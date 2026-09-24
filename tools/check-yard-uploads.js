#!/usr/bin/env node
/* Full-size condition photos on a yard signal.
   ---------------------------------------------------------------------------
   The yard app's photos are evidence of damage that was already there, so they
   go up exactly as the camera wrote them — never shrunk, never re-encoded.
   What makes that bearable on a phone a mile and a half from the shop is how
   the upload behaves when the signal does not:

   1. A drop mid-clip carries on from what Drive already has. It does not fail,
      and it does not start again through the 25 MB base64 relay.
   2. No signal at all waits for signal rather than failing — and goes by
      itself the moment the phone is back online.
   3. A file left unfinished when the app closed carries on next time, in the
      same Drive session, without asking Apps Script for a new one.
   4. When Drive cannot say how far it got, the file starts again on a fresh
      session — once — and still lands exactly once.
   5. What Drive assembles is byte-for-byte the file the phone was handed, with
      the type the camera gave it.

   The real script is lifted out of yard/index.html and run against a fake Drive
   resumable-upload endpoint that honours Content-Range, answers 308 with a
   Range header, and drops connections on cue. Every claim is about what the
   app DID. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'yard/index.html'), 'utf8');
const SRC = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((b) => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  OK   ' + m);
const MB = 1048576;

/* ---- a file, and the blobs its slices make ---- */
function FakeBlob(bytes, type) { this.bytes = bytes; this.size = bytes.length; this.type = type || ''; }
FakeBlob.prototype.slice = function (a, b) { return new FakeBlob(this.bytes.subarray(a, b), this.type); };
function fakeFile(name, size, type) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 255;
  const f = new FakeBlob(bytes, type);
  f.name = name;
  return f;
}

/* ---- Drive's resumable endpoint ---- */
function makeDrive(opts) {
  const sessions = {};   // url -> { size, parts: [Uint8Array], have, done, types }
  let n = 0, dropped = 0;
  const drive = {
    sessions,
    open(size) {
      const url = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=S' + (++n);
      sessions[url] = { size, parts: [], have: 0, done: false, drops: 0, types: [] };
      return url;
    },
    assembled(url) {
      const s = sessions[url];
      const out = new Uint8Array(s.have);
      let o = 0;
      s.parts.forEach((p) => { out.set(p, o); o += p.length; });
      return out;
    },
    finished() { return Object.keys(sessions).filter((u) => sessions[u].done); }
  };
  function XHR() {
    const x = this;
    x.upload = {};
    x.headers = {};
    x.status = 0;
    x.open = (m, u) => { x.method = m; x.url = u; };
    x.setRequestHeader = (k, v) => { x.headers[k.toLowerCase()] = v; };
    x.getResponseHeader = (k) => (opts.hideRange ? null : (x.resHeaders || {})[k.toLowerCase()] || null);
    x.send = (body) => setImmediate(() => {
      const s = sessions[x.url];
      if (!s) { x.status = 404; return x.onload(); }
      if (opts.offline && opts.offline()) { x.status = 0; return x.onerror(); }
      const cr = x.headers['content-range'] || '';
      const range = () => { x.resHeaders = s.have ? { range: 'bytes=0-' + (s.have - 1) } : {}; };
      /* "How much do you have?" */
      if (/^bytes \*\//.test(cr)) {
        if (s.done) { x.status = 200; return x.onload(); }
        x.status = 308; range(); return x.onload();
      }
      let start = 0;
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr);
      if (m) start = Number(m[1]);
      else if (cr) { x.status = 400; return x.onload(); }
      if (start !== s.have) { x.status = 400; return x.onload(); }   // a gap or an overlap: Drive would refuse
      s.types.push(x.headers['content-type']);
      let bytes = body.bytes;
      /* The drop: part of this request arrives, then the connection goes. Drive
         keeps what it committed, in 256 KiB steps. */
      if (opts.dropAt !== undefined && dropped < (opts.drops || 1) &&
          s.have <= opts.dropAt && s.have + bytes.length > opts.dropAt) {
        dropped++;
        const kept = Math.floor((opts.dropAt - s.have) / 262144) * 262144;
        if (kept) { s.parts.push(bytes.slice(0, kept)); s.have += kept; }
        if (x.upload.onprogress) x.upload.onprogress({ loaded: opts.dropAt - start, lengthComputable: true });
        x.status = 0;
        return x.onerror();
      }
      if (x.upload.onprogress) x.upload.onprogress({ loaded: bytes.length, lengthComputable: true });
      s.parts.push(bytes.slice()); s.have += bytes.length;
      if (s.have >= s.size) { s.done = true; x.status = 200; return x.onload(); }
      x.status = 308; range(); return x.onload();
    });
  }
  drive.XHR = XHR;
  return drive;
}

/* ---- IndexedDB, only as much as the app uses ---- */
function fakeIDB(seed) {
  const rows = new Map((seed || []).map((r) => [r.id, r]));
  const db = {
    transaction() {
      const tx = {};
      const st = {
        put(r) { rows.set(r.id, r); return {}; },
        delete(id) { rows.delete(id); return {}; },
        getAll() { return { result: Array.from(rows.values()) }; }
      };
      tx.objectStore = () => st;
      setImmediate(() => tx.oncomplete && tx.oncomplete());
      return tx;
    }
  };
  return { rows, indexedDB: { open() { const rq = { result: db }; setImmediate(() => rq.onsuccess && rq.onsuccess()); return rq; } } };
}

/* ---- the app ---- */
function harness(opts) {
  const noop = () => {};
  const drive = makeDrive(opts);
  const idb = fakeIDB(opts.seed);
  const calls = [];
  const online = [];
  const els = {};
  const mk = (id) => ({ id, textContent: '', className: '', innerHTML: '', value: '', disabled: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop });
  const nav = { onLine: true };
  const ctx = {
    console: { log: noop, error: noop },
    XMLHttpRequest: drive.XHR,
    FileReader: function () { this.readAsDataURL = () => { this.result = 'data:x;base64,AAAA'; setImmediate(() => this.onload()); }; },
    indexedDB: idb.indexedDB,
    navigator: nav,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { getElementById: (id) => (els[id] = els[id] || mk(id)), addEventListener: noop,
                createElement: () => mk('x'), body: mk('b'), visibilityState: 'visible' },
    setTimeout: (fn) => { setImmediate(fn); return 0; }, clearTimeout: noop, scrollTo: noop,
    addEventListener: (ev, fn) => { if (ev === 'online') online.push(fn); },
    removeEventListener: noop,
    fetch: async (u, o) => {
      if (!o || o.method !== 'POST') {
        if (!nav.onLine) throw new Error('offline');
        return { ok: true, status: 200, json: async () => ({ _api: 'console', ok: 1, state: 'unknown' }) };
      }
      if (!nav.onLine) throw new Error('offline');
      const b = JSON.parse(o.body);
      calls.push(b.fn);
      let out = { ok: 1 };
      if (b.fn === 'uploadSession') out = { ok: 1, url: drive.open(b.args[4]) };
      if (b.fn === 'photoInfo') out = { ok: 1, counts: { winter: 1, spring: 0 } };
      return { ok: true, status: 200, json: async () => Object.assign({ _api: 'console' }, out) };
    }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.crypto = { randomUUID: () => 'id-' + Math.random().toString(36).slice(2, 10) };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'yard/index.html' });
  vm.runInContext('T="tok";ME={name:"Rex",admin:true,perms:{photos:1}};CUR={quoteNo:"QW-26-1255"}', ctx);
  return { ctx, drive, idb, calls, nav, els, goOnline() { nav.onLine = true; online.forEach((f) => f()); } };
}

async function drain(h) {
  for (let i = 0; i < 20000; i++) {
    await new Promise((r) => setImmediate(r));
    if (!vm.runInContext('UPRUN || UPQ.length', h.ctx)) {
      /* let trailing IndexedDB deletes settle */
      for (let j = 0; j < 20; j++) await new Promise((r) => setImmediate(r));
      return true;
    }
  }
  fail('the upload queue never drained');
  return false;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const count = (arr, v) => arr.filter((x) => x === v).length;

(async function main() {
  /* 1. A drop in the middle of a clip carries on from what Drive has. */
  {
    const h = harness({ dropAt: 11 * MB });
    const f = fakeFile('haulout.mov', 20 * MB + 12345, 'video/quicktime');
    await h.ctx.upload([f]);
    await drain(h);
    const done = h.drive.finished();
    if (done.length !== 1) fail('a dropped clip did not finish in Drive (' + done.length + ' finished sessions)');
    else if (!same(h.drive.assembled(done[0]), f.bytes)) fail('the clip Drive assembled is not the file the phone was given');
    else ok('a clip dropped at 11 MB of 20 carries on from where Drive got to and lands whole');
    if (count(h.calls, 'uploadSession') !== 1) fail('a drop asked Apps Script for a new session (' + count(h.calls, 'uploadSession') + ')');
    else ok('the drop reused its Drive session — no second trip to Apps Script');
    if (h.calls.indexOf('uploadPhoto') > -1) fail('a drop sent the clip down the base64 relay');
    else ok('a drop never falls back to the 25 MB relay');
    if (h.idb.rows.size) fail('the finished clip is still queued on the phone');
    else ok('once Drive has it, it is gone from the phone\'s queue');
  }

  /* 2. The original bytes and type, never re-encoded. */
  {
    const h = harness({});
    const f = fakeFile('IMG_2041.HEIC', 6 * MB + 17, 'image/heic');
    await h.ctx.upload([f]);
    await drain(h);
    const done = h.drive.finished();
    const s = done[0] && h.drive.sessions[done[0]];
    if (!s || !same(h.drive.assembled(done[0]), f.bytes)) fail('a still did not reach Drive byte-for-byte');
    else ok('a 6 MB still reaches Drive byte-for-byte — no shrinking, no re-encoding');
    if (!s || s.types.some((t) => t !== 'image/heic')) fail('the file was sent as something other than the camera\'s type: ' + (s && s.types.join(',')));
    else ok('and with the type the camera gave it');
  }

  /* 3. No signal: wait for it, then go by itself. */
  {
    let off = true;
    const h = harness({ offline: () => off });
    h.nav.onLine = false;
    const f = fakeFile('bow.jpg', 3 * MB, 'image/jpeg');
    await h.ctx.upload([f]);
    await drain(h);
    if (h.calls.indexOf('uploadPhoto') > -1) fail('with no signal the file was pushed at the relay');
    else if (h.drive.finished().length) fail('a file finished with no signal — the fake is wrong');
    else if (!h.idb.rows.size) fail('with no signal the file was dropped instead of kept on the phone');
    else ok('with no signal the file is kept on the phone, not failed and not relayed');
    const msg = (h.els.upMsg && h.els.upMsg.textContent) || '';
    if (!/signal/i.test(msg)) fail('the crew is not told it is waiting for signal: "' + msg + '"');
    else ok('and the crew is told it is waiting for signal');
    off = false;
    h.goOnline();
    await drain(h);
    const done = h.drive.finished();
    if (done.length !== 1 || !same(h.drive.assembled(done[0]), f.bytes)) fail('the file did not go when the signal came back');
    else ok('the moment the signal is back it goes by itself, whole');
    if (h.idb.rows.size) fail('the file is still queued after it landed');
  }

  /* 4. Left unfinished when the app closed: carries on, same session. */
  {
    const pre = makeDrive({});
    const f = fakeFile('stern.mov', 18 * MB, 'video/mp4');
    const url = pre.open(f.size);
    const h = harness({ seed: [{ id: 'left-over', qn: 'QW-26-1255', season: 'winter', name: 'stern.mov',
      file: f, url: url, urlAt: Date.now(), at: Date.now() }] });
    /* The session the phone kept is on the same Drive as the new harness. */
    h.drive.sessions[url] = { size: f.size, parts: [f.bytes.slice(0, 8 * MB)], have: 8 * MB, done: false, drops: 0, types: [] };
    await h.ctx.upResume_();
    await drain(h);
    const s = h.drive.sessions[url];
    if (!s.done || !same(h.drive.assembled(url), f.bytes)) fail('a file left half-sent did not finish in its own session');
    else ok('a clip left half-sent when the app closed finishes in the session it already had');
    if (h.calls.indexOf('uploadSession') > -1) fail('resuming asked Apps Script for a new session');
    else ok('resuming costs no trip to Apps Script');
    if (h.idb.rows.size) fail('the resumed file is still queued after it landed');
  }

  /* 5. Drive will not say how far it got: one clean restart, one file. */
  {
    const h = harness({ dropAt: 5 * MB, hideRange: true });
    const f = fakeFile('keel.mov', 12 * MB, 'video/mp4');
    await h.ctx.upload([f]);
    await drain(h);
    const done = h.drive.finished();
    if (done.length !== 1) fail('an unreadable resume point left ' + done.length + ' finished files (want exactly 1)');
    else if (!same(h.drive.assembled(done[0]), f.bytes)) fail('the restarted file is not the original');
    else ok('when Drive will not say how far it got, the file starts over on a fresh session and lands exactly once');
  }

  /* 6. A refusal that happens before a byte moves is still the relay's job. */
  {
    const h = harness({});
    h.ctx.XMLHttpRequest = function () {
      this.upload = {}; this.open = () => {}; this.setRequestHeader = () => {};
      this.send = () => setImmediate(() => { this.status = 0; this.onerror(); });
    };
    await h.ctx.upload([fakeFile('small.jpg', 2 * MB, 'image/jpeg')]);
    await drain(h);
    if (h.calls.indexOf('uploadPhoto') < 0) fail('a browser that refuses the direct PUT no longer falls back to the relay');
    else ok('a browser that refuses the direct PUT outright still falls back to the relay');
  }

  if (bad) { console.error('yard uploads: ' + bad + ' failure(s)'); process.exit(1); }
  console.log('yard uploads: full-size files survive drops, dead zones and a closed app');
})().catch((e) => { console.error('  FAIL the guard itself crashed: ' + (e && e.stack || e)); process.exit(1); });
