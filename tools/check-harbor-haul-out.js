#!/usr/bin/env node
/* Harbor Haul Out: what it must never decide for itself, and what must survive
   a phone with two bars.
   ---------------------------------------------------------------------------
   harbor-haul-out/index.html is the third surface to ask "may we pull this
   boat?" — after the staff console and the printed haul-out sheet. The answer
   is the SERVER's (haulAuth_ in the .gs) and is shipped on every storage row.
   This guard exists because the cheap thing to do, the next time somebody
   adds a field, is to work the rule out locally from `deposit` and `contract`;
   two of the three copies would then be free to go stale, and the one that
   goes stale is the one that clears a boat nobody signed for.

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
const HTML = read('harbor-haul-out/index.html');
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
  vm.runInContext(SRC, ctx, { filename: 'harbor-haul-out/index.html' });
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
    fail('an unstamped row reads as CLEARED in Harbor Haul Out — a backend that has not deployed ' +
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
    fail('Harbor Haul Out looks like it is working the pull rule out from contract/deposit');
  } else ok('Harbor Haul Out carries no rule of its own — it renders what the server stamped');
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
    eq(Y.listOf_({ placementState: c[0], slip: c[1] }), c[2], c[3]);
  });
  /* The property underneath all of it, asserted rather than reasoned about. */
  const lists = ['pull', 'store', 'stored'];
  let clean = true;
  ['', 'pulled', 'dropped', 'stored'].forEach(function (st) {
    ['', 'B-14'].forEach(function (slip) {
      const row = { placementState: st, slip: slip };
      const on = lists.filter(function (L) { return Y.listOf_(row) === L; });
      if (on.length > 1) { clean = false; fail('state ' + JSON.stringify(st) + ' appears on ' + on.join(' and ')); }
    });
  });
  if (clean) ok('no unit is ever on two lists at once');
  /* An unknown state must not vanish a boat. */
  const odd = Y.listOf_({ placementState: 'teleported', slip: 'B-14' });
  if (odd === '') fail('an unrecognised state made a boat disappear from every list');
  else ok('an unrecognised state falls back to a real list rather than vanishing (' + odd + ')');
}
/* Search and sort, on the two lists that have them. */
{
  Y.ev('ROWS = ' + JSON.stringify([
    { qn: 'QW-1', name: 'Zeller, Zoe', slip: '', tab: 'Building B', unit: 'Boat', placementState: 'pulled' },
    { qn: 'QW-2', name: 'Adams, Al',   slip: '', tab: 'Outside',    unit: 'Boat', placementState: 'dropped' },
    { qn: 'QW-3', name: 'Moss, Mo',    slip: '', tab: 'Building B', unit: 'Jet Ski', placementState: 'pulled' },
    { qn: 'QW-4', name: 'Quinn, Qi',   slip: '', tab: 'Building B', unit: 'Boat', placementState: 'stored' }
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
/* WHERE the pull is recorded, and the gate that follows it there.
   ---------------------------------------------------------------------
   Chris moved this deliberately: the pull list has no one-tap tick any more,
   because pulling is the act the whole liability rule exists for and it should
   be made with the unit OPEN — its alert, its authorisation banner and its
   notes all on the screen at the time. Putting an already-pulled boat into a
   building carries none of that, so "Stored ✓" stays on the row.

   Asserted from the rendered markup rather than from act_, because a row
   action is a two-line thing to reinstate by hand and the helper would still
   be sitting there ready. */
{
  Y.ev('ME = {name:"Rex",admin:true,perms:{keys:1}}');
  Y.ev('ROWS = ' + JSON.stringify([
    { qn: 'H', name: 'Held',  slip: 'B-1', tab: 'Building A', unit: 'Boat',
      auth: { state: 'hold', why: 'signature', label: 'NO CONTRACT',
              stamp: 'NO SIGNED CONTRACT — DO NOT PULL' } },
    { qn: 'C', name: 'Clear', slip: 'B-2', tab: 'Building A', unit: 'Boat',
      auth: { state: 'cleared' } },
    { qn: 'S', name: 'Stow',  slip: '',    tab: 'Building A', unit: 'Boat',
      placementState: 'pulled', auth: { state: 'cleared' } }
  ]));
  Y.ev('TAB = "pull"; render()');
  const pullMarkup = Y.ev('document.getElementById("list").innerHTML');
  if (/markState\(/.test(pullMarkup))
    fail('the pull list still records a pull from the row — it has to be a button on the ' +
         'opened unit, so the alert and the authorisation banner are on screen when ' +
         'somebody decides to touch a boat');
  else ok('the pull list records nothing from the row');
  if (/openQuote\(/.test(pullMarkup)) ok('the pull row opens the unit instead');
  else fail('the pull rows do not open anything — the list is now inert');

  /* The store list keeps its tick, and it still must not fire the row tap. */
  Y.ev('TAB = "store"; render()');
  const storeMarkup = Y.ev('document.getElementById("list").innerHTML');
  if (/markState\([^)]*stored/.test(storeMarkup)) ok('putting a boat away is still one tap');
  else fail('the To store list lost its one-tap tick — that is a row-at-a-time job');
  if (/stopPropagation/.test(storeMarkup)) ok('and ticking it does not also open the sheet');
  else fail('the row action will also fire the row tap — the list jumps out from under the crew');

  /* The opened unit: the gate, and the transitions it offers. */
  const stateOf = (qn, st) => {
    Y.ev('CUR = {quoteNo:' + JSON.stringify(qn) + ', placement:{state:' + JSON.stringify(st || '') + '}}');
    Y.ev('renderState()');
    return Y.ev('document.getElementById("dState").innerHTML');
  };
  const held = stateOf('H');
  if (/markState\([^)]*pulled/.test(held))
    fail('the opened unit offers Mark pulled on a boat nobody may touch — the app would be ' +
         'where the rule violation gets written down');
  else ok('an opened unit that is not cleared offers no Mark pulled');
  if (/disabled/.test(held) && /DO NOT PULL/.test(held))
    ok('it shows the server\'s stamp in place of the button, so the crew knows why');
  else fail('the blocked unit does not say why it cannot be pulled: ' + held);
  const clear = stateOf('C');
  if (/markState\([^)]*pulled/.test(clear)) ok('a cleared unit can be marked pulled once opened');
  else fail('a cleared unit cannot be marked pulled from anywhere in the app');

  /* "Mark dropped off" is a console act. It records that a customer drove in,
     which is something the counter hears — the yard never sees it happen. */
  ['', 'pulled', 'stored'].forEach(function (st) {
    if (/markState\([^)]*dropped/.test(stateOf('C', st)))
      fail('Harbor Haul Out still offers "Mark dropped off" (state ' + JSON.stringify(st) + ') — ' +
           'Chris asked for that to be console-only');
  });
  ok('Harbor Haul Out never offers "Mark dropped off", in any state');
  /* But the app must still READ it, because the console sets it. */
  eq(Y.ev('listOf_({placementState:"dropped",slip:"B-9"})'), 'store',
     'a unit the console dropped off still reaches the To store list');
  eq(Y.ev('STATE_LABEL.dropped'), 'Dropped off',
     'and the app can still name that state when it opens one');
}
/* And the server refuses it too, because a client is not a permission. */
{
  const gas = GAS;
  const fn = (gas.match(/function adminSetPlacementState\b[\s\S]*?\n}/m) || [''])[0];
  if (!fn) fail('there is no adminSetPlacementState on the server');
  else {
    if (/haulAuth_\(/.test(fn) && /'pulled'/.test(fn))
      ok('the server re-checks the pull gate rather than trusting the app');
    else fail('adminSetPlacementState does not gate "pulled" on haulAuth_ — a crafted request could ' +
              'record a pull nobody was cleared for');
    if (/requireAuth_\(token, 'keys'\)/.test(fn)) ok('and it is gated on the yard permission');
    else fail('adminSetPlacementState is not gated on the keys permission');
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
  if (/btn\('pulled'/.test(adminHtml)) ok('the console can record a pull, not just Harbor Haul Out');
  else fail('the console cannot mark a unit pulled — when somebody\'s phone glitches in the ' +
            'yard, the person they tell has to be able to record it');
  /* And it is the ONLY surface that can, since the app gave it up. */
  if (/btn\('dropped'/.test(adminHtml)) ok('the console can mark a unit dropped off');
  else fail('nothing can mark a unit dropped off any more — the app gave that up on the ' +
            'understanding the console kept it, and the To store list depends on it');
  /* But the gate does not relax for it. */
  if (/_pullAuth[\s\S]{0,400}?state==='cleared'/.test(adminHtml))
    ok('and the console gates that button on the same cleared/not-cleared answer');
  else fail('the console offers "Mark pulled" without checking whether the unit is cleared');
  /* Which means the server has to send it that answer. */
  if (/pullAuth: haulAuth_\(/.test(gas)) ok('adminLookup ships the pull verdict to the console');
  else fail('adminLookup does not return pullAuth, so the console is gating on undefined — ' +
            'it would either always block or always allow');

  /* It has to survive the customer's next save like the rest of the placement state. */
  const carry = (gas.match(/if \(oldD\.placement\)/) || [''])[0];
  if (carry) ok('placement progress survives a customer save');
  else fail('a customer save would wipe the season\'s placement progress');
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
  const fn = (g.match(/function adminSetPlacementAlert\b[\s\S]*?\n}/m) || [''])[0];
  if (!fn) fail('there is no adminSetPlacementAlert on the server');
  else {
    if (/PLACEMENT_ALERT_MAX_/.test(fn)) ok('the alert is length-capped so it stays readable at a glance');
    else fail('nothing caps the alert length — a paragraph on every row is not an alert');
    if (/delete d\.placementAlert/.test(fn)) ok('an empty alert clears it rather than storing a blank');
    else fail('clearing an alert does not remove it');
    if (/auditLog_/.test(fn)) ok('setting and clearing are both logged, since the alert itself is overwritten');
    else fail('an alert can be set and cleared with no record that anybody was warned');
    if (/savePdf_|recomputeTotals_/.test(fn)) fail('setting an alert re-prices or rebuilds the PDF');
    else ok('setting an alert touches no money and no paperwork');
  }
  if (/if \(oldD\.placementAlert\)/.test(g)) ok('an alert survives a customer save');
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

/* The alert is READ ONLY in Harbor Haul Out. Setting it lives on the console,
   so the loud thing stays under one pair of eyes instead of being rewritten by
   whoever is standing nearest the boat. */
{
  if (/function saveAlert|api\('placementAlert'/.test(SRC))
    fail('Harbor Haul Out can still write an alert — alerts are set on the console only');
  else ok('Harbor Haul Out only displays alerts, it cannot set them');
  if (/id="alertText"/.test(HTML))
    fail('Harbor Haul Out still carries an alert editor, which shows an empty box on every unit');
  else ok('there is no alert editor in Harbor Haul Out');
  /* And nothing renders at all when there is no alert to show. */
  if (Y.alert_({ alert: '' }) !== '') fail('an empty alert still renders a strip');
  else if (Y.alert_({ alert: '   ' }) !== '') fail('a whitespace-only alert still renders a strip');
  else if (Y.alert_({}) !== '') fail('a unit with no alert field renders a strip');
  else ok('nothing renders unless an alert has actually been entered');
  if (Y.alert_({ alert: 'no keys' }).indexOf('no keys') > -1) ok('and a real alert does render');
  else fail('a real alert does not render');
}


/* =====================================================================
   2e. RE-MEASURING FROM THE YARD.
   ---------------------------------------------------------------------
   The tape measure is in the yard, so the correction is made in the yard. But
   a re-measure is the one thing the app does that MOVES MONEY: it re-prices
   the quote and can move the boat to a different building. So three rules,
   and all three are the sort that get quietly relaxed later.

     1. It is its own permission, not `keys` and not `adjust`. Writing a note
        must never buy a re-price, and inventing a charge is a different act
        from reading a tape.
     2. Preview and apply are two separate taps. The crew sees what it costs
        before it costs it.
     3. The app sends measurements only. Motors and storage-location overrides
        are specification changes made at a desk, and they stay on the console.
   ===================================================================== */
{
  /* --- 1. the permission --- */
  const measureFns = ['adminDimsPreview', 'adminDimsApply'];
  measureFns.forEach(function (name) {
    const fn = (GAS.match(new RegExp('function ' + name + '\\b[\\s\\S]*?\\n}', 'm')) || [''])[0];
    if (!fn) { fail('there is no ' + name + ' on the server'); return; }
    if (/requireAuth_\(token, 'measure'\)/.test(fn)) ok(name + ' is gated on the measure permission');
    else if (/requireAuth_\(token, 'keys'\)/.test(fn))
      fail(name + ' is gated on `keys` — writing a placement note would then buy the ability to ' +
           're-price a quote, which is not what anybody granted');
    else fail(name + ' is not gated on the measure permission: ' +
              (fn.match(/requireAuth_\([^)]*\)/) || ['(no requireAuth_ at all)'])[0]);
  });
  const gate = (GAS.match(/function canMeasure_\b[\s\S]*?\n}/m) || [''])[0];
  if (!gate) fail('there is no canMeasure_ on the server');
  else {
    if (/canKeys_\(st\)|p\.adjust/.test(gate))
      ok('an unset `measure` falls back rather than reading as a flat no');
    else fail('canMeasure_ has no fallback — every roster entry written before this permission ' +
              'existed would read as undefined, and the answer to that must not be "sure"');
  }
  if (/p\.measure = canMeasure_\(st\)/.test(GAS))
    ok('and the resolved permission set ships it, so no client re-implements the fallback');
  else fail('resolvedPerms_ does not resolve `measure` — the app and the server would disagree ' +
            'about who can re-measure');

  /* The app's copy of that fallback has to agree with the server's, because ME
     is cached in localStorage: a session opened before the deploy carries a
     perms object with no `measure` key in it. */
  Y.ev('ME = {name:"Rex",admin:false,perms:{keys:1,photos:1}}');
  if (Y.ev('canMeasure()') === true) ok('the yard crew can re-measure, which is the point of the card');
  else fail('the app hides the card from the people holding the tape — the server now allows ' +
            'them, so this is the two copies disagreeing');
  Y.ev('ME = {name:"Marina",admin:false,perms:{photos:1}}');
  if (Y.ev('canMeasure()') === false) ok('photos alone still buys nothing');
  else fail('a photos-only account can re-price a quote in the app');
  Y.ev('ME = {name:"Jess",admin:false,perms:{photos:1,measure:1}}');
  if (Y.ev('canMeasure()') === true) ok('and the permission grants it on its own');
  else fail('granting `measure` does nothing in the app');
  Y.ev('ME = {name:"Rex",admin:false,perms:{keys:1,measure:0}}');
  if (Y.ev('canMeasure()') === false) ok('an explicit no beats the fallback');
  else fail('turning `measure` off does not turn it off');
  /* The fallback must BE canKeys_, not a second opinion about it. */
  [['{keys:1}', true], ['{pay:1}', true], ['{adjust:1}', true], ['{photos:1}', false], ['{}', false]]
    .forEach(function (c) {
      Y.ev('ME = {name:"x",admin:false,perms:' + c[0] + '}');
      const m = Y.ev('canMeasure()'), w = Y.ev('canWrite()');
      if (m !== w) fail('canMeasure() and canWrite() disagree for perms ' + c[0] +
                        ' — the fallback has drifted from the yard-facts bar it is supposed to be');
      else if (m !== c[1]) fail('perms ' + c[0] + ' resolved to ' + m + ', expected ' + c[1]);
    });
  ok('the fallback is the yard-facts bar itself, not a second copy of it');

  /* --- 2. preview then apply, never one tap --- */
  const src = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  const prev = (src.match(/async function previewDims\b[\s\S]*?\n}/m) || [''])[0];
  const appl = (src.match(/async function applyDims\b[\s\S]*?\n}/m) || [''])[0];
  if (!prev || !appl) fail('previewDims/applyDims are not both in Harbor Haul Out');
  else {
    if (/dimsApply/.test(prev))
      fail('previewDims applies the change — the point of a preview is that it writes nothing');
    else ok('previewDims writes nothing; it only prices');
    if (/PENDING/.test(appl) && /if\s*\(\s*!CUR\s*\|\|\s*!PENDING\s*\)/.test(appl))
      ok('applyDims refuses to run without a preview behind it');
    else fail('applyDims can fire without a preview — a mistyped beam would re-price a quote ' +
              'with nobody having seen the number');
  }
  /* The server is the one that must actually enforce it, since the app is not
     a permission. sanitizeMeasured_ is that gate. */
  const apply = (GAS.match(/function adminDimsApply\b[\s\S]*?\n}/m) || [''])[0];
  if (/sanitizeMeasured_/.test(apply)) ok('the server sanitises the measurements it is handed');
  else fail('adminDimsApply takes the app\'s numbers at face value');
  if (/m\.customerState/.test(apply))
    ok('and it snapshots what the customer originally told us before overwriting it');
  else fail('a re-measure would erase the customer\'s own figures, which is the exact thing ' +
            'asked about when a measurement is disputed');

  /* --- 3. measurements only --- */
  const collect = (src.match(/function collectDims\b[\s\S]*?\n}/m) || [''])[0];
  if (!collect) fail('there is no collectDims in Harbor Haul Out');
  else {
    if (/engines/.test(collect))
      fail('Harbor Haul Out sends motor changes — that is a specification change made at a desk');
    else ok('Harbor Haul Out sends no motor changes');
    if (/\bstorage\b/.test(collect))
      fail('Harbor Haul Out sends a storage-location override — where a boat is STORED follows ' +
           'from its size, and overriding it is a console decision');
    else ok('Harbor Haul Out sends no storage override; a move follows from the measurements');
    if (/DIMS\.fields/.test(collect) && /hasTrailer/.test(collect))
      ok('it sends the engine\'s own dimension fields, plus whether it is on its trailer');
    else fail('collectDims does not read the server-supplied field list — a dimension added to ' +
              'DIM_FIELDS would not appear in Harbor Haul Out');
  }
  /* Every key Harbor Haul Out can send has to be one the server will actually
     take. A field in DIM_FIELDS that is not in MEASURABLE_NUM_ renders an
     input in Harbor Haul Out, is dropped silently by sanitizeMeasured_, and
     comes back as "Nothing changed." with no explanation of which box was
     ignored. */
  {
    const eng = read('pricing-engine.js');
    const blk = (eng.match(/const DIM_FIELDS = \{[\s\S]*?\n\};/) || [''])[0];
    const keys = (blk.match(/\['([a-zA-Z]+)',/g) || []).map(function (m) { return m.slice(2, -2); });
    const accepted = (GAS.match(/const MEASURABLE_NUM_ = \[([^\]]*)\]/) || ['', ''])[1]
      .split(',').map(function (t) { return t.replace(/['"\s]/g, ''); }).filter(Boolean);
    if (!keys.length || !accepted.length) fail('could not read DIM_FIELDS / MEASURABLE_NUM_ — the field check cannot run');
    else {
      const orphan = keys.filter(function (k) { return accepted.indexOf(k) < 0; });
      if (orphan.length)
        fail('DIM_FIELDS offers ' + orphan.join(', ') + ' but MEASURABLE_NUM_ does not accept ' +
             'it — Harbor Haul Out would render that box, drop what was typed in it, and answer ' +
             '"Nothing changed."');
      else ok('every dimension Harbor Haul Out can render (' + keys.length + ') is one the server accepts');
    }
  }
  /* It has to render nothing at all for somebody who cannot use it. A dead
     control is something people learn to tap anyway. */
  const rend = (src.match(/function renderDims\b[\s\S]*?\n}/m) || [''])[0];
  if (/if\s*\(\s*!canMeasure\(\)\s*\)/.test(rend)) ok('the card is absent, not disabled, without the permission');
  else fail('renderDims does not check canMeasure() first');

  /* And the payment lock must not have followed it here: staff have to be able
     to re-measure a boat AFTER a deposit — that is when it gets measured. */
  if (/lockedMsg_|isLocked_|payments\.length/.test(apply))
    fail('the payment lock has spread to adminDimsApply — a boat is measured at drop-off, ' +
         'which is after the deposit by definition');
  else ok('a deposit does not stop a re-measure');
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
  if (!mine.length) fail('Harbor Haul Out has no GET allow-list at all');
  const rogue = mine.filter((f) => !allowed[f]);
  if (rogue.length) fail('Harbor Haul Out would retry over GET: ' + rogue.join(', ') +
    ' — the server refuses those on GET, so the retry can only fail');
  else ok('every function the app retries over GET is one the server answers there (' + mine.length + ')');
  /* And the writes must NOT be on it. */
  ['placementNote', 'uploadPhoto', 'keysApply'].forEach((w) => {
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
/* CAMERA INPUTS — one per kind, and the rules that were learned the hard way.
     `capture` tells the phone to open the camera but CANNOT say which mode; an
     accept list naming both image/* and video/* is ambiguous, and the browser
     resolves it by ignoring capture and showing the gallery picker instead.
     That is exactly what a single combined input did. And `multiple` alongside
     `capture` is its own version of the same bug: the spec says capture implies
     one file, and Chrome on Android drops capture when multiple is present. */
  const PAGES = [['harbor-haul-out/index.html', HTML], ['admin/index.html', adminHtml]];
  /* Which input plays which role, by id — the signed-contract upload also takes
     image/*, and it is not condition media. */
  const ROLES = {
    'harbor-haul-out/index.html':  { photo: 'camIn',       video: 'vidIn',      gallery: 'galIn' },
    'admin/index.html': { photo: 'cameraInput', video: 'videoInput', gallery: 'photoFiles' }
  };
  const inputById = (html, id) => (html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>')) || [])[0];
  PAGES.forEach(function (p) {
    const r = ROLES[p[0]];
    const photo = inputById(p[1], r.photo), video = inputById(p[1], r.video),
          gal = inputById(p[1], r.gallery);
    if (!photo || !video || !gal) return fail(p[0] + ' is missing one of the media inputs');
    /* Each camera input names exactly ONE kind, or capture is ambiguous. */
    if (/accept="image\/\*"/.test(photo) && !/video\//.test(photo))
      ok(p[0] + ': the stills camera names image/* only, so capture is unambiguous');
    else fail(p[0] + ' #' + r.photo + ' has an ambiguous accept — capture will open the gallery: ' + photo);
    if (/accept="video\/\*"/.test(video) && !/image\//.test(video))
      ok(p[0] + ': the video camera names video/* only');
    else fail(p[0] + ' #' + r.video + ' has an ambiguous accept: ' + video);
    /* Both camera inputs must actually ask for the camera. */
    [[r.photo, photo], [r.video, video]].forEach(function (c) {
      if (!/capture=/.test(c[1])) fail(p[0] + ' #' + c[0] + ' does not carry capture, so it opens the picker');
      if (/multiple/.test(c[1])) fail(p[0] + ' #' + c[0] + ' has multiple alongside capture — Android drops capture');
    });
    ok(p[0] + ': both camera inputs request the camera, neither carries multiple');
    /* The gallery is the one that must NEVER carry capture. */
    if (/capture=/.test(gal)) fail(p[0] + ' #' + r.gallery + ' carries capture — Android loses the gallery');
    else ok(p[0] + ': the gallery input is free of capture');
    /* And between them the crew can still get video in. */
    if (/video\//.test(gal)) ok(p[0] + ': the gallery takes video as well as stills');
    else fail(p[0] + ' #' + r.gallery + ' will not take video');
  });
  /* And the contract input must NOT have quietly been widened along with them. */
  if (/id="contractFile"[^>]*video\//.test(adminHtml))
    fail('the signed-contract input now accepts video — that is not condition media');
  else ok('the signed-contract input was left alone');
  /* Client-side, so nothing is spent reading a file that cannot be sent. */
  if (/MAX_UPLOAD_MB/.test(SRC)) ok('Harbor Haul Out refuses an oversized file before reading it');
  else fail('Harbor Haul Out will read and base64 a file the server is going to refuse');
  if (/MAX_UPLOAD_MB/.test(adminHtml)) ok('the console does too');
  else fail('the console has no size check');
  /* And server-side, because a client is not a permission. */
  if (/MAX_UPLOAD_BYTES_/.test(GAS)) ok('and the server enforces it independently');
  else fail('the server accepts an upload of any size');
  /* The console used to drop anything not an image on the floor, silently. */
  if (/startsWith\('video\/'\)/.test(adminHtml)) ok('the console no longer discards video before uploading it');
  else fail('the console filters uploads to image/* — video would vanish with no message');
  /* The skip surviving the summary is asserted by RUNNING an upload — see
     uploadChecks() at the foot of this file. An earlier version of this check
     pinned a variable name, which went stale the moment the uploader was
     rewritten while the property it cared about still held. */
  /* THE SESSION URI IS A CAPABILITY. The OAuth token is not, and must never
     leave the script — handing it to a browser would be handing over the whole
     Drive, not one file in one folder. */
  const sess = (GAS.match(/function adminUploadSession\b[\s\S]*?\n}/m) || [''])[0];
  if (!sess) fail('there is no adminUploadSession on the server');
  else {
    if (/return[^;]*getOAuthToken/.test(sess))
      fail('adminUploadSession returns the OAuth token to the browser — that is the whole Drive');
    else ok('the OAuth token never leaves the server; only the session URI does');
    if (/requireAuth_\(token, 'photos'\)/.test(sess)) ok('minting a session needs the photos permission');
    else fail('adminUploadSession is not permission-gated');
    if (/parents: \[target\.getId\(\)\]/.test(sess)) ok('the session is pinned to this quote\'s folder');
    else fail('the session does not pin a destination folder — it could write anywhere');
  }
  /* And it is a write, so it must not be reachable by a link. */
  {
    const block = (GAS.match(/const CONSOLE_GET_FNS_ = \{[\s\S]*?\n\};/) || [''])[0]
      .replace(/\/\*[\s\S]*?\*\//g, '');
    if (/uploadSession/.test(block))
      fail('uploadSession is GET-able — a link that mints an upload slot can be followed twice');
    else ok('uploadSession is POST-only, like every other write');
  }
  /* Three large POSTs racing each other on a phone connection is not a plan. */
  if (/CONCURRENCY=files\.some/.test(adminHtml)) ok('the console uploads video one at a time');
  else fail('the console uploads video with the same concurrency as stills');
}
{
  /* The page-wide version of the same rule: nothing that takes several files
     may ask for the camera. Counting capture was the old check and it broke the
     moment stills and video needed their own inputs — the rule is what matters,
     not the number. */
  const offenders = (HTML.match(/<input[^>]*>/g) || [])
    .filter((i) => /capture=/.test(i) && /multiple/.test(i));
  if (offenders.length) fail('an input asks for the camera AND accepts multiple files: ' + offenders[0]);
  else ok('no multi-file input asks for the camera');
}
{
  /* Add to Home Screen is the point of the page being separate. */
  const man = JSON.parse(read('harbor-haul-out/manifest.json'));
  eq(man.display, 'standalone', 'the manifest asks for a standalone window');
  if (String(man.start_url || '').startsWith('/')) {
    fail('manifest start_url is absolute — this deploys under /winter-quotes_26-27/harbor-haul-out/ on Pages, ' +
         'so an absolute path installs an app that opens the wrong site');
  } else ok('manifest start_url is relative, so it survives the Pages subpath');
  if (!/<link rel="manifest"/.test(HTML)) fail('the page does not link its manifest');
  else ok('the page links its manifest');
  (man.icons || []).forEach((i) => {
    const p = path.join(ROOT, 'harbor-haul-out', i.src);
    if (!fs.existsSync(p)) fail('manifest icon ' + i.src + ' does not resolve from /harbor-haul-out/');
  });
  ok('every manifest icon resolves from /harbor-haul-out/');
}
{
  /* Same deployment as everything else, or the app talks to an orphan. */
  const mine = (HTML.match(/AKfycb[A-Za-z0-9_-]*/) || [''])[0];
  const theirs = (GAS.match(/AKfycb[A-Za-z0-9_-]*/) || [''])[0];
  if (mine && theirs && mine === theirs) ok('the app points at the same /exec deployment as the backend');
  else fail('Harbor Haul Out\'s API URL does not match the backend\'s: ' + mine + ' vs ' + theirs);
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
    fail('Harbor Haul Out still uses browser speech recognition — the service tracker records ' +
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
  const save = (g.match(/function adminAddPlacementNote\b[\s\S]*?\n}/m) || [''])[0];
  if (/UrlFetchApp/.test(save))
    fail('adminAddPlacementNote talks to AssemblyAI inline — that is a Drive read and two uploads ' +
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

/* ---------------------------------------------------------------------------
   THE UPLOADER, RUN FOR REAL
   ---------------------------------------------------------------------------
   Direct-to-Drive first, base64 relay second. The cases worth asserting are
   the refusals, because that is where a file quietly fails to arrive and
   nobody is told which one.
--------------------------------------------------------------------------- */
const MB_ = 1048576;
function uploadHarness(opts) {
  const noop = () => {};
  const store = {}, els = {}, sent = [];
  const mk = (id) => ({ id, textContent: '', className: '',
    get innerHTML() { return store[id] || ''; }, set innerHTML(v) { store[id] = v; },
    value: '', disabled: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop });
  function FR() { this.readAsDataURL = (f) => { this.result = 'data:' + f.type + ';base64,AAAA';
    setTimeout(() => this.onload(), 0); }; }
  function XHR() {
    this.upload = {}; this.open = noop; this.setRequestHeader = noop;
    this.send = () => { sent.push('DIRECT'); setTimeout(() => {
      /* A CORS refusal reaches the page as status 0 with no detail. That is
         exactly the shape the fallback has to recognise. */
      if (opts.directBlocked) { this.status = 0; this.onerror(); }
      else { this.status = 200; this.onload(); }
    }, 0); };
  }
  const ctx = {
    console: { log: noop, error: noop }, XMLHttpRequest: XHR, FileReader: FR,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { getElementById: (id) => (els[id] = els[id] || mk(id)),
                addEventListener: noop, createElement: () => mk('x'), body: mk('b') },
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: noop, scrollTo: noop,
    fetch: async (u, o) => {
      const b = JSON.parse(o.body); sent.push(b.fn);
      if (b.fn === 'uploadSession') {
        return { ok: true, status: 200, json: async () => (opts.noSession
          ? { _api: 'console', ok: 0, error: 'no session' }
          : { _api: 'console', ok: 1, url: 'https://www.googleapis.com/upload/x?upload_id=A' }) };
      }
      return { ok: true, status: 200,
               json: async () => ({ _api: 'console', ok: 1, counts: { winter: 1, spring: 0 } }) };
    }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'harbor-haul-out/index.html' });
  vm.runInContext('ME={name:"Rex",admin:true,perms:{photos:1}};CUR={quoteNo:"QW-26-1255"}', ctx);
  return { ctx, els, sent };
}

/* upload() returns the moment the files are queued — that is the whole point
   of it, so the crew is not held up. The test therefore has to wait for the
   background pump, not for upload(). */
async function drain(h) {
  for (let i = 0; i < 500; i++) {
    if (!vm.runInContext('UPRUN || UPQ.length', h.ctx)) return true;
    await new Promise((r) => setImmediate(r));
  }
  fail('the upload queue never drained — the pump is stuck');
  return false;
}

async function uploadChecks() {
  /* 1. A big clip goes straight to Drive and never touches the relay. */
  {
    const h = uploadHarness({});
    await h.ctx.upload([{ name: 'clip.mov', size: 80 * MB_, type: 'video/quicktime' }]);
    await drain(h);
    if (h.sent.indexOf('DIRECT') > -1 && h.sent.indexOf('uploadPhoto') < 0)
      ok('an 80 MB clip goes straight to Drive and never touches the base64 relay');
    else fail('the direct path was not used for a large file: ' + JSON.stringify(h.sent));
  }
  /* 2. Direct refused + a small file: falls back, and the crew never has to care. */
  {
    const h = uploadHarness({ directBlocked: true });
    await h.ctx.upload([{ name: 'photo.jpg', size: 3 * MB_, type: 'image/jpeg' }]);
    await drain(h);
    if (h.sent.indexOf('uploadPhoto') > -1) ok('a refused direct upload falls back to the relay');
    else fail('nothing fell back — the file would simply not arrive: ' + JSON.stringify(h.sent));
  }
  /* 3. Direct refused + a big file: cannot fall back, and MUST name the file. */
  {
    const h = uploadHarness({ directBlocked: true });
    await h.ctx.upload([{ name: 'big4k.mov', size: 96 * MB_, type: 'video/quicktime' }]);
    await drain(h);
    const msg = h.els.upMsg ? h.els.upMsg.textContent : '';
    if (h.sent.indexOf('uploadPhoto') > -1)
      fail('a 96 MB file was handed to the relay, which caps at 25 MB');
    else if (msg.indexOf('big4k.mov') > -1)
      ok('a file that could go neither way is named in the final message');
    else fail('a file failed and the crew is not told which: ' + JSON.stringify(msg));
  }
  /* 4. No session at all (older backend): still falls back rather than dying. */
  {
    const h = uploadHarness({ noSession: true });
    await h.ctx.upload([{ name: 'photo.jpg', size: 2 * MB_, type: 'image/jpeg' }]);
    await drain(h);
    if (h.sent.indexOf('uploadPhoto') > -1)
      ok('a backend with no uploadSession endpoint still takes photos via the relay');
    else fail('an older backend would break uploads entirely: ' + JSON.stringify(h.sent));
  }
}

uploadChecks().then(function () {
  if (bad) { console.error('FAIL: ' + bad + ' problem(s) with Harbor Haul Out'); process.exit(1); }
  console.log('Harbor Haul Out: renders the server\'s verdict rather than forming one, lists slip boats for ' +
              'pulling and everything for placing, uploads straight to Drive with a relay behind it, ' +
              'and degrades safely on a bad connection');
});
