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

/* ---------------- the slip list ---------------- */
console.log('=== the slip list: parking, ramp passes and In & Out never count ===');
const SLIPS = [
  ['Slip', 'Boat', 'Name'],
  ['B-22 Lift *', 'Test Boat', 'Pat Example'],
  ['PWC: C-1', 'Ski', 'Robin Sample'],
  ['LL-01 (Parking Space)', 'Truck', 'Kim Parker'],
  ['UL-03 (Parking Space)', 'Truck', 'Kim Parker'],
  ['Ramp Pass Members', 'Jon Boat', 'Ray Ramp'],
  ['I&O-3', 'Dry stack', 'Ivy Inout'],
  ['', 'No space', 'Nora Nospace'],
  ['C-9', '', '']
];
const ps = ctx.hhParseSlips_(SLIPS);
if (ps.error) fail('the slip list is refused: ' + ps.error);
else {
  const names = ps.rows.map((r) => r[2]);
  if (names.join('|') !== 'Pat Example|Robin Sample') fail('kept the wrong rows: ' + names.join(', '));
  else ok('only real slips kept — parking, ramp pass, In & Out and space-less rows dropped');
  if (ps.skipped !== 5) fail('skipped ' + ps.skipped + ' rows, expected 5 (two parking, ramp, I&O, no space)');
  else ok('the dropped rows are counted for the upload message');
  if (ps.rows[0][0] !== 'B-22 Lift') fail('slip label not cleaned of Dockwa\'s asterisks: ' + JSON.stringify(ps.rows[0][0]));
  else ok('"B-22 Lift *" is kept as "B-22 Lift"');
}
if (!ctx.hhParseSlips_([['Name', 'Email'], ['Pat Example', 'p@example.com']]).error) fail('a slip list with no Slip column was accepted');
else ok('a list with no Slip column is refused');
const sIdx = JSON.parse(JSON.stringify(ctx.hhBuildIndex_(ps.rows.map((r) => [r[0], r[3], r[2], r[4], r[1]]),
  (r) => ({ slip: r[0], boat: r[4] }))));
const IX = { c: idx, s: sIdx };
const G = (d) => ctx.hhFlagOf_(d, IX, null);
const robin = q({ firstName: 'Robin', lastName: 'Sample', email: '' });
const lee = q({ firstName: 'Lee', lastName: 'Sample', email: '' });
if (state(G(q())) !== 'dockwa' || G(q()).dockwa.slip !== 'B-22 Lift' || G(q()).dockwa.boat !== 'Test Boat')
  fail('a contact on the slip list is not settled with its slip: ' + JSON.stringify(G(q())));
else ok('on the slip list → slipholder, with the slip and boat');
if (state(G(robin)) !== 'dockwa') fail('half of a couple on the slip list is not matched');
else ok('a couple\'s second name matches the slip list too');
if (state(G(lee)) !== 'notslip') fail('a contact NOT on the slip list is ' + state(G(lee)) + ', not notslip');
else ok('a Heritage Harbor customer not on the slip list → not a slipholder, once a slip list is loaded');
if (state(ctx.hhFlagOf_(lee, { c: idx, s: { e: {}, p: {}, n: {}, names: [], count: 0 } }, null)) !== 'open')
  fail('with no slip list loaded, a contact is not left open');
else ok('no slip list loaded → still open, never assumed not a slipholder');
if (state(G(Object.assign(lee, { hhList: { answer: 'yes', by: 'T' } }))) !== 'yes') fail('staff "yes" does not beat the slip list');
else ok('staff answering Yes wins over "not on the slip list"');
if (state(G(q({ hhList: { answer: 'no' } }))) !== 'no') fail('staff "no" does not beat the slip list');
else ok('staff answering No wins over a slip-list match');
const slipped = G(q({ state: { unit: 'boat', slipNo: 'Z-9' } }));
if (state(slipped) !== 'slip' || slipped.dockwa.slip !== 'B-22 Lift') fail('a slip on the quote does not win, or the list\'s slip is lost');
else ok('a slip on the quote still wins, and the list\'s slip rides along to compare');
const stranger = q({ firstName: 'Ray', lastName: 'Ramp', email: '' });
if (G(stranger)) fail('a ramp-pass holder not on the contacts list got a flag');
else ok('a ramp-pass-only name gets nothing');
const upl = GS.slice(GS.indexOf('function adminHhListUpload'), GS.indexOf('function adminHhListUpload') + 6000);
if (!/kind === 'slips'/.test(upl) || !/HH_SLIP_TAB/.test(upl)) fail('the upload no longer takes the slip list');
if (!/hhListUpload:function \(a\) \{ return adminHhListUpload\(p\.token, a\[0\], a\[1\], a\[2\]\)/.test(GS))
  fail('the console dispatch drops the list kind');
else ok('the upload takes the slip list as its own kind');

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
for (const id of ['hhSlipFile', 'hhSlipPickBtn', 'hhUseSlip']) {
  if (HTML.indexOf('id="' + id + '"') < 0) fail('the console lost #' + id);
}
if (!/state==='dockwa'/.test(HTML) || !/state==='notslip'/.test(HTML)) fail('the card does not draw the slip-list states');
if (!/renderHhList\(r\.hhList/.test(HTML)) fail('renderQuote no longer draws the Heritage Harbor card');
else ok('the quote card, the upload card and the menu entry are all there');

/* ---------------- filling blank slips ---------------- */
console.log('=== filling blank slip numbers from the slip list ===');
{
  const LIST2 = [['Slip', 'Boat', 'Name', 'Email', 'Phone'],
    ['B-22 Lift', 'Test Boat', 'Pat Example', '', ''],
    ['PWC: C-1', 'Ski', 'Pat Example', '', ''],
    ['E-05', 'Boat One', 'Dana Double', '', ''],
    ['E-06', 'Boat Two', 'Dana Double', '', ''],
    ['A-01', 'Nope', 'Noel Nope', '', ''],
    ['C-07', 'Has One', 'Hal Hasslip', '', ''],
    ['PWC: H-1', 'Only Ski', 'Olly Onlypod', '', '']];
  const mk = (qn, first, last, unit, extra) => {
    const r = new Array(23).fill(''); r[0] = last; r[1] = first; r[2] = qn; r[5] = 'Quote sent'; r[6] = unit;
    r[20] = JSON.stringify(Object.assign({ quoteNo: qn, firstName: first, lastName: last, unit: unit,
      state: { unit: unit === 'Jetski' ? 'jetski' : unit === 'Golf Cart' ? 'golf' : 'boat' } }, extra || {}));
    return r;
  };
  const data = [HEAD,
    mk('QW-26-9301', 'Pat', 'Example', 'Boat'),
    mk('QW-26-9302', 'Pat', 'Example', 'Jetski'),
    mk('QW-26-9303', 'Dana', 'Double', 'Boat'),
    mk('QW-26-9304', 'Noel', 'Nope', 'Boat', { hhList: { answer: 'no' } }),
    mk('QW-26-9305', 'Hal', 'Hasslip', 'Boat', { state: { unit: 'boat', slipNo: 'OWN-1' } }),
    mk('QW-26-9306', 'Pat', 'Example', 'Golf Cart'),
    mk('QW-26-9307', 'Olly', 'Onlypod', 'Boat'),
    mk('QW-26-9308', 'Zed', 'Nobody', 'Boat')];
  const writes = [];
  function wsheet(name, rows) {
    const cell = (r, c) => { const v = (rows[r - 1] || [])[c - 1]; return v === undefined ? '' : v; };
    return { getName: () => name, getLastRow: () => rows.length,
      getRange: (r, c, nr, nc) => ({
        getValue: () => cell(r, c),
        getValues: () => { const o = []; for (let i = 0; i < (nr || 1); i++) { const rr = []; for (let j = 0; j < (nc || 1); j++) rr.push(cell(r + i, c + j)); o.push(rr); } return o; },
        setValue: (v) => { writes.push({ tab: name, r, c }); rows[r - 1][c - 1] = v; } }) };
  }
  const book2 = [wsheet('Inside', data), wsheet('Heritage Harbor Slips', LIST2)];
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => book2, getId: () => 'B',
    getSheetByName: (n) => book2.filter((x) => x.getName() === n)[0] || null }) };
  Object.keys(cache).forEach((k) => delete cache[k]);
  ctx.requireAuth_ = () => ({ name: 'Tester', admin: true, perms: {} });
  ctx.auditLog_ = () => {};
  let snapped = 0;
  ctx.snapshotBeforeRestore_ = () => { snapped++; return { getUrl: () => 'drive://snap' }; };
  const pv = ctx.adminHhSlipFillPreview('t');
  const by = (arr) => Object.fromEntries((arr || []).map((x) => [x.qn, x]));
  const F2 = by(pv.fill), A2 = by(pv.ambiguous), S2 = by(pv.skipped);
  if (!pv.ok) fail('preview refused: ' + pv.error);
  if (!F2['QW-26-9301'] || F2['QW-26-9301'].slip !== 'B-22 Lift') fail('a blank boat quote on the list is not filled with its boat slip');
  else ok('blank boat quote → its boat slip, not the owner\'s PWC pod');
  if (!F2['QW-26-9302'] || F2['QW-26-9302'].slip !== 'PWC: C-1') fail('the jet ski quote did not get the PWC pod');
  else ok('the same owner\'s jet ski quote → the PWC pod');
  if (!A2['QW-26-9303'] || F2['QW-26-9303']) fail('two boat slips were not held back as ambiguous');
  else ok('two candidate slips → listed as ambiguous, not filled');
  if (!S2['QW-26-9304'] || F2['QW-26-9304']) fail('staff "not a slipholder" was overridden by the list');
  else ok('staff answered No → listed, not filled');
  if (F2['QW-26-9305'] || A2['QW-26-9305'] || S2['QW-26-9305']) fail('a quote that already has a slip was offered');
  else ok('a quote that already has a slip is never touched');
  if (F2['QW-26-9306'] || A2['QW-26-9306'] || S2['QW-26-9306']) fail('a golf cart was offered a slip');
  else ok('golf carts and e-bikes are never given a slip');
  if (!S2['QW-26-9307'] || F2['QW-26-9307']) fail('a boat was given a PWC pod');
  else ok('a boat whose only entry is a PWC pod → listed, not filled');
  if (F2['QW-26-9308'] || A2['QW-26-9308'] || S2['QW-26-9308']) fail('someone not on the slip list appears in the preview');
  else ok('not on the slip list → not in the preview at all');
  if (writes.length || snapped) fail('the preview wrote something or took a snapshot');
  else ok('the preview writes nothing');

  const statusBefore = data.map((r) => r[5]).join('|');
  const ap = ctx.adminHhSlipFillApply('t', ['QW-26-9301', 'QW-26-9302', 'QW-26-9305']);
  if (!ap.ok) fail('apply refused: ' + ap.error);
  if (snapped !== 1) fail('apply did not snapshot the spreadsheet first');
  else ok('a snapshot is saved before the first write');
  if (JSON.stringify(ap.done) !== JSON.stringify(['QW-26-9301', 'QW-26-9302'])) fail('apply filled ' + JSON.stringify(ap.done));
  else ok('only the previewed, still-blank quotes are filled');
  const pd1 = JSON.parse(data[1][20]);
  if (pd1.manual.measured.slipNo !== 'B-22 Lift' || pd1.slipNo !== 'B-22 Lift') fail('the slip is not in the journal and the top-level copy');
  else ok('written to manual.measured (survives a customer save) and the top-level copy');
  if (pd1.state.slipNo !== undefined) fail('the customer\'s own state was edited');
  else ok('the customer\'s own answers (d.state) are left alone');
  if (state(ctx.hhFlagOf_(pd1, ctx.hhIndexes_(), null)) !== 'slip') fail('a filled quote is not settled');
  else ok('a filled quote now reads as settled by its slip');
  if (writes.some((w) => w.c !== 21)) fail('apply wrote a column other than the payload: ' + JSON.stringify(writes));
  else if (data.map((r) => r[5]).join('|') !== statusBefore) fail('apply changed a status');
  else ok('payload column only — status, totals and PDF untouched');
  const fa = fn('adminHhSlipFillApply');
  if (/saveQuoteRow_|rebuildLinesFromState_|recomputeTotals_|savePdf_|GmailApp|MailApp|sendEmail/.test(fa))
    fail('the fill re-prices, rebuilds a PDF or emails');
  else ok('the fill never re-prices, rebuilds a PDF or emails');
  if (!/who\.admin/.test(fa) || !/who\.admin/.test(fn('adminHhSlipFillPreview'))) fail('the fill is not admins-only');
  else ok('preview and apply are admins-only');
  const again = ctx.adminHhSlipFillApply('t', ['QW-26-9301']);
  if (again.ok) fail('a second apply of the same quote wrote again');
  else ok('running it twice fills nothing twice');
  ctx.snapshotBeforeRestore_ = () => { throw new Error('Drive down'); };
  data[1] = mk('QW-26-9301', 'Pat', 'Example', 'Boat');      // blank again, fillable
  const before3 = data[1][20];
  const noSnap = ctx.adminHhSlipFillApply('t', ['QW-26-9301']);
  if (noSnap.ok || data[1][20] !== before3) fail('wrote without a snapshot');
  else ok('no snapshot → nothing written');
  if (!/if \(oldD\.slipFill\) d\.slipFill = oldD\.slipFill;/.test(GS)) fail('a customer save drops where the slip came from');
  else ok('a customer save keeps the record of the fill');
  if (/hhSlipFill/.test(getFns)) fail('the slip fill is GET-able');
  else ok('the fill is POST-only');
}

if (bad) { console.error('\n' + bad + ' check(s) failed.'); process.exit(1); }
console.log('\nAll Heritage Harbor list checks pass.');
