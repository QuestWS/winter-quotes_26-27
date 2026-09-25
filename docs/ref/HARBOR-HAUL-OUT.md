# Harbor Haul Out

`harbor-haul-out/index.html` — the haul-out list as something you open on a phone,
standing next to the boat. Installable (Add to Home Screen), PIN-gated,
and deliberately narrow.

*Detail for `harbor-haul-out/index.html` lives here rather than in `CLAUDE.md` so it is
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

`d.placement = { state, at, by }`, where state is `''`, `'pulled'`, `'dropped'`
or `'stored'` (`PLACEMENT_STATES_`). Named `placement`, not `hho`: `hho`
already means Heritage Harbor Ottawa elsewhere in the pricing engine, and
reusing it here would recreate the exact kind of collision this rename exists
to remove. Reads fall back to the pre-rename `d.yard` field, so a quote saved
before the rename keeps its season progress; every write lands on
`d.placement`. One field decides the list, so a unit can never be on two at
once or fall off all three — `check-harbor-haul-out.js` walks every
state × slip combination and asserts exactly that, plus that an unrecognised
state falls back to a real list rather than making a boat disappear.

It is **not** in the manual-ops journal that keys, slip and trailer location
use. Those are corrections to what the customer told us: they feed
`effectiveState_` and they re-run the pricing engine. This is not a correction
and not an input to a price — it is a fact about a day's work. Journalling it
would put a re-price in the path of somebody tapping "stored" with cold hands,
for nothing. The guard fails if `adminSetPlacementState` ever grows a
`savePdf_`/`recomputeTotals_`/`rebuildLinesFromState_` call.

It **is** carried across a customer save, like the payments and the Harbor Haul Out log.
The customer's browser has never heard of it, so their next save would
otherwise wipe the season's progress and put boats that are already in a
building back on the crew's to-do list.

### Where each transition starts

The console can record **every** transition, because at Quest the counter and
the shop are the same people (`CLAUDE.md` §9) and *"somebody told me it is
out"* is an ordinary Tuesday. A phone that glitched at the harbor must not mean
the only person who can record the pull is the one whose phone just failed.

| Transition | In the app | On the console | Gated? |
|---|---|---|---|
| **Pulled** | button on the **opened unit** only | Harbor Haul Out status card | yes, identically |
| **Dropped off** | — | Harbor Haul Out status card | no |
| **Stored** | one tap on the To store row, or the opened unit | Harbor Haul Out status card | no |
| **Undo** | opened unit, any state | Harbor Haul Out status card | no |

Two of those placements are deliberate and were changed after the first build:

- **Pulling is not a row action.** It is the act the whole liability rule
  exists for, so it is made with the unit **open** — its alert, its
  authorisation banner and its notes all on the screen at the time. The pull
  list's rows open a unit and record nothing. Putting an already-pulled boat
  into a building carries none of that weight and is done a row at a time down
  a list, so `Stored ✓` stays on the row.
- **Dropped off is console-only.** It records that a customer drove their own
  boat in, which is something the *counter* hears; the harbor never sees it
  happen. The app must still **read** the state — it is how a unit reaches the
  To store list without ever having been in the water — it just cannot set it.

`check-harbor-haul-out.js` asserts both from the rendered markup rather than from the
helpers, because a row action is a two-line thing to reinstate by hand and the
helper is still sitting there. It also asserts the console kept "Mark dropped
off", since the app gave it up on that understanding.

### The pull gate follows the boat

Marking a unit **pulled** is a claim that we put hands on it and took it out of
the water, so it is refused for anything not `cleared` — in the app the opened
unit shows the stamp where the button would be, and `adminSetPlacementState`
re-checks `haulAuth_` server-side, because a client is not a permission.
Otherwise the app becomes the place a rule violation gets written down.

`dropped` is deliberately **not** gated: the customer drove it here themselves,
we touched nothing, and refusing to record a boat that is visibly sitting in
the lot would only mean it goes unrecorded.

### Search and sort

The two storage lists are searchable (name, quote number, slip, unit, location)
and sort by **location** or **name**. Sorted by location they are *grouped* by
it — a heading you find by eye beats a column you read on every row — and the
per-row location is dropped, since the heading already says it.

The pull list has neither, on purpose: **its order is the information.** It is
the order the customers asked for, and re-sorting it would throw that away.

### The row action

Rows on **To store** carry a `Stored ✓` button, so a crew member can work down
twenty boats without opening twenty detail sheets. Two things make that safe:
it is its own tap target with real padding and a divider above it, and it calls
`stopPropagation`, or the tick would also open the detail sheet and slide a
panel over the list they were working down. The guard asserts both.

**To pull rows carry no button** — see *Where each transition starts*.

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
`tools/check-harbor-haul-out.js` fails if this page looks like it is working the
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

## The alert

One short, current, loud line per unit — *"no keys, do not tow"*, *"owner says
don't touch the canvas"*, *"bad bunk on the trailer"*. `d.placementAlert`.

**Set and cleared on the console only. Harbor Haul Out displays it and cannot
touch it.** Chris's call, and it is the one place the app is deliberately
read-only: the alert is the loud thing, and it stays under one pair of eyes
rather than being rewritten by whoever is standing nearest the boat. The guard
fails if the app grows a `saveAlert` or an alert editor — note that an editor
is not harmless even unused, because an empty box on every unit is exactly
what it must not have (below).

**It is on the list row, not behind a tap.** That is the entire point: somebody
loading the app sees which boats need reading about *before* walking over to
one. An alert only visible on the detail screen is a note, and there is already
a note. The guard asserts it renders on the row.

**Nothing renders unless something was actually entered** — no empty strip, no
empty heading, on the row or on the detail screen. An empty warning on every
unit is how people stop seeing the one that matters. Whitespace counts as
empty, since a cleared field can leave a space behind and a strip containing
one space is still a strip on every row. All four cases are asserted.

**Three staff-facing texts, deliberately kept apart** — and the difference is
why this is a third one rather than a reuse:

| | What it is | Shape |
|---|---|---|
| `staffNote` | the office's private reasoning about a quote | one box, rewritten |
| `placementNotes` | what was observed, when, by whom | append-only, accumulates |
| `placementAlert` | what you must know **before touching this boat** | set, replaced, cleared |

An alert that is a paragraph is not an alert, so it is capped at 160
characters and anything longer is pushed to the Harbor Haul Out log. An alert nobody
clears becomes wallpaper, so clearing it is one tap from where it is set and
the Clear button disables itself when there is nothing to clear.

**Setting and clearing are both audited**, because the alert itself is
overwritten and cleared — without the log there would be no record that anybody
was ever warned about the canvas.

**It is not the do-not-pull stamp.** That one is solid red and means *stop*;
this is an outlined warning strip and means *read this first*. They appear
together on the same row and must stay distinguishable, which the guard pins.
Neither is carried by colour alone — the alert has a ⚠ and the stamp has its
words — because this is read outdoors in November.

**It rides the paper too.** Both printed sheets carry it in a bordered box in
words, since the paper is what the crew is actually holding.

**As private as the rest.** Never on the PDF, in an email, on `?action=load`,
or in the public scan-to-sign lookup — all four checked — and carried across a
customer save, or their next save would take a live warning down with nobody
deciding to.

## The Harbor Haul Out log

Append-only, one entry per observation, each stamped with who wrote it and
when. `adminAddPlacementNote` is the only way in; there is no edit and no delete.

- **It is not the staff note.** The staff note is a single box the office
  rewrites as its understanding of a quote changes. This is a stream of things
  seen at the harbor, and the two answer different questions.
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
- Written from Harbor Haul Out or from the console's **Harbor Haul Out log** card; both go through
  the same endpoint, gated on the `keys` permission — recording what a unit
  looks like is physical work, the same bar as keys and slip.

---

## The unit's facts

Slip, keys, trailer, storage, requested timing, balance — read-only, straight
off `adminLookup`. Two of those rows are conditional, and both conditions are
the server's:

- **"Trailer is" appears only when there is a trailer to find**
  (`needsTrailerLoc_`, `docs/ref/STAFF-CONSOLE.md` § *Keys & slip*). It used to
  render for every unit, so a boat blocked on stands showed
  *"Trailer is — not recorded —"* in the colour this app uses for missing
  information, and a settled fact read as a gap somebody forgot to fill in.
  The **"On a trailer"** row directly above already says there is none, so
  nothing is lost by dropping it. Where the row *is* shown and empty, the red
  is earned: we know there is a trailer and nobody has said where.
- **Land units drop the subject entirely.** Golf carts are driven here and
  e-bikes are carried, so neither the *"On a trailer"* row nor the location row
  appears on one — printing *"On a trailer: No"* on every cart is the same
  noise. `trailerApplies` is the server's answer; an absent one falls back to
  showing the row, so a boat never loses it to an older backend.

Anything the app renders in the missing-information red is a claim that
somebody should go and find out. Rows that can never be filled in have to be
absent, or the colour stops meaning anything.

---

## Measurements

Chris: *"We should have the ability to update dimensions in Harbor Haul Out."* The tape
measure is at the harbor, so the correction is made there. The card sits on
the opened unit, under **Measurements**, and runs the same two endpoints the
console's dimension editor does — `adminDimsPreview` then `adminDimsApply` —
so a re-measure taken at the ramp is journalled, audited and re-priced exactly
like one taken at the desk. Everything in `docs/ref/STAFF-CONSOLE.md`
§ *The dimension editor* and `docs/ref/DATA-AND-MONEY.md` about
`manual.measured` applies unchanged.

Three things are different here, and all three are the sort that get quietly
relaxed later:

- **It is its own permission — `measure`, not `keys` and not `adjust`.**
  Writing a Harbor Haul Out note must never buy the ability to re-price a quote, and
  inventing a charge (`adjust`) is a different act from reading a tape over a
  hull. An unset `measure` falls back to `adjust`, so **deploying this changes
  nobody's access on the day**: Chris and Jeff can re-measure because they
  already could, and John, Rex, Jess and Marina cannot until an admin turns it
  on for them — one tap per person in the console's **Staff** panel, the
  button marked *Re-measure*. `canMeasure_` in the `.gs` is the one answer;
  `canMeasure()` in the app and `permsOf()` in the console mirror its fallback
  because `ME` is cached in localStorage and a session opened before the
  deploy carries a perms object with no `measure` key in it.
- **Preview and apply are two separate taps.** `dimsPreview` writes nothing
  and says what the change costs — line by line, the new total, the new
  balance, any storage move, and any flag the engine raises (*too wide for
  inside*). `dimsApply` is a second deliberate act. That matters more here
  than at the desk: the person making it is holding a phone in one hand and a
  bow line in the other.
- **The app sends measurements only.** The console's editor can also change
  motor counts and override the storage location; those are specification
  changes made at a desk with the customer on the phone, and they stay there.
  Harbor Haul Out sends the engine's own `DIM_FIELDS` plus *stored on its trailer*.
  A storage move still happens — it just *follows from* the measurements
  rather than being chosen, and the diff says so before the tap.

Because the field list comes from the server (`DIM_FIELDS` in the engine), a
dimension that starts mattering to the price appears in Harbor Haul Out without
this file or `harbor-haul-out/index.html` changing.

Applying reloads the list **before** re-opening the unit: the row's dimensions,
total and possibly its storage tab have all just changed, and re-opening
against the cached row would put the old figures back on screen a second after
the toast said otherwise. Nothing is emailed — the customer finds out from the
counter, as with every other re-price.

A deposit does not stop a re-measure. The real workflow *is* quote → deposit →
pull → measure → re-bill, and `verify.sh` fails if the customer-side payment
lock ever spreads to these two endpoints.

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
harbor, and it keeps nothing afterwards. **A recording is evidence.** The audio
is the record and the transcript is the convenience — which is why the audio
is filed first and kept whatever happens next.

- **Nothing slow runs in the request the harbor is waiting on.** Reading the file
  back out of Drive and pushing it to AssemblyAI is a Drive read and two
  uploads; the person who tapped Save is standing outside holding a phone. A
  one-off trigger is the only way an Apps Script request can start work it does
  not then wait for. `check-harbor-haul-out.js` fails if `adminAddPlacementNote` ever grows
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
- **The shared secret is minted on this deployment** (`PLACEMENT_HOOK_KEY` in Script
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

## Condition photos and video

Stills and video, into the same Drive folders the console uses. **Two
transports, tried in order**, and an upload never blocks the app.

### Straight to Drive (the normal path)

`adminUploadSession` asks Drive to open a **resumable session** and returns the
browser nothing but the session URI. The phone then PUTs the raw file directly
to Google; Apps Script never sees the bytes.

- **No 25 MB ceiling** — the limit becomes the phone and the patience
- **No base64 inflation**, so a third less over the air
- **Resumable**, so a dropped signal at the harbor continues instead of restarting
- Real upload progress, via `XMLHttpRequest` rather than `fetch` — a phone
  pushing 60 MB with no feedback looks identical to a phone doing nothing

**The session URI is a capability, not a credential.** It is good for one file,
into one folder we chose, and it expires. **The OAuth token never leaves the
script** — handing that to a browser would be handing over the whole Drive, not
one file. The guard asserts the token is never returned, that the session pins
a destination folder, and that minting one needs the `photos` permission.

`uploadSession` is a **write**: deliberately absent from `CONSOLE_GET_FNS_`,
because a link that mints an upload slot is a link that can be followed twice.

**The CORS question, and why the fallback exists.** Probing before building
showed Google's upload endpoint echoes our exact origin, allows PUT, and
exposes `X-GUploader-UploadID` — a header only a browser would want. What could
*not* be tested without a staff PIN was a preflight against a live session. So
the client tries direct first and falls back; the first real video upload is
the last word either way.

### The base64 relay (the fallback)

The original path: base64 through `adminUploadPhoto`. Still there, still capped
at **25 MB**, used whenever the direct leg is refused — a CORS preflight, an
older backend with no `uploadSession`, a browser with no `XMLHttpRequest`.

A CORS refusal reaches the page as a bare **status 0 with no detail**, which is
exactly the shape the fallback recognises. An HTTP error (`4xx`/`5xx`) is
treated as a genuine refusal and is *not* retried down a path with a smaller
ceiling.

**When neither route works — a big file and no direct upload — the file is
named in the final message.** Silent partial success is the worst outcome
available here, and it is asserted by running an upload, not by matching the
source. An earlier version of that check pinned a variable name and went stale
the moment the uploader was rewritten, while the property it cared about still
held.

### Uploads do not block the app

Chris: *"I dont want to slow the app down with upload times."* A file is queued
against the **quote**, not the screen, and pumped in the background with a chip
at the bottom. Close the unit, go back to the list, keep ticking boats off — a
60 MB clip keeps going. Only closing the app stops it.

Queued against the quote that was open when it started, so closing the sheet
cannot send a clip to whichever boat gets opened next.

### The rest

**Winter, always, from the app.** This is used at haul-out; spring relaunch
media goes through the console, which has the season switch.

**Three inputs: stills camera, video camera, gallery.** Not tidiness — it is
the only arrangement that actually opens the camera.

`capture` tells the phone to open the camera but **cannot say which mode**. An
`accept` naming both `image/*` and `video/*` is ambiguous, and the browser
resolves it by ignoring `capture` and showing the gallery picker. That is
exactly what a single combined input did when video was added: the "Photo /
video" button opened the gallery every time.

`multiple` alongside `capture` is the same class of bug — the spec says
`capture` implies a single file, and Chrome on Android drops `capture`
entirely when `multiple` is present. So neither camera input takes more than
one file; the gallery keeps `multiple`.

The guard used to **count** `capture` occurrences, which broke the moment
stills and video needed separate inputs. It now asserts the rules instead:
each camera input names exactly one kind, both carry `capture`, neither
carries `multiple`, and the gallery carries no `capture` — because on Android
that would remove the gallery.

The **signed-contract** upload is deliberately left alone: it takes a PDF or a
photo of a signed page, and a video of a contract is not a thing.

**The console uploads video one at a time** and uses the same direct-first
logic. Three at a time is right for stills and wrong for clips.

## Talking to the backend from the harbor

The harbor is where the dropped-POST problem was found, so this page cannot
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
  ever fail — at the harbor, with nobody to explain it. `check-harbor-haul-out.js` reads
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
to the PIN screen rather than showing an empty list.

The `keys` permission gates writing. `canWrite()` mirrors `canKeys_`'s fallback
for roster entries written before that permission existed — `ME` is cached in
localStorage, and a session opened before the deploy would otherwise lose the
note box on an action the server would still accept.

`measure` gates the one thing in the app that moves money, and `canMeasure()`
mirrors `canMeasure_` for the same reason. Its fallback routes through
`canWrite()` — this file's copy of `canKeys_` — because that *is* the server's
fallback, so the two cannot drift: whoever can record harbor facts can correct a
measurement. In practice that is the crew, which is the point of the card.
Without the permission the Measurements card is **absent, not disabled**: a
permanently dead control is something people learn to tap anyway.
