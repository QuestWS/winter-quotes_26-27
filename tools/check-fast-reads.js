#!/usr/bin/env node
/* The console's speed work, run rather than read.
   ---------------------------------------------------------------------------
   1. EVERY TAB IN TWO TRIPS. quoteTabGrids_ reads every tab's header, then
      every quote tab, with two Sheets API batchGets instead of three or four
      trips per tab — and never reads a non-quote tab past its header. The storage view, the
      search and a cold quote lookup must give EXACTLY the answer the per-tab
      reads give — on a sheet with blank rows, short rows, a non-quote tab, an
      Import tab and an apostrophe in a tab name — and must fall back to those
      reads whenever the service is missing or refuses.
   2. ONE TRIP PER CLICK. A console write carrying `withQuote` comes back with
      the refreshed quote on the same answer — only when the write succeeded,
      never when the read fails, and never inside the replayable rid answer.
   3. EVERY ANSWER SAYS WHAT IT COST: `serverMs` on every console reply.

   The real .gs runs in a sandbox against a fake spreadsheet that counts its
   round trips. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  OK   ' + m);

/* ---- the fake spreadsheet ---- */
function makeBook(tabs) {
  const stats = { trips: 0, batch: 0, cells: {} };
  const sheets = tabs.map(function (t) {
    const data = t.rows;
    const lastRow = () => {
      for (let r = data.length; r > 0; r--) if ((data[r - 1] || []).some((v) => v !== '' && v != null)) return r;
      return 0;
    };
    const cell = (r, c) => { const row = data[r - 1] || []; const v = row[c - 1]; return v === undefined ? '' : v; };
    return {
      getName: () => t.name,
      getLastRow: () => { stats.trips++; return lastRow(); },
      getRange: (r, c, nr, nc) => ({
        getValue: () => { stats.trips++; return cell(r, c); },
        getValues: () => {
          stats.trips++;
          const out = [];
          for (let i = 0; i < (nr || 1); i++) {
            const row = [];
            for (let j = 0; j < (nc || 1); j++) row.push(cell(r + i, c + j));
            out.push(row);
          }
          return out;
        },
        setValue: () => {}
      }),
      _data: data, _last: lastRow
    };
  });
  const book = { getSheets: () => sheets, getId: () => 'BOOK', getSheetByName: (n) => sheets.filter((s) => s.getName() === n)[0] || null };
  /* The Sheets API's own habits: trailing blank cells and trailing blank rows
     are left off, interior blank rows come back as []. */
  const Sheets = { Spreadsheets: { Values: { batchGet: function (id, o) {
    stats.batch++;
    return { valueRanges: o.ranges.map(function (a1) {
      const m = /^'((?:[^']|'')*)'!([A-Z])1(?::([A-Z]))?$/.exec(a1);
      if (!m) throw new Error('bad range ' + a1);
      const name = m[1].replace(/''/g, "'");
      const sh = sheets.filter((s) => s.getName() === name)[0];
      const c0 = m[2].charCodeAt(0) - 64, c1 = (m[3] || m[2]).charCodeAt(0) - 64;
      const lastR = m[3] ? sh._last() : Math.min(1, sh._last());
      stats.cells[name] = (stats.cells[name] || 0) + lastR * (c1 - c0 + 1);
      const rows = [];
      for (let r = 1; r <= lastR; r++) {
        const row = [];
        for (let c = c0; c <= c1; c++) { const v = (sh._data[r - 1] || [])[c - 1]; row.push(v === undefined ? '' : v); }
        while (row.length && row[row.length - 1] === '') row.pop();
        rows.push(row);
      }
      while (rows.length && !rows[rows.length - 1].length) rows.pop();
      return rows.length ? { range: a1, values: rows } : { range: a1 };
    }) };
  } } } };
  return { book, stats, Sheets };
}

/* A sheet row in the real layout (COL). Only the columns the reads use. */
function row(o) {
  const r = new Array(23).fill('');
  r[0] = o.last || ''; r[1] = o.first || ''; r[2] = o.qn || ''; r[3] = o.bal === undefined ? '' : o.bal;
  r[5] = o.status || ''; r[6] = o.unit || ''; r[7] = o.phone || ''; r[9] = o.ymm || ''; r[10] = o.dims || '';
  r[20] = o.payload === undefined ? JSON.stringify({ quoteNo: o.qn, keyLoc: 'hook 4', payments: o.paid ? [{ amt: o.paid }] : [] }) : o.payload;
  return r;
}
const HEAD = ['Last Name', 'First Name', 'Quote #'];
function tabs() {
  return [
    { name: 'Dry Storage', rows: [HEAD,
      row({ last: 'Alder', first: 'A', qn: 'QW-26-1001', bal: 250.5, status: 'Deposit', unit: 'Boat', phone: 8155550101, ymm: '2019 Sea Ray', dims: "22'", paid: 500 }),
      [],                                           // a blank row in the middle
      row({ last: 'Birch', first: 'B', qn: 'QW-26-1002', bal: -40, unit: 'PWC' }),
      ['Cedar', '', 'QW-26-1003']                   // a short row, no payload
    ] },
    { name: 'Notes', rows: [['just', 'a', 'sheet'], ['nothing', 'to', 'see']] },
    /* Big, and not a quote tab: must never be read past its header. */
    { name: 'Activity Log', rows: [['When', 'Who', 'What']].concat(
      Array.from({ length: 3000 }, (_, i) => ['2026-09-0' + (1 + i % 9), 'Staff', 'did thing ' + i])) },
    { name: "O'Brien's Barn", rows: [HEAD, row({ last: 'Dunn', first: 'D', qn: 'QW-26-1004', bal: 0 })] },
    { name: 'Import', rows: [HEAD, row({ last: 'Elm', first: 'E', qn: 'QW-26-1005', bal: 10 })] },
    { name: 'Empty Tab', rows: [HEAD] },
    { name: 'No Storage', rows: [HEAD, row({ last: 'alder', first: 'Z', qn: 'QW-26-1006', bal: 12 })] }
  ];
}

function backend(withSheets, opts) {
  const f = makeBook(tabs());
  const noop = () => {};
  const cache = {};
  const ctx = {
    console,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } }) },
    HtmlService: {}, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: noop }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => f.book, flush: noop },
    CacheService: { getScriptCache: () => ({
      get: (k) => (cache[k] === undefined ? null : cache[k]), put: (k, v) => { cache[k] = v; },
      getAll: (ks) => { const o = {}; ks.forEach((k) => { if (cache[k] !== undefined) o[k] = cache[k]; }); return o; },
      putAll: (o) => Object.assign(cache, o), remove: (k) => { delete cache[k]; }, removeAll: (ks) => ks.forEach((k) => delete cache[k]) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: noop }) },
    Utilities: {}, GmailApp: {}, DriveApp: {}, ScriptApp: {}, UrlFetchApp: {}, Session: {}
  };
  if (withSheets) ctx.Sheets = (opts && opts.brokenSheets)
    ? { Spreadsheets: { Values: { batchGet: () => { f.stats.batch++; throw new Error('API not enabled'); } } } }
    : f.Sheets;
  vm.createContext(ctx);
  vm.runInContext(GS, ctx, { filename: 'quote-logger-apps-script.gs' });
  ctx.requireAuth_ = () => ({ name: 'Guard', admin: true, perms: {} });
  return { ctx, stats: f.stats, cache };
}

const J = (v) => JSON.stringify(v);

/* ---- 1. every tab in two trips, same answer ---- */
{
  const slow = backend(false), fast = backend(true);
  const a = slow.ctx.adminStorageView('t'), b = fast.ctx.adminStorageView('t');
  if (J(a) !== J(b)) fail('the storage view differs between the batch read and the per-tab reads:\n       ' + J(a) + '\n       ' + J(b));
  else if (!a.groups || a.groups.length < 3) fail('the storage view fixture produced too little to compare: ' + J(a));
  else ok('the storage view is identical from one batch read and from the per-tab reads (' + a.groups.length + ' tabs)');
  if (J(a).indexOf('QW-26-1005') > -1) fail('the Import tab reached the storage view');
  if (fast.stats.batch !== 2 || fast.stats.trips > 0) fail('the storage view made ' + fast.stats.batch + ' batch read(s) and ' + fast.stats.trips + ' per-tab trip(s); want 2 and 0');
  else ok('the storage view costs two reads — headers, then quote tabs (was ' + slow.stats.trips + ' round trips on this 7-tab sheet)');
  if ((fast.stats.cells['Activity Log'] || 0) > 1 || (fast.stats.cells['Notes'] || 0) > 1)
    fail('a non-quote tab was read past its header: ' + JSON.stringify(fast.stats.cells));
  else ok('the Activity Log and other non-quote tabs are never read past their header cell');
}
{
  const slow = backend(false), fast = backend(true);
  const a = slow.ctx.adminSearch('t', 'ald'), b = fast.ctx.adminSearch('t', 'ald');
  if (J(a) !== J(b)) fail('search differs between the batch read and the per-tab reads:\n       ' + J(a) + '\n       ' + J(b));
  else if (!a.hits || a.hits.length !== 2) fail('search fixture should find two Alders: ' + J(a));
  else ok('search is identical from one batch read and from the per-tab reads');
  if (fast.stats.batch !== 2 || fast.stats.trips > 0) fail('search made ' + fast.stats.batch + ' batch read(s) and ' + fast.stats.trips + ' per-tab trip(s) with the service on');
  else ok('search costs two reads (was ' + slow.stats.trips + ')');
}
{
  const want = ['QW-26-1003', 'QW-26-1004', 'QW-26-1005', 'qw-26-1002', 'QW-26-9999'];
  const slow = backend(false), fast = backend(true);
  const pick = (c) => (c ? { tab: c.sh.getName(), row: c.rowNum, qn: c.quoteNo } : null);
  const a = want.map((q) => { try { return pick(slow.ctx.findQuoteCtx_(q)); } catch (e) { return 'threw ' + e.message; } });
  const b = want.map((q) => { try { return pick(fast.ctx.findQuoteCtx_(q)); } catch (e) { return 'threw ' + e.message; } });
  if (J(a) !== J(b)) fail('a cold quote lookup lands differently:\n       ' + J(a) + '\n       ' + J(b));
  else if (!a[1] || a[1].tab !== "O'Brien's Barn" || a[1].row !== 2) fail('the lookup fixture did not find the quote on the apostrophe tab: ' + J(a));
  else ok('a cold quote lookup finds the same tab and row either way — lower case, an apostrophe in the tab name, a missing quote');
}
{
  const broken = backend(true, { brokenSheets: true }), slow = backend(false);
  const a = slow.ctx.adminStorageView('t');
  const b = broken.ctx.adminStorageView('t');
  const c = broken.ctx.adminSearch('t', 'ald');
  if (J(a) !== J(b) || !c.ok) fail('a refused batch read does not fall back to the per-tab reads');
  else if (broken.stats.batch !== 1) fail('a refused batch read was asked again ' + broken.stats.batch + ' times in one execution');
  else ok('a refused batch read falls back to the old reads, and is not asked again in the same execution');
}

/* ---- 2. one trip per click ---- */
{
  const k = backend(true);
  const seen = [];
  k.ctx.adminLookup = (tok, qn) => { seen.push(qn); return { ok: 1, quoteNo: qn, total: '$1.00' }; };
  let wrote = 0;
  k.ctx.adminSetStaffNote = () => { wrote++; return { ok: 1, msg: 'Saved.' }; };
  const r = JSON.parse(k.ctx.consoleServe_({ fn: 'staffNote', token: 't', rid: 'R1', withQuote: 'QW-26-1001', args: ['QW-26-1001', 'x'] }, 'POST')._text);
  if (!r.quote || r.quote.quoteNo !== 'QW-26-1001' || !r.ok) fail('a write with withQuote did not bring the quote back: ' + J(r));
  else ok('a write carrying withQuote answers with the refreshed quote — one trip, not two');
  const cached = JSON.parse(k.cache['RID_R1'] || '{}');
  if (cached.quote) fail('the refreshed quote was stored in the replayable rid answer — it would be served stale');
  else ok('the replayable answer does not carry the quote, so a replay can never show a stale one');
  const again = JSON.parse(k.ctx.consoleServe_({ fn: 'staffNote', token: 't', rid: 'R1', withQuote: 'QW-26-1001', args: [] }, 'POST')._text);
  if (wrote !== 1 || !again._replay || again.quote) fail('a replayed write ran twice or carried a quote');
  else ok('a replay runs nothing and carries no quote (the console then asks for it)');

  k.ctx.adminSetStaffNote = () => ({ ok: 0, error: 'nope' });
  seen.length = 0;
  const no = JSON.parse(k.ctx.consoleServe_({ fn: 'staffNote', token: 't', rid: 'R2', withQuote: 'QW-26-1001', args: [] }, 'POST')._text);
  if (no.quote || seen.length) fail('a failed write still read the quote');
  else ok('a failed write does not read the quote');

  k.ctx.adminSetStaffNote = () => ({ ok: 1, msg: 'Saved.' });
  k.ctx.adminLookup = () => { throw new Error('sheet hiccup'); };
  const hic = JSON.parse(k.ctx.consoleServe_({ fn: 'staffNote', token: 't', rid: 'R3', withQuote: 'QW-26-1001', args: [] }, 'POST')._text);
  if (!hic.ok || hic.error || hic.quote) fail('a failed quote read spoiled the write\'s own answer: ' + J(hic));
  else ok('a quote read that fails leaves the write\'s answer untouched');

  const read = JSON.parse(k.ctx.consoleServe_({ fn: 'ping', token: '', args: [] }, 'GET')._text);
  if (!read.ok || typeof read.serverMs !== 'number') fail('ping does not answer, or carries no serverMs: ' + J(read));
  else ok('ping answers on GET with no session, and every reply carries serverMs');
}

/* ---- 2b. the console uses it ---- */
{
  const leftovers = (ADMIN.match(/api\('lookup',\[QN\]\);if\(q\.ok\)renderQuote\(q\)/g) || []).length;
  const uses = (ADMIN.match(/\{withQuote:QN\}/g) || []).length;
  if (leftovers) fail(leftovers + ' console write(s) still save and then look the quote up in a second trip');
  else if (uses < 8) fail('only ' + uses + ' console writes ask for the quote back (expected at least 8)');
  else ok(uses + ' console writes take the refreshed quote from their own answer');
  if (!/async function afterWrite_\(r\)[\s\S]{0,400}api\('lookup',\[QN\]\)/.test(ADMIN)) fail('afterWrite_ no longer falls back to a lookup when the answer has no quote');
  else ok('with no quote on the answer (a replay, an older backend) the console still looks it up');
}

/* ---- 3. the manifest turns the service on ---- */
{
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps-script/appsscript.json'), 'utf8'));
  const svc = ((man.dependencies || {}).enabledAdvancedServices || []).filter((s) => s.userSymbol === 'Sheets')[0];
  if (!svc) fail('apps-script/appsscript.json does not enable the Sheets advanced service — every batch read would silently fall back');
  else ok('the manifest enables the Sheets advanced service (' + svc.version + ')');
}

if (bad) { console.error('fast reads: ' + bad + ' failure(s)'); process.exit(1); }
console.log('fast reads: two trips for every tab, one trip per click, same answers');
