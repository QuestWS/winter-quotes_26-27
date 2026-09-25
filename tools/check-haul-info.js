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
  fn('missingHaulInfo_'), fn('needsTrailerLoc_'), fn('serverPrice_'), fn('linesTotal_'),
  fn('rebuildLinesFromState_'), fn('ensureManual_'), fn('applyManualOps_'),
  fn('recomputeTotals_'), fn('paymentsTotal_'),
  'return {sanitizeKeys_,effectiveState_,missingHaulInfo_,needsTrailerLoc_,rebuildLinesFromState_,ensureManual_,applyManualOps_,computeQuote};'
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

console.log('\n=== 5. the slip number reaches the Heritage Harbor discount line ===');
{
  /* The customer's selections never price a slipholder line any more — the
     discount exists only once staff approve it (manual.hho), and is rebuilt
     by recomputeTotals_. What has to hold is that whatever slip we hold
     reaches that line, so whoever reads it later knows which slipholder it
     is, and that a staff correction to the slip is the one it shows. */
  const d=quoteFrom('boat-twin-inboard-full');
  d.state.hho=true; d.state.slipNo='';
  B.rebuildLinesFromState_(d); B.applyManualOps_(d);
  check('nothing is priced before approval', !d.lines.some(l=>/Heritage Harbor/i.test(l.label)));
  B.ensureManual_(d).hho={status:'approved',amt:null};
  B.ensureManual_(d).measured={slipNo:'B-14'};
  B.rebuildLinesFromState_(d); B.applyManualOps_(d);
  const line=d.lines.find(l=>/Heritage Harbor/i.test(l.label))||{};
  console.log('    '+(line.label||'(no hho line)'));
  check('label picks up the slip', /B-14/.test(line.label||''));
  check('the line is a discount once approved', line.hho===true && line.amt<0);
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

console.log('\n=== 6b. "where is the trailer" is only asked when there is one ===');
/* Asking it of a boat blocked on stands is not a harmless extra row: Harbor
   Haul Out renders an unanswered field as "— not recorded —" in the colour it
   uses for missing information, so the crew reads a settled fact as a gap.
   Chris reported exactly that.
   The subtlety is WHOSE answer `hasTrailer` is. The quote page only shows the
   trailer question to boats and jet skis, so a golf cart's flag sits at the
   default false and is not an answer at all. */
{
  const unit=(u)=>({unit:u});
  const T={hasTrailer:true}, F={hasTrailer:false};
  const row=(label,got,want)=>check(label,got===want,'got '+got+' want '+want);

  row('boat with a trailer: ask where it is',    B.needsTrailerLoc_(unit('Boat'),T,''), true);
  row('boat on stands: do not ask',              B.needsTrailerLoc_(unit('Boat'),F,''), false);
  row('jet ski (always trailered): ask',         B.needsTrailerLoc_(unit('Jet Ski'),T,''), true);
  /* Chris, flatly: golf carts never have a trailer. They are driven here. An
     earlier pass gave them the field on the theory that one might turn up
     towed, which put a red "— not recorded —" on every cart — the same noise
     the boats had, aimed somewhere else. */
  row('golf cart: never has a trailer',
      B.needsTrailerLoc_(unit('Golf Cart'),F,''), false);
  row('and saying it does changes nothing',
      B.needsTrailerLoc_(unit('Golf Cart'),T,''), false);
  row('e-bike: no keys, no slip, no trailer',    B.needsTrailerLoc_(unit('E-Bike'),F,''), false);
  row('e-bike stays out even with a value on it',B.needsTrailerLoc_(unit('E-Bike'),F,'back lot'), false);
  /* THE SAFETY VALVE. If the flag is wrong and somebody has already written
     down where the trailer is, the field must stay visible — otherwise the
     value is orphaned where nobody can read it, edit it or clear it. */
  row('a recorded location beats the flag',      B.needsTrailerLoc_(unit('Boat'),F,'back lot, row 3'), true);
  row('whitespace is not a recorded location',   B.needsTrailerLoc_(unit('Boat'),F,'   '), false);
  row('a missing state is not a trailer',        B.needsTrailerLoc_(unit('Boat'),null,''), false);

  /* The one case the cart rule must not eat: a value recorded before it, or
     against a flag that turned out wrong. Hiding that would orphan it where
     nobody can read, change or clear it. */
  row('a cart with a location already recorded still shows it',
      B.needsTrailerLoc_(unit('Golf Cart'),F,'back lot'), true);
  /* Exactly one answer now. The editor/reader split that briefly existed only
     had a golf cart to justify it. */
  check('there is no second trailer predicate to drift from this one',
        !/function showTrailerLoc_/.test(gas));

  /* And it must not have crept into the customer chase: we never email anybody
     asking where their trailer is. */
  const d=quoteFrom('boat-twin-inboard-full');
  d.state.hasTrailer=false; d.state.keyLoc=''; d.state.slipNo='';
  const need=B.missingHaulInfo_(d);
  check('the chase list still asks only for keys and slip',
        need.every(n=>n==='keys'||n==='slip'), JSON.stringify(need));
}

console.log('\n=== 6c. both clients read that one answer ===');
{
  const hho=fs.readFileSync(path.join(ROOT,'harbor-haul-out/index.html'),'utf8');
  const admin=fs.readFileSync(path.join(ROOT,'admin/index.html'),'utf8');
  check('Harbor Haul Out gates the trailer row on the server\'s answer',
        /needsTrailerLoc\?kv\('Trailer is'/.test(hho));
  check('and drops the "On a trailer" row entirely for a land unit',
        /towable\?kv\('On a trailer'/.test(hho));
  check('the console gates its trailer input on the same field',
        /keysTrailerWrap'\)\.classList\.toggle\('hide',!k\.needsTrailerLoc\)/.test(admin));
  /* Neither client may work the rule out for itself — that is how two copies
     drift and one of them starts asking again. */
  [['harbor-haul-out/index.html',hho],['admin/index.html',admin]].forEach(function(pair){
    const js=pair[1].replace(/\/\*[\s\S]*?\*\//g,'').replace(/<!--[\s\S]*?-->/g,'');
    check(pair[0]+' does not re-derive it from hasTrailer',
          !/needsTrailerLoc\s*=[^=]/.test(js));
  });
  /* A golf cart's facts should not mention trailers at all. */
  check('Harbor Haul Out knows which units can be towed',
        /trailerApplies/.test(hho));
  check('and the server tells it',
        /trailerApplies: !isLandUnit_\(d\)/.test(gas));
  /* Belt and braces: no surface offers the checkbox for a land unit, so this
     only fires on a crafted request -- but a cart carrying hasTrailer would
     move its deposit as well as putting the question back on the Harbor Haul
     Out screen. */
  const san=(gas.match(/function sanitizeMeasured_[\s\S]*?\n}/m)||[''])[0];
  check('the server refuses to mark a land unit as trailered',
        /golf[\s\S]{0,80}ebike|ebike[\s\S]{0,80}golf/.test(san));
}

console.log(fails?fails+' haul-info violation(s)':'haul info holds: only the applicable question is asked, and a staff entry survives the customer re-saving');
process.exit(fails?1:0);
