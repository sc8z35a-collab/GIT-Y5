"""Read-only dynamic parsers for RK T4 Single Source of Truth repository files.

NEVER hardcodes RK T4 circuit, stackup, BOM, optical, or mechanical values.
All geometry, netlists, footprints, stackups, DTS nodes, and MPN ratings are
parsed dynamically at runtime from the repository.
"""

from __future__ import annotations

import csv
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Iterative KiCad 9 S-Expression Parser (Safe for 14 MB+ .kicad_pcb files)
# ---------------------------------------------------------------------------

_SEXPR_TOKEN_RE = re.compile(r'\s*(\(|\)|"(?:\\.|[^"\\])*"|[^\s()"]+)')


def parse_sexpr(text: str) -> list[Any]:
    """Iterative non-recursive S-expression parser for KiCad 9 files."""
    stack: list[list[Any]] = [[]]
    for m in _SEXPR_TOKEN_RE.finditer(text):
        tok = m.group(1)
        if tok == "(":
            new_list: list[Any] = []
            stack[-1].append(new_list)
            stack.append(new_list)
        elif tok == ")":
            if len(stack) == 1:
                raise ValueError("Unbalanced ')' in S-expression")
            stack.pop()
        elif tok.startswith('"') and tok.endswith('"'):
            stack[-1].append(tok[1:-1].replace('\\"', '"').replace("\\\\", "\\"))
        else:
            stack[-1].append(tok)
    if len(stack) != 1:
        raise ValueError("Unclosed '(' in S-expression")
    return stack[0]


def sexpr_children(node: list[Any], head: str) -> list[list[Any]]:
    return [c for c in node[1:] if isinstance(c, list) and c and c[0] == head]


def sexpr_first(node: list[Any], head: str) -> list[Any] | None:
    for c in node[1:]:
        if isinstance(c, list) and c and c[0] == head:
            return c
    return None


# ---------------------------------------------------------------------------
# KiCad PCB / Footprint / Schematic Structured Extractors
# ---------------------------------------------------------------------------


def parse_kicad_pcb_summary(pcb_path: Path) -> dict[str, Any]:
    """Extract stackup, Edge.Cuts bbox, footprints, attributes, vias, zones, and nets from .kicad_pcb."""
    roots = parse_sexpr(pcb_path.read_text(encoding="utf-8"))
    if not roots or not isinstance(roots[0], list) or roots[0][0] != "kicad_pcb":
        raise ValueError(f"Not a valid kicad_pcb file: {pcb_path}")
    root = roots[0]

    general = sexpr_first(root, "general")
    thickness_mm = 0.0
    if general:
        t_node = sexpr_first(general, "thickness")
        if t_node and len(t_node) >= 2:
            thickness_mm = float(t_node[1])

    # Stackup layers
    stackup_layers: list[dict[str, Any]] = []
    setup = sexpr_first(root, "setup")
    if setup:
        su = sexpr_first(setup, "stackup")
        if su:
            for lyr in sexpr_children(su, "layer"):
                info: dict[str, Any] = {"name": str(lyr[1])}
                for key in ("type", "material"):
                    n = sexpr_first(lyr, key)
                    if n and len(n) >= 2:
                        info[key] = str(n[1])
                for key in ("thickness", "epsilon_r", "loss_tangent"):
                    n = sexpr_first(lyr, key)
                    if n and len(n) >= 2:
                        info[key] = float(n[1])
                stackup_layers.append(info)

    # Copper layers definition
    copper_layers: list[str] = []
    layers_node = sexpr_first(root, "layers")
    if layers_node:
        for item in layers_node[1:]:
            if isinstance(item, list) and len(item) >= 3 and str(item[1]).endswith(".Cu"):
                copper_layers.append(str(item[1]))

    # Nets
    nets: dict[int, str] = {}
    for n in sexpr_children(root, "net"):
        if len(n) >= 3:
            nets[int(n[1])] = str(n[2])

    # Edge.Cuts bounding box & segments
    edge_xs: list[float] = []
    edge_ys: list[float] = []
    edge_segments: list[tuple[float, float, float, float]] = []
    for gl in sexpr_children(root, "gr_line"):
        ln = sexpr_first(gl, "layer")
        if ln and len(ln) >= 2 and ln[1] == "Edge.Cuts":
            st = sexpr_first(gl, "start")
            en = sexpr_first(gl, "end")
            if st and en:
                x1, y1 = float(st[1]), float(st[2])
                x2, y2 = float(en[1]), float(en[2])
                edge_xs.extend([x1, x2])
                edge_ys.extend([y1, y2])
                edge_segments.append((x1, y1, x2, y2))

    # Footprints & anti-disguise attributes
    footprints: list[dict[str, Any]] = []
    for fp in sexpr_children(root, "footprint"):
        fp_name = str(fp[1]) if len(fp) >= 2 else ""
        layer_n = sexpr_first(fp, "layer")
        at_n = sexpr_first(fp, "at")
        attr_n = sexpr_first(fp, "attr")
        attrs = [str(a) for a in attr_n[1:]] if attr_n else []

        ref = ""
        val = ""
        for prop in sexpr_children(fp, "property"):
            if len(prop) >= 3:
                if prop[1] == "Reference":
                    ref = str(prop[2])
                elif prop[1] == "Value":
                    val = str(prop[2])

        pads: list[dict[str, Any]] = []
        for pd in sexpr_children(fp, "pad"):
            p_at = sexpr_first(pd, "at")
            p_sz = sexpr_first(pd, "size")
            p_ly = sexpr_first(pd, "layers")
            p_net = sexpr_first(pd, "net")
            p_dr = sexpr_first(pd, "drill")
            pads.append(
                {
                    "num": str(pd[1]),
                    "type": str(pd[2]) if len(pd) > 2 else "",
                    "shape": str(pd[3]) if len(pd) > 3 else "",
                    "x": float(p_at[1]) if p_at else 0.0,
                    "y": float(p_at[2]) if p_at else 0.0,
                    "w": float(p_sz[1]) if p_sz else 0.0,
                    "h": float(p_sz[2]) if p_sz else 0.0,
                    "layers": [str(x) for x in p_ly[1:]] if p_ly else [],
                    "net": str(p_net[2]) if (p_net and len(p_net) >= 3) else "",
                    "drill": float(p_dr[1]) if (p_dr and len(p_dr) >= 2 and _is_float(p_dr[1])) else 0.0,
                }
            )

        footprints.append(
            {
                "ref": ref,
                "value": val,
                "footprint": fp_name,
                "layer": str(layer_n[1]) if layer_n else "F.Cu",
                "x": float(at_n[1]) if at_n else 0.0,
                "y": float(at_n[2]) if at_n else 0.0,
                "rot": float(at_n[3]) if (at_n and len(at_n) >= 4) else 0.0,
                "attrs": attrs,
                "exclude_from_bom": "exclude_from_bom" in attrs,
                "exclude_from_pos_files": "exclude_from_pos_files" in attrs,
                "dnp": "dnp" in attrs,
                "pads": pads,
            }
        )

    # Vias
    vias: list[dict[str, Any]] = []
    for vn in sexpr_children(root, "via"):
        via_type = "through"
        if len(vn) >= 2 and isinstance(vn[1], str):
            via_type = vn[1]
        at_n = sexpr_first(vn, "at")
        sz_n = sexpr_first(vn, "size")
        dr_n = sexpr_first(vn, "drill")
        ly_n = sexpr_first(vn, "layers")
        nt_n = sexpr_first(vn, "net")
        net_id = int(nt_n[1]) if nt_n else 0
        vias.append(
            {
                "type": via_type,
                "x": float(at_n[1]) if at_n else 0.0,
                "y": float(at_n[2]) if at_n else 0.0,
                "size": float(sz_n[1]) if sz_n else 0.0,
                "drill": float(dr_n[1]) if dr_n else 0.0,
                "layers": [str(x) for x in ly_n[1:]] if ly_n else [],
                "net": nets.get(net_id, ""),
            }
        )

    # Segments
    segments: list[dict[str, Any]] = []
    for sg in sexpr_children(root, "segment"):
        st = sexpr_first(sg, "start")
        en = sexpr_first(sg, "end")
        wd = sexpr_first(sg, "width")
        ly = sexpr_first(sg, "layer")
        nt = sexpr_first(sg, "net")
        net_id = int(nt[1]) if nt else 0
        if st and en:
            segments.append(
                {
                    "x1": float(st[1]),
                    "y1": float(st[2]),
                    "x2": float(en[1]),
                    "y2": float(en[2]),
                    "width": float(wd[1]) if wd else 0.0,
                    "layer": str(ly[1]) if ly else "",
                    "net": nets.get(net_id, ""),
                }
            )

    # Zones
    zones: list[dict[str, Any]] = []
    for zn in sexpr_children(root, "zone"):
        nn = sexpr_first(zn, "net_name")
        ly = sexpr_first(zn, "layer")
        fill = sexpr_first(zn, "fill")
        island_mode = None
        if fill:
            im = sexpr_first(fill, "island_removal_mode")
            if im and len(im) >= 2:
                island_mode = int(im[1])
        filled_polys = len(sexpr_children(zn, "filled_polygon"))
        zones.append(
            {
                "net": str(nn[1]) if nn else "",
                "layer": str(ly[1]) if ly else "",
                "island_removal_mode": island_mode,
                "filled_polygon_count": filled_polys,
            }
        )

    bbox_mm = {
        "min_x_mm": min(edge_xs) if edge_xs else 0.0,
        "max_x_mm": max(edge_xs) if edge_xs else 0.0,
        "min_y_mm": min(edge_ys) if edge_ys else 0.0,
        "max_y_mm": max(edge_ys) if edge_ys else 0.0,
    }

    return {
        "path": str(pcb_path),
        "thickness_mm": thickness_mm,
        "copper_layers": copper_layers,
        "stackup": stackup_layers,
        "bbox_kicad_mm": bbox_mm,
        "edge_segments": edge_segments,
        "nets": nets,
        "footprints": footprints,
        "vias": vias,
        "segments": segments,
        "zones": zones,
    }


def parse_kicad_footprint(mod_path: Path) -> dict[str, Any]:
    """Parse a `.kicad_mod` footprint file including pads, paste/mask layers, and courtyard/fab."""
    roots = parse_sexpr(mod_path.read_text(encoding="utf-8"))
    if not roots or not isinstance(roots[0], list) or roots[0][0] != "footprint":
        raise ValueError(f"Not a valid kicad_mod file: {mod_path}")
    fp = roots[0]
    pads: list[dict[str, Any]] = []
    for pd in sexpr_children(fp, "pad"):
        p_at = sexpr_first(pd, "at")
        p_sz = sexpr_first(pd, "size")
        p_ly = sexpr_first(pd, "layers")
        p_dr = sexpr_first(pd, "drill")
        p_pm = sexpr_first(pd, "solder_paste_margin_ratio")
        pads.append(
            {
                "num": str(pd[1]),
                "type": str(pd[2]) if len(pd) > 2 else "",
                "shape": str(pd[3]) if len(pd) > 3 else "",
                "x": float(p_at[1]) if p_at else 0.0,
                "y": float(p_at[2]) if p_at else 0.0,
                "w": float(p_sz[1]) if p_sz else 0.0,
                "h": float(p_sz[2]) if p_sz else 0.0,
                "layers": [str(x) for x in p_ly[1:]] if p_ly else [],
                "drill": float(p_dr[1]) if (p_dr and len(p_dr) >= 2 and _is_float(p_dr[1])) else 0.0,
                "paste_margin_ratio": float(p_pm[1]) if (p_pm and len(p_pm) >= 2) else 0.0,
            }
        )
    return {"name": str(fp[1]), "path": str(mod_path), "pads": pads}


def scan_schematic_disguise_flags(sch_paths: list[Path]) -> dict[str, Any]:
    """Scan all `.kicad_sch` files for `(in_board no)` or `(dnp yes)` component hiding."""
    hidden_in_board: list[dict[str, str]] = []
    flagged_dnp: list[dict[str, str]] = []
    symbols_found: list[str] = []

    for sp in sch_paths:
        roots = parse_sexpr(sp.read_text(encoding="utf-8"))
        if not roots:
            continue
        root = roots[0]
        for sym in sexpr_children(root, "symbol"):
            lib_id = sexpr_first(sym, "lib_id")
            if not lib_id:
                continue  # skip library definitions inside lib_symbols
            ref = ""
            for prop in sexpr_children(sym, "property"):
                if len(prop) >= 3 and prop[1] == "Reference":
                    ref = str(prop[2])
                    break
            if not ref or ref.startswith("#"):
                continue
            symbols_found.append(ref)
            in_b = sexpr_first(sym, "in_board")
            dnp = sexpr_first(sym, "dnp")
            if in_b and len(in_b) >= 2 and str(in_b[1]).lower() == "no":
                hidden_in_board.append({"ref": ref, "sheet": sp.name, "lib_id": str(lib_id[1])})
            if dnp and len(dnp) >= 2 and str(dnp[1]).lower() == "yes":
                flagged_dnp.append({"ref": ref, "sheet": sp.name, "lib_id": str(lib_id[1])})

    return {
        "total_placed_symbols": len(symbols_found),
        "unique_refs": sorted(set(symbols_found)),
        "hidden_in_board": hidden_in_board,
        "flagged_dnp": flagged_dnp,
    }


def _is_float(s: Any) -> bool:
    try:
        float(s)
        return True
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# BOM, Netlist, CPL, Constants.js, and DTS Parsers
# ---------------------------------------------------------------------------


def load_bom_rows(repo_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with (repo_dir / "hardware" / "bom.csv").open("r", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            desigs = [d.strip() for d in row["Designators"].split() if d.strip()]
            rows.append(
                {
                    "item": int(row["Item"]),
                    "qty": int(row["Qty"]),
                    "designators": desigs,
                    "mpn": row["MPN"].strip(),
                    "manufacturer": row["Manufacturer"].strip(),
                    "category": row["Category"].strip(),
                    "value": row["Value"].strip(),
                    "package": row["Package"].strip(),
                    "subsystem": row["Subsystem"].strip(),
                }
            )
    return rows


def load_netlist(repo_dir: Path) -> dict[str, Any]:
    return json.loads((repo_dir / "hardware" / "rk_t4_netlist.json").read_text(encoding="utf-8"))


def load_cpl_csv(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append(
                {
                    "ref": r["Designator"].strip(),
                    "x_mm": float(r["Mid X"].replace("mm", "").strip()),
                    "y_mm": float(r["Mid Y"].replace("mm", "").strip()),
                    "layer": r["Layer"].strip(),
                    "rotation_deg": float(r["Rotation"].strip()),
                }
            )
    return rows


def parse_constants_js(repo_dir: Path) -> dict[str, Any]:
    """Dynamically parse `src/scene/constants.js` exported dimension objects (in Three.js units and mm)."""
    text = (repo_dir / "src" / "scene" / "constants.js").read_text(encoding="utf-8")
    # Strip line and block comments cleanly
    cleaned = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    cleaned = re.sub(r"//[^\n]*", "", cleaned)

    result: dict[str, Any] = {}
    for m in re.finditer(r"export\s+const\s+(\w+)\s*=\s*\{", cleaned):
        name = m.group(1)
        start = m.end() - 1
        depth = 0
        end = start
        for i in range(start, len(cleaned)):
            if cleaned[i] == "{":
                depth += 1
            elif cleaned[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        raw_obj = cleaned[start:end]
        # Convert JS object literal to JSON
        js_json = re.sub(r"([{\s,])(\w+)\s*:", r'\1"\2":', raw_obj)
        js_json = re.sub(r",\s*([}\]])", r"\1", js_json)
        js_json = re.sub(r"(?<=[:\[,\s])\+(\d)", r"\1", js_json)
        try:
            result[name] = json.loads(js_json)
        except json.JSONDecodeError:
            continue
    return result


def parse_dts_metadata(dts_path: Path) -> dict[str, Any]:
    """Extract compatibles, sink-pdos voltages, regulators, audio cards, and GPIO reset flags from DTS."""
    text = dts_path.read_text(encoding="utf-8")
    no_comments = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    no_comments = re.sub(r"//[^\n]*", "", no_comments)

    compatibles: list[str] = []
    for m in re.finditer(r'compatible\s*=\s*([^;]+);', no_comments):
        for s in re.findall(r'"([^"]+)"', m.group(1)):
            compatibles.append(s)

    root_compat_m = re.search(r"/\s*\{.*?compatible\s*=\s*([^;]+);", no_comments, flags=re.S)
    root_compat = re.findall(r'"([^"]+)"', root_compat_m.group(1)) if root_compat_m else []

    sink_pdos_mv: list[int] = []
    for m in re.finditer(r"PDO_FIXED\(\s*(\d+)\s*,\s*(\d+)", no_comments):
        sink_pdos_mv.append(int(m.group(1)))

    # Grab sink-pdos specifically
    sink_block = re.search(r"sink-pdos\s*=\s*<([^>]+)>;", no_comments, flags=re.S)
    sink_voltages_v = (
        [int(x) / 1000.0 for x in re.findall(r"PDO_FIXED\(\s*(\d+)", sink_block.group(1))]
        if sink_block
        else []
    )

    gpio_defs: list[dict[str, str]] = []
    for m in re.finditer(
        r"([\w-]+gpios?)\s*=\s*<&(gpio\d+)\s+(RK_P[A-D]\d+)\s+(GPIO_ACTIVE_(?:HIGH|LOW))>",
        no_comments,
    ):
        gpio_defs.append(
            {
                "prop": m.group(1),
                "bank": m.group(2),
                "pin": m.group(3),
                "polarity": m.group(4),
            }
        )

    regulators: dict[str, dict[str, Any]] = {}
    for m in re.finditer(
        r'regulator-name\s*=\s*"([^"]+)";(?P<body>[^}]+)',
        no_comments,
    ):
        rname = m.group(1)
        body = m.group("body")
        vmin = re.search(r"regulator-min-microvolt\s*=\s*<(\d+)>", body)
        vmax = re.search(r"regulator-max-microvolt\s*=\s*<(\d+)>", body)
        regulators[rname] = {
            "min_v": int(vmin.group(1)) / 1e6 if vmin else None,
            "max_v": int(vmax.group(1)) / 1e6 if vmax else None,
        }

    return {
        "path": str(dts_path),
        "root_compatible": root_compat,
        "all_compatibles": sorted(set(compatibles)),
        "sink_pdos_v": sink_voltages_v,
        "max_sink_pdo_v": max(sink_voltages_v) if sink_voltages_v else 0.0,
        "gpio_defs": gpio_defs,
        "regulators": regulators,
        "has_vop2": "&vop" in no_comments or "vop2" in no_comments,
        "has_dsi2": "&dsi0" in no_comments or "&dsi1" in no_comments or "mipi-dsi" in no_comments,
        "has_csi_isp_graph": "csi2_dphy" in no_comments or "rkcif" in no_comments or "rkisp" in no_comments,
        "has_typec_of_graph": ("usb-c-connector" in no_comments and "remote-endpoint" in no_comments),
        "has_tsadc_trips": "tsadc" in no_comments and ("thermal-zones" in no_comments or "rockchip,hw-tshut-temp" in no_comments),
        "sound_smartpa_codecs": re.findall(r"sound-dai\s*=\s*<&(tas2562_\w+)>", no_comments),
        "raw_text_no_comments": no_comments,
    }


# ---------------------------------------------------------------------------
# Machine MPN Catalog Decoder (Murata / Yageo / TDK / Samsung / Littelfuse)
# ---------------------------------------------------------------------------

_MURATA_CASE_MAP = {
    "02": "01005",
    "03": "0201",
    "15": "0402",
    "18": "0603",
    "21": "0805",
    "31": "1206",
}
_MURATA_DIEL_MAP = {
    "5C": "C0G",
    "1X": "SL",
    "R6": "X5R",
    "R7": "X7R",
    "C8": "X6S",
}
_MURATA_VOLT_MAP = {
    "0G": 4.0,
    "0J": 6.3,
    "1A": 10.0,
    "1C": 16.0,
    "1E": 25.0,
    "1V": 35.0,
    "1H": 50.0,
    "2A": 100.0,
}


@dataclass
class DecodedMPN:
    mpn: str
    family: str
    decoded_ok: bool
    case_code: str | None = None
    nominal_si: float | None = None  # F for cap, Ohm for res, H for ind, V for TVS
    unit: str | None = None
    voltage_v: float | None = None
    dielectric: str | None = None
    breakdown_v_min: float | None = None
    notes: str = ""


def parse_value_string_si(value_str: str, category: str) -> tuple[float | None, float | None, str | None]:
    """Parse schematic Value string -> (nominal_si, rated_voltage_v, dielectric)."""
    v_match = re.search(r"(\d+(?:\.\d+)?)\s*V\b", value_str, re.I)
    rated_v = float(v_match.group(1)) if v_match else None

    diel = None
    for d in ("C0G", "NP0", "X7R", "X5R", "X6S", "X7S"):
        if d in value_str.upper():
            diel = "C0G" if d == "NP0" else d
            break

    cat = category.lower()
    if "cap" in cat:
        m = re.search(r"(\d+(?:\.\d+)?)\s*(p|n|u|µ|m)F\b", value_str, re.I)
        if m:
            mult = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "m": 1e-3}[m.group(2).lower()]
            return float(m.group(1)) * mult, rated_v, diel
    elif "res" in cat or "shunt" in cat:
        m = re.search(r"(\d+(?:\.\d+)?)\s*(mOhm|mR|R|K|M)\b", value_str, re.I)
        if m:
            u = m.group(2)
            if u.lower() in ("mohm", "mr"):
                mult = 1e-3
            elif u.upper() == "R":
                mult = 1.0
            elif u.upper() == "K":
                mult = 1e3
            else:
                mult = 1e6
            return float(m.group(1)) * mult, rated_v, diel
    elif "ind" in cat:
        m = re.search(r"(\d+(?:\.\d+)?)\s*(n|u|µ|m)H\b", value_str, re.I)
        if m:
            mult = {"n": 1e-9, "u": 1e-6, "µ": 1e-6, "m": 1e-3}[m.group(2).lower()]
            return float(m.group(1)) * mult, rated_v, diel
    elif "esd" in cat or "tvs" in cat:
        return rated_v, rated_v, None
    return None, rated_v, diel


def decode_mpn(mpn: str) -> DecodedMPN:
    """Machine-decode standard Murata, Yageo, TDK/Murata DFE, Samsung CL, and Littelfuse SMF MPNs."""
    s = mpn.strip()

    # Murata GRM / GCM MLCC: GRM<size2><h1><diel2><volt2><cap3><tol1>...
    m = re.match(r"^(?:GRM|GCM)(\d{2})\d([0-9A-Z]{2})([0-9A-Z]{2})(\d{2}\d|R\d{2}|\dR\d)", s)
    if m:
        sz, diel_c, volt_c, cap_c = m.groups()
        if "R" in cap_c:
            pf = float(cap_c.replace("R", "."))
        else:
            pf = int(cap_c[:2]) * (10 ** int(cap_c[2]))
        return DecodedMPN(
            mpn=s,
            family="Murata_MLCC",
            decoded_ok=True,
            case_code=_MURATA_CASE_MAP.get(sz),
            nominal_si=pf * 1e-12,
            unit="F",
            voltage_v=_MURATA_VOLT_MAP.get(volt_c),
            dielectric=_MURATA_DIEL_MAP.get(diel_c),
        )

    # Yageo RC thick-film resistor: RC<case4><tol1>R-07<val>L
    m = re.match(r"^RC(\d{4})[A-Z]R-\d{2}([0-9RKM]+)L$", s)
    if m:
        case4, val_code = m.groups()
        if val_code == "0R":
            ohm = 0.0
        elif "R" in val_code:
            ohm = float(val_code.replace("R", ".")) if not val_code.endswith("R") else float(val_code[:-1])
        elif "K" in val_code:
            ohm = float(val_code.replace("K", ".")) * 1e3 if not val_code.endswith("K") else float(val_code[:-1]) * 1e3
        elif "M" in val_code:
            ohm = float(val_code.replace("M", ".")) * 1e6 if not val_code.endswith("M") else float(val_code[:-1]) * 1e6
        else:
            ohm = float(val_code)
        return DecodedMPN(
            mpn=s,
            family="Yageo_RC",
            decoded_ok=True,
            case_code=case4,
            nominal_si=ohm,
            unit="Ohm",
        )

    # Murata/TOKO DFE metal alloy power inductor: DFE<size4><h2><series>-<ind>M=P2
    m = re.match(r"^DFE(\d{4})\d{2}[A-Z]-([0-9R]+)[A-Z]", s)
    if m:
        sz4, ind_c = m.groups()
        uh = float(ind_c.replace("R", ".")) if "R" in ind_c else float(ind_c)
        return DecodedMPN(
            mpn=s,
            family="Murata_DFE",
            decoded_ok=True,
            case_code=f"IND_{sz4}",
            nominal_si=uh * 1e-6,
            unit="H",
        )

    # Murata LQG RF inductor: LQG15HS47NJ02D -> 0402 metric 1005 (15=0402!)
    m = re.match(r"^LQG(\d{2})[A-Z]{2}(\d+R?\d*)(N|U)", s)
    if m:
        sz2, val_c, unit_c = m.groups()
        mult = 1e-9 if unit_c == "N" else 1e-6
        val = float(val_c.replace("R", ".")) * mult
        return DecodedMPN(
            mpn=s,
            family="Murata_LQG",
            decoded_ok=True,
            case_code=_MURATA_CASE_MAP.get(sz2),
            nominal_si=val,
            unit="H",
        )

    # Littelfuse SMFxxA unidirectional TVS
    m = re.match(r"^SMF(\d+(?:\.\d+)?)A$", s)
    if m:
        vrwm = float(m.group(1))
        return DecodedMPN(
            mpn=s,
            family="Littelfuse_SMF_TVS",
            decoded_ok=True,
            case_code="SOD-123FL",
            nominal_si=vrwm,
            unit="V",
            voltage_v=vrwm,
            breakdown_v_min=round(vrwm * 1.11, 2),  # SMF12A V_BR_min = 13.3V per datasheet
        )

    # Murata BLM ferrite bead
    m = re.match(r"^BLM(\d{2})[A-Z]{2}(\d{3})", s)
    if m:
        sz2, z_c = m.groups()
        z_ohm = int(z_c[:2]) * (10 ** int(z_c[2]))
        return DecodedMPN(
            mpn=s,
            family="Murata_BLM",
            decoded_ok=True,
            case_code=_MURATA_CASE_MAP.get(sz2),
            nominal_si=float(z_ohm),
            unit="Ohm",
        )

    return DecodedMPN(mpn=s, family="Other", decoded_ok=False)


# ---------------------------------------------------------------------------
# Stackup Physics Evaluators (Djordjevic-Sarkar & Classical Lamination Theory)
# ---------------------------------------------------------------------------


def djordjevic_sarkar_er_df(mat: dict[str, Any], freq_hz: float) -> tuple[float, float]:
    """Evaluate causal frequency-dependent (er(f), tan_delta(f)) using Djordjevic-Sarkar."""
    ds = mat.get("djordjevic_sarkar", {"f_low_hz": 1e4, "f_high_hz": 1e12, "f_ref_hz": 1e9})
    f1 = float(ds["f_low_hz"])
    f2 = float(ds["f_high_hz"])
    f_ref = float(ds["f_ref_hz"])
    er_ref = float(mat["er_1ghz"])
    df_ref = float(mat["df_1ghz"])

    # Causal complex permittivity approximation
    delta_er = (2.0 / math.pi) * er_ref * df_ref * math.log(f2 / f1)
    f = max(f1, min(f2, float(freq_hz)))
    er_f = er_ref + (delta_er / math.log(f2 / f1)) * math.log(
        math.hypot(f2, f_ref) / math.hypot(f2, f) * math.hypot(f1, f) / math.hypot(f1, f_ref)
    )
    # Approximate tan_delta with gentle slope matching er_10ghz/df_10ghz
    df_10 = float(mat.get("df_10ghz", df_ref * 1.25))
    slope = (df_10 - df_ref) / math.log10(10.0)
    df_f = max(0.001, df_ref + slope * math.log10(max(f, 1e6) / 1e9))
    return float(er_f), float(df_f)


def compute_clt_effective_properties(
    board_stackup: dict[str, Any],
    materials: dict[str, Any],
    copper_ratios_by_layer: dict[str, float],
    temp_c: float,
) -> dict[str, float]:
    """Compute Classical Lamination Theory (CLT) effective E_xy, CTE_xy, and k_xy/k_z at temperature T."""
    cu = materials["COPPER_ED"]
    e_cu = cu["E_gpa_25c"] + (cu["E_gpa_260c"] - cu["E_gpa_25c"]) * max(0.0, min(1.0, (temp_c - 25.0) / 235.0))
    cte_cu = cu["cte_ppm_per_c"]
    k_cu = cu["k_w_per_mk"]

    total_t = 0.0
    sum_et = 0.0
    sum_ecte_t = 0.0
    sum_kt = 0.0
    sum_t_over_k = 0.0

    for lyr in board_stackup["layers"]:
        t = float(lyr["thickness_mm"])
        kind = lyr["kind"]
        mat = materials[lyr["material"]]
        if kind == "copper":
            cu_r = max(0.0, min(1.0, float(copper_ratios_by_layer.get(lyr["name"], 0.65))))
            # Resin fills (1 - cu_r) between copper features
            e_res = 4.0 if temp_c > 170.0 else 14.0
            cte_res = 18.0 if temp_c > 170.0 else 14.5
            k_res = 0.45
            e_eff = cu_r * e_cu + (1.0 - cu_r) * e_res
            cte_eff = (cu_r * e_cu * cte_cu + (1.0 - cu_r) * e_res * cte_res) / max(e_eff, 1e-6)
            k_xy = cu_r * k_cu + (1.0 - cu_r) * k_res
            k_z = cu_r * k_cu + (1.0 - cu_r) * k_res
        elif kind in ("prepreg", "core"):
            tg = float(mat["tg_c"])
            e_eff = float(mat["E_xy_above_tg_gpa"] if temp_c > tg else mat["E_xy_below_tg_gpa"])
            cte_eff = float(mat["cte_xy_above_tg_ppm"] if temp_c > tg else mat["cte_xy_below_tg_ppm"])
            k_xy = float(mat["k_xy_w_per_mk"])
            k_z = float(mat["k_z_w_per_mk"])
        else:
            e_eff = float(mat.get("E_gpa_25c", 3.5))
            cte_eff = float(mat.get("cte_ppm_per_c", 50.0))
            k_xy = 0.25
            k_z = 0.20

        total_t += t
        sum_et += e_eff * t
        sum_ecte_t += e_eff * cte_eff * t
        sum_kt += k_xy * t
        sum_t_over_k += t / max(k_z, 1e-6)

    e_xy_gpa = sum_et / max(total_t, 1e-6)
    cte_xy_ppm = sum_ecte_t / max(sum_et, 1e-6)
    k_xy_w_mk = sum_kt / max(total_t, 1e-6)
    k_z_w_mk = total_t / max(sum_t_over_k, 1e-6)
    return {
        "total_thickness_mm": total_t,
        "E_xy_gpa": e_xy_gpa,
        "CTE_xy_ppm_per_c": cte_xy_ppm,
        "k_xy_w_per_mk": k_xy_w_mk,
        "k_z_w_per_mk": k_z_w_mk,
    }
