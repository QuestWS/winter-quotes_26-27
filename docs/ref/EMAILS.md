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
  one, flippable from a phone in the yard without a deploy. Either being off
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


## Send to all

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
