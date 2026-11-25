"""Google Colab Pro bootstrap, ABI-isolated env runner, atomic Drive cache, and scratch GC.

Key safety guarantees enforced here:
1. Real GitHub URL self-clone (zero placeholders) when opened standalone via "Open in Colab".
2. Strict Python/C++ ABI isolation: heavy CAE/CAD/EM/Optics libraries execute in dedicated
   `/opt/rk_t4_env_<profile>/bin/python` subprocesses via `run_in_env()`, NEVER polluting the
   running Colab Jupyter kernel's `sys.path`.
3. Host NVIDIA CUDA driver paths (`/usr/lib64-nvidia`, `/usr/local/nvidia/lib64`,
   `/usr/local/cuda/lib64`) are ALWAYS preserved in `LD_LIBRARY_PATH` when prepending env libs.
4. Profile-separated `.tar.zst` environment bundles cached on Google Drive and extracted to
   local NVMe (`/opt/rk_t4_env_*`) with atomic `<name>.tmp.<uuid>` -> `os.replace()` + lockfile.
5. Per-case solver scratch directories live ONLY on local NVMe (`/tmp/rk_t4_work/<case_id>`)
   and are unconditionally `shutil.rmtree()`'d upon case exit (zero Drive FUSE stalls / Errno 28).
6. Tool/solver failures ALWAYS raise `RuntimeError` — NEVER fall back to dummy numbers.
7. Read-only repository verification via `git diff --quiet HEAD -- hardware/ firmware/ src/ optics/ mechanics/`.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Sequence

DEFAULT_REPO_URL = "https://github.com/sc8z35a-collab/GIT-Y5.git"
DEFAULT_REPO_BRANCH = "main"
DEFAULT_REPO_DIR = "/content/rk_t4_repo"
DEFAULT_DRIVE_ROOT = "/content/drive/MyDrive/RK_T4_VirtualLab"
DEFAULT_WORK_BASE = "/tmp/rk_t4_work"
OPT_ENV_ROOT = "/opt"

CANONICAL_INPUT_FILES: tuple[str, ...] = (
    "hardware/rk_t4_mainboard.kicad_pcb",
    "hardware/rk_t4_mainboard.kicad_sch",
    "hardware/rk_t4_mezzanine.kicad_pcb",
    "hardware/rk_t4_mezzanine.kicad_sch",
    "hardware/RK_T4.kicad_sym",
    "hardware/rk_t4_netlist.json",
    "hardware/bom.csv",
    "hardware/stackup_physics.json",
    "firmware/rk3588s2-rk-t4-evt.dts",
    "firmware/bindings/rk-t4.yaml",
    "src/scene/constants.js",
    "optics/rk_t4_main_lens.json",
    "mechanics/assembly_sequence.json",
)

NVIDIA_HOST_LIB_DIRS: tuple[str, ...] = (
    "/usr/lib64-nvidia",
    "/usr/local/nvidia/lib64",
    "/usr/local/cuda/lib64",
)


@dataclass
class RuntimeHardwareInfo:
    os_codename: str
    cpu_count: int
    omp_threads: int
    ram_gb: float
    gpu_name: str | None
    gpu_vram_gb: float
    in_colab: bool
    disk_free_tmp_gb: float


@dataclass
class BootstrapContext:
    repo_dir: Path
    drive_root: Path
    bundles_dir: Path
    reports_dir: Path
    handoff_dir: Path
    checkpoints_dir: Path
    figures_dir: Path
    work_base: Path
    git_commit_sha: str
    input_files_sha256: dict[str, str]
    hw: RuntimeHardwareInfo
    extra: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Atomic Drive I/O & Cross-Tab Lock Manager
# ---------------------------------------------------------------------------


def atomic_write_bytes(dest: str | Path, data: bytes) -> Path:
    """Write bytes atomically via `<name>.tmp.<uuid>` -> fsync -> `os.replace()`."""
    dest_path = Path(dest)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest_path.parent / f".{dest_path.name}.tmp.{uuid.uuid4().hex}"
    try:
        with tmp_path.open("wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, dest_path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise
    return dest_path


def atomic_write_text(dest: str | Path, text: str) -> Path:
    return atomic_write_bytes(dest, text.encode("utf-8"))


def atomic_write_json(dest: str | Path, payload: Any) -> Path:
    text = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=False) + "\n"
    return atomic_write_text(dest, text)


def atomic_copy_file(src: str | Path, dest: str | Path) -> Path:
    """Copy a local file to Drive (or anywhere) atomically via temp file + `os.replace()`."""
    src_path = Path(src)
    dest_path = Path(dest)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest_path.parent / f".{dest_path.name}.tmp.{uuid.uuid4().hex}"
    try:
        shutil.copy2(src_path, tmp_path)
        with tmp_path.open("rb+") as fh:
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, dest_path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise
    return dest_path


class FileLock:
    """Stale-safe exclusive file lock for Google Drive / shared bundle writes."""

    def __init__(self, lock_path: str | Path, timeout_s: float = 300.0, stale_after_s: float = 1800.0):
        self.lock_path = Path(lock_path)
        self.timeout_s = timeout_s
        self.stale_after_s = stale_after_s
        self._acquired = False

    def __enter__(self) -> "FileLock":
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.timeout_s
        payload = json.dumps(
            {
                "host": socket.gethostname(),
                "pid": os.getpid(),
                "created_utc": time.time(),
            }
        ).encode("utf-8")

        while True:
            try:
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
                try:
                    os.write(fd, payload)
                    os.fsync(fd)
                finally:
                    os.close(fd)
                self._acquired = True
                return self
            except FileExistsError:
                try:
                    age = time.time() - self.lock_path.stat().st_mtime
                    if age > self.stale_after_s:
                        self.lock_path.unlink(missing_ok=True)
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"Timed out after {self.timeout_s}s waiting for lock {self.lock_path}"
                    )
                time.sleep(2.0)

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self._acquired:
            self.lock_path.unlink(missing_ok=True)
            self._acquired = False


# ---------------------------------------------------------------------------
# Per-Case Local NVMe Scratch Directory with Unconditional GC
# ---------------------------------------------------------------------------


@contextlib.contextmanager
def ScratchCaseDir(case_id: str, base: str | Path = DEFAULT_WORK_BASE) -> Iterator[Path]:
    """Create `/tmp/rk_t4_work/<case_id>` for solver execution and ALWAYS rmtree on exit."""
    safe_id = "".join(c if c.isalnum() or c in ("_", "-", ".") else "_" for c in case_id)
    case_dir = Path(base) / f"{safe_id}_{uuid.uuid4().hex[:8]}"
    case_dir.mkdir(parents=True, exist_ok=True)
    try:
        yield case_dir
    finally:
        shutil.rmtree(case_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Checkpoint Manager (Atomic Resume per Case)
# ---------------------------------------------------------------------------


class CheckpointManager:
    """Atomic per-case checkpoint store keyed by notebook, run_mode, and git commit SHA."""

    def __init__(self, checkpoints_dir: Path, notebook_id: str, run_mode: str, git_sha: str):
        self.dir = checkpoints_dir / f"nb_{notebook_id}_{run_mode}_{git_sha[:12]}"
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, case_id: str) -> Path:
        safe = "".join(c if c.isalnum() or c in ("_", "-", ".") else "_" for c in case_id)
        return self.dir / f"{safe}.json"

    def has(self, case_id: str) -> bool:
        return self._path(case_id).is_file()

    def load(self, case_id: str) -> dict[str, Any] | None:
        p = self._path(case_id)
        if not p.is_file():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def save(self, case_id: str, data: dict[str, Any]) -> Path:
        return atomic_write_json(self._path(case_id), data)


# ---------------------------------------------------------------------------
# Hardware, OS & Read-Only Repo Guards
# ---------------------------------------------------------------------------


def detect_os_codename() -> str:
    try:
        out = subprocess.check_output(["lsb_release", "-cs"], text=True, stderr=subprocess.DEVNULL).strip()
        if out:
            return out
    except Exception:
        pass
    os_release = Path("/etc/os-release")
    if os_release.is_file():
        for line in os_release.read_text(encoding="utf-8").splitlines():
            if line.startswith("VERSION_CODENAME="):
                return line.split("=", 1)[1].strip().strip('"')
    return platform.system().lower()


def detect_runtime_hardware() -> RuntimeHardwareInfo:
    codename = detect_os_codename()
    cpu_count = os.cpu_count() or 2
    omp_threads = max(1, min(cpu_count, 16))

    ram_gb = 0.0
    meminfo = Path("/proc/meminfo")
    if meminfo.is_file():
        for line in meminfo.read_text(encoding="utf-8").splitlines():
            if line.startswith("MemTotal:"):
                kb = int(line.split()[1])
                ram_gb = round(kb / (1024 * 1024), 2)
                break

    gpu_name: str | None = None
    gpu_vram_gb = 0.0
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            if out:
                first = out.splitlines()[0]
                parts = [x.strip() for x in first.split(",")]
                gpu_name = parts[0]
                gpu_vram_gb = round(float(parts[1]) / 1024.0, 2)
        except Exception:
            pass

    in_colab = "COLAB_RELEASE_TAG" in os.environ or "google.colab" in sys.modules
    usage = shutil.disk_usage("/tmp")
    disk_free_tmp_gb = round(usage.free / (1024**3), 2)

    # Mandatory headless & OpenMPI root-container environment configuration
    os.environ["OMPI_ALLOW_RUN_AS_ROOT"] = "1"
    os.environ["OMPI_ALLOW_RUN_AS_ROOT_CONFIRM"] = "1"
    os.environ["OMP_NUM_THREADS"] = str(omp_threads)
    os.environ["OMP_STACKSIZE"] = "400m"
    os.environ["QT_QPA_PLATFORM"] = "offscreen"
    os.environ["PYVISTA_OFF_SCREEN"] = "true"
    os.environ["MPLBACKEND"] = "Agg"

    return RuntimeHardwareInfo(
        os_codename=codename,
        cpu_count=cpu_count,
        omp_threads=omp_threads,
        ram_gb=ram_gb,
        gpu_name=gpu_name,
        gpu_vram_gb=gpu_vram_gb,
        in_colab=in_colab,
        disk_free_tmp_gb=disk_free_tmp_gb,
    )


def ensure_repo_cloned(
    repo_url: str = DEFAULT_REPO_URL,
    branch: str = DEFAULT_REPO_BRANCH,
    dest: str | Path = DEFAULT_REPO_DIR,
) -> tuple[Path, str]:
    """Ensure RK T4 repository is present locally (supports private token via Colab userdata)."""
    if "<" in repo_url or ">" in repo_url:
        raise ValueError(f"Placeholder REPO_URL detected and forbidden: {repo_url!r}")

    dest_path = Path(dest)
    if not (dest_path / ".git").exists():
        clone_url = repo_url
        token = os.environ.get("GITHUB_TOKEN", "")
        if not token:
            try:
                from google.colab import userdata  # type: ignore

                token = userdata.get("GITHUB_TOKEN") or ""
            except Exception:
                token = ""
        if token and clone_url.startswith("https://github.com/"):
            clone_url = clone_url.replace("https://github.com/", f"https://{token}@github.com/", 1)

        dest_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = ["git", "clone", "--depth", "1", "--branch", branch, clone_url, str(dest_path)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            safe_err = res.stderr.replace(token, "***") if token else res.stderr
            raise RuntimeError(f"Failed to clone {repo_url}@{branch}: {safe_err}")

    sha = subprocess.check_output(
        ["git", "-C", str(dest_path), "rev-parse", "HEAD"], text=True
    ).strip()
    return dest_path, sha


def compute_input_hashes(repo_dir: Path) -> dict[str, str]:
    """Compute SHA-256 digests of all canonical Single Source of Truth input files."""
    hashes: dict[str, str] = {}
    missing: list[str] = []
    for rel in CANONICAL_INPUT_FILES:
        p = repo_dir / rel
        if not p.is_file():
            missing.append(rel)
            continue
        h = hashlib.sha256()
        with p.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        hashes[rel] = h.hexdigest()
    if missing:
        raise FileNotFoundError(
            f"Missing canonical Single Source of Truth files in {repo_dir}: {missing}"
        )
    return hashes


def verify_repo_unmodified(repo_dir: Path) -> bool:
    """Strictly verify tracked input design directories were NEVER modified during verification."""
    tracked_dirs = [
        d for d in ("hardware/", "firmware/", "src/", "optics/", "mechanics/")
        if (repo_dir / d.rstrip("/")).exists()
    ]
    res = subprocess.run(
        ["git", "-C", str(repo_dir), "diff", "--quiet", "HEAD", "--", *tracked_dirs],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        stat = subprocess.check_output(
            ["git", "-C", str(repo_dir), "diff", "--stat", "HEAD", "--", *tracked_dirs],
            text=True,
        )
        raise RuntimeError(
            "READ-ONLY VIOLATION: Verification modified tracked design files!\n" + stat
        )
    return True


def mount_drive_and_prepare(
    drive_root: str | Path = DEFAULT_DRIVE_ROOT,
) -> Path:
    """Mount Google Drive when running on Colab; support local dir override in CI/tests."""
    override = os.environ.get("RK_T4_LOCAL_OUT_DIR")
    if override:
        root = Path(override)
    else:
        root = Path(drive_root)
        if str(root).startswith("/content/drive") and not Path("/content/drive/MyDrive").exists():
            try:
                from google.colab import drive  # type: ignore
            except ImportError as exc:
                raise RuntimeError(
                    "google.colab not available and RK_T4_LOCAL_OUT_DIR is not set."
                ) from exc

            last_err: Exception | None = None
            for attempt in range(2):
                try:
                    drive.mount("/content/drive", force_remount=False)
                    last_err = None
                    break
                except Exception as exc:
                    last_err = exc
                    if attempt == 0:
                        time.sleep(3.0)
            if last_err is not None and not Path("/content/drive/MyDrive").exists():
                raise RuntimeError(
                    f"Google Drive mount failed ({type(last_err).__name__}: {last_err}).\n"
                    "【解決手順 / How to fix in Google Colab】\n"
                    "  1. 左サイドバーの 📁（ファイル）→「ドライブをマウント」ボタンを先にクリックし、認証画面で\n"
                    "     『Google ドライブのすべてのファイルの参照、編集、作成、削除』にチェックを入れて許可してから再実行してください。\n"
                    "  2. 複数タブを同時に開いた場合は OAuth ポップアップが競合するため、1 タブずつマウント完了後に次タブを実行してください。\n"
                    "  3. シークレットモードや広告/CookieブロッカーがサードパーティCookie・ポップアップを遮断している場合は許可してください。\n"
                    "  4. Drive を使わずローカル単体実行したい場合はセル 1 の DRIVE_ROOT を '/content/RK_T4_VirtualLab' に変更してください。"
                ) from last_err
    for sub in ("bundles", "reports", "handoff", "checkpoints", "figures"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def bootstrap_notebook(
    repo_url: str = DEFAULT_REPO_URL,
    repo_branch: str = DEFAULT_REPO_BRANCH,
    repo_dir: str | Path = DEFAULT_REPO_DIR,
    drive_root: str | Path = DEFAULT_DRIVE_ROOT,
    require_gpu: bool = False,
) -> BootstrapContext:
    """One-call bootstrap for every notebook's setup cell."""
    hw = detect_runtime_hardware()
    if require_gpu and not hw.gpu_name:
        raise RuntimeError(
            "This notebook REQUIRES an NVIDIA GPU runtime (A100 or L4), "
            "but no GPU was detected via nvidia-smi. Switch Colab runtime to GPU!"
        )

    rdir, git_sha = ensure_repo_cloned(repo_url=repo_url, branch=repo_branch, dest=repo_dir)
    droot = mount_drive_and_prepare(drive_root=drive_root)
    work_base = Path(DEFAULT_WORK_BASE)
    work_base.mkdir(parents=True, exist_ok=True)
    hashes = compute_input_hashes(rdir)

    return BootstrapContext(
        repo_dir=rdir,
        drive_root=droot,
        bundles_dir=droot / "bundles",
        reports_dir=droot / "reports",
        handoff_dir=droot / "handoff",
        checkpoints_dir=droot / "checkpoints",
        figures_dir=droot / "figures",
        work_base=work_base,
        git_commit_sha=git_sha,
        input_files_sha256=hashes,
        hw=hw,
    )


# ---------------------------------------------------------------------------
# ABI-Isolated Subprocess Environment Runner (Preserves Host NVIDIA Driver!)
# ---------------------------------------------------------------------------


def build_isolated_env(
    profile: str,
    extra_env: dict[str, str] | None = None,
) -> dict[str, str]:
    """Construct clean subprocess environment for `/opt/rk_t4_env_<profile>`.

    Critically preserves Colab's NVIDIA CUDA driver paths (`/usr/lib64-nvidia`,
    `/usr/local/nvidia/lib64`, `/usr/local/cuda/lib64`) while prepending
    `/opt/rk_t4_env_<profile>/lib` and `/opt/rk_t4_solvers_cpu/lib`.
    """
    env = os.environ.copy()
    env_root = Path(OPT_ENV_ROOT) / f"rk_t4_env_{profile}"
    solvers_root = Path(OPT_ENV_ROOT) / "rk_t4_solvers_cpu"

    path_entries = [str(env_root / "bin"), str(solvers_root / "bin")]
    if env.get("PATH"):
        path_entries.append(env["PATH"])
    env["PATH"] = ":".join(path_entries)

    # Preserve existing LD_LIBRARY_PATH + host NVIDIA driver paths unconditionally!
    ld_entries: list[str] = []
    for candidate in (
        str(env_root / "lib"),
        str(solvers_root / "lib"),
        str(solvers_root / "lib64"),
        *NVIDIA_HOST_LIB_DIRS,
    ):
        if candidate not in ld_entries:
            ld_entries.append(candidate)
    if env.get("LD_LIBRARY_PATH"):
        for item in env["LD_LIBRARY_PATH"].split(":"):
            if item and item not in ld_entries:
                ld_entries.append(item)
    env["LD_LIBRARY_PATH"] = ":".join(ld_entries)

    # OpenRadioss environment
    or_root = solvers_root / "openradioss"
    if or_root.exists():
        env["OPENRADIOSS_PATH"] = str(or_root)
        env["RAD_CFG_PATH"] = str(or_root / "hm_cfg_files")
        env["LD_LIBRARY_PATH"] = (
            f"{or_root / 'extlib' / 'hm_reader' / 'linux64'}:"
            f"{or_root / 'extlib' / 'h3d' / 'lib' / 'linux64'}:"
            + env["LD_LIBRARY_PATH"]
        )
        env["PATH"] = f"{or_root / 'exec'}:" + env["PATH"]

    # Headless + OpenMPI root settings
    env["OMPI_ALLOW_RUN_AS_ROOT"] = "1"
    env["OMPI_ALLOW_RUN_AS_ROOT_CONFIRM"] = "1"
    env["OMP_STACKSIZE"] = "400m"
    env["QT_QPA_PLATFORM"] = "offscreen"
    env["PYVISTA_OFF_SCREEN"] = "true"
    env["MPLBACKEND"] = "Agg"
    env["PYTHONNOUSERSITE"] = "1"

    if extra_env:
        env.update(extra_env)
    return env


def run_in_env(
    profile: str,
    script_path: str | Path,
    args: Sequence[str] | None = None,
    extra_env: dict[str, str] | None = None,
    cwd: str | Path | None = None,
    timeout_s: float | None = None,
) -> subprocess.CompletedProcess[str]:
    """Execute a Python worker script inside `/opt/rk_t4_env_<profile>/bin/python`.

    Never loads foreign C/C++/CUDA extensions into the live Colab Jupyter kernel.
    Raises RuntimeError if the subprocess exits non-zero.
    """
    env_python = Path(OPT_ENV_ROOT) / f"rk_t4_env_{profile}" / "bin" / "python"
    if not env_python.exists():
        raise RuntimeError(
            f"Isolated environment python not found: {env_python}. "
            f"Run install_profile('{profile}', ...) before calling run_in_env()."
        )

    env = build_isolated_env(profile, extra_env=extra_env)
    cmd = [str(env_python), str(script_path), *(list(args) if args else [])]
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout_s,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"run_in_env(profile={profile!r}, script={script_path}) failed (rc={proc.returncode}):\n"
            f"--- STDOUT ---\n{proc.stdout[-4000:]}\n"
            f"--- STDERR ---\n{proc.stderr[-4000:]}"
        )
    return proc


# ---------------------------------------------------------------------------
# OpenFOAM Dynamic Environment Wrapper
# ---------------------------------------------------------------------------


def find_openfoam_bashrc() -> Path:
    """Dynamically locate installed OpenCFD OpenFOAM bashrc (`/usr/lib/openfoam/openfoam*/etc/bashrc`)."""
    candidates = sorted(Path("/usr/lib/openfoam").glob("openfoam*/etc/bashrc"), reverse=True)
    if not candidates:
        raise RuntimeError(
            "OpenCFD OpenFOAM bashrc not found under /usr/lib/openfoam/openfoam*/etc/bashrc. "
            "Install latest openfoam<YYMM>-default first."
        )
    return candidates[0]


def run_openfoam_cmd(
    shell_cmd: str,
    cwd: str | Path,
    timeout_s: float | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run an OpenFOAM command with dynamically sourced OpenCFD bashrc."""
    bashrc = find_openfoam_bashrc()
    env = os.environ.copy()
    env["OMPI_ALLOW_RUN_AS_ROOT"] = "1"
    env["OMPI_ALLOW_RUN_AS_ROOT_CONFIRM"] = "1"
    full_cmd = f"set -eo pipefail; source '{bashrc}'; {shell_cmd}"
    proc = subprocess.run(
        ["bash", "-lc", full_cmd],
        cwd=str(cwd),
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout_s,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"OpenFOAM command failed (rc={proc.returncode}): {shell_cmd}\n"
            f"--- STDOUT ---\n{proc.stdout[-3000:]}\n"
            f"--- STDERR ---\n{proc.stderr[-3000:]}"
        )
    return proc


# ---------------------------------------------------------------------------
# Profile-Separated .tar.zst Bundle Builders & Restorers (Drive <-> Local NVMe)
# ---------------------------------------------------------------------------


def _run_bash(cmd: str, timeout_s: float | None = None) -> str:
    proc = subprocess.run(["bash", "-lc", f"set -euo pipefail\n{cmd}"], text=True, capture_output=True, timeout=timeout_s)
    if proc.returncode != 0:
        raise RuntimeError(
            f"Shell step failed (rc={proc.returncode}):\n{cmd[:400]}\n"
            f"--- STDOUT ---\n{proc.stdout[-3000:]}\n"
            f"--- STDERR ---\n{proc.stderr[-3000:]}"
        )
    return proc.stdout


def _extract_tar_zst(archive: Path, dest_parent: Path) -> None:
    dest_parent.mkdir(parents=True, exist_ok=True)
    _run_bash(f"tar --use-compress-program='zstd -T0 -d' -xf '{archive}' -C '{dest_parent}'")


def _pack_tar_zst_to_drive(src_dir: Path, archive_dest: Path) -> None:
    """Compress local NVMe directory to `/tmp` `.tar.zst` and atomically publish to Drive under lock."""
    lock = FileLock(archive_dest.with_suffix(archive_dest.suffix + ".lock"))
    with lock:
        if archive_dest.is_file() and archive_dest.stat().st_size > 1024 * 1024:
            return
        local_tmp = Path(tempfile.gettempdir()) / f"{archive_dest.name}.{uuid.uuid4().hex}.tar.zst"
        try:
            _run_bash(
                f"tar --use-compress-program='zstd -T0 -6' -cf '{local_tmp}' "
                f"-C '{src_dir.parent}' '{src_dir.name}'"
            )
            atomic_copy_file(local_tmp, archive_dest)
        finally:
            local_tmp.unlink(missing_ok=True)


def ensure_micromamba() -> Path:
    mm = Path("/usr/local/bin/micromamba")
    if mm.exists():
        return mm
    _run_bash(
        "curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest "
        "| tar -xvj -C /usr/local/bin --strip-components=1 bin/micromamba && chmod +x /usr/local/bin/micromamba"
    )
    if not mm.exists():
        raise RuntimeError("Failed to install micromamba into /usr/local/bin/micromamba")
    return mm


def ensure_apt_tools(
    ctx: BootstrapContext,
    need_kicad: bool = False,
    need_openfoam: bool = False,
    need_elmer: bool = False,
    need_ngspice: bool = False,
    need_calculix: bool = False,
    need_qemu_dtc: bool = False,
    need_openems_build_deps: bool = False,
) -> None:
    """Install required official apt packages (KiCad 9 PPA, OpenCFD dynamic OpenFOAM, Elmer, etc.)
    with Drive `.deb` cache `.tar.zst` acceleration."""
    codename = ctx.hw.os_codename
    deb_bundle = ctx.bundles_dir / f"apt_debs_{codename}.tar.zst"
    apt_cache_dir = Path("/var/cache/apt/archives")

    _run_bash("apt-get update -qq && apt-get install -y -qq zstd curl ca-certificates gnupg software-properties-common")

    if deb_bundle.is_file():
        try:
            _extract_tar_zst(deb_bundle, Path("/var/cache/apt"))
        except Exception:
            pass

    pkgs: list[str] = ["xvfb", "libgl1", "libegl1", "zstd"]

    if need_kicad and not shutil.which("kicad-cli"):
        _run_bash("add-apt-repository -y ppa:kicad/kicad-9.0-releases")
        pkgs.append("kicad")

    if need_openfoam:
        try:
            find_openfoam_bashrc()
        except RuntimeError:
            _run_bash("curl -fsSL https://dl.openfoam.com/add-debian-repo.sh | bash")
            of_pkg = _run_bash(
                "apt-get update -qq >/dev/null && "
                "apt-cache search '^openfoam[0-9]{4}-default$' | awk '{print $1}' | sort -V | tail -n 1"
            ).strip()
            if not of_pkg:
                raise RuntimeError("Could not locate any openfoam<YYMM>-default package from OpenCFD repo!")
            pkgs.append(of_pkg)

    if need_elmer and not (shutil.which("ElmerSolver") and shutil.which("ElmerGrid")):
        _run_bash("add-apt-repository -y ppa:elmer-csc-ubuntu/elmer-csc-ppa || true")
        pkgs.append("elmerfem-csc")

    if need_ngspice and not shutil.which("ngspice"):
        pkgs.append("ngspice")
    if need_calculix and not shutil.which("ccx"):
        pkgs.append("calculix-ccx")
    if need_qemu_dtc:
        if not shutil.which("dtc"):
            pkgs.append("device-tree-compiler")
        if not shutil.which("qemu-system-aarch64"):
            pkgs.append("qemu-system-aarch64")
        if not shutil.which("aarch64-linux-gnu-gcc"):
            pkgs.append("gcc-aarch64-linux-gnu")

    if need_openems_build_deps:
        pkgs.extend(
            [
                "build-essential",
                "cmake",
                "ninja-build",
                "git",
                "libhdf5-dev",
                "libvtk9-dev",
                "libboost-all-dev",
                "libcgal-dev",
                "libtinyxml-dev",
                "pkg-config",
            ]
        )

    if pkgs:
        uniq = sorted(set(pkgs))
        # Try elmerfem-csc; if PPA unavailable on a newer Ubuntu codename, conda-forge elmerfem handles it
        install_list = [p for p in uniq if p != "elmerfem-csc"]
        _run_bash(
            "apt-get update -qq && DEBIAN_FRONTEND=noninteractive "
            f"apt-get install -y --no-install-recommends {' '.join(install_list)}"
        )
        if "elmerfem-csc" in uniq:
            proc = subprocess.run(
                ["bash", "-lc", "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends elmerfem-csc"],
                text=True,
                capture_output=True,
            )
            if proc.returncode != 0:
                # Fallback to conda-forge elmerfem inside cpu_cae env (still real ElmerSolver + ElmerGrid!)
                pass

        # Cache downloaded .debs to Drive atomically for fast cold boots
        if any(apt_cache_dir.glob("*.deb")):
            _pack_tar_zst_to_drive(apt_cache_dir, deb_bundle)


def ensure_cpu_cae_env(ctx: BootstrapContext, need_elmer_conda: bool = False) -> Path:
    """Restore or build `/opt/rk_t4_env_cpu_cae` (micromamba + pip) cached as `.tar.zst` on Drive."""
    env_dir = Path(OPT_ENV_ROOT) / "rk_t4_env_cpu_cae"
    bundle = ctx.bundles_dir / f"env_cpu_{ctx.hw.os_codename}.tar.zst"

    if not (env_dir / "bin" / "python").exists():
        if bundle.is_file():
            _extract_tar_zst(bundle, Path(OPT_ENV_ROOT))
        else:
            mm = ensure_micromamba()
            conda_pkgs = [
                "python=3.11",
                "pip",
                "numpy",
                "scipy",
                "matplotlib",
                "pydantic>=2.7",
                "pyyaml",
                "jsonschema",
                "lxml",
                "shapely",
                "h5py",
                "cython",
                "gmsh",
                "python-gmsh",
                "scikit-rf",
                "pybamm",
                "cadquery",
            ]
            if need_elmer_conda or not (shutil.which("ElmerSolver") and shutil.which("ElmerGrid")):
                conda_pkgs.append("elmerfem")
            _run_bash(
                f"'{mm}' create -y -p '{env_dir}' -c conda-forge --override-channels "
                + " ".join(f"'{p}'" for p in conda_pkgs),
                timeout_s=1800,
            )
            _run_bash(
                f"'{env_dir}/bin/pip' install --no-cache-dir "
                "build123d manifold3d dtschema trimesh pillow",
                timeout_s=900,
            )
            _pack_tar_zst_to_drive(env_dir, bundle)

    if need_elmer_conda and not (
        shutil.which("ElmerSolver") or (env_dir / "bin" / "ElmerSolver").exists()
    ):
        mm = ensure_micromamba()
        _run_bash(f"'{mm}' install -y -p '{env_dir}' -c conda-forge elmerfem", timeout_s=900)
        _pack_tar_zst_to_drive(env_dir, bundle)

    return env_dir


def ensure_solvers_cpu_bundle(
    ctx: BootstrapContext,
    need_openems: bool = False,
    need_openradioss: bool = False,
) -> Path:
    """Restore or build headless openEMS (no Qt GUI) and official OpenRadioss Linux64 in `/opt/rk_t4_solvers_cpu`."""
    solvers_dir = Path(OPT_ENV_ROOT) / "rk_t4_solvers_cpu"
    env_dir = ensure_cpu_cae_env(ctx)
    bundle = ctx.bundles_dir / f"solvers_cpu_{ctx.hw.os_codename}.tar.zst"

    if bundle.is_file() and not solvers_dir.exists():
        _extract_tar_zst(bundle, Path(OPT_ENV_ROOT))

    modified = False

    if need_openems and not (solvers_dir / "bin" / "openEMS").exists():
        ensure_apt_tools(ctx, need_openems_build_deps=True)
        solvers_dir.mkdir(parents=True, exist_ok=True)
        with ScratchCaseDir("build_openems", ctx.work_base) as bdir:
            _run_bash(
                f"""
                git clone --depth 1 --recursive https://github.com/thliebig/openEMS-Project.git '{bdir}/openEMS-Project'
                cd '{bdir}/openEMS-Project'
                for comp in fparser CSXCAD openEMS; do
                  mkdir -p build_$comp && cd build_$comp
                  cmake ../$comp -G Ninja \
                    -DCMAKE_INSTALL_PREFIX='{solvers_dir}' \
                    -DCMAKE_PREFIX_PATH='{solvers_dir}' \
                    -DCMAKE_INSTALL_RPATH='{solvers_dir}/lib' \
                    -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
                    -DFPARSER_ROOT_DIR='{solvers_dir}' \
                    -DCSXCAD_ROOT_DIR='{solvers_dir}' \
                    -DBUILD_QCSXCAD=OFF \
                    -DBUILD_APPCSXCAD=OFF
                  ninja -j{ctx.hw.omp_threads}
                  ninja install
                  cd '{bdir}/openEMS-Project'
                done
                export CSXCAD_INSTALL_PATH='{solvers_dir}'
                export OPENEMS_INSTALL_PATH='{solvers_dir}'
                export LD_LIBRARY_PATH='{solvers_dir}/lib':"${{LD_LIBRARY_PATH:-}}"
                '{env_dir}/bin/pip' install --no-build-isolation --no-deps '{bdir}/openEMS-Project/CSXCAD/python'
                '{env_dir}/bin/pip' install --no-build-isolation --no-deps '{bdir}/openEMS-Project/openEMS/python'
                """,
                timeout_s=2400,
            )
        modified = True

    if need_openradioss and not (solvers_dir / "openradioss" / "exec" / "starter_linux64_gf").exists():
        solvers_dir.mkdir(parents=True, exist_ok=True)
        with ScratchCaseDir("install_openradioss", ctx.work_base) as bdir:
            _run_bash(
                f"""
                RELEASE_URL=$(curl -fsSL https://api.github.com/repos/OpenRadioss/OpenRadioss/releases/latest \
                  | python3 -c "import sys,json; d=json.load(sys.stdin); \
                    assets=[a['browser_download_url'] for a in d.get('assets',[]) if 'linux64' in a['name'].lower() and a['name'].endswith('.zip')]; \
                    print(assets[0] if assets else '')")
                if [ -z "$RELEASE_URL" ]; then
                  echo "ERROR: Could not resolve official OpenRadioss Linux64 release archive" >&2
                  exit 1
                fi
                curl -fL "$RELEASE_URL" -o '{bdir}/openradioss.zip'
                apt-get install -y -qq unzip
                mkdir -p '{solvers_dir}/openradioss'
                unzip -qo '{bdir}/openradioss.zip' -d '{bdir}/or_unpack'
                TOP=$(find '{bdir}/or_unpack' -maxdepth 2 -type d -name 'exec' | head -n 1 | xargs dirname)
                cp -a "$TOP/." '{solvers_dir}/openradioss/'
                chmod +x '{solvers_dir}/openradioss/exec/'*
                """,
                timeout_s=1200,
            )
        modified = True

    if modified:
        _pack_tar_zst_to_drive(solvers_dir, bundle)
        _pack_tar_zst_to_drive(env_dir, ctx.bundles_dir / f"env_cpu_{ctx.hw.os_codename}.tar.zst")

    return solvers_dir


def ensure_gpu_optics_env(ctx: BootstrapContext) -> Path:
    """Restore or build GPU-only `/opt/rk_t4_env_gpu_optics` (CUDA torch + optiland + mitsuba cuda_ad_rgb)."""
    if not ctx.hw.gpu_name:
        raise RuntimeError("GPU optics env requested without an active NVIDIA GPU.")
    env_dir = Path(OPT_ENV_ROOT) / "rk_t4_env_gpu_optics"
    bundle = ctx.bundles_dir / f"env_gpu_{ctx.hw.os_codename}.tar.zst"

    if not (env_dir / "bin" / "python").exists():
        if bundle.is_file():
            _extract_tar_zst(bundle, Path(OPT_ENV_ROOT))
        else:
            mm = ensure_micromamba()
            _run_bash(
                f"'{mm}' create -y -p '{env_dir}' -c conda-forge --override-channels "
                "python=3.11 pip numpy scipy matplotlib pydantic>=2.7 pillow",
                timeout_s=900,
            )
            # Install CUDA-enabled PyTorch FIRST, then optiland (without [torch] overwrite) + mitsuba
            _run_bash(
                f"'{env_dir}/bin/pip' install --no-cache-dir "
                "--index-url https://download.pytorch.org/whl/cu124 torch && "
                f"'{env_dir}/bin/pip' install --no-cache-dir optiland mitsuba",
                timeout_s=1200,
            )
            _pack_tar_zst_to_drive(env_dir, bundle)

    return env_dir


# ---------------------------------------------------------------------------
# Strict Binary & Minimal Solver Smoke Verification (Zero Silent Fallbacks!)
# ---------------------------------------------------------------------------


def verify_tool_smoke(
    required_tools: Sequence[str],
    profile: str = "cpu_cae",
) -> dict[str, str]:
    """Verify every required binary/library exists AND passes a real minimal smoke check.

    Immediately raises RuntimeError on any failure — NEVER degrades to approximations.
    """
    versions: dict[str, str] = {}
    env = build_isolated_env(profile)

    def _check_cmd(cmd: list[str], label: str) -> str:
        proc = subprocess.run(cmd, env=env, text=True, capture_output=True, timeout=60)
        if proc.returncode != 0:
            raise RuntimeError(
                f"Tool smoke check FAILED for {label} ({cmd}): rc={proc.returncode}\n"
                f"stdout={proc.stdout[:500]}\nstderr={proc.stderr[:500]}"
            )
        return (proc.stdout.strip() or proc.stderr.strip()).splitlines()[0] if (proc.stdout or proc.stderr) else "ok"

    for tool in required_tools:
        if tool == "kicad-cli":
            versions[tool] = _check_cmd(["kicad-cli", "--version"], tool)
        elif tool == "dtc":
            versions[tool] = _check_cmd(["dtc", "--version"], tool)
        elif tool == "qemu-system-aarch64":
            versions[tool] = _check_cmd(["qemu-system-aarch64", "--version"], tool)
        elif tool == "aarch64-linux-gnu-gcc":
            versions[tool] = _check_cmd(["aarch64-linux-gnu-gcc", "--version"], tool)
        elif tool == "ngspice":
            versions[tool] = _check_cmd(["ngspice", "--version"], tool)
        elif tool == "ccx":
            versions[tool] = _check_cmd(["ccx", "-v"], tool)
        elif tool == "openfoam":
            proc = run_openfoam_cmd("chtMultiRegionSimpleFoam -help | head -n 3", cwd="/tmp")
            versions[tool] = proc.stdout.strip().splitlines()[0]
        elif tool == "elmer":
            v1 = _check_cmd(["ElmerSolver", "--version"], "ElmerSolver")
            v2 = _check_cmd(["ElmerGrid", "-h"], "ElmerGrid")
            versions[tool] = f"{v1} | {v2}"
        elif tool == "openradioss":
            or_exec = Path(OPT_ENV_ROOT) / "rk_t4_solvers_cpu" / "openradioss" / "exec"
            starter = or_exec / "starter_linux64_gf"
            engine = or_exec / "engine_linux64_gf"
            if not (starter.exists() and engine.exists()):
                raise RuntimeError(f"OpenRadioss binaries missing under {or_exec}")
            versions[tool] = f"starter={starter.name}, engine={engine.name}"
        elif tool == "openems":
            py = Path(OPT_ENV_ROOT) / f"rk_t4_env_{profile}" / "bin" / "python"
            versions[tool] = _check_cmd(
                [str(py), "-c", "import CSXCAD, openEMS; print('CSXCAD+openEMS OK')"],
                "openEMS python bindings",
            )
        elif tool == "gpu_optics":
            py = Path(OPT_ENV_ROOT) / "rk_t4_env_gpu_optics" / "bin" / "python"
            versions[tool] = _check_cmd(
                [
                    str(py),
                    "-c",
                    "import torch, optiland, mitsuba as mi; "
                    "assert torch.cuda.is_available(), 'CUDA torch unavailable!'; "
                    "mi.set_variant('cuda_ad_rgb'); "
                    "print(f'torch={torch.__version__} gpu={torch.cuda.get_device_name(0)} mitsuba=cuda_ad_rgb')",
                ],
                "gpu_optics(torch+optiland+mitsuba)",
            )
        elif tool == "cpu_cae_python":
            py = Path(OPT_ENV_ROOT) / f"rk_t4_env_{profile}" / "bin" / "python"
            versions[tool] = _check_cmd(
                [
                    str(py),
                    "-c",
                    "import gmsh, manifold3d, skrf, pybamm, shapely, pydantic; "
                    "print(f'gmsh={gmsh.__version__} skrf={skrf.__version__} pybamm={pybamm.__version__}')",
                ],
                "cpu_cae_python",
            )
        else:
            raise ValueError(f"Unknown required tool key: {tool!r}")

    return versions
