#!/usr/bin/env node
/* Quest winter system — pricing baseline harness.
 *
 * WHY THIS EXISTS
 * The pricing-engine extraction (docs/TASK-pricing-engine.md) has one hard
 * gate: the page must price identically to the cent, before vs. after. This
 * harness produces the evidence for that gate.
 *
 * HOW IT STAYS HONEST
 * It does NOT contain a copy of the pricing rules. It slices the live source
 * text out of index.html by locating each block's own opening line, so the
 * numbers it reports always come from the real file. If index.html changes,
 * this re-reads the change. A copy would drift; a slice cannot.
 *
 *   node tools/price-fixtures.js            # human-readable
 *   node tools/price-fixtures.js --json     # machine-diffable
 *
 * After the extraction lands, this same file is pointed at the shared engine
 * and the two outputs must match exactly.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---- slice a top-level block out of index.html by its opening line ----
 * Anchored on the exact declaration text and closed on the first line that
 * is the matching terminator at column 0. Asserts a unique hit, per the
 * project's editing discipline (CLAUDE.md §3) — a missed or ambiguous anchor
 * must fail loudly, never silently return nothing. */
function slice(openLine, closeLine) {
  const lines = SRC.split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (lines[i] === openLine) starts.push(i);
  if (starts.length !== 1) {
    throw new Error(`MISS: ${starts.length} matches for opening line ${JSON.stringify(openLine)}`);
  }
  const s = starts[0];
  for (let j = s + 1; j < lines.length; j++) {
    if (lines[j] === closeLine) return lines.slice(s, j + 1).join('\n');
  }
  throw new Error(`MISS: no terminator ${JSON.stringify(closeLine)} after ${JSON.stringify(openLine)}`);
}

const BLOCKS = [
  slice('const SEASON = {', '};'),
  slice('const PRICES = {', '};'),
  slice('const RULES = {', '};'),
  slice('const LEVEL_DESC = {', '};'),
  slice('const BOAT_ENGINES = [', '];'),
  slice('const QUOTE_ITEMS = [', '];'),
  SRC.split('\n').find(l => l.startsWith('const fmt = ')),
  slice('function wrapAuto(){', '}'),
  slice('function computeLinesRaw(){', '}'),
];
if (!BLOCKS[6]) throw new Error('MISS: fmt declaration not found');

/* The page's own initial state object, used as each fixture's base so a
 * fixture only has to state what it changes. */
const BASE_STATE_SRC = slice('const S = {', '};');

/* ---- fixtures: the five shapes docs/TASK-pricing-engine.md calls for,
 * plus the live test quote named in CLAUDE.md §6. ---- */
const FIXTURES = [
  {
    name: 'boat-twin-inboard-full',
    why: 'Twin inboard, full service, shrinkwrap + acid wash + inside-on-trailer. The brief\'s headline case.',
    state: {
      unit: 'boat', loa: 28, beam: 8, lwt: 30, hasTrailer: true,
      engines: { inboard: { qty: 2, level: 'full' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 0, level: 'basic' }, pwc: { qty: 0, level: 'basic' } },
      dtTrans: 2, waterCold: true, storage: 'inside', wrap: true, acidWash: true,
    },
  },
  {
    name: 'boat-wide-beam-no-trailer',
    why: 'Beam 9.2 > RULES.acidBeamMax and > insideBeamMaxNT, non-trailered. Exercises the wide-beam acid rate and the blocking charge.',
    state: {
      unit: 'boat', loa: 32, beam: 9.2, lwt: 0, hasTrailer: false,
      engines: { inboard: { qty: 0, level: 'basic' }, io: { qty: 1, level: 'full' }, outboard: { qty: 0, level: 'basic' }, pwc: { qty: 0, level: 'basic' } },
      dtTransom: 1, storage: 'inside', wrap: true, acidWash: true, retrieval: 'quest',
    },
  },
  {
    name: 'boat-outside-perfoot-retrieval-large',
    why: 'LOA 40 > retrieveSmallMaxLOA (36) with outside storage — the large retrieval tier and per-foot outside rate.',
    state: {
      unit: 'boat', loa: 40, beam: 12, hasTrailer: false,
      engines: { inboard: { qty: 2, level: 'basic' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 0, level: 'basic' }, pwc: { qty: 0, level: 'basic' } },
      storage: 'outside', retrieval: 'quest', wrap: true, inWater: true, powerwash: true,
      waterHead: true, addlHeads: 2, ac: true, genFull: true,
    },
  },
  {
    name: 'boat-small-flat20-wrap',
    why: 'LOA 19 hits the flat ≤20ft wrap package; trailered outboard with customer-trailer retrieval.',
    state: {
      unit: 'boat', loa: 19, beam: 7, lwt: 21, hasTrailer: true,
      engines: { inboard: { qty: 0, level: 'basic' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 1, level: 'basic' }, pwc: { qty: 0, level: 'basic' } },
      storage: 'none', retrieval: 'custTrailer', wrap: true, powerwash: true,
    },
  },
  {
    name: 'jetski-inside-detail',
    why: 'PWC full service, two skis detailed, inside storage priced from ski L×W.',
    state: {
      unit: 'jetski', skiLen: 12, skiWid: 5, skiDetail: 2,
      engines: { inboard: { qty: 0, level: 'basic' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 0, level: 'basic' }, pwc: { qty: 2, level: 'full' } },
      storage: 'inside',
    },
  },
  {
    name: 'golf-cart',
    why: 'Flat-rate land unit — the shape of CLAUDE.md\'s live test quote QW-26-3477.',
    state: { unit: 'golf' },
  },
  {
    name: 'ebike',
    why: 'Flat-rate land unit including tune-up.',
    state: { unit: 'ebike' },
  },
  {
    name: 'boat-late-retrieval-hho-quoterequests',
    why: 'Late-retrieval surcharge, HHO zero-dollar line, and open quote-requests (rq list must survive the extraction too).',
    state: {
      unit: 'boat', loa: 24, beam: 8.5, hasTrailer: false,
      engines: { inboard: { qty: 0, level: 'basic' }, io: { qty: 1, level: 'basic' }, outboard: { qty: 0, level: 'basic' }, pwc: { qty: 0, level: 'basic' } },
      storage: 'outside', lateRetrieval: true, hho: true, slipNo: 'B-14',
      bottomTouch: true, extDetail: true, propRefurb: true,
    },
  },
  {
    name: 'boat-missing-dims',
    why: 'Deliberately incomplete — the `need` prompts are part of the contract and must not change either.',
    state: {
      unit: 'boat', loa: 0, beam: 0, hasTrailer: false,
      engines: { inboard: { qty: 1, level: 'basic' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 0, level: 'basic' }, pwc: { qty: 0, level: 'basic' } },
      storage: 'outside', wrap: true, acidWash: true, retrieval: 'quest',
    },
  },
];

/* Deep-merge a fixture's overrides onto the page's own base state. */
function applyOverrides(S, over) {
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && S[k] && typeof S[k] === 'object') {
      applyOverrides(S[k], v);
    } else {
      S[k] = v;
    }
  }
}

function runFixture(fx) {
  // Fresh sandbox per fixture so no state bleeds between cases.
  const ctx = vm.createContext({});
  vm.runInContext(BLOCKS.join('\n'), ctx, { filename: 'index.html:engine' });
  vm.runInContext(BASE_STATE_SRC.replace(/^const S = \{/, 'var S = {'), ctx, { filename: 'index.html:state' });
  ctx.__over = JSON.parse(JSON.stringify(fx.state));
  ctx.__apply = applyOverrides;
  vm.runInContext('__apply(S, __over)', ctx);
  const out = vm.runInContext('computeLinesRaw()', ctx);

  const lines = out.L.map(l => ({
    sec: l.sec || '', label: l.label,
    amt: l.amt == null ? null : Number(l.amt),
    calc: l.calc || '',
  }));
  // Total is the sum of line amounts — the same basis the page and sheet use.
  const total = lines.reduce((a, l) => a + (Number(l.amt) || 0), 0);
  return { name: fx.name, why: fx.why, lines, need: out.need, rq: out.rq, total: Number(total.toFixed(2)) };
}

const results = FIXTURES.map(runFixture);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  for (const r of results) {
    console.log('\n=== ' + r.name + ' ===');
    console.log('  ' + r.why);
    for (const l of r.lines) {
      const amt = l.amt == null ? 'incl.' : money(l.amt);
      console.log('   ' + amt.padStart(11) + '  [' + (l.sec || '-') + '] ' + l.label + (l.calc ? '   (' + l.calc + ')' : ''));
    }
    if (r.need.length) console.log('   NEEDS: ' + r.need.join('; '));
    if (r.rq.length) console.log('   QUOTE REQUESTS: ' + r.rq.join('; '));
    console.log('   ' + 'TOTAL'.padStart(9) + '  ' + money(r.total));
  }
  console.log('\n' + results.length + ' fixtures · grand total ' +
    money(results.reduce((a, r) => a + r.total, 0)));
}
