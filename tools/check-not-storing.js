#!/usr/bin/env node
/* "Not storing this season" — executed, everywhere it has to hold.
   ---------------------------------------------------------------------------
   Chris, Oct 2026: a customer who is skipping a season must stop getting
   follow-ups but keep their quote, so they can be re-quoted next year.
   d.notStoring = { season, note, by, at }, and notStoringActive_ is the one
   question: it holds only for the season it was set in.

   A grep for notStoringActive_ proves the name appears in a sweep, not that
   the sweep honours it — an inverted condition or a check placed after the
   send both pass a grep. So every sweep that could contact or count the
   customer is RUN here against a fake sheet carrying three quotes:

     MARKED   marked for this season          — must be left alone
     LAPSED   marked for last season          — must be treated as normal
     PLAIN    never marked                    — must be treated as normal

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

/* One-liners first — see check-season-stamp.js for why. */
function fn(n) {
  const one = gas.match(new RegExp('^function ' + n + '\\b.*}\\s*$', 'm'));
  if (one) return one[0];
  const m = gas.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n);
  return m[0];
}
const decl = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error('missing const ' + n);
  return m[0];
};
const COL = (new Function(decl('COL') + '; return COL;'))();
const HL = 23;

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

const SEASON_SRC = "const SEASON={seasonLabel:'2026–2027'};";
const CUR = '2026–2027', PREV = '2025–2026';
const DAY = 24 * 60 * 60 * 1000;
const OLD = new Date(Date.now() - 30 * DAY);

function payload(qn, last, season) {
  const d = { quoteNo: qn, lastName: last, firstName: 'Pat', unit: 'Boat', email: qn.toLowerCase() + '@x.com' };
  if (season) d.notStoring = { season: season, note: 'skipping a year', by: 'Chris', at: '2026-10-03T12:00:00Z' };
  return d;
}
const QUOTES = [
  { qn: 'MARKED', last: 'Adams', season: CUR },
  { qn: 'LAPSED', last: 'Boone', season: PREV },
  { qn: 'PLAIN',  last: 'Cline', season: '' },
];

/* A quote tab: real column positions, one row per quote, writable cells. */
function tab(name, quotes) {
  const grid = quotes.map((q) => {
    const x = new Array(HL).fill('');
    x[COL.LAST - 1] = q.last; x[COL.FIRST - 1] = 'Pat'; x[COL.QN - 1] = q.qn; x[COL.TS - 1] = OLD;
    x[COL.EMAIL - 1] = q.qn.toLowerCase() + '@x.com'; x[COL.UNIT - 1] = 'Boat';
    x[COL.TOTAL - 1] = 900; x[COL.DEP - 1] = 300; x[COL.BAL - 1] = 900; x[COL.PAID - 1] = 0;
    x[COL.STATUS - 1] = 'Quote saved';
    x[COL.PAYLOAD - 1] = JSON.stringify(payload(q.qn, q.last, q.season));
    return x;
  });
  const writes = [];
  const sh = {
    grid, writes,
    getName: () => name,
    getLastRow: () => grid.length + 1,
    getRange: (r, c, nr, nc) => nr === undefined
      ? { getValue: () => (r === 1 && c === 3) ? 'Quote #' : grid[r - 2][c - 1],
          setValue: (v) => { writes.push(c); grid[r - 2][c - 1] = v; } }
      : { getValues: () => grid.slice(r - 2, r - 2 + nr).map(rw => rw.slice(c - 1, c - 1 + (nc || 1))) }
  };
  return sh;
}
const ssOf = (sheets) => ({
  getActiveSpreadsheet: () => ({
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.filter(s => s.getName() === n)[0] || null,
    getUrl: () => 'https://sheet'
  })
});

const COMMON = [
  SEASON_SRC, decl('HEADERS'), decl('COL'),
  "const STARTED_TAB='Quote Started'; const IMPORT_TAB='Import';",
  fn('isStartedTab_'), fn('isImportTab_'), fn('isOffstageTab_'),
  fn('notStoringActive_'),
];

/* ============ the rule itself ============ */
console.log('=== notStoringActive_ ===');
{
  const f = new Function(COMMON.concat(['return notStoringActive_;']).join('\n'))();
  if (!f(payload('X', 'X', CUR))) fail('a quote marked for this season does not read as not storing');
  else ok('marked for this season → not storing');
  if (f(payload('X', 'X', PREV))) fail("last season's mark is still in force — they would never be re-quoted");
  else ok("last season's mark has lapsed on its own");
  if (f(payload('X', 'X', '')) || f(null) || f({})) fail('an unmarked or empty payload reads as not storing');
  else ok('unmarked, null and empty payloads read as storing');
}

/* ============ the 9am automatic reminder ============ */
console.log('=== dailyReminderCheck ===');
{
  const sh = tab('Inside', QUOTES);
  const sent = [];
  new Function('SpreadsheetApp', 'GmailApp', COMMON.concat([
    'const REMINDER_ENABLED=true;', decl('REMINDER_AFTER_DAYS'),
    decl('IMPORT_HOLD_MARK'), decl('IMPORT_SENT_MARK'),
    fn('isImportHoldMark_'), fn('isImportSentMark_'), fn('importSentAt_'),
    'function autoEmailsPaused_(){return false;}', "function autoPauseCooldown_(){return '';}",
    'function signUrlFor_(){return "";}', 'function customerEmailHtml_(){return "<p>x</p>";}',
    'function quoteLink_(){return "u";}', 'function getPdfBlob_(){return null;}', 'function getLogoBlob_(){return null;}',
    'const FROM_ALIAS="", REPLY_TO="service@example.com";',
    'function recordEmail_(){}', 'function auditLog_(){}',
    fn('dailyReminderCheck'), 'dailyReminderCheck();'
  ]).join('\n'))(ssOf([sh]), { sendEmail: (to) => sent.push(to) });
  if (sent.indexOf('marked@x.com') > -1) fail('the 9am reminder emailed a customer marked not storing');
  else ok('a customer marked not storing gets no automatic reminder');
  if (sent.indexOf('lapsed@x.com') < 0 || sent.indexOf('plain@x.com') < 0) fail('the reminder stopped for unmarked or lapsed quotes too (sent: ' + sent.join(',') + ')');
  else ok('unmarked and last-season quotes are still reminded as before');
}

/* ============ the automatic lead follow-up ============ */
console.log('=== leadFollowUpCheck ===');
{
  const sh = tab('Quote Started', QUOTES);
  const sent = [];
  new Function('SpreadsheetApp', 'GmailApp', COMMON.concat([
    decl('LEAD_FOLLOWUP_ENABLED'), decl('LEAD_FOLLOWUP_AFTER_HOURS'), decl('LEAD_FOLLOWUP_MARK'),
    'function autoEmailsPaused_(){return false;}', "function autoPauseCooldown_(){return '';}",
    "function buildEmailFor_(d){return {subject:'s',html:'h'};}", 'function getLogoBlob_(){return null;}',
    'const FROM_ALIAS="", REPLY_TO="service@example.com";',
    'function recordEmail_(){}', 'function auditLog_(){}',
    fn('leadFollowUpCheck'), 'leadFollowUpCheck();'
  ]).join('\n'))(ssOf([sh]), { sendEmail: (to) => sent.push(to) });
  if (sent.indexOf('marked@x.com') > -1) fail('the lead follow-up emailed a customer marked not storing');
  else ok('a lead marked not storing gets no follow-up');
  if (sent.length !== 2) fail('the lead follow-up stopped for unmarked leads too (sent: ' + sent.join(',') + ')');
  else ok('unmarked leads are still followed up');
}

/* ============ every send-to-all ============ */
console.log('=== bulkTargets_ ===');
{
  const B = new Function('SpreadsheetApp', COMMON.concat([
    decl('BULK_KINDS_'), "function firmQuoteBlocker_(){return '';}",
    fn('bulkTargets_'), 'return { bulkTargets_, BULK_KINDS_ };'
  ]).join('\n'))(ssOf([tab('Inside', QUOTES)]));
  Object.keys(B.BULK_KINDS_).forEach((k) => {
    const t = B.bulkTargets_(k);
    const qns = t.targets.map(x => x.d.quoteNo);
    if (qns.indexOf('MARKED') > -1) fail(k + ' would email a customer marked not storing');
    else if (!t.notReady.some(x => x.qn === 'MARKED' && /not storing/i.test(x.why))) fail(k + ' dropped the marked quote silently — it must be listed with the reason');
    else if (qns.indexOf('LAPSED') < 0 || qns.indexOf('PLAIN') < 0) fail(k + ' lost an unmarked or lapsed quote');
    else ok(k + ': marked quote held back and listed with the reason; the rest still targeted');
  });
}

/* ============ the 1st/15th late-fee report ============ */
console.log('=== balanceReportCheck ===');
{
  const RealDate = Date;
  const bodies = [];
  /* Pinned to the 1st of November, a report day. */
  const FakeDate = function (...a) { return a.length ? new RealDate(...a) : new RealDate(2026, 10, 1, 7, 0, 0); };
  FakeDate.now = () => new RealDate(2026, 10, 1).getTime();
  new Function('SpreadsheetApp', 'GmailApp', 'Date', COMMON.concat([
    decl('REPORT_MONTHS'), decl('REPORT_EMAIL'), 'const FROM_ALIAS="";',
    'function usd_(n){return "$"+n;}', 'function fmtPhone(p){return p;}',
    fn('balanceReportCheck'), 'balanceReportCheck();'
  ]).join('\n'))(ssOf([tab('Inside', QUOTES)]), { sendEmail: (to, subj, body) => bodies.push(body) }, FakeDate);
  const b = bodies.join('\n');
  if (!bodies.length) fail('the balance report sent nothing at all — the fixture is wrong');
  else if (/MARKED/.test(b)) fail('a customer marked not storing is on the late-fee report');
  else if (!/LAPSED/.test(b) || !/PLAIN/.test(b)) fail('the balance report dropped unmarked quotes too');
  else ok('the late-fee report leaves out the marked quote and keeps the rest');
}

/* ============ the storage view, Harbor Haul Out and the printed sheets ============ */
console.log('=== storageViewBuild_ ===');
{
  const out = new Function('SpreadsheetApp', COMMON.concat([
    decl('STORAGE_VIEW_V_'), 'const STORAGE_VIEW_TTL_=1, CNOTE_LIST_MAX_=200, _gridsRoute_="x";',
    'function cacheGetBig_(){return null;} function cachePutBig_(){} function rememberQuoteRows_(){}',
    'function quoteTabGrids_(){return null;} function hhIndexes_(){return null;} function hhFlagOf_(){return null;}',
    'function effectiveState_(){return null;} function paymentsTotal_(){return 0;}',
    "function placementStateOf_(){return '';} function placementOf_(){return null;} function placementAlertOf_(){return null;}",
    "function customerNoteOf_(){return '';} function winterizeStatusOf_(){return null;}",
    "function haulAuth_(){return {state:'held'};} function fmtPhone(p){return p;} function usd_(n){return '$'+n;}",
    fn('storageViewBuild_'), 'return storageViewBuild_({});'
  ]).join('\n'))(ssOf([tab('Inside', QUOTES)]));
  const shown = [].concat(...out.groups.map(g => g.rows.map(r => r.qn)));
  const count = out.groups.reduce((n, g) => n + g.count, 0);
  if (shown.indexOf('MARKED') > -1) fail('a quote marked not storing is on the storage / haul-out list');
  else if (count !== 2) fail('the unit count still includes the marked quote (' + count + ')');
  else if (!(out.notStoring || []).some(x => x.qn === 'MARKED')) fail('the marked quote vanished — it must be listed apart so staff can open it');
  else ok('kept off the storage and haul-out lists and their counts, listed apart under notStoring');
}

/* ============ setting and clearing it ============ */
console.log('=== adminSetNotStoring ===');
{
  const sh = tab('Inside', [{ qn: 'PLAIN', last: 'Cline', season: '' }]);
  const audit = [];
  const S = new Function('SpreadsheetApp', 'AUDIT', COMMON.concat([
    decl('NOT_STORING_NOTE_MAX_'),
    "function requireAuth_(t,p){ if(p!=='keys') throw new Error('wrong permission '+p); return {name:'Chris'}; }",
    'function auditLog_(w,m){AUDIT.push(m);}',
    'const SH=SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];',
    'function findQuoteCtx_(){ return { sh: SH, rowNum: 2, d: JSON.parse(SH.grid[0][COL.PAYLOAD-1]) }; }',
    fn('notStoringOut_'), fn('adminSetNotStoring'), 'return adminSetNotStoring;'
  ]).join('\n'))(ssOf([sh]), audit);
  const read = () => JSON.parse(sh.grid[0][COL.PAYLOAD - 1]);
  let r = S('t', 'PLAIN', 0, '');
  if (r.ok) fail('clearing a mark that is not there reported success');
  r = S('t', 'PLAIN', 1, '  boat   at the lake  ');
  const d = read();
  if (!r.ok || !d.notStoring || d.notStoring.season !== CUR) fail('marking did not store this season on the payload');
  else if (d.notStoring.note !== 'boat at the lake') fail('the reason was not tidied: ' + JSON.stringify(d.notStoring.note));
  else if (!r.notStoring || !r.notStoring.active) fail('the console was not told the mark is in force');
  else ok('marking stores { season, note, by, at } for this season and reports it active');
  if (sh.writes.some(c => c !== COL.PAYLOAD)) fail('marking wrote a column other than the payload: ' + sh.writes.join(','));
  else ok('payload only — no status, total or PDF touched');
  if (S('t', 'PLAIN', 1, 'boat at the lake').ok) fail('re-marking with the same reason was not a no-op');
  r = S('t', 'PLAIN', 0, '');
  if (!r.ok || read().notStoring) fail('clearing did not remove the mark');
  else ok('clearing removes it');
  if (audit.length !== 2) fail('expected an Activity Log line per change, got ' + audit.length);
  else ok('each change is in the Activity Log');
}

/* ============ a customer save keeps it ============ */
console.log('=== doPost ===');
{
  const m = gas.match(/const lockedByPayment[\s\S]*?3\) Target tab/);
  if (!m || !/if \(oldD\.notStoring\) d\.notStoring = oldD\.notStoring/.test(m[0])) {
    fail('a customer re-save would wipe the mark and put them back on the 9am reminder');
  } else ok('a customer re-save carries the mark across');
}

if (bad) { console.error(bad + ' not-storing check(s) failed'); process.exit(1); }
console.log('-> not-storing: every sweep honours the mark');
