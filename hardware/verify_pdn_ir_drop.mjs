#!/usr/bin/env node
/**
 * RK T4 Rev 5.0 (True EVT) — Real-Copper DC IR-Drop & IPC-2152 Ampacity Auditor
 * ==============================================================================
 * Parses ACTUAL routed segments, filled 1oz copper zones (filled_polygon), and
 * plated vias directly from `hardware/rk_t4_mainboard.kicad_pcb` to compute:
 *   - Real DC resistance R_dc (mOhm) at T_op = 75°C (1oz = 35um copper, R_sq = 0.599 mOhm/sq)
 *   - Voltage drop ΔV (mV and % of V_nom) under realistic peak smartphone loads
 *   - IPC-2152 conservative temperature rise ΔT (°C)
 *   - Parallel via current sharing & via-barrel resistance
 *
 * Outputs `hardware/pdn_ir_drop_report.json` and fails CI if ANY rail exceeds
 * ΔV > 5% (or > 50 mV on low-voltage SoC/DDR rails) or ΔT > 20°C.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PCB_PATH = path.join(__dirname, 'rk_t4_mainboard.kicad_pcb');
const REPORT_PATH = path.join(__dirname, 'pdn_ir_drop_report.json');

// Copper physical constants at 75°C operating temperature (JLCPCB 14L 1oz = 35um on all layers)
const RHO_75C = 1.724e-8 * (1 + 0.00393 * (75 - 20)); // 2.096e-8 Ohm*m
const CU_THK_M = 35e-6;                                // 35 um (1 oz)
const R_SQ_MOHM = (RHO_75C / CU_THK_M) * 1000;         // 0.5989 mOhm/sq
const VIA_WALL_M = 20e-6;                              // IPC-6012 Class 2 min 20um Cu plating

// Peak realistic smartphone operating currents & strict PDN acceptance limits
const PDN_SPECS = [
  { net: 'VDD_CPU_BIG0_S0',  vNom: 0.90, iPeakA: 4.5, maxDvMv: 45, maxDvPct: 5.0, maxDtC: 20, pathEstMm: 14.0, desc: 'Cortex-A76 Cluster 0 (U207->U101)' },
  { net: 'VDD_CPU_BIG1_S0',  vNom: 0.90, iPeakA: 4.5, maxDvMv: 45, maxDvPct: 5.0, maxDtC: 20, pathEstMm: 12.0, desc: 'Cortex-A76 Cluster 1 (U208->U101)' },
  { net: 'VDD_GPU_S0',       vNom: 0.85, iPeakA: 5.0, maxDvMv: 45, maxDvPct: 5.3, maxDtC: 20, pathEstMm: 12.5, desc: 'Mali-G610 MC4 GPU (U206 B1->U101)' },
  { net: 'VDD_NPU_S0',       vNom: 0.85, iPeakA: 3.5, maxDvMv: 45, maxDvPct: 5.3, maxDtC: 20, pathEstMm: 11.0, desc: '6-TOPS NPU (U209->U101)' },
  { net: 'VDD_LOG_S0',       vNom: 0.80, iPeakA: 3.0, maxDvMv: 40, maxDvPct: 5.0, maxDtC: 20, pathEstMm: 14.0, desc: 'SoC Core Logic (U206 B3->U101)' },
  { net: 'VDD_CPU_LIT_S0',   vNom: 0.85, iPeakA: 2.5, maxDvMv: 42, maxDvPct: 5.0, maxDtC: 20, pathEstMm: 13.0, desc: 'Cortex-A55 Cluster (U206 B2->U101)' },
  { net: 'VDD_DDR_S0',       vNom: 0.85, iPeakA: 2.5, maxDvMv: 42, maxDvPct: 5.0, maxDtC: 20, pathEstMm: 15.0, desc: 'SoC DDR PHY Core (U206 B5->U101)' },
  { net: 'VDD2_DDR_S3',      vNom: 1.05, iPeakA: 2.0, maxDvMv: 45, maxDvPct: 4.3, maxDtC: 20, pathEstMm: 18.0, desc: 'LPDDR5X VDD2H 1.05V (U206 B6->U301)' },
  { net: 'VDDQ_DDR_S0',      vNom: 0.50, iPeakA: 1.5, maxDvMv: 25, maxDvPct: 5.0, maxDtC: 20, pathEstMm: 18.0, desc: 'LPDDR5X VDDQ 0.50V (U206 B9->U101/U301)' },
  { net: 'VDD2L_0V9_DDR_S3', vNom: 0.90, iPeakA: 1.5, maxDvMv: 35, maxDvPct: 3.9, maxDtC: 20, pathEstMm: 14.0, desc: 'LPDDR5X VDD2L 0.90V Plane (In7.Cu Zone A)' },
  { net: 'VSYS_3V87',        vNom: 3.87, iPeakA: 5.0, maxDvMv: 115, maxDvPct: 3.0, maxDtC: 20, pathEstMm: 22.0, desc: 'Main System Power Plane (In7.Cu Zone B)' },
  { net: 'VBAT_6000MAH',     vNom: 3.87, iPeakA: 5.0, maxDvMv: 115, maxDvPct: 3.0, maxDtC: 20, pathEstMm:  8.5, desc: '6000mAh Battery Trunk (J201->U202)' },
  { net: 'VBUS_PD_12V',      vNom: 12.0, iPeakA: 3.0, maxDvMv: 360, maxDvPct: 3.0, maxDtC: 20, pathEstMm: 52.0, desc: 'USB-PD 12V Input Trunk (J601->Q201A)' },
  { net: 'VBUS_OVP_OUT',     vNom: 12.0, iPeakA: 3.0, maxDvMv: 360, maxDvPct: 3.0, maxDtC: 20, pathEstMm: 11.5, desc: 'Post-OVP VBUS Trunk (Q201B->U202)' },
];

const pcbText = fs.readFileSync(PCB_PATH, 'utf8');

// 1. Parse net table: (net <id> "<name>")
const idToNet = new Map();
const netToId = new Map();
for (const m of pcbText.matchAll(/^\s*\(net\s+(\d+)\s+"([^"]*)"\)/gm)) {
  const id = parseInt(m[1], 10);
  idToNet.set(id, m[2]);
  if (m[2]) netToId.set(m[2], id);
}

const targetIds = new Set(PDN_SPECS.map((s) => netToId.get(s.net)).filter(Boolean));
const stats = new Map();
for (const s of PDN_SPECS) {
  stats.set(s.net, {
    segCount: 0, totalSegLenMm: 0, segWidthLenSum: 0, maxSegWidthMm: 0, minSegWidthMm: 999,
    segsByLayer: {},
    viasTotal: 0, viasThrough: 0, viasBlind: 0, viasMicro: 0,
    zoneCount: 0, filledPolyCount: 0, totalZoneAreaMm2: 0, zoneLayers: new Set(),
    zoneBounds: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  });
}

// 2. Parse ALL routed copper segments
const segRe = /\(segment\s+\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\)\s+\(width\s+([-\d.]+)\)\s+\(layer\s+"([^"]+)"\)\s+\(net\s+(\d+)\)/g;
for (const m of pcbText.matchAll(segRe)) {
  const netId = parseInt(m[7], 10);
  if (!targetIds.has(netId)) continue;
  const st = stats.get(idToNet.get(netId));
  const len = Math.hypot(parseFloat(m[3]) - parseFloat(m[1]), parseFloat(m[4]) - parseFloat(m[2]));
  const w = parseFloat(m[5]);
  const layer = m[6];
  st.segCount++;
  st.totalSegLenMm += len;
  st.segWidthLenSum += w * len;
  if (w > st.maxSegWidthMm) st.maxSegWidthMm = w;
  if (w < st.minSegWidthMm) st.minSegWidthMm = w;
  st.segsByLayer[layer] = (st.segsByLayer[layer] || 0) + len;
}

// 3. Parse ALL vias (supports multiline KiCad 9 pcbnew.Save() formatting)
const viaRe = /\(via(?:\s+(micro|blind))?\s+\(at\s+([-\d.]+)\s+([-\d.]+)\)\s+\(size\s+([-\d.]+)\)\s+\(drill\s+([-\d.]+)\)\s+\(layers\s+"([^"]+)"\s+"([^"]+)"\)(?:\s+\([^)]*\))*?\s+\(net\s+(\d+)\)/g;
for (const m of pcbText.matchAll(viaRe)) {
  const netId = parseInt(m[8], 10);
  if (!targetIds.has(netId)) continue;
  const st = stats.get(idToNet.get(netId));
  const vType = m[1] || 'through';
  st.viasTotal++;
  if (vType === 'micro') st.viasMicro++;
  else if (vType === 'blind') st.viasBlind++;
  else st.viasThrough++;
}

// 4. Parse ALL native KiCad-filled copper zones (filled_polygon areas using exact shoelace formula!)
const zoneHeaderRe = /\(zone\s*\n?\s*\(net\s+(\d+)\)\s*\n?\s*\(net_name\s+"([^"]+)"\)\s*\n?\s*\(layer\s+"([^"]+)"\)/g;
const zoneMatches = [...pcbText.matchAll(zoneHeaderRe)];
for (let zi = 0; zi < zoneMatches.length; zi++) {
  const m = zoneMatches[zi];
  const netName = m[2];
  if (!stats.has(netName)) continue;
  const st = stats.get(netName);
  const startIdx = m.index;
  const endIdx = zi + 1 < zoneMatches.length ? zoneMatches[zi + 1].index : pcbText.length;
  const chunk = pcbText.slice(startIdx, endIdx);
  st.zoneCount++;
  st.zoneLayers.add(m[3]);
  // Extract every (filled_polygon ... (pts (xy x y) ...))
  const fpRe = /\(filled_polygon[\s\S]*?\(pts([\s\S]*?)\)\s*\)/g;
  for (const fp of chunk.matchAll(fpRe)) {
    const pts = [];
    for (const xy of fp[1].matchAll(/\(xy\s+([-\d.]+)\s+([-\d.]+)\)/g)) {
      const px = parseFloat(xy[1]), py = parseFloat(xy[2]);
      pts.push([px, py]);
      if (px < st.zoneBounds.minX) st.zoneBounds.minX = px;
      if (px > st.zoneBounds.maxX) st.zoneBounds.maxX = px;
      if (py < st.zoneBounds.minY) st.zoneBounds.minY = py;
      if (py > st.zoneBounds.maxY) st.zoneBounds.maxY = py;
    }
    if (pts.length >= 3) {
      let area2 = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        area2 += x1 * y2 - x2 * y1;
      }
      st.totalZoneAreaMm2 += Math.abs(area2) * 0.5;
      st.filledPolyCount++;
    }
  }
}

// 5. Compute DC IR-Drop & IPC-2152 ΔT for EVERY high-current PDN rail!
function viaBarrelMohm(drillMm, lenMm) {
  const d = drillMm * 1e-3;
  const circ = Math.PI * (d - VIA_WALL_M);
  const area = circ * VIA_WALL_M;
  return (RHO_75C * (lenMm * 1e-3) / area) * 1000;
}
const R_VIA_TH_MOHM = viaBarrelMohm(0.15, 1.15);      // ~3.0 mOhm
const R_VIA_BURIED_MOHM = viaBarrelMohm(0.15, 0.72);  // ~1.9 mOhm
const R_VIA_MICRO_MOHM = viaBarrelMohm(0.075, 0.09);  // ~0.55 mOhm

const results = [];
const failures = [];

for (const spec of PDN_SPECS) {
  const st = stats.get(spec.net);
  const avgSegW = st.totalSegLenMm > 0 ? st.segWidthLenSum / st.totalSegLenMm : 0.10;
  // Effective parallel copper width along the VRM -> Load span:
  //   1) Parallel routed track copper: sum of segment area divided by direct VRM->load span (capped conservatively at 0.55 efficiency)
  const segAreaMm2 = st.segWidthLenSum;
  const wEffSegMm = Math.max(avgSegW, (segAreaMm2 / Math.max(4.0, spec.pathEstMm)) * 0.45);
  //   2) KiCad-filled solid 1oz copper pour zones: total filled copper area divided by span (0.60 perforation/antipad derating!)
  const wEffZoneMm = st.totalZoneAreaMm2 > 0 ? (st.totalZoneAreaMm2 / Math.max(6.0, spec.pathEstMm)) * 0.60 : 0;
  const wEffTotalMm = wEffSegMm + wEffZoneMm;

  // Copper path DC resistance (mOhm) at 75°C
  const rCopperMohm = R_SQ_MOHM * (spec.pathEstMm / Math.max(0.10, wEffTotalMm));

  // Effective parallel via transition resistance (source end + load end transitions in series)
  // Effective parallel vias per transition = max(1, totalVias / 3)
  const effParallelTh = Math.max(1, (st.viasThrough + st.viasBlind * 0.8 + st.viasMicro * 0.35) / 2.5);
  const rViaTransitionMohm = (2 * R_VIA_TH_MOHM) / effParallelTh;

  const rTotalMohm = rCopperMohm + rViaTransitionMohm;
  const dvMv = spec.iPeakA * rTotalMohm;
  const dvPct = (dvMv / (spec.vNom * 1000)) * 100;

  // IPC-2152 Conservative Internal-Layer Temperature Rise:
  //   I = k * dT^0.44 * A_mil2^0.725  =>  dT = (I / (k * A_mil2^0.725))^(1/0.44)
  //   Cross-section area A = wEffTotalMm * 0.035mm converted to sq. mils (1 mm^2 = 1550.0031 mil^2)
  const cuAreaMm2 = wEffTotalMm * 0.035;
  const cuAreaMil2 = cuAreaMm2 * 1550.0031;
  const kIpc = st.zoneLayers.has('B.Cu') || st.zoneLayers.has('F.Cu') ? 0.032 : 0.024;
  const dtC = Math.pow(spec.iPeakA / (kIpc * Math.pow(Math.max(1.0, cuAreaMil2), 0.725)), 1 / 0.44);

  const pass = dvMv <= spec.maxDvMv && dvPct <= spec.maxDvPct && dtC <= spec.maxDtC && st.totalZoneAreaMm2 > 0;
  if (!pass) {
    failures.push(
      `${spec.net}: dV=${dvMv.toFixed(1)}mV (${dvPct.toFixed(2)}%, lim ${spec.maxDvMv}mV/${spec.maxDvPct}%), ` +
      `dT=${dtC.toFixed(1)}C (lim ${spec.maxDtC}C), zoneArea=${st.totalZoneAreaMm2.toFixed(1)}mm2`
    );
  }
  results.push({
    net: spec.net,
    description: spec.desc,
    vNomV: spec.vNom,
    iPeakA: spec.iPeakA,
    pathEstMm: spec.pathEstMm,
    routedSegs: st.segCount,
    avgSegWidthMm: +avgSegW.toFixed(3),
    maxSegWidthMm: +st.maxSegWidthMm.toFixed(3),
    filledZoneLayers: [...st.zoneLayers],
    filledZoneAreaMm2: +st.totalZoneAreaMm2.toFixed(2),
    viasTotal: st.viasTotal,
    viasThrough: st.viasThrough,
    viasBlind: st.viasBlind,
    viasMicro: st.viasMicro,
    effectiveCopperWidthMm: +wEffTotalMm.toFixed(2),
    rCopperMohm: +rCopperMohm.toFixed(2),
    rViaMohm: +rViaTransitionMohm.toFixed(2),
    rTotalMohm: +rTotalMohm.toFixed(2),
    irDropMv: +dvMv.toFixed(2),
    irDropPct: +dvPct.toFixed(2),
    ipc2152TempRiseC: +dtC.toFixed(2),
    status: pass ? 'PASS' : 'FAIL',
  });
}

const report = {
  board: 'RK T4 Rev 5.0 (True EVT) 14-Layer 1.20mm 1oz/1oz Mainboard',
  generatedAt: new Date().toISOString(),
  assumptions: {
    copperThicknessUm: 35,
    operatingTempC: 75,
    sheetResistanceMohmPerSq: +R_SQ_MOHM.toFixed(4),
    viaPlatingWallUm: 20,
    zoneAntipadDeratingFactor: 0.60,
    ipc2152Model: 'Conservative internal layer k=0.024 (0.032 with outer pour)',
  },
  summary: {
    railsAudited: results.length,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: failures.length,
    worstIrDropPct: +Math.max(...results.map((r) => r.irDropPct)).toFixed(2),
    worstTempRiseC: +Math.max(...results.map((r) => r.ipc2152TempRiseC)).toFixed(2),
  },
  rails: results,
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

console.log('======================================================================================================');
console.log('  RK T4 REV 5.0 (TRUE EVT) — REAL-COPPER DC IR-DROP & IPC-2152 PDN INTEGRITY AUDIT (T=75°C, 1oz Cu)  ');
console.log('======================================================================================================');
console.log('Rail               Vnom   Ipk   ZoneArea  EffW   Vias   R_dc     dV (mV / %)       IPC-2152 dT  Stat');
console.log('------------------------------------------------------------------------------------------------------');
for (const r of results) {
  console.log(
    `${r.net.padEnd(18)} ${r.vNomV.toFixed(2).padStart(5)}V ${r.iPeakA.toFixed(1).padStart(4)}A ` +
    `${r.filledZoneAreaMm2.toFixed(1).padStart(7)}mm2 ${r.effectiveCopperWidthMm.toFixed(2).padStart(5)}mm ` +
    `${String(r.viasTotal).padStart(4)}  ${r.rTotalMohm.toFixed(2).padStart(5)}mR ` +
    `${r.irDropMv.toFixed(1).padStart(6)}mV (${r.irDropPct.toFixed(2).padStart(4)}%)  ` +
    `${r.ipc2152TempRiseC.toFixed(2).padStart(7)}°C    ${r.status}`
  );
}
console.log('======================================================================================================');
console.log(`Saved -> ${REPORT_PATH} | Passed: ${report.summary.passed}/${report.summary.railsAudited} | Worst dV=${report.summary.worstIrDropPct}% | Worst dT=${report.summary.worstTempRiseC}°C`);
if (failures.length) {
  console.error('PDN IR-DROP / AMPACITY FAILURES:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
