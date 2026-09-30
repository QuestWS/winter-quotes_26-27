# Making the mechanic app fast: what Harbor Haul Out learned

Written 30 Sep 2026 for the Service Tracker (`QuestWS/servicetracker`), to be
picked up cold by whoever works on the mechanic app (`m/index.html`) next. It
is the write-up of one day spent taking Harbor Haul Out, the winter services
haul-out app, from "minutes to load" to "opens instantly". Chris's verdict at
the end: *"So much faster."*

Everything here was measured, and every recommendation names the service
tracker file it lands in. Read `docs/FASTER.md` in the service tracker first:
most of what it did on the server side is already right, and this document
does not repeat it.

---

## The one finding that matters

`diagnoseSpeed()`, run from the Apps Script editor against the live sheet,
timed the server's own work:

| What | Time |
|---|---|
| Batch read of every tab (Sheets advanced service) | 0.7 s |
| The whole storage view, rebuilt from the sheet | 1.7 s |
| The same view from CacheService | 0.012 s |
| Finding one quote, cold | 1.1 s |

On the phone, at the same moment, the same list took **fifty seconds** and one
unit took over thirty-five. Chris's screen recording showed it.

**The server was never the problem.** The time was between the phone and the
function: Apps Script starting the request, the redirect leg every POST's answer
travels through, and a first attempt stalling on weak signal. The transport sat
and waited for that stalled attempt to give up before it tried anything else.

So the fixes that made the difference were not in the `.gs` at all. In the
order they paid off:

1. **Show what the phone already has, immediately.** Then refresh behind it.
2. **Ask a slow read a second way.** Do not wait for the first one to give up.
3. **Make the server answer from memory** when nothing has changed.

The service tracker already measures the gap: `api()` records `ms` against
`serverMs`, and the mechanic's footer shows both. **Look at that footer before
doing anything below.** If it reads something like `31.4s · 1.2s in the sheet`,
you are where Harbor Haul Out was, and this document is the fix. If the two
numbers are close, the time is in the sheet and `docs/FASTER.md` step 4 is
next instead.

---

## What the service tracker already does right

So nobody spends a day rediscovering it:

- **Fonts are off the critical path** (`media="print" onload`). Harbor Haul Out
  had them render-blocking and had to fix it.
- **`ping` on open** to warm the container.
- **`serverMs` on every answer** and the round trip timed on the phone.
- **One trip per click** (`jobPage` / `withJobPage_`), and the log is off the
  open path.
- **Tabs read in one batch** (`prefetch_` over `values.batchGet`).
- **Writes carry an id and replay** (`claimRid_`), and the outbox keeps unsent
  entries on the phone.
- **Slow work is in a trigger**, not the request (`submitTranscript_`).

The two apps have borrowed from each other all along: the voice-note method
came from the service tracker, and the `rid` replay went the other way.

---

## 1. Show the last list and the last job at once — `m/index.html`

**This was the biggest single win, and the service tracker does not do it yet.**

Today `renderOpenJobs()` draws *"Loading open jobs…"* and waits for `openJobs`.
`openJob()` draws *"Looking that job up…"* and waits for `lookupJob`. Every open
of the app, and every job opened from the list, is a blank screen for however
long the round trip takes.

Harbor Haul Out now does this instead:

- **The last list the phone loaded is saved**, with the time it was fetched,
  and drawn the instant the screen opens. A strip above it says *"List from
  12 min ago · refreshing…"*. The fresh copy replaces it when it lands.
- **The last full detail for each unit is saved too**, keyed by its id, and
  drawn the instant it is opened. With no saved copy, the screen is drawn from
  what the **list row** already knows (name, boat, alert, status), marked as
  partial, and the rest fills in.
- **A refresh that fails leaves the old copy up** and says so: *"Could not
  refresh — showing the list from 12 min ago."* An old list beats a blank
  screen, and the crew is told exactly how old it is.

The rules that make this safe, each of which Harbor Haul Out's guard asserts:

- **Save only what the server said.** The copy is written after a successful
  answer, and again after a recorded change, never before. A copy built from a
  list row is marked partial and is never saved as if it were the real thing.
- **Draw the saved copy only into an empty screen.** A refresh must never put an
  older copy over a newer one.
- **Drop an answer the mechanic has walked away from.** A counter that goes up
  on every open and on close, checked when the answer lands, stops a slow
  `lookupJob` for job A redrawing the screen after the mechanic opened job B.
- **Nothing on the saved copy decides anything.** Every button still calls the
  server, which confirms or refuses there.
- **Signing out clears it.** An expired session does not, or every morning
  starts blank.

**Two service-tracker specifics:**

- **Follow the token's storage bucket.** `storeSession` puts the token in
  `sessionStorage` on the shared shop iPad and in `localStorage` on a
  mechanic's own phone. The open-jobs list is every customer's name and boat,
  which is why it sits behind sign-in. Save the list and the job screens in
  **the same bucket the token is in**, and clear them in `clearSession`, so the
  shared iPad forgets them at the end of the shift exactly as it forgets the
  token.
- **The scanned path can use it too.** A QR scan hands `lookupJob` a token. Key
  the saved job screen by that token as well as the job id, so a mechanic who
  scans the same work order twice in a morning gets it instantly the second
  time.

Where it goes: `renderOpenJobs()`, `openJob()`, `loadJob()`, `clearSession()` in
`assets/lib/api.js`, and a few lines after each successful save in
`sendEntry()`. In Harbor Haul Out the whole thing is `listLoad_`, `listSave_`,
`qLoad_`, `qSave_` and `fromRow_`, about eighty lines.

---

## 2. Ask a slow read a second way — `assets/lib/api.js` and `doGet`

**This fixed the fifty-second waits.**

Every service tracker call is one POST. When that POST stalls, `api()` waits
until the browser gives up on it, and then throws. There is no second road.

Harbor Haul Out's reads now go like this:

1. Send the POST, as now.
2. If no answer has come back in **six seconds**, also send the same read as a
   **GET**.
3. Whichever real answer arrives first wins. The other is ignored when it lands.
4. If either road fails outright, ask the other one at once instead of waiting
   out the timer.

**Reads only, never writes.** A write is still sent exactly once, with its
`rid`. If its answer goes missing, the app asks what happened; it never sends
the write again. The service tracker already has the replay side of that
(`claimRid_`); keep writes out of the hedge regardless.

What the server needs, and this is the part that takes care:

- **`doGet` must serve the API for an allow-list of read-only functions.** Today
  it answers only the transcript hook and a health check. Harbor Haul Out's
  backend has `CONSOLE_GET_FNS_`: `openJobs`, `lookupJob`, `jobLog`,
  `jobProps` and `ping` would be the service tracker's equivalents.
- **The server refuses a GET naming a write**, not just the client declining to
  send one. A GET can be retried, prefetched or followed twice. A write that
  becomes GET-able is how a note gets saved twice.
- **Derive "is this a write" from the read list, not a second list.** Harbor
  Haul Out treats anything *not* on the GET list as a write. A function added
  later is therefore a write until somebody deliberately says otherwise.
- **The token goes in the query string on the GET road.** That lands in Apps
  Script's own execution log, which only the owner can see. Harbor Haul Out
  accepted that trade; decide it deliberately.

### A correctness risk this exposes, which is worth fixing first

**A reply the service tracker's `api()` cannot tell from a real one.**

The winter services console found this the hard way: a POST can arrive at the
web app with its body gone, and when it does, Apps Script hands it to `doGet`.
In the console, `doGet` then answered with the customer quote loader's error,
and staff were told *"Enter both your quote number and last name"* while
looking at an open quote, for a week.

In the service tracker, that same event gets `doGet`'s health check back:
`{ ok: true, service: 'Quest Service Tracker' }`. `api()` only looks for
`body.error`, so it treats that as success. Traced through `sendEntry()` in
`m/index.html`:

- the entry is **removed from the outbox** (`forgetQuietly`), and
- its place in the feed is overwritten with `result.entry`, which is
  **undefined**, so it disappears from the screen.

**The note was never saved and nothing is left anywhere to say so.** That is
the exact failure the outbox was built to prevent.

Whether it has happened here is not known. The fix is small, and Harbor Haul
Out's is proven:

- **Stamp every API answer** with a marker, e.g. `_api: 'service-tracker'`, in
  `json_()` or `timed_()`.
- **In `api()`, a reply without the stamp is not an answer.** For a read, try
  the other road. For a write, keep it in the outbox and let the `rid` settle
  it.

This is worth doing even if nothing else in this document is.

---

## 3. Answer from memory when nothing has changed — `service-tracker.gs`

`docs/FASTER.md` step 5 lists CacheService as an option and names the risk: *"a
mechanic who sees a stale log will not trust the app again."* The winter
services storage view, which Harbor Haul Out reads, has run from CacheService
since September. What made it safe:

- **Every write drops the cache, from one place.** The dispatcher drops it after
  any function that is not on the read-only list. It is the same derivation as
  above, so a write added next month cannot forget to.
- **The cached copy carries a shape version.** Bump it whenever the rows gain a
  field. Otherwise, for the life of the cache after a deploy, the app is handed
  rows missing the new field and cannot tell *"no alert"* from *"this row
  predates alerts."*
- **A deliberate Refresh skips the cache.** Opening the app takes whatever is
  fastest. Pulling to refresh asks for the sheet as it is now.
- **Split big values across entries.** CacheService caps a value at 100 KB, and
  a missing chunk must read as a miss, never as half a list (`cachePutBig_` /
  `cacheGetBig_` in `quote-logger-apps-script.gs`).

Best first target: **`openJobs`**. It is the list every mechanic opens and every
save changes, which is exactly the shape the invalidation rule handles.

Cheaper and smaller, if a lookup by token ever shows up in the timings: Harbor
Haul Out caches *quote → (tab, row)* for six hours and **verifies it with one
read of that row** before trusting it. The list primes it for every unit it
shows, because the tap that follows a list is "open one of these". The service
tracker's Jobs tab is small today, so this is second priority.

---

## 4. The service worker: add a timeout, but mind the modules — `sw.js`

The service tracker's `sw.js` is network-first for everything same-origin,
which is right, and its comment explains why cache-first broke ES modules. What
it lacks is a **timeout**. On a connection that is slow rather than dead,
`fetch` neither answers nor fails, and the app waits on it before it can draw
anything.

Harbor Haul Out serves the network's answer if it arrives within **four
seconds**, and the cached copy if it does not. It can do that safely because
its page is one file with one inline script.

**The service tracker cannot copy that as-is.** A timed-out navigation served
from the cache, followed by modules that do reach the network, is exactly the
new/old generation mix its `sw.js` comment warns about, and an ES module with a
missing export stops the whole app at *"Starting up…"*. Two safe ways to do it:

- **Put the version in the module URLs** (`api.js?v=…`, stamped at deploy), so
  an old page can only ever load the old modules it was built with; or
- **Apply the timeout to the whole shell as a unit:** if the navigation times
  out, serve every shell file from that same cache generation for the rest of
  the page's life.

Do this after 1 and 2. Once the app draws from its saved copy, the shell is the
only thing left between the tap and the screen, and on a good connection it is
already fast.

---

## 5. A diagnostic you can run from the editor — `service-tracker.gs`

`serverMs` says how long a call took. It cannot say **which road the call took**
inside the script: whether the batch read ran or quietly fell back, whether a
cache was hit. Harbor Haul Out's `diagnoseSpeed()` times each road separately
and prints the answer to the execution log. It is what turned "it's slow"
into "the server is fine, fix the transport" in one run.

For the service tracker it would time: `ping`'s body, one `values.batchGet`,
one plain `getDataRange().getValues()` on Jobs, `prefetch_` for the job page,
`openJobs`, `lookupJob` for one known test job, and a script-properties read.
It must write nothing.

**Put it at the very top of the file.** The Apps Script editor's function
dropdown lists functions **in file order**, and the service tracker's `.gs` has
hundreds. Chris spent ten minutes failing to find `diagnoseSpeed` three-quarters
of the way down Harbor Haul Out's backend, and the browser's Ctrl+F cannot help,
because the editor only draws the lines on screen. First function, first entry.

---

## Suggested order

| Step | Where | Why this order |
|---|---|---|
| 1 | Stamp replies; `api()` rejects an unstamped reply | Closes a silent note-loss path. Small. |
| 2 | Saved open-jobs list and saved job screens | The biggest felt difference; no server change. |
| 3 | GET road for reads, and the hedge in `api()` | Fixes the long waits on weak signal. Needs `doGet` and a deploy. |
| 4 | CacheService for `openJobs` | Makes the refresh behind the saved list quick too. |
| 5 | `diagnoseSpeed()` at the top of the `.gs` | So the next report is a number, not a feeling. |
| 6 | Service worker timeout, done safely | Last, because 2 already hides most of it. |

Test each against the footer: the round trip should fall towards `serverMs`
after 3, and the screen should draw before the round trip after 2.

---

## Where to look in winter-quotes

All in `QuestWS/winter-quotes_26-27`:

| Idea | Code | Write-up |
|---|---|---|
| Saved list and detail, drawn first | `harbor-haul-out/index.html`: `listLoad_`, `listSave_`, `qLoad_`, `qSave_`, `fromRow_`, `openQuote` | `docs/ref/HARBOR-HAUL-OUT.md`, *Opening fast* |
| Hedged reads | `harbor-haul-out/index.html`: `readHedged_`, `api` | same section |
| GET allow-list, stamp, writes refused on GET | `quote-logger-apps-script.gs`: `CONSOLE_GET_FNS_`, `consoleServe_` | `docs/ref/STAFF-CONSOLE.md` |
| Cache with one-place invalidation and a shape version | `cachePutBig_`, `invalidateStorageView_`, `STORAGE_VIEW_V_`, `consoleServe_` | `docs/ref/STAFF-CONSOLE.md`, *Why the console got slow* |
| Verified row index | `cachedQuoteRow_`, `rememberQuoteRows_` | same |
| Service worker with timeout | `harbor-haul-out/sw.js` | `docs/ref/HARBOR-HAUL-OUT.md` |
| Editor diagnostic | `diagnoseSpeed` (first function in the `.gs`) | same |
| Guards that run all of the above | `tools/check-harbor-haul-out.js`, `tools/check-fast-reads.js` | — |
