#!/usr/bin/env node
/* Pumpout and late retrieval are penalties, not choices.
   ---------------------------------------------------------------------------
   The customer is no longer offered either one, so the ONLY way they can be
   charged is a staff member applying them. Two things have to hold, and a grep
   proves neither:

   1. A penalty must reach the engine and actually be priced. It rides the same
      overlay as a re-measure rather than getting its own line-building code,
      so this executes that overlay against the real engine.

   2. It must never be written into d.state. That object is the customer's own
      answers; staff changes live in the journal so a customer reloading and
      re-saving their quote rebuilds cleanly and then has our changes replayed
      on top. A penalty written into their state would look like something they
      asked for, and would be erased the next time they touched the quote. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'pricing-engine.js'));
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

function fn(name) {
  const m = gas.match(new RegExp('^function ' + name + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) { console.error('FAIL: cannot find ' + name); process.exit(1); }
  return m[0];
}
const B = new Function(fn('effectiveState_') + '\nreturn {effectiveState_};')();

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };

const baseState = () => ({
  unit: 'boat', hasTrailer: false, isPontoon: false,
  engines: { inboard: { qty: 1, level: 'basic' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 0, level: 'basic' } },
  loa: 24, beam: 8, lwt: 0, storage: 'outside', retrieval: 'quest',
  dtTrans: 0, dtTransom: 0, ballast: 0, addlHeads: 0,
  pumpout: false, lateRetrieval: false
});
const priceOf = (d) => {
  const st = B.effectiveState_(d);
  return E.computeQuote(st).lines.reduce((a, l) => a + Number(l.amt || 0), 0);
};
const hasLine = (d, re) => E.computeQuote(B.effectiveState_(d)).lines.some(l => re.test(l.label));

console.log('=== a penalty in the journal is priced by the engine ===');
{
  const d = { state: baseState(), manual: {} };
  const clean = priceOf(d);
  if (hasLine(d, /Pumpout/)) fail('a fresh quote already carries a pumpout charge');

  d.manual.penalties = { pumpout: true };
  const withPump = priceOf(d);
  if (!hasLine(d, /Pumpout/)) fail('applying the pumpout penalty did not add the line');
  const delta = Math.round((withPump - clean) * 100) / 100;
  if (delta !== E.PRICES.pumpout) fail('pumpout moved the total by ' + delta + ', expected ' + E.PRICES.pumpout);
  console.log('  pumpout        +$' + delta);

  d.manual.penalties.lateRetrieval = true;
  const both = priceOf(d);
  const d2 = Math.round((both - withPump) * 100) / 100;
  if (d2 !== E.PRICES.lateRetrieval) fail('late retrieval moved the total by ' + d2 + ', expected ' + E.PRICES.lateRetrieval);
  console.log('  late retrieval +$' + d2);

  /* Removing one puts the total back exactly. */
  d.manual.penalties.pumpout = false;
  const off = priceOf(d);
  if (Math.round((both - off) * 100) / 100 !== E.PRICES.pumpout) fail('removing the pumpout did not return the total');
  if (hasLine(d, /Pumpout/)) fail('the pumpout line survived being switched off');
  console.log('  removing one returns the total exactly');
}

console.log('=== the customer\'s own answers are never touched ===');
{
  const d = { state: baseState(), manual: { penalties: { pumpout: true, lateRetrieval: true } } };
  const before = JSON.stringify(d.state);
  priceOf(d);
  if (JSON.stringify(d.state) !== before) fail('pricing a penalty mutated d.state');
  if (d.state.pumpout !== false || d.state.lateRetrieval !== false) {
    fail('a penalty was written into the customer state');
  }
  console.log('  d.state unchanged; the penalty lives only in the journal');
}

console.log('=== a later re-measure cannot drop a penalty ===');
{
  const d = { state: baseState(), manual: { penalties: { lateRetrieval: true }, measured: { loa: 30, beam: 9 } } };
  if (!hasLine(d, /Late retrieval/)) fail('a re-measure dropped the late retrieval surcharge');
  const st = B.effectiveState_(d);
  if (st.loa !== 30) fail('the re-measure itself was lost');
  console.log('  measured LOA ' + st.loa + " and the surcharge both survive");
}

console.log('=== the source of truth is the journal, so nothing is offered to the customer ===');
{
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const k of ['pumpout', 'lateRetrieval']) {
    if (new RegExp('data-chk="' + k + '"').test(page)) {
      fail('index.html still offers "' + k + '" as a customer checkbox — it is a penalty, not an option');
    }
  }
  if (!/adminPenalty/.test(gas)) fail('there is no way for staff to apply a penalty');
  console.log('  no customer checkbox for either; staff have adminPenalty()');
}

console.log('=== only the slipholder discount may be negative ===');
{
  if (!E.isDiscountRequest('Heritage Harbor Slipholder discount — slip B-14')) {
    fail('the slipholder discount is not recognised as a discount request');
  }
  for (const other of ['Exterior detail', 'Impeller change', 'Wash & wax', '']) {
    if (E.isDiscountRequest(other)) fail(JSON.stringify(other) + ' would be allowed to go on as a credit');
  }
  /* The server must enforce it in both places a request can be priced. */
  const guards = (gas.match(/isDiscountRequest\(/g) || []).length;
  if (guards < 2) fail('the sign rule is enforced in ' + guards + ' place(s); both the console and the sheet menu price requests');
  console.log('  sign rule enforced in ' + guards + ' places; only the slipholder discount may be a credit');
}

if (bad) { console.error('FAIL: ' + bad + ' penalty/discount problem(s)'); process.exit(1); }
console.log('penalties hold: journalled not stated, priced by the engine, reversible');
