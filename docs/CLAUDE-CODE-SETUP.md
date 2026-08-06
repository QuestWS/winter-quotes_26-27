# Getting Claude Code running on this project

One-time setup, then a routine you'll repeat all season.

---

## One-time

### 1. Get the repo onto your computer
Claude Code works on local files. Install Claude Code (see
`https://docs.claude.com` for current install steps for your OS), then clone:

```bash
git clone https://github.com/QuestWS/winter-quotes_26-27.git
cd winter-quotes_26-27
```

### 2. Add the handoff files
Copy into the repo root:

```
CLAUDE.md                       <- Claude Code reads this automatically
docs/ESCALATION.md
docs/CLAUDE-CODE-SETUP.md       (this file)
tools/snapshot.sh
tools/verify.sh
```

### 3. Add the Apps Script file to the repo
Right now the `.gs` lives only in the Apps Script editor and in your downloads.
Put a copy in the repo root as `quote-logger-apps-script.gs` and commit it.
This gives the backend the same version history the HTML files already have —
and it's what makes `tools/verify.sh` able to check URL sync across all three.

The repo is **not** the deployment for that file; it's the safety net. You
still paste into the editor and deploy a new version.

### 4. Commit
```bash
git add -A
git commit -m "Add project brief, escalation protocol, and verify tooling"
git push
```

---

## The routine, every time you work

```bash
cd winter-quotes_26-27
git pull                                  # in case you edited on GitHub's site
bash tools/snapshot.sh "about to add X"   # 30 seconds of insurance
claude                                    # start Claude Code
```

Then just describe what you want. Claude Code reads `CLAUDE.md` on its own —
you don't need to explain the project each time.

When it says it's done:

```bash
bash tools/verify.sh      # must print ALL CHECKS PASSED
```

Then deploy — **the same rituals as always**:
- `.gs` → paste into the Apps Script editor → Save →
  **Manage deployments → pencil → New version → Deploy**
- HTML → `git push`, or paste on GitHub's site → Commit → hard-refresh

Finally, commit whatever changed:
```bash
git add -A && git commit -m "what changed" && git push
```

---

## Habits that keep it cheap and safe

- **One task per session.** "Add a field to the console" is a session. Ten
  unrelated tweaks in one long session costs the same way a long chat does.
- **Name the file.** "In `admin/index.html`, the storage view should…" beats
  "the storage thing" — it stops Claude Code reading files it doesn't need.
- **Ask it to verify before you deploy.** "Run `tools/verify.sh` and show me
  the output" should be the last thing in every session.
- **Let it escalate.** If it says it wants to hand back to chat, that's the
  protocol working, not a failure. See `docs/ESCALATION.md`.
- **Snapshot before anything touching money, locks, or the journal.**

---

## What Claude Code is better at than chat

- Editing files in place instead of regenerating whole documents
- Reading only the relevant part of a 2,100-line file
- Running the syntax check and feature sweep itself
- Committing to git with a real message
- Multi-file consistency (e.g. renaming a payload field across all three)

## What chat is still better at

- Designing something new where you want to talk it through
- Reacting to screenshots — "this looks wrong on my phone"
- Wording decisions for customer-facing copy
- Anything where you want the reasoning laid out before code exists

Use both. Design in chat, maintain in Claude Code.
