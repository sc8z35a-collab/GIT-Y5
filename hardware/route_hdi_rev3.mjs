#!/usr/bin/env node
/**
 * RK T4 Rev 3.0 — 12-Layer 0.800mm 3+6+3 HDI Full-Ball Router & High-Speed Length Matcher
 * =======================================================================================
 * Phase 1 + Phase 2 + Phase 3 unified production generator:
 *   - 100% 1:1 physical BGA footprints (ZERO pin omission):
 *       U101 RK3588S2        : 1,253 balls (FCCSP1253L, 0.40mm pitch, 0.22mm pads)
 *       U301 K3LK7K70BM-BGCP :   496 balls (FBGA-496,   0.40mm pitch, 0.22mm pads, 180 deg)
 *       U302 KLMAG1JETD-B041 :   153 balls (FBGA-153,   0.50mm pitch, 0.28mm pads, B.Cu)
 *   - All 7 datasheet-verified package fixes (MSOP-8, SOT-23, FBGA-496, DSBGA-36,
 *     SOT-23-6, 0201 BLM03, USON-14).
 *   - Genuine 0.800mm 12-Layer 3+6+3 (3-Step) HDI Stackup (TU-872SLK / S1000-2M Er=3.70):
 *       L1  F.Cu     (30um)  Component pads + outer escape + same-net power straps
 *       L2  In1.Cu   (15um)  Solid GND Reference Plane #1 (uVia L1-L2 0.10/0.20mm, AR 0.45:1)
 *       L3  In2.Cu   (15um)  HS Signal 1 (H) — 40R/80R LPDDR5X, 100R MIPI, 90R USB3
 *       L4  In3.Cu   (15um)  HS Signal 2 (V) — 40R/80R LPDDR5X, 85R PCIe, 50R eMMC
 *       L5  In4.Cu   (15um)  Solid GND Reference Plane #2 (Shield)
 *       L6  In5.Cu   (15um)  Inner Signal 3 (H) — LPDDR5X + System Buses
 *       L7  In6.Cu   (15um)  Inner Signal 4 (V) — System Buses + Spine
 *       L8  In7.Cu   (15um)  Solid VSYS_3V87 Power Plane (10A Main Bus)
 *       L9  In8.Cu   (15um)  Inner Signal 5 (H) — Core Power + Bottom BGA/eMMC
 *       L10 In9.Cu   (15um)  Inner Signal 6 (V) — Bottom BGA + Spine + Control
 *       L11 In10.Cu  (15um)  Solid GND Reference Plane #3 (uVia L12-L11 0.10/0.20mm, AR 0.45:1)
 *       L12 B.Cu     (30um)  Bottom pads (eMMC 153-FBGA + 106 cavity 01005 MLCCs)
 *   - Stage 1: Same-side BGA power-ball strapping & close same-side pad merging
 *   - Stage 2: 3+6+3 Staggered Laser Microvia (0.10/0.20mm) fanout (GND->L2/L11 VIP!)
 *   - Stage 3: 6-Layer HDI PathFinder Negotiated Congestion router (buried core L4<->L9 0.15/0.25mm)
 *   - Stage 3.5: True physical serpentine meander length matching for ALL 16 LPDDR5X groups + diff pairs
 *   - Stage 4: Native KiCad 9.0.8 pcbnew.ZONE_FILLER on all 4 copper planes
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RK3588S2_MAP, LPDDR5X_MAP, EMMC51_MAP } from './bga_full_expand.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HW_DIR = __dirname;
const NETLIST_PATH = path.join(HW_DIR, 'rk_t4_netlist.json');
const PCB_PATH = path.join(HW_DIR, 'rk_t4_mainboard.kicad_pcb');
const PRO_PATH = path.join(HW_DIR, 'rk_t4_mainboard.kicad_pro');
const LM_REPORT_PATH = path.join(HW_DIR, 'length_match_report.json');

const t0 = Date.now();
const data = JSON.parse(fs.readFileSync(NETLIST_PATH, 'utf8'));

// ============================================================================
// 1. 12-LAYER 0.800mm 3+6+3 HDI DESIGN RULES & CONTROLLED IMPEDANCES
// ============================================================================
const RULES = {
  minClearance: 0.070,       // 2.76 mil (JLCPCB HDI 2.7 mil capable)
  minTrackWidth: 0.070,      // 2.76 mil
  dogboneWidth: 0.075,       // Short BGA/microvia escape dogbone
  uViaDia: 0.18,             // 0.18mm microvia capture pad (0.050mm annular ring; unlocks 0.40mm BGA 1-trace/ch escape!)
  uViaDrill: 0.08,           // 0.08mm laser drill (JLCPCB 0.075-0.15mm HDI spec; AR = 0.066/0.08 = 0.825:1 <= 1:1!)
  buriedDia: 0.20,           // 0.20mm buried core via pad (In3-In8; unlocks diagonal 0.283mm packing inside 0.40mm BGAs!)
  buriedDrill: 0.10,         // 0.10mm buried core drill (JLCPCB 0.1mm/(0.2/0.25mm) HDI spec; Core AR = 0.334/0.10 = 3.34:1!)
  thDia: 0.25,               // 0.25mm full-board through-via pad (VSYS & GND stitching)
  thDrill: 0.15,             // 0.15mm mechanical through drill (TH AR = 0.80/0.15 = 5.33:1 <= 10:1!)
  holeClearance: 0.10,       // Hole-to-trace min (0.200 - 0.040 - 0.035 = 0.125mm >= 0.100mm PASS!)
  holeToHole: 0.15,          // Hole-to-hole min (diagonal 0.283 - 0.080 = 0.203mm >= 0.150mm PASS!)
  copperEdgeClearance: 0.30, // Copper-to-Edge.Cuts
  boardThickness: 0.80,
};

// Stripline Propagation Delay for TU-872SLK / S1000-2M (Er = 3.70):
const ER_STRIP = 3.70;
const TPD_PS_PER_MM = Math.sqrt(ER_STRIP) / 0.299792458; // 6.416 ps/mm

// Netclass -> Controlled Impedance Track Width (mm) computed from h1=0.066, h2=0.129, t=0.015, Er=3.70
// Note: 0.124mm -> 40.42 Ohm SE (+1.0%), gap on 0.20mm grid = 0.076mm >= 0.070mm DRC!
const NETCLASS_SPECS = {
  Default:       { width: 0.075, clearance: 0.070, diffGap: 0.100, zTarget: 'General' },
  DDR_SE_40:     { width: 0.124, clearance: 0.070, diffGap: 0.095, zTarget: '40.4 Ohm SE' },
  DDR_DIFF_80:   { width: 0.110, clearance: 0.070, diffGap: 0.095, zTarget: '80.1 Ohm Diff' },
  EMMC_SE_50:    { width: 0.081, clearance: 0.070, diffGap: 0.100, zTarget: '49.9 Ohm SE' },
  PCIE_DIFF_85:  { width: 0.095, clearance: 0.070, diffGap: 0.100, zTarget: '85.0 Ohm Diff' },
  USB3_DIFF_90:  { width: 0.090, clearance: 0.070, diffGap: 0.130, zTarget: '90.1 Ohm Diff' },
  MIPI_DIFF_100: { width: 0.075, clearance: 0.070, diffGap: 0.150, zTarget: '100.0 Ohm Diff' },
  POWER_WIDE:    { width: 0.124, clearance: 0.070, diffGap: 0.100, zTarget: 'Low-R Power' },
};

function classifyNet(name) {
  if (!name) return 'Default';
  if (/^LPDDR5X_.*_(CK|WCK\d|RDQS\d)_[PN]$/.test(name)) return 'DDR_DIFF_80';
  if (/^LPDDR5X_/.test(name)) return 'DDR_SE_40';
  if (/^EMMC_|^CLK_24M|^CAM\d_MCLK/.test(name)) return 'EMMC_SE_50';
  if (/^PCIE_.*_(TX|RX|CLK)_[PN]$/.test(name)) return 'PCIE_DIFF_85';
  if (/^(USB3_|USB0_D_|USBC_TX|USBC_RX|MODEM_USB_)/.test(name)) return 'USB3_DIFF_90';
  if (/^MIPI_(CSI|DSI)/.test(name)) return 'MIPI_DIFF_100';
  if (/^(VSYS|VBAT|VBUS|VDD|VCC|AVDD|AVCC|OLED_EL|CAM\d_)/.test(name)) return 'POWER_WIDE';
  return 'Default';
}

// 12-layer copper names & 6 inner signal routing layers
const SIG_LAYERS = ['In2.Cu', 'In3.Cu', 'In5.Cu', 'In6.Cu', 'In8.Cu', 'In9.Cu'];
const NUM_SIG = SIG_LAYERS.length; // 6 signal layers: s=0(H), s=1(V), s=2(H), s=3(V), s=4(H), s=5(V)
const SIG_PREF_DIR = [0, 1, 0, 1, 0, 1]; // 0 = Horizontal, 1 = Vertical
// Z-height (mm) from F.Cu for accurate length calculation including via barrels
const LAYER_Z = {
  'F.Cu': 0.000, 'In1.Cu': 0.068, 'In2.Cu': 0.149, 'In3.Cu': 0.212,
  'In4.Cu': 0.293, 'In5.Cu': 0.352, 'In6.Cu': 0.413, 'In7.Cu': 0.472,
  'In8.Cu': 0.531, 'In9.Cu': 0.594, 'In10.Cu': 0.675, 'B.Cu': 0.750,
};

// Exact Mainboard L-shaped outline (board coords: X in [-18.5..16.5], Y in [-69.0..48.0])
const OUTLINE_POLY = [
  [-18.5, 48.0], [16.5, 48.0], [16.5, -69.0],
  [7.6, -69.0],  [7.6, 3.0],   [-18.5, 3.0],
];

// 4 verified 100% component-free Mezzanine Interposer bars shared 1:1 by Mainboard F.Cu, Mezzanine B.Cu, and 3D Assembly!
const INTERPOSER_BARS = [
  { name: 'NORTH',      cx:  0.60, cy: 40.00, w: 20.0, h: 0.70, horiz: true,  count: 20 },
  { name: 'MID_WEST',   cx: -9.60, cy: 16.60, w: 10.4, h: 0.70, horiz: true,  count: 11 },
  { name: 'SOUTH_WEST', cx: -8.70, cy:  6.80, w:  9.8, h: 0.70, horiz: true,  count: 10 },
  { name: 'SOUTH_EAST', cx: 13.30, cy:  9.50, w: 0.70, h:  5.2, horiz: false, count:  7 },
];

// Routing Grid: 0.20mm pitch (EXACT half-divisor of 0.40mm BGA pitch!)
// Aligned so grid origin = (-18.4, -68.9) -> U101 (4.6, 24.5) & U301 (-10.8, 24.5) balls hit exact EVEN/ODD cells!
// Check U101 ball x = 4.6 + (c - 20.5)*0.40 = 4.6 - 8.2 + c*0.40 = -3.6 + 0.40*c -> ALL multiples of 0.20!
// Check U101 ball y = 24.5 - (r - 20.5)*0.40 = 24.5 + 8.2 - 0.40*r = 32.7 - 0.40*r -> ALL (0.10 + 0.20*k)!
// So setting GRID_Y0 = -68.90 puts EVERY U101 ball on EXACT integer grid cells (gx, gy),
// and EVERY diagonal midpoint (x ± 0.20, y ± 0.20) ALSO on EXACT integer grid cells (gx ± 1, gy ± 1)!!
const GRID = 0.20;
const GRID_X0 = -18.40;
const GRID_Y0 = -68.90;
const NX = Math.round((16.40 - GRID_X0) / GRID) + 1; // 175
const NY = Math.round((47.90 - GRID_Y0) / GRID) + 1; // 585

const gxToX = (gx) => +(GRID_X0 + gx * GRID).toFixed(4);
const gyToY = (gy) => +(GRID_Y0 + gy * GRID).toFixed(4);
const xToGx = (x) => Math.round((x - GRID_X0) / GRID);
const yToGy = (y) => Math.round((y - GRID_Y0) / GRID);
const cellKey = (gx, gy) => gy * NX + gx;

function deterministicUuid(seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < 4; i++) {
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  const s = hex(h1) + hex(h2) + hex(h1 ^ 0xa5a5a5a5) + hex(h2 ^ 0x5a5a5a5a);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

// ============================================================================
// 2. GEOMETRY PRIMITIVES
// ============================================================================
function pointInPoly(px, py, poly = OUTLINE_POLY) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distPointToSegSq(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

function distPointToPolyEdges(px, py, poly = OUTLINE_POLY) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d2 = distPointToSegSq(px, py, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

function distPointToPad(px, py, pad) {
  if (pad.shape === 'circle') {
    return Math.max(0, Math.hypot(px - pad.wx, py - pad.wy) - pad.ww * 0.5);
  }
  const dx = Math.max(0, Math.abs(px - pad.wx) - pad.ww * 0.5);
  const dy = Math.max(0, Math.abs(py - pad.wy) - pad.wh * 0.5);
  return Math.hypot(dx, dy);
}

function distPadToPad(a, b) {
  if (a.shape === 'circle' && b.shape === 'circle') {
    return Math.max(0, Math.hypot(a.wx - b.wx, a.wy - b.wy) - (a.ww + b.ww) * 0.5);
  }
  const dx = Math.max(0, Math.abs(a.wx - b.wx) - (a.ww + b.ww) * 0.5);
  const dy = Math.max(0, Math.abs(a.wy - b.wy) - (a.wh + b.wh) * 0.5);
  return Math.hypot(dx, dy);
}

function distSegToPad(x1, y1, x2, y2, pad) {
  if (pad.shape === 'circle') {
    return Math.max(0, Math.sqrt(distPointToSegSq(pad.wx, pad.wy, x1, y1, x2, y2)) - pad.ww * 0.5);
  }
  const minX = pad.wx - pad.ww * 0.5, maxX = pad.wx + pad.ww * 0.5;
  const minY = pad.wy - pad.wh * 0.5, maxY = pad.wy + pad.wh * 0.5;
  if ((x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) ||
      (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY)) return 0;
  // Exact AABB-segment intersection test (Liang-Barsky)
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dy, y1 - minY], [dy, maxY - y1]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) { t0 = 2; break; } }
    else {
      const r = q / p;
      if (p < 0) { if (r > t1) { t0 = 2; break; } if (r > t0) t0 = r; }
      else       { if (r < t0) { t0 = 2; break; } if (r < t1) t1 = r; }
    }
  }
  if (t0 <= t1) return 0;
  let best = Infinity;
  for (const [px, py] of [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]) {
    best = Math.min(best, Math.sqrt(distPointToSegSq(px, py, x1, y1, x2, y2)));
  }
  for (const [px, py] of [[x1, y1], [x2, y2]]) {
    const cx = Math.max(0, Math.max(minX - px, px - maxX));
    const cy = Math.max(0, Math.max(minY - py, py - maxY));
    best = Math.min(best, Math.hypot(cx, cy));
  }
  return best;
}

function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const ccw = (p1x, p1y, p2x, p2y, p3x, p3y) => (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
  return ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
         ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy);
}

function distSegToSeg(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.sqrt(Math.min(
    distPointToSegSq(ax, ay, cx, cy, dx, dy),
    distPointToSegSq(bx, by, cx, cy, dx, dy),
    distPointToSegSq(cx, cy, ax, ay, bx, by),
    distPointToSegSq(dx, dy, ax, ay, bx, by),
  ));
}

function insetOrthoPolygon(poly, inset) {
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], curr = poly[i], next = poly[(i + 1) % n];
    const e1x = curr[0] - prev[0], e1y = curr[1] - prev[1], l1 = Math.hypot(e1x, e1y);
    const e2x = next[0] - curr[0], e2y = next[1] - curr[1], l2 = Math.hypot(e2x, e2y);
    const n1x = e1y / l1, n1y = -e1x / l1;
    const n2x = e2y / l2, n2y = -e2x / l2;
    out.push([+(curr[0] + (n1x + n2x) * inset).toFixed(4), +(curr[1] + (n1y + n2y) * inset).toFixed(4)]);
  }
  return out;
}

// ============================================================================
// 3. BUILD 1:1 PHYSICAL FOOTPRINTS & PAD DATABASE (3,543+ MAINBOARD PADS!)
// ============================================================================
const mainComps = data.components.filter((c) => c.board === 'main');
const j901Orig = data.components.find((c) => c.ref === 'J901');

const netNameToId = new Map([['', 0]]);
const idToNetName = [''];
function getNetId(name) {
  if (!name) return 0;
  if (!netNameToId.has(name)) {
    netNameToId.set(name, idToNetName.length);
    idToNetName.push(name);
  }
  return netNameToId.get(name);
}

// Precompute target centroids for non-BGA pin-to-slot assignment
const mainNetCoords = new Map();
for (const c of mainComps) {
  for (const net of Object.values(c.pins)) {
    if (!net) continue;
    if (!mainNetCoords.has(net)) mainNetCoords.set(net, []);
    mainNetCoords.get(net).push({ ref: c.ref, x: c.x, y: c.y });
  }
}

function getNetTargetForComp(net, excludeRef, fallbackX, fallbackY) {
  const list = (mainNetCoords.get(net) || []).filter((p) => p.ref !== excludeRef);
  if (!list.length) return { x: fallbackX, y: fallbackY };
  return {
    x: list.reduce((s, p) => s + p.x, 0) / list.length,
    y: list.reduce((s, p) => s + p.y, 0) / list.length,
  };
}

function assignPinsToSlots(comp, pinEntries, slots) {
  const rot = (comp.rot || 0) * (Math.PI / 180);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const slotWorld = slots.map((s, idx) => ({
    ...s, idx,
    wx: comp.x + s.lx * cos - s.ly * sin,
    wy: comp.y + s.lx * sin + s.ly * cos,
  }));
  const thermalSlot = slotWorld.find((s) => s.thermal);
  const used = new Set();
  const assignments = [];
  const remainingPins = [];
  for (const [pinName, netName] of pinEntries) {
    if (thermalSlot && !used.has(thermalSlot.idx) && netName === 'GND') {
      used.add(thermalSlot.idx);
      assignments.push({ pinName, netName, ...thermalSlot });
    } else {
      remainingPins.push([pinName, netName]);
    }
  }
  const scored = remainingPins.map(([pinName, netName]) => {
    const tgt = getNetTargetForComp(netName, comp.ref, comp.x, comp.y);
    const isPlane = netName === 'GND' || netName === 'VSYS_3V87';
    return { pinName, netName, tx: tgt.x, ty: tgt.y, prio: isPlane ? 1 : 0 };
  });
  scored.sort((a, b) => a.prio - b.prio);
  for (const item of scored) {
    let bestSlot = null, bestScore = Infinity;
    for (const s of slotWorld) {
      if (used.has(s.idx)) continue;
      const d = Math.hypot(s.wx - item.tx, s.wy - item.ty);
      if (d < bestScore) { bestScore = d; bestSlot = s; }
    }
    if (!bestSlot) throw new Error(`Out of pad slots on ${comp.ref}`);
    used.add(bestSlot.idx);
    assignments.push({ pinName: item.pinName, netName: item.netName, ...bestSlot });
  }
  return assignments;
}

function generateSlotsForComp(c, pinCount) {
  const w = c.w, h = c.h, pkg = c.pkg || '';
  if (pinCount === 1) {
    const d = Math.min(0.55, Math.min(w, h) * 0.78);
    return [{ lx: 0, ly: 0, pw: d, ph: d, shape: 'circle' }];
  }
  if (pinCount === 2) {
    const horiz = w >= h;
    const L = horiz ? w : h, S = horiz ? h : w;
    let pw, ph, off;
    if (pkg.startsWith('01005'))      { pw = 0.11; ph = 0.14; off = 0.115; }
    else if (pkg.startsWith('0201'))  { pw = 0.17; ph = 0.21; off = 0.165; }
    else if (pkg.startsWith('0402'))  { pw = 0.32; ph = 0.38; off = 0.28; }
    else if (pkg.startsWith('0603'))  { pw = 0.46; ph = 0.62; off = 0.49; }
    else {
      pw = +(Math.min(L * 0.30, L * 0.5 - 0.12)).toFixed(3);
      ph = +(S * 0.72).toFixed(3);
      off = +(L * 0.5 - pw * 0.5 - 0.08).toFixed(3);
      if (2 * off - pw < 0.14) { pw = +((L - 0.30) * 0.5).toFixed(3); off = +(pw * 0.5 + 0.08).toFixed(3); }
    }
    if (horiz) return [{ lx: -off, ly: 0, pw, ph, shape: 'roundrect' }, { lx: +off, ly: 0, pw, ph, shape: 'roundrect' }];
    return [{ lx: 0, ly: +off, pw: ph, ph: pw, shape: 'roundrect' }, { lx: 0, ly: -off, pw: ph, ph: pw, shape: 'roundrect' }];
  }
  if (pinCount === 3) {
    // True IPC SOT-23 (2.9x2.4mm) or DFN1006-3 (1.0x0.6mm) 3-pin package
    const horiz = w >= h;
    const inset = +(Math.min(0.10, Math.min(w, h) * 0.06)).toFixed(3);
    if (horiz) {
      const pw = +(Math.min(0.60, w * 0.24)).toFixed(3);
      const ph = +(Math.min(0.70, h * 0.27)).toFixed(3);
      const ox = +(w * 0.5 - pw * 0.5 - inset).toFixed(3);
      const oy = +(h * 0.5 - ph * 0.5 - inset).toFixed(3);
      return [
        { lx: -ox, ly: +oy, pw, ph, shape: 'roundrect' },
        { lx: -ox, ly: -oy, pw, ph, shape: 'roundrect' },
        { lx: +ox, ly: 0,   pw, ph, shape: 'roundrect' },
      ];
    }
    const pw = +(Math.min(0.60, w * 0.27)).toFixed(3);
    const ph = +(Math.min(0.70, h * 0.24)).toFixed(3);
    const ox = +(w * 0.5 - pw * 0.5 - inset).toFixed(3);
    const oy = +(h * 0.5 - ph * 0.5 - inset).toFixed(3);
    return [
      { lx: -ox, ly: -oy, pw, ph, shape: 'roundrect' },
      { lx: +ox, ly: -oy, pw, ph, shape: 'roundrect' },
      { lx: 0,   ly: +oy, pw, ph, shape: 'roundrect' },
    ];
  }
  if (pinCount === 4) {
    const insetX = Math.min(0.10, w * 0.10), insetY = Math.min(0.10, h * 0.10);
    const usableW = w - 2 * insetX, usableH = h - 2 * insetY;
    const pw = +(Math.max(0.16, Math.min(0.46, (usableW - 0.13) * 0.5))).toFixed(3);
    const ph = +(Math.max(0.16, Math.min(0.46, (usableH - 0.13) * 0.5))).toFixed(3);
    const ox = +((usableW - pw) * 0.5).toFixed(3), oy = +((usableH - ph) * 0.5).toFixed(3);
    return [
      { lx: -ox, ly: +oy, pw, ph, shape: 'roundrect' }, { lx: +ox, ly: +oy, pw, ph, shape: 'roundrect' },
      { lx: -ox, ly: -oy, pw, ph, shape: 'roundrect' }, { lx: +ox, ly: -oy, pw, ph, shape: 'roundrect' },
    ];
  }
  // Dual-row packages: BTB, DFN2510, SOT23-5/6, SOT-23-6, MSOP-8, USON-14, WSON-8
  if (
    pkg.startsWith('BTB') || pkg.startsWith('DFN2510') || pkg.startsWith('SOT23') ||
    pkg.startsWith('SOT-23-6') || pkg.startsWith('MSOP-8') || pkg.startsWith('USON-14') ||
    pkg.startsWith('WSON') || pkg.startsWith('DFN-8')
  ) {
    const horiz = w >= h;
    const n1 = Math.ceil(pinCount / 2), n2 = Math.floor(pinCount / 2);
    const slots = [];
    if (horiz) {
      const marginX = Math.min(0.35, w * 0.09);
      const spanX = w - 2 * marginX;
      const pitch = n1 > 1 ? spanX / (n1 - 1) : 0;
      const pw = +(Math.max(0.16, Math.min(0.42, n1 > 1 ? pitch - 0.14 : 0.35))).toFixed(3);
      const ph = +(Math.max(0.22, Math.min(0.55, (h - 0.30) * 0.36))).toFixed(3);
      const oy = +(h * 0.5 - ph * 0.5 - 0.10).toFixed(3);
      for (let i = 0; i < n1; i++) slots.push({ lx: +(n1 > 1 ? -spanX * 0.5 + i * pitch : 0).toFixed(4), ly: +oy, pw, ph, shape: 'roundrect' });
      for (let i = 0; i < n2; i++) slots.push({ lx: +(n2 > 1 ? -spanX * 0.5 + i * (spanX / (n2 - 1)) : 0).toFixed(4), ly: -oy, pw, ph, shape: 'roundrect' });
    } else {
      const marginY = Math.min(0.35, h * 0.09);
      const spanY = h - 2 * marginY;
      const pitch = n1 > 1 ? spanY / (n1 - 1) : 0;
      const ph = +(Math.max(0.16, Math.min(0.42, n1 > 1 ? pitch - 0.14 : 0.35))).toFixed(3);
      const pw = +(Math.max(0.22, Math.min(0.55, (w - 0.30) * 0.36))).toFixed(3);
      const ox = +(w * 0.5 - pw * 0.5 - 0.10).toFixed(3);
      for (let i = 0; i < n1; i++) slots.push({ lx: -ox, ly: +(n1 > 1 ? spanY * 0.5 - i * pitch : 0).toFixed(4), pw, ph, shape: 'roundrect' });
      for (let i = 0; i < n2; i++) slots.push({ lx: +ox, ly: +(n2 > 1 ? spanY * 0.5 - i * (spanY / (n2 - 1)) : 0).toFixed(4), pw, ph, shape: 'roundrect' });
    }
    return slots;
  }
  // Small WLCSP / DSBGA / WLP (except U101/U301/U302 which use exact official BGA maps!)
  if (pkg.includes('BGA') || pkg.includes('CSP') || pkg.includes('WLP')) {
    let cols = Math.ceil(Math.sqrt((pinCount * w) / h));
    let rows = Math.ceil(pinCount / cols);
    while (cols * rows < pinCount) cols++;
    const marginX = Math.min(0.6, Math.max(0.22, w * 0.10));
    const marginY = Math.min(0.6, Math.max(0.22, h * 0.10));
    const spanX = w - 2 * marginX, spanY = h - 2 * marginY;
    const pitchX = cols > 1 ? spanX / (cols - 1) : 0;
    const pitchY = rows > 1 ? spanY / (rows - 1) : 0;
    const minPitch = Math.min(cols > 1 ? pitchX : 99, rows > 1 ? pitchY : 99);
    const dia = +(Math.max(0.18, Math.min(0.32, minPitch - 0.14))).toFixed(3);
    const slots = [];
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const lx = cols > 1 ? -spanX * 0.5 + col * pitchX : 0;
        const ly = rows > 1 ? spanY * 0.5 - r * pitchY : 0;
        slots.push({ lx: +lx.toFixed(4), ly: +ly.toFixed(4), pw: dia, ph: dia, shape: 'circle', isInterior: r > 0 && r < rows - 1 && col > 0 && col < cols - 1 });
      }
    }
    if (slots.length > pinCount) {
      const perim = slots.filter((s) => !s.isInterior);
      const inner = slots.filter((s) => s.isInterior);
      return perim.length >= pinCount ? perim : [...perim, ...inner];
    }
    return slots;
  }
  // QFN / WQFN / VQFN / TQFN / MLP / LGA / OLGA (4-sided perimeter with guaranteed corner clearance)
  const hasGnd = Object.values(c.pins).includes('GND');
  const useThermal = hasGnd && Math.min(w, h) >= 4.0 && pinCount >= 16;
  const perimCount = useThermal ? pinCount - 1 : pinCount;
  const totalPerim = 2 * (w + h);
  let nHoriz = Math.max(1, Math.round((perimCount * w) / totalPerim));
  let nVert = Math.max(1, Math.ceil((perimCount - 2 * nHoriz) / 2));
  while (2 * nHoriz + 2 * nVert < perimCount) { if (w >= h) nHoriz++; else nVert++; }
  const nTop = nHoriz, nBot = nHoriz, nLeft = nVert, nRight = Math.max(0, perimCount - nTop - nBot - nLeft);
  const edgeInset = 0.08;
  const padLen = +(Math.max(0.24, Math.min(0.44, Math.min(w, h) * 0.115))).toFixed(3);
  const maxPadW = 0.22;
  const cornerClear = +(edgeInset + padLen + maxPadW * 0.5 + 0.16).toFixed(3);
  const spanX = Math.max(0.2, w - 2 * cornerClear), spanY = Math.max(0.2, h - 2 * cornerClear);
  const pitchX = nTop > 1 ? spanX / (nTop - 1) : 0.6;
  const pitchY = nLeft > 1 ? spanY / (nLeft - 1) : 0.6;
  const padW = +(Math.max(0.14, Math.min(maxPadW, Math.min(pitchX, pitchY) - 0.13))).toFixed(3);
  const ox = +(w * 0.5 - padLen * 0.5 - edgeInset).toFixed(3);
  const oy = +(h * 0.5 - padLen * 0.5 - edgeInset).toFixed(3);
  const slots = [];
  for (let i = 0; i < nTop; i++)   slots.push({ lx: +(nTop > 1 ? -spanX * 0.5 + i * pitchX : 0).toFixed(4), ly: +oy, pw: padW, ph: padLen, shape: 'roundrect' });
  for (let i = 0; i < nBot; i++)   slots.push({ lx: +(nBot > 1 ? -spanX * 0.5 + i * pitchX : 0).toFixed(4), ly: -oy, pw: padW, ph: padLen, shape: 'roundrect' });
  for (let i = 0; i < nLeft; i++)  slots.push({ lx: -ox, ly: +(nLeft > 1 ? spanY * 0.5 - i * pitchY : 0).toFixed(4), pw: padLen, ph: padW, shape: 'roundrect' });
  for (let i = 0; i < nRight; i++) slots.push({ lx: +ox, ly: +(nRight > 1 ? spanY * 0.5 - i * (spanY / Math.max(1, nRight - 1)) : 0).toFixed(4), pw: padLen, ph: padW, shape: 'roundrect' });
  if (useThermal) {
    const tw = +(Math.min(2.6, w - 2 * padLen - 1.2)).toFixed(3);
    const th = +(Math.min(2.6, h - 2 * padLen - 1.2)).toFixed(3);
    if (tw >= 0.8 && th >= 0.8) slots.push({ lx: 0, ly: 0, pw: tw, ph: th, shape: 'roundrect', thermal: true });
  }
  return slots;
}

const footprints = [];
const allPads = [];

// Helper to emit exact 1:1 physical BGA footprints from official JSON maps
function addExactBgaFootprint(c, mapDoc, flip180 = false, mirrorBot = false) {
  const layer = c.side === 'top' ? 'F.Cu' : 'B.Cu';
  const fpPads = [];
  const dia = mapDoc.pad_dia;
  for (const b of mapDoc.balls) {
    // JSON map uses KiCad-like (x right, y down); board coords have y UP -> board ly = -b.y!
    let lx = b.x;
    let ly = -b.y;
    if (flip180) { lx = -lx; ly = -ly; }
    if (mirrorBot) { lx = -lx; }
    const wx = +(c.x + lx).toFixed(4);
    const wy = +(c.y + ly).toFixed(4);
    const netName = c.pins[b.ball] || '';
    const padObj = {
      id: allPads.length,
      ref: c.ref,
      padNum: b.ball,
      pinName: b.name,
      netName,
      netId: getNetId(netName),
      side: c.side,
      layer,
      lx: +lx.toFixed(4),
      ly: +ly.toFixed(4),
      pw: dia,
      ph: dia,
      shape: 'circle',
      wx, wy, ww: dia, wh: dia,
      rot: 0,
      isBga04: mapDoc.pitch <= 0.45,
      isFullBga: true,
    };
    fpPads.push(padObj);
    allPads.push(padObj);
  }
  footprints.push({
    ref: c.ref, mpn: c.mpn, pkg: c.pkg, value: c.value,
    side: c.side, x: c.x, y: c.y, w: c.w, h: c.h, rot: 0,
    pads: fpPads, isInterposer: false, isFullBga: true,
  });
}

for (const c of mainComps) {
  if (c.ref === 'U101') { addExactBgaFootprint(c, RK3588S2_MAP, false, false); continue; }
  if (c.ref === 'U301') { addExactBgaFootprint(c, LPDDR5X_MAP,  true,  false); continue; } // 180 deg: CH_A/C directly face U101!
  if (c.ref === 'U302') { addExactBgaFootprint(c, EMMC51_MAP,   false, true);  continue; } // B.Cu mirrored!

  const pinEntries = Object.entries(c.pins);
  const slots = generateSlotsForComp(c, pinEntries.length);
  const assigned = assignPinsToSlots(c, pinEntries, slots);
  const rot = c.rot || 0;
  const rad = (rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const layer = c.side === 'top' ? 'F.Cu' : 'B.Cu';
  const fpPads = [];
  assigned.forEach((p, idx) => {
    const wx = +(c.x + p.lx * cos - p.ly * sin).toFixed(4);
    const wy = +(c.y + p.lx * sin + p.ly * cos).toFixed(4);
    const isRot90 = Math.abs(rot % 180) === 90;
    const padObj = {
      id: allPads.length, ref: c.ref, padNum: String(idx + 1), pinName: p.pinName,
      netName: p.netName, netId: getNetId(p.netName), side: c.side, layer,
      lx: p.lx, ly: p.ly, pw: p.pw, ph: p.ph, shape: p.shape,
      wx, wy, ww: isRot90 ? p.ph : p.pw, wh: isRot90 ? p.pw : p.ph, rot,
      isBga04: false, isFullBga: false,
    };
    fpPads.push(padObj);
    allPads.push(padObj);
  });
  footprints.push({
    ref: c.ref, mpn: c.mpn, pkg: c.pkg, value: c.value,
    side: c.side, x: c.x, y: c.y, w: c.w, h: c.h, rot,
    pads: fpPads, isInterposer: false, isFullBga: false,
  });
}

// Add J901 Interposer Mainboard Landing Pads (48 BGA pads inside the 4 verified bars!)
{
  const j901Slots = [];
  for (const bar of INTERPOSER_BARS) {
    const n = bar.count, dia = 0.22;
    if (bar.horiz) {
      const span = bar.w - 0.70, pitch = n > 1 ? span / (n - 1) : 0;
      for (let i = 0; i < n; i++) j901Slots.push({ lx: +(bar.cx - span * 0.5 + i * pitch).toFixed(4), ly: +bar.cy.toFixed(4), pw: dia, ph: dia, shape: 'circle' });
    } else {
      const span = bar.h - 0.70, pitch = n > 1 ? span / (n - 1) : 0;
      for (let i = 0; i < n; i++) j901Slots.push({ lx: +bar.cx.toFixed(4), ly: +(bar.cy + span * 0.5 - i * pitch).toFixed(4), pw: dia, ph: dia, shape: 'circle' });
    }
  }
  const assignedJ901 = assignPinsToSlots({ ref: 'J901', x: 0, y: 0, rot: 0 }, Object.entries(j901Orig.pins), j901Slots);
  const fpPads = [];
  assignedJ901.forEach((p, idx) => {
    const padObj = {
      id: allPads.length, ref: 'J901', padNum: String(idx + 1), pinName: p.pinName,
      netName: p.netName, netId: getNetId(p.netName), side: 'top', layer: 'F.Cu',
      lx: p.lx, ly: p.ly, pw: p.pw, ph: p.ph, shape: 'circle',
      wx: p.lx, wy: p.ly, ww: p.pw, wh: p.ph, rot: 0, isBga04: false, isFullBga: false,
    };
    fpPads.push(padObj);
    allPads.push(padObj);
  });
  footprints.push({
    ref: 'J901', mpn: j901Orig.mpn, pkg: 'BGA-48-INTERPOSER-4BAR', value: 'RF-Mezzanine-48P-BGA-Interposer-Landing',
    side: 'top', x: 0, y: 0, w: 0, h: 0, rot: 0, pads: fpPads, isInterposer: true, isFullBga: false,
  });
}

// Pre-Router Pad Geometry Audit
let padPadViol = 0, padEdgeViol = 0;
const topPads = allPads.filter((p) => p.side === 'top');
const botPads = allPads.filter((p) => p.side === 'bot');
for (const pad of allPads) {
  const hw = pad.ww * 0.5, hh = pad.wh * 0.5;
  for (const [cx, cy] of [[pad.wx - hw, pad.wy - hh], [pad.wx + hw, pad.wy - hh], [pad.wx + hw, pad.wy + hh], [pad.wx - hw, pad.wy + hh]]) {
    if (!pointInPoly(cx, cy) || distPointToPolyEdges(cx, cy) < RULES.copperEdgeClearance + 0.004) {
      padEdgeViol++;
      if (padEdgeViol <= 10) console.warn(`  [PAD-EDGE] ${pad.ref}.${pad.padNum} d=${distPointToPolyEdges(cx, cy).toFixed(3)}mm`);
      break;
    }
  }
}
for (const sidePads of [topPads, botPads]) {
  for (let i = 0; i < sidePads.length; i++) {
    const a = sidePads[i];
    for (let j = i + 1; j < sidePads.length; j++) {
      const b = sidePads[j];
      if (a.netId === b.netId && a.netId !== 0) continue;
      if (Math.abs(a.wx - b.wx) > (a.ww + b.ww) * 0.5 + 0.16) continue;
      if (Math.abs(a.wy - b.wy) > (a.wh + b.wh) * 0.5 + 0.16) continue;
      const d = distPadToPad(a, b);
      if (d < RULES.minClearance + 0.004) {
        padPadViol++;
        if (padPadViol <= 15) console.warn(`  [PAD-PAD] ${a.ref}.${a.padNum} vs ${b.ref}.${b.padNum} gap=${d.toFixed(3)}mm`);
      }
    }
  }
}
console.log(`Built ${footprints.length} footprints (${allPads.length} physical pads, ${idToNetName.length - 1} active nets). Pad Audit: pad-pad=${padPadViol}, pad-edge=${padEdgeViol}`);

// ============================================================================
// 4. SPATIAL INDEX, 3+6+3 HDI VIA REGISTRY & DRC-STRICT VALIDATORS
// ============================================================================
class SpatialHash {
  constructor(cellSize = 1.5) { this.cellSize = cellSize; this.map = new Map(); }
  insertBox(item, minX, minY, maxX, maxY) {
    const ix0 = Math.floor(minX / this.cellSize), ix1 = Math.floor(maxX / this.cellSize);
    const iy0 = Math.floor(minY / this.cellSize), iy1 = Math.floor(maxY / this.cellSize);
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
      const k = `${ix},${iy}`;
      let arr = this.map.get(k);
      if (!arr) { arr = []; this.map.set(k, arr); }
      arr.push(item);
    }
  }
  queryBox(minX, minY, maxX, maxY) {
    const ix0 = Math.floor(minX / this.cellSize), ix1 = Math.floor(maxX / this.cellSize);
    const iy0 = Math.floor(minY / this.cellSize), iy1 = Math.floor(maxY / this.cellSize);
    const seen = new Set(), out = [];
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
      const arr = this.map.get(`${ix},${iy}`);
      if (!arr) continue;
      for (const it of arr) if (!seen.has(it)) { seen.add(it); out.push(it); }
    }
    return out;
  }
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v) {
    const a = this.a; a.push(v); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length > 0) {
      a[0] = last; let i = 0; const n = a.length;
      while (true) {
        let l = (i << 1) + 1, r = l + 1, m = i;
        if (l < n && a[l].f < a[m].f) m = l;
        if (r < n && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

const padHashTop = new SpatialHash(1.2);
const padHashBot = new SpatialHash(1.2);
for (const p of topPads) padHashTop.insertBox(p, p.wx - p.ww * 0.5, p.wy - p.wh * 0.5, p.wx + p.ww * 0.5, p.wy + p.wh * 0.5);
for (const p of botPads) padHashBot.insertBox(p, p.wx - p.ww * 0.5, p.wy - p.wh * 0.5, p.wx + p.ww * 0.5, p.wy + p.wh * 0.5);

// Track & Via storage per physical copper layer
const layerSegs = {
  'F.Cu': [], 'In1.Cu': [], 'In2.Cu': [], 'In3.Cu': [], 'In4.Cu': [],
  'In5.Cu': [], 'In6.Cu': [], 'In7.Cu': [], 'In8.Cu': [], 'In9.Cu': [],
  'In10.Cu': [], 'B.Cu': [],
};
const layerSegHash = {};
for (const l of Object.keys(layerSegs)) layerSegHash[l] = new SpatialHash(1.5);

// All HDI vias (micro, blind buried core, and through-hole GND/VSYS)
const allVias = []; // { type: 'micro'|'blind'|'through', x, y, dia, drill, l1, l2, netId, id }
const viaHashByLayer = {};
for (const l of Object.keys(layerSegs)) viaHashByLayer[l] = new SpatialHash(1.0);
const allDrillHash = new SpatialHash(0.8); // Checks hole-to-hole & co-located holes globally!

const LAYER_ORDER = ['F.Cu','In1.Cu','In2.Cu','In3.Cu','In4.Cu','In5.Cu','In6.Cu','In7.Cu','In8.Cu','In9.Cu','In10.Cu','B.Cu'];
const LAYER_IDX = Object.fromEntries(LAYER_ORDER.map((l, i) => [l, i]));

function viaSpannedLayers(l1, l2) {
  const i0 = Math.min(LAYER_IDX[l1], LAYER_IDX[l2]);
  const i1 = Math.max(LAYER_IDX[l1], LAYER_IDX[l2]);
  return LAYER_ORDER.slice(i0, i1 + 1);
}

function registerSeg(layer, x1, y1, x2, y2, width, netId) {
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-4) return null;
  const seg = { x1, y1, x2, y2, width, netId, layer };
  layerSegs[layer].push(seg);
  const hw = width * 0.5;
  layerSegHash[layer].insertBox(seg, Math.min(x1, x2) - hw, Math.min(y1, y2) - hw, Math.max(x1, x2) + hw, Math.max(y1, y2) + hw);
  return seg;
}

function viaSpansOverlap(zMinA, zMaxA, zMinB, zMaxB) {
  return zMinA <= zMaxB && zMinB <= zMaxA;
}

function registerVia(type, x, y, dia, drill, l1, l2, netId) {
  const zMin = Math.min(LAYER_IDX[l1], LAYER_IDX[l2]);
  const zMax = Math.max(LAYER_IDX[l1], LAYER_IDX[l2]);
  const v = { id: allVias.length, type, x: +x.toFixed(4), y: +y.toFixed(4), dia, drill, l1, l2, zMin, zMax, netId, layers: viaSpannedLayers(l1, l2) };
  allVias.push(v);
  const r = dia * 0.5;
  for (const l of v.layers) viaHashByLayer[l].insertBox(v, v.x - r, v.y - r, v.x + r, v.y + r);
  allDrillHash.insertBox(v, v.x - drill * 0.5, v.y - drill * 0.5, v.x + drill * 0.5, v.y + drill * 0.5);
  return v;
}

// Check if a microvia or buried/through via is strictly DRC-legal across all spanned layers + overlapping-Z drill spacing
function isViaStrictlyLegal(type, x, y, dia, drill, l1, l2, netId, allowPadOverlap = false) {
  const r = dia * 0.5;
  const hr = drill * 0.5;
  const zMin = Math.min(LAYER_IDX[l1], LAYER_IDX[l2]);
  const zMax = Math.max(LAYER_IDX[l1], LAYER_IDX[l2]);
  if (!pointInPoly(x, y) || distPointToPolyEdges(x, y) < RULES.copperEdgeClearance + r + 0.015) return false;

  // 1. Check hole-to-hole & co-located drills ONLY against vias with overlapping Z-layer span (true sequential HDI lamination!)
  //    Adjacent sequential same-net laser microvias (e.g. F->In1 + In1->In2 + In2->In3) may stack directly at dc=0 (copper-filled VIPPO!).
  const nearbyDrills = allDrillHash.queryBox(x - 0.5, y - 0.5, x + 0.5, y + 0.5);
  for (const ov of nearbyDrills) {
    if (!viaSpansOverlap(zMin, zMax, ov.zMin, ov.zMax)) continue;
    const dc = Math.hypot(x - ov.x, y - ov.y);
    if (dc < 0.005) {
      const legalMicroStack = (type === 'micro' && ov.type === 'micro' && ov.netId === netId &&
        (zMin === ov.zMax || zMax === ov.zMin));
      if (legalMicroStack) continue;
      return false; // Never co-locate non-sequential or blind/buried drills sharing a copper layer!
    }
    const wall = dc - hr - ov.drill * 0.5;
    if (wall < RULES.holeToHole + 0.005) return false;
  }

  // 2. Check copper clearance on EVERY spanned layer (pads, vias, existing segs)
  const spanned = viaSpannedLayers(l1, l2);
  for (const l of spanned) {
    if (l === 'F.Cu' || l === 'B.Cu') {
      const pHash = l === 'F.Cu' ? padHashTop : padHashBot;
      const pads = pHash.queryBox(x - r - 0.2, y - r - 0.2, x + r + 0.2, y + r + 0.2);
      for (const p of pads) {
        if (p.netId === netId && allowPadOverlap) continue;
        if (p.netId === netId) continue; // same net touch OK
        const d = distPointToPad(x, y, p);
        if (d < r + RULES.minClearance + 0.005) return false;
        if (d < hr + RULES.holeClearance + 0.005) return false;
      }
    }
    const oVias = viaHashByLayer[l].queryBox(x - r - 0.3, y - r - 0.3, x + r + 0.3, y + r + 0.3);
    for (const ov of oVias) {
      if (ov.netId === netId) continue;
      const dc = Math.hypot(x - ov.x, y - ov.y);
      if (dc < r + ov.dia * 0.5 + RULES.minClearance + 0.004) return false;
      if (dc < hr + ov.dia * 0.5 + RULES.holeClearance + 0.004) return false;
    }
    const oSegs = layerSegHash[l].queryBox(x - r - 0.25, y - r - 0.25, x + r + 0.25, y + r + 0.25);
    for (const s of oSegs) {
      if (s.netId === netId) continue;
      const d = Math.sqrt(distPointToSegSq(x, y, s.x1, s.y1, s.x2, s.y2));
      if (d < r + s.width * 0.5 + RULES.minClearance + 0.004) return false;
      if (d < hr + s.width * 0.5 + RULES.holeClearance + 0.004) return false;
    }
  }
  return true;
}

// Check if a segment on a given copper layer is strictly DRC-legal
function isLayerSegLegal(layer, x1, y1, x2, y2, width, netId) {
  const hw = width * 0.5;
  const minX = Math.min(x1, x2) - hw - 0.20, maxX = Math.max(x1, x2) + hw + 0.20;
  const minY = Math.min(y1, y2) - hw - 0.20, maxY = Math.max(y1, y2) + hw + 0.20;
  for (const [px, py] of [[x1, y1], [x2, y2], [(x1 + x2) * 0.5, (y1 + y2) * 0.5]]) {
    if (!pointInPoly(px, py) || distPointToPolyEdges(px, py) < RULES.copperEdgeClearance + hw + 0.01) return false;
  }
  if (layer === 'F.Cu' || layer === 'B.Cu') {
    const pHash = layer === 'F.Cu' ? padHashTop : padHashBot;
    for (const p of pHash.queryBox(minX, minY, maxX, maxY)) {
      if (p.netId === netId) continue;
      if (distSegToPad(x1, y1, x2, y2, p) < hw + RULES.minClearance + 0.006) return false;
    }
  }
  for (const v of viaHashByLayer[layer].queryBox(minX, minY, maxX, maxY)) {
    if (v.netId === netId) continue;
    const d = Math.sqrt(distPointToSegSq(v.x, v.y, x1, y1, x2, y2));
    if (d < hw + v.dia * 0.5 + RULES.minClearance + 0.006) return false;
    if (d < hw + v.drill * 0.5 + RULES.holeClearance + 0.006) return false;
  }
  for (const s of layerSegHash[layer].queryBox(minX, minY, maxX, maxY)) {
    if (s.netId === netId) continue;
    if (distSegToSeg(x1, y1, x2, y2, s.x1, s.y1, s.x2, s.y2) < hw + s.width * 0.5 + RULES.minClearance + 0.006) return false;
  }
  return true;
}

// Precompute inside-board grid mask for inner routing layers
const validInnerCell = new Uint8Array(NX * NY);
for (let gy = 0; gy < NY; gy++) {
  const y = gyToY(gy);
  for (let gx = 0; gx < NX; gx++) {
    const x = gxToX(gx);
    if (pointInPoly(x, y) && distPointToPolyEdges(x, y) >= RULES.copperEdgeClearance + 0.14) {
      validInnerCell[cellKey(gx, gy)] = 1;
    }
  }
}

// ============================================================================
// 5. STAGE 1 — SAME-SIDE BGA POWER STRAPPING & CLOSE PAD MERGING
// ============================================================================
const t1 = Date.now();
const parentUF = new Int32Array(allPads.length);
for (let i = 0; i < allPads.length; i++) parentUF[i] = i;
function ufFind(i) { while (parentUF[i] !== i) { parentUF[i] = parentUF[parentUF[i]]; i = parentUF[i]; } return i; }
function ufUnion(a, b) { const ra = ufFind(a), rb = ufFind(b); if (ra !== rb) parentUF[ra] = rb; }

const GND_ID = getNetId('GND');
const VSYS_ID = getNetId('VSYS_3V87');

// Group pads by net
const padsByNet = new Map();
for (const p of allPads) {
  if (p.netId === 0) continue;
  if (!padsByNet.has(p.netId)) padsByNet.set(p.netId, []);
  padsByNet.get(p.netId).push(p);
}

let stage1Bridges = 0;
// 1A: Bridge adjacent same-net power/signal BGA balls directly on F.Cu / B.Cu (huge via reduction!)
// 1B: Bridge close same-side pads of ANY non-GND/non-VSYS net within 3.2mm via straight or 1-bend L-route!
for (const [netId, pads] of padsByNet.entries()) {
  if (netId === GND_ID || netId === VSYS_ID || pads.length < 2) continue;
  const w = pads[0].isBga04 ? 0.095 : 0.085;
  for (const side of ['top', 'bot']) {
    const sp = pads.filter((p) => p.side === side);
    if (sp.length < 2) continue;
    const layer = side === 'top' ? 'F.Cu' : 'B.Cu';
    const pairs = [];
    for (let i = 0; i < sp.length; i++) {
      for (let j = i + 1; j < sp.length; j++) {
        const d = Math.hypot(sp[i].wx - sp[j].wx, sp[i].wy - sp[j].wy);
        if (d <= 3.0) pairs.push({ a: sp[i], b: sp[j], d });
      }
    }
    pairs.sort((p1, p2) => p1.d - p2.d);
    for (const { a, b } of pairs) {
      if (ufFind(a.id) === ufFind(b.id)) continue;
      // Try direct straight bridge first (covers all orthogonal & diagonal 0.40mm/0.566mm BGA same-net power balls!)
      if (isLayerSegLegal(layer, a.wx, a.wy, b.wx, b.wy, w, netId)) {
        registerSeg(layer, a.wx, a.wy, b.wx, b.wy, w, netId);
        ufUnion(a.id, b.id);
        stage1Bridges++;
        continue;
      }
      // Try 2-segment L-bend (H-V or V-H) for close component pads <= 2.4mm
      if (Math.hypot(a.wx - b.wx, a.wy - b.wy) <= 2.4) {
        for (const [mx, my] of [[b.wx, a.wy], [a.wx, b.wy]]) {
          if (isLayerSegLegal(layer, a.wx, a.wy, mx, my, w, netId) &&
              isLayerSegLegal(layer, mx, my, b.wx, b.wy, w, netId)) {
            registerSeg(layer, a.wx, a.wy, mx, my, w, netId);
            registerSeg(layer, mx, my, b.wx, b.wy, w, netId);
            ufUnion(a.id, b.id);
            stage1Bridges++;
            break;
          }
        }
      }
    }
  }
}
console.log(`Stage 1 (Same-side BGA power strapping & close merges): ${stage1Bridges} bridges in ${Date.now() - t1}ms`);

// ============================================================================
// 6. STAGE 2 — 3+6+3 HDI LASER MICROVIA FANOUT (0.10/0.20mm)
// ============================================================================
const t2 = Date.now();
let gndViasTop = 0, gndViasBot = 0, gndViaFails = 0;

// 2A: ALL Top GND pads -> Single Via-in-Pad Laser Microvia F.Cu -> In1.Cu (L2 GND Plane)!
//     ALL Bot GND pads -> Single Via-in-Pad Laser Microvia B.Cu -> In10.Cu (L11 GND Plane)!
for (const p of allPads) {
  if (p.netId !== GND_ID) continue;
  const targetPlane = p.side === 'top' ? 'In1.Cu' : 'In10.Cu';
  const surfLayer = p.side === 'top' ? 'F.Cu' : 'B.Cu';
  const l1 = p.side === 'top' ? 'F.Cu' : 'In10.Cu';
  const l2 = p.side === 'top' ? 'In1.Cu' : 'B.Cu';
  // Try exact pad center first (VIPPO copper-filled laser microvia!)
  if (isViaStrictlyLegal('micro', p.wx, p.wy, RULES.uViaDia, RULES.uViaDrill, l1, l2, GND_ID, true)) {
    registerVia('micro', p.wx, p.wy, RULES.uViaDia, RULES.uViaDrill, l1, l2, GND_ID);
    if (p.side === 'top') gndViasTop++; else gndViasBot++;
    continue;
  }
  // If pad is tiny (01005/0201) adjacent to another net or near edge, fanout short stub on surface layer to nearest legal microvia!
  let placed = false;
  for (let rad = 0.12; rad <= 1.2 && !placed; rad += 0.08) {
    for (let a = 0; a < 16; a++) {
      const ang = (a * Math.PI * 2) / 16;
      const vx = +(p.wx + Math.cos(ang) * rad).toFixed(4);
      const vy = +(p.wy + Math.sin(ang) * rad).toFixed(4);
      if (isViaStrictlyLegal('micro', vx, vy, RULES.uViaDia, RULES.uViaDrill, l1, l2, GND_ID, true) &&
          isLayerSegLegal(surfLayer, p.wx, p.wy, vx, vy, RULES.dogboneWidth, GND_ID)) {
        registerSeg(surfLayer, p.wx, p.wy, vx, vy, RULES.dogboneWidth, GND_ID);
        registerVia('micro', vx, vy, RULES.uViaDia, RULES.uViaDrill, l1, l2, GND_ID);
        if (p.side === 'top') gndViasTop++; else gndViasBot++;
        placed = true;
        break;
      }
    }
  }
  if (!placed) {
    // Fallback: try connecting on surface layer to a nearby already-via'd GND pad!
    const pHash = p.side === 'top' ? padHashTop : padHashBot;
    const nearGnd = pHash.queryBox(p.wx - 1.5, p.wy - 1.5, p.wx + 1.5, p.wy + 1.5)
      .filter((op) => op.id !== p.id && op.netId === GND_ID)
      .sort((a, b) => Math.hypot(a.wx - p.wx, a.wy - p.wy) - Math.hypot(b.wx - p.wx, b.wy - p.wy));
    for (const ng of nearGnd) {
      if (isLayerSegLegal(surfLayer, p.wx, p.wy, ng.wx, ng.wy, RULES.dogboneWidth, GND_ID)) {
        registerSeg(surfLayer, p.wx, p.wy, ng.wx, ng.wy, RULES.dogboneWidth, GND_ID);
        placed = true;
        break;
      }
    }
  }
  if (!placed) {
    gndViaFails++;
    console.warn(`  [GND FANOUT FAIL] ${p.ref}.${p.padNum} @ (${p.wx},${p.wy}) [${p.side}]`);
  }
}
// Tie adjacent BGA GND balls together on F.Cu / B.Cu (straight + 2-segment diagonal bypass) so zero isolated GND pockets form inside dense 0.40mm antipad moats!
let gndSurfStraps = 0, gndMoatEscapes = 0;
for (const side of ['top', 'bot']) {
  const surfLayer = side === 'top' ? 'F.Cu' : 'B.Cu';
  const gPads = allPads.filter((p) => p.netId === GND_ID && p.side === side && (p.ref === 'U101' || p.ref === 'U301' || p.ref === 'U302'));
  // Union-Find on GND BGA pads so we only add non-redundant bridges
  const gParent = new Int32Array(gPads.length).map((_, i) => i);
  const gFind = (x) => (gParent[x] === x ? x : (gParent[x] = gFind(gParent[x])));
  const gUnion = (a, b) => { gParent[gFind(a)] = gFind(b); };
  // Pass 1: direct straight bridges (dist <= 0.85mm)
  for (let i = 0; i < gPads.length; i++) {
    const a = gPads[i];
    for (let j = i + 1; j < gPads.length; j++) {
      const b = gPads[j];
      if (a.ref !== b.ref) continue;
      const d = Math.hypot(a.wx - b.wx, a.wy - b.wy);
      if (d <= 0.85 && isLayerSegLegal(surfLayer, a.wx, a.wy, b.wx, b.wy, RULES.dogboneWidth, GND_ID)) {
        registerSeg(surfLayer, a.wx, a.wy, b.wx, b.wy, RULES.dogboneWidth, GND_ID);
        gUnion(i, j);
        gndSurfStraps++;
      }
    }
  }
  // Pass 2: 2-segment diagonal dogleg bridges around intervening signal balls (dist <= 1.25mm)
  for (let i = 0; i < gPads.length; i++) {
    const a = gPads[i];
    for (let j = i + 1; j < gPads.length; j++) {
      const b = gPads[j];
      if (a.ref !== b.ref || gFind(i) === gFind(j)) continue;
      const dx = b.wx - a.wx, dy = b.wy - a.wy;
      const d = Math.hypot(dx, dy);
      if (d > 1.25) continue;
      const mx0 = (a.wx + b.wx) * 0.5, my0 = (a.wy + b.wy) * 0.5;
      const perpX = -dy / d, perpY = dx / d;
      for (const off of [0.20, -0.20, 0.28, -0.28]) {
        const mx = +(mx0 + perpX * off).toFixed(4), my = +(my0 + perpY * off).toFixed(4);
        if (isLayerSegLegal(surfLayer, a.wx, a.wy, mx, my, RULES.dogboneWidth, GND_ID) &&
            isLayerSegLegal(surfLayer, mx, my, b.wx, b.wy, RULES.dogboneWidth, GND_ID)) {
          registerSeg(surfLayer, a.wx, a.wy, mx, my, RULES.dogboneWidth, GND_ID);
          registerSeg(surfLayer, mx, my, b.wx, b.wy, RULES.dogboneWidth, GND_ID);
          gUnion(i, j);
          gndSurfStraps++;
          break;
        }
      }
    }
  }
  // Pass 3: Outer-perimeter U301/U101 GND balls step 0.40-0.60mm outside BGA antipad moat to solid In1.Cu GND plane!
  if (side === 'top') {
    for (const p of gPads) {
      if (p.ref !== 'U301' && p.ref !== 'U101') continue;
      const fp = footprints.find((f) => f.ref === p.ref);
      if (!fp) continue;
      const nearL = p.wx - (fp.x - fp.w * 0.5) < 0.65;
      const nearR = (fp.x + fp.w * 0.5) - p.wx < 0.65;
      const nearB = p.wy - (fp.y - fp.h * 0.5) < 0.65;
      const nearT = (fp.y + fp.h * 0.5) - p.wy < 0.65;
      if (!nearL && !nearR && !nearB && !nearT) continue;
      const dirs = [];
      if (nearL) dirs.push([-0.45, 0], [-0.55, 0]);
      if (nearR) dirs.push([0.45, 0], [0.55, 0]);
      if (nearB) dirs.push([0, -0.45], [0, -0.55]);
      if (nearT) dirs.push([0, 0.45], [0, 0.55]);
      for (const [ddx, ddy] of dirs) {
        const vx = +(p.wx + ddx).toFixed(4), vy = +(p.wy + ddy).toFixed(4);
        if (isViaStrictlyLegal('micro', vx, vy, RULES.uViaDia, RULES.uViaDrill, 'F.Cu', 'In1.Cu', GND_ID, false) &&
            isLayerSegLegal('F.Cu', p.wx, p.wy, vx, vy, RULES.dogboneWidth, GND_ID)) {
          registerSeg('F.Cu', p.wx, p.wy, vx, vy, RULES.dogboneWidth, GND_ID);
          registerVia('micro', vx, vy, RULES.uViaDia, RULES.uViaDrill, 'F.Cu', 'In1.Cu', GND_ID);
          gndMoatEscapes++;
          break;
        }
      }
    }
  }
}
console.log(`Stage 2A (GND VIP Laser Microvias): top=${gndViasTop}, bot=${gndViasBot}, failed=${gndViaFails}, bgaSurfStraps=${gndSurfStraps}, moatEscapes=${gndMoatEscapes}`);

// 2B: VSYS_3V87 Plane Pads -> Clean Via Drop straight to In7.Cu (L8 Power Plane)!
const vsysPads = padsByNet.get(VSYS_ID) || [];
let vsysDrops = 0, vsysFails = 0;
// Merge close same-side VSYS pads first
for (const side of ['top', 'bot']) {
  const sp = vsysPads.filter((p) => p.side === side);
  const layer = side === 'top' ? 'F.Cu' : 'B.Cu';
  for (let i = 0; i < sp.length; i++) {
    for (let j = i + 1; j < sp.length; j++) {
      if (ufFind(sp[i].id) === ufFind(sp[j].id)) continue;
      if (Math.hypot(sp[i].wx - sp[j].wx, sp[i].wy - sp[j].wy) <= 2.4 &&
          isLayerSegLegal(layer, sp[i].wx, sp[i].wy, sp[j].wx, sp[j].wy, 0.12, VSYS_ID)) {
        registerSeg(layer, sp[i].wx, sp[i].wy, sp[j].wx, sp[j].wy, 0.12, VSYS_ID);
        ufUnion(sp[i].id, sp[j].id);
      }
    }
  }
}
const vsysClusters = new Map();
for (const p of vsysPads) {
  const r = ufFind(p.id);
  if (!vsysClusters.has(r)) vsysClusters.set(r, []);
  vsysClusters.get(r).push(p);
}
const thViaGridOcc = new Int32Array(NX * NY); // Tracks through/buried/inner vias on grid
const uVia12Occ = new Int32Array(NX * NY);    // In1<->In2 microvia occupancy on grid
const uVia910Occ = new Int32Array(NX * NY);   // In9<->In10 microvia occupancy on grid

for (const cluster of vsysClusters.values()) {
  let placed = false;
  for (const p of cluster) {
    const surfLayer = p.side === 'top' ? 'F.Cu' : 'B.Cu';
    const gx0 = xToGx(p.wx), gy0 = yToGy(p.wy);
    // Search nearest grid cell for clean through-hole via to In7.Cu (AR=5.33:1)
    for (let rad = 0; rad <= 12 && !placed; rad++) {
      for (let dy = -rad; dy <= rad && !placed; dy++) {
        for (let dx = -rad; dx <= rad && !placed; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const gx = gx0 + dx, gy = gy0 + dy;
          if (gx < 1 || gx >= NX - 1 || gy < 1 || gy >= NY - 1 || !validInnerCell[cellKey(gx, gy)]) continue;
          const vx = gxToX(gx), vy = gyToY(gy);
          if (isViaStrictlyLegal('through', vx, vy, RULES.thDia, RULES.thDrill, 'F.Cu', 'B.Cu', VSYS_ID, false) &&
              isLayerSegLegal(surfLayer, p.wx, p.wy, vx, vy, 0.12, VSYS_ID)) {
            registerSeg(surfLayer, p.wx, p.wy, vx, vy, 0.12, VSYS_ID);
            registerVia('through', vx, vy, RULES.thDia, RULES.thDrill, 'F.Cu', 'B.Cu', VSYS_ID);
            thViaGridOcc[cellKey(gx, gy)] = VSYS_ID;
            vsysDrops++;
            placed = true;
          }
        }
      }
    }
    if (placed) break;
  }
  if (!placed) { vsysFails++; console.warn(`  [VSYS FAIL] cluster ${cluster[0].ref}.${cluster[0].padNum}`); }
}
console.log(`Stage 2B (VSYS_3V87 Plane Drops): ${vsysDrops}/${vsysClusters.size} ok, failed=${vsysFails}`);

// 2C: Build all remaining Signal/Power multi-cluster nets & Fan out via TRUE 3+6+3 Copper-Filled Stacked VIPPO Laser Microvias!
//   - Outer BGA balls & CH0A/CH1C LPDDR5X -> 2-step stacked F->In1->In2 (sLayer=0, In2.Cu)
//   - Inner BGA balls & CH0B/CH1D LPDDR5X -> 3-step stacked F->In1->In2->In3 (sLayer=1, In3.Cu)
//   - ZERO diagonal dogbones on In1.Cu (GND) / In10.Cu (GND3) -> 100% solid unbroken 0.080mm GND copper web across every 0.40mm BGA!
const uVia23Occ = new Int32Array(NX * NY);
const uVia89Occ = new Int32Array(NX * NY);
const netListToRoute = [];
let totalClustersToFan = 0, fanoutOk = 0, fanoutFail = 0, stackedIn2 = 0, stackedIn3 = 0, stackedBotIn9 = 0, stackedBotIn8 = 0, staggeredFallback = 0;

const netIdsOrdered = [...padsByNet.keys()].filter((id) => id !== GND_ID && id !== VSYS_ID);
netIdsOrdered.sort((a, b) => {
  const pa = padsByNet.get(a), pb = padsByNet.get(b);
  const aBga = pa.some((p) => p.isBga04) ? 0 : 1;
  const bBga = pb.some((p) => p.isBga04) ? 0 : 1;
  if (aBga !== bBga) return aBga - bBga;
  return pb.length - pa.length;
});

function shouldTopLandIn3(netName, p, gx0, gy0) {
  if (/^LPDDR5X_(CH0B|CH1D)_/.test(netName)) return true;
  if (/^LPDDR5X_(CH0A|CH1C)_/.test(netName)) return false;
  // Checkerboard 50/50 split inside U101 & U301 so In2.Cu and In3.Cu carry equal BGA escape load!
  if (p.ref === 'U101' || p.ref === 'U301') return (((gx0 >> 1) + (gy0 >> 1)) & 1) === 1;
  return false;
}

function fanoutTopClusterToIn2(cluster, netId, netName) {
  // Strategy 1 (True 3+6+3 Copper-Filled Stacked VIPPO directly at grid-aligned BGA/SMD pad center — ZERO In1.Cu dogbones!)
  for (const p of cluster) {
    const gx0 = xToGx(p.wx), gy0 = yToGy(p.wy);
    if (gx0 < 1 || gx0 >= NX - 1 || gy0 < 1 || gy0 >= NY - 1) continue;
    const k0 = cellKey(gx0, gy0);
    if (!validInnerCell[k0] || uVia12Occ[k0] !== 0 || thViaGridOcc[k0] !== 0) continue;
    const mx = gxToX(gx0), my = gyToY(gy0);
    if (Math.hypot(mx - p.wx, my - p.wy) > 0.006) continue;
    if (!isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'F.Cu', 'In1.Cu', netId, true)) continue;
    if (!isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In1.Cu', 'In2.Cu', netId, false)) continue;
    registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'F.Cu', 'In1.Cu', netId);
    registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In1.Cu', 'In2.Cu', netId);
    uVia12Occ[k0] = netId;
    if (shouldTopLandIn3(netName, p, gx0, gy0) && uVia23Occ[k0] === 0 &&
        isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In2.Cu', 'In3.Cu', netId, false)) {
      registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In2.Cu', 'In3.Cu', netId);
      uVia23Occ[k0] = netId;
      stackedIn3++;
      return { sLayer: 1, gx: gx0, gy: gy0, x: mx, y: my, padGx: gx0, padGy: gy0, isBga04: !!p.isBga04 };
    }
    stackedIn2++;
    return { sLayer: 0, gx: gx0, gy: gy0, x: mx, y: my, padGx: gx0, padGy: gy0, isBga04: !!p.isBga04 };
  }
  // Strategy 2 (Short F.Cu stub to nearest free grid cell -> Stacked F->In1->In2 VIPPO — STILL ZERO In1.Cu dogbones!)
  for (const p of cluster) {
    const gx0 = xToGx(p.wx), gy0 = yToGy(p.wy);
    for (let rad = 0; rad <= 14; rad++) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const gx = gx0 + dx, gy = gy0 + dy;
        if (gx < 2 || gx >= NX - 2 || gy < 2 || gy >= NY - 2) continue;
        const k = cellKey(gx, gy);
        if (!validInnerCell[k] || uVia12Occ[k] !== 0 || thViaGridOcc[k] !== 0) continue;
        const mx = gxToX(gx), my = gyToY(gy);
        const allowPad = Math.hypot(mx - p.wx, my - p.wy) < 0.08;
        if (!isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'F.Cu', 'In1.Cu', netId, allowPad)) continue;
        if (!isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In1.Cu', 'In2.Cu', netId, false)) continue;
        if (Math.hypot(mx - p.wx, my - p.wy) > 0.005 && !isLayerSegLegal('F.Cu', p.wx, p.wy, mx, my, RULES.dogboneWidth, netId)) continue;
        if (Math.hypot(mx - p.wx, my - p.wy) > 0.005) registerSeg('F.Cu', p.wx, p.wy, mx, my, RULES.dogboneWidth, netId);
        registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'F.Cu', 'In1.Cu', netId);
        registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In1.Cu', 'In2.Cu', netId);
        uVia12Occ[k] = netId;
        if ((((gx + gy) & 1) === 1) && uVia23Occ[k] === 0 &&
            isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In2.Cu', 'In3.Cu', netId, false)) {
          registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In2.Cu', 'In3.Cu', netId);
          uVia23Occ[k] = netId;
          stackedIn3++;
          return { sLayer: 1, gx, gy, x: mx, y: my, padGx: gx, padGy: gy, isBga04: !!p.isBga04 };
        }
        stackedIn2++;
        return { sLayer: 0, gx, gy, x: mx, y: my, padGx: gx, padGy: gy, isBga04: !!p.isBga04 };
      }
    }
  }
  // Strategy 3 (Staggered In1.Cu fallback ONLY if surface F.Cu is completely surrounded on all sides)
  for (const p of cluster) {
    const l1Ok = isViaStrictlyLegal('micro', p.wx, p.wy, RULES.uViaDia, RULES.uViaDrill, 'F.Cu', 'In1.Cu', netId, true);
    if (!l1Ok) continue;
    const gx0 = xToGx(p.wx), gy0 = yToGy(p.wy);
    for (let rad = 1; rad <= 10; rad++) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const gx = gx0 + dx, gy = gy0 + dy;
        if (gx < 1 || gx >= NX - 1 || gy < 1 || gy >= NY - 1) continue;
        const k = cellKey(gx, gy);
        if (!validInnerCell[k] || uVia12Occ[k] !== 0 || thViaGridOcc[k] !== 0) continue;
        const mx = gxToX(gx), my = gyToY(gy);
        if (Math.hypot(mx - p.wx, my - p.wy) < 0.265) continue;
        if (!isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In1.Cu', 'In2.Cu', netId, false)) continue;
        if (!isLayerSegLegal('In1.Cu', p.wx, p.wy, mx, my, RULES.dogboneWidth, netId)) continue;
        registerVia('micro', p.wx, p.wy, RULES.uViaDia, RULES.uViaDrill, 'F.Cu', 'In1.Cu', netId);
        registerSeg('In1.Cu', p.wx, p.wy, mx, my, RULES.dogboneWidth, netId);
        registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In1.Cu', 'In2.Cu', netId);
        uVia12Occ[k] = netId;
        staggeredFallback++;
        return { sLayer: 0, gx, gy, x: mx, y: my, padGx: gx0, padGy: gy0, isBga04: !!p.isBga04 };
      }
    }
  }
  return null;
}

function fanoutBotClusterToIn9(cluster, netId, netName) {
  // Strategy 1 & 2 (Stacked B->In10->In9, optionally In9->In8 for checkerboard half of U302 eMMC — ZERO In10.Cu dogbones!)
  for (const p of cluster) {
    const gx0 = xToGx(p.wx), gy0 = yToGy(p.wy);
    for (let rad = 0; rad <= 14; rad++) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const gx = gx0 + dx, gy = gy0 + dy;
        if (gx < 2 || gx >= NX - 2 || gy < 2 || gy >= NY - 2) continue;
        const k = cellKey(gx, gy);
        if (!validInnerCell[k] || uVia910Occ[k] !== 0 || thViaGridOcc[k] !== 0) continue;
        const mx = gxToX(gx), my = gyToY(gy);
        const allowPad = Math.hypot(mx - p.wx, my - p.wy) < 0.12;
        if (!isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In10.Cu', 'B.Cu', netId, allowPad)) continue;
        if (!isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In9.Cu', 'In10.Cu', netId, false)) continue;
        if (Math.hypot(mx - p.wx, my - p.wy) > 0.005 && !isLayerSegLegal('B.Cu', p.wx, p.wy, mx, my, RULES.dogboneWidth, netId)) continue;
        if (Math.hypot(mx - p.wx, my - p.wy) > 0.005) registerSeg('B.Cu', p.wx, p.wy, mx, my, RULES.dogboneWidth, netId);
        registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In10.Cu', 'B.Cu', netId);
        registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In9.Cu', 'In10.Cu', netId);
        uVia910Occ[k] = netId;
        if (p.ref === 'U302' && (((gx + gy) & 1) === 1) && uVia89Occ[k] === 0 &&
            isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In8.Cu', 'In9.Cu', netId, false)) {
          registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In8.Cu', 'In9.Cu', netId);
          uVia89Occ[k] = netId;
          stackedBotIn8++;
          return { sLayer: 4, gx, gy, x: mx, y: my, padGx: gx, padGy: gy, isBga04: !!p.isBga04 };
        }
        stackedBotIn9++;
        return { sLayer: 5, gx, gy, x: mx, y: my, padGx: gx, padGy: gy, isBga04: !!p.isBga04 };
      }
    }
  }
  // Strategy 3: Staggered In10.Cu fallback
  for (const p of cluster) {
    const l1Ok = isViaStrictlyLegal('micro', p.wx, p.wy, RULES.uViaDia, RULES.uViaDrill, 'In10.Cu', 'B.Cu', netId, true);
    if (!l1Ok) continue;
    const gx0 = xToGx(p.wx), gy0 = yToGy(p.wy);
    for (let rad = 1; rad <= 10; rad++) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const gx = gx0 + dx, gy = gy0 + dy;
        if (gx < 1 || gx >= NX - 1 || gy < 1 || gy >= NY - 1) continue;
        const k = cellKey(gx, gy);
        if (!validInnerCell[k] || uVia910Occ[k] !== 0 || thViaGridOcc[k] !== 0) continue;
        const mx = gxToX(gx), my = gyToY(gy);
        if (Math.hypot(mx - p.wx, my - p.wy) < 0.265) continue;
        if (!isViaStrictlyLegal('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In9.Cu', 'In10.Cu', netId, false)) continue;
        if (!isLayerSegLegal('In10.Cu', p.wx, p.wy, mx, my, RULES.dogboneWidth, netId)) continue;
        registerVia('micro', p.wx, p.wy, RULES.uViaDia, RULES.uViaDrill, 'In10.Cu', 'B.Cu', netId);
        registerSeg('In10.Cu', p.wx, p.wy, mx, my, RULES.dogboneWidth, netId);
        registerVia('micro', mx, my, RULES.uViaDia, RULES.uViaDrill, 'In9.Cu', 'In10.Cu', netId);
        uVia910Occ[k] = netId;
        staggeredFallback++;
        return { sLayer: 5, gx, gy, x: mx, y: my, padGx: gx0, padGy: gy0, isBga04: !!p.isBga04 };
      }
    }
  }
  return null;
}

let singleClusterLocalNets = 0;
for (const netId of netIdsOrdered) {
  const pads = padsByNet.get(netId);
  const cMap = new Map();
  for (const p of pads) {
    const r = ufFind(p.id);
    if (!cMap.has(r)) cMap.set(r, []);
    cMap.get(r).push(p);
  }
  if (cMap.size < 2) { singleClusterLocalNets++; continue; }
  const netName = idToNetName[netId];
  const netClass = classifyNet(netName);
  const width = NETCLASS_SPECS[netClass].width;
  const terminals = [];
  for (const cluster of cMap.values()) {
    totalClustersToFan++;
    const side = cluster[0].side;
    const res = side === 'top' ? fanoutTopClusterToIn2(cluster, netId, netName) : fanoutBotClusterToIn9(cluster, netId, netName);
    if (res) {
      fanoutOk++;
      terminals.push({ ...res, cluster, padX: cluster[0].wx, padY: cluster[0].wy, side });
    } else {
      fanoutFail++;
      console.warn(`  [FANOUT FAIL] net=${netName} ${cluster[0].ref}.${cluster[0].padNum} (${side} @ ${cluster[0].wx},${cluster[0].wy})`);
    }
  }
  if (terminals.length >= 2) {
    netListToRoute.push({ netId, netName, netClass, width, terminals, routedNodes: [], routedVias: [] });
  }
}
console.log(`Stage 2C (3+6+3 Stacked VIPPO Fanout): ${fanoutOk}/${totalClustersToFan} OK (fail=${fanoutFail}), In2=${stackedIn2}, In3=${stackedIn3}, In9=${stackedBotIn9}, In8=${stackedBotIn8}, staggeredFB=${staggeredFallback}, innerNets=${netListToRoute.length} in ${Date.now() - t2}ms`);

// ============================================================================
// 6.5. STAGE 2D — 0.40 mm BGA 1-TRACE-PER-CHANNEL UNLOCK (0.08/0.18mm uVia)
// ============================================================================
const fixedMicroBlock = Array.from({ length: NUM_SIG }, () => new Int32Array(NX * NY));
const fixedBigBlock = Array.from({ length: NUM_SIG }, () => new Int32Array(NX * NY));
for (let k = 0; k < NX * NY; k++) {
  if (uVia12Occ[k]) fixedMicroBlock[0][k] = uVia12Occ[k];
  if (uVia23Occ[k]) fixedMicroBlock[1][k] = uVia23Occ[k];
  if (uVia89Occ[k]) fixedMicroBlock[4][k] = uVia89Occ[k];
  if (uVia910Occ[k]) fixedMicroBlock[5][k] = uVia910Occ[k];
  if (thViaGridOcc[k]) {
    for (let s = 0; s < NUM_SIG; s++) fixedBigBlock[s][k] = thViaGridOcc[k];
  }
}

function isTrackCellHardLegal(s, gx, gy, netId) {
  if (gx < 1 || gx >= NX - 1 || gy < 1 || gy >= NY - 1) return false;
  const k = cellKey(gx, gy);
  if (!validInnerCell[k]) return false;
  const fm = fixedMicroBlock[s][k];
  if (fm !== 0 && fm !== netId) return false;
  const fb = fixedBigBlock[s][k];
  if (fb !== 0 && fb !== netId) return false;
  // Only 0.25mm buried/through vias require 4-orthogonal-neighbor keepout on 0.20mm grid!
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nk = cellKey(gx + dx, gy + dy);
    const nfb = fixedBigBlock[s][nk];
    if (nfb !== 0 && nfb !== netId) return false;
  }
  return true;
}

function countFreeExits(s, gx, gy, netId) {
  let c = 0;
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    if (isTrackCellHardLegal(s, gx + dx, gy + dy, netId)) c++;
  }
  return c;
}

let zPromo23 = 0, zPromo89 = 0, trappedTerminals = 0;
for (const netObj of netListToRoute) {
  const nid = netObj.netId;
  for (const tm of netObj.terminals) {
    if (countFreeExits(tm.sLayer, tm.gx, tm.gy, nid) === 0) {
      // Only promote if truly 0 exits (e.g. boxed in by a VSYS through-via)
      const targetS = tm.sLayer === 0 ? 1 : tm.sLayer === 5 ? 4 : -1;
      if (targetS !== -1) {
        const l1 = tm.sLayer === 0 ? 'In2.Cu' : 'In8.Cu';
        const l2 = tm.sLayer === 0 ? 'In3.Cu' : 'In9.Cu';
        const curL = SIG_LAYERS[tm.sLayer];
        for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const tgx = tm.gx + dx, tgy = tm.gy + dy;
          if (tgx < 2 || tgx >= NX - 2 || tgy < 2 || tgy >= NY - 2 || !validInnerCell[cellKey(tgx, tgy)]) continue;
          const tx = gxToX(tgx), ty = gyToY(tgy);
          if (!isViaStrictlyLegal('micro', tx, ty, RULES.uViaDia, RULES.uViaDrill, l1, l2, nid, false)) continue;
          if (!isLayerSegLegal(curL, tm.x, tm.y, tx, ty, RULES.dogboneWidth, nid)) continue;
          registerSeg(curL, tm.x, tm.y, tx, ty, RULES.dogboneWidth, nid);
          registerVia('micro', tx, ty, RULES.uViaDia, RULES.uViaDrill, l1, l2, nid);
          fixedMicroBlock[tm.sLayer][cellKey(tgx, tgy)] = nid;
          fixedMicroBlock[tm.sLayer][cellKey(tm.gx, tgy)] = nid;
          fixedMicroBlock[tm.sLayer][cellKey(tgx, tm.gy)] = nid;
          fixedMicroBlock[targetS][cellKey(tgx, tgy)] = nid;
          tm.sLayer = targetS; tm.gx = tgx; tm.gy = tgy; tm.x = tx; tm.y = ty;
          if (targetS === 1) zPromo23++; else zPromo89++;
          break;
        }
      }
      if (countFreeExits(tm.sLayer, tm.gx, tm.gy, nid) === 0) trappedTerminals++;
    }
  }
}
console.log(`Stage 2D (0.40mm BGA Channel Check): zPromo23=${zPromo23}, zPromo89=${zPromo89}, trappedTerminals=${trappedTerminals}`);

// ============================================================================
// 7. STAGE 3 — 6-LAYER HDI PATHFINDER NEGOTIATED-CONGESTION ROUTER
// ============================================================================
const t3 = Date.now();

const STATE_STRIDE = NX * NY;
const segOcc = Array.from({ length: NUM_SIG }, () => new Map());
const segCnt = Array.from({ length: NUM_SIG }, () => new Uint16Array(STATE_STRIDE));
const segOne = Array.from({ length: NUM_SIG }, () => new Int32Array(STATE_STRIDE));
const segHist = Array.from({ length: NUM_SIG }, () => new Float32Array(STATE_STRIDE));

// Separate dynamic-via copper keepout (blocks OTHER nets' tracks without falsely blocking nearby buried vias!)
const viaKeepoutOcc = Array.from({ length: NUM_SIG }, () => new Map());
const vkCnt = Array.from({ length: NUM_SIG }, () => new Uint16Array(STATE_STRIDE));
const vkOne = Array.from({ length: NUM_SIG }, () => new Int32Array(STATE_STRIDE));

const viaOcc = [new Map(), new Map(), new Map()];
const viaCnt = [new Uint16Array(STATE_STRIDE), new Uint16Array(STATE_STRIDE), new Uint16Array(STATE_STRIDE)];
const viaOne = [new Int32Array(STATE_STRIDE), new Int32Array(STATE_STRIDE), new Int32Array(STATE_STRIDE)];
const viaHist = [new Float32Array(STATE_STRIDE), new Float32Array(STATE_STRIDE), new Float32Array(STATE_STRIDE)];

// Soft escape-door halo around every fanout terminal (discourages other nets from walling off a terminal's 4 exits!)
const termHaloCnt = Array.from({ length: NUM_SIG }, () => new Uint8Array(STATE_STRIDE));
const termHaloOwner = Array.from({ length: NUM_SIG }, () => new Int32Array(STATE_STRIDE));
for (const netObj of netListToRoute) {
  for (const tm of netObj.terminals) {
    const baseK = cellKey(tm.gx, tm.gy);
    for (const d of [1, -1, NX, -NX]) {
      const nk = baseK + d;
      if (nk < 0 || nk >= STATE_STRIDE) continue;
      if (termHaloCnt[tm.sLayer][nk] === 0) termHaloOwner[tm.sLayer][nk] = netObj.netId;
      else if (termHaloOwner[tm.sLayer][nk] !== netObj.netId) termHaloOwner[tm.sLayer][nk] = -1;
      if (termHaloCnt[tm.sLayer][nk] < 250) termHaloCnt[tm.sLayer][nk]++;
    }
  }
}

const VZ_ZMIN = [2, 3, 8];
const VZ_ZMAX = [3, 8, 9];
const VZ_CU_LAYERS = [
  ['In2.Cu', 'In3.Cu'],
  ['In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'In7.Cu', 'In8.Cu'],
  ['In8.Cu', 'In9.Cu'],
];
const VZ_OVERLAP = [[0, 1], [0, 1, 2], [1, 2]];

// Precompute exact Z-span-aware static via legality:
//   0 = legal for ANY net, -1 = forbidden for ALL nets, >0 = exclusive to that netId
const viaHardOwner = [new Int32Array(STATE_STRIDE), new Int32Array(STATE_STRIDE), new Int32Array(STATE_STRIDE)];
for (let gy = 2; gy < NY - 2; gy++) {
  for (let gx = 2; gx < NX - 2; gx++) {
    const k = cellKey(gx, gy);
    if (!validInnerCell[k]) { viaHardOwner[0][k] = -1; viaHardOwner[1][k] = -1; viaHardOwner[2][k] = -1; continue; }
    const x = gxToX(gx), y = gyToY(gy);
    const nearby = allDrillHash.queryBox(x - 0.36, y - 0.36, x + 0.36, y + 0.36);
    for (let vz = 0; vz < 3; vz++) {
      const dia = vz === 1 ? RULES.buriedDia : RULES.uViaDia;
      const drill = vz === 1 ? RULES.buriedDrill : RULES.uViaDrill;
      if (distPointToPolyEdges(x, y) < RULES.copperEdgeClearance + dia * 0.5 + 0.015) {
        viaHardOwner[vz][k] = -1;
        continue;
      }
      let owner = 0;
      for (const ov of nearby) {
        if (!viaSpansOverlap(VZ_ZMIN[vz], VZ_ZMAX[vz], ov.zMin, ov.zMax)) continue;
        const dc = Math.hypot(x - ov.x, y - ov.y);
        if (dc < 0.005) {
          const isMicroStack = (vz !== 1 && ov.type === 'micro' && (VZ_ZMIN[vz] === ov.zMax || VZ_ZMAX[vz] === ov.zMin));
          if (isMicroStack) {
            if (owner === 0) owner = ov.netId;
            else if (owner !== ov.netId) { owner = -1; break; }
            continue;
          }
          owner = -1; break;
        }
        if (dc - drill * 0.5 - ov.drill * 0.5 < RULES.holeToHole + 0.005) { owner = -1; break; }
        if (dc < dia * 0.5 + ov.dia * 0.5 + RULES.minClearance + 0.004) {
          if (owner === 0) owner = ov.netId;
          else if (owner !== ov.netId) { owner = -1; break; }
        }
      }
      if (owner !== -1) {
        for (const l of VZ_CU_LAYERS[vz]) {
          for (const s of layerSegHash[l].queryBox(x - dia * 0.5 - 0.14, y - dia * 0.5 - 0.14, x + dia * 0.5 + 0.14, y + dia * 0.5 + 0.14)) {
            const d = Math.sqrt(distPointToSegSq(x, y, s.x1, s.y1, s.x2, s.y2));
            if (d < dia * 0.5 + s.width * 0.5 + RULES.minClearance + 0.004) {
              if (owner === 0) owner = s.netId;
              else if (owner !== s.netId) { owner = -1; break; }
            }
          }
          if (owner === -1) break;
        }
      }
      viaHardOwner[vz][k] = owner;
    }
  }
}

function addOccFast(map, cntArr, oneArr, k, netId) {
  let m = map.get(k);
  if (!m) { m = new Map(); map.set(k, m); }
  const prev = m.get(netId) || 0;
  m.set(netId, prev + 1);
  if (prev === 0) {
    cntArr[k] = m.size;
    oneArr[k] = m.size === 1 ? netId : 0;
  }
}
function delOccFast(map, cntArr, oneArr, k, netId) {
  const m = map.get(k);
  if (!m) return;
  const c = (m.get(netId) || 0) - 1;
  if (c <= 0) {
    m.delete(netId);
    if (m.size === 0) {
      map.delete(k);
      cntArr[k] = 0;
      oneArr[k] = 0;
    } else {
      cntArr[k] = m.size;
      oneArr[k] = m.size === 1 ? m.keys().next().value : 0;
    }
  } else {
    m.set(netId, c);
  }
}
function otherCountFast(map, cntArr, oneArr, k, netId) {
  const c = cntArr[k];
  if (c === 0) return 0;
  if (c === 1) return oneArr[k] === netId ? 0 : 1;
  const m = map.get(k);
  return m.size - (m.has(netId) ? 1 : 0);
}
// Legacy helper used by Stage 3.5 meander insertion
function addOcc(map, k, netId) {
  const sIdx = segOcc.indexOf(map);
  if (sIdx >= 0) { addOccFast(map, segCnt[sIdx], segOne[sIdx], k, netId); return; }
  let m = map.get(k);
  if (!m) { m = new Map(); map.set(k, m); }
  m.set(netId, (m.get(netId) || 0) + 1);
}

const VZ_LAYERS = [[0, 1], [1, 2, 3, 4], [4, 5]];

function commitNetPF(netObj) {
  const nid = netObj.netId;
  for (const [s, gx, gy] of netObj.routedNodes) {
    addOccFast(segOcc[s], segCnt[s], segOne[s], cellKey(gx, gy), nid);
  }
  for (const [vz, gx, gy] of netObj.routedVias) {
    const k = cellKey(gx, gy);
    addOccFast(viaOcc[vz], viaCnt[vz], viaOne[vz], k, nid);
    for (const s of VZ_LAYERS[vz]) {
      addOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k, nid);
      // 0.25mm buried core via (vz=1) requires 4-neighbor track keepout; 0.18mm microvias allow 0.070mm neck-down at 0.20mm!
      if (vz === 1) {
        addOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k + 1, nid);
        addOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k - 1, nid);
        addOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k + NX, nid);
        addOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k - NX, nid);
      }
    }
  }
}

function ripUpNetPF(netObj) {
  const nid = netObj.netId;
  for (const [s, gx, gy] of netObj.routedNodes) {
    delOccFast(segOcc[s], segCnt[s], segOne[s], cellKey(gx, gy), nid);
  }
  for (const [vz, gx, gy] of netObj.routedVias) {
    const k = cellKey(gx, gy);
    delOccFast(viaOcc[vz], viaCnt[vz], viaOne[vz], k, nid);
    for (const s of VZ_LAYERS[vz]) {
      delOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k, nid);
      if (vz === 1) {
        delOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k + 1, nid);
        delOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k - 1, nid);
        delOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k + NX, nid);
        delOccFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k - NX, nid);
      }
    }
  }
  netObj.routedNodes = [];
  netObj.routedVias = [];
  netObj.paths = [];
}

const OFFS_9 = [0, 1, -1, NX, -NX, NX + 1, NX - 1, -NX + 1, -NX - 1];
const OFFS_5 = [0, 1, -1, NX, -NX];
const OFFS_4 = [1, -1, NX, -NX];

function viaConflictCost(vz, k, netId, presentFac, strictZero, pendingVias) {
  const own = viaHardOwner[vz][k];
  if (own === -1 || (own !== 0 && own !== netId)) return Infinity;
  // Same-net pending vias from earlier branches of this multi-pin net (prevent hole_to_hole / co_located!)
  if (pendingVias && pendingVias.length > 0) {
    const gy = Math.floor(k / NX), gx = k - gy * NX;
    for (let i = 0; i < pendingVias.length; i++) {
      const [pvz, pgx, pgy] = pendingVias[i];
      if (!VZ_OVERLAP[vz].includes(pvz)) continue;
      const adx = Math.abs(gx - pgx), ady = Math.abs(gy - pgy);
      if (adx === 0 && ady === 0 && pvz === vz) continue; // Reusing identical via is legal
      if (adx + ady <= 1) return Infinity; // Co-located diff-span or 0.20mm apart -> illegal hole_to_hole!
    }
  }
  let occ = 0;
  const ovzList = VZ_OVERLAP[vz];
  for (let i = 0; i < ovzList.length; i++) {
    const ovz = ovzList[i];
    // 0.10/0.20mm buried vias & 0.08/0.18mm microvias are BOTH DRC-legal at diagonal 0.283mm (0.083/0.093mm pad gap, 0.183/0.193mm drill gap)!
    const offs = OFFS_5;
    const vc = viaCnt[ovz], vo = viaOne[ovz];
    for (let j = 0; j < offs.length; j++) {
      const nk = k + offs[j];
      const c = vc[nk];
      if (c === 0) continue;
      if (j === 0 && ovz === vz && c === 1 && vo[nk] === netId) continue;
      occ += c;
    }
  }
  const sLayers = VZ_LAYERS[vz];
  for (let i = 0; i < sLayers.length; i++) {
    const s = sLayers[i];
    occ += otherCountFast(segOcc[s], segCnt[s], segOne[s], k, netId);
    if (vz === 1) {
      occ += otherCountFast(segOcc[s], segCnt[s], segOne[s], k + 1, netId);
      occ += otherCountFast(segOcc[s], segCnt[s], segOne[s], k - 1, netId);
      occ += otherCountFast(segOcc[s], segCnt[s], segOne[s], k + NX, netId);
      occ += otherCountFast(segOcc[s], segCnt[s], segOne[s], k - NX, netId);
    }
  }
  if (strictZero && occ > 0) return Infinity;
  const h = viaHist[vz][k];
  return (vz === 1 ? 2.4 : 1.6) + h * 1.4 + occ * presentFac * 4.5;
}

// Pre-allocated zero-GC flat binary min-heap + A* buffers for 6-layer 3+6+3 HDI graph
const gScore = new Float32Array(NUM_SIG * STATE_STRIDE);
const cameFrom = new Int32Array(NUM_SIG * STATE_STRIDE);
const seenStamp = new Int32Array(NUM_SIG * STATE_STRIDE);
const closedStamp = new Int32Array(NUM_SIG * STATE_STRIDE);
let currentStamp = 0;

const HEAP_CAP = 1200000;
const heapF = new Float32Array(HEAP_CAP);
const heapSt = new Int32Array(HEAP_CAP);
let heapLen = 0;

function heapPush(f, st) {
  let i = heapLen++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= f) break;
    heapF[i] = heapF[p];
    heapSt[i] = heapSt[p];
    i = p;
  }
  heapF[i] = f;
  heapSt[i] = st;
}
function heapPopSt() {
  const topSt = heapSt[0];
  const lastF = heapF[--heapLen];
  const lastSt = heapSt[heapLen];
  if (heapLen > 0) {
    let i = 0;
    const half = heapLen >> 1;
    while (i < half) {
      let c = (i << 1) + 1;
      const r = c + 1;
      if (r < heapLen && heapF[r] < heapF[c]) c = r;
      if (lastF <= heapF[c]) break;
      heapF[i] = heapF[c];
      heapSt[i] = heapSt[c];
      i = c;
    }
    heapF[i] = lastF;
    heapSt[i] = lastSt;
  }
  return topSt;
}

// Allowed signal layer transitions from layer s: [ [nextS, viaZone], ... ]
const TRANSITIONS = [
  [[1, 0]],                           // s=0 (In2) -> s=1 (In3) via uVia In2-In3 (vz=0)
  [[0, 0], [2, 1], [3, 1], [4, 1]],   // s=1 (In3) -> In2 (uVia) or In5/In6/In8 (buried core vz=1)
  [[1, 1], [3, 1], [4, 1]],           // s=2 (In5) -> In3/In6/In8 (buried core vz=1)
  [[1, 1], [2, 1], [4, 1]],           // s=3 (In6) -> In3/In5/In8 (buried core vz=1)
  [[1, 1], [2, 1], [3, 1], [5, 2]],   // s=4 (In8) -> In3/In5/In6 (buried core) or In9 (uVia vz=2)
  [[4, 2]],                           // s=5 (In9) -> In8 (uVia vz=2)
];

// Check if taking via (vz at curGx,curGy) would violate hole_to_hole/co_located with an earlier via on the SAME A* path!
function pathHasNearbyVia(curSt, vz, curGx, curGy) {
  let t = curSt;
  for (let hops = 0; hops < 6 && t !== -1; hops++) {
    const prev = cameFrom[t];
    if (prev === -1) break;
    const sA = Math.floor(prev / STATE_STRIDE);
    const sB = Math.floor(t / STATE_STRIDE);
    if (sA !== sB) {
      const k = t - sB * STATE_STRIDE;
      const gy = Math.floor(k / NX), gx = k - gy * NX;
      const tr = TRANSITIONS[sA].find(([ns]) => ns === sB);
      const pvz = tr[1];
      if (VZ_OVERLAP[vz].includes(pvz)) {
        const adx = Math.abs(curGx - gx), ady = Math.abs(curGy - gy);
        if (adx + ady <= 1) return true;
      }
    }
    t = prev;
  }
  return false;
}

const DDR_GY_MIN = yToGy(11.0);
const DDR_GY_MAX = yToGy(39.0);

function routePairHDI(netId, startS, startGx, startGy, targetStates, goalS, goalGx, goalGy, presentFac, strictZero, pendingVias, isDdr = false, maxPops = 280000, hWOverride = 0) {
  currentStamp++;
  const st0 = startS * STATE_STRIDE + cellKey(startGx, startGy);
  if (targetStates.has(st0)) return { states: [st0], vias: [] };

  const hW = hWOverride || (strictZero ? 1.25 : 1.62);
  heapLen = 0;
  seenStamp[st0] = currentStamp;
  gScore[st0] = 0;
  cameFrom[st0] = -1;
  heapPush((Math.abs(startGx - goalGx) + Math.abs(startGy - goalGy)) * hW, st0);

  let pops = 0;
  while (heapLen > 0 && pops < maxPops) {
    const curSt = heapPopSt();
    if (closedStamp[curSt] === currentStamp) continue;
    closedStamp[curSt] = currentStamp;
    pops++;
    if (targetStates.has(curSt)) {
      const states = [], vias = [];
      let t = curSt;
      while (t !== -1) {
        states.push(t);
        const prev = cameFrom[t];
        if (prev !== -1) {
          const sA = Math.floor(prev / STATE_STRIDE);
          const sB = Math.floor(t / STATE_STRIDE);
          if (sA !== sB) {
            const k = t - sB * STATE_STRIDE;
            const gy = Math.floor(k / NX), gx = k - gy * NX;
            const tr = TRANSITIONS[sA].find(([ns]) => ns === sB);
            vias.push([tr[1], gx, gy]);
          }
        }
        t = prev;
      }
      states.reverse();
      return { states, vias };
    }

    const curS = Math.floor(curSt / STATE_STRIDE);
    const curK = curSt - curS * STATE_STRIDE;
    const curGy = Math.floor(curK / NX);
    const curGx = curK - curGy * NX;
    const cg = gScore[curSt];
    const prefDir = SIG_PREF_DIR[curS];
    const curSOff = curS * STATE_STRIDE;
    const curSegOcc = segOcc[curS], curSegCnt = segCnt[curS], curSegOne = segOne[curS];
    const curVkOcc = viaKeepoutOcc[curS], curVkCnt = vkCnt[curS], curVkOne = vkOne[curS];
    const curSegHist = segHist[curS];
    const curHaloCnt = termHaloCnt[curS], curHaloOwn = termHaloOwner[curS];

    // 1. Planar moves on same signal layer curS
    for (let dir = 0; dir < 4; dir++) {
      const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
      const dy = dir === 2 ? 1 : dir === 3 ? -1 : 0;
      const ngx = curGx + dx, ngy = curGy + dy;
      if (!isTrackCellHardLegal(curS, ngx, ngy, netId)) continue;
      const nk = ngy * NX + ngx;
      const nst = curSOff + nk;
      if (closedStamp[nst] === currentStamp) continue;
      const occ = otherCountFast(curSegOcc, curSegCnt, curSegOne, nk, netId)
                + otherCountFast(curVkOcc, curVkCnt, curVkOne, nk, netId);
      if (strictZero && occ > 0) continue;

      const isHoriz = dx !== 0;
      const wrongWay = (isHoriz && prefDir === 1) || (!isHoriz && prefDir === 0);
      const haloPen = (curHaloCnt[nk] > 0 && curHaloOwn[nk] !== netId) ? 2.2 : 0;
      const ddrDetour = (isDdr && (ngy < DDR_GY_MIN || ngy > DDR_GY_MAX)) ? 6.0 : 0;
      const stepCost = (wrongWay ? 1.35 : 1.0) + haloPen + ddrDetour + curSegHist[nk] * 1.45 + occ * presentFac * 3.5;
      const ng = cg + stepCost;
      if (seenStamp[nst] !== currentStamp || ng < gScore[nst]) {
        seenStamp[nst] = currentStamp;
        gScore[nst] = ng;
        cameFrom[nst] = curSt;
        const h = (Math.abs(ngx - goalGx) + Math.abs(ngy - goalGy)) * hW;
        if (heapLen < HEAP_CAP - 1) heapPush(ng + h, nst);
      }
    }

    // 2. Vertical HDI via transitions (laser microvia or buried core via)
    const trans = TRANSITIONS[curS];
    for (let ti = 0; ti < trans.length; ti++) {
      const ns = trans[ti][0], vz = trans[ti][1];
      const nst = ns * STATE_STRIDE + curK;
      if (closedStamp[nst] === currentStamp) continue;
      const vc = viaConflictCost(vz, curK, netId, presentFac, strictZero, pendingVias);
      if (vc === Infinity) continue;
      if (!isTrackCellHardLegal(ns, curGx, curGy, netId)) continue;
      if (pathHasNearbyVia(curSt, vz, curGx, curGy)) continue;
      const ng = cg + vc;
      if (seenStamp[nst] !== currentStamp || ng < gScore[nst]) {
        seenStamp[nst] = currentStamp;
        gScore[nst] = ng;
        cameFrom[nst] = curSt;
        const h = (Math.abs(curGx - goalGx) + Math.abs(curGy - goalGy)) * hW;
        if (heapLen < HEAP_CAP - 1) heapPush(ng + h, nst);
      }
    }
  }
  return null;
}

function routeSingleNetHDI(netObj, presentFac, strictZero = false) {
  const terms = netObj.terminals;
  const isDdr = netObj.netName.startsWith('LPDDR5X_');
  const treeStates = new Set([terms[0].sLayer * STATE_STRIDE + cellKey(terms[0].gx, terms[0].gy)]);
  const remaining = terms.slice(1);
  const allNodes = [[terms[0].sLayer, terms[0].gx, terms[0].gy]];
  const allNetVias = [];
  const paths = [];
  let sumX = terms[0].gx, sumY = terms[0].gy, cnt = 1;

  while (remaining.length > 0) {
    let bestIdx = 0, bestD = Infinity;
    const cx = sumX / cnt, cy = sumY / cnt;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.abs(remaining[i].gx - cx) + Math.abs(remaining[i].gy - cy);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    const term = remaining.splice(bestIdx, 1)[0];
    let goalS = terms[0].sLayer, goalGx = terms[0].gx, goalGy = terms[0].gy, gd = Infinity;
    for (const [ts, tgx, tgy] of allNodes) {
      const d = Math.abs(term.gx - tgx) + Math.abs(term.gy - tgy);
      if (d < gd) { gd = d; goalS = ts; goalGx = tgx; goalGy = tgy; }
    }
    let res = routePairHDI(netObj.netId, term.sLayer, term.gx, term.gy, treeStates, goalS, goalGx, goalGy, presentFac, strictZero, allNetVias, isDdr, strictZero ? 320000 : 280000);
    if (!res) {
      res = routePairHDI(netObj.netId, term.sLayer, term.gx, term.gy, treeStates, goalS, goalGx, goalGy, presentFac, strictZero, allNetVias, false, 600000, strictZero ? 1.15 : 3.2);
    }
    if (!res) return false;
    paths.push(res.states);
    for (const st of res.states) {
      if (!treeStates.has(st)) {
        treeStates.add(st);
        const s = Math.floor(st / STATE_STRIDE), k = st - s * STATE_STRIDE;
        const gy = Math.floor(k / NX), gx = k - gy * NX;
        allNodes.push([s, gx, gy]);
        sumX += gx; sumY += gy; cnt++;
      }
    }
    for (const v of res.vias) allNetVias.push(v);
  }
  netObj.routedNodes = allNodes;
  netObj.routedVias = allNetVias;
  netObj.paths = paths;
  commitNetPF(netObj);
  return true;
}

function netHasConflictHDI(netObj) {
  const nid = netObj.netId;
  for (const [s, gx, gy] of netObj.routedNodes) {
    const k = cellKey(gx, gy);
    if (otherCountFast(segOcc[s], segCnt[s], segOne[s], k, nid) > 0) return true;
    if (otherCountFast(viaKeepoutOcc[s], vkCnt[s], vkOne[s], k, nid) > 0) return true;
  }
  for (const [vz, gx, gy] of netObj.routedVias) {
    const k = cellKey(gx, gy);
    for (const s of VZ_LAYERS[vz]) {
      if (otherCountFast(segOcc[s], segCnt[s], segOne[s], k, nid) > 0) return true;
      if (vz === 1) {
        if (otherCountFast(segOcc[s], segCnt[s], segOne[s], k + 1, nid) > 0) return true;
        if (otherCountFast(segOcc[s], segCnt[s], segOne[s], k - 1, nid) > 0) return true;
        if (otherCountFast(segOcc[s], segCnt[s], segOne[s], k + NX, nid) > 0) return true;
        if (otherCountFast(segOcc[s], segCnt[s], segOne[s], k - NX, nid) > 0) return true;
      }
    }
    for (const ovz of VZ_OVERLAP[vz]) {
      const offs = OFFS_5;
      const vc = viaCnt[ovz], vo = viaOne[ovz];
      for (let j = 0; j < offs.length; j++) {
        const nk = k + offs[j];
        const c = vc[nk];
        if (c === 0) continue;
        if (j === 0 && ovz === vz && c === 1 && vo[nk] === nid) continue;
        return true;
      }
    }
  }
  return false;
}

function updateHistoryAndCountConflicts() {
  let segConf = 0, viaConf = 0;
  for (let s = 0; s < NUM_SIG; s++) {
    const sc = segCnt[s], so = segOne[s], vc = vkCnt[s], vo = vkOne[s];
    for (const [k, m] of segOcc[s].entries()) {
      let extra = m.size > 1 ? (m.size - 1) : 0;
      if (vc[k] > 0) {
        if (m.size === 1 && vc[k] === 1 && so[k] === vo[k]) {
          // Same net track touching its own via keepout -> legal
        } else {
          extra += vc[k];
        }
      }
      if (extra > 0) {
        segConf++;
        segHist[s][k] = Math.min(900, segHist[s][k] + 2.2 * extra);
      }
    }
  }
  for (let vz = 0; vz < 3; vz++) {
    for (const [k, m] of viaOcc[vz].entries()) {
      let adjConf = m.size > 1 ? (m.size - 1) : 0;
      const singleNid = m.size === 1 ? m.keys().next().value : -1;
      for (const ovz of VZ_OVERLAP[vz]) {
        const offs = OFFS_5;
        const vc = viaCnt[ovz], vo = viaOne[ovz];
        for (let j = 0; j < offs.length; j++) {
          if (j === 0 && ovz === vz) continue;
          const nk = k + offs[j];
          const c = vc[nk];
          if (c === 0) continue;
          adjConf += c;
        }
      }
      for (const s of VZ_LAYERS[vz]) {
        if (singleNid > 0) {
          adjConf += otherCountFast(segOcc[s], segCnt[s], segOne[s], k, singleNid);
          if (vz === 1) {
            adjConf += otherCountFast(segOcc[s], segCnt[s], segOne[s], k + 1, singleNid);
            adjConf += otherCountFast(segOcc[s], segCnt[s], segOne[s], k - 1, singleNid);
            adjConf += otherCountFast(segOcc[s], segCnt[s], segOne[s], k + NX, singleNid);
            adjConf += otherCountFast(segOcc[s], segCnt[s], segOne[s], k - NX, singleNid);
          }
        } else {
          if (segCnt[s][k] > 0) adjConf += segCnt[s][k];
        }
      }
      if (adjConf > 0) {
        viaConf++;
        viaHist[vz][k] = Math.min(900, viaHist[vz][k] + 3.6 * adjConf);
      }
    }
  }
  return { segConf, viaConf, total: segConf + viaConf };
}

// Route high-speed LPDDR5X & short 2-pin nets first, then buses/power!
netListToRoute.sort((a, b) => {
  const aDdr = a.netName.startsWith('LPDDR5X_') ? 0 : 1;
  const bDdr = b.netName.startsWith('LPDDR5X_') ? 0 : 1;
  if (aDdr !== bDdr) return aDdr - bDdr;
  return a.terminals.length - b.terminals.length;
});
const netById = new Map(netListToRoute.map((n) => [n.netId, n]));

function collectBlockingNeighbors(conflictNets) {
  const neighbors = new Set();
  for (const cn of conflictNets) {
    for (const [s, gx, gy] of cn.routedNodes) {
      const k = cellKey(gx, gy);
      const m = segOcc[s].get(k);
      if (m) for (const oid of m.keys()) if (oid !== cn.netId) neighbors.add(oid);
      const vm = viaKeepoutOcc[s].get(k);
      if (vm) for (const oid of vm.keys()) if (oid !== cn.netId) neighbors.add(oid);
    }
    for (const [vz, gx, gy] of cn.routedVias) {
      const k = cellKey(gx, gy);
      for (const ovz of VZ_OVERLAP[vz]) {
        for (const d of OFFS_5) {
          const m = viaOcc[ovz].get(k + d);
          if (m) for (const oid of m.keys()) if (oid !== cn.netId) neighbors.add(oid);
        }
      }
      for (const s of VZ_LAYERS[vz]) {
        for (const d of (vz === 1 ? OFFS_5 : [0])) {
          const m = segOcc[s].get(k + d);
          if (m) for (const oid of m.keys()) if (oid !== cn.netId) neighbors.add(oid);
        }
      }
    }
    // Also grab nets immediately adjacent to terminals of any failed/unrouted net!
    if (cn.routedNodes.length === 0) {
      for (const tm of cn.terminals) {
        for (let rad = 1; rad <= 3; rad++) {
          for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
            const nk = cellKey(tm.gx + dx, tm.gy + dy);
            const m = segOcc[tm.sLayer].get(nk);
            if (m) for (const oid of m.keys()) if (oid !== cn.netId) neighbors.add(oid);
            const vm = viaKeepoutOcc[tm.sLayer].get(nk);
            if (vm) for (const oid of vm.keys()) if (oid !== cn.netId) neighbors.add(oid);
          }
        }
      }
    }
  }
  return neighbors;
}

const MAX_ITERS = 75;
let failedNets = [];
for (let iter = 1; iter <= MAX_ITERS; iter++) {
  const tIt = Date.now();
  const presentFac = Math.min(110, 2.0 * Math.pow(1.18, iter - 1));
  failedNets = [];
  let rerouted = 0;
  for (const netObj of netListToRoute) {
    if (iter === 1 || netObj.routedNodes.length === 0 || netHasConflictHDI(netObj)) {
      ripUpNetPF(netObj);
      const ok = routeSingleNetHDI(netObj, presentFac, false);
      if (!ok) failedNets.push(netObj);
      rerouted++;
    }
  }
  const conf = updateHistoryAndCountConflicts();
  const conflictNets = netListToRoute.filter((n) => n.routedNodes.length === 0 || netHasConflictHDI(n));
  console.log(`  PF iter ${String(iter).padStart(2)}: rerouted=${rerouted}, segConf=${conf.segConf}, viaConf=${conf.viaConf}, conflictNets=${conflictNets.length}, failed=${failedNets.length} (${((Date.now() - tIt) / 1000).toFixed(1)}s)`);
  if (conf.total === 0 && conflictNets.length === 0 && failedNets.length === 0) {
    console.log(`  >>> CONVERGED TO ZERO CONFLICTS IN ${iter} ITERATIONS (${((Date.now() - t3) / 1000).toFixed(2)}s)!`);
    break;
  }
  // Active Stall Unlock: rip up blocking neighbor nets around stalled conflict nets!
  if (iter >= 16 && iter % 4 === 0 && conflictNets.length > 0 && conflictNets.length <= 120) {
    const neighbors = collectBlockingNeighbors(conflictNets);
    for (const oid of neighbors) {
      const nb = netById.get(oid);
      if (nb) { ripUpNetPF(nb); routeSingleNetHDI(nb, presentFac * 1.3, false); }
    }
  }
}

// Multi-pass strict zero-conflict finish + Guided Exact-Blocker Push-and-Shove + Subset Mini-PathFinder!
for (const netObj of netListToRoute) {
  if (netObj.routedNodes.length === 0 || netHasConflictHDI(netObj)) {
    ripUpNetPF(netObj);
  }
}
const pendingStrict = netListToRoute.filter((n) => n.routedNodes.length === 0);
pendingStrict.sort((a, b) => {
  const ad = a.netName.startsWith('LPDDR5X_') ? 0 : 1;
  const bd = b.netName.startsWith('LPDDR5X_') ? 0 : 1;
  if (ad !== bd) return ad - bd;
  return a.terminals.length - b.terminals.length;
});
for (const netObj of pendingStrict) {
  routeSingleNetHDI(netObj, 110.0, true);
}

function findExactPathBlockers(unNet, pf = 120.0) {
  if (!routeSingleNetHDI(unNet, pf, false)) return [];
  const blockers = [...collectBlockingNeighbors([unNet])]
    .map((oid) => netById.get(oid))
    .filter((nb) => nb && nb.routedNodes.length > 0 && nb.netId !== unNet.netId);
  ripUpNetPF(unNet);
  blockers.sort((a, b) => a.terminals.length - b.terminals.length);
  return blockers;
}

function tryDisplaceAndRoute(unNet, victimList, allowDepth2 = true) {
  const allSnaps = new Map();
  const snapNet = (nb) => {
    if (!allSnaps.has(nb.netId)) {
      allSnaps.set(nb.netId, { nb, nodes: nb.routedNodes.slice(), vias: nb.routedVias.slice(), paths: nb.paths.slice() });
    }
  };
  for (const nb of victimList) snapNet(nb);
  for (const nb of victimList) ripUpNetPF(nb);

  let success = false;
  if (routeSingleNetHDI(unNet, 110.0, true)) {
    const failedVictims = [];
    for (const nb of victimList) {
      if (!routeSingleNetHDI(nb, 110.0, true)) failedVictims.push(nb);
    }
    if (failedVictims.length === 0) {
      success = true;
    } else if (allowDepth2 && failedVictims.length <= 2) {
      let d2Ok = true;
      for (const fv of failedVictims) {
        const subBlockers = findExactPathBlockers(fv, 140.0)
          .filter((sb) => sb.netId !== unNet.netId && !allSnaps.has(sb.netId) && sb.terminals.length <= 8)
          .slice(0, 4);
        if (subBlockers.length === 0) { d2Ok = false; break; }
        for (const sb of subBlockers) { snapNet(sb); ripUpNetPF(sb); }
        if (!routeSingleNetHDI(fv, 110.0, true)) { d2Ok = false; break; }
        for (const sb of subBlockers) {
          if (!routeSingleNetHDI(sb, 110.0, true)) { d2Ok = false; break; }
        }
        if (!d2Ok) break;
      }
      if (d2Ok) success = true;
    }
  }
  if (success) return true;
  ripUpNetPF(unNet);
  for (const { nb } of allSnaps.values()) ripUpNetPF(nb);
  for (const { nb, nodes, vias, paths } of allSnaps.values()) {
    nb.routedNodes = nodes; nb.routedVias = vias; nb.paths = paths;
    commitNetPF(nb);
  }
  return false;
}

for (let round = 1; round <= 8; round++) {
  const stillUn = netListToRoute.filter((n) => n.routedNodes.length === 0);
  if (stillUn.length === 0) break;
  let recovered = 0;
  for (const unNet of stillUn) {
    if (routeSingleNetHDI(unNet, 110.0, true)) { recovered++; continue; }
    const exactBlockers = findExactPathBlockers(unNet, 90.0 + round * 20).filter((nb) => nb.terminals.length <= 16);
    const termBlockers = [...collectBlockingNeighbors([unNet])]
      .map((oid) => netById.get(oid))
      .filter((nb) => nb && nb.routedNodes.length > 0 && nb.terminals.length <= 14);
    let done = false;
    if (exactBlockers.length > 0 && exactBlockers.length <= 12) {
      if (tryDisplaceAndRoute(unNet, exactBlockers, true)) done = true;
    }
    for (let i = 0; i < Math.min(6, exactBlockers.length) && !done; i++) {
      if (tryDisplaceAndRoute(unNet, [exactBlockers[i]], true)) done = true;
    }
    for (let i = 0; i < Math.min(4, exactBlockers.length) && !done; i++) {
      for (let j = i + 1; j < Math.min(5, exactBlockers.length) && !done; j++) {
        if (tryDisplaceAndRoute(unNet, [exactBlockers[i], exactBlockers[j]], true)) done = true;
      }
    }
    for (let i = 0; i < Math.min(5, termBlockers.length) && !done; i++) {
      if (tryDisplaceAndRoute(unNet, [termBlockers[i]], true)) done = true;
    }
    if (done) recovered++;
  }
  console.log(`  Guided R&R round ${round}: recovered=${recovered}, remainingUnrouted=${netListToRoute.filter((n) => n.routedNodes.length === 0).length}`);
  if (recovered === 0) break;
}

let finalUnrouted = 0;
for (const netObj of netListToRoute) {
  if (netObj.routedNodes.length === 0 || netHasConflictHDI(netObj)) {
    ripUpNetPF(netObj);
    finalUnrouted++;
    console.warn(`  [UNROUTED] ${netObj.netName} (${netObj.terminals.length} terminals)`);
  }
}
console.log(`Stage 3 Complete: routed=${netListToRoute.length - finalUnrouted}/${netListToRoute.length} (unrouted=${finalUnrouted}) in ${((Date.now() - t3) / 1000).toFixed(2)}s`);

// ============================================================================
// 8. STAGE 3.5 (PHASE 3) — TRUE PHYSICAL SERPENTINE MEANDER LENGTH MATCHING!
// ============================================================================
const t35 = Date.now();

// Convert each routed net's state paths into clean compressed Manhattan polylines per layer
function extractNetPolylines(netObj) {
  // Each path is a sequence of states (s, gx, gy)
  const runs = []; // { s, pts: [[gx, gy], ...] }
  for (const stPath of (netObj.paths || [])) {
    let cur = null;
    for (const st of stPath) {
      const s = Math.floor(st / STATE_STRIDE), k = st % STATE_STRIDE;
      const gx = k % NX, gy = Math.floor(k / NX);
      if (!cur || cur.s !== s) {
        if (cur && cur.pts.length >= 2) runs.push(cur);
        cur = { s, pts: [[gx, gy]] };
      } else {
        const prev = cur.pts[cur.pts.length - 1];
        if (prev[0] !== gx || prev[1] !== gy) cur.pts.push([gx, gy]);
      }
    }
    if (cur && cur.pts.length >= 2) runs.push(cur);
  }
  return runs;
}

function measureNetLengthMm(netObj) {
  let len = 0;
  // 1. Inner copper polylines
  for (const run of netObj.polylines) {
    for (let i = 1; i < run.pts.length; i++) {
      len += Math.hypot(run.pts[i][0] - run.pts[i - 1][0], run.pts[i][1] - run.pts[i - 1][1]) * GRID;
    }
  }
  // 2. Fanout dogbone lengths (surface + stacked microvia Z-barrel height)
  for (const tm of netObj.terminals) {
    len += Math.hypot(tm.x - tm.padX, tm.y - tm.padY);
    const zLand = LAYER_Z[SIG_LAYERS[tm.sLayer]];
    len += tm.side === 'top' ? (zLand - LAYER_Z['F.Cu']) : (LAYER_Z['B.Cu'] - zLand);
  }
  // 3. Dynamic inner via Z-barrel heights
  for (const [vz] of netObj.routedVias) {
    len += vz === 0 ? (LAYER_Z['In3.Cu'] - LAYER_Z['In2.Cu'])
         : vz === 1 ? (LAYER_Z['In8.Cu'] - LAYER_Z['In3.Cu'])
         :            (LAYER_Z['In9.Cu'] - LAYER_Z['In8.Cu']);
  }
  return len;
}

for (const netObj of netListToRoute) {
  netObj.polylines = extractNetPolylines(netObj);
}

// Check if a cell (s, gx, gy) is completely free for inserting a serpentine meander bump of netId
function isCellFreeForMeander(s, gx, gy, netId) {
  if (!isTrackCellHardLegal(s, gx, gy, netId)) return false;
  const k = cellKey(gx, gy);
  if (segCnt[s][k] > 0 || vkCnt[s][k] > 0) return false; // Completely unoccupied (no tracks or dynamic via keepouts!)
  // Also ensure not orthogonally touching any dynamic microvia on layer s (avoid unnecessary neck-down on meanders)
  for (let vz = 0; vz < 3; vz++) {
    if (!VZ_LAYERS[vz].includes(s)) continue;
    for (const d of OFFS_5) {
      if (viaCnt[vz][k + d] > 0) return false;
    }
  }
  return true;
}

// Insert real DRC-verified orthogonal serpentine trombone bumps into netObj to add targetDeltaMm
function tuneNetWithMeanders(netObj, targetDeltaMm) {
  let addedMm = 0;
  let bumpsAdded = 0;
  const nid = netObj.netId;

  // Record every terminal, dynamic via, and polyline endpoint on this net so U-trombones NEVER skip over a T-junction or via!
  const protectedStates = new Set();
  for (const tm of netObj.terminals) protectedStates.add(tm.sLayer * STATE_STRIDE + cellKey(tm.gx, tm.gy));
  for (const [vz, gx, gy] of netObj.routedVias) {
    const k = cellKey(gx, gy);
    for (const vs of VZ_LAYERS[vz]) protectedStates.add(vs * STATE_STRIDE + k);
  }
  for (const r of netObj.polylines) {
    if (r.pts.length >= 2) {
      const p0 = r.pts[0], p1 = r.pts[r.pts.length - 1];
      protectedStates.add(r.s * STATE_STRIDE + cellKey(p0[0], p0[1]));
      protectedStates.add(r.s * STATE_STRIDE + cellKey(p1[0], p1[1]));
    }
  }

  // Stage A: Wide bw=2 (0.40mm pitch, minimal self-coupling); Stage B: Compact bw=1 (0.20mm pitch, 0.076mm gap >= 0.070mm DRC)
  const stages = [
    { bw: 2, gap: 2, maxAmp: 16, passes: 4 },
    { bw: 1, gap: 1, maxAmp: 14, passes: 3 },
  ];
  for (const st of stages) {
    for (let pass = 0; pass < st.passes && targetDeltaMm - addedMm >= 0.35; pass++) {
      for (const run of netObj.polylines) {
        if (targetDeltaMm - addedMm < 0.35) break;
        const s = run.s;
        const sOff = s * STATE_STRIDE;
        const newPts = [run.pts[0]];
        let i = 0;
        while (i < run.pts.length - 1) {
          const [x0, y0] = run.pts[i];
          let j = i + 1;
          const dx0 = Math.sign(run.pts[j][0] - x0), dy0 = Math.sign(run.pts[j][1] - y0);
          while (j + 1 < run.pts.length &&
                 Math.sign(run.pts[j + 1][0] - run.pts[j][0]) === dx0 &&
                 Math.sign(run.pts[j + 1][1] - run.pts[j][1]) === dy0) {
            j++;
          }
          const [xEnd, yEnd] = run.pts[j];
          const segLenCells = Math.abs(xEnd - x0) + Math.abs(yEnd - y0);

          if (segLenCells >= st.bw + 2 && targetDeltaMm - addedMm >= 0.35 && ((dx0 !== 0) !== (dy0 !== 0))) {
            let cursor = 1;
            while (cursor + st.bw + 1 <= segLenCells && targetDeltaMm - addedMm >= 0.35) {
              // Ensure interior cells of bridged base [cursor..cursor+bw] contain NO T-junction/via/terminal!
              let baseProtected = false;
              for (let u = 0; u <= st.bw; u++) {
                if (protectedStates.has(sOff + cellKey(x0 + (cursor + u) * dx0, y0 + (cursor + u) * dy0))) {
                  baseProtected = true; break;
                }
              }
              if (baseProtected) { cursor += 1; continue; }

              const remMm = targetDeltaMm - addedMm;
              const maxAmpWanted = Math.min(st.maxAmp, Math.floor(remMm / (2 * GRID)));
              if (maxAmpWanted < 1) break;
              let bestSide = 0, bestAmp = 0;
              for (const sideSign of [1, -1]) {
                const px = -dy0 * sideSign, py = dx0 * sideSign;
                let amp = 0;
                for (let a = 1; a <= maxAmpWanted; a++) {
                  let rowOk = true;
                  for (let u = 0; u <= st.bw; u++) {
                    const cx = x0 + (cursor + u) * dx0 + a * px;
                    const cy = y0 + (cursor + u) * dy0 + a * py;
                    if (!isCellFreeForMeander(s, cx, cy, nid)) { rowOk = false; break; }
                  }
                  if (!rowOk) break;
                  amp = a;
                }
                if (amp > bestAmp) { bestAmp = amp; bestSide = sideSign; }
              }
              if (bestAmp >= 1) {
                const px = -dy0 * bestSide, py = dx0 * bestSide;
                const bx = x0 + cursor * dx0, by = y0 + cursor * dy0;
                const ex = bx + st.bw * dx0, ey = by + st.bw * dy0;
                for (let a = 1; a <= bestAmp; a++) {
                  addOcc(segOcc[s], cellKey(bx + a * px, by + a * py), nid);
                  addOcc(segOcc[s], cellKey(ex + a * px, ey + a * py), nid);
                }
                for (let u = 1; u < st.bw; u++) {
                  addOcc(segOcc[s], cellKey(bx + u * dx0 + bestAmp * px, by + u * dy0 + bestAmp * py), nid);
                }
                newPts.push([bx, by]);
                newPts.push([bx + bestAmp * px, by + bestAmp * py]);
                newPts.push([ex + bestAmp * px, ey + bestAmp * py]);
                newPts.push([ex, ey]);
                addedMm += 2 * bestAmp * GRID;
                bumpsAdded++;
                cursor += st.bw + st.gap;
              } else {
                cursor += 1;
              }
            }
          }
          newPts.push([xEnd, yEnd]);
          i = j;
        }
        run.pts = newPts;
      }
    }
  }
  return { addedMm, bumpsAdded };
}

// Build ALL 16 LPDDR5X Length-Matching Groups + eMMC + High-Speed Diff Pairs!
const netObjByName = new Map(netListToRoute.map((n) => [n.netName, n]));
const matchGroups = [];
for (const ch of ['CH0A', 'CH0B', 'CH1C', 'CH1D']) {
  const byte0 = [...Array(8).keys()].map((b) => `LPDDR5X_${ch}_DQ${b}`)
    .concat([`LPDDR5X_${ch}_DMI0`, `LPDDR5X_${ch}_RDQS0_P`, `LPDDR5X_${ch}_RDQS0_N`, `LPDDR5X_${ch}_WCK0_P`, `LPDDR5X_${ch}_WCK0_N`]);
  const byte1 = [...Array(8).keys()].map((b) => `LPDDR5X_${ch}_DQ${b + 8}`)
    .concat([`LPDDR5X_${ch}_DMI1`, `LPDDR5X_${ch}_RDQS1_P`, `LPDDR5X_${ch}_RDQS1_N`, `LPDDR5X_${ch}_WCK1_P`, `LPDDR5X_${ch}_WCK1_N`]);
  const caCk = [...Array(7).keys()].map((b) => `LPDDR5X_${ch}_CA${b}`)
    .concat([`LPDDR5X_${ch}_CS0`, `LPDDR5X_${ch}_CS1`, `LPDDR5X_${ch}_CK_P`, `LPDDR5X_${ch}_CK_N`]);
  matchGroups.push({ name: `LPDDR5X_${ch}_BYTE0_WCK0`, type: 'LPDDR5X-Byte', nets: byte0 });
  matchGroups.push({ name: `LPDDR5X_${ch}_BYTE1_WCK1`, type: 'LPDDR5X-Byte', nets: byte1 });
  matchGroups.push({ name: `LPDDR5X_${ch}_CA_CK`,      type: 'LPDDR5X-CA',   nets: caCk });
}
// eMMC 5.1 HS400 Group
matchGroups.push({
  name: 'EMMC51_HS400_BUS', type: 'eMMC-5.1',
  nets: ['EMMC_D0','EMMC_D1','EMMC_D2','EMMC_D3','EMMC_D4','EMMC_D5','EMMC_D6','EMMC_D7','EMMC_CMD','EMMC_DATA_STROBE','EMMC_CLK_SOC','EMMC_CLK_LINE'],
});
// High-Speed Differential Intra-Pair Groups (MIPI CSI/DSI, USB3, PCIe)
for (const netObj of netListToRoute) {
  if (netObj.netName.endsWith('_P') && !netObj.netName.startsWith('LPDDR5X_')) {
    const base = netObj.netName.slice(0, -2);
    if (netObjByName.has(`${base}_N`) && /^(MIPI_|USB3_|USBC_|PCIE_)/.test(base)) {
      matchGroups.push({ name: `DIFF_${base}`, type: 'HS-DiffPair', nets: [`${base}_P`, `${base}_N`] });
    }
  }
}

const lengthReport = {
  stackup: '12-Layer 0.800mm 3+6+3 HDI (TU-872SLK / S1000-2M Er=3.70, t_in=15um)',
  propagationDelayPsPerMm: +TPD_PS_PER_MM.toFixed(3),
  netclasses: NETCLASS_SPECS,
  groups: [],
};

let totalMeanderBumps = 0;
for (const grp of matchGroups) {
  const objs = grp.nets.map((n) => netObjByName.get(n)).filter(Boolean);
  if (objs.length < 2) continue;
  const routedObjs = objs.filter((o) => o.routedNodes.length > 0);
  const unroutedNames = objs.filter((o) => o.routedNodes.length === 0).map((o) => o.netName);
  if (routedObjs.length < 2) continue;
  const beforeLens = routedObjs.map((o) => ({ name: o.netName, len: measureNetLengthMm(o) }));
  const beforeMin = Math.min(...beforeLens.map((x) => x.len));
  const beforeMax = Math.max(...beforeLens.map((x) => x.len));
  const targetLen = beforeMax;

  let grpBumps = 0;
  for (const o of routedObjs) {
    const curLen = measureNetLengthMm(o);
    const deficit = targetLen - curLen;
    if (deficit >= 0.35) {
      const { bumpsAdded } = tuneNetWithMeanders(o, deficit);
      grpBumps += bumpsAdded;
      totalMeanderBumps += bumpsAdded;
    }
  }
  const afterLens = objs.map((o) => ({
    name: o.netName,
    routed: o.routedNodes.length > 0,
    len: +measureNetLengthMm(o).toFixed(3),
  }));
  const routedAfter = afterLens.filter((x) => x.routed);
  const afterMin = Math.min(...routedAfter.map((x) => x.len));
  const afterMax = Math.max(...routedAfter.map((x) => x.len));
  const skewMm = +(afterMax - afterMin).toFixed(3);
  const skewPs = +(skewMm * TPD_PS_PER_MM).toFixed(2);
  lengthReport.groups.push({
    group: grp.name,
    type: grp.type,
    netCount: objs.length,
    routedCount: routedObjs.length,
    unroutedNets: unroutedNames,
    beforeMinMm: +beforeMin.toFixed(3),
    beforeMaxMm: +beforeMax.toFixed(3),
    beforeSkewMm: +(beforeMax - beforeMin).toFixed(3),
    afterMinMm: +afterMin.toFixed(3),
    afterMaxMm: +afterMax.toFixed(3),
    afterSkewMm: skewMm,
    afterSkewPs: skewPs,
    meanderBumps: grpBumps,
    nets: afterLens,
  });
}
fs.writeFileSync(LM_REPORT_PATH, JSON.stringify(lengthReport, null, 2));
console.log(`Stage 3.5 (Meander Length Tuning): inserted ${totalMeanderBumps} DRC-safe serpentine bumps across ${lengthReport.groups.length} groups in ${Date.now() - t35}ms`);
for (const g of lengthReport.groups.filter((x) => x.type.startsWith('LPDDR5X') || x.type === 'eMMC-5.1')) {
  const unTag = g.unroutedNets.length ? ` [UNROUTED=${g.unroutedNets.length}]` : ' [100%]';
  console.log(`  ${g.group.padEnd(24)} (${String(g.routedCount).padStart(2)}/${String(g.netCount).padStart(2)}): ${g.beforeSkewMm.toFixed(2)}mm -> ${g.afterSkewMm.toFixed(2)}mm (${g.afterSkewPs.toFixed(1)}ps) [min=${g.afterMinMm.toFixed(2)}, max=${g.afterMaxMm.toFixed(2)}, bumps=${g.meanderBumps}]${unTag}`);
}

// ============================================================================
// 9. COMMIT ALL STAGE 3 + 3.5 ROUTES & DYNAMIC HDI VIAS TO PHYSICAL LAYERS
// ============================================================================
const emittedDynVias = new Set();
let innerSegCount = 0, neckDownSegs = 0, dynUViaCount = 0, dynBuriedCount = 0;

// First commit all dynamic HDI vias and record EVERY 0.18mm microvia per signal layer
// so segments passing at 0.200mm from a different-net 0.18mm microvia automatically apply
// Rockchip/JEDEC BGA neck-down (0.070mm -> 0.075mm >= 0.070mm clearance), while keeping
// full controlled-impedance width (0.124mm 40Ω DDR, 0.110mm 80Ω diff, etc.) everywhere else!
const allMicroViaGrid = Array.from({ length: NUM_SIG }, (_, s) => new Int32Array(fixedMicroBlock[s]));
for (const netObj of netListToRoute) {
  const nid = netObj.netId;
  for (const [vz, gx, gy] of netObj.routedVias) {
    const vk = `${vz},${gx},${gy},${nid}`;
    if (emittedDynVias.has(vk)) continue;
    emittedDynVias.add(vk);
    const x = gxToX(gx), y = gyToY(gy);
    if (vz === 0) {
      registerVia('micro', x, y, RULES.uViaDia, RULES.uViaDrill, 'In2.Cu', 'In3.Cu', nid);
      allMicroViaGrid[0][cellKey(gx, gy)] = nid;
      allMicroViaGrid[1][cellKey(gx, gy)] = nid;
      dynUViaCount++;
    } else if (vz === 1) {
      registerVia('blind', x, y, RULES.buriedDia, RULES.buriedDrill, 'In3.Cu', 'In8.Cu', nid);
      dynBuriedCount++;
    } else {
      registerVia('micro', x, y, RULES.uViaDia, RULES.uViaDrill, 'In8.Cu', 'In9.Cu', nid);
      allMicroViaGrid[4][cellKey(gx, gy)] = nid;
      allMicroViaGrid[5][cellKey(gx, gy)] = nid;
      dynUViaCount++;
    }
  }
}

function cellNearOtherMicroVia(s, gx, gy, netId) {
  const grid = allMicroViaGrid[s];
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = gx + dx, ny = gy + dy;
    if (nx < 0 || nx >= NX || ny < 0 || ny >= NY) continue;
    const mv = grid[cellKey(nx, ny)];
    if (mv !== 0 && mv !== netId) return true;
  }
  return false;
}

for (const netObj of netListToRoute) {
  const nid = netObj.netId;
  const fullW = netObj.width;
  for (const run of netObj.polylines) {
    const s = run.s;
    const layerName = SIG_LAYERS[s];
    // Expand to unit grid steps, assign local BGA neck-down (0.070mm) ONLY where adjacent to a different-net 0.18mm microvia,
    // then re-compress collinear same-width runs!
    const unitEdges = [];
    for (let i = 1; i < run.pts.length; i++) {
      let [cx, cy] = run.pts[i - 1];
      const [tx, ty] = run.pts[i];
      const sx = Math.sign(tx - cx), sy = Math.sign(ty - cy);
      while (cx !== tx || cy !== ty) {
        const nx = cx + sx, ny = cy + sy;
        const needNeck = fullW > 0.070 && (cellNearOtherMicroVia(s, cx, cy, nid) || cellNearOtherMicroVia(s, nx, ny, nid));
        const ew = needNeck ? 0.070 : fullW;
        if (needNeck) neckDownSegs++;
        const prev = unitEdges[unitEdges.length - 1];
        if (prev && prev.w === ew && prev.dx === sx && prev.dy === sy && prev.x2 === cx && prev.y2 === cy) {
          prev.x2 = nx; prev.y2 = ny;
        } else {
          unitEdges.push({ x1: cx, y1: cy, x2: nx, y2: ny, dx: sx, dy: sy, w: ew });
        }
        cx = nx; cy = ny;
      }
    }
    for (const e of unitEdges) {
      registerSeg(layerName, gxToX(e.x1), gyToY(e.y1), gxToX(e.x2), gyToY(e.y2), e.w, nid);
      innerSegCount++;
    }
  }
}

// Add clean GND Through-Hole Stitching Vias uniting In1.Cu (GND) + In4.Cu (GND2) + In10.Cu (GND3)!
let gndStitchCount = 0;
for (let gy = 4; gy < NY - 4; gy += 10) {
  for (let gx = 4; gx < NX - 4; gx += 10) {
    if (!validInnerCell[cellKey(gx, gy)]) continue;
    const x = gxToX(gx), y = gyToY(gy);
    if (isViaStrictlyLegal('through', x, y, RULES.thDia, RULES.thDrill, 'F.Cu', 'B.Cu', GND_ID, false)) {
      registerVia('through', x, y, RULES.thDia, RULES.thDrill, 'F.Cu', 'B.Cu', GND_ID);
      gndStitchCount++;
    }
  }
}
console.log(`Committed: innerSegs=${innerSegCount} (localBgaNeckDownSteps=${neckDownSegs}), dynUVias=${dynUViaCount}, dynBuriedCore=${dynBuriedCount}, gndStitchTH=${gndStitchCount}, totalVias=${allVias.length}`);

// ============================================================================
// 10. EMIT 12-LAYER 0.800mm 3+6+3 HDI .kicad_pro AND .kicad_pcb
// ============================================================================
const basePro = JSON.parse(fs.readFileSync(PRO_PATH, 'utf8'));
basePro.board.design_settings.rules = {
  ...basePro.board.design_settings.rules,
  allow_blind_buried_vias: true,
  allow_microvias: true,
  min_clearance: RULES.minClearance,
  min_track_width: RULES.minTrackWidth,
  min_via_diameter: RULES.uViaDia,
  min_through_hole_diameter: RULES.buriedDrill,
  min_via_annular_width: 0.05,
  min_microvia_diameter: RULES.uViaDia,
  min_microvia_drill: RULES.uViaDrill,
  min_hole_clearance: RULES.holeClearance,
  min_hole_to_hole: RULES.holeToHole,
  min_copper_edge_clearance: RULES.copperEdgeClearance,
  use_height_for_length_calcs: true,
};
basePro.net_settings.classes = Object.entries(NETCLASS_SPECS).map(([name, sp], idx) => ({
  bus_width: 12,
  clearance: sp.clearance,
  diff_pair_gap: sp.diffGap,
  diff_pair_via_gap: 0.20,
  diff_pair_width: sp.width,
  line_style: 0,
  microvia_diameter: RULES.uViaDia,
  microvia_drill: RULES.uViaDrill,
  name,
  pcb_color: 'rgba(0, 0, 0, 0.000)',
  priority: name === 'Default' ? 2147483647 : 100 + idx,
  schematic_color: 'rgba(0, 0, 0, 0.000)',
  track_width: sp.width,
  via_diameter: RULES.buriedDia,
  via_drill: RULES.buriedDrill,
  wire_width: 6,
}));
basePro.net_settings.netclass_patterns = [
  { netclass: 'DDR_DIFF_80',   pattern: 'LPDDR5X_*_CK_*' },
  { netclass: 'DDR_DIFF_80',   pattern: 'LPDDR5X_*_WCK*' },
  { netclass: 'DDR_DIFF_80',   pattern: 'LPDDR5X_*_RDQS*' },
  { netclass: 'DDR_SE_40',     pattern: 'LPDDR5X_*' },
  { netclass: 'EMMC_SE_50',    pattern: 'EMMC_*' },
  { netclass: 'PCIE_DIFF_85',  pattern: 'PCIE_*' },
  { netclass: 'USB3_DIFF_90',  pattern: 'USB3_*' },
  { netclass: 'USB3_DIFF_90',  pattern: 'USBC_*' },
  { netclass: 'MIPI_DIFF_100', pattern: 'MIPI_*' },
  { netclass: 'POWER_WIDE',    pattern: 'VDD_*' },
  { netclass: 'POWER_WIDE',    pattern: 'VSYS_*' },
  { netclass: 'POWER_WIDE',    pattern: 'VBAT_*' },
];
fs.writeFileSync(PRO_PATH, JSON.stringify(basePro, null, 2));

const kbX = (x) => +x.toFixed(4);
const kbY = (y) => +(-y).toFixed(4); // Board +Y UP -> KiCad +Y DOWN

const out = [];
out.push(`(kicad_pcb`);
out.push(`  (version 20241229)`);
out.push(`  (generator "rk_t4_rev3_hdi_router")`);
out.push(`  (generator_version "9.0")`);
out.push(`  (general (thickness 0.80) (legacy_teardrops no))`);
out.push(`  (paper "A4")`);
out.push(`  (title_block (title "RK T4 Smartphone Mainboard Rev 3.0 — 12L 0.80mm 3+6+3 HDI") (date "2026-11-21") (rev "3.0"))`);
out.push(`  (layers`);
out.push(`    (0 "F.Cu" signal)`);
out.push(`    (4 "In1.Cu" power "GND")`);
out.push(`    (6 "In2.Cu" signal)`);
out.push(`    (8 "In3.Cu" signal)`);
out.push(`    (10 "In4.Cu" power "GND2")`);
out.push(`    (12 "In5.Cu" signal)`);
out.push(`    (14 "In6.Cu" signal)`);
out.push(`    (16 "In7.Cu" power "VSYS_3V87")`);
out.push(`    (18 "In8.Cu" signal)`);
out.push(`    (20 "In9.Cu" signal)`);
out.push(`    (22 "In10.Cu" power "GND3")`);
out.push(`    (2 "B.Cu" signal)`);
out.push(`    (9 "F.Adhes" user "F.Adhesive") (11 "B.Adhes" user "B.Adhesive")`);
out.push(`    (13 "F.Paste" user) (15 "B.Paste" user)`);
out.push(`    (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen")`);
out.push(`    (1 "F.Mask" user) (3 "B.Mask" user)`);
out.push(`    (25 "Edge.Cuts" user) (27 "F.CrtYd" user) (29 "B.CrtYd" user) (31 "F.Fab" user) (33 "B.Fab" user)`);
out.push(`  )`);
out.push(`  (setup`);
out.push(`    (stackup`);
out.push(`      (layer "F.SilkS" (type "Top Silk Screen"))`);
out.push(`      (layer "F.Paste" (type "Top Solder Paste"))`);
out.push(`      (layer "F.Mask" (type "Top Solder Mask") (thickness 0.014))`);
out.push(`      (layer "F.Cu" (type "copper") (thickness 0.030))`);
out.push(`      (layer "dielectric 1" (type "prepreg") (thickness 0.045) (material "S1000-2M") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In1.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 2" (type "prepreg") (thickness 0.066) (material "S1000-2M") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In2.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 3" (type "prepreg") (thickness 0.048) (material "S1000-2M") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In3.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 4" (type "core") (thickness 0.066) (material "TU-872SLK") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In4.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 5" (type "prepreg") (thickness 0.044) (material "S1000-2M") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In5.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 6" (type "core") (thickness 0.046) (material "TU-872SLK") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In6.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 7" (type "prepreg") (thickness 0.044) (material "S1000-2M") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In7.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 8" (type "core") (thickness 0.044) (material "TU-872SLK") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In8.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 9" (type "prepreg") (thickness 0.048) (material "S1000-2M") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In9.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 10" (type "prepreg") (thickness 0.066) (material "S1000-2M") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "In10.Cu" (type "copper") (thickness 0.015))`);
out.push(`      (layer "dielectric 11" (type "prepreg") (thickness 0.045) (material "S1000-2M") (epsilon_r 3.70) (loss_tangent 0.012))`);
out.push(`      (layer "B.Cu" (type "copper") (thickness 0.030))`);
out.push(`      (layer "B.Mask" (type "Bottom Solder Mask") (thickness 0.014))`);
out.push(`      (layer "B.Paste" (type "Bottom Solder Paste"))`);
out.push(`      (layer "B.SilkS" (type "Bottom Silk Screen"))`);
out.push(`      (copper_finish "ENIG")`);
out.push(`      (dielectric_constraints yes)`);
out.push(`    )`);
out.push(`    (pad_to_mask_clearance 0.0)`);
out.push(`    (allow_soldermask_bridges_in_footprints yes)`);
out.push(`  )`);

// Nets
for (let i = 0; i < idToNetName.length; i++) {
  out.push(`  (net ${i} "${idToNetName[i]}")`);
}

// Board Outline (Edge.Cuts)
for (let i = 0; i < OUTLINE_POLY.length; i++) {
  const a = OUTLINE_POLY[i], b = OUTLINE_POLY[(i + 1) % OUTLINE_POLY.length];
  out.push(`  (gr_line (start ${kbX(a[0])} ${kbY(a[1])}) (end ${kbX(b[0])} ${kbY(b[1])}) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "${deterministicUuid(100 + i)}"))`);
}

// Footprints
let uuidSeq = 10000;
for (const fp of footprints) {
  const isBot = fp.side === 'bot';
  const cuLayer = isBot ? 'B.Cu' : 'F.Cu';
  const pasteLayer = isBot ? 'B.Paste' : 'F.Paste';
  const maskLayer = isBot ? 'B.Mask' : 'F.Mask';
  const fabLayer = isBot ? 'B.Fab' : 'F.Fab';
  const fpName = `RK_T4_${fp.pkg.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  out.push(`  (footprint "${fpName}" (layer "${cuLayer}") (uuid "${deterministicUuid(++uuidSeq)}")`);
  out.push(`    (at ${kbX(fp.x)} ${kbY(fp.y)} ${fp.rot || 0})`);
  out.push(`    (property "Reference" "${fp.ref}" (at 0 0 0) (layer "${fabLayer}") (hide yes) (uuid "${deterministicUuid(++uuidSeq)}") (effects (font (size 0.4 0.4) (thickness 0.06))))`);
  out.push(`    (property "Value" "${fp.mpn}" (at 0 0.5 0) (layer "${fabLayer}") (hide yes) (uuid "${deterministicUuid(++uuidSeq)}") (effects (font (size 0.4 0.4) (thickness 0.06))))`);
  out.push(`    (attr smd)`);
  if (!fp.isInterposer && fp.w > 0 && fp.h > 0) {
    const hw = +(fp.w * 0.5).toFixed(4), hh = +(fp.h * 0.5).toFixed(4);
    out.push(`    (fp_rect (start ${-hw} ${-hh}) (end ${hw} ${hh}) (stroke (width 0.06) (type solid)) (fill none) (layer "${fabLayer}") (uuid "${deterministicUuid(++uuidSeq)}"))`);
  }
  for (const p of fp.pads) {
    // KiCad footprint-local Y is inverted from board local Y (when rot=0)
    const klx = +p.lx.toFixed(4);
    const kly = +(-p.ly).toFixed(4);
    const shapeStr = p.shape === 'circle' ? 'circle' : 'roundrect';
    const rrStr = shapeStr === 'roundrect' ? ' (roundrect_rratio 0.2)' : '';
    const netStr = p.netId > 0 ? ` (net ${p.netId} "${p.netName}")` : '';
    out.push(`    (pad "${p.padNum}" smd ${shapeStr} (at ${klx} ${kly}) (size ${p.pw} ${p.ph}) (layers "${cuLayer}" "${pasteLayer}" "${maskLayer}")${rrStr}${netStr} (uuid "${deterministicUuid(++uuidSeq)}"))`);
  }
  out.push(`  )`);
}

// Segments across all 12 layers
for (const [layer, segs] of Object.entries(layerSegs)) {
  for (const s of segs) {
    out.push(`  (segment (start ${kbX(s.x1)} ${kbY(s.y1)}) (end ${kbX(s.x2)} ${kbY(s.y2)}) (width ${s.width}) (layer "${layer}") (net ${s.netId}) (uuid "${deterministicUuid(++uuidSeq)}"))`);
  }
}

// Vias (micro, blind buried core, through)
for (const v of allVias) {
  const typeTok = v.type === 'micro' ? ' micro' : v.type === 'blind' ? ' blind' : '';
  out.push(`  (via${typeTok} (at ${kbX(v.x)} ${kbY(v.y)}) (size ${v.dia}) (drill ${v.drill}) (layers "${v.l1}" "${v.l2}") (net ${v.netId}) (uuid "${deterministicUuid(++uuidSeq)}"))`);
}

// 4 Copper Planes: In1.Cu (GND), In4.Cu (GND2), In7.Cu (VSYS_3V87), In10.Cu (GND3)
const zonePoly = insetOrthoPolygon(OUTLINE_POLY, 0.35);
const zonePts = zonePoly.map(([px, py]) => `(xy ${kbX(px)} ${kbY(py)})`).join(' ');
for (const [layer, netId, netName] of [
  ['In1.Cu', GND_ID, 'GND'],
  ['In4.Cu', GND_ID, 'GND'],
  ['In7.Cu', VSYS_ID, 'VSYS_3V87'],
  ['In10.Cu', GND_ID, 'GND'],
]) {
  out.push(`  (zone (net ${netId}) (net_name "${netName}") (layer "${layer}") (uuid "${deterministicUuid(++uuidSeq)}")`);
  out.push(`    (hatch edge 0.5)`);
  out.push(`    (connect_pads yes (clearance 0.07))`);
  out.push(`    (min_thickness 0.05)`);
  out.push(`    (filled_areas_thickness no)`);
  out.push(`    (fill yes (thermal_gap 0.07) (thermal_bridge_width 0.12) (island_removal_mode 1))`);
  out.push(`    (polygon (pts ${zonePts}))`);
  out.push(`  )`);
}
out.push(`)`);

fs.writeFileSync(PCB_PATH, out.join('\n') + '\n');
console.log(`Wrote ${PCB_PATH} (${(fs.statSync(PCB_PATH).size / 1024).toFixed(1)} KB)`);

// ============================================================================
// 11. STAGE 4 — NATIVE KICAD 9.0.8 pcbnew.ZONE_FILLER ON ALL 4 PLANES!
// ============================================================================
const kicadRoot = '/home/antigravity/.local/kicad-root';
const env = {
  ...process.env,
  PYTHONPATH: `${kicadRoot}/usr/lib/python3/dist-packages`,
  LD_LIBRARY_PATH: `${kicadRoot}/usr/lib/x86_64-linux-gnu:${kicadRoot}/usr/lib/x86_64-linux-gnu/kicad:${kicadRoot}/lib/x86_64-linux-gnu:${kicadRoot}/usr/lib:${process.env.LD_LIBRARY_PATH || ''}`,
};
console.log('Running native KiCad 9.0.8 pcbnew.ZONE_FILLER on In1.Cu, In4.Cu, In7.Cu, In10.Cu (0.07mm/0.10mm HDI rules)...');
execFileSync('python3', [
  '-c',
  `import pcbnew; b = pcbnew.LoadBoard(${JSON.stringify(PCB_PATH)}); ` +
  `ds = b.GetDesignSettings(); ds.m_MinClearance = pcbnew.FromMM(0.07); ` +
  `ds.m_HoleClearance = pcbnew.FromMM(0.10); ds.m_CopperEdgeClearance = pcbnew.FromMM(0.30); ` +
  `ds.m_NetSettings.GetDefaultNetclass().SetClearance(pcbnew.FromMM(0.07)); ` +
  `f = pcbnew.ZONE_FILLER(b); ok = f.Fill(b.Zones()); b.Save(${JSON.stringify(PCB_PATH)}); ` +
  `print("ZONE_FILLER ok =", ok, "zones =", len(b.Zones()), "outlines =", [z.GetFilledPolysList(z.GetFirstLayer()).OutlineCount() for z in b.Zones()])`,
], { env, stdio: 'inherit' });

// CRITICAL: pcbnew.Save() resets .kicad_pro net_settings.classes to KiCad's 0.2mm default — rewrite our verified Rev 3.0 .kicad_pro AFTER b.Save()!
basePro.net_settings.classes = Object.entries(NETCLASS_SPECS).map(([name, sp], idx) => ({
  bus_width: 12,
  clearance: sp.clearance,
  diff_pair_gap: sp.diffGap,
  diff_pair_via_gap: 0.20,
  diff_pair_width: sp.width,
  line_style: 0,
  microvia_diameter: RULES.uViaDia,
  microvia_drill: RULES.uViaDrill,
  name,
  pcb_color: 'rgba(0, 0, 0, 0.000)',
  priority: name === 'Default' ? 2147483647 : 100 + idx,
  schematic_color: 'rgba(0, 0, 0, 0.000)',
  track_width: sp.width,
  via_diameter: RULES.buriedDia,
  via_drill: RULES.buriedDrill,
  wire_width: 6,
}));
fs.writeFileSync(PRO_PATH, JSON.stringify(basePro, null, 2));
console.log(`Restored Rev 3.0 8-netclass HDI rules in ${PRO_PATH}`);
console.log(`Total Rev 3.0 12L 0.80mm HDI build time: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
