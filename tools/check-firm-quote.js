#!/usr/bin/env node
/* The firm-quote email ("our rates are final — here is your firm quote"),
   executed rather than grepped.
   ---------------------------------------------------------------------------
   This email promises a customer that their price will not move. Every way it
   could go out while that promise is false is a way of being quietly wrong
   that no grep would catch, so each one is built here and the answer read:

     - while PRICING.provisional is on, it refuses — preview, send and picker
     - a quote priced/dated under the estimate rates is refused ("re-price it")
     - a quote whose stored total differs from today's price is refused, so the
       PDF it attaches cannot disagree with the promise in the email
     - a lead, a quote with no total, a row with no last name: refused
     - when it DOES build: the customer's own quote link, the sign link and the
       pay link are all there, it attaches the PDF, it sets its status, and no
       estimate wording survives
     - paid in full and signed: "you're all set", no pay button
     - a signed agreement on file: no sign button
     - the re-price offers a same-total quote still stamped from the estimate
       days, so it can be brought up to date and sent

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const gasSrc = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);
const has = (s, frag, what) => (String(s).indexOf(frag) > -1 ? ok(what) : fail(what + ' — missing ' + JSON.stringify(frag)));
const hasnt = (s, frag, what) => (String(s).indexOf(frag) < 0 ? ok(what) : fail(what + ' — found ' + JSON.stringify(frag)));

const B = new Function(gasSrc + '\nreturn { buildEmailFor_, firmQuoteBlocker_, priceStampStale_, unbuildableMsg_,' +
  ' PRICING, SEASON, SIGNING, seasonStamp, quoteLinkFor_, signUrlFor_, PAYMENT_URL, BULK_KINDS_,' +
  ' repriceRowOut_, customerNoteOf_ };')();

/* A real, priced quote from the shared fixtures — the same way check-reprice.js
   builds one, so the fresh-price comparison in firmQuoteBlocker_ has something
   true to compare against. */
const states = JSON.parse(execSync('node tools/price-fixtures.js --dump-states', { cwd: ROOT, maxBuffer: 1e8 }));
const P = require(path.join(ROOT, 'pricing-engine.js'));
function quote(name, extra) {
  const state = JSON.parse(JSON.stringify(states.find((s) => s.name === name).state));
  const r = P.computeQuote(state);
  const lines = r.lines.map((l) => ({ sec: l.sec, label: l.label, calc: l.calc || '', amt: Number(l.amt || 0), desc: l.desc || '' }));
  return Object.assign({ quoteNo: 'QW-26-9001', unit: 'Boat', firstName: 'Pat', lastName: 'Fixture',
    email: 'fixture@example.invalid', depositBase: 500, deposit: 500, state, lines,
    total: lines.reduce((a, b) => a + b.amt, 0).toFixed(2), payments: [], emailLog: [],
    storageTab: P.storageTabFor(state), season: B.seasonStamp() }, extra || {});
}

const provisionalWas = B.PRICING.provisional;

console.log('=== while rates are still estimates ===');
B.PRICING.provisional = true;
{
  const d = quote('boat-twin-inboard-full');
  const why = B.firmQuoteBlocker_(d);
  has(why, 'estimates', 'refuses while PRICING.provisional is on');
  if (B.buildEmailFor_(d, 'firmquote', '', '') === null) ok('the builder returns nothing, so preview and send both refuse');
  else fail('the firm-quote email BUILT while rates are estimates');
  if (B.unbuildableMsg_('firmquote', d) === why) ok('preview and send give the same reason');
  else fail('unbuildableMsg_ disagrees with firmQuoteBlocker_');
  if (B.BULK_KINDS_.firmquote.blocker(d) === why) ok('the send-to-all picker holds it back for the same reason');
  else fail('the bulk picker uses a different bar from the builder');
}
/* Stamped now, while provisional: this is every quote on the sheet today. */
const stampedUnderEstimates = quote('boat-twin-inboard-full');

console.log('=== once the rates are final ===');
B.PRICING.provisional = false;
{
  if (B.priceStampStale_(stampedUnderEstimates)) ok('a quote stamped under the estimate rates reads as stale');
  else fail('a quote priced under estimate rates reads as current');
  has(B.firmQuoteBlocker_(stampedUnderEstimates), 'Re-price', 'and is refused with "re-price it first"');

  const noStamp = quote('boat-twin-inboard-full'); delete noStamp.season;
  has(B.firmQuoteBlocker_(noStamp), 'Re-price', 'a quote with no season stamp at all is refused, not waved through');

  const d = quote('boat-twin-inboard-full');           // stamped now: provisional false
  if (B.priceStampStale_(d)) fail('a freshly stamped quote reads as stale');
  const why = B.firmQuoteBlocker_(d);
  if (why === '') ok('a quote priced and dated at the final rates may be sent');
  else fail('a current quote was refused: ' + why);

  const built = B.buildEmailFor_(d, 'firmquote', '', '');
  if (!built) { fail('the firm-quote email did not build for a current quote'); }
  else {
    has(built.subject, 'firm', 'subject says firm');
    has(built.subject, d.quoteNo, 'subject carries the quote number');
    has(built.html, 'firm price for the season', 'says the attached quote is the firm price');
    has(built.html, 'measure', 'names re-measuring as what could change it');
    has(built.html, 'change services', 'names a change of services as what could change it');
    has(built.html, B.quoteLinkFor_(d).replace(/&/g, '&'), 'Option 1 is their own quote link (quoteLink_)');
    has(built.html, 'Review or change my quote', 'Option 1 button');
    has(built.html, B.PAYMENT_URL, 'Option 2 carries the payment link');
    has(built.html, 'Pay my deposit online', 'unpaid storage quote is asked for the deposit');
    const sign = B.signUrlFor_(d);
    if (sign) has(built.html, sign, 'Option 2 carries the sign link, rebuilt at send time');
    else ok('no web form configured — no sign button (nothing to check)');
    if (built.attachPdf === true) ok('attaches the quote PDF');
    else fail('the firm quote does not attach the PDF it calls firm');
    if (built.status === 'Firm quote sent') ok('stamps status "Firm quote sent"');
    else fail('status was ' + JSON.stringify(built.status));
    ['Estimate only', 'Heads up', 'are not published yet', 'reserve your spot'].forEach((f) =>
      hasnt(built.html, f, 'carries no estimate wording ("' + f + '")'));
  }

  /* Price on file no longer matches today's rates: the PDF would contradict it. */
  const drift = quote('boat-twin-inboard-full'); drift.total = (Number(drift.total) + 40).toFixed(2);
  has(B.firmQuoteBlocker_(drift), 'At today', 'a quote whose total differs from today\'s price is refused');

  const lead = quote('boat-twin-inboard-full', { storageTab: 'Quote Started' });
  has(B.firmQuoteBlocker_(lead), 'unfinished', 'a lead is never sent a firm quote');
  const zero = quote('boat-twin-inboard-full', { total: '0.00' });
  has(B.firmQuoteBlocker_(zero), 'no priced total', 'a quote with no total is refused');
  const noName = quote('boat-twin-inboard-full', { lastName: '' });
  has(B.firmQuoteBlocker_(noName), 'last name', 'no last name means no link, so it is refused');

  const signedPaid = quote('boat-twin-inboard-full', { contractUrl: 'https://drive.example/c' });
  signedPaid.payments = [{ amt: Number(signedPaid.total), method: 'Check', ts: '2026-10-01', by: 'Chris' }];
  const sp = B.buildEmailFor_(signedPaid, 'firmquote', '', '');
  if (!sp) fail('did not build for a signed, paid-in-full quote');
  else {
    has(sp.html, 'all set', 'paid in full and signed: "you\'re all set"');
    hasnt(sp.html, B.PAYMENT_URL, 'no pay button once it is paid in full');
    hasnt(sp.html, 'Review &amp; sign', 'no sign button once the agreement is on file');
    has(sp.subject, 'invoice', 'a quote with a payment is called an invoice');
  }

  const signedOnly = quote('boat-twin-inboard-full', { contractUrl: 'https://drive.example/c' });
  const so = B.buildEmailFor_(signedOnly, 'firmquote', '', '');
  if (!so) fail('did not build for a signed, unpaid quote');
  else {
    hasnt(so.html, 'Review &amp; sign', 'signed already: no sign button');
    has(so.html, 'signed agreement on file', 'signed already: says so');
    has(so.html, B.PAYMENT_URL, 'signed already: still asked to pay');
  }

  const deposit = quote('boat-twin-inboard-full');
  deposit.payments = [{ amt: 500, method: 'Card', ts: '2026-10-01', by: 'Chris' }];
  const dp = B.buildEmailFor_(deposit, 'firmquote', '', '');
  if (!dp) fail('did not build for a quote with a deposit');
  else {
    has(dp.html, 'We already have your payment', 'a deposit already paid is acknowledged');
    has(dp.html, 'Balance due', 'and the balance at the final rates is shown');
    hasnt(dp.html, 'Pay my deposit online', 'nobody is asked for a deposit they already paid');
  }

  /* The re-price offers a same-total quote still stamped from the estimate
     days — otherwise it could never become sendable. */
  const row = B.repriceRowOut_({ qn: 'Q', tab: 'Inside', name: 'n', unit: 'Boat', paidNum: 0,
    beforeNum: 100, afterNum: 100, deltaNum: 0, newBalanceNum: 100, restamp: true });
  if (row.changed && row.restamp) ok('the re-price ticks a same-total quote that still needs re-dating');
  else fail('a same-total, stale-stamped quote is reported "already at current rates" and can never be sent');
}

console.log('=== the customer note ===');
{
  if (B.customerNoteOf_({ notes: '  Please call first  ' }) === 'Please call first') ok('reads d.notes, trimmed');
  else fail('customerNoteOf_ did not read d.notes');
  if (B.customerNoteOf_({ notes: '', state: { notes: 'from the old sheet' } }) === 'from the old sheet') ok('falls back to state.notes (imports)');
  else fail('customerNoteOf_ missed an imported note in state.notes');
  if (B.customerNoteOf_({}) === '' && B.customerNoteOf_(null) === '') ok('no note reads as empty');
  else fail('customerNoteOf_ invented a note');
}

B.PRICING.provisional = provisionalWas;
if (bad) { console.error('FAIL: ' + bad + ' problem(s) with the firm-quote email'); process.exit(1); }
console.log('firm-quote email: refuses whenever the price is not firm, and says the right thing when it is');
