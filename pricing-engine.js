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
  /* Impeller change stays a QUOTE_ITEMS request — boat-to-boat variance is
     too wide to price outright — but showing a baseline next to the checkbox
     gives customers something to plan around. Display only; not a priced
     line, so this number is never added into any total. */
  impellerStartingAt:225,
  /* Blocking a pontoon is a different job from blocking a deep-V on stands.
     Both rates are $185 for 2025-2026; Chris splits them at the 2026-2027
     rollover, and this is already wired so that is a one-number edit here
     rather than a change to the engine. */
  blocking:185, blockingPontoon:185,
};
/* Jet-drive boats winterize exactly like a PWC/jetski — no drive oil, no
   gimbal ring, none of the shaft-drive steps — so this ALIASES the pwc rate
   rather than carrying a second number that could quietly drift from it at
   the next season rollover. Update pwc above and jet follows automatically. */
PRICES.basic.jet = PRICES.basic.pwc;
PRICES.full.jet = PRICES.full.pwc;

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

/* ----------------------------------------------------------------------------
   PROVISIONAL PRICING — the one switch that turns every estimate disclaimer
   on, and off again.
   ----------------------------------------------------------------------------
   PRICES above still holds last season's numbers because the next rate card
   is not published yet, so every quote we hand out is an ESTIMATE: a deposit
   reserves a storage space and a place in the retrieval order, it does not
   hold a price. While `provisional` is true, the banner on the quote page,
   the wording on the pay step, the live ticket, the PDF and every customer
   email say exactly that — all of them from `pricingNotice()` and
   `lockinCopy()` below, so there is one wording rather than six copies that
   drift apart.

   AT THE ROLLOVER: update PRICES, then set `provisional:false`. That single
   edit removes every disclaimer from page, PDF and email at once and puts the
   ordinary lock-in wording back — there is nothing else to go find.
   `tools/check-pricing-notice.js` proves both halves: the disclaimer is on
   every surface while the flag is true, and gone from all of them when it is
   false.
---------------------------------------------------------------------------- */
const PRICING = {
  provisional: true,
  ratesLabel:  '2025–2026',   // the season the numbers in PRICES came from
  nextLabel:   '2026–2027',   // the season they are being updated to
};

/* ----------------------------------------------------------------------------
   ADOBE SIGN WEB FORM — the signing hand-off.
   ----------------------------------------------------------------------------
   `webFormUrl` is the published web form URL. Empty it and the quote page
   falls back to the "signing almost here" placeholder and no email carries a
   sign button — so this one string is the on switch for the whole signing
   step, page AND email, and the kill switch if the form ever has a bad day.

   It lives in the engine rather than in the page's INTEGRATIONS block because
   BOTH sides build the link: the page for the customer sitting in front of it,
   the server for the sign button in every email it sends. Two copies would
   drift the moment Adobe re-publishes the form under a new wid.

   `fields` maps what we know to the FIELD NAMES ON THE ADOBE FORM. Each key
   here must match the field's name in the Acrobat Sign authoring tool exactly,
   character for character and case for case, and that field must have
   "Default value may come from URL" checked in its properties. A name that
   does not match is not an error — Adobe silently leaves the field blank — so
   a renamed field fails quietly and forever. Test one live link after any
   change here. Full setup steps and the current field list:
   docs/adobe-webform-field-map.md.

   Adding a third pre-filled field later is one line in `fields` and one line
   in signUrlFor below — only text fields work this way; checkboxes and
   dropdowns need separate handling.
---------------------------------------------------------------------------- */
const SIGNING = {
  webFormUrl: 'https://na3.documents.adobe.com/public/esignWidget?wid=CBFCIBAA3AAABLblqZhD_H9Z6wlwlhi9HgnMlxUkxv9O4Da6Wup4QyROF6Ev-0BGnkrRVBxCtC9Y642eshIU*',
  /* THE NAMES ON THE ADOBE FORM, character for character and case for case.
     Underscores, no spaces — which is what Adobe recommends and what the live
     form uses. Rename one side without the other and nothing errors: Adobe
     just leaves the field blank, on every contract, until somebody notices.
     tools/check-sign-link.js holds these to the table in
     docs/adobe-webform-field-map.md, but nothing here can see the Adobe side,
     so a live test link is the only real check after a rename. */
  fields: {
    quoteNo: 'Quote_Number',
    slipNo:  'Slip_Number',
  },
};
/* ========================= END ANNUAL UPDATE ZONE ========================= */

/* The estimate disclaimer itself, in one place. Returns null — not an empty
   string — once pricing is current, so a caller that forgets to check renders
   nothing rather than an empty box, and the guard can assert on it.
     heading/body : the page banner
     short        : the one-paragraph version for the ticket, the PDF and email
   Phrased so it reads correctly on a quote and on an invoice, since the same
   text rides both. */
function pricingNotice(){
  if(!PRICING.provisional) return null;
  const r = PRICING.ratesLabel, n = PRICING.nextLabel;
  return {
    heading: 'Heads up — these prices are ' + r + ' estimates',
    body: 'Our ' + n + ' winter rates are not published yet, so every price shown here uses last season\'s ' +
          r + ' rates and is an estimate. A deposit reserves your storage space and your place in the ' +
          'retrieval order — it does not lock in the prices shown. We expect ' + n + ' pricing very soon; ' +
          'your quote will be updated to those rates and we will send you the new total. ' +
          'Questions? Call us at (815) 433-2200.',
    short: 'Estimate only — priced at ' + r + ' rates. ' + n + ' rates are not published yet. A deposit ' +
           'reserves your storage space and your place in the retrieval order, but does not lock in the prices ' +
           'shown. Totals will be updated to ' + n + ' rates as soon as they are released.'
  };
}

/* The one sentence in the fine print that says whether paying holds a price.
   It is the heart of what a customer is being asked to trust, so it is built
   here rather than written out once on the page and again in the PDF. Takes
   the quote's own pay-by date when it has one, so an old quote keeps the date
   it was quoted under. */
function pricesValidSentence(payBy){
  const by = payBy || SEASON.payByDate;
  return PRICING.provisional
    ? 'Settling in full by ' + by + ' by cash, check, debit card, Zelle, or ACH avoids the card fee, but does not hold the prices shown: they are ' +
      PRICING.ratesLabel + ' estimates and will be updated to ' + PRICING.nextLabel + ' rates.'
    : 'Prices shown are valid when balances are settled in full by ' + by + ' by cash, check, debit card, Zelle, or ACH.';
}

/* Every phrase that promises a customer something is being locked in. While
   pricing is provisional a deposit buys a SPACE, not a price, and each of
   these says so; flipping the flag restores the ordinary wording. Page, PDF
   and email all read their copy from here — nothing hardcodes "lock in"
   ahead of a price we cannot yet honour. */
function lockinCopy(){
  const p = PRICING.provisional, n = PRICING.nextLabel;
  return {
    signHeading:   p ? 'Sign & reserve your spot' : 'Sign & lock it in',
    depositRow:    p ? 'Deposit due today to reserve your spot' : 'Deposit due today to lock in',
    depositEmail:  p ? 'Deposit to reserve your spot' : 'Deposit to lock in your spot',
    depositOptSub: p ? 'Reserves your storage space and retrieval window · balance due by ' + SEASON.payByShort + ', at ' + n + ' rates'
                     : 'Locks in your selections and retrieval window · balance due by ' + SEASON.payByShort,
    fullOptSub:    p ? 'Nothing further due — unless ' + n + ' rates change your total, and we will tell you if they do'
                     : 'Done and dusted — nothing due later',
    signPlaceholder: p ? 'pay your deposit online below to reserve your spot'
                       : 'pay your deposit online below to lock in your spot',
    reservedNote:  p ? ' Your deposit holds that spot at whatever the ' + n + ' rate turns out to be — it is not a price lock.'
                     : ''
  };
}

/* ============ PER-QUOTE PRICING EXCEPTIONS ============
   One-off negotiated rates for a specific customer, keyed by quote number.
   Deliberately kept OUTSIDE the Annual Update Zone above: a season-wide rate
   rollover only ever edits that block, so an entry here survives untouched
   through any future update to everyone else's pricing — exactly the point.
   Read ONLY by rateOverride_ below; nothing else ever consults this table,
   so a quote not listed here can never be affected by one that is.
   Remove an entry the moment its exception no longer applies. */
const QUOTE_RATE_OVERRIDES = {
  'QW-26-1991': { insideNT: 6.74 }   // negotiated inside/non-trailer rate — Sep 2026
};
/* Returns the override for this exact quote + rate key, or null if this quote
   has none — callers fall back to the normal PRICES value on null. */
function rateOverride_(s, key){
  const o = QUOTE_RATE_OVERRIDES[s && s.quoteNo];
  return (o && o[key] != null) ? o[key] : null;
}

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
  {id:'outboard', name:'Outboard', sub:'Basic includes drive oil change · Full subject to oil volume adjustment'},
  /* Some boats run a jet drive instead of a prop — same winterizing steps as
     a PWC/jetski, not a shaft-drive or sterndrive boat, so likePwc points the
     price lookup and the description text at the pwc rate/text (aliased
     above) instead of the boat-engine text, which lists steps a jet drive
     doesn't have (drive oil, gimbal ring). */
  {id:'jet', name:'Jet Drive', likePwc:true, sub:'Priced and winterized the same as PWC / Jetski'}
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
  /* No storage purchased means nothing is being locked in for the season —
     there is no deposit-now/balance-later split, the whole total comes due
     when the work itself is finished. A sentinel far above any real total
     makes the caller's Math.min(base,total) always resolve to the CURRENT
     total, so it stays correct even after a later edit changes that total;
     a frozen dollar amount would stop matching the moment the total moved. */
  if(s.storage==='none') return Number.MAX_SAFE_INTEGER;
  if(s.unit!=='boat') return RULES.depositTrailer;
  if(s.hasTrailer) return RULES.depositTrailer;
  return s.isPontoon ? RULES.depositNoTrailerPontoon : RULES.depositNoTrailer;
}

/* The total length-with-trailer, from the boat's own length and how far the
   trailer adds to it. Customers are asked for the overhang, not the total —
   guessing at a whole rig's length badly is easy, but "how far does the
   trailer stick out past your boat" is something most owners can eyeball or
   measure directly. This is the one formula that turns that into the LWT the
   rest of the system has always priced from, so page and server can never
   compute two different totals from the same overhang. */
function lwtFromOverhang(loa, overhang){
  const l=Number(loa)||0, o=Number(overhang)||0;
  /* Both pieces or neither — a boat length with no overhang yet typed must
     stay 0 (not-yet-priced), the same way a bare LWT box used to. Otherwise
     an unanswered overhang box would silently price as "trailer adds
     nothing," never asking the question at all. */
  if(!l || !o) return 0;
  return Math.round((l+o)*1000)/1000;
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
  /* tbd: this line prices at 0 today but is not free — the customer's own
     total decides it, and staff fill it in afterward. The ticket renderer
     prints "TBD" instead of "incl." when it sees this flag. */
  const add=(sec,label,amt,calc,desc,tbd)=>L.push({sec,label,amt,calc,desc,tbd});

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
    if(s.hho){
      if(!s.slipNo) need.push('your slip number for the Heritage Harbor Slipholder discount');
      add('Misc','Heritage Harbor Slipholder'+(s.slipNo?` — slip ${s.slipNo}`:'')+' — discount applied by Quest', 0, '', '', true);
    }
    return {lines:L, need, rq:[], flags:computeFlags_(s)};
  }

  /* ---- boat ---- */
  for(const e of BOAT_ENGINES){
    /* A quote saved before a given engine id existed (jet drive, or whatever
       comes next) has no key for it at all — not zero, absent. Treat absent
       as zero rather than crashing every price/PDF/email on every quote
       that predates the id, on both the page and the server. */
    const g=s.engines[e.id] || {qty:0, level:'basic'};
    if(g.qty>0){
      const rate=PRICES[g.level][e.id];
      const fullText = e.likePwc ? LEVEL_DESC.fullPwcQuote : LEVEL_DESC.fullQuote;
      add('Engine winterization', `${g.level==='full'?'Full service':'Basic'} — ${e.name}${g.qty>1?` × ${g.qty}`:''}`, rate*g.qty, `${g.qty} × ${fmtMoney_(rate)}`, g.level==='full'?fullText:LEVEL_DESC.basic);
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
      const ntOverride=prem?null:rateOverride_(s,'insideNT');
      const r=prem?PRICES.insidePremNT:(ntOverride!=null?ntOverride:PRICES.insideNT);
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
  if(s.hho){
    if(!s.slipNo) need.push('your slip number for the Heritage Harbor Slipholder discount');
    add('Misc','Heritage Harbor Slipholder'+(s.slipNo?` — slip ${s.slipNo}`:'')+' — discount applied by Quest', 0, '', '', true);
  }

  const rq=QUOTE_ITEMS.filter(function(p){return s[p[0]];}).map(function(p){return p[1];});
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

/* The link that carries a customer into the Adobe Sign web form with their
   quote already filled in. Shared because both sides hand it out: the page
   embeds it in the sign step, the server puts it behind the "Review & sign"
   button in every customer email. The server's copy is the one that matters
   most — it is built fresh at send time from the quote's CURRENT slip, so a
   slip staff corrected in the console reaches Adobe, and quotes saved before
   the web form existed still get a working button.

   Pre-fill rides the URL FRAGMENT (#), not a query string (?): Acrobat Sign
   reads `#Field_Name=value&Other_Field=value`, key and value both encoded.
   Anything already after a # on the configured URL is dropped rather than
   appended to, so pasting a URL that already carries a fragment cannot produce
   two of them. Pass `embed:true` for the copy that goes in our own iframe.

   Returns '' when there is no web form configured yet or no quote number to
   send — an empty string every caller already treats as "no signing link",
   which is what keeps the placeholder showing and the email button hidden.
   The slip is optional by design: most units have none, and sending an empty
   one would blank a field staff may have filled in on the Adobe side. */
function signUrlFor(o){
  const base = String((SIGNING && SIGNING.webFormUrl) || '').trim().split('#')[0];
  const qn   = String((o && o.quoteNo) || '').trim();
  if(!base || !qn) return '';
  const slip = String((o && o.slipNo) || '').trim();
  /* The KEY is encoded as well as the value. A no-op for the two underscore
     names above, and deliberately kept: it is what makes a future field name
     with a space in it safe, and a raw space in a URL is not a URL — email
     clients each guess differently about where it ends. */
  const pair = (k, v) => encodeURIComponent(k) + '=' + encodeURIComponent(v);
  const parts = [ pair(SIGNING.fields.quoteNo, qn) ];
  if(slip) parts.push(pair(SIGNING.fields.slipNo, slip));
  /* `hosted=false` is what Adobe's own iframe snippet carries: it tells the
     widget it is embedded in somebody else's page rather than sitting on an
     Adobe-hosted page of its own. The quote page embeds; an emailed button
     opens the form directly, and must NOT carry it. */
  const url = (o && o.embed) && base.indexOf('hosted=') < 0
    ? base + (base.indexOf('?') > -1 ? '&' : '?') + 'hosted=false'
    : base;
  return url + '#' + parts.join('&');
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

  const API = { SEASON, PRICES, RULES, PRICING, SIGNING, LEVEL_DESC, BOAT_ENGINES, QUOTE_ITEMS, DIM_FIELDS,
                pricingNotice, lockinCopy, pricesValidSentence, signUrlFor,
                wrapAuto, computeQuote, fmtMoney_, storageTabFor, dimsString,
                fmtPhone, fmtPhonePartial, fmtFtIn, ftInToDecimal, fullDelta,
                depositBaseFor, lwtFromOverhang, rateOverride_ };
  root.QuestPricing = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
