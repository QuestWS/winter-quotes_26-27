/* ============================================================================
   Quest Watersports — SHARED PRICING ENGINE
   ----------------------------------------------------------------------------
   ONE rule set, read by both the customer page (index.html) and the Apps
   Script backend. See docs/TASK-pricing-engine.md.

   RULES FOR TOUCHING THIS FILE
   1. It is DOM-free and side-effect-free. No document/window, no globals
      beyond what is passed in. computeQuote(state) must never mutate state.
      tools/verify.sh fails the build if the DOM appears here.
   2. The block between ENGINE-START and ENGINE-END is duplicated verbatim
      into quote-logger-apps-script.gs. verify.sh diffs the two copies and
      fails if they drift. Edit here, then re-sync the .gs copy — never the
      other way round.
   3. Any change to a number or a rule moves customer money. Re-run
      `node tools/price-fixtures.js` and diff against tools/baseline/ before
      committing. A moved total is either intentional (update the baseline in
      the same commit, and say why) or a bug.

   No build step. Plain script: the page loads it with a <script> tag, Node
   requires it, Apps Script embeds the marked block.
============================================================================ */
'use strict';
(function (root) {
// ENGINE-START
/* ============================================================================
   ANNUAL UPDATE ZONE — everything that changes year to year lives here.
============================================================================ */
const SEASON = {
  seasonLabel:      '2025–2026',
  payByDate:        'November 15, 2025',
  payByShort:       'Nov 15',
  lateChargeStart:  'Dec 1, 2025',
  storageStart:     'October 15, 2025',
  storageStartShort:'Oct 15',
  storageEnd:       'April 15, 2026',
};

const PRICES = {
  basic:  { inboard:298, io:298, outboard:177, pwc:111 },
  full:   { inboard:458, io:502, outboard:253, pwc:230 },
  dtTrans:144, dtTransom:191,
  ballast:80, waterCold:122, waterHead:252, pumpout:88, addlHeads:46, ac:116, genBasic:101, genFull:270,
  retrieveSmall:17,
  retrieveLarge:23,
  retrieveCustTrailer:198,
  outsidePerFt:18,
  insidePremNT:8.29, insidePremT:7.29, insideNT:6.29, insideT:5.29,
  golfCart:365,
  ebikeStorage:160,     // includes a tune-up
  skiDetail:175,        // flat, per ski
  wrapLaborFt:23, wrapInWaterFt:11, wrapMatSqft:0.75, wrapFlat20:325, wrapFlat24:425,
  powerwashFt:5.39, acidNarrowFt:17, acidWideFt:22, lateRetrieval:225,
  /* Blocking a pontoon is a different job from blocking a deep-V on stands.
     Both rates are $185 for 2025-2026; Chris splits them at the 2026-2027
     rollover, and this is already wired so that is a one-number edit here
     rather than a change to the engine. */
  blocking:185, blockingPontoon:185,
};

const RULES = {
  latePct:10,
  ccPct:3,
  depositTrailer:500,
  depositNoTrailer:1000,
  /* A pontoon on stands is the one non-trailered boat that only owes the
     smaller deposit. Everything else off a trailer owes the full 1000. */
  depositNoTrailerPontoon:500,
  wrapFlat20MaxLOA:20,
  wrapFlat24MaxLOA:24,
  acidBeamMax:8.5,
  insideBeamMaxNT:8.5,   // non-trailered boats over this beam: no regular inside storage
  hhoMinTotal:500,       // Heritage Harbor Slipholder option only shows at/above this total
  retrieveSmallMaxLOA:36,
};
/* ========================= END ANNUAL UPDATE ZONE ========================= */

const LEVEL_DESC = {
  basic:'Drain water, run on anti-freeze, drain & fog, disconnect batteries.',
  full: 'Everything in Basic, plus (as applicable): engine oil & filter change, drive oil change, gimbal ring torque check, fuel conditioner, and 1 fuel filter.',
  fullPwc:'Everything in Basic, plus (as applicable): engine oil & filter change, fuel conditioner. Fuel filter not included for PWC.',
  /* Standalone versions for the quote sheet / PDF — must make sense a year
     later with no Basic line to compare against */
  fullQuote:'Drain water, run on anti-freeze, drain & fog, disconnect batteries, plus (as applicable): engine oil & filter change, drive oil change, gimbal ring torque check, fuel conditioner, and 1 fuel filter.',
  fullPwcQuote:'Drain water, run on anti-freeze, drain & fog, disconnect batteries, plus (as applicable): engine oil & filter change and fuel conditioner. Fuel filter not included for PWC.'
};

const BOAT_ENGINES = [
  {id:'inboard',  name:'Inboard'},
  {id:'io',       name:'Inboard/Outboard (sterndrive)'},
  {id:'outboard', name:'Outboard', sub:'Basic includes drive oil change · Full subject to oil volume adjustment'}
];

const QUOTE_ITEMS = [
  ['bottomTouch','Bottom paint touch-up'],
  ['bottomStrip','Strip bottom paint & reapply'],
  ['propRefurb','Propeller refurbishment'],
  ['extDetail','Exterior detail'],
  ['washWax','Wash & wax'],
  ['intDetail','Interior detail'],
  ['intWipe','Interior wipe-down'],
  /* Quoted rather than priced for now. If it settles at a set cost, move it
     into PRICES and add a normal line — the state key stays the same, so
     quotes already carrying the request keep working. */
  ['impeller','Impeller change']
];

/* Money formatter for the `calc` recipe strings. Deliberately NOT
   toLocaleString: Apps Script's Intl support is less predictable than the
   browser's, and calc strings are compared byte-for-byte by the drift alarm.
   Verified identical to the page's old formatter across every rate in use. */
function fmtMoney_(n){ return '$'+Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); }

/* Feet and inches, everywhere a dimension is shown. Nobody measures a boat in
   decimal feet — they read 30 ft 6 in off a tape — so the page collects it that
   way and every downstream surface prints it that way. The engine still
   CALCULATES in decimal feet, because that is what the per-foot and per-sqft
   rates multiply; this is a display and input concern only.

   Rounds to the nearest inch, and rolls 12" up to the next foot so nothing
   ever reads 29' 12". Anything unparseable comes back as-is rather than
   becoming 0' 0" — a dimension we cannot read must look wrong, not look like
   a very small boat. */
function fmtFtIn(v){
  if(v===''||v===null||v===undefined) return '';
  const n=Number(v);
  if(!isFinite(n)) return String(v);
  const neg=n<0, a=Math.abs(n);
  let ft=Math.floor(a), inch=Math.round((a-ft)*12);
  if(inch===12){ ft+=1; inch=0; }
  return (neg?'-':'')+ft+"'"+(inch?' '+inch+'"':'');
}

/* The inverse, for the page's two-box input. Kept beside fmtFtIn so the pair
   can never disagree about what a foot is. */
function ftInToDecimal(ft,inch){
  const f=Number(ft)||0, i=Number(inch)||0;
  const v=f+(i/12);
  return v ? Math.round(v*1000)/1000 : 0;
}

/* The deposit rule. Lived only on the customer page, which was fine while it
   was one ternary; with the pontoon carve-out it is a rule, and a rule both
   sides may need to state belongs here. Returns the BASE — callers still cap
   it at the quote total, since a deposit larger than the bill is nonsense. */
function depositBaseFor(s){
  if(s.unit!=='boat') return RULES.depositTrailer;
  if(s.hasTrailer) return RULES.depositTrailer;
  return s.isPontoon ? RULES.depositNoTrailerPontoon : RULES.depositNoTrailer;
}

/* Requests that resolve to a CREDIT rather than a charge. The slipholder
   discount is worked out from the customer's finished total, so it cannot be
   shown while they are still building the quote — and it must never be shown
   to someone who is not a slipholder. It goes on as an open request reading
   TBD, and staff price it later as a negative.

   Shared because the server enforces the sign against this list: every other
   request must be positive, so a mistyped charge cannot become a refund. */
const DISCOUNT_REQUESTS = ['Heritage Harbor Slipholder discount'];
function isDiscountRequest(label){
  const t=String(label||'');
  return DISCOUNT_REQUESTS.some(function(d){ return t===d || t.indexOf(d+' —')===0; });
}
function hhoRequest_(s){
  if(!s.hho) return '';
  return DISCOUNT_REQUESTS[0] + (s.slipNo ? ' — slip '+s.slipNo : '');
}

/* What Full service ADDS over Basic, per engine type. The customer is choosing
   an upgrade, so the page shows the difference; the quote still carries the
   full price, because that is what they are charged. */
function fullDelta(engineId){
  const b=PRICES.basic[engineId], f=PRICES.full[engineId];
  return (b===undefined||f===undefined) ? null : Math.round((f-b)*100)/100;
}

/* Shrinkwrap sub-calc. Pure: reads only the state passed in.
   Returns {label, amt, type} and, for the per-foot tier, a `split` of the
   individual lines to add. amt === null means "cannot price yet". */
function wrapAuto(s){
  const loa=s.loa||0, beam=s.beam||0;
  if(!loa) return {label:'Enter your LOA on the first step to see pricing', amt:null, type:''};
  if(loa<=RULES.wrapFlat20MaxLOA) return {label:`Package rate — ${RULES.wrapFlat20MaxLOA}' and under`, amt:PRICES.wrapFlat20, type:`Package ≤${RULES.wrapFlat20MaxLOA}'`};
  if(loa<=RULES.wrapFlat24MaxLOA) return {label:`Package rate — ${RULES.wrapFlat24MaxLOA}' and under`, amt:PRICES.wrapFlat24, type:`Package ≤${RULES.wrapFlat24MaxLOA}'`};
  if(!beam) return {label:`Over ${RULES.wrapFlat24MaxLOA}' — priced per foot; enter your beam on the first step`, amt:null, type:''};
  const labor=PRICES.wrapLaborFt*loa, mat=PRICES.wrapMatSqft*loa*beam;
  return {label:`Over ${RULES.wrapFlat24MaxLOA}' — labor $${PRICES.wrapLaborFt}/ft + materials $${PRICES.wrapMatSqft}/sqft`, amt:labor+mat, type:'Per-foot labor + materials',
          split:[['Shrinkwrap labor',labor,`${loa} ft × ${fmtMoney_(PRICES.wrapLaborFt)}`],['Shrinkwrap materials',mat,`${loa}×${beam} sqft × $${PRICES.wrapMatSqft}`]]};
}

/* ----------------------------------------------------------------------------
   Rule advisories. The engine REPORTS violations; it never enforces them and
   never moves a unit. Callers decide:
     - customer page: hides the option up front (buildStorage), so a customer
       is never offered storage their boat won't fit in;
     - console remeasure: reprices in the CURRENT location and shows the flag,
       because relocating an already-stored boat is a customer conversation.
   Chris was explicit that a remeasure must not auto-relocate.
---------------------------------------------------------------------------- */
function computeFlags_(s){
  const flags=[];
  const beam=s.beam||0;
  // Mirrors buildStorage()'s hideInside test exactly: regular inside only.
  // Premium inside is deliberately still offered to wide non-trailered boats.
  if(s.unit==='boat' && !s.hasTrailer && s.storage==='inside' && beam > RULES.insideBeamMaxNT){
    flags.push({
      code:'beamOversizeInside',
      field:'beam',
      value:beam,
      limit:RULES.insideBeamMaxNT,
      msg:`Beam ${beam}' exceeds the Inside storage limit (${RULES.insideBeamMaxNT}') for a non-trailered boat — discuss relocation with the customer.`
    });
  }
  return flags;
}

/* ============================================================================
   THE ENGINE
   computeQuote(state) -> { lines, need, rq, flags }
     lines : [{sec,label,amt,calc,desc}]  amt 0 = included, null never used here
     need  : missing-input prompts, shown to the customer
     rq    : open quote-request labels (priced later by staff)
     flags : rule advisories; see computeFlags_
   Pure. Does not read or write anything outside the state passed in.
============================================================================ */
function computeQuote(s){
  const L=[], loa=s.loa||0, beam=s.beam||0, lwt=s.lwt||0, T=s.hasTrailer, u=s.unit;
  const need=[];
  const add=(sec,label,amt,calc,desc)=>L.push({sec,label,amt,calc,desc});

  /* ---- flat-rate units ---- */
  if(u==='golf'){
    add('Storage','Golf cart storage (incl. Heritage Harbor pickup & delivery)', PRICES.golfCart);
    return {lines:L, need, rq:[], flags:computeFlags_(s)};
  }
  if(u==='ebike'){
    add('Storage','E-bike storage — includes tune-up', PRICES.ebikeStorage);
    return {lines:L, need, rq:[], flags:computeFlags_(s)};
  }

  /* ---- jetski ---- */
  if(u==='jetski'){
    const g=s.engines.pwc;
    if(g.qty>0){
      const rate=PRICES[g.level].pwc;
      add('Winterization', `${g.level==='full'?'Full service':'Basic'} — PWC / Jetski${g.qty>1?` × ${g.qty}`:''}`, rate*g.qty, `${g.qty} × ${fmtMoney_(rate)}`, g.level==='full'?LEVEL_DESC.fullPwcQuote:LEVEL_DESC.basic);
    }
    if(s.skiDetail>0) add('Detailing', `Jetski detail${s.skiDetail>1?` × ${s.skiDetail}`:''}`, PRICES.skiDetail*s.skiDetail, `${s.skiDetail} × ${fmtMoney_(PRICES.skiDetail)}`);
    if(s.storage==='inside'){
      const len=s.skiLen||0, wid=s.skiWid||0;
      if(len&&wid) add('Storage','Inside storage — on trailer', PRICES.insideT*len*wid, `${len}×${wid} sqft × $${PRICES.insideT}`);
      else need.push('stored length & width for inside storage');
      add('Retrieval','Retrieve, set & relaunch — included with inside storage', 0);
    }
    if(s.lateRetrieval) add('Misc','Late retrieval surcharge (after '+SEASON.payByShort+')', PRICES.lateRetrieval);
    if(s.hho && !s.slipNo) need.push('your slip number for the Heritage Harbor Slipholder discount');
    return {lines:L, need, rq:hhoRequest_(s)?[hhoRequest_(s)]:[], flags:computeFlags_(s)};
  }

  /* ---- boat ---- */
  for(const e of BOAT_ENGINES){
    const g=s.engines[e.id];
    if(g.qty>0){
      const rate=PRICES[g.level][e.id];
      add('Engine winterization', `${g.level==='full'?'Full service':'Basic'} — ${e.name}${g.qty>1?` × ${g.qty}`:''}`, rate*g.qty, `${g.qty} × ${fmtMoney_(rate)}`, g.level==='full'?LEVEL_DESC.fullQuote:LEVEL_DESC.basic);
    }
  }
  if(s.dtTrans>0) add('Drive train','Transmission or V-drive'+(s.dtTrans>1?` × ${s.dtTrans}`:''), PRICES.dtTrans*s.dtTrans, `${s.dtTrans} × ${fmtMoney_(PRICES.dtTrans)}`);
  if(s.dtTransom>0) add('Drive train','I/O transom service'+(s.dtTransom>1?` × ${s.dtTransom}`:''), PRICES.dtTransom*s.dtTransom, `${s.dtTransom} × ${fmtMoney_(PRICES.dtTransom)}`);

  if(s.ballast>0) add('Water systems',`Ballast drain × ${s.ballast} tank${s.ballast>1?'s':''}`, PRICES.ballast*s.ballast, `${s.ballast} × ${fmtMoney_(PRICES.ballast)}`);
  if(s.waterCold) add('Water systems','Water system — cold only', PRICES.waterCold);
  if(s.waterHead) add('Water systems','Water system incl. 1 head', PRICES.waterHead);
  if(s.waterHead && s.addlHeads>0) add('Water systems',`Additional heads × ${s.addlHeads}`, PRICES.addlHeads*s.addlHeads, `${s.addlHeads} × ${fmtMoney_(PRICES.addlHeads)}`);
  if(s.pumpout) add('Water systems','Pumpout service charge', PRICES.pumpout);
  if(s.ac) add('Water systems','Air conditioning (up to 2 units)', PRICES.ac);
  if(s.genBasic) add('Water systems','Generator — basic', PRICES.genBasic);
  if(s.genFull) add('Water systems','Generator — oil & filter', PRICES.genFull);

  if(s.storage==='outside'){
    if(loa) add('Storage','Outside storage', PRICES.outsidePerFt*loa, `${loa} ft × ${fmtMoney_(PRICES.outsidePerFt)}`); else need.push('LOA for outside storage');
  }
  if(s.storage==='inside'||s.storage==='insidePrem'){
    const prem=s.storage==='insidePrem';
    const name=(prem?'Premium inside':'Inside (non-heated)')+' storage'+(prem?' (pending Quest approval)':'');
    if(T){
      const r=prem?PRICES.insidePremT:PRICES.insideT;
      if(lwt&&beam) add('Storage',name+' — on trailer', r*lwt*beam, `${lwt}×${beam} sqft × $${r}`); else need.push('LWT & beam for on-trailer inside storage');
    }else{
      const r=prem?PRICES.insidePremNT:PRICES.insideNT;
      if(loa&&beam) add('Storage',name+' — non-trailer', r*loa*beam, `${loa}×${beam} sqft × $${r}`); else need.push('LOA & beam for inside storage');
    }
  }

  const insideSel=s.storage==='inside'||s.storage==='insidePrem';
  if(!insideSel){
    if(s.retrieval==='quest' && !T){
      const rate=loa<=RULES.retrieveSmallMaxLOA?PRICES.retrieveSmall:PRICES.retrieveLarge;
      if(loa) add('Retrieval',`Retrieve, set & relaunch (${loa<=RULES.retrieveSmallMaxLOA?'≤':'>'}${RULES.retrieveSmallMaxLOA}')`, rate*loa, `${loa} ft × ${fmtMoney_(rate)}`); else need.push('LOA for retrieval');
    }else if(s.retrieval==='custTrailer' && T){
      add('Retrieval','Retrieve & relaunch, customer trailer', PRICES.retrieveCustTrailer);
    }
  }
  if(insideSel) add('Retrieval','Retrieve, set & relaunch — included with inside storage', 0);

  if((s.storage==='outside'||insideSel) && !T){
    const pont=!!s.isPontoon;
    add('Blocking & washing','Blocking, stands & handling (non-trailer'+(pont?', pontoon':'')+')',
        pont?PRICES.blockingPontoon:PRICES.blocking);
  }

  if(s.wrap){
    const w=wrapAuto(s);
    if(w.amt==null){ need.push(loa?'beam for shrinkwrap':'LOA for shrinkwrap'); }
    else if(w.split){ for(const pair of w.split) add('Shrinkwrap',pair[0],pair[1],pair[2]); }
    else add('Shrinkwrap',`Shrinkwrap package (${w.type})`, w.amt);
    if(s.inWater){
      if(loa) add('Shrinkwrap','Additional in-water wrap labor', PRICES.wrapInWaterFt*loa, `${loa} ft × ${fmtMoney_(PRICES.wrapInWaterFt)}`); else need.push('LOA for in-water wrap');
    }
  }

  if(s.powerwash && !s.acidWash){
    if(loa) add('Blocking & washing','Powerwash hull', PRICES.powerwashFt*loa, `${loa} ft × ${fmtMoney_(PRICES.powerwashFt)}`); else need.push('LOA for powerwash');
  }
  if(s.acidWash){
    if(loa&&beam){
      const r=beam<=RULES.acidBeamMax?PRICES.acidNarrowFt:PRICES.acidWideFt;
      add('Blocking & washing',`Acid wash hull (${beam<=RULES.acidBeamMax?'≤':'>'}${RULES.acidBeamMax}' beam)`, r*loa, `${loa} ft × ${fmtMoney_(r)}`);
    } else need.push(loa?'beam for acid wash':'LOA & beam for acid wash');
  }
  if(s.lateRetrieval) add('Misc','Late retrieval surcharge (after '+SEASON.payByShort+')', PRICES.lateRetrieval);
  if(s.hho && !s.slipNo) need.push('your slip number for the Heritage Harbor Slipholder discount');

  const rq=QUOTE_ITEMS.filter(function(p){return s[p[0]];}).map(function(p){return p[1];});
  if(hhoRequest_(s)) rq.push(hhoRequest_(s));
  return {lines:L, need, rq, flags:computeFlags_(s)};
}

/* Which spreadsheet tab a quote belongs on. Shared because BOTH sides decide
   it now: the page on save, and the console when staff move a unit. Two copies
   of this would put a quote on one tab and look for it on another. */
function storageTabFor(s){
  if(s.unit==='golf') return 'Golf Cart';
  if(s.unit==='ebike') return 'E-Bike';
  if(s.storage==='outside') return 'Outside';
  if(s.storage==='inside') return 'Inside';
  if(s.storage==='insidePrem') return 'Premium Inside';
  return 'No Storage';
}

/* The human-readable dimension line shown in the sheet, the PDF and emails.
   Shared for the same reason: the console can now change dimensions, so it has
   to be able to rewrite this string exactly the way the page first wrote it. */
function dimsString(s){
  if(s.unit==='boat'){
    return [ s.loa?('LOA '+fmtFtIn(s.loa)):'', s.beam?('B '+fmtFtIn(s.beam)):'',
             (s.hasTrailer&&s.lwt)?('LWT '+fmtFtIn(s.lwt)):'',
             s.hasTrailer?'trailer':'no trailer' ].filter(Boolean).join(' · ');
  }
  if(s.unit==='jetski'){
    return [ s.skiLen?('stored L '+fmtFtIn(s.skiLen)):'',
             s.skiWid?('stored W '+fmtFtIn(s.skiWid)):'' ].filter(Boolean).join(' · ');
  }
  if(s.unit==='golf') return s.hhoAddr?('HHO: '+s.hhoAddr):'';
  return '';
}

/* One phone format for the whole system: (815) 555-0123, everywhere a number
   is shown. Shared for the same reason as dimsString — the page formats what
   somebody types, the server formats what it writes to the sheet, prints on
   the PDF and sends in an email, and the two must not disagree.

   It only ever reformats a number it is sure of: ten digits, or eleven
   starting with the country code. Anything else — an extension, an
   international number, a half-typed one, or a note somebody put in the box —
   comes back exactly as it went in. Mangling a number nobody can call is worse
   than showing it unformatted. Formatting an already-formatted number returns
   the same string, so it is safe to apply more than once. */
function fmtPhone(v){
  const raw = String(v == null ? '' : v).trim();
  let d = raw.replace(/\D/g, '');
  if(d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  if(d.length !== 10) return raw;
  return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
}

/* The same rule applied while somebody is still typing, for the live mask on
   the quote page. Partial input is formatted as far as it goes; anything that
   is not a plain 10-digit US number is left alone so the field never fights
   the person filling it in. */
function fmtPhonePartial(v){
  const raw = String(v == null ? '' : v);
  if(/[a-zA-Z]/.test(raw)) return raw;         // "ext", "call after 5" — leave it
  let d = raw.replace(/\D/g, '');
  if(d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  if(d.length > 10) return raw;                 // longer than a US number: not ours to format
  if(d.length > 6) return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
  if(d.length > 3) return '(' + d.slice(0,3) + ') ' + d.slice(3);
  if(d.length > 0) return '(' + d;
  return '';
}

/* The dimension fields that actually drive price, per unit type. The console's
   editor renders exactly these, so a new priced dimension shows up there by
   adding it here rather than by remembering to touch the console too. */
const DIM_FIELDS = {
  boat:   [['loa','LOA (ft)'],['beam','Beam (ft)'],['lwt','Length with trailer (ft)']],
  jetski: [['skiLen','Stored length (ft)'],['skiWid','Stored width (ft)']],
  golf:   [],
  ebike:  []
};
// ENGINE-END

  const API = { SEASON, PRICES, RULES, LEVEL_DESC, BOAT_ENGINES, QUOTE_ITEMS, DIM_FIELDS,
                wrapAuto, computeQuote, fmtMoney_, storageTabFor, dimsString,
                fmtPhone, fmtPhonePartial, fmtFtIn, ftInToDecimal, fullDelta,
                depositBaseFor, isDiscountRequest, DISCOUNT_REQUESTS };
  root.QuestPricing = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
