#!/usr/bin/env node
/* The Heritage Harbor slipholder discount: asked, never shown, approved by staff.
   ---------------------------------------------------------------------------
   The customer page only asks whether they are a slipholder and which slip.
   It shows no discount and no amount, so there is nothing to watch climb while
   a customer piles on services they mean to cancel later. The tier's figure
   waits in the console for a person to approve, change or remove, and the
   decision lives in the manual journal as `manual.hho`.

   What this proves, by running the real code rather than grepping it:

   1. The tier table is Chris's rate card, boundaries included.
   2. Nothing is on the quote until staff approve it; removing it takes it off.
   3. An approved tiered discount FOLLOWS the services total. Take the
      detailing off and the discount drops to the smaller total's tier —
      through a customer re-save, the line editor, and a re-total alike.
   4. A staff-fixed amount stays put whatever the total does.
   5. The base leaves out staff Adjustments: a late fee must not raise the
      tier, and another discount must not lower it.
   6. Re-totalling is idempotent (one discount line, never two), and the
      discount line is never migrated into manual.adjustments, where it would
      be applied twice.
   7. The customer page replays it the same way the server does, and neither
      the page nor the engine prices it from the customer's own answers.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');
const engA = gas.indexOf('// ENGINE-START'), engB = gas.indexOf('// ENGINE-END');
function fn(n) {
  const m = gas.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n); return m[0];
}
const decl = (n) => gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'))[0];

/* The embedded engine, not pricing-engine.js: this is the copy the server
   actually runs. */
const B = new Function([
  gas.slice(engA, engB),
  'const ADJ_CC_PCT=3, ADJ_LATE_PCT=10;',
  fn('usd_'), decl('KEYFIELDS_'),
  fn('effectiveState_'), fn('serverPrice_'), fn('linesTotal_'), fn('rebuildLinesFromState_'),
  fn('ensureManual_'), fn('applyManualOps_'), fn('reconcileManual_'), fn('recomputeTotals_'),
  fn('hhoInfo_'), fn('hhoSetDecision_'), fn('hhoLineEdit_'),
  'return {RULES,computeQuote,hhoDiscountFor,withHhoDiscount,effectiveState_,rebuildLinesFromState_,' +
  'ensureManual_,applyManualOps_,reconcileManual_,recomputeTotals_,hhoInfo_,hhoSetDecision_,hhoLineEdit_};'
].join('\n'))();

const states = JSON.parse(execSync('node tools/price-fixtures.js --dump-states', { cwd: ROOT, maxBuffer: 1e8 }));
function quoteFrom(name, patch) {
  const state = Object.assign(JSON.parse(JSON.stringify(states.find(s => s.name === name).state)), patch || {});
  const d = { quoteNo: 'QW-26-TEST', depositBase: 500, state, lines: [], total: '0', payments: [] };
  B.rebuildLinesFromState_(d); B.applyManualOps_(d);
  return d;
}
const disc = (d) => { const l = (d.lines || []).filter(x => x.hho); return l.length ? -l[0].amt : 0; };
const count = (d) => (d.lines || []).filter(x => x.hho).length;
const resave = (d) => { B.rebuildLinesFromState_(d); B.applyManualOps_(d); };

let fails = 0;
const check = (l, c, detail) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (detail ? '  — ' + detail : '')); if (!c) fails++; };

console.log('=== 1. the tier table is the rate card ===');
[[0, 0], [499.99, 0], [500, 25], [999.99, 25], [1000, 50], [1999.99, 50], [2000, 100],
 [2999.99, 100], [3000, 150], [3999.99, 150], [4000, 200], [12000, 200]].forEach(([t, want]) => {
  const got = B.hhoDiscountFor(t);
  check('$' + t + ' → $' + want, got === want, 'got $' + got);
});

console.log('\n=== 2. nothing until approved; removed takes it off ===');
{
  const d = quoteFrom('jetski-inside-detail', { hho: true, slipNo: 'B-14' });   // $1,127.40
  check('pending: no discount line', count(d) === 0);
  const before = Number(d.total);
  let r = B.hhoSetDecision_(d, 'approve', '', 'Test');
  check('approve with no amount takes the tier', r.ok && disc(d) === 50 && d.manual.hho.amt === null, r.msg);
  check('total drops by the discount', Math.abs(Number(d.total) - (before - 50)) < 0.005, before + ' -> ' + d.total);
  check('label carries the slip', /slip B-14/.test(d.lines.find(l => l.hho).label));
  r = B.hhoSetDecision_(d, 'decline', null, 'Test');
  check('remove takes it off', r.ok && count(d) === 0 && Math.abs(Number(d.total) - before) < 0.005);
  resave(d);
  check('and a customer re-save does not bring it back', count(d) === 0);
  check('approving $0 is refused (that is Remove)', B.hhoSetDecision_(d, 'approve', '0', 'Test').ok === 0);
}

console.log('\n=== 3. a tiered approval follows the services total down ===');
{
  const d = quoteFrom('jetski-inside-detail', { hho: true, slipNo: 'B-14' });
  B.hhoSetDecision_(d, 'approve', '50', 'Test');           // typing the tier's figure = the tier
  check('typing the tier figure keeps it tiered', d.manual.hho.amt === null);
  check('$1,127.40 of services → $50', disc(d) === 50);
  /* The exact complaint this exists to prevent: detailing comes off after the
     discount was set. Via the journal, as the console line editor records it. */
  const det = d.lines.find(l => l.sec === 'Detailing');
  B.ensureManual_(d).removed.push(det.label);
  resave(d);
  check('detailing removed → $777.40 of services → $25', disc(d) === 25, 'discount $' + disc(d));
  /* Via a direct splice + re-total, the way every write path finishes. */
  const d2 = quoteFrom('jetski-inside-detail', { hho: true, slipNo: 'B-14' });
  B.hhoSetDecision_(d2, 'approve', '', 'Test');
  d2.lines = d2.lines.filter(l => l.sec !== 'Detailing');
  B.recomputeTotals_(d2);
  check('the same, through recomputeTotals_ alone', disc(d2) === 25, 'discount $' + disc(d2));
  /* And when the customer drops the detailing themselves and re-saves. */
  const d3 = quoteFrom('jetski-inside-detail', { hho: true, slipNo: 'B-14' });
  B.hhoSetDecision_(d3, 'approve', '', 'Test');
  d3.state.skiDetail = 0; resave(d3);
  check('the same, through a customer re-save', disc(d3) === 25, 'discount $' + disc(d3));
}

console.log('\n=== 4. a fixed amount stays put ===');
{
  const d = quoteFrom('jetski-inside-detail', { hho: true, slipNo: 'B-14' });
  B.hhoSetDecision_(d, 'approve', '-75', 'Test');          // sign does not matter
  check('a different figure is pinned', d.manual.hho.amt === 75 && disc(d) === 75);
  d.state.skiDetail = 0; resave(d);
  check('and survives the detailing coming off', disc(d) === 75, 'discount $' + disc(d));
  const info = B.hhoInfo_(d);
  check('the console is told it is fixed and what the tier now says', info.fixed && info.fixedAmt === 75 && info.tier === 25);
}

console.log('\n=== 5. staff adjustments do not move the tier ===');
{
  const d = quoteFrom('boat-late-retrieval-hho-quoterequests');   // $1,140 of services
  B.hhoSetDecision_(d, 'approve', '', 'Test');
  check('$1,140 → $50', disc(d) === 50);
  B.ensureManual_(d).adjustments.push({ label: 'December service charge', amt: 1000 });
  resave(d);
  check('a $1,000 late fee does not lift it to $100', disc(d) === 50, 'discount $' + disc(d));
  B.ensureManual_(d).adjustments = [{ label: 'Courtesy discount', amt: -500 }];
  resave(d);
  check('a $500 courtesy discount does not drop it to $25', disc(d) === 50, 'discount $' + disc(d));
}

console.log('\n=== 6. one line, never two; never migrated into adjustments ===');
{
  const d = quoteFrom('boat-twin-inboard-full', { hho: true, slipNo: 'C-3' });   // $3,883.60
  B.hhoSetDecision_(d, 'approve', '', 'Test');
  B.recomputeTotals_(d); B.recomputeTotals_(d); resave(d); resave(d);
  check('still exactly one discount line', count(d) === 1 && disc(d) === 150, count(d) + ' line(s), $' + disc(d));
  check('reconcileManual_ leaves it alone', B.reconcileManual_(d) === false && d.manual.adjustments.length === 0);
  const pending = quoteFrom('boat-twin-inboard-full', { hho: true, slipNo: 'C-3' });
  check('the console sees it as awaiting approval with the right tier',
    B.hhoInfo_(pending).status === 'pending' && B.hhoInfo_(pending).tier === 150 && B.hhoInfo_(pending).asked);
}

console.log('\n=== 7. the line editor routes to the same decision ===');
{
  const d = quoteFrom('jetski-inside-detail', { hho: true, slipNo: 'B-14' });
  B.hhoSetDecision_(d, 'approve', '', 'Test');
  B.hhoLineEdit_(d, 'edit', '-40', 'Test');
  check('editing the line pins that amount', d.manual.hho.amt === 40 && disc(d) === 40);
  B.hhoLineEdit_(d, 'delete', null, 'Test');
  check('deleting the line is Remove', d.manual.hho.status === 'declined' && count(d) === 0);
  check('adminEditLine hands discount lines to it', /if \(line\.hho\)[\s\S]{0,200}hhoLineEdit_/.test(fn('adminEditLine')));
  check('the sheet-menu editor does too', /if \(line\.hho\)[\s\S]{0,200}hhoLineEdit_/.test(fn('editLineItems')));
}

console.log('\n=== 8. the customer never sees a discount they could play with ===');
{
  const r = B.computeQuote(states.find(s => s.name === 'boat-late-retrieval-hho-quoterequests').state);
  check('the engine puts no Heritage Harbor line on the customer quote', !r.lines.some(l => /Heritage Harbor|slip ?holder/i.test(l.label)));
  const opt = (page.match(/<label class="opt hhoOpt"[\s\S]*?<\/label>/) || [''])[0];
  check('the page asks the question', /slipholder/i.test(opt));
  check('and does not mention a discount', opt && !/discount/i.test(opt));
  check('the old $500 gate is gone (it told customers where a discount started)',
    !/hhoMinTotal/.test(page) && !/hhoMinTotal/.test(gas));
  check('the page replays an approved discount like the server', /withHhoDiscount\(r\.L, S, MANUAL\.hho\)/.test(page));
  check('the console has the card and sends the decision', /id="hhoCard"/.test(admin) && /api\('hho'/.test(admin));
  check('the console dispatches it', /hho:\s+function \(a\) \{ return adminHho\(/.test(gas));
}

if (fails) { console.error('\nFAIL: ' + fails + ' slipholder discount problem(s)'); process.exit(1); }
console.log('\nslipholder discount holds: asked not shown, approved by staff, follows the services total');
