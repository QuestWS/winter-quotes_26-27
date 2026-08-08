# Restoring from a nightly backup

Every evening at 6pm the system emails `chris@questwatersports.com` a full
`.xlsx` of the spreadsheet — every tab, every quote, every payment. This is how
you put one of those back if something goes wrong.

**Admin only.** The Restore option only appears for accounts with the admin
flag.

---

## One-time setup — do this once, before the first restore

Reading an uploaded backup needs two permissions this script has never used:
opening a spreadsheet *by ID* (rather than the one it lives in), and uploading
to Drive so Google can convert the `.xlsx` into something readable.

Google will not grant a new permission silently. Until it's approved, the
feature fails — and because this web app runs under your account with public
access, an un-approved permission can affect **the customer quote page too**,
not just the console. So we approve it while nothing is live.

1. Open the Winter Quotes spreadsheet → **Extensions → Apps Script**
2. In the function dropdown at the top (it usually says `doGet`), choose
   **`checkRestoreAccess`**
3. Click **Run**
4. Google will show a permissions screen. Click **Review permissions**, choose
   **questwsottawa@gmail.com**, click **Advanced → Go to (project name)**, then
   **Allow**.
   - This screen is normal. It's the same one you saw when the project was
     first set up.
5. Look at the **Execution log** at the bottom. Success looks like:

   ```
   1/2 Sheets: reopened "Winter Quotes 2026-2027" by id — OK.
   2/2 Drive API: OK.
   Both permissions are granted. The backup restore will work — safe to deploy.
   ```

If you see anything else, stop and send me the log — don't deploy yet.

`checkRestoreAccess` only reads. It reopens the same spreadsheet and asks Drive
who you are. It changes nothing.

---

## Restoring

1. Find a nightly backup email and **save the `.xlsx` attachment** to your phone
   or computer. Pick the most recent one from *before* the problem started.
2. Staff console → menu (☰) → **Restore from backup**
3. **Choose a backup file** → pick the `.xlsx` you saved
4. Wait a moment. It reads the file and shows you a comparison:

   | Section | What it means |
   |---|---|
   | **Missing from the sheet** | In the backup, gone from the live sheet. These are what a restore puts back. |
   | **In both, but different now** | Exists in both, changed since. Only restored if you choose the second button. |
   | **On the sheet but not in this backup** | Taken since the backup. **Never touched**, whatever you choose. |

5. Choose one:
   - **Put back the N missing quote(s)** — the safe one. Only fills gaps.
   - **Also overwrite the N that differ** — replaces changed quotes with the
     backup's version. Use this when something corrupted quotes rather than
     deleting them.
6. Confirm. It reports how many were restored and links the snapshot.

---

## What it will never do

- **Delete a quote.** Restoring only writes rows the backup knows about. A
  quote taken after the backup stays exactly as it is, under either option.
- **Run without a safety net.** Every restore saves the current spreadsheet to
  Drive first, named `… — before restore <date> <time>.xlsx`, in the season
  folder. If a restore makes things worse, that file is the way back.
- **Happen by accident.** Uploading only reads and reports. Nothing is written
  until you press a restore button and confirm.

Every restore is written to the **Activity Log** tab with who did it, how many
quotes, and a link to the snapshot.

---

## Undoing a restore

The pre-restore snapshot is an ordinary backup file. Restore *it* the same way:
console → Restore from backup → choose the `… — before restore …xlsx` from the
season Drive folder → **Also overwrite** so it puts everything back as it was.

---

## If something goes wrong

| Message | Cause | Fix |
|---|---|---|
| `Drive could not read that file` | Not an `.xlsx`, or a partial download | Re-save the attachment from the email; don't rename it |
| `That file has no quote tabs in it` | Wrong file (a PDF, a photo, a different spreadsheet) | Use a nightly backup attachment |
| `Upload the backup again — the reference expired` | Too long between reading and restoring | Upload the file again and redo it |
| `Admins only` | Account isn't an admin | Ask Chris or Jeff |
| Permission errors mentioning Drive or Sheets | The one-time setup above was skipped | Run `checkRestoreAccess` |

---

## Staff accounts

Same menu, **Staff & permissions**:

- **Create account** — name, tick the permissions, optionally Admin. The new
  PIN is shown **once**, in a gold box. Write it down; if it's lost use
  **Reset PIN**.
- **Remove** — next to each person. Their PIN stops working immediately and
  they're signed out on every device.

Two things the console will refuse, because neither can be undone from here:

- Removing **your own** account (ask the other admin).
- Removing or demoting the **last admin** — make someone else an admin first.

Every account change is recorded in the Activity Log.
