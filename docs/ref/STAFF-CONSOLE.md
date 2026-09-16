# The staff console

Everything reachable from `admin/index.html`: who may do what, and the
invariant behind each card and panel.

*Split out of `CLAUDE.md` so it is read when it is relevant rather than on
every request. The rules are unchanged — this text was moved verbatim, and
`tools/check-docs-coverage.js` fails if any of it goes missing.*

---

## Permissions
Roster in Script Properties `STAFF`. Perms: `pay`, `adjust`, `email`,
`photos`, `keys`, plus `admin`. `requireAuth_(token, perm)` gates every console
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


## How the console talks to the backend

`api(fn,args)` POSTs `{api:'console',fn,token,args}` to `/exec`, and
`consoleServe_` in the `.gs` dispatches it. Since September 2026 the same
dispatcher also answers a **GET** (`?api=console&fn=…&token=…&args=…`).

**Why:** those POSTs started coming back with `doGet`'s customer-facing *"Enter
both your quote number and last name."* That string is reachable only by a GET
carrying no quote number, so the POST body was being lost between the browser
and Apps Script and the call was landing on the customer quote-loader. The
console displayed the answer it got, so staff were asked for a customer's last
name to look up a quote they already had open, and Print did the same thing.
Nothing was wrong with the quote, the PIN, or the console — the question never
reached the code that answers it.

- **A reply is only believed if it carries `_api:'console'`.** That stamp is
  how the console tells *"the server said no"* from *"the server never heard
  me"*. Without it the two are indistinguishable, which is exactly how a
  customer error message ended up inside the staff console.
- **Read-only calls are retried over GET; a write is never re-sent blindly.**
  A reply that went missing cannot prove whether the write ran first, and a
  silently repeated payment is far worse than an error. After the first lost
  POST the console switches to GET for reads for the rest of the session rather
  than paying for a round trip already known to fail — **but a write always
  posts anyway**, because the server refuses writes on GET, so skipping the
  POST would mean the action was never attempted at all.
- **A write that goes unanswered is chased down, not guessed at.** Every write
  carries a `rid` the console generates, one per action. The server claims that
  id under the script lock, does the work once, and keeps the answer for fifteen
  minutes — so asking about it again is free and re-sending it is harmless. When
  the reply goes missing the console polls `jobStatus` **over GET** (the route
  that still works when POST is what broke) for about half a minute and reports
  what actually happened:
  - *done* → it shows the server's real message, so a payment that went through
    reads as "Recorded $500.00 — Paid in full", not as an error;
  - *unknown*, several times over → the request never arrived, nothing changed,
    try again;
  - *still running* → it says so and tells staff **not** to send it again, and
    to reload and check the quote first.

  **Why this exists:** recording a payment rebuilds the PDF and sends two
  emails. When that ran long, Google gave up on the POST and handed the console
  a 404 — so Chris was told the payment had failed while the receipt, carrying
  the new balance, was already in the customer's inbox. The next thing anyone
  does with a failed payment is record it again.
- **A transport failure is not an answer.** A non-2xx, an unreachable host and
  a body that will not parse are tagged as transport failures and handled apart
  from anything the server said. Before that, a 404 on the POST was thrown
  before the GET fallback could run — which is why the storage view failed
  after minutes of waiting and then worked on the very next tap.
- **`CONSOLE_GET_FNS_` is enforced server-side, not just client-side.** The
  console is not the only thing that can build a URL, and the retry makes GETs
  repeatable by construction — so a GET naming a write is *refused*, not merely
  un-sent. `auth` is on the list deliberately: a PIN in a query string is not
  free (it reaches Quest's own Apps Script log; a fetch URL never enters browser
  history), but being unable to sign in to the console at all is the worse
  failure.
- **The lost-call detector matches on wording**, which is fragile, so
  `tools/check-console-transport.js` pins it against the customer loader's real
  strings. That guard also runs the real dispatcher to prove every write is
  refused on GET and never reaches its function, that all allow-listed reads do
  answer, that every reply is stamped, and that the client's retry list and the
  server's allow-list are the same set.
- **Both halves of the recovery are executed, not grepped.**
  `tools/check-idempotent-writes.js` runs the real dispatcher against a faked
  cache and lock: one run per `rid`, the same answer replayed to a repeat,
  "running" while it is in flight, unchanged behaviour with no `rid` at all, and
  a write still working when CacheService is unavailable.
  `tools/check-console-recovery.js` lifts the console's own script out of
  `admin/index.html` and runs it against a `fetch` that fails on cue — the 404
  that must fall through to GET, and the payment that must be reported by its
  real result rather than as a failure.


## Why the console got slow, and what is cached

Every action used to re-walk the whole spreadsheet. Opening a quote read the
Quote # column of every tab; the storage view read all 23 columns of every row
on every tab, and column 21 is the full JSON payload — kilobytes per quote. By
September that was tens of seconds of Sheets traffic for one tap, which is what
put the calls over the edge Google gives up at.

- **The storage view is cached for two minutes**, split across CacheService
  entries (`cachePutBig_` / `cacheGetBig_`, 100KB cap each). A missing chunk is
  a miss, never half a yard sheet.
- **Every write drops that cache**, from one place: `consoleServe_` invalidates
  after any function that is *not* on the read-only allow-list. Deriving it from
  that list is the point — a write added later cannot forget to. The customer
  save path does the same at the end of `doPost`.
- **The quote → (tab, row) index is cached for half an hour and verified before
  it is trusted**: one cell is re-read to confirm the quote number still matches
  there. A row that moved simply misses and falls back to the full scan.
- **The storage view and the search read columns 1..`COL.DIMS`**, plus the
  payload column on its own for the storage view. Neither needs the itemised
  services, the customer notes or the link columns, and those were the bulk of
  what was being shipped.
- **`savePdf_` remembers the blob it just filed** (`_freshPdf_`), so the email
  that follows attaches it instead of searching Drive and downloading the file
  back. That also removes a race: Drive's index is not instant, and the search
  could still be returning the copy `savePdf_` had just trashed.
- **A reply with no stamp at all is still accepted** when it isn't the customer
  loader's — an older backend answers exactly that way, so the page and the
  script can be deployed in either order.


## Customer link

Every loaded quote shows a **Customer link** block under the print button: the
URL in full, selectable, with Copy and Open. It opens that customer's quote on
the customer page already filled in — nothing to spell out over the phone, and
it can be texted.

- **The server builds it, not the console** (`quoteLinkFor_` on `adminLookup`).
  The same `quoteLink_` builds the one inside every customer email, so the link
  staff hand over in the yard and the link the customer was emailed are the
  same URL. See `docs/ref/EMAILS.md`.
- **The URL is shown, not just copied.** `navigator.clipboard` needs a secure
  context and is missing in some in-app browsers; `copyQuoteLink()` falls back
  to select + `execCommand`, and if that goes too it leaves the field selected
  so press-and-hold still works. A copy button that can silently do nothing is
  worse than a field you can read out.
- **Hidden, not broken, when there is no last name.** The server returns `''`
  and the block does not render — a link missing half its query string opens an
  empty quote page and looks like the system lost the quote.
- The sheet menu's *Show customer link for selected quote* is the same link
  (menu ↔ console parity). It reads the row and shows the URL; it writes
  nothing and sends nothing. The legacy `?page=admin` console shows it too, as
  a row in its info list — a fallback console missing something staff have
  started relying on is a fallback that fails the day it is needed.


## Staff notes

`d.staffNote`, own card, gated on `keys`. Why a quote is the way it is —
discounts, odd dimensions, what was agreed on the phone. Chris's reason: not
having to guess at his own logic a year later.

- **Never customer-facing.** Not the PDF, not any email, not `?action=load`.
  `verify.sh` checks all five paths; the value of a candid note is the candour.
- **It must be carried across a customer save.** The note exists only on this
  side, so a posted payload has no such field and would wipe it — preserved
  explicitly like `payments`, and pinned by the save-path fixture.
- Saving a note touches nothing else: no status, no re-price, no new PDF.


## Keys & slip (console) and the missing-info chase

`Keys & slip` card, gated on its **own `keys` permission** — recording where the
keys are is yard work, and the crew who find that out have no business changing
what a customer owes. Chris, Jeff, John, Rex and Jess have it; Marina does not.

- **Roster entries written before the permission existed have no `keys` field.**
  `canKeys_()` falls back to "already trusted with payments or adjustments",
  which is exactly the yard staff and the admins, so nobody had to run a
  migration. An explicit setting always wins, including turning it OFF.
  `permsOf()` mirrors that fallback in the console, because `ME` is cached in
  localStorage and a session opened before the deploy would otherwise lose the
  card on an action the server still accepts.
  `tools/check-perms-pause.js` runs the real roster through it.

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


## Re-measuring and relocating (console)

`Unit details & storage` card, gated on the `adjust` permission. Edit LOA /
beam / LWT (or stored L×W for a jet ski), toggle the trailer, **correct the
motor type / count / service level**, and/or pick a new storage location →
**Preview the change** → server re-prices with the shared engine and returns a
before/after line diff → **Apply**. Nothing is written until Apply.

- **Motors travel as one control group** (`sanitizeEngines_`), because the rules
  bind them: a boat may have multiples of ONE type but never a mix, so changing
  the type has to zero the others. Three counts sent loose could leave a boat
  with two inboards *and* an outboard. Switching to outboard or jet drive also
  clears `dtTrans` — neither has a transmission or V-drive, and the console
  hides that field for both, so staff couldn't fix it otherwise.
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
- **Beam over the limit is flagged, never acted on.** Chris explicitly does NOT
  want auto-relocation of storage on a beam change — that's a customer
  conversation. Flag it and let him move it manually. The
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


## Re-pricing a season (console)

`Re-price at current rates`, menu, gated on `adjust`. Existing quotes do **not**
follow a rate change on their own: a quote only re-prices when the customer
reloads and re-saves, and a quote with a payment never re-prices at all (the
customer save path is locked). That leaves the sheet holding a mix of old and
new prices with no way to tell which is which. This is the staff-side answer.

Quest's position, from Chris: last year's numbers were given as ball-park and
are **not** honoured on the strength of a deposit. So paid quotes are in scope.

- **Preview writes nothing.** `repriceScan_` prices deep copies and reports
  before → after → delta per quote, plus the net movement across the season.
  `verify.sh` fails if the preview path gains a write or a send.
- **The staff journal replays.** Without `applyManualOps_` a re-price would
  silently erase every discount — the most expensive possible failure here, so
  `check-reprice.js` asserts a discounted quote stays exactly its discount below
  an identical undiscounted one.
- **Deposits are untouched**; payments are append-only, so the balance simply
  moves. The preview says how many ticked quotes have money on them.
- **A quote whose storage tab would move is reported, never moved.** Relocating
  somebody is a conversation — see the re-measure rules above — and a bulk job
  is the wrong place for it.
- **Snapshot first, every time.** A season-wide re-price cannot be undone from
  the console, so `snapshotBeforeRestore_()` runs before the first write and the
  link is shown with the result. `verify.sh` fails if that call is removed.
- **Nobody is emailed.** Who gets told, and when, is a separate human decision.
- **Applied in batches of 15** from the console. Regenerating a quote PDF takes
  seconds and Apps Script stops a call at six minutes; a whole season in one
  request would time out mid-write with no record of where it stopped.


## Loading an old winter-services sheet (console)

`Load from an old sheet`, menu, gated on `adjust`. The pre-system quotes were
**one spreadsheet per customer**, built from the "Winter services menu master
pricing" template. This reads one and makes a quote here.

- **Three file states, and the third is the one that matters.** Intact with
  labels; intact but with the label column dead (`$0`); and **broken**, where
  prices *and* labels are `#REF!` because they were live links to the master
  workbook. The broken ones are the biggest group.
- **The broken ones are recoverable, and that is Chris's insight.** Those cells
  reference the same positions in the master, because the design was to swap the
  master yearly to re-price everything. The customer's quantities are still in
  their own file, so `parseLegacyGrid_(rows, master)` reads the meaning from the
  master at the same row/col. It proves the two grids are the same template
  first — the six section captions are plain text in every file and must agree
  row for row — and refuses outright if they don't.
- **Match on unit price, never the label.** The price is the only thing that
  reliably survives. Two services are $298 and two are $23, so the scan only
  ever moves forward: order is what separates them.
- **Recovered lines carry no amount.** Those were formulas and are gone. A
  recovered line has its quantity and the master's unit price, is marked
  recovered, and says the figure is recalculated rather than what was quoted.
- **A sheet with two storage options is a COMPARISON, not a quote.** Chris
  priced inside against outside on one page to quote the difference; its total
  is the sum of both and is a number nobody was ever quoted — on the real
  example it overstates the inside option by $1,856. Never sum, never pick;
  staff say which was taken.
- **The companion lines follow the option, not the sheet.** Shrinkwrap and
  separately-charged retrieval belong to OUTSIDE (inside includes retrieval).
  Carried over but flagged; dropping them on the real example lands on
  $2,648.28 against the sheet's $2,648.
- **Jet skis and golf carts got tagged onto boat sheets** because fewer files
  was better then. Here one quote per unit is what makes the storage tabs, the
  haul-out list and re-pricing work, so extras are reported for separating.
- **Imports price at TODAY's rates** and carry choices, not old figures — an
  imported quote must re-price like every other. Preview writes nothing; the
  import emails nobody; `verify.sh` asserts all three.
- `tools/check-legacy-import.js` executes eighteen groups over all three file
  states, a mismatched master, comparison sheets, multi-unit sheets and the
  live engine. Fixtures are invented names over the real layout — **no customer
  data in this repo**.


## Restoring from a backup
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
  the console. Push-only first, run it, then deploy (CLAUDE.md §2, step 3).

Current roster intent: Chris & Jeff admin (full); John, Rex, Jess →
pay+email+photos; Marina → photos only.

---


## Haul-out list

`printHaulOut()` on the storage card — one yard-wide sheet, not one per
building, because haul-out order is a yard-wide question. Sorted ready-now →
stated dates ascending → will call → not answered, and it carries what the crew
needs standing in the yard: customer, unit + dims, storage, trailer or not,
slip, key location, requested timing and any note. Sorting uses the stored ISO
date; printing uses `haulDate_()`, which passes anything non-ISO through rather
than printing "Invalid Date" on a sheet somebody is holding.
- **Email previews render by writing into the frame, not `srcdoc`.** The frame
  is `sandbox="allow-same-origin"` and deliberately **not** `allow-scripts`, so
  a rendered email stays inert. `srcdoc` under a fully-restrictive sandbox works
  in Chrome and comes up **blank on iOS Safari** — which is what the yard uses,
  so every email preview was broken for the person who most needs it while every
  desktop test passed. `pvRender()` is the single path for both the per-quote
  preview and the send-to-all sample, and it reports a failure rather than
  showing an empty box. `verify.sh` pins the sandbox value both ways.
- **Staff can re-measure after a deposit.** The workflow is quote → deposit →
  boat pulled → measured → re-billed. The payment lock belongs to the *customer*
  save path only, where it stops a stale browser tab overwriting a paid invoice;
  `verify.sh` fails if it spreads to `adminDimsApply` / `adminDimsPreview`.
- **Money and customer email are menu/console-only.** Never hand-edit cells —
  it desyncs the payload, PDF, and totals.
- **Key location & HHO address:** required for boat/jetski/golf (keys) and
  golf (HHO street address). $500 tow/start fee warning for boats/jetskis;
  golf carts **cannot be picked up without keys at all**.
