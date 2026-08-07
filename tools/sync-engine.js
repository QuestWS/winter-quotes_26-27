#!/usr/bin/env node
/* Copy the shared pricing engine into the Apps Script backend.
   ---------------------------------------------------------------------------
   pricing-engine.js is the ONE source of the rules. The Apps Script cannot
   load it over the network at runtime, so it carries a verbatim copy of the
   block between // ENGINE-START and // ENGINE-END.

   This script is the only sanctioned way to update that copy. Edit
   pricing-engine.js, run `node tools/sync-engine.js`, commit both files.

     node tools/sync-engine.js          rewrite the .gs copy from the engine
     node tools/sync-engine.js --check  exit 1 if they differ (used by verify.sh)

   Never hand-edit the block inside the .gs: verify.sh diffs the two and fails
   the build, which is the guard working, but it costs you a debugging round.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'pricing-engine.js');
const GAS = path.join(ROOT, 'quote-logger-apps-script.gs');
const START = '// ENGINE-START';
const END = '// ENGINE-END';

function block(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  if (a < 0 || b < 0 || b < a) {
    throw new Error(`${path.basename(file)}: missing ${START} / ${END} markers`);
  }
  // Guard against a second marker pair, which would make "the block" ambiguous
  // and let a stale copy hide below the one we rewrite.
  if (src.indexOf(START, a + 1) > -1 || src.indexOf(END, b + 1) > -1) {
    throw new Error(`${path.basename(file)}: more than one ENGINE-START/END pair`);
  }
  return { src, a, b, text: src.slice(a, b + END.length) };
}

const eng = block(ENGINE);
const gas = block(GAS);
const check = process.argv.includes('--check');

if (eng.text === gas.text) {
  console.log('in sync: .gs engine copy matches pricing-engine.js');
  process.exit(0);
}

if (check) {
  console.error('DRIFT: the .gs engine copy differs from pricing-engine.js.');
  console.error('Run `node tools/sync-engine.js` and commit both files.');
  const a = eng.text.split('\n'), b = gas.text.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error(`  first difference at engine line ${i + 1}:`);
      console.error(`    pricing-engine.js: ${a[i] === undefined ? '(end of block)' : a[i]}`);
      console.error(`    .gs copy         : ${b[i] === undefined ? '(end of block)' : b[i]}`);
      break;
    }
  }
  process.exit(1);
}

const out = gas.src.slice(0, gas.a) + eng.text + gas.src.slice(gas.b + END.length);
fs.writeFileSync(GAS, out);
console.log(`synced ${eng.text.split('\n').length} lines of engine into quote-logger-apps-script.gs`);
