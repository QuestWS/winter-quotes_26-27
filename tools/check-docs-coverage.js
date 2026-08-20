#!/usr/bin/env node
/* Prove that no rule was lost when CLAUDE.md was split into docs/ref/.
   ---------------------------------------------------------------------------
   CLAUDE.md is the only reason a later session knows why this code is shaped
   the way it is. Splitting it up is safe; quietly dropping a paragraph while
   splitting it up is the expensive kind of mistake, because nothing fails —
   the rule simply stops being known, and gets violated months later by someone
   who never saw it.

   So the pre-split text is frozen in tools/baseline/claude-md-rules.txt, and
   every line of it must still appear somewhere in the doc set. Rewording a
   rule means updating the baseline deliberately, which is a visible diff in a
   commit. Deleting one by accident fails here.

   It also checks the pointers both ways: every docs/ref file is reachable from
   CLAUDE.md, and every path CLAUDE.md names exists. A reference file nobody is
   pointed at is a file nobody reads. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };

/* ---- 1. every frozen rule still exists somewhere ---- */
const baselinePath = 'tools/baseline/claude-md-rules.txt';
if (!fs.existsSync(path.join(ROOT, baselinePath))) {
  console.error('FAIL: ' + baselinePath + ' is missing — the coverage guard cannot run');
  process.exit(1);
}
const rules = read(baselinePath).split('\n')
  .filter(l => !l.startsWith('#'))          // the file's own explanatory header
  .map(norm).filter(Boolean);

const docFiles = ['CLAUDE.md']
  .concat(fs.readdirSync(path.join(ROOT, 'docs/ref')).sort().map(f => 'docs/ref/' + f));
const haystack = norm(docFiles.map(read).join('\n'));

const missing = rules.filter(r => haystack.indexOf(r) < 0);
if (missing.length) {
  fail(missing.length + ' rule(s) from the baseline no longer appear anywhere in the docs:');
  missing.slice(0, 12).forEach(m => console.error('         · ' + m.slice(0, 150)));
  if (missing.length > 12) console.error('         … and ' + (missing.length - 12) + ' more');
} else {
  console.log('  all ' + rules.length + ' frozen rules still present across ' + docFiles.length + ' file(s)');
}

/* ---- 2. the pointers resolve, both directions ---- */
const claude = read('CLAUDE.md');
fs.readdirSync(path.join(ROOT, 'docs/ref')).forEach(f => {
  if (claude.indexOf('docs/ref/' + f) < 0) {
    fail('docs/ref/' + f + ' is not referenced from CLAUDE.md — nothing would ever send a reader to it');
  }
});
(claude.match(/docs\/[A-Za-z0-9/_.-]+\.md/g) || []).forEach(p => {
  if (!fs.existsSync(path.join(ROOT, p))) fail('CLAUDE.md points at ' + p + ', which does not exist');
});

/* ---- 3. the always-loaded core has not drifted into a reference file ---- */
/* These are the rules that must be in front of anyone before they touch
   anything at all, so they stay in CLAUDE.md itself rather than in a file that
   only gets opened for a matching task. */
[['assert s.count(old) == 1', 'the anchored-edit rule'],
 ['QW-26-1255', 'the test-quote boundary'],
 ['NEVER use "New deployment."', 'the deployment ritual'],
 ['Never send email to a customer', 'the customer-email boundary'],
 ['Never put customer PII in the repo', 'the PII boundary'],
 ['node tools/sync-engine.js', 'the engine sync rule'],
].forEach(([needle, what]) => {
  if (claude.indexOf(needle) < 0) {
    fail(what + ' has left CLAUDE.md — it must be in the always-loaded file, not a reference one');
  }
});

/* ---- 4. docs/MAP.md must still describe the code that exists ----
   A finding aid that sends you to a function which was renamed two months ago
   is worse than no finding aid, because you trust it. Every backticked
   identifier in the map has to be findable in the source. */
{
  const map = read('docs/MAP.md');
  const src = ['quote-logger-apps-script.gs', 'index.html', 'admin/index.html',
               'pricing-engine.js', 'terms-config.js']
    .map(read).join('\n');
  const tools = fs.readdirSync(path.join(ROOT, 'tools'));
  const named = new Set((map.match(/`[A-Za-z_][A-Za-z0-9_]*_?`/g) || [])
    .map(x => x.slice(1, -1))
    .filter(x => x.length > 3 && !/^(and|the|not|null|true|false|keys|pay|adjust|email|photos|admin|view)$/.test(x)));
  const gone = [];
  named.forEach(n => {
    if (new RegExp('\\b' + n + '\\b').test(src)) return;
    if (tools.some(t => t.indexOf(n) > -1)) return;
    gone.push(n);
  });
  if (gone.length) {
    fail('docs/MAP.md names ' + gone.length + ' thing(s) that no longer exist in the code: ' +
      gone.join(', '));
  } else {
    console.log('  docs/MAP.md: all ' + named.size + ' named entry points still exist');
  }
}

/* ---- 5. the whole point: the root file has to stay small ---- */
const rootTokens = Math.round(claude.length / 4);
console.log('  CLAUDE.md is ~' + rootTokens + ' tokens (loaded on every request)');
if (rootTokens > 6000) {
  fail('CLAUDE.md has grown back to ~' + rootTokens + ' tokens — move detail into docs/ref/');
}

if (bad) { console.error('FAIL: ' + bad + ' documentation problem(s)'); process.exit(1); }
console.log('docs hold: every rule still written down, pointers resolve, core rules stay in front');
