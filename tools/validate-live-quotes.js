#!/usr/bin/env node
/* Quest winter system — validate the shared engine against REAL saved quotes.
 *
 * The fixtures in tools/price-fixtures.js are shapes I invented. This checks
 * the engine against quotes that actually exist in the spreadsheet: it takes
 * each row's stored payload.state (exactly what the customer selected) and
 * confirms computeQuote() reproduces the payload.lines that were saved and
 * shown to that customer — label, calc recipe, amount, to the cent.
 *
 * Quotes carrying staff changes (payload.manual) are reported separately: the
 * saved lines there are base lines PLUS the journal replay, which is server
 * logic, so a raw engine comparison would be apples-to-oranges. For those the
 * engine is compared against the base lines only, ignoring lines the journal
 * added.
 *
 *   node tools/validate-live-quotes.js <payloads.json>
 *
 * Input is an array of {quoteNo, tab, payload}. No customer PII is printed —
 * quotes are identified by number only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require(path.resolve(__dirname, '..', 'pricing-engine.js'));

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toFixed(2);
let clean = 0, dirty = 0, failed = 0, skipped = 0;

for (const row of rows) {
  const p = row.payload;
  if (!p || !p.state || !Array.isArray(p.lines)) { skipped++; continue; }

  const out = E.computeQuote(p.state);
  const got = out.lines;
  const want = p.lines;

  const m = p.manual;
  const hasManual = !!(m && ((m.edits || []).length || (m.priced || []).length ||
                             (m.adjustments || []).length || (m.removed || []).length));

  // Labels the journal introduced or rewrote — not the engine's business.
  const journalLabels = new Set();
  if (hasManual) {
    (m.priced || []).forEach(x => journalLabels.add(x.label));
    (m.adjustments || []).forEach(x => journalLabels.add(x.label));
    (m.edits || []).forEach(x => { journalLabels.add(x.label); if (x.newLabel) journalLabels.add(x.newLabel); });
    (m.removed || []).forEach(l => journalLabels.add(l));
  }
  const cmpWant = want.filter(l => !journalLabels.has(l.label));
  const cmpGot = got.filter(l => !journalLabels.has(l.label));

  const norm = ls => ls.map(l => ({
    sec: l.sec || '', label: l.label,
    amt: l.amt == null ? null : Number(Number(l.amt).toFixed(4)),
    calc: l.calc || '',
  }));

  const a = JSON.stringify(norm(cmpWant), null, 1);
  const b = JSON.stringify(norm(cmpGot), null, 1);
  const savedTotal = want.reduce((s, l) => s + (Number(l.amt) || 0), 0);
  const engineTotal = got.reduce((s, l) => s + (Number(l.amt) || 0), 0);

  const tag = hasManual ? ' [staff edits — base lines only]' : '';
  if (a === b) {
    if (hasManual) dirty++; else clean++;
    const totalNote = hasManual
      ? `base ${money(engineTotal)} (saved total ${money(savedTotal)} incl. staff changes)`
      : `${money(engineTotal)}`;
    console.log(`  MATCH  ${row.quoteNo.padEnd(12)} ${String(row.tab).padEnd(16)} ${totalNote}${tag}`);
  } else {
    failed++;
    console.log(`\n### MISMATCH ${row.quoteNo} (${row.tab})${tag}`);
    const la = a.split('\n'), lb = b.split('\n');
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) console.log(`  saved:  ${la[i]}\n  engine: ${lb[i]}`);
    }
    console.log(`  saved total ${money(savedTotal)} vs engine ${money(engineTotal)}`);
  }

  for (const f of out.flags) console.log(`         ^ flag: ${f.code} — ${f.msg}`);
}

console.log(`\n${clean} clean quote(s) reproduced exactly, ${dirty} with staff edits reproduced at the base, ` +
            `${failed} mismatch(es), ${skipped} unreadable.`);
process.exit(failed ? 1 : 0);
