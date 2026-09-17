#!/usr/bin/env node
/* The Adobe Sign hand-off: run the link builder and assert what comes out.
   ---------------------------------------------------------------------------
   The failure this guards against is silent by design. Acrobat Sign pre-fills
   a web form field from the URL fragment ONLY when the parameter name matches
   the field's name on the Adobe side exactly. A name that does not match is
   not an error -- Adobe leaves the field blank and says nothing -- so a rename
   on one side ships, looks fine, and produces blank contracts until somebody
   notices weeks later. Nothing in this repo can see the Adobe side, so what is
   checked here is everything that CAN drift on our side:

   1. THE NAMES AGREE WITH THE DOC. docs/adobe-webform-field-map.md is what
      anyone setting up the Adobe form reads. If SIGNING.fields is edited and
      that table is not, the next person names the field from a stale doc.

   2. THE LINK IS BUILT IN ONE PLACE. The page and the server both hand out a
      sign link. Two builders would drift the moment the form is re-published.

   3. THE SHAPE IS RIGHT. Fragment not query string; quote number always; slip
      only when there is one; values encoded; a configured URL that already has
      a fragment does not end up with two.

   4. THE SERVER REBUILDS RATHER THAN REPLAYS. Emails must not take the sign
      link straight from the stored column -- that copy predates both the slip
      staff entered and, for every existing quote, the web form itself.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let fail = 0;
const bad = m => { console.error('FAIL ' + m); fail = 1; };
const ok  = m => console.log('  ok: ' + m);

const engine = require(path.join(ROOT, 'pricing-engine.js'));
const page   = read('index.html');
const gas    = read('quote-logger-apps-script.gs');
const doc    = read('docs/adobe-webform-field-map.md');

/* ---- 1. engine field names vs. the doc anyone sets the form up from ---- */
const fields = (engine.SIGNING && engine.SIGNING.fields) || {};
const names = Object.keys(fields).map(k => fields[k]);
if (!names.length) bad('SIGNING.fields is empty — nothing would ever pre-fill');
names.forEach(function (n) {
  /* Backticked in the table, so a near-miss in prose cannot satisfy this. */
  if (doc.indexOf('`' + n + '`') > -1) ok('field name documented: ' + n);
  else bad('field name ' + JSON.stringify(n) + ' is not in docs/adobe-webform-field-map.md — ' +
           'the Adobe form gets named from that doc, and a name that does not match fails silently');
});
/* And the reverse: a name left in the doc after being renamed in the engine is
   the same trap pointed the other way. */
(doc.match(/^\| [^|]*\| `([A-Za-z0-9_ ]+)` \|/gm) || []).forEach(function (row) {
  const n = row.match(/`([A-Za-z0-9_ ]+)`/)[1];
  if (names.indexOf(n) < 0) bad('docs/adobe-webform-field-map.md still lists field ' + JSON.stringify(n) +
                                ' — it is not in SIGNING.fields any more');
});

/* ---- 2. one builder, and the config is not duplicated ---- */
if (typeof engine.signUrlFor !== 'function') bad('engine does not export signUrlFor');
else ok('engine exports signUrlFor');
if (/adobesign\.com|esignWidget/i.test(page)) {
  bad('index.html contains an Acrobat Sign URL — the web form URL belongs in SIGNING.webFormUrl only');
} else ok('page carries no Adobe URL of its own');
if (/adobeWebFormUrl/.test(page)) {
  bad('index.html still has INTEGRATIONS.adobeWebFormUrl — a second copy of the web form URL');
} else ok('page has no second web form URL');
['signUrlFor(', 'adobeSignUrl('].forEach(function (s) {
  if (page.indexOf(s) > -1) ok('page delegates: ' + s + ')');
  else bad('index.html no longer calls ' + s + ') — it is building the sign link some other way');
});

/* ---- 3. run it ---- */
const saved = engine.SIGNING.webFormUrl;
try {
  engine.SIGNING.webFormUrl = '';
  if (engine.signUrlFor({ quoteNo: 'QW-26-1255', slipNo: 'B-14' }) !== '')
    bad('no web form configured but signUrlFor returned a link — the placeholder would be replaced by a dead iframe');
  else ok('unconfigured web form yields no link');

  const BASE = 'https://na3.documents.adobe.com/public/esignWidget?wid=TEST';
  const key = k => encodeURIComponent(k);
  engine.SIGNING.webFormUrl = BASE;
  const qOnly = engine.signUrlFor({ quoteNo: 'QW-26-1255' });
  if (qOnly !== BASE + '#' + key(fields.quoteNo) + '=QW-26-1255')
    bad('quote-only link is wrong: ' + qOnly);
  else ok('quote number rides the fragment');
  if (qOnly.indexOf('?' + key(fields.quoteNo)) > -1 || qOnly.indexOf('&' + key(fields.quoteNo) + '=') > -1)
    bad('pre-fill was appended as a query parameter — Acrobat Sign only reads the fragment');
  /* Our field names contain spaces. A raw space in a URL is not a URL: the
     link breaks differently in every email client that touches it. */
  if (/[^\S\n]/.test(qOnly)) bad('the link contains a raw space: ' + qOnly);
  else ok('field-name spaces are percent-encoded');

  const withSlip = engine.signUrlFor({ quoteNo: 'QW-26-1255', slipNo: 'B-14' });
  if (withSlip !== qOnly + '&' + key(fields.slipNo) + '=B-14') bad('slip link is wrong: ' + withSlip);
  else ok('slip joins with &');

  /* hosted=false belongs on the iframe and nowhere else. */
  const emb = engine.signUrlFor({ quoteNo: 'QW-26-1255', embed: true });
  if (emb.indexOf('hosted=false') < 0) bad('embedded link is missing hosted=false: ' + emb);
  else if (emb.indexOf('hosted=false') > emb.indexOf('#')) bad('hosted=false landed inside the fragment: ' + emb);
  else ok('embedded link carries hosted=false, ahead of the fragment');
  if (qOnly.indexOf('hosted=') > -1) bad('the emailed link carries hosted= — it opens the form directly');
  else ok('emailed link does not claim to be embedded');

  if (engine.signUrlFor({ quoteNo: 'QW-26-1255', slipNo: '   ' }).indexOf(fields.slipNo) > -1)
    bad('a blank slip was sent as a field — it would blank whatever is on the Adobe side');
  else ok('blank slip is left out entirely');

  const enc = engine.signUrlFor({ quoteNo: 'QW-26-1255', slipNo: 'Dock B / 14' });
  if (enc.indexOf('Dock B / 14') > -1 || enc.indexOf('%20') < 0) bad('slip value was not URL-encoded: ' + enc);
  else ok('values are URL-encoded');

  if (engine.signUrlFor({ slipNo: 'B-14' }) !== '' || engine.signUrlFor() !== '')
    bad('a link was built without a quote number — it would sign an unidentifiable contract');
  else ok('no quote number yields no link');

  engine.SIGNING.webFormUrl = BASE + '#leftover=1';
  const frag = engine.signUrlFor({ quoteNo: 'QW-26-1255' });
  if ((frag.match(/#/g) || []).length !== 1 || frag.indexOf('leftover') > -1)
    bad('a configured URL with its own fragment produced: ' + frag);
  else ok('an existing fragment is replaced, not appended to');
} finally {
  engine.SIGNING.webFormUrl = saved;
}

/* ---- 4. the server builds fresh, and reads the slip through the journal ---- */
const helper = (gas.match(/^function signUrlFor_\b[\s\S]*?\n}/m) || [''])[0];
if (!helper) bad('quote-logger-apps-script.gs has no signUrlFor_');
else {
  if (/effectiveState_/.test(helper)) ok('server reads the slip through effectiveState_');
  else bad('signUrlFor_ does not go through effectiveState_ — a slip staff corrected in the console ' +
           'would never reach Adobe');
  if (/signUrlFor\(/.test(helper)) ok('server delegates to the shared engine builder');
  else bad('signUrlFor_ does not call the engine builder');
}
/* Every `signUrl:` handed to the email builder must START with something
   signUrlFor_ produced -- either the call itself, or a local built from it a
   few lines up (the reminder sweep, which has the payload but not the quote
   object). A stored-column fallback AFTER that is fine and wanted; it is only
   a leading one that would ship a stale link. */
const replays = [];
let m, re = /signUrl:\s*([^,\n]+)/g;
while ((m = re.exec(gas))) {
  const expr = m[1].trim();
  if (!/^(signUrlFor_\(|signLink\b)/.test(expr)) replays.push(expr);
}
if (replays.length) {
  bad('an email builds its sign link without signUrlFor_ — a stored link predates the slip, and ' +
      'predates the web form entirely on every quote saved so far:\n       ' + replays.join('\n       '));
} else ok('every email rebuilds the sign link at send time');

process.exit(fail);
