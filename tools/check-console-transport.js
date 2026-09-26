#!/usr/bin/env node
/* The console API answers on two verbs. Prove the rules that makes safe.
   ---------------------------------------------------------------------------
   Background: the console's POSTs started being answered by doGet — the body
   was lost in transit, the request fell through to the customer quote-loader,
   and staff were told to enter "your quote number and last name" to look up a
   quote they already had open. The console now retries read-only calls over
   GET, which means the server must serve the console API on GET too.

   That is a bigger surface, so three things have to hold, and a grep cannot
   show any of them:

   1. A GET naming a WRITE is refused by the server. Not merely absent from the
      client's retry list — refused, because the client is not the only thing
      that can build a URL, and because the retry makes GETs repeatable by
      construction. A repeated payment is the failure this prevents.
   2. Every reply carries the `_api: 'console'` stamp. It is the only way the
      console can tell "the server said no" from "the server never heard me".
   3. The two sides agree: the console's retry list matches the server's
      allow-list, and the console's "this call was lost" detector actually
      matches the message the customer loader really returns. That detector
      matching on wording is the fragile part, so it is pinned here against the
      real strings rather than trusted.

   Everything below runs the real code out of the real files. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  OK   ' + m);

/* ---- stand the backend up ---- */
const out = [];
const ctx = {
  console,
  ContentService: {
    MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
    createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } })
  },
  HtmlService: { createHtmlOutput: (h) => ({ _html: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => { throw new Error('the spreadsheet must not be touched by this guard'); } },
  Utilities: {}, GmailApp: {}, DriveApp: {}, ScriptApp: {}, UrlFetchApp: {}, Session: {}, CacheService: {}, LockService: {}
};
vm.createContext(ctx);
vm.runInContext(GS, ctx, { filename: 'quote-logger-apps-script.gs' });

const reply = (res) => JSON.parse(res._text);
/* `const` declarations do not become properties of a VM's global object, so
   the allow-list is read by evaluating its name rather than off the sandbox. */
const GET_FNS = vm.runInContext('CONSOLE_GET_FNS_', ctx);

/* Every admin* entry point the map can reach is replaced with a recorder, so
   a dispatch that should have been refused is visible as a call that happened
   rather than inferred from a message. */
const called = [];
Object.keys(ctx).forEach((k) => {
  if (/^admin[A-Z]/.test(k) && typeof ctx[k] === 'function') {
    ctx[k] = function () { called.push(k); return { ok: 1, ran: k }; };
  }
});

/* ---- 1. writes are refused on GET, and never reach their function ---- */
const WRITES = ['pay', 'adjust', 'lateFee', 'editLine', 'penalty', 'servicesApply', 'hho', 'keysApply', 'dimsApply',
  'staffNote', 'sendEmail', 'setSeasonDone', 'priceRequest', 'uploadPhoto', 'uploadContract',
  'setPerm', 'resetPin', 'addStaff', 'removeStaff', 'setAutoPause', 'backupRestore',
  'bulkSend', 'repriceApply', 'importApply', 'deleteQuote'];

let leaked = [];
WRITES.forEach((fn) => {
  called.length = 0;
  const r = reply(ctx.consoleServe_({ fn: fn, token: 't', args: ['QW-26-1255', 100, 'Cash', 0] }, 'GET'));
  if (r.ok !== 0 || called.length) leaked.push(fn + (called.length ? ' (ran ' + called.join(',') + ')' : ''));
  if (GET_FNS[fn]) leaked.push(fn + ' (on the GET allow-list)');
});
if (leaked.length) fail('these writes are reachable over GET: ' + leaked.join(', '));
else ok('every write is refused on GET and never reaches its function (' + WRITES.length + ' checked)');

/* The same names must still work on POST — a refusal that also breaks the
   normal path is not a fix. */
const brokenPost = WRITES.filter((fn) => {
  called.length = 0;
  const r = reply(ctx.consoleServe_({ fn: fn, token: 't', args: [] }, 'POST'));
  return r.ok !== 1 || called.length !== 1;
});
if (brokenPost.length) fail('these writes stopped working on POST: ' + brokenPost.join(', '));
else ok('every write still dispatches normally on POST');

/* ---- 2. reads do answer on GET ---- */
const brokenGet = Object.keys(GET_FNS).filter((fn) => {
  called.length = 0;
  const r = reply(ctx.consoleServe_({ fn: fn, token: 't', args: [] }, 'GET'));
  return r.ok !== 1 || called.length !== 1;
});
if (brokenGet.length) fail('these allow-listed reads do not dispatch on GET: ' + brokenGet.join(', '));
else ok('all ' + Object.keys(GET_FNS).length + ' allow-listed reads answer on GET');

/* ---- 3. every reply carries the stamp ---- */
const stamps = [
  ['a normal answer', ctx.consoleServe_({ fn: 'lookup', token: 't', args: ['QW-26-1255'] }, 'POST')],
  ['an unknown function', ctx.consoleServe_({ fn: 'nope', token: 't', args: [] }, 'POST')],
  ['a refused GET', ctx.consoleServe_({ fn: 'pay', token: 't', args: [] }, 'GET')],
  ['a thrown error', (function () {
    ctx.adminLookup = function () { throw new Error('boom'); };
    const r = ctx.consoleServe_({ fn: 'lookup', token: 't', args: ['x'] }, 'POST');
    ctx.adminLookup = function () { called.push('adminLookup'); return { ok: 1 }; };
    return r;
  })()],
  ['a function returning nothing', (function () {
    ctx.adminAutoPause = function () { return undefined; };
    const r = ctx.consoleServe_({ fn: 'autoPause', token: 't', args: [] }, 'POST');
    ctx.adminAutoPause = function () { called.push('adminAutoPause'); return { ok: 1 }; };
    return r;
  })()]
];
const unstamped = stamps.filter(([, res]) => reply(res)._api !== 'console').map(([w]) => w);
if (unstamped.length) fail('these replies carry no _api stamp: ' + unstamped.join(', '));
else ok('every reply carries the _api stamp, including errors and refusals');

/* ---- 4. doGet routes the console API, and leaves the customer path alone ---- */
const asGet = (params) => ctx.doGet({ parameter: params });
const routed = reply(asGet({ api: 'console', fn: 'lookup', token: 't', args: '["QW-26-1255"]' }));
if (routed._api !== 'console' || routed.ok !== 1) fail('doGet does not route ?api=console to the console API');
else ok('doGet routes ?api=console to the console API');

const badArgs = reply(asGet({ api: 'console', fn: 'lookup', token: 't', args: 'not json' }));
if (badArgs._api !== 'console') fail('doGet mishandles unparseable args instead of answering');
else ok('unparseable args still get a console answer, not a crash');

/* The symptom itself: a console call that arrives with nothing must NOT be
   answered by the customer quote-loader any more... */
const emptyConsole = reply(asGet({ api: 'console' }));
if (emptyConsole._api !== 'console' || /quote number and last name/i.test(String(emptyConsole.error || ''))) {
  fail('an empty console GET still falls through to the customer quote-loader');
} else ok('an empty console GET is answered by the console API, not the customer loader');

/* ...while a real customer with no quote number still gets the customer message. */
const customer = JSON.parse(asGet({})._text);
if (!/quote number and last name/i.test(String(customer.error || ''))) {
  fail('the customer quote-loader no longer asks for the quote number and last name');
} else ok('the customer quote-loader is untouched');

/* ---- 5. the two sides agree ---- */
const listMatch = ADMIN.match(/const API_GET_OK=\{([\s\S]*?)\};/);
if (!listMatch) fail('API_GET_OK not found in the console');
else {
  const clientList = (listMatch[1].match(/([A-Za-z_$][\w$]*)\s*:/g) || []).map((x) => x.replace(/\s*:$/, ''));
  const serverList = Object.keys(GET_FNS);
  const onlyClient = clientList.filter((f) => !GET_FNS[f]);
  const onlyServer = serverList.filter((f) => clientList.indexOf(f) < 0);
  if (onlyClient.length) fail('the console retries these over GET but the server refuses them: ' + onlyClient.join(', '));
  else if (onlyServer.length) fail('the server allows these on GET but the console never retries them: ' + onlyServer.join(', '));
  else ok('the console retry list and the server allow-list are the same ' + serverList.length + ' functions');
}

/* The lost-call detector matches on wording. Pin it against the real strings:
   if either message is reworded, this fails instead of the console quietly
   losing the ability to notice a lost call. */
const detector = ADMIN.match(/\/(quote number and last name)\/i/);
if (!detector) fail('the console no longer has a lost-call detector');
else {
  const re = new RegExp(detector[1], 'i');
  const loaderMsgs = (GS.match(/error: '[^']*quote number and last name[^']*'/g) || [])
    .map((m) => m.replace(/^error: '/, '').replace(/'$/, ''));
  if (loaderMsgs.length < 2) fail('expected the customer loader to have both of its "quote number and last name" messages');
  else if (loaderMsgs.some((m) => !re.test(m))) fail('the detector no longer matches a customer-loader message: ' + loaderMsgs.join(' | '));
  else ok('the lost-call detector matches both customer-loader messages');
}

if (bad) { console.error('console transport: ' + bad + ' failure(s)'); process.exit(1); }
console.log('console transport: writes are POST-only, reads survive a lost POST, both sides agree');
