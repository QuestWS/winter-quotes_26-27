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
  /* THE LOADER IS THE ONE PATH THAT MAY SEE IT, and that is a decision, not
     an oversight: it answers a number AND a last name with one quote, which
     is the same pair that opens every other quote, and it is the only surface
     that can correct an imported quote's selections before it is sent. The
     skip is what made Chris's imported quotes read "Quote not found." on the
     customer page. Everything a draft must stay out of is a PUSH — email, the
     yard lists, the money report — and those are asserted above. */
  if (!loader) ok('a draft can be opened on the quote page with its number and last name');
  else fail('doGet\'s quote loader skips the Import tab again — an imported quote reads ' +
            '"Quote not found." on the customer page, and nothing can fix its selections');
  if (pref) ok('the spring launch buttons ignore drafts');
  else fail('doGet\'s launch-preference path does not exclude the Import tab');
}

/* =====================================================================
   1b. EDITING A DRAFT IS NOT SENDING IT.
   ---------------------------------------------------------------------
   The loader above lets a draft be opened and re-saved, and the dimension
   editor could already re-price one. Neither may hand it to the crew: a
   parked row stays parked until recordEmail_ releases it. Without this the
   Import tab is a pen with an open gate — a boat nobody agreed to store
   appears on the haul-out list because somebody fixed its beam.
   ===================================================================== */
{
  const post = fn('doPost');
  if (/isImportTab_\(c\.sheet\.getName\(\)\)/.test(post) && /parked \? IMPORT_TAB/.test(post)) {
    ok('a save from the quote page leaves a parked draft on the Import tab');
  } else {
    fail('doPost writes a parked draft to its storage tab — opening an imported quote ' +
         'and saving it would publish it to the storage view, the yard app and the ' +
         'printed haul-out sheets without anybody sending it');
  }
  const dims = fn('adminDimsApply');
  if (/!isOffstageTab_\(fromTab\)/.test(dims)) {
    ok('a re-measure does not drag a draft (or a lead) off its own tab');
  } else {
    fail('adminDimsApply moves a row off whatever tab it is on — re-measuring an imported ' +
         'quote would publish a draft the same way');
  }
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
  const start = fn('bulkImportStart_');
  /* bulkImportSlice_, not bulkImportStep: the loop moved there so the
     foreground runner could share it, leaving step as a catch around it. */
  const step  = fn('bulkImportSlice_');
  const one   = fn('bulkImportOne_');

  /* Resumable, because ~139 Drive conversions do not fit in six minutes. */
  if (/BULKIMP_BUDGET_MS_/.test(step)) ok('each run stops inside its own time budget');
  else fail('the slice has no time budget — Apps Script will kill it mid-folder');
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

/* =====================================================================
   8. SENDING ONE OFF UNPARKS IT.
   ---------------------------------------------------------------------
   The reminder marker and the tab hold different things back, and releasing
   only the marker would leave a boat Chris has quoted — and may have been
   paid for — invisible to the crew who have to pull it. That is the failure
   the tab exists to prevent, arriving from the other side.
   ===================================================================== */
{
  const rec = fn('recordEmail_');
  if (/leaveImportTab_\(/.test(rec)) ok('every send site unparks the row, not just the console');
  else fail('recordEmail_ does not move a sent quote off the Import tab — it would stay ' +
            'invisible to the yard app and the haul-out sheets after the customer was quoted');
  if (/releaseImportHold_\(/.test(rec)) ok('and still releases the reminder hold');
  else fail('recordEmail_ no longer releases the import hold');

  const leave = fn('leaveImportTab_');
  if (/isImportTab_\(sh\.getName\(\)\)/.test(leave)) ok('it only touches rows that are actually parked');
  else fail('leaveImportTab_ does not check which tab the row is on — it would move ordinary quotes');
  if (/isOffstageTab_\(dest\)/.test(leave)) ok('and never moves one onto another offstage tab');
  else fail('leaveImportTab_ could move a row from the Import tab to the lead tab');
  if (/catch/.test(leave)) ok('a failed move cannot fail a send that already went out');
  else fail('leaveImportTab_ can throw after the email has gone — the customer has it, and ' +
            'the console would report the send as failed');
  if (/d\.storageTab/.test(leave)) ok('it sends the row to the tab the engine picked at import');
  else fail('leaveImportTab_ does not read d.storageTab, so it cannot know where the row belongs');
}

/* =====================================================================
   9. A RUN THAT DIES MUST SAY SO.
   ---------------------------------------------------------------------
   The first real run stalled in total silence: the report sat on "Scanning
   139 files…", no email came, and the editor said "Execution Complete"
   because the scan only queues the work. bulkImportStep deletes its own
   trigger before doing anything, so ONE throw outside the per-file catch
   disarmed the run, killed it, and left nothing to say why. A background job
   is allowed to fail; it is not allowed to fail quietly.
   ===================================================================== */
{
  const step = fn('bulkImportStep');
  if (/try\s*\{[\s\S]*catch/.test(step)) ok('bulkImportStep cannot throw past its own trigger');
  else fail('bulkImportStep has no catch — one throw outside the per-file handler disarms the ' +
            'trigger and the run dies silently, which is exactly what happened');

  const blew = fn('bulkImportBlewUp_');
  if (/REPORT_EMAIL/.test(blew)) ok('a stopped run emails Chris');
  else fail('a stopped run tells nobody');
  if (/bulkImportAppendReport_/.test(blew)) ok('and writes the reason into the report');
  else fail('the report would still read "Scanning …" after the run died');
  if (/st\.errors/.test(blew) && /bulkImportArm_\(\)/.test(blew)) {
    ok('it retries a couple of times before giving up');
  } else fail('a single Drive hiccup would end the whole run');
  if (/st\.errors < 3/.test(blew)) ok('but not for ever');
  else fail('nothing bounds the retries — a permanent error would re-arm in a loop');

  /* The foreground runner is the one that must NOT swallow: its whole job is
     to put the stack on the screen somebody is looking at. */
  /* Comments stripped first: this function's own comment explains why it does
     NOT catch, and matching that prose would fail the check it describes. */
  const now = fn('bulkImportContinue').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (!now) fail('there is no foreground runner');
  else if (/catch/.test(now)) {
    fail('bulkImportContinue catches its own error — then the editor shows nothing useful ' +
         'and the stall is just as opaque as before');
  } else ok('the foreground runner lets the editor show the stack');
  if (/bulkImportSlice_\(\)/.test(now)) ok('and it shares the same slice the trigger runs');
  else fail('the foreground runner has its own copy of the work');

  /* Progress must survive either path, or a resumed run redoes everything. */
  const slice = fn('bulkImportSlice_');
  if (/bulkImportSave_\(st\)/.test(slice)) ok('a slice saves its progress whichever way it was started');
  else fail('bulkImportSlice_ never saves — a resumed run would start from the beginning');
}

/* =====================================================================
   10. THE RUN DROPDOWN READS IN THE ORDER YOU RUN IT.
   ---------------------------------------------------------------------
   The Apps Script editor lists top-level functions in FILE ORDER and hides
   anything ending in an underscore. For a migration somebody runs twice ever,
   that list is the only instruction they get at the moment they click — and
   it first shipped as Start, Step, Scan, Apply, Status, Stop: two pieces of
   machinery above the thing you actually want, and Apply sitting next to Scan
   with nothing to say which comes first.
   ===================================================================== */
{
  const pub = (GAS.match(/^function (bulkImport[A-Za-z0-9_]*)\s*\(/gm) || [])
    .map(m => m.replace(/^function /, '').replace(/\s*\($/, ''))
    .filter(n => !n.endsWith('_'));          // the editor hides these
  const want = ['bulkImport1_Scan', 'bulkImport2_Apply', 'bulkImportContinue',
                'bulkImportStatus', 'bulkImportStop', 'bulkImportRepair',
                'bulkImportStep'];
  eq(pub.join(' → '), want.join(' → '),
     'the dropdown reads: scan, apply, continue, status, stop, repair, then the trigger handler');

  /* The numbered pair must stay numbered: they are the only two that have a
     wrong order to get wrong. */
  if (/^function bulkImport1_Scan/m.test(GAS) && /^function bulkImport2_Apply/m.test(GAS)) {
    ok('and the two passes carry their order in their names');
  } else fail('the two passes are no longer numbered — nothing in the dropdown says which is first');

  /* Machinery must not climb back into the list. */
  const machinery = ['bulkImportStart_', 'bulkImportSlice_', 'bulkImportOne_',
                     'bulkImportArm_', 'bulkImportBlewUp_', 'bulkImportState_'];
  const leaked = machinery.filter(n => pub.indexOf(n.replace(/_$/, '')) > -1);
  if (leaked.length) fail('machinery is showing in the dropdown: ' + leaked.join(', '));
  else ok('the machinery stays out of it');

  /* And the trigger handler must stay public, or the trigger stops firing. */
  if (/^function bulkImportStep\s*\(/m.test(GAS)) ok('the trigger handler is still public');
  else fail('bulkImportStep was made private — a trailing-underscore trigger handler fires ' +
            'unreliably, which is the trap sweepTranscripts already hit');
}

/* =====================================================================
   11. A ROW IS NEVER PLACED BY ASKING getLastRow() AFTER WRITING BLANKS.
   ---------------------------------------------------------------------
   This one actually happened, to ~40 real quotes. importApplyCore_ did
   appendRow(new Array(23).fill('')) and then took getLastRow() as the row it
   had just made. A row of empty strings is still blank to getLastRow(), so on
   a tab whose only content was the header it answered 1 — and the import wrote
   the quote OVER the header. The next one asked again, got 1 again, and
   overwrote that. Forty quotes went through row 1 of the new Import tab,
   one survived, and with "Quote #" gone from C1 every sheet sweep skipped the
   whole tab: the console could not find any of them.

   It hid for as long as it did because every other caller appends to a tab
   that already holds rows. Creating a fresh tab is what the bulk import added.
   ===================================================================== */
{
  const core = fn('importApplyCore_');
  if (/appendRow\(new Array\(HEADERS\.length\)\.fill\(''\)\)/.test(core)) {
    fail('importApplyCore_ still appends a row of blanks — getLastRow() does not count ' +
         'those, so on a tab holding only its header the next write lands ON the header');
  } else ok('no blank row is appended before the write');
  if (/rowNum\s*=\s*sh\.getLastRow\(\)\s*;/.test(core)) {
    fail('the target row is getLastRow() itself — that is the row that already has data');
  } else ok('the target row is not getLastRow() itself');
  if (/Math\.max\(sh\.getLastRow\(\),\s*1\)\s*\+\s*1/.test(core)) {
    ok('it writes below the last row with real data, and never to row 1');
  } else fail('importApplyCore_ no longer computes its row defensively — row 1 is the header ' +
              'and must never be a target');

  /* And the repair for the damage already done. */
  const rp = fn('bulkImportRepair');
  if (/insertRowBefore\(1\)/.test(rp)) ok('the repair puts a header row back above a stranded quote');
  else fail('bulkImportRepair does not restore the header row');
  if (/setValues\(\[HEADERS\]\)/.test(rp)) ok('and writes the real HEADERS, not a guess at them');
  else fail('the repair does not write HEADERS');
  if (/survivors\.indexOf\(qn\) > -1/.test(rp)) {
    ok('a quote that really is on the tab is not queued for a second import');
  } else fail('the repair would re-import the surviving quote, duplicating it');
  if (/'IMPORT'\)/.test(rp)) ok('and the rest of the report is set back to IMPORT');
  else fail('the repair never re-arms the report, so Apply would have nothing to do');
}

/* =====================================================================
   12. IT IS RUNNABLE FROM THE CONSOLE, NOT JUST THE EDITOR.
   ---------------------------------------------------------------------
   The Apps Script Run dropdown lists every top-level function in the file, in
   file order — hundreds of them. Telling somebody to scroll to line 3756 to
   start a migration of 139 live customer quotes is not an interface, and the
   person running it could not find the functions at all.
   ===================================================================== */
{
  const ADMIN = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');

  /* Every button must have a server endpoint, and every endpoint a button. */
  [['bulkImpStart', 'bulkStart('], ['bulkImpState', 'bulkPoll'],
   ['bulkImpStop', 'bulkStop('], ['bulkImpNudge', 'bulkNudge('],
   ['bulkImpRepair', 'bulkRepair(']].forEach(function (pair) {
    const fnName = pair[0];
    if (!new RegExp(fnName + ':\\s*function').test(GAS))
      fail('the console calls ' + fnName + ' but the server does not answer it');
    else if (ADMIN.indexOf(pair[1]) < 0)
      fail('the server answers ' + fnName + ' but no console control reaches it');
    else ok('the console can ' + fnName.replace('bulkImp', '').toLowerCase() + ' a run');
  });

  /* ~139 quotes into live customer data is an admin act, like deleting one. */
  ['adminBulkImportStart', 'adminBulkImportStop', 'adminBulkImportNudge',
   'adminBulkImportRepair'].forEach(function (n) {
    const body = fn(n);
    if (/who\.admin/.test(body)) ok(n + ' is admin-only');
    else fail(n + ' is not admin-only — it writes or destroys at scale');
  });

  /* NONE of them may wait for the folder to be read. A console call slow
     enough to be dropped is a console call reported wrong, and the one you
     least want reported wrong is the one that starts an import. */
  ['adminBulkImportStart', 'adminBulkImportState', 'adminBulkImportStop',
   'adminBulkImportNudge'].forEach(function (n) {
    const body = fn(n);
    if (/bulkImportSlice_\(|legacyReadGrid_\(/.test(body)) {
      fail(n + ' reads files inline — that call would run for minutes and be dropped');
    } else ok(n + ' returns without reading a single file');
  });

  /* Starting a second run on top of a live one would double-import. */
  if (/running\.i < running\.jobs\.length/.test(fn('adminBulkImportStart'))) {
    ok('a run cannot be started on top of one already going');
  } else fail('the console can start a second run over a live one — every file imported twice');

  /* The state read may fall back to GET like every other read; the four writes
     must not, or a lost POST could replay one. */
  if (/bulkImpState: 1/.test(GAS)) ok('the state read can answer on GET');
  else fail('bulkImpState is not on CONSOLE_GET_FNS_, so a lost read cannot retry');
  ['bulkImpStart', 'bulkImpStop', 'bulkImpNudge', 'bulkImpRepair'].forEach(function (n) {
    if (new RegExp('\\b' + n + ':\\s*1').test(GAS))
      fail(n + ' is GET-able — a write must never be followable twice');
  });
  ok('the four writes stay POST-only');

  /* A timer left polling against a phone in the yard is somebody's battery. */
  if (/bulkPollStop\(\)/.test(ADMIN)) ok('the poll stops when the card is closed');
  else fail('nothing stops the status poll');
}

if (bad) { console.error('\n' + bad + ' problem(s) with the Import tab'); process.exit(1); }
console.log('import tab holds: drafts stay off every customer path, duplicates are skipped, ' +
            'the dry run writes nothing');
