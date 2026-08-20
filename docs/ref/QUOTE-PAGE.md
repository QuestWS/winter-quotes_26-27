# The customer quote page

Rules that live on `index.html` — what a customer may build, how they get
back to an unfinished quote, and what the proceed button commits them to.

*Split out of `CLAUDE.md` so it is read when it is relevant rather than on
every request. The rules are unchanged — this text was moved verbatim, and
`tools/check-docs-coverage.js` fails if any of it goes missing.*

---

## One motor type per boat
Inboard / outboard / I-O are mutually exclusive; multiples of one type are
normal. Picking a type zeroes the others and dims their rows
(`clearOtherEngineTypes_`, `syncEngineRows_`). Genuinely odd rigs are handled
by Quest as a line-item adjustment, not by letting a customer build a boat
that cannot exist.


## Detail options are NOT mutually exclusive
Exterior detail / wash & wax, interior detail / wipe-down, and bottom-paint
touch-up / strip & reapply can all be requested together, deliberately: Quest
quotes every option and removes what the customer doesn't take. Do not
reintroduce `data-excl` on these. (Acid wash still suppresses powerwash — that
is pricing logic in the engine, not a choice restriction.)


## Resuming an unfinished quote
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


## Terms acceptance & lead capture
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

**The terms version is declared once, as `QuestTerms.version` in
`terms-config.js`**, and read by
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


## Season-done survey
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
