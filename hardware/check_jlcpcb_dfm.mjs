#!/usr/bin/env node
/**
 * Live JLCPCB Auto-DFM & Prototype Quote Inspector (Read-Only / Zero Ordering)
 * ============================================================================
 * Usage:
 *   node hardware/check_jlcpcb_dfm.mjs <gerber.zip> <out_prefix> [--thickness 0.8] [--hdi]
 *
 * Strictly read-only inspection:
 *  - Uploads Gerber ZIP to https://cart.jlcpcb.com/quote for live automatic DFM parsing & quote calculation
 *  - NEVER submits cart or places any order
 *  - NEVER solves or bypasses any CAPTCHA or anti-bot gate (aborts and reports if gated)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node hardware/check_jlcpcb_dfm.mjs <gerber.zip> <out_prefix> [--thickness 0.8] [--hdi]');
  process.exit(1);
}
const ZIP_PATH = path.resolve(args[0]);
const OUT_PREFIX = path.resolve(args[1]);
const thkIdx = args.indexOf('--thickness');
const targetThickness = thkIdx >= 0 ? args[thkIdx + 1] : null;
const viaIdx = args.indexOf('--via');
const targetVia = viaIdx >= 0 ? args[viaIdx + 1] : null;
const matIdx = args.indexOf('--material');
const targetMaterial = matIdx >= 0 ? args[matIdx + 1] : null;
const wantHdi = args.includes('--hdi');
const wantEnig = args.includes('--enig');
const wantImpedance = args.includes('--impedance');
const stepIdx = args.indexOf('--hdi-step');
const targetHdiStep = stepIdx >= 0 ? args[stepIdx + 1] : null;
const icuIdx = args.indexOf('--inner-cu');
const targetInnerCu = icuIdx >= 0 ? args[icuIdx + 1] : null;

if (!fs.existsSync(ZIP_PATH)) {
  console.error(`File not found: ${ZIP_PATH}`);
  process.exit(1);
}

const PORT = 9225 + Math.floor(Math.random() * 500);
const USER_DATA = `/tmp/jlc_chrome_${PORT}`;
fs.rmSync(USER_DATA, { recursive: true, force: true });

const chrome = spawn('/usr/bin/chromium', [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--ignore-certificate-errors',
  '--window-size=1440,2200',
  `--user-data-dir=${USER_DATA}`,
  `--remote-debugging-port=${PORT}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('Timed out waiting for Chromium CDP');
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && this.handlers.has(msg.method)) {
        for (const fn of this.handlers.get(msg.method)) fn(msg.params);
      }
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function run() {
  const wsUrl = await waitForCdp();
  const cdp = new CdpClient(wsUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');

  const capturedApi = [];
  const reqUrls = new Map();
  cdp.on('Network.requestWillBeSent', (p) => { reqUrls.set(p.requestId, p.request.url); });
  cdp.on('Network.loadingFinished', async (p) => {
    const url = reqUrls.get(p.requestId) || '';
    if (/\/(assets|static|language)\//i.test(url)) return;
    let pathname = url;
    try { pathname = new URL(url).pathname; } catch {}
    if (!/gerber|analysis|calculate|calculation|price|quote|dfm|upload|stackup|hdi|checkOrder/i.test(pathname)) return;
    if (/\.(js|css|png|jpg|svg|woff|ico|webp)(\?|$)/i.test(pathname)) return;
    try {
      const body = await cdp.send('Network.getResponseBody', { requestId: p.requestId });
      const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
      if (text && text.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(text);
          capturedApi.push({ url, time: Date.now(), data: parsed });
        } catch {}
      }
    } catch {}
  });

  console.log(`Opening https://cart.jlcpcb.com/quote for ${path.basename(ZIP_PATH)}...`);
  await cdp.send('Page.navigate', { url: 'https://cart.jlcpcb.com/quote' });
  await sleep(6000);

  const evalJs = async (expression) => {
    const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result?.value;
  };

  // Check for anti-bot / CAPTCHA gate (strict compliance: NEVER attempt to bypass!)
  const pageState = await evalJs(`({
    title: document.title,
    url: location.href,
    hasCaptcha: /captcha|turnstile|verify you are human|cloudflare/i.test(document.body?.innerText || ''),
    bodyLen: (document.body?.innerText || '').length,
    inputs: [...document.querySelectorAll('input[type="file"]')].length
  })`);
  console.log('Initial page state:', pageState);
  if (pageState?.hasCaptcha && pageState.inputs === 0) {
    console.error('BLOCKED BY CAPTCHA / ANTI-BOT GATE — aborting without bypass.');
    process.exit(2);
  }

  // Upload Gerber ZIP directly via DOM.setFileInputFiles
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const fileNode = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
  if (!fileNode?.nodeId) {
    throw new Error('Could not locate input[type="file"] on JLCPCB quote page');
  }
  console.log(`Uploading ${ZIP_PATH} (${(fs.statSync(ZIP_PATH).size / 1024).toFixed(1)} KB)...`);
  await cdp.send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [ZIP_PATH] });

  // Wait up to 150 seconds for JLCPCB CAM server Gerber DFM analysis (12L HDI takes longer than 8L)!
  let gerberParsed = null;
  for (let i = 0; i < 150; i++) {
    await sleep(1000);
    gerberParsed = capturedApi.find((a) =>
      /analysisGerber/i.test(a.url) &&
      a.data?.data &&
      a.data.data.head !== 'timeout' &&
      (a.data.data.stencilLayer != null || a.data.data.resultJson != null)
    );
    const hasQuote = capturedApi.some((a) => /calculationGoodsCostsNew/i.test(a.url) && a.time > (gerberParsed?.time || Infinity));
    if (i % 10 === 9 || (gerberParsed && hasQuote)) {
      console.log(`  t=${i + 1}s: apiCaptures=${capturedApi.length}, gerberParsed=${!!gerberParsed}, hasQuote=${hasQuote}`);
    }
    if (gerberParsed && hasQuote) { await sleep(2500); break; }
  }

  const clickOption = async (labelList) => {
    const res = await evalJs(`(() => {
      const norm = (x) => (x || '').replace(/\\s+/g, ' ').trim();
      const compact = (x) => (x || '').replace(/\\s+/g, '').toLowerCase();
      const targets = ${JSON.stringify(labelList)};
      const targetsCompact = targets.map(compact);
      const all = [...document.querySelectorAll('button, label, li, div, span')];
      const cands = [];
      for (const el of all) {
        if (el.offsetParent === null) continue;
        if (el.children.length > 4) continue;
        const txt = norm(el.innerText);
        if (!txt || txt.length > 60) continue;
        const tc = compact(txt);
        const exact = targetsCompact.some(t => tc === t);
        const partial = !exact && targetsCompact.some(t => tc.includes(t));
        if (!exact && !partial) continue;
        const disabledAncestor = el.closest('[disabled], .is-disabled, .disabled, [class*="disabled"], [class*="Disabled"]');
        const st = getComputedStyle(el);
        if (disabledAncestor || st.pointerEvents === 'none' || st.cursor === 'not-allowed' || el.disabled) continue;
        cands.push({ el, txt, exact, len: txt.length, children: el.children.length });
      }
      cands.sort((a, b) => (b.exact - a.exact) || (a.len - b.len) || (a.children - b.children));
      for (const c of cands) {
        c.el.scrollIntoView({ block: 'center' });
        c.el.click();
        return { clicked: c.txt, tag: c.el.tagName, exact: c.exact };
      }
      return false;
    })()`);
    await sleep(3500);
    return res;
  };

  if (wantHdi) {
    console.log('Clicked HDI:', await clickOption(['HDI']));
    await sleep(2500);
  }
  if (targetHdiStep) {
    console.log(`Clicked HDI step ${targetHdiStep}:`, await clickOption([targetHdiStep]));
    await sleep(2000);
  }
  if (targetThickness) {
    console.log(`Clicked thickness ${targetThickness}mm:`, await clickOption([`${targetThickness}mm`, targetThickness]));
  }
  if (targetMaterial) {
    console.log(`Clicked material ${targetMaterial}:`, await clickOption([targetMaterial]));
  }
  if (wantEnig) {
    console.log('Clicked ENIG:', await clickOption(['ENIG']));
  }
  if (targetInnerCu) {
    console.log(`Clicked inner copper ${targetInnerCu}:`, await clickOption([targetInnerCu]));
  }
  if (wantImpedance) {
    const impClicked = await evalJs(`(() => {
      const rows = [...document.querySelectorAll('div, tr, section')];
      for (const row of rows) {
        const txt = (row.innerText || '').trim();
        if (!/Impedance Control|Specify Stackup/i.test(txt) || txt.length > 260) continue;
        const btns = [...row.querySelectorAll('button, label, span, div')];
        for (const b of btns) {
          if (b.offsetParent === null || b.children.length > 2) continue;
          const bt = (b.innerText || '').trim();
          if (/^Yes$/i.test(bt) || /±10%/i.test(bt)) {
            const dis = b.closest('[disabled], .is-disabled, .disabled, [class*="disabled"]');
            if (dis || b.disabled) continue;
            b.scrollIntoView({ block: 'center' });
            b.click();
            return { clicked: bt, rowText: txt.slice(0, 80) };
          }
        }
      }
      return false;
    })()`);
    console.log('Clicked Impedance Control:', impClicked);
    await sleep(3000);
  }
  if (targetVia) {
    const clickedVia = await clickOption([targetVia]);
    console.log(`Clicked min via ${targetVia}:`, clickedVia);
    if (!clickedVia && targetVia.includes('0.1mm')) {
      console.log('Fallback to 0.15mm/(0.25/0.3mm):', await clickOption(['0.15mm/(0.25/0.3mm)']));
    }
  }
  await sleep(3500);

  // Extract comprehensive quote, DFM notices, and enabled/disabled button states from the rendered DOM
  const domSummary = await evalJs(`(() => {
    const norm = (x) => (x || '').replace(/\\s+/g, ' ').trim();
    const txt = document.body.innerText;
    const lines = txt.split('\\n').map(s => s.trim()).filter(Boolean);
    const interesting = lines.filter(l => /layer|dimension|mm|price|\\$|error|warn|notice|hdi|via|thickness|enig|pofv|manual|review|build time|impedance|copper|min|charge|offer|hole|stackup|blind|buried|step|press|lamination|kelvin|s1000|tg170|fr-4|not supported|exceed/i.test(l));
    const options = [];
    for (const el of document.querySelectorAll('button, [role="radio"], [class*="option"], [class*="Option"], li')) {
      if (el.offsetParent === null || el.children.length > 4) continue;
      const t = norm(el.innerText);
      if (!t || t.length > 45) continue;
      if (!/(^\\d+(\\.\\d+)?\\s*mm$|hdi|step|en[i1]g|s1000|fr-4|tg1|0\\.1\\s*mm|0\\.15\\s*mm|0\\.2\\s*mm|0\\.3\\s*mm|epoxy|blind|buried|any.?layer)/i.test(t)) continue;
      const cls = String(el.className || '') + ' ' + String(el.parentElement?.className || '');
      const disabled = !!(el.disabled || el.closest('[disabled], .is-disabled, .disabled, [class*="disabled"], [class*="Disabled"]') || getComputedStyle(el).cursor === 'not-allowed');
      const active = /(active|selected|checked|is-checked|primary)/i.test(cls);
      options.push({ text: t, disabled, active });
    }
    const dedupOpts = [];
    const seen = new Set();
    for (const o of options) {
      const k = o.text + '|' + o.disabled + '|' + o.active;
      if (!seen.has(k)) { seen.add(k); dedupOpts.push(o); }
    }
    return {
      url: location.href,
      title: document.title,
      interestingLines: [...new Set(interesting)].slice(0, 180),
      options: dedupOpts.slice(0, 120),
    };
  })()`);

  // Scroll to top before capturing viewport screenshot so both top DFM banner and right-hand quote card are visible
  await evalJs('window.scrollTo(0, 0)');
  await sleep(500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = `${OUT_PREFIX}.png`;
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

  const outJson = {
    timestamp: new Date().toISOString(),
    zipFile: path.basename(ZIP_PATH),
    zipBytes: fs.statSync(ZIP_PATH).size,
    requestedThickness: targetThickness,
    capturedApis: capturedApi.map((a) => ({ url: a.url, data: a.data })),
    domSummary,
  };
  const jsonPath = `${OUT_PREFIX}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(outJson, null, 2));
  console.log(`Saved JLCPCB live DFM report -> ${jsonPath} & screenshot -> ${shotPath}`);

  // Print key parsed highlights immediately
  for (const api of capturedApi) {
    const s = JSON.stringify(api.data);
    if (s.includes('dfm') || s.includes('stencilLayer') || s.includes('pcbPrice') || s.includes('totalMoney') || s.includes('minTrace') || s.includes('layer')) {
      console.log(`  [API] ${api.url.split('?')[0]} -> ${s.slice(0, 420)}`);
    }
  }
  console.log('  [DOM Highlights]:', (domSummary?.interestingLines || []).slice(0, 30).join(' | '));

  cdp.close();
}

run()
  .catch((err) => { console.error('ERROR:', err); process.exitCode = 1; })
  .finally(() => {
    try { chrome.kill('SIGKILL'); } catch {}
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });
