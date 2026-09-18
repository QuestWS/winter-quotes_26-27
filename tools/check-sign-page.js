#!/usr/bin/env node
/* What the scan-to-sign page does when the lookup lets it down.
   ---------------------------------------------------------------------------
   sign.html exists to stop customers typing their quote number into the Adobe
   contract by hand. It sits between a QR code on the counter flyer and the web
   form, confirms the number against the sheet, and hands the customer on with
   it pre-filled.

   Two things about that arrangement are worth executing rather than trusting:

   1. THE LOOKUP MAY INFORM, IT MAY NEVER BLOCK. The customer is standing at a
      counter. A quote we cannot find, a request that times out, a backend that
      is down and a browser that refuses the fetch must ALL still end with a
      working Continue button and a reachable contract. A page that returns
      early on any of them sends somebody to the desk instead.

   2. A QUOTE NUMBER IS WRITTEN INTO A READ-ONLY FIELD. `Quote_Number` is locked
      on the Adobe side (docs/adobe-webform-field-map.md) precisely so a customer
      cannot break the link back to their row — which also means a wrong number
      cannot be corrected once they are there. So the page must send only a
      number it could actually parse, and must show the customer the normalized
      form before it sends it.

   Both are behaviour, not text, so the page's real script is lifted out of
   sign.html and run against a browser thin enough to lie to.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'sign.html'), 'utf8');
const ENGINE = fs.readFileSync(path.join(ROOT, 'pricing-engine.js'), 'utf8');
const SRC = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');

let bad = 0;
const fail = m => { console.error('  FAIL ' + m); bad++; };
const ok = m => console.log('  ok: ' + m);

if (!SRC.trim()) { fail('sign.html has no inline script to execute'); process.exit(1); }

/* ---- a browser thin enough to lie to ---------------------------------- */
function makePage(opts) {
  opts = opts || {};
  const els = {};
  const mkEl = () => ({
    value: '', className: '', innerHTML: '', textContent: '', disabled: false,
    parentNode: null, src: '', onerror: null,
    _on: {}, addEventListener(t, fn) { (this._on[t] = this._on[t] || []).push(fn); },
    focus() { this._focused = true; }
  });
  ['quote', 'slip', 'found', 'go', 'skip'].forEach(id => { els[id] = mkEl(); });

  const timers = [];
  let tid = 0;
  const scripts = [];          // every JSONP <script> the page appended

  const ctx = {
    console,
    URLSearchParams,
    Date,
    setTimeout: (fn, ms) => { const id = ++tid; timers.push({ id, fn, ms }); return id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i > -1) timers.splice(i, 1); },
    location: { search: opts.search || '', href: '' },
    fetch: opts.fetch || (() => Promise.reject(new Error('offline'))),
    document: {
      getElementById: id => els[id] || null,
      createElement: () => mkEl(),
      body: { appendChild(el) { el.parentNode = { removeChild() {} }; scripts.push(el); } }
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(ENGINE, ctx, { filename: 'pricing-engine.js' });
  vm.runInContext(SRC, ctx, { filename: 'sign.html' });

  return {
    ctx, els, scripts,
    /* Fire every pending timer, soonest first — including any a handler adds. */
    runTimers() {
      let guard = 0;
      while (timers.length && guard++ < 50) {
        timers.sort((a, b) => a.ms - b.ms);
        timers.shift().fn();
      }
    },
    fire(id, type, ev) { (els[id]._on[type] || []).forEach(fn => fn(ev || { preventDefault() {} })); },
    /* The JSONP callback the page just installed, answered the way a real
       script tag would: either with a body, or with onerror. */
    answerJsonp(res) {
      const sc = scripts[scripts.length - 1];
      if (!sc) return false;
      const name = (String(sc.src).match(/callback=([A-Za-z0-9_$]+)/) || [])[1];
      if (!name) return false;
      if (res === null) { sc.onerror(); return true; }
      ctx[name](res);
      return true;
    }
  };
}

const settle = () => new Promise(r => setImmediate(r));
const jsonOK = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const YY = String(new Date().getFullYear()).slice(2);
const QN = 'QW-' + YY + '-1255';

(async () => {

/* =====================================================================
   1. THE HAPPY PATH — a confirmed quote, a slip, and the right URL.
   ===================================================================== */
{
  let asked = '';
  const p = makePage({ fetch: url => { asked = String(url); return jsonOK({ ok: 1, quoteNo: QN, who: 'W•••', unit: '2018 Sea Ray 230', slip: 'B-14' }); } });
  p.els.quote.value = '1255';
  p.fire('quote', 'blur');
  await settle();

  if (p.els.quote.value !== QN) {
    fail('the typed number was not normalized back into the field: ' + JSON.stringify(p.els.quote.value) +
         ' — the customer cannot check a number they are never shown, and Quote_Number is read-only on the Adobe side');
  } else ok('a bare "1255" is normalized to ' + QN + ' in the field the customer can see');

  if (asked.indexOf('action=signlookup') < 0) fail('the page did not use the narrowed signlookup action: ' + asked);
  else if (/[?&]ln=/.test(asked)) fail('the lookup sent a last name — this page has none to send');
  else ok('the lookup goes to ?action=signlookup with the quote number and nothing else');

  if (p.els.found.innerHTML.indexOf('2018 Sea Ray 230') < 0) fail('the confirmation does not show the unit: ' + p.els.found.innerHTML);
  else if (p.els.found.className.indexOf('ok') < 0) fail('a found quote was not shown as a success: ' + p.els.found.className);
  else ok('a found quote is confirmed back with the masked name and the unit');

  if (p.els.slip.value !== 'B-14') fail('the slip on the quote was not offered: ' + JSON.stringify(p.els.slip.value));
  else ok('a slip already on the quote is pre-filled');

  p.fire('go', 'click');
  const want = p.ctx.QuestPricing.signUrlFor({ quoteNo: QN, slipNo: 'B-14' });
  if (p.ctx.location.href !== want) fail('wrong hand-off URL:\n         got  ' + p.ctx.location.href + '\n         want ' + want);
  else ok('Continue hands off to exactly what the shared builder produces');
  if (p.ctx.location.href.indexOf('hosted=') > -1) fail('the hand-off claims to be embedded — this page redirects, it does not iframe');
  else ok('the hand-off carries no hosted= (it is a redirect, not an iframe)');
}

/* =====================================================================
   2. A SLIP THE CUSTOMER TYPED BEATS ONE THE SHEET OFFERS.
   ===================================================================== */
{
  const p = makePage({ fetch: () => jsonOK({ ok: 1, who: 'W•••', unit: 'Boat', slip: 'B-14' }) });
  p.els.slip.value = 'D-2';
  p.fire('slip', 'input');
  p.els.quote.value = '1255';
  p.fire('quote', 'blur');
  await settle();
  if (p.els.slip.value !== 'D-2') fail('the lookup overwrote a slip the customer had typed: ' + p.els.slip.value);
  else ok('a slip the customer typed is not overwritten by the sheet');
}

/* =====================================================================
   3. THE THREE WAYS THE LOOKUP CAN LET THEM DOWN. All must still sign.
   ===================================================================== */
const stillWorks = async (label, p) => {
  p.els.quote.value = '1255';
  p.fire('quote', 'blur');
  await settle();
  p.runTimers();
  await settle();
  p.fire('go', 'click');
  if (!p.ctx.location.href) fail(label + ': Continue did nothing — the customer is stranded at the counter');
  else if (p.ctx.location.href.indexOf(encodeURIComponent(QN)) < 0)
    fail(label + ': the quote number did not reach the contract: ' + p.ctx.location.href);
  else ok(label + ': the customer still reaches a pre-filled contract');
};

await stillWorks('quote not found',
  makePage({ fetch: () => jsonOK({ ok: 0 }) }));
await stillWorks('backend unreachable',
  makePage({ fetch: () => Promise.reject(new Error('offline')) }));
await stillWorks('backend answers 500',
  makePage({ fetch: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('no body')) }) }));

/* A request that simply never comes back: the timeout must fire and the page
   must carry on rather than sit there with a disabled button. */
{
  const p = makePage({ fetch: () => new Promise(() => {}) });
  p.els.quote.value = '1255';
  p.fire('quote', 'blur');
  await settle();
  p.runTimers();
  p.fire('go', 'click');
  if (!p.ctx.location.href) fail('a lookup that never answers left the page stuck');
  else ok('a lookup that never answers still ends at the contract');
}

/* What an unknown quote SAYS matters as much as that it proceeds. */
{
  const p = makePage({ fetch: () => jsonOK({ ok: 0 }) });
  p.els.quote.value = '1255';
  p.fire('quote', 'blur');
  await settle();
  if (p.els.found.className.indexOf('warn') < 0) fail('an unknown quote was not warned about: ' + p.els.found.className);
  else ok('an unknown quote gets a soft warning');
}

/* ...and a lookup we never got an answer from must NOT claim the quote is
   unknown. It probably exists; saying otherwise starts a conversation at the
   counter that did not need to happen. */
{
  const p = makePage({ fetch: () => Promise.reject(new Error('offline')) });
  p.els.quote.value = '1255';
  p.fire('quote', 'blur');
  await settle();
  p.answerJsonp(null);
  p.runTimers();
  if (/couldn.t find|not found/i.test(p.els.found.innerHTML))
    fail('an unreachable backend was reported to the customer as "quote not found": ' + p.els.found.innerHTML);
  else ok('an unreachable lookup says nothing rather than something untrue');
}

/* =====================================================================
   4. JSONP — the fallback transport, same as the quote page.
   ===================================================================== */
{
  const p = makePage({ fetch: () => Promise.reject(new Error('CORS')) });
  p.els.quote.value = '1255';
  p.fire('quote', 'blur');
  await settle();
  if (!p.scripts.length) fail('a refused fetch did not fall back to JSONP');
  else if (!p.answerJsonp({ ok: 1, who: 'W•••', unit: 'Demo Test Boat', slip: '' }))
    fail('the JSONP request carried no callback name: ' + p.scripts[0].src);
  else if (p.els.found.innerHTML.indexOf('Demo Test Boat') < 0)
    fail('the JSONP answer was not rendered: ' + p.els.found.innerHTML);
  else ok('a refused fetch falls back to JSONP and renders the answer');
}

/* =====================================================================
   5. A NUMBER WE CANNOT PARSE IS NEVER GUESSED AT.
   ===================================================================== */
{
  const p = makePage({ fetch: () => jsonOK({ ok: 0 }) });
  p.els.quote.value = 'my boat';
  p.fire('go', 'click');
  if (p.ctx.location.href) fail('a quote number we could not parse was sent to the contract anyway: ' + p.ctx.location.href);
  else if (p.els.found.className.indexOf('warn') < 0) fail('an unparseable quote number was not explained');
  else ok('an unparseable quote number is refused rather than guessed at');
  /* ...and the way out is still one tap away. */
  p.fire('skip', 'click');
  if (!p.ctx.location.href) fail('the escape hatch did not work after a refused number');
  else ok('the escape hatch still works after a refused number');
}

/* =====================================================================
   6. THE ESCAPE HATCH — the unprefilled form, with no fragment on it.
   ===================================================================== */
{
  const p = makePage({});
  p.fire('skip', 'click');
  const href = p.ctx.location.href;
  if (!href) fail('the "I don\'t have my quote number" link goes nowhere');
  else if (href.indexOf('#') > -1) fail('the escape hatch carries a pre-fill fragment: ' + href);
  else if (href !== String(p.ctx.QuestPricing.SIGNING.webFormUrl).split('#')[0])
    fail('the escape hatch does not go to the configured web form: ' + href);
  else ok('the escape hatch opens the configured form with nothing filled in');
}

/* =====================================================================
   7. DEEP LINK — fills the page in, and stops there.
   ===================================================================== */
{
  const p = makePage({ search: '?quote=1255&slip=B-14', fetch: () => jsonOK({ ok: 1, who: 'W•••', unit: 'Boat', slip: '' }) });
  await settle();
  if (p.els.quote.value !== QN) fail('?quote= did not populate and normalize the field: ' + p.els.quote.value);
  else if (p.els.slip.value !== 'B-14') fail('?slip= did not populate the slip field: ' + p.els.slip.value);
  else ok('?quote=/?slip= populate the inputs');
  if (p.ctx.location.href) fail('a deep link jumped straight to the contract — it must stop for the confirmation step: ' + p.ctx.location.href);
  else ok('a deep link stops at the confirmation step rather than auto-continuing');
}

/* =====================================================================
   8. THE PAGE HOLDS NO COPY OF THE ADOBE CONFIG.
   ===================================================================== */
if (/adobesign\.com|esignWidget|documents\.adobe\.com/i.test(HTML))
  fail('sign.html contains an Acrobat Sign URL — it belongs in SIGNING.webFormUrl only');
else ok('sign.html carries no Adobe URL of its own');
['Quote_Number', 'Slip_Number'].forEach(n => {
  if (HTML.indexOf(n) > -1) fail('sign.html names the Adobe field ' + n + ' — the names live in SIGNING.fields');
});
if (!/normalizeQuoteNo/.test(SRC)) fail('sign.html does not use the shared normalizeQuoteNo — a second parser would disagree with the server');
else ok('sign.html normalizes through the shared engine');
if (/function\s+normalizeQuoteNo\b|function\s+signUrlFor\b/.test(SRC))
  fail('sign.html defines its own copy of an engine function');
else ok('sign.html defines no copy of an engine function');
if (!/name="robots"[^>]*noindex/.test(HTML)) fail('sign.html is not noindex — it would turn up in search results');
else ok('sign.html is noindex');

process.exit(bad ? 1 : 0);
})();
