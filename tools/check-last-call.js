#!/usr/bin/env node
/* The "last call for storage" email (`lastcall`) and the typed CC box,
   executed rather than grepped.
   ---------------------------------------------------------------------------
   Chris, Nov 2026: a last check-in for customers with no deposit or no signed
   agreement — the pay-by date is coming, the late pull-out fee and the 10%
   late invoice fee follow it, here is your quote, and here is how to adjust
   it, pay and sign. Each way it could be quietly wrong is built here:

     - it goes to the right people: no deposit, or no contract, or neither —
       never somebody with BOTH on file, never a lead, never a row with no
       last name (the adjust button would be dead)
     - it stops once the deadline has passed (it says the date is coming)
     - the fee, the percentage and the date come from the season and the
       engine, not from text typed into the builder
     - the buttons match what is missing: no sign button with a contract on
       file, no pay button once paid in full, deposit wording until money is in
     - it attaches the PDF and sets NO status (a deposit-paid quote must keep
       "Deposit received")
     - a golf cart is collected, never pulled out of the water
     - the typed CC box accepts real addresses only, folds duplicates, caps
       the count, and the preview and the send both refuse a bad one

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gasSrc = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);
const has = (s, frag, what) => (String(s).indexOf(frag) > -1 ? ok(what) : fail(what + ' — missing ' + JSON.stringify(frag)));
const hasnt = (s, frag, what) => (String(s).indexOf(frag) < 0 ? ok(what) : fail(what + ' — found ' + JSON.stringify(frag)));
const eq = (got, want, what) => (got === want ? ok(what) : fail(what + ' — got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want)));

const B = new Function(gasSrc + '\nreturn { buildEmailFor_, lastCallBlocker_, lastCallPastDeadline_, unbuildableMsg_,' +
  ' staffExtras_, BULK_KINDS_, quoteLinkFor_, signUrlFor_, PAYMENT_URL, PRICES, RULES, SEASON, NOTIFY_EMAIL,' +
  ' seasonStamp, CC_TYPED_MAX_ };')();

/* The builder reads today's date, so the fixtures carry a deadline far enough
   out that this guard does not start failing on Nov 16. The real 2026 stamp is
   exercised separately below with an explicit clock. */
const FUTURE = Object.assign(B.seasonStamp(), { payBy: 'November 15, 2099', payByShort: 'Nov 15' });
const quote = (over) => Object.assign({
  quoteNo: 'QW-26-9101', firstName: 'Pat', lastName: 'Fixture', unit: 'Boat',
  email: 'fixture@example.invalid', total: 1000, deposit: 500, payments: [], emailLog: [],
  state: { storage: 'inside', slipNo: '' }, storageTab: 'Inside', season: FUTURE, contractUrl: ''
}, over || {});
const build = (d) => B.buildEmailFor_(d, 'lastcall', '', '');

console.log('=== neither a deposit nor a contract ===');
{
  const d = quote();
  const e = build(d);
  if (!e) { fail('no email built for the ordinary case'); }
  else {
    has(e.html, B.quoteLinkFor_(d), 'the adjust button carries the customer\'s own quote link');
    has(e.html, B.PAYMENT_URL, 'there is a pay button');
    const sign = B.signUrlFor_(d);
    if (sign) has(e.html, sign, 'the sign button carries signUrlFor_\'s link');
    else has(e.html, 'get your agreement to you', 'with no web form, the sign step says to call');
    has(e.html, 'Pay my deposit online', 'nothing paid yet: it asks for the deposit');
    has(e.html, '$' + B.PRICES.lateRetrieval.toFixed(2), 'the late pull-out fee is the engine\'s figure');
    has(e.html, 'late retrieval fee', 'and is named the way Chris names it');
    has(e.html, B.RULES.latePct + '% late fee', 'the late percentage is the engine\'s');
    has(e.html, 'November 15, 2099', 'the date is the quote\'s own season stamp, not typed text');
    has(e.html, 'Payment in full is due at sign-up', 'waiting means paying in full up front');
    has(e.html, '$1,100.00', 'after the date: the balance plus 10%');
    has(e.html, '$1,325.00', 'then the fee on top of that');
    has(e.html, 'saves you <b>$325.00</b>', 'and the difference is spelled out');
    /* Chris: the fee is the customer's timing, never ours. */
    has(e.html, 'because we haven\'t reached it yet', 'a boat we simply have not pulled yet owes no fee, and it says so');
    has(e.html, 'pull your boat after', 'asking for a pull after the date carries the fee');
    has(e.html, 'your deposit or your signed winter services agreement', 'it says both are missing');
    eq(e.attachPdf, true, 'the quote is attached');
    eq(e.status, '', 'it sets no status');
    has(e.subject, 'QW-26-9101', 'the subject carries the quote number');
  }
}

console.log('=== a deposit, no contract ===');
{
  const e = build(quote({ payments: [{ amt: 500 }] }));
  if (!e) fail('a deposit with no contract got no last call — that is half the list');
  else {
    has(e.html, '$500.00', 'it thanks them for the payment we have');
    has(e.html, 'your signed winter services agreement', 'it says the agreement is what is missing');
    hasnt(e.html, 'Pay my deposit online', 'it does not ask for a deposit already paid');
    has(e.html, 'Pay online', 'it still offers to pay the balance');
    eq(e.status, '', 'and does not overwrite "Deposit received"');
  }
}

console.log('=== a contract, no deposit ===');
{
  const d = quote({ contractUrl: 'https://drive.example.invalid/c' });
  const e = build(d);
  if (!e) fail('a signed quote with no money got no last call');
  else {
    const sign = B.signUrlFor_(d);
    if (sign) hasnt(e.html, sign, 'no sign button when the agreement is on file');
    hasnt(e.html, 'Review &amp; sign', 'no sign step at all');
    has(e.html, 'Pay my deposit online', 'it asks for the deposit');
  }
}

console.log('=== paid in full, no contract ===');
{
  const e = build(quote({ payments: [{ amt: 1000 }] }));
  if (!e) fail('paid in full but unsigned got no last call');
  else {
    hasnt(e.html, B.PAYMENT_URL, 'no pay button when nothing is owed');
    hasnt(e.html, '% late fee', 'no late-balance figure when nothing is owed');
    has(e.html, 'saves you <b>$225.00</b>', 'only the fee is at stake when nothing is owed');
  }
}

console.log('=== who is held back ===');
const refuse = (d, frag, what) => {
  const why = B.lastCallBlocker_(d);
  if (build(d) !== null) { fail(what + ' — the email BUILT'); return; }
  has(why, frag, what);
  eq(B.unbuildableMsg_('lastcall', d), why, '  preview and send give the same reason');
  eq(B.BULK_KINDS_.lastcall.blocker(d), why, '  the send-to-all picker holds it back for the same reason');
};
refuse(quote({ payments: [{ amt: 500 }], contractUrl: 'https://drive.example.invalid/c' }), 'both on file',
  'a deposit AND a contract: nothing to chase');
refuse(quote({ storageTab: 'Quote Started' }), 'unfinished', 'a lead is never sent it');
refuse(quote({ total: 0 }), 'no priced total', 'an unpriced quote is not');
refuse(quote({ lastName: '' }), 'last name', 'no last name means no adjust link, so no email');

console.log('=== the deadline ===');
{
  const d = quote({ season: B.seasonStamp() });   // the real 2026–2027 pay-by date
  eq(d.season.payBy, B.SEASON.payByDate, 'the fixture carries the live season\'s date');
  eq(B.lastCallBlocker_(d, new Date(2026, 10, 5, 9, 0)), '', 'a week before: sendable');
  eq(B.lastCallBlocker_(d, new Date(2026, 10, 15, 23, 30)), '', 'late on the day itself: still sendable');
  has(B.lastCallBlocker_(d, new Date(2026, 10, 16, 0, 5)), 'deadline has passed', 'the next morning: refused');
  eq(B.lastCallPastDeadline_(quote({ season: { payBy: 'whenever' } }), new Date()), false,
    'an unreadable date does not block a reminder');
}

console.log('=== a golf cart ===');
{
  const e = build(quote({ unit: 'Golf Cart' }));
  if (!e) fail('no last call for a golf cart');
  else {
    has(e.html, 'pick up your golf cart after', 'a land unit is picked up, with the same fee');
    const WET = /\bpull(?:ed)? out\b|\bpull-out\b|\bhaul|\bwater\b|\bslips?\b/i;
    if (WET.test(e.html)) fail('a golf cart is being pulled out of the water: ' +
      (e.html.match(new RegExp('[^<>]*(' + WET.source + ')[^<>]*', 'i')) || [''])[0].trim().slice(0, 140));
    else ok('a land unit is collected, never pulled out of the water');
  }
}

console.log('=== typed CC addresses ===');
{
  const sx = (o) => B.staffExtras_(o);
  eq(sx({}).cc, '', 'nothing ticked or typed: no CC');
  eq(sx({ cc: true }).cc, B.NOTIFY_EMAIL, 'the service@ box still works on its own');
  eq(sx({ ccTo: 'a@example.com, b@example.org; c@example.net' }).cc, 'a@example.com,b@example.org,c@example.net',
    'commas, semicolons and spaces all separate addresses');
  eq(sx({ cc: true, ccTo: B.NOTIFY_EMAIL.toUpperCase() + ' a@example.com A@EXAMPLE.COM' }).cc,
    B.NOTIFY_EMAIL + ',a@example.com', 'duplicates (any case) and a typed service@ are folded');
  eq(sx({ ccTo: 'a@example.com' }).badCc.length, 0, 'a good address is not flagged');
  for (const junk of ['bob', 'bob@', '@example.com', 'bob@example', 'Bob <bob@example.com>', 'a@example.com\nBcc:x@example.com']) {
    if (sx({ ccTo: junk }).badCc.length) ok('rejected: ' + JSON.stringify(junk));
    else fail('accepted a CC that is not one plain address: ' + JSON.stringify(junk));
  }
  const many = Array.from({ length: B.CC_TYPED_MAX_ + 1 }, (_, i) => 'p' + i + '@example.com').join(',');
  if (sx({ ccTo: many }).badCc.length) ok('more than ' + B.CC_TYPED_MAX_ + ' typed addresses is refused');
  else fail('no cap on typed CC addresses');
  if (!sx({ cc: true, ccTo: many.split(',').slice(0, B.CC_TYPED_MAX_).join(',') }).badCc.length)
    ok('service@ does not count against the cap');
  else fail('ticking service@ used up one of the typed slots');

  /* Both server entry points must refuse before doing anything else. */
  ['adminEmailPreview', 'adminSendEmail'].forEach((fn) => {
    const body = (gasSrc.match(new RegExp('function ' + fn + '\\([\\s\\S]*?\\n}')) || [''])[0];
    const i = body.indexOf('sx.badCc.length'), j = body.indexOf('findQuoteCtx_');
    if (i > -1 && i < j) ok(fn + ' refuses a bad CC before it looks anything up');
    else fail(fn + ' does not refuse a bad CC first');
  });
  if (/function pvStaff\(\)\{return \{[^}]*ccTo:\$\('pvCcTo'\)/.test(html)) ok('the console sends the typed CC box');
  else fail('the console preview does not send the typed CC box');
  has(html, 'onclick="sendKind(\'lastcall\')"', 'the console has a Last call button');
  has(html, '<option value="lastcall">', 'and a send-to-all option');
}

if (bad) { console.error('FAIL: ' + bad + ' problem(s) with the last-call email'); process.exit(1); }
console.log('last call holds: right people, right buttons, season-driven fees, no status, safe CC');
