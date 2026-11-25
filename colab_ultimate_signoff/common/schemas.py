"""Strict Pydantic v2 JSON schemas, SI-unit contracts, and anti-cheating provenance audits.

Every notebook (00..09) in `colab_ultimate_signoff/` MUST serialize its results
through these models so that Notebook 09 can perform cross-domain physics
consistency verification, provenance anti-spoofing, and Rev 6 patch generation.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = "1.0.0"

ModelFidelity = Literal[
    "verified_datasheet_or_geometry",
    "parametric_surrogate",
    "reference_patent_prescription",
]
RunMode = Literal["QUICK_CHECK", "ULTRA_SIGNOFF"]
CheckStatus = Literal["PASS", "WARN", "FAIL"]
SignoffVerdictEnum = Literal[
    "APPROVED_FOR_EVT_TAPEOUT",
    "PRELIMINARY_QUICK_CHECK_ONLY",
    "SIGNOFF_REJECTED_NEEDS_REV6_PATCH",
    "SIGNOFF_BLOCKED_PROVENANCE_OR_SCHEMA_ERROR",
]
ModelScope = Literal[
    "full_phone",
    "board_assembly",
    "pcb_submodel",
    "local_submodel",
    "circuit_netlist",
    "optical_stack",
    "electrochemical_cell",
    "firmware_dtb",
]

_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_GIT_SHA_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")


def sha256_file(path: str | Path) -> str:
    """Return hex SHA-256 of a file streamed in 1 MiB chunks."""
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


class BoundingBoxMM(BaseModel):
    """3D Cartesian bounding box strictly in millimeters (SI mm)."""

    model_config = ConfigDict(extra="forbid")

    min_x_mm: float
    max_x_mm: float
    min_y_mm: float
    max_y_mm: float
    min_z_mm: float
    max_z_mm: float

    @model_validator(mode="after")
    def _validate_ordering(self) -> "BoundingBoxMM":
        if self.max_x_mm < self.min_x_mm:
            raise ValueError("max_x_mm must be >= min_x_mm")
        if self.max_y_mm < self.min_y_mm:
            raise ValueError("max_y_mm must be >= min_y_mm")
        if self.max_z_mm < self.min_z_mm:
            raise ValueError("max_z_mm must be >= min_z_mm")
        return self

    @property
    def span_x_mm(self) -> float:
        return self.max_x_mm - self.min_x_mm

    @property
    def span_y_mm(self) -> float:
        return self.max_y_mm - self.min_y_mm

    @property
    def span_z_mm(self) -> float:
        return self.max_z_mm - self.min_z_mm

    @property
    def max_span_mm(self) -> float:
        return max(self.span_x_mm, self.span_y_mm, self.span_z_mm)

    @property
    def volume_mm3(self) -> float:
        return self.span_x_mm * self.span_y_mm * self.span_z_mm


class RawOutputFileHash(BaseModel):
    """Cryptographic receipt proving a raw solver output file was genuinely produced."""

    model_config = ConfigDict(extra="forbid")

    path: str = Field(..., min_length=1)
    sha256: str
    size_bytes: int = Field(..., gt=0)

    @field_validator("sha256")
    @classmethod
    def _check_sha256(cls, v: str) -> str:
        if not _SHA256_RE.match(v):
            raise ValueError(f"Invalid SHA-256 hex digest: {v!r}")
        return v.lower()


class SolverProvenance(BaseModel):
    """Mandatory provenance proof for every physics / EDA / CAD / firmware solver invocation."""

    model_config = ConfigDict(extra="forbid")

    solver_name: str = Field(..., min_length=1)
    binary_path: str = Field(..., min_length=1)
    solver_version: str = Field(..., min_length=1)
    model_scope: ModelScope = "board_assembly"
    mesh_nodes: int = Field(..., ge=0)
    mesh_elements: int = Field(..., ge=0)
    model_bbox_mm: BoundingBoxMM
    solve_wall_time_s: float = Field(..., gt=0.0)
    raw_output_files: list[RawOutputFileHash] = Field(..., min_length=1)
    command_line: str = Field(..., min_length=1)
    model_fidelity: ModelFidelity = "verified_datasheet_or_geometry"
    notes: str = ""


class AffectedEntity(BaseModel):
    """Granular design entity locator for automated Rev 6 patch order generation."""

    model_config = ConfigDict(extra="forbid")

    refdes: str | None = None
    mpn: str | None = None
    footprint: str | None = None
    net: str | None = None
    layer: str | None = None
    board: str | None = None
    x_mm: float | None = None
    y_mm: float | None = None
    z_mm: float | None = None
    dts_node: str | None = None
    current_value: str | None = None
    target_value: str | None = None
    fix_action: str | None = None


class AuditCheckItem(BaseModel):
    """Single quantitative signoff check item with SI units and standards citation."""

    model_config = ConfigDict(extra="forbid")

    check_id: str = Field(..., min_length=3)
    domain: str = Field(..., min_length=2)
    title: str = Field(..., min_length=3)
    status: CheckStatus
    measured_value: float | int | str
    limit_value: float | int | str
    unit: str = Field(..., min_length=1)
    margin: float | None = None
    standard_ref: str = Field(..., min_length=2)
    model_fidelity: ModelFidelity = "verified_datasheet_or_geometry"
    affected_entities: list[AffectedEntity] = Field(default_factory=list)
    details: str = ""
    severity_1_to_10: int = Field(default=7, ge=1, le=10)
    occurrence_1_to_10: int = Field(default=4, ge=1, le=10)
    detection_1_to_10: int = Field(default=3, ge=1, le=10)


class NotebookReportBase(BaseModel):
    """Canonical top-level JSON report emitted by each notebook 00..09."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default=SCHEMA_VERSION)
    notebook_id: Literal["00", "01", "02", "03", "04a", "04b", "05", "06", "07", "08", "09"]
    notebook_name: str = Field(..., min_length=3)
    run_mode: RunMode
    random_seed: int = Field(default=42)
    git_commit_sha: str
    input_files_sha256: dict[str, str] = Field(..., min_length=1)
    repo_clean_verified: bool
    model_fidelity: ModelFidelity
    timestamp_utc: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    solver_provenance: list[SolverProvenance] = Field(..., min_length=1)
    checks: list[AuditCheckItem] = Field(..., min_length=1)
    summary_metrics: dict[str, Any] = Field(default_factory=dict)
    handoff_artifacts: dict[str, str] = Field(default_factory=dict)
    overall_status: CheckStatus

    @field_validator("schema_version")
    @classmethod
    def _check_schema_version(cls, v: str) -> str:
        if v != SCHEMA_VERSION:
            raise ValueError(f"Unsupported schema_version {v!r}; expected {SCHEMA_VERSION!r}")
        return v

    @field_validator("git_commit_sha")
    @classmethod
    def _check_git_sha(cls, v: str) -> str:
        if not _GIT_SHA_RE.match(v):
            raise ValueError(f"Invalid git_commit_sha: {v!r}")
        return v.lower()

    @field_validator("input_files_sha256")
    @classmethod
    def _check_input_hashes(cls, v: dict[str, str]) -> dict[str, str]:
        for rel_path, digest in v.items():
            if not _SHA256_RE.match(digest):
                raise ValueError(f"Invalid SHA-256 for input {rel_path}: {digest!r}")
        return {k: d.lower() for k, d in v.items()}

    @model_validator(mode="after")
    def _validate_status_consistency(self) -> "NotebookReportBase":
        statuses = {c.status for c in self.checks}
        if "FAIL" in statuses and self.overall_status != "FAIL":
            raise ValueError(
                "overall_status MUST be 'FAIL' whenever any check item has status=='FAIL'"
            )
        if not self.repo_clean_verified:
            raise ValueError(
                "repo_clean_verified must be True — verification runs may not mutate tracked design files"
            )
        return self


# ---------------------------------------------------------------------------
# Inter-Notebook Handoff Schemas (00 -> 02/03/04b, 01 -> CAE, 06 -> 08, 09)
# ---------------------------------------------------------------------------


class CopperOccupancy5mmHandoff(BaseModel):
    """5mm x 5mm per-layer copper occupancy maps for 14L mainboard & 8L mezzanine (NB 00 -> NB 04b)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    git_commit_sha: str
    grid_step_mm: float = 5.0
    boards: dict[str, dict[str, Any]]  # board -> {bbox_mm, layers: {layer_name: [[float]]}, layer_avg_pct}


class PcbNetGeometryHandoff(BaseModel):
    """IPC-2581 extracted net geometry for 14L mainboard & 8L mezzanine (NB 00 -> NB 02/03)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    git_commit_sha: str
    boards: dict[str, dict[str, Any]]


class BringupBenchLimitsHandoff(BaseModel):
    """Safe bench power-supply limits, test-point map, and first-power-on checklist (NB 00 -> EVT)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    git_commit_sha: str
    vbus_current_limit_a: float
    vbat_sim_voltage_v: float
    vbat_current_limit_a: float
    expected_idle_current_ma: float
    dead_battery_rd_ohm_expected: float
    maskrom_entry_procedure: str
    test_points: list[dict[str, Any]]
    rail_expected_voltages_v: dict[str, float]


class CaeCadManifestHandoff(BaseModel):
    """Watertight multi-body B-Rep STEP / Gmsh v2.2 / CalculiX .inp / STL manifest (NB 01 -> downstream)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    git_commit_sha: str
    master_step_path: str
    gmsh_v22_path: str
    calculix_solid_inp_path: str
    calculix_oring_2d_inp_path: str
    stl_dir: str
    parts: list[dict[str, Any]]
    total_nodes: int = Field(..., gt=0)
    total_elements: int = Field(..., gt=0)
    min_jacobian: float = Field(..., gt=0.0)
    max_aspect_ratio: float = Field(..., gt=0.0)
    static_interference_count: int = Field(..., ge=0)
    envelope_bbox_mm: BoundingBoxMM


class BatterySwellingHandoff(BaseModel):
    """Early PyBaMM 3-year Si-C swelling output written BEFORE OpenFOAM CFD (NB 06 -> NB 08)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    notebook_id: Literal["06"] = "06"
    run_mode: RunMode
    random_seed: int = 42
    git_commit_sha: str
    model_fidelity: ModelFidelity = "parametric_surrogate"
    nominal_thickness_mm: float = Field(..., gt=0.0)
    swelling_bol_to_3yr_1000cyc_mm: float = Field(..., ge=0.0)
    swelling_3yr_pct: float = Field(..., ge=0.0)
    worst_case_eol_thickness_mm: float = Field(..., gt=0.0)
    capacity_retention_1000cyc_pct: float = Field(..., ge=0.0, le=100.0)
    low_temp_li_plating_margin_mv: float
    solver_provenance: SolverProvenance


class Rev6PatchOrder(BaseModel):
    """Machine-actionable patch order emitted by Notebook 09 for every FAIL/WARN."""

    model_config = ConfigDict(extra="forbid")

    order_id: str
    source_notebook: str
    source_check_id: str
    severity: Literal["CRITICAL_FAIL", "WARNING"]
    domain: str
    title: str
    standard_ref: str
    measured_value: str
    limit_value: str
    unit: str
    rpn: int = Field(..., ge=1, le=1000)
    affected_entities: list[AffectedEntity]
    recommended_rev6_action: str


class Rev6PatchOrdersBundle(BaseModel):
    """Complete Rev 6 engineering change order JSON file emitted by Notebook 09."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    git_commit_sha: str
    generated_utc: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    verdict: SignoffVerdictEnum
    total_fail_orders: int = Field(..., ge=0)
    total_warn_orders: int = Field(..., ge=0)
    orders: list[Rev6PatchOrder]


class MasterSignoffVerdict(BaseModel):
    """Final master signoff verdict & cross-domain summary produced by Notebook 09."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    git_commit_sha: str
    generated_utc: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    verdict: SignoffVerdictEnum
    blocking_reasons: list[str]
    notebooks_evaluated: list[str]
    notebook_run_modes: dict[str, RunMode]
    total_checks: int
    pass_count: int
    warn_count: int
    fail_count: int
    cross_domain_checks: list[AuditCheckItem]
    provenance_audit_errors: list[str]
    dfmea_pfmea_top_rpn: list[dict[str, Any]]
    digitally_proven_domains: list[str]
    evt_physical_mandatory_domains: list[str]


# ---------------------------------------------------------------------------
# Anti-Spoofing Provenance & Schema Audit Functions
# ---------------------------------------------------------------------------

_3D_MESH_SOLVERS = {"gmsh", "openems", "openradioss", "calculix", "ccx", "openfoam", "elmer", "elmersolver"}


def audit_provenance_integrity(report: NotebookReportBase) -> list[str]:
    """Audit solver_provenance entries to catch dummy 1mm-box or zero-mesh spoofing.

    Returns a list of error strings (empty list means provenance integrity passed).
    """
    errors: list[str] = []
    if not report.solver_provenance:
        errors.append(f"NB {report.notebook_id}: missing solver_provenance entries")
        return errors

    for idx, prov in enumerate(report.solver_provenance):
        tag = f"NB {report.notebook_id} provenance[{idx}] ({prov.solver_name})"
        sname = prov.solver_name.lower()
        bbox = prov.model_bbox_mm

        # Detect classic 1mm x 1mm x 1mm dummy cube / stub geometry cheat
        is_tiny_cube = (
            bbox.span_x_mm <= 2.0
            and bbox.span_y_mm <= 2.0
            and bbox.span_z_mm <= 2.0
            and abs(bbox.span_x_mm - bbox.span_y_mm) < 0.05
            and abs(bbox.span_y_mm - bbox.span_z_mm) < 0.05
            and bbox.volume_mm3 <= 8.0
        )
        if is_tiny_cube and prov.model_scope not in ("circuit_netlist", "firmware_dtb", "electrochemical_cell"):
            errors.append(
                f"{tag}: SUSPECTED DUMMY CUBE CHEAT — bbox spans "
                f"({bbox.span_x_mm:.3f}, {bbox.span_y_mm:.3f}, {bbox.span_z_mm:.3f}) mm "
                f"(vol={bbox.volume_mm3:.3f} mm^3) cannot represent real RK T4 geometry."
            )

        # Scope-specific real RK T4 physical dimension guards
        if prov.model_scope == "full_phone":
            if bbox.max_span_mm < 100.0 or bbox.span_x_mm < 50.0 or bbox.span_y_mm < 100.0:
                errors.append(
                    f"{tag}: full_phone bbox ({bbox.span_x_mm:.1f}x{bbox.span_y_mm:.1f}x{bbox.span_z_mm:.1f} mm) "
                    "does not match RK T4 chassis (~75x162x10.9 mm)."
                )
        elif prov.model_scope == "board_assembly":
            if bbox.max_span_mm < 25.0:
                errors.append(
                    f"{tag}: board_assembly bbox max span {bbox.max_span_mm:.2f} mm < 25 mm "
                    "(mainboard=35x117 mm, mezzanine=33.8x60.8 mm)."
                )
        elif prov.model_scope == "pcb_submodel":
            if bbox.max_span_mm < 2.5:
                errors.append(
                    f"{tag}: pcb_submodel bbox max span {bbox.max_span_mm:.2f} mm < 2.5 mm."
                )

        # Mesh complexity floor for real 3D/2D physics solvers
        if any(k in sname for k in _3D_MESH_SOLVERS):
            min_elems = 50 if prov.model_scope in ("local_submodel", "pcb_submodel") else 200
            if prov.mesh_elements < min_elems:
                errors.append(
                    f"{tag}: mesh_elements={prov.mesh_elements} below minimum {min_elems} "
                    f"for real {prov.solver_name} solve (scope={prov.model_scope})."
                )
            if prov.mesh_nodes < 20:
                errors.append(
                    f"{tag}: mesh_nodes={prov.mesh_nodes} too low for real physics mesh."
                )

        if not prov.raw_output_files:
            errors.append(f"{tag}: no raw_output_files SHA-256 receipts recorded.")

    return errors


def validate_report_dict(data: dict[str, Any]) -> NotebookReportBase:
    """Validate an in-memory dict against NotebookReportBase."""
    return NotebookReportBase.model_validate(data)


def validate_report_file(path: str | Path) -> NotebookReportBase:
    """Load and strictly validate a notebook JSON report file."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return validate_report_dict(raw)
