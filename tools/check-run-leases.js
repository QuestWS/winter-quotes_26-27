#!/usr/bin/env node
/* Two runs of a job that must never overlap itself, executed rather than
   grepped for.
   ---------------------------------------------------------------------------
   Both of these happened to the live sheet in September 2026:

   - **The backup restore, clicked twice, four seconds apart.** Each run read
     the sheet before the other had written, each saw the same quote as
     missing, and each wrote it back — one quote number on two rows of
     Premium Inside, a second haul-out line and a second reminder.
   - **Two bulk-import slices at once.** Both read the same place in the
     worklist, and eleven customers were imported onto the Import tab twice.

   The guard is `claimLease_` (quote-logger-apps-script.gs). This check runs
   the real `adminBackupRestore` and the real `bulkImportSlice_` against a fake
   spreadsheet and fires the second run IN THE MIDDLE of the first — at the
   exact moment the September runs overlapped — then counts rows:

   1. A second restore while one is running is refused and writes nothing; the
      quote ends up on ONE row.
   2. A restore after the first has finished finds nothing left to put back.
   3. A lease left by a run that was killed expires; the next run proceeds.
   4. If the lock cannot be had, the claim is refused (fails closed).
   5. Only the holder releases a lease.
   6. A second bulk slice while one is running is refused and touches nothing.
   7. Progress is saved after every file, so a killed slice cannot make the
      next one re-import what it already wrote.
   8. Stop pressed mid-slice: the slice stops writing and does not resurrect
      the run by saving its old state back.

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

const WIDTH = 23;
const pad = (row) => { const r = row.slice(); while (r.length < WIDTH) r.push(''); return r; };

function makeSheet(name, grid) {
  const self = {
    getName: () => name,
    getSheetId: () => 'gid-' + name,
    getLastRow: () => grid.length,
    grid: grid,
    setFrozenRows: () => self,
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
          return self;
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

function quoteRow(qn, last) {
  const row = new Array(WIDTH).fill('');
  row[0] = last; row[2] = qn; row[6] = 'Boat'; row[11] = 1000;
  row[20] = JSON.stringify({ quoteNo: qn, lastName: last, total: 1000 });
  return row;
}

function makeSs(tabsSpec) {
  const tabs = {}, order = [];
  Object.keys(tabsSpec).forEach(n => {
    tabs[n] = makeSheet(n, [HEADER_ROW.slice()].concat(tabsSpec[n]));
    order.push(n);
  });
  return {
    tabs,
    getUrl: () => 'https://docs.google.test/FAKE',
    getId: () => 'FAKE',
    getName: () => 'Winter Quotes 2026-2027',
    getSheets: () => order.map(n => tabs[n]),
    getSheetByName: (n) => tabs[n] || null,
    insertSheet: (n) => { tabs[n] = makeSheet(n, []); order.push(n); return tabs[n]; }
  };
}

let live = null, backup = null, lockAvailable = true;
const props = {};

function context() {
  const ctx = {
    console, JSON, Date, Math, Number, String, Object, Array, isFinite, parseInt, parseFloat, RegExp, Error,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => live, openById: () => backup },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
        getKeys: () => Object.keys(props)
      })
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockAvailable, releaseLock: () => {} }) },
    DriveApp: { getFileById: () => ({ setTrashed: () => {} }) },
    GmailApp: { sendEmail: () => { throw new Error('nothing here may email anybody'); } },
    MailApp: { sendEmail: () => { throw new Error('nothing here may email anybody'); } },
    UrlFetchApp: { fetch: () => { throw new Error('no network here'); } },
    Utilities: { getUuid: (() => { let n = 0; return () => 'uuid-' + (++n); })(), formatDate: () => '2026-09-19' },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => {} }) }) }) },
    Session: { getScriptTimeZone: () => 'America/Chicago' }
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx, { filename: 'quote-logger-apps-script.gs' });
  return ctx;
}

function reset() {
  Object.keys(props).forEach(k => delete props[k]);
  props.STAFF = JSON.stringify({ Chris: { pin: '1111', admin: true, perms: {} } });
  props.SESS_admin = JSON.stringify({ name: 'Chris', exp: Date.now() + 3600000 });
  lockAvailable = true;
}

const countOf = (qn) => live.getSheets().reduce((n, sh) =>
  n + (sh.getRange(1, 3).getValue() === 'Quote #' ? sh.grid.slice(1).filter(r => r[2] === qn).length : 0), 0);

/* ============ 1-2. the double click on Restore ============ */
console.log('=== two restores cannot overlap ===');
{
  reset();
  /* The September shape: the quote is in last night's backup and missing
     from the live sheet. */
  live = makeSs({ 'Premium Inside': [quoteRow('QW-26-1001', 'Adams')], 'Activity Log': [] });
  live.tabs['Activity Log'].grid[0] = ['Timestamp', 'Who', 'Action'];
  backup = makeSs({ 'Premium Inside': [quoteRow('QW-26-1001', 'Adams'), quoteRow('QW-26-2002', 'Baker')] });
  const ctx = context();
  let second = null, fired = false;
  /* The snapshot is the slow first step of a restore — the window the second
     click landed in. Fire the second restore from inside it. */
  ctx.snapshotBeforeRestore_ = function () {
    if (!fired) { fired = true; second = ctx.adminBackupRestore('admin', 'backup-file', 'all', []); }
    return { getUrl: () => 'https://drive.test/snap' };
  };
  const first = ctx.adminBackupRestore('admin', 'backup-file', 'all', []);
  if (Number(first.ok) !== 1) fail('the first restore did not run: ' + first.error);
  else ok('the first restore ran (' + first.restored + ' restored)');
  if (!second || Number(second.ok) === 1) fail('a second restore started while the first was running');
  else ok('the second click is refused while the first runs: ' + second.error);
  const n = countOf('QW-26-2002');
  if (n !== 1) fail('the restored quote is on ' + n + ' rows — the September duplicate');
  else ok('the restored quote is on exactly one row');
  if (props.LEASE_restore) fail('the restore left its lease behind');
  else ok('the lease is released when the restore ends');

  /* A restore started after the first has finished: same file, nothing missing. */
  ctx.snapshotBeforeRestore_ = () => ({ getUrl: () => 'https://drive.test/snap2' });
  const again = ctx.adminBackupRestore('admin', 'backup-file', 'missing', []);
  if (Number(again.ok) === 1) fail('a later restore put back a quote that is already there');
  else ok('a later restore finds nothing missing: ' + again.error);
  if (countOf('QW-26-2002') !== 1) fail('the later restore changed the row count');
}

/* ============ 3-5. the lease itself ============ */
console.log('=== the lease: expiry, fail-closed, holder-only release ===');
{
  reset();
  live = makeSs({});
  const ctx = context();
  props.LEASE_restore = JSON.stringify({ token: 'dead-run', until: Date.now() - 1000 });
  const t = ctx.claimLease_('restore', 60000);
  if (!t) fail('an expired lease (a run killed by the ceiling) still blocks the job');
  else ok('an expired lease is taken over');
  if (ctx.claimLease_('restore', 60000)) fail('a live lease was claimed a second time');
  else ok('a live lease cannot be claimed twice');
  ctx.releaseLease_('restore', 'somebody-else');
  if (!props.LEASE_restore) fail('a non-holder released the lease');
  else ok('only the holder can release it');
  ctx.releaseLease_('restore', t);
  if (props.LEASE_restore) fail('the holder could not release its lease');
  else ok('the holder releases it');
  lockAvailable = false;
  if (ctx.claimLease_('restore', 60000)) fail('a claim succeeded without the lock — it must fail closed');
  else ok('no lock, no claim (fails closed)');
  lockAvailable = true;
}

/* ============ 6-8. the bulk import ============ */
function bulkCtx(files) {
  reset();
  live = makeSs({ Import: [] });
  const ctx = context();
  ctx.legacyMasterGrid_ = () => null;
  ctx.bulkImportExistingIndex_ = () => ({});
  ctx.bulkImportAppendReport_ = () => {};
  ctx.bulkImportFinish_ = () => { ctx.bulkImportClear_(); };
  const st = { mode: 'apply', folder: 'Storage 2025-2026', at: '2026-09-22T16:21:15.000Z',
               jobs: files, names: {}, i: 0, done: 0, failed: 0, skipped: 0, imported: 0, reportId: '' };
  files.forEach(f => { st.names[f] = f + '.ods'; });
  ctx.bulkImportSave_(st);
  return ctx;
}

console.log('=== two bulk-import slices cannot overlap ===');
{
  const ctx = bulkCtx(['a', 'b', 'c', 'd']);
  const imported = [];
  let second = null, fired = false;
  ctx.bulkImportOne_ = function (fid) {
    if (!fired) { fired = true; second = ctx.bulkImportSlice_(); }   // the second worker, mid-slice
    imported.push(fid);
    return ['IMPORTED', fid];
  };
  ctx.bulkImportSlice_();
  if (!second || !second.busy) fail('a second slice ran while the first was working');
  else ok('a second slice is refused while one is working');
  const dupes = imported.filter((f, i) => imported.indexOf(f) !== i);
  if (dupes.length) fail('files imported twice: ' + dupes.join(', '));
  else ok('each file imported once (' + imported.join(', ') + ')');
  if (props.LEASE_bulkImport) fail('the slice left its lease behind');
  else ok('the lease is released when the slice ends');
}

console.log('=== progress is saved per file ===');
{
  const ctx = bulkCtx(['a', 'b', 'c']);
  const seenAt = [];
  ctx.bulkImportOne_ = function (fid) {
    seenAt.push(JSON.parse(props[vm.runInContext('BULKIMP_PROP_', ctx)]).i);
    return ['IMPORTED', fid];
  };
  ctx.bulkImportSlice_();
  /* When file N is being read, the saved position must already be past file
     N-1 — so a slice killed during file N restarts AT file N, not at 0. */
  if (seenAt.join(',') !== '0,1,2') fail('saved position while reading each file was ' + seenAt.join(',') + ', expected 0,1,2');
  else ok('a killed slice would resume at the file it died on, not re-import the ones before');
}

console.log('=== Stop pressed mid-slice stays stopped ===');
{
  const ctx = bulkCtx(['a', 'b', 'c', 'd']);
  const imported = [];
  ctx.bulkImportOne_ = function (fid) {
    imported.push(fid);
    if (fid === 'b') ctx.bulkImportClear_();          // the Stop button, while b is being read
    return ['IMPORTED', fid];
  };
  const r = ctx.bulkImportSlice_();
  if (imported.indexOf('c') >= 0) fail('the slice kept importing after Stop: ' + imported.join(', '));
  else ok('nothing after the stop was imported (' + imported.join(', ') + ')');
  if (props[vm.runInContext('BULKIMP_PROP_', ctx)]) fail('the stopped run was resurrected by the slice saving its state back');
  else ok('the stopped run stays stopped');
  if (!r || !r.stopped) fail('the slice did not report that it was stopped');
}

if (bad) { console.error('\n' + bad + ' check(s) failed.'); process.exit(1); }
console.log('\nAll run-lease checks pass.');
