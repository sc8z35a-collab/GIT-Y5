"""Comprehensive Local Verification Suite for RK T4 Ultimate Digital Twin Signoff Suite.

Covers all 3 mandatory verification gates before git commit/push:
  1. All 11 `.ipynb` nbformat validation, Python AST parsing, ruff/undefined-name lint,
     and zero placeholder URL / zero forbidden legacy-doc reference verification.
  2. Consistency unit tests between the 4 new canonical input files
     (`optics/rk_t4_main_lens.json`, `mechanics/assembly_sequence.json`,
      `hardware/stackup_physics.json`, `firmware/bindings/rk-t4.yaml`)
     and the real RK T4 Rev 5.0 EVT repository files (14L+8L PCBs/Schematics,
     `.kicad_mod`, `rk_t4_netlist.json`, `bom.csv`, `.dts`, `constants.js`).
  3. End-to-end Schema + Provenance + Cross-Domain FMEA integration tests driving
     Notebook 09 (`nb09_master_signoff_engine.py`):
     (a) All 10 upstream reports `00`..`08` PASS in `ULTRA_SIGNOFF` -> `APPROVED_FOR_EVT_TAPEOUT`
     (b) Real design violations (FAIL/WARN) -> zero crash, `SIGNOFF_REJECTED_NEEDS_REV6_PATCH`,
         and concrete RefDes/MPN/DTS entries populated in `rev6_patch_orders.json` + HTML dashboard
     (c) Any `QUICK_CHECK` mixed in -> blocked with `PRELIMINARY_QUICK_CHECK_ONLY`
     (d) Dummy 1mm x 1mm x 1mm cube `solver_provenance` cheat injected -> blocked with
         `SIGNOFF_BLOCKED_PROVENANCE_OR_SCHEMA_ERROR`
  4. Bootstrap safety tests (atomic writes, FileLock, ScratchCaseDir GC on error,
     LD_LIBRARY_PATH NVIDIA CUDA preservation, read-only repo invariance).
"""

from __future__ import annotations

import ast
import hashlib
import itertools
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import nbformat
import numpy as np
import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SUITE_DIR = REPO_ROOT / "colab_ultimate_signoff"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from colab_ultimate_signoff.common.colab_bootstrap import (
    CheckpointManager,
    FileLock,
    NVIDIA_HOST_LIB_DIRS,
    ScratchCaseDir,
    atomic_write_json,
    build_isolated_env,
    compute_input_hashes,
    verify_repo_unmodified,
)
from colab_ultimate_signoff.common.design_parsers import (
    decode_mpn,
    djordjevic_sarkar_er_df,
    load_bom_rows,
    load_netlist,
    parse_constants_js,
    parse_dts_metadata,
    parse_kicad_pcb_summary,
)
from colab_ultimate_signoff.common.schemas import (
    AffectedEntity,
    AuditCheckItem,
    BoundingBoxMM,
    NotebookReportBase,
    RawOutputFileHash,
    SolverProvenance,
    audit_provenance_integrity,
)
from colab_ultimate_signoff.workers.nb01_cad_mesh_prep import _collect_rk_t4_bodies
from colab_ultimate_signoff.workers.nb09_master_signoff_engine import (
    EXPECTED_UPSTREAM_IDS,
    run_nb09_master_signoff,
)

EXPECTED_NOTEBOOKS = [
    "00_truth_boot_stackup_pcba_audit.ipynb",
    "01_cae_watertight_cad_prep.ipynb",
    "02_em_si_pi_coldboot_esd_mc.ipynb",
    "03_rf_anechoic_desense_coex_nfc_mag.ipynb",
    "04a_drop_bga_shock_retention.ipynb",
    "04b_static_creep_reflow_vib_ip68.ipynb",
    "05_gpu_optics_isp.ipynb",
    "06_thermal_cfd_ctm_battery_safety.ipynb",
    "07_cpu_acoustics_haptics_touch.ipynb",
    "08_3d_tolerance_assembly_fpc.ipynb",
    "09_cross_fmea_master_signoff.ipynb",
]


# =============================================================================
# GATE 1: All 11 Notebooks nbformat + AST + Undefined-Name Lint + Real URL Check
# =============================================================================


def test_all_11_notebooks_exist_and_nbformat_valid() -> None:
    for fname in EXPECTED_NOTEBOOKS:
        nb_path = SUITE_DIR / fname
        assert nb_path.is_file(), f"Missing notebook: {nb_path}"
        nb = nbformat.read(nb_path, as_version=4)
        nbformat.validate(nb)
        assert len(nb.cells) >= 4, f"{fname} has too few cells"


def test_all_11_notebooks_ast_lint_and_no_placeholder_urls(tmp_path: Path) -> None:
    """Concatenate every notebook's code cells in execution order, verify AST & ruff F/E9 (zero undefined names),
    and guarantee ZERO `<USER>/<REPO>` placeholders and REAL GitHub Colab badge URLs."""
    for fname in EXPECTED_NOTEBOOKS:
        nb_path = SUITE_DIR / fname
        raw_txt = nb_path.read_text(encoding="utf-8")
        assert "<USER>" not in raw_txt and "<REPO>" not in raw_txt, f"Placeholder URL left in {fname}"
        assert "sc8z35a-collab/GIT-Y5" in raw_txt, f"Real repo URL missing in {fname}"
        assert f"https://colab.research.google.com/github/sc8z35a-collab/GIT-Y5/blob/main/colab_ultimate_signoff/{fname}" in raw_txt
        # Forbidden legacy doc references must NOT appear as inputs in notebooks
        for forbidden in ("DESIGN_ARCHITECTURE.md", "route_hdi_rev3.mjs", "route_hdi_rev4.mjs", "REV3_VERIFICATION", "REV4_PRODUCTION"):
            assert forbidden not in raw_txt, f"Forbidden legacy reference {forbidden} found in {fname}"

        nb = nbformat.read(nb_path, as_version=4)
        combined_code_parts = []
        for idx, cell in enumerate(nb.cells):
            if cell.cell_type == "code":
                src = cell.source
                ast.parse(src, filename=f"{fname}#cell{idx}")
                combined_code_parts.append(f"# --- cell {idx} ---\n{src}\n")

        # Verify combined execution flow has zero undefined names / missing imports via ruff F,E9
        py_dump = tmp_path / f"{fname.replace('.ipynb', '.py')}"
        py_dump.write_text("\n".join(combined_code_parts), encoding="utf-8")
        proc = subprocess.run(
            ["ruff", "check", "--select", "F821,F822,F823,E9", str(py_dump)],
            text=True,
            capture_output=True,
        )
        assert proc.returncode == 0, f"Undefined-name/syntax lint failed in {fname}:\n{proc.stdout}\n{proc.stderr}"

        # GPU isolation verification: ONLY notebook 05 should have GPU accelerator metadata
        if fname == "05_gpu_optics_isp.ipynb":
            assert nb.metadata.get("accelerator") == "GPU"
            assert "require_gpu=True" in raw_txt
        else:
            assert nb.metadata.get("accelerator") != "GPU"
            assert "require_gpu=False" in raw_txt


def test_readme_contains_all_11_real_colab_badges_and_waves() -> None:
    readme = (SUITE_DIR / "README.md").read_text(encoding="utf-8")
    assert "<USER>" not in readme and "<REPO>" not in readme
    for fname in EXPECTED_NOTEBOOKS:
        expected_url = f"https://colab.research.google.com/github/sc8z35a-collab/GIT-Y5/blob/main/colab_ultimate_signoff/{fname}"
        assert expected_url in readme, f"README missing Open in Colab badge for {fname}"
    for wave in ("Wave 1", "Wave 2A", "Wave 2B", "Wave 3", "06_battery_swelling_handoff.json"):
        assert wave in readme


# =============================================================================
# GATE 2: Consistency Unit Tests Between 4 New Canonical Files & Real Repository
# =============================================================================


def test_canonical_optics_matches_camera_system_and_paraxial_efl() -> None:
    lens = json.loads((REPO_ROOT / "optics" / "rk_t4_main_lens.json").read_text(encoding="utf-8"))
    consts = parse_constants_js(REPO_ROOT)
    bom_mpns = {r["mpn"] for r in load_bom_rows(REPO_ROOT)}

    assert lens["model_fidelity"] == "reference_patent_prescription"
    assert lens["sensor"]["mpn"] in bom_mpns  # LYT-818
    assert lens["sensor"]["ois_claf_driver_mpn"] in bom_mpns  # DW9786

    # Verify exact surface counts: 14 lens surfaces (91 pairs) + 2 sapphire + 2 IRCF = 18 coated surfaces (153 pairs)
    lens_surfs = [s for s in lens["surfaces"] if s.get("is_lens_body_surface")]
    coated_surfs = [s for s in lens["surfaces"] if s.get("coating")]
    assert len(lens_surfs) == 14
    assert len(list(itertools.combinations(lens_surfs, 2))) == 91
    assert len(coated_surfs) == 18
    assert len(list(itertools.combinations(coated_surfs, 2))) == 153

    # Verify camera bay world coordinates match src/scene/constants.js * 10mm
    cb = consts["CAMERA_BAY"]
    rp = lens["adjacent_optical_crosstalk"]["rear_camera_plateau"]
    assert rp["main_lens_center_xy_mm"] == pytest.approx([cb["MAIN_X"] * 10.0, cb["MAIN_Y"] * 10.0], abs=0.05)
    assert rp["aux_lens_center_xy_mm"] == pytest.approx([cb["AUX_X"] * 10.0, cb["AUX_Y"] * 10.0], abs=0.05)
    assert rp["flash_center_xy_mm"] == pytest.approx([cb["FLASH_X"] * 10.0, cb["FLASH_Y"] * 10.0], abs=0.05)
    assert rp["dtof_center_xy_mm"] == pytest.approx([cb["TOF_X"] * 10.0, cb["TOF_Y"] * 10.0], abs=0.05)

    # Verify ABCD paraxial EFL == 6.82mm and BFL == 0.68mm
    mats = lens["materials"]
    M = np.eye(2)
    n_prev = 1.0
    for s in lens["surfaces"]:
        n_cur = 1.0 if s["material"] == "AIR" else mats[s["material"]]["nd"]
        R = s["radius_mm"]
        Mr = np.array([[1.0, 0.0], [-(n_cur - n_prev) / (R * n_cur), n_prev / n_cur]]) if R is not None else np.array([[1.0, 0.0], [0.0, n_prev / n_cur]])
        Mt = np.array([[1.0, s["thickness_mm"]], [0.0, 1.0]])
        M = Mt @ Mr @ M
        n_prev = n_cur
    t_last = lens["surfaces"][-1]["thickness_mm"]
    M_last = np.array([[1.0, -t_last], [0.0, 1.0]]) @ M
    efl = -1.0 / M_last[1, 0]
    bfl = -M_last[0, 0] / M_last[1, 0]
    assert efl == pytest.approx(6.82, abs=0.02)
    assert bfl == pytest.approx(0.68, abs=0.02)


def test_canonical_stackup_physics_matches_both_kicad_pcbs() -> None:
    sp = json.loads((REPO_ROOT / "hardware" / "stackup_physics.json").read_text(encoding="utf-8"))
    for bkey, pcb_rel in (
        ("mainboard_14l", "hardware/rk_t4_mainboard.kicad_pcb"),
        ("mezzanine_8l", "hardware/rk_t4_mezzanine.kicad_pcb"),
    ):
        pcb = parse_kicad_pcb_summary(REPO_ROOT / pcb_rel)
        b_sp = sp["boards"][bkey]
        assert b_sp["nominal_thickness_mm"] == pytest.approx(pcb["thickness_mm"], abs=0.01)

        # Every copper & dielectric layer thickness in stackup_physics.json matches .kicad_pcb 1:1!
        pcb_phys_layers = [l for l in pcb["stackup"] if l.get("type") in ("copper", "prepreg", "core")]
        sp_phys_layers = [l for l in b_sp["layers"] if l["kind"] in ("copper", "prepreg", "core")]
        assert len(sp_phys_layers) == len(pcb_phys_layers), f"Layer count mismatch on {bkey}"
        for sl, pl in zip(sp_phys_layers, pcb_phys_layers):
            assert sl["name"] == pl["name"]
            assert sl["thickness_mm"] == pytest.approx(pl["thickness"], abs=1e-4)

    # Verify all off-board flex/sub-PCBs are defined and Djordjevic-Sarkar evaluates cleanly
    for extra_board in ("camera_rigid_flex_4l", "display_cof_fpc_2l", "bottom_sub_pcb_4l"):
        assert extra_board in sp["boards"]
    er_5g, df_5g = djordjevic_sarkar_er_df(sp["materials"]["S1000-2M-1078"], 5.0e9)
    assert 3.5 < er_5g < 4.2 and 0.005 < df_5g < 0.025


def test_canonical_assembly_sequence_matches_constants_and_netlist() -> None:
    asm = json.loads((REPO_ROOT / "mechanics" / "assembly_sequence.json").read_text(encoding="utf-8"))
    consts = parse_constants_js(REPO_ROOT)
    nl = load_netlist(REPO_ROOT)
    comp_map = {c["ref"]: c for c in nl["components"]}

    phone = consts["PHONE"]
    env = asm["chassis_envelope_mm"]
    assert env["width_x"] == pytest.approx(phone["W"] * 10.0)
    assert env["height_y"] == pytest.approx(phone["H"] * 10.0)
    assert env["body_thickness_z"] == pytest.approx(phone["T"] * 10.0)
    assert len(env["antenna_peek_slits"]) == 6
    assert len(asm["fastener_spec"]["screws"]) == 12

    # Every MHF4 coax cable receptacle must exist in rk_t4_netlist.json and match exact world XY!
    mb_ax, mb_ay, _ = asm["coordinate_frame"]["mainboard_anchor_world_mm"]
    assert asm["mhf4_coax_harnesses"]["mated_height_max_mm"] == pytest.approx(1.20)
    for cab in asm["mhf4_coax_harnesses"]["cables"]:
        ref = cab["receptacle_refdes"]
        assert ref in comp_map, f"Coax receptacle {ref} missing from netlist"
        c = comp_map[ref]
        assert cab["start_world_xyz_mm"][0] == pytest.approx(mb_ax + c["x"], abs=0.15)
        assert cab["start_world_xyz_mm"][1] == pytest.approx(mb_ay + c["y"], abs=0.15)

    # Every PCB-mounted spring contact (J202A/B, J802A/B, J708A/B) matches netlist coordinates
    for sp in asm["spring_contacts"]:
        if sp["refdes"].startswith("J"):
            assert sp["refdes"] in comp_map
            c = comp_map[sp["refdes"]]
            assert sp["world_xy_mm"][0] == pytest.approx(mb_ax + c["x"], abs=0.15)
            assert sp["world_xy_mm"][1] == pytest.approx(mb_ay + c["y"], abs=0.15)


def test_canonical_dt_binding_matches_dts_root_and_does_not_whitelist_fake_peripherals() -> None:
    binding_txt = (REPO_ROOT / "firmware" / "bindings" / "rk-t4.yaml").read_text(encoding="utf-8")
    binding = yaml.safe_load(binding_txt)
    dts = parse_dts_metadata(REPO_ROOT / "firmware" / "rk3588s2-rk-t4-evt.dts")

    assert binding["$schema"] == "http://devicetree.org/meta-schemas/core.yaml#"
    items = binding["properties"]["compatible"]["items"]
    assert [it["const"] for it in items] == dts["root_compatible"]
    # Ensure non-mainline peripheral strings were NOT secretly whitelisted
    assert "quectel,eg25" not in binding_txt
    assert "goodix,ultrasonic-fp" not in binding_txt


def test_nb01_cad_bodies_have_zero_static_overlaps_and_mpn_decoder_catches_real_bugs() -> None:
    bodies = _collect_rk_t4_bodies(REPO_ROOT)
    assert len(bodies) >= 35
    for i in range(len(bodies)):
        a = bodies[i]["bbox"]
        for j in range(i + 1, len(bodies)):
            b = bodies[j]["bbox"]
            ox = min(a[1], b[1]) - max(a[0], b[0])
            oy = min(a[3], b[3]) - max(a[2], b[2])
            oz = min(a[5], b[5]) - max(a[4], b[4])
            assert not (ox > 0.01 and oy > 0.01 and oz > 0.01), f"CAD overlap: {bodies[i]['name']} vs {bodies[j]['name']}"

    # Verify MPN decoder accurately decodes standard parts
    d1 = decode_mpn("GRM0335C1H120JA01D")
    assert d1.decoded_ok and d1.case_code == "0201" and d1.dielectric == "C0G" and d1.voltage_v == 50.0 and d1.nominal_si == pytest.approx(12e-12)
    d2 = decode_mpn("RC0201FR-0722KL")
    assert d2.decoded_ok and d2.case_code == "0201" and d2.nominal_si == pytest.approx(22000.0)
    d3 = decode_mpn("SMF12A")
    assert d3.decoded_ok and d3.voltage_v == 12.0 and d3.breakdown_v_min > 13.0


# =============================================================================
# GATE 3: Schema, Cross-Check, Rev 6 Patch, QUICK_CHECK Block & Dummy-Box Block
# =============================================================================


def _make_valid_upstream_report(
    nb_id: str,
    git_sha: str,
    input_hashes: dict[str, str],
    run_mode: str = "ULTRA_SIGNOFF",
    inject_fail: bool = False,
    inject_dummy_cube: bool = False,
) -> dict[str, Any]:
    fake_raw_sha = hashlib.sha256(f"raw_{nb_id}_{run_mode}".encode()).hexdigest()
    bbox = (
        BoundingBoxMM(min_x_mm=0.0, max_x_mm=1.0, min_y_mm=0.0, max_y_mm=1.0, min_z_mm=0.0, max_z_mm=1.0)
        if inject_dummy_cube
        else BoundingBoxMM(min_x_mm=-37.5, max_x_mm=37.5, min_y_mm=-81.0, max_y_mm=81.0, min_z_mm=-6.2, max_z_mm=4.7)
    )
    prov = SolverProvenance(
        solver_name="CalculiX" if nb_id in ("04b", "07", "08") else ("openEMS" if nb_id in ("02", "03") else "OpenRadioss"),
        binary_path="/usr/bin/ccx",
        solver_version="2.21",
        model_scope="full_phone",
        mesh_nodes=4200,
        mesh_elements=18500,
        model_bbox_mm=bbox,
        solve_wall_time_s=12.4,
        raw_output_files=[RawOutputFileHash(path=f"nb{nb_id}_raw.dat", sha256=fake_raw_sha, size_bytes=8192)],
        command_line=f"solver_nb{nb_id}",
        model_fidelity="verified_datasheet_or_geometry",
    )
    checks = [
        AuditCheckItem(
            check_id=f"NB{nb_id.upper()}_PRIMARY_CHECK",
            domain=f"Domain_{nb_id}",
            title=f"Primary Signoff Check NB {nb_id}",
            status="FAIL" if inject_fail else "PASS",
            measured_value=99.0 if inject_fail else 10.0,
            limit_value=50.0,
            unit="units",
            margin=-49.0 if inject_fail else 40.0,
            standard_ref="IPC/JEDEC/IEEE",
            affected_entities=[
                AffectedEntity(
                    refdes="U206",
                    mpn="RK806-1",
                    footprint="QFN-68__7x7mm_",
                    layer="F.Paste",
                    current_value="100% solid paste",
                    target_value="60% window-pane paste",
                    fix_action="Segment QFN-68 pad 69 F.Paste into 3x3 window-pane (60% aperture)",
                )
            ]
            if inject_fail
            else [],
        )
    ]
    summary_by_nb: dict[str, dict[str, Any]] = {
        "02": {"soc_core_step_min_v": 0.83},
        "03": {"max_rf_pa_dissipation_w": 2.4},
        "04a": {"peak_drop_shock_g": 1350.0, "df40c_retention_sf": 2.1, "mhf4_retention_sf": 4.2},
        "04b": {"reflow_warpage_main_um": 32.0, "reflow_warpage_mezz_um": 22.0},
        "06": {"peak_pcb_temp_c": 72.0, "mezzanine_rf_power_assumed_w": 2.4},
        "07": {"lra_ois_sep_hz": 55.0},
        "08": {"worst_batt_eol_clearance_mm": 0.85, "worst_mezz_to_nfc_clearance_mm": 0.14},
    }
    rep = NotebookReportBase(
        notebook_id=nb_id,  # type: ignore[arg-type]
        notebook_name=f"nb_{nb_id}_test",
        run_mode=run_mode,  # type: ignore[arg-type]
        random_seed=42,
        git_commit_sha=git_sha,
        input_files_sha256=input_hashes,
        repo_clean_verified=True,
        model_fidelity="verified_datasheet_or_geometry",
        solver_provenance=[prov],
        checks=checks,
        summary_metrics=summary_by_nb.get(nb_id, {}),
        handoff_artifacts={},
        overall_status="FAIL" if inject_fail else "PASS",
    )
    return rep.model_dump()


def _stage_all_upstream(drive_root: Path, git_sha: str, input_hashes: dict[str, str], **overrides: Any) -> None:
    rdir = drive_root / "reports"
    rdir.mkdir(parents=True, exist_ok=True)
    for nb_id in EXPECTED_UPSTREAM_IDS:
        kw = dict(run_mode="ULTRA_SIGNOFF", inject_fail=False, inject_dummy_cube=False)
        if nb_id in overrides:
            kw.update(overrides[nb_id])
        data = _make_valid_upstream_report(nb_id, git_sha, input_hashes, **kw)
        atomic_write_json(rdir / f"nb{nb_id}_report.json", data)


def test_nb09_integration_all_pass_ultra_signoff_approved(tmp_path: Path) -> None:
    git_sha = subprocess.check_output(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], text=True).strip()
    hashes = compute_input_hashes(REPO_ROOT)
    _stage_all_upstream(tmp_path, git_sha, hashes)

    res = run_nb09_master_signoff(REPO_ROOT, tmp_path, run_mode="ULTRA_SIGNOFF", git_commit_sha=git_sha)
    assert res["verdict"]["verdict"] == "APPROVED_FOR_EVT_TAPEOUT"
    assert res["verdict"]["fail_count"] == 0
    assert len(res["patch_orders"]["orders"]) == 0
    assert (tmp_path / "reports" / "RK_T4_MASTER_SIGNOFF_REPORT.html").is_file()
    assert (tmp_path / "reports" / "rev6_patch_orders.json").is_file()
    assert (tmp_path / "reports" / "RK_T4_EVT_TAPEOUT_CERTIFICATE.md").is_file()
    html_txt = (tmp_path / "reports" / "RK_T4_MASTER_SIGNOFF_REPORT.html").read_text(encoding="utf-8")
    assert "APPROVED_FOR_EVT_TAPEOUT" in html_txt
    assert "Irreducible Real-Hardware EVT Mandatory Scope" in html_txt


def test_nb09_integration_fail_emits_rev6_patch_orders_without_crashing(tmp_path: Path) -> None:
    git_sha = subprocess.check_output(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], text=True).strip()
    hashes = compute_input_hashes(REPO_ROOT)
    _stage_all_upstream(tmp_path, git_sha, hashes, **{"00": {"inject_fail": True}, "08": {"inject_fail": True}})

    res = run_nb09_master_signoff(REPO_ROOT, tmp_path, run_mode="ULTRA_SIGNOFF", git_commit_sha=git_sha)
    assert res["verdict"]["verdict"] == "SIGNOFF_REJECTED_NEEDS_REV6_PATCH"
    assert res["verdict"]["fail_count"] >= 2
    orders = res["patch_orders"]["orders"]
    assert len(orders) >= 2
    assert any(e["refdes"] == "U206" and e["footprint"] == "QFN-68__7x7mm_" for o in orders for e in o["affected_entities"])


def test_nb09_integration_quick_check_mixed_blocks_tapeout(tmp_path: Path) -> None:
    git_sha = subprocess.check_output(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], text=True).strip()
    hashes = compute_input_hashes(REPO_ROOT)
    # Mix a single QUICK_CHECK notebook (04a) into an otherwise all-PASS suite -> MUST block tapeout!
    _stage_all_upstream(tmp_path, git_sha, hashes, **{"04a": {"run_mode": "QUICK_CHECK"}})

    res = run_nb09_master_signoff(REPO_ROOT, tmp_path, run_mode="ULTRA_SIGNOFF", git_commit_sha=git_sha)
    assert res["verdict"]["verdict"] == "PRELIMINARY_QUICK_CHECK_ONLY"
    assert any("QUICK_CHECK" in r for r in res["verdict"]["blocking_reasons"])


def test_nb09_integration_dummy_1mm_cube_provenance_blocked(tmp_path: Path) -> None:
    git_sha = subprocess.check_output(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], text=True).strip()
    hashes = compute_input_hashes(REPO_ROOT)
    # Inject a 1mm x 1mm x 1mm dummy cube solver_provenance cheat into NB 04b -> MUST be caught & blocked!
    _stage_all_upstream(tmp_path, git_sha, hashes, **{"04b": {"inject_dummy_cube": True}})

    bad_rep = NotebookReportBase.model_validate_json((tmp_path / "reports" / "nb04b_report.json").read_text(encoding="utf-8"))
    prov_errs = audit_provenance_integrity(bad_rep)
    assert any("DUMMY CUBE CHEAT" in e for e in prov_errs)

    res = run_nb09_master_signoff(REPO_ROOT, tmp_path, run_mode="ULTRA_SIGNOFF", git_commit_sha=git_sha)
    assert res["verdict"]["verdict"] == "SIGNOFF_BLOCKED_PROVENANCE_OR_SCHEMA_ERROR"
    assert len(res["verdict"]["provenance_audit_errors"]) >= 1


# =============================================================================
# GATE 4: Bootstrap Safety (Scratch GC, NVIDIA CUDA LD_LIBRARY_PATH, Locks, Read-Only)
# =============================================================================


def test_bootstrap_scratch_gc_and_nvidia_ld_library_preservation(tmp_path: Path) -> None:
    # 1) ScratchCaseDir ALWAYS deletes directory even when an exception occurs inside the block
    leaked_path: Path | None = None
    with pytest.raises(RuntimeError, match="intentional_solver_abort"):
        with ScratchCaseDir("gc_test", base=tmp_path) as sdir:
            leaked_path = sdir
            (sdir / "huge_dump.bin").write_bytes(b"0" * 4096)
            assert sdir.exists()
            raise RuntimeError("intentional_solver_abort")
    assert leaked_path is not None and not leaked_path.exists()

    # 2) build_isolated_env ALWAYS preserves Colab NVIDIA driver paths while prepending env lib
    env_gpu = build_isolated_env("gpu_optics")
    ld = env_gpu["LD_LIBRARY_PATH"].split(":")
    assert ld[0] == "/opt/rk_t4_env_gpu_optics/lib"
    for nv in NVIDIA_HOST_LIB_DIRS:
        assert nv in ld, f"Host NVIDIA driver path {nv} was dropped from LD_LIBRARY_PATH!"
    assert env_gpu["OMPI_ALLOW_RUN_AS_ROOT"] == "1"
    assert env_gpu["OMP_STACKSIZE"] == "400m"

    # 3) Atomic CheckpointManager + FileLock round-trip
    with FileLock(tmp_path / "bundle.lock", timeout_s=5.0):
        ckpt = CheckpointManager(tmp_path / "ckpts", "04a", "ULTRA_SIGNOFF", "abcdef123456")
        assert not ckpt.has("case1")
        ckpt.save("case1", {"peak_g": 1245.5})
        assert ckpt.has("case1")
        assert ckpt.load("case1") == {"peak_g": 1245.5}

    # 4) Repository read-only invariance passes cleanly
    assert verify_repo_unmodified(REPO_ROOT) is True
