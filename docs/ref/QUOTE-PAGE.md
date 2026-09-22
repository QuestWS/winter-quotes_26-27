# The customer quote page

Rules that live on `index.html` — what a customer may build, how they get
back to an unfinished quote, and what the proceed button commits them to.

*Split out of `CLAUDE.md` so it is read when it is relevant rather than on
every request. The rules are unchanged — this text was moved verbatim, and
`tools/check-docs-coverage.js` fails if any of it goes missing.*

---

## One motor type per boat
Inboard / outboard / I-O / jet drive are mutually exclusive; multiples of one
type are normal. Picking a type zeroes the others and dims their rows
(`clearOtherEngineTypes_`, `syncEngineRows_`). Genuinely odd rigs are handled
by Quest as a line-item adjustment, not by letting a customer build a boat
that cannot exist.

Jet drive is a boat engine that winterizes exactly like a PWC/jetski — no
drive oil, no gimbal ring — so it rides the pwc rate and description text
instead of carrying its own (`BOAT_ENGINES`' `likePwc` flag in
`pricing-engine.js`, aliased in `PRICES.basic.jet`/`PRICES.full.jet`). Update
the pwc rate at rollover and jet follows automatically; there is no second
number to remember.


## A jet ski quote is a trailer, not a hull
The ski step asks how many skis are **on this trailer** ("Tandem trailer with
two skis? Set it to 2"), and storage is priced once, on the stored footprint of
the whole rig — tongue to rearmost point, full width at the widest — including
a tandem trailer carrying a single ski. Winterizing and detailing are per ski;
storage, retrieval and the haul-out row are per trailer. Two skis on two
trailers are therefore two quotes, and the old-sheet importer asks which it is
looking at rather than guessing (`docs/ref/STAFF-CONSOLE.md`).


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

That link is no longer only the follow-up email's: the quote/invoice email, the
10-day reminder and the staff console's copyable **Customer link** all hand out
the same `?quote=…&ln=…` URL, all built by `quoteLink_` server-side
(`docs/ref/EMAILS.md`). `autoLoadFromUrl_()` is therefore a **customer-facing
entry point**, not a one-off — a change to it, or to the fields it fills, is a
change to every one of those paths.


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


## The sign step

The Acrobat Sign web form is embedded in an iframe on the sign & pay panel,
with **two** values pre-filled through the URL fragment: the quote number, and
the slip number when the unit is in one. That is the entire hand-off —
`adobeSignUrl()` on the page is three lines and delegates to `signUrlFor()` in
the shared engine, which the server uses too. Setup and field names:
`docs/adobe-webform-field-map.md`.

The selections and totals are deliberately **not** sent. The agreement is a
contract, not a restatement of the quote; the numbers travel on the quote PDF
attached to the same email. Pricing in two places is pricing that can disagree,
and a quote re-prices on reload while a signed PDF is frozen. (An earlier
builder pushed ~50 fields — every line item and amount — at a form that never
had fields to receive them; Adobe ignores a parameter with no matching field,
silently, so it looked like it worked.)

`SIGNING.webFormUrl` in `pricing-engine.js` is the on switch, and it is now
**set** to the live form. Empty it and `adobeSignUrl()` returns `''`, the page
shows the "signing almost here" placeholder instead of an iframe, and
`#signNote` is hidden — the note promises the form opens pre-filled, so it must
not show when there is no form. That fallback is the kill switch if Adobe ever
has a bad day: one line, and the page stops sending anyone to a broken form.

The page's link carries `hosted=false` (`signUrlFor({…, embed:true})`), which
is what Adobe's own iframe snippet uses — it tells the widget it is embedded in
our page rather than hosted on one of Adobe's. The emailed button must **not**
carry it, because that one opens the form directly; the server never passes the
flag, and `tools/check-sign-link.js` checks both halves.

The two fields are `Quote_Number` and `Slip_Number` — underscores, which is
what Adobe recommends. `Quote_Number` is read-only on the Adobe side (it is our
reference back to the sheet row); `Slip_Number` is editable on purpose, because
for most quotes we have no slip to send and a locked blank box is a phone call.
Keys are percent-encoded along with values, which is a no-op for these names
and the guard for the next one.

The panel also warns about anything the crew will need and the customer has not
given — name, slip, Heritage Harbor pickup address, key location, email —
through `#signMissing`. That gate is about the haul-out, not about the
pre-fill: only the slip is actually sent to Adobe.


## Scan to sign (`sign.html`)

The second door into the same Adobe form, for a customer standing at the
service counter rather than sitting at home with their quote open. A laminated
flyer carries a QR code to
`https://questws.github.io/winter-quotes_26-27/sign.html`; the customer types
their quote number, the page confirms it against the sheet, and hands them to
the web form with `Quote_Number` — and `Slip_Number` when we have one —
already filled in.

**Why the page exists at all.** The QR used to point straight at Adobe, so the
customer typed the quote number into the agreement itself, into a field nobody
checks until a signed contract comes back pointing at nothing. This page moves
that typing one step earlier, to the one place we can check it.

**The rule everything on the page bends to: the lookup may inform, it may never
block.** An unknown quote number, a lookup that times out, a backend that is
down, a browser that refuses the cross-origin fetch — all four end the same
way, with a soft message and a working Continue button. Nothing returns early
on a failure. A customer at the counter who cannot sign is a worse outcome than
a contract with a typo in it, and `tools/check-sign-page.js` runs the page's
real script against each of those four backends to prove it.

**One parser, and the customer can see its answer.** `normalizeQuoteNo()` lives
in the shared engine and turns `1255`, `qw261255` or `QW-26-1255` into
`QW-26-1255`; anything else comes back `''` and is refused rather than guessed
at. The bare-digit form assumes the current calendar year, which is how both
the page and the server *mint* a quote number, so it is right for anything
issued this season and a guess for anything older. That is why the page writes
the normalized number **back into the input**: `Quote_Number` is read-only on
the Adobe side, so what the customer sends is what they are stuck with, and the
only defence is that they can see it first. The server normalizes with the same
function, so the number shown and the number looked up cannot disagree.

**What the lookup is allowed to say back.** `?action=signlookup` →
`signLookup_`, and it returns a *masked* last initial, the unit description and
the slip. Nothing else — no phone, no email, no address, no totals, no
selections. The reason is the shape of the page: quote numbers are four digits
and this page is public, so anything it returns is returned to anyone who
guesses a number. It is deliberately **not** `?action=load`, which needs a last
name and hands back the whole priced quote. `tools/check-sign-link.js` holds
the response to that key list and fails if it grows one, or if the function
starts reading a contact or money column. The lead tab is skipped: somebody who
poked at pricing and wandered off is not signing a storage agreement.

`signLookupAllowed_` is a soft global throttle — 40 lookups a minute across
everyone, because a free-Gmail web app cannot see a client IP and there is
nobody to limit individually. It is a speed bump against enumeration, not a
security control, and it **fails open**: an unavailable cache lets the lookup
through, since a throttle that stopped customers signing would defeat the page.

**The escape hatch is a real path, not a courtesy.** "I don't have my quote
number" goes straight to the unprefilled form. Somebody at the counter without
their paperwork must never be stuck, and the same link is what a quote number
we could not parse falls back to.

**Deep links.** `sign.html?quote=1255&slip=B-14` fills both inputs in, so a
customer-specific link can be emailed alongside a quote later without building
anything new. It deliberately does **not** auto-continue — the confirmation
step is the whole point of the page.

The page is `noindex`: a QR code on a counter flyer is the only thing that
should ever send anyone here. It links `quest.css` for the Quest palette rather
than carrying its own copy, and holds no Adobe URL and no Adobe field name of
its own — those stay in `SIGNING`, in the engine.


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


## The provisional-pricing banner
`#pricingNotice` sits in `<main>` **above the step nav**, outside every
`.panel`, so it is on screen at every step and cannot scroll away with a
panel — that placement is the requirement, not a detail, and the guard checks
it. `#ticketNotice` is the same disclaimer inside the ticket card, because
`@media print` hides the panels and the banner and keeps only the ticket: the
printed / saved PDF has to carry it too. `applyPricingNotice()` fills both
from the engine at init, and **removes** them from the DOM (not just hides
them) when `pricingNotice()` returns null, so nothing is left for a stylesheet
or a stray `hidden = false` to bring back.

Both containers are empty in the markup on purpose — the wording has exactly
one source (`docs/ref/DATA-AND-MONEY.md`). Same for `#quoteTerms`, whose
paragraph `refresh()` writes on every recompute: a second copy of the terms in
the markup would be the one that goes stale.
