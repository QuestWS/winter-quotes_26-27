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
const B=new Function([decl('LEGACY_LEFT_'),decl('LEGACY_RIGHT_'),
  fn('legacyNum_'),fn('legacyText_'),fn('legacyFind_'),fn('parseLegacyGrid_'),
  'return {parseLegacyGrid_};'].join('\n'))();

/* Build a grid in the template's shape. left/right = [ [rowOffset, qty, price, amount] ] */
function grid(hdr,left,right){
  const g=[]; for(let i=0;i<40;i++) g.push(new Array(12).fill(''));
  g[1][6]='Owner:';           g[1][7]=hdr.owner;
  g[2][6]='Phone & email:';   g[2][7]=hdr.phone; g[2][8]=hdr.email;
  g[3][6]='Yr/make/mod:';     g[3][7]=hdr.ymm;
  g[4][6]=hdr.loa;  g[4][8]=hdr.beam;
  g[5][6]=hdr.lwt;
  g[30][5]='Notes/extras: '+(hdr.notes||'');
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
console.log(fails?fails+' legacy-parse violation(s)':'legacy import holds: duplicate prices separated by order, broken files declared not guessed');
process.exit(fails?1:0);
