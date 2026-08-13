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
| `pricing-engine.js` | GitHub Pages root | **The shared pricing rules** — loaded by the page, embedded in the Apps Script |
| `terms.html` / `privacy.html` | GitHub Pages root | Legal pages, reachable without submitting anything |
| `terms-config.js` | GitHub Pages root | **`TERMS_VERSION`, single source of truth** — read by the page *and* both legal pages |
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

**The server prices the quote; the browser does not.** On every customer save
`rebuildLinesFromState_()` re-runs the shared engine over `d.state` and
*replaces* the posted lines, then `applyManualOps_()` replays the journal onto
those clean lines. Before this, the page posted lines it had already replayed
the journal onto and the server replayed it a second time — adjustments and
priced requests were appended twice (the total rose on every customer re-save)
while removals and edits couldn't find their targets and reported a spurious
`could NOT re-apply — REVIEW`. No real customer was affected: it needed a quote
that already carried staff changes to be reloaded and re-saved, and only the
test quote had a journal. Do not "optimise" this by trusting `d.lines` again.

Anything the two engines disagree about becomes a **drift note**:
`driftNoteFor_()` compares the browser's total with the server's, stores the
warning in the payload as `_driftNote`, and leads the `service@` subject with
⚠️ PRICE DRIFT. The server's figure is the one that gets stored. It fails open
— a payload with no `state` (older quotes) keeps the old behavior exactly.

**Any new staff-side mutation must journal itself**, or it will vanish on the
next customer save. Mutations that already journal correctly: line edits,
deletes, priced quote-requests, adjustments, late fees, and the season-done
survey's late-retrieval surcharge (`applySeasonDone_` adds/removes it via
`m.adjustments`). Any dimension-repricing work must follow the same pattern.

### One motor type per boat
Inboard / outboard / I-O are mutually exclusive; multiples of one type are
normal. Picking a type zeroes the others and dims their rows
(`clearOtherEngineTypes_`, `syncEngineRows_`). Genuinely odd rigs are handled
by Quest as a line-item adjustment, not by letting a customer build a boat
that cannot exist.

### Detail options are NOT mutually exclusive
Exterior detail / wash & wax, interior detail / wipe-down, and bottom-paint
touch-up / strip & reapply can all be requested together, deliberately: Quest
quotes every option and removes what the customer doesn't take. Do not
reintroduce `data-excl` on these. (Acid wash still suppresses powerwash — that
is pricing logic in the engine, not a choice restriction.)

### Resuming an unfinished quote
The contact gate checks for an existing lead before minting a new quote number
(`checkForUnfinished_` → server `?action=findlead`), and offers "continue that
quote" or "start a new one". Without it, one person who comes back twice
becomes three leads.

**`findlead` only ever reads the lead tab, and requires email *and* last name.**
That boundary is deliberate: lead rows hold no pricing, so the most it can
reveal is that an address started a quote. Widening it to real quote tabs would
turn an email address into a way to pull somebody's priced quote — which today
needs the quote number. The check is best-effort: if it errors or times out the
customer proceeds to a new quote rather than being blocked from a price.

The follow-up email links back with `?quote=…&ln=…`; `autoLoadFromUrl_()`
restores the quote on load and also fills the two fields, so a mangled link
still leaves the customer one button press away.

### Terms acceptance & lead capture
Name, phone and email are **required** before a customer can leave the start
step. That proceed button is deliberately the acceptance point: it is the same
click anyone must make to reach the pricing, so it captures agreement to the
Terms that govern that access, timestamped. The acknowledgment line sits beside
the button — visually quiet, but real text with real links, because a hidden
acknowledgment is not an enforceable one.

`stampTermsAcceptance_()` writes `acceptedTerms` / `termsVersion` /
`termsAcceptedAt` into `S`, and `logQuote()` promotes them to the **top level
of the payload** — a value living only in the browser proves nothing later.
Re-stamping happens only when the posted version differs from the stamped one,
so a customer who clicks under new terms gets a fresh record and everyone else
keeps their original.

**`TERMS_VERSION` is declared once, in `terms-config.js`**, and read by
`index.html`, `terms.html` and `privacy.html`. `verify.sh` fails on a
hardcoded version anywhere else — the version shown and the version recorded
must never disagree.

Passing the gate immediately logs a row with status `Quote started` on its own
**`Quote Started`** tab, so an abandoned build still leaves a durable record
(who reached the pricing, and which terms they accepted). Completing the quote
does *not* create a second row — the existing duplicate sweep moves it onto the
real storage tab.

**The lead tab is excluded from every customer-facing email sweep, and that
exclusion is load-bearing.** `dailyReminderCheck()` runs at 9am on its own; if
it stopped skipping `STARTED_TAB` it would email a stranger — possibly a
competitor — a "your quote is waiting" nudge ten days after they poked at the
pricing. `sendSpringAlertAll()` skips it too. `verify.sh` asserts both, and
fails if either exclusion is removed. Started rows also skip PDF generation and
are forced to `emailCustomer = 0` server-side. The internal `service@`
notification still fires — that is the "someone started a quote" alert.

A quote loaded from the server is never gated and never logs a start row:
posting a `Quote started` status over a real (possibly paid) quote would
overwrite it. `QUOTE_LOADED` guards both paths.

### Season-done survey
A 3-option survey (done now / done on a date / will call) rides on customer
emails — but **only once a deposit or payment exists** (`o.paid > 0`, checked in
`customerEmailHtml_`). Asking someone to book a haul-out before they've put
money down is asking them to schedule work they haven't agreed to buy, and it
puts a date in the yard plan that nothing backs up. A refund back to zero drops
the question again; receipts never carry it. The console's Season timing block
is staff-facing and stays available regardless, for phone calls. Answers post back via `?action=seasondone`. A stated date after Nov 15
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

Admins can **create and remove accounts** from the console (`adminAddStaff` /
`adminRemoveStaff`). Three rules the console enforces because none of them can
be undone from inside it:
- **PINs are minted by `freshPin_()`, never `Math.random()` alone.** `adminAuth`
  looks a person up *by* their PIN, so a duplicate would silently sign the
  second person in as the first. `verify.sh` fails if any path mints one
  without the collision check.
- **The last admin can't be removed or demoted**, and nobody can remove their
  own account. `adminCount_()` guards both; `verify.sh` asserts it.
- **Removal revokes sessions** (`revokeSessions_`). `requireAuth_` already
  rejects a session whose roster entry is gone, so this is belt-and-braces plus
  property hygiene.

Names are typed by admins now, so the console addresses staff rows **by index,
not by pasting the name into an `onclick`** — an apostrophe in a name would
otherwise break the handler.

### Restoring from a backup
Admin-only console panel; full walkthrough in `docs/BACKUP-RESTORE.md`. Upload
a nightly `.xlsx`, see a comparison, then choose what to put back. Invariants:
- **A restore never deletes a live quote.** It only writes rows the backup
  knows about, so work taken since the backup survives either mode.
- **`snapshotBeforeRestore_()` runs first, every time** — the restore is itself
  undoable, and `verify.sh` fails if that call is removed.
- **Preview writes nothing.** Upload reads and reports; writing needs a second,
  explicit click.
- Reading an `.xlsx` needs Drive to convert it, so this is the one feature that
  uses **new OAuth scopes** (`SpreadsheetApp.openById` + the Drive upload API).
  `checkRestoreAccess()` exists to trigger that approval from the editor
  *before* deploying — this web app is `ANYONE_ANONYMOUS` / `USER_DEPLOYING`,
  so a scope waiting on approval can take the **customer page** down, not just
  the console. Push-only first, run it, then deploy (§2.3).

Current roster intent: Chris & Jeff admin (full); John, Rex, Jess →
pay+email+photos; Marina → photos only.

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
any test window. Nothing else is automatic (§5).

---

## 5. Product rules that are easy to break

- **Two customer-facing emails are automatic; everything else needs a click.**
  (1) the 10-day reminder on real quotes, and (2) the **lead follow-up**
  ("finish my quote") sent once, 24h after someone passes the contact gate and
  walks away — `leadFollowUpCheck()`, a **daily** trigger at **12:15pm
  Central**, chosen to land over lunch when someone has a moment to act on it.
  The real delay is therefore 24–47h: the first 12:15 sweep after a full 24
  hours have elapsed. Apps Script fires time triggers approximately, within
  roughly a quarter-hour window — that cannot be tightened. It scans
  **only** the lead tab, which is what makes "walked away" true by
  construction: saving, printing, emailing or paying moves the row off that
  tab. Its sent-marker goes in the reminder column with the distinct prefix
  `Lead follow-up sent `, and `doPost` **drops that marker when the row
  graduates** to a real tab — otherwise the genuine 10-day reminder would see
  a reminder already sent and stay silent forever.
  Late-fee warnings, fee application, receipts, seasonal emails — all require
  a human click and confirmation. The 1st/15th reports go to Chris only.
  **Both automatic sends write to the Activity Log** as `System (automatic)`.
  Staff read that log to answer "did we contact this customer?", so an email
  nobody clicked send on must still appear there; `verify.sh` asserts it.
- **Arrival and notice emails never ask when a customer wants to come out of
  the water.** We already have the boat. The season-done survey lives in
  `customerEmailHtml_` (quotes and invoices); notice kinds use `noticeHtml_`,
  which has none. `verify.sh` fails if the survey ever reaches `noticeHtml_`.
- **The `fall` email is the autumn counterpart to `spring`** — season winding
  down, a last opening for detailing or other winter work, and the haul-out
  timing poll (the same three buttons, so answers land in the existing
  season-done flow and the late-retrieval surcharge still applies).
  `hasDetailing_()` checks priced lines, outstanding requests *and* the
  staff-priced journal, so somebody who has already asked is told it is in hand
  rather than sold it again. Land units get "collect it", never "out of the
  water".
- **"You're up next" points both ways.** `upnextfall` is the autumn twin of
  `upnext`: we are about to touch the unit, speak now — but taking it *out*.
  They are deliberately two kinds rather than one with the verbs flipped,
  because the last-minute request that matters in spring ("anything before it
  goes in?") is not the one that matters in autumn ("anything while we have
  it?"). The console picks direction from a dropdown, the menu asks. Bikes get
  no "leave the keys" line — they have none.
- **Unit-appropriate wording.** Golf carts and e-bikes are *land units*
  (`isLandUnit_`, `isBike_`). They come "back home" / are "ready to ride" —
  never "back in the water," never "relaunch," never "splash." This shipped
  broken once; a golf cart was congratulated on being back in the water.
- **Menu ↔ console parity.** Anything staff can do in the spreadsheet menu
  should exist in the console, and vice versa. Line editing was console-missing
  for a while; that gap is the kind of thing to actively check. Every menu email
  now goes through `menuSendKind_` → `buildEmailFor_`, the same builder the
  console previews from, so the two cannot say different things. The old
  `springAlertFor_` was a second hand-written copy of the spring wording and is
  gone.

### Send to all

Two kinds and only two — `BULK_KINDS_` is the whole allow-list: `spring` (skips
`No Storage`; nothing to relaunch for a unit we never stored) and `fall` (skips
nothing; a No Storage customer still has to get the unit to us). Reachable from
the console with **no quote loaded**, gated on `email`, and from the sheet menu.

- **One recipient list, `bulkTargets_`.** Console and menu share it, and both
  send through `bulkSendKind_`. A menu item that walks the sheets itself is a
  second copy of the lead-exclusion rule, and the second copy is the one that
  gets it wrong — `verify.sh` fails if `sendSpringAlertAll` or `sendFallNoteAll`
  grows its own sweep.
- **Leads are never in it.** `tools/check-bulk-targets.js` stands up a fake
  spreadsheet *with a lead row on it*, runs the real `bulkTargets_`, and reads
  the answer. A grep for `isStartedTab_` passes even when the condition is
  inverted; this doesn't. It also pins the per-kind tab rules, the missing-email
  reporting, and the header probe that separates a customer tab from a log.
- **Preview sends nothing.** It reports the count per tab, who has no email
  address, a Gmail-quota warning past 400, and renders one real email for the
  first recipient — what staff approve is the actual email, not a description.
- **The recipient picker narrows and can never widen.** Preview returns the
  roster; the console renders it as checkboxes, everyone ticked, so unticking is
  the deliberate act. The posted selection is a **filter** applied by
  `bulkFilterTargets_` to the list `bulkTargets_` already computed — a quote
  number that is not already a target is ignored, never looked up and added.
  Otherwise the checkbox list would become a way to email anyone on the sheet,
  leads included. Two shapes matter and are both pinned: `null` (the sheet menu,
  which has no picker) means everyone; an **empty array means nobody** and must
  never fall through to everyone — that is the difference between zero emails
  and five hundred. `check-bulk-targets.js` executes all of it.
- Every bulk send is audited (`SEND TO ALL "…" — n of m`) and lands in each
  quote's Email History.

### Haul-out list

`printHaulOut()` on the storage card — one yard-wide sheet, not one per
building, because haul-out order is a yard-wide question. Sorted ready-now →
stated dates ascending → will call → not answered, and it carries what the crew
needs standing in the yard: customer, unit + dims, storage, trailer or not,
slip, key location, requested timing and any note. Sorting uses the stored ISO
date; printing uses `haulDate_()`, which passes anything non-ISO through rather
than printing "Invalid Date" on a sheet somebody is holding.
- **Money and customer email are menu/console-only.** Never hand-edit cells —
  it desyncs the payload, PDF, and totals.
- **Key location & HHO address:** required for boat/jetski/golf (keys) and
  golf (HHO street address). $500 tow/start fee warning for boats/jetskis;
  golf carts **cannot be picked up without keys at all**.

### Keys & slip (console) and the missing-info chase

`Keys & slip` card, gated on `adjust` (it writes the payload and re-runs the
engine — the slip number appears in the Heritage Harbor discount line).

- **Journalled like a re-measure, never written into `d.state`.** Both fields
  exist in the customer's browser too and are re-posted on every save, so a
  staff correction written into `d.state` would survive right up until their
  next save. They go into `manual.measured`; `effectiveState_` overlays them.
  `verify.sh` fails if `adminKeysApply` assigns into `d.state`.
- **A blank box removes the override**, falling back to what the customer told
  us, rather than storing an empty string that hides it forever.
- **The top-level copies are only ever upgraded on a customer save.**
  `rebuildLinesFromState_` syncs `keyLoc`/`slipNo` from the effective state but
  **will not blank a non-empty one** — older payloads carry a key location at
  the top level that never reached `state`, and copying the empty state over it
  would lose the only record of where the keys are. Deliberate clearing is
  `adminKeysApply`'s job, where blanking is what was actually asked for. This
  regression was caught by the save-path fixture and is pinned permanently.
- **The haul-out "up next" email asks for whatever is missing**, and only for
  what applies: `missingHaulInfo_` never asks an e-bike for keys — it has none.
  Every water unit gets the slip question. When both are known the email says
  them back, because a key location six months old quietly stops being true.
  `tools/check-haul-info.js` runs the rule over every combination rather than
  grepping for it; `verify.sh` runs it.
- **`hasTrailer` says nothing about where the boat is.** Owning a trailer does
  not mean the boat is on it — Heritage Harbor customers routinely store the
  trailer with Quest and keep the boat in a slip all season. Gating the slip
  question on the trailer flag (which this did, briefly) hid it from exactly the
  customers most likely to have a slip. The guard pairs every case on and off
  the trailer flag so the answer cannot start depending on it again. The wording
  covers the genuinely-not-in-the-water boat instead, by inviting them to say
  where it is.
- **Every close control closes.** Panels (storage, staff, matches, quote) each
  need a working ✕. Users noticed when one didn't.
- **No duplicate top-level function names in the console.** `admin/index.html`
  is one big `<script>`, so a second `function foo()` silently *replaces* the
  first (declarations hoist; the later one wins). This shipped: a photo-toggle
  `setSeason(s,btn)` overwrote the season-done `setSeason(choice)`, killing the
  "Done now" and "Will call" buttons — they threw on `btn.classList` and never
  sent the answer, while also corrupting the photo upload target. "Set date…"
  kept working (different name, `openSeasonDate`), which is why it hid for so
  long. `verify.sh` now fails on any duplicate function name in the console.
  Name console handlers for their feature (`setSeasonDoneChoice`), not the
  generic noun.

---

## 6. Testing checklist before calling anything done

Run against the test quote **`QW-26-1255`** (boat — see §4b; it is the only
row you may write to). The old golf-cart test quote `QW-26-3477` is gone, so
**there is currently no land-unit test row**: build a throwaway golf cart or
e-bike quote when touching land-unit paths, since that wording is the
least-exercised and is where bugs hide (§5).

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
1. ~~Extract config + engine into a shared, DOM-free module.~~ **DONE** —
   `pricing-engine.js`.
2. ~~Refactor `index.html` to call the shared engine.~~ **DONE** — totals
   identical; the baseline gate in `verify.sh` keeps them that way.
3. ~~Give the Apps Script the same engine + drift alarm.~~ **DONE** — the
   engine is embedded in the `.gs` between `ENGINE-START`/`ENGINE-END`.
   **Never hand-edit that block**: edit `pricing-engine.js`, run
   `node tools/sync-engine.js`, commit both. Two guards back it:
   `sync-engine.js --check` diffs the copies, and
   `check-embedded-engine.js` executes the block as bare top-level code (the
   scope Apps Script gives it) and prices every fixture — because identical
   text is not the same as working code.
4. ~~Dimension editor + storage move on the console.~~ **DONE** — see below.

Chris explicitly does NOT want auto-relocation of storage on a beam change —
that's a customer conversation. Flag it and let him move it manually.

### Re-measuring and relocating (console)

`Unit details & storage` card, gated on the `adjust` permission. Edit LOA /
beam / LWT (or stored L×W for a jet ski), toggle the trailer, **correct the
motor type / count / service level**, and/or pick a new storage location →
**Preview the change** → server re-prices with the shared engine and returns a
before/after line diff → **Apply**. Nothing is written until Apply.

- **Motors travel as one control group** (`sanitizeEngines_`), because the rules
  bind them: a boat may have multiples of ONE type but never a mix, so changing
  the type has to zero the others. Three counts sent loose could leave a boat
  with two inboards *and* an outboard. Switching to outboard also clears
  `dtTrans` — outboards have no transmission or V-drive, and the console hides
  that field for them, so staff couldn't fix it otherwise.
  `tools/check-engine-rules.js` **executes** the rule over every type/count
  combination rather than grepping for it; `verify.sh` runs it.
- **A blank count is refused, not read as zero.** `Number('')` is 0, so an
  emptied field would silently delete the winterizing charge. Zero has to be
  typed on purpose. Same for `wholeCount_` on transmissions. (Related trap,
  fixed twice now: never strip the sign before a range check — `-1` becomes a
  perfectly valid `1`.)

- **The new values are journalled, never written into `d.state`.**
  `d.manual.measured` holds what *Quest* measured; `d.state` stays what the
  *customer* selected. `effectiveState_()` overlays one on the other and is what
  everything prices from — **including `?action=load`**, which must serve
  `effectiveState_(d)` and not raw `d.state`. Serving the raw state shipped once
  and meant a relocated quote rendered on the customer's own page at its old
  storage and old price (an $820 gap on the test quote), then posted a state
  that disagreed with the server and tripped the drift alarm on every save.
  `verify.sh` asserts the load endpoint. Because the page now round-trips the
  effective state, `adminDimsApply` snapshots the customer's original into
  `manual.customerState` the first time it measures, so "what did they tell us"
  survives their next save. Writing into `d.state` would work right up until the
  customer's next save, which posts the state still sitting in their browser and
  would silently undo the re-measure. `verify.sh` fails if `adminDimsApply` ever
  assigns into `d.state`.
- **Beam over the limit is flagged, never acted on** (Chris's rule above). The
  flag comes from `computeFlags_`, which must stay advisory — `verify.sh` fails
  if it mutates the state it was handed.
- **Storage choices are per unit type.** `allowedStorageFor_()`: a jet ski is
  inside-or-nothing (outside storage prices per foot of LOA, which a jet ski
  quote doesn't carry); golf carts and e-bikes have one tab each and no choice.
  The console renders exactly what the server allows.
- **Moving storage physically moves the row** (`moveQuoteRow_`), carrying every
  column with it. Because a relocation changes the destination tab *after* the
  browser posted one, `doPost` now **reads** all copies of a quote first and
  **deletes** stale ones only once the final tab is known (`pruneQuoteCopies_`).
  Deleting against the posted tab and writing to the rebuilt one would leave the
  quote on two tabs at once.
- **`dims` email kind** in `buildEmailFor_` — previewable like every other, and
  the first notice kind to set `attachPdf`, so the customer gets the rebuilt
  quote/invoice with it. Its wording follows what actually changed: a
  storage-only move must not claim we measured anything.
- `storageTabFor()` and `dimsString()` moved into the shared engine, because
  both sides now decide them — the page on save, the console on a move.

---

## 9. What's deliberately still open

| Item | State | Notes |
|---|---|---|
| Adobe Sign web form | **Chris's task** | `adobeWebFormUrl:''` in the page; a customer-appropriate "signing almost here" placeholder shows until set. Last blocker to full couch-to-paid. |
| Excel import of last year's selections | Blocked | Needs a sample workbook from Chris to map columns. Architecture supports it — quotes store selections, not prices. |
| Twilio SMS mirroring | Blocked on A2P registration (~$20–65 one-time, ~$50–60/yr, ~1 month approval). `buildEmailFor_` centralization makes mirroring cheap once approved. Reference PDF exists. |
| Year-over-year rollover | Architected, not exercised | Same script/URL/spreadsheet; archive-rename tabs, update SEASON/PRICES/RULES in the **Annual Update Zone** at the top of `pricing-engine.js` (it moved there from `index.html` — one edit now updates page *and* server). Old quotes re-price against new rates on reload. |
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
