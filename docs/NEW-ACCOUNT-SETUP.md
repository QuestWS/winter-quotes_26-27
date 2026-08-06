# Setting up the Quest Watersports Claude account (start here)

This project is moving from a personal Claude account to a dedicated **Quest
Watersports** account, working in **Claude Code** with direct access to the
Quest GitHub. This document is the checklist for standing that up. A brand-new
Claude has none of the history from the chat sessions that built this system —
everything it needs is in this repo, and `CLAUDE.md` is the first thing it
reads.

---

## What you're setting up, and why

- **A Quest Claude account** (not your personal one) so the work, billing, and
  history belong to the business, not to you personally.
- **Claude Code with GitHub access** so Claude edits the real files in place
  and commits real diffs — no more paste-into-editor, no silent-replace risk,
  proper version history on every change.
- **The Quest GitHub** (`QuestWS`) as the single home for all three files,
  including the Apps Script `.gs` (which until now lived only in the editor).

---

## Checklist

### 1. Create the Quest Claude account
- Sign up at claude.ai with a **Quest email** (e.g. chris@questwatersports.com
  or a shared ops address). Not your personal address.
- A paid plan is what unlocks Claude Code comfortably; check current plan
  details at `https://claude.ai` — plans change, so don't trust anything a
  prior session \"remembers\" about tiers or limits. Verify live.

### 2. Confirm the Quest GitHub org/account
- The repo is **`QuestWS/winter-quotes_26-27`**. Confirm you can sign into that
  GitHub account (the Quest one, not a personal one you may have used recently).
- If the repo currently lives under a personal account, transfer it to the
  Quest `QuestWS` org first (GitHub → repo Settings → Transfer ownership), so
  the business owns it. Update the Pages URL if it changes (see §6 below).

### 3. Install Claude Code
- Follow the current install steps for your OS at `https://docs.claude.com`.
  (Install specifics change; use the live docs, not remembered instructions.)
- Sign Claude Code into the **Quest** Claude account from step 1.

### 4. Connect Claude Code to GitHub
- Authorize Claude Code / the GitHub connection for the **Quest** GitHub, scoped
  to the `winter-quotes_26-27` repo. Follow the current in-product flow.
- Verify by asking Claude Code to read `CLAUDE.md` and summarize the project —
  if it can, the connection and the brief are both working.

### 5. Put ALL THREE files in the repo
The HTML files already live in the repo. The **Apps Script `.gs` does not** —
until now it lived only in the Apps Script editor. This handoff includes a
current copy. Make sure the repo root contains:

```
index.html                        (customer quote page)
admin/index.html                  (staff console)
quote-logger-apps-script.gs       (the backend — the safety-net copy)
CLAUDE.md, README.md, docs/, tools/
```

The repo is **not** the deployment for the `.gs` — you still paste it into the
Apps Script editor and deploy a new version. The repo copy is the version
history and what lets `tools/verify.sh` cross-check the shared URL.

### 6. If any URL changed during the move
Transferring the repo can change the Pages URL. The system has **one shared
web-app URL in three files** (see `CLAUDE.md` §1). If the GitHub Pages URL or
the Apps Script deployment URL changes, update all three in sync and run
`tools/verify.sh`. If nothing moved, skip this.

### 7. Access the new Claude will NOT have automatically
A fresh account starts blind. Have these ready to hand it or point it at:

- **The live URLs** (customer page, console, spreadsheet) — in `CLAUDE.md` §1.
- **Google account** `questwsottawa@gmail.com` — the Apps Script and Sheet live
  here. Claude Code can edit the `.gs` file, but **you** paste and deploy it in
  the editor (Claude has no access to the Google account, by design).
- **The staff PINs** — printed once by `initStaff()`. If you've lost them, an
  admin resets them from the console; don't re-run `initStaff()` (it refuses
  anyway, to protect the roster).
- **Anything in progress** — the current priority is the pricing-engine
  extraction; its brief is `docs/TASK-pricing-engine.md`.

---

## The mental model for the new setup

**Design and talk-it-through in a chat session. Maintain and build in Claude
Code.** Claude Code is better at editing a 2,000-line file surgically, running
its own syntax checks, keeping three files consistent, and committing clean
history. Chat is better at reacting to a screenshot, wording customer copy, and
designing something new out loud before code exists. You'll use both — this
repo is the shared memory that makes either one pick up where the other left
off.

One caution carried over from the chat era: a new Claude, in Code or chat, does
**not** inherit the hard-won context. It reads `CLAUDE.md`. That file is the
project's memory — keep it current. When something new is learned the hard way
(a bug, a constraint, a decision), it belongs in `CLAUDE.md`, not just in a
commit message.
