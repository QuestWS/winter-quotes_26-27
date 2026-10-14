#!/usr/bin/env node
/* Receivables — executed against a fake sheet.
   ---------------------------------------------------------------------------
   The console's Receivables card shows the newest payments across the season
   and every customer by payment status (receivablesBuild_ in the .gs). Money
   on a screen that disagrees with the sheet is worse than no screen, so the
   real builder is RUN here over quotes covering every bucket and every trap:

     UNPAID    priced, nothing paid                       → unpaid
     PART      deposit recorded before `at` existed       → partial
     FULL      paid in full, stamped with at/by           → paid
     CRED      overpaid then partly refunded              → credit (signed, never clamped)
     SKIP      not storing this season, with a deposit    → notstoring, out of the total
     ZERO      no total, no payment                       → counted as unpriced, not listed
     BROKEN    payload will not parse                     → still listed, from the columns
     DRAFT     on the Import tab, with a payment          → nowhere at all

   Both read routes are run — the batch grid and the per-tab fallback — and
   must give the same answer. Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

function fn(n) {
  const one = gas.match(new RegExp('^function ' + n + '\\b.*}\\s*$', 'm'));
  if (one) return one[0];
  const m = gas.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n);
  return m[0];
}
const decl = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;', 'm'));
  if (!m) throw new Error('missing const ' + n);
  return m[0];
};
const COL = (new Function(decl('COL') + '; return COL;'))();
const HL = 23;

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);
const near = (a, b) => Math.abs(a - b) < 0.005;

const CUR = '2026–2027';
const Q = [
  { qn: 'UNPAID', last: 'Able',  total: 900, pays: [] },
  { qn: 'PART',   last: 'Baker', total: 900, pays: [{ amt: 300, method: 'Check #1', date: '9/20/2026' }] },
  { qn: 'FULL',   last: 'Cole',  total: 500, contract: 1,
    pays: [{ amt: 500, method: 'Zelle', date: '10/12/2026', at: '2026-10-12T15:30:00.000Z', by: 'Jeff' }] },
  { qn: 'CRED',   last: 'Dunn',  total: 400,
    pays: [{ amt: 500, method: 'Cash', date: '10/1/2026' }, { amt: -50, method: 'Refund', date: '10/1/2026' }] },
  { qn: 'SKIP',   last: 'Eads',  total: 700, ns: 1, pays: [{ amt: 100, method: 'Card', date: '8/1/2026' }] },
  { qn: 'ZERO',   last: 'Fry',   total: 0,   pays: [] },
  { qn: 'BROKEN', last: 'Gage',  total: 200, broken: 1, pays: [] },
];

function row(q) {
  const x = new Array(HL).fill('');
  x[COL.LAST - 1] = q.last; x[COL.FIRST - 1] = 'Pat'; x[COL.QN - 1] = q.qn; x[COL.UNIT - 1] = 'Boat';
  x[COL.PHONE - 1] = '8155551212'; x[COL.STATUS - 1] = 'Quote saved';
  const paid = q.pays.reduce((a, p) => a + p.amt, 0);
  x[COL.TOTAL - 1] = q.total; x[COL.PAID - 1] = paid; x[COL.BAL - 1] = q.total - paid;
  const d = { quoteNo: q.qn, total: q.total, payments: q.pays };
  if (q.contract) d.contractUrl = 'https://drive/x';
  if (q.ns) d.notStoring = { season: CUR, note: 'skipping', by: 'Chris', at: '2026-10-03T12:00:00Z' };
  x[COL.PAYLOAD - 1] = q.broken ? '{not json' : JSON.stringify(d);
  return x;
}
function tab(name, quotes) {
  const grid = quotes.map(row);
  return {
    grid,
    getName: () => name,
    getLastRow: () => grid.length + 1,
    getRange: (r, c, nr, nc) => nr === undefined
      ? { getValue: () => (r === 1 && c === 3) ? 'Quote #' : grid[r - 2][c - 1] }
      : { getValues: () => grid.slice(r - 2, r - 2 + nr).map(rw => rw.slice(c - 1, c - 1 + (nc || 1))) }
  };
}
const SHEETS = [
  tab('Inside', Q.slice(0, 4)),
  tab('Outside', Q.slice(4)),
  tab('Import', [{ qn: 'DRAFT', last: 'Hale', total: 300, pays: [{ amt: 300, method: 'Cash', date: '10/13/2026' }] }]),
];
/* What quoteTabGrids_ hands back for these spans: header row + data rows. */
function gridsFor(sheets, spans) {
  return sheets.map((sh) => spans.map((sp) => [['hdr']].concat(sh.grid.map(r => r.slice(sp[0] - 1, sp[1])))));
}

function build(batch) {
  const put = [];
  const src = [
    "const SEASON={seasonLabel:'" + CUR + "'};", decl('COL'),
    "const STARTED_TAB='Quote Started'; const IMPORT_TAB='Import';",
    fn('isStartedTab_'), fn('isImportTab_'), fn('isOffstageTab_'),
    fn('notStoringActive_'), fn('paymentsTotal_'),
    decl('STORAGE_VIEW_TTL_'), decl('RECEIVABLES_V_'), decl('RECEIVABLES_TX_MAX_'),
    'let _gridsRoute_ = "batch";',
    'function fmtPhone(v){ return v; }',
    'function cacheGetBig_(){ return null; }',
    'function cachePutBig_(k, s){ PUT.push(k); return true; }',
    'function quoteTabGrids_(ss, sheets, spans){ return BATCH ? GRIDS(sheets, spans) : null; }',
    fn('paymentWhen_'), fn('receivablesBuild_'),
    'return receivablesBuild_({});'
  ].join('\n');
  const out = new Function('SpreadsheetApp', 'BATCH', 'GRIDS', 'PUT', src)(
    { getActiveSpreadsheet: () => ({ getSheets: () => SHEETS }) }, batch, gridsFor, put);
  out._put = put;
  return out;
}

for (const batch of [true, false]) {
  console.log('=== receivablesBuild_ — ' + (batch ? 'batch read' : 'per-tab fallback') + ' ===');
  const r = build(batch);
  const by = {}; (r.customers || []).forEach(c => { by[c.qn] = c; });
  const want = { UNPAID: 'unpaid', PART: 'partial', FULL: 'paid', CRED: 'credit', SKIP: 'notstoring', BROKEN: 'unpaid' };
  Object.keys(want).forEach((qn) => {
    if (!by[qn]) fail(qn + ' is missing from the customer list');
    else if (by[qn].bucket !== want[qn]) fail(qn + ' is in "' + by[qn].bucket + '", expected "' + want[qn] + '"');
  });
  if (!bad) ok('every quote lands in the right bucket');
  if (by.ZERO || r.unpriced !== 1) fail('the unpriced quote is listed, or not counted (' + r.unpriced + ')');
  else ok('a quote with no total and no payment is counted, not listed');
  if (by.DRAFT || (r.tx || []).some(t => t.qn === 'DRAFT')) fail('an Import-tab draft reached the receivables');
  else ok('Import-tab drafts are left out, payments and all');
  if (!by.CRED || !near(by.CRED.bal, -50)) fail('the credit is not a signed −$50 (' + (by.CRED && by.CRED.bal) + ')');
  else ok('a credit stays negative — never clamped');
  if (!by.BROKEN || !near(by.BROKEN.bal, 200)) fail('a row with a broken payload lost its balance');
  else ok('a broken payload still lists from the columns');
  const t = r.totals || {};
  if (!near(t.outstanding, 900 + 600 + 200)) fail('outstanding is ' + t.outstanding + ', expected 1700 (not-storing excluded)');
  else ok('outstanding = unpaid + partial, not-storing left out');
  if (!near(t.credit, 50)) fail('credits due is ' + t.credit + ', expected 50');
  else ok('credits due adds up');
  if (!near(t.collected, 300 + 500 + 500 - 50 + 100)) fail('collected is ' + t.collected + ', expected 1350 (refunds net, not-storing deposit in)');
  else ok('collected nets refunds and keeps money taken on a not-storing quote');
  const order = (r.tx || []).map(x => x.qn + ':' + x.amt).join(' ');
  const wantOrder = 'FULL:500 CRED:-50 CRED:500 PART:300 SKIP:100';
  if (order !== wantOrder) fail('transactions out of order: ' + order + ' — expected ' + wantOrder);
  else ok('transactions newest first; a same-day refund sorts above its payment');
  if (r.txCount !== 5) fail('txCount is ' + r.txCount + ', expected 5');
  const full = (r.tx || [])[0] || {};
  if (full.by !== 'Jeff' || !full.at) fail('who/when did not carry through on a stamped payment');
  else ok('a stamped payment carries who recorded it and when');
  if (r._put.indexOf('receivables') < 0) fail('the view was not cached');
}

/* The two writers stamp `at` and `by`, and the cache is dropped with the
   storage view's. Grepped, because both are one-line facts about the writers. */
console.log('=== writers and cache ===');
const stamped = (gas.match(/d\.payments\.push\(\{[^}]*\n?[^}]*at: new Date\(\)\.toISOString\(\), by: /g) || []).length;
if (stamped !== 2) fail('expected both payment writers to stamp at/by, found ' + stamped);
else ok('both payment writers stamp at and by');
if (!/function invalidateStorageView_\(\) \{[^}]*cacheDropBig_\('receivables'\)/.test(gas)) fail('a write no longer drops the receivables cache');
else ok('every write drops the receivables cache');
if (!/CONSOLE_GET_FNS_ = \{[\s\S]*?receivables: 1[\s\S]*?\};/.test(gas)) fail('receivables is not on the GET allow-list');
else ok('receivables is a GET-able read');

if (bad) { console.error('\n' + bad + ' receivables check(s) failed'); process.exit(1); }
console.log('\nreceivables: all checks passed');
