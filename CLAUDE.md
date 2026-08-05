# Quest Watersports — Winter Services Quote & Invoice System

**Owner:** Chris Kujawa, Service Coordinator, Quest Watersports (Ottawa, IL)
**Read this entire file before touching anything.** It encodes bugs already
found and fixed the hard way. Skipping it reliably reintroduces them.

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
| `admin/index.html` | GitHub Pages `/admin/` | Staff console (PIN-gated) |
| `quote-logger-apps-script.gs` | Apps Script, bound to the Sheet | The entire backend |

- **Repo:** `QuestWS/winter-quotes_26-27`
- **Customer page:** `https://questws.github.io/winter-quotes_26-27/`
- **Staff console:** `https://questws.github.io/winter-quotes_26-27/admin/`
- **Spreadsheet:** "Winter Quotes 2026-2027" (Google Sheets, script is bound to it)
- **Drive:** season folder holds quote PDFs, `Unit Photos/`, `Signed Contracts/`

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

## 2. Deploy rituals — non-negotiable

### Apps Script
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
| `setupAllTriggers()` | once, or to repair | Reminder 9am, backup 6pm, balance report 7am. Idempotent. |
| `migrateColumnOrder()` | once, after the column reorder | Skips tabs already migrated. |
| `testLogo()` | once | Forces the Drive/Gmail scope grant for logo embedding. |

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

**After any edit to any file, before presenting it:**
1. Syntax check. `.gs` → copy to `.js`, `node --check`. HTML → extract
   `<script>` contents, `node --check`.
2. Feature sweep — grep for the markers of every feature you touched *and* a
   few you didn't, confirming nothing was clobbered.
3. Only then hand it over.

Chris works from **files, not pasted code**. Pasted code blocks have arrived
empty before. Always deliver the complete file.

---

## 4. Architecture and invariants

### The spreadsheet is the source of truth
One tab per storage location (Inside, Premium Inside, Outside, No Storage,
Golf Cart, E-Bike). One row per quote. A quote **moves tabs automatically**
when storage changes, and stale copies on other tabs are swept on every save.

**Column order is defined once, in `const COL`.** Never hardcode a column
number anywhere. Quote # deliberately sits at column 3 — `findQuoteRow_()` and
several tab-detection checks (`getRange(1,3).getValue() !== 'Quote #'`) depend
on it. Changing that constant means auditing every sheet-scan loop.

Full quote state lives as JSON in the **Payload** column. That's what makes
reload, re-price, adjustment replay, and year-over-year rollover possible.

### The manual-ops journal — read this before touching pricing
`d.manual = { removed[], edits[], priced[], adjustments[] }`

Staff changes (discounts, line edits, priced quote-requests, adjustments) are
recorded as **operations**, not just baked into the line array. When a
customer reloads and re-saves their quote, the page recomputes clean lines from
their selections, and `applyManualOps_()` **replays every staff change on top**.

Without this, a customer reloading their quote silently erased Quest's
discounts. If a replay can't find its target (e.g. the customer removed the
service that was discounted), it appends a `could NOT re-apply — REVIEW` note
and emails `service@`. `originalLabelFor_()` chains renames so an edited line
can still be matched later.

**Any new staff-side mutation must journal itself**, or it will vanish on the
next customer save. Mutations that already journal correctly: line edits,
deletes, priced quote-requests, adjustments, late fees, and the season-done
survey's late-retrieval surcharge (`applySeasonDone_` adds/removes it via
`m.adjustments`). Any dimension-repricing work must follow the same pattern.

### Season-done survey
The quote email carries a 3-option survey (done now / done on a date / will
call). Answers post back via `?action=seasondone`. A stated date after Nov 15
auto-applies the **late retrieval surcharge**, priced from the quote's own
stored `d.season.lateRetrievalFee` (NOT a hardcoded number — the page writes
the live price into the payload's season object so it stays correct
year-over-year). `applySeasonDone_(d, choice, date, note)` is the single entry
point; it also *removes* the surcharge if the answer changes to an on-time
date. Editable from the console (Season timing block, adjust permission) and
carries an optional customer/staff note. The console uses a real inline date
field + live fee warning — **never a `prompt()`** (a raw prompt shipped once and
looked unacceptable; all console inputs are inline UI now).

### Payment lock
Once `d.payments` is non-empty:
- The customer page goes read-only (gold banner, inputs disabled, "Invoice").
- The **server** enforces it too: a locked save keeps the official payload and
  adopts only incoming `status` / `payMode`. A stale browser tab cannot
  overwrite a paid quote.
- Terminology flips Quote → Invoice everywhere via `docTerm_(d)`.

### Signed balances
Balance is `total − paid`, **never clamped**. Negative = credit due to the
customer, and it must render as such in the sheet, PDF ledger, emails, and
page ticket. Refunds are recorded as **negative payments** — payments are an
append-only ledger, never deleted.

### Email builder
`buildEmailFor_(d, kind, extra, photos)` returns `{subject, html, status}` and
is used by **both** `adminEmailPreview` and `adminSendEmail`. Preview must
always be byte-identical to what sends. If you add an email kind, add it to
that builder — not to the send path directly.

`recordEmail_(sh, rowNum, d, kind, by)` must be called at **every** send site
(console, sheet menu, quote page, auto-reminder). It's what powers per-quote
Email History.

### Permissions
Roster in Script Properties `STAFF`. Perms: `pay`, `adjust`, `email`,
`photos`, plus `admin`. `requireAuth_(token, perm)` gates every console
endpoint; sessions are 12h tokens; 10 failed PINs → 15-minute lockout + alert
email. Every console action writes to the **Activity Log** sheet tab.

Current roster intent: Chris & Jeff admin (full); John, Rex, Jess →
pay+email+photos; Marina → photos only.

---

## 5. Product rules that are easy to break

- **Nothing customer-facing is automatic except the single 10-day reminder.**
  Late-fee warnings, fee application, receipts, seasonal emails — all require
  a human click and confirmation. The 1st/15th reports go to Chris only.
- **Unit-appropriate wording.** Golf carts and e-bikes are *land units*
  (`isLandUnit_`, `isBike_`). They come "back home" / are "ready to ride" —
  never "back in the water," never "relaunch," never "splash." This shipped
  broken once; a golf cart was congratulated on being back in the water.
- **Menu ↔ console parity.** Anything staff can do in the spreadsheet menu
  should exist in the console, and vice versa. Line editing was console-missing
  for a while; that gap is the kind of thing to actively check.
- **Money and customer email are menu/console-only.** Never hand-edit cells —
  it desyncs the payload, PDF, and totals.
- **Key location & HHO address:** required for boat/jetski/golf (keys) and
  golf (HHO street address). $500 tow/start fee warning for boats/jetskis;
  golf carts **cannot be picked up without keys at all**.
- **Every close control closes.** Panels (storage, staff, matches, quote) each
  need a working ✕. Users noticed when one didn't.

---

## 6. Testing checklist before calling anything done

Run against the test quote (`QW-26-3477`, golf cart) **and** a boat quote —
the land-unit paths are the least-exercised and where wording bugs hide.

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

## 8. THE CURRENT PRIORITY — pricing engine extraction

**This is why the project moved to Claude Code. Do this first, carefully, as
its own multi-commit effort.** Full brief in `docs/TASK-pricing-engine.md`.

The problem: all dimension→price logic (shrinkwrap per-foot, storage tier by
beam, wash by area, the beam>8.5 no-trailer rule, blocking, retrieval tiers)
lives **only** in `index.html`'s `computeLinesRaw()`. The server has never had
it. That blocks the requested feature: **editing a unit's dimensions on the
console and having the price recompute.**

The decision (Chris chose this): **refactor so page and server share ONE rule
set** — not mirror-and-hope. Extract `SEASON` / `PRICES` / `RULES` and a pure,
DOM-free `computeQuote(state)` into a shared block. The page loads it; the
Apps Script embeds it. Then build the dimension editor on top.

Hard requirement: **prove the page prices identically before and after the
extraction.** Same test quotes, same totals, to the cent. The refactor must be
transparent — if any total moves, the extraction is wrong, not the old code.

Sequenced plan (each step its own commit + verify):
1. Extract config + engine into a shared, DOM-free module. No behavior change.
2. Refactor `index.html` to call the shared engine; prove identical totals.
3. Give the Apps Script the same engine; add a save-time cross-check that the
   server's recomputed total matches the page's saved total (drift alarm).
4. Dimension editor on the console: edit LOA/beam/len/width → server re-runs
   engine → **before/after line diff** → Chris confirms → dollars move. Plus:
   - **beam-oversize flag** (edited beam > storage limit → warn, do NOT auto-move)
   - **move storage location** (dropdown reassigns tab; row physically moves)
   - **"Your dimensions have been adjusted" email** (premade, previewable,
     attaches updated quote/invoice — add it to `buildEmailFor_`)

Chris explicitly does NOT want auto-relocation of storage on a beam change —
that's a customer conversation. Flag it and let him move it manually.

---

## 9. What's deliberately still open

| Item | State | Notes |
|---|---|---|
| Adobe Sign web form | **Chris's task** | `adobeWebFormUrl:''` in the page; a customer-appropriate "signing almost here" placeholder shows until set. Last blocker to full couch-to-paid. |
| Excel import of last year's selections | Blocked | Needs a sample workbook from Chris to map columns. Architecture supports it — quotes store selections, not prices. |
| Twilio SMS mirroring | Blocked on A2P registration (~$20–65 one-time, ~$50–60/yr, ~1 month approval). `buildEmailFor_` centralization makes mirroring cheap once approved. Reference PDF exists. |
| Year-over-year rollover | Architected, not exercised | Same script/URL/spreadsheet; archive-rename tabs, update SEASON/PRICES/RULES via the **Annual Update Zone** checklist at the top of `index.html`. Old quotes re-price against new rates on reload. |
| Roster add/remove beyond the seeded six | Script Properties edit | Add to the admin panel if staff churn proves real. |
| Legacy `?page=admin` console | Kept as fallback | Shares sessions/permissions with the GitHub console. Harmless; useful if GitHub Pages ever hiccups. |

---

## 10. Working with Chris

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
