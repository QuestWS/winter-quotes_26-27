# Moving the customer page to questws.com

**Status:** proposed, nothing changed yet. Decisions and data needed from
Chris are in §6 — that list is the whole blocker.

**The short answer:** yes. The system is three static files on GitHub Pages
plus an Apps Script backend at a `script.google.com` address. Only the *page*
moves. The backend, the spreadsheet, the Drive folders, the PDFs, the PINs and
every deployment ritual stay exactly where they are. The code change is
**one constant and one text file** (§4).

---

## 1. The one thing that is not free

GitHub Pages attaches a custom domain to a **whole site**, never to a path. You
cannot point `questws.com/winter` at this repo while something else serves
`questws.com/`. The path has to come from somewhere. Three ways to get it:

| Route | Final URL | What it costs |
|---|---|---|
| **A — apex takeover** (recommended) | `questws.com/winter` | The whole `questws.com` apex must be served by GitHub Pages. The account already has a `QuestWS/questws.github.io` repo, which is what would serve `questws.com/` itself. Repo gets renamed `winter-quotes_26-27` → `winter`. |
| **B — subdomain** | `winter.questws.com` | Nothing else about the domain changes. One DNS record, no rename, no apex commitment. 15 minutes end to end. |
| **C — redirect only** | `questws.com/winter` → lands on B or on the current Pages URL | Keeps the apex wherever it is. The address bar changes to the real URL after the jump. Needs a DNS/CDN host that does path-level redirect rules (Cloudflare does, free; most registrar "forwarding" does not do paths well). |

Route A is the only one that literally *is* `questws.com/winter`. It is
achievable here because `QuestWS` already owns a `questws.github.io` repo — the
account-level Pages site — and once a custom domain is set on that repo, every
other repo on the account serves at `questws.com/<repo-name>`.

**Do not use domain masking / frame forwarding** for route C. Some registrars
offer it as "URL forwarding with masking." It puts the quote page inside a
hidden frame, which breaks the Adobe Sign widget, breaks the payment hand-off,
breaks PDF links, and hides the real address from the customer's password
manager. It looks like the cheap win and it is not.

## 2. What does not change, and why that matters

- **The Apps Script URL.** All three copies of `/exec` keep pointing at
  `script.google.com`. `verify.sh`'s URL-sync check keeps passing untouched.
- **CORS.** The save POST is `mode:'no-cors'` fire-and-forget; the console POST
  sends `Content-Type: text/plain`, which is a simple request with no preflight;
  GET lookups follow the redirect to `googleusercontent.com`, which answers
  `Access-Control-Allow-Origin: *`. Nothing in the backend reads `Origin` or
  `Referer`. **The page works from any domain with no backend change.**
- **Every asset path is relative** (`favicon.png`, `pricing-engine.js`,
  `terms-config.js`, `../favicon.png` from `/admin/`). There is not a single
  root-relative `/…` href in the four pages, so the whole site relocates without
  a path edit. `verify.sh`'s favicon walker keeps passing.
- **The old URL keeps working.** Once a custom domain is set, GitHub Pages
  301-redirects `questws.github.io/<repo>/…` to the custom domain, query string
  intact. Quote links in already-sent emails survive — *unless the repo is
  renamed*, see §5.
- **HTTPS is free and automatic** (Let's Encrypt, issued by GitHub once DNS
  resolves). Tick **Enforce HTTPS** after the cert appears.

## 3. DNS records

**Route A (apex).** At the DNS host for `questws.com`, four A records on the
apex (`@`), all four, no substitutions:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Optional AAAA for IPv6:

```
2606:50c0:8000::153   2606:50c0:8001::153
2606:50c0:8002::153   2606:50c0:8003::153
```

Plus `www` as a CNAME to `questws.github.io.`

Then in **QuestWS/questws.github.io → Settings → Pages → Custom domain**, enter
`questws.com`, save, wait for the DNS check to go green, tick Enforce HTTPS.

**Route B (subdomain).** One record, and the apex is untouched:

```
winter   CNAME   questws.github.io.
```

Then set `winter.questws.com` as the custom domain on **this** repo
(`winter-quotes_26-27` → Settings → Pages). GitHub writes a `CNAME` file into
the repo root; leave it there — deleting it drops the domain on the next deploy.

**Either route: do not delete existing MX, TXT/SPF, DKIM or DMARC records.**
Changing A records does not affect mail, but a "clear it out and start fresh"
edit does. Export the zone before touching anything.

## 4. The code change

Three files. That is the entire diff.

1. **`quote-logger-apps-script.gs` line 116** — `QUOTE_PAGE_URL`. Every
   customer-facing quote link in the system is built by `quoteLink_()`
   (line ~5093), which is the only reader of this constant. Console copy-link,
   lead follow-up email, quote/invoice email and the PDF all go through it, so
   one edit moves all of them together.
   - Must keep the **trailing slash**.
   - Requires a **redeploy** (Actions → "Deploy Apps Script" → Run workflow;
     or Deploy → Manage deployments → pencil → New version. **Never** "New
     deployment.")
   - **Emails already sent are frozen** — old links keep pointing at the Pages
     URL. That is fine while the GitHub redirect holds (§2), and is the reason
     §5 matters.
2. **`docs/build-guides.py`** lines ~409 and ~778 — the two printed guides name
   the console and quote-page addresses in body text. Rebuild
   (`python3 docs/build-guides.py`), commit, then run `emailGuides()` so Chris
   gets the corrected PDFs.
3. **`CLAUDE.md`** §1 — the two URLs in the header table.

No change to `index.html`, `admin/index.html`, `pricing-engine.js` or any
`INTEGRATIONS` value.

## 5. The rename trap (route A only)

Renaming `winter-quotes_26-27` → `winter` is what produces the `/winter` path.
GitHub redirects the *repository* URL after a rename; **do not assume it
redirects the old Pages path.** Treat `questws.com/winter-quotes_26-27/` as
dead the moment the rename lands — which kills the quote link in every email
sent so far this season.

Mitigation, done in the same sitting as the rename: create a new empty repo
named `winter-quotes_26-27`, enable Pages on it, and put a single `index.html`
in it that carries the query string across:

```html
<!doctype html><meta charset="utf-8">
<title>Quest Watersports — Winter Services</title>
<script>location.replace('https://questws.com/winter/' + location.search);</script>
<p><a href="https://questws.com/winter/">Continue to your quote</a></p>
```

Keep it for at least one full season. It costs nothing and it is the difference
between an old email link working and a customer seeing a 404.

Route B has no rename and therefore no trap.

## 6. What Chris needs to supply

Nothing here needs code — it is all access and facts.

**Decisions (answer these first; everything else depends on them)**
1. Route **A**, **B** or **C**? A = `questws.com/winter`, B =
   `winter.questws.com`, C = `questws.com/winter` as a redirect.
2. If A: **what should `questws.com/` itself show?** Taking the apex means
   GitHub Pages answers the bare domain. A one-page landing, or a redirect to
   questwatersports.com, both fine — but it has to be decided, because that is
   what `QuestWS/questws.github.io` will serve.
3. If A: **is renaming the repo to `winter` approved?** (Path spelling is the
   repo name: `/winter`, `/winter-quotes`, `/quote` — pick one.)

**Domain and DNS**
4. **Registrar** holding `questws.com` (GoDaddy / Namecheap / Google–Squarespace
   / other) and login access.
5. **Where DNS is actually hosted** — the registrar's own nameservers, or
   delegated to Cloudflare/another host. Check the NS records; this is where the
   A/CNAME record gets added, and it is often *not* the registrar.
6. **A full export of the current zone** — every record, not just the ones that
   look relevant. Screenshot of the DNS page is enough.
7. **What `questws.com` does today** — parked, forwarding to
   questwatersports.com, running a site, or nothing? If it currently forwards,
   that forwarding rule must be removed before GitHub Pages can answer, and
   whatever it forwarded to needs a new home (see decision 2).
8. **Does `questws.com` carry email?** Any `@questws.com` mailbox or SPF/DKIM
   record means MX and TXT records must be preserved verbatim.
9. Whether the domain is due to **renew**, and that auto-renew is on. A lapsed
   domain takes the whole customer-facing form down; the current Pages URL never
   expires.

**GitHub**
10. **Owner-level access to the `QuestWS` account** — Settings → Pages on both
    repos, and the rename. Confirm who holds it.
11. Whether `QuestWS/questws.github.io` (created Aug 2026) is already serving
    something that matters, or is free to become the apex site. *(Not readable
    from this session — it is outside the repo scope granted here.)*

**Downstream links to fix afterward**
12. A list of every place the current address is printed or linked, so they get
    updated once the domain is live:
    - the Shopify storefront (menu item / button / page)
    - Google Business Profile, Facebook, Instagram bio
    - email signatures
    - any **printed QR codes or flyers already in the yard** — these are the
      expensive ones; a QR code cannot be edited after printing, so it must keep
      resolving (§5 is what protects it)
    - text-message templates staff use by hand
13. **Adobe Sign**, when the web form lands (§8 of CLAUDE.md): embedded widgets
    can be restricted to allowed domains. If that restriction is on, the new
    domain must be added in the Acrobat Sign admin, or signing silently fails
    on the new address.

## 7. Order of operations

1. Answer §6.1–§6.3.
2. Add the DNS records (§3). Wait for propagation — usually minutes, allow an hour.
3. Set the custom domain in GitHub Pages settings. Wait for the green check and
   the certificate, then tick **Enforce HTTPS**.
4. Load the new address on a phone, off wifi. Build a test quote on
   **QW-26-1255** only, save it, reload it by quote number and last name.
5. Open the console at the new `/admin/` address, log in with a PIN, preview an
   email. (Preview only — §4b of CLAUDE.md.)
6. Only then edit `QUOTE_PAGE_URL`, run `bash tools/verify.sh`, commit, and
   deploy the Apps Script.
7. Send yourself the quote link from the console and click it.
8. Rename the repo and stand up the stub (§5), if route A.
9. Update the printed guides and the downstream links (§6.12).

**Rollback** at any point: remove the custom domain in Pages settings and revert
`QUOTE_PAGE_URL`. The `github.io` address never stops working, so the fallback
is always one setting away.
