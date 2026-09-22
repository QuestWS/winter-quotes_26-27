#!/usr/bin/env node
/* The season stamp, and the reminder hold on an imported quote — executed.
   ---------------------------------------------------------------------------
   `d.season` is the dates a quote prints: the PDF's totals block reads
   sn.payByShort, its fine print reads sn.payBy and sn.lateStart. It used to be
   built inline on the customer page, which was true while a customer save was
   the only way a quote came into existence. It stopped being true when the
   importer and the season re-price arrived, and nothing noticed:

     - an IMPORTED quote had no season at all, so its PDF printed
       "Total — ... by " and "a service charge beginning " with nothing after.
     - a RE-PRICED quote kept last season's dates against this season's
       prices — 2026-2027 money over a "balance due by November 15, 2025".

   The second one is the dangerous half, because it is silent and it is wrong
   on exactly the documents a customer is asked to pay from.

   Separately, an imported quote must not trip the automatic 10-day reminder.
   It otherwise qualifies on every count — email address, no payment, no
   marker, ten days old — and that email opens "Your Quest Watersports winter
   quote is waiting", unprompted, to somebody who never built a quote.

   Everything here RUNS the real code. Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const E = require(path.join(ROOT, 'pricing-engine.js'));

/* Slice a function out of the .gs by name. The one-line form is matched FIRST:
   a single-line function has no "\n}" of its own, so the multi-line pattern
   would run straight past it and swallow everything up to the next one —
   which is how isStartedTab_ came back carrying the COL declaration with it.
   Same two-branch shape as tools/check-reprice.js. */
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

/* The engine, exactly as the .gs carries it — the sandboxes price with the
   same code the server runs, not with a stand-in. */
const ENG = gas.slice(gas.indexOf('// ENGINE-START'), gas.indexOf('// ENGINE-END'));
/* The real column map, read out of the .gs rather than restated here: a
   hand-written copy silently tests the wrong cells the moment a column moves. */
const COL = (new Function(gas.match(/^const COL\s*=[\s\S]*?;\s*$/m)[0] + '; return COL;'))();

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

/* ============ the stamp itself ============ */
console.log('=== seasonStamp() carries every field the PDF and the emails read ===');
{
  const s = E.seasonStamp();
  const want = {
    label: E.SEASON.seasonLabel,
    payBy: E.SEASON.payByDate,
    payByShort: E.SEASON.payByShort,
    lateStart: E.SEASON.lateChargeStart,
    storageStart: E.SEASON.storageStart,
    storageEnd: E.SEASON.storageEnd,
    lateRetrievalFee: E.PRICES.lateRetrieval,
    lateRetrievalLabel: 'Late retrieval surcharge (after ' + E.SEASON.payByShort + ')',
    pricingProvisional: !!E.PRICING.provisional,
    ratesLabel: E.PRICING.ratesLabel
  };
  Object.keys(want).forEach(k => {
    if (!(k in s)) fail('seasonStamp() is missing ' + k);
    else if (s[k] !== want[k]) fail('seasonStamp().' + k + ' = ' + JSON.stringify(s[k]) + ', expected ' + JSON.stringify(want[k]));
  });
  const extra = Object.keys(s).filter(k => !(k in want));
  if (extra.length) fail('seasonStamp() grew unchecked field(s): ' + extra.join(', '));
  if (!bad) ok('all 10 fields present and sourced from SEASON / PRICES / PRICING');
}

/* ============ one stamp, not four copies ============ */
console.log('=== page and server share the one stamp ===');
{
  if (!/season:\s*QuestPricing\.seasonStamp\(\)/.test(page)) {
    fail('index.html does not build its payload season from QuestPricing.seasonStamp()');
  } else ok('the customer page stamps from the engine');
  /* An inline rebuild anywhere is the drift this function exists to stop. */
  if (/lateRetrievalLabel\s*:/.test(page)) {
    fail('index.html still builds a season object by hand — that is the copy that drifts');
  } else ok('the page carries no hand-built copy of it');
  /* importApplyCore_, not adminImportApply: the write moved there when the bulk
     folder import arrived, and BOTH importers now go through it. Reading the
     wrapper would pass on an empty function while saying nothing about either
     caller — which is exactly what it did the day the two landed together. */
  ['importApplyCore_', 'adminRepriceApply'].forEach(name => {
    const body = fn(name);
    if (!/season\s*[:=]\s*seasonStamp\(\)/.test(body)) {
      fail(name + ' does not stamp the season — its quotes print the wrong dates');
    } else ok(name + ' stamps the season from the engine');
  });
  /* And the wrapper must still route through it rather than growing its own. */
  if (/importApplyCore_/.test(fn('adminImportApply'))) {
    ok('adminImportApply stamps it by sharing that one write path');
  } else fail('adminImportApply no longer calls importApplyCore_, so it stamps nothing');
}

/* ============ a re-price actually moves the dates ============ */
console.log('=== a re-priced quote is re-dated, not just re-costed ===');
{
  /* Run the real adminRepriceApply against a fake sheet, with a quote carrying
     LAST season's stamp, and read back what was written. */
  const OLD_SEASON = { label: '2019–2020', payBy: 'November 15, 2019', payByShort: 'Nov 15',
                       lateStart: 'Dec 1, 2019', storageStart: 'October 15, 2019',
                       storageEnd: 'April 15, 2020', lateRetrievalFee: 1,
                       lateRetrievalLabel: 'x', pricingProvisional: false, ratesLabel: '2019–2020' };
  const states = JSON.parse(require('child_process')
    .execSync('node tools/price-fixtures.js --dump-states', { cwd: ROOT, maxBuffer: 1e8 }));
  const state = JSON.parse(JSON.stringify(states.find(s => s.name === 'boat-twin-inboard-full').state));
  const r = E.computeQuote(state);
  const lines = r.lines.map(l => ({ sec: l.sec, label: l.label, calc: l.calc || '', amt: Number(l.amt || 0), desc: l.desc || '' }));
  const d = { quoteNo: 'Q-A', lastName: 'Adams', firstName: 'Pat', unit: 'Boat', depositBase: 500,
              state, lines, total: lines.reduce((a, b) => a + b.amt, 0).toFixed(2), payments: [],
              storageTab: E.storageTabFor(state), season: JSON.parse(JSON.stringify(OLD_SEASON)) };

  const HL = 23, COL_QN = 3, COL_PAYLOAD = 21;
  const grid = [(() => { const x = new Array(HL).fill(''); x[0] = 'Adams'; x[1] = 'Pat';
    x[COL_QN - 1] = 'Q-A'; x[COL_PAYLOAD - 1] = JSON.stringify(d); return x; })()];
  const sheet = {
    getName: () => 'Inside', getLastRow: () => grid.length + 1,
    getRange: (row, c, nr, nc) => nr === undefined
      ? { getValue: () => (row === 1 && c === 3) ? 'Quote #' : grid[row - 2][c - 1],
          setValue: (v) => { grid[row - 2][c - 1] = v; } }
      : { getValues: () => grid.slice(row - 2, row - 2 + nr).map(rw => rw.slice(c - 1, c - 1 + nc)),
          setValues: (vals) => { vals.forEach((rw, i) => { rw.forEach((v, j) => { grid[row - 2 + i][c - 1 + j] = v; }); }); },
          setNumberFormat: () => {}, setWrap: () => {}, setFontWeight: () => {} }
  };
  const SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => [sheet], getSheetByName: () => sheet }) };

  let written = null;
  const api = new Function('SpreadsheetApp', 'seasonStamp', 'CAPTURE', [
    ENG,
    decl('HEADERS'), decl('COL'), decl('KEYFIELDS_'),
    "const STARTED_TAB='Quote Started';", fn('isStartedTab_'),
    /* repriceScan_ asks isOffstageTab_ — the lead tab OR the bulk Import tab.
       Both stubs, or it throws and this guard reports a broken season rule
       where there is only a missing definition. */
    "const IMPORT_TAB='Import';", fn('isImportTab_'), fn('isOffstageTab_'),
    'const ADJ_CC_PCT=3, ADJ_LATE_PCT=10;',
    'function usd_(n){return "$"+Number(n||0).toFixed(2);}',
    fn('paymentsTotal_'), fn('effectiveState_'), fn('serverPrice_'), fn('linesTotal_'),
    fn('rebuildLinesFromState_'), fn('ensureManual_'), fn('applyManualOps_'),
    fn('recomputeTotals_'), fn('bulkFilterTargets_'), fn('repriceScan_'),
    "function requireAuth_(){return {name:'Chris',admin:true};}",
    "function snapshotBeforeRestore_(){return {getUrl:function(){return 'snap';}};}",
    "function auditLog_(){}",
    "function findQuoteCtx_(qn){var ss=SpreadsheetApp.getActiveSpreadsheet();var sh=ss.getSheets()[0];" +
      "var d=JSON.parse(sh.getRange(2,21).getValue());return {d:d,sh:sh,rowNum:2};}",
    "function saveQuoteRow_(ctx,status){CAPTURE(ctx.d);}",
    fn('adminRepriceApply'),
    'return {adminRepriceApply};'
  ].join('\n'))(SpreadsheetApp, E.seasonStamp, (x) => { written = JSON.parse(JSON.stringify(x)); });

  const res = api.adminRepriceApply('t', ['Q-A'], true);
  if (!res || !res.done) {
    fail('the re-price did not apply: ' + JSON.stringify(res));
  } else if (!written || !written.season) {
    fail('the re-priced quote was written with no season stamp at all');
  } else {
    const live = E.seasonStamp();
    if (written.season.payBy === OLD_SEASON.payBy) {
      fail('the re-priced quote kept last season\'s pay-by date (' + written.season.payBy + ')');
    } else if (written.season.payBy !== live.payBy || written.season.lateStart !== live.lateStart
               || written.season.label !== live.label) {
      fail('the re-priced season stamp does not match the live one: ' + JSON.stringify(written.season));
    } else {
      ok('re-pricing moved the stamp ' + JSON.stringify(OLD_SEASON.label) + ' -> ' + JSON.stringify(written.season.label));
      ok('pay-by ' + JSON.stringify(OLD_SEASON.payBy) + ' -> ' + JSON.stringify(written.season.payBy));
      ok('late charges ' + JSON.stringify(OLD_SEASON.lateStart) + ' -> ' + JSON.stringify(written.season.lateStart));
    }
  }
}

/* ============ the reminder hold on an imported quote ============ */
console.log('=== the 10-day reminder and an imported quote ===');
{
  const DAY = 24 * 60 * 60 * 1000;
  const HL = 23;
  const C = COL;

  function run(rows) {
    const grid = rows.map(r => {
      const x = new Array(HL).fill('');
      x[C.LAST - 1] = r.last; x[C.QN - 1] = r.qn; x[C.TS - 1] = r.ts;
      x[C.EMAIL - 1] = r.email; x[C.REM - 1] = r.rem || ''; x[C.TOTAL - 1] = 100; x[C.DEP - 1] = 50;
      x[C.PAID - 1] = r.paid || 0; x[C.PAYLOAD - 1] = JSON.stringify({ quoteNo: r.qn });
      return x;
    });
    const sheet = {
      getName: () => 'Inside', getLastRow: () => grid.length + 1,
      getRange: (row, c, nr, nc) => nr === undefined
        ? { getValue: () => (row === 1 && c === 3) ? 'Quote #' : grid[row - 2][c - 1],
            setValue: (v) => { grid[row - 2][c - 1] = v; } }
        : { getValues: () => grid.slice(row - 2, row - 2 + nr).map(rw => rw.slice(c - 1, c - 1 + nc)) }
    };
    const SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheets: () => [sheet] }) };
    const sent = [];
    new Function('SpreadsheetApp', 'GmailApp', 'SENT', [
      decl('HEADERS'), decl('COL'),
      'const REMINDER_ENABLED=true;', decl('REMINDER_AFTER_DAYS'),
      decl('IMPORT_HOLD_MARK'), decl('IMPORT_SENT_MARK'),
      fn('isImportHoldMark_'), fn('isImportSentMark_'), fn('importSentAt_'),
      "const STARTED_TAB='Quote Started';", fn('isStartedTab_'),
      /* repriceScan_ asks isOffstageTab_ — the lead tab OR the bulk Import tab.
         Both stubs, or it throws and this guard reports a broken season rule
         where there is only a missing definition. */
      "const IMPORT_TAB='Import';", fn('isImportTab_'), fn('isOffstageTab_'),
      'function autoEmailsPaused_(){return false;}',
      /* Nothing is paused in these cases, so no cooldown is running. The
         "lifting a pause restarts the ten days" rule has its own guard, in
         check-perms-pause.js; stubbing it here keeps this file about the
         marker rules it was written for. */
      "function autoPauseCooldown_(){return '';}",
      'function signUrlFor_(){return "";}',
      'function customerEmailHtml_(){return "<p>x</p>";}',
      'function quoteLink_(){return "u";}',
      'function getPdfBlob_(){return null;}',
      'function getLogoBlob_(){return null;}',
      'const FROM_ALIAS="", REPLY_TO="service@example.com";',
      'function recordEmail_(){}', 'function auditLog_(){}',
      fn('dailyReminderCheck'),
      'return dailyReminderCheck();'
    ].join('\n'))(SpreadsheetApp, { sendEmail: (to, subj) => sent.push(to) }, sent);
    return { sent, grid };
  }

  const old = new Date(Date.now() - 30 * DAY);

  /* a) an ordinary old unreminded quote still gets its reminder — unchanged */
  {
    const { sent } = run([{ qn: 'A', last: 'Adams', ts: old, email: 'a@x.com' }]);
    if (sent.length !== 1) fail('an ordinary 30-day-old quote no longer gets its reminder (sent ' + sent.length + ')');
    else ok('an ordinary old quote is still reminded — existing behaviour unchanged');
  }
  /* b) an imported quote nobody has contacted is NOT emailed */
  {
    const { sent } = run([{ qn: 'B', last: 'Boone', ts: old, email: 'b@x.com',
                            rem: 'Imported — not yet sent 1/1/2026' }]);
    if (sent.length) fail('an imported quote nobody has contacted was auto-emailed "your quote is waiting"');
    else ok('an imported, never-contacted quote is held back from the automatic reminder');
  }
  /* c) once a human has sent, the ten days run from THAT send */
  {
    const justSent = new Date(Date.now() - 2 * DAY).toISOString();
    const { sent } = run([{ qn: 'C', last: 'Cline', ts: old, email: 'c@x.com',
                            rem: 'Imported — sent ' + justSent }]);
    if (sent.length) fail('a quote emailed two days ago was nudged again — the clock is running from the import, not the send');
    else ok('the ten days run from the send, not from the import date');
  }
  /* d) ...and it does fire once those ten days are up */
  {
    const longAgo = new Date(Date.now() - 20 * DAY).toISOString();
    const { sent, grid } = run([{ qn: 'D', last: 'Doyle', ts: old, email: 'd@x.com',
                                  rem: 'Imported — sent ' + longAgo }]);
    if (sent.length !== 1) fail('a quote emailed 20 days ago never got its reminder');
    else if (!/^Reminder sent /.test(String(grid[0][C.REM - 1]))) fail('the reminder marker was not written back');
    else ok('twenty days after the send, the reminder goes and the marker is written');
  }
  /* e) a corrupt SENT marker must not become a reason to email */
  {
    const { sent } = run([{ qn: 'E', last: 'Evans', ts: old, email: 'e@x.com',
                            rem: 'Imported — sent not-a-date' }]);
    if (sent.length) fail('a corrupt sent-marker was treated as "never contacted" and triggered an email');
    else ok('an unparseable marker fails towards sending nothing');
  }
  /* f) a paid quote is still never nudged */
  {
    const { sent } = run([{ qn: 'F', last: 'Fox', ts: old, email: 'f@x.com', paid: 500 }]);
    if (sent.length) fail('a quote with a payment on it was nudged');
    else ok('a quote with money on it is still never nudged');
  }
}

/* ============ the import writes the hold ============ */
console.log('=== the importer sets the hold ===');
{
  /* importApplyCore_, not the wrapper: the write moved there when the bulk
     folder import landed, and both importers go through it. Reading
     adminImportApply would pass on a three-line function that writes nothing
     itself, which is the guard testing nothing at all. */
  const body = fn('importApplyCore_');
  if (!/COL\.REM\)\.setValue\(IMPORT_HOLD_MARK/.test(body)) {
    fail('importApplyCore_ does not write the reminder hold — imports would be auto-emailed');
  } else ok('adminImportApply writes the hold into the reminder column');
  const rec = fn('recordEmail_');
  if (!/releaseImportHold_/.test(rec)) {
    fail('recordEmail_ does not release the hold — an imported quote would never be reminded again');
  } else ok('recordEmail_ releases it, so every send site (console and menu) clears it');
  const rel = fn('releaseImportHold_');
  if (!/isImportHoldMark_/.test(rel)) {
    fail('releaseImportHold_ does not check the marker first — it could clobber "Reminder sent"');
  } else ok('the release only ever rewrites the hold marker');
}

if (bad) { console.error('\n' + bad + ' season-stamp / import-hold check(s) FAILED'); process.exit(1); }
console.log('\nseason stamp: one builder, and a re-price re-dates as well as re-costs');
