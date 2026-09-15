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
