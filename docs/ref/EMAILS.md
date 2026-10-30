# Email

Every rule about what this system sends, to whom, and on whose authority.
The highest-blast-radius area in the project — read all of it before
changing any send path.

*Split out of `CLAUDE.md` so it is read when it is relevant rather than on
every request. The rules are unchanged — this text was moved verbatim, and
`tools/check-docs-coverage.js` fails if any of it goes missing.*

---

## Email builder
`buildEmailFor_(d, kind, extra, photos)` returns `{subject, html, status}` and
is used by **both** `adminEmailPreview` and `adminSendEmail`. Preview must
always be byte-identical to what sends. If you add an email kind, add it to
that builder — not to the send path directly.

`recordEmail_(sh, rowNum, d, kind, by)` must be called at **every** send site
(console, sheet menu, quote page, auto-reminder). It's what powers per-quote
Email History.


## CC and a staff note from the preview window

The console's preview window has a **CC service@** box and a free-text
**note to the customer**. Both travel as one object — the 4th argument of
`emailPreview` and `sendEmail` (5th of `adminEmailPreview` /
`adminSendEmail`) — and both go through `staffExtras_`, so the preview stays
byte-identical to the send. The note is escaped and placed by `withStaffNote_`
directly under "Hi <name>," in either shell; typing re-renders the preview
and **Send** waits until it has. The CC can only ever be `NOTIFY_EMAIL` — a
checkbox, never a typed address. The bulk sample hides both: send-to-all
builds its own mail and takes neither.

## The "pick up your quote" link

**`quoteLink_(quoteNo, lastName)` is the only place this URL is built**, and
`quoteLinkFor_(d)` is its payload-shaped wrapper. Quote number + last name is
exactly what the quote page's own loader asks a customer to type, so a link
carrying both opens that customer's restored quote and nothing else — it
reveals no more than the form already does, and the server's matcher trims and
lower-cases both halves, so a link built from the stored last name always
matches.

Everything that hands the link out goes through that one builder: the quote /
invoice email (`customerEmailHtml_`, as `o.quoteUrl` — "View my quote online",
worded *invoice* once a payment exists), the 10-day auto-reminder, the lead
follow-up ("Finish my quote"), the console's copyable **Customer link** block,
and the sheet menu's *Show customer link*. That is what stops the link staff
read out at the harbor from differing from the one the customer was emailed.

It returns `''` when either half is missing rather than a half-built URL that
lands on an empty quote page — **every caller must hide its button on `''`**,
which is what the console and the email builder both do.


## The "review & sign" link

The sibling of the link above, and it follows the same one-builder rule.
`signUrlFor()` in `pricing-engine.js` builds the Acrobat Sign pre-fill URL;
`signUrlFor_(d)` in the Apps Script is its payload-shaped wrapper. Field names
and the Adobe-side setup: `docs/adobe-webform-field-map.md`.

**Emails never read the stored `SIGN` column — they rebuild the link at send
time.** Two reasons, and both bite:

- **The slip is usually not known when the quote is saved.** Only a Heritage
  Harbor customer types one on the quote page; for everyone else staff enter it
  from the console weeks later, into the manual-ops journal. `signUrlFor_`
  reads it through `effectiveState_`, so the staff correction is what reaches
  Adobe — the same reason the haul-out email reads it that way.
- **Every quote saved so far stored an empty string**, because the web form URL
  is not set yet. Rebuilding means they all get a working sign button in their
  next email the moment `SIGNING.webFormUrl` is filled in, with no backfill.

The stored value stays as a fallback (`signUrlFor_(d) || d.adobeUrl || ''`) so
the sheet still shows where a customer was sent. It returns `''` when the web
form URL is unset, and `customerEmailHtml_` already hides the button and
switches the numbered next-steps line on `''` — so the whole signing step
turns on across every email from that one string.
`tools/check-sign-link.js` fails any email that builds `signUrl` some other
way.


**Every sign button is followed by the "confirm your email" note**
(`signConfirmHtml_()`, wording in `SIGNING.confirm` in the engine). Adobe does
not count a signature until the signer clicks the link in its follow-up
"Please confirm your signature" email, and its own last screen reads like
"done" — customers stopped there. The quote page and `sign.html` say the same
words; `tools/check-sign-link.js` fails a surface that drops them.


## The sign chase (`signreminder`)

"We still need your signature" — the nudge for a quote with no signed agreement
on file. Most often one that has already paid a deposit, which is the pairing
the storage view tags in red (`docs/ref/STAFF-CONSOLE.md`).

- **Staff-clicked, one quote at a time.** Deliberately **not** in `BULK_KINDS_`
  and not on either automatic trigger: whether somebody has been chased enough
  is a judgement call, and a mailshot to everyone without a contract on file
  would reach the customers who signed a paper copy at the counter.
- **It refuses to build rather than ship a dead button.** No `signUrlFor_`
  link — the web form is unset — means no email at all. An "almost there, just
  sign" with nothing to click is worse than saying nothing.
- **A lead is never asked to sign.** No selections, no price, nothing agreed;
  `doPost` already refuses a lead row a customer copy, and this is the same
  boundary on the staff-clicked path.
- **It sets no status.** Every other notice kind stamps the status column, but
  this one says nothing about where the quote is in the money or placement status —
  overwriting `Deposit received` with a chase note would take that off the
  console pill and off the storage sheets somebody is holding. `adminSendEmail`
  only writes `built.status` when there is one. The send still lands in Email
  History, which is what staff read to answer "have we chased this one?".
- **It asks for the slip only when we don't have one**, and only for a water
  unit. `Slip_Number` is left editable on the Adobe side for exactly that
  reason (`docs/adobe-webform-field-map.md`). Land units are *collected*, never
  hauled out of the water — the same `isLandUnit_` wording rule as everywhere
  else.
- **Why a refusal reads the same in preview and in send:** `unbuildableMsg_` is
  shared by `adminEmailPreview` and `adminSendEmail`. Staff who read one
  explanation in the preview and a different one from the send assume the
  system changed its mind.
- `tools/check-sign-chase.js` builds it for every one of those cases and
  asserts what came out; `verify.sh` runs it.


## An imported quote is held back from the automatic reminder

`dailyReminderCheck` sends to any quote with an email address, no payment, no
reminder marker and a timestamp older than `REMINDER_AFTER_DAYS`. **An imported
quote is all four, ten days after it lands.** That email opens "Your Quest
Watersports winter quote is waiting" — so a batch import of last season's
customers would, with nobody's finger on it, send that to several hundred
people who never built a quote.

- **The import writes `IMPORT_HOLD_MARK` into the reminder column**, which is
  the marker `dailyReminderCheck` already honours, so the hold needs no special
  case in the sweep itself.
- **`releaseImportHold_` is called from `recordEmail_`**, not from the console
  path alone: every send site goes through the recorder, so the sheet menu
  clears the hold exactly as the console does — the standing menu/console
  parity rule. It only ever rewrites the hold marker, which is what makes it
  safe to call from the shared recorder; a `Reminder sent …` or a lead marker
  is left untouched.
- **The ten days then run from the send, not from the import.** The release
  writes `IMPORT_SENT_MARK` plus an **ISO** date, and `importSentAt_` parses it
  back. Without that the clock would run from the row's creation date and the
  nudge would arrive the morning after the quote finally went out.
- **An unparseable marker reads as "say nothing".** A corrupt date must never
  become a reason to email somebody.
- `tools/check-season-stamp.js` runs the real sweep over all of these,
  including that an ordinary old quote is still reminded exactly as before.

## A quote marked not storing this season is never chased

Staff can mark a quote **Not storing this season** (`docs/ref/STAFF-CONSOLE.md`).
`dailyReminderCheck`, `leadFollowUpCheck` and every `bulkTargets_` kind skip it
via `notStoringActive_`; the bulk preview lists it as held back with the
reason. The mark lapses on its own when `SEASON.seasonLabel` moves on, so next
season's firm quote reaches them again. A deleted quote needs none of this —
its archive tab fails the `'Quote #'` probe every sweep starts with.

## The automatic-email pause

`AUTO_EMAIL_PAUSED` in Script Properties, flipped from the console (admin only,
☰ → Automatic emails). It stops the **only two emails that send without a
human**: the 10-day reminder and the lead follow-up.

- **Why it exists:** both carry money and both invite the customer to reload a
  quote, which re-prices against whatever rates are live. That is the wrong
  thing to have running across a season rollover, or any window where the prices
  on the page are not the prices we mean.
- **A property, not a constant.** `REMINDER_ENABLED` / `LEAD_FOLLOWUP_ENABLED`
  are the permanent code-level switches and still work; this is the operational
  one, flippable from a phone at the harbor without a deploy. Either being off
  stops a send.
- **A corrupt setting reads as PAUSED.** An unparseable property must fail
  towards sending nothing — the other way turns a broken value into an
  unannounced mailshot. `verify.sh` asserts it, and `check-perms-pause.js`
  executes it.
- **It does not gag the console.** Staff still send invoices and receipts by
  hand, each previewed and clicked; pausing those would stop Quest doing
  business. Send-to-all is likewise still allowed — it is a human click — so the
  standing banner is the thing that stops somebody blasting old prices.
- **The banner shows for everyone, not just admins.** A pause nobody can see is
  a pause somebody forgets to lift. Toggling it is audited and emails `NOTIFY`.
- **Lifting the pause RESTARTS both clocks; it does not resume them.**
  `autoPauseCooldown_` holds the 10-day reminder for a further ten days after
  the pause comes off, and the lead follow-up for a further 24 hours.

  Chris's case, and the one this was built for: the 2026-2027 rate card lands,
  `PRICES` is updated, `provisional` goes false, the season is re-priced and
  everybody is emailed their real quote — then the pause comes off. Without the
  cooldown the next 9am sweep finds a few hundred quotes whose ten days elapsed
  weeks ago and sends the lot, so a customer reads *"here is your updated
  quote"* and hours later *"your quote is still waiting"* about the same quote.

  - **Global, not per-quote.** Restarting only the rows whose timestamp falls
    inside the pause window still lets everything older fire on resume morning,
    which is the blast this exists to stop.
  - **Only a real pause → running transition stamps it.** Clicking "resume" on
    something already running must not buy another ten days of silence, and
    starting a pause clears the last stamp rather than leaving a stale one to
    expire mid-pause.
  - **An unreadable `resumedAt` means no cooldown.** The pause itself fails
    towards silence; this guard must never become the reason a real reminder
    stops for ever.
  - **It is visible.** The resume notice to `NOTIFY` says the clocks restarted,
    the console's pause card carries the same sentence, and the Resume
    confirmation says it before you click — because "running again, but nothing
    until the 29th" looks exactly like a broken reminder to anyone who cannot
    see it.
  - `check-perms-pause.js` executes it: the cooldown at 0, 9 and 11 days, the
    24h lead window inside the 10-day one, a corrupt stamp, and all four pause
    transitions through the real `adminSetAutoPause`.

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
- **A notice's balance box says *when* the money is due, never just "open
  balance."** A bare open-balance line on "We have your boat" read as chasing
  customers for money not due yet. `noticeDueRows_()` splits it: any unpaid
  part of the deposit is **Deposit due now**, the rest is **Balance due by
  <pay-by date>**, and when only the dated balance is left it adds "Nothing is
  due today." No-storage quotes say due when the work is completed; after the
  pay-by date the row reads "was due" and the reassurance line goes.
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


## Send to all

Three kinds and only three — `BULK_KINDS_` is the whole allow-list: `spring` (skips
`No Storage`; nothing to relaunch for a unit we never stored), `fall` (skips
nothing; a No Storage customer still has to get the unit to us) and `firmquote`
(see *The firm quote* below — hand-picked, not a blast). Reachable from
the console with **no quote loaded**, gated on `email`, and from the sheet menu
(the two announcements only; the menu has no picker, so it has no firm quote).

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


## The firm quote (`firmquote`)

*"Is there a pre-set email that says our rates have been updated and here is
your firm quote? … scroll through all quotes and send those firm rates one by
one, or by checking a box next to each person"* — Chris, Sept 2026, the week
before the 2026-2027 rate card.

"Our rates are final — the attached quote is your firm price, unless we
re-measure or you change your selections." Then exactly two ways forward:
**Option 1** opens their own quote on the quote page (`quoteLinkFor_`) to change
anything; **Option 2** accepts it as-is — the sign button (`signUrlFor_`,
dropped when a contract is already on file) and the pay button (deposit, or
balance once something is paid; neither once it is paid in full and signed).
It attaches the PDF and stamps status `Firm quote sent`.

- **`firmQuoteBlocker_` is the whole bar, and it is shared.** The builder, the
  preview, the send, the bulk picker and the console's button all ask it, so
  they cannot disagree about a quote. It refuses — with a reason staff can act
  on — whenever calling the price firm would be false:
  - `PRICING.provisional` is still on. **Nothing can send this until the rates
    are in and the switch is off**, preview included;
  - the quote's season stamp is from the estimate days (`priceStampStale_`) —
    the answer is always the season re-price, which re-stamps it and rebuilds
    the PDF this email attaches;
  - pricing a copy at today's rates gives a different total than the one on
    file (a rate edited after the re-price ran) — the PDF would contradict the
    email;
  - a lead, no priced total, no last name (no link for Option 1), or the one
    `FIRM_QUOTE_NO` quote that already has an agreed price.
- **The re-price offers "re-date only" rows.** A quote whose total did not move
  but whose stamp is from the estimate days is ticked in the re-price like a
  changed one. Otherwise it would keep last season's pay-by date and an
  estimate-bannered PDF, and this email would refuse it for ever.
- **In `BULK_KINDS_`, but not a blast.** `startTicked:false`: the picker opens
  with nobody ticked, and each recipient shows their total, a 💬 if they left a
  note, and **"Already sent …"** if this kind has gone to them before. Quotes
  the bar holds back are listed under the picker with their reason.
- **It reaches imported drafts (`includeImports`)** — they are exactly the
  quotes waiting for it, and `recordEmail_` releasing a draft onto its storage
  tab is the same event as Chris emailing it one at a time. Leads stay out.
- **Sending a draft moves its row**, which shifts every draft below it up one.
  `bulkSendKind_` therefore re-checks the quote number at the remembered row
  before writing, for any kind that reaches drafts, and follows the quote with
  `findQuoteCtx_` if it moved — otherwise the second draft's status and payload
  land on the third draft's row.
- **Sent in batches of 10** (`batch`), each its own call: every send fetches a
  PDF from Drive and Apps Script stops a call at six minutes.
- **Gmail quota.** A free Gmail account's Apps Script send quota is ~100
  recipients a day, and every customer save's service@ notification, every
  receipt and the 9am reminders draw on the same pot — so the send button is
  good for ~25 firm quotes a day. **Create drafts** (next section) is how a
  season's worth goes out in a week.
- `tools/check-firm-quote.js` builds it for every case above and reads the
  answer; `check-bulk-targets.js` pins the picker rules (drafts in for this
  kind only, held-back quotes reported, nobody pre-ticked).

## Drafts instead of sends

*"Can you put all of the bulk sends into my drafts so I can send them
manually? … Having everything in draft and just needing to open and hit send
is absolutely okay."* — Chris, Sept 2026.

Creating a Gmail draft costs nothing against the Apps Script send quota, and
sending one by hand from Gmail runs under Gmail's own, far larger limit. So
the send-to-all picker has a second button, **Create N drafts in Gmail**
(`adminBulkDraft`): the same recipients, the same `buildEmailFor_`, the same
PDF and inline logo — into `questwsottawa@gmail.com`'s Drafts instead of out
of the door. Every draft **CCs `NOTIFY_EMAIL` (service@)** and keeps
`REPLY_TO`, because no notification is sent for a draft and that CC is the
office's copy.

- **A draft is not a send.** Creating one appends an Email History entry with
  `draft: {id, state:'open', subject, status, total, made}` and changes
  nothing else: no status, no reminder-hold release, no Import-tab move.
  `verify.sh` executes it and fails if `recordEmail_` runs on creation.
- **The sweep is what turns it into a send.** `draftSweepCheck` runs at
  **6:30pm Central** (Chris's call — end of the working day) and from the
  console's **Check drafts now** (`adminDraftSweep`). `draftSweep_` reads every
  quote with an open draft, asks Gmail which drafts still exist, and for each
  one that is gone searches Sent for the quote number and compares the
  **exact subject**. Found → state `sent`, the stored status is stamped, and
  `recordEmail_` runs with `by = "<who drafted it> (sent from Gmail)"` — the
  full treatment a scripted send gets, including releasing an imported draft.
- **Gone is not discarded.** Gmail's search index can lag a fresh send, so a
  draft gone from Drafts but not yet in Sent is stamped `missing` and stays
  open; only a sweep more than `DRAFT_MISSING_GRACE_MS_` (~a day) later that
  still cannot find it marks it `discarded`. An unreachable Gmail leaves every
  entry untouched and is reported, never treated as "not sent".
- **Stale drafts are flagged, not fixed.** A draft is frozen when created; if
  the quote's total has changed since, or the customer note was edited after
  it was built (`d.notesAt` newer than `draft.made` — the attached PDF carries
  the old note), the sweep marks it `stale` and both the picker and Email
  History say *delete it in Gmail and re-create it*.
- **One draft per email per quote.** Creating another is skipped ("already
  waiting"), and the scripted send holds back any quote with an open draft
  (`bulkSendKind_` → `held`) — otherwise the customer gets it twice the moment
  somebody opens Drafts.
- **"Already sent" counts only real sends.** An open draft is not one; a
  sweep-confirmed one is. The picker shows *Draft waiting in Gmail since …*
  separately.
- **The sweep sends nothing**, so the automatic-email pause does not apply to
  it. `bulkDraft` and `draftSweep` are POST-only (the sweep can move a row).
- **Why this is not the CLAUDE.md hazard.** "Never create a Gmail draft
  addressed to a customer" is about Claude doing so while testing; this is
  staff ticking each name and pressing a button, and every draft goes through
  the same builder and the same picker rules as a send.
- `tools/check-draft-sweep.js` runs `draftSweep_` and `adminBulkDraft` against
  a fake Gmail and sheet for every case above.

## The provisional-pricing disclaimer rides every customer email
While `PRICING.provisional` is true, `customerEmailHtml_` puts
`pricingNotice()` in a gold box above the money box — on the quote, the
update, the 10-day reminder **and** the receipt. All four can have their total
moved by the coming rate update, so all four say so; a receipt is not an
exception just because it reads like a closing document. `noticeHtml_` carries
the short form only when it actually prints a balance, since those emails are
about a haul-out, not about pricing. Deposit rows come from `lockinCopy()`.

Nothing here writes that wording itself, and nothing should: the flag has to
be able to take it away from every already-built body at once
(`docs/ref/DATA-AND-MONEY.md`).

## The Inbox Review tab — mail in, not mail out

Everything else in this file is about what the system sends. This is the one
place it reads. Customers answer quote emails, mail checks, say they sold the
boat or want an early launch, and those land in **chris@questwatersports.com**
(service@ and questwsottawa@ both forward there, so one mailbox sees all three).
Nobody re-types all of that, so things go unlogged.

**How it runs.** chris@ is on our own mail server (IMAP at `questwatersports.com`, port 993 — the host's published settings),
not Gmail, and Apps Script cannot read IMAP. So a GitHub Action,
`.github/workflows/scan-inbox.yml`, runs `tools/inbox-scan.py` every morning at
6:10am Central in winter, 7:10am in summer (GitHub schedules in UTC, so the
clock shifts with daylight time; both are before the 8am start). To run it any
time, from a phone or a computer: GitHub → Actions → **Scan inbox** → **Run
workflow** (the GitHub mobile app has the same button). The script reads the last 3 days, pulls out the sender,
any quote numbers, dollar amounts and what the message is about (payment,
cancel / not storing, contact change, pickup / launch timing, service
question, signing), and posts that to the backend. `inboxIngest_` matches it
against the quote tabs, by quote number first and then by sender address, and
adds a row to the **Inbox Review** tab, newest first, with a Priority and a
"Why it is here". Staff set **Status** to *Logged* or *No action*.

**AI review.** Keywords cannot read "dropped the check in your box Tuesday", or
Jeff writing "the Hendersons want the pontoon pulled before the 10th". With a
Claude credential set (below), the AI review runs in two passes:
1. **Screen**: Claude Haiku 5.5 (`INBOX_SCREEN_MODEL`) sees the sender, subject
   and first 600 characters of each message, 25 at a time, and drops what is
   clearly unrelated: a Menards flyer, newsletters, vendor pitches, order and
   shipping notices for Quest's own purchases, personal mail. It is told to
   keep anything it is unsure of. A dropped message counts as "nothing to log".
   Mail that names a quote number skips the screen.
2. **Review**: Claude Opus 5.5 (`INBOX_REVIEW_MODEL`, effort low) reads all of
   what the screen kept, six messages a call. It answers in a fixed JSON shape: relevant or not,
what kind (payment, cancellation, contact change, schedule, service request,
signature, staff direction, new customer, question), priority, a one-line
summary, the action to take in the quote system, and the customers, quote
numbers and amounts it is about. The row's **What it says → what to do**
column is that summary and action. The hidden **Reviewed by** column says
`AI` or `Keywords`.
- **Staff mail is read.** @questwatersports.com is no longer skipped, because
  direction from Jeff and the others is half the point. A staff email names
  customers, not addresses, so the backend matches `customer_names` to quotes
  by full name, then by surname alone ("the Hendersons") when that picks out
  three quotes or fewer, and marks the row *Matched by name — check it is the
  right customer*. Only the system's own mail (questwsottawa@) is skipped.
- **The AI's "nothing to log" wins.** No row is made, whatever the keywords say.
- **It is never asked twice.** The scanner first asks the backend (`known`)
  which messages already have an AI review or a person's mark, and sends only
  the rest. The daily run pays for new mail only.
- **Keyword rows get upgraded in place.** A row made by keywords that still says
  *New* is rewritten with the AI's reading when the AI sees that message, or
  removed if the AI says there is nothing to log. A row a person has marked is
  never touched. So the first AI catch-up cleans up the keyword rows.
- **Falls back, never loses.** If a screen call fails, its whole batch goes on
  to review. If a review call fails (no credential, an API error, a usage limit,
  a refusal, a bad answer), its messages fall back to keywords and get another
  try on the next run. Staff mail without an AI review makes no row: keywords cannot tell
  direction from chatter.
- **Email text is data.** Each message goes to the model inside its own
  `<email>` tags, the system prompt says never to follow instructions in one,
  and the answer is held to the schema. Messages share a call, so the worst a
  hostile email can do is mislabel rows in its batch, and a row only asks a
  person to look.
- **Credentials: subscription or API key.** `CLAUDE_CODE_OAUTH_TOKEN` (Chris's
  Claude subscription, made with `claude setup-token`) runs the calls through
  the Claude Code CLI. It has no separate bill and counts against the plan's
  usage limits. The CLI runs from an empty temporary folder, with every tool
  off and no MCP servers, and the emails go in on stdin. Never pass `--bare`:
  it turns off subscription sign-in. `ANTHROPIC_API_KEY` runs the same calls
  through the Python SDK on pay-as-you-go billing. If both are set, the
  subscription is used.
- **Where the mail goes.** Each reviewed message's sender, subject and text
  (the new part, up to 12,000 characters, plus up to 1,500 of the quoted
  original) is sent to Anthropic's API. It is not used to train models under
  Anthropic's commercial terms.
- **Cost.** On the subscription, no bill, only usage, and the screen keeps
  most of the volume on Haiku. On an API key, roughly: the screen is a
  fraction of a cent per batch, and each message Opus reviews is about a cent.
  If about half the mail survives the screen, that is a few dollars a month.
- **The server keeps about two weeks of mail.** The scan reads whatever is
  still there, so the morning run is the only record of anything older. The
  console's catch-up choice is *Everything on the server* (30 days).

**Rules it keeps:**
- **Read-only on the mailbox.** The folder is opened read-only and every fetch
  is `BODY.PEEK`, so nothing is marked read, moved or deleted.
- **Writes one tab, touches no quote.** It never records a payment or sends
  anything. A row is a prompt for a person. The only rows it ever rewrites or
  removes are its own keyword rows still marked *New* (see AI review).
- **One row per message, ever**, keyed by Message-ID (hidden column 15), so
  re-runs and back-scans add nothing twice, and a row a person has already
  marked is never rewritten.
- **The repo and its Actions logs are public.** The script prints counts only,
  never an address, name or subject. Keep it that way.
- **The key is a shared secret, the same pattern as the tracker feed:**
  `INBOX_SCAN_KEY` is in Script Properties and in the Actions secrets, never in
  a file. No key set means the backend answers nobody.
- Amounts and topic words come only from the new part of a reply, above
  "On … wrote:". Otherwise every reply to a quote email would "mention" our own
  balance figure. Quote numbers come from the whole message.
- The system's own mail (questwsottawa@gmail.com) is skipped, and so are
  newsletters and no-reply senders, **unless** they name a quote or
  are about a payment or a signature. A card processor's "you received a
  payment" is exactly what this is for.

**Setup (once):**
1. Apps Script editor → run `setupInboxScan()` → copy the key from the log.
2. GitHub → repo Settings → Secrets and variables → Actions → add three
   repository secrets: `INBOX_SCAN_KEY` (that key), `IMAP_USER`
   (`chris@questwatersports.com`), `IMAP_PASSWORD` (its mail password).
   For the AI review, a fourth secret, one of these:
   `CLAUDE_CODE_OAUTH_TOKEN`, from running `claude setup-token` on a computer
   with Claude Code, signed in with the Claude subscription; or
   `ANTHROPIC_API_KEY` (console.anthropic.com → API keys; put a monthly spend
   limit on it under Billing → Limits).
   Optional variables: `IMAP_HOST` (default `questwatersports.com`),
   `IMAP_PORT` (default 993), `IMAP_FOLDERS` (default `INBOX`, comma-separated).
3. Console → Menu → **Scan inbox** → *Everything on the server* → **Scan now**
   (or Actions → **Scan inbox** → Run workflow with `days` = 30). After that it runs by itself every morning.

**Reviewing in the console, not on the tab.** Menu → **Inbox review** lists
every row still marked *New*, High priority first and then newest first
(`adminInboxList`). Each card shows the sender, subject, the AI's summary and
action, the matched quote with its balance, and the amounts in the email, with
an expandable excerpt. Its buttons:
- **Record payment…** appears when the row reads as a payment on one quote. It
  opens the quote and fills the payment card's Amount (if the email gave one
  figure) and Method (a guess such as *Check (per email Oct 28)*). Chris checks
  them and presses **Record payment** as always, so receipts, the payment lock
  and the journal all work as they do for any payment.
- **Open QW-…** opens each matched quote.
- **Add to staff notes…** opens the quote and appends a dated line from the
  email to the staff note box, unsaved. **Save note** saves it.
- **Find customer** (no quote matched) runs the console search on the name.
- **✓ Logged** / **No action** set the row's Status and stamp **Handled by** /
  **Handled at** (columns 17–18) and the Activity Log (`adminInboxMark`).
  **Show handled** lists those too, each with **Undo**.

While a quote opened from a card is on screen, a strip above it repeats the
email's summary with **Mark logged**, **No action** and **← Back to the list**.
Opening a different quote by hand drops the strip.

**Already applied cards are hidden.** The list is for what was missed. For
a payment or signature row with one matched quote, `adminInboxList` reads that
quote (`findQuoteCtx_`, one cached lookup per quote named) and hides the card
when the quote already covers it (`inboxAppliedOf_`):
- **Payment**: the quote holds a payment of an amount the email names,
  recorded no more than three weeks (`INBOX_PAY_LOOKBACK_DAYS_`) before the
  email, or any time after. A counter payment and the customer's "I paid today"
  email can arrive either way round, but an August deposit is not this week's
  check. If the email names no amount, the card hides only if the quote is
  paid in full with a payment in that window.
- **Signature**: a signed contract is on file (`d.contractUrl`).

This is decided each time the list is read, so a payment recorded after the
scan clears its card. Nothing is written: the row stays *New* on the tab, and
**Show handled** lists it with the reason ("Already on the quote: $412.50
recorded Oct 22 by Chris (Check)") and a **✓ Logged** button. That catches the
rare wrong match, such as two payments of the same amount. The kind comes from
the AI (stored as `AI · payment` in Reviewed by) or, for older rows, from the
summary's wording (`inboxKindOf_`). A bare `AI` row from before the kind was
stored is reviewed once more by the next scan.

**Dockwa messages are Heritage Harbor's, except mechanical work or storage.**
Dockwa is how Heritage Harbor's slip customers message the marina. Chris sees
those messages only in case one lands in the wrong place, and the customers
don't know he does. The scanner tags any Dockwa message ("dockwa" in the
sender, name or subject). Both the screen and the review are told it is
relevant **only** when the customer asks about mechanical or service work or
winter storage, Quest's business sent to the wrong place. Slips,
reservations, the dock, fuel and thank-yous are dropped. The suggested action
is a Quest follow-up ("Quote winterization and indoor storage for…"), never a
reply on Dockwa. Dockwa relays from a no-reply address, so it is exempt from
the robot filter and always reaches the screen. A Dockwa row's Reviewed by
ends `· Dockwa`. Rows reviewed before this rule (Oct 30 2026) and still *New*
are reviewed once more, and removed if they fail it.

**POS+ receipts: only winter money.** POS+ (the register) emails a receipt
for every sale. The scanner tags them (`pos+`, `posplus` or `pospluslogin` in
the sender, name or subject) and exempts them from the robot filter. They skip
the relevance screen: Haiku only reads each one (customer name as printed, the
total paid, method, what was bought). The backend then decides by matching
(`inboxPosMatch_`), with no judgment involved:

| Receipt | Card |
|---|---|
| Name matches a winter customer **and** the amount equals that quote's expected deposit, balance or total | **High**, on that quote |
| Name matches, amount doesn't | **Medium**, "may be a service job" |
| No name match, amount equals the deposit/balance/total of 1–3 quotes | **Low**, on those quotes |
| Anything else, including an amount shared by more than three quotes such as the standard deposit | no card |

A POS card is a payment card, so the already-applied check hides it once that
payment is on the quote. Reviewed by ends `· POS`, and POS rows reviewed
before this rule and still *New* are reviewed once more.

Not built yet: asking the service tracker (QuestWS/servicetracker) whether a
receipt is a service-job payment logged there. The tracker has no
server-to-server read for that. Its only shared-key door is its own read of
this system's winter feed (`WINTER_KEY` / `TRACKER_KEY`), and everything else
needs a staff sign-in. It would need a new key-gated lookup on the tracker's side.

**Adobe Sign's signed PDFs are read.** "Signed and filed" mail often names
nobody in its body, so for Adobe senders only (`adobesign`, `echosign`,
`adobe.com`) the scanner opens the attached PDF with pypdf. Any form fields
(`Quote_Number` above all) and the text of its first six pages are passed to
the review, and a quote number found there matches the quote and skips the
screen. The review is told an Adobe notice is a signed contract: the signer
is the customer, and the action is "File the signed contract on QW-… (Upload
signed copy)". Once it is filed, the card clears itself. PDFs from anyone else
are not opened, and the PDF text never reaches the sheet's excerpt. Without
pypdf, or with an unreadable PDF, the email is handled from its body alone.

**Applying never writes on its own.** The buttons fill in the existing forms
and stop. An AI-read amount is a suggestion. Posting it straight to a ledger,
or sending its receipt, would skip the person who knows whether the check
actually arrived, and every customer email here is a human click. The only
writes are Logged / No action, and they touch the Inbox Review tab alone. Both
calls are Chris only, like the rest of the panel; `inboxList` is a read,
`inboxMark` a write.

**Scan now, from the console.** Menu → **Scan inbox** (also a home tile)
is **Chris only**: it is his mailbox. The server refuses every other sign-in,
admins included (`inboxOwner_`, matching the roster name `INBOX_OWNER_`), and
the console hides the menu item and tile from them. The panel shows how many rows still say *New*, links
straight to the tab, shows the last run, and has a **Scan now** button with a
look-back choice (since yesterday through everything on the server). The button asks GitHub to
start the same workflow early (`adminInboxScanRun`). That needs a GitHub token
in Script Properties; without one the panel says so and the morning run is
unaffected. A second press inside a minute is refused rather than queued, and
every press is written to the Activity Log. Starting a scan is a write
(never GET-able); `inboxScanState` is a read.

Token setup (once):
1. GitHub → your profile picture → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name it `Quest console scan`, pick an expiry (a year is fine; the panel
   says "GitHub refused the token" when it lapses), **Repository access: Only
   select repositories** → `QuestWS/winter-quotes_26-27`, **Permissions →
   Repository → Actions: Read and write**. Generate, copy it.
3. Apps Script editor → **Project Settings** (gear) → **Script Properties** →
   **Add script property**: name `GITHUB_ACTIONS_TOKEN`, value the token. Save.

Testing: `tools/check-inbox-scan.js` (run by `verify.sh`) runs both halves,
the scanner's `extract()` on built messages and the backend's `inboxRowFor_`
on the result. Locally, `python3 tools/inbox-scan.py --dry-run` with the IMAP
variables set prints counts without posting.

