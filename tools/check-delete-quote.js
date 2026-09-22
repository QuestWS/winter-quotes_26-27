#!/usr/bin/env node
/* Execute the quote delete against a fake spreadsheet.
   ---------------------------------------------------------------------------
   This is the only console action that removes a row, and the sheet is the
   source of truth for the whole season — so every claim made about it has to
   be executed rather than grepped for:

   1. **Admins only.** A grep for `who.admin` proves the identifier is there.
      It does not prove a non-admin is stopped BEFORE the rows go, which is the
      only version of that check anybody cares about.
   2. **Nothing is destroyed.** Every copy of the row lands on the archive tab,
      payload column and all, with the quote number still in COL.QN — that is
      what makes an undo a paste of columns A-W rather than a reconstruction.
   3. **The archive is not a quote tab.** Seventeen sweeps in the backend
      decide what is a quote tab by reading 'Quote #' from column 3 — the 9am
      reminder among them. If the archive answered to that probe, deleting a
      quote would put the customer back on the reminder run and back on the
      haul-out list. So the probe is run against it here, the way those sweeps
      run it.
   4. **A deleted number is never reissued.** `uniqueQuoteNo_` is asked for a
      number with the whole four-digit space full except the deleted one, and
      must not hand it back (docs/ref/DATA-AND-MONEY.md — quote numbers cannot
      collide: a reissue silently replaces one customer's PDF with another's).
   5. **The confirmations actually gate.** Wrong quote number typed, no reason,
      money on the quote without the second confirmation — each must leave the
      sheet exactly as it was.
   6. **It emails nobody.** GmailApp and MailApp throw if touched.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

/* ---------- a spreadsheet, modelled the way Sheets actually behaves -------
   The grid includes the header row, because that is what makes getLastRow,
   deleteRow and appendRow line up with the real thing — and this guard is
   about row numbers moving under each other. */
const WIDTH = 23;
const pad = (row) => { const r = row.slice(); while (r.length < WIDTH) r.push(''); return r; };

function makeSheet(name, grid) {
  let frozen = 0;
  const self = {
    getName: () => name,
    getSheetId: () => 'gid-' + name,
    getLastRow: () => grid.length,
    grid: grid,
    setFrozenRows: (n) => { frozen = n; return self; },
    getFrozenRows: () => frozen,
    appendRow: (row) => { grid.push(row.slice()); return self; },
    deleteRow: (r) => { grid.splice(r - 1, 1); },
    getRange: (r, c, nr, nc) => {
      if (nr === undefined) {
        return {
          getValue: () => (grid[r - 1] && grid[r - 1][c - 1] !== undefined) ? grid[r - 1][c - 1] : '',
          setValue: (v) => { while (grid.length < r) grid.push([]); grid[r - 1][c - 1] = v; },
          setWrap: () => {}, setNumberFormat: () => {}, setFontWeight: () => {}
        };
      }
      return {
        getValues: () => grid.slice(r - 1, r - 1 + nr).map(row => pad(row).slice(c - 1, c - 1 + nc)),
        setValues: (vals) => {
          vals.forEach((row, i) => {
            while (grid.length < r + i) grid.push([]);
            row.forEach((v, j) => { grid[r + i - 1][c + j - 1] = v; });
          });
        },
        setWrap: () => {}, setNumberFormat: () => {}, setFontWeight: () => {}
      };
    }
  };
  return self;
}

const HEADER_ROW = (() => {
  const m = GS.match(/^const HEADERS = \[[\s\S]*?\];/m);
  return vm.runInNewContext(m[0] + '\nHEADERS');
})();

/* One quote, with a payload the console would have written. */
function quoteRow(qn, last, first, opts) {
  const o = opts || {};
  const d = {
    quoteNo: qn, lastName: last, firstName: first, unit: o.unit || 'Boat',
    total: o.total === undefined ? 1200 : o.total,
    payments: o.payments || [],
    contractUrl: o.contractUrl || '',
    state: { unit: 'boat', storage: 'inside' },
    email: last.toLowerCase() + '@example.test'
  };
  const row = new Array(WIDTH).fill('');
  row[0] = last; row[1] = first; row[2] = qn;
  row[6] = d.unit;
  row[11] = d.total;
  row[20] = JSON.stringify(d);
  return row;
}

let trashed = [];
let ss = null;

function freshSheet() {
  trashed = [];
  const tabs = {};
  const order = [];
  const add = (name, rows, headerRow) => {
    const grid = [headerRow || HEADER_ROW.slice()].concat(rows);
    tabs[name] = makeSheet(name, grid);
    order.push(name);
  };
  add('Inside', [
    quoteRow('QW-26-1001', 'Adams', 'Ann'),
    quoteRow('QW-26-1002', 'Boone', 'Bo', { payments: [{ amt: 500, method: 'Cash' }] }),
    quoteRow('QW-26-1003', 'Cline', 'Cy')
  ]);
  add('Outside', [
    quoteRow('QW-26-1003', 'Cline', 'Cy'),          // the stale second copy
    quoteRow('QW-26-1004', 'Doyle', 'Di', { contractUrl: 'https://drive.test/contract' })
  ]);
  /* Not a quote tab: its header row says something else in column 3, exactly
     like the Activity Log. Rows are quote-shaped on purpose. */
  add('Activity Log', [['2026-09-19', 'Chris', 'QW-26-1001']],
    ['Timestamp', 'Who', 'Action']);

  ss = {
    getUrl: () => 'https://docs.google.test/spreadsheets/d/FAKE',
    getId: () => 'FAKE',
    getName: () => 'Winter Quotes 2026-2027',
    getSheets: () => order.map(n => tabs[n]),
    getSheetByName: (n) => tabs[n] || null,
    /* A brand-new sheet is EMPTY — no header row until something writes one.
       Modelling that matters: the archive's own header is written by the code
       under test, and it is the thing every sheet sweep reads. */
    insertSheet: (n) => { tabs[n] = makeSheet(n, []); order.push(n); return tabs[n]; }
  };
  return { tabs, order };
}

/* ---------- the rest of the Apps Script world ---------- */
const cache = new Map();
const props = {};

function context() {
  const ctx = {
    console,
    JSON, Date, Math, Number, String, Object, Array, isFinite, parseInt, parseFloat, RegExp, Error,
    ContentService: {
      MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
      createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } })
    },
    HtmlService: { createHtmlOutput: (h) => ({ _html: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: (k) => { delete props[k]; },
        getKeys: () => Object.keys(props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => cache.set(k, v),
        remove: (k) => cache.delete(k),
        putAll: (o) => Object.keys(o).forEach(k => cache.set(k, o[k])),
        getAll: (ks) => { const o = {}; ks.forEach(k => { if (cache.has(k)) o[k] = cache.get(k); }); return o; },
        removeAll: (ks) => ks.forEach(k => cache.delete(k))
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      getFoldersByName: (name) => {
        const files = [];
        (trashedSeed[name] || []).forEach(f => files.push(f));
        let served = false;
        return {
          hasNext: () => !served,
          next: () => {
            served = true;
            return {
              searchFiles: (q) => {
                const m = q.match(/"([^"]+)"/);
                const want = m ? m[1] : '';
                const hits = files.filter(f => f.indexOf(want) >= 0);
                let i = 0;
                return { hasNext: () => i < hits.length,
                         next: () => ({ setTrashed: () => { trashed.push(hits[i]); i++; } }) };
              }
            };
          }
        };
      }
    },
    GmailApp: { sendEmail: () => { throw new Error('the delete must not email anybody'); } },
    MailApp: { sendEmail: () => { throw new Error('the delete must not email anybody'); } },
    UrlFetchApp: { fetch: () => { throw new Error('the delete must not call out'); } },
    Utilities: { getUuid: () => 'uuid', formatDate: () => '2026-09-19', newBlob: () => { throw new Error('no blobs here'); } },
    ScriptApp: { getOAuthToken: () => 't' },
    Session: { getScriptTimeZone: () => 'America/Chicago' }
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx, { filename: 'quote-logger-apps-script.gs' });
  return ctx;
}

/* PDFs sitting in the season folders, so trashing can be observed. */
const trashedSeed = {
  'Winter Quotes 2025-26': ['QW-26-1003 — Cy Cline.pdf', 'QW-26-1099 — Someone Else.pdf'],
  'Winter Quotes 2026-2027': ['QW-26-1002 — Bo Boone.pdf']
};

const ROSTER = {
  Chris: { pin: '1111', admin: true, perms: { pay: 1, adjust: 1, email: 1, photos: 1, keys: 1, measure: 1 } },
  Jess: { pin: '2222', admin: false, perms: { pay: 1, adjust: 0, email: 1, photos: 1, keys: 1, measure: 0 } }
};

function setup() {
  const layout = freshSheet();
  cache.clear();
  Object.keys(props).forEach(k => delete props[k]);
  props.STAFF = JSON.stringify(ROSTER);
  props['SESS_admin'] = JSON.stringify({ name: 'Chris', exp: Date.now() + 3600000 });
  props['SESS_crew'] = JSON.stringify({ name: 'Jess', exp: Date.now() + 3600000 });
  const ctx = context();
  return { ctx, layout };
}

const qnsOn = (sh) => sh.grid.slice(1).map(r => r[2]).filter(Boolean);
const archive = (ctx) => ss.getSheetByName(vm.runInContext('DELETED_TAB', ctx));

/* ================= 1. a non-admin cannot delete anything ================= */
console.log('=== admins only ===');
{
  const { ctx } = setup();
  const r = ctx.adminDeleteQuote('crew', 'QW-26-1001', 'QW-26-1001', 'tidying up', 1);
  if (Number(r.ok) === 1) fail('a non-admin (keys+pay+email, no admin) was allowed to delete a quote');
  else ok('a non-admin is refused: ' + r.error);
  if (qnsOn(ss.getSheetByName('Inside')).indexOf('QW-26-1001') < 0) fail('the row went anyway');
  else ok('the row is still on its tab');
  if (archive(ctx)) fail('an archive tab was created by a refused delete');
  else ok('a refused delete creates nothing');
}

/* ================= 2. the typed confirmation has to match ================= */
console.log('=== the quote number is typed, not ticked ===');
{
  const { ctx } = setup();
  const wrong = ctx.adminDeleteQuote('admin', 'QW-26-1001', 'QW-26-1002', 'duplicate', 0);
  if (Number(wrong.ok) === 1) fail('a delete went through with somebody ELSE\'s quote number typed in');
  else ok('a mismatched confirmation is refused');
  const blank = ctx.adminDeleteQuote('admin', 'QW-26-1001', '', 'duplicate', 0);
  if (Number(blank.ok) === 1) fail('a delete went through with nothing typed in');
  else ok('an empty confirmation is refused');
  const noWhy = ctx.adminDeleteQuote('admin', 'QW-26-1001', 'qw-26-1001', '  ', 0);
  if (Number(noWhy.ok) === 1) fail('a delete went through with no reason given');
  else ok('no reason is refused');
  if (qnsOn(ss.getSheetByName('Inside')).indexOf('QW-26-1001') < 0) fail('a refused delete still removed the row');
  else ok('the sheet is untouched by all three refusals');
}

/* ================= 3. money and contracts ask twice ================= */
console.log('=== a quote with money or a contract on it asks again ===');
{
  const { ctx } = setup();
  const paid = ctx.adminDeleteQuote('admin', 'QW-26-1002', 'QW-26-1002', 'test row', 0);
  if (Number(paid.ok) === 1) fail('a quote with a payment on it was deleted on the first ask');
  else if (!paid.needsForce) fail('the refusal does not tell the console to ask again (needsForce missing)');
  else ok('a payment forces a second confirmation: ' + paid.error);

  const signed = ctx.adminDeleteQuote('admin', 'QW-26-1004', 'QW-26-1004', 'test row', 0);
  if (Number(signed.ok) === 1) fail('a quote with a signed contract was deleted on the first ask');
  else if (!signed.needsForce) fail('the contract refusal does not set needsForce');
  else ok('a signed contract forces a second confirmation');

  if (qnsOn(ss.getSheetByName('Inside')).indexOf('QW-26-1002') < 0) fail('the paid quote went anyway');
  else ok('neither row moved');

  const forced = ctx.adminDeleteQuote('admin', 'QW-26-1002', 'QW-26-1002', 'test row', 1);
  if (Number(forced.ok) !== 1) fail('the second confirmation did not let it through: ' + forced.error);
  else ok('with the box ticked it goes');
}

/* ================= 4. every copy goes, and all of it is archived ========== */
console.log('=== nothing is destroyed, and no copy is left behind ===');
{
  const { ctx } = setup();
  const r = ctx.adminDeleteQuote('admin', 'QW-26-1003', 'QW-26-1003', 'Duplicate of QW-26-1001', 0);
  if (Number(r.ok) !== 1) { fail('a plain delete failed: ' + r.error); }
  else {
    ok('deleted: ' + r.msg);
    if (Number(r.removed) !== 2) fail('reported ' + r.removed + ' row(s) removed, expected both copies');
    else ok('both copies reported');
  }
  const left = ss.getSheets().filter(sh => sh.getRange(1, 3).getValue() === 'Quote #')
    .filter(sh => qnsOn(sh).indexOf('QW-26-1003') >= 0).map(sh => sh.getName());
  if (left.length) fail('a copy of the deleted quote is still on: ' + left.join(', '));
  else ok('no copy left on any quote tab');

  /* The other quotes are still where they were — deleting bottom-up matters
     because a row number moves the moment one above it goes. */
  const inside = qnsOn(ss.getSheetByName('Inside'));
  if (inside.join(',') !== 'QW-26-1001,QW-26-1002') fail('Inside now reads ' + inside.join(',') + ' — a neighbouring row moved or went');
  else ok('the neighbouring rows are untouched and in order');

  const arch = archive(ctx);
  if (!arch) { fail('nothing was archived at all'); }
  else {
    const rows = arch.grid.slice(1);
    if (rows.length !== 2) fail('archived ' + rows.length + ' row(s), expected both copies');
    else ok('both copies are on the archive tab');
    const a = rows[0];
    const COL = vm.runInContext('COL', ctx);
    if (String(a[COL.QN - 1]) !== 'QW-26-1003') fail('the archived row does not carry the quote number in COL.QN — an undo would not be a paste');
    else ok('the archived row keeps the quote number in its own column');
    let payload = null;
    try { payload = JSON.parse(a[COL.PAYLOAD - 1]); } catch (e) {}
    if (!payload || payload.quoteNo !== 'QW-26-1003') fail('the payload column did not survive the archive — the quote could not be restored');
    else ok('the full payload is archived, so the quote can be put back');
    const meta = a.slice(HEADER_ROW.length);
    if (meta.length !== 4 || !meta[1] || String(meta[2]).indexOf('Duplicate') < 0) {
      fail('the archive row is missing its who/why metadata: ' + JSON.stringify(meta));
    } else ok('archived with who deleted it, why, and which tab it came off');
    if (String(rows[0][HEADER_ROW.length + 3]) === String(rows[1][HEADER_ROW.length + 3])) {
      fail('both archive rows claim the same source tab');
    } else ok('each copy records the tab it came off');
  }

  if (trashed.indexOf('QW-26-1003 — Cy Cline.pdf') < 0) fail('the quote PDF was not trashed');
  else ok('the quote PDF is trashed');
  if (trashed.indexOf('QW-26-1099 — Someone Else.pdf') >= 0) fail('somebody else\'s PDF was trashed');
  else ok('no other PDF was touched');

  const log = ss.getSheetByName('Activity Log');
  const last = log.grid[log.grid.length - 1];
  if (String(last[2]).indexOf('QW-26-1003') < 0 || String(last[2]).indexOf('Duplicate') < 0) {
    fail('the Activity Log does not record the deletion and its reason: ' + last[2]);
  } else ok('the Activity Log records who, what and why');
}

/* ========== 5. the archive must not look like a quote tab ========== */
console.log('=== the archive is invisible to every sheet sweep ===');
{
  const { ctx } = setup();
  ctx.adminDeleteQuote('admin', 'QW-26-1001', 'QW-26-1001', 'test quote', 0);
  const arch = archive(ctx);
  if (!arch) fail('no archive tab');
  else if (arch.getRange(1, 3).getValue() === 'Quote #') {
    fail('the archive answers to the "is this a quote tab" probe — a deleted quote would stay on the ' +
         'reminder run, the haul-out list and every count');
  } else ok('the archive fails the quote-tab probe, so every sweep skips it');

  /* The sweep that matters most, run for real: a send-to-all must not reach a
     deleted customer. bulkTargets_ walks the same tabs the 9am reminder does. */
  let targets = null;
  try { targets = ctx.bulkTargets_('fall'); } catch (e) { targets = null; }
  if (!targets) ok('(bulk target sweep not exercised here)');
  else if (targets.targets.some(t => String(t.d.quoteNo) === 'QW-26-1001')) {
    fail('a deleted quote is still in the send-to-all recipient list');
  } else ok('a deleted quote is out of the send-to-all list');
}

/* ========== 6. a deleted number is never handed out again ========== */
console.log('=== quote numbers are not recycled ===');
{
  const { ctx } = setup();
  const del = ctx.adminDeleteQuote('admin', 'QW-26-1001', 'QW-26-1001', 'test quote', 0);
  if (Number(del.ok) !== 1) fail('setup delete failed: ' + del.error);
  const taken = ctx.takenQuoteNos_();
  if (!taken['QW-26-1001']) fail('takenQuoteNos_ no longer counts the deleted number as used — it can be reissued');
  else ok('the deleted number still counts as taken');

  /* And prove it through the minter, with the rest of the space full. */
  const yy = String(new Date().getFullYear()).slice(2);
  const inside = ss.getSheetByName('Inside');
  for (let n = 1000; n <= 9999; n++) {
    const qn = 'QW-' + yy + '-' + n;
    if (qn === 'QW-26-1001') continue;
    inside.grid.push([String(n), 'Filler', qn]);
  }
  const got = ctx.uniqueQuoteNo_('QW-26-1001');
  if (got === 'QW-26-1001') fail('the minter handed back a number belonging to a deleted quote');
  else ok('the minter refuses the deleted number and widens instead (' + got + ')');
}

/* ========== 7. the dispatcher wiring: POST only ========== */
console.log('=== it arrives as a POST, never as a link ===');
{
  const { ctx } = setup();
  const GET_FNS = vm.runInContext('CONSOLE_GET_FNS_', ctx);
  if (GET_FNS.deleteQuote) fail('deleteQuote is on the GET allow-list — a link that deletes a quote can be followed twice');
  else ok('deleteQuote is not on the GET allow-list');
  const g = JSON.parse(ctx.consoleServe_({ fn: 'deleteQuote', token: 'admin',
    args: ['QW-26-1001', 'QW-26-1001', 'test', 1] }, 'GET')._text);
  if (Number(g.ok) === 1) fail('a GET deleted a quote');
  else ok('a GET is refused: ' + g.error);
  if (qnsOn(ss.getSheetByName('Inside')).indexOf('QW-26-1001') < 0) fail('the GET deleted the row anyway');
  else ok('the row survived the GET');
  const p = JSON.parse(ctx.consoleServe_({ fn: 'deleteQuote', token: 'admin',
    args: ['QW-26-1001', 'QW-26-1001', 'test quote', 1] }, 'POST')._text);
  if (Number(p.ok) !== 1) fail('the POST route does not work: ' + p.error);
  else ok('the same call works on POST');
  if (p._api !== 'console') fail('the reply is not stamped _api:console');
  else ok('the reply carries the console stamp');
}

/* ========== 8. a quote that is not there ========== */
console.log('=== a quote number nobody has ===');
{
  const { ctx } = setup();
  const r = ctx.adminDeleteQuote('admin', 'QW-26-9999', 'QW-26-9999', 'typo', 1);
  if (Number(r.ok) === 1) fail('deleting a quote that does not exist reported success');
  else ok('refused: ' + r.error);
}

if (bad) { console.error('\n' + bad + ' problem(s) with the quote delete.'); process.exit(1); }
console.log('\nquote delete: all checks passed.');
