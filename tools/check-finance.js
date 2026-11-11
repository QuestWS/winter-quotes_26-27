#!/usr/bin/env node
/* Synchrony financing and the admin fee, executed rather than grepped.
   ---------------------------------------------------------------------------
   Money that a customer agrees to on one screen and staff charge on another
   has to be the same number on both, to the cent. So:

     - the engine reproduces Chris's fee table EXACTLY (grossed up: total =
       amount / (1 - pct)), and the copy embedded in the .gs agrees;
     - the last-call email carries the Finance button only when something is
       owed and the apply link is set — empty applyUrl turns it all off;
     - 'apply' is recorded quietly; 'authorize' needs a name, a 10-digit
       phone, the tick and a typed signature, stores the exact sentence they
       agreed to, emails the office ONCE, and changes nothing on the quote;
     - the staff charge (adminFinanceCharge) needs an approval code, refuses
       a balance that moved since the authorization, adds the admin fee line
       AND the payment in one save, and never runs twice;
     - the rate disclosure is flagged after the charge until signed in person;
     - the page draws the server's figures, acts only by POST, and never asks
       for an account number or an SSN.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gasSrc = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'finance.html'), 'utf8');
const P = require(path.join(ROOT, 'pricing-engine.js'));

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);
const eq = (got, want, what) => (JSON.stringify(got) === JSON.stringify(want) ? ok(what)
  : fail(what + ' — got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want)));
const has = (s, frag, what) => (String(s).indexOf(frag) > -1 ? ok(what) : fail(what + ' — missing ' + JSON.stringify(frag)));
const hasnt = (s, frag, what) => (String(s).indexOf(frag) < 0 ? ok(what) : fail(what + ' — found ' + JSON.stringify(frag)));

/* Stubs go INSIDE the backend's scope so they replace its own bindings. */
const SENT = [], WRITES = [], SAVES = [];
const B = new Function('__SENT', '__SAVES', gasSrc + `
;requireAuth_ = function () { return { name: 'Tester', admin: true }; };
auditLog_ = function () {};
invalidateStorageView_ = function () {};
notifyFinanceAuth_ = function (ctx, au, prev) { __SENT.push({ qn: ctx.d.quoteNo, key: au.key, prev: !!prev }); };
saveQuoteRow_ = function (ctx, st) { __SAVES.push(ctx.d.quoteNo); ctx.d.status = st; return 'pdf'; };
sendCustomerEmail_ = function () {}; recordEmail_ = function () {}; sendNotification_ = function () {};
var __CTX = null;
offersCtx_ = function () { return __CTX; };
findQuoteCtx_ = function () { return __CTX; };
LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
ContentService = { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { setMimeType: function () { return JSON.parse(t); } }; } };
return { financeQuote, financeOptions, financeAuthText, FINANCING, buildEmailFor_, financeReply_, financeServe_,
  adminFinanceCharge, adminFinanceDisclosure, financeOut_, financeLinkFor_, paymentsTotal_,
  setCtx: function (c) { __CTX = c; } };`)(SENT, SAVES);

console.log('=== the fee table, to the cent ===');
/* Chris's sheet, Nov 2026, on $1,000.00. */
const TABLE = { syf6: [15.23, 1015.23], syf9: [30.40, 1030.40], syf12: [44.39, 1044.39],
                syf18: [68.38, 1068.38], syf24: [95.89, 1095.89], syf36: [51.52, 1051.52] };
Object.keys(TABLE).forEach((k) => {
  const q = P.financeQuote(1000, k);
  eq(q && [q.fee, q.total], TABLE[k], k + ' on $1,000: admin fee and total match the sheet');
  const g = B.financeQuote(1000, k);
  eq(g && [g.fee, g.total], TABLE[k], k + ' — and the engine embedded in the .gs agrees');
});
eq(P.financeOptions(1000).length, 6, 'six plans');
eq(P.financeQuote(1000, 'nope'), null, 'an unknown plan prices as nothing');
eq(P.financeQuote(0, 'syf12'), null, 'nothing owed prices as nothing');
eq(P.FINANCING.feeLabel, 'Admin fee', 'the fee is called "Admin fee"');
eq(P.RULES.ccPct, 3, 'the card fee is untouched — POS+ passes a true 3% on top, not grossed up');

console.log('=== the last-call email ===');
const quote = (over) => Object.assign({
  quoteNo: 'QW-26-9201', firstName: 'Pat', lastName: 'Fixture', unit: 'Boat', email: 'fixture@example.invalid',
  total: 1000, deposit: 500, payments: [], emailLog: [], state: { storage: 'inside' }, storageTab: 'Inside',
  season: Object.assign({}, { payBy: 'November 15, 2099', payByShort: 'Nov 15', lateRetrievalFee: 225 }),
  contractUrl: ''
}, over || {});
{
  const e = B.buildEmailFor_(quote(), 'lastcall', '', '');
  has(e && e.html, 'Finance with Synchrony', 'money owed: the email offers Synchrony');
  has(e && e.html, 'finance.html?quote=QW-26-9201&amp;ln=Fixture'.replace('&amp;', '&'), 'the button opens their own finance page');
  hasnt(e && e.html, P.FINANCING.applyUrl, 'the email links our page, not Synchrony directly — the plan is picked first');
  const paid = B.buildEmailFor_(quote({ payments: [{ amt: 1000 }] }), 'lastcall', '', '');
  hasnt(paid && paid.html, 'Finance with Synchrony', 'paid in full: no Synchrony button');
  const was = B.FINANCING.applyUrl;
  B.FINANCING.applyUrl = '';
  const off = B.buildEmailFor_(quote(), 'lastcall', '', '');
  hasnt(off && off.html, 'Finance with Synchrony', 'empty applyUrl: the button is gone');
  eq(B.financeLinkFor_(quote()), '', 'and there is no link to build');
  B.FINANCING.applyUrl = was;
  eq(B.financeLinkFor_(quote({ storageTab: 'Quote Started' })), '', 'a lead never gets a finance link');
}

console.log('=== the customer applies, then authorizes ===');
const ctxFor = (d) => {
  const cells = {};
  return { d: d, rowNum: 2, sh: { getName: () => 'Inside',
    getRange: (r, c) => ({ setValue: (v) => { WRITES.push(c); cells[c] = v; }, getValue: () => cells[c] || '' }) } };
};
const AUTH = (over) => Object.assign({ quote: 'QW-26-9201', ln: 'fixture', step: 'authorize', term: 'syf12',
  first: 'Pat', last: 'Fixture', phone: '(815) 555-0100', agree: true, sig: 'Pat Fixture' }, over || {});
{
  const d = quote({ payments: [{ amt: 200 }] });   // owes $800
  const totalBefore = d.total;
  B.setCtx(ctxFor(d));
  const ap = B.financeServe_({ quote: d.quoteNo, ln: 'fixture', step: 'apply', term: 'syf12' });
  eq(ap.ok, 1, 'going to apply is accepted');
  eq(SENT.length, 0, 'and emails nobody — Synchrony tells the dealer about approvals itself');
  eq(!!(d.finance && d.finance.applyAt), true, 'but is noted on the quote');

  for (const [bad, why] of [[{ first: '' }, 'no name'], [{ phone: '555-0100' }, 'a short phone number'],
                            [{ agree: false }, 'no tick'], [{ agree: 'true' }, 'a tick that is not a real true'],
                            [{ sig: '  ' }, 'no signature'], [{ term: 'syf99' }, 'an unknown plan']]) {
    eq(B.financeServe_(AUTH(bad)).ok, 0, 'refused: ' + why);
  }
  eq(SENT.length, 0, 'no refused attempt reached the office');

  const r = B.financeServe_(AUTH());
  const q = P.financeQuote(800, 'syf12');
  eq(r.ok, 1, 'a complete authorization is accepted');
  eq(r._api, 'finance', 'stamped as the finance answer');
  const au = d.finance.auth;
  eq([au.total, au.base, au.fee], [q.total, q.base, q.fee], 'for the plan priced on what is owed now ($800)');
  eq(au.phone, '8155550100', 'the phone is kept as digits — the Business Center lookup');
  eq(au.text, P.financeAuthText(q), 'the exact sentence they agreed to is stored');
  eq(au.text.indexOf('$835.51') > -1 && au.text.indexOf('12-month deferred interest') > -1, true,
    'and it names the exact amount ($835.51 = $800 at 4.25%) and the plan');
  eq(d.total, totalBefore, 'authorizing does not move the quote total');
  eq(SAVES.length, 0, 'nor rebuild the quote');
  eq(SENT.length, 1, 'service@ is told once: ready to charge');
  B.financeServe_(AUTH());
  eq(SENT.length, 1, 'the same authorization again emails nobody');
  eq(!!B.financeReply_(d).authorized, true, 'the page shows it as authorized');
  B.setCtx(null);
  eq(B.financeServe_(AUTH()).ok, 0, 'no matching quote: refused');
}

console.log('=== staff record the Synchrony charge ===');
{
  const d = quote({ payments: [{ amt: 200 }], lines: [{ sec: 'Storage', label: 'Inside', amt: 1000 }] });
  B.setCtx(ctxFor(d));
  eq(B.adminFinanceCharge('t', d.quoteNo, 'A12345', false, true).ok, 0, 'no plan picked: nothing to record');
  B.financeServe_(AUTH());
  const q = P.financeQuote(800, 'syf12');
  eq(B.adminFinanceCharge('t', d.quoteNo, '', false, true).ok, 0, 'no approval code: refused');

  /* The balance moves after they authorized (a re-price, a payment). */
  d.payments.push({ amt: 50 });
  const moved = B.adminFinanceCharge('t', d.quoteNo, 'A12345', false, true);
  eq(moved.ok, 0, 'the balance moved since they authorized: refused, not guessed');
  eq(B.financeOut_(d).stale, true, 'and the console says so');
  d.payments.pop();
  eq(B.financeOut_(d).stale, false, 'back to the authorized balance: not stale');

  const savesBefore = SAVES.length;
  const r = B.adminFinanceCharge('t', d.quoteNo, 'a12345', false, true);
  eq(r.ok, 1, 'with the code and the authorized balance, it records');
  eq(SAVES.length - savesBefore, 1, 'in ONE save (one PDF rebuild)');
  const fee = (d.lines || []).filter((l) => /^Admin fee/.test(l.label));
  eq(fee.length && [fee[0].sec, fee[0].amt], ['Adjustments', q.fee], 'the admin fee is one Adjustments line');
  eq((d.manual && d.manual.adjustments || []).filter((a) => /^Admin fee/.test(a.label)).length, 1,
    'and in the manual journal, so a re-price replays it');
  const pay = d.payments[d.payments.length - 1];
  eq(pay.amt, q.total, 'the payment is exactly the authorized total');
  eq(/^Synchrony 12 months — approval A12345$/.test(pay.method), true, 'labelled with the plan and the approval code');
  eq(Math.abs(Number(d.total) - B.paymentsTotal_(d)) < 0.005, true, 'which leaves nothing owing');
  eq(d.finance.disclosure && d.finance.disclosure.state, 'needed', 'the rate disclosure is flagged to sign');
  eq(B.adminFinanceCharge('t', d.quoteNo, 'A12345', false, true).ok, 0, 'a second press is refused — no double payment');
  eq(B.financeServe_(AUTH({ term: 'syf6' })).ok, 0, 'once charged, the customer cannot change plans online');

  eq(B.adminFinanceDisclosure('t', d.quoteNo, 'digital').ok, 1, 'a digital copy can be marked');
  eq(B.financeOut_(d).disclosure.state, 'digital', '— and it is still owed in person');
  eq(B.adminFinanceDisclosure('t', d.quoteNo, 'inperson').ok, 1, 'signed in person closes it');
  eq(B.adminFinanceDisclosure('t', d.quoteNo, 'lost').ok, 0, 'an unknown state is refused');
}

console.log('=== by phone, without an online authorization ===');
{
  const d = quote({ payments: [], lines: [{ sec: 'Storage', label: 'Inside', amt: 1000 }] });
  B.setCtx(ctxFor(d));
  B.financeServe_({ quote: d.quoteNo, ln: 'fixture', step: 'apply', term: 'syf6' });
  eq(B.adminFinanceCharge('t', d.quoteNo, 'B777', false, false).ok, 0, 'not authorized online and not by phone: refused');
  const r = B.adminFinanceCharge('t', d.quoteNo, 'B777', true, false);
  eq(r.ok, 1, 'staff tick "authorized by phone": recorded');
  eq(d.finance.charged.authorized, 'phone', 'and it says so');
  eq(d.payments[0].amt, P.financeQuote(1000, 'syf6').total, 'for the plan priced on what was owed');
}

console.log('=== the page ===');
{
  hasnt(page, 'financeQuote(', 'the page never works out a fee itself — it draws the server\'s figures');
  has(page, "step: 'authorize'", 'the authorization goes by POST');
  has(page, "step: 'apply'", 'and so does the apply note');
  hasnt(page, 'term=', 'nothing is ever a GET parameter a link scanner could follow');
  has(page, "res._api !== 'finance'", 'a reply that is not the finance answer is treated as a failure');
  if (/\bSSN\b|social security|id="aAcct|id="aSsn/i.test(page.replace(/never ask for your account number|never an SSN|never an account number/gi, '')))
    fail('the page asks for an SSN or an account number');
  else ok('the page never asks for an SSN or an account number');
  has(page, "window.open(DATA.applyUrl, '_blank')", 'the application opens in a new tab, so this page is still here to come back to');
}

if (bad) { console.error('FAIL: ' + bad + ' problem(s) with Synchrony financing'); process.exit(1); }
console.log('financing holds: fee table to the cent, server-priced, chosen by POST, fee added once');
