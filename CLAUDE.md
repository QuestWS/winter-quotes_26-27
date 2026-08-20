# Quest Watersports — Winter Services Quote & Invoice System

**Owner:** Chris Kujawa, Service Coordinator, Quest Watersports (Ottawa, IL)
**Read this entire file before touching anything.** It encodes bugs already
found and fixed the hard way. Skipping it reliably reintroduces them.

---

---

## 1. What this system is
A complete seasonal quoting → signing → payment → storage → relaunch pipeline
for a marine dealership's winter services program (boats, jetskis, golf carts,
e-bikes). A customer can quote, sign, and pay from their couch; staff can run
the entire operational and financial side of the season from a phone.

Three deployed artifacts, one Google account (`questwsottawa@gmail.com`, free
Gmail — **not** Workspace; this constrains some options, see §7).

| File in repo | Deploys to | Purpose |
|---|---|---|
| `index.html` | GitHub Pages root | Customer quote page |
| `pricing-engine.js` | GitHub Pages root | **The shared pricing rules** — loaded by the page, embedded in the Apps Script |
| `terms.html` / `privacy.html` | GitHub Pages root | Legal pages, reachable without submitting anything |
| `terms-config.js` | GitHub Pages root | **`QuestTerms.version`, single source of truth** — read by the page *and* both legal pages |
| `legal.css` | GitHub Pages root | Shared styling for the two legal pages |
| `favicon.png` | GitHub Pages root | **The Quest mark — every page links this one file** |
| `admin/index.html` | GitHub Pages `/admin/` | Staff console (PIN-gated) |
| `quote-logger-apps-script.gs` | Apps Script, bound to the Sheet | The entire backend |

- **Repo:** `QuestWS/winter-quotes_26-27`
- **Customer page:** `https://questws.github.io/winter-quotes_26-27/`
- **Staff console:** `https://questws.github.io/winter-quotes_26-27/admin/`
- **Spreadsheet:** "Winter Quotes 2026-2027" (Google Sheets, script is bound to it)
- **Drive:** season folder holds quote PDFs, `Unit Photos/`, `Signed Contracts/`

**Every page we make carries the Quest favicon.** One file, `favicon.png` at
the repo root, linked by all of them — `href="favicon.png"` from the root,
`href="../favicon.png"` from `/admin/`. Not inlined per page: four copies of a
20KB data URI can drift apart, and one shared file is downloaded once for the
whole site. `verify.sh` walks every `.html` (excluding `.snapshots/`), fails a
page with no icon, and **resolves each href against the page that carries it**
— the failure that actually happens is a path that is right from the root and
404s from `/admin/`. The legacy `?page=admin` console is served by Apps Script
from `script.google.com`, so it cannot reference a repo file and shows Google's
icon; that one is outside the rule.

### The one URL everything shares

```
https://script.google.com/macros/s/AKfycbxv8kqGKXU_4-9TytfWzdrv-QqqmyrYLxRwd8FDfA8b47sX3NlEBNDlIwIHRuQObZbL9w/exec
```

It appears in **three places that must stay in sync**:
1. `quote-logger-apps-script.gs` → `const WEB_APP_URL`
2. `index.html` → `INTEGRATIONS.quoteLogUrl`
3. `admin/index.html` → `const API_URL`

Same URL serves three behaviors: plain `/exec` (quote page lookups + console
API via POST), `?action=launchpref&...` (spring email buttons),
`?page=admin` (legacy HtmlService console — kept as fallback, see §8).

---

---

## 2. Deploy rituals — non-negotiable

### Apps Script
**Preferred: GitHub Actions → "Deploy Apps Script" → Run workflow.** Manual
trigger only, runs `verify.sh` first, and calls `clasp update-deployment`,
which points the *existing* deployment at a new version — so the rule below is
enforced by the tool rather than by memory. Setup and troubleshooting:
`docs/APPS-SCRIPT-DEPLOY.md`.

Fallback (and what the workflow automates):
1. Paste the full file over the editor contents, **Save**.
2. **Deploy → Manage deployments → pencil (edit) → Version: New version → Deploy.**

**NEVER use "New deployment."** It mints a *new URL*, silently orphaning the
customer page and console, which still point at the old one. This already
happened once — an abandoned duplicate deployment (`AKfycbwEWDAuZM93...`)
exists and should stay archived.

3. If the change uses a **new Google capability** (Drive, Gmail scope, etc.),
   run any function that touches it once from the editor first, approve the
   OAuth popup, *then* deploy the new version. Otherwise it fails silently at
   runtime for everyone.

### GitHub pages
Paste file contents → Commit → **hard-refresh (Ctrl+Shift+R)** or the browser
serves the cached old version and you'll debug a ghost.

### One-time setup functions (run from the editor dropdown)
| Function | When | Notes |
|---|---|---|
| `initStaff()` | once, ever | Prints 6 PINs to the log. Refuses to run twice (won't clobber the roster). |
| `setupAllTriggers()` | once, or to repair | Reminder 9am, backup 6pm, balance report 7am, lead follow-up 12:15pm. All **Central** (the script's timezone). Idempotent — re-run after any change to the trigger list. |
| `migrateColumnOrder()` | once, after the column reorder | Skips tabs already migrated. |
| `testLogo()` | once | Forces the Drive/Gmail scope grant for logo embedding. |
| `emailGuides()` | whenever the guides change | Fetches the four PDFs from `main` and mails them to `REPORT_EMAIL` (Chris). Rebuild first: `python3 docs/build-guides.py`, commit, then run it — it reads the repo, not the local copy. |

---

---

## 3. Editing discipline — the rule that matters most
**Every string replacement must assert its anchor before writing.**

This project was bitten twice by silent no-op replaces: the edit "succeeded,"
the file was written, nothing changed, and the bug surfaced hours later in a
different form. The manual-journal page bug and a PDF-title miss both came
from this.

If you're scripting edits (Python, sed, etc.):

```python
old = "...exact text..."
assert s.count(old) == 1, "MISS: anchor not found or ambiguous"
s = s.replace(old, new)
```

If an assert fails, **write nothing** — fix the anchor and re-run the whole
batch. A partially-applied batch is worse than none.

**Verify against an absolute path, not a relative one.** A restore during the
engine work was copied into the scratch directory instead of the repo, because
an earlier `cd` in the same shell was still in effect — and the `grep` that
"confirmed" the restore read that same wrong copy, so it reported success. The
repo file still held the test value. Relative paths make a check agree with
itself; absolute paths make it agree with reality. Confirm with
`git status` / `git diff` too — git always speaks about the repo.

**After any edit to any file, before presenting it:**
1. Syntax check. `.gs` → copy to `.js`, `node --check`. HTML → extract
   `<script>` contents, `node --check`.
2. Feature sweep — grep for the markers of every feature you touched *and* a
   few you didn't, confirming nothing was clobbered.
3. Only then hand it over.

Chris works from **files, not pasted code**. Pasted code blocks have arrived
empty before. Always deliver the complete file.

---

---

## 4. Where the rest of the rules live

This file holds what applies to **every** task. The detail for each subsystem
sits in `docs/ref/`, so it is read when it is relevant rather than on every
request. Open the one that covers what you are about to change — and open it
*before* you change it, not after something breaks.

| Read this | Before touching |
|---|---|
| `docs/ref/DATA-AND-MONEY.md` | The payload, sheet columns, the manual-ops journal, re-pricing replay, drift, payments, balances, the payment lock |
| `docs/ref/QUOTE-PAGE.md` | `index.html` — motors, detail options, resuming a quote, the terms/lead gate, the season-done survey |
| `docs/ref/STAFF-CONSOLE.md` | `admin/index.html` — permissions, staff notes, keys & slip, the dimension editor, season re-price, the old-sheet importer, backup restore, yard printing |
| `docs/ref/EMAILS.md` | Anything that sends: the shared builder, the automatic-email pause, send-to-all |
| `docs/MAP.md` | Finding where a feature is implemented before grepping for it |

`tools/check-docs-coverage.js` fails if a rule that was once written down stops
appearing anywhere in this set, so moving text between these files is safe and
quietly dropping it is not.

---

## 4b. Real customer data — the hard boundary
**The spreadsheet holds live customers, not test rows.** As of Aug 2026 the
only test quote is **`QW-26-1255` (John White, "Demo Test Boat",
john@questwatersports.com)**. Every other row is a paying customer with a real
name, email and phone. (`QW-26-3477`, the golf cart this file used to name as
the test quote, **no longer exists** — it survives only in Activity Log
history, and the Golf Cart tab is empty. Don't go looking for it.)

Rules, non-negotiable:

- **Never send email to a customer.** Not a test, not a "just checking the
  template renders." Every email in this system is a human-clicked action by
  Quest staff. If you need to see an email, use `adminEmailPreview` /
  `buildEmailFor_`, which render without sending.
- **Never create a Gmail draft addressed to a customer.** A draft one click
  away from sending is the same hazard.
- **Test only against `QW-26-1255`.** Any save, payment, adjustment, line edit
  or season-done change goes on that quote and no other.
- **Treat the sheet as read-only** unless the task is explicitly to change a
  specific quote. Reading is fine; writing needs a reason and a named row.
- **Never put customer PII in the repo** — not in commits, fixtures, test
  data, baselines, comments or commit messages. Identify quotes by number.
  Extracted payloads belong in a scratch directory outside the repo.

Remember the system emails **on its own** in exactly one place: the daily 9am
auto-reminder trigger, which writes to real customers. It keeps running during
any test window. Nothing else is automatic — `docs/ref/EMAILS.md`.

---

---

## 5. The shared pricing engine

`SEASON` / `PRICES` / `RULES` and a pure, DOM-free `computeQuote(state)` live in
**`pricing-engine.js`**, which the customer page loads and the Apps Script
embeds verbatim between `ENGINE-START` / `ENGINE-END`.

- **Never hand-edit that block in the `.gs`.** Edit `pricing-engine.js`, run
  `node tools/sync-engine.js`, commit both.
- Two guards back it: `sync-engine.js --check` diffs the copies, and
  `check-embedded-engine.js` *executes* the embedded block as bare top-level
  code and prices every fixture — identical text is not the same as working
  code.
- The **Annual Update Zone** at the top of `pricing-engine.js` is where a season
  rollover happens: one edit updates page and server together.
- Anything both sides must decide the same way belongs in the engine —
  `storageTabFor()`, `dimsString()` and `fmtPhone()` are there for that reason.
- **The server prices the quote; the browser does not.** Disagreements become a
  drift note and the server's figure is stored. Detail in
  `docs/ref/DATA-AND-MONEY.md`.

---

## 6. Testing checklist before calling anything done
Run against the test quote **`QW-26-1255`** (boat — see §4b; it is the only
row you may write to). The old golf-cart test quote `QW-26-3477` is gone, so
**there is currently no land-unit test row**: build a throwaway golf cart or
e-bike quote when touching land-unit paths, since that wording is the
least-exercised and is where bugs hide (`docs/ref/EMAILS.md`).

1. Build a new quote → save → check row lands on the right tab, PDF generates.
2. Reload it with quote# + last name → all selections restored.
3. Apply a staff discount → customer reloads & re-saves → **discount survives**.
4. Record a payment → quote locks, terminology flips to Invoice.
5. Remove lines until overpaid → balance goes **negative**, shows as CREDIT
   in sheet, PDF, email, and page.
6. Console: search by partial last name → multiple matches → pick one.
7. Console: edit a line, delete a line, apply a late fee with custom wording.
8. Console: preview each email kind, confirm it renders, send one, confirm it
   appears in Email History with the sender's name.
9. Photos: camera path and gallery path, Winter and Spring subfolders.
10. Storage view → print yard sheets → one page per area, keys column filled.
11. Narrow the browser (or use a phone) → hamburger menu appears and works.

---

---

## 7. Known constraints and traps
- **`ScriptApp.getService().getUrl()` returns the `/dev` URL** when called from
  a spreadsheet-menu context. `/dev` only works for the logged-in owner —
  customers get a Google error page. **Always use the `WEB_APP_URL` constant**
  for anything that ends up in an email or in front of a customer. This shipped
  broken once in the spring-alert launch buttons.
- **Emails are frozen at send time.** Fixing a link in the code does not fix
  emails already sent. Re-send after deploying.
- **Free Gmail, not Workspace:** no per-account allowlist on web apps, no
  reliable visitor identity. That's *why* the console uses PINs.
- **HtmlService serializes uploads** (one at a time). The GitHub console posts
  directly to `/exec` and uploads 3-in-parallel. Don't "simplify" the GitHub
  console back onto `google.script.run`.
- **Mobile Google Sheets app cannot show custom menus, ever.** Desktop web or
  Chrome's "Desktop site" toggle only. That limitation is why the console
  exists.
- **`capture` attribute on a file input forces the camera** on Android, killing
  the gallery option. Only the dedicated camera button carries it.
- **Signed contracts and photo folders are "anyone with link, view."** That's
  what lets staff outside the Google account open them. Accepted tradeoff,
  documented for Chris; account-locking is a ~2-line change if ever wanted.
- **Sheet menu prompts** (`ui.prompt`) only exist on desktop. Console
  equivalents must supply their own inputs.

---

---

## 8. What's deliberately still open
| Item | State | Notes |
|---|---|---|
| Adobe Sign web form | **Chris's task** | `adobeWebFormUrl:''` in the page; a customer-appropriate "signing almost here" placeholder shows until set. Last blocker to full couch-to-paid. |
| Excel import of last year's selections | Blocked | Needs a sample workbook from Chris to map columns. Architecture supports it — quotes store selections, not prices. |
| Twilio SMS mirroring | Blocked on A2P registration (~$20–65 one-time, ~$50–60/yr, ~1 month approval). `buildEmailFor_` centralization makes mirroring cheap once approved. Reference PDF exists. |
| Year-over-year rollover | Architected, not exercised | Same script/URL/spreadsheet; archive-rename tabs, update SEASON/PRICES/RULES in the **Annual Update Zone** at the top of `pricing-engine.js` (it moved there from `index.html` — one edit now updates page *and* server). Old quotes re-price against new rates on reload. |
| Roster add/remove beyond the seeded six | Script Properties edit | Add to the admin panel if staff churn proves real. |
| Legacy `?page=admin` console | Kept as fallback | Shares sessions/permissions with the GitHub console. Harmless; useful if GitHub Pages ever hiccups. |

---

---

## 9. Working with Chris
- He wants **explicit numbered walkthroughs** for anything run from the Apps
  Script editor — function name, where to click, what success looks like.
- He tests on a **phone**, in the yard, and reports UX friction precisely.
  Take those reports seriously; they've all been real.
- He values knowing the *tradeoff*, not just the result — flag what you chose
  not to do and why.
- In Claude Code this inverts: **edit in place, commit real diffs.** The
  "complete files only" rule was a chat-era workaround for empty paste blocks;
  it doesn't apply when Claude Code owns the files directly. Still deliver
  whole files if Chris ever asks for one to paste manually.
- **eBike-related customer email uses `ebikes@questwatersports.com`**, not
  chris@ — relevant if any e-bike-specific comms get added.
- Notification/reply-to addresses live in constants at the top of the `.gs`
  (`NOTIFY`, `REPLY_TO`, `BACKUP_EMAIL`, `REPORT_EMAIL`). Confirm before
  changing; some point at chris@ and some at service@ intentionally.
