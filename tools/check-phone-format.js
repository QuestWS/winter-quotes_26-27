#!/usr/bin/env node
/* Execute the phone formatter, and check that every place a phone number is
   shown actually runs it.
   ---------------------------------------------------------------------------
   Two separate failures are possible here and a grep catches neither. The
   first is the formatter mangling a number nobody can then call — an
   extension, an international number, a half-typed one. The second is a new
   render site that prints the raw value, which looks fine in review and only
   shows up when somebody prints a yard sheet.

   So this runs the real function over the awkward inputs, and then asserts
   that no display site in the backend reaches d.phone without it. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'pricing-engine.js'));

let bad = 0;
const fail = (m) => { console.error('  FAIL ' + m); bad++; };
const eq = (got, want, what) => {
  if (got !== want) fail(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
};

console.log('=== the house format ===');
[['8155550123',    '(815) 555-0123', 'ten bare digits'],
 ['815-555-0123',  '(815) 555-0123', 'dashes'],
 ['815.555.0123',  '(815) 555-0123', 'dots'],
 ['(815)555-0123', '(815) 555-0123', 'no space after the area code'],
 [' 815 555 0123 ','(815) 555-0123', 'spaces and padding'],
 ['18155550123',   '(815) 555-0123', 'with the country code'],
 ['+1 (815) 555-0123', '(815) 555-0123', 'fully decorated'],
 ['(815) 555-0123','(815) 555-0123', 'already formatted (idempotent)'],
].forEach(([inp, want, what]) => eq(E.fmtPhone(inp), want, what));

console.log('=== left exactly as typed, because we cannot be sure ===');
[['', '', 'empty'],
 ['555-0123', '555-0123', 'seven digits — a local number, not ours to expand'],
 ['8155550123 ext 4', '8155550123 ext 4', 'an extension'],
 ['815-555-0123 x22', '815-555-0123 x22', 'an extension, decorated'],
 ['+44 20 7946 0018', '+44 20 7946 0018', 'international'],
 ['call the shop', 'call the shop', 'not a number at all'],
 ['81555501234', '81555501234', 'eleven digits that are not a country code'],
 ['2', '2', 'one digit'],
].forEach(([inp, want, what]) => eq(E.fmtPhone(inp), want, what));

/* A number that reaches the sheet must be reversible to the digits somebody
   dials. Formatting that loses or invents a digit is the real hazard. */
console.log('=== no digit is lost or invented ===');
for (let i = 0; i < 400; i++) {
  const d = String(2000000000 + Math.floor(Math.random() * 7999999999)).slice(0, 10);
  const out = E.fmtPhone(d);
  if (out.replace(/\D/g, '') !== d) { fail('digits changed: ' + d + ' -> ' + out); break; }
  if (!/^\(\d{3}\) \d{3}-\d{4}$/.test(out)) { fail('wrong shape: ' + out); break; }
}

console.log('=== the live mask, typed one character at a time ===');
{
  let acc = '';
  for (const ch of '8155550123') acc = E.fmtPhonePartial(acc + ch);
  eq(acc, '(815) 555-0123', 'typing ten digits straight through');
  eq(E.fmtPhonePartial('815'), '(815', 'area code alone');
  eq(E.fmtPhonePartial('(815) 555-0123'), '(815) 555-0123', 'retyping over a formatted value');
  eq(E.fmtPhonePartial('call after 5'), 'call after 5', 'words are left alone');
  eq(E.fmtPhonePartial('+44 20 7946 0018'), '+44 20 7946 0018', 'international is left alone');
  /* Backspacing must be able to empty the field. A mask that re-inserts a
     bracket after the last delete traps the person in it. */
  eq(E.fmtPhonePartial(''), '', 'deleting the last character clears it');
}

console.log('=== every backend render site runs it ===');
{
  const gas = fs.readFileSync(path.join(ROOT, 'quote-logger-apps-script.gs'), 'utf8');
  const lines = gas.split('\n');
  const raw = [];
  lines.forEach((ln, i) => {
    if (!/\b(d|x|parsed)\.phone\b/.test(ln)) return;
    if (/fmtPhone\s*\(/.test(ln)) return;
    raw.push((i + 1) + ': ' + ln.trim());
  });
  if (raw.length) {
    fail('a phone number is used without fmtPhone():');
    raw.forEach(r => console.error('         ' + r));
  } else {
    console.log('  every d.phone / x.phone / parsed.phone goes through fmtPhone()');
  }
}

console.log('=== the quote page uses the shared one, not its own ===');
{
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const flat = page.replace(/\s+/g, ' ');
  const destructure = (flat.match(/const \{[^}]*\} = QuestPricing/) || [''])[0];
  for (const name of ['fmtPhone', 'fmtPhonePartial']) {
    if (!new RegExp('\\b' + name + '\\b').test(destructure)) {
      fail('index.html does not take ' + name + ' from the shared engine');
    }
  }
  if (/function\s+fmtPhone\s*\(/.test(page)) {
    fail('index.html defines its own fmtPhone — there must be exactly one');
  }
  if (!/addEventListener\('blur'/.test(page)) {
    fail('the phone field has no blur handler, so a pasted number is never formatted');
  }
  /* $ on the quote page is querySelector, so it wants a selector. Passing the
     bare id returns null, the whole mask block is skipped, and nothing throws —
     which is exactly how this shipped broken for one round of testing. */
  if (!/\$\('#phone'\)/.test(page)) {
    fail("the phone field is not looked up as $('#phone') — a bare id returns null and the mask silently does nothing");
  }
}

if (bad) { console.error('FAIL: ' + bad + ' phone-format problem(s)'); process.exit(1); }
console.log('phone format holds: one rule, applied everywhere, nothing mangled');
