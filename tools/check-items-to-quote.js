#!/usr/bin/env node
/* Items to Quote — itemsToQuoteOf_ executed against real engine output.
   ---------------------------------------------------------------------------
   The console prints "Items to Quote as of <date>" and Harbor Haul Out shows
   the same items on the row and the opened unit. Both read `tq` off the
   storage-view row, which itemsToQuoteOf_ in the .gs decides. This runs it:

     OPEN     a detail request nobody has priced                → 'open'
     PRICED   the same request priced by staff (adminPriceRequest's shape) → 'quoted' + amount
     SKI      a jetski detail (an engine-priced line)           → 'quoted'
     PW       powerwash on a boat with an LOA                   → 'quoted', wash
     ACID     acid wash AND powerwash ticked                    → only the acid wash (it replaces it)
     NODIMS   acid wash with no LOA/beam                        → 'dims', wash
     OFF      staff took the request off in the console        → nothing
     NONE     a quote with none of it                           → empty
   Plus: both clients render `tq`, and the storage row carries it. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'pricing-engine.js'));
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const adm = fs.readFileSync(path.join(ROOT, 'admin', 'index.html'), 'utf8');
const hho = fs.readFileSync(path.join(ROOT, 'harbor-haul-out', 'index.html'), 'utf8');

function fn(name) {
  const m = gas.match(new RegExp('^function ' + name + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) { console.error('FAIL: cannot find ' + name); process.exit(1); }
  return m[0];
}
const cst = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=.*;$', 'm'));
  if (!m) { console.error('FAIL: cannot find const ' + n); process.exit(1); }
  return m[0];
};
const B = new Function('QUOTE_ITEMS',
  cst('TQ_WASH_RE_') + '\n' + fn('effectiveState_') + '\n' + fn('itemsToQuoteOf_') +
  '\nreturn { effectiveState_, itemsToQuoteOf_ };')(E.QUOTE_ITEMS);

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

const boat = (o) => Object.assign({
  unit: 'boat', hasTrailer: false, isPontoon: false,
  engines: { inboard: { qty: 1, level: 'basic' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 0, level: 'basic' }, jet: { qty: 0, level: 'basic' } },
  loa: 24, beam: 8, lwt: 0, storage: 'outside', retrieval: 'none',
  dtTrans: 0, dtTransom: 0, ballast: 0, addlHeads: 0,
  waterCold: false, waterHead: false, ac: false, genBasic: false, genFull: false,
  wrap: false, inWater: false, powerwash: false, acidWash: false,
  bottomTouch: false, bottomStrip: false, propRefurb: false, extDetail: false,
  washWax: false, intDetail: false, intWipe: false, impeller: false
}, o || {});
/* A payload the way the server stores one: engine lines and open requests. */
function quote(state, manual) {
  const d = { state: state, manual: manual || {} };
  const r = E.computeQuote(B.effectiveState_(d));
  d.lines = r.lines.slice();
  d.quotesRequested = r.rq.join('; ');
  return d;
}
const tq = (d) => B.itemsToQuoteOf_(d, B.effectiveState_(d));
const show = (t) => t.map((x) => x.l + ':' + x.s + (x.a != null ? '=' + x.a : '') + (x.w ? ':w' : '')).join(', ');

{
  const t = tq(quote(boat({ extDetail: true })));
  if (t.length === 1 && t[0].l === 'Exterior detail' && t[0].s === 'open') ok('OPEN detail request → needs price');
  else fail('OPEN: ' + show(t));
}
{
  /* adminPriceRequest's shape: a priced entry, the line, the request closed. */
  const d = quote(boat({ washWax: true }));
  d.manual.priced = [{ rqLabel: 'Wash & wax', label: 'Wash & wax — 24ft', amt: 304, sec: 'Additional services' }];
  d.lines.push({ sec: 'Additional services', label: 'Wash & wax — 24ft', calc: '', amt: 304, desc: '' });
  d.quotesRequested = '';
  const t = tq(d);
  if (t.length === 1 && t[0].s === 'quoted' && t[0].a === 304) ok('PRICED request → quoted $304');
  else fail('PRICED: ' + show(t));
}
{
  const t = tq(quote({ unit: 'jetski', engines: { pwc: { qty: 1, level: 'basic' } }, skiLen: 10, skiWid: 4, skiDetail: 1, storage: 'inside' }));
  if (t.length === 1 && /^Jetski detail/.test(t[0].l) && t[0].s === 'quoted' && t[0].a > 0) ok('SKI jetski detail → quoted');
  else fail('SKI: ' + show(t));
}
{
  const t = tq(quote(boat({ powerwash: true })));
  if (t.length === 1 && t[0].l === 'Powerwash hull' && t[0].s === 'quoted' && t[0].w && t[0].a > 0) ok('PW powerwash → quoted, a wash');
  else fail('PW: ' + show(t));
}
{
  const t = tq(quote(boat({ powerwash: true, acidWash: true })));
  if (t.length === 1 && /^Acid wash hull/.test(t[0].l) && t[0].w) ok('ACID acid wash replaces the powerwash — one entry');
  else fail('ACID: ' + show(t));
}
{
  const t = tq(quote(boat({ acidWash: true, loa: 0, beam: 0 })));
  if (t.length === 1 && t[0].s === 'dims' && t[0].w) ok('NODIMS acid wash without dimensions → needs dimensions');
  else fail('NODIMS: ' + show(t));
}
{
  const t = tq(quote(boat({ propRefurb: true }), { services: { propRefurb: false } }));
  if (!t.length) ok('OFF a request staff took off is not listed');
  else fail('OFF: ' + show(t));
}
{
  const t = tq(quote(boat({ wrap: true })));
  if (!t.length) ok('NONE nothing to list');
  else fail('NONE: ' + show(t));
}
{
  const d = quote(boat({ extDetail: true, acidWash: true }));
  const t = tq(d);
  if (t.length === 2) ok('detail and wash on one quote → both listed');
  else fail('BOTH: ' + show(t));
}

/* Wiring: the row carries it, and both clients draw it. */
if (/tq = itemsToQuoteOf_\(pd, st\)/.test(gas) && /\btq: tq\b/.test(gas)) ok('storage row carries tq');
else fail('adminStorageView no longer puts tq on the row');
if (/function printItemsToQuote\(/.test(adm) && /x\.tq/.test(adm)) ok('console prints Items to Quote from tq');
else fail('console Items to Quote print missing');
if (/function tq_\(/.test(hho) && /tq_\(x\)/.test(hho) && /renderTq\(listRow\)/.test(hho)) ok('Harbor Haul Out shows tq on the row and the unit');
else fail('Harbor Haul Out no longer shows tq');

/* Pricing a request: its own permission (canQuote_), falling back to adjust.
   Chris, Nov 4 2026: John prices details from Harbor Haul Out without adjust. */
{
  const canQuote_ = new Function(fn('canQuote_') + '\nreturn canQuote_;')();
  const cases = [
    [{ admin: true, perms: {} }, true, 'admin'],
    [{ perms: { adjust: 1 } }, true, 'unset, adjust → yes (as before)'],
    [{ perms: { adjust: 0, keys: 1 } }, false, 'unset, no adjust → no'],
    [{ perms: { adjust: 0, quote: 1 } }, true, 'explicit quote ON without adjust (John)'],
    [{ perms: { adjust: 1, quote: 0 } }, false, 'explicit quote OFF wins over adjust'],
  ];
  cases.forEach((c) => { if (canQuote_(c[0]) === c[1]) ok('canQuote_: ' + c[2]); else fail('canQuote_: ' + c[2]); });
  if (/function adminPriceRequest\(token[^)]*\) \{\n  const who = requireAuth_\(token, 'quote'\)/.test(gas)) ok('adminPriceRequest is gated on quote');
  else fail('adminPriceRequest is not gated on the quote permission');
  if (/\(perm === 'quote'\) \? canQuote_\(st\)/.test(gas) && /p\.quote = canQuote_\(st\)/.test(gas)) ok('requireAuth_ and resolvedPerms_ know quote');
  else fail('requireAuth_/resolvedPerms_ do not resolve quote');
  if (/function canQuote\(/.test(hho) && /api\('priceRequest'/.test(hho)) ok('Harbor Haul Out can price an open request');
  else fail('Harbor Haul Out price box missing');
  if (/quote:'Price requests'/.test(adm) && /btn\('quote',st\.perms\.quote\)/.test(adm)) ok('console Staff panel has the Price requests toggle');
  else fail('console Staff panel toggle missing');
}

if (bad) { console.error(bad + ' failure(s)'); process.exit(1); }
console.log('items to quote: all checks passed');
