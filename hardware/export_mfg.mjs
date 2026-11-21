#!/usr/bin/env node
/**
 * RK T4 16-Layer Mainboard — Native KiCad 9 Manufacturing Package Exporter
 * =========================================================================
 * Uses official native `kicad-cli` (9.0.8) to verify DRC = 0 (exit code 0) and export:
 *   - 23 Gerber layers (F.Cu, In1..In14.Cu, B.Cu, F/B.Mask, F/B.Paste, F/B.SilkS, Edge.Cuts)
 *   - Excellon Drill files + Drill Map/Report
 *   - Flat ZIP package: hardware/mfg/rk_t4_mainboard_gerbers.zip
 *   - JLCPCB-formatted Pick-and-Place CPL: hardware/mfg/rk_t4_cpl_jlcpcb.csv
 *   - JLCPCB-formatted BOM: hardware/mfg/rk_t4_bom_jlcpcb.csv
 *   - Top & Bottom SVG vector plots for visual inspection
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HW_DIR = __dirname;
const MFG_DIR = path.join(HW_DIR, 'mfg');
const GERBER_DIR = path.join(MFG_DIR, 'gerbers');
const PCB_PATH = path.join(HW_DIR, 'rk_t4_mainboard.kicad_pcb');
const NETLIST_PATH = path.join(HW_DIR, 'rk_t4_netlist.json');
const DRC_REPORT_PATH = path.join(HW_DIR, 'kicad_drc_report.json');
const ZIP_PATH = path.join(MFG_DIR, 'rk_t4_mainboard_gerbers.zip');
const CPL_RAW_PATH = path.join(MFG_DIR, 'rk_t4_cpl_raw.csv');
const CPL_JLC_PATH = path.join(MFG_DIR, 'rk_t4_cpl_jlcpcb.csv');
const BOM_JLC_PATH = path.join(MFG_DIR, 'rk_t4_bom_jlcpcb.csv');

const KICAD_CLI = fs.existsSync('/home/antigravity/.local/bin/kicad-cli')
  ? '/home/antigravity/.local/bin/kicad-cli'
  : 'kicad-cli';

fs.rmSync(GERBER_DIR, { recursive: true, force: true });
fs.mkdirSync(GERBER_DIR, { recursive: true });

// 1. Native KiCad 9.0.8 DRC Gate (--exit-code-violations enforces strict 0 errors/warnings/unconnected!)
console.log('1) Running strict native KiCad DRC gate (--severity-all --all-track-errors --exit-code-violations)...');
execFileSync(
  KICAD_CLI,
  [
    'pcb', 'drc',
    '--format', 'json',
    '--severity-all',
    '--all-track-errors',
    '--units', 'mm',
    '--exit-code-violations',
    '-o', DRC_REPORT_PATH,
    PCB_PATH,
  ],
  { stdio: 'inherit' }
);
const drc = JSON.parse(fs.readFileSync(DRC_REPORT_PATH, 'utf8'));
console.log(`   DRC Verified: violations=${drc.violations.length}, unconnected=${drc.unconnected_items.length} -> PASS!`);

// 2. Export all 23 Gerber layers (Protel extensions + standard RS-274X for JLCPCB / PCBWay auto-detection)
const LAYERS = [
  'F.Cu',
  'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'In7.Cu',
  'In8.Cu', 'In9.Cu', 'In10.Cu', 'In11.Cu', 'In12.Cu', 'In13.Cu', 'In14.Cu',
  'B.Cu',
  'F.Paste', 'B.Paste',
  'F.SilkS', 'B.SilkS',
  'F.Mask', 'B.Mask',
  'Edge.Cuts',
].join(',');

console.log('2) Exporting 23 Gerber layers via kicad-cli...');
execFileSync(
  KICAD_CLI,
  [
    'pcb', 'export', 'gerbers',
    '--layers', LAYERS,
    '--subtract-soldermask',
    '--no-x2',
    '--precision', '6',
    '-o', GERBER_DIR + '/',
    PCB_PATH,
  ],
  { stdio: 'inherit' }
);

// 3. Export Excellon Drill files + Drill Report (same absolute origin as Gerbers!)
console.log('3) Exporting Excellon drill files via kicad-cli...');
execFileSync(
  KICAD_CLI,
  [
    'pcb', 'export', 'drill',
    '--format', 'excellon',
    '--drill-origin', 'absolute',
    '--excellon-units', 'mm',
    '--excellon-zeros-format', 'decimal',
    '--generate-report',
    '--report-path', path.join(MFG_DIR, 'drill_report.txt'),
    '-o', GERBER_DIR + '/',
    PCB_PATH,
  ],
  { stdio: 'inherit' }
);

// 4. Zip all Gerbers + Drills cleanly into flat ZIP root
console.log('4) Packaging hardware/mfg/rk_t4_mainboard_gerbers.zip...');
fs.rmSync(ZIP_PATH, { force: true });
const gerberFiles = fs.readdirSync(GERBER_DIR).sort();
execFileSync(
  'python3',
  [
    '-c',
    `import zipfile, os, sys
zip_path, src_dir = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for fn in sorted(os.listdir(src_dir)):
        fp = os.path.join(src_dir, fn)
        if os.path.isfile(fp):
            zf.write(fp, arcname=fn)
print(f"Packaged {len(os.listdir(src_dir))} files into {zip_path} ({os.path.getsize(zip_path)/1024:.1f} KB)")`,
    ZIP_PATH,
    GERBER_DIR,
  ],
  { stdio: 'inherit' }
);
console.log('   Gerber + Drill contents:', gerberFiles.join(', '));

// 5. Export Native KiCad Pick-and-Place Position CSV & convert to JLCPCB CPL Format
console.log('5) Exporting CPL (Pick-and-Place) via kicad-cli...');
execFileSync(
  KICAD_CLI,
  [
    'pcb', 'export', 'pos',
    '--format', 'csv',
    '--units', 'mm',
    '--side', 'both',
    '--smd-only',
    '-o', CPL_RAW_PATH,
    PCB_PATH,
  ],
  { stdio: 'inherit' }
);

const rawPosLines = fs.readFileSync(CPL_RAW_PATH, 'utf8').trim().split('\n');
const jlcCplLines = ['Designator,Mid X,Mid Y,Layer,Rotation'];
let cplCount = 0;
for (let i = 1; i < rawPosLines.length; i++) {
  // KiCad pos CSV: Ref,Val,Package,PosX,PosY,Rot,Side
  const cols = rawPosLines[i].match(/("([^"]*)"|[^,]+)/g);
  if (!cols || cols.length < 7) continue;
  const clean = (s) => s.replace(/^"|"$/g, '').trim();
  const ref = clean(cols[0]);
  if (ref === 'J901') continue; // J901 is PCB-to-PCB BGA landing array (interposer soldered during final board stackup)
  const midX = `${parseFloat(clean(cols[3])).toFixed(4)}mm`;
  const midY = `${parseFloat(clean(cols[4])).toFixed(4)}mm`;
  const rot = parseFloat(clean(cols[5])).toFixed(2);
  const layer = clean(cols[6]).toLowerCase() === 'bottom' ? 'Bottom' : 'Top';
  jlcCplLines.push(`${ref},${midX},${midY},${layer},${rot}`);
  cplCount++;
}
fs.writeFileSync(CPL_JLC_PATH, jlcCplLines.join('\n') + '\n');
console.log(`   Wrote ${CPL_JLC_PATH} (${cplCount} SMT placements).`);

// 6. Export JLCPCB BOM CSV (Comment,Designator,Footprint,LCSC Part #) from rk_t4_netlist.json
// Populate LCSC Part # ONLY from live-API-verified hardware/mfg/jlcpcb_bom_stock_audit.json (zero guessed codes!).
const AUDIT_PATH = path.join(MFG_DIR, 'jlcpcb_bom_stock_audit.json');
const VERIFIED_LCSC = {};
if (fs.existsSync(AUDIT_PATH)) {
  const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
  for (const item of audit.items || []) {
    if (item.bestMatch?.lcscCode && item.mpn) {
      VERIFIED_LCSC[item.mpn] = item.bestMatch.lcscCode;
    }
  }
}

const netlist = JSON.parse(fs.readFileSync(NETLIST_PATH, 'utf8'));
const mainComps = netlist.components.filter((c) => c.board === 'main');
const bomGroups = new Map();
for (const c of mainComps) {
  const comment = c.mpn || c.value;
  const fp = (c.pkg || 'SMD').replace(/,/g, ' ');
  const key = `${comment}|||${fp}`;
  if (!bomGroups.has(key)) bomGroups.set(key, { comment, fp, refs: [], lcsc: VERIFIED_LCSC[c.mpn] || '' });
  bomGroups.get(key).refs.push(c.ref);
}
const bomLines = ['Comment,Designator,Footprint,LCSC Part #'];
for (const g of bomGroups.values()) {
  const esc = (s) => (/[,"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  bomLines.push(`${esc(g.comment)},${esc(g.refs.join(','))},${esc(g.fp)},${g.lcsc}`);
}
fs.writeFileSync(BOM_JLC_PATH, bomLines.join('\n') + '\n');
console.log(`   Wrote ${BOM_JLC_PATH} (${bomGroups.size} BOM line items, ${mainComps.length} mainboard parts, ${Object.keys(VERIFIED_LCSC).length} API-verified LCSC codes).`);

// 7. Export Top & Bottom SVG vector plots for engineering review
console.log('6) Exporting Top & Bottom PCB SVG previews...');
execFileSync(
  KICAD_CLI,
  ['pcb', 'export', 'svg', '--layers', 'F.Cu,F.Fab,Edge.Cuts', '--page-size-mode', '2', '-o', path.join(MFG_DIR, 'rk_t4_pcb_top.svg'), PCB_PATH],
  { stdio: 'inherit' }
);
execFileSync(
  KICAD_CLI,
  ['pcb', 'export', 'svg', '--layers', 'B.Cu,B.Fab,Edge.Cuts', '--page-size-mode', '2', '-o', path.join(MFG_DIR, 'rk_t4_pcb_bot.svg'), PCB_PATH],
  { stdio: 'inherit' }
);
console.log('All manufacturing outputs generated cleanly!');
