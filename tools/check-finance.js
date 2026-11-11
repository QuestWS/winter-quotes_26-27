#!/usr/bin/env node
/* Synchrony financing and the admin fee, executed rather than grepped.
   ---------------------------------------------------------------------------
   Money that a customer agrees to on one screen and staff charge on another
   has to be the same number on both, to the cent. So:

     - the engine reproduces Chris's fee table EXACTLY (grossed up: total =
       amount / (1 - pct)), and the copy embedded in the .gs agrees;
     - the last-call email carries the Finance button only when something is
       owed and the apply link is set — empty applyUrl turns it all off;
     - the customer's pick (financeServe_) is stored, mails the office ONCE,
       changes nothing on the quote, refuses unknown plans, and cannot switch
       plans once staff have put the fee on the invoice;
     - the staff button (adminFinanceFee) adds exactly one Adjustments line,
       priced on what is owed now, and refuses a second press;
     - the page draws the server's figures and picks only by POST.

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
notifyFinanceChoice_ = function (ctx, q, was) { __SENT.push({ qn: ctx.d.quoteNo, key: q.key, was: was }); };
saveQuoteRow_ = function (ctx) { __SAVES.push(ctx.d.quoteNo); };
var __CTX = null;
offersCtx_ = function () { return __CTX; };
findQuoteCtx_ = function () { return __CTX; };
LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
ContentService = { MimeType: { JSON: 'json' }, createTextOutput: function (t) { return { setMimeType: function () { return JSON.parse(t); } }; } };
return { financeQuote, financeOptions, FINANCING, buildEmailFor_, financeReply_, financeServe_, adminFinanceFee,
  financeOut_, financeLinkFor_, setCtx: function (c) { __CTX = c; } };`)(SENT, SAVES);

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

console.log('=== the customer picks a plan ===');
const ctxFor = (d) => {
  const cells = {};
  return { d: d, rowNum: 2, sh: { getRange: (r, c) => ({ setValue: (v) => { WRITES.push(c); cells[c] = v; }, getValue: () => cells[c] || '' }) } };
};
{
  const d = quote({ payments: [{ amt: 200 }] });   // owes $800
  const totalBefore = d.total;
  B.setCtx(ctxFor(d));
  const r = B.financeServe_({ quote: d.quoteNo, ln: 'fixture', term: 'syf12' });
  eq(r.ok, 1, 'a real plan is accepted');
  eq(r._api, 'finance', 'and stamped as the finance answer');
  eq(d.finance && [d.finance.key, d.finance.base, d.finance.total], ['syf12', 800, P.financeQuote(800, 'syf12').total],
    'stored, priced on what is owed now ($800), not the quote total');
  eq(d.total, totalBefore, 'picking a plan does not move the quote total');
  eq(SAVES.length, 0, 'nor rebuild the quote (no PDF, no status change)');
  eq(SENT.length, 1, 'service@ is told once');
  eq(r.applyUrl, P.FINANCING.applyUrl, 'the reply carries the Synchrony apply link for the redirect');
  B.financeServe_({ quote: d.quoteNo, ln: 'fixture', term: 'syf12' });
  eq(SENT.length, 1, 'the same plan again emails nobody');
  B.financeServe_({ quote: d.quoteNo, ln: 'fixture', term: 'syf6' });
  eq(SENT.length, 2, 'a different plan is a new choice, and the office hears about it');
  eq(SENT[1].was, P.financeQuote(800, 'syf12').label, 'with what they had picked before');
  eq(B.financeServe_({ quote: d.quoteNo, ln: 'fixture', term: 'syf99' }).ok, 0, 'an unknown plan is refused');
  const pub = B.financeReply_(d);
  eq(Object.keys(pub).sort(), ['applyUrl', 'balance', 'chosen', 'disclosure', 'feeApplied', 'feeLabel', 'firstName',
    'ok', 'options', 'quoteNo', 'quoteUrl', 'term', 'unit'], 'the page is told nothing beyond its own job');
  B.setCtx(null);
  eq(B.financeServe_({ quote: 'QW-26-0000', ln: 'x', term: 'syf6' }).ok, 0, 'no matching quote: refused');
  B.setCtx(ctxFor(quote({ payments: [{ amt: 1000 }] })));
  eq(B.financeServe_({ quote: 'QW-26-9201', ln: 'fixture', term: 'syf6' }).ok, 0, 'nothing owed: nothing to finance');
}

console.log('=== staff add the admin fee ===');
{
  const d = quote({ payments: [{ amt: 200 }], lines: [{ sec: 'Storage', label: 'Inside', amt: 1000 }] });
  B.setCtx(ctxFor(d));
  eq(B.adminFinanceFee('t', d.quoteNo).ok, 0, 'no plan picked: nothing to add');
  B.financeServe_({ quote: d.quoteNo, ln: 'fixture', term: 'syf12' });
  const want = P.financeQuote(800, 'syf12');
  const r = B.adminFinanceFee('t', d.quoteNo);
  eq(r.ok, 1, 'the fee goes on');
  const line = (d.lines || []).filter((l) => /^Admin fee/.test(l.label));
  eq(line.length, 1, 'as exactly one line');
  eq(line[0] && [line[0].sec, line[0].amt], ['Adjustments', want.fee], 'in Adjustments, for the fee on the $800 owed');
  eq((d.manual && d.manual.adjustments || []).filter((a) => /^Admin fee/.test(a.label)).length, 1,
    'and in the manual journal, so a re-price replays it');
  eq(Math.round((Number(d.total) - 200) * 100) / 100, want.total, 'the new balance is exactly the amount to charge');
  eq(B.adminFinanceFee('t', d.quoteNo).ok, 0, 'a second press is refused — no fee on the fee');
  eq(B.financeServe_({ quote: d.quoteNo, ln: 'fixture', term: 'syf6' }).ok, 0,
    'once the fee is on the invoice the customer cannot switch plans online');
  const out = B.financeOut_(d);
  eq(!!(out && out.feeApplied), true, 'the console sees that it is applied');
}

console.log('=== the page ===');
{
  hasnt(page, 'financeQuote(', 'the page never works out a fee itself — it draws the server\'s figures');
  has(page, "body = { api: 'finance'", 'the choice goes by POST');
  hasnt(page, 'term=', 'and never as a GET parameter a link scanner could follow');
  has(page, "res._api !== 'finance'", 'a reply that is not the finance answer is treated as a failure');
}

if (bad) { console.error('FAIL: ' + bad + ' problem(s) with Synchrony financing'); process.exit(1); }
console.log('financing holds: fee table to the cent, server-priced, chosen by POST, fee added once');
