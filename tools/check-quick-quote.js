#!/usr/bin/env node
/* Quick quote — the console's one-screen price check (Nov 2026).
   ---------------------------------------------------------------------------
   What has to stay true, and why each one is here:

   1. The card prices with the SHARED engine, loaded from the repo root —
      never a copy and never its own arithmetic. A second price list in the
      console is a second place for the rate card to go stale.
   2. Its starting state carries every key the customer page's state does.
      The server prices that object; a key missing here is a box the engine
      reads as undefined, and the two would quietly disagree.
   3. Save never emails anybody, and it holds the 9am reminder — a quote the
      customer has not been sent must not be chased "your quote is waiting".
      It goes through importApplyCore_, which is where the hold lives.
   4. Its Activity Log line never starts "IMPORTED " — bulkImportRepair
      reconciles every such line against the sheet.
   5. Run for real: adminQuickQuote refuses a quote with no last name, and
      hands the names through whole (no guessing at "Mary Ann Van Dyke").

   Run by tools/verify.sh. No customer data. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(ROOT + '/quote-logger-apps-script.gs', 'utf8');
const admin = fs.readFileSync(ROOT + '/admin/index.html', 'utf8');
const page = fs.readFileSync(ROOT + '/index.html', 'utf8');

let fails = 0;
const check = (label, cond, detail) => {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : ''));
  if (!cond) fails++;
};
function fn(src, n) {
  const m = src.match(new RegExp('^(?:async )?function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  return m ? m[0] : '';
}

// 1. shared engine
check('console loads the shared engine from the repo root', /<script src="\.\.\/pricing-engine\.js"><\/script>/.test(admin));
const ticket = fn(admin, 'qqTicket_');
check('the ticket is priced by QuestPricing.computeQuote', /QP\.computeQuote\(/.test(ticket));
check('no rate is written into the card', !/\b\d+\.\d\d\b/.test(fn(admin, 'renderQuick') + ticket));

// 2. state parity with the customer page
const keysOf = (src) => {
  const out = new Set();
  src.replace(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g, (_, k) => { out.add(k); return _; });
  return out;
};
const sMatch = page.match(/^const S = \{([\s\S]*?)\n\};/m);
const blank = fn(admin, 'qqBlank_');
check('found the quote page state and the console blank state', !!(sMatch && blank));
if (sMatch && blank) {
  const want = keysOf(sMatch[1].replace(/\/\*[\s\S]*?\*\//g, ''));
  const have = keysOf(blank);
  const missing = [...want].filter(k => !have.has(k));
  check('every key of the quote page state is in qqBlank_', !missing.length, missing.join(', '));
}

// 3 & 4. the server write
const quick = fn(gas, 'adminQuickQuote');
const core = fn(gas, 'importApplyCore_');
check('adminQuickQuote exists and is dispatched', !!quick && /quickQuote:\s*function \(a\) \{ return adminQuickQuote\(/.test(gas));
check('quickQuote is a write (not on the GET allow-list)', !/^\s*quickQuote:\s*1/m.test(gas.match(/^const CONSOLE_GET_FNS_ = \{[\s\S]*?\n\};/m)[0]));
check('it writes through importApplyCore_', /importApplyCore_\(/.test(quick));
check('neither sends mail', !/GmailApp|MailApp|sendNotification_|sendCustomerEmail_|recordEmail_/.test(quick + core));
check('the reminder hold is still written by importApplyCore_', /COL\.REM\)\.setValue\(IMPORT_HOLD_MARK/.test(core));
check('the quick quote audit line is not an IMPORTED line', /auditLog_\(who\.name, 'QUICK QUOTE '/.test(core));

// 5. run it
let captured = null;
const run = new Function('requireAuth_', 'importApplyCore_', quick + '\nreturn adminQuickQuote;')(
  () => ({ name: 'Tester', admin: false, perms: {} }),
  (who, st, meta, tab) => { captured = { who, st, meta, tab }; return { ok: 1, quoteNo: 'QW-26-0000' }; });
const r0 = run('t', { unit: 'boat', lastName: '' }, { lastName: '  ' });
check('refuses a quote with no last name', r0.ok === 0 && !captured);
const r1 = run('t', { unit: 'spaceship' }, { lastName: 'Van Dyke' });
check('refuses an unknown unit', r1.ok === 0 && !captured);
const r2 = run('t', { unit: 'boat' }, { firstName: 'Mary Ann', lastName: 'Van Dyke', note: 'n' });
check('passes the names through whole', r2.ok === 1 && captured &&
  captured.meta.firstName === 'Mary Ann' && captured.meta.lastName === 'Van Dyke' &&
  captured.meta.origin === 'console' && captured.tab === '');

console.log(fails ? '  ' + fails + ' quick-quote check(s) FAILED' : '  quick quote: all checks passed');
process.exit(fails ? 1 : 0);
