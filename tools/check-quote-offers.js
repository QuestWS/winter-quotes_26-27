#!/usr/bin/env node
/* Staff quotes that wait on the customer — run, not grepped.
   ---------------------------------------------------------------------------
   Chris, Nov 2026: a priced request sits in limbo until the customer accepts
   or declines it. "Here are your quotes" emails them a breakdown and a link;
   on service-quotes.html they Accept, Decline, or ask us to call.

   What has to hold, each executed against the real .gs in a VM:
     PENDING   a freshly priced request is NOT a line and NOT in the total
     LEGACY    a priced request with no status (priced before this) still is
     ACCEPT    accepting puts the line on and moves the total — and a customer
               re-save (engine rebuild + journal replay) lands on the same total
     TWICE     the same answer twice changes nothing (retried POST, double tap)
     DECLINE   declining an accepted one takes the line back off
     WITHDRAW  withdrawing re-opens the request so it can be priced again
     CUSTOMER  the POST refuses to un-accept, stamps its replies, and tells
               service@ about a call request
     EMAIL     the email lists what is waiting, links to the page, and carries
               no answer links (a mail scanner must never accept anything)
     PAGE      the quote page replays the same rule; the answers page posts
   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const OFFERS = fs.readFileSync(path.join(ROOT, 'service-quotes.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

const ctx = {
  console,
  ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
    createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } }) },
  HtmlService: { createHtmlOutput: (h) => ({ _html: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => { throw new Error('the spreadsheet must not be touched by this guard'); } },
  Utilities: {}, GmailApp: {}, DriveApp: {}, ScriptApp: {}, UrlFetchApp: {}, Session: {}, CacheService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  MailApp: {}
};
vm.createContext(ctx);
vm.runInContext(GS, ctx, { filename: 'quote-logger-apps-script.gs' });
const E = ctx;   // the engine is embedded, so its functions are globals here too

const boat = (o) => Object.assign({
  unit: 'boat', hasTrailer: false, isPontoon: false,
  engines: { inboard: { qty: 1, level: 'basic' }, io: { qty: 0, level: 'basic' }, outboard: { qty: 0, level: 'basic' }, jet: { qty: 0, level: 'basic' } },
  loa: 24, beam: 8, lwt: 0, storage: 'outside', retrieval: 'none',
  dtTrans: 0, dtTransom: 0, ballast: 0, addlHeads: 0,
  waterCold: false, waterHead: false, ac: false, genBasic: false, genFull: false,
  wrap: false, inWater: false, powerwash: false, acidWash: false,
  bottomTouch: false, bottomStrip: false, propRefurb: false, extDetail: false,
  washWax: true, intDetail: false, intWipe: false, impeller: false
}, o || {});
/* What a customer save does on the server: engine lines, then the journal. */
function resave(d) {
  const r = E.computeQuote(E.effectiveState_(d));
  d.lines = r.lines.slice();
  d.quotesRequested = r.rq.join('; ');
  E.applyManualOps_(d);
  return d;
}
function fresh(priced) {
  const d = { quoteNo: 'QW-26-1255', firstName: 'Test', lastName: 'Quote', unit: 'Demo Test Boat',
    email: 'x@example.invalid', storageTab: 'Outside', state: boat(), manual: { priced: priced || [] } };
  return resave(d);
}
const total = (d) => Number(d.total || 0);
const hasLine = (d, label) => (d.lines || []).filter((l) => l.label === label).length;
const BASE = total(fresh());
const P = (o) => Object.assign({ rqLabel: 'Wash & wax', label: 'Wash & wax — 24ft', amt: 304, sec: 'Additional services' }, o);

/* ---- PENDING / LEGACY ---- */
{
  const d = fresh([P({ status: 'pending' })]);
  if (!hasLine(d, 'Wash & wax — 24ft') && Math.abs(total(d) - BASE) < 0.005 && !/Wash & wax/.test(d.quotesRequested))
    ok('PENDING: priced request is not a line, total unchanged, request closed');
  else fail('PENDING: line=' + hasLine(d, 'Wash & wax — 24ft') + ' total=' + total(d) + ' base=' + BASE + ' rq=' + d.quotesRequested);
}
{
  const d = fresh([P({})]);
  if (hasLine(d, 'Wash & wax — 24ft') === 1 && Math.abs(total(d) - BASE - 304) < 0.005) ok('LEGACY: no status still reads as accepted');
  else fail('LEGACY: line=' + hasLine(d, 'Wash & wax — 24ft') + ' total=' + total(d));
}
{
  const it = E.itemsToQuoteOf_(fresh([P({ status: 'pending' })]));
  const w = it.filter((t) => t.l === 'Wash & wax')[0];
  if (w && w.s === 'awaiting' && w.a === 304) ok('Items to Quote: a pending quote reads "awaiting" with its price');
  else fail('Items to Quote pending: ' + JSON.stringify(it));
}

/* ---- ACCEPT / TWICE / DECLINE / WITHDRAW ---- */
{
  const d = fresh([P({ status: 'pending' })]);
  const r = E.offerDecide_(d, 'Wash & wax', 'accepted', 'Customer', '');
  const after = total(d);
  const again = E.offerDecide_(d, 'Wash & wax', 'accepted', 'Customer', '');
  const lines1 = hasLine(d, 'Wash & wax — 24ft');
  const re = total(resave(JSON.parse(JSON.stringify(d))));
  if (r.ok && r.changed && Math.abs(after - BASE - 304) < 0.005) ok('ACCEPT: line on, total up by the quoted price');
  else fail('ACCEPT: ' + JSON.stringify({ r: r.ok, ch: r.changed, after, BASE }));
  if (again.ok && !again.changed && lines1 === 1) ok('TWICE: accepting again changes nothing, one line');
  else fail('TWICE: changed=' + again.changed + ' lines=' + lines1);
  if (Math.abs(re - after) < 0.005) ok('ACCEPT survives a customer re-save at the same total');
  else fail('ACCEPT re-save: ' + re + ' vs ' + after);
  const dec = E.offerDecide_(d, 'Wash & wax', 'declined', 'Chris', '');
  if (dec.changed && !hasLine(d, 'Wash & wax — 24ft') && Math.abs(total(d) - BASE) < 0.005) ok('DECLINE after accept: line off, total back');
  else fail('DECLINE: line=' + hasLine(d, 'Wash & wax — 24ft') + ' total=' + total(d));
  const w = E.offerDecide_(d, 'Wash & wax', 'withdraw', 'Chris', '');
  if (w.ok && !E.offersOf(d.manual).length && /Wash & wax/.test(d.quotesRequested)) ok('WITHDRAW: price gone, request open again');
  else fail('WITHDRAW: ' + JSON.stringify({ ok: w.ok, offers: E.offersOf(d.manual), rq: d.quotesRequested }));
}

/* ---- CUSTOMER (the POST) ---- */
{
  const d = fresh([P({ status: 'pending' })]);
  const told = [];
  const saved = [];
  ctx.offersCtx_ = () => ({ d: d, sh: {}, rowNum: 2 });
  ctx.saveQuoteRow_ = (c, st) => { saved.push(st); };
  const COL = vm.runInContext('COL', ctx);   // a const: not a property of the VM's global
  ctx.ctxCell_ = (c, col) => (col === COL.STATUS ? 'Deposit received' : '');
  ctx.invalidateStorageView_ = () => {};
  ctx.auditLog_ = () => {};
  ctx.notifyOfferDecisions_ = (c, done) => { told.push(done.map((x) => x.choice).join('+')); };
  const call = (b) => JSON.parse(ctx.offersServe_(Object.assign({ api: 'offers', quote: '1255', ln: 'quote', item: 'Wash & wax' }, b))._text);
  const bogus = call({ choice: 'withdraw' });
  if (!bogus.ok && bogus._api === 'offers') ok('CUSTOMER: only accept / decline / call; reply stamped _api:offers');
  else fail('CUSTOMER bogus choice: ' + JSON.stringify(bogus));
  const c1 = call({ choice: 'call', note: 'Does that include the cockpit?' });
  if (c1.ok && told.indexOf('call') > -1 && saved[0] === 'Deposit received' && Math.abs(total(d) - BASE) < 0.005)
    ok('CUSTOMER: call request saved, status column kept, service@ told, nothing added');
  else fail('CUSTOMER call: ' + JSON.stringify({ c1, told, saved }));
  const a = call({ choice: 'accepted' });
  const back = call({ choice: 'declined' });
  if (a.ok && /already accepted/.test(back.warn || '') && hasLine(d, 'Wash & wax — 24ft') === 1)
    ok('CUSTOMER: accepted is final from the page — un-accepting is a phone call');
  else fail('CUSTOMER un-accept: ' + JSON.stringify({ a: a.ok, back }));
  if (!/decidedBy|pricedBy/.test(JSON.stringify(a.offers))) ok('CUSTOMER: reply carries no staff names');
  else fail('CUSTOMER reply leaks staff fields: ' + JSON.stringify(a.offers));

  /* BATCH — Chris: one tap and one office email per quote was maddening.
     Three answers in one POST: one save, one email, all three applied. */
  const d2 = fresh([P({ status: 'pending' }),
    P({ rqLabel: 'Impeller change', label: 'Impeller change', amt: 185, status: 'pending' }),
    P({ rqLabel: 'Propeller refurbishment', label: 'Propeller refurbishment', amt: 140, status: 'pending' })]);
  ctx.offersCtx_ = () => ({ d: d2, sh: {}, rowNum: 2 });
  saved.length = 0; told.length = 0;
  const all = call({ item: undefined, note: 'Parts included?', answers: [
    { item: 'Wash & wax', choice: 'accepted' }, { item: 'Impeller change', choice: 'call' },
    { item: 'Propeller refurbishment', choice: 'declined' }] });
  const st = (it) => (all.offers || []).filter((o) => o.item === it)[0].status;
  if (all.ok && saved.length === 1 && told.length === 1 && told[0] === 'accepted+call+declined' &&
      st('Wash & wax') === 'accepted' && st('Impeller change') === 'call' && st('Propeller refurbishment') === 'declined' &&
      Math.abs(total(d2) - total(fresh()) - 304) < 0.005)
    ok('BATCH: three answers, one save, one office email, only the accepted one in the total');
  else fail('BATCH: ' + JSON.stringify({ ok: all.ok, saved: saved.length, told, msg: all.msg, err: all.error }));
  saved.length = 0; told.length = 0;
  const again = call({ answers: [{ item: 'Impeller change', choice: 'call' }] });
  if (again.ok && !saved.length && !told.length) ok('BATCH: a resend of the same answers saves and emails nothing');
  else fail('BATCH resend: ' + JSON.stringify({ saved: saved.length, told }));
}

/* ---- EMAIL ---- */
{
  const none = ctx.buildEmailFor_(fresh([P({ status: 'accepted' })]), 'offers', '', '');
  if (none === null) ok('EMAIL: nothing waiting → no email');
  else fail('EMAIL built with nothing waiting');
  const d = fresh([P({ status: 'pending' })]);
  const e = ctx.buildEmailFor_(d, 'offers', '', '');
  if (e && /service-quotes\.html\?quote=QW-26-1255&ln=Quote/.test(e.html) && /Here's your quote/.test(e.subject) && /\$304\.00/.test(e.html))
    ok('EMAIL: lists the price and links to the answers page');
  else fail('EMAIL: ' + (e ? e.subject : 'null'));
  if (e && !/choice=|action=offers/.test(e.html)) ok('EMAIL: no answer links a scanner could follow');
  else fail('EMAIL carries an answer link');
  if (e && e.status === '') ok('EMAIL: sets no status (money/placement status left alone)');
  else fail('EMAIL status: ' + (e && e.status));
  if (/'offers'/.test(ctx.unbuildableMsg_.toString())) ok('EMAIL: a refusal explains itself');
  else fail('unbuildableMsg_ has no offers reason');
}

/* ---- the GET read writes nothing; the page agrees ---- */
{
  const real = GS.match(/^function offersRead_[\s\S]*?\n}/m)[0] + GS.match(/^function offersCtx_[\s\S]*?\n}/m)[0];
  if (!/offerDecide_|saveQuoteRow_|setValue/.test(real)) ok('READ: ?action=offers writes nothing');
  else fail('READ path writes: ' + real.slice(0, 200));
}
if (/\(MANUAL\.priced\|\|\[\]\)\.filter\(QuestPricing\.offerOnQuote\)/.test(PAGE)) ok('PAGE: quote page replays only accepted quotes');
else fail('index.html computeLines no longer filters priced requests through offerOnQuote');
if (/method: 'POST'/.test(OFFERS) && /api: 'offers'/.test(OFFERS) && /_api !== 'offers'/.test(OFFERS) && /answers: ch\.map/.test(OFFERS)) ok('PAGE: all answers go in one POST and only a stamped reply counts');
else fail('service-quotes.html answer transport changed');
if (/id="em_offers"/.test(ADMIN) && /api\('offerDecision'/.test(ADMIN)) ok('CONSOLE: send button and on-behalf answers present');
else fail('console lost the offers controls');

if (bad) { console.error('\n' + bad + ' failure(s)'); process.exit(1); }
console.log('\nall quote-offer checks passed');
