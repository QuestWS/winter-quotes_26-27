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
