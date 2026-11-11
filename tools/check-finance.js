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
var __PROPS = {};
PropertiesService = { getScriptProperties: function () { return {
  getProperty: function (k) { return __PROPS[k] || null; }, setProperty: function (k, v) { __PROPS[k] = v; } }; } };
LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
ContentService = { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { setMimeType: function () { return JSON.parse(t); } }; } };
return { financeQuote, financeOptions, financeAuthText, FINANCING, buildEmailFor_, financeReply_, financeServe_,
  adminFinanceCharge, adminFinanceDisclosure, financeOut_, financeLinkFor_, paymentsTotal_,
  adminFinanceFollowups, adminFinanceDismiss, finFollowBlocker_, unbuildableMsg_, FIN_FOLLOW_AFTER_MS_,
  financeOfferUrl_, customerEmailHtml_,
  props: function () { return __PROPS; },
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
  has(e && e.html, 'Pay over time with Synchrony', 'money owed: the email offers Synchrony');
  has(e && e.html, 'finance.html?quote=QW-26-9201&amp;ln=Fixture'.replace('&amp;', '&'), 'the button opens their own finance page');
  hasnt(e && e.html, P.FINANCING.applyUrl, 'the email links our page, not Synchrony directly — the plan is picked first');
  const paid = B.buildEmailFor_(quote({ payments: [{ amt: 1000 }] }), 'lastcall', '', '');
  hasnt(paid && paid.html, 'Pay over time with Synchrony', 'paid in full: no Synchrony button');
  const was = B.FINANCING.applyUrl;
  B.FINANCING.applyUrl = '';
  const off = B.buildEmailFor_(quote(), 'lastcall', '', '');
  hasnt(off && off.html, 'Pay over time with Synchrony', 'empty applyUrl: the button is gone');
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

console.log('=== follow-ups: applied, never authorized ===');
{
  B.props().FIN_APPLIED = '{}';
  const d = quote({ quoteNo: 'QW-26-9301', phone: '8155550100', payments: [], lines: [{ sec: 'Storage', label: 'Inside', amt: 1000 }] });
  B.setCtx(ctxFor(d));
  eq(B.buildEmailFor_(d, 'finfollow', 'approved', ''), null, 'no plan picked: no follow-up');
  eq(B.unbuildableMsg_('finfollow', d), B.finFollowBlocker_(d), 'and preview/send give the blocker\'s reason');
  B.financeServe_({ quote: d.quoteNo, ln: 'fixture', step: 'apply', term: 'syf12' });
  const idx = JSON.parse(B.props().FIN_APPLIED);
  eq(Object.keys(idx), ['QW-26-9301'], 'clicking Apply puts them in the follow-up index');
  eq(B.adminFinanceFollowups('t').due.length, 0, 'not on the list inside the first day');
  eq(B.adminFinanceFollowups('t').recent, 1, '— counted as applied recently');
  idx['QW-26-9301'].at = new Date(Date.now() - B.FIN_FOLLOW_AFTER_MS_ - 60000).toISOString();
  B.props().FIN_APPLIED = JSON.stringify(idx);
  const due = B.adminFinanceFollowups('t').due;
  eq(due.length === 1 && due[0].qn, 'QW-26-9301', 'a day later they are on the list');
  eq(!!(due[0].first && due[0].phone), true, 'with the name and phone the Business Center lookup needs');

  const ap = B.buildEmailFor_(d, 'finfollow', 'approved', '');
  has(ap && ap.html, 'one step left', '"approved" says one step left');
  has(ap && ap.html, 'plan=syf12&go=auth', 'and links straight to the authorize step with their plan picked');
  has(ap && ap.html, '$1,044.39', 'with the total priced on what is owed now');
  eq(ap && ap.status, '', 'it sets no status');
  const ny = B.buildEmailFor_(d, 'finfollow', 'notyet', '');
  has(ny && ny.html, 'Pay over time with Synchrony', '"still want to pay over time?" offers the finance link');
  has(ny && ny.html, B.FINANCING && 'Pay online', 'and another way to pay');
  hasnt(ny && ny.html, 'go=auth', 'without jumping to the authorize step');
  hasnt(((ny && ny.html) || '') + ((ap && ap.html) || ''), 'declin', 'neither version ever says declined');

  B.financeServe_(AUTH({ quote: d.quoteNo }));
  eq(Object.keys(JSON.parse(B.props().FIN_APPLIED)).length, 0, 'authorizing takes them off the list');
  eq(B.buildEmailFor_(d, 'finfollow', 'approved', ''), null, 'and there is nothing left to chase');

  const d2 = quote({ quoteNo: 'QW-26-9302', payments: [] });
  B.setCtx(ctxFor(d2));
  B.financeServe_({ quote: d2.quoteNo, ln: 'fixture', step: 'apply', term: 'syf6' });
  eq(Object.keys(JSON.parse(B.props().FIN_APPLIED)), ['QW-26-9302'], 'a second applicant goes on');
  B.adminFinanceDismiss('t', d2.quoteNo);
  eq(Object.keys(JSON.parse(B.props().FIN_APPLIED)).length, 0, '"Not financing" takes them off');
  eq(!!B.financeOut_(d2).dismissed, true, 'and the console shows it');
  B.financeServe_({ quote: d2.quoteNo, ln: 'fixture', step: 'apply', term: 'syf6' });
  eq(Object.keys(JSON.parse(B.props().FIN_APPLIED)), ['QW-26-9302'], 'applying again puts them back');
  B.props().FIN_APPLIED = '{not json';
  eq(B.adminFinanceFollowups('t').due.length, 0, 'a corrupt index reads as an empty list, not an error');
}

console.log('=== invoice emails and the late fee warning ===');
{
  const owed = quote({ payments: [{ amt: 200 }] });
  const url = B.financeOfferUrl_(owed);
  has(url, 'finance.html?quote=QW-26-9201', 'money owed: the invoice emails offer Synchrony');
  eq(B.financeOfferUrl_(quote({ payments: [{ amt: 1000 }] })), '', 'paid in full: no offer');
  eq(B.financeOfferUrl_(quote({ payments: [{ amt: 1100 }] })), '', 'a credit: no offer');
  eq(B.financeOfferUrl_(quote({ storageTab: 'Quote Started' })), '', 'a lead: no offer');
  const authed = quote({ payments: [{ amt: 200 }], finance: { key: 'syf6', auth: { base: 800 } } });
  eq(B.financeOfferUrl_(authed), '', 'already authorized on today\'s balance: no offer — nothing left to do');
  const stale = quote({ payments: [{ amt: 200 }], finance: { key: 'syf6', auth: { base: 700 } } });
  has(B.financeOfferUrl_(stale), 'finance.html', 'authorized on an old balance: offered again, to re-authorize');
  eq(B.financeOfferUrl_(quote({ payments: [{ amt: 200 }], finance: { key: 'syf6', charged: { amt: 1 } } })), '',
    'charged: no offer');

  const base = { firstName: 'Pat', quoteNo: 'QW-26-9201', unit: 'Boat', total: 1000, deposit: 500, paid: 200,
    balance: 800, paidInFull: false, creditDue: 0, payBy: 'Nov 15', quoteUrl: 'https://example.invalid/q' };
  has(B.customerEmailHtml_(Object.assign({}, base, { financeUrl: url })), 'Pay over time with Synchrony',
    'the invoice email carries the button');
  hasnt(B.customerEmailHtml_(Object.assign({}, base, { financeUrl: url, paidInFull: true, balance: 0 })),
    'Pay over time with Synchrony', 'never on a paid-in-full invoice');
  hasnt(B.customerEmailHtml_(base), 'Pay over time with Synchrony', 'and not when the caller has no link');
  /* Every caller passes the same rule — the three builders of invoice email. */
  const calls = gasSrc.split('customerEmailHtml_({').length - 1;
  const passing = (gasSrc.match(/customerEmailHtml_\(\{[\s\S]{0,1200}?financeUrl: [^\n]*financeOfferUrl_\(/g) || []).length;
  const reminder = /finUrl = pdRow \? financeOfferUrl_\([\s\S]{0,400}?customerEmailHtml_\(\{[\s\S]{0,1200}?financeUrl: finUrl/.test(gasSrc);
  eq([calls, passing, reminder], [3, 2, true],
    're-send and every sent quote/invoice/receipt pass financeOfferUrl_; the 10-day reminder passes it too, guarded');

  const lw = B.buildEmailFor_(owed, 'latewarn', '', '');
  has(lw && lw.html, 'Pay over time with Synchrony', 'the late fee warning offers Synchrony');
  const was = B.FINANCING.applyUrl;
  B.FINANCING.applyUrl = '';
  hasnt((B.buildEmailFor_(owed, 'latewarn', '', '') || {}).html, 'Pay over time with Synchrony', 'financing off: gone from the warning');
  hasnt(B.customerEmailHtml_(Object.assign({}, base, { financeUrl: B.financeOfferUrl_(owed) })), 'Pay over time with Synchrony',
    'and from the invoice');
  B.FINANCING.applyUrl = was;
}

console.log('=== everywhere a payment option shows ===');
{
  const owed = quote({ payments: [{ amt: 200 }] });
  const count = (h) => (String(h || '').match(/Pay over time with Synchrony<\/a>/g) || []).length;
  const st = B.buildEmailFor_(owed, 'stored', '', '');
  eq(count(st && st.html), 1, '"We have your unit" with a balance owed: one Synchrony button, beside Pay online');
  const stPaid = B.buildEmailFor_(quote({ payments: [{ amt: 1000 }] }), 'stored', '', '');
  eq(count(stPaid && stPaid.html), 0, '"We have your unit", paid in full: none');
  eq(count((B.buildEmailFor_(owed, 'latewarn', '', '') || {}).html), 1, 'the late fee warning: exactly one, not two');
  /* Every Pay online button the builder writes has Synchrony with it — read
     off the source, because some sit in emails that need a full priced quote
     to build (the firm quote is executed in check-firm-quote.js). */
  const payBtns = (gasSrc.match(/buttonHtml_\(PAYMENT_URL,[\s\S]{0,260}?\)/g) || []).length;
  const withFin = (gasSrc.match(/buttonHtml_\(PAYMENT_URL,[\s\S]{0,400}?(financeButtonHtml_|financeUrl|finUrl)/g) || []).length;
  /* The one Pay online with Synchrony BEFORE it, not after: the "still want
     to pay over time?" follow-up, which leads with Synchrony on purpose. */
  const leadsWithFin = /buttonHtml_\(link, 'Pay over time with Synchrony', '#14293E'\) \+\s*buttonHtml_\(PAYMENT_URL/.test(gasSrc);
  eq([payBtns, withFin, leadsWithFin], [5, 4, true],
    'every Pay online button in the emails has the Synchrony option beside it (4 after, and the follow-up\'s before)');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  has(idx, 'id="finLink"', 'the quote page\'s pay step has the Synchrony link');
  has(idx, "$('#payLink').style.display!=='none'&&!!finUrl()", 'shown exactly when the payment page is offered and financing is on');
  has(idx, "await Promise.race([Promise.resolve(logQuote('Signed & paying — Synchrony'))",
    'it saves the quote and waits before opening the plans (an unsaved quote would be "not found")');
  eq((idx.match(/finSync\(\);/g) || []).length, 4, 'every pay-step branch updates it');
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
  has(page, "q.get('go')", 'the page opens on the authorize step when the email asks it to');
  has(page, "window.open(DATA.applyUrl, '_blank')", 'the application opens in a new tab, so this page is still here to come back to');
}

if (bad) { console.error('FAIL: ' + bad + ' problem(s) with Synchrony financing'); process.exit(1); }
console.log('financing holds: fee table to the cent, server-priced, chosen by POST, fee added once');
