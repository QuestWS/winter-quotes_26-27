# Deploying the Apps Script from GitHub (no more pasting)

One-time setup, then every future backend deploy is a button click.

**What this replaces:** paste the whole `.gs` into the editor → Save → Manage
deployments → pencil → New version → Deploy.

**What stays true:** it still updates the *existing* deployment, so the
`/exec` URL never changes. That rule (CLAUDE.md §2) is now enforced by the
tool instead of by remembering it — the workflow calls
`clasp update-deployment <id>`, which cannot mint a new URL.

---

## Why setup needs you (and not Claude)

Claude has no access to the Google account, by design. Steps 1–5 capture two
things only you can get: the **project's real manifest** and a **credential**
that lets GitHub act on your behalf. After that, Claude edits the `.gs` in the
repo and you click Run.

You do **not** need to install anything on your computer. Everything below runs
in **Google Cloud Shell**, a free terminal in your browser.

---

## Step 1 — Turn on the Apps Script API

1. Go to **https://script.google.com/home/usersettings**
2. Sign in as **questwsottawa@gmail.com**
3. Set **Google Apps Script API** to **ON**

Without this, every push fails with a "User has not enabled the Apps Script
API" error.

---

## Step 2 — Collect two IDs

**Script ID:**
1. Open the Winter Quotes spreadsheet → **Extensions → Apps Script**
2. In the editor: **Project Settings** (the gear, left sidebar)
3. Copy **Script ID** — a long string of letters and numbers

**Deployment ID — you already have this one.** It is the long string in the
middle of the web app URL, between `/macros/s/` and `/exec`. For this project
that is:

```
AKfycbxv8kqGKXU_4-9TytfWzdrv-QqqmyrYLxRwd8FDfA8b47sX3NlEBNDlIwIHRuQObZbL9w
```

> If you ever need to confirm it: **Deploy → Manage deployments**, click the
> active deployment, and check the Deployment ID matches the string above. If
> it doesn't, stop — you may be looking at the abandoned duplicate deployment
> (`AKfycbwEWDAuZM93…`), which must stay archived.

---

## Step 3 — Capture the real manifest

This is the step that protects you. `appsscript.json` holds the OAuth scopes
and the web app's **"Who has access"** setting. If GitHub ever pushed a wrong
manifest, the customer page could start returning Google error pages. So we
copy the live one into the repo and push exactly that, forever after.

1. Open **https://shell.cloud.google.com** (signed in as questwsottawa@gmail.com)
2. Click **Continue** if it asks to provision
3. Run, pasting your Script ID from step 2:

```bash
npm install @google/clasp@3.3.0
npx clasp login --no-localhost
```

Follow the link it prints, approve, paste the code back.

```bash
mkdir ~/quest && cd ~/quest
npx clasp clone-script PASTE_YOUR_SCRIPT_ID_HERE
ls -la
cat appsscript.json
```

> Replace `PASTE_YOUR_SCRIPT_ID_HERE` with the ID itself and **no brackets**.
> A pasted `<...>` makes bash try to read from a file and you get
> `syntax error near unexpected token`, with an empty folder to show for it.

4. Note the **filename** of the code file it pulled — usually `Code.js`
   (clasp writes `.gs` files locally as `.js`). If it's something else, you'll
   need it in step 5.
5. Copy the contents of `appsscript.json` — you'll commit it in step 6.

---

## Step 4 — Copy the credential into GitHub

Still in Cloud Shell. Use **base64** rather than `cat` — it collapses the
credential to a single line, which survives copying out of a wrapping terminal
and keeps GitHub from masking every `}` in future build logs:

```bash
base64 -w0 ~/.clasprc.json
```

Copy the **entire** single line of output.

> The workflow accepts either base64 or raw JSON, and tells you plainly if the
> value arrived corrupted — but base64 is what avoids the corruption in the
> first place. A plain `cat` of a pretty-printed credential is easy to break on
> copy, and the resulting error (`Unexpected non-whitespace character after
> JSON`) points at nothing useful.

> This is a key to your Google account. Treat it like a password: it goes into
> the GitHub **secret** box and nowhere else — not into a file in the repo, not
> into a chat, not into an email. Unlike the short-lived code from the login
> step, this one stays valid until revoked.
>
> If it ever leaks, `npx clasp logout` then `npx clasp login` mints a new one
> and invalidates the old.

1. GitHub → `QuestWS/winter-quotes_26-27` → **Settings**
2. **Secrets and variables → Actions → Secrets** tab
3. **New repository secret**
   - Name: `CLASPRC_JSON`
   - Value: paste the whole JSON blob
4. **Add secret**

---

## Step 5 — Add the two IDs as variables

Same page, **Variables** tab (not Secrets — these aren't credentials, and
having them visible makes the workflow easier to check):

| Name | Value |
|---|---|
| `SCRIPT_ID` | the Script ID from step 2 |
| `DEPLOYMENT_ID` | the Deployment ID from step 2 |
| `REMOTE_FILE_NAME` | only if step 3's file was **not** `Code` — enter the name without its extension |

---

## Step 6 — Commit the manifest

The repo needs `apps-script/appsscript.json` — the file you read in step 3.
Either paste its contents to Claude and ask for it to be committed, or add it
yourself: GitHub → **Add file → Create new file** → path
`apps-script/appsscript.json` → paste → Commit.

The workflow refuses to run without it, on purpose.

---

## Deploying, from now on

1. GitHub → **Actions** tab
2. **Deploy Apps Script** in the left list
3. **Run workflow**
4. Fill in **What changed?** — this becomes the version description in the
   Apps Script version list, so write something you'd want to read while
   rolling back at 7am
5. Leave mode as **push-and-deploy** (use **push-only** to upload code without
   making it live)
6. **Run workflow**

It runs `tools/verify.sh` first and **stops before touching the backend if
anything fails**. Then it pushes the code, cuts an **immutable version**, and
points the existing deployment at that version by number — exactly the manual
ritual, in the same order.

That version number matters. If the deploy ever pointed at `@HEAD` instead,
there would be nothing pinned in the Version dropdown to roll back to, and
every later push would go live the instant it landed. `verify.sh` fails the
build if the workflow stops cutting versions.

Takes about a minute. Green check = live.

---

## What still needs a human

- **New OAuth scopes.** If a change uses a Google capability the project
  hasn't used before (a new Drive or Gmail permission), you must still run the
  function once from the editor and approve the popup. Otherwise it fails
  silently at runtime for everyone — CLAUDE.md §2.3.
- **Anything edited directly in the Apps Script editor.** The push overwrites
  the whole project. If you hand-edit in the editor, re-run step 3 to re-capture
  the manifest, or the next deploy reverts it.
- **The customer page and console** are still GitHub Pages — they go live on
  commit, no workflow needed. Hard-refresh after.

---

## Rolling back

Unchanged, and still the fastest undo you have:

**Apps Script editor → Deploy → Manage deployments → pencil → Version
dropdown → pick the previous version → Deploy.** About ten seconds.

You can also re-run the workflow from an older commit: **Actions → Deploy Apps
Script → Run workflow →** change the branch/tag selector to the commit you
want.

---

## If it fails

| Message | Cause | Fix |
|---|---|---|
| `User has not enabled the Apps Script API` | Step 1 skipped | Turn it on, wait a minute, re-run |
| `Missing secret CLASPRC_JSON` | Step 4 skipped or misnamed | Name must be exactly `CLASPRC_JSON` |
| `invalid_grant` / auth errors | The refresh token was revoked or expired | Redo steps 3–4 to mint a fresh credential |
| `CLASPRC_JSON could not be parsed` | The value was corrupted on copy | Re-store it with `base64 -w0 ~/.clasprc.json` |
| Logs show `***` where `}` should be | The secret was stored multi-line, so GitHub masks each line | Harmless, but re-storing as base64 clears it |
| `apps-script/appsscript.json is missing` | Step 6 skipped | Commit the manifest |
| verify.sh failures | The tree is broken | Fix first — this is the guard working |
| Pushed fine but nothing changed | You used **push-only** | Re-run with **push-and-deploy** |
