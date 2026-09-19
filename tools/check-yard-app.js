#!/usr/bin/env node
/* The yard app: what it must never decide for itself, and what must survive a
   phone with two bars.
   ---------------------------------------------------------------------------
   yard/index.html is the third surface to ask "may we pull this boat?" — after
   the staff console and the printed haul-out sheet. The answer is the SERVER's
   (haulAuth_ in the .gs) and is shipped on every storage row. This guard exists
   because the cheap thing to do, the next time somebody adds a field, is to
   work the rule out locally from `deposit` and `contract`; two of the three
   copies would then be free to go stale, and the one that goes stale is the one
   that clears a boat nobody signed for.

   It also pins the things that only fail in the yard, where nobody is watching
   a console: the GET fallback naming a function the server refuses, the
   lost-POST fingerprint drifting from the string it matches, and `capture`
   spreading to the gallery input and killing the gallery on Android.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('yard/index.html');
const GAS = read('quote-logger-apps-script.gs');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);
const eq = (got, want, what) => {
  if (got === want) ok(what);
  else fail(what + ' — got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
};

/* ---- run the real page script ---- */
const SRC = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((b) => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');

function load() {
  const noop = () => {};
  const el = { textContent: '', className: '', innerHTML: '', value: '', disabled: false,
               classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
               addEventListener: noop, click: noop };
  const ctx = {
    console,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { getElementById: () => el, addEventListener: noop, createElement: () => el, body: el },
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: noop,
    fetch: async () => { throw new Error('this guard makes no requests'); },
    scrollTo: noop
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'yard/index.html' });
  /* `function` declarations land on the context object, but top-level `let`
     and `const` live in the realm's global LEXICAL scope and never become
     properties of it. Reaching them means evaluating an expression in the same
     realm rather than reading ctx.FOO — which would silently be undefined and
     make this guard pass by testing nothing. */
  ctx.ev = (expr) => vm.runInContext(expr, ctx, { filename: 'guard-probe' });
  return ctx;
}
const Y = load();

/* =====================================================================
   1. THE APP DECIDES NOTHING ABOUT PULLING.
   ===================================================================== */
/* Whatever the server stamped is what the app shows — including a state the
   app has never heard of, which it must not quietly downgrade to "fine". */
eq(Y.auth_({ deposit: true, contract: true, auth: { state: 'cleared' } }).state, 'cleared',
   'a row the server cleared reads as cleared');
eq(Y.auth_({ deposit: true, contract: true, auth: { state: 'hold', why: 'payment' } }).why, 'payment',
   'the app reports the server\'s reason, it does not recompute one');
/* THE FAIL-SAFE, and the reason this file exists. A row with no stamp on it —
   an older backend, a cache entry from before the deploy — must read as
   blocked on the phone, exactly as it does on the console. */
{
  const bare = Y.auth_({ deposit: true, contract: true });
  if (bare.state === 'cleared') {
    fail('an unstamped row reads as CLEARED in the yard app — a backend that has not deployed ' +
         'yet would authorise pulling boats nobody signed for');
  } else ok('an unstamped row reads as blocked (it fails towards not touching the boat)');
  if (/DO NOT PULL/.test(String(bare.stamp || ''))) ok('and it still stamps DO NOT PULL');
  else fail('the unstamped fallback does not say DO NOT PULL: ' + JSON.stringify(bare.stamp));
}
/* The rule itself must not be in this file. Anything that turns `contract` and
   `deposit` into a verdict here is a second copy by definition. */
{
  const js = SRC.replace(/\/\*[\s\S]*?\*\//g, '');      // comments may discuss it
  if (/cleared[\s\S]{0,80}(contract|deposit)/.test(js) && !/a\.state/.test(js)) {
    fail('the yard app looks like it is working the pull rule out from contract/deposit');
  } else ok('the yard app carries no rule of its own — it renders what the server stamped');
}

/* =====================================================================
   2. THE TWO LISTS ARE WHAT CHRIS ASKED FOR.
   ===================================================================== */
Y.ev('ROWS = ' + JSON.stringify([
  { qn: 'A', name: 'Adams', slip: 'B-14', tab: 'Building A', seasonDone: { choice: 'now' } },
  { qn: 'B', name: 'Baker', slip: '',     tab: 'Building A', seasonDone: { choice: 'now' } },
  { qn: 'C', name: 'Clark', slip: '   ',  tab: 'Outside',    seasonDone: null },
  { qn: 'D', name: 'Dunn',  slip: 'C-2',  tab: 'Outside',    seasonDone: { choice: 'call' } },
  { qn: 'E', name: 'Ewing', slip: 'A-1',  tab: 'Building A', seasonDone: { choice: 'date', date: '2026-10-20' } }
]));
{
  const pull = Y.ev('pullList_().map(function(r){return r.qn;})');
  eq(pull.join(','), 'A,E,D', '"To pull" is slip boats only, in haul-out order (now, date, will call)');
  if (pull.indexOf('C') > -1) fail('a whitespace-only slip counted as a slip — that boat is not in the water');
  else ok('a whitespace-only slip is not a slip');
  if (pull.indexOf('B') > -1) fail('a boat with no slip is on the pull list');
  else ok('a boat with no slip never reaches the pull list');
}

/* =====================================================================
   2b. THE THREE LISTS ARE ONE FIELD READ THREE WAYS.
   ---------------------------------------------------------------------
   A unit must be on exactly one list. On two, and the crew does the same job
   twice; on none, and a boat sits in the water until somebody notices.
   ===================================================================== */
{
  const cases = [
    ['',        'B-14', 'pull',   'in the water and not yet pulled'],
    ['',        '',     '',       'no slip and nothing done: not the crew\'s problem yet'],
    ['pulled',  'B-14', 'store',  'pulled leaves the pull list for the store list'],
    ['dropped', '',     'store',  'dropped off reaches the store list without ever being in the water'],
    ['dropped', 'B-14', 'store',  'and a slip does not drag it back onto the pull list'],
    ['stored',  'B-14', 'stored', 'stored is stored, slip or no slip'],
    ['stored',  '',     'stored', 'stored is stored for a trailered unit too']
  ];
  cases.forEach(function (c) {
    eq(Y.listOf_({ yardState: c[0], slip: c[1] }), c[2], c[3]);
  });
  /* The property underneath all of it, asserted rather than reasoned about. */
  const lists = ['pull', 'store', 'stored'];
  let clean = true;
  ['', 'pulled', 'dropped', 'stored'].forEach(function (st) {
    ['', 'B-14'].forEach(function (slip) {
      const row = { yardState: st, slip: slip };
      const on = lists.filter(function (L) { return Y.listOf_(row) === L; });
      if (on.length > 1) { clean = false; fail('state ' + JSON.stringify(st) + ' appears on ' + on.join(' and ')); }
    });
  });
  if (clean) ok('no unit is ever on two lists at once');
  /* An unknown state must not vanish a boat. */
  const odd = Y.listOf_({ yardState: 'teleported', slip: 'B-14' });
  if (odd === '') fail('an unrecognised state made a boat disappear from every list');
  else ok('an unrecognised state falls back to a real list rather than vanishing (' + odd + ')');
}
/* Search and sort, on the two lists that have them. */
{
  Y.ev('ROWS = ' + JSON.stringify([
    { qn: 'QW-1', name: 'Zeller, Zoe', slip: '', tab: 'Building B', unit: 'Boat', yardState: 'pulled' },
    { qn: 'QW-2', name: 'Adams, Al',   slip: '', tab: 'Outside',    unit: 'Boat', yardState: 'dropped' },
    { qn: 'QW-3', name: 'Moss, Mo',    slip: '', tab: 'Building B', unit: 'Jet Ski', yardState: 'pulled' },
    { qn: 'QW-4', name: 'Quinn, Qi',   slip: '', tab: 'Building B', unit: 'Boat', yardState: 'stored' }
  ]));
  Y.ev('SORT = "location"');
  /* Building B before Outside, and inside Building B "Moss" before "Zeller". */
  eq(Y.ev('storeList_("store").map(function(r){return r.qn;}).join(",")'), 'QW-3,QW-1,QW-2',
     'by location groups Building B before Outside, and sorts by name inside each');
  Y.ev('SORT = "name"');
  eq(Y.ev('storeList_("store").map(function(r){return r.qn;}).join(",")'), 'QW-2,QW-3,QW-1',
     'by name ignores location entirely');
  eq(Y.ev('storeList_("stored").map(function(r){return r.qn;}).join(",")'), 'QW-4',
     'the stored list holds only stored units');
  /* Search has to find a unit by whatever the person happens to know. */
  Y.ev('document.getElementById("q").value = "jet"');
  eq(Y.ev('storeList_("store").length'), 1, 'search matches the unit type');
  Y.ev('document.getElementById("q").value = "QW-2"');
  eq(Y.ev('storeList_("store").length'), 1, 'search matches the quote number');
  Y.ev('document.getElementById("q").value = "outside"');
  eq(Y.ev('storeList_("store").length'), 1, 'search matches the location');
  Y.ev('document.getElementById("q").value = "ZELL"');
  eq(Y.ev('storeList_("store").length'), 1, 'search ignores case');
  Y.ev('document.getElementById("q").value = ""');
}
/* The liability gate follows the boat onto the new control. */
{
  const held = { qn: 'H', slip: 'B-1', auth: { state: 'hold', why: 'signature', stamp: 'NO SIGNED CONTRACT — DO NOT PULL' } };
  Y.ev('ME = {name:"Rex",admin:true,perms:{}}');
  const markup = Y.act_(held, 'pulled', 'Pulled ✓');
  if (/disabled/.test(markup)) ok('a unit that is not cleared cannot be ticked off as pulled');
  else fail('the pull tick is offered on a unit nobody may touch — the app would be where the ' +
            'rule violation gets written down');
  const okRow = { qn: 'C', slip: 'B-2', auth: { state: 'cleared' } };
  if (/disabled/.test(Y.act_(okRow, 'pulled', 'Pulled ✓'))) fail('a cleared unit cannot be ticked off');
  else ok('a cleared unit can be ticked off in one tap');
  if (/stopPropagation/.test(Y.act_(okRow, 'pulled', 'Pulled ✓')))
    ok('ticking a row does not also open its detail sheet');
  else fail('the row action will also fire the row tap — the list jumps out from under the crew');
}
/* And the server refuses it too, because a client is not a permission. */
{
  const gas = GAS;
  const fn = (gas.match(/function adminSetYardState\b[\s\S]*?\n}/m) || [''])[0];
  if (!fn) fail('there is no adminSetYardState on the server');
  else {
    if (/haulAuth_\(/.test(fn) && /'pulled'/.test(fn))
      ok('the server re-checks the pull gate rather than trusting the app');
    else fail('adminSetYardState does not gate "pulled" on haulAuth_ — a crafted request could ' +
              'record a pull nobody was cleared for');
    if (/requireAuth_\(token, 'keys'\)/.test(fn)) ok('and it is gated on the yard permission');
    else fail('adminSetYardState is not gated on the keys permission');
    if (/savePdf_|recomputeTotals_|rebuildLinesFromState_/.test(fn))
      fail('moving a boat re-prices it or rebuilds its PDF — it is a fact about a day\'s work, ' +
           'not a change to what the customer owes');
    else ok('moving a boat touches no money and no paperwork');
  }
  /* EVERY transition works from either surface. The counter and the shop are
     the same people (CLAUDE.md §9) — a phone that glitched in the yard must not
     mean the only person who can record the pull is the one whose phone failed.
     This was built the other way once and had to be taken back out. */
  const adminHtml = read('admin/index.html');
  if (/btn\('pulled'/.test(adminHtml)) ok('the console can record a pull, not just the app');
  else fail('the console cannot mark a unit pulled — when somebody\'s phone glitches in the ' +
            'yard, the person they tell has to be able to record it');
  /* But the gate does not relax for it. */
  if (/_yardAuth[\s\S]{0,400}?state==='cleared'/.test(adminHtml))
    ok('and the console gates that button on the same cleared/not-cleared answer');
  else fail('the console offers "Mark pulled" without checking whether the unit is cleared');
  /* Which means the server has to send it that answer. */
  if (/yardAuth: haulAuth_\(/.test(gas)) ok('adminLookup ships the pull verdict to the console');
  else fail('adminLookup does not return yardAuth, so the console is gating on undefined — ' +
            'it would either always block or always allow');

  /* It has to survive the customer's next save like the rest of the yard state. */
  const carry = (gas.match(/if \(oldD\.yard\)/) || [''])[0];
  if (carry) ok('yard progress survives a customer save');
  else fail('a customer save would wipe the season\'s yard progress');
}

/* =====================================================================
   2c. THE ALERT IS ON THE LIST, NOT JUST BEHIND A TAP.
   ---------------------------------------------------------------------
   Its entire purpose is that somebody loading the app sees which boats need
   reading about BEFORE walking over to one. An alert only visible on the
   detail screen is a note, and there is already a note.
   ===================================================================== */
{
  const withAlert = { qn: 'A', name: 'Adams', slip: 'B-1', alert: 'no keys — do not tow',
                      auth: { state: 'cleared' } };
  const markup = Y.row_(withAlert, 'Slip B-1', '');
  if (markup.indexOf('no keys — do not tow') > -1) ok('the alert is rendered on the list row itself');
  else fail('the alert does not appear on the row — it would only be found by opening the unit');
  if (/class="alert"/.test(markup)) ok('and it is rendered as the alert strip, not plain text');
  else fail('the alert is not using the alert styling');
  /* Never by colour alone: this is read outdoors, in November, on a phone. */
  if (/\u26A0|⚠/.test(markup)) ok('it carries an icon, so it does not depend on colour');
  else fail('the alert is carried by colour alone');
  if (Y.row_({ qn: 'B', name: 'Baker', slip: '', auth: { state: 'cleared' } }, '', '').indexOf('class="alert"') > -1)
    fail('a unit with no alert still renders an empty alert strip');
  else ok('a unit with no alert renders nothing');
  /* It must not be confusable with the thing that stops a boat moving. */
  const held = Y.row_({ qn: 'C', name: 'Clark', slip: 'B-2', alert: 'watch the canvas',
                        auth: { state: 'hold', why: 'signature', stamp: 'NO SIGNED CONTRACT — DO NOT PULL' } },
                      'Slip B-2', '');
  if (/class="alert"/.test(held) && /class="badge stop"/.test(held))
    ok('an alert and a do-not-pull stamp are separate marks on the same row');
  else fail('the alert and the pull stamp are not distinguishable on a row that has both');
}
{
  /* Short by construction, or it stops being scannable. */
  const g = GAS;
  const fn = (g.match(/function adminSetYardAlert\b[\s\S]*?\n}/m) || [''])[0];
  if (!fn) fail('there is no adminSetYardAlert on the server');
  else {
    if (/YARD_ALERT_MAX_/.test(fn)) ok('the alert is length-capped so it stays readable at a glance');
    else fail('nothing caps the alert length — a paragraph on every row is not an alert');
    if (/delete d\.yardAlert/.test(fn)) ok('an empty alert clears it rather than storing a blank');
    else fail('clearing an alert does not remove it');
    if (/auditLog_/.test(fn)) ok('setting and clearing are both logged, since the alert itself is overwritten');
    else fail('an alert can be set and cleared with no record that anybody was warned');
    if (/savePdf_|recomputeTotals_/.test(fn)) fail('setting an alert re-prices or rebuilds the PDF');
    else ok('setting an alert touches no money and no paperwork');
  }
  if (/if \(oldD\.yardAlert\)/.test(g)) ok('an alert survives a customer save');
  else fail('a customer save would take a live warning down with nobody deciding to');
}

/* =====================================================================
   2d. EVERY GENERATED HANDLER MUST ACTUALLY PARSE.
   ---------------------------------------------------------------------
   The row taps and every action button in this app shipped DEAD, and no test
   caught it, because the markup looked right to a regex. JSON.stringify emits
   double quotes; dropped into onclick="..." the first one ends the attribute
   and the browser is left with `openQuote(` — a syntax error that throws
   nothing, logs nothing, and just does not fire.

   So: pull every on*= handler out of the real generated markup and run it
   through the JS parser. A handler that will not parse is a control that does
   nothing when somebody taps it, in the yard, with no error to go on.
   ===================================================================== */
{
  const rows = [
    { qn: 'QW-26-1255', name: "O'Brien, Pat", unit: 'Boat', slip: 'B-14', alert: 'no keys',
      auth: { state: 'cleared' } },
    { qn: 'QW-26-0002', name: 'Baker, Bo', unit: 'Boat', slip: 'A-3',
      auth: { state: 'hold', why: 'signature', stamp: 'NO SIGNED CONTRACT — DO NOT PULL' } }
  ];
  let markup = '';
  rows.forEach(function (r) {
    markup += Y.row_(r, 'Slip ' + r.slip, Y.act_(r, 'pulled', 'Pulled'));
    markup += Y.row_(r, '', Y.act_(r, 'stored', 'Stored'));
  });
  /* Attribute values are double-quoted, so the value is everything up to the
     next double quote — which is precisely why a raw quote inside it breaks. */
  const handlers = markup.match(/\son[a-z]+="[^"]*"/g) || [];
  if (handlers.length < 4) fail('expected several generated handlers to check, found ' + handlers.length);
  let broken = 0;
  handlers.forEach(function (h) {
    const body = h.slice(h.indexOf('"') + 1, -1)
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    try { new Function('event', body); }
    catch (e) { broken++; fail('a generated handler is not valid JavaScript — it will do nothing ' +
      'when tapped: ' + h.trim().slice(0, 90) + '  (' + e.message + ')'); }
  });
  if (!broken) ok('every generated on*= handler parses as JavaScript (' + handlers.length + ' checked)');
  /* The specific shape of the original bug, named so the message is useful. */
  if (/on[a-z]+="[^"]*"[A-Za-z0-9_-]/.test(markup))
    fail('an attribute value is terminated early by a raw double quote — use jsArg_()');
  else ok('no handler is cut short by an unescaped quote');
  /* And the helper has to exist and do the escaping, or the next person will
     reach for JSON.stringify again. */
  if (/JSON\.stringify/.test(Y.ev('String(row_)') + Y.ev('String(act_)')))
    fail('row_/act_ use JSON.stringify directly in markup — that is the bug');
  else ok('the row builders go through the escaping helper, not JSON.stringify');
}

/* The alert is READ ONLY in the yard. Setting it lives on the console, so
   the loud thing stays under one pair of eyes instead of being rewritten by
   whoever is standing nearest the boat. */
{
  if (/function saveAlert|api\('yardAlert'/.test(SRC))
    fail('the yard app can still write an alert — alerts are set on the console only');
  else ok('the yard app only displays alerts, it cannot set them');
  if (/id="alertText"/.test(HTML))
    fail('the yard app still carries an alert editor, which shows an empty box on every unit');
  else ok('there is no alert editor in the yard app');
  /* And nothing renders at all when there is no alert to show. */
  if (Y.alert_({ alert: '' }) !== '') fail('an empty alert still renders a strip');
  else if (Y.alert_({ alert: '   ' }) !== '') fail('a whitespace-only alert still renders a strip');
  else if (Y.alert_({}) !== '') fail('a unit with no alert field renders a strip');
  else ok('nothing renders unless an alert has actually been entered');
  if (Y.alert_({ alert: 'no keys' }).indexOf('no keys') > -1) ok('and a real alert does render');
  else fail('a real alert does not render');
}

/* =====================================================================
   3. TALKING TO A BACKEND OVER A BAD CONNECTION.
   ===================================================================== */
/* The app's retry list must be a SUBSET of what the server allows on GET —
   the server refuses a GET naming a write, so a wrong entry here is a retry
   that can only ever fail, in the yard, with nobody to explain it. */
{
  const block = (GAS.match(/const CONSOLE_GET_FNS_ = \{[\s\S]*?\n\};/) || [''])[0];
  if (!block) fail('could not find CONSOLE_GET_FNS_ in the .gs — the subset check cannot run');
  /* Comments in that block name functions in prose, and several entries share
     a line, so strip the comments and scan the whole block rather than
     line-starts. An under-read here would make this check pass by comparing
     against almost nothing. */
  const allowed = {};
  block.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([A-Za-z][A-Za-z0-9_]*)\s*:\s*1/g, (m, n) => { allowed[n] = 1; return m; });
  if (Object.keys(allowed).length < 5)
    fail('only read ' + Object.keys(allowed).length + ' entries out of CONSOLE_GET_FNS_ — ' +
         'the subset check would pass against almost nothing');
  else ok('read ' + Object.keys(allowed).length + ' functions the server answers on GET');
  const GETOK = Y.ev('API_GET_OK') || {};
  const mine = Object.keys(GETOK);
  if (!mine.length) fail('the yard app has no GET allow-list at all');
  const rogue = mine.filter((f) => !allowed[f]);
  if (rogue.length) fail('the yard app would retry over GET: ' + rogue.join(', ') +
    ' — the server refuses those on GET, so the retry can only fail');
  else ok('every function the app retries over GET is one the server answers there (' + mine.length + ')');
  /* And the writes must NOT be on it. */
  ['yardNote', 'uploadPhoto', 'keysApply'].forEach((w) => {
    if (GETOK[w]) fail(w + ' is on the app\'s GET list — a link that changes something can be followed twice');
  });
  ok('the app never tries to send a write as a GET');
}
/* The lost-POST fingerprint is matched on wording, which is fragile, so pin it
   against the string doGet actually returns. */
{
  const real = (GAS.match(/Enter both your quote number and last name\.?/) || [''])[0];
  if (!real) fail('could not find the customer loader\'s message in the .gs to pin against');
  else if (Y.lost_({ ok: 0, error: real })) ok('the app recognises the customer loader answering a staff call');
  else fail('the lost-POST detector no longer matches the customer loader\'s real wording: ' + real);
  if (Y.lost_({ _api: 'console', ok: 0, error: real }))
    fail('a properly stamped console reply was mistaken for a lost call');
  else ok('a stamped console reply is never mistaken for a lost one');
  if (Y.lost_({ ok: 0, error: 'Quote not found.' }))
    fail('an ordinary server error was mistaken for a lost call');
  else ok('an ordinary error is not mistaken for a lost call');
}

/* =====================================================================
   4. THE PHONE ITSELF.
   ===================================================================== */
/* Condition media is stills AND video. The format needed no new plumbing —
   Drive takes any blob — but the size does: a clip arrives as base64, a third
   bigger again, and an oversized POST is dropped by Apps Script with no
   explanation at all. On a phone that is a spinner and then a failure nobody
   can act on, so the cap is enforced on BOTH clients and on the server. */
{
  const adminHtml = read('admin/index.html');
  /* By id, not by "any input that takes an image". The signed-contract upload
     also accepts image/* — somebody photographing a signed page — and it is
     NOT condition media: a video of a contract is not a thing. */
  const MEDIA_INPUTS = { 'yard/index.html': ['camIn', 'galIn'],
                         'admin/index.html': ['photoFiles', 'cameraInput'] };
  [['yard/index.html', HTML], ['admin/index.html', adminHtml]].forEach(function (p) {
    MEDIA_INPUTS[p[0]].forEach(function (id) {
      const m = p[1].match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
      if (!m) return fail(p[0] + ' has no file input called ' + id);
      if (!/accept="[^"]*video\//.test(m[0]))
        fail(p[0] + ' #' + id + ' will not take video: ' + m[0].slice(0, 90));
      else ok(p[0] + ' #' + id + ' accepts video as well as stills');
    });
  });
  /* And the contract input must NOT have quietly been widened along with them. */
  if (/id="contractFile"[^>]*video\//.test(adminHtml))
    fail('the signed-contract input now accepts video — that is not condition media');
  else ok('the signed-contract input was left alone');
  /* Client-side, so nothing is spent reading a file that cannot be sent. */
  if (/MAX_UPLOAD_MB/.test(SRC)) ok('the yard app refuses an oversized file before reading it');
  else fail('the yard app will read and base64 a file the server is going to refuse');
  if (/MAX_UPLOAD_MB/.test(adminHtml)) ok('the console does too');
  else fail('the console has no size check');
  /* And server-side, because a client is not a permission. */
  if (/MAX_UPLOAD_BYTES_/.test(GAS)) ok('and the server enforces it independently');
  else fail('the server accepts an upload of any size');
  /* The console used to drop anything not an image on the floor, silently. */
  if (/startsWith\('video\/'\)/.test(adminHtml)) ok('the console no longer discards video before uploading it');
  else fail('the console filters uploads to image/* — video would vanish with no message');
  /* THE SKIP HAS TO SURVIVE THE SUMMARY. The first version warned about the
     oversized clip and then overwrote that warning with "2 uploaded" a few
     seconds later — so the crew walked away believing a video was saved that
     never left the phone. Silent partial success is the worst outcome here. */
  if (/bigTxt\?' '\+bigTxt/.test(SRC) || /\+\s*\(bigTxt/.test(SRC))
    ok('a skipped oversized file is still named in the final message');
  else fail('the oversized-file warning is overwritten by the upload summary — the crew would ' +
            'believe a clip saved when it never left the phone');
  /* Three large POSTs racing each other on a phone connection is not a plan. */
  if (/CONCURRENCY=files\.some/.test(adminHtml)) ok('the console uploads video one at a time');
  else fail('the console uploads video with the same concurrency as stills');
}
{
  const caps = (HTML.match(/capture=/g) || []).length;
  if (caps !== 1) fail('`capture` appears ' + caps + ' times — on Android it forces the camera and ' +
    'kills the gallery, so it belongs on the camera button ONLY');
  else ok('capture is on the camera input only, so the gallery still works on Android');
  if (/<input[^>]*id="galIn"[^>]*capture/.test(HTML)) fail('the gallery input carries capture');
  else ok('the gallery input is free of capture');
}
{
  /* Add to Home Screen is the point of the page being separate. */
  const man = JSON.parse(read('yard/manifest.json'));
  eq(man.display, 'standalone', 'the manifest asks for a standalone window');
  if (String(man.start_url || '').startsWith('/')) {
    fail('manifest start_url is absolute — this deploys under /winter-quotes_26-27/yard/ on Pages, ' +
         'so an absolute path installs an app that opens the wrong site');
  } else ok('manifest start_url is relative, so it survives the Pages subpath');
  if (!/<link rel="manifest"/.test(HTML)) fail('the page does not link its manifest');
  else ok('the page links its manifest');
  (man.icons || []).forEach((i) => {
    const p = path.join(ROOT, 'yard', i.src);
    if (!fs.existsSync(p)) fail('manifest icon ' + i.src + ' does not resolve from /yard/');
  });
  ok('every manifest icon resolves from /yard/');
}
{
  /* Same deployment as everything else, or the app talks to an orphan. */
  const mine = (HTML.match(/AKfycb[A-Za-z0-9_-]*/) || [''])[0];
  const theirs = (GAS.match(/AKfycb[A-Za-z0-9_-]*/) || [''])[0];
  if (mine && theirs && mine === theirs) ok('the app points at the same /exec deployment as the backend');
  else fail('the yard app\'s API URL does not match the backend\'s: ' + mine + ' vs ' + theirs);
}

/* =====================================================================
   5. VOICE NOTES — the recording is the record.
   ---------------------------------------------------------------------
   The method is the service tracker's (QuestWS/servicetracker): record with
   MediaRecorder, upload the audio with the note, transcribe server-side, fill
   the words in when the webhook returns. The properties that matter are the
   ones that only show up when something goes wrong.
   ===================================================================== */
{
  /* On-device speech recognition was the obvious guess and is the wrong
     method — it keeps nothing, so there is no evidence afterwards. */
  if (/webkitSpeechRecognition|SpeechRecognition/.test(SRC))
    fail('the yard app still uses browser speech recognition — the service tracker records ' +
         'audio and transcribes server-side, and a recording is evidence where a live ' +
         'transcript is not');
  else ok('voice notes are recorded, not live-transcribed on the device');
  if (/MediaRecorder/.test(SRC)) ok('the app records with MediaRecorder, as the service tracker does');
  else fail('the app does not record audio at all');
  /* Safari will not take audio/webm. A single hardcoded mime is how iOS gets
     a recorder button that does nothing. */
  if (/audio\/mp4/.test(SRC)) ok('it negotiates a mime type that includes an iOS-friendly one');
  else fail('no audio/mp4 in the mime list — the recorder would fail on iPhones');
}
{
  const g = GAS;
  /* Slow work must never run inside the request the yard is waiting on. */
  const save = (g.match(/function adminAddYardNote\b[\s\S]*?\n}/m) || [''])[0];
  if (/UrlFetchApp/.test(save))
    fail('adminAddYardNote talks to AssemblyAI inline — that is a Drive read and two uploads ' +
         'with somebody standing in the yard waiting for the button');
  else ok('the save path does not transcribe inline; it queues');
  if (/queueTranscript_\(/.test(save)) ok('it queues the recording for the trigger to pick up');
  else fail('nothing queues the recording — it would never be typed up');
  /* The note must survive the audio failing, and vice versa. */
  if (/tstatus = 'failed'/.test(save)) ok('a recording that cannot be filed still saves the note');
  else fail('a Drive failure on the audio would lose the note that came with it');

  /* The webhook is a public door on the same /exec that takes payments. */
  const hook = (g.match(/function transcriptWebhook_\b[\s\S]*?\n}/m) || [''])[0];
  if (!hook) fail('there is no transcriptWebhook_');
  else if (/transcriptHookKey_\(\)/.test(hook) && /return \{ ok: 0 \}/.test(hook))
    ok('the webhook checks its shared secret and says nothing useful without it');
  else fail('the transcript webhook does not check a shared secret — anyone who guessed a ' +
            'transcript id could write onto a quote');
  /* And it must be decided before the customer quote-loader can answer it. */
  /* Slice to the next top-level function, not the first `\n}` — doGet contains
     nested closures and a lazy match stops inside one. Then strip comments:
     this is a question about the order of the CODE, and the prose around both
     branches quotes the customer loader's message. */
  const gi = g.indexOf('function doGet');
  const gj = g.indexOf('\nfunction ', gi + 10);
  const get = g.slice(gi, gj === -1 ? undefined : gj).replace(/\/\*[\s\S]*?\*\//g, '');
  const iHook = get.indexOf("p.hook || '') === 'transcript'");
  const iQuote = get.indexOf('quote number and last name');
  if (iHook > -1 && (iQuote === -1 || iHook < iQuote))
    ok('doGet answers the webhook before anything can fall through to the customer loader');
  else fail('the transcript webhook is reachable only after the customer quote-loader — ' +
            'AssemblyAI would be told to enter a quote number and last name');

  /* Nothing may be left sitting on "transcribing..." for ever. */
  if (/function sweepTranscripts\b/.test(g)) ok('a sweep exists for webhooks that never arrive');
  else fail('no sweep — a dropped webhook would leave a note pending for ever');
  if (/sweepTranscripts:\s*\{/.test(g)) ok('and it is on the trigger list');
  else fail('sweepTranscripts is never scheduled');
  if (/function sweepTranscripts_\b/.test(g))
    fail('the sweep is named with a trailing underscore — Apps Script treats that as private ' +
         'and it is not dependable as a trigger handler');
  else ok('the sweep has a public name, so it can actually be a trigger handler');
  /* Without a key the feature degrades; it must not break. */
  const submit = (g.match(/function submitTranscript_\b[\s\S]*?\n}/m) || [''])[0];
  if (/if \(!key\)/.test(submit)) ok('no API key means the audio is kept and the note says so');
  else fail('submitTranscript_ does not handle a missing ASSEMBLYAI_API_KEY');
  /* The lesson the storage view already taught. */
  const apply = (g.match(/function applyTranscript_\b[\s\S]*?\n}/m) || [''])[0];
  if (/getSheets\(\)|forEach\(function \(sh\)/.test(apply))
    fail('applyTranscript_ walks the spreadsheet to find its note — that is what made the ' +
         'storage view time out; the transcript id maps straight to a quote');
  else ok('a returning transcript goes straight to its note without scanning the sheet');
}

if (bad) { console.error('FAIL: ' + bad + ' problem(s) with the yard app'); process.exit(1); }
console.log('yard app: renders the server\'s verdict rather than forming one, lists slip boats for ' +
            'pulling and everything for placing, and degrades safely on a bad connection');
