#!/usr/bin/env bash
# Quest winter system — syntax + feature sweep. Run AFTER every edit, BEFORE deploying.
# Usage: bash tools/verify.sh        (requires node)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"; FAIL=0

check_js () { # file label
  if node --check "$1" 2>/dev/null; then echo "  OK   syntax: $2"
  else echo "  FAIL syntax: $2"; node --check "$1" 2>&1 | head -5; FAIL=1; fi
}
extract_scripts () { # html -> js
  python3 - "$1" "$2" <<'PY'
import re,sys
html=open(sys.argv[1]).read()
open(sys.argv[2],'w').write('\n;\n'.join(re.findall(r'<script>(.*?)</script>',html,re.S)))
PY
}
sweep () { # file label pattern...
  local f="$1" label="$2"; shift 2
  for p in "$@"; do
    if grep -q -- "$p" "$f"; then echo "  OK   $label: $p"
    else echo "  FAIL $label: MISSING $p"; FAIL=1; fi
  done
}

echo "== Apps Script =="
if [ -f quote-logger-apps-script.gs ]; then
  cp quote-logger-apps-script.gs "$TMP/gas.js"; check_js "$TMP/gas.js" "quote-logger-apps-script.gs"
  sweep quote-logger-apps-script.gs "backend" \
    "const COL" "applyManualOps_" "ensureManual_" "docTerm_" "isLandUnit_" \
    "buildEmailFor_" "recordEmail_" "requireAuth_" "auditLog_" "adminEditLine" \
    "adminEmailPreview" "adminUploadContract" "adminStorageView" "WEB_APP_URL" \
    "applySeasonDone_" "adminSetSeasonDone" "adminPriceRequest" "findQuoteRowFrom_" \
    "balanceReportCheck" "adminLateFee" \
    "effectiveState_" "rebuildLinesFromState_" "driftNoteFor_" "pruneQuoteCopies_" \
    "dimsProposal_" "adminDimsPreview" "adminDimsApply" "moveQuoteRow_" "adminQuoteHtml" \
    "adminAddStaff" "adminRemoveStaff" "freshPin_" "adminCount_" "revokeSessions_" \
    "adminBackupPreview" "adminBackupRestore" "snapshotBeforeRestore_" "checkRestoreAccess" \
    "sanitizeEngines_" "engineSummary_" "adminBulkPreview" "adminBulkSend" "bulkTargets_" \
    "BULK_KINDS_" "upnextfall" "adminSetStaffNote" "adminImportList" "adminImportPreview" "adminImportApply" "legacyToState_" "adminRepricePreview" "adminRepriceApply" "repriceScan_"
  # traps
  if grep -q "getService().getUrl()" quote-logger-apps-script.gs; then
    echo "  FAIL trap: getService().getUrl() present — /dev URL will leak into emails"; FAIL=1
  else echo "  OK   trap: no getService().getUrl()"; fi
  # Credits must survive the three authoritative paths. Display-only clamps
  # (menu prompts, late-fee gates) are fine and expected.
  if grep -A3 'function writeMoneyCols_' quote-logger-apps-script.gs | grep -q 'Math.max(0'; then
    echo "  FAIL trap: writeMoneyCols_ clamps balance — sheet will hide credits"; FAIL=1
  else echo "  OK   trap: sheet balance signed"; fi
  if grep -q "creditDue" quote-logger-apps-script.gs; then echo "  OK   trap: emails handle credits"
  else echo "  FAIL trap: creditDue missing — emails will not show credits"; FAIL=1; fi
  if grep -q "CREDIT DUE TO YOU" quote-logger-apps-script.gs; then echo "  OK   trap: PDF ledger handles credits"
  else echo "  FAIL trap: PDF credit row missing"; FAIL=1; fi
else echo "  (quote-logger-apps-script.gs not present)"; fi

echo "== Customer page =="
if [ -f index.html ]; then
  extract_scripts index.html "$TMP/page.js"; check_js "$TMP/page.js" "index.html"
  sweep index.html "page" "keyLoc" "hhoAddr" "tDocTerm" "CREDIT DUE TO YOU" "quoteLogUrl" \
    "lateRetrievalFee" "jump start"
else echo "  (index.html not present)"; fi

echo "== Staff console =="
if [ -f admin/index.html ]; then
  extract_scripts admin/index.html "$TMP/admin.js"; check_js "$TMP/admin.js" "admin/index.html"
  sweep admin/index.html "console" \
    "API_URL" "previewSend" "renderLines" "editLine" "qHist" "uploadContract" \
    "storageView" "printStorage" "toggleNav" "cameraInput" "qclose" \
    "renderSeasonDone" "saveSeasonDate" "renderRequests" "feewarn" \
    "renderDims" "previewDims" "applyDims" "printQuote" "dimsCard" \
    "addStaff" "removeStaff" "readBackupFile" "doRestore" "backupCard" \
    "renderMotors" "dimsMotors" "previewBulk" "doBulkSend" "printHaulOut" "bulkCard" \
    "previewReprice" "doReprice" "repriceCard" "pvRender" "saveStaffNote" "noteCard" "previewImport" "doImport" "importCard"
  # The email preview frame. srcdoc under a fully-restrictive sandbox renders in
  # Chrome and comes up BLANK on iOS Safari — which is what the yard uses, so the
  # preview was broken for the person who most needs it. It needs
  # allow-same-origin to be written into, and must NEVER get allow-scripts, or a
  # rendered email could execute.
  if grep -q 'id="pvFrame" sandbox="allow-same-origin"' admin/index.html; then
    echo "  OK   trap: preview frame is same-origin (renders on Safari)"
  else echo "  FAIL trap: preview frame sandbox changed — it will render blank on iOS"; FAIL=1; fi
  if grep -q 'id="pvFrame"[^>]*allow-scripts' admin/index.html; then
    echo "  FAIL trap: preview frame allows scripts — a rendered email could execute"; FAIL=1
  else echo "  OK   trap: preview frame cannot run scripts"; fi
  # A blank preview must announce itself rather than look like an empty email.
  if grep -q 'function pvRender' admin/index.html; then
    echo "  OK   trap: preview reports a failure instead of showing a blank box"
  else echo "  FAIL trap: pvRender missing — a failed preview would render blank"; FAIL=1; fi
  # no raw prompt() in the console — all inputs are inline UI
  if grep -q "prompt(" "$TMP/admin.js"; then
    echo "  FAIL trap: prompt() in console — replace with inline UI"; FAIL=1
  else echo "  OK   trap: no prompt() in console"; fi
  if [ "$(grep -c 'capture=' admin/index.html)" != "1" ]; then
    echo "  FAIL trap: 'capture' should appear exactly once (camera input only)"; FAIL=1
  else echo "  OK   trap: capture attribute on camera input only"; fi
  # Duplicate top-level function names silently shadow each other (the later
  # declaration wins). This killed the season-done buttons once: a photo-toggle
  # setSeason(s,btn) overwrote the season-done setSeason(choice).
  DUPFN=$(grep -oE '^\s*(async )?function [A-Za-z0-9_$]+' "$TMP/admin.js" \
          | grep -oE '[A-Za-z0-9_$]+$' | sort | uniq -d)
  if [ -n "$DUPFN" ]; then
    echo "  FAIL trap: duplicate function name(s) in console — later declaration shadows earlier:"
    echo "$DUPFN" | sed 's/^/         /'; FAIL=1
  else echo "  OK   trap: no duplicate function names in console"; fi
  # Every console destination has two doors: the ☰ menu item (xxxOpen) and the
  # home tile (xxxTile). They must be gated together — a tile that shows what a
  # menu item hides is a permission enforced in one place and forgotten in the
  # other. navGate() does both at once, so the guard is that nothing else
  # un-hides one of them on its own.
  OPENS=$(grep -oE 'id="[A-Za-z0-9_]+Open"' admin/index.html | sed 's/id="//;s/Open"//' | sort -u)
  for d in $OPENS; do
    if ! grep -q "id=\"${d}Tile\"" admin/index.html; then
      echo "  FAIL trap: menu item ${d}Open has no home tile ${d}Tile"; FAIL=1
    fi
  done
  if [ -n "$OPENS" ] && ! grep -q "function navGate" "$TMP/admin.js"; then
    echo "  FAIL trap: navGate() is gone — menu and tiles are being gated separately"; FAIL=1
  fi
  SOLO=$(grep -oE "\\$\('[A-Za-z0-9_]+(Open|Tile)'\)\.classList\.(remove|toggle)\('hide'" "$TMP/admin.js" || true)
  if [ -n "$SOLO" ]; then
    echo "  FAIL trap: a menu item or tile is shown outside navGate():"
    echo "$SOLO" | sed 's/^/         /'; FAIL=1
  else echo "  OK   trap: menu items and home tiles are gated together"; fi
  # The home tiles are the console's empty state. If nothing drives them they
  # either never appear or never go away.
  if ! grep -q "function syncHome" "$TMP/admin.js" || ! grep -q "MutationObserver(syncHome)" "$TMP/admin.js"; then
    echo "  FAIL trap: syncHome()/its observer is missing — the home tiles will not track what is open"; FAIL=1
  else echo "  OK   trap: home tiles track what is open"; fi
else echo "  (admin/index.html not present)"; fi

echo "== Pricing engine parity =="
if [ -f pricing-engine.js ]; then
  cp pricing-engine.js "$TMP/engine.js"; check_js "$TMP/engine.js" "pricing-engine.js"
  sweep pricing-engine.js "engine" "computeQuote" "PRICES" "RULES" "SEASON"
  # engine must be DOM-free
  if grep -Eq "document\.|window\.|getElementById|querySelector" pricing-engine.js; then
    echo "  FAIL trap: pricing-engine.js references the DOM — must be pure"; FAIL=1
  else echo "  OK   trap: engine is DOM-free"; fi
  # if the .gs embeds a copy, it must match. Extract between the parity markers
  # // ENGINE-START / // ENGINE-END in both files and diff them.
  # PROVE-IDENTICAL GATE (permanent). The committed baseline was generated
  # from the legacy computeLinesRaw() BEFORE any extraction, so matching it is
  # the same guarantee as matching the old page — and it keeps holding now
  # that the legacy code is gone. An intentional price change must regenerate
  # the baseline in the same commit, so money never moves silently.
  if node tools/price-fixtures.js --check-baseline > "$TMP/base.txt" 2>&1; then
    echo "  OK   gate: engine matches committed baseline ($(grep -c '^  MATCH' "$TMP/base.txt") fixtures)"
  else
    echo "  FAIL gate: pricing MOVED vs tools/baseline/"; sed 's/^/       /' "$TMP/base.txt"; FAIL=1
  fi
  # Legacy cross-check, only meaningful while index.html still carries its own
  # inline copy of the rules (i.e. before step 2 lands).
  if grep -q "^const PRICES = {" index.html 2>/dev/null; then
    if node tools/price-fixtures.js --compare > "$TMP/cmp.txt" 2>&1; then
      echo "  OK   gate: engine prices identically to inline legacy"
    else
      echo "  FAIL gate: engine DIVERGES from inline legacy"; sed 's/^/       /' "$TMP/cmp.txt"; FAIL=1
    fi
  else
    echo "  OK   page delegates to the shared engine (no inline rule copy)"
  fi
  # The page must actually load the engine, or it has no pricing at all.
  if grep -q 'src="pricing-engine.js"' index.html 2>/dev/null; then
    echo "  OK   page loads pricing-engine.js"
  else
    echo "  FAIL page does not load pricing-engine.js"; FAIL=1
  fi
  if grep -q "ENGINE-START" quote-logger-apps-script.gs 2>/dev/null; then
    if node tools/sync-engine.js --check > "$TMP/sync.txt" 2>&1; then
      echo "  OK   trap: .gs engine copy matches pricing-engine.js"
    else
      echo "  FAIL trap: .gs engine copy has DRIFTED from pricing-engine.js"
      sed 's/^/       /' "$TMP/sync.txt"; FAIL=1
    fi
    # Identical text is not the same as working code: in the .gs the block runs
    # at the top level, not inside the module's wrapper. Execute it there.
    if node tools/check-embedded-engine.js > "$TMP/emb.txt" 2>&1; then
      echo "  OK   gate: embedded .gs engine runs standalone and prices identically"
    else
      echo "  FAIL gate: embedded .gs engine is broken or diverges"
      sed 's/^/       /' "$TMP/emb.txt"; FAIL=1
    fi
  fi
else
  echo "  (pricing-engine.js not present yet — see docs/TASK-pricing-engine.md)"
fi

echo "== Dimensions, storage & re-pricing =="
if [ -f quote-logger-apps-script.gs ]; then
  # A staff re-measure must live in the journal, not in d.state. Writing it into
  # d.state works until the customer's next save, which posts the state still
  # sitting in their browser and would silently undo the measurement.
  if awk '/^function adminDimsApply/,/^}/' quote-logger-apps-script.gs | grep -qE '\bd\.state\.[A-Za-z]+ *='; then
    echo "  FAIL trap: adminDimsApply writes into d.state — a customer re-save will erase the re-measure"; FAIL=1
  else echo "  OK   trap: re-measure is journalled (manual.measured), not written into d.state"; fi
  # Chris's rule: a beam over the limit is flagged for a conversation, never
  # acted on. The console must not relocate storage off the back of a flag.
  if awk '/^function adminDimsApply/,/^}/' quote-logger-apps-script.gs | grep -q '_flags.*storage *='; then
    echo "  FAIL trap: apply changes storage from an engine flag — must stay staff-driven"; FAIL=1
  else echo "  OK   trap: beam flag never auto-relocates storage"; fi
  # Staff must be able to re-measure AFTER a deposit: the real workflow is
  # quote -> deposit -> boat pulled -> measured -> re-billed. The payment lock
  # belongs to the CUSTOMER save path only (a stale browser tab must not
  # overwrite a paid invoice); it must never spread to the console.
  for f in adminDimsApply adminDimsPreview; do
    if awk "/^function $f/,/^}/" quote-logger-apps-script.gs | grep -qE 'lockedByPayment|payments.*length.*return|return.*already paid'; then
      echo "  FAIL trap: $f refuses paid quotes — staff must be able to re-bill after a deposit"; FAIL=1
    else echo "  OK   trap: $f still works after a deposit"; fi
  done
  # THE STAFF NOTE IS PRIVATE. Its entire value is that it is candid — why a
  # discount was given, what was really agreed. If it ever reached the PDF, an
  # email, or the customer's own page, that candour becomes a liability.
  for f in quoteHtml_ customerEmailHtml_ noticeHtml_ buildEmailFor_; do
    if awk "/^function $f/,/^}/" quote-logger-apps-script.gs | grep -q 'staffNote'; then
      echo "  FAIL trap: $f can show the staff note to a customer"; FAIL=1
    else echo "  OK   trap: $f cannot leak the staff note"; fi
  done
  # ...nor the endpoint the customer's own page reads.
  if awk "/action === 'load'/,/^  }/" quote-logger-apps-script.gs | grep -q 'staffNote'; then
    echo "  FAIL trap: the load endpoint returns the staff note to the customer page"; FAIL=1
  else echo "  OK   trap: staff note never reaches the customer page"; fi
  # It exists only on this side, so a customer save must be made to carry it.
  if awk '/const lockedByPayment/,/3\) Target tab/' quote-logger-apps-script.gs | grep -q 'oldD.staffNote'; then
    echo "  OK   trap: staff note survives a customer save"
  else echo "  FAIL trap: a customer save would wipe the staff note"; FAIL=1; fi
  # Keys/slip is yard work and has its own permission — it must NOT be back on
  # `adjust`, or the crew who find out where the keys are cannot record it.
  if awk '/^function adminKeysApply/,/^}/' quote-logger-apps-script.gs | grep -q "requireAuth_(token, 'keys')"; then
    echo "  OK   trap: keys/slip uses its own permission"
  else echo "  FAIL trap: adminKeysApply is not gated on the 'keys' permission"; FAIL=1; fi
  # Key location and slip number must not be written into d.state: the customer's
  # browser holds its own copy and would post it back over ours on their next
  # save, silently undoing the correction. Same trap the dimension editor avoids.
  if awk '/^function adminKeysApply/,/^}/' quote-logger-apps-script.gs | grep -qE 'd\.state\s*(\.|\[)?[A-Za-z"'"'"']*\s*='; then
    echo "  FAIL trap: adminKeysApply writes into d.state — the customer's next save would undo it"; FAIL=1
  else echo "  OK   trap: keys/slip journalled, never written into d.state"; fi
  # Who gets asked for what, and whether a staff entry survives a customer save.
  # Both are properties of the code, so they are checked by running it.
  if node tools/check-haul-info.js > "$TMP/haul.txt" 2>&1; then
    echo "  OK   gate: key-location / slip rules hold"
  else
    echo "  FAIL gate: key-location / slip rules broken"; sed 's/^/       /' "$TMP/haul.txt"; FAIL=1
  fi
  # One motor type per boat, whole counts only. That is a property of the code,
  # not of any string, so it is checked by running it.
  if node tools/check-engine-rules.js > "$TMP/eng.txt" 2>&1; then
    echo "  OK   gate: motor correction rules hold"
  else
    echo "  FAIL gate: motor correction rules broken"; sed 's/^/       /' "$TMP/eng.txt"; FAIL=1
  fi
  # "We have your unit" must never ask when they want to come out of the water —
  # we already have the boat. The season-done survey lives in customerEmailHtml_
  # (quotes and invoices); notice emails use noticeHtml_, which has none. This
  # asserts the two stay apart.
  if awk '/^function noticeHtml_/,/^}/' quote-logger-apps-script.gs | grep -qE 'surveyBase|done=now'; then
    echo "  FAIL trap: noticeHtml_ carries the season-done survey — 'we have your unit' would ask for a haul-out date"; FAIL=1
  else echo "  OK   trap: arrival/notice emails never ask for haul-out timing"; fi
  # The end-of-season note must not pitch detailing to someone who already asked.
  if awk "/if \(kind === 'fall'\)/,/^  }/" quote-logger-apps-script.gs | grep -q 'hasDetailing_'; then
    echo "  OK   trap: end-of-season note checks for an existing detail request"
  else echo "  FAIL trap: fall email offers detailing without checking whether they already asked"; FAIL=1; fi
  # THE PAUSE. Exactly two emails send without a human pressing anything, and
  # both go to real customers with money in them. If either sweep stops checking
  # the pause, turning it on stops meaning anything — and the person who turned
  # it on will not find out until a customer replies to an email nobody sent.
  for f in dailyReminderCheck leadFollowUpCheck; do
    if awk "/^function $f/,/^}/" quote-logger-apps-script.gs | grep -q 'autoEmailsPaused_'; then
      echo "  OK   trap: $f honours the automatic-email pause"
    else echo "  FAIL trap: $f ignores the pause — turning it on would do nothing"; FAIL=1; fi
  done
  # An unreadable pause setting must stop sending, not start it.
  if awk '/^function autoPauseState_/,/^}/' quote-logger-apps-script.gs | grep -q 'on: true'; then
    echo "  OK   trap: a corrupt pause setting fails towards sending nothing"
  else echo "  FAIL trap: a corrupt pause setting would let the automatic sends run"; FAIL=1; fi
  # Only an admin may change whether the system talks to customers at all.
  if awk '/^function adminSetAutoPause/,/^}/' quote-logger-apps-script.gs | grep -q 'who.admin'; then
    echo "  OK   trap: only admins can pause or resume automatic emails"
  else echo "  FAIL trap: adminSetAutoPause is not admin-gated"; FAIL=1; fi
  # An import must never email anybody, and must price at CURRENT rates rather
  # than copying the old sheet's figures — an imported quote has to behave like
  # every other quote or it cannot be re-priced later.
  if awk '/^function adminImportApply/,/^}/' quote-logger-apps-script.gs | grep -qE 'GmailApp|MailApp|sendCustomerEmail_'; then
    echo "  FAIL trap: importing a sheet emails the customer"; FAIL=1
  else echo "  OK   trap: import emails nobody"; fi
  if awk '/^function adminImportApply/,/^}/' quote-logger-apps-script.gs | grep -q 'rebuildLinesFromState_'; then
    echo "  OK   trap: imported quotes are priced by the shared engine"
  else echo "  FAIL trap: import does not re-price — it would carry stale figures"; FAIL=1; fi
  # Preview reads and reports; it must not create a quote.
  if awk '/^function adminImportPreview/,/^}/' quote-logger-apps-script.gs | grep -qE 'appendRow|saveQuoteRow_'; then
    echo "  FAIL trap: import preview writes a quote — it must only report"; FAIL=1
  else echo "  OK   trap: import preview writes nothing"; fi
  # The legacy-sheet parser. Two services share a price and are told apart only
  # by their order in the template, and a file whose prices are #REF! must be
  # declared broken rather than silently yielding a quote with nothing on it.
  if node tools/check-legacy-import.js > "$TMP/leg.txt" 2>&1; then
    echo "  OK   gate: legacy sheet parsing holds"
  else
    echo "  FAIL gate: legacy sheet parsing broken"; sed 's/^/       /' "$TMP/leg.txt"; FAIL=1
  fi
  # RE-PRICE. This rewrites what customers owe across a whole season, so the
  # rules are executed against a fake sheet with the rates actually moved.
  if node tools/check-reprice.js > "$TMP/rp.txt" 2>&1; then
    echo "  OK   gate: re-price rules hold"
  else
    echo "  FAIL gate: re-price rules broken"; sed 's/^/       /' "$TMP/rp.txt"; FAIL=1
  fi
  # Preview must read and report. If it ever writes, "see what would change"
  # becomes "change everything", which is the opposite of the point.
  for f in adminRepricePreview repriceScan_; do
    if awk "/^function $f/,/^}/" quote-logger-apps-script.gs | grep -qE 'saveQuoteRow_|setValue|GmailApp|MailApp'; then
      echo "  FAIL trap: $f writes or sends — preview must only report"; FAIL=1
    else echo "  OK   trap: $f only reads"; fi
  done
  # A season-wide re-price is not undoable from inside the console. It must take
  # a spreadsheet snapshot to Drive before the first write, every time.
  if awk '/^function adminRepriceApply/,/^}/' quote-logger-apps-script.gs | grep -q 'snapshotBeforeRestore_'; then
    echo "  OK   trap: re-price snapshots the sheet before writing"
  else echo "  FAIL trap: re-price would rewrite the season with no way back"; FAIL=1; fi
  # It must not email anyone. Who gets told is a separate, human decision.
  if awk '/^function adminRepriceApply/,/^}/' quote-logger-apps-script.gs | grep -qE 'GmailApp|MailApp|sendCustomerEmail_|buildEmailFor_'; then
    echo "  FAIL trap: re-price emails customers — that must stay a separate decision"; FAIL=1
  else echo "  OK   trap: re-price emails nobody"; fi
  # Who can actually record a key location today, and which way a broken pause
  # fails. Both are properties of the code, so they are checked by running it.
  if node tools/check-perms-pause.js > "$TMP/perm.txt" 2>&1; then
    echo "  OK   gate: keys permission and pause behave"
  else
    echo "  FAIL gate: keys permission / pause broken"; sed 's/^/       /' "$TMP/perm.txt"; FAIL=1
  fi
  # Automatic emails must reach the Activity Log; they are the ones nobody saw sent.
  for f in dailyReminderCheck leadFollowUpCheck; do
    if awk "/^function $f/,/^}/" quote-logger-apps-script.gs | grep -q 'auditLog_'; then
      echo "  OK   trap: $f writes to the Activity Log"
    else echo "  FAIL trap: $f sends email without logging it"; FAIL=1; fi
  done
  # A send-to-all must never reach the lead tab. This is the highest-blast-radius
  # path in the system: one click, every customer, no way to un-send — so the
  # recipient list is BUILT against a fake sheet with a lead on it and read back,
  # rather than grepped for the name of the check.
  if node tools/check-bulk-targets.js > "$TMP/bulk.txt" 2>&1; then
    echo "  OK   gate: send-to-all recipient rules hold"
    sed 's/^/     /' "$TMP/bulk.txt" | grep -E '\->' || true
  else
    echo "  FAIL gate: send-to-all recipient rules broken"; sed 's/^/       /' "$TMP/bulk.txt"; FAIL=1
  fi
  # Only genuine announcements can be blasted; BULK_KINDS_ is the whole allow-list.
  if awk '/^function adminBulkSend/,/^}/' quote-logger-apps-script.gs | grep -q 'BULK_KINDS_'; then
    echo "  OK   trap: send-to-all restricted to the announcement kinds"
  else echo "  FAIL trap: send-to-all accepts any email kind"; FAIL=1; fi
  # Preview reads and reports; it must not send.
  if awk '/^function adminBulkPreview/,/^}/' quote-logger-apps-script.gs | grep -qE 'GmailApp|MailApp'; then
    echo "  FAIL trap: adminBulkPreview sends email — it must only report"; FAIL=1
  else echo "  OK   trap: send-to-all preview sends nothing"; fi
  # The quote-load endpoint must serve the EFFECTIVE state. Serving the raw
  # customer state means a re-measured or relocated quote renders at the old
  # dimensions and the old price on the customer's own page — they see a total
  # that no longer matches their invoice.
  if grep -q 'state: effectiveState_(d)' quote-logger-apps-script.gs; then
    echo "  OK   trap: quote load serves the effective (re-measured) state"
  else
    echo "  FAIL trap: quote load serves raw d.state — customers will see pre-measure pricing"; FAIL=1
  fi
  # Preview must be a dry run. If it ever calls a writer, staff lose the
  # confirm step that stands between a mistyped beam and a customer's invoice.
  if awk '/^function adminDimsPreview/,/^}/' quote-logger-apps-script.gs | grep -qE 'saveQuoteRow_|moveQuoteRow_|setValue'; then
    echo "  FAIL trap: adminDimsPreview writes to the sheet — it must be a dry run"; FAIL=1
  else echo "  OK   trap: dimension preview writes nothing"; fi
fi
if [ -f pricing-engine.js ]; then
  # computeFlags_ advises; it must never mutate the state it was handed.
  if awk '/^function computeFlags_/,/^}/' pricing-engine.js | grep -qE '\bs\.[A-Za-z]+ *=[^=]'; then
    echo "  FAIL trap: computeFlags_ mutates state — flags must be advisory only"; FAIL=1
  else echo "  OK   trap: computeFlags_ is advisory (no state mutation)"; fi
fi
if [ -f admin/index.html ]; then
  # Customer-entered text reaches innerHTML in the console; it must be escaped.
  if grep -q "^function esc(" "$TMP/admin.js"; then echo "  OK   console has an HTML escaper"
  else echo "  FAIL console has no esc() helper — customer text reaches innerHTML raw"; FAIL=1; fi
fi

echo "== Staff accounts & backup restore =="
if [ -f quote-logger-apps-script.gs ]; then
  # A PIN is the only credential, and adminAuth looks people up BY pin — two
  # matching PINs would sign the second person in as the first.
  if awk '/^function adminAddStaff/,/^}/' quote-logger-apps-script.gs | grep -q 'freshPin_' \
     && awk '/^function adminResetPin/,/^}/' quote-logger-apps-script.gs | grep -q 'freshPin_'; then
    echo "  OK   trap: PINs are minted through freshPin_ (collision-checked)"
  else
    echo "  FAIL trap: a PIN is generated without checking it is unused"; FAIL=1
  fi
  # Locking every admin out cannot be undone from the console.
  if awk '/^function adminRemoveStaff/,/^}/' quote-logger-apps-script.gs | grep -q 'adminCount_'; then
    echo "  OK   trap: last admin cannot be removed"
  else echo "  FAIL trap: adminRemoveStaff can strand the roster with no admin"; FAIL=1; fi
  if awk '/^function adminSetPerm/,/^}/' quote-logger-apps-script.gs | grep -q 'adminCount_'; then
    echo "  OK   trap: last admin cannot be demoted"
  else echo "  FAIL trap: adminSetPerm can strand the roster with no admin"; FAIL=1; fi
  # A restore must never delete live work, and must be undoable.
  if awk '/^function adminBackupRestore/,/^}/' quote-logger-apps-script.gs | grep -q 'snapshotBeforeRestore_'; then
    echo "  OK   trap: restore snapshots the sheet first"
  else echo "  FAIL trap: restore runs without saving a snapshot — it would be irreversible"; FAIL=1; fi
  # Preview reads and reports; it must not write to the live sheet.
  if awk '/^function adminBackupPreview/,/^}/' quote-logger-apps-script.gs | grep -qE 'setValues|deleteRow|saveQuoteRow_'; then
    echo "  FAIL trap: adminBackupPreview writes to the sheet — it must only report"; FAIL=1
  else echo "  OK   trap: backup preview writes nothing"; fi
  # Both admin-only endpoints must actually check for admin.
  for f in adminAddStaff adminRemoveStaff adminBackupPreview adminBackupRestore; do
    if awk "/^function $f/,/^}/" quote-logger-apps-script.gs | grep -q 'who.admin'; then
      echo "  OK   trap: $f is admin-gated"
    else echo "  FAIL trap: $f does not check who.admin"; FAIL=1; fi
  done
fi

echo "== Terms, privacy & lead capture =="
for f in terms.html privacy.html terms-config.js legal.css; do
  if [ -f "$f" ]; then echo "  OK   present: $f"; else echo "  FAIL missing: $f"; FAIL=1; fi
done
if [ -f terms-config.js ]; then
  check_js terms-config.js "terms-config.js"
  # One source of truth: the version must be declared here and nowhere else.
  if grep -q "version:" terms-config.js; then echo "  OK   terms version declared in terms-config.js"
  else echo "  FAIL terms-config.js has no version"; FAIL=1; fi
  for f in terms.html privacy.html index.html; do
    if grep -q 'terms-config.js' "$f" 2>/dev/null; then echo "  OK   $f reads the shared terms version"
    else echo "  FAIL $f does not load terms-config.js"; FAIL=1; fi
  done
  # A hardcoded version string anywhere else can drift from what is stamped.
  if grep -nE "Version 1\.0|termsVersion *[:=] *'1" terms.html privacy.html index.html 2>/dev/null | grep -v terms-config; then
    echo "  FAIL trap: hardcoded terms version outside terms-config.js"; FAIL=1
  else echo "  OK   trap: no hardcoded terms version outside terms-config.js"; fi
fi
if [ -f index.html ]; then
  sweep index.html "gate" "startAcceptAndContinue" "contactMissing_" "stampTermsAcceptance_" \
    "acceptedTerms" "termsAcceptedAt" "ackline" "QUOTE_LOADED" "Quote Started"
  # The acknowledgment must be reachable text, not a hidden checkbox.
  if grep -q 'By continuing, you agree' index.html; then echo "  OK   acknowledgment line present"
  else echo "  FAIL acknowledgment line missing"; FAIL=1; fi
fi
if [ -f quote-logger-apps-script.gs ]; then
  sweep quote-logger-apps-script.gs "lead capture" "STARTED_TAB" "isStartedTab_" "isStartedQuote_"
  # THE load-bearing check: a started quote is a lead, not a customer. If the
  # daily 9am reminder ever stops skipping that tab, it will email strangers.
  if awk '/function dailyReminderCheck/,/^}/' quote-logger-apps-script.gs | grep -q "isStartedTab_"; then
    echo "  OK   trap: daily reminder skips the lead tab"
  else echo "  FAIL trap: dailyReminderCheck no longer skips STARTED_TAB — it will email leads"; FAIL=1; fi
  # Every mass send now shares ONE recipient list, so there is one place the lead
  # exclusion has to hold. A menu item that walks the sheets itself is a second
  # copy of that rule, and the second copy is the one that gets it wrong.
  for f in sendSpringAlertAll sendFallNoteAll; do
    if awk "/^function $f/,/^}/" quote-logger-apps-script.gs | grep -qE 'getSheets|getLastRow'; then
      echo "  FAIL trap: $f builds its own recipient list instead of using bulkTargets_"; FAIL=1
    else echo "  OK   trap: $f goes through the shared recipient list"; fi
  done
fi
if [ -f admin/index.html ]; then
  sweep admin/index.html "console terms" "termsText" "Terms accepted"
fi

echo "== Favicon on every page =="
# Chris: use the Quest mark on any page we make. One file at the repo root,
# linked by every page. The failure that actually happens is a relative path
# that is right for the root but wrong from /admin/, so resolve each link
# against the page that carries it and check the file is really there.
python3 - <<'PY'
import os, re, sys
fail = 0
pages = []
for dirpath, dirnames, filenames in os.walk('.'):
    # .snapshots holds dated archive copies of past versions, not pages we ship.
    dirnames[:] = [d for d in dirnames if d not in
                   ('.git', 'node_modules', 'docs', 'tools', '.github', '.snapshots')]
    for fn in filenames:
        if fn.endswith('.html'):
            pages.append(os.path.join(dirpath, fn))
for page in sorted(pages):
    html = open(page, encoding='utf-8').read()
    m = re.search(r'<link[^>]*rel="icon"[^>]*href="([^"]+)"', html)
    if not m:
        print('  FAIL %s has no favicon — every page gets the Quest mark' % page[2:]); fail = 1; continue
    href = m.group(1)
    if href.startswith('data:'):
        print('  OK   %s carries an inline icon' % page[2:]); continue
    target = os.path.normpath(os.path.join(os.path.dirname(page), href))
    if os.path.exists(target):
        print('  OK   %s -> %s' % (page[2:], href))
    else:
        print('  FAIL %s -> %s does not resolve (looked for %s)' % (page[2:], href, target)); fail = 1
sys.exit(fail)
PY
[ $? -eq 0 ] || FAIL=1

echo "== Apps Script deploy workflow =="
WF=.github/workflows/deploy-apps-script.yml
if [ -f "$WF" ]; then
  # Deploying the live money backend must stay a deliberate human act. If this
  # ever gains a push/schedule trigger, a bad commit reaches customers by
  # itself. Also assert it updates the EXISTING deployment (CLAUDE.md §2) —
  # create-deployment would mint a new URL and orphan both front ends.
  python3 - "$WF" <<'PY'
import sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
trig = d.get(True) or d.get('on')          # bare `on:` parses as boolean True
keys = sorted(trig.keys())
fail = 0
if keys != ['workflow_dispatch']:
    print("  FAIL trap: deploy workflow must be manual-only, found triggers: %s" % keys); fail = 1
else:
    print("  OK   trap: deploy workflow is manual-only")
steps = d['jobs']['deploy']['steps']
names = [s.get('name', '') for s in steps]
runs = ' '.join(str(s.get('run', '')) for s in steps)
if 'Verify before deploying' in names and names.index('Verify before deploying') < names.index('Push code to Apps Script'):
    print("  OK   trap: verify.sh gates the deploy")
else:
    print("  FAIL trap: verify.sh must run before the push"); fail = 1
if 'update-deployment' in runs and 'create-deployment' not in runs:
    print("  OK   trap: updates existing deployment (URL preserved)")
else:
    print("  FAIL trap: workflow must use update-deployment, never create-deployment"); fail = 1
# clasp treats a missing -V as @HEAD: nothing pinned to roll back to, and every
# later push goes live instantly. The version must be cut explicitly.
if 'create-version' in runs and 'update-deployment -V' in runs:
    print("  OK   trap: cuts an immutable version and deploys it by number")
else:
    print("  FAIL trap: deploy must create a version and pass -V, or it ships @HEAD"); fail = 1
sys.exit(fail)
PY
  [ $? -eq 0 ] || FAIL=1
else
  echo "  (no deploy workflow — Apps Script is deployed by hand)"
fi

echo "== URL sync =="
U_GAS=$(grep -o 'AKfycb[A-Za-z0-9_-]*' quote-logger-apps-script.gs 2>/dev/null | sort -u | head -1)
U_PAGE=$(grep -o 'AKfycb[A-Za-z0-9_-]*' index.html 2>/dev/null | sort -u | head -1)
U_ADM=$(grep -o 'AKfycb[A-Za-z0-9_-]*' admin/index.html 2>/dev/null | sort -u | head -1)
echo "  gas:   ${U_GAS:-none}"; echo "  page:  ${U_PAGE:-none}"; echo "  admin: ${U_ADM:-none}"
if [ -n "${U_GAS:-}" ] && { [ "${U_PAGE:-$U_GAS}" != "$U_GAS" ] || [ "${U_ADM:-$U_GAS}" != "$U_GAS" ]; }; then
  echo "  FAIL: deployment URLs do not match across files"; FAIL=1
else echo "  OK   all present URLs match"; fi

rm -rf "$TMP"
echo
if [ "$FAIL" = "0" ]; then echo "ALL CHECKS PASSED — safe to deploy"; else echo "CHECKS FAILED — do not deploy"; exit 1; fi
