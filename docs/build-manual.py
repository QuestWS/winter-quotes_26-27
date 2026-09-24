#!/usr/bin/env python3
"""Build the Winter Services Program Manual — the one-volume staff manual.

Run:  python3 docs/build-manual.py
Out:  docs/pdf/5 - Winter Services Program Manual.pdf

Covers every feature, how to do each thing, and the permission it needs. It
reuses the look of the four guides by loading their helpers from
build-guides.py, so the series stays visually consistent.

Keep every permission level accurate against the code: each `requireAuth_`
call in quote-logger-apps-script.gs, and the card gating in renderQuote() in
admin/index.html. Never put a real customer's details in an example — use
placeholder quote numbers (QW-26-0000).
"""
import os
import sys
import importlib.util

sys.dont_write_bytecode = True   # no __pycache__ in docs/

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('guides', os.path.join(HERE, 'build-guides.py'))
G = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(G)   # the builder only writes PDFs under __main__

from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph

P, B, gap, note, table, perm = G.P, G.B, G.gap, G.note, G.table, G.perm
H1, H2, BODY, SMALL, CELL = G.H1, G.H2, G.BODY, G.SMALL, G.CELL

W = [1.9 * inch, 1.05 * inch, 3.65 * inch]   # action | permission | notes


def steps(items):
    """A numbered walkthrough. Chris asked for these for anything clicked."""
    return [Paragraph(t, G.BULLET, bulletText='%d.' % (i + 1)) for i, t in enumerate(items)]


def perms(*ps):
    """Several permission chips in one cell ('pay' or 'adjust', etc.)."""
    parts = []
    for p in ps:
        c = G.PERM_COLOR.get(p, G.INK)
        parts.append('<font color="#%s"><b>%s</b></font>' % (c.hexval()[2:], p))
    return Paragraph(' / '.join(parts), CELL)


def section(g, title):
    g.story += [PageBreak(), P(title, H1)]


def manual():
    g = G.Guide('5 - Winter Services Program Manual.pdf', 'Winter Services Program Manual',
                'Every feature of the quote, sign, pay, storage and relaunch system — what it '
                'does, how to use it, and who is allowed to.', '5')
    g.head()
    s = g.story

    # ------------------------------------------------------------------
    s += [P('How to use this manual', H1)]
    s += [P(
        'This is the complete reference for Quest Watersports\' winter services program: the '
        'customer quote page, the scan-to-sign page, the staff console, the yard app, the '
        'emails, the spreadsheet and the owner-only jobs in Google Apps Script. Each section says '
        '<b>what the feature is for</b>, <b>how to do it step by step</b>, and <b>which '
        'permission it needs</b>. Section 15 is a one-page "I want to…" index.')]
    s += [P(
        'Permission names appear in colour throughout, e.g. ' +
        '<font color="#1E6B3A"><b>pay</b></font>, <font color="#C08A22"><b>adjust</b></font>, '
        '<font color="#A6341F"><b>admin</b></font>. <b>view</b> means anyone who can sign in.')]
    s += [table(['Section', 'Covers'], [
        ['1. The system at a glance', 'The pieces, the web addresses, and a season from start to finish'],
        ['2. Permission levels', 'Every permission, who holds it, and the full action-by-permission matrix'],
        ['3. Signing in', 'PINs, sessions, lock-outs, the console and yard app together'],
        ['4. The customer quote page', 'What customers see and do; helping a customer over the phone'],
        ['5. Scan to sign', 'The counter QR-code page'],
        ['6. The staff console — a quote', 'Every card on an open quote'],
        ['7. The staff console — season tools', 'Storage view, yard sheets, send to all, re-price, imports, pause, staff, restore'],
        ['8. The yard app', 'The three lists, pulling and storing, notes, voice, photos, measurements'],
        ['9. Emails', 'Every email, who sends it, and the only two that send themselves'],
        ['10. Money rules', 'Deposits, payments, refunds, credits, the payment lock, fees'],
        ['11. The spreadsheet and Drive', 'Tabs, folders, backups, what never to do by hand'],
        ['12. The spreadsheet menu', 'The desktop-only Quest Quotes menu'],
        ['13. Owner jobs', 'Apps Script functions, deploys, the season rollover'],
        ['14. Troubleshooting', 'Common messages and what they really mean'],
        ['15. Quick reference', 'I want to… → where → permission'],
    ], [2.3 * inch, 4.3 * inch])]

    # ------------------------------------------------------------------
    section(g, '1. The system at a glance')
    s += [P(
        'A customer can build a quote, sign the storage agreement and pay a deposit from their '
        'couch; staff can run the whole operational and financial side of the season from a '
        'phone. Everything shares one set of pricing rules and one Google spreadsheet.')]
    s += [table(['Piece', 'Who uses it', 'Address / where'], [
        ['Quote page', 'Customers (and staff helping them)', 'questws.github.io/winter-quotes_26-27/'],
        ['Scan to sign', 'Customers at the service counter', 'questws.github.io/winter-quotes_26-27/sign.html'],
        ['Staff console', 'All staff, PIN required', 'questws.github.io/winter-quotes_26-27/admin/'],
        ['Yard app', 'Yard crew, PIN required (same PIN)', 'questws.github.io/winter-quotes_26-27/yard/ — add to home screen'],
        ['Spreadsheet', 'Owner; read by everything', '"Winter Quotes 2026-2027" in questwsottawa@gmail.com'],
        ['Drive season folder', 'Owner; links shown in the console', 'Quote PDFs, Unit Photos/, Signed Contracts/, Voice Notes/'],
        ['Legacy console', 'Fallback only', 'The web-app URL with ?page=admin — same PINs'],
        ['Terms / Privacy', 'Anyone', 'terms.html and privacy.html on the same site'],
    ], [1.35 * inch, 1.9 * inch, 3.35 * inch])]

    s += [P('A season, start to finish', H2)]
    s += steps([
        '<b>Quote.</b> The customer builds a quote on the quote page (or staff build one with '
        'them). Contact details come first; that click is also their acceptance of the Terms. '
        'The quote is saved to the spreadsheet, a PDF is filed in Drive, and service@ is told.',
        '<b>Sign.</b> The customer signs the Adobe storage agreement — on the quote page, from '
        'the <b>Review &amp; sign</b> button in any email, or at the counter via the QR code. '
        'Staff upload the signed copy to the quote.',
        '<b>Pay.</b> The customer pays a deposit (online, or in person). Staff record the '
        'payment in the console; the quote locks and becomes an <b>Invoice</b>.',
        '<b>Schedule.</b> Customers who have paid are asked when they want their unit out '
        '(done now / on a date / will call). Late answers after the pay-by date add the late '
        'retrieval surcharge automatically.',
        '<b>Haul out.</b> The office prints the haul-out list; the crew works the <b>To pull</b> '
        'list in the yard app. Only units that are <b>both signed and paid</b> may be pulled.',
        '<b>Store.</b> Pulled and dropped-off units appear on <b>To store</b>; the crew taps '
        '<b>Stored ✓</b>. Staff send "We have your unit". Photos, measurements, key and slip '
        'details are recorded as they are learned; measurements re-price the quote.',
        '<b>Winter.</b> Balance reports reach Chris on the 1st and 15th (Nov–Apr). Late-fee '
        'warnings and late fees are staff decisions, applied from the console.',
        '<b>Spring.</b> Staff send the spring alert (to one or all), "You\'re up next", and '
        '"Back in the water / back home".',
    ])

    s += [note('Estimates until the 2026–2027 rate card lands',
        'The price list still holds 2025–2026 rates, so every quote, PDF and email currently '
        'carries an <b>estimate</b> banner, and a deposit is described as <b>reserving a storage '
        'space and retrieval spot</b> — not locking in a price. This switches off everywhere at '
        'once when the new rates are entered (Section 13).')]

    # ------------------------------------------------------------------
    section(g, '2. Permission levels')
    s += [P(
        'Every staff member has their own 4-digit PIN. What they can do is decided by the '
        'permissions on their account, checked <b>by the server</b> on every action — hiding a '
        'button is a convenience, not the protection. Every action is written to the '
        '<b>Activity Log</b> tab with the staff member\'s name.')]
    s += [table(['Permission', 'Shown in Staff panel as', 'What it allows'], [
        [perm('view'), 'Anyone signed in', 'Search and open quotes, print quotes, the storage '
         'overview, printing yard sheets and the haul-out list, copying the customer link, the '
         'yard app lists.'],
        [perm('pay'), 'Payments', 'Record payments, deposits and refunds; upload a signed contract.'],
        [perm('adjust'), 'Adjustments', 'Change what a customer owes: discounts/adjustments, edit '
         'or delete lines, late fees, penalties, price a quote request, season timing, season '
         're-price, load an old sheet.'],
        [perm('email'), 'Emails', 'Preview and send any customer email, including "Ask them to '
         'sign" and Send to all.'],
        [perm('photos'), 'Photos', 'Upload condition photos and video; open the photo folder.'],
        [perm('keys'), 'Keys &amp; slip', 'Yard facts: keys, slip, trailer location, yard alert, '
         'yard status (pulled / dropped off / stored), yard log, staff notes, voice notes.'],
        [perm('measure'), 'Re-measure', 'Correct dimensions, trailer, motors and storage '
         'location — which re-prices the quote. Console and yard app.'],
        [perm('admin'), 'Admin', 'Everything above, plus: staff accounts and PINs, delete a '
         'quote, restore from backup, pause automatic emails, bulk-import a whole folder.'],
    ], [0.95 * inch, 1.35 * inch, 4.3 * inch])]

    s += [P('Two permissions have a built-in default', H2)]
    s += [B('<b>keys</b> — if never set for someone, they have it when they already hold '
            '<b>pay</b> or <b>adjust</b>.')]
    s += [B('<b>measure</b> — if never set, they have it when they have <b>keys</b>. So '
            'whoever can record yard facts can correct a measurement.')]
    s += [B('An explicit setting always wins, including switching it <b>off</b>.')]

    s += [P('The roster as seeded', H2)]
    s += [table(['Person', 'admin', 'pay', 'adjust', 'email', 'photos', 'keys', 'measure'], [
        ['Chris', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes'],
        ['Jeff', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes'],
        ['John', '—', 'yes', '—', 'yes', 'yes', 'yes', '—*'],
        ['Rex', '—', 'yes', '—', 'yes', 'yes', 'yes', '—*'],
        ['Jess', '—', 'yes', '—', 'yes', 'yes', 'yes', '—*'],
        ['Marina', '—', '—', '—', '—', 'yes', '—', '—'],
    ], [1.1 * inch] + [0.785 * inch] * 7)]
    s += [P('* Re-measure was seeded <b>off</b> for John, Rex and Jess. Chris has said the yard '
            'crew should re-measure — turn it on in the Staff panel (<b>Re-measure</b> button) if it '
            'is not on already. The live roster is whatever the <b>Staff '
            '&amp; permissions</b> panel shows — check there.', SMALL)]

    s += [P('Changing someone\'s permissions', H2)]
    s += [P('Needs ' + '<font color="#A6341F"><b>admin</b></font>.')]
    s += steps([
        'Console → ☰ menu → <b>Staff &amp; permissions</b>.',
        'Find the person. Each permission is a button; a highlighted button is on. Tap to '
        'toggle.',
        '<b>New account:</b> type a name and tick the starting permissions → <b>Create '
        'account</b>. The new PIN is shown once — hand it over privately.',
        '<b>Reset PIN:</b> tap <b>Reset PIN</b> on their row; the new PIN is shown once.',
        '<b>Remove:</b> tap <b>Remove</b>. They are signed out everywhere immediately.',
        'Changes take effect at their <b>next sign-in</b> — ask them to sign out and back in.',
    ])
    s += [P('Safeguards: nobody can remove their own account, and the last admin can never be '
            'removed or demoted.', SMALL)]

    s += [P('Every action and the permission it needs', H1)]
    matrix = [
        ['Search / open a quote', perm('view'), 'Quote number, or at least 2 letters of the last name'],
        ['Print quote, copy customer link', perm('view'), ''],
        ['Storage overview; print yard sheets / haul-out list', perm('view'), ''],
        ['Yard app — see the lists and units', perm('view'), ''],
        ['Record payment / deposit / refund', perm('pay'), 'Optional receipt email'],
        ['Upload a signed contract', perm('pay'), 'PDF or photo of the signed page'],
        ['Adjustment (discount or charge)', perm('adjust'), 'Optional email of updated copy'],
        ['Edit or delete a line item', perm('adjust'), ''],
        ['Late fee', perm('adjust'), 'Card only shows when a balance is owed'],
        ['Penalties (pumpout, late retrieval)', perm('adjust'), 'Nobody is emailed'],
        ['Price a quote request', perm('adjust'), 'Items the customer asked to have quoted'],
        ['Season timing (done now / date / will call)', perm('adjust'), 'Late date adds surcharge'],
        ['Re-price the season at current rates', perm('adjust'), 'Snapshot first; no emails'],
        ['Load one old sheet', perm('adjust'), ''],
        ['Bulk import a whole season folder', perm('admin'), ''],
        ['Send any customer email / "Ask them to sign"', perm('email'), 'Always previewed first'],
        ['Send to all (spring / fall)', perm('email'), 'Recipient picker; preview first'],
        ['Condition photos and video', perm('photos'), 'Console and yard app'],
        ['Keys, slip, trailer location', perm('keys'), ''],
        ['Yard alert (set / clear)', perm('keys'), 'Console only — the yard app shows it'],
        ['Yard status: pulled / dropped off / stored / undo', perm('keys'), 'Pull only if cleared'],
        ['Yard log entry (typed or voice)', perm('keys'), 'Append-only'],
        ['Staff notes', perm('keys'), 'Never seen by the customer'],
        ['Re-measure / change storage / motors', perm('measure'), 'Re-prices; preview then apply'],
        ['Staff accounts, PINs, permissions', perm('admin'), ''],
        ['Pause / resume automatic emails', perm('admin'), 'Banner shows for everyone'],
        ['Restore from a backup', perm('admin'), 'Snapshot first'],
        ['Delete a quote', perm('admin'), 'Archived, never destroyed'],
    ]
    s += [table(['Action', 'Needs', 'Notes'], matrix, W)]

    # ------------------------------------------------------------------
    section(g, '3. Signing in')
    s += steps([
        'Open the staff console or the yard app on any phone or computer.',
        'Type your 4-digit PIN → <b>Log in</b> / <b>Sign in</b>.',
        'You stay signed in for <b>12 hours</b>. The console and the yard app share the '
        'sign-in on the same phone, so one PIN per shift covers both.',
        '<b>Log out</b> is in the ☰ menu (console) or at the top of the yard app. Always log '
        'out on a shared or borrowed device.',
    ])
    s += [note('Wrong PINs',
        'After <b>10 wrong PINs</b> sign-in pauses for everyone for 15 minutes and Chris is '
        'emailed. Wait it out; if it keeps happening, reset PINs from the Staff panel.', 'ice')]
    s += [P('Installing the yard app on a phone', H2)]
    s += steps([
        'Open questws.github.io/winter-quotes_26-27/yard/ in Safari (iPhone) or Chrome (Android).',
        'iPhone: Share → <b>Add to Home Screen</b>. Android: ⋮ menu → <b>Add to Home screen</b> '
        '/ <b>Install app</b>.',
        'Open it from the new icon and sign in with your PIN.',
    ])

    # ------------------------------------------------------------------
    section(g, '4. The customer quote page')
    s += [P(
        'Public — no sign-in. Customers use it on their own; staff use the same page to build a '
        'quote with a customer at the counter or on the phone. Four unit types: <b>boat</b>, '
        '<b>jet ski</b>, <b>golf cart</b>, <b>e-bike</b>.')]
    s += [P('Building a quote', H2)]
    s += steps([
        '<b>Start.</b> Choose the unit type and enter name, phone and email (all required). The '
        'button beside the Terms acknowledgment is the customer\'s acceptance of the Terms; the '
        'version and time are recorded. From this moment the visit appears on the <b>Quote '
        'Started</b> tab as a lead.',
        'If that email and last name already started a quote, the page offers to <b>continue '
        'that quote</b> or start a new one.',
        '<b>Boat details</b> — trailer or not, length (LOA), beam, length with trailer.',
        '<b>Engines</b> — one motor type (inboard, outboard, I/O or jet drive), any number of '
        'that type, and the winterization level; drive-train service.',
        '<b>Onboard systems</b> — water systems, heads, pump-out, A/C, generator, ballast.',
        '<b>Storage &amp; retrieval</b> — inside, premium inside, outside, or no storage; '
        'retrieval and relaunch.',
        '<b>Shrinkwrap &amp; extras</b> — shrinkwrap, washing, and <b>quote requests</b> (hull, '
        'running gear, detailing) that staff price later. Detail options can all be chosen '
        'together on purpose.',
        '<b>Jet skis</b> have their own steps: how many skis <b>on this trailer</b>, detailing, '
        'and storage. Two skis on one trailer is one quote; two trailers are two quotes. A jet '
        'ski needs a trailer. <b>Golf carts and e-bikes</b> are flat-rate.',
        '<b>Review.</b> The quote ticket shows every line, the deposit due and the total. From '
        'here: <b>Print quote</b>, <b>Email me this quote</b>, or continue to <b>Sign &amp; pay</b>.',
        '<b>Sign &amp; pay.</b> The Adobe agreement opens inside the page with the quote number '
        'filled in. The page then shows the amount to pay and a link to the secure payment page; '
        'customers put their quote number in the memo. Cards carry a 3% fee; cash, check, debit, '
        'Zelle and ACH do not.',
    ])
    s += [P('Things the page does on its own', H2)]
    s += [B('Warns about anything the crew will need that is missing — slip, Heritage Harbor '
            'pickup address, key location, email. Golf carts cannot be picked up without keys; '
            'boats and jet skis without keys risk a tow/start fee.')]
    s += [B('Saves the quote to the correct storage tab and files a PDF in Drive.')]
    s += [B('Once a payment is recorded the page goes <b>read-only</b> with a gold banner and '
            'says <b>Invoice</b>; the customer can view but not change it.')]
    s += [B('The server re-prices every save with the same rules. If the page and server '
            'disagree, the server\'s figure is kept and service@ gets a ⚠️ PRICE DRIFT email.')]

    s += [P('Getting back to a quote', H2)]
    s += [P(
        'Customers reload a quote with their <b>quote number + last name</b>. Every email '
        'carries a "View my quote online" link that opens it already filled in. Staff can give '
        'the same link from the console (<b>Customer link → Copy link</b>, any signed-in staff) '
        '— text it or read it out.')]

    s += [P('The season-done survey', H2)]
    s += [P(
        'Once a customer has paid something, their quote/invoice emails ask when they want the '
        'unit out: <b>Done now</b>, <b>on a date</b>, or <b>Will call</b>. A date after the '
        'pay-by date adds the late retrieval surcharge; changing to an on-time date removes it. '
        'Staff can set the same answer from the console (Section 6, '
        '<font color="#C08A22"><b>adjust</b></font>).')]

    # ------------------------------------------------------------------
    section(g, '5. Scan to sign (counter QR code)')
    s += [P(
        'sign.html is the page the laminated counter flyer\'s QR code points to. It exists so '
        'the quote number on a signed contract is checked <b>before</b> the customer signs, not '
        'discovered wrong afterwards.')]
    s += [P('What the customer does', H2)]
    s += steps([
        'Scan the QR code at the counter.',
        'Type the quote number — <b>1255</b>, <b>QW261255</b> and <b>QW-26-1255</b> all work; '
        'the page rewrites it in the full form so they can see it.',
        'The page confirms it: a masked last initial, the unit, and the slip if known. Nothing '
        'private is shown.',
        'Tap <b>Continue</b> — the Adobe agreement opens with the quote number (and slip) '
        'already filled in.',
        'No quote number? <b>"I don\'t have my quote number"</b> opens the blank agreement.',
    ])
    s += [P('It never blocks a signature: if the lookup fails or times out the customer can '
            'still continue. A pre-filled link can be made as '
            'sign.html?quote=1255&amp;slip=B-14.', SMALL)]
    s += [note('Before printing the flyer',
        'Generate the QR code against <b>…/sign.html</b>, not the Adobe link. After any rename '
        'of an Adobe form field, send one real test signature through it — a mismatched field '
        'name fails silently with blank contracts.')]

    # ------------------------------------------------------------------
    section(g, '6. The staff console — working a quote')
    s += [P('Finding a quote', H2)]
    s += [P('Any signed-in staff (<b>view</b>).')]
    s += steps([
        'Type in the search box — a quote number (QW-26-1255 or just 1255), or at least two '
        'letters of the last name ("Kuj") → <b>Look up</b>. Phone and email are not searched.',
        'One match opens directly; several show a <b>Matches</b> list — tap the one you want.',
        '✕ on any panel closes it.',
    ])
    s += [P('The quote card (everyone)', H2)]
    s += [B('<b>Name, status pill, Total / Paid / Balance.</b> A negative balance is a '
            '<b>credit</b> owed to the customer.')]
    s += [B('<b>Print quote</b> — the current PDF.')]
    s += [B('<b>Customer link</b> — Copy link / Open. Hidden if the quote has no last name.')]
    s += [B('<b>Quote requests</b> — items the customer asked to have priced (Price this → Add '
            'as line, <font color="#C08A22"><b>adjust</b></font>).')]
    s += [B('<b>Season timing</b> — Done now / Set date… / Will call '
            '(<font color="#C08A22"><b>adjust</b></font>).')]
    s += [B('<b>Signed contract</b> — the link, or "not on file" with Upload '
            '(<font color="#1E6B3A"><b>pay</b></font>) and <b>Ask them to sign</b> '
            '(<font color="#1D3A57"><b>email</b></font>).')]
    s += [B('<b>Line items</b> — Edit / ✕ beside each line '
            '(<font color="#C08A22"><b>adjust</b></font>).')]
    s += [B('<b>Email history</b> — every email sent for this quote, when, and by whom.')]

    cards = [
        ('Record payment / deposit', 'pay', [
            'Enter the <b>amount</b>. A refund is a <b>negative</b> amount (e.g. -200).',
            'Enter the <b>method</b> — Cash, Check #1042, Zelle, card…',
            'Leave <b>Email receipt to customer</b> ticked unless there is a reason not to.',
            'Tap <b>Record payment</b>. The quote locks and becomes an Invoice; the PDF is rebuilt.',
        ], 'Payments are a permanent ledger: never deleted, only corrected with another entry. '
           'If the console says it lost the reply, it checks what happened — <b>do not record '
           'the payment again</b> until you have reloaded the quote and looked.'),
        ('Upload a signed contract', 'pay', [
            'On the quote card, <b>Signed contract → Upload signed copy</b> (or <b>Replace</b>).',
            'Choose the PDF from Adobe, or take a photo of a paper signature.',
            'The link then appears on the quote, the "Ask them to sign" buttons disappear, and '
            'if a deposit is already in, the unit becomes cleared to pull.',
        ], None),
        ('Condition photos &amp; video', 'photos', [
            'Choose <b>Winter</b> (arrival / haul-out) or <b>Spring</b> (relaunch).',
            '<b>Take photo</b> or <b>Record video</b> opens the camera; <b>Upload from '
            'gallery</b> picks existing files (several at once).',
            'Watch the progress bar; <b>Open folder</b> shows the Drive folder.',
        ], 'Large videos upload directly to Drive and continue if the signal drops.'),
        ('Keys &amp; slip', 'keys', [
            'Fill in where the keys will be, the slip number, and (if the unit has a trailer) '
            'where the trailer is.',
            'Tap <b>Save keys &amp; slip</b>.',
        ], 'A blank box returns to what the customer told us. No trailer box on a quote that '
           'says no trailer — if it really has one, tick <b>Stored on its trailer</b> under '
           'Unit details (that re-prices). Golf carts and e-bikes never ask about trailers.'),
        ('Unit details &amp; storage (re-measure)', 'measure', [
            'Change LOA / beam / length with trailer (or the jet ski\'s stored length × width), '
            'the trailer tick, motor type / count / service level, or the storage location.',
            'Optionally add a note for the customer.',
            '<b>Preview the change</b> — shows each line before and after, the new total and '
            'balance, any storage move and any warning (e.g. too wide for inside).',
            '<b>Apply this change</b> to save. The quote re-prices and moves tab if storage changed.',
            'Tell the customer with the <b>Dimensions updated</b> email (it attaches the new PDF).',
        ], 'Works after a deposit — quote, deposit, pull, measure, re-bill is the normal order. '
           'A beam over the limit is flagged, never moved automatically.'),
        ('Yard alert', 'keys', [
            'Type one line the crew must read before touching the unit — "no keys, do not tow".',
            '<b>Save alert</b>. It shows on the yard app list, at the top of the unit, and on '
            'both printed sheets.',
            '<b>Clear it</b> as soon as it stops being true.',
        ], 'Maximum 160 characters. Set only from the console; the customer never sees it.'),
        ('Yard status', 'keys', [
            'Tap the new state: <b>Pulled</b>, <b>Dropped off</b>, <b>Stored</b>, or undo.',
            'Use <b>Dropped off</b> when a customer drives their unit in — that puts it on the '
            'crew\'s <b>To store</b> list.',
        ], '<b>Pulled</b> is refused unless the unit is cleared (signed <b>and</b> paid).'),
        ('Yard log', 'keys', [
            'Type what was observed — "gelcoat crack starboard bow, photographed".',
            '<b>Add to the log</b>. Stamped with your name and the time.',
        ], 'Append-only: entries are never edited or deleted.'),
        ('Staff notes', 'keys', [
            'Write why the quote is the way it is — discounts, odd dimensions, phone agreements.',
            '<b>Save note</b>. Never on the PDF or in any email.',
        ], None),
        ('Penalties', 'adjust', [
            'Tap to apply or remove <b>Pumpout service charge</b> or <b>Late retrieval surcharge</b>.',
        ], 'Charges the customer is never offered on the quote page. Nobody is emailed.'),
        ('Adjustment', 'adjust', [
            'Amount: <b>negative for a discount</b> (-50), positive for a charge.',
            'Wording as it should appear on the invoice.',
            'Tick <b>Email the updated copy now</b> if the customer should get it now.',
            '<b>Apply adjustment</b>.',
        ], 'Survives the customer re-saving the quote. If the thing it was attached to is '
           'later removed, service@ is emailed a REVIEW note.'),
        ('Edit or delete a line', 'adjust', [
            'Line items → <b>Edit</b> on the line; change amount and/or wording → <b>Save change</b>.',
            'Or tap <b>✕</b> to delete the line.',
        ], None),
        ('Late fee', 'adjust', [
            'The card appears only when a balance is owed, and suggests an amount (a first fee '
            'of 10% of the balance; monthly 2%, minimum $5).',
            'Enter the amount and invoice wording.',
            'Leave <b>Email "you\'ve been charged a late fee" now</b> ticked to tell them.',
            '<b>Apply late fee</b>. Send the <b>Late fee warning</b> email first, as a courtesy.',
        ], None),
        ('Customer emails', 'email', [
            'Tap the email you want (list in Section 9).',
            'A <b>preview</b> opens showing exactly what will be sent.',
            '<b>Send it</b> or <b>Cancel</b>. Sent emails appear in Email history.',
            'For <b>You\'re up next</b>: choose the direction (autumn haul-out or spring '
            'relaunch), type when ("tomorrow"), then send.',
        ], 'The card only shows if the quote has an email address.'),
        ('Delete this quote', 'admin', [
            'Last card on the quote. Type the quote number exactly, and a reason.',
            'If the quote has money or a signed contract, tick the extra confirmation.',
            '<b>Delete this quote</b>.',
        ], 'Nothing is destroyed: the row goes to the <b>Deleted Quotes</b> tab with who, when '
           'and why, and the number is never reused. The PDF goes to the Drive bin (30 days); '
           'photos and contracts stay. Delete duplicates only after the customer has finished — '
           'an open quote page can re-save it.'),
    ]
    for title, p, how, why in cards:
        s += [P('%s — %s' % (title, '<font color="#%s">%s</font>' % (
            G.PERM_COLOR.get(p, G.INK).hexval()[2:], p)), H2)]
        s += steps(how)
        if why:
            s += [P(why, SMALL)]

    # ------------------------------------------------------------------
    section(g, '7. The staff console — season tools')
    s += [P('These live in the ☰ menu and on the home tiles; each appears only for staff '
            'allowed to use it.')]

    s += [P('Storage overview — <font color="#4A81A6">view</font>', H2)]
    s += steps([
        '☰ → <b>Storage view</b>. Every unit grouped by storage area.',
        'Tabs across the top: <b>Everyone</b>, <b>No deposit</b>, <b>Deposit paid</b> — for '
        '"who still owes a deposit" and "who paid but never signed".',
        'Tags on each row: <b>NO CONTRACT — DO NOT PULL</b> (red: paid, not signed), <b>NO '
        'DEPOSIT — DO NOT PULL</b> (gold: signed, not paid), <b>not authorised</b> (neither).',
        '<b>Print yard sheets</b> — one page per storage area for the tab you are on, with keys '
        'and alerts. <b>Print haul-out list</b> — the yard-wide pull order.',
    ])
    s += [note('The pull rule — Chris\'s rule',
        'A unit is <b>cleared to pull only when it is both signed and paid</b>. Paid but not '
        'signed, or signed but not paid, is a <b>HOLD</b>: on the haul-out list for planning, '
        'shaded, stamped DO NOT PULL, with no tick box. Neither is on a separate '
        '<b>DO NOT TOUCH — NOT AUTHORISED</b> page for the office. The server decides this; '
        'the console, the paper and the yard app just show it.')]
    s += [P('The haul-out list is sorted: ready now → requested dates (earliest first) → will '
            'call → no answer. It shows customer, unit and size, storage, trailer, slip, keys, '
            'timing, alerts and notes.', SMALL)]

    s += [P('Send to all — <font color="#1D3A57">email</font>', H2)]
    s += steps([
        '☰ → <b>Send to all</b>. No quote needs to be open.',
        'Choose <b>Spring</b> (skips No Storage customers) or <b>Fall</b> (everyone).',
        '<b>See who this goes to</b> — counts per tab, anyone without an email, a quota warning '
        'over 400, and a checkbox list with everyone ticked. Untick anyone to leave out.',
        '<b>Preview the email</b> — a real one, rendered for the first recipient.',
        'Send. Each quote\'s Email history records it.',
    ])
    s += [P('Leads and draft imports are never included.', SMALL)]

    s += [P('Re-price at current rates — <font color="#C08A22">adjust</font>', H2)]
    s += steps([
        '☰ → <b>Re-price at current rates</b> → <b>See what would change</b>. Nothing is written.',
        'Review each quote\'s before → after → difference, and the season net change. Quotes '
        'whose storage area would change are listed, not moved.',
        'Select all, or tick the ones to apply → apply. It runs in batches of 15 and takes a '
        'snapshot of the spreadsheet first (link shown).',
        'Discounts and adjustments survive; deposits are untouched, so balances move. '
        '<b>Nobody is emailed</b> — use Send to all or per-quote emails afterwards.',
    ])

    s += [P('Load from an old sheet — <font color="#C08A22">adjust</font>; whole folder — '
            '<font color="#A6341F">admin</font>', H2)]
    s += [P('Turns last season\'s one-spreadsheet-per-customer files into quotes here, priced at '
            'today\'s rates. Broken (#REF!) files are recovered from the master price sheet.')]
    s += steps([
        '<b>One file:</b> ☰ → <b>Load from an old sheet</b> → pick the file → <b>Read it</b>. '
        'Check the preview (it flags comparison sheets, multiple units, and anything priced '
        'differently) → <b>Import as a new quote</b>.',
        '<b>Whole folder (admin):</b> same card → <b>1 · Scan the folder</b>. It runs in the '
        'background and emails Chris a Drive report when done.',
        'Open the report. Delete any row you don\'t want imported (or change its first cell '
        'from IMPORT). Customers who already have a quote for that unit type are skipped.',
        '<b>2 · Import the approved rows</b>. Everything lands on the <b>Import</b> tab.',
        'If it stalls: <b>It has stalled — nudge it</b>. To end it: <b>Stop the run</b>. If '
        'the Import tab looks wrong: <b>Check &amp; repair the Import tab</b>.',
    ])
    s += [note('Imported quotes are drafts',
        'A quote on the Import tab is invisible to the yard, the storage view, send-to-all, the '
        'balance report and the 9am reminder. It is <b>released</b> — moved onto its real '
        'storage tab — the first time anyone emails it to the customer (staff, or the customer '
        'using "Email me this quote"). Import <b>after</b> the new rate card, not before.')]

    s += [P('Automatic emails (pause / resume) — <font color="#A6341F">admin</font>', H2)]
    s += steps([
        '☰ → <b>Automatic emails</b> → <b>Pause automatic emails</b>. This stops the 10-day '
        'reminder and the lead follow-up. A banner shows for all staff while paused.',
        'To resume, the same card → <b>Resume automatic emails</b>. Resuming <b>restarts the clocks</b>: no reminders for 10 '
        'days and no lead follow-ups for 24 hours — so a season-rollover blast can\'t follow '
        'your own "here is your updated quote" email.',
    ])
    s += [P('Staff emails (invoices, receipts, send to all) keep working while paused.', SMALL)]

    s += [P('Staff &amp; permissions — <font color="#A6341F">admin</font>', H2)]
    s += [P('See Section 2.')]

    s += [P('Restore from a backup — <font color="#A6341F">admin</font>', H2)]
    s += steps([
        'Save the <b>.xlsx</b> from a nightly backup email (6pm daily, to Chris).',
        '☰ → <b>Restore from backup</b> → choose the file. It compares it with the live sheet; '
        'nothing is written yet.',
        'Choose <b>Put back the missing quotes</b> (safe) or <b>Also overwrite the ones that '
        'differ</b> (only if you are sure the live copies are wrong).',
        'A snapshot is taken first, so the restore can itself be undone. A restore never '
        'deletes a live quote — but it can bring back a quote that was deliberately deleted.',
    ])

    # ------------------------------------------------------------------
    section(g, '8. The yard app')
    s += [P('The haul-out list as a phone app for the crew. Same PIN as the console. Anyone '
            'can view; recording anything needs <font color="#4A81A6"><b>keys</b></font>; '
            'measurements need <font color="#4A81A6"><b>measure</b></font>; photos need '
            '<font color="#5C7185"><b>photos</b></font>.')]
    s += [table(['List', 'Shows', 'Order'], [
        ['To pull', 'Units in a slip not yet pulled', 'The order customers asked for — '
         'deliberately not re-sortable'],
        ['To store', 'Everything pulled, plus everything marked dropped off', 'Search; sort by '
         'location (grouped) or name'],
        ['Stored', 'Everything put away', 'Search; sort by location or name'],
    ], [1.0 * inch, 2.7 * inch, 2.9 * inch])]
    s += [P('Everyday use', H2)]
    s += steps([
        'Open the app and pick a list. A ⚠ strip on a row is a <b>yard alert</b> — read it '
        'before walking over.',
        'Tap a unit to open it. The first thing shown is the verdict: <b>CLEARED TO PULL</b>, '
        'a hold stamp, or <b>DO NOT TOUCH — NOT AUTHORISED</b>.',
        '<b>To pull a unit:</b> open it and tap <b>Mark pulled</b>. Only offered when cleared; '
        'otherwise the button shows the hold stamp instead.',
        '<b>To store:</b> tap <b>Stored ✓</b> on the To store row — no need to open each one.',
        '<b>Mark in storage</b> is also on the opened unit. <b>Undo — back to not started</b> '
        'fixes a mis-tap.',
        '<b>Refresh</b> reloads the lists.',
    ])
    s += [P('Dropped off is recorded from the console only (the counter sees the customer '
            'arrive). The yard alert is set and cleared from the console only.', SMALL)]
    s += [P('On an opened unit', H2)]
    s += [B('<b>Facts</b> — slip, keys, trailer, storage, requested timing, balance. Red means '
            'missing information somebody should find out.')]
    s += [B('<b>Yard log</b> — type a note → <b>Save note</b>; or tap record for a <b>voice '
            'note</b> (stop, play back, discard or save). The recording is filed in the unit\'s '
            'Voice Notes folder and typed up automatically once the AssemblyAI key is installed '
            '(Section 13).')]
    s += [B('<b>Photos &amp; video</b> — separate buttons for camera photo, camera video, and '
            '<b>Choose from gallery</b>. Always filed as Winter. Uploads continue in the '
            'background (a chip at the bottom) — keep working; only closing the app stops them.')]
    s += [B('<b>Measurements</b> — edit the dimensions and "stored on its trailer" → <b>Price '
            'the change</b> → review → <b>Apply this change</b>. Re-prices the quote; nobody is '
            'emailed. Motors and a chosen storage move stay in the console.')]
    s += [note('If the app says it lost the reply',
        'It will tell you not to tap again. Refresh the list and look at the unit before '
        'repeating anything — the action may already have gone through.', 'ice')]

    # ------------------------------------------------------------------
    section(g, '9. Emails')
    s += [P('Every email except two is a human decision: previewed, then sent by a named staff '
            'member, and recorded in the quote\'s Email history. Replies go to service@.')]
    s += [table(['Email', 'Sent by', 'Needs', 'Use it when'], [
        ['Quote / invoice', 'Customer ("Email me this quote") or staff (Re-send invoice)', perms('email'), 'Any time; attaches the PDF'],
        ['Payment receipt', 'Staff, on recording a payment', perms('pay'), 'Each payment (tick box)'],
        ['Updated copy', 'Staff, on an adjustment', perms('adjust'), 'After a discount/charge (tick box)'],
        ['We have your unit', 'Staff', perms('email'), 'Unit has arrived / been pulled'],
        ['End of season note', 'Staff, one or all', perms('email'), 'Autumn: last call for work, haul-out timing'],
        ['Spring alert', 'Staff, one or all', perms('email'), 'Spring relaunch scheduling'],
        ['You\'re up next', 'Staff', perms('email'), 'About to haul out (autumn) or relaunch (spring)'],
        ['Back in / back home', 'Staff', perms('email'), 'Unit relaunched or returned'],
        ['Dimensions updated', 'Staff', perms('email'), 'After a re-measure; attaches new PDF'],
        ['Late fee warning', 'Staff', perms('email'), 'Before charging a late fee'],
        ['Late fee charged', 'Staff, on applying a fee', perms('adjust'), 'Tick box on the Late fee card'],
        ['Ask them to sign', 'Staff', perms('email'), 'No contract on file; never to a lead'],
        ['10-day reminder', '<b>Automatic</b>, 9am', '—', 'Unpaid quote, 10 days after sending'],
        ['Lead follow-up', '<b>Automatic</b>, 12:15pm', '—', 'Started but never finished, after 24h'],
    ], [1.35 * inch, 1.85 * inch, 0.8 * inch, 2.6 * inch])]
    s += [P('Emails to staff', H2)]
    s += [table(['What', 'To', 'When'], [
        ['New quote / save / start notices, PRICE DRIFT, REVIEW', 'service@', 'As they happen'],
        ['Nightly backup (.xlsx)', 'Chris', '6pm daily'],
        ['Balance report', 'Chris', '7am on the 1st and 15th, Nov–Apr'],
        ['Wrong-PIN lock-out, pause toggled', 'Chris / service@', 'As they happen'],
        ['Bulk import report ready', 'Chris', 'When a scan finishes'],
    ], [3.0 * inch, 1.4 * inch, 2.2 * inch])]
    s += [note('Emails cannot be recalled or corrected',
        'An email is frozen when it is sent. Fixing a link or a price afterwards does not fix '
        'emails already delivered — send a fresh one. Golf carts and e-bikes are always '
        'worded as coming "back home", never "back in the water".')]

    # ------------------------------------------------------------------
    section(g, '10. Money rules')
    s += [B('<b>Deposits:</b> $500 for a unit on a trailer (and a pontoon on stands); $1,000 '
            'for other boats off a trailer.')]
    s += [B('<b>Card fee:</b> 3%. Cash, check, debit, Zelle and ACH have none.')]
    s += [B('<b>Balance = total − paid</b>, never rounded to zero. Negative is a <b>credit</b> '
            'owed to the customer and shows as CREDIT everywhere.')]
    s += [B('<b>Refunds</b> are negative payments. Payments are never deleted.')]
    s += [B('<b>The payment lock:</b> once any payment exists, the customer can no longer '
            'change the quote and it reads <b>Invoice</b>. Staff can still adjust, edit lines, '
            're-measure and re-price.')]
    s += [B('<b>Staff changes survive customer saves.</b> Discounts, line edits, priced '
            'requests, penalties, fees and measurements are replayed on top every time the '
            'quote is re-priced.')]
    s += [B('<b>Late retrieval surcharge</b> — added automatically when a requested date is '
            'after the pay-by date; removed if the date moves back.')]
    s += [B('<b>Late fees</b> are never automatic. Warn, then charge, from the console.')]
    s += [note('Never edit money in the spreadsheet by hand',
        'The sheet cells, the stored quote data and the PDF are kept in step by the system. '
        'Typing a new total into a cell puts them out of step. Use the console.')]

    # ------------------------------------------------------------------
    section(g, '11. The spreadsheet and Drive')
    s += [table(['Tab', 'Holds'], [
        ['Inside, Premium Inside, Outside, No Storage, Golf Cart, E-Bike', 'One row per quote. '
         'A quote moves tab automatically when its storage changes.'],
        ['Quote Started', 'Leads — people who passed the contact step and have not finished. '
         'Never emailed except the one lead follow-up.'],
        ['Import', 'Draft quotes from the bulk import, until first emailed.'],
        ['Deleted Quotes', 'Everything deleted from the console, with who, when and why. To undo, '
         'paste columns A–W back onto the storage tab.'],
        ['Activity Log', 'Every staff action and automatic email, by name.'],
    ], [2.4 * inch, 4.2 * inch])]
    s += [P('Drive', H2)]
    s += [B('Quote PDFs are filed in the season folder for the rates they are priced at (while '
            'prices are estimates, that is the 2025-26 folder).')]
    s += [B('<b>Unit Photos/</b> — one folder per quote, Winter and Spring subfolders; <b>Voice '
            'Notes/</b> inside it. <b>Signed Contracts/</b>. These are "anyone with the link can '
            'view" so staff outside the Google account can open them.')]
    s += [P('Rules', H2)]
    s += [B('Don\'t hand-edit money, rename tabs, reorder columns, or delete rows. Use the console.')]
    s += [B('The mobile Google Sheets app cannot show the Quest Quotes menu — that is why the '
            'console exists.')]
    s += [B('Test only on quote <b>QW-26-1255</b>. Every other row is a real customer.')]

    # ------------------------------------------------------------------
    section(g, '12. The spreadsheet menu (desktop only)')
    s += [P('The <b>Quest Quotes</b> menu in the spreadsheet does many of the console\'s jobs '
            'for the selected row. It runs as the spreadsheet owner, so it is available to '
            'whoever can edit the sheet — no PIN. It only appears in a desktop browser.')]
    s += [table(['Menu item', 'Console equivalent'], [
        ['Adjust selected quote (no email) / Adjust &amp; email customer', 'Adjustment card'],
        ['Email updated quote to customer', 'Re-send invoice'],
        ['Show customer link for selected quote', 'Customer link'],
        ['Edit / remove line items', 'Line items → Edit / ✕'],
        ['Price a quote request', 'Quote requests → Price this'],
        ['Record payment / deposit', 'Record payment card'],
        ['Add late fee / Send late-fee warning email', 'Late fee card / Late fee warning'],
        ['Create / open photo folder', 'Photos → Open folder'],
        ['Send "We have your unit", end-of-season, spring, up next, back in the water',
         'Customer emails card'],
        ['Send end-of-season note to ALL / spring alert to ALL', 'Send to all'],
    ], [3.6 * inch, 3.0 * inch])]

    # ------------------------------------------------------------------
    section(g, '13. Owner jobs (Chris — Apps Script and GitHub)')
    s += [P('Running a function from the Apps Script editor', H2)]
    s += steps([
        'Open the spreadsheet → <b>Extensions → Apps Script</b>.',
        'Pick the function from the dropdown at the top → <b>Run</b>.',
        'If Google asks for permissions: <b>Review permissions</b> → questwsottawa@gmail.com → '
        '<b>Advanced → Go to (project)</b> → <b>Allow</b>.',
        'Read the <b>Execution log</b> at the bottom for the result.',
    ])
    s += [table(['Function', 'When', 'Success looks like'], [
        ['initStaff()', 'Once, ever', 'Six PINs printed. Refuses to run a second time.'],
        ['setupAllTriggers()', 'Once, or to repair', 'Reminder 9am, backup 6pm, balance report '
         '7am, lead follow-up 12:15pm, transcript sweep 5am (Central). Safe to re-run.'],
        ['testLogo()', 'Once', 'Grants Drive/Gmail access for the logo in emails.'],
        ['checkRestoreAccess()', 'Before first restore', '"Both permissions are granted…"'],
        ['bulkImport1_Scan() / 2_Apply()', 'Fallback for the console buttons', 'Emails a report / imports approved rows'],
        ['bulkImportStatus / Continue / Stop / Repair', 'If a bulk import misbehaves', 'Shown in the log'],
        ['emailGuides()', 'After the guides change', 'Guides emailed to Chris'],
    ], [1.9 * inch, 1.5 * inch, 3.2 * inch])]

    s += [P('Turning on voice-note transcription', H2)]
    s += steps([
        'Apps Script → <b>Project Settings</b> (gear) → <b>Script properties</b>.',
        '<b>Add script property</b>: name <b>ASSEMBLYAI_API_KEY</b>, value: the service '
        'tracker\'s AssemblyAI key. Save. Nothing else is needed.',
    ])

    s += [P('Deploying a backend change', H2)]
    s += [B('Preferred: GitHub → Actions → <b>Deploy Apps Script</b> → Run workflow (Claude can '
            'run this for you). It checks the code first and updates the <b>existing</b> '
            'deployment.')]
    s += [B('By hand: paste the file → Save → <b>Deploy → Manage deployments → pencil → '
            'Version: New version → Deploy</b>.')]
    s += [B('<b>Never "New deployment"</b> — it creates a new web address and silently cuts off '
            'the quote page, console and yard app.')]
    s += [B('To undo: Manage deployments → pencil → pick the previous version.')]
    s += [B('The quote page, console and yard app update when changes are merged to <b>main</b> '
            'on GitHub. Hard-refresh (Ctrl+Shift+R) to see them.')]

    s += [P('The season rollover (when the 2026–2027 rate card arrives)', H2)]
    s += steps([
        '<b>Pause automatic emails</b> (console, admin).',
        'Update <b>SEASON</b> dates and <b>PRICES</b> in the Annual Update Zone of '
        'pricing-engine.js, and set <b>provisional: false</b> in the same change.',
        'Re-baseline the price fixtures, sync the engine, run the checks, deploy.',
        'Console → <b>Re-price at current rates</b>; review; apply.',
        'Import any old sheets now (not before), so they price once at the new rates.',
        'Email customers their real quote (Send to all or individually).',
        '<b>Resume automatic emails.</b> The clocks restart, so no reminder crowds your email.',
    ])

    # ------------------------------------------------------------------
    section(g, '14. Troubleshooting')
    s += [table(['You see', 'What it means / what to do'], [
        ['"Session expired — log in again."', 'Your 12 hours are up or your account changed. Sign in again.'],
        ['"Your account doesn\'t have permission for that"', 'The server refused it. Ask Chris or '
         'Jeff to add the permission; then sign out and back in.'],
        ['"Too many wrong PINs…"', 'The 15-minute lock-out. Wait.'],
        ['The console says a write went unanswered / still running', 'Do <b>not</b> repeat it. '
         'Reload the quote and check whether it happened (payments especially).'],
        ['"Enter both your quote number and last name." inside the console', 'A lost request; '
         'the console now detects this. Reload; if it persists, tell Chris.'],
        ['A card or button is missing', 'Your permissions don\'t include it, or it doesn\'t apply '
         '(e.g. no email address → no email card; no balance → no late fee card).'],
        ['An old version of a page', 'Hard-refresh (Ctrl+Shift+R, or close and reopen the app).'],
        ['Customer says "Quote not found"', 'Check the quote number and the last name as stored; '
         'send them the Customer link from the console.'],
        ['⚠️ PRICE DRIFT email', 'The customer\'s page and the server disagreed; the server\'s figure '
         'was kept. Check the quote.'],
        ['"could NOT re-apply — REVIEW" email', 'A staff change\'s target line was removed by the '
         'customer. Re-apply the discount/edit by hand.'],
        ['A unit won\'t mark as Pulled', 'It is not signed and paid. Fix that first.'],
        ['Voice note says it was not typed up', 'The AssemblyAI key isn\'t installed; the recording is still saved.'],
        ['The storage view is slow the first time', 'It is cached for two minutes after the first load.'],
    ], [2.4 * inch, 4.2 * inch])]

    # ------------------------------------------------------------------
    section(g, '15. Quick reference — I want to…')
    s += [table(['I want to…', 'Where', 'Needs'], [
        ['Find a customer', 'Console search box', perm('view')],
        ['Text a customer their quote', 'Quote card → Customer link → Copy', perm('view')],
        ['Take a deposit', 'Record payment / deposit', perm('pay')],
        ['Give a refund', 'Record payment, negative amount', perm('pay')],
        ['File a signed contract', 'Signed contract → Upload', perm('pay')],
        ['Chase a signature', 'Ask them to sign', perm('email')],
        ['Give a discount', 'Adjustment, negative amount', perm('adjust')],
        ['Charge a late fee', 'Late fee warning, then Late fee', perms('email', 'adjust')],
        ['Price something they asked about', 'Quote requests → Price this', perm('adjust')],
        ['Record when they want it out', 'Season timing', perm('adjust')],
        ['Fix the boat\'s size', 'Unit details &amp; storage / yard app Measurements', perm('measure')],
        ['Move them to inside storage', 'Unit details &amp; storage', perm('measure')],
        ['Record keys / slip', 'Keys &amp; slip', perm('keys')],
        ['Warn the crew about a unit', 'Yard alert', perm('keys')],
        ['Mark a unit dropped off', 'Yard status', perm('keys')],
        ['Mark a unit pulled / stored', 'Yard app, or Yard status', perm('keys')],
        ['Note something about a unit', 'Yard log (or voice note in the yard app)', perm('keys')],
        ['Photograph a unit', 'Photos card / yard app', perm('photos')],
        ['Print the haul-out list', 'Storage view → Print haul-out list', perm('view')],
        ['Email everyone in spring', 'Send to all → Spring', perm('email')],
        ['Move the season to new prices', 'Re-price at current rates', perm('adjust')],
        ['Bring in last year\'s sheets', 'Load from an old sheet', perms('adjust', 'admin')],
        ['Stop automatic emails', 'Automatic emails', perm('admin')],
        ['Add staff / reset a PIN', 'Staff &amp; permissions', perm('admin')],
        ['Delete a duplicate quote', 'Delete this quote', perm('admin')],
        ['Undo a mistake in the sheet', 'Restore from backup', perm('admin')],
    ], [2.15 * inch, 3.25 * inch, 1.2 * inch])]
    s += [gap(8), P('Quest Watersports · 1851 Old Chicago Rd, Ottawa, IL · (815) 433-2200', SMALL)]

    return g.build()


if __name__ == '__main__':
    print('wrote', manual())
