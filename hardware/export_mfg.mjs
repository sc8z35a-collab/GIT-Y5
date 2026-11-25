#!/usr/bin/env node
/**
 * RK T4 Rev 5.0 (True EVT) — Dual-Board Native KiCad 9 Manufacturing Package Exporter
 * ===================================================================================
 * Supports exporting either or both verified boards:
 *   - Mainboard (`--board main`): 14-Layer 1.200 mm 3+8+3 Staggered HDI (Inner 0.5oz / Outer 1oz, S1000-2M 1067/1078)
 *   - Mezzanine (`--board mezz`): 8-Layer 0.800 mm JLC08081H-1080A 5G RF CPWG (15 Gerbers + POFV Excellon drill)
 *   - Default (no flag): exports BOTH boards!
 *
 * Strictly gates EVERY board through official native
 * `kicad-cli pcb drc --severity-all --all-track-errors --schematic-parity --exit-code-violations`
 * (pass `--allow-drc-report-only` ONLY if inspecting partial/diagnostic builds — never for release!).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HW_DIR = __dirname;
const MFG_DIR = path.join(HW_DIR, 'mfg');
const NETLIST_PATH = path.join(HW_DIR, 'rk_t4_netlist.json');
const AUDIT_PATH = path.join(MFG_DIR, 'jlcpcb_bom_stock_audit.json');

const KICAD_CLI = fs.existsSync('/home/antigravity/.local/bin/kicad-cli')
  ? '/home/antigravity/.local/bin/kicad-cli'
  : 'kicad-cli';

const args = process.argv.slice(2);
const boardArgIdx = args.indexOf('--board');
const boardArg = boardArgIdx >= 0 ? args[boardArgIdx + 1] : 'both';
const allowNonZeroDrc = args.includes('--allow-drc-report-only');

const netlist = JSON.parse(fs.readFileSync(NETLIST_PATH, 'utf8'));
const VERIFIED_LCSC = {};
if (fs.existsSync(AUDIT_PATH)) {
  const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
  for (const item of audit.items || []) {
    if (item.bestMatch?.lcscCode && item.mpn) VERIFIED_LCSC[item.mpn] = item.bestMatch.lcscCode;
  }
}

const BOARDS = {
  main: {
    key: 'main',
    title: 'RK T4 Mainboard (14-Layer 1.200mm 3+8+3 HDI, Inner 0.5oz / Outer 1oz, Spread-Glass 1067/1078)',
    pcbPath: path.join(HW_DIR, 'rk_t4_mainboard.kicad_pcb'),
    drcPath: path.join(HW_DIR, 'kicad_drc_report.json'),
    gerberDir: path.join(MFG_DIR, 'gerbers'),
    zipPath: path.join(MFG_DIR, 'rk_t4_mainboard_gerbers.zip'),
    drillReportPath: path.join(MFG_DIR, 'drill_report.txt'),
    cplRawPath: path.join(MFG_DIR, 'rk_t4_cpl_raw.csv'),
    cplJlcPath: path.join(MFG_DIR, 'rk_t4_cpl_jlcpcb.csv'),
    bomJlcPath: path.join(MFG_DIR, 'rk_t4_bom_jlcpcb.csv'),
    svgTopPath: path.join(MFG_DIR, 'rk_t4_pcb_top.svg'),
    svgBotPath: path.join(MFG_DIR, 'rk_t4_pcb_bot.svg'),
    layers: [
      'F.Cu',
      'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu',
      'In7.Cu', 'In8.Cu', 'In9.Cu', 'In10.Cu', 'In11.Cu', 'In12.Cu',
      'B.Cu',
      'F.Paste', 'B.Paste', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts',
    ],
  },
  mezz: {
    key: 'mezz',
    title: 'RK T4 5G RF Mezzanine (8-Layer 0.800mm JLC08081H-1080A CPWG, Rev 5.0 EVT)',
    pcbPath: path.join(HW_DIR, 'rk_t4_mezzanine.kicad_pcb'),
    drcPath: path.join(HW_DIR, 'kicad_mezz_drc_report.json'),
    gerberDir: path.join(MFG_DIR, 'gerbers_mezz'),
    zipPath: path.join(MFG_DIR, 'rk_t4_mezzanine_gerbers.zip'),
    drillReportPath: path.join(MFG_DIR, 'drill_report_mezz.txt'),
    cplRawPath: path.join(MFG_DIR, 'rk_t4_mezz_cpl_raw.csv'),
    cplJlcPath: path.join(MFG_DIR, 'rk_t4_mezz_cpl_jlcpcb.csv'),
    bomJlcPath: path.join(MFG_DIR, 'rk_t4_mezz_bom_jlcpcb.csv'),
    svgTopPath: path.join(MFG_DIR, 'rk_t4_mezz_top.svg'),
    svgBotPath: path.join(MFG_DIR, 'rk_t4_mezz_bot.svg'),
    layers: [
      'F.Cu',
      'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu',
      'B.Cu',
      'F.Paste', 'B.Paste', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts',
    ],
  },
};

function exportBoard(cfg) {
  console.log(`\n========================================================================`);
  console.log(`EXPORTING: ${cfg.title}`);
  console.log(`========================================================================`);

  fs.rmSync(cfg.gerberDir, { recursive: true, force: true });
  fs.mkdirSync(cfg.gerberDir, { recursive: true });

  // 1. Native KiCad 9 DRC Gate (including --schematic-parity and isolated_copper=error)
  console.log('1) Running native KiCad 9 DRC (--severity-all --all-track-errors --schematic-parity)...');
  const drcArgs = [
    'pcb', 'drc', '--format', 'json', '--severity-all', '--all-track-errors', '--schematic-parity', '--units', 'mm',
    '-o', cfg.drcPath, cfg.pcbPath,
  ];
  if (!allowNonZeroDrc) drcArgs.splice(7, 0, '--exit-code-violations');
  execFileSync(KICAD_CLI, drcArgs, { stdio: 'inherit' });
  const drc = JSON.parse(fs.readFileSync(cfg.drcPath, 'utf8'));
  const parityCount = (drc.schematic_parity || []).length;
  const isoCopperCount = (drc.violations || []).filter((v) => v.type === 'isolated_copper').length;
  console.log(
    `   DRC Result: violations=${drc.violations.length}, unconnected=${drc.unconnected_items.length}, ` +
    `schematic_parity=${parityCount}, isolated_copper=${isoCopperCount}`
  );
  if (!allowNonZeroDrc && (drc.violations.length || drc.unconnected_items.length || parityCount || isoCopperCount)) {
    throw new Error(`KiCad 9 DRC/parity gate failed on ${cfg.key}`);
  }

  // 2. Export Gerbers (Protel + RS-274X)
  console.log(`2) Exporting ${cfg.layers.length} Gerber layers via kicad-cli...`);
  execFileSync(
    KICAD_CLI,
    [
      'pcb', 'export', 'gerbers',
      '--layers', cfg.layers.join(','),
      '--subtract-soldermask',
      '--no-x2',
      '--precision', '6',
      '-o', cfg.gerberDir + '/',
      cfg.pcbPath,
    ],
    { stdio: 'inherit' }
  );

  // 3. Export Excellon Drill files (automatically outputs separate blind/buried/through layer-pair .drl files!)
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
      '--report-path', cfg.drillReportPath,
      '-o', cfg.gerberDir + '/',
      cfg.pcbPath,
    ],
    { stdio: 'inherit' }
  );

  // 4. Zip all Gerbers + Drills cleanly into flat ZIP root
  console.log(`4) Packaging ${path.basename(cfg.zipPath)}...`);
  fs.rmSync(cfg.zipPath, { force: true });
  const gerberFiles = fs.readdirSync(cfg.gerberDir).sort();
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
print(f"   Packaged {len(os.listdir(src_dir))} files into {zip_path} ({os.path.getsize(zip_path)/1024:.1f} KB)")`,
      cfg.zipPath,
      cfg.gerberDir,
    ],
    { stdio: 'inherit' }
  );
  console.log('   Contents:', gerberFiles.join(', '));

  // 5. Export Native KiCad CPL -> JLCPCB format
  console.log('5) Exporting Pick-and-Place CPL...');
  execFileSync(
    KICAD_CLI,
    ['pcb', 'export', 'pos', '--format', 'csv', '--units', 'mm', '--side', 'both', '--smd-only', '-o', cfg.cplRawPath, cfg.pcbPath],
    { stdio: 'inherit' }
  );
  const rawPosLines = fs.readFileSync(cfg.cplRawPath, 'utf8').trim().split('\n');
  const jlcCplLines = ['Designator,Mid X,Mid Y,Layer,Rotation'];
  let cplCount = 0;
  for (let i = 1; i < rawPosLines.length; i++) {
    const cols = rawPosLines[i].match(/("([^"]*)"|[^,]+)/g);
    if (!cols || cols.length < 7) continue;
    const clean = (s) => s.replace(/^"|"$/g, '').trim();
    const ref = clean(cols[0]);
    if (ref === 'J901') continue;
    const midX = `${parseFloat(clean(cols[3])).toFixed(4)}mm`;
    const midY = `${parseFloat(clean(cols[4])).toFixed(4)}mm`;
    const rot = parseFloat(clean(cols[5])).toFixed(2);
    const layer = clean(cols[6]).toLowerCase() === 'bottom' ? 'Bottom' : 'Top';
    jlcCplLines.push(`${ref},${midX},${midY},${layer},${rot}`);
    cplCount++;
  }
  fs.writeFileSync(cfg.cplJlcPath, jlcCplLines.join('\n') + '\n');
  console.log(`   Wrote ${cfg.cplJlcPath} (${cplCount} SMT placements).`);

  // 6. Export JLCPCB BOM CSV
  const comps = netlist.components.filter((c) => c.board === cfg.key && c.ref !== 'J901');
  const bomGroups = new Map();
  for (const c of comps) {
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
  fs.writeFileSync(cfg.bomJlcPath, bomLines.join('\n') + '\n');
  console.log(`   Wrote ${cfg.bomJlcPath} (${bomGroups.size} BOM lines, ${comps.length} parts).`);

  // 7. Export Top & Bottom SVG vector plots
  console.log('6) Exporting Top & Bottom PCB SVG previews...');
  execFileSync(KICAD_CLI, ['pcb', 'export', 'svg', '--layers', 'F.Cu,F.Fab,Edge.Cuts', '--page-size-mode', '2', '-o', cfg.svgTopPath, cfg.pcbPath], { stdio: 'inherit' });
  execFileSync(KICAD_CLI, ['pcb', 'export', 'svg', '--layers', 'B.Cu,B.Fab,Edge.Cuts', '--page-size-mode', '2', '-o', cfg.svgBotPath, cfg.pcbPath], { stdio: 'inherit' });
}

if (boardArg === 'main' || boardArg === 'both') exportBoard(BOARDS.main);
if (boardArg === 'mezz' || boardArg === 'both') exportBoard(BOARDS.mezz);
console.log('\nAll requested Rev 5.0 EVT manufacturing packages generated cleanly!');
