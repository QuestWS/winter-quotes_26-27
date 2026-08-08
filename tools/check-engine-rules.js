#!/usr/bin/env node
/* Execute the console's motor-correction rules and assert the invariants.
   ---------------------------------------------------------------------------
   A boat may have MULTIPLES of one motor type but never a MIX (CLAUDE.md
   section 4). The console lets staff correct a count, which means it can also
   change the type — and a half-applied change would leave a boat with two
   inboards AND an outboard, quietly charging for both.

   That is a property of the code, not of a string, so grepping cannot check
   it. This pulls sanitizeEngines_ out of the .gs, runs it over every
   type/count combination, and asserts what comes out. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
function fn(name) {
  const m = gas.match(new RegExp('^function ' + name + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) {
    console.error('FAIL: could not find ' + name + ' in the backend');
    process.exit(1);
  }
  return m[0];
}

let S;
try {
  S = new Function(fn('sanitizeEngines_') + '\nreturn sanitizeEngines_;')();
} catch (err) {
  console.error('FAIL: sanitizeEngines_ does not execute standalone — ' + err.message);
  process.exit(1);
}

const BOAT_TYPES = ['inboard', 'io', 'outboard'];
const start = {
  unit: 'boat',
  engines: {
    inboard: { qty: 2, level: 'full' }, io: { qty: 0, level: 'basic' },
    outboard: { qty: 0, level: 'basic' }, pwc: { qty: 0, level: 'basic' }
  }
};

let bad = 0;
const fail = (msg) => { console.error('  FAIL ' + msg); bad++; };

// Every type, every plausible count: exactly one boat type may end up active.
for (const t of BOAT_TYPES) {
  for (let q = 0; q <= 8; q++) {
    for (const level of ['basic', 'full']) {
      let out;
      try {
        out = S({ type: t, qty: q, level: level }, start);
      } catch (err) {
        fail(`${t} × ${q} (${level}) threw: ${err.message}`);
        continue;
      }
      const active = BOAT_TYPES.filter(k => Number((out[k] || {}).qty || 0) > 0);
      if (q === 0 && active.length !== 0) fail(`${t} × 0 left ${active.join(',')} active`);
      if (q > 0 && (active.length !== 1 || active[0] !== t)) {
        fail(`${t} × ${q} produced active=[${active.join(',')}] — a boat cannot mix motor types`);
      }
      if (Number((out.pwc || {}).qty || 0) !== 0) fail(`${t} × ${q} left a jet ski count on a boat`);
      if (t === 'outboard' && !out._clearTrans) {
        fail('outboard did not clear the transmission count — outboards have no V-drive');
      }
      if (t !== 'outboard' && out._clearTrans) {
        fail(`${t} cleared the transmission count when it should not`);
      }
    }
  }
}

// A jet ski quote only ever touches pwc.
{
  const ski = { unit: 'jetski', engines: JSON.parse(JSON.stringify(start.engines)) };
  const out = S({ qty: 3, level: 'full' }, ski);
  if (Number(out.pwc.qty) !== 3) fail('jet ski count not applied');
  if (BOAT_TYPES.some(k => Number(out[k].qty) > 0)) fail('jet ski left boat motors active');
}

// Counts that are not whole positive numbers must be refused, sign included —
// stripping non-digits first would turn -1 into a valid 1.
for (const badQty of [-1, -5, 1.5, 9, 100, 'two', '', null]) {
  let threw = false;
  try { S({ type: 'inboard', qty: badQty, level: 'basic' }, start); } catch (e) { threw = true; }
  if (!threw) fail(`motor count ${JSON.stringify(badQty)} was accepted`);
}

// Unknown type or level must be refused.
for (const t of ['', 'rocket', 'pwc']) {
  let threw = false;
  try { S({ type: t, qty: 1, level: 'basic' }, start); } catch (e) { threw = true; }
  if (!threw) fail(`motor type ${JSON.stringify(t)} was accepted on a boat`);
}
{
  let threw = false;
  try { S({ type: 'inboard', qty: 1, level: 'deluxe' }, start); } catch (e) { threw = true; }
  if (!threw) fail('service level "deluxe" was accepted');
}

if (bad) {
  console.error(`FAIL: ${bad} motor-rule violation(s)`);
  process.exit(1);
}
console.log('motor rules hold: one type per boat, whole counts only, outboards carry no V-drive');
