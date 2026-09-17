# Adobe Sign web form — URL pre-fill field map

What the quote tool sends to the Acrobat Sign web form, and what has to be true
on the Adobe side for it to land. Two fields, and the setup for each is a
checkbox that is easy to miss.

The code side is `SIGNING` in `pricing-engine.js` — the web form URL and the
field names both live there, shared by the quote page and the Apps Script so a
customer clicking "sign" on the page and a customer clicking the button in an
email land on the same pre-filled form.

---

## The fields

| We send | Adobe field must be named | Contents | When |
|---|---|---|---|
| quote number | `Quote Number` | `QW-26-1255` | always |
| slip number | `Slip Number` | `B-14` | only when the unit is in a slip |

**Those names contain a space**, because that is how the fields are named in
the live web form. The parameter key is percent-encoded on the way out, so the
link reads `#Quote%20Number=QW-26-1255` — a raw space is not a valid URL and
email clients each guess differently about where it ends. If a field comes back
blank on a live test, renaming both sides to `Quote_Number` / `Slip_Number` is
the fix Adobe itself recommends; it is one line in `SIGNING.fields` plus a
rename in the authoring tool.

The slip is left out of the URL entirely when we don't have one, rather than
sent empty. An empty value would blank a field somebody may have filled in on
the Adobe side; an absent one leaves it alone.

The **names in that middle column are the contract.** They are the field names
in the Acrobat Sign authoring tool, and they must match what is in
`SIGNING.fields` character for character, including case and the underscore.
Rename a field on either side alone and Adobe does not complain — it silently
leaves the field blank, forever, on every contract. There is no error to find
later. `tools/check-sign-link.js` holds this file and the engine to the same
names so the two cannot drift, but nothing outside the repo can check the
Adobe side. **Send yourself one test link after any rename.**

---

## One-time setup in Acrobat Sign

For each of the two fields, in the web form authoring tool:

1. Add or select the text field.
2. Name it exactly as the table above spells it — `Quote_Number`,
   `Slip_Number`.
3. Open the field's properties and check **"Default value may come from URL."**
   Without this the pre-fill is ignored and the field just stays blank.
4. **Read Only.** Right for `Quote Number` — it is our reference back to the
   row in the sheet, and a customer "fixing a typo" in it costs us the link
   between the signed contract and the quote.

   **`Slip Number` is currently read-only too, and that is worth a second
   look.** We only have a slip to send when the customer entered one for the
   Heritage Harbor discount, or when staff filled one in from the console. For
   most quotes at signing time we have neither, so the field arrives blank —
   and read-only means the customer cannot fill it in either. A blank locked
   box on a contract invites the phone call we built this to avoid. Leaving it
   editable costs nothing: when we do send a slip it still arrives pre-filled,
   and when we do not, the one person who definitely knows it can type it.
5. Save and publish the form, then copy the published web form URL.

That URL goes in `SIGNING.webFormUrl` in `pricing-engine.js` — **it is already
set** to the live form (`wid=CBFC…642eshIU*`, note the trailing `*`, which is
part of the id). Replacing it means editing that one line, running
`node tools/sync-engine.js`, committing both files, and deploying the Apps
Script. Emptying it puts the "signing almost here" placeholder back and drops
the sign button out of every email — it is the one switch for the whole signing
step, page and email together.

---

## The URL we build

Emailed button — opens the form directly:

```
https://na3.documents.adobe.com/public/esignWidget?wid=CBFC…U*#Quote%20Number=QW-26-1255&Slip%20Number=B-14
```

Quote-page iframe — same link plus `hosted=false`:

```
https://na3.documents.adobe.com/public/esignWidget?wid=CBFC…U*&hosted=false#Quote%20Number=QW-26-1255
```

`hosted=false` is what Adobe's own iframe snippet carries: it tells the widget
it is embedded in someone else's page rather than sitting on an Adobe-hosted
page of its own. `signUrlFor({…, embed:true})` adds it — the quote page passes
that flag, the server never does, because an emailed button opens the form
directly. It goes **before** the `#`, like every other query parameter.

- Pre-fill rides the **fragment (`#`)**, not a query string (`?`). The web form
  URL usually already has a `?wid=...` on it; the `#` goes after all of it.
- Multiple fields are joined with `&`.
- Values are URL-encoded — a slip written `Dock B / 14` goes over as
  `Dock%20B%20%2F%2014`.
- Anything already after a `#` on the configured URL is dropped rather than
  appended to, so pasting a URL that carries its own fragment cannot produce
  two of them.

`signUrlFor()` in `pricing-engine.js` builds this and is the only thing that
does. It returns `''` when the web form URL is unset or there is no quote
number, and every caller treats `''` as "no signing link" — which is what keeps
the placeholder up and the email button hidden.

---

## Why the server rebuilds the link instead of storing it

Column S (`SIGN`) on each quote tab holds the link as it stood when the quote
was saved. Emails do **not** read it. `signUrlFor_()` in the Apps Script builds
a fresh link at send time, because:

- **The slip usually is not known at save time.** The customer only enters one
  through the Heritage Harbor discount; for everyone else staff fill it in from
  the console weeks later, into the manual-ops journal. `signUrlFor_` reads it
  through `effectiveState_`, so a staff correction is what reaches Adobe.
- **Every quote saved before the web form existed stored an empty string.** The
  moment `SIGNING.webFormUrl` is filled in, those quotes get a working sign
  button in their next email with nothing to backfill.

The stored value is still written on save, and still used as a fallback, so the
sheet shows where a customer was sent.

---

## Adding a third field later

One line in `SIGNING.fields`, one line in `signUrlFor()`, one row in the table
above — `tools/check-sign-link.js` fails if you do two of those three. Only
**text** fields pre-fill this way — checkboxes, dropdowns and radio groups
ignore URL defaults and need their own handling.

Note what is deliberately *not* sent: the selections and the totals. The
agreement is a contract, not a restatement of the quote, and the numbers travel
on the quote PDF that rides along with it. Pricing that appears in two places
is pricing that can disagree — and the quote is re-priced on reload, while a
signed PDF is frozen.
