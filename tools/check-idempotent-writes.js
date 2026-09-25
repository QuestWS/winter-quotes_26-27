#!/usr/bin/env node
/* A write must happen once, and must still be able to answer twice.
   ---------------------------------------------------------------------------
   Background: recording a payment rebuilds the PDF and sends two emails. When
   that ran long, Google stopped waiting on the console's POST and handed back a
   404 — so staff were told the payment had failed while the receipt, with the
   new balance on it, was already in the customer's inbox. The next thing anyone
   does with a failed payment is record it again.

   The console now stamps every write with a request id and, when the answer
   goes missing, asks the server what became of that id instead of guessing.
   That only helps if the server really does:

   1. run the work once per id, no matter how many times the id arrives;
   2. hand back the SAME answer to a repeat, rather than a fresh "unknown";
   3. say "still running" — and run nothing — while the first copy is working;
   4. keep behaving exactly as before for a call that carries no id at all;
   5. throw the storage-view cache away on every write, derived from the
      read-only allow-list so a write added later cannot forget to;
   6. answer jobStatus without ever performing a write.

   None of that is visible to a grep, so it is executed against the real
   dispatcher out of the real file, with the cache and the lock faked. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  OK   ' + m);

/* ---- a cache and a lock that behave like the real ones ---- */
const store = new Map();
const cache = {
  get: (k) => (store.has(k) ? store.get(k) : null),
  put: (k, v) => { store.set(k, String(v)); },
  putAll: (o) => { Object.keys(o).forEach((k) => store.set(k, String(o[k]))); },
  /* getAll omits keys it does not hold, exactly as CacheService does. */
  getAll: (ks) => { const o = {}; ks.forEach((k) => { if (store.has(k)) o[k] = store.get(k); }); return o; },
  remove: (k) => { store.delete(k); },
  removeAll: (ks) => { ks.forEach((k) => store.delete(k)); }
};
let lockTaken = 0;
const ctx = {
  console,
  ContentService: {
    MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
    createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } })
  },
  HtmlService: { createHtmlOutput: (h) => ({ _html: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
  CacheService: { getScriptCache: () => cache },
  LockService: { getScriptLock: () => ({ tryLock: () => { lockTaken++; return true; }, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => { throw new Error('the spreadsheet must not be touched by this guard'); } },
  Utilities: {}, GmailApp: {}, DriveApp: {}, ScriptApp: {}, UrlFetchApp: {}, Session: {}
};
vm.createContext(ctx);
vm.runInContext(GS, ctx, { filename: 'quote-logger-apps-script.gs' });

const reply = (res) => JSON.parse(res._text);
/* `const` does not land on a VM's global object, so these are read by name. */
const GET_FNS = vm.runInContext('CONSOLE_GET_FNS_', ctx);
const RUNNING = vm.runInContext('RID_RUNNING_', ctx);

/* Every admin* entry point becomes a counter, so "did the work run" is
   observed rather than inferred from the wording of a message. Two stay real:
   adminJobStatus is the thing under test, and requireAuth_ is stubbed so it
   can run without a session. */
const runs = {};
const REAL_JOB_STATUS = ctx.adminJobStatus;
Object.keys(ctx).forEach((k) => {
  if (/^admin[A-Z]/.test(k) && typeof ctx[k] === 'function') {
    ctx[k] = function () { runs[k] = (runs[k] || 0) + 1; return { ok: 1, msg: 'did ' + k + ' #' + runs[k] }; };
  }
});
ctx.adminJobStatus = REAL_JOB_STATUS;
ctx.requireAuth_ = function () { return { name: 'Guard', admin: true, perms: {} }; };

const post = (p) => reply(ctx.consoleServe_(p, 'POST'));
const get = (p) => reply(ctx.consoleServe_(p, 'GET'));

/* ---- 1 & 2. one run per id; the repeat replays the same answer ---- */
runs.adminRecordPayment = 0;
const first = post({ fn: 'pay', token: 't', rid: 'rid-A', args: ['QW-26-1255', 500, 'Cash', 1] });
const again = post({ fn: 'pay', token: 't', rid: 'rid-A', args: ['QW-26-1255', 500, 'Cash', 1] });
if (runs.adminRecordPayment !== 1) fail('the same request id ran the payment ' + runs.adminRecordPayment + ' time(s) — it must run exactly once');
else ok('the same request id records the payment exactly once');
if (JSON.stringify(again.msg) !== JSON.stringify(first.msg) || Number(again.ok) !== 1) {
  fail('a repeat of a finished write did not replay its answer: ' + JSON.stringify(again));
} else ok('a repeat of a finished write replays the original answer (' + JSON.stringify(first.msg) + ')');
if (!again._replay) fail('the replayed answer is not marked as a replay');
else ok('the replayed answer says it is a replay');
if (!lockTaken) fail('the claim was taken without the script lock — two copies of one tap could both win it');
else ok('the claim is taken under the script lock');

/* A DIFFERENT id is a different action and must run. Recording two genuine
   payments in a row is ordinary, and must not be swallowed as a duplicate. */
const other = post({ fn: 'pay', token: 't', rid: 'rid-B', args: ['QW-26-1255', 25, 'Cash', 0] });
if (runs.adminRecordPayment !== 2 || Number(other.ok) !== 1) fail('a second, different request id did not run');
else ok('a different request id runs normally — two real payments still both land');

/* ---- 3. in flight: says so, runs nothing ---- */
runs.adminAdjust = 0;
store.set('RID_rid-C', RUNNING);
const busy = post({ fn: 'adjust', token: 't', rid: 'rid-C', args: ['QW-26-1255', -50, 'x', 0] });
if (runs.adminAdjust) fail('a write already in flight was started a second time');
else if (Number(busy.ok) !== 0 || !busy.pending) fail('a write already in flight did not report itself as pending: ' + JSON.stringify(busy));
else ok('a write already in flight reports pending and starts nothing');

/* ---- 4. no id, no change in behaviour ---- */
runs.adminLateFee = 0;
const plain = post({ fn: 'lateFee', token: 't', args: ['QW-26-1255', 10, 'late', 0] });
const plain2 = post({ fn: 'lateFee', token: 't', args: ['QW-26-1255', 10, 'late', 0] });
if (runs.adminLateFee !== 2 || Number(plain.ok) !== 1 || Number(plain2.ok) !== 1) {
  fail('a write with no request id no longer behaves as it always did');
} else ok('a write with no request id is unchanged — it runs every time');

/* ---- 5. any write drops the storage-view cache ---- */
const big = JSON.stringify({ ok: 1, groups: [{ tab: 'Lot', count: 1, rows: [{ pad: 'x'.repeat(200000) }] }] });
if (!ctx.cachePutBig_('storageView', big, 120)) fail('a storage view larger than one cache entry could not be stored');
else if (ctx.cacheGetBig_('storageView') !== big) fail('a chunked storage view did not come back byte-for-byte');
else ok('the storage view survives being split across cache entries (' + Math.round(big.length / 1024) + 'KB)');

/* a single missing chunk must be a miss, never half a storage sheet */
store.delete('storageView:1');
if (ctx.cacheGetBig_('storageView') !== null) fail('a storage view with a missing chunk was served anyway');
else ok('a storage view missing a chunk is a miss, not a partial answer');

ctx.cachePutBig_('storageView', big, 120);
post({ fn: 'staffNote', token: 't', args: ['QW-26-1255', 'note'] });
if (ctx.cacheGetBig_('storageView') !== null) fail('a write left a stale storage view in the cache');
else ok('a write throws the cached storage view away');

/* ...and that is derived from the allow-list, so it cannot be forgotten for a
   write added later. Prove it for every write the dispatcher knows. */
const FNS = Object.keys(ctx.consoleFns_({ token: 't', args: [] }));
const writes = FNS.filter((f) => !GET_FNS[f]);
const leaky = writes.filter((f) => {
  ctx.cachePutBig_('storageView', '{"ok":1,"groups":[]}', 120);
  post({ fn: f, token: 't', args: [] });
  return ctx.cacheGetBig_('storageView') !== null;
});
if (leaky.length) fail('these writes leave the storage view cached: ' + leaky.join(', '));
else ok('all ' + writes.length + ' writes drop the cached storage view');

/* A read must NOT drop it — that would make the cache pointless. */
ctx.cachePutBig_('storageView', '{"ok":1,"groups":[]}', 120);
post({ fn: 'lookup', token: 't', args: ['QW-26-1255'] });
if (ctx.cacheGetBig_('storageView') === null) fail('a read dropped the cached storage view');
else ok('a read leaves the cache alone');

/* ---- 6. jobStatus answers, and writes nothing ---- */
store.clear();
const before = JSON.stringify(runs);
const unknown = get({ fn: 'jobStatus', token: 't', args: ['never-sent'] });
if (unknown.state !== 'unknown') fail('an id the server never saw is not reported as unknown: ' + JSON.stringify(unknown));
else ok('an id the server never saw reports "unknown" — nothing was changed');

store.set('RID_rid-D', RUNNING);
if (get({ fn: 'jobStatus', token: 't', args: ['rid-D'] }).state !== 'running') fail('a write in flight is not reported as running');
else ok('a write in flight reports "running"');

store.set('RID_rid-E', JSON.stringify({ ok: 1, msg: 'Recorded $500.00 — Paid in full.' }));
const done = get({ fn: 'jobStatus', token: 't', args: ['rid-E'] });
if (done.state !== 'done' || !done.reply || done.reply.msg.indexOf('Recorded') !== 0) {
  fail('a finished write does not hand its answer back: ' + JSON.stringify(done));
} else ok('a finished write hands its real answer back over GET (' + JSON.stringify(done.reply.msg) + ')');
if (before !== JSON.stringify(runs)) fail('asking about a job ran something');
else ok('asking about a job runs nothing');

/* The whole point is that this question survives the route that broke. */
if (!GET_FNS.jobStatus) fail('jobStatus is not answerable on GET — it is the question asked when POST is what failed');
else ok('jobStatus is answerable on GET');

/* ---- 7. an answer too large to cache still says the work is done ---- */
ctx.finishRid_('rid-F', { ok: 1, msg: 'x'.repeat(200000) });
const trimmed = JSON.parse(store.get('RID_rid-F') || 'null');
if (!trimmed || Number(trimmed.ok) !== 1 || !trimmed._trimmed) {
  fail('an oversized answer was not replaced by a short one — a retry would see "unknown" and pay twice');
} else ok('an answer too big to cache is kept as a short "done", never as nothing');

/* ---- 8. no cache, no lock: slower, never broken ---- */
ctx.CacheService = { getScriptCache: () => { throw new Error('cache unavailable'); } };
ctx.LockService = { getScriptLock: () => { throw new Error('lock unavailable'); } };
runs.adminRecordPayment = 0;
const noCache = post({ fn: 'pay', token: 't', rid: 'rid-G', args: ['QW-26-1255', 75, 'Cash', 0] });
if (Number(noCache.ok) !== 1 || runs.adminRecordPayment !== 1) {
  fail('the console stops working when CacheService is unavailable: ' + JSON.stringify(noCache));
} else ok('with no cache and no lock a write still runs — the protection degrades, the console does not');

if (bad) { console.error('idempotent writes: ' + bad + ' failure(s)'); process.exit(1); }
console.log('idempotent writes: one run per id, answers replayable, cache dropped on every write');
