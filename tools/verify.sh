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
    "balanceReportCheck" "adminLateFee"
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
    "renderSeasonDone" "saveSeasonDate" "renderRequests" "feewarn"
  # no raw prompt() in the console — all inputs are inline UI
  if grep -q "prompt(" "$TMP/admin.js"; then
    echo "  FAIL trap: prompt() in console — replace with inline UI"; FAIL=1
  else echo "  OK   trap: no prompt() in console"; fi
  if [ "$(grep -c 'capture=' admin/index.html)" != "1" ]; then
    echo "  FAIL trap: 'capture' should appear exactly once (camera input only)"; FAIL=1
  else echo "  OK   trap: capture attribute on camera input only"; fi
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
  if grep -q "ENGINE-START" quote-logger-apps-script.gs 2>/dev/null; then
    sed -n '/ENGINE-START/,/ENGINE-END/p' pricing-engine.js > "$TMP/eng-a" 2>/dev/null
    sed -n '/ENGINE-START/,/ENGINE-END/p' quote-logger-apps-script.gs > "$TMP/eng-b" 2>/dev/null
    if diff -q "$TMP/eng-a" "$TMP/eng-b" >/dev/null 2>&1; then
      echo "  OK   trap: .gs engine copy matches pricing-engine.js"
    else echo "  FAIL trap: .gs engine copy has DRIFTED from pricing-engine.js"; FAIL=1; fi
  fi
else
  echo "  (pricing-engine.js not present yet — see docs/TASK-pricing-engine.md)"
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
