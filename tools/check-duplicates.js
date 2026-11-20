#!/usr/bin/env node
/* Possible duplicates — executed against a fake sheet.
   ---------------------------------------------------------------------------
   duplicatesBuild_ (the .gs) lists the same customer with the same unit on
   more than one quote, and says which to keep. It deletes nothing, so the
   failure that matters is a WRONG LIST: two real units told apart as one
   (staff delete a paying customer's second jet ski), or the quote the
   customer holds offered up for deletion. Every case below is one the first
   run over the live sheet (Nov 2026) actually met, under invented names:

     LEFTOVER   Import draft + the same quote sent from Inside  → keep Inside
     TWICE      the same old sheet imported twice               → keep newest
     LEAD       unfinished lead + the paid quote for that boat  → keep the paid one
     SPLIT      name typed "Chris Van" / "Dyke" vs "VanDyke"    → still one customer
     BOTHPAID   two quotes for one unit, both with money        → listed, with a warning
   and must NOT be listed:
     YEARS      a 2019 and a 2022 of the same model             → two units
     NUMBERED   "Waverunner" and "Waverunner #2"; "1/3" / "2/3" → two units
     KINDS      a boat and a jet ski, one customer              → two units
     SPOUSES    same surname, different first name/email/phone  → two customers
     DELETED    a row on Deleted Quotes                         → not a quote

   Both read routes are run (batch grid and per-tab fallback). Run by
   tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const admin = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');

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

/* first, last, email, phone, unit, ymm, dims, paid, edited, contract */
const P = (o) => Object.assign({ first: 'Pat', email: '', phone: '', unit: 'Boat', ymm: '', dims: '',
  paid: 0, ts: '2026-10-01T12:00:00Z' }, o);
const TABS = {
  Inside: [
    P({ qn: 'LEFT-LIVE', last: 'Avery', email: 'a@x.test', ymm: 'Crownline', dims: "LOA 21' · B 8' · trailer", ts: '2026-10-02T16:00:00Z', emails: 2 }),
    P({ qn: 'LEAD-PAID', last: 'Baird', email: 'b@x.test', ymm: 'Chaparrel 21SSi', dims: "LOA 21' · B 8' 4\"", paid: 1700, ts: '2026-10-19T12:00:00Z' }),
    P({ qn: 'SPLIT-PAID', first: 'Chris', last: 'VanDyke', email: 'c@x.test', phone: '815 555 0101', unit: 'Jet ski', ymm: 'Yamaha Waverunners', dims: "stored L 13' · stored W 8'", paid: 1000 }),
    P({ qn: 'BOTH-A', last: 'Dale', email: 'd@x.test', ymm: 'Sea Ray 240', paid: 500, ts: '2026-10-05T12:00:00Z' }),
    P({ qn: 'BOTH-B', last: 'Dale', email: 'd@x.test', ymm: 'Sea Ray 240', paid: 300, ts: '2026-10-09T12:00:00Z' }),
    P({ qn: 'YEAR-19', last: 'Ellis', email: 'e@x.test', unit: 'Jetski', ymm: '2019 Yamaha VX Cruiser', paid: 500 }),
    P({ qn: 'YEAR-22', last: 'Ellis', email: 'e@x.test', unit: 'Jetski', ymm: '2022 Yamaha VX Cruiser', paid: 600 }),
    P({ qn: 'NUM-1', last: 'Ford', email: 'f@x.test', unit: 'Jet ski', ymm: 'Seadoo Waverunner', dims: "stored L 14' · stored W 5'", paid: 500 }),
    P({ qn: 'NUM-2', last: 'Ford', email: 'f@x.test', unit: 'Jetski', ymm: 'Seadoo Waverunner #2', dims: "stored L 14' · stored W 5'", paid: 500 }),
    P({ qn: 'TAN-1', last: 'Gray', email: 'g@x.test', unit: 'Jetski', ymm: 'Wave Runners (Tandem Trailer 1/3)', dims: "stored L 16'" }),
    P({ qn: 'TAN-2', last: 'Gray', email: 'g@x.test', unit: 'Jetski', ymm: 'Wave Runners (Tandem Trailer 2/3)', dims: "stored L 16'" }),
    P({ qn: 'KIND-B', last: 'Hart', email: 'h@x.test', ymm: 'Harris Tritoon' }),
    P({ qn: 'KIND-J', last: 'Hart', email: 'h@x.test', unit: 'Jet ski', ymm: 'Harris' }),
    P({ qn: 'SPOUSE-1', first: 'Gwen', last: 'Ives', email: 'g1@x.test', phone: '8155550001', unit: 'Jet ski', ymm: 'Waverunners' }),
    P({ qn: 'SPOUSE-2', first: 'Lars', last: 'Ives', email: 'l1@x.test', phone: '8155550002', unit: 'Boat', ymm: 'Waverunners' }),
    P({ qn: 'SPOUSE-3', first: 'Lars', last: 'Ives', email: 'l1@x.test', phone: '8155550002', unit: 'Jet ski', ymm: 'Larson 254' }),
  ],
  Import: [
    P({ qn: 'LEFT-DRAFT', last: 'Avery', email: 'a@x.test', ymm: 'Crownline', dims: "LOA 21' · B 8' · trailer", ts: '2026-11-05T21:00:00Z' }),
    P({ qn: 'TWICE-OLD', last: 'Jones', email: 'j@x.test', ymm: "1985 48' Ocean Alexander", dims: "LOA 48' · B 15'", ts: '2026-11-05T21:21:11Z' }),
    P({ qn: 'TWICE-NEW', last: 'Jones', email: 'j@x.test', ymm: "1985 48' Ocean Alexander", dims: "LOA 48' · B 15'", ts: '2026-11-05T21:21:15Z' }),
  ],
  'Quote Started': [
    P({ qn: 'LEAD-OPEN', last: 'Baird', email: 'b@x.test', ymm: '2026 Chaparral 210 SSI', dims: 'trailer', ts: '2026-11-01T12:00:00Z' }),
    P({ qn: 'SPLIT-LEAD', first: 'Chris Van', last: 'Dyke', email: 'c@x.test', phone: '(815) 555-0101', unit: 'Jetski', ymm: '2018 Yamaha vx', ts: '2026-11-02T12:00:00Z' }),
  ],
  'Deleted Quotes': [
    P({ qn: 'GONE', last: 'Avery', email: 'a@x.test', ymm: 'Crownline', dims: "LOA 21' · B 8' · trailer", paid: 900 }),
  ],
};
function row(q) {
  const x = new Array(HL).fill('');
  x[COL.LAST - 1] = q.last; x[COL.FIRST - 1] = q.first; x[COL.QN - 1] = q.qn; x[COL.UNIT - 1] = q.unit;
  x[COL.EMAIL - 1] = q.email; x[COL.PHONE - 1] = q.phone; x[COL.YMM - 1] = q.ymm; x[COL.DIMS - 1] = q.dims;
  x[COL.STATUS - 1] = 'Quote saved'; x[COL.TS - 1] = '2026-09-22 11:30'; x[COL.PAID - 1] = q.paid;
  const d = { quoteNo: q.qn, total: 1000, ts: q.ts,
    payments: q.paid ? [{ amt: q.paid, method: 'Check', date: '10/1/2026' }] : [],
    emailLog: new Array(q.emails || 0).fill({ kind: 'firmquote' }) };
  x[COL.PAYLOAD - 1] = JSON.stringify(d);
  return x;
}
const SHEETS = Object.keys(TABS).map((name) => {
  const grid = TABS[name].map(row);
  const head = name === 'Deleted Quotes' ? 'Quote # (deleted)' : 'Quote #';
  return {
    grid, head,
    getName: () => name,
    getLastRow: () => grid.length + 1,
    getRange: (r, c, nr, nc) => nr === undefined
      ? { getValue: () => (r === 1 && c === 3) ? head : grid[r - 2][c - 1] }
      : { getValues: () => grid.slice(r - 2, r - 2 + nr).map(rw => rw.slice(c - 1, c - 1 + (nc || 1))) }
  };
});
function gridsFor(sheets, spans) {
  return sheets.map((sh) => sh.head !== 'Quote #' ? null :
    spans.map((sp) => [['hdr']].concat(sh.grid.map(r => r.slice(sp[0] - 1, sp[1])))));
}

/* The builder, every helper it calls, and nothing that could write. */
const dupFns = (gas.match(/^function (dup[A-Za-z]*_|duplicatesBuild_)\b/mg) || []).map(s => s.replace('function ', ''));
function build(batch) {
  const src = [decl('COL'),
    "const STARTED_TAB='Quote Started'; const IMPORT_TAB='Import';",
    fn('isStartedTab_'), fn('isImportTab_'), fn('isOffstageTab_'), fn('paymentsTotal_'),
    decl('DUP_LEN_SLACK_FT_'), decl('DUP_GENERIC_'),
    'let _gridsRoute_ = "batch";',
    'function quoteTabGrids_(ss, sheets, spans){ return BATCH ? GRIDS(sheets, spans) : null; }']
    .concat(dupFns.map(fn)).concat(['return duplicatesBuild_();']).join('\n');
  return new Function('SpreadsheetApp', 'BATCH', 'GRIDS', src)(
    { getActiveSpreadsheet: () => ({ getSheets: () => SHEETS }) }, batch, gridsFor);
}

for (const batch of [true, false]) {
  console.log('=== duplicatesBuild_ — ' + (batch ? 'batch read' : 'per-tab fallback') + ' ===');
  const r = build(batch);
  const byKeep = {};
  (r.groups || []).forEach(g => { byKeep[g.keep.qn] = g; });
  const want = { 'LEFT-LIVE': ['LEFT-DRAFT', 'live'], 'TWICE-NEW': ['TWICE-OLD', 'recent'],
    'LEAD-PAID': ['LEAD-OPEN', 'deposit'], 'SPLIT-PAID': ['SPLIT-LEAD', 'deposit'], 'BOTH-B': ['BOTH-A', 'deposit'] };
  Object.keys(want).forEach((k) => {
    const g = byKeep[k];
    if (!g) return fail(k + ' is not kept in any group (groups: ' + (r.groups || []).map(x => x.keep.qn + '>' + x.review.map(y => y.qn)).join(' ') + ')');
    const rv = g.review.map(x => x.qn).join(',');
    if (rv !== want[k][0]) fail(k + ': review list is ' + rv + ', expected ' + want[k][0]);
    else if (g.why !== want[k][1]) fail(k + ': kept because "' + g.why + '", expected "' + want[k][1] + '"');
    else ok(k + ' kept (' + g.why + '), ' + rv + ' to review');
  });
  if ((r.groups || []).length !== Object.keys(want).length)
    fail('expected ' + Object.keys(want).length + ' groups, got ' + (r.groups || []).length);
  else ok('different years, numbered units, other kinds and spouses are not listed');
  const both = byKeep['BOTH-B'];
  if (!both || !/money/.test(both.note)) fail('two quotes with money on one unit carry no warning');
  else ok('two paid quotes for one unit are flagged as a money question');
  const all = [].concat(...(r.groups || []).map(g => [g.keep].concat(g.review))).map(q => q.qn);
  if (all.indexOf('GONE') >= 0) fail('a Deleted Quotes row was treated as a quote');
  else ok('the Deleted Quotes archive is not read as a quote tab');
  const lead = byKeep['LEAD-PAID'];
  if (!lead || lead.confidence !== 'medium') fail('a misspelled match should be a maybe (medium), got ' + (lead && lead.confidence));
  else ok('a spelling-slip match is a maybe, not a certainty');
  if (!byKeep['TWICE-NEW'] || byKeep['TWICE-NEW'].confidence !== 'high') fail('identical drafts should be high confidence');
  if (r.scanned !== TABS.Inside.length + TABS.Import.length + TABS['Quote Started'].length)
    fail('scanned ' + r.scanned + ' quotes');
}

console.log('=== read-only, and reachable ===');
const body = dupFns.map(fn).join('\n');
if (/setValue|setValues|deleteRow|appendRow|insertSheet|sendEmail|GmailApp|MailApp|setTrashed|cachePut/.test(body))
  fail('the duplicates check writes, deletes, emails or caches something');
else ok('the builder writes, deletes and emails nothing');
if (!/CONSOLE_GET_FNS_ = \{[\s\S]*?duplicates: 1[\s\S]*?\};/.test(gas)) fail('duplicates is not on the GET allow-list');
else ok('duplicates is a GET-able read on the server');
if (!/duplicates:\s*function \(a\) \{ return adminDuplicates\(p\.token\); \}/.test(gas)) fail('duplicates is not routed in consoleFns_');
if (!/function adminDuplicates\(token\) \{\s*requireAuth_\(token, 'view'\);/.test(gas)) fail('adminDuplicates does not check the session');
if (!/API_GET_OK=\{[^}]*duplicates:1/.test(admin)) fail('the console does not retry duplicates over GET');
else ok('the console retries it over GET like the other reads');
if (!/api\('duplicates',\[\]\)/.test(admin) || !/navGo\(toggleDuplicates\)/.test(admin)) fail('the console has no way to open the list');
else ok('menu and home tile open it');

if (bad) { console.error('\n' + bad + ' duplicates check(s) failed'); process.exit(1); }
console.log('\nduplicates: all checks passed');
