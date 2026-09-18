#!/usr/bin/env node
/* The "who still hasn't signed" chase: the storage-view filter and the nudge
   email, both executed rather than grepped.
   ---------------------------------------------------------------------------
   Two halves, and each one has a way of being quietly wrong that a grep would
   pass straight over:

   THE FILTER. "Has a deposit" is not "owes nothing" and it is not "the balance
   is zero" — a quote paid in full and a $500 deposit are both on the deposit
   side, and a lead row with no price at all is on neither. Invert any of those
   conditions and the console still renders three tidy tabs; they are just
   showing the wrong people, and the tab that is supposed to be the chase list
   is the one nobody would think to re-check. So the real console script is
   lifted out of admin/index.html and run against a fixed set of rows.

   THE EMAIL. It must refuse to build when there is nowhere to send them —
   an "almost there, just sign" with a dead button is worse than no email —
   and it must leave the quote's status column alone, because that column is
   what the console pill and the yard sheets read. Overwriting "Deposit
   received" with a chase note takes money state off a sheet somebody is
   holding in the yard.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GAS = path.join(ROOT, 'quote-logger-apps-script.gs');
const HTML = path.join(ROOT, 'admin/index.html');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);
const eq = (got, want, what) => {
  if (got === want) ok(what);
  else fail(what + ' — got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
};

/* =====================================================================
   1. THE CONSOLE FILTER, run for real.
   ===================================================================== */
const SRC = (fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((b) => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');

function consoleCtx() {
  const noop = () => {};
  const el = {
    textContent: '', className: '', innerHTML: '', value: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop
  };
  const ctx = {
    console,
    localStorage: { getItem: () => null, setItem: noop, clear: noop },
    location: { reload: noop, href: '' },
    document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
                addEventListener: noop, createElement: () => el, body: el },
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: noop,
    MutationObserver: function () { return { observe: noop }; },
    fetch: async () => { throw new Error('this guard makes no requests'); }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'admin/index.html' });
  return ctx;
}

/* Deliberately covers every shape that has a way of being misread:
   - a deposit that does NOT clear the balance   (the ordinary chase)
   - a quote PAID IN FULL with no contract       (still a deposit, still a chase)
   - a quote with a deposit AND a contract       (deposit side, no tag)
   - a zero-balance quote that was never paid    ('Paid' text, no payment)
   - a CREDIT balance                            (money in, so deposit side)
   - a lead row                                  (neither side, ever) */
const GROUPS = [
  { tab: 'Building A', lead: false, count: 5, rows: [
    { qn: 'QW-26-0001', name: 'Adams, Al',   deposit: true,  contract: false, balance: '$700.00' },
    { qn: 'QW-26-0002', name: 'Baker, Bo',   deposit: true,  contract: true,  balance: '$700.00' },
    { qn: 'QW-26-0003', name: 'Clark, Cy',   deposit: true,  contract: false, balance: 'Paid' },
    { qn: 'QW-26-0004', name: 'Dunn, Di',    deposit: false, contract: false, balance: '$1,200.00' },
    { qn: 'QW-26-0005', name: 'Ewing, Ed',   deposit: true,  contract: false, balance: 'CREDIT $25.00' }
  ] },
  { tab: 'No Storage', lead: false, count: 1, rows: [
    /* Never priced, never paid: reads 'Paid' because the balance is zero. It is
       NOT a deposit, and reading the balance instead of the payments is exactly
       how it would end up on the wrong tab. */
    { qn: 'QW-26-0006', name: 'Frost, Fi',   deposit: false, contract: false, balance: 'Paid' }
  ] },
  { tab: 'Quote Started', lead: true, count: 2, rows: [
    { qn: 'QW-26-0007', name: 'Gray, Gi',    deposit: false, contract: false, balance: 'Paid' },
    { qn: 'QW-26-0008', name: 'Hall, Ha',    deposit: false, contract: false, balance: 'Paid' }
  ] }
];

const C = consoleCtx();
C.window._sg = GROUPS;

const qns = () => C.storageGroups_().reduce((a, g) => a.concat(g.rows.map((r) => r.qn)), []);

C.setStorageFilter('all');
eq(qns().length, 8, 'Everyone shows every row, leads included');

C.setStorageFilter('dep');
eq(qns().join(','), 'QW-26-0001,QW-26-0002,QW-26-0003,QW-26-0005',
   'Deposit paid = every row with money on it, paid-in-full and credit included');

C.setStorageFilter('nodep');
eq(qns().join(','), 'QW-26-0004,QW-26-0006',
   'No deposit = the unpaid quotes only, and a zero-balance unpriced quote counts as unpaid');

/* The trap this exists for: a lead is not a customer who forgot to pay. */
if (qns().some((q) => q === 'QW-26-0007' || q === 'QW-26-0008'))
  fail('a lead row is being counted as a quote with no deposit — it has no quote to take one on');
else ok('leads are in neither deposit bucket');

const counts = C.storageCounts_();
eq(counts.all, 8, 'the Everyone count is every row');
eq(counts.dep, 4, 'the Deposit count matches what that tab shows');
eq(counts.nodep, 2, 'the No-deposit count matches what that tab shows');
eq(counts.unsigned, 3, 'the unsigned count is deposits WITHOUT a contract, not all deposits');
if (counts.dep + counts.nodep === counts.all)
  fail('the two deposit tabs add up to every row — the lead rows are being counted somewhere');
else ok('the two tabs deliberately do not add up to Everyone (leads sit outside both)');

/* A filtered view must not keep buildings it emptied; Everyone must. */
C.setStorageFilter('dep');
if (C.storageGroups_().some((g) => g.count === 0)) fail('a filtered view still lists an emptied building');
else ok('a filtered view drops the buildings it emptied');
C.setStorageFilter('all');
eq(C.storageGroups_().length, GROUPS.length, 'Everyone still lists every building');

/* The tab strip must not share the photo switch's class: setSeason() clears
   `.on` from every `.seg button` on the page, so a photo tap would silently
   un-highlight whichever storage tab was selected. */
const markup = fs.readFileSync(HTML, 'utf8');
if (/id="storageTabs"[^>]*class="[^"]*\bseg\b/.test(markup))
  fail('the storage tabs use .seg — setSeason() would clear their highlight on a photo tap');
else ok('the storage tabs have their own class, not the photo switch\'s');

/* =====================================================================
   1b. WHO MAY BE TOUCHED. Chris's rule, executed.
   ---------------------------------------------------------------------
   "If they don't have a contract or a deposit, we do not touch the boat. If
   they have a deposit they can be on the haul out list with a note that they
   don't have a contract so that we can plan around pulling them, but we will
   not pull the boat without a signed contract."

   So the gate for putting hands on a unit is the SIGNATURE, never the money.
   Getting this backwards — letting a deposit authorise a pull — is the whole
   liability this guards, and it is one inverted condition away at all times.
   ===================================================================== */
eq(C.haulAuth_({ contract: true,  deposit: true  }).state, 'cleared', 'signed and paid: cleared to pull');
eq(C.haulAuth_({ contract: true,  deposit: false }).state, 'cleared',
   'signed but unpaid is STILL cleared — the signature is the gate, not the money');
eq(C.haulAuth_({ contract: false, deposit: true  }).state, 'hold',
   'a deposit with no signature is planning only, never a pull');
eq(C.haulAuth_({ contract: false, deposit: false }).state, 'blocked',
   'neither means we do not touch the boat at all');

{
  const p = C.haulPartition_(GROUPS);
  const on = p.plan.map((r) => r.qn).sort().join(',');
  const off = p.blocked.map((r) => r.qn).sort().join(',');
  eq(on, 'QW-26-0001,QW-26-0002,QW-26-0003,QW-26-0005',
     'the working list is exactly the units with a signature or a deposit');
  eq(off, 'QW-26-0004,QW-26-0006,QW-26-0007,QW-26-0008',
     'everything with neither is held off the working list, leads included');
  /* The one sentence that must never stop being true. */
  if (p.plan.some((r) => r.auth.state === 'cleared' && !r.contract))
    fail('a unit with no signed contract was marked cleared to pull');
  else ok('nothing without a signed contract is ever marked cleared');
  if (p.blocked.some((r) => r.deposit || r.contract))
    fail('a unit with a deposit or a contract was held off the list entirely');
  else ok('a deposit is enough to get onto the plan, as Chris asked');
}

/* And the paper says so. The sheet is what the yard acts on, and shop printers
   are black and white, so the hold must be in WORDS, not a colour. */
{
  const printed = [];
  const el = { textContent: '', className: '', innerHTML: '', value: '',
               classList: { add: () => {}, remove: () => {}, toggle: () => {} }, addEventListener: () => {} };
  const area = { get innerHTML() { return printed[0] || ''; }, set innerHTML(v) { printed[0] = v; },
                 classList: el.classList, textContent: '' };
  C.document.getElementById = (id) => (id === 'printArea' ? area : el);
  C.print = () => {};
  C.window._sg = GROUPS;
  C.printHaulOut().then(function () {
    const html = printed[0] || '';
    const pages = html.split('class="pg"').length - 1;
    eq(pages, 2, 'two pages: the working list, and the units nobody may touch');
    if (/DO NOT TOUCH — NOT AUTHORISED/.test(html)) ok('the held-off units get their own headed page');
    else fail('there is no "do not touch" page for the units with neither');
    if (/NO SIGNED CONTRACT — DO NOT PULL/.test(html)) ok('a deposit-only row is stamped in words on the sheet');
    else fail('a deposit-only row carries no printed warning — colour alone will not survive a shop printer');
    if (/No unit is pulled without a signed agreement on file/.test(html)) ok('the rule itself is printed on the sheet');
    else fail('the sheet does not state the rule');
    /* The checkbox is the instruction to pull. A row we may not pull must not
       have one, or it is the box that gets ticked. */
    const holdRow = (html.match(/<tr class="noauth">[\s\S]*?<\/tr>/) || [''])[0];
    if (/class="cb"/.test(holdRow)) fail('a HOLD row still carries a tick box — that box is the instruction to pull it');
    else ok('a HOLD row has no tick box');
    if (bad) { console.error('FAIL: ' + bad + ' problem(s) with the sign chase'); process.exit(1); }
    tail();
  });
}

/* =====================================================================
   2. THE NUDGE EMAIL, built for real.
   ===================================================================== */
function backend(src) {
  return new Function(src + '\nreturn { buildEmailFor_, signUrlFor_, SIGNING };')();
}
const gasSrc = fs.readFileSync(GAS, 'utf8');
const B = backend(gasSrc);

const quote = (over) => Object.assign({
  quoteNo: 'QW-26-1255', firstName: 'Fixture', lastName: 'Owner', unit: 'Boat',
  email: 'fixture@example.com', total: 1200, payments: [{ amt: 500 }],
  state: { storage: 'inside', slipNo: '' }
}, over || {});

const paid = B.buildEmailFor_(quote(), 'signreminder', '', '');
if (!paid) { fail('no sign-reminder email was built for an ordinary paid quote'); }
else {
  const link = B.signUrlFor_(quote());
  if (paid.html.indexOf(link) > -1) ok('the button carries the link signUrlFor_ builds');
  else fail('the sign button does not carry signUrlFor_\'s link — it is building one of its own');
  if (paid.html.indexOf('Quote_Number=QW-26-1255') > -1) ok('the quote number pre-fills');
  else fail('the link does not pre-fill Quote_Number');
  /* The status column is what the console pill and the yard sheets read. */
  eq(paid.status, '', 'the chase sets no status — it says nothing about money or the yard');
  if (paid.html.indexOf('$500.00') > -1) ok('a quote with a payment says what we have');
  else fail('the paid case does not name the payment');
  if (/slip/i.test(paid.html)) ok('a water unit with no slip on file is asked for one');
  else fail('a water unit with no slip is not asked for one — Slip_Number is editable for exactly this');
}

/* Slip already known: asking again is noise, and the link carries it anyway. */
const withSlip = B.buildEmailFor_(quote({ state: { storage: 'inside', slipNo: 'B-14' } }), 'signreminder', '', '');
if (withSlip && /if your boat is in a slip/i.test(withSlip.html))
  fail('a quote that already has a slip is still being asked for one');
else ok('a slip we already have is not asked for again');
if (withSlip && withSlip.html.indexOf('Slip_Number=B-14') > -1) ok('a known slip rides the link');
else fail('a known slip did not reach the pre-fill link');

/* Land units are collected, never hauled out of water. */
const cart = B.buildEmailFor_(quote({ unit: 'Golf Cart' }), 'signreminder', '', '');
if (!cart) fail('no sign-reminder email was built for a golf cart');
else {
  /* \bwater\b deliberately, so the "Quest Watersports" in the header and the
     footer of every email is not mistaken for a boat being put back in it. */
  const WET = /\bhauls?\b|\bhauled\b|\bhaul-out\b|\bwater\b|\bslips?\b/i;
  if (WET.test(cart.html)) fail('a golf cart is being hauled out of the water: ' +
    (cart.html.match(new RegExp('[^<>]*(' + WET.source + ')[^<>]*', 'i')) || [''])[0].trim().slice(0, 140));
  else ok('a land unit is collected, not hauled out, and is never asked about a slip');
}

/* Never paid: still sendable, but it must not invent a payment. */
const unpaid = B.buildEmailFor_(quote({ payments: [] }), 'signreminder', '', '');
if (!unpaid) fail('a quote with no payment cannot be asked to sign — staff chase those too');
else if (/\$/.test(unpaid.html.split('QUOTE#')[0])) fail('the unpaid case names a payment it does not have');
else ok('an unpaid quote is asked to sign without being thanked for money');

/* A lead has no selections, no price, and agreed to nothing. */
const lead = B.buildEmailFor_(quote({ storageTab: 'Quote Started' }), 'signreminder', '', '');
if (lead) fail('a lead row was sent a storage agreement to sign');
else ok('a lead is never asked to sign');

/* No web form configured: no link, so no email. Patched in a copy of the
   source, which is the same edit that would turn the signing step off. */
{
  const off = gasSrc.replace(/webFormUrl: '[^']*'/, "webFormUrl: ''");
  if (off === gasSrc) fail('could not blank SIGNING.webFormUrl to test the unconfigured case');
  else {
    const B2 = backend(off);
    if (B2.buildEmailFor_(quote(), 'signreminder', '', '')) {
      fail('an "almost there, just sign" email was built with no web form to send them to');
    } else ok('no web form configured means no email, not an email with a dead button');
  }
}

/* It is a judgement call, one quote at a time. Not a mailshot, and not on
   either of the two triggers that send without a human. */
{
  const bulk = (gasSrc.match(/BULK_KINDS_\s*=\s*\[[^\]]*\]/) || [''])[0];
  if (/signreminder/.test(bulk)) fail('signreminder is in BULK_KINDS_ — it would reach everyone ' +
    'without a contract on file, including the customers who signed on paper at the counter');
  else ok('signreminder is not a send-to-all kind');
  ['dailyReminderCheck', 'leadFollowUpCheck'].forEach(function (fn) {
    const body = (gasSrc.match(new RegExp('function ' + fn + '\\b[\\s\\S]*?\\n}', 'm')) || [''])[0];
    if (/signreminder/.test(body)) fail(fn + ' sends the sign chase automatically — it is a human decision');
    else ok(fn + ' does not send it automatically');
  });
}

/* The status guard itself: an empty status must not blank the column. */
{
  const send = (gasSrc.match(/function adminSendEmail\b[\s\S]*?\n}/m) || [''])[0];
  if (/if \(built\.status\) ctx\.sh\.getRange\(ctx\.rowNum, COL\.STATUS\)\.setValue\(built\.status\)/.test(send))
    ok('adminSendEmail only stamps a status when the kind has one');
  else fail('adminSendEmail writes built.status unconditionally — a kind with no status would ' +
            'blank the column the console pill and the yard sheets read');
  if (/recordEmail_\(/.test(send)) ok('the send is still recorded in Email History either way');
  else fail('adminSendEmail no longer records the send');
}

/* Preview and send must explain a refusal the same way. */
{
  const shared = (gasSrc.match(/function unbuildableMsg_\b[\s\S]*?\n}/m) || [''])[0];
  if (!shared) fail('there is no shared explanation for an email that could not be built');
  else {
    const callers = (gasSrc.match(/if \(!built\) return \{ ok: 0, error: [^;]*;/g) || []);
    const rogue = callers.filter((c) => c.indexOf('unbuildableMsg_(') < 0);
    if (rogue.length) fail('a caller explains an unbuildable email its own way: ' + rogue.join(' | '));
    else ok('preview and send give the same reason for a refusal (' + callers.length + ' callers)');
  }
}

function tail() {
  if (bad) { console.error('FAIL: ' + bad + ' problem(s) with the sign chase'); process.exit(1); }
  console.log('sign chase: a signature is the gate for touching a unit, a deposit only buys a ' +
              'place on the plan, the filter sorts by payment not balance, and the nudge ' +
              'refuses to build rather than ship a dead button');
}
if (bad) { console.error('FAIL: ' + bad + ' problem(s) with the sign chase'); process.exit(1); }
