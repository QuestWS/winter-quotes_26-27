#!/usr/bin/env node
/* The storage view's season tag — which card each quote is priced on —
   executed end to end rather than grepped.
   ---------------------------------------------------------------------------
   Through a rollover, staff need to see which quotes still carry last year's
   rates. The answer is the payload's own season stamp (seasonStamp() in the
   engine), which moves when the money moves: a re-price, an import, or a
   customer save. Two halves, each with a quiet way of being wrong:

   THE SERVER. storageViewBuild_ must carry each row's season label and the
   current season, taken from the engine's SEASON — not a literal, or the tag
   would call every quote "old" the moment next year's card is loaded.

   THE CONSOLE. Current season reads as current, anything else as last
   season's, a quote with no stamp as unknown (never as current), and a lead
   (Quote Started) gets no tag and is not counted, because an unfinished quote
   has no price on either card.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

/* ---------------- the server ---------------- */
function sheet(name, data) {
  const cell = (r, c) => { const v = (data[r - 1] || [])[c - 1]; return v === undefined ? '' : v; };
  return {
    getName: () => name,
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValue: () => cell(r, c),
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nr || 1); i++) {
          const row = [];
          for (let j = 0; j < (nc || 1); j++) row.push(cell(r + i, c + j));
          out.push(row);
        }
        return out;
      }
    })
  };
}
function row(qn, last, season) {
  const r = new Array(23).fill('');
  r[0] = last; r[2] = qn; r[6] = 'Boat';
  const d = { quoteNo: qn, lastName: last };
  if (season) d.season = { label: season };
  r[20] = JSON.stringify(d);
  return r;
}
const HEAD = ['Last Name', 'First Name', 'Quote #'];

const cache = {};
const ctx = {
  console, JSON, Date, Math, Number, String, Object, Array, RegExp, Error, isFinite, parseInt, parseFloat,
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } }) },
  HtmlService: {},
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; },
    getAll: (ks) => { const o = {}; ks.forEach((k) => { if (k in cache) o[k] = cache[k]; }); return o; },
    putAll: (o) => Object.assign(cache, o), remove: (k) => { delete cache[k]; },
    removeAll: (ks) => ks.forEach((k) => delete cache[k]) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: {}, GmailApp: {}, MailApp: {}, DriveApp: {}, ScriptApp: {}, UrlFetchApp: {}, Session: {}
};
vm.createContext(ctx);
vm.runInContext(GS, ctx, { filename: 'quote-logger-apps-script.gs' });
const CUR = vm.runInContext('SEASON.seasonLabel', ctx);
const book = [
  sheet('Inside', [HEAD,
    row('QW-26-1001', 'Adams', CUR),
    row('QW-26-1002', 'Baker', '2025–2026'),
    row('QW-26-1003', 'Clark', '')]),
  sheet('Quote Started', [HEAD, row('QW-26-1004', 'Dunn', '2025–2026')])
];
ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => book, getId: () => 'B',
  getSheetByName: (n) => book.filter((s) => s.getName() === n)[0] || null }) };

console.log('=== the server carries the season ===');
const out = ctx.storageViewBuild_({ fresh: true });
if (out.currentSeason !== CUR) fail('currentSeason is ' + JSON.stringify(out.currentSeason) + ', not the engine\'s ' + CUR);
else ok('currentSeason is the engine\'s SEASON.seasonLabel (' + CUR + ')');
const byQn = {};
out.groups.forEach((g) => g.rows.forEach((r) => { byQn[r.qn] = r; }));
if (byQn['QW-26-1001'].season !== CUR) fail('a current-season quote lost its label');
else if (byQn['QW-26-1002'].season !== '2025–2026') fail('a last-season quote lost its label');
else if (byQn['QW-26-1003'].season !== '') fail('a quote with no stamp got a label from somewhere');
else ok('each row carries its own payload\'s season label, and "" when it has none');
if (!/SEASON\.seasonLabel/.test(GS.slice(GS.indexOf('function storageViewBuild_'), GS.indexOf('function storageViewBuild_') + 20000)))
  fail('storageViewBuild_ no longer reads SEASON.seasonLabel');

/* ---------------- the console ---------------- */
console.log('=== the console tags it ===');
const SRC = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((b) => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');
const noop = () => {};
const el = { textContent: '', className: '', innerHTML: '', value: '',
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop };
const C = { console, localStorage: { getItem: () => null, setItem: noop },
  location: { reload: noop, href: '' },
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
              addEventListener: noop, createElement: () => el, body: el },
  setTimeout: (fn) => { fn(); return 0; }, clearTimeout: noop,
  MutationObserver: function () { return { observe: noop }; },
  fetch: async () => { throw new Error('no requests'); } };
C.window = C; C.globalThis = C;
vm.createContext(C);
vm.runInContext(SRC, C, { filename: 'admin/index.html' });

C.window._sg = out.groups;
C.window._curSeason = out.currentSeason;
const tag = (qn) => C.seasonTag_(byQn[qn]);
const curShort = CUR.replace(/^(\d{4})(\s*[–-]\s*)\d{2}(\d{2})$/, '$1$2$3');

if (!/tagseason cur/.test(tag('QW-26-1001').html) || tag('QW-26-1001').old) fail('a current-season quote is not tagged current: ' + tag('QW-26-1001').html);
else if (tag('QW-26-1001').html.indexOf(curShort) < 0) fail('the current tag does not name the season: ' + tag('QW-26-1001').html);
else ok('current season → green "' + curShort + '"');
if (!tag('QW-26-1002').old || tag('QW-26-1002').html.indexOf('2025–26 rates') < 0) fail('a last-season quote is not tagged as old rates: ' + tag('QW-26-1002').html);
else ok('last season → grey "2025–26 rates"');
if (!tag('QW-26-1003').old || /tagseason cur/.test(tag('QW-26-1003').html)) fail('a quote with no season stamp was shown as current');
else ok('no stamp → "season ?", never current');

C.setStorageFilter('all');
const n = C.storageCounts_().oldRates;
if (n !== 2) fail('oldRates counted ' + n + ' — expected 2 (the lead must not count)');
else ok('the header counts 2 on old rates; the lead is left out');
C.renderStorage();
const page = el.innerHTML;
/* The whole name cell of the lead row — every tag on it — up to the unit cell. */
const at = page.indexOf('Dunn');
const dunn = page.slice(at, page.indexOf('<span class="un">', at));
const baker = page.slice(page.indexOf('Baker'), page.indexOf('<span class="un">', page.indexOf('Baker')));
if (!/tagseason/.test(baker)) fail('the slice used to inspect a row does not reach its tags');
else if (/tagseason/.test(dunn)) fail('a lead row carries a season tag');
else ok('a lead (Quote Started) row carries no season tag');
if (page.indexOf('still priced on last season') < 0) fail('the header does not say how many are on last season\'s rates');
else ok('the header says how many are still on last season\'s rates');

/* Before the response names a season (an old cached view), no tags at all —
   rather than every row reading as "old". */
C.window._curSeason = '';
if (C.seasonTag_(byQn['QW-26-1002']).html) fail('tags drawn with no current season to compare against');
else ok('no current season known → no tags, rather than everything "old"');

if (bad) { console.error('\n' + bad + ' check(s) failed.'); process.exit(1); }
console.log('\nAll season-tag checks pass.');
