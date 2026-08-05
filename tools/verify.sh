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
  # Duplicate top-level function names silently shadow each other (the later
  # declaration wins). This killed the season-done buttons once: a photo-toggle
  # setSeason(s,btn) overwrote the season-done setSeason(choice).
  DUPFN=$(grep -oE '^\s*(async )?function [A-Za-z0-9_$]+' "$TMP/admin.js" \
          | grep -oE '[A-Za-z0-9_$]+$' | sort | uniq -d)
  if [ -n "$DUPFN" ]; then
    echo "  FAIL trap: duplicate function name(s) in console — later declaration shadows earlier:"
    echo "$DUPFN" | sed 's/^/         /'; FAIL=1
  else echo "  OK   trap: no duplicate function names in console"; fi
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
    sed -n '/ENGINE-START/,/ENGINE-END/p' pricing-engine.js > "$TMP/eng-a" 2>/dev/null
    sed -n '/ENGINE-START/,/ENGINE-END/p' quote-logger-apps-script.gs > "$TMP/eng-b" 2>/dev/null
    if diff -q "$TMP/eng-a" "$TMP/eng-b" >/dev/null 2>&1; then
      echo "  OK   trap: .gs engine copy matches pricing-engine.js"
    else echo "  FAIL trap: .gs engine copy has DRIFTED from pricing-engine.js"; FAIL=1; fi
  fi
else
  echo "  (pricing-engine.js not present yet — see docs/TASK-pricing-engine.md)"
fi

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
