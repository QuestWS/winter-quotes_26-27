#!/usr/bin/env node
/* Which Drive folder a quote's paperwork is filed in — executed.
   ---------------------------------------------------------------------------
   Chris's rule: a quote is filed under the season whose rates it is ACTUALLY
   priced at. While PRICES holds 2025-2026 numbers every quote is an estimate
   and belongs in last season's folder — except one we negotiated a real
   2026-2027 price for, which is a current quote and files under 2026-2027
   today. At the rollover everything becomes current and files there.

   None of that is provable by reading it, because the interesting parts are
   what happens at the boundaries:

     - the season labels use an EN DASH and folder names use a hyphen, so a
       label that misses the lookup table would quietly create a SECOND,
       near-identically-named folder beside the real one
     - "Winter Quotes 2025-26" must keep its short spelling: it exists, it
       holds a season of PDFs, and its URLs are stored on the sheet
     - a quote that CHANGES folder must still be findable in the one it came
       from, or an email goes out with no PDF attached and nothing says so
     - and the previous PDF must be binned from the old folder, or one quote
       ends up with two PDFs carrying different totals

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');

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

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

const OVERRIDE_QUOTE = 'QW-26-1991';   // the negotiated-rate quote (see QUOTE_RATE_OVERRIDES)
const OLD_FOLDER = 'Winter Quotes 2025-26';
const NEW_FOLDER = 'Winter Quotes 2026-2027';

/* Build the folder rule with PRICING and QUOTE_RATE_OVERRIDES injectable, so
   the rollover can be simulated rather than described. */
function build(pricing, overrides) {
  return new Function('PRICING', 'QUOTE_RATE_OVERRIDES', 'DRIVE_FOLDER_NAME', [
    decl('SEASON_FOLDERS_'),
    fn('seasonFolderName_'), fn('quoteRateSeason_'), fn('allSeasonFolderNames_'),
    'return {seasonFolderName_, quoteRateSeason_, allSeasonFolderNames_};'
  ].join('\n'))(pricing, overrides, OLD_FOLDER);
}

const PROVISIONAL = { provisional: true,  ratesLabel: '2025–2026', nextLabel: '2026–2027' };
const ROLLED_OVER = { provisional: false, ratesLabel: '2026–2027', nextLabel: '2027–2028' };
const OVERRIDES = { [OVERRIDE_QUOTE]: { insideNT: 6.74 } };

const folderOf = (api, d) => api.seasonFolderName_(api.quoteRateSeason_(d));

/* ================= today: estimates in 25-26, the real price in 26-27 ====== */
console.log('=== today, while PRICES still holds 2025-2026 rates ===');
{
  const api = build(PROVISIONAL, OVERRIDES);
  const ordinary = folderOf(api, { quoteNo: 'QW-26-1255' });
  if (ordinary !== OLD_FOLDER) fail('an ordinary estimate filed to ' + ordinary + ', expected ' + OLD_FOLDER);
  else ok('an ordinary estimate -> ' + OLD_FOLDER);

  const negotiated = folderOf(api, { quoteNo: OVERRIDE_QUOTE });
  if (negotiated !== NEW_FOLDER) fail(OVERRIDE_QUOTE + ' filed to ' + negotiated + ', expected ' + NEW_FOLDER);
  else ok(OVERRIDE_QUOTE + ' (negotiated real price) -> ' + NEW_FOLDER);

  /* A quote with no number at all must not invent a folder. */
  const nameless = folderOf(api, {});
  if (nameless !== OLD_FOLDER) fail('a quote with no number filed to ' + nameless);
  else ok('a quote with no number -> ' + OLD_FOLDER + ' (not treated as negotiated)');
}

/* ================= after the rollover: everything is current ============== */
console.log('=== after PRICES is updated and provisional goes false ===');
{
  const api = build(ROLLED_OVER, OVERRIDES);
  ['QW-26-1255', OVERRIDE_QUOTE, 'QW-26-4242'].forEach(qn => {
    const got = folderOf(api, { quoteNo: qn });
    if (got !== NEW_FOLDER) fail(qn + ' filed to ' + got + ' after the rollover, expected ' + NEW_FOLDER);
  });
  if (!bad) ok('every quote, negotiated or not -> ' + NEW_FOLDER);

  /* The override must not push a quote into a season BEYOND the current one
     once rates are real — otherwise it would file under 2027-2028. */
  const negotiated = folderOf(api, { quoteNo: OVERRIDE_QUOTE });
  if (negotiated.indexOf('2027-2028') > -1) {
    fail('the override pushed ' + OVERRIDE_QUOTE + ' into a future season: ' + negotiated);
  } else ok('the override stops mattering once rates are real — no run-ahead into 2027-2028');
}

/* ================= the en-dash trap ======================================= */
console.log('=== the label/folder dash mismatch ===');
{
  const api = build(PROVISIONAL, OVERRIDES);
  const cases = [
    ['2025–2026', OLD_FOLDER, 'en dash (what SEASON actually uses)'],
    ['2025-2026',      OLD_FOLDER, 'plain hyphen'],
    ['2026–2027', NEW_FOLDER, 'en dash, new season'],
    ['2026-2027',      NEW_FOLDER, 'plain hyphen, new season'],
    ['2026—2027', NEW_FOLDER, 'em dash'],
    [' 2026-2027 ',    NEW_FOLDER, 'stray whitespace']
  ];
  cases.forEach(([label, want, why]) => {
    const got = api.seasonFolderName_(label);
    if (got !== want) fail(why + ': ' + JSON.stringify(label) + ' -> ' + got + ', expected ' + want);
  });
  if (!bad) ok('every dash and spacing variant resolves to the one real folder');

  /* An unlisted future season must still get a sane, long-form name. */
  const future = api.seasonFolderName_('2027–2028');
  if (future !== 'Winter Quotes 2027-2028') fail('an unlisted season became ' + future);
  else ok('an unlisted season -> ' + future + ' (long form, like the spreadsheet)');
}

/* ================= 2025-26 keeps its existing spelling ==================== */
console.log('=== the folder that already exists is not renamed ===');
{
  const api = build(PROVISIONAL, OVERRIDES);
  const got = api.seasonFolderName_('2025–2026');
  if (got !== OLD_FOLDER) fail('the 2025-2026 folder resolved to ' + got + ' — its stored URLs would break');
  else ok(OLD_FOLDER + ' keeps its short spelling, so stored links still resolve');
  if (got === 'Winter Quotes 2025-2026') fail('2025-2026 was long-formed into a brand new empty folder');
}

/* ================= a moved quote is still findable ======================== */
console.log('=== lookups cover the folder a quote came from ===');
{
  const api = build(PROVISIONAL, OVERRIDES);
  const all = api.allSeasonFolderNames_();
  [OLD_FOLDER, NEW_FOLDER].forEach(n => {
    if (all.indexOf(n) < 0) fail(n + ' is not in the lookup sweep — a PDF there would be unfindable');
  });
  if (new Set(all).size !== all.length) fail('the sweep lists a folder twice: ' + all.join(', '));
  if (!bad) ok('the sweep covers both folders, no duplicates: ' + all.join(' + '));

  const rolled = build(ROLLED_OVER, OVERRIDES).allSeasonFolderNames_();
  if (rolled.indexOf(OLD_FOLDER) < 0) {
    fail('after the rollover the 2025-26 folder drops out of the sweep — last season\'s PDFs become unfindable');
  } else ok('after the rollover the old folder is still searched');
}

/* ================= the wiring actually uses all this ====================== */
console.log('=== the callers were moved over ===');
{
  const perQuote = { savePdf_: 'the quote PDF',
                     ensurePhotoFolders_: 'the photo folder',
                     adminUploadContract: 'the signed contract' };
  Object.keys(perQuote).forEach(name => {
    const body = fn(name);
    if (/getFolder_\(\)/.test(body)) fail(name + ' still files ' + perQuote[name] + ' by the clock, not by the quote');
    else if (!/seasonFolderFor_\(/.test(body)) fail(name + ' does not use seasonFolderFor_');
    else ok(name + ' files ' + perQuote[name] + " in the quote's own season folder");
  });
  /* The pre-restore snapshot belongs to the season, not to a quote. */
  if (!/getFolder_\(\)/.test(fn('snapshotBeforeRestore_'))) {
    fail('snapshotBeforeRestore_ no longer uses the current-season folder');
  } else ok('the pre-restore snapshot still goes to the current season folder');

  if (!/trashQuotePdfs_/.test(fn('savePdf_'))) {
    fail('savePdf_ does not clear old PDFs across folders — a moved quote keeps two');
  } else ok('savePdf_ bins prior PDFs from every season folder');

  if (!/getFolderById/.test(fn('ensurePhotoFolders_'))) {
    fail('ensurePhotoFolders_ re-derives the path instead of reusing the stored folder id');
  } else ok('an existing photo folder is reused by its stored id, so photos are never split');
}

if (bad) { console.error('\n' + bad + ' season-folder check(s) FAILED'); process.exit(1); }
console.log('\nseason folders: a quote is filed under the rates it is actually priced at');
