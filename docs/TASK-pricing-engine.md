# TASK: Pricing-engine extraction + dimension editor

This is the current priority and the reason the project moved to Claude Code.
Read `CLAUDE.md` in full first — especially §3 (editing discipline), §4
(architecture/invariants), and §8 (this task's summary). Do this as a sequence
of small, verified commits, not one big change.

---

## Why

All dimension→price logic lives **only** in `index.html`'s
`computeLinesRaw()`. The Apps Script backend has never had it. Because of that,
staff can *see* a unit's dimensions on the console but can't remeasure and
reprice — the server has no way to recompute shrinkwrap-per-foot, storage tier
by beam, wash-by-area, blocking, retrieval tiers, or the beam>8.5 no-trailer
rule.

Chris chose the clean fix over the quick one: **one shared rule set that both
the page and the server read**, so the two can never drift. Not a server-side
mirror of the rules that has to be kept in sync by hand.

## The seam that makes this possible

Every dimension-driven line already stores its own formula. A line looks like:

```js
{ sec:'Shrinkwrap', label:'Shrinkwrap package (24)', amt:425, calc:'...', desc:'' }
```

`calc` is the recipe, `amt` is the result. The engine already knows *how* each
number was derived, not just the total. That's what makes a faithful
server-side recompute achievable.

## Where the logic lives right now (read these first)

In `index.html`, inside the `<script>`:
- `const SEASON` — dates/labels (Annual Update Zone, top of the script).
- `const PRICES` — every rate.
- `const RULES` — thresholds (`acidBeamMax`, `insideBeamMaxNT:8.5`,
  `hhoMinTotal`, `retrieveSmallMaxLOA`, deposits, percentages).
- `computeLinesRaw()` — the engine. Pure-ish already: reads `S` (state),
  returns `{L (lines), need (missing-input prompts), rq (quote-requests)}`.
- `wrapAuto()` — shrinkwrap sub-calc it calls.
- `LEVEL_DESC`, `BOAT_ENGINES`, `QUOTE_ITEMS` — data tables it references.

On the server (`quote-logger-apps-script.gs`), the manual-ops journal
(`applyManualOps_`, `reconcileManual_`, `recomputeTotals_`) already replays
staff changes on top of whatever base lines exist. Today the *base* lines come
from the page. After this task, the server can regenerate them itself.

---

## Sequenced plan — each step is its own commit, each ends with verify

### Step 1 — Extract into a shared, DOM-free module
Create `pricing-engine.js` containing `SEASON`, `PRICES`, `RULES`,
`LEVEL_DESC`, `BOAT_ENGINES`, `QUOTE_ITEMS`, `wrapAuto`, and a pure
`computeQuote(state)` that is exactly today's `computeLinesRaw()` logic with
**no DOM access** — it takes a plain state object and returns
`{lines, need, rq}`. No `document`, no `$`, no globals beyond what's passed in.

Do not change any number or rule. This step is pure relocation.

### Step 2 — Page reads the shared module; prove identical output
Refactor `index.html` to load `pricing-engine.js` and call `computeQuote(S)`
instead of the inline `computeLinesRaw()`. Delete the now-duplicated inline
copy.

**Pass/fail gate:** the page must price **identically to the cent** for a set
of test quotes, before vs. after. Build several (a twin-engine inboard boat
with shrinkwrap + acid wash + inside-on-trailer storage; a non-trailered boat
over 8.5' beam; a jetski with inside storage; a golf cart; an e-bike). Capture
totals before the refactor, then after, and diff. Any difference means the
extraction is wrong. Show Chris the before/after.

GitHub Pages can load a second local `.js` file fine (`<script
src=\"pricing-engine.js\"></script>`). Keep it a plain global-exposing script or
a tiny module — whatever keeps the page working without a build step. **No
bundler, no npm build** — this repo deploys as static files.

### Step 3 — Give the Apps Script the same engine + drift alarm
The `.gs` needs to run `computeQuote`. Two viable ways:
- Paste the shared engine's contents into the `.gs` as well (kept identical by
  a verify check that diffs the two), or
- Keep the engine as one canonical block and have `verify.sh` assert the `.gs`
  copy matches `pricing-engine.js` byte-for-byte.

Either way, **verify must fail if they diverge.** That check is the whole point
of \"one rule set.\"

Then, at save time (`doPost`) and on any server recompute, compare the server's
`computeQuote(state).total` against the total the page saved. On mismatch,
note it on the row and email `service@` — a permanent tripwire for drift.

### Step 4 — Dimension editor on the console
Now the feature Chris actually asked for. In `admin/index.html` + new server
endpoints:

- **Edit raw dimensions** (LOA, beam, LWT, jetski L/W as applicable). Editing
  updates `d` state, re-runs `computeQuote` server-side, and produces a
  **before/after line diff** (what changed, old→new amount, new total).
- **Require confirmation before dollars move.** Show the diff, Chris confirms,
  then it writes. Remeasuring must never silently change money. Journal the
  reprice so it survives customer reloads (see `CLAUDE.md` §4).
- **Beam-oversize flag:** if the edited beam exceeds the storage area's limit
  (`RULES.insideBeamMaxNT` etc.), show a clear warning — \"Beam 9.2' exceeds
  Inside limit (8.5'); discuss relocation with the customer.\" **Do NOT
  auto-move storage.** Chris was explicit: that's a customer conversation.
- **Move storage location:** a dropdown to reassign the storage tab. Reuse the
  existing tab-move mechanics (a quote already moves tabs when storage changes
  on save; this is the manual equivalent). The row physically moves.
- **\"Your dimensions have been adjusted\" email:** premade, branded, previewable
  like every other console email. Add it as a kind in `buildEmailFor_(d, kind,
  ...)` so preview and send stay byte-identical (`CLAUDE.md` §4). It should
  attach/point to the updated quote/invoice and briefly explain what changed.

---

## Guardrails specific to this task

- **Prove-identical is non-negotiable** at step 2. If you can't show matching
  totals, stop and escalate rather than ship a \"probably fine\" refactor.
- **No build step.** Static files only. A second `.js` is fine; a toolchain is
  not.
- **Journal every reprice and every manual dimension change**, or it vanishes
  on the next customer save.
- **Confirmation gates any dollar movement** from a remeasure.
- **The beam flag never auto-relocates.**
- Keep menu ↔ console parity in mind — if the sheet menu should also be able
  to remeasure, add it there too (or note the deliberate asymmetry).
- Run `tools/verify.sh` (updated for this task) before declaring any step done,
  and show Chris the output.

---

## When to hand back to a chat session

Per `docs/ESCALATION.md`: if a wording decision, a customer-facing design
choice, or a \"which behavior does Chris actually want\" question comes up
mid-build, that's a chat conversation, not a Claude Code guess. The email copy
for \"Your dimensions have been adjusted\" is a likely candidate — draft it, but
let Chris approve the wording.
