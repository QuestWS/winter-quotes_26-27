#!/usr/bin/env node
/* The Import tab: a holding pen that must never reach a customer.
   ---------------------------------------------------------------------------
   ~149 quotes carried over from last season's per-customer sheets land on one
   tab called "Import". Every one of them is a DRAFT: the customer never asked
   for it, has never been told about it, and the figures came from a file
   rather than from them.

   ONE OF THOSE PATHS IS UNATTENDED. dailyReminderCheck runs at 9am on a
   trigger and emails customers. If the Import tab is ever in its scan, 145
   people get a quote nobody meant to send, before anybody is awake to stop it.
   That is what this file exists for. The rest -- the yard lists, the money
   report, the public lookups -- are the same rule applied where the cost is
   lower.

   Checked by EXECUTING the predicates and by reading the real scan bodies out
   of the .gs, because "the tab is excluded" is a property of the code and a
   grep for the tab name would pass on a comment.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GAS = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);
const eq = (got, want, what) => {
  if (got === want) ok(what);
  else fail(what + ' — got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
};
/* A ONE-LINE function has no "\n}" of its own, so the greedy form runs on to
   the next multi-line function's closing brace and swallows everything in
   between -- which is how isImportTab_ came back carrying half the file and a
   second copy of every const in it. One-liners are matched first, as
   check-haul-info.js already does. */
function fn(n) {
  const one = GAS.match(new RegExp('^function ' + n + '\\b.*}\\s*$', 'm'));
  if (one) return one[0];
  const m = GAS.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n);
  return m[0];
}
function decl(n) {
  const m = GAS.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error('missing const ' + n);
  return m[0];
}

/* ---- run the real predicates ---- */
const B = new Function([
  decl('STARTED_TAB'), decl('IMPORT_TAB'),
  fn('isStartedTab_'), fn('isImportTab_'), fn('isOffstageTab_'),
  decl('BULKIMP_NOT_A_QUOTE_'), fn('bulkImportNotAQuote_'),
  decl('COL'), fn('bulkImportDuplicateOf_'),
  'return {IMPORT_TAB,STARTED_TAB,isImportTab_,isStartedTab_,isOffstageTab_,' +
  'bulkImportNotAQuote_,bulkImportDuplicateOf_};'
].join('\n'))();

/* =====================================================================
   1. EVERY CUSTOMER-FACING SCAN EXCLUDES IT.
   ---------------------------------------------------------------------
   Read out of the real function bodies. A scan that walks the spreadsheet
   and does not ask is a scan the Import tab is visible to.
   ===================================================================== */
const MUST_EXCLUDE = [
  ['dailyReminderCheck', 'emails customers at 9am on a trigger, with nobody watching'],
  ['bulkTargets_',       'builds the send-to-all recipient list'],
  ['balanceReportCheck', 'reports money owed; a draft owes nothing'],
  ['repriceScan_',       'the season re-price'],
  ['adminStorageView',   'the storage view, the yard app and the printed haul-out sheets'],
  ['signLookup_',        'the public scan-to-sign lookup']
];
MUST_EXCLUDE.forEach(function (pair) {
  const name = pair[0], why = pair[1];
  let body;
  try { body = fn(name); } catch (e) { fail('there is no ' + name + ' on the server'); return; }
  if (/isOffstageTab_\(|isImportTab_\(/.test(body)) {
    ok(name + ' cannot see the Import tab (' + why + ')');
  } else {
    fail(name + ' does NOT exclude the Import tab — it ' + why + ', so every imported ' +
         'draft would be treated as a live quote');
  }
});

/* The two public doGet paths live inside one big function, so they are read by
   their own shape rather than by the function body. */
{
  const doGet = fn('doGet');
  const loader = /if \(isImportTab_\(sh\.getName\(\)\)\) continue;/.test(doGet);
  const pref   = /if \(isImportTab_\(sh2\.getName\(\)\)\) return;/.test(doGet);
  if (loader) ok('a customer cannot load a draft with its quote number');
  else fail('doGet\'s quote loader does not exclude the Import tab — a customer given the ' +
            'number by accident could open a quote nobody sent them');
  if (pref) ok('the spring launch buttons ignore drafts');
  else fail('doGet\'s launch-preference path does not exclude the Import tab');
}

/* =====================================================================
   2. STAFF PATHS MUST STILL SEE IT.
   ---------------------------------------------------------------------
   Hiding it from everything would be safe and useless: Chris could not find,
   open, price or send one, and the nightly backup would not carry it.
   ===================================================================== */
[['adminSearch', 'Chris can find an imported quote by name'],
 ['findQuoteCtx_', 'he can open, re-price and send one'],
 ['readQuoteRows_', 'the nightly backup carries them']
].forEach(function (pair) {
  let body;
  try { body = fn(pair[0]); } catch (e) { fail('there is no ' + pair[0]); return; }
  if (/isImportTab_\(|isOffstageTab_\(/.test(body)) {
    fail(pair[0] + ' excludes the Import tab, so ' + pair[1] + ' — no longer true');
  } else ok(pair[1]);
});

/* =====================================================================
   3. THE PREDICATES THEMSELVES.
   ===================================================================== */
eq(B.IMPORT_TAB, 'Import', 'the tab is called Import');
eq(B.isImportTab_('Import'), true, 'the Import tab is recognised');
eq(B.isImportTab_('Inside'), false, 'a real storage tab is not');
eq(B.isImportTab_('import'), false, 'and the match is exact, not fuzzy');
eq(B.isOffstageTab_('Import'), true, 'offstage covers imports');
eq(B.isOffstageTab_(B.STARTED_TAB), true, 'offstage still covers leads');
eq(B.isOffstageTab_('Outside'), false, 'and nothing else');

/* =====================================================================
   4. THE FOUR FILES IN THAT FOLDER THAT ARE NOT QUOTES.
   ---------------------------------------------------------------------
   Left in, each imports as a nameless $0 quote somebody then has to find and
   delete. Real names, read off the real folder.
   ===================================================================== */
[['aaaaa Storage List.ods', true, 'the storage list'],
 ['Deposits.ods', true, 'the deposits ledger'],
 ['Winter services menu template.ods', true, 'the blank template'],
 ['Winter Services.ods', true, 'an untitled copy of the template'],
 ['Winter services menu master pricing - DO NOT EDIT UNLESS UPDATING.ods', true, 'the price list'],
 ['~$Dooley Winter Services.ods', true, 'a LibreOffice lock file'],
 ['Anderson - Winter Services.xlsx', false, 'a real customer sheet'],
 ['ECKSTEIN Winter Services.ods', false, 'a real customer sheet in caps'],
 ['Dowling Golf Cart - Winter Services.ods', false, 'a real golf cart sheet'],
 ['Cromer - Winter services menu template.ods', false,
  'a real customer whose file happens to say "template"']
].forEach(function (c) {
  eq(B.bulkImportNotAQuote_(c[0]), c[1],
     (c[1] ? 'skipped: ' : 'imported: ') + c[2]);
});

/* =====================================================================
   5. DUPLICATES ARE MATCHED ON NAME **AND** UNIT.
   ---------------------------------------------------------------------
   Surname alone would skip a customer who stores a boat and a jet ski under
   one name, and several of them do — those are two quotes, not one.
   ===================================================================== */
{
  const idx = {
    'kasperski': [{ qn: 'QW-26-4472', unit: 'boat' }],
    'franco':    [{ qn: 'QW-26-9458', unit: 'boat' }, { qn: 'QW-26-6224', unit: 'jet ski' }]
  };
  eq(B.bulkImportDuplicateOf_(idx, 'Kasperski', 'Boat'), 'QW-26-4472',
     'a boat whose owner already has a boat quote is a duplicate');
  eq(B.bulkImportDuplicateOf_(idx, 'Kasperski', 'Jet ski'), '',
     'the same owner\'s JET SKI is not — that is a second unit, not a repeat');
  eq(B.bulkImportDuplicateOf_(idx, 'KASPERSKI', 'boat'), 'QW-26-4472',
     'case and spacing do not hide a duplicate');
  eq(B.bulkImportDuplicateOf_(idx, 'Franco', 'Jet ski'), 'QW-26-6224',
     'a second unit for the same name still matches on its own type');
  eq(B.bulkImportDuplicateOf_(idx, 'Nobody', 'Boat'), '',
     'a customer we have never quoted is not a duplicate');
  eq(B.bulkImportDuplicateOf_(idx, '', 'Boat'), '',
     'a blank name never matches — it would skip everything');
}

/* =====================================================================
   6. THE RUN ITSELF.
   ===================================================================== */
{
  const start = fn('bulkImportStart');
  const step  = fn('bulkImportStep');
  const one   = fn('bulkImportOne_');

  /* Resumable, because ~149 Drive conversions do not fit in six minutes. */
  if (/BULKIMP_BUDGET_MS_/.test(step)) ok('each run stops inside its own time budget');
  else fail('bulkImportStep has no time budget — Apps Script will kill it mid-folder');
  if (/bulkImportArm_\(\)/.test(step)) ok('and re-arms itself to carry on');
  else fail('nothing continues the run after a slice — it would stop half way and stay there');
  if (/bulkImportSave_\(st\)/.test(step)) ok('progress is written before the next slice');
  else fail('progress is never saved, so a killed run restarts from the beginning');

  /* The dry run must write nothing to the quote sheet. */
  if (/st\.mode !== 'apply'/.test(one)) ok('the scan returns its verdict without importing');
  else fail('bulkImportOne_ does not distinguish scan from apply — the dry run would write');
  const applyIdx = one.indexOf('importApplyCore_');
  const guardIdx = one.indexOf("st.mode !== 'apply'");
  if (applyIdx > -1 && guardIdx > -1 && guardIdx < applyIdx) {
    ok('and the scan returns BEFORE anything is written');
  } else fail('the mode guard does not sit in front of the write');

  /* Everything lands on the Import tab, never on a storage tab. */
  if (/importApplyCore_\([\s\S]{0,400}?IMPORT_TAB\)/.test(one)) {
    ok('every imported quote is parked on the Import tab');
  } else fail('the bulk run does not force IMPORT_TAB — quotes would scatter onto the storage ' +
              'tabs and straight into the yard lists');

  /* A duplicate is reported, not imported. */
  if (/if \(dupe\)[\s\S]{0,400}?st\.skipped\+\+/.test(one)) ok('a duplicate is skipped and reported');
  else fail('a customer who already has a quote this season would get a second one');

  /* Nothing is emailed to a customer by any of this. */
  const all = [start, step, one, fn('bulkImportFinish_')].join('\n');
  const sends = all.match(/sendCustomerEmail_|sendEmail\(/g) || [];
  const toReport = /to: REPORT_EMAIL/.test(all);
  if (sends.length && !toReport) {
    fail('the bulk import sends mail to something other than REPORT_EMAIL');
  } else ok('the only mail it sends is the finished-run note to Chris');
  if (/d\.email|state\.email/.test(fn('bulkImportFinish_'))) {
    fail('the completion email reads a customer address');
  } else ok('and that note carries no customer address');
}

/* =====================================================================
   7. THE IMPORTER STILL WRITES THROUGH ONE PATH.
   ===================================================================== */
{
  const single = fn('adminImportApply');
  if (/importApplyCore_/.test(single)) ok('the one-at-a-time importer shares the bulk write path');
  else fail('adminImportApply has its own copy of the write — the column list will go stale in one of them');
  const core = fn('importApplyCore_');
  if (/tabOverride \|\| d\.storageTab/.test(core)) {
    ok('and the tab is the only thing the two differ on');
  } else fail('importApplyCore_ does not take a tab override');
  if (/requireAuth_/.test(core)) {
    fail('importApplyCore_ authenticates internally — it is called with an already-checked ' +
         'identity and a second check there would hide which caller was unauthorised');
  } else ok('authentication stays with the callers, one check each');
}

if (bad) { console.error('\n' + bad + ' problem(s) with the Import tab'); process.exit(1); }
console.log('import tab holds: drafts stay off every customer path, duplicates are skipped, ' +
            'the dry run writes nothing');
