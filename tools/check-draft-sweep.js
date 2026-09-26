#!/usr/bin/env node
/* Drafts instead of sends — executed against a fake Gmail and a fake sheet.
   ---------------------------------------------------------------------------
   Creating a draft must NOT do what a send does (no status, no reminder-hold
   release, no Import-tab move), and the sweep must do exactly that only when
   the draft is really gone AND really in Sent. The failure modes that matter:

     - a draft written off as "discarded" the evening it was sent, because
       Gmail's search index had not caught up — the quote never releases;
     - an unreachable Gmail turning into a hundred "discarded" marks;
     - a stale draft (quote changed after drafting) sent with old numbers and
       nobody told;
     - a second draft, or a scripted send, on top of a draft already waiting
       — the customer gets it twice;
     - a draft without service@ on it, or with the wrong reply-to.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

function fn(name) {
  const one = gas.match(new RegExp('^function ' + name + '\\b.*}\\s*$', 'm'));
  if (one) return one[0];
  const m = gas.match(new RegExp('^function ' + name + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + name);
  return m[0];
}
const decl = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error('missing const ' + n);
  return m[0];
};

/* ---- the sheet ---------------------------------------------------------- */
const COL = { QN: 3, STATUS: 6, EMAIL: 9, PAYLOAD: 21 };
const HL = 23;
const DAY = 24 * 3600 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const draftEntry = (id, subject, total, extra) => Object.assign(
  { ts: 'yesterday', kind: 'firmquote', to: 'x@x', by: 'Chris',
    draft: { id: id, state: 'open', subject: subject, status: 'Firm quote sent', total: total, made: iso(DAY) } }, extra || {});

const Q = {
  A: { quoteNo: 'Q-A', lastName: 'Adams', email: 'a@x', total: '100.00', storageTab: 'Inside',
       emailLog: [draftEntry('dA', 'Your firm quote · Q-A', 100)] },                       // still in Drafts, unchanged
  B: { quoteNo: 'Q-B', lastName: 'Boone', email: 'b@x', total: '140.00', storageTab: 'Inside',
       emailLog: [draftEntry('dB', 'Your firm quote · Q-B', 100)] },                       // still in Drafts, quote moved on
  C: { quoteNo: 'Q-C', lastName: 'Cline', email: 'c@x', total: '100.00', storageTab: 'Inside',
       emailLog: [draftEntry('dC', 'Your firm quote · Q-C', 100)] },                       // gone, in Sent
  D: { quoteNo: 'Q-D', lastName: 'Doyle', email: 'd@x', total: '100.00', storageTab: 'Inside',
       emailLog: [draftEntry('dD', 'Your firm quote · Q-D', 100)] },                       // gone, not in Sent, first miss
  E: { quoteNo: 'Q-E', lastName: 'Ewing', email: 'e@x', total: '100.00', storageTab: 'Inside',
       emailLog: [(function () { const e = draftEntry('dE', 'Your firm quote · Q-E', 100);
                                 e.draft.missing = iso(2 * DAY); return e; })()] },       // gone, missing for two days
  F: { quoteNo: 'Q-F', lastName: 'Frost', email: 'f@x', total: '100.00', storageTab: 'Inside',
       emailLog: [{ ts: 'x', kind: 'spring', to: 'f@x', by: 'Chris' }] },                  // no draft at all
  G: { quoteNo: 'Q-G', lastName: 'Grant', email: 'g@x', total: '100.00', storageTab: 'Inside',
       emailLog: [draftEntry('dG', 'Your firm quote · Q-G', 100)] },                       // gone; Gmail search throws
  /* An older draft that DID go and a fresh send: neither is "open", so the
     sweep must not touch this row at all. */
  H: { quoteNo: 'Q-H', lastName: 'Hyde', email: 'h@x', total: '100.00', storageTab: 'Inside',
       emailLog: [draftEntry('dH', 'Your firm quote · Q-H', 100, {}), { ts: 'x', kind: 'firmquote', to: 'h@x', by: 'Chris' }] }
};
Q.H.emailLog[0].draft.state = 'sent';

const writes = { payload: {}, status: {} };
function makeSheet(name, quotes) {
  const rows = quotes.map((d) => { const r = new Array(HL).fill(''); r[COL.QN - 1] = d.quoteNo;
    r[COL.EMAIL - 1] = d.email; r[COL.PAYLOAD - 1] = JSON.stringify(d); return r; });
  const sh = {
    getName: () => name,
    getLastRow: () => rows.length + 1,
    getRange: function (r, c, nr, nc) {
      if (nr === undefined) {
        return {
          getValue: () => (r === 1 && c === 3) ? 'Quote #' : (rows[r - 2] ? rows[r - 2][c - 1] : ''),
          setValue: (v) => {
            const qn = rows[r - 2][COL.QN - 1];
            rows[r - 2][c - 1] = v;
            if (c === COL.PAYLOAD) writes.payload[qn] = (writes.payload[qn] || 0) + 1;
            if (c === COL.STATUS) writes.status[qn] = v;
          }
        };
      }
      return { getValues: () => rows.slice(r - 2, r - 2 + nr).map((row) => row.slice(c - 1, c - 1 + nc)) };
    },
    _rows: rows
  };
  return sh;
}
const SHEETS = [makeSheet('Inside', [Q.A, Q.B, Q.C, Q.D, Q.E, Q.F, Q.G, Q.H])];
const SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => SHEETS }) };

/* ---- Gmail -------------------------------------------------------------- */
const gmail = { drafts: ['dA', 'dB'], sentSubjects: { 'Q-C': 'Your firm quote · Q-C' }, throwFor: { 'Q-G': 1 }, created: [] };
const GmailApp = {
  getDrafts: () => gmail.drafts.map((id) => ({ getId: () => id })),
  search: (q) => {
    const qn = Object.keys(gmail.throwFor).find((k) => q.indexOf('"' + k + '"') > -1);
    if (qn) throw new Error('Gmail is having a moment');
    const hit = Object.keys(gmail.sentSubjects).find((k) => q.indexOf('"' + k + '"') > -1);
    if (!hit) return [];
    return [{ getMessages: () => [{ getSubject: () => gmail.sentSubjects[hit], getDate: () => new Date() }] }];
  },
  createDraft: (to, subject, body, opts) => { gmail.created.push({ to, subject, opts }); return { getId: () => 'new-' + gmail.created.length }; },
  sendEmail: () => { throw new Error('the draft path must never send'); }
};

/* ---- the real functions, with the sheet-facing helpers stubbed ---------- */
const recorded = [];
const B = new Function('SpreadsheetApp', 'GmailApp', 'RECORDED', [
  decl('COL'), decl('HEADERS'), decl('REPLY_TO'), decl('NOTIFY_EMAIL'), decl('FROM_ALIAS'),
  "const STARTED_TAB='Quote Started'; const IMPORT_TAB='Import';",
  fn('isStartedTab_'), fn('isImportTab_'), fn('isOffstageTab_'),
  decl('DRAFT_SEARCH_DAYS_'), decl('DRAFT_MISSING_GRACE_MS_'),
  fn('openDraftFor_'), fn('draftOpts_'), fn('draftWasSent_'), fn('draftSweep_'), fn('adminDraftSweep'),
  fn('adminBulkDraft'), fn('bulkTargets_'), fn('bulkFilterTargets_'),
  "const BULK_KINDS_ = { firmquote: { label: 'Firm quote', skipTabs: [], status: 'Firm quote sent', includeImports: true, blocker: function () { return ''; } } };",
  "function buildEmailFor_(d, kind) { return { subject: 'Your firm quote · ' + d.quoteNo, html: '<p>hi</p>', status: 'Firm quote sent', attachPdf: true }; }",
  "function getLogoBlob_() { return 'LOGO'; } function getPdfBlob_(qn) { return 'PDF-' + qn; }",
  "function requireAuth_() { return { name: 'Chris', admin: true }; }",
  "function auditLog_() {} function invalidateStorageView_() {}",
  /* findQuoteCtx_ reads the row fresh, like the real one. */
  "function findQuoteCtx_(qn) { for (const sh of SpreadsheetApp.getActiveSpreadsheet().getSheets()) { for (let i = 0; i < sh._rows.length; i++) { if (sh._rows[i][COL.QN - 1] === qn) return { sh: sh, rowNum: i + 2, d: JSON.parse(sh._rows[i][COL.PAYLOAD - 1]) }; } } return null; }",
  "function recordEmail_(sh, rowNum, d, kind, by) { RECORDED.push({ qn: d.quoteNo, kind: kind, by: by, states: (d.emailLog || []).map(function (e) { return e.draft ? e.draft.state : 'send'; }) }); sh.getRange(rowNum, COL.PAYLOAD).setValue(JSON.stringify(d)); return null; }",
  'return { draftSweep_, adminDraftSweep, adminBulkDraft, openDraftFor_ };'
].join('\n'))(SpreadsheetApp, GmailApp, recorded);

/* ===================================================================== */
console.log('=== the sweep ===');
const r = B.draftSweep_('Guard');
const payloadOf = (qn) => JSON.parse(SHEETS[0]._rows.find((row) => row[COL.QN - 1] === qn)[COL.PAYLOAD - 1]);
const stateOf = (qn) => payloadOf(qn).emailLog[0].draft;

if (stateOf('Q-A').state === 'open' && !stateOf('Q-A').stale) ok('a draft still in Drafts stays open');
else fail('Q-A (still in Drafts) is ' + JSON.stringify(stateOf('Q-A')));
if (writes.payload['Q-A']) fail('an unchanged draft still rewrote its payload'); else ok('an unchanged draft writes nothing');

if (stateOf('Q-B').state === 'open' && stateOf('Q-B').stale === true) ok('a draft whose quote moved on is marked stale');
else fail('Q-B (quote re-priced after drafting) is ' + JSON.stringify(stateOf('Q-B')));

if (stateOf('Q-C').state === 'sent' && stateOf('Q-C').sentAt) ok('a draft gone from Drafts and found in Sent is marked sent');
else fail('Q-C (in Sent) is ' + JSON.stringify(stateOf('Q-C')));
const recC = recorded.find((x) => x.qn === 'Q-C');
if (recC && recC.kind === 'firmquote' && /sent from Gmail/.test(recC.by)) ok('...and recordEmail_ runs for it, as a scripted send would');
else fail('recordEmail_ did not run for the sent draft: ' + JSON.stringify(recC));
if (writes.status['Q-C'] === 'Firm quote sent') ok('...and its status is stamped');
else fail('the sent draft did not stamp its status: ' + JSON.stringify(writes.status['Q-C']));

if (stateOf('Q-D').state === 'open' && stateOf('Q-D').missing) ok('a draft gone but not yet in Sent is NOT written off — stamped missing, still open');
else fail('Q-D (first miss) is ' + JSON.stringify(stateOf('Q-D')));
if (recorded.find((x) => x.qn === 'Q-D')) fail('a merely-missing draft was recorded as a send');

if (stateOf('Q-E').state === 'discarded') ok('a draft missing for two days is marked discarded');
else fail('Q-E (missing two days) is ' + JSON.stringify(stateOf('Q-E')));
if (recorded.find((x) => x.qn === 'Q-E')) fail('a discarded draft was recorded as a send');

if (!writes.payload['Q-F'] && !recorded.find((x) => x.qn === 'Q-F')) ok('a quote with no draft is untouched');
else fail('the sweep touched a quote that has no draft');

if (stateOf('Q-G').state === 'open' && !stateOf('Q-G').missing) ok('a Gmail error leaves the entry exactly as it was');
else fail('Q-G (Gmail threw) is ' + JSON.stringify(stateOf('Q-G')));
if (r.unreachable === 1) ok('...and is reported as unreachable'); else fail('unreachable count is ' + r.unreachable);

if (!writes.payload['Q-H'] && !recorded.find((x) => x.qn === 'Q-H')) ok('a draft already marked sent is not re-processed');
else fail('the sweep re-processed a draft that was already sent');

if (r.checked === 6 && r.sent === 1 && r.open === 2 && r.stale === 1 && r.missing === 1 && r.discarded === 1) ok('counts add up: ' + JSON.stringify(r));
else fail('counts are off: ' + JSON.stringify(r));

console.log('=== the second evening ===');
gmail.drafts = ['dA'];                                   // Q-B's draft was deleted (it was stale)
gmail.sentSubjects['Q-D'] = 'Your firm quote · Q-D';     // and Q-D has surfaced in Sent
const r2 = B.draftSweep_('Guard');
if (stateOf('Q-D').state === 'sent') ok('a draft that surfaced in Sent the next day is marked sent, not discarded');
else fail('Q-D on the second sweep is ' + JSON.stringify(stateOf('Q-D')));
if (stateOf('Q-B').state === 'open' && stateOf('Q-B').missing) ok('the deleted stale draft starts its grace period');
else fail('Q-B on the second sweep is ' + JSON.stringify(stateOf('Q-B')));
if (r2.sent === 1) ok('second sweep reports the one new send'); else fail('second sweep: ' + JSON.stringify(r2));

console.log('=== creating drafts ===');
const c = B.adminBulkDraft('t', 'firmquote', ['Q-A', 'Q-F', 'Q-C']);
if (c.ok && c.made === 2 && c.waiting === 1) ok('two drafts made; the quote with one already waiting is skipped: ' + c.msg);
else fail('adminBulkDraft: ' + JSON.stringify(c));
const mk = gmail.created[0];
if (mk.opts.cc === 'service@questwatersports.com') ok('service@ is CC\'d'); else fail('cc is ' + JSON.stringify(mk.opts.cc));
if (mk.opts.replyTo === 'service@questwatersports.com') ok('reply-to is service@'); else fail('replyTo is ' + JSON.stringify(mk.opts.replyTo));
if ((mk.opts.attachments || []).length === 1 && /^PDF-Q-/.test(mk.opts.attachments[0])) ok('the PDF is attached');
else fail('no PDF on the draft: ' + JSON.stringify(mk.opts.attachments));
if (mk.opts.inlineImages && mk.opts.inlineImages.questlogo) ok('the logo rides inline'); else fail('no inline logo');
const madeF = payloadOf('Q-F').emailLog.find((e) => e.draft);
if (madeF && madeF.draft.state === 'open' && madeF.kind === 'firmquote' && madeF.draft.total === 100) ok('the draft is recorded on the quote, open, with the total it was built from');
else fail('draft entry on Q-F: ' + JSON.stringify(madeF));
if (writes.status['Q-F']) fail('creating a draft stamped a status — that is the send\'s job'); else ok('creating a draft sets no status');
if (recorded.find((x) => x.qn === 'Q-F')) fail('creating a draft ran recordEmail_ — the row would move and the hold would lift');
else ok('creating a draft does not run recordEmail_');
const none = B.adminBulkDraft('t', 'firmquote', []);
if (!none.ok) ok('an empty selection makes no drafts'); else fail('an empty selection was treated as everyone');
const nul = B.adminBulkDraft('t', 'firmquote', null);
if (!nul.ok) ok('no selection (the menu shape) makes no drafts either'); else fail('null selection was treated as everyone');

console.log('=== the sweep sends nothing ===');
['draftSweep_', 'draftWasSent_', 'adminBulkDraft', 'draftOpts_'].forEach((name) => {
  if (/sendEmail|sendCustomerEmail_|sendCustomerNotice_/.test(fn(name))) fail(name + ' can send mail');
  else ok(name + ' cannot send mail');
});
const trig = fn('setupAllTriggers');
if (/draftSweepCheck:\s*\{\s*hour:\s*18,\s*minute:\s*30/.test(trig)) ok('the sweep is on the trigger list at 6:30pm');
else fail('setupAllTriggers has no 6:30pm draftSweepCheck');
const getFns = (gas.match(/const CONSOLE_GET_FNS_ = \{[\s\S]*?\n\};/) || [''])[0];
if (/bulkDraft|draftSweep/.test(getFns)) fail('bulkDraft / draftSweep are writes and must not be GET-able');
else ok('bulkDraft and draftSweep are POST-only');

if (bad) { console.error('FAIL: ' + bad + ' problem(s) with drafts / the draft sweep'); process.exit(1); }
console.log('drafts: nothing is recorded as sent until Gmail says so, and nothing here can send');
