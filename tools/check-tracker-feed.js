#!/usr/bin/env node
/* The service tracker's feed — executed, not grepped.
   ---------------------------------------------------------------------------
   The mechanic app in QuestWS/servicetracker asks this backend for every unit
   on Harbor Haul Out's To store list and the work its quote says is to be
   done. Four properties of that answer matter and all four are properties of
   the code, so they are run here:

   1. WHICH UNITS. Pulled and dropped off, and nothing else — not a boat still
      in the water, not one already in a building, not a lead.
   2. WHAT WORK. The service lines, minus Storage, Retrieval, Misc, Discounts
      and Adjustments; open quote requests included and marked.
   3. NO MONEY. No amount, balance, deposit, contract, phone or email on any
      unit — the mechanic needs the job, not the bill.
   4. THE DOOR. No key configured answers nobody; a short key is no key; a
      wrong key of the right length is refused.

   Run by tools/verify.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
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
  decl('COL'), decl('PLACEMENT_STATES_'), decl('TRACKER_SKIP_SECS_'),
  decl('WINTERIZE_SECS_'), decl('WINTERIZE_STATES_'), fn('winterDoneOf_'), fn('winterizeStatusOf_'),
  fn('placementOf_'), fn('placementStateOf_'), fn('placementAlertOf_'),
  fn('effectiveState_'), fn('customerNoteOf_'),
  decl('TRACKER_STORAGE_LABELS_'), fn('isLandUnit_'), fn('trackerStorageOf_'),
  fn('trackerWorkOf_'), fn('trackerUnitOf_'), fn('trackerKeyOk_'),
  'return {trackerWorkOf_, trackerUnitOf_, trackerKeyOk_, winterizeStatusOf_, COL};'
].join('\n'))({ getScriptProperties: () => ({ getProperty: () => KEY }) });

let fails = 0;
const check = (l, c, d) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d ? '  — ' + d : '')); if (!c) fails++; };

const C = B.COL;
function row(qn) {
  const r = new Array(C.DIMS).fill('');
  r[C.QN - 1] = qn; r[C.LAST - 1] = 'White'; r[C.FIRST - 1] = 'John';
  r[C.UNIT - 1] = 'Boat'; r[C.YMM - 1] = '2019 Malibu 22 VLX'; r[C.DIMS - 1] = "22' x 8'6\"";
  r[C.BAL - 1] = 1234.5; r[C.PHONE - 1] = '8155550142'; r[C.EMAIL - 1] = 'x@example.com';
  return r;
}
function quote(state, extra) {
  return Object.assign({
    quoteNo: 'QW-26-1255', state: { slipNo: 'B-12', keyLoc: 'front desk' },
    placement: state === null ? undefined : { state: state, at: '2026-10-01T12:00:00Z', by: 'Jeff' },
    lines: [
      { sec: 'Engine winterization', label: 'Full service — Inboard', amt: 400 },
      { sec: 'Water systems', label: 'Ballast drain × 3 tanks', amt: 90 },
      { sec: 'Shrinkwrap', label: 'Shrinkwrap package (standard)', amt: 500 },
      { sec: 'Storage', label: 'Inside (non-heated) storage — on trailer', amt: 1800 },
      { sec: 'Retrieval', label: 'Retrieve, set & relaunch — included with inside storage', amt: 0 },
      { sec: 'Misc', label: 'Late retrieval surcharge', amt: 50 },
      { sec: 'Discounts', label: 'Heritage Harbor slipholder discount', amt: -100, hho: true },
      { sec: 'Adjustments', label: 'Courtesy credit', amt: -25 },
      { sec: 'Additional services', label: 'Bottom paint touch-up', amt: 225 }
    ],
    quotesRequested: 'Impeller change; Wash & wax',
    payments: [{ amt: 500 }], contractUrl: 'https://example.com/signed.pdf',
    placementAlert: { text: "owner says don't touch the canvas" },
    notes: 'Please check the bilge pump'
  }, extra || {});
}

console.log('=== 1. which units ===');
check('pulled is on the feed', !!B.trackerUnitOf_(row('A'), quote('pulled'), 'Inside'));
check('dropped off is on the feed', !!B.trackerUnitOf_(row('A'), quote('dropped'), 'Inside'));
check('still in the water is not', B.trackerUnitOf_(row('A'), quote(''), 'Inside') === null);
check('nothing recorded is not', B.trackerUnitOf_(row('A'), quote(null), 'Inside') === null);
check('stored with winterization still pending IS — it is the boat that most needs a mechanic',
  !!B.trackerUnitOf_(row('A'), quote('stored'), 'Inside'));
check('stored and fully winterized is not',
  B.trackerUnitOf_(row('A'), quote('stored', { winterWork: { done: [
    { label: 'Full service — Inboard' }, { label: 'Ballast drain × 3 tanks' }] } }), 'Inside') === null);
check('stored with no winterization on the quote is not',
  B.trackerUnitOf_(row('A'), quote('stored', { lines: [{ sec: 'Shrinkwrap', label: 'Wrap', amt: 1 }] }), 'Inside') === null);
check('an unknown state is not', B.trackerUnitOf_(row('A'), quote('launched'), 'Inside') === null);
check('the pre-rename d.yard still counts',
  !!B.trackerUnitOf_(row('A'), quote(null, { yard: { state: 'pulled', at: 'x' } }), 'Inside'));
check('a lead tab is left out of the read', /isOffstageTab_\(sh\.getName\(\)\)/.test(fn('trackerFeed_')));

console.log('\n=== 2. what work ===');
{
  const u = B.trackerUnitOf_(row('QW-26-1255'), quote('pulled'), 'Inside');
  const labels = u.work.map((w) => w.label);
  check('winterization is there', labels.includes('Full service — Inboard'));
  check('water systems and shrinkwrap are there', labels.includes('Ballast drain × 3 tanks') && labels.includes('Shrinkwrap package (standard)'));
  check('a staff-priced request is there', labels.includes('Bottom paint touch-up'));
  check('storage, retrieval, misc, discounts, adjustments are not',
    !labels.some((l) => /storage —|Retrieve|surcharge|discount|credit/i.test(l)), JSON.stringify(labels));
  const rq = u.work.filter((w) => w.requested).map((w) => w.label);
  check('open quote requests are there and marked', rq.join('|') === 'Impeller change|Wash & wax', JSON.stringify(rq));
  check('the alert and the customer note cross', u.alert === "owner says don't touch the canvas" && u.cnote === 'Please check the bilge pump');
  check('slip and keys come off the effective state', u.slip === 'B-12' && u.keys === 'front desk');
  const m = B.trackerUnitOf_(row('A'), quote('pulled', { manual: { measured: { keyLoc: 'lockbox 4' } } }), 'Inside');
  check('a staff correction to the keys wins', m.keys === 'lockbox 4', m.keys);
  check('no duplicate labels', new Set(labels).size === labels.length);
  check('a quote with no lines has no work, not a crash',
    B.trackerUnitOf_(row('A'), { placement: { state: 'dropped' } }, 'X').work.length === 0);
}

console.log('\n=== 2b. winterize pending ===');
{
  const s = B.winterizeStatusOf_(quote('pulled'));
  check('engines and water systems are winterization', s && s.total === 2 &&
    s.pending.join('|') === 'Full service — Inboard|Ballast drain × 3 tanks', JSON.stringify(s));
  const labels = B.trackerWorkOf_(quote('pulled')).filter((w) => w.winterize).map((w) => w.label);
  check('shrinkwrap, extras and requests are not', !labels.some((l) => /Shrinkwrap|Bottom|Impeller|Wash/.test(l)), JSON.stringify(labels));
  const one = B.winterizeStatusOf_(quote('dropped', { winterWork: { done: [{ label: 'Full service — Inboard', by: 'Dale' }] } }));
  check('a tick takes that item off the pending list', one.pending.join('|') === 'Ballast drain × 3 tanks');
  const all = B.winterizeStatusOf_(quote('pulled', { winterWork: { done: [
    { label: 'Full service — Inboard' }, { label: 'Ballast drain × 3 tanks' }] } }));
  check('the last tick clears it', all && all.pending.length === 0);
  check('ticks on other work do not clear it',
    B.winterizeStatusOf_(quote('pulled', { winterWork: { done: [{ label: 'Shrinkwrap package (standard)' }] } })).pending.length === 2);
  check('a boat still in the water has no winterize alert', B.winterizeStatusOf_(quote('')) === null);
  check('nor one with nothing recorded', B.winterizeStatusOf_(quote(null)) === null);
  check('a stored boat keeps it until it is done', B.winterizeStatusOf_(quote('stored')).pending.length === 2);
  check('a quote with no winterization has none',
    B.winterizeStatusOf_(quote('pulled', { lines: [{ sec: 'Shrinkwrap', label: 'Wrap', amt: 1 }] })) === null);
  check('it never touches the typed alert', !/placementAlert/.test(fn('winterizeStatusOf_') + fn('trackerSetTicks_')));
  check('the ticks survive a customer save',
    /if \(oldD\.winterWork\) d\.winterWork = oldD\.winterWork;/.test(gas));
  check('the ticks endpoint is behind the key',
    /trackerKeyOk_[\s\S]*winterTicks[\s\S]*trackerSetTicks_/.test(fn('trackerServe_')));
  check('a tick write is payload only — no status, no re-price, no PDF',
    !/savePdf_|recomputeTotals_|rebuildLinesFromState_|COL\.STATUS/.test(fn('trackerSetTicks_')));
  check('the storage row and the lookup carry it as its own field',
    /winter: winter,/.test(fn('storageViewBuild_')) && /winter: winterizeStatusOf_\(d\)/.test(fn('adminLookup')));
}

console.log('\n=== 2c. Harbor Haul Out draws it apart from the alert ===');
{
  const app = fs.readFileSync(path.join(ROOT, 'harbor-haul-out/index.html'), 'utf8');
  const script = app.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/) || app.match(/<script>([\s\S]*)<\/script>/);
  const body = new Function('esc', script[1].match(/function winterize_\(x\)\{[\s\S]*?\n\}/)[0] + '; return winterize_;')(
    (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
  check('a row with winterization pending gets its own strip',
    /class="winterize"/.test(body({ winter: { total: 2, pending: ['a', 'b'] } })) &&
    /2 of 2 not done/.test(body({ winter: { total: 2, pending: ['a', 'b'] } })));
  check('nothing at all when none is pending', body({ winter: { total: 2, pending: [] } }) === '' && body({}) === '' && body({ winter: null }) === '');
  check('the row draws both strips, alert first', /alert_\(x\)\+winterize_\(x\)/.test(app));
  check('the opened unit has its own place for it, beside the alert', /<div id="dAlert"><\/div>\s*<div id="dWinter"><\/div>/.test(app));
  check('it is not styled as the alert', /\.winterize\{/.test(app) && !/function winterize_[\s\S]*?class="alert"/.test(app.match(/function winterize_\(x\)\{[\s\S]*?\n\}/)[0]));
  check('and the app offers no way to clear it', !/api\('winterTicks'|winterTicks/.test(app));
}

console.log('\n=== 2d. the staff console shows it too, and cannot change it ===');
{
  const con = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');
  check('the storage view row draws it after the alert, as its own strip', /\$\{al\}\$\{wz\}/.test(con) && /class="winterbox"/.test(con));
  check('the quote has a read-only Winterization card', /id="winterCard"/.test(con) && /renderWinterCard\(r\.winter\|\|null\)/.test(con));
  check('the printed storage sheet carries it, apart from the alert', /class="pwinter"/.test(con));
  check('nothing on the console sends ticks', !/winterTicks/.test(con));
  const fnSrc = con.match(/function renderWinterCard\(w\)\{[\s\S]*?\n\}/)[0];
  check('the card never reads or writes the alert', !/_alert|placementAlert/.test(fnSrc));
}

console.log('\n=== 2e. going into storage, and where ===');
{
  const at = (tab, extra) => B.trackerUnitOf_(row('A'), quote('pulled', extra), tab);
  const inside = at('Inside', { state: { slipNo: 'B-12', keyLoc: 'front desk', hasTrailer: true } });
  check('a unit on a storage tab is going into storage, and says where',
    inside.storing === true && inside.storageLabel === 'Inside (non-heated)', JSON.stringify([inside.storing, inside.storageLabel]));
  check('and how it sits', inside.storageHow === 'On its trailer');
  const blocked = at('Outside', { state: { hasTrailer: false } });
  check('a boat off its trailer says so', blocked.storageLabel === 'Outside' && /blocked/.test(blocked.storageHow));
  check('premium inside is named as such', at('Premium Inside').storageLabel === 'Premium inside');
  const none = at('No Storage');
  check('No Storage is NOT going into storage', none.storing === false && /Not going into storage/.test(none.storageLabel));
  check('an unknown trailer answer says nothing rather than guess', at('Inside', { state: {} }).storageHow === '');
  const cart = B.trackerUnitOf_(row('A'), quote('dropped', { unit: 'Golf cart', state: { hasTrailer: false } }), 'Golf Cart');
  check('a land unit gets its area and no trailer talk', cart.storing && cart.storageLabel === 'Golf cart storage' && cart.storageHow === '');
  check('a staff move wins over the customer: the tab, not their answer, is read',
    /trackerStorageOf_\(tab, pd, st\)/.test(fn('trackerUnitOf_')));
}

console.log('\n=== 2f. the walk-in menu comes from the engine ===');
{
  const engA = gas.indexOf('// ENGINE-START'), engB = gas.indexOf('// ENGINE-END');
  const M = new Function([gas.slice(engA, engB), decl('WINTERIZE_SECS_'), decl('TRACKER_MENU_SKIP_'), fn('trackerMenu_'),
    'return { menu: trackerMenu_(), SERVICE_MENU, BOAT_ENGINES };'].join('\n'))();
  const m = M.menu;
  check('full and basic, with the steps for each', m.levels.map((l) => l.id).join() === 'basic,full' &&
    m.levels.every((l) => l.steps && l.stepsPwc) && /oil/.test(m.levels[1].steps));
  check('every boat engine type, plus PWC', M.BOAT_ENGINES.every((e) => m.engines.some((x) => x.id === e.id)) &&
    m.engines.some((x) => x.id === 'pwc' && x.pwc));
  const keys = m.services.map((x) => x.key);
  check('every service on the winter menu but retrieval and the in-water wrap',
    M.SERVICE_MENU.filter((x) => x.key !== 'retrieval' && x.key !== 'inWater').every((x) => keys.includes(x.key)) &&
    !keys.includes('retrieval') && !keys.includes('inWater'), keys.join());
  check('water systems and drive train are marked winterization, shrinkwrap is not',
    m.services.find((x) => x.key === 'ballast').winterize && m.services.find((x) => x.key === 'dtTrans').winterize &&
    !m.services.find((x) => x.key === 'wrap').winterize);
  check('no prices on it', !/\$|price|perFt|amt/i.test(JSON.stringify(m)));
  check('it is behind the key like the rest', /'menu'\) out = trackerMenu_\(\)/.test(fn('trackerServe_')));
}

console.log('\n=== 2g. No Storage units leave Harbor Haul Out once done ===');
{
  const D = new Function([decl('PLACEMENT_STATES_'), fn('hhoDone_'), 'return hhoDone_;'].join('\n'))();
  const pend = { total: 2, pending: ['Full service — Inboard'] };
  const clear = { total: 2, pending: [] };
  check('still in the water: stays, it has to be pulled', D(true, '', null) === false);
  check('pulled with winterization pending: stays', D(true, 'pulled', pend) === false);
  check('pulled and winterized: gone', D(true, 'pulled', clear) === true);
  check('dropped off with nothing to winterize: gone', D(true, 'dropped', null) === true);
  check('picked up: gone', D(true, 'pickedup', clear) === true);
  check('a unit with storage is never hidden', D(false, 'pulled', clear) === false && D(false, 'stored', null) === false);
  check('an unknown state is not hidden — it falls to a real list', D(true, 'launched', clear) === false);
  check('the storage row carries it', /hhoDone: hhoDone_\(noStore, placementState, winter\)/.test(fn('storageViewBuild_')));
  const app = fs.readFileSync(path.join(ROOT, 'harbor-haul-out/index.html'), 'utf8');
  check('Harbor Haul Out leaves those rows out', /if\(x\.hhoDone\) return;/.test(app));
  const con = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8');
  check('the console does not — that is where they are found for pickup', !/hhoDone/.test(con));
}

console.log('\n=== 3. no money ===');
{
  const u = B.trackerUnitOf_(row('A'), quote('pulled'), 'Inside');
  const text = JSON.stringify(u);
  check('no amounts on the work', u.work.every((w) => !('amt' in w)));
  ['1234', '500', '1800', 'signed.pdf', '8155550142', 'example.com', 'balance', 'deposit', 'contract', 'phone', 'email', 'paid']
    .forEach((bad) => check('nothing says ' + bad, text.toLowerCase().indexOf(bad.toLowerCase()) === -1));
}

console.log('\n=== 4. the door ===');
KEY = '';
check('no key configured refuses every caller', !B.trackerKeyOk_('') && !B.trackerKeyOk_('anything'));
KEY = 'short-key';
check('a short key is no key', !B.trackerKeyOk_('short-key'));
KEY = 'k'.repeat(40);
check('the right key opens it', B.trackerKeyOk_('k'.repeat(40)));
check('a wrong key of the same length does not', !B.trackerKeyOk_('k'.repeat(39) + 'x'));
check('a wrong length does not', !B.trackerKeyOk_('k'.repeat(41)));
check('doPost routes it before the quote save',
  gas.indexOf("if (d.api === 'tracker') return trackerServe_(d);") > 0 &&
  gas.indexOf("if (d.api === 'tracker')") < gas.indexOf('const postedTab = d.storageTab'));
check('trackerServe_ checks the key before anything else',
  /if \(!trackerKeyOk_\(p && p\.key\)\)/.test(fn('trackerServe_')));
check('the feed writes nothing',
  !/setValue|setValues|appendRow|deleteRow|savePdf_|recomputeTotals_|auditLog_/.test(fn('trackerFeed_') + fn('trackerUnitOf_') + fn('trackerServe_')));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall good');
process.exit(fails ? 1 : 0);
