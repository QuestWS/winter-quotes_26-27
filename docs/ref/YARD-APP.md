# The yard app

`yard/index.html` — the haul-out list as something you open on a phone,
standing next to the boat. Installable (Add to Home Screen), PIN-gated,
and deliberately narrow.

*Detail for `yard/index.html` lives here rather than in `CLAUDE.md` so it is
read when it is relevant. `tools/check-docs-coverage.js` fails if any of it
goes missing.*

---

## What it is for

Two lists, because the yard asks two different questions on the same day:

| Tab | Shows | The question it answers |
|---|---|---|
| **To pull** | every unit with a **slip number**, in requested-timing order | which boats are coming out of the water, and in what order |
| **All storage** | everything we store, grouped by building | where does this one go once it is on the trailer |

Chris's words for why it is two and not one: *"boats to pull which is just slip
numbers so boats literally being pulled, and then all storage boats so they can
figure out which storage the boat goes in."*

A slip number is the whole test for the pull list — a unit with no slip is not
in the water, so there is nothing to pull it out of. A **whitespace-only** slip
is not a slip; `check-yard-app.js` pins that, because `' '` is what a cleared
field can leave behind and it would put a trailered boat on the water list.

Lead rows never appear on either list. A quote nobody finished is not a unit
we are holding.

---

## THE APP DECIDES NOTHING ABOUT PULLING

Whether a unit may be touched is **the server's answer** (`haulAuth_` in the
`.gs`), stamped onto every storage row and rendered here. It is not recomputed
on the phone.

That rule now has three readers — the staff console, the printed haul-out
sheet, and this app. A copy per reader is a liability rule free to go stale on
two of them, and the one that goes stale is the one that clears a boat nobody
signed for. So there is exactly one copy, on the server, and
`tools/check-yard-app.js` fails if this page looks like it is working the
verdict out from `contract` and `deposit` itself.

- **An unstamped row reads as BLOCKED**, on the phone and on the console
  alike. A row with no `auth` on it means an older backend or a cache entry
  written before the deploy — and defaulting the other way would let a
  deploy-ordering accident authorise pulling boats nobody signed for. It fails
  towards not touching the boat, and that fallback is asserted on both clients.
- **The verdict is the first thing on the detail screen**, above the phone
  number, in words rather than a colour: `CLEARED TO PULL`, the hold stamp, or
  `DO NOT TOUCH — NOT AUTHORISED`. The rules themselves live in
  `docs/ref/STAFF-CONSOLE.md` § *Nothing is pulled unless it is BOTH signed and
  paid*.

---

## The yard log

Append-only, one entry per observation, each stamped with who wrote it and
when. `adminAddYardNote` is the only way in; there is no edit and no delete.

- **It is not the staff note.** The staff note is a single box the office
  rewrites as its understanding of a quote changes. This is a stream of things
  seen in the yard, and the two answer different questions.
- **Append-only, for two reasons.** Two people on two phones cannot clobber
  each other — a read-modify-write of one text box loses whichever save lands
  second and tells nobody. And *"gelcoat crack on the port side, 12 Oct"* stops
  being true the moment somebody edits the box; a season later nobody can tell
  what was observed from what was concluded.
- **As private as the staff note.** Never on the PDF, never in an email, never
  returned by `?action=load`. `verify.sh` checks all of those paths, and also
  fails on anything that splices, pops or empties the array.
- **It must survive a customer save.** The log exists only on this side, so a
  posted payload carries none — it is preserved explicitly like `payments` and
  the staff note. Losing it would destroy observations nobody can reconstruct,
  silently, right after somebody photographs a crack.
- Written from the app or from the console's **Yard log** card; both go through
  the same endpoint, gated on the `keys` permission — recording what a unit
  looks like is yard work, the same bar as keys and slip.

---

## Dictation

Isolated behind `toggleDictation` / `stopDictation` / `dictationSupported_` so
the engine can be swapped without touching anything else on the page.

- **What is there now is the browser's own `SpeechRecognition`, and it is a
  PLACEHOLDER.** Chris asked for the same method as the service tracker
  mechanic app; that repo was not attached to the session this was written in,
  so the method could not be read and copied. When it is, replace the bodies of
  those three functions and leave every call site alone.
- **Dictation appends, never replaces.** A half-typed note wiped by a misfired
  button is how somebody stops using the feature altogether.
- A browser that will not do it says so and points at the phone keyboard's own
  mic key, rather than presenting a button that silently does nothing.

---

## Photos

The same Drive folders and the same endpoint the console uses
(`adminUploadPhoto`), uploaded one at a time with a running count.

- **Winter, always.** This app is used at haul-out; spring relaunch photos go
  through the console, which has the season switch. One less thing to get wrong
  in a hurry.
- **`capture` is on the camera button only.** On Android it forces the camera
  and kills the gallery, so the two inputs are separate and `verify.sh` counts
  the attribute — exactly once, page-wide.

---

## Talking to the backend from the yard

The yard is where the dropped-POST problem was found, so this page cannot
pretend it does not exist. A transport failure is not an answer: reads retry
over GET, and a write carries a `rid` so the app can ask `jobStatus` what
became of it instead of guessing.

- **It is a deliberate subset of the console's transport, not a copy of it.**
  The hard half is the server's and is shared: the GET allow-list is enforced
  there, and a write's request id is claimed there, so asking twice replays one
  answer rather than doing the work twice. What lives on this page is only the
  client's side of that contract, in about fifty lines.
- **`API_GET_OK` here must stay a subset of `CONSOLE_GET_FNS_` there.** The
  server refuses a GET naming a write, so a wrong entry is a retry that can only
  ever fail — in the yard, with nobody to explain it. `check-yard-app.js` reads
  both and asserts the subset, and asserts the writes are absent from it.
- **A write that goes unanswered is never re-sent.** The reply cannot prove
  whether it ran. The app says so in as many words and tells staff to refresh
  and look rather than tap again.
- The lost-POST fingerprint matches the customer loader's wording, which is
  fragile, so it is pinned against the real string in the `.gs`.

---

## Sessions

It shares `qwtok` / `qwme` with the staff console on purpose: same origin, so
signing in to either signs you in to both. One PIN entry per phone per shift.
A cached token may be hours stale, so the first load finds out and drops back
to the PIN screen rather than showing an empty yard.

The `keys` permission gates writing. `canWrite()` mirrors `canKeys_`'s fallback
for roster entries written before that permission existed — `ME` is cached in
localStorage, and a session opened before the deploy would otherwise lose the
note box on an action the server would still accept.
