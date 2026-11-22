#!/usr/bin/env node
/**
 * Live JLCPCB SMT Parts Library Stock Audit for RK T4 Mainboard BOM
 * Queries JLCPCB's public SMT component catalog for every unique MPN in
 * hardware/mfg/rk_t4_bom_jlcpcb.csv with strict MPN matching (zero fuzzy faking).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/antigravity/sc8z35a-collab/GIT-Y5';
const BOM_CSV = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'hardware/mfg/rk_t4_bom_jlcpcb.csv');
const OUT_JSON = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'hardware/mfg/jlcpcb_bom_stock_audit.json');
const API_URL = 'https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList';

const PCB_COPPER_FEATURES = new Set([
  'TP_0.8MM_ENIG',
  'WPC_SPRING_2P',
  'EARPIECE_PAD_2P',
]);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function norm(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function queryJlc(keyword, pageSize = 20) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ keyword, pageSize, currentPage: 1 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json?.data?.componentPageInfo?.list || [];
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
  return [];
}

function scoreMatch(mpn, item) {
  const m = norm(mpn);
  const c = norm(item.componentModelEn);
  if (!c) return 0;
  if (c === m) return 100;
  // Exact match ignoring trailing tape/reel suffix like -T, -TR, /TR, -R, =P2, #PBF
  const stripReel = (s) => s.replace(/(TR|T3|T1|R|P2|L|D)$/, '');
  if (m.length >= 6 && c.startsWith(m) && c.length - m.length <= 4) return 85;
  if (c.length >= 6 && m.startsWith(c) && m.length - c.length <= 4) return 80;
  const ms = stripReel(m);
  const cs = stripReel(c);
  if (ms.length >= 7 && cs === ms) return 75;
  return 0;
}

function unitPrice(item, qty) {
  const prices = item.componentPrices || [];
  if (!prices.length) return null;
  for (const p of prices) {
    if (qty >= p.startNumber && (p.endNumber === -1 || qty <= p.endNumber)) {
      return Number(p.productPrice);
    }
  }
  return Number(prices[0].productPrice);
}

async function main() {
  const lines = fs.readFileSync(BOM_CSV, 'utf8').trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const [mpn, desStr, footprint, lcscInput] = parseCsvLine(lines[i]);
    const designators = desStr.split(',').map(s => s.trim()).filter(Boolean);
    rows.push({ mpn: mpn.trim(), designators, qty: designators.length, footprint: footprint.trim(), lcscInput: (lcscInput || '').trim() });
  }

  console.log(`Auditing ${rows.length} BOM lines (${rows.reduce((a, r) => a + r.qty, 0)} placements) against live JLCPCB SMT Parts Library...`);

  const results = [];
  let idx = 0;

  for (const row of rows) {
    idx++;
    if (PCB_COPPER_FEATURES.has(row.mpn)) {
      results.push({
        ...row,
        status: 'PCB_COPPER_PAD_ONLY',
        matchType: 'NONE_NEEDED',
        bestMatch: null,
        lcscInputCheck: null,
      });
      continue;
    }

    // Query by MPN
    let candidates = await queryJlc(row.mpn, 20);
    // Also try trimmed base keyword if zero results and MPN has spaces or special suffixes
    if (candidates.length === 0 && /[\s(=/]/.test(row.mpn)) {
      const alt = row.mpn.split(/[\s(=/]/)[0];
      if (alt.length >= 5) {
        candidates = await queryJlc(alt, 20);
      }
    }

    // Score strictly
    const scored = candidates
      .map(item => ({ item, score: scoreMatch(row.mpn, item) }))
      .filter(x => x.score >= 75)
      .sort((a, b) => {
        // Prefer exact match, then in-stock, then basic library, then higher stock
        if (b.score !== a.score) return b.score - a.score;
        const aIn = (a.item.stockCount || 0) >= row.qty * 5 ? 1 : 0;
        const bIn = (b.item.stockCount || 0) >= row.qty * 5 ? 1 : 0;
        if (bIn !== aIn) return bIn - aIn;
        const aBasic = a.item.componentLibraryType === 'base' ? 1 : 0;
        const bBasic = b.item.componentLibraryType === 'base' ? 1 : 0;
        if (bBasic !== aBasic) return bBasic - aBasic;
        return (b.item.stockCount || 0) - (a.item.stockCount || 0);
      });

    // If LCSC input code was provided in BOM, check it specifically too
    let lcscInputCheck = null;
    if (row.lcscInput) {
      const lcscList = await queryJlc(row.lcscInput, 5);
      const exactLcsc = lcscList.find(x => String(x.componentCode).toUpperCase() === row.lcscInput.toUpperCase());
      lcscInputCheck = exactLcsc ? {
        code: exactLcsc.componentCode,
        model: exactLcsc.componentModelEn,
        brand: exactLcsc.componentBrandEn,
        stockCount: exactLcsc.stockCount,
        libraryType: exactLcsc.componentLibraryType,
        matchesMpn: scoreMatch(row.mpn, exactLcsc) >= 75,
      } : { code: row.lcscInput, found: false };
    }

    const best = scored[0];
    if (!best) {
      results.push({
        ...row,
        status: 'NOT_IN_JLCPCB_LIBRARY',
        matchType: 'NO_MATCH',
        rawCandidateCount: candidates.length,
        bestMatch: null,
        lcscInputCheck,
      });
    } else {
      const it = best.item;
      const stock = Number(it.stockCount || 0);
      const req5 = row.qty * 5;
      let status = 'IN_STOCK_5X';
      if (stock === 0) status = 'OUT_OF_STOCK';
      else if (stock < row.qty) status = 'INSUFFICIENT_FOR_1X';
      else if (stock < req5) status = 'LOW_STOCK_UNDER_5X';

      results.push({
        ...row,
        status,
        matchType: best.score === 100 ? 'EXACT_MPN' : 'VARIANT_MPN',
        matchScore: best.score,
        bestMatch: {
          lcscCode: it.componentCode,
          model: it.componentModelEn,
          brand: it.componentBrandEn,
          package: it.componentSpecificationEn,
          libraryType: it.componentLibraryType, // 'base' or 'expand'
          stockCount: stock,
          unitPriceUsd5x: unitPrice(it, req5),
          extCostUsd5x: unitPrice(it, req5) != null ? Number((unitPrice(it, req5) * req5).toFixed(4)) : null,
          category: it.componentTypeEn,
        },
        lcscInputCheck,
      });
    }

    if (idx % 15 === 0 || idx === rows.length) {
      console.log(`  [${idx}/${rows.length}] processed...`);
    }
    await new Promise(r => setTimeout(r, 80));
  }

  // Aggregate statistics
  const summary = {
    auditedAt: new Date().toISOString(),
    totalBomLines: rows.length,
    totalPlacementsPerBoard: rows.reduce((a, r) => a + r.qty, 0),
    physicalComponentLines: results.filter(r => r.status !== 'PCB_COPPER_PAD_ONLY').length,
    physicalPlacementsPerBoard: results.filter(r => r.status !== 'PCB_COPPER_PAD_ONLY').reduce((a, r) => a + r.qty, 0),
    pcbCopperPadLines: results.filter(r => r.status === 'PCB_COPPER_PAD_ONLY').length,
    pcbCopperPadCount: results.filter(r => r.status === 'PCB_COPPER_PAD_ONLY').reduce((a, r) => a + r.qty, 0),
    byStatus: {},
    byStatusPlacements: {},
    basicLibraryLines: results.filter(r => r.bestMatch?.libraryType === 'base').length,
    extendedLibraryLines: results.filter(r => r.bestMatch?.libraryType === 'expand').length,
    inStockMatchedPartsCost5BoardsUsd: Number(
      results
        .filter(r => r.status === 'IN_STOCK_5X' && r.bestMatch?.extCostUsd5x != null)
        .reduce((a, r) => a + r.bestMatch.extCostUsd5x, 0)
        .toFixed(2)
    ),
    lcscCodeMismatches: results.filter(r => r.lcscInputCheck && (!r.lcscInputCheck.matchesMpn || r.lcscInputCheck.found === false)).map(r => ({
      mpn: r.mpn,
      bomLcsc: r.lcscInput,
      actualLookup: r.lcscInputCheck,
      recommendedLcsc: r.bestMatch?.lcscCode || null,
    })),
  };

  for (const r of results) {
    summary.byStatus[r.status] = (summary.byStatus[r.status] || 0) + 1;
    summary.byStatusPlacements[r.status] = (summary.byStatusPlacements[r.status] || 0) + r.qty;
  }

  const report = { summary, items: results };
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  console.log('\n================ JLCPCB LIVE BOM STOCK AUDIT SUMMARY ================');
  console.log(JSON.stringify(summary, null, 2));

  console.log('\n--- OUT OF STOCK (IN CATALOG, STOCK = 0) ---');
  for (const r of results.filter(x => x.status === 'OUT_OF_STOCK' || x.status === 'INSUFFICIENT_FOR_1X' || x.status === 'LOW_STOCK_UNDER_5X')) {
    console.log(`  [${r.status}] ${r.mpn} (qty=${r.qty}, fp=${r.footprint}) -> ${r.bestMatch.lcscCode} (${r.bestMatch.model}) stock=${r.bestMatch.stockCount} [${r.bestMatch.libraryType}]`);
  }

  console.log('\n--- NOT IN JLCPCB SMT LIBRARY (CONSIGNMENT / DISTRIBUTOR REQUIRED) ---');
  for (const r of results.filter(x => x.status === 'NOT_IN_JLCPCB_LIBRARY')) {
    console.log(`  [NOT_IN_LIB] ${r.mpn} (qty=${r.qty}, fp=${r.footprint}, des=${r.designators.slice(0, 4).join(',')}${r.designators.length > 4 ? '...' : ''})`);
  }

  console.log('\n--- IN STOCK (5+ BOARDS) SAMPLE & MATCH DETAILS ---');
  for (const r of results.filter(x => x.status === 'IN_STOCK_5X')) {
    console.log(`  [IN_STOCK] ${r.mpn} x${r.qty} -> ${r.bestMatch.lcscCode} (${r.bestMatch.model}, ${r.bestMatch.package}) [${r.bestMatch.libraryType}] stock=${r.bestMatch.stockCount} $${r.bestMatch.unitPriceUsd5x}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
