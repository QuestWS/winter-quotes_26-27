# Escalation & Rollback Protocol

Two audiences: **Chris**, when something's gone wrong and he wants out; and
**Claude Code**, which must recognize when to stop and hand back.

---

## Part A — For Claude Code: when to stop and escalate

**Stop working and produce a handoff (Part C) immediately if any of these are
true.** Do not attempt a clever fix first.

1. **An anchor assert failed twice** on the same edit — the file's structure
   isn't what you think it is.
2. **A syntax check fails and the cause isn't obvious in one look.**
3. **You're about to change payment, lock, journal, or balance logic** and
   can't fully explain the existing behavior first. These four are where
   money correctness lives.
4. **A change would touch all three files at once** and you're not certain
   the contract between them (field names in the payload, API arg order)
   stays intact.
5. **Chris reports a bug you cannot reproduce** in the file contents.
6. **You've made three or more attempts** at the same problem without it
   resolving. Three strikes is the rule; a fourth attempt usually digs deeper.
7. **Anything involving a new deployment URL, OAuth scope, or trigger** that
   you cannot verify from the file alone.

Escalating is not failure. This project has a working chat session that holds
the full design history; routing back to it is cheaper than a wrong fix.

---

## Part B — Rolling back (Chris, or Claude Code on request)

### Fastest path: GitHub history
Both HTML files live in the repo with full version history.
1. Repo → the file → **History** → pick the last known-good commit.
2. **View file → Raw → copy**, or use **Revert** on the bad commit.
3. Commit, hard-refresh.

The Apps Script file should also be committed to the repo (see below) so it
gets the same safety net.

### Apps Script's own history
Apps Script editor → **⋮ → See version history** (or File → Version history).
Restores the editor contents. **Remember: restoring the editor is not
deploying.** After restoring, still do
**Manage deployments → pencil → New version → Deploy.**

### Deployment rollback
Manage deployments → pencil → the **Version** dropdown lists every version
you've ever deployed. Selecting an older one and deploying rolls the live
backend back in about ten seconds. This is the single fastest "undo" for a
backend problem.

### Data rollback
The nightly 6pm backup emails a full `.xlsx` of every tab to
`chris@questwatersports.com`. Any one of those can rebuild the season. Data is
never truly lost — which is why the standing rule is *don't hand-edit cells,
ask instead*.

### Before any risky edit
Run `tools/snapshot.sh` (see `tools/`) to stamp a local dated copy of all three
files. Thirty seconds of insurance.

---

## Part C — The handoff back to chat

When escalating, Claude Code should write a file named
`HANDOFF-TO-CHAT.md` in the repo root using the template below, then tell
Chris:

> I've hit something I shouldn't guess at. I've written `HANDOFF-TO-CHAT.md`
> — open your Quest winter-system chat and attach that file plus the file(s)
> listed inside it.

### Template

```markdown
# Handoff to chat session — [DATE]

## What I was asked to do
[Chris's request, verbatim if possible]

## What I changed before stopping
- [file]: [change] — [applied / reverted / partially applied]
- [file]: [change] — ...
(If nothing was written to disk, say so explicitly — that's important.)

## What went wrong
[Exact error text, failed assert anchor, or the behavior Chris reported.]

## What I ruled out
[Things already checked, so the chat session doesn't repeat them.]

## Current state of the deployment
- Apps Script: [deployed new version? / editor only? / untouched]
- GitHub index.html: [committed? / untouched]
- GitHub admin/index.html: [committed? / untouched]
- Is the live system currently working: [yes / no / partially — describe]

## Files to attach alongside this one
[List only the files actually relevant — usually 1–2, not all three.
Attaching all three every time wastes the chat session's context.]

## My best guess
[One paragraph. Optional but usually useful.]
```

---

## Part D — Restarting the chat session cleanly

If the original chat thread is gone, unwieldy, or you just want a fresh one,
open a new conversation and attach:

1. `CLAUDE.md` (the project brief — this is the important one)
2. `HANDOFF-TO-CHAT.md` if one exists
3. **Only the file(s) actually being worked on**

Then open with something like:

> This is my Quest Watersports winter services system. CLAUDE.md has the full
> architecture, conventions, and known traps — please read it before
> suggesting anything. Today I need: [request].

Attaching all three source files "just in case" is the main way a fresh
session gets expensive. `quest-winter-quote-builder.html` alone is ~187KB;
attach it only when the customer page is genuinely the subject.

---

## Part E — Quick triage table

| Symptom | Most likely cause | First check |
|---|---|---|
| Console says "Session expired" constantly | New deployment URL, or Script Properties cleared | `API_URL` in `admin/index.html` matches `WEB_APP_URL` in the `.gs` |
| Customer page can't load a quote | Same URL mismatch | `INTEGRATIONS.quoteLogUrl` |
| Email button link → Google error page | `/dev` URL leaked into an email | Search the `.gs` for `getService().getUrl()` — should be zero hits |
| Staff discount vanished after customer edit | Journal not written by a new mutation | Does the new code call `ensureManual_()`? |
| Change deployed but nothing happened | "New deployment" used instead of "New version," or no hard-refresh | Manage deployments — is there a second, newer URL? |
| Feature works for Chris, fails for staff | Missing OAuth scope grant, or a permission gate | Run the function once from the editor; check `requireAuth_` perm string |
| Balance shows $0.00 when a refund is owed | Something re-introduced `Math.max(0, ...)` | Grep for `Math.max(0` near balance math |
| Land unit told it's "back in the water" | New email text bypassed `isLandUnit_` | Check the kind in `buildEmailFor_` |
