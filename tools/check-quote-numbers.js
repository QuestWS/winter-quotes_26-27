#!/usr/bin/env node
/* Quote numbers must not collide — executed, not read.
   ---------------------------------------------------------------------------
   Every write path finds a quote BY NUMBER: saveQuoteRow_ overwrites the row
   findQuoteRow_ returns and savePdf_ replaces the Drive file whose title
   carries it. So a duplicate number is not a clash staff would notice, it is
   one customer's row and PDF silently replaced by another's.

   The old page-side draw was four random digits against nothing. Reading the
   new code cannot tell you it is safe — only running it can, which is what
   this does, against a spreadsheet that already has numbers on it:

     - a number already on the sheet is never handed out again
     - a number reserved minutes ago (someone still filling in the form) is
       never handed out again either
     - a proposed number that IS free is kept, so a caller that already has
       one does not churn a new one for nothing
     - a proposed number that is taken is replaced
     - minting many in a row — the import batch case — yields no duplicates
     - EXISTING NUMBERS ARE NEVER REWRITTEN: minting touches no sheet cell
     - the four-digit space filling up widens the draw rather than failing,
       and what comes out still round-trips through normalizeQuoteNo

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const E = require(path.join(ROOT, 'pricing-engine.js'));

/* Slice a function out of the .gs by name. The one-line form is matched FIRST:
   a single-line function has no "\n}" of its own, so the multi-line pattern
   would run straight past it and swallow everything up to the next one —
   which is how isStartedTab_ came back carrying the COL declaration with it.
   Same two-branch shape as tools/check-reprice.js. */
function fn(n) {
  const one = gas.match(new RegExp('^function ' + n + '\\b.*}\\s*$', 'm'));
  if (one) return one[0];
  const m = gas.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n);
  return m[0];
}
const decl = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error('missing const ' + n);
  return m[0];
};

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

/* ---- a spreadsheet with numbers already on it, and a write tripwire ---- */
let sheetWrites = 0;
/* getRange(2, COL.QN, n, 1).getValues() is the only read the minter makes. */
function makeSSExact(tabs) {
  return {
    getSheets: () => tabs.map(t => {
      const grid = t.rows;
      return {
        getName: () => t.name,
        getLastRow: () => grid.length + 1,
        getRange: (r, c, nr, nc) => nr === undefined
          ? { getValue: () => (r === 1 && c === 3 && !t.notQuote) ? 'Quote #' : '',
              setValue: () => { sheetWrites++; } }
          : { getValues: () => grid.slice(r - 2, r - 2 + nr).map(qn => [qn]),
              setValue: () => { sheetWrites++; } }
      };
    })
  };
}

let props = {};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; }
  })
};
let lockGranted = true;
const LockService = { getScriptLock: () => ({ tryLock: () => lockGranted, releaseLock: () => {} }) };

function build(ss) {
  const SpreadsheetApp = { getActiveSpreadsheet: () => ss };
  return new Function('SpreadsheetApp', 'PropertiesService', 'LockService', 'normalizeQuoteNo', [
    decl('COL'),
    decl('QNO_RESERVE_KEY_'), decl('QNO_RESERVE_TTL_MIN_'), decl('QNO_LOCK_MS_'),
    decl('DELETED_TAB'),
    /* takenQuoteNos_ asks quoteTabGrids_ first; with no Sheets service in this
       sandbox it answers null and the per-tab reads below are what run — which
       is exactly the fallback these checks exist to hold correct. */
    gas.match(/^let _tabGridsOff_.*$/m)[0], fn('quoteTabGrids_'),
    fn('takenQuoteNos_'), fn('readReservations_'), fn('uniqueQuoteNo_'),
    'return {uniqueQuoteNo_, takenQuoteNos_, readReservations_};'
  ].join('\n'))(SpreadsheetApp, PropertiesService, LockService, E.normalizeQuoteNo);
}

const YY = String(new Date().getFullYear()).slice(2);
const Q = (n) => 'QW-' + YY + '-' + n;

/* ================= a taken number is never handed out again ================= */
console.log('=== a number already on the sheet is never reissued ===');
{
  props = {}; sheetWrites = 0;
  /* Fill almost the whole four-digit space, so a blind random draw would
     essentially always collide and only a real check can pass this. */
  const taken = [];
  for (let n = 1000; n <= 9990; n++) taken.push(Q(String(n)));
  const api = build(makeSSExact([{ name: 'Inside', rows: taken }]));
  const seen = {};
  taken.forEach(t => { seen[t] = 1; });
  let collided = 0;
  for (let i = 0; i < 9; i++) {
    const got = api.uniqueQuoteNo_('');
    if (seen[got]) collided++;
    seen[got] = 1;
  }
  if (collided) fail(collided + ' of 9 mints returned a number already on the sheet');
  else ok('9 mints into a sheet holding 8,991 of the 9,000 four-digit numbers, no collision');
  if (sheetWrites) fail('minting wrote to the spreadsheet ' + sheetWrites + ' time(s) — existing rows must not be touched');
  else ok('minting wrote nothing to the spreadsheet');
}

/* ============ a DELETED number is still taken ============ */
console.log('=== a deleted quote\'s number is never handed out again ===');
{
  props = {}; sheetWrites = 0;
  /* The archive tab deliberately fails the 'Quote #' header probe, so that
     every sheet sweep skips it. The minter is the one place that must still
     read it: reissuing the number would have savePdf_ replace one customer's
     PDF with another's, and the archive and the Activity Log would describe
     two different people under one number. */
  const live = [];
  for (let n = 1000; n <= 9998; n++) live.push(Q(String(n)));
  const gone = Q('9999');
  const api = build(makeSSExact([
    { name: 'Inside', rows: live },
    { name: 'Deleted Quotes', rows: [gone], notQuote: true }
  ]));
  if (!api.takenQuoteNos_()[gone]) fail('the archived number is not counted as taken');
  else ok('the archive is read by the minter even though it is not a quote tab');
  const got = api.uniqueQuoteNo_(gone);
  if (got === gone) fail('the minter handed back a deleted quote\'s number');
  else ok('asked for the deleted number by name, the minter widened instead (' + got + ')');
}

/* ================= the space filling up widens rather than fails ============ */
console.log('=== a full four-digit space widens to five digits ===');
{
  props = {}; sheetWrites = 0;
  const taken = [];
  for (let n = 1000; n <= 9999; n++) taken.push(Q(String(n)));
  const api = build(makeSSExact([{ name: 'Inside', rows: taken }]));
  let got;
  try { got = api.uniqueQuoteNo_(''); }
  catch (e) { fail('a full four-digit space threw instead of widening: ' + e.message); got = null; }
  if (got) {
    if (taken.indexOf(got) > -1) fail('widened draw still returned a taken number: ' + got);
    else if (!/^QW-\d{2}-\d{5}$/.test(got)) fail('expected a five-digit number, got ' + got);
    else if (E.normalizeQuoteNo(got) !== got) fail('the widened number does not round-trip through normalizeQuoteNo: ' + got);
    else ok('widened to ' + got + ', and it round-trips through normalizeQuoteNo');
  }
}

/* ================= reservations hold across the mint→save gap ============== */
console.log('=== a number reserved by someone still filling in the form is held ===');
{
  props = {}; sheetWrites = 0;
  const api = build(makeSSExact([{ name: 'Inside', rows: [] }]));
  const first = api.uniqueQuoteNo_('');
  /* Nothing has been saved to the sheet — the sheet is still empty — so only
     the reservation can stop the next mint handing out the same number. */
  const seen = { [first]: 1 };
  let repeat = 0;
  for (let i = 0; i < 300; i++) {
    const got = api.uniqueQuoteNo_('');
    if (seen[got]) repeat++;
    seen[got] = 1;
  }
  if (repeat) fail(repeat + ' of 300 mints repeated a number that was reserved but not yet saved');
  else ok('301 back-to-back mints against an empty sheet, all distinct (the import-batch case)');
}

/* ================= an expired reservation is released ====================== */
console.log('=== an abandoned reservation expires rather than burning the number ===');
{
  props = {}; sheetWrites = 0;
  const api = build(makeSSExact([{ name: 'Inside', rows: [] }]));
  const stale = Q('4242');
  const old = Date.now() - (2 * 60 * 60 * 1000);   // 2h ago, TTL is 90min
  props['QNO_RESERVATIONS'] = JSON.stringify({ [stale]: old });
  const kept = api.uniqueQuoteNo_(stale);
  if (kept !== stale) fail('an expired reservation still blocked its number (' + stale + ' -> ' + kept + ')');
  else ok('a reservation older than the TTL is released');

  props['QNO_RESERVATIONS'] = JSON.stringify({ [stale]: Date.now() });
  const moved = api.uniqueQuoteNo_(stale);
  if (moved === stale) fail('a LIVE reservation was handed out anyway');
  else ok('a live reservation is respected (' + stale + ' -> ' + moved + ')');
}

/* ================= a proposed number is kept when free, replaced when not == */
console.log('=== a proposed number is kept only when it is actually free ===');
{
  props = {}; sheetWrites = 0;
  const api = build(makeSSExact([{ name: 'Inside', rows: [Q('1255')] }]));
  const free = api.uniqueQuoteNo_(Q('7777'));
  if (free !== Q('7777')) fail('a free proposed number was not kept: ' + free);
  else ok('a free proposed number is kept as-is');

  props = {};
  const api2 = build(makeSSExact([{ name: 'Inside', rows: [Q('1255')] }]));
  const clash = api2.uniqueQuoteNo_(Q('1255'));
  if (clash === Q('1255')) fail('a proposed number that is already on the sheet was handed out anyway');
  else ok('a taken proposed number is replaced (' + Q('1255') + ' -> ' + clash + ')');
}

/* ================= a non-quote tab is not scanned for numbers ============== */
console.log('=== only quote tabs are read ===');
{
  props = {}; sheetWrites = 0;
  const api = build(makeSSExact([
    { name: 'Inside', rows: [Q('1111')] },
    { name: 'Activity Log', rows: [Q('2222')], notQuote: true }
  ]));
  const taken = api.takenQuoteNos_();
  if (!taken[Q('1111')]) fail('a real quote number was missed');
  else if (taken[Q('2222')]) fail('a value on the Activity Log was treated as a quote number');
  else ok('the Activity Log is not scanned (its column 3 header is not "Quote #")');
}

/* ================= losing the lock still produces a usable number ========== */
console.log('=== a lock we cannot get degrades, it does not break ===');
{
  props = {}; sheetWrites = 0; lockGranted = false;
  const api = build(makeSSExact([{ name: 'Inside', rows: [Q('1255')] }]));
  const got = api.uniqueQuoteNo_('');
  lockGranted = true;
  if (!got || !/^QW-\d{2}-\d{3,5}$/.test(got)) fail('no usable number when the lock was unavailable: ' + got);
  else if (got === Q('1255')) fail('without the lock it handed out a number already on the sheet');
  else ok('still checks the sheet and returns ' + got + ' when the lock is unavailable');
}

if (bad) { console.error('\n' + bad + ' quote-number check(s) FAILED'); process.exit(1); }
console.log('\nquote numbers: every mint checked against the sheet and the live reservations');
