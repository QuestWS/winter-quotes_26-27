#!/usr/bin/env node
/* The service tracker's feed — executed, not grepped.
   ---------------------------------------------------------------------------
   The mechanic app in QuestWS/servicetracker asks this backend for every unit
   on Harbor Haul Out's To store list and the work its quote says is to be
   done. Four properties of that answer matter and all four are properties of
   the code, so they are run here:

   1. WHICH UNITS. Pulled and dropped off, and nothing else — not a boat still
      in the water, not one already in a building, not a lead.
   2. WHAT WORK. The service lines, minus Storage, Retrieval, Misc, Discounts
      and Adjustments; open quote requests included and marked.
   3. NO MONEY. No amount, balance, deposit, contract, phone or email on any
      unit — the mechanic needs the job, not the bill.
   4. THE DOOR. No key configured answers nobody; a short key is no key; a
      wrong key of the right length is refused.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
function fn(n) {
  const m = gas.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n); return m[0];
}
const decl = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error('missing ' + n); return m[0];
};

let KEY = '';
const B = new Function('PropertiesService', [
  decl('COL'), decl('PLACEMENT_STATES_'), decl('TRACKER_SKIP_SECS_'),
  fn('placementOf_'), fn('placementStateOf_'), fn('placementAlertOf_'),
  fn('effectiveState_'), fn('customerNoteOf_'),
  fn('trackerWorkOf_'), fn('trackerUnitOf_'), fn('trackerKeyOk_'),
  'return {trackerWorkOf_, trackerUnitOf_, trackerKeyOk_, COL};'
].join('\n'))({ getScriptProperties: () => ({ getProperty: () => KEY }) });

let fails = 0;
const check = (l, c, d) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d ? '  — ' + d : '')); if (!c) fails++; };

const C = B.COL;
function row(qn) {
  const r = new Array(C.DIMS).fill('');
  r[C.QN - 1] = qn; r[C.LAST - 1] = 'White'; r[C.FIRST - 1] = 'John';
  r[C.UNIT - 1] = 'Boat'; r[C.YMM - 1] = '2019 Malibu 22 VLX'; r[C.DIMS - 1] = "22' x 8'6\"";
  r[C.BAL - 1] = 1234.5; r[C.PHONE - 1] = '8155550142'; r[C.EMAIL - 1] = 'x@example.com';
  return r;
}
function quote(state, extra) {
  return Object.assign({
    quoteNo: 'QW-26-1255', state: { slipNo: 'B-12', keyLoc: 'front desk' },
    placement: state === null ? undefined : { state: state, at: '2026-10-01T12:00:00Z', by: 'Jeff' },
    lines: [
      { sec: 'Engine winterization', label: 'Full service — Inboard', amt: 400 },
      { sec: 'Water systems', label: 'Ballast drain × 3 tanks', amt: 90 },
      { sec: 'Shrinkwrap', label: 'Shrinkwrap package (standard)', amt: 500 },
      { sec: 'Storage', label: 'Inside (non-heated) storage — on trailer', amt: 1800 },
      { sec: 'Retrieval', label: 'Retrieve, set & relaunch — included with inside storage', amt: 0 },
      { sec: 'Misc', label: 'Late retrieval surcharge', amt: 50 },
      { sec: 'Discounts', label: 'Heritage Harbor slipholder discount', amt: -100, hho: true },
      { sec: 'Adjustments', label: 'Courtesy credit', amt: -25 },
      { sec: 'Additional services', label: 'Bottom paint touch-up', amt: 225 }
    ],
    quotesRequested: 'Impeller change; Wash & wax',
    payments: [{ amt: 500 }], contractUrl: 'https://example.com/signed.pdf',
    placementAlert: { text: "owner says don't touch the canvas" },
    notes: 'Please check the bilge pump'
  }, extra || {});
}

console.log('=== 1. which units ===');
check('pulled is on the feed', !!B.trackerUnitOf_(row('A'), quote('pulled'), 'Inside'));
check('dropped off is on the feed', !!B.trackerUnitOf_(row('A'), quote('dropped'), 'Inside'));
check('still in the water is not', B.trackerUnitOf_(row('A'), quote(''), 'Inside') === null);
check('nothing recorded is not', B.trackerUnitOf_(row('A'), quote(null), 'Inside') === null);
check('already stored is not', B.trackerUnitOf_(row('A'), quote('stored'), 'Inside') === null);
check('an unknown state is not', B.trackerUnitOf_(row('A'), quote('launched'), 'Inside') === null);
check('the pre-rename d.yard still counts',
  !!B.trackerUnitOf_(row('A'), quote(null, { yard: { state: 'pulled', at: 'x' } }), 'Inside'));
check('a lead tab is left out of the read', /isOffstageTab_\(sh\.getName\(\)\)/.test(fn('trackerFeed_')));

console.log('\n=== 2. what work ===');
{
  const u = B.trackerUnitOf_(row('QW-26-1255'), quote('pulled'), 'Inside');
  const labels = u.work.map((w) => w.label);
  check('winterization is there', labels.includes('Full service — Inboard'));
  check('water systems and shrinkwrap are there', labels.includes('Ballast drain × 3 tanks') && labels.includes('Shrinkwrap package (standard)'));
  check('a staff-priced request is there', labels.includes('Bottom paint touch-up'));
  check('storage, retrieval, misc, discounts, adjustments are not',
    !labels.some((l) => /storage —|Retrieve|surcharge|discount|credit/i.test(l)), JSON.stringify(labels));
  const rq = u.work.filter((w) => w.requested).map((w) => w.label);
  check('open quote requests are there and marked', rq.join('|') === 'Impeller change|Wash & wax', JSON.stringify(rq));
  check('the alert and the customer note cross', u.alert === "owner says don't touch the canvas" && u.cnote === 'Please check the bilge pump');
  check('slip and keys come off the effective state', u.slip === 'B-12' && u.keys === 'front desk');
  const m = B.trackerUnitOf_(row('A'), quote('pulled', { manual: { measured: { keyLoc: 'lockbox 4' } } }), 'Inside');
  check('a staff correction to the keys wins', m.keys === 'lockbox 4', m.keys);
  check('no duplicate labels', new Set(labels).size === labels.length);
  check('a quote with no lines has no work, not a crash',
    B.trackerUnitOf_(row('A'), { placement: { state: 'dropped' } }, 'X').work.length === 0);
}

console.log('\n=== 3. no money ===');
{
  const u = B.trackerUnitOf_(row('A'), quote('pulled'), 'Inside');
  const text = JSON.stringify(u);
  check('no amounts on the work', u.work.every((w) => !('amt' in w)));
  ['1234', '500', '1800', 'signed.pdf', '8155550142', 'example.com', 'balance', 'deposit', 'contract', 'phone', 'email', 'paid']
    .forEach((bad) => check('nothing says ' + bad, text.toLowerCase().indexOf(bad.toLowerCase()) === -1));
}

console.log('\n=== 4. the door ===');
KEY = '';
check('no key configured refuses every caller', !B.trackerKeyOk_('') && !B.trackerKeyOk_('anything'));
KEY = 'short-key';
check('a short key is no key', !B.trackerKeyOk_('short-key'));
KEY = 'k'.repeat(40);
check('the right key opens it', B.trackerKeyOk_('k'.repeat(40)));
check('a wrong key of the same length does not', !B.trackerKeyOk_('k'.repeat(39) + 'x'));
check('a wrong length does not', !B.trackerKeyOk_('k'.repeat(41)));
check('doPost routes it before the quote save',
  gas.indexOf("if (d.api === 'tracker') return trackerServe_(d);") > 0 &&
  gas.indexOf("if (d.api === 'tracker')") < gas.indexOf('const postedTab = d.storageTab'));
check('trackerServe_ checks the key before anything else',
  /if \(!trackerKeyOk_\(p && p\.key\)\)/.test(fn('trackerServe_')));
check('the feed writes nothing',
  !/setValue|setValues|appendRow|deleteRow|savePdf_|recomputeTotals_|auditLog_/.test(fn('trackerFeed_') + fn('trackerUnitOf_') + fn('trackerServe_')));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall good');
process.exit(fails ? 1 : 0);
