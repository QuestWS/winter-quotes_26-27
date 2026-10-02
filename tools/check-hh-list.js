#!/usr/bin/env node
/* The Heritage Harbor customer list — matched, flagged and answered, executed
   end to end rather than grepped.
   ---------------------------------------------------------------------------
   The marina's contacts export lists every Heritage Harbor customer, slip or
   not. Each quote whose customer is on it is flagged until staff answer
   slipholder / not; a slip number on the quote settles it with nobody
   opening the quote (Chris, Oct 2026). The quiet ways of being wrong:

   - a match that misses: a couple written "John & Jane Doe", a phone with a
     +1, an email in capitals;
   - a match that is too loose: one word alone matching every "Smith";
   - a slip recorded by staff under Keys & slip (manual.measured) not counting,
     because the check read the customer's original state;
   - the answer wiped by the customer's next save (doPost rebuilds the payload
     from their browser, which has never heard of it);
   - the export's addresses and the marina's notes being kept, when only what
     matching needs should cross into the sheet;
   - the console losing the tag, the filter, or the card.

   Every name, email and phone here is invented. Real ones never go in the
   repo (CLAUDE.md §4b). Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

const cache = {};
const ctx = {
  console, JSON, Date, Math, Number, String, Object, Array, RegExp, Error, isFinite, parseInt, parseFloat,
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } }) },
  HtmlService: {},
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; },
    getAll: (ks) => { const o = {}; ks.forEach((k) => { if (k in cache) o[k] = cache[k]; }); return o; },
    putAll: (o) => Object.assign(cache, o), remove: (k) => { delete cache[k]; },
    removeAll: (ks) => ks.forEach((k) => delete cache[k]) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: {}, GmailApp: {}, MailApp: {}, DriveApp: {}, ScriptApp: {}, UrlFetchApp: {}, Session: {}
};
vm.createContext(ctx);
vm.runInContext(GS, ctx, { filename: 'quote-logger-apps-script.gs' });

/* ---------------- reading the export ---------------- */
console.log('=== the export is read, and only four columns kept ===');
const EXPORT = [
  ['Contacts Export', '', '', '', '', '', '', '', '', ''],
  ['As of 2026-10-02 09:31:19 CDT', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['Customer ID', 'Email', 'Customer Name', 'Phone', 'Address Line 1', 'Address Line 2', 'City', 'State', 'Postal Code', 'Customer Notes'],
  ['c1', 'Pat.Example@Example.com', 'Pat Example', '+18155550101', '1 Test St', '', 'Nowhere', 'IL', '60000', 'slip B-1, fuel acct'],
  ['c2', 'couple@example.com', 'Lee & Robin Sample', '+18155550102', '', '', '', '', '', ''],
  ['c3', '', 'Acme', '', '', '', '', '', '', ''],
  ['c4', 'old.salt@example.com', "Sam O'Testy Jr.", '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '']
];
const parsed = ctx.hhParseExport_(EXPORT);
if (parsed.error) fail('the marina export shape is refused: ' + parsed.error);
else if (parsed.rows.length !== 4) fail('expected 4 contacts, got ' + parsed.rows.length);
else if (parsed.rows.some((r) => r.length !== 4)) fail('more than ID, email, name and phone kept from the export');
else if (JSON.stringify(parsed.rows).indexOf('Test St') >= 0 || JSON.stringify(parsed.rows).indexOf('fuel acct') >= 0)
  fail('an address or the marina\'s notes crossed into the list');
else ok('title rows skipped, headings found, ID/email/name/phone kept, address and notes dropped');
const fl = ctx.hhParseExport_([['Email', 'First Name', 'Last Name', 'Mobile'], ['a@example.com', 'Kim', 'Placeholder', '815-555-0199']]);
if (fl.error || fl.rows[0][2] !== 'Kim Placeholder' || fl.rows[0][3] !== '815-555-0199') fail('First/Last name columns not combined: ' + JSON.stringify(fl));
else ok('a First name / Last name export is read too');
if (!ctx.hhParseExport_([['Quote #', 'Total'], ['QW-1', '5']]).error) fail('a file with no email/name headings was accepted');
else ok('a file without the headings is refused with a reason');

/* ---------------- matching ---------------- */
console.log('=== matching ===');
const idx = JSON.parse(JSON.stringify(ctx.hhBuildIndex_(parsed.rows)));   // as it comes back from the cache
const M = (e, p, f, l) => ctx.hhMatch_(idx, e, p, f, l);
const on = (m) => (m ? m.on.join('+') : 'none');
[
  [M('pat.example@EXAMPLE.com', '', 'Zed', 'Nobody'), 'email', 'email, any case'],
  [M('', '(815) 555-0101', 'Zed', 'Nobody'), 'phone', 'phone, formatted against +1'],
  [M('', '815.555.0101', 'Zed', 'Nobody'), 'phone', 'phone, dotted'],
  [M('', '', 'Pat', 'Example'), 'name', 'first and last name'],
  [M('', '', 'robin', 'SAMPLE'), 'name', 'the second half of a couple, sharing the surname'],
  [M('', '', 'Lee', 'Sample'), 'name', 'the first half of a couple'],
  [M('', '', 'Sam', 'OTesty'), 'name', 'apostrophe and "Jr." ignored'],
  [M('pat.example@example.com', '8155550101', 'Pat', 'Example'), 'email+phone+name', 'all three reported'],
].forEach(([got, want, what]) => (on(got) === want ? ok(what + ' → ' + want) : fail(what + ': matched on ' + on(got) + ', wanted ' + want)));
[
  [M('', '', '', 'Example'), 'a surname alone'],
  [M('', '', 'Pat', 'Other'), 'a first name alone'],
  [M('', '', 'Acme', 'Acme'), 'a one-word contact (a business) never matches by name'],
  [M('', '555-0101', '', ''), 'seven digits are not a phone we can be sure of'],
  [M('nobody@example.com', '8155559999', 'Zed', 'Nobody'), 'somebody not on the list'],
  [M('', '', 'constructor', 'toString'), 'object-prototype names do not match'],
].forEach(([got, what]) => (got ? fail(what + ' matched (' + on(got) + ')') : ok(what + ' → no match')));
if (M('', '', 'Pat', 'Example').name !== 'Pat Example') fail('the match does not name the list entry');
else ok('the match names the list entry it hit');
if (ctx.hhMatch_({ e: {}, p: {}, n: {}, names: [], count: 0 }, 'pat.example@example.com', '', 'Pat', 'Example'))
  fail('an empty list flagged somebody');
else ok('no list loaded → nobody flagged');

/* ---------------- the flag ---------------- */
console.log('=== the flag: open, slip, yes, no ===');
const q = (extra) => Object.assign({ quoteNo: 'QW-26-9001', firstName: 'Pat', lastName: 'Example', unit: 'Boat',
  email: 'pat.example@example.com', state: { unit: 'boat' } }, extra || {});
const F = (d, r) => ctx.hhFlagOf_(d, idx, r || null);
const state = (f) => (f ? f.state : 'null');
if (state(F(q())) !== 'open') fail('a matched quote with no slip and no answer is ' + state(F(q())) + ', not open');
else ok('matched, no slip, no answer → open');
if (state(F(q({ state: { unit: 'boat', slipNo: 'B-14' } }))) !== 'slip') fail('a slip the customer gave does not settle it');
else ok('a slip number the customer gave settles it');
const staffSlip = q({ manual: { measured: { slipNo: 'C-2' } } });
if (state(F(staffSlip)) !== 'slip' || F(staffSlip).slip !== 'C-2') fail('a slip staff saved under Keys & slip does not settle it: ' + JSON.stringify(F(staffSlip)));
else ok('a slip staff saved under Keys & slip settles it (effective state)');
if (state(F(q({ state: { unit: 'boat', slipNo: '   ' } }))) !== 'open') fail('a blank slip settled it');
else ok('a blank slip does not count');
if (state(F(q({ hhList: { answer: 'no', by: 'Tester', at: '2026-10-02' } }))) !== 'no') fail('a "no" answer is not kept');
else ok('answered no → no');
if (state(F(q({ hhList: { answer: 'yes', by: 'Tester' } }))) !== 'yes') fail('a "yes" answer is not kept');
else ok('answered yes → yes');
if (state(F(q({ hhList: { answer: 'no' }, state: { unit: 'boat', slipNo: '7' } }))) !== 'slip') fail('a slip does not win over an answer');
else ok('a slip wins over an answer');
if (F(q({ email: 'x@example.com', firstName: 'Zed', lastName: 'Nobody' }))) fail('a quote not on the list is flagged');
else ok('not on the list → no flag at all');
const row = new Array(23).fill(''); row[0] = 'Example'; row[1] = 'Pat';
if (state(F({ quoteNo: 'QW-26-9002', unit: 'Boat' }, row)) !== 'open') fail('the sheet row is not used when the payload has no name');
else ok('a payload with no contact falls back to the sheet row');

/* ---------------- staff answer + customer save ---------------- */
console.log('=== the answer survives, and is only an answer ===');
const fn = (name) => { const a = GS.indexOf('function ' + name + '('); return a < 0 ? '' : GS.slice(a, GS.indexOf('\nfunction ', a + 10)); };
const conf = fn('adminHhConfirm');
if (!/requireAuth_\(token, 'keys'\)/.test(conf)) fail('adminHhConfirm is not behind the keys permission');
else ok('answering takes the keys permission, like the staff note');
if (/GmailApp|MailApp|sendEmail|saveQuoteRow_|recomputeTotals_|rebuildLinesFromState_/.test(conf))
  fail('adminHhConfirm emails, re-prices or re-saves the row — it must only write the payload');
else ok('answering emails nobody and touches no price — payload only');
const up = fn('adminHhListUpload');
if (!/who\.admin/.test(up)) fail('uploading the list is not admins-only');
else ok('uploading the list is admins-only');
if (/GmailApp|MailApp|sendEmail/.test(up)) fail('uploading the list sends email');
else ok('uploading the list emails nobody');
if (!/if \(oldD\.hhList\) d\.hhList = oldD\.hhList;/.test(GS)) fail('a customer save does not carry the staff answer (d.hhList) across');
else ok('a customer save carries the answer across');
if (!/hhListUpload/.test(GS.slice(GS.indexOf('function consoleFns_'), GS.indexOf('function consoleFns_') + 8000)))
  fail('hhListUpload is not dispatched by the console');
const getFns = GS.slice(GS.indexOf('const CONSOLE_GET_FNS_'), GS.indexOf('};', GS.indexOf('const CONSOLE_GET_FNS_')));
if (/hhListUpload|hhConfirm/.test(getFns)) fail('a Heritage Harbor write is GET-able');
else ok('the upload and the answer are POST-only writes');

/* ---------------- the storage view row ---------------- */
console.log('=== the storage view carries it ===');
const HEAD = ['Last Name', 'First Name', 'Quote #'];
function sheet(name, data) {
  const cell = (r, c) => { const v = (data[r - 1] || [])[c - 1]; return v === undefined ? '' : v; };
  return { getName: () => name, getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({ getValue: () => cell(r, c), getValues: () => {
      const out = []; for (let i = 0; i < (nr || 1); i++) { const rr = []; for (let j = 0; j < (nc || 1); j++) rr.push(cell(r + i, c + j)); out.push(rr); } return out; } }) };
}
function srow(qn, d) { const r = new Array(23).fill(''); r[0] = d.lastName; r[1] = d.firstName; r[2] = qn; r[6] = 'Boat'; r[20] = JSON.stringify(Object.assign({ quoteNo: qn }, d)); return r; }
const LIST = [['Customer ID', 'Email', 'Name', 'Phone']].concat(parsed.rows);
const book = [
  sheet('Inside', [HEAD,
    srow('QW-26-9101', q()),
    srow('QW-26-9102', q({ state: { unit: 'boat', slipNo: 'B-14' } })),
    srow('QW-26-9103', q({ firstName: 'Zed', lastName: 'Nobody', email: 'z@example.com' }))]),
  sheet('Heritage Harbor List', LIST)
];
ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => book, getId: () => 'B',
  getSheetByName: (n) => book.filter((s) => s.getName() === n)[0] || null }) };
Object.keys(cache).forEach((k) => delete cache[k]);
const out = ctx.storageViewBuild_({ fresh: true });
const byQn = {};
out.groups.forEach((g) => g.rows.forEach((r) => { byQn[r.qn] = r; }));
if (out.groups.some((g) => g.tab === 'Heritage Harbor List')) fail('the list tab was read as a storage area');
else ok('the list tab is not mistaken for a storage area');
if (!byQn['QW-26-9101'] || byQn['QW-26-9101'].hh !== 'open') fail('a matched quote is not "open" on the list: ' + JSON.stringify(byQn['QW-26-9101'] && byQn['QW-26-9101'].hh));
else if (byQn['QW-26-9102'].hh !== 'slip') fail('a matched quote with a slip is not settled on the list');
else if (byQn['QW-26-9103'].hh !== '') fail('a quote not on the list carries a flag');
else ok('rows carry hh: open / slip / "" from the list tab');

/* ---------------- the console ---------------- */
console.log('=== the console shows it ===');
const SRC = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((b) => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');
const noop = () => {};
const el = { textContent: '', className: '', innerHTML: '', value: '',
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop };
const C = { console, localStorage: { getItem: () => null, setItem: noop }, location: { reload: noop, href: '' },
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
              addEventListener: noop, createElement: () => el, body: el },
  setTimeout: (f) => { f(); return 0; }, clearTimeout: noop,
  MutationObserver: function () { return { observe: noop }; },
  fetch: async () => { throw new Error('no requests'); } };
C.window = C; C.globalThis = C;
vm.createContext(C);
vm.runInContext(SRC, C, { filename: 'admin/index.html' });
C.window._sg = out.groups;
C.window._curSeason = out.currentSeason;
C.window._drafts = [{ qn: 'QW-26-9201', name: 'Draft, Imported', unit: 'Boat', status: 'Imported', total: '$0.00', hh: 'open' }];
const cnt = C.storageCounts_();
if (cnt.hh !== 1 || cnt.hhDrafts !== 1) fail('counted ' + cnt.hh + ' storage + ' + cnt.hhDrafts + ' draft(s) to confirm — expected 1 + 1');
else ok('one storage quote and one imported draft counted to confirm');
C.setStorageFilter('all');
C.renderStorage();
let page = el.innerHTML;
const nm = (last) => { const a = page.indexOf(last); return a < 0 ? '' : page.slice(a, page.indexOf('<span class="un">', a)); };
if (!/taghh/.test(nm('Example, Pat'))) fail('the open row is not tagged');
else ok('the open row is tagged on the list');
C.setStorageFilter('hh');
C.renderStorage();
page = el.innerHTML;
if (page.indexOf('QW-26-9201') < 0) fail('the Heritage Harbor view leaves out an imported draft that needs an answer');
else ok('the Heritage Harbor view includes imported drafts that need an answer');
if (/Nobody/.test(page)) fail('the Heritage Harbor view shows a customer not on the list');
else ok('the Heritage Harbor view shows only the ones to answer');
if (C.storageGroups_().some((g) => g.rows.some((x) => x.hh !== 'open'))) fail('a settled quote is in the Heritage Harbor filter');
else ok('a settled quote (slip on file) is not in the filter');
if (C.storageGroups_().some((g) => g.rows.some((x) => x.qn === 'QW-26-9201'))) fail('a draft reached storageGroups_ — it would print on a storage sheet');
else ok('drafts stay out of storageGroups_, so they never print');
for (const id of ['hhListCard', 'hhListUpCard', 'hhListFile', 'hhListOpen', 'hhListTile']) {
  if (HTML.indexOf('id="' + id + '"') < 0) fail('the console lost #' + id);
}
if (!/renderHhList\(r\.hhList/.test(HTML)) fail('renderQuote no longer draws the Heritage Harbor card');
else ok('the quote card, the upload card and the menu entry are all there');

if (bad) { console.error('\n' + bad + ' check(s) failed.'); process.exit(1); }
console.log('\nAll Heritage Harbor list checks pass.');
