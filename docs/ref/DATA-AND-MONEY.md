# Data, pricing state and money

How a quote is stored, how staff changes survive a customer save, and the
rules money obeys. Read this before touching the payload, the sheet layout,
pricing replay, payments or balances.

*Split out of `CLAUDE.md` so it is read when it is relevant rather than on
every request. The rules are unchanged — this text was moved verbatim, and
`tools/check-docs-coverage.js` fails if any of it goes missing.*

---

## The spreadsheet is the source of truth
One tab per storage location (Inside, Premium Inside, Outside, No Storage,
Golf Cart, E-Bike). One row per quote. A quote **moves tabs automatically**
when storage changes, and stale copies on other tabs are swept on every save.

**Column order is defined once, in `const COL`.** Never hardcode a column
number anywhere. Quote # deliberately sits at column 3 — `findQuoteRow_()` and
several tab-detection checks (`getRange(1,3).getValue() !== 'Quote #'`) depend
on it. Changing that constant means auditing every sheet-scan loop.

Full quote state lives as JSON in the **Payload** column. That's what makes
reload, re-price, adjustment replay, and year-over-year rollover possible.


## The manual-ops journal — read this before touching pricing
`d.manual = { removed[], edits[], priced[], adjustments[] }` — plus `measured`,
`services` (menu services staff added or took off from the console, laid over
`d.state` by `effectiveState_` and priced by the engine; `docs/ref/STAFF-CONSOLE.md`
§ *Adding or removing services*), `penalties` and `hho` (the slipholder
discount approval, re-applied by `recomputeTotals_`; `docs/ref/STAFF-CONSOLE.md`
§ *Heritage Harbor slipholder discount*)

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
PRICE DRIFT. The server's figure is the one that gets stored. It fails open
— a payload with no `state` (older quotes) keeps the old behavior exactly.

**Any new staff-side mutation must journal itself**, or it will vanish on the
next customer save. Mutations that already journal correctly: line edits,
deletes, priced quote-requests, adjustments, late fees, and the season-done
survey's late-retrieval surcharge (`applySeasonDone_` adds/removes it via
`m.adjustments`). Any dimension-repricing work must follow the same pattern.
Console-added services (`m.services`) and penalties (`m.penalties`) take the
other route: they are not replayed onto the lines, they are laid over the
state the lines are built *from* (`effectiveState_`), so the engine prices
them and a re-price moves them with the rate card.
The slipholder discount (`m.hho`) journals too, and is re-applied by
`recomputeTotals_` rather than by the replay.

**A priced request is not money until the customer accepts it.** Each
`manual.priced` entry carries a `status` (`OFFER_STATES` in the engine):
`pending`, `call`, `declined` or `accepted`. Only `offerOnQuote` entries — an
accepted one, or one with **no** status, which was priced before approvals
existed and has been a line all along — are replayed as lines. The others still
close the open request (they have a price) but stay out of `d.lines` and the
total. Page and server ask the engine the same question. `offerDecide_` moves
one between states and edits `d.lines` to match; it is idempotent. On a
customer save the server's `manual.priced` replaces the browser's copy, because
only the server ever writes it. Detail: `docs/ref/STAFF-CONSOLE.md` § *Quoted
items*.


## Payment lock
Once `d.payments` is non-empty:
- The customer page goes read-only (gold banner, inputs disabled, "Invoice").
- The **server** enforces it too: a locked save keeps the official payload and
  adopts only incoming `status` / `payMode`. A stale browser tab cannot
  overwrite a paid quote.
- Terminology flips Quote → Invoice everywhere via `docTerm_(d)`.


## Signed balances
Balance is `total − paid`, **never clamped**. Negative = credit due to the
customer, and it must render as such in the sheet, PDF ledger, emails, and
page ticket. Refunds are recorded as **negative payments** — payments are an
append-only ledger, never deleted.

**`d.priceLog`** is the quote's price history: `{ at, total, was, paid, why }`
appended by `notePriceChange_` whenever the total moves (capped at the newest
80). Append-only, staff-side, and carried across a customer save like the
Harbor Haul Out log — it is what the console's **Quote history** card reads
first (`docs/ref/STAFF-CONSOLE.md` § *Quote history*). It records; it never
prices, and nothing renders from it for a customer.

A ledger entry is `{ amt, method, date }`, and since Oct 2026 also `at` (ISO
time) and `by` (staff name, or `Sheet menu`). `date` is unchanged because the
PDF ledger and the emails print it; `at`/`by` exist for the console's
**Receivables** list, which orders by `at` and falls back to `date` for older
entries (`paymentWhen_`). Never backfill them — an old payment's time is not
known, and inventing midnight would put it in the wrong order.


## Provisional pricing — a deposit holds a space, not a price
`PRICES` in the Annual Update Zone holds the **2026–2027** card (loaded Oct
2026) and `PRICING.provisional` is **false**, so quotes are firm. For the
2026–27 season up to then, `PRICES` held 2025–2026 rates and every figure
was an estimate; whenever that happens again, `PRICING.provisional` in that
same zone is the only switch for it.

While it is true, three engine helpers supply every word of it and nothing
else may:

| Helper | Supplies |
|---|---|
| `pricingNotice()` | `heading` + `body` for the page banner and the boxes at the top of the PDF and every customer email; `short` for the live ticket, the PDF fine print and any notice email that prints a balance. Returns **null** — not an empty string — once pricing is current, so a caller that forgets to check renders nothing rather than an empty box |
| `lockinCopy()` | Every phrase that promised something was being locked in: the sign step's heading, the ticket and PDF deposit rows, the email deposit row, both pay-step options, the "signing almost here" placeholder, and the extra sentence on the retrieval-window confirmation |
| `pricesValidSentence(payBy)` | The fine-print sentence about whether paying holds a price. Takes the quote's own pay-by date when it has one, so an old quote keeps the date it was quoted under |

**A deposit reserves a storage space and a place in the retrieval order. It
does not hold a price.** That is the whole point of the wording, and it is why
`lockinCopy()` exists rather than a search-and-replace: at the rollover the
lock-in language has to come back, and it comes back from one function.

The payload records `season.pricingProvisional` and `season.ratesLabel` so a
quote saved under provisional rates can be told apart later. **Nothing renders
from them** — the page, the PDF and the emails all read the live engine flag,
which is what makes the disclaimer vanish everywhere from one edit, including
from a PDF regenerated for an old quote.

## The season stamp — the dates a quote prints
`d.season` holds the dates the quote was written under: the PDF's totals block
reads `payByShort`, its fine print reads `payBy` and `lateStart`, and
`pricesValidSentence()` takes `payBy` so an old quote keeps the terms it was
quoted under.

**It is built by `seasonStamp()` in the engine, and nowhere else.** Three paths
write it and they have to write the same shape: the customer page on every
save, `adminImportApply`, and `adminRepriceApply`. It used to be assembled
inline on the page, which was true while a customer save was the only way a
quote came into being — and that is exactly how two bugs got in. An imported
quote had no `season` at all, so its PDF printed "Total — … by " and "a service
charge beginning " with nothing after them. A re-priced quote kept last
season's dates against this season's prices.

**A re-price re-dates as well as re-costs.** `adminRepriceApply` re-stamps from
the live constants, deliberately overriding `pricesValidSentence`'s habit of
keeping the quote's original date: that habit exists so an *old* quote keeps
what it was quoted under, and it stops being the right answer the moment we
re-price that quote into a new season. `tools/check-season-stamp.js` runs the
real re-price over a quote carrying a 2019–2020 stamp and asserts the dates
moved.

## Quote numbers cannot collide
Every write path finds a quote **by its number**: `saveQuoteRow_` overwrites
the row `findQuoteRow_` returns, and `savePdf_` replaces the Drive file whose
title carries it. So a duplicate number is not a clash anybody notices — it is
one customer's row and PDF silently replaced by another's.

Numbers used to be four random digits drawn on the page against nothing: 9,000
slots, no check. That held while quotes arrived a few a day and stops holding
the moment a batch is created at once — importing a couple of hundred of last
season's customers is about a 90% chance of at least one collision.

- **`uniqueQuoteNo_(proposed)` is the only minter**, and it checks two things:
  the Quote # column of every quote tab, and the numbers **reserved** in the
  last `QNO_RESERVE_TTL_MIN_` minutes by customers still filling in the form.
  It reads the Quote # column only — never the payload, which is kilobytes a
  row and is what made the storage view time out.
- **Existing numbers are never rewritten.** Minting reads; it writes no cell.
- **The page cannot mint safely on its own** — it cannot see the sheet, and its
  save POST is `no-cors`, so it cannot be told a corrected number afterwards.
  It therefore asks for one at the contact gate (`reserveQuoteNo_`, alongside
  the resume check) and **fails open** to the old local draw if that call does
  not come back. A customer is never blocked from quoting by a slow backend.
- **A full four-digit space widens to five** rather than failing;
  `normalizeQuoteNo` already accepts 3–5 digits on both sides, so a wider
  number round-trips everywhere without any other change.
- `tools/check-quote-numbers.js` executes all of it against a sheet holding
  8,991 of the 9,000 four-digit numbers.

## Which Drive folder a quote's paperwork is filed in
**A quote is filed under the season whose rates it is actually priced at**, not
by the calendar. While `PRICING.provisional` is true every quote we hand out is
an estimate at last season's numbers, so it belongs in last season's folder —
except one we negotiated a real 2026-2027 price for, which is a current quote
and files under 2026-2027 today.

- **`QUOTE_RATE_OVERRIDES` decides it.** That table is already the record of
  "we agreed a price for this one in real money", so `quoteRateSeason_` reads
  it rather than a second flag somebody has to remember to set.
- **At the rollover it resolves itself.** `provisional:false` makes every quote
  current, and because `saveQuoteRow_` regenerates the PDF on every write, the
  season re-price re-files the whole season. Nothing to move by hand.
- **`Winter Quotes 2025-26` keeps its short spelling.** It exists, it holds a
  season of PDFs and its URLs are on the sheet, so renaming it would break
  every stored link. `2026-2027` onwards uses the long form, matching the
  spreadsheet and the season labels. `SEASON_FOLDERS_` maps the exceptions and
  an unlisted season still gets a sane long-form folder.
- **The season labels use an EN DASH and folder names use a hyphen.**
  `seasonFolderName_` normalises first — without it, `2025–2026` would miss the
  table and quietly create a second, near-identically-named folder.
- **Looking something up sweeps every season folder; filing it does not.** A
  quote that changed folder must still be findable in the one it came from, or
  an email goes out with no PDF and nothing says so. `savePdf_` likewise bins
  prior PDFs from *all* of them, since one quote with two PDFs carrying
  different totals is worse than none.
- **A photo folder that exists is reused by its stored id**, never by
  re-deriving the path — otherwise a quote changing season would get a second,
  empty folder while this unit's photos stayed in the old one.
- **The pre-restore snapshot belongs to the season, not a quote**, so it stays
  on `getFolder_()`, which now follows the current season automatically.
- `tools/check-season-folders.js` executes all of it, including the rollover.

### The 2026–2027 rollover (Oct 2026)
Loaded from Chris's *2026-27 Winter Services Menu & Terms* sheet: `SEASON`
dates (storage Oct 15 2026 – Apr 15 2027, pay by Nov 15 2026, service charge
from Dec 1 2026), every `PRICES` line on the card, `provisional:false`.
**Not on the card, so unchanged from 2025–26:** e-bike storage, jet-ski
detail, acid washes, the impeller "starting at" figure, the Heritage Harbor
tiers. Blocking is still one $194 line, so `blocking` and `blockingPontoon`
both carry it. Existing quotes keep their 2025–26 figures until the console's
**Season re-price** runs; then the **Firm quote** goes out.

### At the rollover
1. Update `PRICES` (and `SEASON`) in the Annual Update Zone.
2. Set `PRICING.provisional:false` **in the same commit**.
3. `node tools/price-fixtures.js` and re-baseline deliberately — money moved,
   so the diff must say so.
4. `node tools/sync-engine.js`, then `bash tools/verify.sh`.
5. Re-price the season from the console (Season re-price) so existing quotes
   carry the new rates; discounts survive that, `check-reprice.js` proves it.

`tools/check-pricing-notice.js` runs both halves for real: it renders the PDF
and the emails with the flag true and asserts the disclaimer is there, then
patches the flag to false in a copy of the source and asserts every trace of
it is gone and the lock-in wording is back. It also fails if any surface grows
its own copy of the wording — a hardcoded disclaimer would still be telling
customers about 2025–2026 estimates next spring.

## Synchrony financing and the admin fee

Chris, Nov 2026: Quest is a **Synchrony Sport** merchant, and customers should
be able to *"apply and pay from this email"*, with a fee per term — approved
by the owner and **titled "Admin fee"** everywhere a customer sees it.

- **One table, `FINANCING` in `pricing-engine.js`** (embedded in the `.gs` like
  the rest of the engine): the apply link, the fee label, each term's months,
  plan wording and percentage, and the disclosure printed under the options.
  `financeQuote(amount, key)` / `financeOptions(amount)` are the only math.
- **The fee is grossed up:** total = amount ÷ (1 − pct), so when Synchrony
  takes its cut Quest nets the true amount. $1,000 at 12 months is $1,044.39.
  `tools/check-finance.js` holds every row of Chris's table to the cent.
- **The card fee is NOT grossed up, on purpose.** POS+ passes it straight to
  the customer, so `RULES.ccPct` stays a true 3% on top ($1,030.00 on $1,000).
  The older fee sheet that shows $1,030.93 predates POS+.
- **`applyUrl` empty turns all of it off** — the email button, the page and the
  POST — the same way an empty `SIGNING.webFormUrl` turns off signing.
- **The flow** (no Synchrony API; that is on the back burner — Chris, Nov 2026):
  1. The last-call email's *Pay over time with Synchrony* button (only when something
     is owed) opens `finance.html?quote=…&ln=…`; the server prices every plan
     on the balance owed **now** (`financeRead_`).
  2. The customer picks a plan. **No account yet:** *Apply for Synchrony* opens
     the Synchrony Sport application in a **new tab** (step `apply`, noted
     quietly — Synchrony tells the dealer about approvals itself); they come
     back to the same link once approved.
  3. **Have an account:** they **authorize** — name and phone as on the account,
     a tick box over the exact sentence (`FINANCING.authText` via
     `financeAuthText`: amount, plan, admin fee, disclosure to sign in person)
     and their typed name. Stored word for word as `d.finance.auth`; service@
     gets **READY TO CHARGE** with the lookup details (`notifyFinanceAuth_`).
  4. Staff look them up in the Business Center by **Name & Phone Number**, run
     the sale, and enter the **approval code** in the console's payment card:
     `adminFinanceCharge` adds the admin fee line, records the payment
     (method `Synchrony 12 months — approval …`), saves once, emails the
     receipt.
  5. The **rate disclosure** is then flagged at the top of the quote
     (`d.finance.disclosure`: `needed` → `digital` → `inperson`,
     `adminFinanceDisclosure`) until they sign in person — customers come in
     whenever suits them, so the flag lives on the screen whoever is at the
     counter opens. Not on the search list: that reads only the light columns,
     and reading every payload to tag it is what made the console slow.
- **Where the *Pay over time with Synchrony* button appears:** the last-call email,
  every invoice email (`customerEmailHtml_` — the console's re-send, every
  quote/invoice/receipt the system sends, and the 10-day reminder), and the
  late fee warning. All of them ask `financeOfferUrl_(d)`, so they agree: no
  button when nothing is owed (paid up, a credit), when the plan is settled
  (charged, or authorized on today's balance), for a lead, or with financing
  off. Authorized on an *old* balance is offered again, to re-authorize.
- **Follow-ups: applied, never authorized** (Chris, Nov 2026). Our Synchrony
  access cannot see application status (sandbox only, no *Partner* APIs), so
  the follow-up is staff-informed:
  - Clicking *Apply* puts the quote in a small index (Script Property
    `FIN_APPLIED`: quote → name, phone, plan, when — customer details in
    Script Properties, never in the repo). ☰ → **Synchrony follow-ups**
    (`adminFinanceFollowups`) lists everyone in it for **a day or more**,
    oldest first, reading only that index — never the quotes.
  - Staff check the Business Center (Name & Phone Number), open the quote and
    send one of two previewed emails (kind `finfollow`, `extra` picks):
    **approved** — "one step left", straight to the authorize step with their
    plan picked (`finance.html?…&plan=…&go=auth`); **notyet** — "still want to
    finance?", the finance link or pay another way. Neither ever says
    *declined*. No status set; `finFollowBlocker_` is the shared bar.
  - Off the list on authorize, on a recorded charge, or **Not financing**
    (`adminFinanceDismiss`); applying again puts them back. A corrupt index
    reads as an empty list.
- **Never an account number, never an SSN.** The Business Center's *Name &
  Phone Number* lookup is enough, so we hold no card data (and stay out of
  PCI scope). `tools/check-finance.js` fails a page that asks for either.
- **The disclosure form** (`FINANCING.disclosureForm.url`) is an Adobe
  Sign web form for a digital copy on file until the in-person signature;
  empty hides it everywhere. It pre-fills `Quote_Number`, `Finance_Plan`,
  `Finance_Amount` from the link — those names must match the form's fields
  exactly, or the fields are silently blank.
- **The charge refuses rather than guesses:** no approval code; the balance
  moved since the authorization (the console marks it *stale* — they
  re-authorize at the same link, or staff tick **Authorized by phone**, which
  is recorded as such); or already recorded (a second press would double the
  payment).
- **Picking a plan or authorizing changes nothing on the quote.** Only the
  recorded charge adds the fee — one Adjustments line in the manual journal,
  so a re-price replays it. Once charged, changing plans is a phone call.
- **Same safety as the quotes page:** read by GET with quote number + last
  name (`offersCtx_`, one error for any miss), chosen by POST only (a link
  scanner can never act for anybody), stamped `_api:'finance'`, idempotent
  (the same authorization again emails nobody).
- **The API, on the back burner:** the developer portal's Getting Started
  pages (Nov 2026) show OAuth client credentials against `api.syf.com`, 60-minute
  tokens, staging at `api-stg.syf.com`, and a production certification review;
  no client certificate or fixed IP. Still unknown until Synchrony grants
  *Partner* API visibility: whether Digital Buy is available for the Synchrony
  Sport merchant number, and whether its calls need JWE encryption (Apps
  Script has no RSA-OAEP built in).
