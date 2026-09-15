#!/usr/bin/env node
/* Prove the provisional-pricing disclaimer is on every customer-facing
   surface while rates are estimates — and gone from all of them the moment
   PRICING.provisional flips to false.
   ---------------------------------------------------------------------------
   Why this exists:

   The promise made to Chris is "one edit turns all the disclaimers off". A
   grep cannot check that promise. A surface that hardcodes its own wording
   would still read correctly today and would still be saying "2025–2026
   estimate" next spring, long after the rates were updated — the exact
   failure this file exists to prevent, and the reason none of the wording
   lives in index.html, the PDF or the emails.

   So this runs both halves for real: it executes the engine and the Apps
   Script with the flag TRUE and asserts the disclaimer renders, then patches
   the flag to FALSE in a copy of the source, executes the same builders
   again, and asserts every trace of it is gone and the ordinary lock-in
   wording is back. The page is checked structurally (it needs a DOM to run):
   the two containers exist, they carry no wording of their own, the banner
   sits outside every step panel, and the script reads both engine helpers.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'pricing-engine.js');
const GAS = path.join(ROOT, 'quote-logger-apps-script.gs');
const PAGE = path.join(ROOT, 'index.html');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok   ' + m);
const has = (hay, needle, what) => {
  if (String(hay).indexOf(needle) > -1) ok(what);
  else fail(what + ' — missing ' + JSON.stringify(needle));
};
const hasnt = (hay, needle, what) => {
  if (String(hay).indexOf(needle) < 0) ok(what);
  else fail(what + ' — still contains ' + JSON.stringify(needle));
};

/* Flip the flag in a COPY of the source and run that copy. Patching the text
   rather than the loaded object is deliberate: it is exactly the edit Chris
   makes at the rollover, so this proves that edit and nothing else. */
function patched(src, provisional) {
  if (provisional) return src;
  const from = 'provisional: true';
  if (src.split(from).length - 1 !== 1) {
    console.error('FAIL: expected exactly one "' + from + '" to flip — the flag moved or was duplicated');
    process.exit(1);
  }
  return src.replace(from, 'provisional: false');
}

function loadEngine(provisional) {
  const src = patched(fs.readFileSync(ENGINE, 'utf8'), provisional);
  return new Function('module', src + '\nreturn module.exports;')({ exports: {} });
}

/* The backend, executed the way check-embedded-engine.js executes the engine
   block: as bare top-level code, so anything the builders actually need has
   to travel with them. */
function loadBackend(provisional) {
  const src = patched(fs.readFileSync(GAS, 'utf8'), provisional);
  return new Function(src + '\nreturn { quoteHtml_, customerEmailHtml_, noticeHtml_ };')();
}

/* A quote with a deposit owing — the case that carries every disclaimer. */
const FIXTURE = {
  quoteNo: 'QW-26-0000', owner: 'Fixture Owner', firstName: 'Fixture', lastName: 'Owner',
  email: 'fixture@example.com', phone: '8155550123', unit: 'Boat',
  total: 1200, totalCC: 1236, totalLate: 1320, totalLateCC: 1359.6, deposit: 500,
  lines: [{ sec: 'Winterization', label: 'Basic winterization', amt: 298 }],
  payments: [], state: { storage: 'outside' },
  season: { label: '2025–2026', payBy: 'November 15, 2025', payByShort: 'Nov 15', lateStart: 'Dec 1, 2025' }
};
const emailOpts = {
  firstName: 'Fixture', quoteNo: 'QW-26-0000', unit: 'Boat',
  total: 1200, deposit: 500, paid: 0, payBy: 'Nov 15'
};

console.log('=== while pricing is provisional ===');
const E = loadEngine(true);
const B = loadBackend(true);
const N = E.pricingNotice();
const C = E.lockinCopy();

if (!N) {
  console.error('FAIL: PRICING.provisional is false in the committed source.');
  console.error('      If the rollover has happened, that is correct — re-run this guard');
  console.error('      with the flag true to check the disclaimer half, and keep the');
  console.error('      "pricing is current" half below passing.');
} else {
  ['heading', 'body', 'short'].forEach(function (k) {
    if (N[k] && String(N[k]).trim().length > 40) ok('notice.' + k + ' says something');
    else fail('notice.' + k + ' is empty or too short to be a disclaimer');
  });
  /* The three things Chris asked the wording to carry. */
  has(N.body, E.PRICING.ratesLabel, 'banner names the season the rates came from');
  has(N.body, E.PRICING.nextLabel, 'banner names the season being updated to');
  has(N.body, 'does not lock in the prices shown', 'banner says a deposit is not a price lock');
  has(N.short, 'Estimate only', 'short form leads with "estimate only"');
  has(N.short, 'does not lock in the prices', 'short form says a deposit is not a price lock');

  /* No lock-in promise anywhere in the copy while we cannot honour a price. */
  Object.keys(C).forEach(function (k) {
    const v = String(C[k] || '');
    if (/lock(s)? in|lock it in/i.test(v)) fail('lockinCopy().' + k + ' still promises a price lock: ' + JSON.stringify(v));
  });
  ok('no lock-in promise in lockinCopy()');
  has(C.depositRow, 'reserve your spot', 'ticket/PDF deposit row reserves a spot');
  has(C.depositEmail, 'reserve your spot', 'email deposit row reserves a spot');

  /* The fine-print sentence must not promise that paying holds a price. */
  const pv = E.pricesValidSentence();
  hasnt(pv, 'Prices shown are valid', 'fine print does not promise valid prices');
  has(pv, 'does not hold the prices shown', 'fine print says paying does not hold a price');
  has(E.pricesValidSentence('November 15, 2026'), 'November 15, 2026', 'an older quote keeps its own pay-by date');

  const pdf = B.quoteHtml_(FIXTURE);
  has(pdf, N.heading, 'PDF carries the banner heading');
  has(pdf, N.body, 'PDF banner carries the whole notice');
  has(pdf, pv, 'PDF fine print says paying does not hold a price');
  has(pdf, C.depositRow, 'PDF deposit row uses the reserve wording');
  hasnt(pdf, 'Deposit due today to lock in', 'PDF has no lock-in deposit row');

  /* The two terms paragraphs with no price-validity sentence of their own --
     a quote due in full today, and one already paid -- get the short form
     appended instead, so no PDF is missing it and none repeats it. */
  const pdfDue = B.quoteHtml_(Object.assign({}, FIXTURE, { total: 500, deposit: 500 }));
  has(pdfDue, N.short, 'a due-today PDF carries the short form in its fine print');
  const pdfPaid = B.quoteHtml_(Object.assign({}, FIXTURE, { payments: [{ amt: 1200, method: 'Check' }] }));
  has(pdfPaid, N.short, 'a paid-in-full PDF carries the short form in its fine print');
  [['due-today', pdfDue], ['paid-in-full', pdfPaid]].forEach(function (pair) {
    const n = pair[1].split(N.short).length - 1;
    if (n === 1) ok('the ' + pair[0] + ' PDF says it once, not twice');
    else fail('the ' + pair[0] + ' PDF carries the short form ' + n + ' times');
  });

  const mail = B.customerEmailHtml_(emailOpts);
  has(mail, N.heading, 'customer email carries the notice');
  has(mail, C.depositEmail, 'customer email deposit row uses the reserve wording');
  hasnt(mail, 'Deposit to lock in your spot', 'customer email has no lock-in deposit row');

  /* An operational notice that prints a balance is quoting an estimate too. */
  const notice = B.noticeHtml_({ firstName: 'Fixture', quoteNo: 'QW-26-0000', unit: 'Boat', total: 1200, payments: [{ amt: 200 }] },
    '<p>Time to talk about spring.</p>', '', true);
  has(notice, N.short, 'a notice that shows a balance carries the short form');
}

console.log('=== once pricing is updated (flag flipped to false) ===');
const E2 = loadEngine(false);
const B2 = loadBackend(false);
if (E2.pricingNotice() !== null) fail('pricingNotice() must return null once pricing is current');
else ok('pricingNotice() returns null');

const C2 = E2.lockinCopy();
has(C2.signHeading, 'lock it in', 'the ordinary sign heading comes back');
has(C2.depositRow, 'Deposit due today to lock in', 'the ordinary ticket/PDF deposit row comes back');
has(C2.depositEmail, 'Deposit to lock in your spot', 'the ordinary email deposit row comes back');
if (C2.reservedNote === '') ok('no extra retrieval-window sentence once rates are real');
else fail('lockinCopy().reservedNote should be empty when pricing is current');

/* The disclaimer must be GONE, not merely shortened — check for the phrases
   that only ever come from pricingNotice(). */
has(E2.pricesValidSentence(), 'Prices shown are valid when balances are settled in full',
    'the ordinary price-validity sentence comes back');

const pdf2 = B2.quoteHtml_(FIXTURE);
const mail2 = B2.customerEmailHtml_(emailOpts);
const notice2 = B2.noticeHtml_({ firstName: 'Fixture', quoteNo: 'QW-26-0000', unit: 'Boat', total: 1200, payments: [{ amt: 200 }] },
  '<p>Time to talk about spring.</p>', '', true);
[['PDF', pdf2], ['customer email', mail2], ['balance notice', notice2]].forEach(function (pair) {
  ['Estimate only', 'Heads up', 'are not published yet', 'reserve your spot',
   'does not hold the prices shown'].forEach(function (frag) {
    hasnt(pair[1], frag, pair[0] + ' drops "' + frag + '"');
  });
});

console.log('=== the quote page ===');
const page = fs.readFileSync(PAGE, 'utf8');
has(page, 'id="pricingNotice"', 'page has the banner container');
has(page, 'id="ticketNotice"', 'ticket has its own notice container (the printed copy)');
has(page, 'applyPricingNotice()', 'page fills them at init');
has(page, 'pricingNotice()', 'page reads the notice from the engine');
has(page, 'lockinCopy()', 'page reads the lock-in wording from the engine');
has(page, 'pricesValidSentence()', 'page reads the price-validity sentence from the engine');
hasnt(page, 'Prices shown are valid', 'page keeps no second copy of the price-validity promise');

/* Static regardless of step: the banner must sit outside every step panel,
   which on this page means before the first one. */
const iBanner = page.indexOf('id="pricingNotice"');
const iFirstPanel = page.indexOf('<section class="panel"');
if (iBanner > -1 && iFirstPanel > -1 && iBanner < iFirstPanel) ok('banner is above the steps — shown on every step');
else fail('banner must sit outside the step panels, above the first one');

/* Empty in the markup: the wording has exactly one source. */
if (/id="pricingNotice"[^>]*>\s*<\/div>/.test(page)) ok('banner carries no wording of its own');
else fail('banner must be empty in the markup — its text comes from pricingNotice()');

/* Nothing anywhere may carry a second copy of the disclaimer. In the .gs the
   only legitimate home is inside the engine block. */
['Estimate only', 'are not published yet', 'Heads up — these prices'].forEach(function (frag) {
  hasnt(page, frag, 'page does not hardcode "' + frag + '"');
});
const gas = fs.readFileSync(GAS, 'utf8');
const a = gas.indexOf('// ENGINE-START'), b = gas.indexOf('// ENGINE-END');
const outside = gas.slice(0, a) + gas.slice(b);
['Estimate only', 'are not published yet', 'Heads up — these prices'].forEach(function (frag) {
  hasnt(outside, frag, 'backend does not hardcode "' + frag + '" outside the engine');
});

if (bad) {
  console.error('FAIL: ' + bad + ' problem(s) with the provisional-pricing disclaimer');
  process.exit(1);
}
console.log('provisional-pricing disclaimer: present on every surface, and removed by one flag');
