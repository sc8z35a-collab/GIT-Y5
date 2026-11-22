#!/usr/bin/env node
/**
 * RK T4 — Automated 3D Box3 Physical Thickness & Solid-vs-Solid Interference Audit
 * Launches the real 3D WebGL viewer in headless Chrome at assembled state (explode = 0),
 * evaluates exact world-space Box3 bounds of all 11 subsystems and every child mesh/instance,
 * prints total body thickness (mm), max thickness with camera bump (mm), and EVERY real
 * penetration pair (mm) without hiding any error.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:5173/';
const SHOT_DIR = process.argv[3] || '';
const PORT = 9241;

const CHROME_BIN =
  process.env.CHROME_BIN ||
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p)) ||
  'google-chrome';

const chrome = spawn(CHROME_BIN, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu-sandbox',
  '--user-data-dir=/tmp/chrome-cdp-box3-audit',
  '--enable-webgl',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--no-proxy-server',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1280,800',
  'about:blank',
], { stdio: 'ignore' });

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForCDP() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome CDP did not start');
}

let msgId = 1;
function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const errors = [];
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = msgId++;
        return new Promise((res, rej) => {
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      errors,
      close: () => ws.close(),
    }));
    ws.addEventListener('message', (ev) => {
      const data = JSON.parse(ev.data);
      if (data.id && pending.has(data.id)) {
        const { res, rej } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) rej(new Error(data.error.message));
        else res(data.result);
      } else if (data.method === 'Runtime.exceptionThrown') {
        errors.push(`EXCEPTION: ${JSON.stringify(data.params.exceptionDetails)}`);
      } else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
        errors.push(`CONSOLE[error]: ${data.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      }
    });
    ws.addEventListener('error', reject);
  });
}

try {
  const wsUrl = await waitForCDP();
  const cdp = await connectCDP(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: URL });

  for (let i = 0; i < 60; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'Boolean(window.__RKT4?.auditIntersections)', returnByValue: true });
    if (r.result?.value) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  await cdp.send('Runtime.evaluate', { expression: 'window.__RKT4.setPaused(true);' });
  const evalRes = await cdp.send('Runtime.evaluate', {
    expression: 'window.__RKT4.auditIntersections({ forceClosed: true })',
    returnByValue: true,
  });
  const report = evalRes.result.value;
  const outReportPath = path.join(path.dirname(new globalThis.URL(import.meta.url).pathname), '3d_interference_report.json');
  fs.writeFileSync(
    outReportPath,
    JSON.stringify(
      {
        ...report,
        totalSolidMeshes: report.totalCheckedMeshes,
        totalInterferences: report.interferenceCount,
      },
      null,
      2
    )
  );

  console.log('========================================================================');
  console.log('  RK T4 — 3D BOX3 THICKNESS & PHYSICAL INTERFERENCE AUDIT REPORT        ');
  console.log('========================================================================');
  console.log(`  Body Width (X)            : ${report.bodyWidthMm.toFixed(3)} mm`);
  console.log(`  Body Height (Y)           : ${report.bodyHeightMm.toFixed(3)} mm`);
  console.log(`  Body Total Thickness (Z)  : ${report.bodyThicknessMm.toFixed(3)} mm`);
  console.log(`  Max Thickness w/ Camera   : ${report.maxThicknessWithCameraMm.toFixed(3)} mm`);
  console.log(`  Camera Protrusion         : ${report.cameraProtrusionMm.toFixed(3)} mm`);
  console.log(`  Solid Meshes Checked      : ${report.totalCheckedMeshes} (0 excluded)`);
  console.log(`  Total Interferences (>5um): ${report.interferenceCount} (Inter-Module: ${report.interModuleCount}, Intra-Module: ${report.intraModuleCount})`);
  console.log('------------------------------------------------------------------------');
  console.log('  PHYSICAL ANTI-SQUASH REALISM AUDIT:');
  const pc = report.physicalChecks;
  console.log(`    6000mAh Battery Box     : ${pc.batterySizeMm} mm -> ${pc.batteryVolumeCm3} cm3 (${pc.batteryImpliedWhPerL} Wh/L, <=860 Wh/L real Si-C: ${pc.batteryRealisticSiC ? 'PASS' : 'FAIL — PHYSICALLY TOO SMALL!'})`);
  console.log(`    Display Stack Thickness : ${pc.displayThicknessMm} mm`);
  console.log(`    Cooling VC+Graphite     : ${pc.coolingThicknessMm} mm`);
  console.log(`    Motherboard 14L+8L+Can  : ${pc.motherboardStackThicknessMm} mm`);
  console.log(`    Wireless+Rear Ceramic   : ${pc.wirelessRearThicknessMm} mm`);
  console.log('------------------------------------------------------------------------');
  console.log('  MODULE Z-STACK BOUNDS (mm):');
  for (const [id, b] of Object.entries(report.moduleBounds)) {
    console.log(
      `    ${id.padEnd(13)} Z:[${b.minZmm.toFixed(3).padStart(7)}, ${b.maxZmm.toFixed(3).padStart(7)}] (${b.sizeZmm.toFixed(3).padStart(6)} mm)  ` +
      `X:[${b.minXmm.toFixed(2).padStart(6)}, ${b.maxXmm.toFixed(2).padStart(6)}]  Y:[${b.minYmm.toFixed(2).padStart(6)}, ${b.maxYmm.toFixed(2).padStart(6)}]`
    );
  }
  console.log('------------------------------------------------------------------------');
  console.log('  MODULE-PAIR INTERFERENCE SUMMARY:');
  const pairKeys = Object.keys(report.pairSummary);
  if (pairKeys.length === 0) {
    console.log('    NONE — 0 PHYSICAL INTERFERENCES DETECTED!');
  } else {
    for (const k of pairKeys) {
      const s = report.pairSummary[k];
      console.log(`    ${k.padEnd(30)} count=${String(s.count).padStart(4)}  maxMinPen=${s.maxPenetrationMm.toFixed(3)} mm  maxOvZ=${s.maxOverlapZmm.toFixed(3)} mm`);
    }
    console.log('------------------------------------------------------------------------');
    console.log('  TOP 30 PENETRATION DETAILS (mm):');
    report.interferences.slice(0, 30).forEach((it, idx) => {
      console.log(
        `    #${String(idx + 1).padStart(2)} ${it.aModule}.${it.aPart} <-> ${it.bModule}.${it.bPart} ` +
        `| ov=(${it.overlapXmm.toFixed(3)}, ${it.overlapYmm.toFixed(3)}, ${it.overlapZmm.toFixed(3)}) mm ` +
        `| boxZ=[${it.boxMinMm[2].toFixed(2)}..${it.boxMaxMm[2].toFixed(2)}] boxX=[${it.boxMinMm[0].toFixed(1)}..${it.boxMaxMm[0].toFixed(1)}] boxY=[${it.boxMinMm[1].toFixed(1)}..${it.boxMaxMm[1].toFixed(1)}]`
      );
    });
  }
  console.log('========================================================================');

  if (SHOT_DIR) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    // Capture collision highlight + X/Y/Z cross-section slices!
    const captures = [
      {
        name: 'slice_x_section.png',
        js: `
          window.__RKT4.snap({ focusId: null, explode: 0.0, theta: -2.08, phi: 1.32, distance: 26.5 });
          window.__RKT4.setSlice({ openPanel: true, x: { enabled: true, mm: -12.0, dir: -1 }, y: { enabled: false }, z: { enabled: false } });
          window.__RKT4.setCollisionHighlight(true);
        `,
      },
      {
        name: 'slice_y_camera_section.png',
        js: `
          window.__RKT4.snap({ focusId: null, explode: 0.0, theta: -2.42, phi: 0.92, distance: 21.0 });
          window.__RKT4.setSlice({ openPanel: true, x: { enabled: false }, y: { enabled: true, mm: 56.0, dir: -1 }, z: { enabled: false } });
          window.__RKT4.setCollisionHighlight(true);
        `,
      },
      {
        name: 'slice_z_internal_section.png',
        js: `
          window.__RKT4.snap({ focusId: null, explode: 0.0, theta: -2.78, phi: 1.44, distance: 29.0 });
          window.__RKT4.setSlice({ openPanel: true, x: { enabled: false }, y: { enabled: false }, z: { enabled: true, mm: -1.40, dir: 1 } });
          window.__RKT4.setCollisionHighlight(true);
        `,
      },
    ];
    for (const c of captures) {
      await cdp.send('Runtime.evaluate', { expression: c.js });
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, c.name), Buffer.from(data, 'base64'));
      console.log('Saved screenshot:', path.join(SHOT_DIR, c.name));
    }
  }

  if (cdp.errors.length) {
    console.error('BROWSER ERRORS:', cdp.errors);
  }
  cdp.close();
  process.exitCode = report.interferenceCount === 0 && cdp.errors.length === 0 ? 0 : 1;
} finally {
  chrome.kill('SIGKILL');
}
