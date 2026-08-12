#!/usr/bin/env node
/* Execute the send-to-all recipient list against a fake spreadsheet.
   ---------------------------------------------------------------------------
   This is the highest-blast-radius path in the system: one click, every
   customer, no way to un-send. The rule that matters is that a LEAD — someone
   who reached the pricing and walked away — is never in that list. Emailing a
   stranger, possibly a competitor, a seasonal note about "your boat" is the
   failure this exists to prevent.

   A grep for `isStartedTab_` proves the identifier appears. It does not prove
   the lead row is actually excluded — an inverted condition, a tab whose header
   check runs first, or a second sweep somewhere else all pass a grep and still
   email the lead. So this stands up a spreadsheet with a lead on it and reads
   the answer.

   It also pins the per-kind tab rules, because "which tabs does the spring
   alert skip" is a product decision (nothing to relaunch for a unit we never
   stored) that is easy to lose in a refactor. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

function grab(re, what) {
  const m = gas.match(re);
  if (!m) { console.error('FAIL: could not find ' + what + ' in the backend'); process.exit(1); }
  return m[0];
}
/* One-liners first: `function f(x) { ... }` has no closing brace in column 0,
   so the multi-line pattern would run past it and swallow whatever follows. */
const fn = (name) => {
  const one = gas.match(new RegExp('^function ' + name + '\\b.*}\\s*$', 'm'));
  return one ? one[0] : grab(new RegExp('^function ' + name + '\\b[\\s\\S]*?\\n}', 'm'), name);
};
const decl = (name) => grab(new RegExp('^const ' + name + '\\s*=[\\s\\S]*?;\\s*$', 'm'), name);

/* --- a spreadsheet, small enough to reason about ------------------------- */
const TABS = [
  { name: 'Inside',        rows: [['Adams', 'Q-IN-1', 'a@x.com'], ['Boone', 'Q-IN-2', 'b@x.com']] },
  { name: 'Premium Inside',rows: [['Cline', 'Q-PI-1', 'c@x.com']] },
  { name: 'Outside',       rows: [['Doyle', 'Q-OU-1', 'd@x.com']] },
  { name: 'No Storage',    rows: [['Ellis', 'Q-NS-1', 'e@x.com']] },
  { name: 'Golf Cart',     rows: [['Frost', 'Q-GC-1', 'f@x.com']] },
  { name: 'E-Bike',        rows: [['Grant', 'Q-EB-1', '']] },          // no email
  { name: 'Quote Started', rows: [['Hyde',  'Q-LD-1', 'lead@x.com']] },// THE lead
  /* Not a quote tab. Its rows are given quote-number- and email-shaped values in
     those column positions on purpose: the header probe is the ONLY thing that
     tells a customer list from a log, so the test has to make the probe matter. */
  { name: 'Activity Log',  rows: [['Log', 'Q-LOG-1', 'staff@questwatersports.com']], notAQuoteTab: true },
];

const HEADERS_LEN = 23;
const COL = { QN: 3, EMAIL: 9, PAYLOAD: 21 };

function sheetFor(t) {
  const grid = t.rows.map(function (r) {
    const row = new Array(HEADERS_LEN).fill('');
    row[0] = r[0];
    row[COL.QN - 1] = r[1];
    row[COL.EMAIL - 1] = r[2];
    row[COL.PAYLOAD - 1] = JSON.stringify({ quoteNo: r[1], lastName: r[0], unit: 'Boat' });
    return row;
  });
  return {
    getName: () => t.name,
    getLastRow: () => grid.length + 1,
    getRange: function (r, c, nr, nc) {
      if (nr === undefined) {                       // single cell: the header probe
        return { getValue: () => (r === 1 && c === 3 && !t.notAQuoteTab) ? 'Quote #' : '' };
      }
      return { getValues: () => grid.slice(r - 2, r - 2 + nr).map(row => row.slice(c - 1, c - 1 + nc)) };
    }
  };
}

const SpreadsheetApp = {
  getActiveSpreadsheet: () => ({ getSheets: () => TABS.map(sheetFor) })
};

let B;
try {
  B = new Function('SpreadsheetApp', [
    "const STARTED_TAB = 'Quote Started';",
    fn('isStartedTab_'),
    decl('HEADERS'),
    decl('COL'),
    decl('BULK_KINDS_'),
    fn('bulkTargets_'),
    'return { bulkTargets_, BULK_KINDS_ };'
  ].join('\n'))(SpreadsheetApp);
} catch (err) {
  console.error('FAIL: the send-to-all target list does not execute standalone — ' + err.message);
  process.exit(1);
}

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };

const kinds = Object.keys(B.BULK_KINDS_);
if (!kinds.length) fail('no send-to-all kinds are defined at all');

for (const kind of kinds) {
  let t;
  try { t = B.bulkTargets_(kind); }
  catch (e) { fail(kind + ' threw: ' + e.message); continue; }

  const qns = t.targets.map(x => x.d.quoteNo);
  const tabs = t.targets.map(x => x.tab);

  /* 1. The rule this file exists for. */
  if (qns.indexOf('Q-LD-1') > -1) fail(kind + ' would email a LEAD (Q-LD-1) — leads are never customers');
  if (tabs.indexOf('Quote Started') > -1) fail(kind + ' pulled a target off the lead tab');

  /* 2. A row with no email address cannot be sent to, and must be reported
        rather than silently dropped — staff need to know who was missed. */
  if (qns.indexOf('Q-EB-1') > -1) fail(kind + ' targeted a quote with no email address');
  if (t.noEmail.indexOf('Q-EB-1') < 0) fail(kind + ' did not report the missing address on Q-EB-1');

  /* 3. Non-quote tabs are not customer lists. */
  if (tabs.indexOf('Activity Log') > -1) fail(kind + ' treated the Activity Log as a customer tab');

  /* 4. The per-kind product rule. */
  const cfg = B.BULK_KINDS_[kind];
  for (const skip of cfg.skipTabs) {
    if (tabs.indexOf(skip) > -1) fail(kind + ' included ' + skip + ', which it is configured to skip');
  }
  if (kind === 'spring' && cfg.skipTabs.indexOf('No Storage') < 0) {
    fail('the spring alert must skip No Storage — there is nothing to relaunch for a unit we never stored');
  }
  if (kind === 'fall' && cfg.skipTabs.length) {
    fail('the end-of-season note must reach every tab — a No Storage customer still has to get the unit to us');
  }

  /* 5. Everyone else really is in. */
  const expect = TABS
    .filter(x => !x.notAQuoteTab && x.name !== 'Quote Started' && cfg.skipTabs.indexOf(x.name) < 0)
    .reduce((a, x) => a.concat(x.rows.filter(r => r[2]).map(r => r[1])), []);
  const missing = expect.filter(q => qns.indexOf(q) < 0);
  if (missing.length) fail(kind + ' missed ' + missing.join(', '));

  /* 6. The per-tab breakdown the console shows must add up to the send. */
  const summed = Object.keys(t.byTab).reduce((a, k) => a + t.byTab[k], 0);
  if (summed !== t.targets.length) {
    fail(kind + ' reports ' + summed + ' recipients by tab but would send to ' + t.targets.length);
  }

  console.log('  ' + kind.padEnd(7) + ' -> ' + t.targets.length + ' recipient(s): ' + qns.join(', ') +
    '   (no email: ' + (t.noEmail.join(', ') || 'none') + ')');
}

/* An unknown kind must produce nothing, not everything. */
for (const junk of ['', 'receipt', 'quote', 'latewarn']) {
  let threw = false, n = -1;
  try { n = B.bulkTargets_(junk).targets.length; } catch (e) { threw = true; }
  if (!threw && n > 0) fail('kind ' + JSON.stringify(junk) + ' produced ' + n + ' recipients — only announcements may be blasted');
}

if (bad) { console.error('FAIL: ' + bad + ' send-to-all violation(s)'); process.exit(1); }
console.log('send-to-all holds: leads excluded, non-quote tabs ignored, per-kind tab rules enforced');
