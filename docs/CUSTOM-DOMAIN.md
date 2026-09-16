# winter.questws.com — the customer page's address

**Decided (Sep 2026):** the customer page and staff console move to
`winter.questws.com`. The `questws.com` apex keeps doing what it does today —
redirecting to questwatersports.com — and is not touched.

**The code is done and sitting on this branch. The DNS record is not.**
Read §1 before merging.

---

## 1. Merge order — this one matters

Adding a `CNAME` file tells GitHub Pages to claim the domain, and from that
moment `questws.github.io/winter-quotes_26-27/` **301-redirects to
`winter.questws.com`**. If that hostname does not resolve yet, the redirect
lands nowhere and the live customer page is down — during selling season, with
real quotes in flight.

So:

1. **Add the DNS record first** (§2). On its own it changes nothing — a CNAME
   pointing at `questws.github.io` does nothing at all until Pages claims the
   domain. There is no window where adding it early can hurt.
2. Confirm it resolves (`dig winter.questws.com` from anywhere, or just load
   `http://winter.questws.com` and expect a GitHub 404 — a 404 from GitHub
   means DNS is working and Pages simply has not been told about the domain
   yet, which is exactly the state you want).
3. *Then* merge this branch.

Backing out is one commit: delete `CNAME`, revert `QUOTE_PAGE_URL`, redeploy.
The `github.io` address never stops working, so the fallback is always there.

## 2. The DNS record

One record, at whatever host actually answers for `questws.com` — check the NS
records first, because DNS is often delegated away from the registrar.

```
Type    CNAME
Name    winter
Value   questws.github.io.        ← the account, not the repo path. Keep the trailing dot if the host wants one.
TTL     default / automatic
```

**Do not touch anything else in the zone** — not the apex record doing the
questwatersports.com redirect, not MX, not SPF/DKIM/DMARC. This is an addition,
not an edit.

Then: **repo → Settings → Pages → Custom domain**. It should already read
`winter.questws.com` from the merged `CNAME` file. Wait for the DNS check to go
green and the certificate to issue (usually minutes, allow an hour), then tick
**Enforce HTTPS**.

## 3. What changed in the repo

| File | Change |
|---|---|
| `CNAME` | New. Contains `winter.questws.com`. **Deleting it drops the domain on the next deploy** — Pages reads this file, not a setting. |
| `quote-logger-apps-script.gs` | `QUOTE_PAGE_URL` → `https://winter.questws.com/`. Its only reader is `quoteLink_()`, which every customer-facing quote link goes through — console copy-link, lead follow-up, quote/invoice email, PDF — so one constant moves all of them together. |
| `tools/verify.sh` | New **Custom domain** check: fails if `CNAME` and `QUOTE_PAGE_URL` disagree, or if `CNAME` is empty. Drift here sends customers to a host that is not serving the page, and nothing else would have caught it. |
| `docs/build-guides.py` | The two printed guides that name the addresses. PDFs rebuilt in the same commit. |
| `CLAUDE.md` + `tools/baseline/claude-md-rules.txt` | §1 header table. The baseline is updated deliberately alongside it, which is what the coverage guard wants. |

**Nothing else needed changing**, and that is worth knowing rather than
re-deriving next time:

- **No CORS work.** The save POST is `mode:'no-cors'` fire-and-forget; the
  console POST sends `Content-Type: text/plain`, a simple request with no
  preflight; GET lookups follow the redirect to `googleusercontent.com`, which
  answers `Access-Control-Allow-Origin: *`. Nothing in the backend reads
  `Origin` or `Referer`, so the page works from any host.
- **No path edits.** There is not one root-relative `/…` href across the four
  pages — `favicon.png`, `pricing-engine.js`, `terms-config.js` and
  `../favicon.png` are all relative, so the site relocates intact.
- **The `/exec` URL is untouched.** All three copies still point at
  `script.google.com`; `verify.sh`'s URL-sync check is unaffected.
- **Old links keep working.** `questws.github.io/winter-quotes_26-27/…`
  301s to the new host with the query string intact, so quote links in
  already-sent emails and any printed QR codes still resolve. Nothing expires
  this; it holds as long as the repo keeps its name.

## 4. Why not questws.com/winter

GitHub Pages attaches a custom domain to a whole site, never to a path. Getting
`questws.com/winter` would have meant serving the **entire apex** from Pages
(via the existing `QuestWS/questws.github.io` repo) and **renaming this repo**
to `winter` — and a rename kills the old Pages path, which is the quote link in
every email already sent and every QR code already printed. A stub repo can
paper over that, but it is a real failure mode in exchange for four characters
of address.

`winter.questws.com` costs one DNS record, no rename, no apex commitment, and
no risk to links already in customers' hands. If the apex is ever wanted on
Pages anyway, route A is still open and this subdomain keeps working beside it.

**Never use registrar "URL forwarding with masking"** to fake a path. It frames
the page, which breaks the Adobe Sign widget, the payment hand-off and PDF
links, and hides the real address from password managers.

## 5. Deploy and test order

1. DNS record added and resolving (§1, §2).
2. Merge this branch. Hard-refresh (Ctrl+Shift+R).
3. GitHub Pages settings: green DNS check, certificate issued, **Enforce HTTPS**
   ticked.
4. Load `https://winter.questws.com` on a phone, off wifi. Then
   `https://winter.questws.com/admin/`, sign in with a PIN, preview an email —
   **preview only** (CLAUDE.md §4b).
5. Check the old address still redirects:
   `https://questws.github.io/winter-quotes_26-27/?quote=QW-26-1255&ln=White`
   should land on the new host with the quote loaded.
6. **Only then deploy the Apps Script** — Actions → "Deploy Apps Script" → Run
   workflow. (Never "New deployment.") Until this runs, emails still send the
   old link, which still redirects, so there is no rush and no breakage.
7. From the console, copy a quote link for **QW-26-1255** and click it. It
   should read `winter.questws.com`.
8. Run `emailGuides()` so Chris gets the rebuilt PDFs with the new address.

**Emails already sent are frozen** — they keep the old link forever. That is
fine, because the redirect is what makes it fine.

## 6. Loose ends to tidy after it is live

- Shopify storefront: menu item or button pointing at the quote page.
- Google Business Profile, Facebook, Instagram bio.
- Email signatures.
- Staff text-message templates.
- Printed QR codes and flyers already in the yard — these keep working via the
  redirect. Anything printed *from now on* should carry the new address.
- **Adobe Sign**, when the web form lands (CLAUDE.md §8): embedded widgets can
  be restricted to allowed domains. If that restriction is on, add
  `winter.questws.com` in the Acrobat Sign admin or signing fails silently.
