#!/usr/bin/env node
/* Execute the re-price against a fake spreadsheet with the rates actually moved.
   ---------------------------------------------------------------------------
   This rewrites what customers owe across a whole season, so the things that
   must hold cannot be checked by reading the code:

     - a LEAD is never in the list (they have no pricing and are not customers)
     - the staff journal REPLAYS, so a discount is not quietly erased by the
       re-price — this is the failure that would cost Quest money silently
     - a deposit is untouched and the balance follows the new total
     - a quote whose storage tab would move is reported, never moved
     - preview writes NOTHING
     - the selection can only narrow, never widen

   Run by tools/verify.sh. */
'use strict';
const fs=require('fs'); const {execSync}=require('child_process');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const gas=fs.readFileSync(ROOT+'/quote-logger-apps-script.gs','utf8');
function fn(n){const o=gas.match(new RegExp('^function '+n+'\\b.*}\\s*$','m'));if(o)return o[0];
  const m=gas.match(new RegExp('^function '+n+'\\b[\\s\\S]*?\\n}','m'));if(!m)throw new Error('missing '+n);return m[0];}
const decl=(n)=>gas.match(new RegExp('^const '+n+'\\s*=[\\s\\S]*?;\\s*$','m'))[0];

const states=JSON.parse(execSync('node tools/price-fixtures.js --dump-states',{cwd:ROOT,maxBuffer:1e8}));
const P=require(ROOT+'/pricing-engine.js');
function payload(name,extra){
  const state=JSON.parse(JSON.stringify(states.find(s=>s.name===name).state));
  const r=P.computeQuote(state);
  const lines=r.lines.map(l=>({sec:l.sec,label:l.label,calc:l.calc||'',amt:Number(l.amt||0),desc:l.desc||''}));
  return Object.assign({quoteNo:'X',unit:'Boat',depositBase:500,state,lines,
    total:lines.reduce((a,b)=>a+b.amt,0).toFixed(2),payments:[],
    storageTab:P.storageTabFor(state)},extra||{});
}

const P1=payload('boat-twin-inboard-full',{quoteNo:'Q-A',lastName:'Adams',firstName:'Pat'});
const P2=payload('boat-twin-inboard-full',{quoteNo:'Q-B',lastName:'Boone',firstName:'Sam',
  payments:[{amt:500,method:'Card',ts:'2026-09-01',by:'Chris'}]});           // DEPOSIT
const P3=payload('boat-twin-inboard-full',{quoteNo:'Q-C',lastName:'Cline',firstName:'Al',
  manual:{removed:[],edits:[],priced:[],adjustments:[{label:'Slipholder discount',amt:-50}]}});
P3.lines.push({sec:'Adjustments',label:'Slipholder discount',calc:'',amt:-50,desc:''});
P3.total=(Number(P3.total)-50).toFixed(2);
const P4=payload('jetski-inside-detail',{quoteNo:'Q-D',lastName:'Doyle',firstName:'Kim',unit:'Jet ski'});
const P5={quoteNo:'Q-E',lastName:'Evans',firstName:'Lee',unit:'Boat',total:'900.00',payments:[]}; // no state
const LEAD={quoteNo:'Q-LEAD',lastName:'Hyde',firstName:'Jo',unit:'Boat',total:'0.00',state:P1.state};

const TABS=[
  {name:'Inside', rows:[P1,P2,P3]},
  {name:'Inside2',rows:[P4,P5]},
  {name:'Quote Started', rows:[LEAD]},
  {name:'Activity Log', rows:[P1], notQuote:true},
];
const HL=23, COLQN=3, COLPAY=21, COLTOTAL=12, COLUNIT=7, COLLAST=1, COLFIRST=2;
function sheetFor(t){
  const grid=t.rows.map(d=>{const r=new Array(HL).fill('');
    r[COLLAST-1]=d.lastName||''; r[COLFIRST-1]=d.firstName||'';
    r[COLQN-1]=d.quoteNo; r[COLUNIT-1]=d.unit||''; r[COLTOTAL-1]=Number(d.total||0);
    r[COLPAY-1]=JSON.stringify(d); return r;});
  return {getName:()=>t.name,getLastRow:()=>grid.length+1,
    getRange:(r,c,nr,nc)=> nr===undefined
      ? {getValue:()=>(r===1&&c===3&&!t.notQuote)?'Quote #':''}
      : {getValues:()=>grid.slice(r-2,r-2+nr).map(row=>row.slice(c-1,c-1+nc))}};
}
const SpreadsheetApp={getActiveSpreadsheet:()=>({getSheets:()=>TABS.map(sheetFor)})};

function build(engine){
  return new Function('SpreadsheetApp',[
    engine,
    'const ADJ_CC_PCT=3, ADJ_LATE_PCT=10;',
    'function usd_(n){n=Number(n||0);return "$"+Math.abs(n).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g,",").replace(/^/, n<0?"-":"");}',
    "const STARTED_TAB='Quote Started';", fn('isStartedTab_'),
    decl('HEADERS'), decl('COL'), decl('KEYFIELDS_'),
    fn('paymentsTotal_'), fn('effectiveState_'), fn('serverPrice_'), fn('linesTotal_'),
    fn('rebuildLinesFromState_'), fn('ensureManual_'), fn('applyManualOps_'),
    fn('recomputeTotals_'), fn('bulkFilterTargets_'),
    fn('repriceScan_'), fn('repriceRowOut_'),
    "function requireAuth_(){return {name:'Chris',admin:true};}",
    fn('adminRepricePreview'),
    'return {repriceScan_,adminRepricePreview};'
  ].join('\n'))(SpreadsheetApp);
}

const eng=gas.slice(gas.indexOf('// ENGINE-START'),gas.indexOf('// ENGINE-END'));
let fails=0;
const check=(l,c,d)=>{console.log('  '+(c?'PASS':'FAIL')+'  '+l+(d?'  — '+d:''));if(!c)fails++;};

console.log('=== A. rates UNCHANGED: nothing should move ===');
{
  const r=build(eng).adminRepricePreview('t');
  console.log('  read '+r.total+', changed '+r.changed+', unchanged '+r.unchanged+', net '+r.net);
  check('no quote moves when rates have not changed', r.changed===0, 'changed='+r.changed);
  check('the lead is not in the list', !r.rows.some(x=>x.qn==='Q-LEAD'));
  check('the Activity Log is not treated as quotes', !r.rows.some(x=>x.tab==='Activity Log'));
  check('the state-less quote is reported, not priced',
    r.rows.some(x=>x.qn==='Q-E'&&x.skip), JSON.stringify((r.rows.find(x=>x.qn==='Q-E')||{}).skip));
}

console.log('\n=== B. inside storage +10%: a real rollover ===');
const bumped=eng.replace(/insideT:\s*([\d.]+)/,(m,v)=>'insideT: '+(Number(v)*1.1).toFixed(4))
                .replace(/insideNT:\s*([\d.]+)/,(m,v)=>'insideNT: '+(Number(v)*1.1).toFixed(4));
{
  const B=build(bumped);
  const r=B.adminRepricePreview('t');
  console.log('  read '+r.total+', changed '+r.changed+', net '+r.net+', deposits affected '+r.lockedChanged);
  r.rows.filter(x=>!x.skip).forEach(x=>console.log('    '+x.qn+' '+String(x.name).padEnd(12)+
    (x.before+' -> '+x.after).padEnd(24)+x.delta.padStart(9)+
    (x.locked?'   paid '+x.paid+' bal '+x.newBalance:'')));
  check('quotes moved', r.changed>0);
  check('the deposited quote is included', r.rows.some(x=>x.qn==='Q-B'&&x.changed));
  check('its deposit is reported', (r.rows.find(x=>x.qn==='Q-B')||{}).paid==='$500.00');
  const b=r.rows.find(x=>x.qn==='Q-B');
  const expBal=(Number(b.after.replace(/[^0-9.]/g,''))-500).toFixed(2);
  check('its balance = new total − deposit',
    b.newBalance.replace(/[^0-9.]/g,'')===expBal, b.newBalance+' vs '+expBal);
  check('deposits-affected count is surfaced', r.lockedChanged>=1, String(r.lockedChanged));
  /* Q-D sits on a tab its storage rules would not put it on, so it is REPORTED
     as needing a move and deliberately left out of the tickable list. Moving
     somebody's unit is a conversation, not a side effect of a bulk job. */
  const dRow=r.rows.find(x=>x.qn==='Q-D');
  check('a quote whose tab would move is flagged, not moved', !!dRow.wouldMove, 'wouldMove='+dRow.wouldMove);
  check('it is excluded from the change count', r.changed===3 && r.moving===1,
    'changed='+r.changed+' moving='+r.moving);

  const c=r.rows.find(x=>x.qn==='Q-C');
  const a=r.rows.find(x=>x.qn==='Q-A');
  const cd=Number(c.after.replace(/[^0-9.]/g,'')), ad=Number(a.after.replace(/[^0-9.]/g,''));
  check('the staff discount SURVIVES the re-price', Math.abs((ad-cd)-50)<0.02,
    'Adams '+a.after+' vs Cline '+c.after+' (should differ by the $50 discount)');
}

console.log('\n=== C. preview writes nothing ===');
{
  const before=JSON.stringify(TABS.map(t=>t.rows.map(r=>r.total)));
  build(bumped).adminRepricePreview('t');
  const after=JSON.stringify(TABS.map(t=>t.rows.map(r=>r.total)));
  check('no payload totals were touched', before===after);
}

console.log('\n=== D. the selection can only narrow ===');
{
  const B=build(bumped);
  const scan=B.repriceScan_();
  const wrap=scan.map(x=>({d:{quoteNo:x.qn},x:x}));
  const F=new Function(fn('bulkFilterTargets_')+'\nreturn bulkFilterTargets_;')();
  check('empty selection = nobody', F(wrap,[]).length===0);
  check('naming the LEAD adds nothing', F(wrap,['Q-LEAD']).length===0);
  check('naming a ghost adds nothing', F(wrap,['Q-NOPE']).length===0);
  check('a real pick resolves', F(wrap,['Q-A']).length===1);
}
console.log(fails?fails+' re-price violation(s)':'re-price holds: leads out, discounts survive, deposits intact, preview writes nothing');
process.exit(fails?1:0);
