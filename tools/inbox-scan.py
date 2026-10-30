#!/usr/bin/env python3
"""The nightly inbox scan: chris@questwatersports.com -> the Inbox Review tab.

chris@ is on our own mail server, not Gmail, and Apps Script cannot speak
IMAP. So this runs in GitHub Actions (.github/workflows/scan-inbox.yml), reads
the mailbox, pulls out what matters -- who sent it, quote numbers, dollar
amounts, what it seems to be about -- and posts that to the backend
(inboxServe_ in the .gs), which matches it against the quotes and writes the
tab. The backend decides what a message means; this only reads and extracts.

Three rules this file keeps, and why:

- READ-ONLY. Every fetch is BODY.PEEK and the folder is opened read-only, so
  a scanned message stays unread in Chris's mail client. Nothing is moved,
  flagged or deleted.
- NO CUSTOMER DETAIL IN THE LOG. The repo is public and so are its Actions
  logs. Only counts are printed -- never an address, a subject or a name.
- THE URL IS READ FROM THE .gs (WEB_APP_URL), not written here, so this does
  not become a sixth copy of the deployment URL to keep in sync.

Environment (all from Actions secrets/variables):
  IMAP_HOST       default questwatersports.com (the host's published IMAP server)
  IMAP_PORT       default 993 (SSL)
  IMAP_USER       the mailbox login, usually chris@questwatersports.com
  IMAP_PASSWORD   its password
  IMAP_FOLDERS    comma-separated, default INBOX
  INBOX_SCAN_KEY  same value as the INBOX_SCAN_KEY Script Property
  SCAN_DAYS       how far back to look, default 3

`--dry-run` extracts and prints counts without posting anything.
"""
import datetime
import email
import email.header
import email.policy
import email.utils
import hashlib
import html
import imaplib
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATCH = 40

OWN_DOMAINS = ('questwatersports.com',)
OWN_ADDRESSES = ('questwsottawa@gmail.com',)
AUTOMATED_RE = re.compile(r'(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|bounce)', re.I)

QN_RE = re.compile(r'\bQW-?\d{2}-?\d{3,5}\b', re.I)
# "$1,234.56", "$ 450", "450.00 dollars"
AMOUNT_RE = re.compile(r'\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?|\b(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\s*(?:dollars|usd)\b', re.I)

SIGNALS = {
    'payment': r'\b(paid|payment|pay(?:ing)?|check|cheque|venmo|zelle|paypal|square|stripe|deposit|'
               r'credit card|debit|wire|transfer(?:red)?|receipt|refund|invoice)\b',
    'cancel': r'\b(cancel+(?:ed|ing|ation)?|not (?:be )?storing|won\'?t (?:be )?(?:storing|needing)|'
              r'sold (?:the|my|our) (?:boat|ski|jet ?ski|cart|bike)|no longer need|selling (?:the|my|our))\b',
    'contact': r'\b(new (?:phone|cell|number|email|address)|changed my (?:number|email|address)|'
               r'moved to|my new)\b',
    'schedule': r'\b(pick ?up|drop ?off|launch|retriev\w*|haul(?:ed|ing)? ?out|deliver\w*|'
                r'in the water|spring|bring (?:it|her) (?:in|over))\b',
    'service': r'\b(winteriz\w*|shrink ?wrap|detail(?:ing)?|bottom paint|impeller|oil change|repair|'
               r'estimate|quote|service|storage|store (?:it|my|our))\b',
    'signature': r'\b(sign(?:ed|ature)?|contract|agreement|adobe|docusign)\b',
}
SIGNALS = {k: re.compile(v, re.I) for k, v in SIGNALS.items()}

# The point where a reply stops and the quoted original begins. Amounts and
# signals come only from above it -- otherwise every reply to a quote email
# "mentions a payment" because our own email did. Quote numbers come from the
# whole message: a reply that only quotes the number still names the quote.
QUOTE_CUT_RE = re.compile(
    r'^\s*(On .{0,200}wrote:|-{2,}\s*Original Message|From:\s.+|Sent from my \w+|_{5,})\s*$',
    re.I | re.M)


def env(name, default=''):
    return os.environ.get(name, default).strip()


def web_app_url():
    with open(os.path.join(ROOT, 'quote-logger-apps-script.gs'), encoding='utf-8') as f:
        m = re.search(r"^const WEB_APP_URL = '([^']+)';", f.read(), re.M)
    if not m:
        sys.exit('WEB_APP_URL not found in quote-logger-apps-script.gs')
    return m.group(1)


def decode(v):
    try:
        return str(email.header.make_header(email.header.decode_header(v or '')))
    except Exception:
        return str(v or '')


def body_text(msg):
    """The plain text of a message: its text/plain part, or its HTML stripped."""
    plain, htm = None, None
    for part in msg.walk():
        if part.is_multipart() or part.get_content_disposition() == 'attachment':
            continue
        ct = part.get_content_type()
        try:
            text = part.get_content()
        except Exception:
            payload = part.get_payload(decode=True) or b''
            text = payload.decode(part.get_content_charset() or 'utf-8', 'replace')
        if ct == 'text/plain' and plain is None:
            plain = text
        elif ct == 'text/html' and htm is None:
            htm = text
    if plain is not None:
        return plain
    if htm is None:
        return ''
    htm = re.sub(r'(?is)<(script|style).*?</\1>', ' ', htm)
    htm = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</tr>', '\n', htm)
    htm = re.sub(r'(?i)<blockquote', '\nOn x wrote:\n<blockquote', htm, count=1)
    return html.unescape(re.sub(r'<[^>]+>', ' ', htm))


def amounts_in(text):
    out = []
    for m in AMOUNT_RE.finditer(text):
        whole, cents = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), '.' + m.group(4))
        try:
            n = float(whole.replace(',', '') + (cents or ''))
        except ValueError:
            continue
        if 0 < n < 1_000_000 and n not in out:
            out.append(n)
    return out[:8]


def is_own(addr):
    addr = addr.lower()
    return addr in OWN_ADDRESSES or any(addr.endswith('@' + d) for d in OWN_DOMAINS)


def extract(raw, mailbox):
    """One raw message -> the item the backend expects, or None to skip it."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    from_name, from_addr = email.utils.parseaddr(decode(msg.get('From')))
    from_addr = from_addr.lower()
    if not from_addr or is_own(from_addr):
        return None
    subject = decode(msg.get('Subject'))
    text = body_text(msg)
    cut = QUOTE_CUT_RE.search(text)
    fresh = text[:cut.start()] if cut else text
    fresh_and_subject = subject + '\n' + fresh

    signals = [k for k, rx in SIGNALS.items() if rx.search(fresh_and_subject)]
    amounts = amounts_in(fresh_and_subject)
    quote_nos = sorted({q.upper() for q in QN_RE.findall(subject + '\n' + text)})

    # Newsletters and robots, unless they are about money or a signature --
    # a card processor's "you received a payment" or Adobe's "signed and
    # filed" is exactly what this scan is for.
    bulk = bool(msg.get('List-Unsubscribe')) or str(msg.get('Precedence', '')).lower() in ('bulk', 'list')
    if (bulk or AUTOMATED_RE.search(from_addr)) and not (
            quote_nos or 'payment' in signals or 'signature' in signals):
        return None

    try:
        when = email.utils.parsedate_to_datetime(msg.get('Date'))
        if when.tzinfo is None:
            when = when.replace(tzinfo=datetime.timezone.utc)
        when = when.isoformat()
    except Exception:
        when = ''
    mid = (msg.get('Message-ID') or '').strip()
    if not mid:
        mid = 'sha1:' + hashlib.sha1((from_addr + when + subject).encode()).hexdigest()

    snippet = re.sub(r'\s+', ' ', fresh).strip()[:400]
    return {'messageId': mid, 'date': when, 'fromName': from_name, 'fromEmail': from_addr,
            'subject': subject, 'quoteNos': quote_nos, 'amounts': amounts,
            'signals': signals, 'snippet': snippet, 'mailbox': mailbox}


def scan(days):
    # The mail host's own setup sheet names questwatersports.com as the IMAP
    # server. mail.questwatersports.com (the MX record) is the same machine,
    # but its TLS certificate may not carry that name, so use theirs.
    host = env('IMAP_HOST', 'questwatersports.com')
    user, password = env('IMAP_USER'), os.environ.get('IMAP_PASSWORD', '')
    if not user or not password:
        sys.exit('IMAP_USER and IMAP_PASSWORD must be set (Actions secrets).')
    folders = [f.strip() for f in env('IMAP_FOLDERS', 'INBOX').split(',') if f.strip()]
    since = (datetime.date.today() - datetime.timedelta(days=days)).strftime('%d-%b-%Y')

    items, skipped = [], 0
    imap = imaplib.IMAP4_SSL(host, int(env('IMAP_PORT', '993')))
    try:
        imap.login(user, password)
        for folder in folders:
            typ, _ = imap.select('"%s"' % folder, readonly=True)
            if typ != 'OK':
                print('  folder %d of %d could not be opened -- skipped' % (folders.index(folder) + 1, len(folders)))
                continue
            typ, data = imap.search(None, 'SINCE', since)
            ids = data[0].split() if typ == 'OK' and data and data[0] else []
            for i in ids:
                typ, parts = imap.fetch(i, '(BODY.PEEK[])')
                raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
                item = extract(raw, user + '/' + folder) if raw else None
                if item:
                    items.append(item)
                else:
                    skipped += 1
            print('  folder %d: %d message(s) since %s' % (folders.index(folder) + 1, len(ids), since))
    finally:
        try:
            imap.logout()
        except Exception:
            pass
    return items, skipped


def post(url, key, items):
    body = json.dumps({'api': 'inbox', 'key': key, 'fn': 'ingest', 'items': items}).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    # Apps Script answers with a redirect to a one-shot URL; urllib follows it
    # as a GET, which is what that URL expects.
    with urllib.request.urlopen(req, timeout=300) as r:
        res = json.loads(r.read().decode())
    if not res.get('ok'):
        sys.exit('Backend refused the batch: ' + str(res.get('error')))
    return res


def main():
    dry = '--dry-run' in sys.argv
    try:
        days = max(1, min(int(env('SCAN_DAYS', '3') or 3), 400))
    except ValueError:
        days = 3
    key = os.environ.get('INBOX_SCAN_KEY', '')
    if not dry and len(key) < 24:
        sys.exit('INBOX_SCAN_KEY is missing or too short (run setupInboxScan() in the Apps Script editor).')

    print('Scanning the last %d day(s)...' % days)
    items, skipped = scan(days)
    print('%d message(s) worth a look, %d skipped (ours, robots, newsletters).' % (len(items), skipped))
    if dry:
        print('Dry run -- nothing posted.')
        return

    url = web_app_url()
    added = dup = noise = 0
    for i in range(0, len(items), BATCH):
        res = post(url, key, items[i:i + BATCH])
        added += res.get('added', 0)
        dup += res.get('duplicates', 0)
        noise += res.get('skipped', 0)
    print('Inbox Review: %d new row(s), %d already there, %d not matched to anything.' % (added, dup, noise))


if __name__ == '__main__':
    main()
