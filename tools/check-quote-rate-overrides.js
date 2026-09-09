#!/usr/bin/env node
/* Per-quote negotiated rates (QUOTE_RATE_OVERRIDES in pricing-engine.js) must
   hold three things at once, and none of them are provable by reading the
   code — only by running it:

   1. The named quote gets the negotiated rate.
   2. EVERY other quote — including one with no quote number at all — still
      gets the normal PRICES rate. An override that leaked would look like a
      bug in someone else's bill, not a feature.
   3. The override survives a season-wide rate change to everyone else. That
      is the entire point of keeping it outside the Annual Update Zone: a
      rollover only ever edits PRICES, so this proves an edit there cannot
      reach in and overwrite the negotiated number. */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'pricing-engine.js'));

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };

const OVERRIDE_QUOTE = 'QW-26-1991';
const OVERRIDE_RATE = 6.74;

/* A minimal, complete boat state — inside, non-trailer, so the only line
   this produces is the one under test. */
function baseState(quoteNo, storage, hasTrailer) {
  return {
    unit: 'boat', quoteNo: quoteNo || '', hasTrailer: !!hasTrailer,
    loa: 24, beam: 8, lwt: 0, storage: storage || 'inside', retrieval: 'none',
    engines: { inboard: { qty: 0, level: 'basic' }, io: { qty: 0, level: 'basic' },
               outboard: { qty: 0, level: 'basic' }, jet: { qty: 0, level: 'basic' },
               pwc: { qty: 0, level: 'basic' } },
    dtTrans: 0, dtTransom: 0, ballast: 0, waterCold: false, waterHead: false,
    addlHeads: 0, pumpout: false, ac: false, genBasic: false, genFull: false,
    wrap: false, inWater: false, powerwash: false, acidWash: false,
    lateRetrieval: false, hho: false, slipNo: '', isPontoon: false,
    trailerOverhang: 0, impeller: false, bottomTouch: false, bottomStrip: false,
    propRefurb: false, extDetail: false, washWax: false, intDetail: false,
    intWipe: false, firstName: '', lastName: '', phone: '', email: '',
    ymm: '', notes: '', skiLen: 0, skiWid: 0, skiDetail: 0
  };
}
function storageLine(state) {
  const r = E.computeQuote(state);
  return r.lines.find(l => l.sec === 'Storage');
}
const stdRate = E.PRICES.insideNT;
const sqft = 24 * 8;

console.log('=== the named quote gets the negotiated rate ===');
{
  const li = storageLine(baseState(OVERRIDE_QUOTE, 'inside', false));
  if (!li) fail('no storage line produced at all');
  else {
    if (Math.abs(li.amt - OVERRIDE_RATE * sqft) > 0.001) fail(`${OVERRIDE_QUOTE} priced at ${li.amt}, expected ${OVERRIDE_RATE * sqft} (rate ${OVERRIDE_RATE})`);
    if (li.calc.indexOf('$' + OVERRIDE_RATE) < 0) fail(`calc string "${li.calc}" does not show the negotiated rate`);
    else console.log(`  ${OVERRIDE_QUOTE}: ${li.calc} = $${li.amt}`);
  }
}

console.log('\n=== every other quote still gets the normal rate ===');
for (const qn of ['', 'QW-26-1990', 'QW-26-1992', 'QW-25-1991', 'qw-26-1991']) {
  const li = storageLine(baseState(qn, 'inside', false));
  const expect = stdRate * sqft;
  if (Math.abs(li.amt - expect) > 0.001) fail(`quoteNo=${JSON.stringify(qn)} priced at ${li.amt}, expected the standard ${expect} — the override leaked`);
}
console.log(`  standard rate ($${stdRate}/sqft) held for blank, near-miss, and case-different quote numbers`);

console.log('\n=== the override is scoped to inside/non-trailer only — premium and on-trailer are untouched ===');
{
  const prem = storageLine(baseState(OVERRIDE_QUOTE, 'insidePrem', false));
  const expectPrem = E.PRICES.insidePremNT * sqft;
  if (Math.abs(prem.amt - expectPrem) > 0.001) fail(`premium inside for ${OVERRIDE_QUOTE} priced at ${prem.amt}, expected the normal premium rate ${expectPrem}`);
  else console.log(`  premium inside still $${E.PRICES.insidePremNT}/sqft for ${OVERRIDE_QUOTE}`);

  const trailerState = baseState(OVERRIDE_QUOTE, 'inside', true);
  trailerState.lwt = 26; // on-trailer inside storage prices off LWT × beam, not LOA
  const onTrailer = storageLine(trailerState);
  const expectT = E.PRICES.insideT * 26 * 8;
  if (Math.abs(onTrailer.amt - expectT) > 0.001) fail(`on-trailer inside for ${OVERRIDE_QUOTE} priced at ${onTrailer.amt}, expected the normal on-trailer rate ${expectT}`);
  else console.log(`  on-trailer inside still $${E.PRICES.insideT}/sqft for ${OVERRIDE_QUOTE}`);
}

console.log('\n=== the override survives a season-wide rate change to everyone else ===');
{
  const before = E.PRICES.insideNT;
  const bumped = before + 1.5;
  E.PRICES.insideNT = bumped; // simulates editing the Annual Update Zone for the new season
  try {
    const overridden = storageLine(baseState(OVERRIDE_QUOTE, 'inside', false));
    if (Math.abs(overridden.amt - OVERRIDE_RATE * sqft) > 0.001) {
      fail(`${OVERRIDE_QUOTE} moved to ${overridden.amt} after a PRICES.insideNT change — the override did not survive the season update`);
    } else {
      console.log(`  PRICES.insideNT bumped ${before} -> ${bumped}; ${OVERRIDE_QUOTE} still prices at $${OVERRIDE_RATE}/sqft`);
    }
    const everyoneElse = storageLine(baseState('', 'inside', false));
    if (Math.abs(everyoneElse.amt - bumped * sqft) > 0.001) {
      fail(`a normal quote did not pick up the new season rate after the update — expected ${bumped * sqft}, got ${everyoneElse.amt}`);
    } else {
      console.log(`  a normal quote correctly picked up the new rate: $${bumped}/sqft`);
    }
  } finally {
    E.PRICES.insideNT = before; // leave the module's shared state exactly as found
  }
}

if (bad) {
  console.error(`\nFAIL: ${bad} quote-rate-override violation(s)`);
  process.exit(1);
}
console.log('\nquote rate overrides hold: named quote gets its rate, nobody else does, and a season update cannot overwrite it');
