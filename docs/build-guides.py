#!/usr/bin/env python3
"""Build the four staff/operator guide PDFs.

Run:  python3 docs/build-guides.py
Out:  docs/pdf/*.pdf

These are written for Chris and the Quest staff, not for developers. Keep the
tone plain, keep every permission level accurate against the code, and never
put a real customer's details in an example — quote numbers only.
"""
import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, Image, KeepTogether)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'pdf')
os.makedirs(OUT, exist_ok=True)

NAVY = colors.HexColor('#14293E')
NAVY2 = colors.HexColor('#1D3A57')
GOLD = colors.HexColor('#C08A22')
FROST = colors.HexColor('#4A81A6')
ICE = colors.HexColor('#EBF1F6')
INK = colors.HexColor('#1D2B38')
MUTED = colors.HexColor('#5C7185')
RED = colors.HexColor('#A6341F')
GREEN = colors.HexColor('#1E6B3A')

S = getSampleStyleSheet()

def st(name, **kw):
    base = kw.pop('parent', S['Normal'])
    return ParagraphStyle(name, parent=base, **kw)

TITLE   = st('QTitle', fontName='Helvetica-Bold', fontSize=23, leading=27,
             textColor=NAVY, spaceAfter=2)
SUBTITLE= st('QSub', fontName='Helvetica', fontSize=11.5, leading=15,
             textColor=MUTED, spaceAfter=16)
H1      = st('QH1', fontName='Helvetica-Bold', fontSize=15, leading=19,
             textColor=NAVY, spaceBefore=17, spaceAfter=6)
H2      = st('QH2', fontName='Helvetica-Bold', fontSize=12, leading=15,
             textColor=NAVY2, spaceBefore=11, spaceAfter=4)
BODY    = st('QBody', fontName='Helvetica', fontSize=10, leading=14.5,
             textColor=INK, spaceAfter=7, alignment=TA_LEFT)
BULLET  = st('QBullet', parent=BODY, leftIndent=15, bulletIndent=4, spaceAfter=4)
SMALL   = st('QSmall', fontName='Helvetica', fontSize=8.8, leading=12,
             textColor=MUTED, spaceAfter=6)
CELL    = st('QCell', fontName='Helvetica', fontSize=8.8, leading=11.8, textColor=INK)
CELLB   = st('QCellB', parent=CELL, fontName='Helvetica-Bold')
CELLH   = st('QCellH', fontName='Helvetica-Bold', fontSize=8.8, leading=11.8,
             textColor=colors.white)
NOTEBODY= st('QNote', fontName='Helvetica', fontSize=9.3, leading=13, textColor=INK)

def P(t, s=BODY):  return Paragraph(t, s)
def B(t):          return Paragraph(t, BULLET, bulletText='•')
def gap(h=6):      return Spacer(1, h)

def note(title, text, tone='gold'):
    """A framed callout. Used sparingly — for things that cost money or data."""
    bg   = colors.HexColor('#FDF3E0') if tone == 'gold' else ICE
    edge = GOLD if tone == 'gold' else FROST
    inner = [Paragraph('<b>%s</b>' % title, NOTEBODY), Paragraph(text, NOTEBODY)]
    t = Table([[inner]], colWidths=[6.6 * inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('BOX', (0, 0), (-1, -1), 1.1, edge),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    return KeepTogether([t, gap(9)])

def table(headers, rows, widths, zebra=True):
    data = [[Paragraph(h, CELLH) for h in headers]]
    for r in rows:
        data.append([c if hasattr(c, 'wrap') else Paragraph(str(c), CELL) for c in r])
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#B9C6D2')),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]
    if zebra:
        for i in range(1, len(data)):
            if i % 2 == 0:
                style.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#F6F9FB')))
    t.setStyle(TableStyle(style))
    return t

PERM_COLOR = {'view': FROST, 'pay': GREEN, 'adjust': GOLD, 'email': NAVY2,
              'photos': MUTED, 'admin': RED}

def perm(p):
    c = PERM_COLOR.get(p, INK)
    return Paragraph('<font color="#%s"><b>%s</b></font>' % (c.hexval()[2:], p), CELL)


class Guide:
    def __init__(self, filename, title, subtitle, doc_no):
        self.path = os.path.join(OUT, filename)
        # The heading is parsed as markup; the footer and PDF metadata are drawn
        # as raw text. Keep both forms so "&amp;" never reaches a reader.
        self.title = title.replace('&amp;', '&')
        self.subtitle = subtitle
        self.doc_no = doc_no
        self.story = []

    def _page(self, canv, doc):
        canv.saveState()
        # Top rule with the Quest colours.
        canv.setFillColor(NAVY)
        canv.rect(0, letter[1] - 0.34 * inch, letter[0], 0.34 * inch, stroke=0, fill=1)
        canv.setFillColor(GOLD)
        canv.rect(0, letter[1] - 0.375 * inch, letter[0], 0.035 * inch, stroke=0, fill=1)
        canv.setFont('Helvetica-Bold', 8.5)
        canv.setFillColor(colors.white)
        canv.drawString(0.75 * inch, letter[1] - 0.235 * inch, 'QUEST WATERSPORTS')
        canv.setFont('Helvetica', 8.5)
        canv.drawRightString(letter[0] - 0.75 * inch, letter[1] - 0.235 * inch,
                             'Winter Services System')
        # Footer.
        canv.setFillColor(MUTED)
        canv.setFont('Helvetica', 8)
        canv.drawString(0.75 * inch, 0.5 * inch,
                        'Document %s — %s' % (self.doc_no, self.title))
        canv.drawRightString(letter[0] - 0.75 * inch, 0.5 * inch, 'Page %d' % doc.page)
        canv.setStrokeColor(colors.HexColor('#C7D5E0'))
        canv.setLineWidth(0.5)
        canv.line(0.75 * inch, 0.66 * inch, letter[0] - 0.75 * inch, 0.66 * inch)
        canv.restoreState()

    def head(self):
        logo = os.path.join(ROOT, 'favicon.png')
        heading = self.title.replace('&', '&amp;')
        rows = [[Image(logo, width=0.62 * inch, height=0.62 * inch),
                 [Paragraph(heading, TITLE), Paragraph(self.subtitle, SUBTITLE)]]]
        t = Table(rows, colWidths=[0.85 * inch, 5.75 * inch])
        t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
                               ('LEFTPADDING', (0, 0), (0, 0), 0),
                               ('TOPPADDING', (0, 0), (-1, -1), 0)]))
        self.story += [t]

    def build(self):
        doc = SimpleDocTemplate(
            self.path, pagesize=letter,
            leftMargin=0.75 * inch, rightMargin=0.75 * inch,
            topMargin=0.62 * inch, bottomMargin=0.85 * inch,
            title=self.title, author='Quest Watersports', subject=self.subtitle)
        doc.build(self.story, onFirstPage=self._page, onLaterPages=self._page)
        return self.path


# =====================================================================
# 1 — COMPLETE OVERVIEW
# =====================================================================
def doc1():
    g = Guide('1 - Complete System Overview.pdf', 'Complete System Overview',
              'Every part of the winter services system, and how the parts fit together.', '1')
    g.head()

    g.story += [P(
        'This system takes a customer from "what would it cost to winterize my boat?" all the '
        'way to a signed, paid, scheduled job — and gives Quest staff the tools to run the '
        'season from a phone. It is three pieces that share one set of pricing rules and one '
        'spreadsheet.')]

    g.story += [P('The three pieces', H1)]
    g.story += [table(
        ['Piece', 'Who uses it', 'What it is'],
        [['Quote page', 'Customers', 'A public web page where someone builds a winter quote for a '
          'boat, jet ski, golf cart or e-bike, and can email, print, sign and pay.'],
         ['Staff console', 'Quest staff', 'A PIN-protected page for looking up quotes, taking '
          'payments, adjusting prices, sending emails, uploading photos and running the yard.'],
         ['Backend + spreadsheet', 'Nobody directly', 'The Google Apps Script that prices, stores, '
          'emails and generates PDFs, plus the Google Sheet that holds every quote.']],
        [1.15 * inch, 1.05 * inch, 4.4 * inch])]

    g.story += [P('Why they agree with each other', H2)]
    g.story += [P(
        'Both the quote page and the backend price a quote using <b>the same rule set</b>, kept in '
        'one file. There is no second copy of the prices that could drift out of step. When a '
        'customer saves a quote, the server prices it again from their selections and stores its '
        'own figure — so a stale browser tab, or an old page left open across a price change, '
        'cannot lock in the wrong number. If the two ever disagree, the save still completes with '
        'the server\'s figure and an alert is emailed to service@ with <b>PRICE DRIFT</b> in the '
        'subject.')]

    g.story += [P('The customer\'s journey', H1)]
    g.story += [P(
        'Full step-by-step in <b>Document 3</b>. In outline:')]
    for t in [
        '<b>Contact details first.</b> Name, phone and email are required before any pricing is '
        'shown. That button press is also where the customer agrees to the Terms — the '
        'acknowledgment sits next to it, with real links, and the version they agreed to is '
        'recorded with a timestamp.',
        '<b>A row is logged immediately.</b> The moment they pass that gate, a row appears on the '
        '<b>Quote Started</b> tab. If they wander off, you still know who reached the pricing.',
        '<b>They build the quote.</b> The questions asked depend on the unit type — a boat is '
        'asked about engines, systems, storage and shrinkwrap; a jet ski is asked far less; golf '
        'carts and e-bikes are close to flat-rate.',
        '<b>They review and act.</b> Print, email themselves a copy, sign, or pay a deposit.',
        '<b>They can come back.</b> A quote reloads with quote number and last name, with every '
        'selection restored. If they start again with the same email and last name, the page '
        'offers to continue the quote they already had rather than making a second one.',
    ]:
        g.story += [B(t)]

    g.story += [P('What staff do', H1)]
    g.story += [P(
        'Full detail and permission levels in <b>Document 2</b>. The console covers: looking up a '
        'quote by number or partial last name; recording payments, deposits and refunds; editing '
        'or removing line items; pricing a service the customer asked about; applying late fees; '
        'correcting dimensions, motor counts and storage location; uploading condition photos and '
        'signed contracts; previewing and sending customer emails, individually or to '
        'everyone; printing yard sheets and the haul-out list; managing '
        'staff accounts; and restoring from a backup.')]

    g.story += [note('Staff changes are never lost when a customer edits their quote',
        'Every staff change is recorded as an <i>operation</i> — "discount this line", "price this '
        'request", "we measured the beam at 9.4 feet" — not just baked into the numbers. When a '
        'customer reloads and re-saves, the server rebuilds their quote cleanly from their '
        'selections and then replays every staff change on top. Without this, a customer opening '
        'their quote would quietly erase your discounts.')]

    g.story += [P('Correcting what the customer told us', H2)]
    g.story += [P(
        'Customers get things wrong — the wrong beam, the wrong number of motors, the wrong '
        'storage. The console\'s <b>Unit details &amp; storage</b> card handles all three. You '
        'change a value, press <b>Preview the change</b>, and the server re-prices and shows you a '
        'line-by-line before/after with the new total. Nothing is written until you press Apply.')]
    for t in [
        'Corrections are stored separately from what the customer selected, so their next save '
        'cannot undo them — and you can always still see what they originally told you.',
        'A beam that outgrows its storage class is <b>flagged, never moved</b>. Relocating a '
        'customer\'s boat is a conversation, not something the software should decide.',
        'Moving storage physically moves the quote to the right tab and re-prices it, because '
        'inside and outside cost different money.',
        'Motors are corrected as a set — type, count and service level together — because a boat '
        'can have several of one type but never a mix.',
    ]:
        g.story += [B(t)]

    g.story += [P('Money', H1)]
    g.story += [P(
        'Payments are an <b>append-only ledger</b>. Nothing is ever deleted; a refund is recorded '
        'as a negative payment. Balance is always total minus paid, and it is never clamped at '
        'zero — if a customer has overpaid, the system shows a <b>CREDIT</b> in the sheet, on the '
        'PDF, in emails and on their own page, rather than pretending the balance is zero.')]
    g.story += [P(
        'Once any payment exists the quote <b>locks</b>. The customer\'s page becomes read-only '
        'with a gold banner, the wording changes from Quote to Invoice everywhere, and the server '
        'refuses to let a stale browser tab overwrite a paid quote. Staff can still adjust a '
        'locked quote from the console — that is how corrections after a deposit get made.')]

    g.story += [P('Emails', H1)]
    g.story += [P(
        'Every customer email is drafted by one shared builder, so the preview you see is exactly '
        'what sends. <b>Only two emails ever send by themselves:</b>')]
    g.story += [table(
        ['Automatic email', 'When', 'Who gets it'],
        [['Quote reminder', '10 days after a quote is saved or emailed with no signature and no '
          'payment. Runs daily at 9:00am Central.', 'Customers with a real quote. Never anyone who '
          'only reached the pricing and stopped.'],
         ['Finish my quote', 'Once, roughly 24–47 hours after someone passes the contact gate and '
          'walks away. Runs daily at 12:15pm Central, chosen to land over lunch.',
          'Only people still sitting on the Quote Started tab. Saving, printing, emailing or '
          'paying moves them off it.']],
        [1.25 * inch, 2.55 * inch, 2.8 * inch])]
    g.story += [P(
        'Everything else — receipts, "we have your unit", the seasonal notes, "you\'re up next", '
        'late-fee warnings, dimension-change notices — requires a staff member to click, preview '
        'and confirm. The 1st and 15th balance reports go to Chris only, never to customers. Both '
        'automatic emails are written to the Activity Log as well, so "did we contact this '
        'customer?" has one answer no matter who sent it.')]

    g.story += [P('The two seasonal announcements', H2)]
    g.story += [P(
        'These are the only emails that have a send-to-all version, and they bracket the season. '
        'The <b>end-of-season note</b> goes out in the autumn: the season is winding down, here is '
        'a last chance at detailing or winter work, and when would you like to come out? It will '
        'not offer a detail quote to somebody who has already asked for one. The <b>spring '
        'relaunch alert</b> is its counterpart in the other direction — anything you want done '
        'before it goes back, and when would you like it? Both put the customer\'s answer into the '
        'same haul-out timing record, so the late retrieval surcharge applies from either.')]
    g.story += [P(
        'Alongside them, <b>"you\'re up next"</b> comes in two directions. In autumn it means we '
        'are about to take the unit out; in spring, about to put it back. They are separate '
        'emails rather than one with the words flipped, because the useful thing to say differs: '
        'in autumn the last easy moment to add work is now, while we have it.')]

    g.story += [P('The season-done question', H2)]
    g.story += [P(
        'Customer emails carry a three-option question — done now, done on a set date, or "I\'ll '
        'call" — but <b>only once a deposit or payment exists</b>. Asking someone to book a '
        'haul-out before they have put money down is asking them to schedule work they have not '
        'agreed to buy. A date after Nov 15 automatically applies the late retrieval surcharge, '
        'priced from that quote\'s own stored figure so it stays right year to year. Staff can '
        'record the same answer from the console for anyone who phones in.')]

    g.story += [P('Sending to everyone', H2)]
    g.story += [P(
        'A send-to-all is the one action in the system that cannot be undone or narrowed after the '
        'fact, so it is built to be checked first. Choosing the email does not send it: the '
        'console reads the sheet and reports who would receive it, broken down by storage area, '
        'plus how many quotes have no email address and whether the number is large enough to hit '
        'Google\'s daily sending limit. It also renders the real email for the first person on the '
        'list. Sending is a second, separate, confirmed click.')]
    g.story += [P(
        'People who started a quote and walked away are never on that list. They are leads, not '
        'customers, and a "your boat" email to a stranger — possibly a competitor — is the failure '
        'the exclusion exists to prevent. It is enforced in one shared piece of code used by both '
        'the console and the spreadsheet menu, and there is an automated test that builds a '
        'spreadsheet with a lead on it and checks the lead is not in the result.')]

    g.story += [P('Photos and contracts', H1)]
    g.story += [P(
        'Condition photos are uploaded from the console — camera or gallery — and filed into '
        'Winter and Spring folders per quote, so there is a record of how a unit arrived. Signed '
        'contracts upload the same way. Both are stored in Drive as "anyone with the link can '
        'view", which is what lets staff open them without a Google login. See <b>Document 4</b>.')]

    g.story += [P('What runs on a timer', H1)]
    g.story += [table(
        ['Time (Central)', 'What happens'],
        [['9:00am daily', 'Ten-day quote reminders to customers who have not signed or paid.'],
         ['12:15pm daily', '"Finish my quote" to people who stopped at the contact gate ~24h ago.'],
         ['6:00pm daily', 'Full spreadsheet backup emailed to Chris as an .xlsx file.'],
         ['7:00am', 'Unpaid balance report — internal only, to Chris.']],
        [1.35 * inch, 5.25 * inch])]
    g.story += [P(
        'Google fires these within roughly a quarter-hour of the stated time; that cannot be '
        'tightened and does not matter for any of them.', SMALL)]

    g.story += [P('Not built yet', H1)]
    g.story += [table(
        ['Item', 'Status'],
        [['Adobe Sign web form', 'Waiting on the contract being finalised. Until the URL is set, '
          'customers see a "signing almost here" placeholder instead of a broken button. '
          'Everything else in the couch-to-paid path already works.'],
         ['BiT DMS work orders', 'On hold. No public API was found; the next step is asking BiT '
          'whether they offer one or accept a file import.'],
         ['Import of last year\'s selections', 'Needs a sample workbook to map the columns. The '
          'design already supports it, because quotes store the customer\'s selections rather '
          'than just prices.'],
         ['Text-message copies of emails', 'Blocked on carrier registration (roughly $20–65 once, '
          '$50–60 a year, about a month to approve).']],
        [1.6 * inch, 5.0 * inch])]

    g.story += [note('One thing to decide before the season opens',
        'The season dates and prices still read <b>2025–2026</b> (pay by Nov 15 2025, storage Oct 15 '
        '2025 – Apr 15 2026) while the spreadsheet is named 2026-2027. Rolling the season over is a '
        'single edit in one place that updates the customer page and the backend together, but it '
        'has not been done yet and it changes what customers are told. Worth doing deliberately '
        'rather than discovering it mid-quote.')]

    return g.build()


# =====================================================================
# 2 — USING THE STAFF CONSOLE
# =====================================================================
def doc2():
    g = Guide('2 - Using the Staff Console.pdf', 'Using the Staff Console',
              'Every option on the admin page, and the permission each one needs.', '2')
    g.head()

    g.story += [P(
        'The console lives at <b>questws.github.io/winter-quotes_26-27/admin/</b>. It works on a '
        'phone. Add it to your home screen and it behaves like an app.')]

    g.story += [P('Signing in', H1)]
    g.story += [P(
        'Enter your 4-digit PIN. There are no usernames — the PIN identifies you, which is why no '
        'two people can ever share one. A session lasts <b>12 hours</b>, then you sign in again. '
        'Ten wrong PINs in a row pauses login for everyone for 15 minutes and emails an alert; '
        'that is deliberate, and it is the reason a wrong PIN is worth reporting rather than '
        'retrying.')]

    g.story += [P('The five permissions', H1)]
    g.story += [P(
        'Each account carries any combination of four permissions, plus an optional admin flag. '
        'You only see the controls you are allowed to use — if a card is missing from your '
        'console, that is why.')]
    g.story += [table(
        ['Permission', 'What it unlocks'],
        [[perm('view'), 'Looking up quotes, searching, the storage view, printing. Everyone who '
          'can sign in has this.'],
         [perm('pay'), 'Recording payments, deposits and refunds. Uploading a signed contract.'],
         [perm('adjust'), 'Anything that changes what a customer owes: adjustments, editing or '
           'deleting lines, pricing requests, late fees, dimensions, motors, storage, season '
           'timing.'],
         [perm('email'), 'Previewing and sending customer emails.'],
         [perm('photos'), 'Uploading and viewing condition photos.'],
         [perm('admin'), 'Everything above, plus staff accounts and backup restore. An admin '
           'bypasses the individual permissions entirely.']],
        [0.85 * inch, 5.75 * inch])]
    g.story += [P('Current intent for the team: Chris and Jeff are admins. John, Rex and Jess have '
                  'pay, email and photos. Marina has photos only.', SMALL)]

    g.story += [P('Finding a quote', H1)]
    g.story += [P(
        'Type a quote number (<b>QW-26-####</b>) or part of a last name and press Look up. A '
        'partial name that matches several people gives you a list to pick from. '
        'Needs <b>view</b>.')]

    g.story += [P('The quote screen, card by card', H1)]

    g.story += [P('Quote summary', H2)]
    g.story += [table(
        ['Option', 'Permission', 'What it does'],
        [['Total / Paid / Balance', perm('view'), 'Balance shows CREDIT in green when a customer '
          'has overpaid.'],
         ['Print quote / Print invoice', perm('view'), 'Opens a printable copy in a new tab and '
          'prints it. Identical to the customer\'s PDF. Says "invoice" once a payment exists. '
          'If nothing happens, allow pop-ups for the site.'],
         ['Line items', perm('view'), 'Every priced service. Edit and delete buttons appear only '
          'with adjust.'],
         ['Edit a line / Delete a line', perm('adjust'), 'Change an amount or its wording, or '
          'remove it. Recorded so a customer re-save cannot undo it.'],
         ['Quotes requested', perm('adjust'), 'Services the customer asked about but that were not '
          'priced automatically. Give one a price and it becomes a normal line.'],
         ['Season timing', perm('adjust'), 'Record done now / done on a date / will call. A date '
          'after Nov 15 applies the late retrieval surcharge, and changing it back to an on-time '
          'date removes it again.'],
         ['Signed contract', perm('pay'), 'Upload the signed agreement. Replaces any prior copy.'],
         ['Email history', perm('view'), 'Every email sent for this quote, when, and by whom.']],
        [1.45 * inch, 0.95 * inch, 4.2 * inch])]

    g.story += [P('Record payment / deposit', H2)]
    g.story += [table(
        ['Option', 'Permission', 'What it does'],
        [['Amount + method', perm('pay'), 'Records a payment. The quote locks: the customer\'s page '
          'goes read-only and the wording flips to Invoice.'],
         ['Negative amount', perm('pay'), 'Records a refund. Payments are never deleted — a refund '
           'is a negative entry, so the history stays honest.'],
         ['Email receipt to customer', perm('pay'), 'Sends a receipt. Receipts never carry the '
          'season-done question.']],
        [1.45 * inch, 0.95 * inch, 4.2 * inch])]

    g.story += [P('Adjustment', H2)]
    g.story += [P('A one-off charge or discount. Negative for a discount. Needs <b>adjust</b>. '
                  'The optional "email the updated copy now" sends the revised quote immediately.')]

    g.story += [P('Late fee', H2)]
    g.story += [P('Suggests the standard first fee (10% of balance) and monthly fee (2%, minimum '
                  '$5), but you type the amount and the wording that appears on the invoice. '
                  'Needs <b>adjust</b>. Only appears when there is actually a balance owing.')]

    g.story += [P('Unit details &amp; storage', H2)]
    g.story += [P('All of this needs <b>adjust</b>, and all of it goes through Preview → Apply. '
                  'Nothing is written until you confirm the before/after.')]
    g.story += [table(
        ['Option', 'What it does'],
        [['LOA / Beam / Length with trailer', 'Correct a boat\'s measurements. Jet skis show stored '
          'length and width instead.'],
         ['Stored on its trailer', 'Changes how storage is priced and the deposit tier.'],
         ['Motor type / number / service level', 'Fix a wrong motor count or type. Changing type '
          'clears the others — a boat can have several of one type but never a mix. Type 0 if '
          'there are genuinely none; leaving it blank is refused on purpose.'],
         ['Transmissions / V-drives', 'Only shown for inboard and sterndrive. Switching to outboard '
          'clears it, because outboards have no V-drive.'],
         ['Storage location', 'Moves the quote to another storage area and re-prices it. The row '
          'physically moves to the new tab, carrying photos, payments and links with it.'],
         ['Note for the customer', 'Optional line included in the notice email.'],
         ['Preview the change', 'Shows the line-by-line difference and the new total. Writes '
          'nothing.'],
         ['Apply this change', 'Commits it. Recorded in the Activity Log.']],
        [1.85 * inch, 4.75 * inch])]
    g.story += [note('A beam over the limit is flagged, not acted on',
        'If a corrected beam no longer fits its storage class, the preview warns you and says '
        '"Nothing has been moved." Moving that customer is your decision and their conversation — '
        'use the storage dropdown yourself if that is what you agree.')]

    g.story += [P('Condition photos', H2)]
    g.story += [table(
        ['Option', 'Permission', 'What it does'],
        [['Winter / Spring', perm('photos'), 'Chooses which folder the photos go into.'],
         ['Take photos now', perm('photos'), 'Opens the camera directly.'],
         ['Upload from gallery', perm('photos'), 'Pick existing photos. Uploads three at a time.'],
         ['Open folder', perm('photos'), 'Opens this quote\'s photo folder in Drive.']],
        [1.45 * inch, 0.95 * inch, 4.2 * inch])]

    g.story += [P('Customer emails', H2)]
    g.story += [P('All of these need <b>email</b>. Every one shows you a preview of exactly what '
                  'will send before it sends — the preview is built by the same code as the real '
                  'email, so what you see is what the customer gets.')]
    g.story += [table(
        ['Button', 'What it sends'],
        [['We have your unit', 'Confirms arrival, links the arrival photos if there are any.'],
         ['End of season note', 'The autumn one. Says the season is winding down, offers a last '
          'chance at detailing or winter work — but only if they have not already asked — and '
          'polls when they want to be hauled out.'],
         ['Spring alert', 'Asks when they would like their unit back and offers early / any time / '
          'late. Their answer sets their place in the queue.'],
         ['Back in / back home', 'Confirms the unit is back. Wording changes for golf carts and '
          'e-bikes — they come "back home", never "back in the water".'],
         ['Dimensions updated', 'Explains a re-measure, storage move or motor correction, and '
          'attaches the rebuilt quote or invoice. The wording follows what actually changed.'],
         ['Late fee warning', 'Warns before a fee is applied. You write the wording.'],
         ['Re-send invoice', 'Sends the current quote or invoice again.'],
         ['You\'re up next', 'Pick the direction first — <b>haul-out / pick-up</b> in the autumn '
          'or <b>relaunch / return</b> in the spring — then type when you expect to do the work. '
          'The two read differently on purpose: in autumn it is the last easy moment to add work, '
          'in spring it is the last moment before the unit goes back.']],
        [1.5 * inch, 5.1 * inch])]

    g.story += [P('The menu — the three-line button, top right', H1)]
    g.story += [table(
        ['Menu item', 'Permission', 'What it does'],
        [['Storage view', perm('view'), 'Every unit grouped by storage area, with keys and '
          'balances. "Print yard sheets" gives one page per area for use in the yard; '
          '"Print haul-out list" gives one sheet for the whole yard, in the order customers '
          'asked to come out.'],
         ['Send to all', perm('email'), 'See below. Works without a quote pulled up.'],
         ['Staff &amp; permissions', perm('admin'), 'See below.'],
         ['Restore from backup', perm('admin'), 'See below and Document 4.'],
         ['Log out', '—', 'Ends your session on this device.']],
        [1.45 * inch, 0.95 * inch, 4.2 * inch])]

    g.story += [P('Send to all — needs email', H1)]
    g.story += [P(
        'The two seasonal announcements can go to every customer at once. Open it from the menu; '
        'you do not need a quote pulled up. There are only two, and nothing else can be sent this '
        'way — a receipt or a late-fee warning is about one person and has no send-to-all version.')]
    g.story += [table(
        ['Step', 'What happens'],
        [['Pick which one', '<b>End of season note</b> (autumn) or <b>Spring relaunch alert</b>.'],
         ['See who this goes to', 'Reads the sheet and reports back. <b>Nothing is sent.</b> You '
          'get the total, a count per storage area, how many quotes have no email address on them, '
          'and a warning if the number is large enough to run into Google\'s daily limit.'],
         ['Preview the email', 'Opens the real email for the first person on the list — not a '
          'description of it.'],
         ['Send to all N', 'Asks you to confirm, then sends. Each one is recorded on that '
          'customer\'s quote and in the Activity Log.']],
        [1.6 * inch, 5.0 * inch])]
    g.story += [note('Who never receives one',
        'Anyone who started a quote and walked away without finishing it. They are on the Quote '
        'Started tab, they are not customers, and no seasonal email will ever reach them. Quotes '
        'with no email address on them are skipped and counted for you. The spring alert also '
        'skips No Storage customers — there is nothing to relaunch for a unit we never had. The '
        'end-of-season note does go to them, because they still have to get the unit to us.')]
    g.story += [P('Both are also on the spreadsheet menu, and both go to the same people either '
                  'way.', SMALL)]

    g.story += [P('Printing for the yard', H1)]
    g.story += [table(
        ['Sheet', 'What it is for'],
        [['Yard sheets', 'One page per storage area. For walking a building and checking units '
          'off — what is in here, whose it is, where the keys are.'],
         ['Haul-out list', 'One page for the whole yard, ordered by when each customer asked to '
          'come out: ready now first, then stated dates soonest first, then "will call", then '
          'anyone who has not answered. Shows the customer, the unit and its dimensions, storage '
          'area, whether it is on a trailer, the slip number, where the keys are, and any note '
          'they left. This is the planning sheet.']],
        [1.35 * inch, 5.25 * inch])]

    g.story += [P('Staff &amp; permissions — admin only', H1)]
    g.story += [table(
        ['Option', 'What it does'],
        [['Permission buttons', 'Tap to turn a permission on or off for that person. Takes effect '
          'immediately.'],
         ['Reset PIN', 'Issues a new PIN. Their old one stops working at once. The new PIN is '
          'shown <b>once</b> — write it down.'],
         ['Remove', 'Deletes the account and signs them out everywhere. Cannot be undone from the '
          'console.'],
         ['Create account', 'Name, tick the permissions, optionally admin. The new PIN is shown '
          'once, in a gold box.']],
        [1.5 * inch, 5.1 * inch])]
    g.story += [P('Three things the console will refuse, because none can be undone from inside '
                  'it: removing your own account, removing or demoting the last admin, and issuing '
                  'a PIN that is already in use.', SMALL)]

    g.story += [P('Restore from backup — admin only', H1)]
    g.story += [P(
        'Upload one of the nightly .xlsx backups; the console shows what is missing, what differs '
        'and what exists only on the live sheet, then you choose what to put back. Nothing on the '
        'sheet is ever deleted, and a snapshot is saved before anything is written. Full '
        'walkthrough in <b>Document 4</b>.')]

    g.story += [P('If something does not work', H1)]
    g.story += [table(
        ['What you see', 'What it means'],
        [['A card is missing', 'Your account does not have that permission. Ask Chris or Jeff.'],
         ['"Session expired"', 'Twelve hours have passed. Sign in again.'],
         ['"Too many wrong PINs"', 'Someone entered ten wrong PINs. Login is paused 15 minutes.'],
         ['Print does nothing', 'Your browser blocked the pop-up. Allow pop-ups for the site.'],
         ['Nothing looks new after an update', 'Hard-refresh the page — your phone is showing a '
          'cached copy.'],
         ['"Admins only"', 'The action is restricted to admin accounts.']],
        [2.0 * inch, 4.6 * inch])]
    g.story += [P('Every action you take in the console is recorded in the Activity Log tab of the '
                  'spreadsheet, with your name and the time.', SMALL)]
    return g.build()


# =====================================================================
# 3 — MAKING A NEW QUOTE
# =====================================================================
def doc3():
    g = Guide('3 - Making a New Quote.pdf', 'Making a New Quote',
              'Start to finish on the customer page — for staff building one, or for '
              'walking a customer through it.', '3')
    g.head()

    g.story += [P(
        'The quote page is at <b>questws.github.io/winter-quotes_26-27/</b>. It is the same page '
        'customers use, so building a quote on someone\'s behalf and letting them build their own '
        'are the same process. It works on a phone.')]

    g.story += [note('Every quote you start creates a record',
        'Pressing the button at the end of the first step logs a row immediately, before any '
        'pricing is shown. If you are only poking around, use the test quote rather than making a '
        'new one — otherwise you leave a lead in the system that will be emailed a "finish my '
        'quote" note the next day.')]

    g.story += [P('Step 1 — Who and what', H1)]
    g.story += [P('The page asks for four things before it will show any prices:')]
    for t in ['First name', 'Last name', 'Phone', 'Email']:
        g.story += [B(t)]
    g.story += [P(
        'All four are required. Then pick the unit — <b>Boat</b>, <b>Jetski</b>, <b>Golf cart</b> '
        'or <b>E-bike</b> — and fill in the year, make and model.')]
    g.story += [P(
        'Below the continue button is a line saying that continuing means agreeing to the Terms '
        'and Privacy Policy, with links to both. That press records which version of the Terms '
        'they agreed to and when. It is a real agreement, so do not click it on a customer\'s '
        'behalf without their say-so.')]
    g.story += [P(
        'If the email and last name match a quote somebody already started and did not finish, '
        'the page offers to <b>continue that quote</b> instead of making a new one. Take it — it '
        'stops one person becoming three leads.')]

    g.story += [P('Boat measurements', H2)]
    g.story += [table(
        ['Field', 'Why it matters'],
        [['LOA (length overall)', 'Drives shrinkwrap, powerwash, acid wash and outside storage.'],
         ['Beam', 'Drives storage area, the acid wash rate, and whether the boat fits inside.'],
         ['Length with trailer', 'Used instead of LOA for inside storage when the boat stays on '
          'its trailer.'],
         ['On its trailer?', 'Changes how storage is measured and which deposit applies.']],
        [1.75 * inch, 4.85 * inch])]
    g.story += [P('Jet skis are asked for stored length and width instead. Golf carts and e-bikes '
                  'are not measured at all — they are flat-rate.', SMALL)]

    g.story += [P('Step 2 — Engines (boats)', H1)]
    g.story += [P(
        'Choose <b>one</b> motor type — inboard, inboard/outboard (sterndrive), or outboard — and '
        'how many. A boat can have several of one type but never a mix, so picking a type clears '
        'the others and greys them out. A genuinely unusual rig is handled by Quest as a line-item '
        'adjustment later, not by building a boat that cannot exist.')]
    g.story += [P(
        'Then pick <b>Basic</b> or <b>Full service</b>. Both descriptions are on screen. If the '
        'boat has transmissions or V-drives, enter how many — outboards do not have them.')]

    g.story += [P('Step 3 — Onboard systems (boats)', H1)]
    g.story += [P(
        'Fresh water system, head, generator and so on. Tick what applies. Anything the customer '
        'is unsure about can be left off and added later from the console.')]

    g.story += [P('Step 4 — Storage &amp; retrieval', H1)]
    g.story += [table(
        ['Choice', 'What it means'],
        [['No storage with Quest', 'Winterizing and services only. The customer keeps the unit.'],
         ['Outside storage', 'Priced per foot of length.'],
         ['Inside storage', 'Priced per square foot. Retrieval, set and relaunch are included.'],
         ['Premium inside storage', 'Very limited space, requires Quest approval, returning '
          'customers prioritised. Also includes retrieval.']],
        [1.75 * inch, 4.85 * inch])]
    g.story += [P(
        'A boat that is <b>not</b> on a trailer and has a beam over the inside limit will not be '
        'offered regular inside storage — the option is hidden rather than offered and then '
        'refused. Jet skis are inside-or-nothing.')]
    g.story += [P(
        'This step also asks for <b>where the keys will be</b>. That is required for boats, jet '
        'skis and golf carts. Golf carts <b>cannot be picked up without keys at all</b>, and for '
        'boats and jet skis there is a $500 tow/jump-start fee warning if we arrive and cannot '
        'move it. Golf carts also need the Heritage Harbor street address.')]

    g.story += [P('Step 5 — Shrinkwrap &amp; extras (boats)', H1)]
    g.story += [P(
        'Shrinkwrap, powerwash, acid wash, bottom paint, detailing and so on. Two things worth '
        'knowing:')]
    for t in [
        'Detail options are <b>not</b> mutually exclusive. Exterior and interior, wash and wax and '
        'full detail, touch-up and strip-and-reapply can all be selected together on purpose — '
        'Quest quotes every option and removes whatever the customer does not take.',
        'Acid wash automatically suppresses the powerwash charge; you do not need to avoid '
        'ticking both.',
    ]:
        g.story += [B(t)]
    g.story += [P(
        'Some services cannot be priced without seeing the unit. Ticking those adds them to '
        '<b>Quotes requested</b> — they appear on the quote as "we will price this" and staff give '
        'them a real price later from the console.')]

    g.story += [P('Step 6 — Review', H1)]
    g.story += [P(
        'Every line with its price, the total, the deposit, and what the total becomes if paid by '
        'card (+3%) or after the pay-by date (+10%). If anything is missing the page says exactly '
        'what — for example "LOA for shrinkwrap" — rather than quietly leaving a service off.')]
    g.story += [P('From here the customer can:')]
    for t in [
        '<b>Print</b> the quote.',
        '<b>Email themselves a copy</b> — this also saves the quote and files it on the right '
        'storage tab, and sends Quest a notification.',
        '<b>Come back later</b> using the quote number and last name.',
    ]:
        g.story += [B(t)]

    g.story += [P('Step 7 — Sign &amp; pay', H1)]
    g.story += [P(
        'Signing is where the Adobe agreement will sit once the contract is finalised. Until then '
        'customers see a short "signing almost here" note rather than a broken button. Paying a '
        'deposit already works and goes through the normal Quest payment page.')]
    g.story += [P(
        'Once any payment is recorded the quote <b>locks</b>: the customer\'s page becomes '
        'read-only with a gold banner explaining why, and every mention of "quote" becomes '
        '"invoice". Changes after that point are made by staff from the console.')]

    g.story += [P('Reloading a quote later', H1)]
    g.story += [P(
        'On the quote page, enter the <b>quote number</b> and <b>last name</b>. Everything comes '
        'back — every selection, every staff change, and the official total. If Quest has '
        're-measured the unit or moved its storage since, the customer sees the corrected '
        'figures, not what they originally entered.')]
    g.story += [P(
        'The "finish my quote" email contains a link that fills both fields in automatically, so '
        'a customer usually only has to press one button.')]

    g.story += [P('What happens behind the scenes when a quote is saved', H1)]
    for t in [
        'The server re-prices the quote from the customer\'s selections using the same rules the '
        'page used, and stores its own figure.',
        'Any staff changes already on the quote are re-applied on top.',
        'A PDF is generated and filed in Drive.',
        'The row lands on the tab matching its storage location, and any stale copy on another tab '
        'is removed.',
        'service@ gets a notification. The customer only gets an email if they asked for one.',
    ]:
        g.story += [B(t)]

    g.story += [P('Quick reference', H1)]
    g.story += [table(
        ['Question', 'Answer'],
        [['Quote number format', 'QW-26-#### — assigned automatically.'],
         ['Can a customer change a quote after paying?', 'No. It locks. Staff can still change it '
          'from the console.'],
         ['Customer picked the wrong storage', 'Console → Unit details &amp; storage → change it, '
          'preview, apply. It re-prices and moves tabs.'],
         ['Customer picked the wrong motor count', 'Same card. Type, count and level are corrected '
          'together.'],
         ['Customer wants something not on the list', 'Add it from the console as an adjustment, '
          'or price one of their requested items.'],
         ['Quote started but never finished', 'It sits on the Quote Started tab and gets one '
          '"finish my quote" email the next day at 12:15pm.']],
        [2.1 * inch, 4.5 * inch])]
    return g.build()


# =====================================================================
# 4 — SECURITY, REDUNDANCY, AND THE SPREADSHEET
# =====================================================================
def doc4():
    g = Guide('4 - Security, Redundancy and the Spreadsheet.pdf',
              'Security, Redundancy &amp; the Spreadsheet',
              'Who can reach what, how the data is protected, and how to get it back.', '4')
    g.head()

    g.story += [P(
        'Everything lives in one Google account, <b>questwsottawa@gmail.com</b>. That account owns '
        'the spreadsheet, the Drive folder, the script and the web app. Protecting that account '
        'protects the whole system — it is the single most important control here, and it is worth '
        'having two-factor authentication on it.')]

    g.story += [P('Who can reach what', H1)]
    g.story += [table(
        ['Thing', 'Who can open it'],
        [['Quote page', 'Anyone with the link. It is a public page — that is the point.'],
         ['Terms and Privacy pages', 'Anyone. Reachable without submitting anything.'],
         ['Staff console', 'Anyone can load the page, but it shows nothing without a valid PIN.'],
         ['A specific quote', 'Needs the quote number <b>and</b> the matching last name.'],
         ['The spreadsheet', 'Only the Google account. Staff never touch it directly.'],
         ['Quote PDFs', 'Anyone with the direct link. Links are not published.'],
         ['Photos and signed contracts', 'Anyone with the direct link — deliberately, so staff can '
          'open them without a Google login.']],
        [1.8 * inch, 4.8 * inch])]

    g.story += [note('The known trade-off, stated plainly',
        'Photo folders and signed contracts are set to "anyone with the link can view". That is '
        'what lets a technician open them on a personal phone with no Google account. It also '
        'means anyone who obtains a link can view that file. This was an accepted trade-off; '
        'locking them to the Google account is a small change if you ever want it.')]

    g.story += [P('Staff access', H1)]
    g.story += [P(
        'There are no usernames or passwords. A 4-digit PIN identifies the person, which is why '
        'the system will not issue a duplicate PIN — if two people shared one, the system would '
        'sign the second person in as the first.')]
    g.story += [table(
        ['Control', 'How it behaves'],
        [['Session length', 'Twelve hours, then a fresh sign-in.'],
         ['Wrong PINs', 'Ten in a row pauses login for 15 minutes and emails an alert.'],
         ['Permissions', 'view, pay, adjust, email, photos, plus admin. You only see the controls '
          'you can use.'],
         ['Removing someone', 'Their PIN stops working immediately and every device they are '
          'signed in on is ended.'],
         ['Lockout protection', 'The console refuses to remove or demote the last admin, or to let '
          'you remove your own account.'],
         ['Activity Log', 'Every console action — who, what, when — on its own tab in the '
          'spreadsheet.']],
        [1.55 * inch, 5.05 * inch])]
    g.story += [P('Why PINs rather than Google logins: the account is ordinary Gmail, not Google '
                  'Workspace, so there is no way to restrict a web app to a list of staff '
                  'accounts. PINs are the workable alternative.', SMALL)]

    g.story += [P('Protecting customers', H1)]
    for t in [
        'Looking up a quote needs the number <b>and</b> the last name. A number alone is not enough.',
        'The "do you already have a quote?" check reads only the leads list and requires both '
        'email and last name. Leads hold no pricing, so the most it can ever reveal is that an '
        'address started a quote — it can never be used to pull someone\'s priced quote.',
        'People who only reached the pricing and stopped are excluded from every customer email '
        'sweep. Without that, a stranger — possibly a competitor — would get a "your quote is '
        'waiting" email ten days later.',
        'The Terms version each customer agreed to, and the timestamp, are stored with their quote '
        'rather than only in their browser.',
    ]:
        g.story += [B(t)]

    g.story += [P('Redundancy — four independent layers', H1)]
    g.story += [table(
        ['Layer', 'What it protects against', 'Where it lives'],
        [['Nightly backup', 'Anything that damages the spreadsheet.', 'A full .xlsx emailed to '
          'Chris every evening at 6pm. Keep several.'],
         ['Google\'s own history', 'Accidental edits and deletions.', 'File → Version history in '
          'the spreadsheet, going back automatically.'],
         ['Pre-restore snapshot', 'A restore that makes things worse.', 'Saved to Drive '
          'automatically before any restore is written.'],
         ['Backend version history', 'A bad software change.', 'Every deploy creates a numbered '
          'version. Rolling back takes about ten seconds.']],
        [1.25 * inch, 2.05 * inch, 3.3 * inch])]

    g.story += [P('Restoring from a backup', H2)]
    g.story += [P('Admin only. Console → menu → <b>Restore from backup</b>.')]
    for t in [
        'Save the .xlsx from one of the nightly emails — pick the last one from before the problem.',
        'Upload it. The console reads it and shows what is missing from the sheet, what differs, '
        'and what exists only on the sheet. <b>Nothing has been written at this point.</b>',
        'Choose: put back only what is missing (the safe option), or also overwrite quotes that '
        'differ.',
        'Confirm. It reports how many were restored and links the snapshot it saved first.',
    ]:
        g.story += [B(t)]
    g.story += [P(
        'Two guarantees: <b>a restore never deletes a live quote</b> — anything taken since the '
        'backup survives either option — and the current sheet is always saved to Drive first, so '
        'the restore itself can be undone by restoring that snapshot.')]

    g.story += [P('The spreadsheet', H1)]
    g.story += [P(
        'Named <b>Winter Quotes 2026-2027</b>. One tab per storage location, plus supporting tabs. '
        'A quote lives on exactly one tab, and moves automatically if its storage changes.')]
    g.story += [table(
        ['Tab', 'What is on it'],
        [['Inside', 'Quotes stored inside.'],
         ['Premium Inside', 'Quotes in premium inside storage.'],
         ['Outside', 'Quotes stored outside.'],
         ['No Storage', 'Services only — the customer keeps the unit.'],
         ['Golf Cart / E-Bike', 'One tab each; these units have no storage choice.'],
         ['Quote Started', 'People who reached the pricing and stopped. Excluded from every '
          'customer email sweep.'],
         ['Activity Log', 'Every console action, with who and when.']],
        [1.5 * inch, 5.1 * inch])]

    g.story += [P('What each row holds', H2)]
    g.story += [P(
        'Twenty-three columns: name, quote number, balance, timestamp, status, unit, phone, email, '
        'year/make/model, dimensions, total, deposit, pay choice, itemised services, quotes '
        'requested, customer notes, PDF link, sign link, reminder marker, <b>payload</b>, paid, '
        'and photos.')]
    g.story += [P(
        'The <b>Payload</b> column is the important one. It holds the complete quote as structured '
        'data — every selection the customer made, every staff change, the payment ledger, the '
        'email history, the Terms they agreed to. It is what makes reloading, re-pricing, '
        'correcting and next year\'s rollover possible. It looks like unreadable text in the '
        'cell; that is expected.')]

    g.story += [note('Do not hand-edit money or email cells',
        'Editing a total, a payment or a customer email directly in the spreadsheet changes the '
        'cell but not the underlying record, so the sheet, the PDF and the customer\'s own page '
        'will disagree from that moment on. Use the console or the spreadsheet menu, which update '
        'everything together. Reading the sheet is always safe.')]

    g.story += [P('Why the customer\'s selections are stored, not just the prices', H2)]
    g.story += [P(
        'Because a quote is a description of a job, not a number. Storing the selections means an '
        'old quote can be re-priced against this year\'s rates on reload, a corrected measurement '
        'can flow through every affected line, and next season can start from what each customer '
        'had last season.')]

    g.story += [P('How the software gets updated', H1)]
    g.story += [P(
        'The customer page, Terms, Privacy and the console are static files — they go live as soon '
        'as they change. The backend is deployed deliberately, from a button, and every deploy:')]
    for t in [
        'runs the full automated check suite first and <b>refuses to deploy if anything fails</b>;',
        'creates a numbered, permanent version;',
        'points the existing web address at it, so the address customers and staff use never '
        'changes.',
    ]:
        g.story += [B(t)]
    g.story += [P(
        'Rolling back is choosing the previous version from a dropdown — about ten seconds. The '
        'check suite covers, among other things: that prices have not moved unintentionally, that '
        'the customer page and backend agree on every rule, that people who only started a quote '
        'are never emailed, that credits are never hidden, that a re-measure survives a customer '
        'save, that a backup restore always snapshots first, and that the last admin cannot be '
        'removed.')]

    g.story += [P('Where the real risks are', H1)]
    g.story += [table(
        ['Risk', 'What reduces it', 'What is left'],
        [['The Google account is compromised', 'Strong password; two-factor authentication.',
          'This is the big one. Everything is in that account.'],
         ['A PIN is shared or seen', 'Per-person PINs, 12-hour sessions, activity logging, '
          'per-permission limits.', 'Reset the PIN from the console; it takes effect at once.'],
         ['A file link is forwarded', 'Links are not published anywhere.',
          'Anyone holding a photo or contract link can open it.'],
         ['A bad software change', 'Automated checks gate the deploy; versions roll back in '
          'seconds.', 'Front-end pages go live immediately on change.'],
         ['Spreadsheet damaged or deleted', 'Nightly backups, Google version history, restore '
           'tool.', 'Up to one day of work if the sheet is lost outright.'],
         ['Google outage', 'None available.', 'The system is unavailable until Google recovers. '
          'Quotes can be taken on paper.']],
        [1.5 * inch, 2.55 * inch, 2.55 * inch])]

    g.story += [P('If something goes badly wrong', H1)]
    g.story += [table(
        ['Situation', 'First move'],
        [['A quote looks wrong after an update', 'Roll the backend back one version, then tell '
          'Claude what changed.'],
         ['Quotes are missing from the sheet', 'Restore from last night\'s backup, missing-only '
          'mode. Nothing live is deleted.'],
         ['Someone edited cells by hand', 'Spreadsheet → File → Version history to undo, or '
          'restore the quote from a backup.'],
         ['A staff member leaves', 'Console → Staff &amp; permissions → Remove. Signs them out '
          'everywhere immediately.'],
         ['Suspected account compromise', 'Change the Google password and turn on two-factor '
          'first. Then reset every staff PIN from the console.']],
        [2.0 * inch, 4.6 * inch])]
    return g.build()


if __name__ == '__main__':
    for f in (doc1, doc2, doc3, doc4):
        print('wrote', f())
