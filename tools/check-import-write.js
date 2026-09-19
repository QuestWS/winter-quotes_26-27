#!/usr/bin/env node
/* Where an imported quote lands on the sheet.
   ---------------------------------------------------------------------------
   The importer used to reserve its row like this:

       sh.appendRow(new Array(HEADERS.length).fill(''));
       const ctx = { d: d, sh: sh, rowNum: sh.getLastRow() };

   A row of empty strings is a row of empty CELLS, so the data region never
   grew and getLastRow() still pointed at the last row with something in it.
   Every import overwrote that row: the most recent quote on a tab that had
   any, and the HEADER row on a tab that was empty — where nothing can find it,
   because every scan in this system starts at row 2. The console reported
   "Imported as QW-26-3445 on Golf Cart" either way.

   That is not a bug a grep can hold down, so this runs the real helpers
   against a sheet fake that copies Apps Script's actual behaviour: appendRow
   writes below the last row WITH CONTENT, an empty string is not content, and
   getLastRow() is computed from the grid rather than remembered.

   No customer data here — the quotes below are invented.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(ROOT + '/quote-logger-apps-script.gs', 'utf8');
const P = require(path.join(ROOT, 'pricing-engine.js'));

function fn(n) {
  const m = gas.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('not found: ' + n);
  return m[0];
}
const decl = (n, end) => gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?' + end, 'm'))[0];

let fails = 0;
const check = (label, cond, detail) => {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : ''));
  if (!cond) fails++;
};

/* ---------------- the sheet fake ----------------
   Only what these helpers touch, and it behaves the way Sheets does on the
   one point the bug turned on: '' is an empty cell. */
class FakeRange {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValue() { return this.sh._get(this.r, this.c); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sh._get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValue(v) { this.sh._set(this.r, this.c, v); return this; }
  setValues(vals) {
    vals.forEach((row, i) => row.forEach((v, j) => this.sh._set(this.r + i, this.c + j, v)));
    return this;
  }
  setNumberFormat() { return this; }
  setWrap() { return this; }
  setFontWeight() { return this; }
}
class FakeSheet {
  constructor(name, rows) { this.name = name; this.grid = rows || []; this.frozen = 0; }
  getName() { return this.name; }
  _get(r, c) { const row = this.grid[r - 1] || []; const v = row[c - 1]; return v === undefined ? '' : v; }
  _set(r, c, v) {
    while (this.grid.length < r) this.grid.push([]);
    const row = this.grid[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  /* Apps Script: the last row that HAS CONTENT. '' is not content. */
  getLastRow() {
    let last = 0;
    this.grid.forEach((row, i) => {
      if ((row || []).some(v => v !== '' && v !== null && v !== undefined)) last = i + 1;
    });
    return last;
  }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, j) => this._set(r, j + 1, v)); }
  setFrozenRows(n) { this.frozen = n; }
}
class FakeSS {
  constructor(sheets) { this.sheets = sheets; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.getName() === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n, []); this.sheets.push(s); return s; }
}

/* ---------------- the real helpers, lifted out of the .gs ---------------- */
const HEADERS_SRC = decl('HEADERS', '^\\];');
const COL_SRC = decl('COL', 'PHOTOS:23 };');
const DELETED_SRC = gas.match(/^const DELETED_TAB\s*=.*$/m)[0];
const B = new Function('ENGINE', 'SpreadsheetApp', 'console', [
  HEADERS_SRC, COL_SRC, DELETED_SRC,
  'const normalizeQuoteNo = ENGINE.normalizeQuoteNo;',
  'function auditLog_(){}',
  fn('nextQuoteRow_'), fn('rescueClobberedHeader_'), fn('quoteTabFor_'),
  fn('rescueAllQuoteTabs_'), fn('repairImportedRows'), fn('findQuoteRow_'),
  'return {HEADERS,COL,nextQuoteRow_,rescueClobberedHeader_,quoteTabFor_,' +
  'rescueAllQuoteTabs_,repairImportedRows,findQuoteRow_};'
].join('\n'));

function build(ss) { return B(P, { getActiveSpreadsheet: () => ss }, { log: () => {} }); }

const hdr = () => {
  const api = build(new FakeSS([]));
  return api.HEADERS.slice();
};
const HEADERS = hdr();
const QN = 3;
function quoteRow(no, last) {
  const row = new Array(HEADERS.length).fill('');
  row[0] = last; row[QN - 1] = no; row[5] = 'Imported — not yet sent';
  return row;
}

/* =========================== 0. the fake is honest ======================== */
console.log('=== 0. the premise: a row of empty strings is not a row ===');
{
  const sh = new FakeSheet('Golf Cart', [HEADERS.slice()]);
  sh.appendRow(new Array(HEADERS.length).fill(''));
  check('appendRow of empty strings does not move getLastRow', sh.getLastRow() === 1,
    'getLastRow() = ' + sh.getLastRow() + ' (the old code would have written to row 1)');
  sh.appendRow(quoteRow('QW-26-1000', 'Demo'));
  check('appendRow of real content does', sh.getLastRow() === 2);
}

/* ====================== 1. the row an import goes on ====================== */
console.log('=== 1. nextQuoteRow_ ===');
{
  const empty = new FakeSheet('Golf Cart', [HEADERS.slice()]);
  const api = build(new FakeSS([empty]));
  check('header-only tab -> row 2, never row 1', api.nextQuoteRow_(empty) === 2,
    'got ' + api.nextQuoteRow_(empty));

  const full = new FakeSheet('Inside Heated', [HEADERS.slice(),
    quoteRow('QW-26-1001', 'Alpha'), quoteRow('QW-26-1002', 'Bravo'), quoteRow('QW-26-1003', 'Charlie')]);
  check('tab with three quotes -> row 5', api.nextQuoteRow_(full) === 5, 'got ' + api.nextQuoteRow_(full));

  const bare = new FakeSheet('Brand New', []);
  check('completely empty tab -> row 2', api.nextQuoteRow_(bare) === 2);

  /* The refusal. Every quote lost to this bug was lost because the sheet's
     idea of the bottom was wrong, so the one thing the helper must never do is
     trust it blindly: make getLastRow() under-report the way the blank append
     effectively did, and the write has to fail instead of landing on somebody.
     Nothing else here can produce that state, which is the point. */
  const clash = new FakeSheet('Odd', [HEADERS.slice(), quoteRow('QW-26-1004', 'Delta')]);
  clash.getLastRow = () => 1;                       // lies, exactly like the bug
  let threw = false, msg = '';
  try { build(new FakeSS([clash])).nextQuoteRow_(clash); }
  catch (e) { msg = e.message; threw = /already holds quote QW-26-1004/.test(msg); }
  check('refuses to write over a row that already holds a quote', threw, msg || 'no error thrown');
}

/* ================ 2. five imports in a row, on an empty tab =============== */
console.log('=== 2. a batch of imports (the morning that went missing) ===');
{
  const ss = new FakeSS([new FakeSheet('Golf Cart', [HEADERS.slice()])]);
  const api = build(ss);
  const nos = ['QW-26-3441', 'QW-26-3442', 'QW-26-3443', 'QW-26-3444', 'QW-26-3445'];
  nos.forEach((no, i) => {
    const sh = api.quoteTabFor_(ss, 'Golf Cart');
    const row = api.nextQuoteRow_(sh);
    sh.getRange(row, api.COL.LAST).setValue('Owner' + i);
    sh.getRange(row, api.COL.QN).setValue(no);
    sh.getRange(row, api.COL.STATUS).setValue('Imported — not yet sent');
  });
  const sh = ss.getSheetByName('Golf Cart');
  const found = nos.map(no => api.findQuoteRow_(sh, no));
  check('all five are on the sheet', found.every(r => r > 1), 'rows ' + found.join(','));
  check('all five are on DIFFERENT rows', new Set(found).size === 5, 'rows ' + found.join(','));
  check('the header row survived', sh.getRange(1, QN).getValue() === 'Quote #');
  check('the tab is still recognised as a quote tab', sh.getRange(1, 3).getValue() === 'Quote #');
}

/* =============== 3. rescuing a quote out of the header row =============== */
console.log('=== 3. rescueClobberedHeader_ ===');
{
  /* Exactly what the bug left behind: the header gone, the quote in row 1. */
  const sh = new FakeSheet('Golf Cart', [quoteRow('QW-26-3445', 'Jacksonesque')]);
  const api = build(new FakeSS([sh]));
  const to = api.rescueClobberedHeader_(sh);
  check('the stranded quote is moved down', to === 2, 'moved to row ' + to);
  check('the header is back', sh.getRange(1, QN).getValue() === 'Quote #');
  check('every column came with it', sh.getRange(2, 1).getValue() === 'Jacksonesque' &&
    sh.getRange(2, 6).getValue() === 'Imported — not yet sent');
  check('a normal scan now finds it', api.findQuoteRow_(sh, 'QW-26-3445') === 2);
  check('running it again does nothing', api.rescueClobberedHeader_(sh) === 0 && sh.getLastRow() === 2);
}

console.log('=== 4. what it must NOT touch ===');
{
  const healthy = new FakeSheet('Inside Heated', [HEADERS.slice(), quoteRow('QW-26-1001', 'Alpha')]);
  const log = new FakeSheet('Activity Log', [['Timestamp', 'Who', 'Action'], [new Date(), 'Chris', 'LOOKED UP']]);
  const scratch = new FakeSheet('Notes', [['jot', '', ''], ['', '', '']]);
  const numbers = new FakeSheet('Numbers', [['x', 'y', '3445']]);   // bare digits, not a quote number
  const api = build(new FakeSS([healthy, log, scratch, numbers]));
  check('a healthy quote tab is left alone', api.rescueClobberedHeader_(healthy) === 0 &&
    healthy.getLastRow() === 2);
  check('the Activity Log is left alone', api.rescueClobberedHeader_(log) === 0 &&
    log.getRange(1, 3).getValue() === 'Action');
  check('a tab with a blank C1 is left alone', api.rescueClobberedHeader_(scratch) === 0 &&
    scratch.getRange(1, 1).getValue() === 'jot');
  check('bare digits are not a quote number', api.rescueClobberedHeader_(numbers) === 0 &&
    numbers.getRange(1, 3).getValue() === '3445');
}

console.log('=== 5. the sweep and the repair report ===');
{
  const golf = new FakeSheet('Golf Cart', [quoteRow('QW-26-3445', 'Jacksonesque')]);
  const bike = new FakeSheet('E-bike', [quoteRow('QW-26-3446', 'Echo')]);
  const ok = new FakeSheet('Inside Heated', [HEADERS.slice(), quoteRow('QW-26-1001', 'Alpha')]);
  const log = new FakeSheet('Activity Log', [['Timestamp', 'Who', 'Action']]);
  const ss = new FakeSS([golf, bike, ok, log]);
  const api = build(ss);
  const report = api.repairImportedRows();
  check('both stranded quotes are rescued', /Rescued 2 quote\(s\)/.test(report), report.split('\n')[0]);
  check('the report names them', /QW-26-3445/.test(report) && /QW-26-3446/.test(report));
  check('golf cart quote is findable now', api.findQuoteRow_(golf, 'QW-26-3445') === 2);
  check('e-bike quote is findable now', api.findQuoteRow_(bike, 'QW-26-3446') === 2);
  check('no duplicates reported', /No duplicate quote numbers/.test(report));

  /* A number handed out twice is possible precisely because a clobbered tab is
     invisible to takenQuoteNos_, so the repair has to say so. */
  const dupA = new FakeSheet('Golf Cart', [quoteRow('QW-26-3445', 'Jacksonesque')]);
  const dupB = new FakeSheet('Inside Heated', [HEADERS.slice(), quoteRow('QW-26-3445', 'Foxtrot')]);
  const api2 = build(new FakeSS([dupA, dupB]));
  const rep2 = api2.repairImportedRows();
  check('a reissued number is reported, not swallowed', /DUPLICATE quote numbers/.test(rep2) &&
    /QW-26-3445/.test(rep2.split('DUPLICATE')[1]));
}

console.log('=== 6. the tab helper ===');
{
  const ss = new FakeSS([]);
  const api = build(ss);
  const made = api.quoteTabFor_(ss, 'Outside');
  check('a new tab gets its header', made.getRange(1, QN).getValue() === 'Quote #' &&
    made.getLastRow() === 1);
  check('and a frozen header row', made.frozen === 1);
  const headerless = new FakeSheet('No Storage', []);
  const ss2 = new FakeSS([headerless]);
  const api3 = build(ss2);
  api3.quoteTabFor_(ss2, 'No Storage');
  check('an existing tab with no header gets one', headerless.getRange(1, QN).getValue() === 'Quote #');
}

/* ======================= 7. the pattern stays dead ======================= */
console.log('=== 7. the old pattern cannot come back ===');
{
  const body = (gas.match(/^function adminImportApply[\s\S]*?\n}/m) || [''])[0];
  check('adminImportApply exists', body.length > 0);
  /* The comment above adminImportApply quotes the old pattern on purpose, so
     look at code only. */
  const code = gas.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('no appendRow of blanks anywhere in the file',
    !/appendRow\(new Array\([^)]*\)\.fill\(''\)\)/.test(code));
  check('the import takes its row from nextQuoteRow_', /nextQuoteRow_\(sh\)/.test(body));
  check('the import never takes a row from a bare getLastRow()',
    !/rowNum:\s*sh\.getLastRow\(\)\s*[,}]/.test(body));
  check('the import reads the row back before reporting success',
    /findQuoteRow_\(sh, qn\)/.test(body) && /landedRow !== ctx\.rowNum/.test(body));
  check('a failed read-back reports failure, not a quote number',
    /did not land on the/.test(body));
  check('stranded rows are swept at the top of an import', /rescueAllQuoteTabs_\(\);/.test(body));
  const post = (gas.match(/const copies = \[\];[\s\S]*?\n    \}\);/m) || [''])[0];
  check('the customer save path repairs a clobbered tab instead of skipping it',
    /rescueClobberedHeader_\(other\)/.test(post));
}

console.log(fails ? '\nFAILED: ' + fails : '\nAll import-write checks passed.');
process.exit(fails ? 1 : 0);
