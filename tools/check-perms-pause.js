#!/usr/bin/env node
/* Execute the keys permission and the automatic-email pause.
   ---------------------------------------------------------------------------
   Two rules here decide whether the system talks to customers, and neither can
   be checked by grepping:

   1. WHO CAN RECORD KEYS AND SLIPS. The permission was added after the roster
      was written, so no existing staff record has a `keys` field. Whether the
      yard crew can actually use the card today depends on the fallback, not on
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
  fn('canKeys_'), fn('resolvedPerms_'),
  "const AUTO_PAUSE_KEY_='AUTO_EMAIL_PAUSED';",
  fn('autoPauseState_'), fn('autoEmailsPaused_'),
  'return {canKeys_,resolvedPerms_,autoPauseState_,autoEmailsPaused_};'
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

console.log('\n=== 3. the console is told the resolved answer ===');
for(const n of ['John','Marina']){
  const p=B.resolvedPerms_(roster[n]);
  check(n+' resolvedPerms_.keys matches canKeys_', !!p.keys===want[n], JSON.stringify(p));
}
check('other permissions survive untouched',
  JSON.stringify(B.resolvedPerms_(roster.Marina))===JSON.stringify({pay:0,adjust:0,email:0,photos:1,keys:0}));

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

console.log(fails?fails+' permission/pause violation(s)':'permissions and pause hold: yard crew can record keys, a broken pause stops sending');
process.exit(fails?1:0);
