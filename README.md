# Quest Watersports — Winter Services Quote & Invoice System

Customer quoting, e-signature, payment, storage tracking, photo documentation,
and seasonal customer communication for Quest Watersports' winter program.

| Path | Deploys to |
|---|---|
| `index.html` | GitHub Pages root — customer quote page |
| `admin/index.html` | GitHub Pages `/admin/` — staff console (PIN-gated) |
| `quote-logger-apps-script.gs` | Google Apps Script bound to the Winter Quotes sheet |

## Start here (new account? read in this order)
- **`docs/NEW-ACCOUNT-SETUP.md`** — standing up the Quest Claude account + Claude Code + GitHub. **Do this first.**
- **`CLAUDE.md`** — architecture, conventions, invariants, known traps. The project's memory; Claude Code reads it automatically.
- **`docs/TASK-pricing-engine.md`** — the current priority build (why you're here).
- **`docs/CLAUDE-CODE-SETUP.md`** — the day-to-day working routine.
- **`docs/ESCALATION.md`** — rollback paths and when to hand back to a chat session.

## Before you deploy
```bash
bash tools/verify.sh     # syntax + feature sweep + URL sync; must pass
```

## Before anything risky
```bash
bash tools/snapshot.sh "what I'm about to try"
```

## Deploy
- **Apps Script:** paste → Save → Manage deployments → pencil → **New version** → Deploy.
  Never "New deployment" — it mints a new URL and orphans both front ends.
- **Pages:** commit → hard-refresh (Ctrl+Shift+R).
