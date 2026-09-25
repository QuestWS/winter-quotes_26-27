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
`penalties` and `hho` (the slipholder discount approval, re-applied by
`recomputeTotals_`; `docs/ref/STAFF-CONSOLE.md` § *Heritage Harbor slipholder
discount*)

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
The slipholder discount (`m.hho`) journals too, and is re-applied by
`recomputeTotals_` rather than by the replay.


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


## Provisional pricing — a deposit holds a space, not a price
`PRICES` in the Annual Update Zone still holds **2025–2026** rates, so every
figure this system produces is an estimate until the 2026–2027 rate card
lands. `PRICING.provisional` in that same zone is the only switch for it.

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
