#!/usr/bin/env node
/* Execute the keys permission and the automatic-email pause.
   ---------------------------------------------------------------------------
   Two rules here decide whether the system talks to customers, and neither can
   be checked by grepping:

   1. WHO CAN RECORD KEYS AND SLIPS. The permission was added after the roster
      was written, so no existing staff record has a `keys` field. Whether the
      crew can actually use the card today depends on the fallback, not on
      the permission's existence — so the real roster is run through it.

   2. WHICH WAY A BROKEN PAUSE FAILS. An unreadable setting must stop the
      automatic sends, never release them. Failing the other way turns a
      corrupt property into an unannounced mailshot.

   Run by tools/verify.sh. */
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const gas=fs.readFileSync(ROOT+'/quote-logger-apps-script.gs','utf8');
function fn(n){
  const o=gas.match(new RegExp('^function '+n+'\\b.*}\\s*$','m'));
  if(o) return o[0];
  const m=gas.match(new RegExp('^function '+n+'\\b[\\s\\S]*?\\n}','m'));
  if(!m) throw new Error('missing '+n); return m[0];
}
let store={};
const PropertiesService={getScriptProperties:()=>({
  getProperty:k=>(k in store?store[k]:null),
  setProperty:(k,v)=>{store[k]=v;},
  deleteProperty:k=>{delete store[k];}})};

const B=new Function('PropertiesService',[
  fn('canKeys_'), fn('canMeasure_'), fn('resolvedPerms_'),
  "const AUTO_PAUSE_KEY_='AUTO_EMAIL_PAUSED';",
  fn('autoPauseState_'), fn('autoEmailsPaused_'), fn('autoPauseCooldown_'),
  'return {canKeys_,canMeasure_,resolvedPerms_,autoPauseState_,autoEmailsPaused_,autoPauseCooldown_};'
].join('\n'))(PropertiesService);

let fails=0;
const check=(l,c,d)=>{console.log('  '+(c?'PASS':'FAIL')+'  '+l+(d?'  — '+d:''));if(!c)fails++;};

console.log("=== 1. who can edit keys & slip, on TODAY'S roster (no `keys` field yet) ===");
/* The live roster predates the permission, so nobody has a `keys` field. These
   are the real people and their real current permissions. */
const roster={
  Chris:  {admin:true,  perms:{pay:1,adjust:1,email:1,photos:1}},
  Jeff:   {admin:true,  perms:{pay:1,adjust:1,email:1,photos:1}},
  John:   {admin:false, perms:{pay:1,adjust:0,email:1,photos:1}},
  Rex:    {admin:false, perms:{pay:1,adjust:0,email:1,photos:1}},
  Jess:   {admin:false, perms:{pay:1,adjust:0,email:1,photos:1}},
  Marina: {admin:false, perms:{pay:0,adjust:0,email:0,photos:1}},
};
const want={Chris:true,Jeff:true,John:true,Rex:true,Jess:true,Marina:false};
for(const n of Object.keys(roster)) check(n.padEnd(7)+' can edit keys', B.canKeys_(roster[n])===want[n], 'got '+B.canKeys_(roster[n])+' want '+want[n]);

console.log('\n=== 2. an explicit setting always beats the fallback ===');
check('Marina can be granted it',       B.canKeys_({admin:false,perms:{photos:1,keys:1}})===true);
check('John can be denied it',          B.canKeys_({admin:false,perms:{pay:1,keys:0}})===false);
check('an admin cannot be locked out',  B.canKeys_({admin:true,perms:{keys:0}})===true);
check('0 as a string is still OFF',     B.canKeys_({admin:false,perms:{pay:1,keys:'0'}})===false);
check('empty string falls back',        B.canKeys_({admin:false,perms:{pay:1,keys:''}})===true);
check('nobody at all',                  B.canKeys_(null)===false);

console.log('\n=== 2b. who can re-measure, on TODAY\'S roster (no `measure` field yet) ===');
/* A re-measure re-prices the quote, so it is its own permission rather than
   riding on `adjust` — adjusting is inventing a charge, measuring is reading a
   tape over a hull, and they deserve different answers.

   It shipped falling back to `adjust`, which meant the only people who could
   correct a dimension were the two admins who never hold the tape. Chris then
   said plainly: give it to John, Rex and Jess. So the fallback is `canKeys_`
   — whoever can already record harbor facts can correct a measurement — and it
   stops exactly where `keys` stops. Marina has neither.

   These are the real people and their real current permissions. Nobody has a
   `measure` field yet, so every line here is the fallback answering. */
const wantM={Chris:true,Jeff:true,John:true,Rex:true,Jess:true,Marina:false};
for(const n of Object.keys(roster))
  check(n.padEnd(7)+' can re-measure', B.canMeasure_(roster[n])===wantM[n],
        'got '+B.canMeasure_(roster[n])+' want '+wantM[n]);
check('it lands on exactly the people who can record harbor facts',
      Object.keys(roster).every(n=>B.canMeasure_(roster[n])===B.canKeys_(roster[n])));
check('photos alone still buys nothing',
      B.canMeasure_({admin:false,perms:{photos:1}})===false);
check('granting `measure` is enough on its own',
      B.canMeasure_({admin:false,perms:{photos:1,measure:1}})===true);
check('and it can be taken away from somebody who could record harbor facts',
      B.canMeasure_({admin:false,perms:{keys:1,measure:0}})===false);
check('0 as a string is still OFF',  B.canMeasure_({admin:false,perms:{keys:1,measure:'0'}})===false);
check('empty string falls back',     B.canMeasure_({admin:false,perms:{keys:1,measure:''}})===true);
check('an admin cannot be locked out',B.canMeasure_({admin:true,perms:{measure:0}})===true);
check('nobody at all',               B.canMeasure_(null)===false);

console.log('\n=== 3. the console is told the resolved answer ===');
for(const n of ['John','Marina']){
  const p=B.resolvedPerms_(roster[n]);
  check(n+' resolvedPerms_.keys matches canKeys_', !!p.keys===want[n], JSON.stringify(p));
  check(n+' resolvedPerms_.measure matches canMeasure_', !!p.measure===wantM[n], JSON.stringify(p));
}
check('other permissions survive untouched',
  JSON.stringify(B.resolvedPerms_(roster.Marina))===JSON.stringify({pay:0,adjust:0,email:0,photos:1,keys:0,measure:0}));
check('and the crew resolve as able to re-measure',
  JSON.stringify(B.resolvedPerms_(roster.John))===JSON.stringify({pay:1,adjust:0,email:1,photos:1,keys:1,measure:1}));

console.log('\n=== 4. the pause ===');
store={};
check('unset means running',            B.autoEmailsPaused_()===false);
store['AUTO_EMAIL_PAUSED']=JSON.stringify({on:true,reason:'pricing',by:'Chris',at:'now'});
check('set means paused',               B.autoEmailsPaused_()===true);
check('reason/by/at survive',           B.autoPauseState_().reason==='pricing'&&B.autoPauseState_().by==='Chris');
store['AUTO_EMAIL_PAUSED']=JSON.stringify({on:false,reason:'',by:'Chris',at:'now'});
check('explicitly off means running',   B.autoEmailsPaused_()===false);
store['AUTO_EMAIL_PAUSED']='{not json at all';
check('CORRUPT setting = paused',       B.autoEmailsPaused_()===true, 'must fail towards sending nothing');
store['AUTO_EMAIL_PAUSED']='';
check('empty string means running',     B.autoEmailsPaused_()===false);

/* ===================================================================
   5. LIFTING THE PAUSE RESTARTS THE CLOCKS.
   -------------------------------------------------------------------
   The case this exists for: the rate card lands, the season is re-priced,
   everybody is emailed their real quote, and the pause comes off. Without
   the cooldown the next 9am sweep sends a reminder to every quote whose ten
   days elapsed during the pause — so the customer reads "here is your
   updated quote" and then "your quote is still waiting" about the same one.
   =================================================================== */
console.log('\n=== 5. lifting the pause restarts the 10-day clock ===');
const DAY=24*60*60*1000, TEN=10*DAY, DAYMS=DAY;
const iso=ms=>new Date(Date.now()-ms).toISOString();
store={};
check('never paused = no cooldown',     B.autoPauseCooldown_(TEN)==='');
store['AUTO_EMAIL_PAUSED']=JSON.stringify({on:false,resumedAt:iso(0)});
check('just resumed = held',            B.autoPauseCooldown_(TEN)!=='');
check('and it says when it lifts',      /nothing automatic goes out before/.test(B.autoPauseCooldown_(TEN)));
store['AUTO_EMAIL_PAUSED']=JSON.stringify({on:false,resumedAt:iso(9*DAY)});
check('9 days after resuming = still held', B.autoPauseCooldown_(TEN)!=='');
check('but the 24h lead window has passed', B.autoPauseCooldown_(DAYMS)==='');
store['AUTO_EMAIL_PAUSED']=JSON.stringify({on:false,resumedAt:iso(11*DAY)});
check('11 days after resuming = running',   B.autoPauseCooldown_(TEN)==='');
store['AUTO_EMAIL_PAUSED']=JSON.stringify({on:false,resumedAt:'not a date'});
check('an unreadable resume stamp never silences a reminder', B.autoPauseCooldown_(TEN)==='',
      'the pause already fails towards silence; this guard must not');
store['AUTO_EMAIL_PAUSED']=JSON.stringify({on:true,reason:'rate card',by:'Chris',at:'now',resumedAt:iso(30*DAY)});
check('paused again = the old resume stamp is irrelevant', B.autoEmailsPaused_()===true);
check('and resumedAt still round-trips', B.autoPauseState_().resumedAt!=='');

/* ===================================================================
   6. AND ONLY A REAL RESUME RESTARTS THEM.
   -------------------------------------------------------------------
   Run the real adminSetAutoPause against the fake property store. The
   transitions are the subtle part: clicking "resume" on something already
   running must not buy another ten days of silence, and starting a pause must
   clear the last resume rather than leave a stale stamp to expire mid-pause.
   =================================================================== */
console.log('\n=== 6. only a real pause -> running restarts the clocks ===');
{
  const notices=[];
  const S=new Function('PropertiesService','requireAuth_','auditLog_','MailApp','NOTIFY',
    'REMINDER_AFTER_DAYS','LEAD_FOLLOWUP_AFTER_HOURS','console',[
      "const AUTO_PAUSE_KEY_='AUTO_EMAIL_PAUSED';",
      fn('autoPauseState_'), fn('autoPauseCooldown_'), fn('adminSetAutoPause'),
      'return adminSetAutoPause;'
    ].join('\n'))(PropertiesService, ()=>({name:'Chris',admin:true}), ()=>{},
      {sendEmail:(to,subj,body)=>notices.push(body)}, 'x@y.z', 10, 24, console);

  store={};
  let r=S('t', true, 'rate card');            // start a pause
  check('pausing stores no resume stamp',     r.resumedAt==='');
  r=S('t', false, '');                        // lift it
  check('lifting it stamps the resume',       !!r.resumedAt && !isNaN(Date.parse(r.resumedAt)));
  check('and the notice says the clocks restart',
        /clocks restart from now/.test(notices[notices.length-1]||''));
  const stamped=r.resumedAt;
  r=S('t', false, '');                        // "resume" again, already running
  check('resuming twice does not extend the silence', r.resumedAt===stamped);
  r=S('t', true, 'again');                    // pause again
  check('a new pause clears the old stamp',   r.resumedAt==='');
  check('and its notice does not promise a restart',
        !/clocks restart from now/.test(notices[notices.length-1]||''));
}

console.log(fails?fails+' permission/pause violation(s)':'permissions and pause hold: crew can record keys, a broken pause stops sending, and lifting it restarts the clocks');
process.exit(fails?1:0);
