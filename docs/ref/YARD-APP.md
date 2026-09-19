# The yard app

`yard/index.html` — the haul-out list as something you open on a phone,
standing next to the boat. Installable (Add to Home Screen), PIN-gated,
and deliberately narrow.

*Detail for `yard/index.html` lives here rather than in `CLAUDE.md` so it is
read when it is relevant. `tools/check-docs-coverage.js` fails if any of it
goes missing.*

---

## What it is for

Three lists, and they are **one field read three ways**. Left to right is the
season, and a unit moves along it as the work gets done:

| Tab | Shows | The question it answers |
|---|---|---|
| **To pull** | slip boats not yet pulled, in requested-timing order | what is still in the water, and in what order |
| **To store** | everything pulled, plus everything marked dropped off | what is sitting here waiting for a spot |
| **Stored** | everything put away | did we already deal with that one |

Chris's shape for it: *"leave pull as is, but store should be boats that are
either flagged as pulled (a flag from the pull list which also removes them
from the pull list) or marked as dropped off on the admin page… once something
is brought to storage it should be moved to a 3rd list."*

### The state, and why it is a plain field

`d.yard = { state, at, by }`, where state is `''`, `'pulled'`, `'dropped'` or
`'stored'` (`YARD_STATES_`). One field decides the list, so a unit can never be
on two at once or fall off all three — `check-yard-app.js` walks every
state × slip combination and asserts exactly that, plus that an unrecognised
state falls back to a real list rather than making a boat disappear.

It is **not** in the manual-ops journal that keys, slip and trailer location
use. Those are corrections to what the customer told us: they feed
`effectiveState_` and they re-run the pricing engine. This is not a correction
and not an input to a price — it is a fact about a day's work. Journalling it
would put a re-price in the path of somebody tapping "stored" with cold hands,
for nothing. The guard fails if `adminSetYardState` ever grows a
`savePdf_`/`recomputeTotals_`/`rebuildLinesFromState_` call.

It **is** carried across a customer save, like the payments and the yard log.
The customer's browser has never heard of it, so their next save would
otherwise wipe the season's progress and put boats that are already in a
building back on the crew's to-do list.

### Where each transition starts

- **Pulled** — from the yard, one tap on the row. Never offered on the console:
  pulling happens with the boat in front of you, and the app gates it on the
  unit being cleared. Recording it from a desk would route around that gate.
- **Dropped off** — from the **console**, because a customer driving their boat
  in is something the office sees and the yard does not. It is what puts a
  trailered unit on the crew's To store list without it ever having been in
  the water.
- **Stored** — either place.
- **Undo** — either place, any state. A mis-tap in the yard is a certainty and
  the fix must not be a phone call to somebody at a desk.

### The pull gate follows the boat

Marking a unit **pulled** is a claim that we put hands on it and took it out of
the water, so it is refused for anything not `cleared` — in the app the tick
button is disabled and shows the stamp instead, and `adminSetYardState`
re-checks `haulAuth_` server-side, because a client is not a permission.
Otherwise the app becomes the place a rule violation gets written down.

`dropped` is deliberately **not** gated: the customer drove it here themselves,
we touched nothing, and refusing to record a boat that is visibly sitting in
the yard would only mean it goes unrecorded.

### Search and sort

The two storage lists are searchable (name, quote number, slip, unit, location)
and sort by **location** or **name**. Sorted by location they are *grouped* by
it — a heading you find by eye beats a column you read on every row — and the
per-row location is dropped, since the heading already says it.

The pull list has neither, on purpose: **its order is the information.** It is
the order the customers asked for, and re-sorting it would throw that away.

### The row action

Each row on To pull and To store carries its own button — `Pulled ✓`,
`Stored ✓` — so a crew member can work down twenty boats without opening
twenty detail sheets. Two things make that safe: it is its own tap target with
real padding and a divider above it, and it calls `stopPropagation`, or the
tick would also open the detail sheet and slide a panel over the list they were
working down. The guard asserts both.

Lead rows never appear on any list. A quote nobody finished is not a unit we
are holding.

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

## Voice notes

The same method as the service tracker's mechanic app
(`QuestWS/servicetracker`), deliberately, so the two apps behave the same way
in the same hands:

1. the phone records with `MediaRecorder` — live seconds counter, stop,
   play it back, discard;
2. the audio uploads **with** the note and is filed in `Voice Notes/` inside
   the quote's Drive folder;
3. a **one-off time trigger a few seconds out** hands it to AssemblyAI;
4. AssemblyAI calls a webhook back and the words appear under the entry.

**Not on-device speech recognition.** That is the obvious guess and it is the
wrong one: it needs a live connection while you talk, it gives up in a noisy
yard, and it keeps nothing afterwards. **A recording is evidence.** The audio
is the record and the transcript is the convenience — which is why the audio
is filed first and kept whatever happens next.

- **Nothing slow runs in the request the yard is waiting on.** Reading the file
  back out of Drive and pushing it to AssemblyAI is a Drive read and two
  uploads; the person who tapped Save is standing outside holding a phone. A
  one-off trigger is the only way an Apps Script request can start work it does
  not then wait for. `check-yard-app.js` fails if `adminAddYardNote` ever grows
  a `UrlFetchApp` call.
- **A recording on its own is a note.** No typed words required — that is the
  whole point for somebody whose hands are full. Equally, audio that cannot be
  filed must not lose the words that came with it, so the note saves either way
  and says what went wrong.
- **Nothing is scanned.** The sheet is not walked to find pending work — that
  is the mistake that made the storage view time out. Each note carries an
  `id`, the queue and the transcript-id → quote mapping live in Script
  Properties, and a returning transcript goes straight to its row.
- **Without `ASSEMBLYAI_API_KEY` it degrades, it does not break.** The
  recording still saves, still plays, and the note says it was not typed up
  rather than sitting on "transcribing…" for ever. That is the same way the
  service tracker behaves, and it is why the recorder was worth shipping before
  the key was installed.
- **iOS needs `audio/mp4` in the mime list.** A single hardcoded `audio/webm`
  is how an iPhone gets a record button that does nothing; the list is
  negotiated and the guard checks it.

### The webhook

`WEB_APP_URL?hook=transcript&k=<secret>` — a new public door on the same
`/exec` the customer page and the payments use. Three things make that safe
enough to be worth it:

- **It is decided first in `doGet` and `doPost`**, before anything can fall
  through to the customer quote-loader — otherwise AssemblyAI would be told
  *"Enter both your quote number and last name."* and read it as success.
  Pinned by the guard.
- **The shared secret is minted on this deployment** (`YARD_HOOK_KEY` in Script
  Properties, generated once) and a wrong key gets `{ok:0}` and nothing else.
- **The id rides the POST body, not the query string**, so it stays out of
  execution logs — the same choice the service tracker made.

`sweepTranscripts` (5am, on the trigger list) is the net under all of it: a
delivery Google dropped, a deploy mid-transcription, or a queue run that never
happened. It is named without a trailing underscore on purpose — Apps Script
treats `_`-suffixed functions as private and they are not dependable as
trigger handlers.

### Turning it on

One step, and only Chris can do it — Claude has no access to the Google
account:

1. Apps Script editor → **Project Settings** → **Script properties**
2. **Add script property** → name `ASSEMBLYAI_API_KEY`, value: the same key
   the service tracker uses.
3. Save. Nothing else — the hook secret mints itself on first use.

Until then, voice notes record and play; they just do not get typed up.

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
