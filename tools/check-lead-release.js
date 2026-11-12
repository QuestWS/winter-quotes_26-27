#!/usr/bin/env node
/* A LEAD THE OFFICE FINISHED LEAVES THE LEAD TAB — run, not read.
   ---------------------------------------------------------------------------
   QW-26-1651, Nov 2026: a customer got past the contact gate (a lead row on
   'Quote Started'), never finished, and the office finished it from the
   console — storage, slip, contract, payment. Every write landed on the lead
   row, and the lead tab is skipped by Harbor Haul Out, the storage view, the
   haul-out sheets and the balance report, so a paid boat was on no list.

   The REAL leadReleaseTab_, leaveLeadTab_, leaveImportTab_, recordEmail_,
   moveQuoteRow_ and releaseStrandedLeads are lifted out of the .gs and run
   against a fake spreadsheet. The source checks at the end pin the three write
   paths that must release (dimension editor, payment, any send) and the
   follow-up that must never nudge a finished quote to "finish".

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const GAS = fs.readFileSync(path.join(__dirname, '..', 'quote-logger-apps-script.gs'), 'utf8');
function fn(n){
  const one = GAS.match(new RegExp('^function ' + n + '\\b.*}\\s*$','m'));
  if (one) return one[0];
  const m = GAS.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}','m'));
  if (!m) throw new Error('missing ' + n); return m[0];
}
function decl(n){ const m = GAS.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$','m'));
  if (!m) throw new Error('missing const ' + n); return m[0]; }

function Sheet(name, rows){ this.name=name; this.rows=rows; }
Sheet.prototype.getName=function(){ return this.name; };
Sheet.prototype.getLastRow=function(){ return this.rows.length; };
Sheet.prototype.deleteRow=function(r){ this.rows.splice(r-1,1); };
Sheet.prototype.setFrozenRows=function(){};
Sheet.prototype.appendRow=function(v){ this.rows.push(v.slice()); };
Sheet.prototype.getRange=function(r,c,nr,nc){
  const sh=this;
  return {
    getValue(){ return (sh.rows[r-1]||[])[c-1]; },
    setValue(v){ while(sh.rows.length<r) sh.rows.push([]); sh.rows[r-1][c-1]=v; },
    getValues(){ const out=[]; for(let i=0;i<(nr||1);i++){ const row=sh.rows[r-1+i]||[]; const seg=[];
      for(let j=0;j<(nc||1);j++) seg.push(row[c-1+j]); out.push(seg);} return out; },
    setValues(vals){ vals.forEach((row,i)=>{ while(sh.rows.length<r+i) sh.rows.push([]);
      row.forEach((v,j)=>{ sh.rows[r-1+i][c-1+j]=v; }); }); },
    setNumberFormat(){return this;}, setWrap(){return this;}, setFontWeight(){return this;}
  };
};

const book = {};
let dropped = 0;
const AUDIT = [];
const env = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: n => book[n] || null,
    insertSheet: n => (book[n] = new Sheet(n, [])),
  })},
  auditLog_: (who, what) => { AUDIT.push(what); },
  invalidateStorageView_: () => { dropped++; },
  console: { log(){}, error(){} },
};
const src = [
  decl('IMPORT_TAB'), decl('STARTED_TAB'), decl('COL'), decl('HEADERS'),
  decl('IMPORT_HOLD_MARK'), decl('IMPORT_SENT_MARK'),
  fn('isImportTab_'), fn('isStartedTab_'), fn('isOffstageTab_'),
  fn('isImportHoldMark_'), fn('releaseImportHold_'),
  fn('moveQuoteRow_'), fn('leaveImportTab_'), fn('leadReleaseTab_'), fn('leaveLeadTab_'),
  fn('recordEmail_'), fn('followRow_'), fn('releaseStrandedLeads'),
  'return { recordEmail_, followRow_, releaseStrandedLeads, leaveLeadTab_, HEADERS, COL };'
].join('\n');
const api = new Function(...Object.keys(env), src)(...Object.values(env));
const { HEADERS, COL } = api;

let failed = 0;
function check(label, got, want){
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log((pass ? '  ok: ' : '  FAIL: ') + label + (pass ? '' : '  got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)));
  if (!pass) failed++;
}
function rowFor(qn, d){
  const row = new Array(HEADERS.length).fill('');
  row[COL.QN-1] = qn; row[COL.LAST-1] = 'Tester';
  row[COL.PAYLOAD-1] = JSON.stringify(Object.assign({ quoteNo: qn }, d));
  return row;
}
function reset(){ Object.keys(book).forEach(k => delete book[k]); dropped = 0; AUDIT.length = 0; }
function qns(tab){ return (book[tab] ? book[tab].rows.slice(1) : []).map(r => r[COL.QN-1]); }

// 1. a send on a lead the office priced moves it, and says where
{
  reset();
  book['Quote Started'] = new Sheet('Quote Started', [HEADERS.slice(), rowFor('QW-26-0001', { storageTab: 'Inside' })]);
  const d = { quoteNo: 'QW-26-0001', storageTab: 'Inside', email: 'x@y.z' };
  const after = api.recordEmail_(book['Quote Started'], 2, d, 'updated', 'Staff');
  check('a priced lead left the lead tab on a send', qns('Quote Started'), []);
  check('and landed on its storage tab', qns('Inside'), ['QW-26-0001']);
  check('recordEmail_ reports where it went', [after.sh.getName(), after.rowNum], ['Inside', 2]);
  check('the cached storage view was dropped', dropped > 0, true);
  check('the move is in the Activity Log', AUDIT.some(a => /QW-26-0001.*Quote Started.*Inside/.test(a)), true);
}
// 2. a real lead stays a lead
{
  reset();
  book['Quote Started'] = new Sheet('Quote Started', [HEADERS.slice(), rowFor('QW-26-0002', { storageTab: 'Quote Started' })]);
  const d = { quoteNo: 'QW-26-0002', storageTab: 'Quote Started', email: 'x@y.z' };
  const after = api.recordEmail_(book['Quote Started'], 2, d, 'finish-quote', 'System');
  check('an unpriced lead stays on the lead tab', [after.sh.getName(), qns('Quote Started')], ['Quote Started', ['QW-26-0002']]);
  const none = api.leaveLeadTab_(book['Quote Started'], 2, { quoteNo: 'QW-26-0002' });
  check('a lead with no storage tab at all stays too', none, null);
}
// 3. the Import hold is not released by this path
{
  reset();
  book['Import'] = new Sheet('Import', [HEADERS.slice(), rowFor('QW-26-0003', { storageTab: 'Outside' })]);
  check('leaveLeadTab_ never moves an Import draft', api.leaveLeadTab_(book['Import'], 2, { quoteNo: 'QW-26-0003', storageTab: 'Outside' }), null);
  check('it is still parked', qns('Import'), ['QW-26-0003']);
}
// 4. a quote already on a real tab is untouched
{
  reset();
  book['Inside'] = new Sheet('Inside', [HEADERS.slice(), rowFor('QW-26-0004', { storageTab: 'Outside' })]);
  check('a quote on a storage tab is not moved by this path', api.leaveLeadTab_(book['Inside'], 2, { quoteNo: 'QW-26-0004', storageTab: 'Outside' }), null);
}
// 5. the repair: moves exactly the finished ones, bottom-up, idempotent
{
  reset();
  book['Quote Started'] = new Sheet('Quote Started', [HEADERS.slice(),
    rowFor('QW-26-0010', { storageTab: 'Inside' }),
    rowFor('QW-26-0011', { storageTab: 'Quote Started' }),
    rowFor('QW-26-0012', { storageTab: 'Inside' }),
    rowFor('QW-26-0013', { storageTab: 'Quote Started' }),
    rowFor('QW-26-0014', { storageTab: 'No Storage' }),
    rowFor('QW-26-0015', { storageTab: 'Import' })]);
  book['Inside'] = new Sheet('Inside', [HEADERS.slice(), rowFor('QW-26-0099', { storageTab: 'Inside' })]);
  const r = api.releaseStrandedLeads();
  check('only the leads still marked Quote Started (or offstage) stay', qns('Quote Started'), ['QW-26-0011', 'QW-26-0013', 'QW-26-0015']);
  check('both finished Inside quotes moved, existing row untouched', qns('Inside').sort(), ['QW-26-0010', 'QW-26-0012', 'QW-26-0099']);
  check('a finished No Storage quote moved to No Storage', qns('No Storage'), ['QW-26-0014']);
  check('the run reports three moves', r.moved.length, 3);
  const again = api.releaseStrandedLeads();
  check('a second run moves nothing', again.moved.length, 0);
}
// 6. followRow_ follows a move and ignores a non-answer
{
  const ctx = { sh: 'old', rowNum: 9 };
  api.followRow_(ctx, null);
  check('followRow_ leaves ctx alone on null', [ctx.sh, ctx.rowNum], ['old', 9]);
  api.followRow_(ctx, { sh: 'new', rowNum: 3 });
  check('followRow_ takes the new row', [ctx.sh, ctx.rowNum], ['new', 3]);
}

// 7. wiring — the write paths that finish a lead from the console
function body(n){ return fn(n); }
const dims = GAS.match(/const toTab = d\.storageTab \|\| fromTab;[\s\S]{0,900}?moveQuoteRow_\(ctx, toTab\)/);
check('dimension editor moves a lead (guard is the Import tab only)',
  !!dims && /!isImportTab_\(fromTab\)/.test(dims[0]) && !/!isOffstageTab_\(fromTab\)/.test(dims[0]), true);
check('dimension editor never moves onto an offstage tab', !!dims && /!isOffstageTab_\(toTab\)/.test(dims[0]), true);
check('a payment releases a lead the office priced', /leaveLeadTab_\(ctx\.sh, ctx\.rowNum, d\)/.test(body('adminRecordPayment')), true);
check('every send releases one (recordEmail_)', /leaveLeadTab_\(/.test(body('recordEmail_')), true);
const fu = body('leadFollowUpCheck');
check('the lead follow-up releases stranded leads before reading the tab',
  fu.indexOf('releaseStrandedLeads()') > -1 && fu.indexOf('releaseStrandedLeads()') < fu.indexOf('getSheetByName(STARTED_TAB)'), true);
check('the lead follow-up never nudges a priced quote to "finish"', /leadReleaseTab_\(STARTED_TAB, d\)\) return/.test(fu), true);
// No caller may discard where recordEmail_ put the row and then write to it.
const bare = GAS.split('\n').filter(l => /recordEmail_\(ctx\.sh, ctx\.rowNum/.test(l) && !/followRow_\(ctx, recordEmail_|const after = recordEmail_/.test(l));
check('every ctx caller follows the row after a send', bare, []);

if (failed) { console.log(failed + ' check(s) failed'); process.exit(1); }
console.log('all lead-release checks passed');
