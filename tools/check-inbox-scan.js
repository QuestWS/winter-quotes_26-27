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
  decl('COL'), decl('INBOX_PRIORITIES_'), fn('fmtMoney_'), fn('inboxNormQn_'), fn('inboxNormName_'),
  fn('inboxQuotesByName_'), fn('inboxAiOf_'), fn('inboxRowFor_'), fn('inboxKeyOk_'),
  'return {inboxNormQn_, inboxRowFor_, inboxKeyOk_};'
].join('\n'))({ getScriptProperties: () => ({ getProperty: () => KEY }) });

let fails = 0;
const check = (l, c, d) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d ? '  — ' + d : '')); if (!c) fails++; };

const q1 = { qn: 'QW-26-1255', tab: 'Inside', name: 'John White', bal: 412.5, total: 912.5,
  ts: new Date('2026-10-01T12:00:00Z') };
const idx = { byQn: { 'QW-26-1255': q1 }, byEmail: { 'john@questwatersports.com': [q1] },
  byName: { 'john white': [q1] }, byLast: { 'white': [q1] } };
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

/* ---- the AI review's answer ---- */
const ai = (o) => Object.assign({ relevant: true, kind: 'payment', priority: 'Medium', summary: 'S', action: '',
  customer_names: [], quote_numbers: [], amounts: [] }, o);
r = B.inboxRowFor_(item({ quoteNos: ['QW-26-1255'], signals: ['payment'], ai: ai({ relevant: false }) }), idx);
check('AI: "nothing to log" beats the keywords — no row', r === null);
r = B.inboxRowFor_(item({ staff: true, fromEmail: 'jeff@questwatersports.com', signals: ['schedule'] }), idx);
check('staff mail without an AI review makes no row', r === null);
r = B.inboxRowFor_(item({ staff: true, fromEmail: 'jeff@questwatersports.com',
  ai: ai({ kind: 'staff_direction', priority: 'High', summary: 'Jeff says pull the Whites first',
           action: 'Move QW-26-1255 to the top of the haul-out list', customer_names: ['the Whites'] }) }), idx);
check('AI: staff direction matched to a quote by surname ("the Whites")', r && r[H.qn] === 'QW-26-1255' && r[H.pri] === 'High'
  && /Jeff says pull the Whites first → Move QW-26-1255/.test(r[H.why]) && /From staff/.test(r[H.why]) && /Matched by name/.test(r[H.why]) && r[15] === 'AI');
r = B.inboxRowFor_(item({ fromEmail: 'stranger@example.com', ai: ai({ customer_names: ['Zed Nobody'], summary: 'New inquiry' }) }), idx);
check('AI: a relevant stranger still gets a row, and an unknown name is said', r && /No quote found for Zed Nobody/.test(r[H.why]));
r = B.inboxRowFor_(item({ fromEmail: 'john@questwatersports.com', amounts: [999], ai: ai({ priority: 'Low', amounts: [412.5] }) }), idx);
check('AI: its amounts replace the keyword ones, and the balance match still makes it High',
  r && r[H.amts] === '$412.50' && r[H.pri] === 'High');
r = B.inboxRowFor_(item({ quoteNos: ['QW261255'] }), idx);
check('keyword rows say so in the hidden column', r && r[15] === 'Keywords');

/* ---- ingest: re-review in place, never over a person's mark ---- */
function fakeSheet(rows) {
  const S = { rows: rows.map(r => r.slice()), deleted: [] };
  const range = (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((S.rows[r - 1 + i] || [])[c - 1 + j]) ?? '')),
    setValues: (v) => v.forEach((row, i) => row.forEach((x, j) => { (S.rows[r - 1 + i] = S.rows[r - 1 + i] || [])[c - 1 + j] = x; })),
    setDataValidation: () => {}, setNumberFormat: () => {}, setFontWeight: () => {},
  });
  S.sheet = { getLastRow: () => S.rows.length, getRange: range, hideColumns: () => {}, setFrozenRows: () => {}, setColumnWidth: () => {},
    insertRowsBefore: (at, n) => S.rows.splice(at - 1, 0, ...Array.from({ length: n }, () => [])),
    deleteRow: (r) => { S.deleted.push(S.rows[r - 1][14]); S.rows.splice(r - 1, 1); } };
  return S;
}
const HEAD = (gas.match(/^const INBOX_HEADERS_ = (\[[\s\S]*?\]);/m) || [])[1];
const oldRow = (mid, status, rev) => ['' + status, 'Low', '', 'n', 'e', 's', '', '', '', '', '', 'keyword reason', '', 'm', mid, rev];
const S = fakeSheet([eval(HEAD), oldRow('<keep-marked>', 'Logged', 'Keywords'), oldRow('<redo>', 'New', 'Keywords'),
  oldRow('<drop>', 'New', 'Keywords'), oldRow('<ai-done>', 'New', 'AI')]);
const I = new Function('SpreadsheetApp', 'LockService', 'inboxQuoteIndex_', [
  decl('COL'), decl('INBOX_TAB'), decl('INBOX_HEADERS_'), decl('INBOX_MID_COL_'), decl('INBOX_REV_COL_'),
  decl('INBOX_STATUSES_'), decl('INBOX_PRIORITIES_'), fn('fmtMoney_'), fn('inboxNormQn_'), fn('inboxNormName_'),
  fn('inboxQuotesByName_'), fn('inboxAiOf_'), fn('inboxRowFor_'), fn('inboxSheet_'), fn('inboxRowsByMid_'),
  fn('inboxIngest_'), fn('inboxKnown_'), 'return {inboxIngest_, inboxKnown_};'
].join('\n'))(
  { getActiveSpreadsheet: () => ({ getSheetByName: () => S.sheet }), newDataValidation: () => ({ requireValueInList: () => ({ build: () => 1 }) }) },
  { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  () => idx);
const kn = I.inboxKnown_().settled.sort().join(',');
check('known: AI-reviewed and person-marked rows are not sent to the AI again', kn === '<ai-done>,<keep-marked>', kn);
const res = I.inboxIngest_([
  item({ messageId: '<keep-marked>', quoteNos: ['QW-26-1255'], ai: ai({ summary: 'NEW TEXT' }) }),
  item({ messageId: '<redo>', quoteNos: ['QW-26-1255'], ai: ai({ summary: 'Mailed a check' }) }),
  item({ messageId: '<drop>', ai: ai({ relevant: false }) }),
  item({ messageId: '<ai-done>', ai: ai({ summary: 'AGAIN' }) }),
  item({ messageId: '<fresh>', quoteNos: ['QW-26-1255'], ai: ai({ summary: 'Brand new' }) }),
]);
const rowOf = (m) => S.rows.find(r => r[14] === m);
check('ingest: a keyword row still New is rewritten with the AI reading', res.updated === 1 && /Mailed a check/.test(rowOf('<redo>')[11]) && rowOf('<redo>')[15] === 'AI');
check('ingest: a keyword row the AI calls irrelevant is removed', res.removed === 1 && S.deleted.join() === '<drop>' && !rowOf('<drop>'));
check('ingest: a row a person marked is never touched', rowOf('<keep-marked>')[0] === 'Logged' && rowOf('<keep-marked>')[11] === 'keyword reason');
check('ingest: an AI-reviewed row is not reviewed twice', !/AGAIN/.test(rowOf('<ai-done>')[11]));
check('ingest: a new message goes in at the top', res.added === 1 && S.rows[1][14] === '<fresh>' && /Brand new/.test(S.rows[1][11]));

KEY = '';
check('no key configured refuses everyone', !B.inboxKeyOk_(''));
KEY = 'short';
check('a short key is no key', !B.inboxKeyOk_('short'));
KEY = 'a'.repeat(40);
check('a wrong key of the right length is refused', !B.inboxKeyOk_('b'.repeat(40)));
check('the right key is accepted', B.inboxKeyOk_('a'.repeat(40)));

/* ---- the Python half: extract() on built messages ---- */
const py = String.raw`
import sys; sys.dont_write_bytecode = True
import importlib.util, json
spec = importlib.util.spec_from_file_location('s', sys.argv[1]); s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
def msg(frm, subj, body, extra=''):
    return ('From: %s\r\nSubject: %s\r\nDate: Tue, 20 Oct 2026 10:00:00 -0500\r\nMessage-ID: <a@b>\r\n%s'
            'Content-Type: text/plain\r\n\r\n%s' % (frm, subj, extra, body)).encode()
out = {
  'reply': s.extract(msg('Jo <jo@example.com>', 'Re: Your quote QW-26-1255',
      'I mailed a check for $412.50 today.\r\n\r\nOn Mon, Oct 19, 2026, Quest wrote:\r\n> Balance due $900.00\r\n'), 'x'),
  'own': s.extract(msg('Quest <questwsottawa@gmail.com>', 'Quote saved', 'QW-26-1255'), 'x'),
  'staff': s.extract(msg('Jeff <jeff@questwatersports.com>', 'Hendersons', 'Pull the Henderson pontoon before the 10th.'), 'x'),
  'robot': s.extract(msg('news@shop.example', 'Sale', 'Big sale', 'List-Unsubscribe: <x>\r\n'), 'x'),
  'card': s.extract(msg('no-reply@square.example', 'You received a payment', 'Payment of $1,250.00 received'), 'x'),
}
import os, types
out['posted'] = s.for_post(out['reply'])
import re, tempfile
# ---- the two-pass pipeline, against a stand-in model ----
calls = []
class FakeLlm:
    mode = 'api'; workers = 2; fail = None
    def ask(self, model, system, user, schema, effort):
        ids = [int(x) for x in re.findall(r'<email id="(\d+)">', user)]
        kind = 'screen' if schema is s.SCREEN_SCHEMA else 'review'
        calls.append({'kind': kind, 'model': model, 'n': len(ids), 'user': user, 'effort': effort})
        if FakeLlm.fail == kind: raise s.LlmError('RateLimitError')
        blocks = re.split(r'<email id="\d+">', user)[1:]
        if kind == 'screen':
            return {'results': [{'id': i, 'keep': 'Menards' not in blocks[n]} for n, i in enumerate(ids)]}
        return {'results': [{'id': i, 'relevant': True, 'kind': 'other', 'priority': 'Medium', 'summary': 'r%d' % i,
                             'action': '', 'customer_names': [], 'quote_numbers': [], 'amounts': []} for i in ids]}
def mk(frm, subj, body):
    return s.extract(msg(frm, subj, body), 'x')
os.environ['INBOX_SCREEN_MODEL'] = ''; os.environ['INBOX_REVIEW_MODEL'] = ''
flyer = mk('Menards <deals@menards.example>', 'Weekly ad', 'Menards 11% rebate on everything this week')
staff = mk('Jeff <jeff@questwatersports.com>', 'Hendersons', 'Pull the Henderson pontoon before the 10th.')
reply = mk('Jo <jo@example.com>', 'Re: QW-26-1255', 'I mailed a check for $412.50 today.')
settled = mk('Al <al@example.com>', 'Old', 'Already handled')
settled['messageId'] = '<settled@x>'
c = s.ai_review([flyer, staff, reply, settled], {'<settled@x>'}, FakeLlm())
scr = [k for k in calls if k['kind'] == 'screen']; rev = [k for k in calls if k['kind'] == 'review']
out['pipe'] = {'counts': c, 'flyer': flyer.get('ai'), 'staff': staff.get('ai'), 'reply': reply.get('ai'),
  'screenModel': scr[0]['model'], 'reviewModel': rev[0]['model'], 'screenN': sum(k['n'] for k in scr),
  'reviewN': sum(k['n'] for k in rev), 'qnScreened': any('QW-26-1255' in k['user'] for k in scr),
  'screenSeesFull': any('Henderson pontoon' in k['user'] for k in scr), 'reviewTagged': '(Quest staff)' in rev[0]['user'],
  'settledSent': any('Already handled' in k['user'] for k in calls)}
# A failed screen keeps everything; a failed review falls back to keywords.
calls.clear(); FakeLlm.fail = 'screen'
import io, contextlib
logged = io.StringIO()
f2 = mk('Menards <deals@menards.example>', 'Weekly ad', 'Menards sale')
with contextlib.redirect_stdout(logged): c2 = s.ai_review([f2], set(), FakeLlm())
calls.clear(); FakeLlm.fail = 'review'
r3 = mk('Jo <jo@example.com>', 'Re: QW-26-1255', 'Check mailed')
with contextlib.redirect_stdout(logged): c3 = s.ai_review([r3], set(), FakeLlm())
out['pipe']['failLog'] = logged.getvalue().strip()
out['pipe'].update({'screenFailKept': f2.get('ai', {}).get('summary'), 'reviewFail': c3, 'reviewFailAi': 'ai' in r3})
# 40 emails -> screened in batches of 25, reviewed in batches of 6.
calls.clear(); FakeLlm.fail = None
many = [mk('P%d <p%d@example.com>' % (i, i), 'Winterize?', 'Can you winterize my boat %d' % i) for i in range(40)]
s.ai_review(many, set(), FakeLlm())
out['pipe']['batches'] = sorted(k['n'] for k in calls)
calls.clear()
longmail = mk('Kim <kim@example.com>', 'Boat', 'Please winterize my boat. ' + 'x' * 700 + ' TAILMARK')
s.ai_review([longmail], set(), FakeLlm())
out['pipe']['tailInScreen'] = any('TAILMARK' in k['user'] for k in calls if k['kind'] == 'screen')
out['pipe']['tailInReview'] = any('TAILMARK' in k['user'] for k in calls if k['kind'] == 'review')
out['pipe']['allReviewed'] = all('ai' in m for m in many)

# ---- the API path: request shape, with a stand-in anthropic package ----
class APIError(Exception): pass
fake = types.ModuleType('anthropic'); fake.APIError = APIError
seen = []
class Msgs:
    mode = 'ok'
    def create(self, **kw):
        seen.append(kw)
        if Msgs.mode == 'err': raise APIError('boom')
        return types.SimpleNamespace(stop_reason='refusal' if Msgs.mode == 'refusal' else 'end_turn',
                                     content=[types.SimpleNamespace(type='text', text='{"results": []}')])
fake.Anthropic = lambda **kw: types.SimpleNamespace(beta=types.SimpleNamespace(messages=Msgs()))
sys.modules['anthropic'] = fake
os.environ.pop('CLAUDE_CODE_OAUTH_TOKEN', None); os.environ['ANTHROPIC_API_KEY'] = 'k'
L = s.Llm()
L.ask('claude-opus-5-5', 'sys', 'u', s.REVIEW_SCHEMA, 'low'); L.ask('claude-haiku-5-5', 'sys', 'u', s.SCREEN_SCHEMA, 'low')
errs = []
for m in ('err', 'refusal'):
    Msgs.mode = m
    try: L.ask('claude-opus-5-5', 'sys', 'u', s.REVIEW_SCHEMA, 'low')
    except s.LlmError as e: errs.append(str(e))
out['api'] = {'mode': L.mode, 'opusFallbacks': seen[0].get('fallbacks'), 'haikuFallbacks': seen[1].get('fallbacks', None),
              'schema': seen[0]['output_config']['format']['type'], 'errs': errs}

# ---- the subscription path: a stand-in claude command on PATH ----
bindir = tempfile.mkdtemp()
log = os.path.join(bindir, 'argv.json')
with open(os.path.join(bindir, 'claude'), 'w') as f:
    f.write('#!' + sys.executable + '\nimport json, os, sys\n'
            'json.dump({"argv": sys.argv[1:], "cwd": os.getcwd(), "stdin": sys.stdin.read()}, open(%r, "w"))\n'
            'print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "structured_output": {"results": [{"id": 0, "keep": False}]}}))\n' % log)
os.chmod(os.path.join(bindir, 'claude'), 0o755)
os.environ['PATH'] = bindir + os.pathsep + os.environ['PATH']; os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = 't'
L2 = s.Llm()
ans = L2.ask('claude-haiku-5-5', 'SYS', 'EMAILS', s.SCREEN_SCHEMA, 'low')
rec = json.load(open(log))
av = rec['argv']
out['cli'] = {'mode': L2.mode, 'ans': ans, 'model': av[av.index('--model') + 1], 'tools': av[av.index('--tools') + 1],
              'print': '-p' in av, 'schema': '--json-schema' in av, 'stdin': rec['stdin'],
              'cwdIsRepo': os.path.realpath(rec['cwd']).startswith(os.path.realpath(os.path.dirname(os.path.dirname(sys.argv[1])))),
              'bare': '--bare' in av, 'mcp': '--strict-mcp-config' in av}
os.environ.pop('CLAUDE_CODE_OAUTH_TOKEN'); os.environ.pop('ANTHROPIC_API_KEY')
del out['reply']['_quoted']
for k in ('IMAP_HOST', 'IMAP_PORT', 'IMAP_FOLDERS'): os.environ[k] = ''
out['envDefaults'] = [s.env('IMAP_HOST', 'questwatersports.com'), s.env('IMAP_PORT', '993'), s.env('IMAP_FOLDERS', 'INBOX')]
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
  check('scanner: an unset Actions variable (empty string) falls back to the default',
    (pyOut.envDefaults || []).join('|') === 'questwatersports.com|993|INBOX', (pyOut.envDefaults || []).join('|'));
  check('scanner: the system\'s own mail is skipped', pyOut.own === null);
  check('scanner: staff mail is kept and marked as staff', pyOut.staff && pyOut.staff.staff === true);
  check('scanner: the full text kept for the AI never reaches the post',
    pyOut.posted && !Object.keys(pyOut.posted).some(k => k[0] === '_') && pyOut.reply && pyOut.reply._fresh.indexOf('I mailed a check') === 0);
  const P = pyOut.pipe || {};
  check('AI: Haiku screens, Opus reviews', P.screenModel === 'claude-haiku-5-5' && P.reviewModel === 'claude-opus-5-5', P.screenModel + ' / ' + P.reviewModel);
  check('AI: a Menards flyer is screened out and becomes "nothing to log"', P.flyer && P.flyer.relevant === false && P.counts.screened_out === 1);
  check('AI: staff mail passes the screen and is reviewed', P.staff && P.staff.relevant === true && P.reviewTagged);
  check('AI: mail naming a quote skips the screen and goes straight to review', P.reply && P.reply.relevant === true && !P.qnScreened);
  check('AI: the screen sees only the opening of each email; the review sees all of it', P.tailInScreen === false && P.tailInReview === true && P.screenN === 2);
  check('AI: settled messages are not sent at all', !P.settledSent && P.counts.reused === 1);
  check('AI: a failed screen keeps the batch for review', P.screenFailKept === 'r0');
  check('AI: a failed review falls back to keywords', P.reviewFail && P.reviewFail.fallback === 1 && !P.reviewFailAi);
  check('AI: failures are logged as reasons and counts only', /^AI failures: screen RateLimitError x1\s+AI failures: review RateLimitError x1$/.test(P.failLog), P.failLog);
  check('AI: batches of 25 to screen, 6 to review', JSON.stringify(P.batches) === JSON.stringify([4, 6, 6, 6, 6, 6, 6, 15, 25]) && P.allReviewed, JSON.stringify(P.batches));
  const A = pyOut.api || {};
  check('API key: Opus gets default fallbacks and the schema; Haiku gets no fallbacks', A.mode === 'api' && A.opusFallbacks === 'default'
    && A.haikuFallbacks === null && A.schema === 'json_schema');
  check('API key: an API error or a refusal is a short reason, not content', JSON.stringify(A.errs) === '["APIError","refusal"]');
  const C = pyOut.cli || {};
  check('subscription: chosen when the token is set, answer read from structured_output', C.mode === 'cli' && C.ans && C.ans.results[0].keep === false);
  check('subscription: print mode, the model asked for, no tools, schema enforced', C.print && C.model === 'claude-haiku-5-5' && C.tools === '' && C.schema && C.mcp);
  check('subscription: never --bare (that would refuse the subscription sign-in)', C.bare === false);
  check('subscription: runs outside the repo, so its CLAUDE.md is not loaded', C.cwdIsRepo === false);
  check('subscription: the emails go in on stdin, not the command line', C.stdin === 'EMAILS');
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
