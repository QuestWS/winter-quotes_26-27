#!/usr/bin/env node
/* Customer details (name, phone, email) edited from the console — executed.
   ---------------------------------------------------------------------------
   adminSetContact has to change four copies together (payload top level,
   d.state, the sheet's columns, the PDF), and a last-name change must not
   lock the customer out of links already emailed to them. Grepping for the
   field names proves none of that, so the real function is RUN here against
   a fake sheet row, and the last-name rule (lastNameMatches_) is run
   directly. No customer data: every name below is invented.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
const eng = fs.readFileSync(path.join(ROOT, 'pricing-engine.js'), 'utf8');

function fn(src, n) {
  const one = src.match(new RegExp('^function ' + n + '\\b.*}\\s*$', 'm'));
  if (one) return one[0];
  const m = src.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n);
  return m[0];
}
const decl = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error('missing const ' + n);
  return m[0];
};
const COL = (new Function(decl('COL') + '; return COL;'))();
const HL = 23;

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const ok = (m) => console.log('  ok: ' + m);

function fresh(over) {
  const d = Object.assign({
    quoteNo: 'QW-26-0001', firstName: 'Jonh', lastName: 'Smyth', owner: 'Jonh Smyth',
    phone: '8155550100', email: 'Old@Example.com', unit: 'Boat', total: 900,
    state: { firstName: 'Jonh', lastName: 'Smyth', phone: '8155550100', email: 'Old@Example.com', unit: 'boat' }
  }, over || {});
  const row = new Array(HL).fill('');
  row[COL.LAST - 1] = d.lastName; row[COL.FIRST - 1] = d.firstName; row[COL.QN - 1] = d.quoteNo;
  row[COL.PHONE - 1] = d.phone; row[COL.EMAIL - 1] = d.email;
  row[COL.PAYLOAD - 1] = JSON.stringify(d);
  return { d, row };
}

/* Runs adminSetContact against one row. Returns the answer plus what was
   written, the PDFs built and the log lines. */
function run(rec, fields, perm) {
  const writes = {};
  const pdfs = [];
  const logs = [];
  const sh = {
    getName: () => 'Inside',
    getRange: (r, c) => ({ setValue: (v) => { writes[c] = v; rec.row[c - 1] = v; } })
  };
  const body = [
    decl('COL'),
    fn(eng, 'fmtPhone'),
    decl('CONTACT_FIELDS_'), decl('CONTACT_NAME_MAX_'), decl('CONTACT_EMAIL_MAX_'), decl('FORMER_LAST_NAMES_MAX_'),
    'function requireAuth_(t, p){ if (p !== "keys") throw new Error("wrong permission " + p); return { name: "Tester" }; }',
    'function isStartedQuote_(d){ return !!d._lead; }',
    'function savePdf_(d){ PDFS.push(d.owner); return "https://drive/pdf"; }',
    'function auditLog_(w, a){ LOGS.push(a); }',
    'function findQuoteCtx_(qn){ return { sh: SH, rowNum: 2, d: JSON.parse(REC.row[COL.PAYLOAD - 1]) }; }',
    fn(gas, 'contactOf_'), fn(gas, 'lastNameMatches_'), fn(gas, 'adminSetContact'),
    'return adminSetContact("tok", "QW-26-0001", FIELDS);'
  ].join('\n');
  const out = new Function('SH', 'REC', 'FIELDS', 'PDFS', 'LOGS', body)(sh, rec, fields, pdfs, logs);
  return { out, writes, pdfs, logs, d: JSON.parse(rec.row[COL.PAYLOAD - 1]) };
}
const matches = new Function(fn(gas, 'lastNameMatches_') + '; return lastNameMatches_;')();

console.log('=== adminSetContact ===');
{
  const rec = fresh();
  const r = run(rec, { firstName: 'John', lastName: 'Smyth', phone: '8155550100', email: 'old@example.com' });
  if (!r.out.ok) fail('a first-name fix was refused: ' + r.out.error);
  else if (r.d.firstName !== 'John' || r.d.state.firstName !== 'John' || r.d.owner !== 'John Smyth')
    fail('first name not changed in payload, state and owner together: ' + JSON.stringify([r.d.firstName, r.d.state.firstName, r.d.owner]));
  else if (rec.row[COL.FIRST - 1] !== 'John') fail('the sheet\'s First column was not updated');
  else if (r.pdfs.length !== 1 || r.pdfs[0] !== 'John Smyth') fail('the PDF was not rebuilt under the new name');
  else if (r.d.formerLastNames) fail('a first-name fix recorded a former last name');
  else if (/phone|email/i.test(r.out.msg.split('.')[0])) fail('unchanged fields were reported as changed: ' + r.out.msg);
  else ok('first-name typo fixed in payload, state, owner, sheet and PDF; nothing else counted as changed');
  if (!r.d.notesAt) fail('notesAt not stamped — a Gmail draft built before the edit would not read as stale');
  else ok('notesAt stamped so the draft sweep sees older drafts as stale');
}
{
  const rec = fresh();
  const r = run(rec, { lastName: 'Smith' });
  if (!r.out.ok) fail('a last-name fix was refused: ' + r.out.error);
  else if (rec.row[COL.LAST - 1] !== 'Smith' || r.d.state.lastName !== 'Smith') fail('last name not written to sheet and state');
  else if (JSON.stringify(r.d.formerLastNames) !== '["smyth"]') fail('old last name not kept: ' + JSON.stringify(r.d.formerLastNames));
  else ok('last-name fix keeps the old spelling in formerLastNames');
  if (!matches('smith', 'Smith', r.d) || !matches('smith', ' SMYTH ', r.d)) fail('the new or the old last name no longer opens the quote');
  else ok('both the corrected and the emailed spelling open the quote');
  if (matches('smith', 'jones', r.d) || matches('smith', '', r.d)) fail('an unrelated or blank last name opens the quote');
  else ok('an unrelated or blank last name still does not');
  /* And back again: the spelling now in use is never also a "former" one. */
  const r2 = run(rec, { lastName: 'Smyth' });
  if (!r2.out.ok || JSON.stringify(r2.d.formerLastNames) !== '["smith"]') fail('changing back left the current name on the former list: ' + JSON.stringify(r2.d.formerLastNames));
  else ok('changing it back drops the current spelling from the former list');
}
{
  const rec = fresh();
  const r = run(rec, { phone: '815 555 0199' });
  if (!r.out.ok || r.d.phone !== '(815) 555-0199' || rec.row[COL.PHONE - 1] !== '(815) 555-0199' || r.d.state.phone !== '(815) 555-0199')
    fail('phone not formatted and written everywhere: ' + JSON.stringify([r.out, r.d.phone, rec.row[COL.PHONE - 1]]));
  else ok('a new phone is formatted and written to payload, state and sheet');
  const same = run(fresh(), { phone: '(815) 555-0100' });
  if (same.out.ok) fail('the same phone, formatted, counted as a change');
  else ok('the stored phone in another format is not a change');
}
{
  const rec = fresh();
  const r = run(rec, { email: 'New@Example.com ' });
  if (!r.out.ok || r.d.email !== 'new@example.com' || rec.row[COL.EMAIL - 1] !== 'new@example.com' || r.d.state.email !== 'new@example.com')
    fail('email not written everywhere: ' + JSON.stringify([r.out, r.d.email]));
  else ok('a new email is trimmed, lower-cased and written to payload, state and sheet');
  const caseOnly = run(fresh(), { email: 'old@example.com' });
  if (caseOnly.out.ok) fail('retyping the email in lower case counted as a change');
  else ok('a case-only difference in the email is not a change');
}
{
  const rec = fresh();
  const before = JSON.stringify(rec.row);
  const r1 = run(rec, { email: 'not-an-email' });
  const r2 = run(rec, { lastName: '   ' });
  if (r1.out.ok || r2.out.ok) fail('a bad email or blank last name was accepted');
  else if (JSON.stringify(rec.row) !== before || r1.pdfs.length || r2.pdfs.length) fail('a refused edit still wrote to the row or rebuilt the PDF');
  else ok('a bad email or a blank last name is refused and writes nothing');
  const r3 = run(rec, {});
  if (r3.out.ok) fail('an empty edit reported success');
  else ok('an edit with nothing in it reports "Nothing changed"');
}
{
  const rec = fresh({ _lead: true });
  const r = run(rec, { firstName: 'John' });
  if (!r.out.ok || r.pdfs.length) fail('a lead row (no selections) had a PDF built for it');
  else ok('a lead row is edited without building a PDF');
}

/* Every door that matches on last name has to accept a corrected one, or
   the first email sent before the fix stops working. */
console.log('=== last-name doors ===');
{
  const doGet = fn(gas, 'doGet');
  const n = (doGet.match(/lastNameMatches_\(/g) || []).length;
  if (n < 3) fail('only ' + n + ' of the 3 last-name doors in doGet (load, seasondone, launchpref) use lastNameMatches_');
  else ok('load, season-done and launch-pref all accept a former last name');
}

/* The customer's browser never carries formerLastNames, so the save path
   has to bring it across from the stored copy — or a re-save breaks every
   link emailed before the correction. */
console.log('=== customer save ===');
{
  const doPost = fn(gas, 'doPost');
  if (!/if \(oldD\.formerLastNames[^\n]*\) d\.formerLastNames = oldD\.formerLastNames;/.test(doPost))
    fail('doPost does not carry formerLastNames across a customer save');
  else ok('a customer save keeps the former last names');
}

if (bad) { console.error(bad + ' failure(s)'); process.exit(1); }
console.log('all customer-details checks passed');
