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
| `sign.html` | ~250 | The scan-to-sign page: a QR at the counter, a quote number, and the hand-off to the Adobe form |
| `harbor-haul-out/index.html` | ~900 | Harbor Haul Out: four lists, one unit at a time, the Harbor Haul Out log, dictation, photos and re-measuring. One big `<script>`, same no-duplicate-names rule as the console |
| `quest.css` | ~125 | The canonical Quest palette and control shapes, linked by `sign.html` |
| `terms.html`, `privacy.html`, `legal.css`, `terms-config.js` | small | Legal pages and the single `QuestTerms` version constant |
| `tools/verify.sh` | ~570 | Runs before every deploy; calls each `tools/check-*.js` |
| `docs/build-guides.py` | ~1,140 | Builds the four staff PDFs in `docs/pdf/` |
| `docs/build-manual.py` | ~620 | Builds `docs/pdf/5 - Winter Services Program Manual.pdf` — every feature, how-to and permission in one volume. Rebuild when a feature or permission changes; not part of `emailGuides()` |

## Backend entry points

Everything arrives through two functions. Start at whichever matches the
symptom.

| Entry | Handles |
|---|---|
| `doPost` | Customer saves, and **every** console API call (the action is dispatched from a table inside it) |
| `doGet` | `?action=load` (customer reload), `?action=findlead`, `?action=newquoteno` (a number set aside for a quote about to be built), `?action=signlookup` (scan-to-sign), `?action=launchpref`, `?action=seasondone`, `?page=admin` (legacy console) |

## Feature → where to start

### Pricing and quote state
| Feature | Entry point | File |
|---|---|---|
| The rules themselves | `computeQuote` | `pricing-engine.js` |
| The dates a quote prints (`d.season`) | `seasonStamp` | `pricing-engine.js` |
| Which Drive folder a quote is filed in | `quoteRateSeason_`, `seasonFolderName_`, `seasonFolderFor_`, `allSeasonFolderNames_`, `trashQuotePdfs_` | `.gs` |
| A quote number nothing else is using | `uniqueQuoteNo_`, `takenQuoteNos_`, `readReservations_` | `.gs` |
| The page asking for one before it saves | `reserveQuoteNo_` (page), `?action=newquoteno` (`doGet`) | `index.html`, `.gs` |
| Estimate disclaimer while rates are last season's | `pricingNotice`, `lockinCopy`, `pricesValidSentence` (switched by `PRICING`) | `pricing-engine.js` |
| Where the page puts that disclaimer | `applyPricingNotice` | `index.html` |
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
| The "pick up your quote" link | `quoteLink_`, `quoteLinkFor_` | `.gs` |
| The "review & sign" link | `signUrlFor` (engine), `signUrlFor_` (`.gs` wrapper) | both |
| Send, and record in Email History | `adminSendEmail`, `recordEmail_` | `.gs` |
| The two automatic sends | `dailyReminderCheck`, `leadFollowUpCheck` | `.gs` |
| Holding the reminder off an imported quote | `isImportHoldMark_`, `isImportSentMark_`, `importSentAt_`, `releaseImportHold_` | `.gs` |
| The pause switch | `autoPauseState_`, `autoEmailsPaused_`, `adminSetAutoPause` | `.gs` |
| Send to all | `bulkTargets_`, `bulkFilterTargets_`, `bulkSendKind_` | `.gs` |
| The firm quote (rates final) and whether a quote may get it | `firmQuoteBlocker_`, `priceStampStale_` (kind `firmquote` in `buildEmailFor_`) | `.gs` |
| Spreadsheet-menu sends | `menuSendKind_`, `menuBulkSend_` | `.gs` |

### Staff console
| Feature | Entry point (server) | Entry point (console) |
|---|---|---|
| Sign in, sessions, lockout | `adminAuth`, `requireAuth_` | `doLogin` |
| Permissions incl. the `keys` and `measure` fallbacks | `resolvedPerms_`, `canKeys_`, `canMeasure_` | `permsOf`, `myPerms_` |
| Load a quote | `adminLookup`, `adminSearch` | `renderQuote` |
| Talking to the backend | `consoleServe_`, `consoleFns_` | `api`, `apiLostReply_` |
| Speed: one trip per click, timing, warm-up | `withQuote_`, `adminPing` | `afterWrite_`, `apiTiming_` |
| Speed: every tab in one read | `quoteTabGrids_` (used by `adminStorageView`, `adminSearch`, `findQuoteCtx_`) | — |
| Home tiles and the menu | — | `navGate`, `syncHome` |
| Dimensions, motors, storage move | `adminDimsPreview`, `adminDimsApply`, `sanitizeEngines_` | `renderDims`, `previewDims` |
| Keys and slip | `adminKeysApply`, `sanitizeKeys_`, `missingHaulInfo_` | `renderKeys`, `saveKeys` |
| Staff notes | `adminSetStaffNote` | `renderStaffNote`, `saveStaffNote` |
| Heritage Harbor slipholder discount | `adminHho`, `hhoSetDecision_`, `hhoInfo_`, `hhoLineEdit_`; tiers `RULES.hhoTiers`, `withHhoDiscount` (engine) | `renderHho`, `saveHho` |
| Customer link for a quote | `quoteLinkFor_` (on `adminLookup`) | `renderQuoteLink`, `copyQuoteLink` |
| Season re-price | `repriceScan_`, `adminRepricePreview`, `adminRepriceApply` | `previewReprice`, `doReprice` |
| The one quote held out of it (not a category) | `priceIsFirm_` (engine) | — |
| Old-sheet import (one at a time) | `parseLegacyGrid_`, `legacyToState_`, `adminImportPreview`, `adminImportApply`, `importApplyCore_` | `previewImport`, `doImport` |
| Bulk import of a season folder | `bulkImport1_Scan`, `bulkImport2_Apply`, `bulkImportStep`, `bulkImportOne_`, `bulkImportDuplicateOf_`, `BULKIMP_NOT_A_QUOTE_` | editor-run; report sheet on Drive |
| Keeping a draft off every customer path | `IMPORT_TAB`, `isImportTab_`, `isOffstageTab_` | — |
| Where an appended row goes (and the header-row rescue) | `nextQuoteRow_`, `rescueClobberedHeader_`, `quoteTabFor_`, `rescueAllQuoteTabs_`, `repairImportedRows` | `.gs` |
| Which imports went missing | `importAudit` | `.gs` (editor) |
| Backup restore | `adminBackupPreview`, `adminBackupRestore`, `snapshotBeforeRestore_` | `readBackupFile`, `doRestore` |
| Storage view and printing | `adminStorageView` | `printStorage`, `printHaulOut` |
| Whether to ask where the trailer is | `needsTrailerLoc_`, `trailerApplies` (land units have none) | `renderKeys`, `keysNoTrailer`; Harbor Haul Out `renderSheet` |
| Deposit / no-deposit tabs and the red no-contract tag | `adminStorageView` (`deposit`, `contract`, `STORAGE_VIEW_V_`) | `setStorageFilter`, `renderStorage`, `storageGroups_`, `storageCounts_` |
| The customer's own note (list tag, Customer notes tab, quote card) | `customerNoteOf_` (`cnote` on the storage rows, `customerNote` on `adminLookup`) | `renderStorage`, `renderQuote` |
| Imported drafts as a scrollable list | `adminDraftList` | `loadDrafts_`, `renderDrafts_` |
| Asking a customer to sign | `signUrlFor_` (kind `signreminder` in `buildEmailFor_`), `unbuildableMsg_` | `signAskAllowed_`, `syncSignAsk_`, `myPerms_` |
| Whether a unit may be pulled at all | `haulAuth_` (the .gs owns the rule; every client renders it) | `haulPartition_`, `haulSort_`, `haulHoldText_` |
| Keys, slip and trailer location | `KEYFIELDS_`, `KEYLABELS_`, `sanitizeKeys_`, `adminKeysApply` | `renderKeys`, `saveKeys` |
| The Harbor Haul Out log | `adminAddPlacementNote`, `PLACEMENT_NOTE_MAX_` | `renderPlacementLog`, `addPlacementNote` |
| The per-unit alert (set: console only) | `adminSetPlacementAlert`, `PLACEMENT_ALERT_MAX_` | console `renderAlert`/`saveAlert`; Harbor Haul Out `alert_`/`renderAlert` display only |
| Staff accounts | `adminAddStaff`, `adminRemoveStaff`, `freshPin_`, `adminCount_` | `addStaff`, `removeStaff` |
| Deleting a quote (admins only) | `adminDeleteQuote`, `deletedSheet_`, `deletedHeaders_`, `DELETED_TAB` | `renderDeleteQuote`, `doDeleteQuote` |
| Photos | `adminUploadPhoto` | `refreshPhotos` |
| Signed contract on file | `adminUploadContract` | `renderContract`, `contractFiles`, `uploadContract` |
| Email preview frame | `adminEmailPreview` | `pvRender` |

### Harbor Haul Out
| Feature | Entry point (server) | Entry point (app) |
|---|---|---|
| The four lists | `adminStorageView` | `listOf_`, `pullList_`, `awaitList_`, `storeList_`, `render`, `setTab` |
| Moving a unit along (pulled / dropped off / stored) | `PLACEMENT_STATES_`, `adminSetPlacementState`, `placementStateOf_` | `markState`, `renderState`, `act_` (pulled is on the opened unit, not the row; dropped off is a row action on Awaiting and works from the console too) |
| Search and sort | — | `search_`, `storeList_`, `toggleSort`, `byLocation_`, `byName_` |
| May we pull this one | `haulAuth_` | `auth_` (renders it; never decides it) |
| One unit | `adminLookup` | `openQuote`, `renderSheet` |
| Re-measuring at the harbor | `canMeasure_`, `adminDimsPreview`, `adminDimsApply`, `dimsProposal_` | `renderDims`, `collectDims`, `previewDims`, `drawDiff`, `applyDims`, `canMeasure` |
| The Harbor Haul Out log | `adminAddPlacementNote` | `renderLog`, `saveNote` |
| Voice notes (record) | `voiceFolder_`, `adminAddPlacementNote` | `startRec`, `stopRec`, `drawRecorder`, `recSupported_` |
| Voice notes (typing them up) | `queueTranscript_`, `processTranscriptQueue`, `submitTranscript_`, `applyTranscript_`, `transcriptWebhook_`, `sweepTranscripts` | `renderLog` |
| Photos and video | `adminUploadSession` (direct), `adminUploadPhoto` (relay), `adminPhotoInfo` | `upload`, `uploadOne_`, `putDirect_`, `upPump_`, `refreshPhotos` |
| Bad connection | `consoleServe_`, `adminJobStatus` | `api`, `settle_`, `lost_` |
| Full-size uploads that survive a harbor signal | `adminUploadSession` | `putDirect_`, `upAsk_`, `upResume_`, `upWake_` |

### Customer page
| Feature | Entry point |
|---|---|
| Contact gate and terms acceptance | `startAcceptAndContinue`, `contactMissing_`, `stampTermsAcceptance_` |
| Resume an unfinished quote | `checkForUnfinished_`, `autoLoadFromUrl_` |
| Land on a quote from a link | `autoLoadFromUrl_` (server side: `quoteLink_`) |
| The Adobe Sign step and its pre-fill | `adobeSignUrl` (rules: `SIGNING`, `signUrlFor` in the engine) |
| Scan to sign, at the counter | `signLookup_`, `signLookupAllowed_`, `maskLastName_` (`.gs`); the page is `sign.html` |
| A typed quote number, normalized | `normalizeQuoteNo` (engine — page and server share it) |
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
| `check-hho-discount.js` | The slipholder discount is asked, never shown; nothing applies until staff approve; a tiered approval follows the services total down when a service comes off; a typed amount stays fixed |
| `check-engine-rules.js` | One motor type per boat, whole counts only |
| `check-perms-pause.js` | The `keys` fallback, and that a corrupt pause reads as PAUSED |
| `check-reprice.js` | A discount survives a season re-price |
| `check-legacy-import.js` | Old-sheet parsing, including the broken and comparison files |
| `check-import-write.js` | An imported quote lands on a free row — never on the last quote, never on the header row |
| `check-phone-format.js` | One phone format everywhere, and nothing mangled |
| `check-pricing-notice.js` | The estimate disclaimer renders on page, PDF and every email while pricing is provisional, and one flag removes all of it |
| `check-sign-page.js` | The scan-to-sign page still hands off correctly, and still fails **open** against a backend that is missing, slow, refusing or lying |
| `check-harbor-haul-out.js` | Harbor Haul Out renders the server's pull verdict rather than forming one, an unstamped row reads as blocked, the pull list is slip-only, and its GET retry list is a subset of the server's |
| `check-sign-chase.js` | A unit is cleared to pull if and only if it is BOTH signed and paid, and the two holds name their own reason; the deposit tabs sort by payment rather than balance; a lead sits outside both; the sign nudge refuses to build rather than ship a dead button |
| `check-design-tokens.js` | One Quest palette — every page that copies it still matches `quest.css`, and every deliberate difference is declared |
| `check-season-stamp.js` | A re-price re-dates as well as re-costs, an import carries a season stamp at all, and a batch import cannot trip the automatic reminder |
| `check-quote-numbers.js` | A minted quote number is never one already on the sheet or reserved, and minting rewrites nothing |
| `check-season-folders.js` | A quote is filed under the rates it is priced at; the en-dash labels resolve to the real folders; a moved quote stays findable |
| `check-fast-reads.js` | The batched tab read gives exactly the per-tab answer and falls back when refused; a save's answer carries its quote only when it should |
| `check-harbor-haul-out-uploads.js` | Full-size Harbor Haul Out uploads resume after a drop, wait out no signal, survive the app closing, and land byte-for-byte exactly once |
| `check-docs-coverage.js` | No rule has vanished from `CLAUDE.md` + `docs/ref/` |
