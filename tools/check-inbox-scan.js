#!/usr/bin/env node
/* The Inbox Review tab — executed, not grepped.
   ---------------------------------------------------------------------------
   The nightly scan of chris@ posts what it found; inboxRowFor_ decides what a
   message means against the quotes. What matters is all in that function:

   1. MATCHING. A named quote number wins; otherwise the sender's address
      finds the quote. "QW261255" is "QW-26-1255". A number nobody has is
      reported as not found rather than dropped.
   2. MONEY. An amount equal to the balance is High; a payment word is High.
   3. NOISE. A stranger saying nothing about money, service or plans makes no
      row at all.
   4. THE DOOR. No key answers nobody; a short key is no key; a wrong key of
      the right length is refused.

   Then tools/inbox-scan.py's extract() is run on built messages, so the two
   halves are checked against each other. Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
function fn(n) {
  const m = gas.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n); return m[0];
}
const decl = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error('missing ' + n); return m[0];
};

let KEY = '';
const B = new Function('PropertiesService', [
  decl('COL'), fn('fmtMoney_'), fn('inboxNormQn_'), fn('inboxRowFor_'), fn('inboxKeyOk_'),
  'return {inboxNormQn_, inboxRowFor_, inboxKeyOk_};'
].join('\n'))({ getScriptProperties: () => ({ getProperty: () => KEY }) });

let fails = 0;
const check = (l, c, d) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d ? '  — ' + d : '')); if (!c) fails++; };

const q1 = { qn: 'QW-26-1255', tab: 'Inside', name: 'John White', bal: 412.5, total: 912.5,
  ts: new Date('2026-10-01T12:00:00Z') };
const idx = { byQn: { 'QW-26-1255': q1 }, byEmail: { 'john@questwatersports.com': [q1] } };
const item = (o) => Object.assign({ messageId: '<m1@x>', date: '2026-10-20T15:00:00Z',
  fromName: 'Sender', fromEmail: 'someone@example.com', subject: 'Hi', quoteNos: [],
  amounts: [], signals: [], snippet: '', mailbox: 'chris@/INBOX' }, o);
const H = { pri: 1, qn: 6, cust: 7, bal: 9, amts: 10, why: 11 };

console.log('Inbox Review — matching, money, noise, the door');

check('quote numbers normalise', B.inboxNormQn_('qw261255') === 'QW-26-1255' && B.inboxNormQn_('QW-26-1255') === 'QW-26-1255'
  && B.inboxNormQn_('QW-1255') === '');

let r = B.inboxRowFor_(item({ quoteNos: ['QW261255'] }), idx);
check('a named quote number matches', r && r[H.qn] === 'QW-26-1255' && r[H.cust] === 'John White' && r[H.bal] === 412.5);

r = B.inboxRowFor_(item({ fromEmail: 'JOHN@questwatersports.com', signals: ['schedule'] }), idx);
check('the sender address matches, case-blind', r && r[H.qn] === 'QW-26-1255' && /Sender is on a quote/.test(r[H.why]));

r = B.inboxRowFor_(item({ fromEmail: 'john@questwatersports.com', amounts: [412.5] }), idx);
check('an amount equal to the balance is High', r && r[H.pri] === 'High' && /equals the balance/.test(r[H.why]) && r[H.amts] === '$412.50');

r = B.inboxRowFor_(item({ fromEmail: 'john@questwatersports.com', signals: ['payment'] }), idx);
check('a payment word is High', r && r[H.pri] === 'High');

r = B.inboxRowFor_(item({ quoteNos: ['QW-26-9999'] }), idx);
check('an unknown quote number is reported, not dropped', r && /QW-26-9999 not found/.test(r[H.why]) && r[H.qn] === 'QW-26-9999');

r = B.inboxRowFor_(item({ fromEmail: 'john@questwatersports.com', date: '2026-10-20T00:00:00Z' }), idx);
check('a matched email after the last save is flagged', r && /after the quote was last saved/.test(r[H.why]) && r[H.pri] === 'Medium');

r = B.inboxRowFor_(item({}), idx);
check('a stranger saying nothing relevant makes no row', r === null);

r = B.inboxRowFor_(item({ signals: ['service'] }), idx);
check('a stranger asking about service is a possible new customer', r && /Possible new customer/.test(r[H.why]));

KEY = '';
check('no key configured refuses everyone', !B.inboxKeyOk_(''));
KEY = 'short';
check('a short key is no key', !B.inboxKeyOk_('short'));
KEY = 'a'.repeat(40);
check('a wrong key of the right length is refused', !B.inboxKeyOk_('b'.repeat(40)));
check('the right key is accepted', B.inboxKeyOk_('a'.repeat(40)));

/* ---- the Python half: extract() on built messages ---- */
const py = `
import sys; sys.dont_write_bytecode = True
import importlib.util, json
spec = importlib.util.spec_from_file_location('s', sys.argv[1]); s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
def msg(frm, subj, body, extra=''):
    return ('From: %s\\r\\nSubject: %s\\r\\nDate: Tue, 20 Oct 2026 10:00:00 -0500\\r\\nMessage-ID: <a@b>\\r\\n%s'
            'Content-Type: text/plain\\r\\n\\r\\n%s' % (frm, subj, extra, body)).encode()
out = {
  'reply': s.extract(msg('Jo <jo@example.com>', 'Re: Your quote QW-26-1255',
      'I mailed a check for $412.50 today.\\r\\n\\r\\nOn Mon, Oct 19, 2026, Quest wrote:\\r\\n> Balance due $900.00\\r\\n'), 'x'),
  'own': s.extract(msg('Quest <service@questwatersports.com>', 'Quote saved', 'QW-26-1255'), 'x'),
  'robot': s.extract(msg('news@shop.example', 'Sale', 'Big sale', 'List-Unsubscribe: <x>\\r\\n'), 'x'),
  'card': s.extract(msg('no-reply@square.example', 'You received a payment', 'Payment of $1,250.00 received'), 'x'),
}
print(json.dumps(out))
`;
let pyOut = null;
try {
  pyOut = JSON.parse(execFileSync('python3', ['-I', '-c', py, path.join(ROOT, 'tools/inbox-scan.py')], { encoding: 'utf8' }));
} catch (e) { check('tools/inbox-scan.py runs', false, String(e.message || e).split('\n')[0]); }
if (pyOut) {
  const a = pyOut.reply;
  check('scanner: quote number found, even in the quoted part', a && a.quoteNos.join() === 'QW-26-1255');
  check('scanner: amounts come from the reply, not the quoted original', a && a.amounts.join() === '412.5', a && a.amounts.join());
  check('scanner: a check is a payment', a && a.signals.indexOf('payment') >= 0);
  check('scanner: our own mail is skipped', pyOut.own === null);
  check('scanner: newsletters are skipped', pyOut.robot === null);
  check('scanner: a card processor\'s payment notice is kept', pyOut.card && pyOut.card.amounts.join() === '1250');
  /* And the two halves agree: the scanner's item makes the right row. */
  r = pyOut.reply && B.inboxRowFor_(Object.assign({}, pyOut.reply, { mailbox: 'x' }), idx);
  check('scanner → backend: the reply becomes a High row on QW-26-1255', r && r[H.pri] === 'High' && r[H.qn] === 'QW-26-1255');
}

/* ---- the console's Scan now button ---- */
const getFns = gas.match(/^const CONSOLE_GET_FNS_ = \{[\s\S]*?\n\};/m)[0];
const adm = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');
const apiGetOk = adm.match(/const API_GET_OK=\{[\s\S]*?\};/)[0];
check('console: the state read is GET-able on both sides', /\binboxScanState: 1\b/.test(getFns) && /\binboxScanState:1\b/.test(apiGetOk));
check('console: starting a scan is a write, never GET-able', !/inboxScanRun/.test(getFns) && !/inboxScanRun/.test(apiGetOk));
check('console: only Chris sees the panel', /navGate\('inbox',\s*ME\.name==='Chris'\)/.test(adm));
check('server: both console calls check the owner', /function adminInboxScanState\(token\) \{\s*inboxOwner_\(token\)/.test(gas)
  && /function adminInboxScanRun\(token, days\) \{\s*const who = inboxOwner_\(token\)/.test(gas));
check('console: both calls are routed', /inboxScanState:\s*function/.test(gas) && /inboxScanRun:\s*function/.test(gas));

const props = {}; let fetched = []; let ghCode = 204; let audits = [];
const R = new Function('PropertiesService', 'UrlFetchApp', 'requireAuth_', 'auditLog_', [
  decl('INBOX_GH_REPO_'), decl('INBOX_GH_WORKFLOW_'), decl('INBOX_LAST_RUN_KEY_'), decl('INBOX_OWNER_'),
  fn('inboxOwner_'), fn('inboxGh_'), fn('adminInboxScanRun'), 'return {adminInboxScanRun};'
].join('\n'))(
  { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  { fetch: (url, o) => { fetched.push({ url, o }); return { getResponseCode: () => ghCode, getContentText: () => '' }; } },
  () => ({ name: WHO }), (who, what) => audits.push(what));
let WHO = 'Jeff';
let refused = '';
try { R.adminInboxScanRun('t', 3); } catch (e) { refused = String(e.message); }
check('anyone but Chris is refused, admins included', /Only Chris/.test(refused) && fetched.length === 0);
WHO = 'Chris';

let out = R.adminInboxScanRun('t', 90);
check('Scan now with no token says so and calls nothing', out.ok === 0 && /not set up yet/.test(out.error) && fetched.length === 0);
props.GITHUB_ACTIONS_TOKEN = 'ghp_test';
out = R.adminInboxScanRun('t', 90);
const sent = fetched[0] && JSON.parse(fetched[0].o.payload);
check('Scan now dispatches scan-inbox.yml on main with the days asked',
  out.ok === 1 && /actions\/workflows\/scan-inbox\.yml\/dispatches$/.test(fetched[0].url) && sent.ref === 'main' && sent.inputs.days === '90');
check('Scan now is written to the Activity Log', /INBOX SCAN/.test(audits[0] || ''));
out = R.adminInboxScanRun('t', 3);
check('a second press inside a minute is refused, not queued', out.ok === 0 && fetched.length === 1);
props.INBOX_SCAN_LAST_DISPATCH = '0'; ghCode = 403;
out = R.adminInboxScanRun('t', 3);
check('a GitHub refusal is reported, not hidden', out.ok === 0 && /403/.test(out.error));
check('days are clamped', (props.INBOX_SCAN_LAST_DISPATCH = '0', ghCode = 204, R.adminInboxScanRun('t', 5000), JSON.parse(fetched[fetched.length - 1].o.payload).inputs.days === '400'));

if (fails) { console.log('\n' + fails + ' check(s) failed'); process.exit(1); }
console.log('\nAll inbox checks passed.');
