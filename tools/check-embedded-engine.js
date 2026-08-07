#!/usr/bin/env node
/* Prove the engine copy embedded in the Apps Script actually RUNS, and prices
   identically to pricing-engine.js.
   ---------------------------------------------------------------------------
   Why this exists alongside the byte-diff in verify.sh:

   The diff proves the two copies are textually identical. It does NOT prove
   the block works where it is pasted. In pricing-engine.js the block sits
   inside an IIFE; in the .gs it sits at the top level of the script. If the
   block ever started leaning on something the wrapper provides — a closure
   variable, `root`, a helper defined outside the markers — the diff would
   still pass and the backend would throw at runtime, on a customer's save.

   So: pull the block out of the .gs, execute it as bare top-level code the
   way Apps Script will, and compare its output to the module's on every
   fixture. Any reference that does not travel with the block fails here.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const a = gas.indexOf('// ENGINE-START');
const b = gas.indexOf('// ENGINE-END');
if (a < 0 || b < 0) {
  console.error('no engine block in quote-logger-apps-script.gs — nothing to check');
  process.exit(0);
}

let embedded;
try {
  // No wrapper, no arguments: exactly the scope Apps Script gives it.
  embedded = new Function(gas.slice(a, b) + '\nreturn { computeQuote };')();
} catch (err) {
  console.error('FAIL: the embedded engine block does not execute standalone.');
  console.error('      ' + err.message);
  console.error('      Something inside the markers depends on the module wrapper.');
  process.exit(1);
}

const mod = require(path.join(ROOT, 'pricing-engine.js'));
const states = JSON.parse(
  execFileSync('node', [path.join(ROOT, 'tools/price-fixtures.js'), '--dump-states'],
    { maxBuffer: 1e8 }).toString()
);

let bad = 0;
for (const f of states) {
  let got;
  try {
    got = JSON.stringify(embedded.computeQuote(f.state));
  } catch (err) {
    console.error(`  THREW ${f.name}: ${err.message}`);
    bad++;
    continue;
  }
  if (got !== JSON.stringify(mod.computeQuote(f.state))) {
    console.error(`  DIFF  ${f.name}`);
    bad++;
  }
}

if (bad) {
  console.error(`FAIL: embedded engine diverges from pricing-engine.js on ${bad} fixture(s)`);
  process.exit(1);
}
console.log(`embedded engine executes standalone and matches on all ${states.length} fixtures`);
