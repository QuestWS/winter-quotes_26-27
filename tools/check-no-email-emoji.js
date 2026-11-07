#!/usr/bin/env node
/* No emoji in an email — Chris, Nov 2026: "no emojis in professional
   emails", none used for emphasis. A symbol that does a job (→ ✓ ×) is fine.
   Fails on an emoji in any line of the backend that builds a subject or
   sends mail. Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const gas = fs.readFileSync(path.join(__dirname, '..', 'quote-logger-apps-script.gs'), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B50}\u{2B55}\u{FE0F}\u{2705}\u{274C}\u{2757}]|\\ud83[c-e]/iu;
const MAILISH = /subject|sendEmail|htmlBody|GmailApp|MailApp/;
let fails = 0;
gas.split('\n').forEach((line, i) => {
  const s = line.trim();
  if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
  if (MAILISH.test(line) && EMOJI.test(line)) { console.log('  FAIL  line ' + (i + 1) + ': ' + s.slice(0, 140)); fails++; }
});
console.log(fails ? fails + ' FAILED' : 'ALL PASS — no emoji in an email subject or send');
process.exit(fails ? 1 : 0);
