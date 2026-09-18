#!/usr/bin/env node
/* One Quest palette, proven identical everywhere it is written down.
   ---------------------------------------------------------------------------
   The colours, type scale and radius in quest.css were invented in index.html
   and then re-typed into legal.css. Nothing checked them against each other,
   so the two copies were free to drift, and a third page would have made it
   three. The failure is quiet and cumulative: nobody notices that one page's
   --muted is two shades off, they just notice, eventually, that the site looks
   slightly assembled.

   quest.css is the canonical file. sign.html links it and declares nothing of
   its own. index.html and legal.css keep their own :root block on purpose —
   index.html is the page a customer pays on, and making its palette depend on
   a second network request would let one failed GET render the money path
   unstyled — so the copies stay and this holds them to the original. Same
   bargain the pricing engine already makes: duplicate where the runtime
   demands it, prove the duplicates identical in CI.

   A deliberate difference is allowed, but it has to be declared BELOW with a
   reason, which makes it a visible line in a diff instead of a typo nobody
   catches.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let fail = 0;
const bad = m => { console.error('  FAIL ' + m); fail = 1; };
const ok  = m => console.log('  ok: ' + m);

/* Deliberate divergences: file -> token -> why. Anything not listed here must
   match quest.css exactly. */
const ALLOWED = {
  'legal.css': {
    '--ink':  'full black — legal.css §contrast: greying the text down is the one ' +
              'change that would undermine the conspicuousness of Terms §5',
    '--line': 'a darker rule that reads as a printed document, not a web card',
  },
};

/* Every :root{...} block in a file, merged. A file may open more than one
   (quest.css keeps color-scheme in its own), and a later declaration of the
   same token wins, exactly as the cascade would resolve it. */
function tokensIn(src) {
  const out = {};
  const re = /:root\s*(?:\{)/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    src.slice(re.lastIndex, i - 1).split(';').forEach(decl => {
      const p = decl.indexOf(':');
      if (p < 0) return;
      const name = decl.slice(0, p).trim();
      if (name.slice(0, 2) !== '--') return;
      out[name] = decl.slice(p + 1).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    });
  }
  return out;
}

const canon = tokensIn(read('quest.css'));
const canonNames = Object.keys(canon);
if (canonNames.length < 10) {
  bad('quest.css declares only ' + canonNames.length + ' tokens — it is meant to be the ' +
      'whole palette, so something has gone missing from it');
} else {
  ok('quest.css is the canonical palette (' + canonNames.length + ' tokens)');
}

/* Files that carry their own copy of the palette. Adding a page here is how a
   new copy gets guarded; the better move is to link quest.css instead. */
['index.html', 'legal.css'].forEach(function (f) {
  const mine = tokensIn(read(f));
  const shared = Object.keys(mine).filter(n => canon[n] !== undefined);
  if (!shared.length) {
    bad(f + ' declares no tokens that quest.css also declares — either it stopped ' +
        'using the Quest palette, or the names were renamed on one side only');
    return;
  }
  let drifted = 0;
  shared.forEach(function (n) {
    if (mine[n] === canon[n]) return;
    const why = (ALLOWED[f] || {})[n];
    if (why) { ok(f + ' ' + n + ' deliberately differs: ' + why); return; }
    bad(f + ' ' + n + ' is ' + JSON.stringify(mine[n]) + ' but quest.css says ' +
        JSON.stringify(canon[n]) + ' — the palette has drifted. Fix the copy, or ' +
        'declare the difference in tools/check-design-tokens.js with a reason');
    drifted++;
  });
  if (!drifted) ok(f + ': all ' + shared.length + ' shared tokens match quest.css');
});

/* An allowance left behind after the difference was resolved is a licence for
   the NEXT drift on that token to pass unnoticed. */
Object.keys(ALLOWED).forEach(function (f) {
  const mine = tokensIn(read(f));
  Object.keys(ALLOWED[f]).forEach(function (n) {
    if (mine[n] === undefined) {
      bad('tools/check-design-tokens.js allows ' + f + ' ' + n + ' to differ, but that file ' +
          'no longer declares it — drop the allowance');
    } else if (mine[n] === canon[n]) {
      bad('tools/check-design-tokens.js allows ' + f + ' ' + n + ' to differ, but it now matches ' +
          'quest.css — drop the allowance so the next real drift is caught');
    }
  });
});

/* A page that links quest.css must not also re-declare the palette: that is
   how the third copy gets born. */
['sign.html'].forEach(function (f) {
  const src = read(f);
  if (src.indexOf('quest.css') < 0) {
    bad(f + ' does not link quest.css — it is a new page and has no legacy to protect, ' +
        'so it should be using the shared palette rather than its own');
    return;
  }
  const mine = tokensIn(src);
  const dupes = Object.keys(mine).filter(n => canon[n] !== undefined);
  if (dupes.length) {
    bad(f + ' links quest.css AND redeclares ' + dupes.join(', ') +
        ' — that is a second copy of the palette by another name');
  } else {
    ok(f + ' links the shared palette and declares no copy of it');
  }
});

process.exit(fail);
