#!/usr/bin/env node
/* The Detail Tracker's door — executed where it can be, grepped where not.
   ---------------------------------------------------------------------------
   QuestWS/servicetracker's Detail Tracker (/d/) reads every winter quote with
   detailing or a wash on it, signs its staff in with THIS roster's PINs, and
   is pinged when a customer answers. What has to stay true:

   1. WHICH LINES. Detailing, the two washes and bottom paint, nothing
      else — not shrinkwrap, not an impeller.
   2. THE PIN. The same roster and the same wrong-PIN pause as adminAuth, and
      no SESS_ session minted here.
   3. THE URL. Only a script.google.com /exec URL is ever remembered as the
      tracker's address.
   4. THE PING. Sent after a customer answers, after staff price a request and
      after staff decide one for the customer — and from nowhere that sends a
      customer anything.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const gas = fs.readFileSync(path.join(__dirname, '..', 'quote-logger-apps-script.gs'), 'utf8');
function fn(n) {
  const m = gas.match(new RegExp('^function ' + n + '\\b[\\s\\S]*?\\n}', 'm'));
  if (!m) throw new Error('missing ' + n); return m[0];
}
const decl = (n) => {
  const m = gas.match(new RegExp('^const ' + n + '\\s*=[\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error('missing ' + n); return m[0];
};
let fails = 0;
const check = (l, c, d) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d ? '  — ' + d : '')); if (!c) fails++; };

console.log('=== 1. which lines ===');
const WORDS = new Function(decl('DETAIL_TRACKER_WORDS_') + '\nreturn DETAIL_TRACKER_WORDS_;')();
['Exterior detail', 'Wash & wax', 'Interior detail', 'Interior wipe-down', "Powerwash hull (22')", 'Acid wash hull', 'Jetski detail × 2',
  'Bottom paint touch-up', 'Strip bottom paint & reapply']
  .forEach((l) => check('"' + l + '" is the detailers\'', WORDS.test(l)));
['Shrinkwrap package (standard)', 'Impeller change', 'Propeller refurbishment', 'Full service — Inboard']
  .forEach((l) => check('"' + l + '" is not', !WORDS.test(l)));

console.log('=== 2. the PIN ===');
const cache = new Map();
const props = new Map();
const B = new Function('CacheService', 'PropertiesService', 'getStaff_', 'canQuote_', [
  fn('trackerStaffPin_'), fn('rememberTrackerUrl_'), 'return { trackerStaffPin_, rememberTrackerUrl_ };'].join('\n'))(
  { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
  { getScriptProperties: () => ({ getProperty: (k) => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
  () => ({ John: { pin: '4821', admin: false, perms: { quote: 1 } }, Chris: { pin: '1111', admin: true } }),
  (st) => !!(st && (st.admin || (st.perms && st.perms.quote))));
const ok = B.trackerStaffPin_(' 4821 ');
check('a staff PIN names its owner', ok.valid === true && ok.name === 'John' && ok.quote === 1);
check('a wrong PIN is refused', B.trackerStaffPin_('0000').valid === false);
check('and counts toward the console\'s pause', Number(cache.get('pinfails')) === 1);
for (let i = 0; i < 10; i++) B.trackerStaffPin_('0000');
check('ten wrong PINs pause it, even for a right one', B.trackerStaffPin_('4821').valid === false);
check('no session is minted here', !/SESS_/.test(fn('trackerStaffPin_')));

console.log('=== 3. the URL ===');
B.rememberTrackerUrl_('https://evil.example.com/exec');
check('a URL off script.google.com is ignored', !props.get('DETAIL_TRACKER_URL'));
B.rememberTrackerUrl_('https://script.google.com/macros/s/AKfycbTEST_tracker-1/exec');
check('the tracker\'s /exec is kept', props.get('DETAIL_TRACKER_URL') === 'https://script.google.com/macros/s/AKfycbTEST_tracker-1/exec');
check('this file holds no second /exec URL', new Set(gas.match(/AKfycb[A-Za-z0-9_-]+/g)).size === 1);

console.log('=== 4. the ping ===');
['offersServe_', 'adminOfferDecision', 'adminPriceRequest'].forEach((n) =>
  check(n + ' pings the tracker', /pingDetailTracker_\(/.test(fn(n))));
check('the door answers details and staffPin', /fn \|\| ''\) === 'details'/.test(fn('trackerServe_')) && /'staffPin'/.test(fn('trackerServe_')));
check('a ping never throws', /try \{[\s\S]*\} catch \(e\) \{\s*return false;/.test(fn('pingDetailTracker_')));
check('a ping sends no mail', !/GmailApp|MailApp/.test(fn('pingDetailTracker_')));

console.log('=== 5. John hears about detail answers ===');
check('the office answer email copies DETAIL_NOTIFY_EMAIL when a detail line was answered',
  /DETAIL_TRACKER_WORDS_\.test/.test(fn('notifyOfferDecisions_')) && /opts\.cc = DETAIL_NOTIFY_EMAIL/.test(fn('notifyOfferDecisions_')));
check('and that address is John\'s', /const DETAIL_NOTIFY_EMAIL = 'john@questwatersports\.com';/.test(gas));

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
