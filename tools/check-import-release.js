#!/usr/bin/env node
/* SENDING A DRAFT RELEASES IT — proved by running the code, not reading it.
   ---------------------------------------------------------------------------
   check-import-tab.js reads the scan bodies and asserts the wiring is there.
   This file executes it: the REAL recordEmail_, leaveImportTab_, releaseImport-
   Hold_ and moveQuoteRow_ are lifted out of the .gs and run against a fake
   spreadsheet, and the test asks where the row actually ended up.

   Why both: the release has to be right in three different situations, and
   "the call is present" says nothing about which one it gets wrong. A draft
   that is emailed and does NOT move stays invisible to the crew who have to
   pull the boat. A row that moves but is not REPORTED as moved leaves every
   caller after the send talking about a row that has been deleted. A quote
   already on a real tab that "moves" again is a duplicate.

   The customer's own "Email me this quote" runs the same path as Chris
   emailing it from the console — that is deliberate, and case 1 is it.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const GAS = fs.readFileSync('/home/user/winter-quotes_26-27/quote-logger-apps-script.gs', 'utf8');
function fn(n){
  const one = GAS.match(new RegExp('^function ' + n + '\\b.*}\\s*$','m'));
  if (one) return one[0];
  const m = GAS.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}','m'));
  if (!m) throw new Error('missing ' + n); return m[0];
}
function decl(n){ const m = GAS.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$','m'));
  if (!m) throw new Error('missing const ' + n); return m[0]; }

// ---- fake sheet: a 2-D array per tab, 1-indexed like Apps Script ----
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
const env = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: n => book[n] || null,
    insertSheet: n => (book[n] = new Sheet(n, [])),
  })},
  auditLog_: () => {},
  console,
};

const src = [
  decl('IMPORT_TAB'), decl('STARTED_TAB'), decl('COL'), decl('HEADERS'),
  decl('IMPORT_HOLD_MARK'), decl('IMPORT_SENT_MARK'),
  fn('isImportTab_'), fn('isStartedTab_'), fn('isOffstageTab_'),
  fn('isImportHoldMark_'), fn('releaseImportHold_'),
  fn('moveQuoteRow_'), fn('leaveImportTab_'), fn('recordEmail_'),
  'return { recordEmail_, HEADERS, COL, IMPORT_HOLD_MARK, isImportSentMark_: null };'
].join('\n');
const api = new Function(...Object.keys(env), src)(...Object.values(env));
const { HEADERS, COL } = api;

function freshBook(tabName, storageTab){
  Object.keys(book).forEach(k => delete book[k]);
  const hdr = HEADERS.slice();
  const row = new Array(HEADERS.length).fill('');
  row[COL.LAST-1]='Tester'; row[COL.QN-1]='QW-26-0001'; row[COL.REM-1]=api.IMPORT_HOLD_MARK+'9/22/2026';
  book[tabName] = new Sheet(tabName, [hdr, row]);
  if (storageTab !== tabName) book[storageTab] = new Sheet(storageTab, [HEADERS.slice()]);
  return { sh: book[tabName], rowNum: 2 };
}
function check(label, got, want){ console.log((got===want?'  ok: ':'  FAIL: ')+label+
  (got===want?'':'  got '+JSON.stringify(got)+', wanted '+JSON.stringify(want))); if(got!==want) process.exitCode=1; }

// 1. a parked draft, customer emails themselves their copy
{
  const at = freshBook('Import','Inside');
  const d = { quoteNo:'QW-26-0001', storageTab:'Inside', email:'x@y.z' };
  const after = api.recordEmail_(at.sh, at.rowNum, d, 'quote copy', 'Quote page');
  check('the row left the Import tab', book['Import'].rows.length, 1);            // header only
  check('and landed on Inside', book['Inside'].rows.length, 2);
  check('recordEmail_ reports the new tab', after.sh.getName(), 'Inside');
  check('and the new row number', after.rowNum, 2);
  check('the quote number went with it', book['Inside'].rows[1][COL.QN-1], 'QW-26-0001');
  check('the hold was swapped for a SENT marker',
        String(book['Inside'].rows[1][COL.REM-1]).indexOf('Imported — sent ')===0, true);
  check('the email is in the log', (d.emailLog||[]).length, 1);
}
// 2. a quote already on a real tab is not moved, and the caller is told so
{
  const at = freshBook('Inside','Inside');
  const d = { quoteNo:'QW-26-0001', storageTab:'Inside', email:'x@y.z' };
  const after = api.recordEmail_(at.sh, at.rowNum, d, 'quote copy', 'Quote page');
  check('it stays where it is', after.sh.getName(), 'Inside');
  check('same row', after.rowNum, 2);
  check('nothing was duplicated', book['Inside'].rows.length, 2);
}
// 3. a draft with nowhere sensible to go stays parked
{
  const at = freshBook('Import','Import');
  const d = { quoteNo:'QW-26-0001', storageTab:'Import', email:'x@y.z' };
  const after = api.recordEmail_(at.sh, at.rowNum, d, 'quote copy', 'Quote page');
  check('a draft whose storage tab is offstage stays parked', after.sh.getName(), 'Import');
  check('and the row is still there', book['Import'].rows.length, 2);
}
