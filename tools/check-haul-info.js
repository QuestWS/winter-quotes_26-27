#!/usr/bin/env node
/* Execute the key-location / slip-number rules and assert what comes out.
   ---------------------------------------------------------------------------
   Two things here are properties of the code rather than of any string, so a
   grep cannot check them:

   1. WHO GETS ASKED. The haul-out "you're up next" email chases missing info.
      Asking an e-bike owner where the keys will be, or a customer whose boat is
      on its own trailer which slip it is in, reads as a form letter and erodes
      the emails that do matter. missingHaulInfo_ is run over every combination
      here instead of trusted.

   2. WHETHER A STAFF ENTRY SURVIVES. Key location and slip number live in the
      customer's browser too, and it re-posts them on every save. If they were
      written into d.state, the customer's next save would silently undo the
      correction -- the same trap the dimension editor already avoids. This
      drives a real customer re-save and checks the staff value is still there.

   Run by tools/verify.sh. */
'use strict';
const fs=require('fs'); const {execSync}=require('child_process');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const gas=fs.readFileSync(path.join(ROOT,'quote-logger-apps-script.gs'),'utf8');
const engA=gas.indexOf('// ENGINE-START'), engB=gas.indexOf('// ENGINE-END');
function fn(n){
  const one=gas.match(new RegExp('^function '+n+'\\b.*}\\s*$','m'));
  if(one) return one[0];
  const m=gas.match(new RegExp('^function '+n+'\\b[\\s\\S]*?\\n}','m'));
  if(!m) throw new Error('missing '+n); return m[0];
}
const decl=(n)=>gas.match(new RegExp('^const '+n+'\\s*=[\\s\\S]*?;\\s*$','m'))[0];

const B=new Function([
  gas.slice(engA,engB),
  'function esc_(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',
  'const ADJ_CC_PCT=3, ADJ_LATE_PCT=10;',
  'function usd_(n){n=Number(n||0);return "$"+Math.abs(n).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g,",").replace(/^/, n<0?"-":"");}',
  decl('KEYFIELDS_'),
  fn('sanitizeKeys_'), fn('effectiveState_'), fn('isLandUnit_'), fn('isBike_'),
  fn('missingHaulInfo_'), fn('serverPrice_'), fn('linesTotal_'),
  fn('rebuildLinesFromState_'), fn('ensureManual_'), fn('applyManualOps_'),
  fn('recomputeTotals_'), fn('paymentsTotal_'),
  'return {sanitizeKeys_,effectiveState_,missingHaulInfo_,rebuildLinesFromState_,ensureManual_,applyManualOps_,computeQuote};'
].join('\n'))();

const states=JSON.parse(execSync('node tools/price-fixtures.js --dump-states',{cwd:ROOT,maxBuffer:1e8}));
const P=require(path.join(ROOT,'pricing-engine.js'));
function quoteFrom(name,extra){
  const state=JSON.parse(JSON.stringify(states.find(s=>s.name===name).state));
  const r=P.computeQuote(state);
  const lines=r.lines.map(l=>({sec:l.sec,label:l.label,calc:l.calc||'',amt:Number(l.amt||0),desc:l.desc||''}));
  return Object.assign({quoteNo:'QW-26-TEST',unit:'Boat',depositBase:500,state,lines,
    total:lines.reduce((a,b)=>a+b.amt,0).toFixed(2),
    keyLoc:state.keyLoc||'',slipNo:state.slipNo||'',payments:[]},extra||{});
}
let fails=0;
const check=(l,c,d)=>{console.log('  '+(c?'PASS':'FAIL')+'  '+l+(d?'  — '+d:''));if(!c)fails++;};

console.log('=== 1. sanitiser ===');
{
  const r=B.sanitizeKeys_({keyLoc:'  in the   glove box ',slipNo:'B-14'});
  check('trims and collapses whitespace', r.set.keyLoc==='in the glove box', JSON.stringify(r.set));
  const c=B.sanitizeKeys_({keyLoc:'',slipNo:'B-14'});
  check('blank means CLEAR, not empty-string override', c.clear.indexOf('keyLoc')>-1 && c.set.keyLoc===undefined);
  const n=B.sanitizeKeys_({slipNo:'A-1'});
  check('a field not offered is left alone', n.set.keyLoc===undefined && n.clear.indexOf('keyLoc')<0);
  let threw=false; try{B.sanitizeKeys_({keyLoc:'x'.repeat(200)});}catch(e){threw=true;}
  check('absurdly long value refused', threw);
  const inj=B.sanitizeKeys_({keyLoc:'<script>alert(1)</script>'});
  check('no HTML stripping here (escaping is the email\'s job)', inj.set.keyLoc.indexOf('<script>')===0);
}

console.log('\n=== 2. a staff entry survives the customer re-saving their quote ===');
{
  const d=quoteFrom('boat-twin-inboard-full');
  d.state.keyLoc='wherever'; d.keyLoc='wherever';
  const m=B.ensureManual_(d);
  m.measured=Object.assign({},m.measured||{},B.sanitizeKeys_({keyLoc:'front desk',slipNo:'B-14'}).set);
  B.rebuildLinesFromState_(d); B.applyManualOps_(d);
  check('effective state shows the staff value', B.effectiveState_(d).keyLoc==='front desk');
  check('top-level synced for the sheet/emails', d.keyLoc==='front desk', 'd.keyLoc='+d.keyLoc);
  check('slip synced too', d.slipNo==='B-14', 'd.slipNo='+d.slipNo);

  // the customer reloads and re-saves: their browser posts their own values
  d.state.keyLoc='wherever'; d.state.slipNo='';
  B.rebuildLinesFromState_(d); B.applyManualOps_(d);
  check('customer re-save does NOT erase it', d.keyLoc==='front desk' && d.slipNo==='B-14',
    'keys='+d.keyLoc+' slip='+d.slipNo);
}

console.log('\n=== 3. clearing falls back to what the customer told us ===');
{
  const d=quoteFrom('boat-twin-inboard-full');
  d.state.keyLoc='on the seat';
  const m=B.ensureManual_(d);
  m.measured={keyLoc:'front desk'};
  B.rebuildLinesFromState_(d);
  check('override in force', d.keyLoc==='front desk');
  const c=B.sanitizeKeys_({keyLoc:''});
  c.clear.forEach(k=>delete m.measured[k]);
  B.rebuildLinesFromState_(d);
  check('cleared -> customer value returns', d.keyLoc==='on the seat', 'd.keyLoc='+d.keyLoc);
}

console.log('\n=== 3b. an empty state value must never wipe a top-level one ===');
{
  /* Older payloads carry a key location at the top level that never made it
     into `state`. A customer save re-runs the rebuild; if that copied the empty
     state value over the top, the only record of where the keys are would be
     silently lost. Found by the save-path fixture, kept here permanently. */
  const d=quoteFrom('boat-twin-inboard-full');
  d.state.keyLoc=''; d.state.slipNo='';
  d.keyLoc='With unit'; d.slipNo='B-14';
  B.rebuildLinesFromState_(d);
  check('top-level key location survives an empty state', d.keyLoc==='With unit', 'd.keyLoc='+JSON.stringify(d.keyLoc));
  check('top-level slip survives an empty state', d.slipNo==='B-14', 'd.slipNo='+JSON.stringify(d.slipNo));
  /* ...but a real value in the state still wins, or a staff correction would
     never reach the sheet. */
  B.ensureManual_(d).measured={keyLoc:'front desk'};
  B.rebuildLinesFromState_(d);
  check('a real value still upgrades it', d.keyLoc==='front desk', 'd.keyLoc='+d.keyLoc);
}

console.log('\n=== 4. what counts as missing ===');
/* Owning a trailer says NOTHING about where the boat is: Heritage Harbor
   customers routinely store the trailer with us and keep the boat in a slip all
   season. Gating the slip question on hasTrailer hid it from exactly the people
   most likely to have one, so the trailer flag must not change the answer —
   these cases are paired on/off to hold that. */
const cases=[
  ['boat, nothing known, no trailer',     {unit:'Boat'},      {hasTrailer:false,keyLoc:'',slipNo:''},   ['keys','slip']],
  ['boat, nothing known, HAS a trailer',  {unit:'Boat'},      {hasTrailer:true,keyLoc:'',slipNo:''},    ['keys','slip']],
  ['boat, keys known, no trailer',        {unit:'Boat'},      {hasTrailer:false,keyLoc:'desk',slipNo:''},['slip']],
  ['boat, keys known, HAS a trailer',     {unit:'Boat'},      {hasTrailer:true,keyLoc:'desk',slipNo:''}, ['slip']],
  ['boat fully known',                    {unit:'Boat'},      {hasTrailer:false,keyLoc:'desk',slipNo:'B-1'},[]],
  ['boat fully known, HAS a trailer',     {unit:'Boat'},      {hasTrailer:true,keyLoc:'desk',slipNo:'B-1'},[]],
  ['jet ski in the water',                {unit:'Jet ski'},   {hasTrailer:false,keyLoc:'',slipNo:''},   ['keys','slip']],
  ['jet ski with a trailer',              {unit:'Jet ski'},   {hasTrailer:true,keyLoc:'',slipNo:''},    ['keys','slip']],
  ['golf cart (land: keys, never a slip)',{unit:'Golf cart'}, {hasTrailer:false,keyLoc:'',slipNo:''},   ['keys']],
  ['e-bike (no keys, no slip, ever)',     {unit:'E-bike'},    {hasTrailer:false,keyLoc:'',slipNo:''},   []],
  ['whitespace is not a key location',    {unit:'Boat'},      {hasTrailer:true,keyLoc:'   ',slipNo:'B-1'}, ['keys']],
  ['whitespace is not a slip number',     {unit:'Boat'},      {hasTrailer:true,keyLoc:'desk',slipNo:'  '}, ['slip']],
];
for(const [label,base,st,want] of cases){
  const d=Object.assign({state:Object.assign({unit:'boat'},st)},base);
  const got=B.missingHaulInfo_(d);
  check(label, JSON.stringify(got)===JSON.stringify(want), 'got ['+got+'] want ['+want+']');
}

console.log('\n=== 5. the slip number reaches the Heritage Harbor line ===');
{
  const d=quoteFrom('boat-twin-inboard-full');
  d.state.hho=true; d.state.slipNo='';
  B.rebuildLinesFromState_(d);
  const before=(d.lines.find(l=>/Heritage Harbor/i.test(l.label))||{}).label||'(no hho line)';
  B.ensureManual_(d).measured={slipNo:'B-14'};
  B.rebuildLinesFromState_(d);
  const after=(d.lines.find(l=>/Heritage Harbor/i.test(l.label))||{}).label||'(no hho line)';
  console.log('    '+before+'\n    '+after);
  check('label picks up the slip', /B-14/.test(after));
}

console.log('\n=== 6. pricing is untouched by a keys edit ===');
{
  const d=quoteFrom('boat-twin-inboard-full');
  B.rebuildLinesFromState_(d); B.applyManualOps_(d);
  const before=Number(d.total);
  B.ensureManual_(d).measured={keyLoc:'front desk',slipNo:'B-14'};
  B.rebuildLinesFromState_(d); B.applyManualOps_(d);
  check('total unmoved', Math.abs(Number(d.total)-before)<0.005, before.toFixed(2)+' -> '+Number(d.total).toFixed(2));
}
console.log(fails?fails+' haul-info violation(s)':'haul info holds: only the applicable question is asked, and a staff entry survives the customer re-saving');
process.exit(fails?1:0);
