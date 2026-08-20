# Where things are

A finding aid, not a rule book — the rules are in `CLAUDE.md` and `docs/ref/`.
Read this before grepping, so one search finds it instead of four.

Function names here are checked against the code by
`tools/check-docs-coverage.js`: if something is renamed and this file is not
updated, the guard fails. Line numbers are deliberately absent — they go stale
in a day and a function name does not.

## The files

| File | Lines | What lives in it |
|---|---|---|
| `quote-logger-apps-script.gs` | ~5,300 | The entire backend: routing, pricing replay, the sheet, PDFs, every email, the console API |
| `index.html` | ~1,550 | The customer quote page |
| `admin/index.html` | ~2,100 | The staff console — one big `<script>`, so no duplicate top-level function names |
| `pricing-engine.js` | ~340 | The shared rule set. Embedded verbatim in the `.gs` between `ENGINE-START`/`ENGINE-END` |
| `terms.html`, `privacy.html`, `legal.css`, `terms-config.js` | small | Legal pages and the single `QuestTerms` version constant |
| `tools/verify.sh` | ~570 | Runs before every deploy; calls each `tools/check-*.js` |
| `docs/build-guides.py` | ~1,140 | Builds the four staff PDFs in `docs/pdf/` |

## Backend entry points

Everything arrives through two functions. Start at whichever matches the
symptom.

| Entry | Handles |
|---|---|
| `doPost` | Customer saves, and **every** console API call (the action is dispatched from a table inside it) |
| `doGet` | `?action=load` (customer reload), `?action=findlead`, `?action=launchpref`, `?action=seasondone`, `?page=admin` (legacy console) |

## Feature → where to start

### Pricing and quote state
| Feature | Entry point | File |
|---|---|---|
| The rules themselves | `computeQuote` | `pricing-engine.js` |
| Which storage tab a quote belongs on | `storageTabFor` | `pricing-engine.js` |
| The dimension line shown everywhere | `dimsString` | `pricing-engine.js` |
| Phone formatting, page and server | `fmtPhone`, `fmtPhonePartial` | `pricing-engine.js` |
| Server re-prices a customer save | `rebuildLinesFromState_` | `.gs` |
| Staff changes replayed onto clean lines | `applyManualOps_` | `.gs` |
| Quest's measurements over the customer's | `effectiveState_` | `.gs` |
| Page/server disagreement | `driftNoteFor_` | `.gs` |
| Finding a quote's row | `findQuoteRow_`, `findQuoteRowFrom_` | `.gs` |
| Stale copies after a storage move | `pruneQuoteCopies_`, `moveQuoteRow_` | `.gs` |

### Money
| Feature | Entry point | File |
|---|---|---|
| Record a payment or refund | `adminRecordPayment` | `.gs` |
| Adjustment / discount | `adminAdjust` | `.gs` |
| Late fee | `adminLateFee` | `.gs` |
| Line edit and delete | `adminEditLine` (the action argument selects which) | `.gs` |
| Price a requested service | `adminPriceRequest` | `.gs` |
| Balance columns on the sheet | `writeMoneyCols_` | `.gs` |

### Email
| Feature | Entry point | File |
|---|---|---|
| **Every** email body | `buildEmailFor_` | `.gs` |
| Customer-facing bodies | `customerEmailHtml_`, `noticeHtml_` | `.gs` |
| Send, and record in Email History | `adminSendEmail`, `recordEmail_` | `.gs` |
| The two automatic sends | `dailyReminderCheck`, `leadFollowUpCheck` | `.gs` |
| The pause switch | `autoPauseState_`, `autoEmailsPaused_`, `adminSetAutoPause` | `.gs` |
| Send to all | `bulkTargets_`, `bulkFilterTargets_`, `bulkSendKind_` | `.gs` |
| Spreadsheet-menu sends | `menuSendKind_`, `menuBulkSend_` | `.gs` |

### Staff console
| Feature | Entry point (server) | Entry point (console) |
|---|---|---|
| Sign in, sessions, lockout | `adminAuth`, `requireAuth_` | `doLogin` |
| Permissions incl. the `keys` fallback | `resolvedPerms_`, `canKeys_` | `permsOf` |
| Load a quote | `adminLookup`, `adminSearch` | `renderQuote` |
| Home tiles and the menu | — | `navGate`, `syncHome` |
| Dimensions, motors, storage move | `adminDimsPreview`, `adminDimsApply`, `sanitizeEngines_` | `renderDims`, `previewDims` |
| Keys and slip | `adminKeysApply`, `sanitizeKeys_`, `missingHaulInfo_` | `renderKeys`, `saveKeys` |
| Staff notes | `adminSetStaffNote` | `renderStaffNote`, `saveStaffNote` |
| Season re-price | `repriceScan_`, `adminRepricePreview`, `adminRepriceApply` | `previewReprice`, `doReprice` |
| Old-sheet import | `parseLegacyGrid_`, `legacyToState_`, `adminImportPreview`, `adminImportApply` | `previewImport`, `doImport` |
| Backup restore | `adminBackupPreview`, `adminBackupRestore`, `snapshotBeforeRestore_` | `readBackupFile`, `doRestore` |
| Storage view and yard printing | `adminStorageView` | `printStorage`, `printHaulOut` |
| Staff accounts | `adminAddStaff`, `adminRemoveStaff`, `freshPin_`, `adminCount_` | `addStaff`, `removeStaff` |
| Photos | `adminUploadPhoto` | `refreshPhotos` |
| Email preview frame | `adminEmailPreview` | `pvRender` |

### Customer page
| Feature | Entry point |
|---|---|
| Contact gate and terms acceptance | `startAcceptAndContinue`, `contactMissing_`, `stampTermsAcceptance_` |
| Resume an unfinished quote | `checkForUnfinished_`, `autoLoadFromUrl_` |
| Restore a loaded quote into the form | `hydrateFromState` |
| Recompute and redraw | `refresh` |
| Engine type exclusivity | `clearOtherEngineTypes_`, `syncEngineRows_` |

## The guards, and what each one actually proves

`verify.sh` runs all of these. Each *executes* the rule rather than grepping
for it, which is the point — an inverted condition passes a grep.

| Script | Proves |
|---|---|
| `check-embedded-engine.js` | The engine copy inside the `.gs` runs as bare top-level code and prices identically |
| `sync-engine.js --check` | That copy is textually identical to `pricing-engine.js` |
| `price-fixtures.js --check-baseline` | Nine quotes still price to the committed cent |
| `check-bulk-targets.js` | A lead is never a send-to-all recipient; the picker can only narrow |
| `check-haul-info.js` | Who gets asked for keys and slip, over every combination |
| `check-engine-rules.js` | One motor type per boat, whole counts only |
| `check-perms-pause.js` | The `keys` fallback, and that a corrupt pause reads as PAUSED |
| `check-reprice.js` | A discount survives a season re-price |
| `check-legacy-import.js` | Old-sheet parsing, including the broken and comparison files |
| `check-phone-format.js` | One phone format everywhere, and nothing mangled |
| `check-docs-coverage.js` | No rule has vanished from `CLAUDE.md` + `docs/ref/` |
