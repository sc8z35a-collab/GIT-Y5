#!/usr/bin/env node
/**
 * RK T4 Rev 5.0 (True EVT) — Real-Copper DC IR-Drop & IPC-2152 Ampacity Auditor
 * ==============================================================================
 * Parses ACTUAL routed segments, filled copper zones (filled_polygon), and
 * plated vias directly from `hardware/rk_t4_mainboard.kicad_pcb` using the
 * exact JLCPCB 14-Layer 1.200 mm 3+8+3 HDI copper weights:
 *   - Outer layers (F.Cu, B.Cu)      : 1.0 oz = 35.0 um Cu (R_sq = 0.5989 mOhm/sq @ 75°C)
 *   - Inner layers (In1.Cu..In12.Cu) : 0.5 oz = 17.5 um Cu (R_sq = 1.1977 mOhm/sq @ 75°C)
 *
 * Audits ALL 16 high-current / display PDN rails (including TI TPS65632RTER
 * OLED_ELVDD_4V6 +4.6V and OLED_ELVSS_M4V0 -4.0V) PLUS real PCB copper traces
 * of the TI BQ27Z561-R2 Si-C fuel gauge (VBAT_NEG_PACK 5A return + 4-terminal
 * Kelvin sense FG_CSP/FG_CSN).
 *
 * Outputs `hardware/pdn_ir_drop_report.json` and fails CI if ANY rail exceeds
 * ΔV or ΔT limits.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PCB_PATH = path.join(__dirname, 'rk_t4_mainboard.kicad_pcb');
const REPORT_PATH = path.join(__dirname, 'pdn_ir_drop_report.json');

// Copper physical constants at 75°C operating temperature (JLCPCB 14L HDI: Outer 1oz / Inner 0.5oz)
const RHO_75C = 1.724e-8 * (1 + 0.00393 * (75 - 20));       // 2.096e-8 Ohm*m
const CU_OUTER_M = 35.0e-6;                                  // 35.0 um (1.0 oz: F.Cu, B.Cu)
const CU_INNER_M = 17.5e-6;                                  // 17.5 um (0.5 oz: In1.Cu..In12.Cu)
const R_SQ_OUTER_MOHM = (RHO_75C / CU_OUTER_M) * 1000;       // 0.5989 mOhm/sq
const R_SQ_INNER_MOHM = (RHO_75C / CU_INNER_M) * 1000;       // 1.1977 mOhm/sq
const VIA_WALL_M = 20e-6;                                    // IPC-6012 Class 2 min 20um Cu plating

const isOuterLayer = (layer) => layer === 'F.Cu' || layer === 'B.Cu';
const layerCuMm = (layer) => (isOuterLayer(layer) ? 0.035 : 0.0175);
const layerRSqMohm = (layer) => (isOuterLayer(layer) ? R_SQ_OUTER_MOHM : R_SQ_INNER_MOHM);

// Peak realistic smartphone operating currents & strict PDN acceptance limits (16 Rails!)
const PDN_SPECS = [
  { net: 'VDD_CPU_BIG0_S0',  vNom: 0.90, iPeakA: 4.5, maxDvMv: 45,  maxDvPct: 5.0, maxDtC: 20, pathEstMm: 14.0, desc: 'Cortex-A76 Cluster 0 (U207->U101)' },
  { net: 'VDD_CPU_BIG1_S0',  vNom: 0.90, iPeakA: 4.5, maxDvMv: 45,  maxDvPct: 5.0, maxDtC: 20, pathEstMm: 12.0, desc: 'Cortex-A76 Cluster 1 (U208->U101)' },
  { net: 'VDD_GPU_S0',       vNom: 0.85, iPeakA: 5.0, maxDvMv: 45,  maxDvPct: 5.3, maxDtC: 20, pathEstMm: 12.5, desc: 'Mali-G610 MC4 GPU (U206 B1->U101)' },
  { net: 'VDD_NPU_S0',       vNom: 0.85, iPeakA: 3.5, maxDvMv: 45,  maxDvPct: 5.3, maxDtC: 20, pathEstMm: 11.0, desc: '6-TOPS NPU (U209->U101)' },
  { net: 'VDD_LOG_S0',       vNom: 0.80, iPeakA: 3.0, maxDvMv: 40,  maxDvPct: 5.0, maxDtC: 20, pathEstMm: 14.0, desc: 'SoC Core Logic (U206 B3->U101)' },
  { net: 'VDD_CPU_LIT_S0',   vNom: 0.85, iPeakA: 2.5, maxDvMv: 42,  maxDvPct: 5.0, maxDtC: 20, pathEstMm: 13.0, desc: 'Cortex-A55 Cluster (U206 B2->U101)' },
  { net: 'VDD_DDR_S0',       vNom: 0.85, iPeakA: 2.5, maxDvMv: 42,  maxDvPct: 5.0, maxDtC: 20, pathEstMm: 15.0, desc: 'SoC DDR PHY Core (U206 B5->U101)' },
  { net: 'VDD2_DDR_S3',      vNom: 1.05, iPeakA: 2.0, maxDvMv: 45,  maxDvPct: 4.3, maxDtC: 20, pathEstMm: 18.0, desc: 'LPDDR5X VDD2H 1.05V (U206 B6->U301)' },
  { net: 'VDDQ_DDR_S0',      vNom: 0.50, iPeakA: 1.5, maxDvMv: 25,  maxDvPct: 5.0, maxDtC: 20, pathEstMm: 18.0, desc: 'LPDDR5X VDDQ 0.50V (U206 B9->U101/U301)' },
  { net: 'VDD2L_0V9_DDR_S3', vNom: 0.90, iPeakA: 1.5, maxDvMv: 35,  maxDvPct: 3.9, maxDtC: 20, pathEstMm: 14.0, desc: 'LPDDR5X VDD2L 0.90V Plane (In7.Cu Zone A)' },
  { net: 'VSYS_3V87',        vNom: 3.87, iPeakA: 5.0, maxDvMv: 115, maxDvPct: 3.0, maxDtC: 20, pathEstMm: 22.0, desc: 'Main System Power Plane (In7.Cu Zone B)' },
  { net: 'VBAT_6000MAH',     vNom: 3.87, iPeakA: 5.0, maxDvMv: 115, maxDvPct: 3.0, maxDtC: 20, pathEstMm:  8.5, desc: '6000mAh Battery Trunk (J201->U202)' },
  { net: 'VBUS_PD_12V',      vNom: 12.0, iPeakA: 3.0, maxDvMv: 360, maxDvPct: 3.0, maxDtC: 20, pathEstMm: 52.0, desc: 'USB-PD 12V Input Trunk (J601->Q201A)' },
  { net: 'VBUS_OVP_OUT',     vNom: 12.0, iPeakA: 3.0, maxDvMv: 360, maxDvPct: 3.0, maxDtC: 20, pathEstMm: 11.5, desc: 'Post-OVP VBUS Trunk (Q201B->U202)' },
  { net: 'OLED_ELVDD_4V6',   vNom: 4.60, iPeakA: 0.8, maxDvMv: 115, maxDvPct: 2.5, maxDtC: 20, pathEstMm: 14.0, desc: 'AMOLED Positive ELVDD +4.6V (U501 TPS65632RTER->J501)' },
  { net: 'OLED_ELVSS_M4V0',  vNom: 4.00, iPeakA: 0.8, maxDvMv: 100, maxDvPct: 2.5, maxDtC: 20, pathEstMm: 14.0, desc: 'AMOLED Negative ELVSS -4.0V (U501 TPS65632RTER->J501)' },
];

// Additional BQ27Z561-R2 Si-C Fuel Gauge PCB copper nets to audit
const FG_NETS = ['VBAT_NEG_PACK', 'FG_CSP_RAW', 'FG_CSN_RAW', 'FG_CSP', 'FG_CSN'];

const pcbText = fs.readFileSync(PCB_PATH, 'utf8');

// 1. Parse net table: (net <id> "<name>")
const idToNet = new Map();
const netToId = new Map();
for (const m of pcbText.matchAll(/^\s*\(net\s+(\d+)\s+"([^"]*)"\)/gm)) {
  const id = parseInt(m[1], 10);
  idToNet.set(id, m[2]);
  if (m[2]) netToId.set(m[2], id);
}

const allAuditNets = [...PDN_SPECS.map((s) => s.net), ...FG_NETS];
const targetIds = new Set(allAuditNets.map((n) => netToId.get(n)).filter(Boolean));
const stats = new Map();
for (const netName of allAuditNets) {
  stats.set(netName, {
    segCount: 0, totalSegLenMm: 0, segWidthLenSum: 0, maxSegWidthMm: 0, minSegWidthMm: 999,
    segsByLayer: {},
    segAreaByLayer: {},
    viasTotal: 0, viasThrough: 0, viasBlind: 0, viasMicro: 0,
    zoneCount: 0, filledPolyCount: 0, totalZoneAreaMm2: 0, zoneLayers: new Set(),
    zoneAreaByLayer: {},
    zoneBounds: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  });
}

// 2. Parse ALL routed copper segments (with exact per-layer copper area tracking)
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
  st.segAreaByLayer[layer] = (st.segAreaByLayer[layer] || 0) + w * len;
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

// 4. Parse ALL native KiCad-filled copper zones (filled_polygon areas per layer using exact shoelace formula!)
const zoneHeaderRe = /\(zone\s*\n?\s*\(net\s+(\d+)\)\s*\n?\s*\(net_name\s+"([^"]+)"\)\s*\n?\s*\(layer\s+"([^"]+)"\)/g;
const zoneMatches = [...pcbText.matchAll(zoneHeaderRe)];
for (let zi = 0; zi < zoneMatches.length; zi++) {
  const m = zoneMatches[zi];
  const netName = m[2];
  const layer = m[3];
  if (!stats.has(netName)) continue;
  const st = stats.get(netName);
  const startIdx = m.index;
  const endIdx = zi + 1 < zoneMatches.length ? zoneMatches[zi + 1].index : pcbText.length;
  const chunk = pcbText.slice(startIdx, endIdx);
  st.zoneCount++;
  st.zoneLayers.add(layer);
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
      const polyArea = Math.abs(area2) * 0.5;
      st.totalZoneAreaMm2 += polyArea;
      st.zoneAreaByLayer[layer] = (st.zoneAreaByLayer[layer] || 0) + polyArea;
      st.filledPolyCount++;
    }
  }
}

// 5. Compute Per-Layer DC IR-Drop & IPC-2152 ΔT for EVERY high-current PDN rail!
function viaBarrelMohm(drillMm, lenMm) {
  const d = drillMm * 1e-3;
  const circ = Math.PI * (d - VIA_WALL_M);
  const area = circ * VIA_WALL_M;
  return (RHO_75C * (lenMm * 1e-3) / area) * 1000;
}
const R_VIA_TH_MOHM = viaBarrelMohm(0.15, 1.20);       // ~3.10 mOhm (full 1.20 mm stackup)
const R_VIA_BURIED_MOHM = viaBarrelMohm(0.15, 0.662);  // ~1.71 mOhm (In3<->In10 buried core)
const R_VIA_MICRO_MOHM = viaBarrelMohm(0.075, 0.068);  // ~0.41 mOhm (laser microvia)

const results = [];
const failures = [];

function evaluateCopperPath(st, pathEstMm, iPeakA, requireZone = true) {
  const avgSegW = st.totalSegLenMm > 0 ? st.segWidthLenSum / st.totalSegLenMm : 0.10;
  const layers = new Set([...Object.keys(st.segAreaByLayer), ...Object.keys(st.zoneAreaByLayer)]);

  let totalConductanceInvMohm = 0; // sum of 1 / R_layer (in 1/mOhm)
  let cuCrossSectionMm2 = 0;
  let wEffGeomTotalMm = 0;
  let wEffSegSum = 0;
  let dominantSegLayer = 'In7.Cu';
  let dominantSegLen = -1;
  for (const [l, len] of Object.entries(st.segsByLayer)) {
    if (len > dominantSegLen) { dominantSegLen = len; dominantSegLayer = l; }
  }

  for (const layer of layers) {
    const segArea = st.segAreaByLayer[layer] || 0;
    const zoneArea = st.zoneAreaByLayer[layer] || 0;
    const wEffSegL = (segArea / Math.max(4.0, pathEstMm)) * 0.45;
    wEffSegSum += wEffSegL;
    const wEffZoneL = zoneArea > 0 ? (zoneArea / Math.max(6.0, pathEstMm)) * 0.60 : 0;
    const wEffL = wEffSegL + wEffZoneL;
    if (wEffL <= 0) continue;
    wEffGeomTotalMm += wEffL;
    totalConductanceInvMohm += wEffL / (layerRSqMohm(layer) * pathEstMm);
    cuCrossSectionMm2 += wEffL * layerCuMm(layer);
  }

  // Conservative floor: if routed segments exist and total wEffSeg < avgSegW, ensure at least avgSegW on dominant segment layer
  if (st.segCount > 0 && wEffSegSum < avgSegW) {
    const deltaW = avgSegW - wEffSegSum;
    wEffGeomTotalMm += deltaW;
    totalConductanceInvMohm += deltaW / (layerRSqMohm(dominantSegLayer) * pathEstMm);
    cuCrossSectionMm2 += deltaW * layerCuMm(dominantSegLayer);
  }

  const rCopperMohm = totalConductanceInvMohm > 1e-6
    ? 1 / totalConductanceInvMohm
    : R_SQ_INNER_MOHM * (pathEstMm / 0.10);

  const effParallelTh = Math.max(1, (st.viasThrough + st.viasBlind * 0.8 + st.viasMicro * 0.35) / 2.5);
  const rViaTransitionMohm = (2 * R_VIA_TH_MOHM) / effParallelTh;
  const rTotalMohm = rCopperMohm + rViaTransitionMohm;
  const dvMv = iPeakA * rTotalMohm;

  // IPC-2152 Conservative Temperature Rise using exact mixed 1oz-outer / 0.5oz-inner copper cross-section!
  //   I = k * dT^0.44 * A_mil2^0.725  =>  dT = (I / (k * A_mil2^0.725))^(1/0.44)
  const cuAreaMil2 = cuCrossSectionMm2 * 1550.0031;
  const hasOuterCu =
    (st.zoneAreaByLayer['F.Cu'] || 0) > 1.0 ||
    (st.zoneAreaByLayer['B.Cu'] || 0) > 1.0 ||
    (st.segAreaByLayer['F.Cu'] || 0) > 0.5 ||
    (st.segAreaByLayer['B.Cu'] || 0) > 0.5;
  const kIpc = hasOuterCu ? 0.032 : 0.024;
  const dtC = Math.pow(iPeakA / (kIpc * Math.pow(Math.max(1.0, cuAreaMil2), 0.725)), 1 / 0.44);

  const outerZoneAreaMm2 = (st.zoneAreaByLayer['F.Cu'] || 0) + (st.zoneAreaByLayer['B.Cu'] || 0);
  const innerZoneAreaMm2 = st.totalZoneAreaMm2 - outerZoneAreaMm2;

  return {
    avgSegW,
    wEffGeomTotalMm,
    wEff1ozEquivMm: cuCrossSectionMm2 / 0.035,
    cuCrossSectionMm2,
    outerZoneAreaMm2,
    innerZoneAreaMm2,
    rCopperMohm,
    rViaTransitionMohm,
    rTotalMohm,
    dvMv,
    dtC,
    hasZone: !requireZone || st.totalZoneAreaMm2 > 0,
  };
}

for (const spec of PDN_SPECS) {
  const st = stats.get(spec.net);
  const ev = evaluateCopperPath(st, spec.pathEstMm, spec.iPeakA, true);
  const dvPct = (ev.dvMv / (spec.vNom * 1000)) * 100;

  const pass = ev.dvMv <= spec.maxDvMv && dvPct <= spec.maxDvPct && ev.dtC <= spec.maxDtC && ev.hasZone;
  if (!pass) {
    failures.push(
      `${spec.net}: dV=${ev.dvMv.toFixed(1)}mV (${dvPct.toFixed(2)}%, lim ${spec.maxDvMv}mV/${spec.maxDvPct}%), ` +
      `dT=${ev.dtC.toFixed(1)}C (lim ${spec.maxDtC}C), zoneArea=${st.totalZoneAreaMm2.toFixed(1)}mm2 ` +
      `(1oz=${ev.outerZoneAreaMm2.toFixed(1)}mm2, 0.5oz=${ev.innerZoneAreaMm2.toFixed(1)}mm2)`
    );
  }
  results.push({
    net: spec.net,
    description: spec.desc,
    vNomV: spec.vNom,
    iPeakA: spec.iPeakA,
    pathEstMm: spec.pathEstMm,
    routedSegs: st.segCount,
    avgSegWidthMm: +ev.avgSegW.toFixed(3),
    maxSegWidthMm: +st.maxSegWidthMm.toFixed(3),
    filledZoneLayers: [...st.zoneLayers],
    filledZoneAreaMm2: +st.totalZoneAreaMm2.toFixed(2),
    outer1ozZoneAreaMm2: +ev.outerZoneAreaMm2.toFixed(2),
    inner05ozZoneAreaMm2: +ev.innerZoneAreaMm2.toFixed(2),
    viasTotal: st.viasTotal,
    viasThrough: st.viasThrough,
    viasBlind: st.viasBlind,
    viasMicro: st.viasMicro,
    effectiveCopperWidthMm: +ev.wEffGeomTotalMm.toFixed(2),
    effective1ozEquivWidthMm: +ev.wEff1ozEquivMm.toFixed(2),
    rCopperMohm: +ev.rCopperMohm.toFixed(2),
    rViaMohm: +ev.rViaTransitionMohm.toFixed(2),
    rTotalMohm: +ev.rTotalMohm.toFixed(2),
    irDropMv: +ev.dvMv.toFixed(2),
    irDropPct: +dvPct.toFixed(2),
    ipc2152TempRiseC: +ev.dtC.toFixed(2),
    status: pass ? 'PASS' : 'FAIL',
  });
}

// 6. Audit TI BQ27Z561-R2 Si-C Fuel Gauge Real PCB Copper Wiring (5A Return + 4T Kelvin Sense!)
const vbatNegSt = stats.get('VBAT_NEG_PACK');
const vbatNegEv = evaluateCopperPath(vbatNegSt, 4.5, 5.0, false);
const fgKelvinNets = ['FG_CSP_RAW', 'FG_CSN_RAW', 'FG_CSP', 'FG_CSN'].map((n) => {
  const s = stats.get(n);
  return {
    net: n,
    routedSegs: s.segCount,
    totalLenMm: +s.totalSegLenMm.toFixed(2),
    avgWidthMm: +(s.totalSegLenMm > 0 ? s.segWidthLenSum / s.totalSegLenMm : 0).toFixed(3),
    vias: s.viasTotal,
    layers: Object.keys(s.segsByLayer),
  };
});
const fgKelvinAllRouted = fgKelvinNets.every((k) => k.routedSegs > 0);
const vbatNegPass = vbatNegSt.segCount > 0 && vbatNegEv.dvMv <= 40.0 && vbatNegEv.dtC <= 20.0;
const fuelGaugePass = fgKelvinAllRouted && vbatNegPass;
if (!fuelGaugePass) {
  failures.push(
    `BQ27Z561-R2 Fuel Gauge PCB audit failed: VBAT_NEG_PACK segs=${vbatNegSt.segCount} dV=${vbatNegEv.dvMv.toFixed(1)}mV dT=${vbatNegEv.dtC.toFixed(1)}C, Kelvin routed=${fgKelvinAllRouted}`
  );
}

const fuelGaugeAudit = {
  ic: 'U201 (TI BQ27Z561-R2 Si-C Fuel Gauge) + R202 (Vishay WSL0805 5mOhm 4-Terminal Kelvin Shunt)',
  vbatNegPackReturn: {
    net: 'VBAT_NEG_PACK',
    iPeakA: 5.0,
    pathEstMm: 4.5,
    routedSegs: vbatNegSt.segCount,
    avgSegWidthMm: +vbatNegEv.avgSegW.toFixed(3),
    maxSegWidthMm: +vbatNegSt.maxSegWidthMm.toFixed(3),
    viasTotal: vbatNegSt.viasTotal,
    rTotalMohm: +vbatNegEv.rTotalMohm.toFixed(2),
    irDropMv: +vbatNegEv.dvMv.toFixed(2),
    ipc2152TempRiseC: +vbatNegEv.dtC.toFixed(2),
    status: vbatNegPass ? 'PASS' : 'FAIL',
  },
  kelvinSenseTraces: fgKelvinNets,
  status: fuelGaugePass ? 'PASS' : 'FAIL',
};

const report = {
  board: 'RK T4 Rev 5.0 (True EVT) 14-Layer 1.200mm HDI Mainboard (Inner 0.5oz / Outer 1oz, S1000-2M 1067/1078)',
  generatedAt: new Date().toISOString(),
  assumptions: {
    outerCopperThicknessUm: 35.0,
    innerCopperThicknessUm: 17.5,
    operatingTempC: 75,
    outerSheetResistanceMohmPerSq: +R_SQ_OUTER_MOHM.toFixed(4),
    innerSheetResistanceMohmPerSq: +R_SQ_INNER_MOHM.toFixed(4),
    viaPlatingWallUm: 20,
    zoneAntipadDeratingFactor: 0.60,
    ipc2152Model: 'Per-layer exact 1oz-outer (35um) + 0.5oz-inner (17.5um) cross-section; k=0.024 internal / 0.032 with outer pour',
  },
  summary: {
    railsAudited: results.length,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: failures.length,
    worstIrDropPct: +Math.max(...results.map((r) => r.irDropPct)).toFixed(2),
    worstTempRiseC: +Math.max(...results.map((r) => r.ipc2152TempRiseC)).toFixed(2),
    oledPmicAudited: true,
    fuelGaugeSiCAudited: fuelGaugePass,
  },
  rails: results,
  fuelGaugeAudit,
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

console.log('================================================================================================================');
console.log('  RK T4 REV 5.0 (TRUE EVT) — 16-RAIL REAL-COPPER DC IR-DROP & IPC-2152 PDN AUDIT (0.5oz Inner / 1oz Outer, 75°C)');
console.log('================================================================================================================');
console.log('Rail               Vnom   Ipk   Zone(1oz/0.5oz)  Eq1ozW  Vias   R_dc     dV (mV / %)       IPC-2152 dT  Stat');
console.log('----------------------------------------------------------------------------------------------------------------');
for (const r of results) {
  const zStr = `${r.outer1ozZoneAreaMm2.toFixed(0)}/${r.inner05ozZoneAreaMm2.toFixed(0)}mm2`;
  console.log(
    `${r.net.padEnd(18)} ${r.vNomV.toFixed(2).padStart(5)}V ${r.iPeakA.toFixed(1).padStart(4)}A ` +
    `${zStr.padStart(15)} ${r.effective1ozEquivWidthMm.toFixed(2).padStart(6)}mm ` +
    `${String(r.viasTotal).padStart(4)}  ${r.rTotalMohm.toFixed(2).padStart(5)}mR ` +
    `${r.irDropMv.toFixed(1).padStart(6)}mV (${r.irDropPct.toFixed(2).padStart(4)}%)  ` +
    `${r.ipc2152TempRiseC.toFixed(2).padStart(7)}°C    ${r.status}`
  );
}
console.log('----------------------------------------------------------------------------------------------------------------');
console.log(
  `BQ27Z561-R2 Si-C Fuel Gauge: VBAT_NEG_PACK(5A) maxW=${fuelGaugeAudit.vbatNegPackReturn.maxSegWidthMm}mm ` +
  `dV=${fuelGaugeAudit.vbatNegPackReturn.irDropMv}mV dT=${fuelGaugeAudit.vbatNegPackReturn.ipc2152TempRiseC}°C | ` +
  `Kelvin Sense: ${fgKelvinNets.map((k) => `${k.net}=${k.totalLenMm}mm`).join(', ')} [${fuelGaugeAudit.status}]`
);
console.log('================================================================================================================');
console.log(`Saved -> ${REPORT_PATH} | Passed: ${report.summary.passed}/${report.summary.railsAudited} | Worst dV=${report.summary.worstIrDropPct}% | Worst dT=${report.summary.worstTempRiseC}°C`);
if (failures.length) {
  console.error('PDN IR-DROP / AMPACITY FAILURES:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}

