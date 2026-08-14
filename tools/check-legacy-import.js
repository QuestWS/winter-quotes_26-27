#!/usr/bin/env node
/* Execute the legacy winter-services sheet parser.
   ---------------------------------------------------------------------------
   The old system was one spreadsheet per customer, and the files come in three
   states that a reader has to survive:

     1. intact, with service labels
     2. intact, but the label column is dead ($0) — the labels were formulas
        pointing at the master pricing workbook
     3. broken — prices AND labels are #REF!, because that link is gone

   Only the unit price reliably survives, so the parser matches on price, in
   template order. Two services share $298 and two share $23; only their ORDER
   separates them, which is a property of the code and cannot be grepped.

   State 3 is the trap worth guarding: a parser that shrugged would hand back a
   quote with no services and no explanation. It must say the file is broken.

   Names and contacts below are invented. The layout and the breakage are
   copied from the real files; no customer data lives in this repo.

   Run by tools/verify.sh. */
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const gas=fs.readFileSync(ROOT+'/quote-logger-apps-script.gs','utf8');
function fn(n){const o=gas.match(new RegExp('^function '+n+'\\b.*}\\s*$','m'));if(o)return o[0];
  const m=gas.match(new RegExp('^function '+n+'\\b[\\s\\S]*?\\n}','m'));if(!m)throw new Error(n);return m[0];}
const decl=(n)=>gas.match(new RegExp('^const '+n+'\\s*=[\\s\\S]*?^\\];','m'))[0];
const B=new Function([decl('LEGACY_LEFT_'),decl('LEGACY_RIGHT_'),decl('LEGACY_ANCHORS_'),
  fn('legacyNum_'),fn('legacyText_'),fn('legacyFind_'),fn('legacyRowOf_'),fn('legacyAligned_'),
  fn('parseLegacyGrid_'),fn('legacyToState_'),
  'return {parseLegacyGrid_,legacyAligned_,legacyToState_};'].join('\n'))();
const P=require(path.join(ROOT,'pricing-engine.js'));
const money=(st)=>P.computeQuote(st).lines.reduce((a,l)=>a+Number(l.amt||0),0);

/* Build a grid in the template's shape. left/right = [ [rowOffset, qty, price, amount] ] */
function grid(hdr,left,right){
  const g=[]; for(let i=0;i<40;i++) g.push(new Array(12).fill(''));
  g[1][6]='Owner:';           g[1][7]=hdr.owner;
  g[2][6]='Phone & email:';   g[2][7]=hdr.phone; g[2][8]=hdr.email;
  g[3][6]='Yr/make/mod:';     g[3][7]=hdr.ymm;
  g[4][6]=hdr.loa;  g[4][8]=hdr.beam;
  g[5][6]=hdr.lwt;
  g[30][5]='Notes/extras: '+(hdr.notes||'');
  /* Section captions are plain text in every file, broken or not — they are
     what proves two grids are the same template generation. */
  g[7][0]='Basic engine winterization';
  g[12][0]='Full service engine winterization';
  g[17][0]='Drive train service';
  g[21][0]='Water systems winterization';
  g[24][5]='Blocking & washing';
  g[27][5]='Misc. & special requests';
  const LEFT=[298,298,177,111,458,502,253,230,144,191,80,122,252,88,46,116,101,270];
  const RIGHT=[17,23,198,18,23,11,0.75,325,425,8.29,7.29,6.29,5.29,365,5.39,185,225];
  LEFT.forEach((p,i)=>{ const r=8+i; g[r][1]=hdr.broken?'#REF!':'$'+p;
    g[r][2]=hdr.labels?('label '+i):(hdr.broken?'#REF!':'$0');
    g[r][3]=hdr.broken?'#REF!':'$0'; });
  RIGHT.forEach((p,i)=>{ const r=8+i; g[r][6]=hdr.broken?'#REF!':'$'+p;
    g[r][7]=hdr.labels?('rlabel '+i):(hdr.broken?'#REF!':'$0');
    g[r][10]=hdr.broken?'#REF!':'$0'; });
  (left||[]).forEach(x=>{ const r=8+x[0]; g[r][0]=x[1]; if(x[2]!==undefined)g[r][3]='$'+x[2]; });
  (right||[]).forEach(x=>{ const r=8+x[0]; g[r][5]=x[1]; if(x[2]!==undefined)g[r][10]='$'+x[2]; });
  return g;
}
let fails=0; const check=(l,c,d)=>{console.log('  '+(c?'PASS':'FAIL')+'  '+l+(d?'  — '+d:''));if(!c)fails++;};

console.log('=== 1. intact file WITH labels (the ~47KB shape) ===');
{
  const g=grid({owner:'Mark Demo',phone:'815-555-0101',email:'mark@example.com',
      ymm:'Chaparral 29ft',loa:29,beam:8,lwt:'',labels:true,notes:'Slip P-08'},
    [[5,2,1004]],                                   // 2 x I/O full
    [[0,1,493],[3,1,522],[4,1,667],[6,1,174],[11,1,1459],[15,1,185]]);
  const p=B.parseLegacyGrid_(g);
  console.log('   owner/phone/email:',p.owner,'|',p.phone,'|',p.email);
  console.log('   ymm/dims        :',p.ymm,'| LOA',p.loa,'B',p.beam,'LWT',p.lwt);
  console.log('   notes           :',JSON.stringify(p.notes));
  p.picked.forEach(x=>console.log('     '+String(x.qty).padStart(2)+' x '+x.label.padEnd(44)+'$'+x.amount));
  check('owner read',p.owner==='Mark Demo');
  check('email read',p.email==='mark@example.com');
  check('LOA/beam read',p.loa===29&&p.beam===8);
  check('notes read',/Slip P-08/.test(p.notes),p.notes);
  check('2 x I/O full identified (not inboard)',p.picked.some(x=>x.key==='ioFull'&&x.qty===2));
  check('R/S/R under 36 not confused with over-36',p.picked.some(x=>x.key==='rsrUnder36'));
  check('shrinkwrap labour separated from the other $23 line',
    p.picked.some(x=>x.key==='wrapLabor')&&!p.picked.some(x=>x.key==='rsrOver36'));
  check('inside storage identified',p.picked.some(x=>x.key==='insideNT'&&x.amount===1459));
  check('nothing unreadable',p.unreadable===0,'unreadable='+p.unreadable);
  check('BOTH storages flagged as present',
    p.picked.some(x=>x.key==='outside')&&p.picked.some(x=>x.key==='insideNT'));
}

console.log('\n=== 2. intact file WITHOUT labels (the ~40KB shape) ===');
{
  const g=grid({owner:'DAN DEMO',phone:'312-555-0102',email:'dan@example.com',
      ymm:'SEARAY SUNDANCER',loa:30,beam:10,lwt:32,labels:false},
    [[5,2,1004],[12,1,252],[15,1,116]],
    [[9,1,2487],[14,1,162],[15,1,185]]);
  const p=B.parseLegacyGrid_(g);
  console.log('   dims:',p.loa,p.beam,p.lwt);
  p.picked.forEach(x=>console.log('     '+String(x.qty).padStart(2)+' x '+x.label.padEnd(44)+'$'+x.amount));
  check('labels missing does not stop the read',p.picked.length===6,'got '+p.picked.length);
  check('LWT read',p.lwt===32);
  check('A/C identified purely by price',p.picked.some(x=>x.key==='ac'));
  check('premium inside identified',p.picked.some(x=>x.key==='premInsideNT'&&x.amount===2487));
  check('no false warnings',p.warnings.length===0,JSON.stringify(p.warnings));
}

console.log('\n=== 3. the #REF! file (the ~80KB shape, the biggest group) ===');
{
  const g=grid({owner:'Matt Demo',phone:'630-555-0103',email:'matt@example.com',
      ymm:"25' Regency",loa:25,beam:8.5,lwt:29,broken:true,
      notes:'Slip P-08 customer will drop keys'},
    [[5,1]],[[11,1],[12,1]]);
  const p=B.parseLegacyGrid_(g);
  console.log('   owner/dims :',p.owner,'| LOA',p.loa,'B',p.beam,'LWT',p.lwt);
  console.log('   notes      :',JSON.stringify(p.notes).slice(0,60));
  console.log('   services   :',p.picked.length,'  unreadable:',p.unreadable);
  console.log('   warning    :',JSON.stringify(p.warnings[0]||'').slice(0,110));
  check('contact still recovered',p.owner==='Matt Demo'&&p.email==='matt@example.com');
  check('dimensions still recovered',p.loa===25&&p.beam===8.5&&p.lwt===29);
  check('notes still recovered',/drop keys/.test(p.notes));
  check('no services invented from a broken file',p.picked.length===0);
  check('it SAYS the file is broken',/prices are broken/.test(p.warnings[0]||''));
}

console.log('\n=== 4. an untouched blank template ===');
{
  const g=grid({owner:'',phone:'',email:'',ymm:'',loa:'',beam:'',lwt:'',labels:true},[],[]);
  const p=B.parseLegacyGrid_(g);
  check('nothing ticked is reported, not silently empty',
    /No services are ticked/.test(p.warnings.join(' ')),JSON.stringify(p.warnings));
}

console.log('\n=== 5. junk in the quantity column is ignored ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'',loa:20,beam:8,lwt:'',labels:true},
    [[5,'yes'],[6,0],[7,-1]],[]);
  const p=B.parseLegacyGrid_(g);
  check('text qty ignored',!p.picked.some(x=>x.key==='ioFull'));
  check('zero qty ignored',!p.picked.some(x=>x.key==='outboardFull'));
  check('negative qty ignored',!p.picked.some(x=>x.key==='pwcFull'));
}
console.log('\n=== 6. a BROKEN file recovered from the master pricing grid ===');
{
  /* Chris's design: the customer sheet links to the master by cell location,
     so what is missing here is answerable there. Quantities survive locally. */
  const master=grid({owner:'',phone:'',email:'',ymm:'',loa:'',beam:'',lwt:'',labels:true},[],[]);
  const broken=grid({owner:'Matt Demo',phone:'630-555-0103',email:'matt@example.com',
      ymm:"25' Regency",loa:25,beam:8.5,lwt:29,broken:true,notes:'Slip P-08'},
    [[5,2]],[[11,1],[15,1]]);
  const p=B.parseLegacyGrid_(broken,master);
  p.picked.forEach(x=>console.log('     '+String(x.qty).padStart(2)+' x '+x.label.padEnd(42)+
    (x.recovered?'(recovered from master)':'')));
  check('services recovered from a #REF! file',p.picked.length===3,'got '+p.picked.length);
  check('the 2 x I/O full survived',p.picked.some(x=>x.key==='ioFull'&&x.qty===2));
  check('inside storage recovered',p.picked.some(x=>x.key==='insideNT'));
  check('blocking recovered',p.picked.some(x=>x.key==='blocking'));
  check('every recovered line is marked as such',p.picked.every(x=>x.recovered===true));
  check('amounts are NOT invented',p.picked.every(x=>x.amount===null));
  check('it says the amounts were recalculated',
    /recalculated, not copied/.test(p.warnings.join(' ')));
  check('contact + dims still read',p.owner==='Matt Demo'&&p.loa===25&&p.lwt===29);
}

console.log('\n=== 7. a master from a DIFFERENT template generation is refused ===');
{
  const broken=grid({owner:'X',phone:'',email:'',ymm:'',loa:20,beam:8,lwt:'',broken:true},
    [[5,2]],[[11,1]]);
  const shifted=grid({owner:'',phone:'',email:'',ymm:'',loa:'',beam:'',lwt:'',labels:true},[],[]);
  const moved=[]; for(let i=0;i<3;i++) moved.push(new Array(12).fill(''));
  const master2=moved.concat(shifted);
  check('misaligned grids are detected',B.legacyAligned_(broken,master2)===false);
  const p=B.parseLegacyGrid_(broken,master2);
  check('nothing recovered from a mismatched master',p.picked.length===0,'got '+p.picked.length);
  check('and it says why',/different version of the template/.test(p.warnings.join(' ')));
}

console.log('\n=== 8. an intact file ignores the master entirely ===');
{
  const master=grid({owner:'',phone:'',email:'',ymm:'',loa:'',beam:'',lwt:'',labels:true},[],[]);
  const good=grid({owner:'Mark Demo',phone:'',email:'',ymm:'',loa:29,beam:8,lwt:'',labels:true},
    [[5,2,1004]],[[11,1,1459]]);
  const p=B.parseLegacyGrid_(good,master);
  check('real amounts kept, not recalculated',p.picked.some(x=>x.key==='ioFull'&&x.amount===1004));
  check('not flagged as recovered',p.usedMaster===false&&p.picked.every(x=>!x.recovered));
}

console.log('\n=== 9. a SIDE-BY-SIDE storage comparison sheet ===');
{
  /* The real one: outside + R/S/R + wrap priced against inside, on one sheet,
     to quote the customer the difference. Its stated total is the sum of both
     and is not a number anybody was quoted. */
  const g=grid({owner:'Mark Demo',phone:'',email:'',ymm:'Chaparral 29ft',loa:29,beam:8,lwt:'',labels:true},
    [[5,2,1004]],
    [[0,1,493],[3,1,522],[4,1,667],[6,1,174],[11,1,1459],[15,1,185]]);
  const p=B.parseLegacyGrid_(g);
  console.log('   options found:',(p.storageChoice||[]).map(x=>x.label+' '+x.amount).join('  |  '));
  check('both storage options detected',p.storageChoice&&p.storageChoice.length===2);
  check('neither is silently chosen',
    !(p.storageChoice||[]).some(x=>x.chosen),'nothing marked chosen');
  check('the stated total is marked unreliable',p.totalUnreliable===true);
  check('it explains why',/not what the customer was quoted/.test(p.warnings.join(' ')));
  check('it is NOT reported as multiple units',!p.extraUnits);
}

console.log('\n=== 10. a jet ski tagged onto a boat sheet ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'',loa:29,beam:8,lwt:'',labels:true},
    [[5,2,1004],[7,2,460]],            // 2 x I/O full  +  2 x PWC full
    [[11,1,1459]]);
  const p=B.parseLegacyGrid_(g);
  console.log('   extras:',JSON.stringify(p.extraUnits));
  check('extra units detected',!!p.extraUnits);
  check('it counts the jet skis',/2 jet ski/.test((p.extraUnits||[]).join(' ')));
  check('it says why separating matters',/one quote per unit/.test(p.warnings.join(' ')));
  check('single storage is not flagged as a comparison',!p.storageChoice);
}

console.log('\n=== 11. a golf cart on the same sheet as a boat ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'',loa:29,beam:8,lwt:'',labels:true},
    [[5,1,502]],[[13,1,365]]);         // I/O full + golf cart storage
  const p=B.parseLegacyGrid_(g);
  check('golf cart on a boat sheet detected',/golf cart/.test((p.extraUnits||[]).join(' ')),
    JSON.stringify(p.extraUnits));
}

console.log('\n=== 12. an ordinary single-unit sheet raises none of this ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'',loa:29,beam:8,lwt:'',labels:true},
    [[5,2,1004]],[[11,1,1459],[15,1,185]]);
  const p=B.parseLegacyGrid_(g);
  check('no storage comparison',!p.storageChoice);
  check('no extra units',!p.extraUnits);
  check('total is trusted',p.totalUnreliable===false);
  check('no warnings at all',p.warnings.length===0,JSON.stringify(p.warnings));
}

console.log('\n=== 13. a genuine jet-ski-only sheet is not "extra units" ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'',loa:12,beam:4,lwt:'',labels:true},
    [[7,1,230]],[[11,1,300]]);         // 1 x PWC full, inside storage, no boat motors
  const p=B.parseLegacyGrid_(g);
  check('one jet ski on its own is fine',!p.extraUnits,JSON.stringify(p.extraUnits));
}

console.log('\n=== 14. parse -> state -> priced by the LIVE engine ===');
{
  /* The readable comparison sheet, with staff saying they took inside. */
  const g=grid({owner:'Mark Demo',phone:'815-555-0101',email:'m@example.com',
      ymm:'Chaparral 29ft',loa:29,beam:8,lwt:'',labels:true,notes:'Slip P-08'},
    [[5,2,1004]],
    [[0,1,493],[3,1,522],[4,1,667],[6,1,174],[11,1,1459],[15,1,185]]);
  const p=B.parseLegacyGrid_(g);
  const m=B.legacyToState_(p,'insideNT');
  const st=m.state;
  console.log('   unit/dims  :',st.unit,'LOA',st.loa,'B',st.beam,'trailer',st.hasTrailer);
  console.log('   motors     :','io x'+st.engines.io.qty+' ('+st.engines.io.level+')');
  console.log('   storage    :',st.storage,' retrieval:',st.retrieval,' wrap:',st.wrap);
  console.log('   priced now : $'+money(st).toFixed(2)+'   (2025-26 sheet said inside = $2,648)');
  check('unit is a boat',st.unit==='boat');
  check('2 x I/O full carried over',st.engines.io.qty===2&&st.engines.io.level==='full');
  check('storage follows the staff pick',st.storage==='inside');
  check('blocking on the sheet means NOT on a trailer',st.hasTrailer===false);
  check('contact + notes carried',st.email==='m@example.com'&&/Slip P-08/.test(st.notes));
  check('the live engine prices it',money(st)>0);
  /* The imported total is HIGHER than the sheet's inside option by exactly the
     shrinkwrap, which on a comparison sheet belonged to the outside option. */
  check('the wrap-belongs-to-the-other-option warning fires',
    /belongs with the OUTSIDE option/.test(m.notes.join(' ')),JSON.stringify(m.notes).slice(0,120));
  const noWrap=JSON.parse(JSON.stringify(st)); noWrap.wrap=false;
  console.log('   without the wrap: $'+money(noWrap).toFixed(2)+'   (sheet inside = $2,648)');
  check('dropping the wrap lands within a few dollars of the sheet',
    Math.abs(money(noWrap)-2648)<25,'got '+money(noWrap).toFixed(2));
}

console.log('\n=== 15. a comparison sheet with NO pick imports without storage ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'',loa:29,beam:8,lwt:'',labels:true},
    [[5,2,1004]],[[3,1,522],[11,1,1459]]);
  const m=B.legacyToState_(B.parseLegacyGrid_(g),null);
  check('storage left as none rather than guessed',m.state.storage==='none',m.state.storage);
  check('the motors still came through',m.state.engines.io.qty===2);
}

console.log('\n=== 16. a boat with two motor types is flagged, not silently built ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'',loa:29,beam:8,lwt:'',labels:true},
    [[4,1,458],[5,1,502]],[[11,1,1459]]);   // 1 inboard full + 1 I/O full
  const m=B.legacyToState_(B.parseLegacyGrid_(g),'insideNT');
  check('both types survive so staff can choose',
    m.state.engines.inboard.qty===1&&m.state.engines.io.qty===1);
  check('and it says a boat cannot have both',/only have one type/.test(m.notes.join(' ')),
    JSON.stringify(m.notes));
}

console.log('\n=== 17. a jet ski sheet becomes a jet ski quote ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'Yamaha',loa:12,beam:4,lwt:'',labels:true},
    [[7,1,230]],[[11,1,300]]);
  const m=B.legacyToState_(B.parseLegacyGrid_(g),'insideNT');
  check('unit is a jet ski',m.state.unit==='jetski',m.state.unit);
  check('its winterizing carried over',m.state.engines.pwc.qty===1&&m.state.engines.pwc.level==='full');
}

console.log('\n=== 18. things the new engine prices differently are named ===');
{
  const g=grid({owner:'X',phone:'',email:'',ymm:'',loa:19,beam:7,lwt:'',labels:true},
    [[5,1,502]],[[7,1,325],[11,1,900]]);    // flat-rate wrap up to 20'
  const m=B.legacyToState_(B.parseLegacyGrid_(g),'insideNT');
  check('flat-rate wrap is called out',/flat-rate shrinkwrap/.test(m.unmapped.join(' ')),
    JSON.stringify(m.unmapped));
  check('wrap is still turned on',m.state.wrap===true);
}

console.log('');
console.log(fails?fails+' legacy-parse violation(s)':'legacy import holds: duplicate prices separated by order, broken files declared not guessed');
process.exit(fails?1:0);
