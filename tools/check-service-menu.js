#!/usr/bin/env node
/* Services added from the console are journalled, priced by the engine, and
   reversible.
   ---------------------------------------------------------------------------
   The console's "Add or remove services" card is the answer to a real problem:
   a service typed into the Adjustment card is a frozen dollar figure that
   never follows a re-measure or next season's rate card. So a staff-added
   service has to reach the engine as the SAME state key the customer's own
   control writes — and it has to live in the manual journal, never in
   d.state, or the customer's next save (which posts whatever is still ticked
   in their browser) would silently undo it.

   Everything here is executed, not grepped: the real effectiveState_ and the
   real sanitizer are lifted out of the .gs and run against the real engine. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'pricing-engine.js'));
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function fn(name) {
  const m = gas.match(new RegExp('^function ' + name + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) { console.error('FAIL: cannot find ' + name); process.exit(1); }
  return m[0];
}
const a = gas.indexOf('// ENGINE-START'), b = gas.indexOf('// ENGINE-END');
const B = new Function(
  gas.slice(a, b) + '\n' +
  ['effectiveState_', 'serviceMenuFor_', 'serviceItem_', 'cleanServiceValue_', 'sanitizeServices_'].map(fn).join('\n') +
  '\nreturn { effectiveState_, sanitizeServices_, serviceMenuFor_ };'
)();

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };

const boat = () => ({
  unit: 'boat', hasTrailer: false, isPontoon: false,
  engines: { inboard: { qty: 1, level: 'basic' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 0, level: 'basic' }, jet: { qty: 0, level: 'basic' } },
  loa: 24, beam: 8, lwt: 0, storage: 'outside', retrieval: 'none',
  dtTrans: 0, dtTransom: 0, ballast: 0, addlHeads: 0,
  waterCold: false, waterHead: false, ac: false, genBasic: false, genFull: false,
  wrap: false, inWater: false, powerwash: false, acidWash: false,
  bottomTouch: false, bottomStrip: false, propRefurb: false, extDetail: false,
  washWax: false, intDetail: false, intWipe: false, impeller: false
});
const ski = () => ({ unit: 'jetski', engines: { pwc: { qty: 1, level: 'basic' } }, skiLen: 10, skiWid: 4, skiDetail: 0, storage: 'inside' });
const priced = (d) => E.computeQuote(B.effectiveState_(d));
const total = (r) => r.lines.reduce((s, l) => s + Number(l.amt || 0), 0);

console.log('=== every menu item reaches the engine through the journal ===');
{
  E.SERVICE_MENU.forEach((item) => {
    const base = item.units[0] === 'jetski' ? ski() : boat();
    /* A dependent item needs its parent on; give it the parent in the base
       state so the item itself is what is being tested. */
    if (item.needs) base[item.needs] = true;
    const d = { state: base, manual: {} };
    const before = priced(d);
    const on = item.kind === 'flag' ? true : item.kind === 'count' ? 2
      : item.options.map((o) => o[0]).filter((v) => v !== 'none')[0];
    d.manual.services = {}; d.manual.services[item.key] = on;
    const after = priced(d);
    const moved = Math.abs(total(after) - total(before)) > 0.005;
    const opened = after.rq.length > before.rq.length;
    if (item.request) {
      if (!opened) fail(item.key + ': a quote request should have opened');
      if (moved) fail(item.key + ': a quote request must not move the total on its own');
    } else if (!moved) {
      fail(item.key + ': adding it did not change the priced total');
    }
    /* And off again returns to exactly where it started. */
    d.manual.services[item.key] = item.kind === 'flag' ? false : item.kind === 'count' ? 0 : 'none';
    const off = priced(d);
    if (Math.abs(total(off) - total(before)) > 0.005) fail(item.key + ': taking it off did not return the total');
    if (off.rq.length !== before.rq.length) fail(item.key + ': taking it off left a quote request open');
  });
  console.log('  ' + E.SERVICE_MENU.length + ' items: each adds a line or a request, and comes off cleanly');
}

console.log('=== the customer\'s own answers are never touched ===');
{
  const d = { state: boat(), manual: { services: { powerwash: true, ballast: 2, impeller: true } } };
  const before = JSON.stringify(d.state);
  priced(d);
  B.sanitizeServices_({ waterCold: 1 }, B.effectiveState_(d));
  if (JSON.stringify(d.state) !== before) fail('pricing a staff-added service mutated d.state');
  if (d.state.powerwash !== false) fail('a staff-added service was written into the customer state');
  const body = (gas.match(/^function adminServicesApply[\s\S]*?\n}/m) || [''])[0];
  if (!body) fail('adminServicesApply is missing');
  if (/\bd\.state\.[A-Za-z]+\s*=/.test(body) || /\bd\.state\s*=/.test(body)) fail('adminServicesApply assigns into d.state');
  if (!/m\.services\s*=/.test(body)) fail('adminServicesApply does not journal into manual.services');
  console.log('  d.state unchanged; the service lives only in the journal');
}

console.log('=== every menu key is a control the customer page can show back ===');
{
  /* The page is handed the effective state on reload, so a service added here
     appears ticked on the customer's own page — but only if the page has a
     control for that key. A key with no control would price on the server and
     be invisible to the customer. */
  E.SERVICE_MENU.forEach((item) => {
    const k = item.key;
    const has = new RegExp('data-chk="' + k + '"').test(page) || new RegExp('data-qty="' + k + '"').test(page) ||
      new RegExp('name="?' + k + '"?').test(page);
    if (!has) fail(k + ' has no control on index.html — the customer could never see it');
  });
  console.log('  every key maps to a checkbox, counter or radio group on the quote page');
}

console.log('=== the menu never overlaps what other cards own ===');
{
  const dims = [].concat.apply([], Object.keys(E.DIM_FIELDS).map((k) => E.DIM_FIELDS[k].map((f) => f[0])));
  const owned = dims.concat(['engines', 'storage', 'hasTrailer', 'pumpout', 'lateRetrieval', 'keyLoc', 'slipNo', 'trailerLoc', 'hho']);
  E.SERVICE_MENU.forEach((item) => {
    if (owned.indexOf(item.key) > -1) fail(item.key + ' is on the services menu but belongs to the dimensions, penalties or keys card');
    if (item.units.some((u) => u === 'golf' || u === 'ebike')) fail(item.key + ' is offered to a land unit, which is one flat line');
  });
  const seen = {};
  E.SERVICE_MENU.forEach((item) => { if (seen[item.key]) fail('duplicate menu key ' + item.key); seen[item.key] = 1; });
  E.QUOTE_ITEMS.forEach((q) => { if (!seen[q[0]]) fail('quote item ' + q[0] + ' is not on the menu — staff could not open that request'); });
  console.log('  no overlap with the other cards; every QUOTE_ITEMS entry is on the menu');
}

console.log('=== the sanitizer refuses what would silently do the wrong thing ===');
{
  const st = B.effectiveState_({ state: boat(), manual: {} });
  const throws = (changes, re, what) => {
    try { B.sanitizeServices_(changes, st); fail(what + ' was accepted'); }
    catch (e) { if (!re.test(String(e.message))) fail(what + ': wrong message: ' + e.message); }
  };
  throws({ ballast: '' }, /Enter a number/, 'a blank count');
  throws({ ballast: '-1' }, /whole number/, 'a negative count');
  throws({ ballast: '1.5' }, /whole number/, 'a fractional count');
  throws({ addlHeads: 2 }, /needs "Water system incl. 1 head"/, 'heads with no head system');
  throws({ inWater: 1 }, /needs "Shrinkwrap"/, 'in-water wrap with no wrap');
  throws({ retrieval: 'teleport' }, /Pick an option/, 'an unknown retrieval choice');
  throws({ loa: 30 }, /not a service/, 'a dimension key');
  throws({ pumpout: 1 }, /not a service/, 'a penalty key');
  throws({ skiDetail: 1 }, /not a service/, 'a jetski service on a boat');
  const both = B.sanitizeServices_({ addlHeads: 2, waterHead: 1 }, st);
  if (both.addlHeads !== 2 || both.waterHead !== true) fail('turning a dependent and its parent on together was refused');
  const same = B.sanitizeServices_({ powerwash: 0, ballast: '0', retrieval: 'none' }, st);
  if (Object.keys(same).length) fail('a change to the value already in force was journalled: ' + JSON.stringify(same));
  const str = B.sanitizeServices_({ powerwash: '1', ballast: ' 3 ' }, st);
  if (str.powerwash !== true || str.ballast !== 3) fail('form strings were not normalised: ' + JSON.stringify(str));
  console.log('  blank, negative, fractional, orphaned, unknown and foreign keys all refused; no-ops dropped');
}

console.log('=== a staff-added service follows the boat, not a frozen figure ===');
{
  /* The whole reason for the card. The same powerwash on the same quote prices
     differently once the boat is re-measured, and the request stays open
     across a re-measure and a penalty. */
  const d = { state: boat(), manual: { services: { powerwash: true, impeller: true } } };
  const at24 = priced(d).lines.find((l) => /Powerwash/.test(l.label));
  d.manual.measured = { loa: 30 };
  const at30 = priced(d).lines.find((l) => /Powerwash/.test(l.label));
  if (!at24 || !at30) fail('the powerwash line is missing');
  else if (Math.abs(at30.amt - at24.amt - 6 * E.PRICES.powerwashFt) > 0.005) fail('the powerwash did not re-price with the new LOA');
  d.manual.penalties = { pumpout: true };
  const r = priced(d);
  if (!r.lines.some((l) => /Powerwash/.test(l.label))) fail('a penalty dropped the staff-added service');
  if (!r.lines.some((l) => /Pumpout/.test(l.label))) fail('the service overlay dropped the penalty');
  if (r.rq.indexOf('Impeller change') < 0) fail('the impeller request did not survive a re-measure and a penalty');
  console.log('  powerwash $' + at24.amt.toFixed(2) + ' at 24\' → $' + at30.amt.toFixed(2) + ' at 30\'; request and penalty both survive');
}

console.log('=== the overlay wins over the customer either way ===');
{
  /* Off is a decision too: the customer decided against the detailing on the
     phone, and their browser still has it ticked. */
  const st = boat(); st.acidWash = true; st.ballast = 3;
  const d = { state: st, manual: { services: { acidWash: false, ballast: 1 } } };
  const r = priced(d);
  if (r.lines.some((l) => /Acid wash/.test(l.label))) fail('a staff removal did not override the customer\'s selection');
  const bal = r.lines.find((l) => /Ballast/.test(l.label));
  if (!bal || !/× 1 tank\b/.test(bal.label)) fail('a staff count did not override the customer\'s count');
  console.log('  a staff "off" and a staff count both beat what the customer\'s browser posted');
}

if (bad) { console.error('FAIL: ' + bad + ' service-menu problem(s)'); process.exit(1); }
console.log('service menu holds: journalled not stated, priced by the engine, follows the boat, reversible');
