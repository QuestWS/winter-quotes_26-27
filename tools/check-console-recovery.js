#!/usr/bin/env node
/* What the console does when the answer never arrives.
   ---------------------------------------------------------------------------
   Apps Script answers a POST with a redirect to a one-shot googleusercontent
   URL. On a phone at the harbor, on a call Google took long enough to give up on,
   that leg comes back 404. Two failures came out of treating that as an answer:

   - the storage view threw `Network error (404)` after minutes of waiting and
     never reached its GET fallback, so the same tap worked on the second try;
   - a payment was reported as failed while the server was still finishing it.
     The receipt, with the new balance on it, was already in the customer's
     inbox. The next thing anyone does with a failed payment is record it again.

   The console's half of the fix is executed here: the real script is lifted out
   of admin/index.html and run against a `fetch` that fails on cue. Every claim
   below is about what the console DID — which requests it sent, and what it
   handed back to the person tapping the button. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');
const SRC = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((b) => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  OK   ' + m);

/* ---- the console, with a browser thin enough to lie to ---- */
let sent = [];          // every request the console made, in order
let handler = null;     // decides what each one comes back as
const stamped = (o) => Object.assign({ _api: 'console' }, o);
const asResponse = (o) => (o.status && o.status !== 200)
  ? { ok: false, status: o.status, json: async () => { throw new Error('no body'); } }
  : { ok: true, status: 200, json: async () => o.body };

function makeConsole() {
  sent = [];
  const noop = () => {};
  const el = { textContent: '', className: '', innerHTML: '', value: '', classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop };
  const ctx = {
    console,
    localStorage: { getItem: () => null, setItem: noop, clear: noop },
    location: { reload: noop, href: '' },
    document: { getElementById: () => el, querySelector: () => el, addEventListener: noop, createElement: () => el, body: el },
    /* Timers fire straight away: this guard is about the order of the calls,
       not about how long the console is willing to wait. */
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: noop,
    MutationObserver: function () { return { observe: noop }; },
    fetch: async (url, opts) => {
      const req = { url: String(url), method: (opts && opts.method) || 'GET',
                    body: (opts && opts.body) ? JSON.parse(opts.body) : null };
      if (req.method === 'GET') {
        const q = req.url.split('?')[1] || '';
        const p = {};
        q.split('&').forEach((kv) => { const i = kv.indexOf('='); p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
        req.fn = p.fn; req.args = JSON.parse(p.args || '[]');
      } else if (req.body) { req.fn = req.body.fn; req.rid = req.body.rid; req.args = req.body.args; }
      sent.push(req);
      return asResponse(handler(req) || {});
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.crypto = { randomUUID: () => 'uuid-' + sent.length + '-' + Math.random().toString(36).slice(2, 8) };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'admin/index.html' });
  vm.runInContext('T = "tok";', ctx);
  return ctx;
}

const GOT = (fn, method) => sent.filter((r) => r.fn === fn && (!method || r.method === method));

/* =====================================================================
   1. A READ whose POST 404s must fall through to GET, not give up.
   ===================================================================== */
(async () => {
  let c = makeConsole();
  handler = (r) => (r.method === 'POST'
    ? { status: 404 }
    : { body: stamped({ ok: 1, groups: [{ tab: 'Lot', count: 2, rows: [] }] }) });
  let out = null, err = null;
  try { out = await c.api('storageView', []); } catch (e) { err = e; }
  if (err) fail('a 404 on the storage view POST still fails outright: ' + err.message);
  else if (!out || Number(out.ok) !== 1) fail('the storage view did not come back over GET: ' + JSON.stringify(out));
  else if (!GOT('storageView', 'GET').length) fail('the GET fallback was never attempted');
  else ok('a read whose POST 404s is answered over GET instead of failing (the storage view bug)');

  /* ...and a GET that fails once is retried rather than surfaced. */
  c = makeConsole();
  let getTries = 0;
  handler = (r) => {
    if (r.method === 'POST') return { status: 404 };
    return (++getTries < 3) ? { status: 404 } : { body: stamped({ ok: 1, groups: [] }) };
  };
  out = null; err = null;
  try { out = await c.api('storageView', []); } catch (e) { err = e; }
  if (err) fail('a flaky GET is not retried: ' + err.message);
  else if (getTries !== 3) fail('expected 3 GET attempts, saw ' + getTries);
  else ok('a read retries the GET route before reporting a failure (' + getTries + ' attempts)');

  /* A read that fails every way must still say so rather than hang. */
  c = makeConsole();
  handler = () => ({ status: 404 });
  err = null;
  try { await c.api('storageView', []); } catch (e) { err = e; }
  if (!err) fail('a read that fails on every route resolved anyway');
  else if (!/try again/i.test(err.message)) fail('the give-up message does not tell anyone what to do: ' + err.message);
  else ok('a read that fails on every route reports a reachability problem');

  /* =====================================================================
     2. Every WRITE carries its own request id.
     ===================================================================== */
  c = makeConsole();
  handler = () => ({ body: stamped({ ok: 1, msg: 'done' }) });
  await c.api('pay', ['QW-26-1255', 500, 'Cash', 1]);
  await c.api('pay', ['QW-26-1255', 25, 'Cash', 0]);
  await c.api('lookup', ['QW-26-1255']);
  const pays = GOT('pay', 'POST');
  if (pays.length !== 2 || !pays[0].rid || !pays[1].rid) fail('a payment was sent without a request id');
  else if (pays[0].rid === pays[1].rid) fail('two separate payments shared one request id — the second would be swallowed as a duplicate');
  else ok('every write carries its own request id, a fresh one per action');
  const reads = GOT('lookup', 'POST');
  if (reads.length && reads[0].rid) fail('a read carries a request id it does not need');
  else ok('reads carry no request id');

  /* =====================================================================
     3. A WRITE whose answer went missing, where the work DID happen.
        This is the payment Chris was told had failed.
     ===================================================================== */
  c = makeConsole();
  const REAL = 'Recorded $500.00 — Paid in full. Receipt emailed.';
  let ridSeen = null;
  handler = (r) => {
    if (r.method === 'POST' && r.fn === 'pay') { ridSeen = r.rid; return { status: 404 }; }
    if (r.fn === 'jobStatus') {
      if (r.args[0] !== ridSeen) return { body: stamped({ ok: 1, state: 'unknown' }) };
      /* still finishing its PDF and its two emails, then done */
      return { body: stamped(GOT('jobStatus').length < 3
        ? { ok: 1, state: 'running' }
        : { ok: 1, state: 'done', reply: { _api: 'console', ok: 1, msg: REAL } }) };
    }
    return { status: 404 };
  };
  out = null; err = null;
  try { out = await c.api('pay', ['QW-26-1255', 500, 'Cash', 1]); } catch (e) { err = e; }
  if (err) fail('a payment that actually succeeded was still reported as an error: ' + err.message);
  else if (!out || out.msg !== REAL) fail('the console did not hand back what the server really did: ' + JSON.stringify(out));
  else ok('a payment whose answer went missing is reported by its real result, not as a failure');
  if (GOT('pay', 'POST').length !== 1) fail('the payment was posted ' + GOT('pay', 'POST').length + ' times — it must be sent once and then asked about');
  else ok('the payment is sent exactly once and then asked about, never re-sent');
  if (!GOT('jobStatus', 'GET').length) fail('the console asked about the job over a route other than GET — GET is the one that still worked');
  else ok('the console asks what became of the write over GET');

  /* =====================================================================
     4. ...where the write never arrived at all.
     ===================================================================== */
  c = makeConsole();
  handler = (r) => (r.fn === 'jobStatus'
    ? { body: stamped({ ok: 1, state: 'unknown' }) }
    : { status: 404 });
  err = null;
  try { await c.api('pay', ['QW-26-1255', 500, 'Cash', 1]); } catch (e) { err = e; }
  if (!err) fail('a write that never arrived was reported as a success');
  else if (!/nothing was changed/i.test(err.message)) fail('a write that never arrived does not say nothing changed: ' + err.message);
  else ok('a write the server never received says so — nothing was changed, try again');

  /* =====================================================================
     5. ...where it is still running when we run out of patience.
        The one thing that must never be said here is "it failed".
     ===================================================================== */
  c = makeConsole();
  handler = (r) => (r.fn === 'jobStatus'
    ? { body: stamped({ ok: 1, state: 'running' }) }
    : { status: 404 });
  err = null;
  try { await c.api('pay', ['QW-26-1255', 500, 'Cash', 1]); } catch (e) { err = e; }
  if (!err) fail('a write still in flight was reported as a success');
  else if (/nothing was changed/i.test(err.message)) fail('a write still in flight was reported as having changed nothing: ' + err.message);
  else if (!/do not send it again/i.test(err.message)) fail('a write still in flight does not warn against repeating it: ' + err.message);
  else ok('a write still in flight warns against repeating it and says to check the quote');

  /* =====================================================================
     6. A lost read must not disarm the writes.
        API_USE_GET sends later reads straight to GET. Writes are refused on
        GET by the server, so a write that skipped the POST would never be
        attempted at all — it would fail with "nothing was changed" while
        genuinely doing nothing, forever.
     ===================================================================== */
  c = makeConsole();
  handler = (r) => (r.method === 'POST'
    ? { body: { ok: 0, error: 'Enter both your quote number and last name.' } }
    : { body: stamped({ ok: 1, hits: [] }) });
  await c.api('search', ['white']);
  if (!vm.runInContext('API_USE_GET', c)) fail('a lost POST did not switch reads over to GET');
  else ok('a lost POST switches later reads to the GET route');
  handler = (r) => (r.method === 'POST' ? { body: stamped({ ok: 1, msg: 'paid' }) } : { status: 404 });
  const n0 = GOT('pay', 'POST').length;
  out = await c.api('pay', ['QW-26-1255', 500, 'Cash', 1]);
  if (GOT('pay', 'POST').length !== n0 + 1) fail('a write was never posted once reads had moved to GET');
  else if (!out || Number(out.ok) !== 1) fail('a write after a lost read did not go through: ' + JSON.stringify(out));
  else ok('writes keep posting even after reads have moved to GET');

  if (bad) { console.error('console recovery: ' + bad + ' failure(s)'); process.exit(1); }
  console.log('console recovery: a dropped answer is chased down, never guessed at');
})().catch((e) => { console.error('console recovery: guard crashed — ' + e.stack); process.exit(1); });
