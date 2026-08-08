/************************************************************************
 * QUEST WATERSPORTS — WINTER QUOTE LOGGER + PDF ARCHIVE
 * Google Apps Script web app. Receives quotes from the quote-builder page,
 * then:
 *   1. Generates a PDF of the quote and saves it to Google Drive
 *   2. Logs the quote to this spreadsheet (one tab per storage location)
 *      with a link to the PDF
 *   3. Emails service@questwatersports.com with the details + PDF link
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ACCOUNT SEPARATION — READ BEFORE DEPLOYING
 *  This is a QUEST WATERSPORTS business system. Deploy it ONLY under a
 *  Google account owned by Quest Watersports (e.g. a Quest Workspace
 *  account or a Quest-owned Gmail). The spreadsheet, the Drive folder,
 *  the Apps Script project, and the web-app deployment all live in
 *  whichever account clicks "Deploy" — so that account must be Quest's.
 *  Do NOT deploy from, or store any of this in, any personal account or
 *  any account used by other projects. Zero shared infrastructure.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── SETUP (one time, ~5 minutes, signed into the QUEST Google account) ─
 * 1. Create a new Google Sheet (e.g. "Winter Quotes 2025-26").
 * 2. Extensions → Apps Script. Delete the placeholder, paste this entire
 *    file, save.
 * 3. Deploy → New deployment → type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Deploy, authorize when prompted (it will ask for Sheets, Drive, and
 *    Mail permissions — that's the PDF archive and the notification
 *    email), and copy the Web app URL (ends in /exec).
 * 4. Paste that URL into INTEGRATIONS.quoteLogUrl at the top of the
 *    quote page's script. Done.
 *
 * Storage tabs (Inside, Premium Inside, Outside, No Storage, Golf Cart,
 * E-Bike) and the Drive folder are created automatically on first use.
 *
 * Repeat events for the same quote number (customer prints, then later
 * signs & pays) UPDATE the existing row and REPLACE the PDF, so each
 * quote lives once, at its latest status.
 *
 * ── ANNUAL UPDATE ─────────────────────────────────────────────────────
 * Change DRIVE_FOLDER_NAME for the new season and start a fresh sheet.
 * Season dates on the PDF come from the quote page's config automatically.
 ************************************************************************/

const NOTIFY_EMAIL = 'service@questwatersports.com';
const DRIVE_FOLDER_NAME = 'Winter Quotes 2025-26';
// OPTIONAL: after adding a "Send mail as" alias in this Google account's
// Gmail settings (using your email host's SMTP details), put that address
// here so notifications come from a questwatersports.com address instead
// of the Gmail address. Leave '' to send from the Gmail account directly.
const FROM_ALIAS = '';
// Customer-facing email settings
const PAYMENT_URL = 'https://pay.pospluslogin.com/questwatersports';
// Customer replies to quote emails go here (works regardless of FROM_ALIAS)
const REPLY_TO = 'service@questwatersports.com';
// Optional: public URL of the Quest logo PNG (e.g. upload Quest_wet_rect.png to
// the GitHub repo and use https://YOURUSER.github.io/winter-quotes/quest-logo.png).
// Leave '' for a text-only header in customer emails.
const LOGO_URL = 'https://raw.githubusercontent.com/QuestWS/winter-quotes_26-27/refs/heads/main/Quest%20wet%20rect.png';
// Auto-reminder: days after a quote is saved/emailed with no signature/payment
// before the customer gets one follow-up email. Run setupReminderTrigger() once
// from the editor to activate the daily check. Set REMINDER_ENABLED=false to pause.
const REMINDER_ENABLED = true;
const REMINDER_AFTER_DAYS = 10;
// Daily backup: full spreadsheet emailed as an Excel file. Run
// setupBackupTrigger() once from the editor to activate (6pm daily).
const BACKUP_EMAIL = 'chris@questwatersports.com';
// Unpaid-balance report: emailed to REPORT_EMAIL on the 1st (warning ahead of
// the mid-month fee) and 15th (fee day) of the months listed. Internal only —
// no customer emails are ever sent automatically.
const REPORT_EMAIL = 'chris@questwatersports.com';
// Public web-app URL of THIS script (same /exec address the quote page uses).
// Used for one-click buttons in customer emails. If the deployment is ever
// recreated (new URL), update this to match the page's quoteLogUrl.
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxv8kqGKXU_4-9TytfWzdrv-QqqmyrYLxRwd8FDfA8b47sX3NlEBNDlIwIHRuQObZbL9w/exec';
// Public URL of the CUSTOMER QUOTE PAGE (GitHub Pages). Used to build
// "pick your quote back up" links. Must end in a trailing slash.
const QUOTE_PAGE_URL = 'https://questws.github.io/winter-quotes_26-27/';
const REPORT_MONTHS = [11, 12, 1, 2, 3, 4];
// Percentages used when recalculating totals after a manual adjustment
const ADJ_CC_PCT = 3;
const ADJ_LATE_PCT = 10;

const HEADERS = [
  'Last Name','First Name','Quote #','Balance','Timestamp','Status','Unit','Phone','Email',
  'Year/Make/Model','Dimensions','Total','Deposit','Pay choice',
  'Itemized services','Quotes requested','Customer notes','Quote PDF',
  'Sign link','Reminder','Payload','Paid','Photos'
];
// Column numbers — single source of truth for every read/write below
/* ---------------------------------------------------------------------------
   LEAD CAPTURE — quotes that were started but not completed.
   The customer page logs a row the moment someone passes the contact gate, so
   an abandoned build still leaves a timestamped record (who accessed the
   pricing, and which terms version they accepted).

   These rows live on their own tab so they never mix with real storage
   locations, and they are excluded from EVERY customer-facing email sweep.
   That exclusion is the load-bearing part: dailyReminderCheck() runs on its
   own at 9am and would otherwise email a stranger — or a competitor — a
   "your quote is waiting" nudge ten days after they poked at the pricing.
   The row still moves onto a real tab by the normal duplicate sweep once the
   quote is completed, so completing a quote never leaves a second row.
--------------------------------------------------------------------------- */
const STARTED_TAB = 'Quote Started';
const STARTED_STATUS = 'Quote started';
function isStartedTab_(name) { return String(name) === STARTED_TAB; }
function isStartedQuote_(d) { return String((d && d.storageTab) || '') === STARTED_TAB; }

const COL = { LAST:1, FIRST:2, QN:3, BAL:4, TS:5, STATUS:6, UNIT:7, PHONE:8, EMAIL:9,
  YMM:10, DIMS:11, TOTAL:12, DEP:13, PAY:14, ITEMS:15, RQ:16, NOTES:17, PDF:18,
  SIGN:19, REM:20, PAYLOAD:21, PAID:22, PHOTOS:23 };

/* ===========================================================================
   SHARED PRICING ENGINE — VERBATIM COPY. DO NOT HAND-EDIT.
   ---------------------------------------------------------------------------
   The rules below are the same ones the customer page runs. They live in
   pricing-engine.js; this is a copy, because Apps Script cannot fetch that
   file at runtime.

   To change a price or a rule: edit pricing-engine.js, run
   `node tools/sync-engine.js`, and commit both files. tools/verify.sh diffs
   the two copies and fails the build if they drift, so an edit made here
   instead is caught rather than shipped.
=========================================================================== */
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
  powerwashFt:5.39, acidNarrowFt:17, acidWideFt:22, blocking:185, lateRetrieval:225,
};

const RULES = {
  latePct:10,
  ccPct:3,
  depositTrailer:500,
  depositNoTrailer:1000,
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
  ['intWipe','Interior wipe-down']
];

/* Money formatter for the `calc` recipe strings. Deliberately NOT
   toLocaleString: Apps Script's Intl support is less predictable than the
   browser's, and calc strings are compared byte-for-byte by the drift alarm.
   Verified identical to the page's old formatter across every rate in use. */
function fmtMoney_(n){ return '$'+Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); }

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
    if(s.hho) add('Misc','Heritage Harbor Slipholder'+(s.slipNo?` — slip ${s.slipNo}`:'')+' — discount applied by Quest', 0);
    return {lines:L, need, rq:[], flags:computeFlags_(s)};
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
    const name=(prem?'Premium inside':'Inside')+' storage'+(prem?' (pending Quest approval)':'');
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
    add('Blocking & washing','Blocking, stands & handling (non-trailer)', PRICES.blocking);
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
  if(s.hho) add('Misc','Heritage Harbor Slipholder'+(s.slipNo?` — slip ${s.slipNo}`:'')+' — discount applied by Quest', 0);

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

/* The human-readable dimension line shown in the sheet, the PDF and emails.
   Shared for the same reason: the console can now change dimensions, so it has
   to be able to rewrite this string exactly the way the page first wrote it. */
function dimsString(s){
  if(s.unit==='boat'){
    return [ s.loa?('LOA '+s.loa+"'"):'', s.beam?('B '+s.beam+"'"):'',
             (s.hasTrailer&&s.lwt)?('LWT '+s.lwt+"'"):'',
             s.hasTrailer?'trailer':'no trailer' ].filter(Boolean).join(' · ');
  }
  if(s.unit==='jetski'){
    return [ s.skiLen?('stored L '+s.skiLen+"'"):'',
             s.skiWid?('stored W '+s.skiWid+"'"):'' ].filter(Boolean).join(' · ');
  }
  if(s.unit==='golf') return s.hhoAddr?('HHO: '+s.hhoAddr):'';
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

function doPost(e) {
  try {
    let d = JSON.parse(e.postData.contents);

    // ---- Staff console API (the GitHub admin site posts here) ----
    if (d.api === 'console') {
      const json = function (obj) {
        return ContentService.createTextOutput(JSON.stringify(obj))
          .setMimeType(ContentService.MimeType.JSON);
      };
      try {
        const FNS = {
          auth:        function (a) { return adminAuth(a[0]); },
          lookup:      function (a) { return adminLookup(d.token, a[0]); },
          quoteHtml:   function (a) { return adminQuoteHtml(d.token, a[0]); },
          dimsPreview: function (a) { return adminDimsPreview(d.token, a[0], a[1]); },
          dimsApply:   function (a) { return adminDimsApply(d.token, a[0], a[1], a[2]); },
          pay:         function (a) { return adminRecordPayment(d.token, a[0], a[1], a[2], a[3]); },
          adjust:      function (a) { return adminAdjust(d.token, a[0], a[1], a[2], a[3]); },
          sendEmail:   function (a) { return adminSendEmail(d.token, a[0], a[1], a[2]); },
          search:      function (a) { return adminSearch(d.token, a[0]); },
          lateFee:     function (a) { return adminLateFee(d.token, a[0], a[1], a[2], a[3]); },
          storageView: function (a) { return adminStorageView(d.token); },
          photoInfo:   function (a) { return adminPhotoInfo(d.token, a[0]); },
          uploadPhoto: function (a) { return adminUploadPhoto(d.token, a[0], a[1], a[2], a[3], a[4]); },
          uploadContract: function (a) { return adminUploadContract(d.token, a[0], a[1], a[2], a[3]); },
          editLine:    function (a) { return adminEditLine(d.token, a[0], a[1], a[2], a[3], a[4]); },
          emailPreview:function (a) { return adminEmailPreview(d.token, a[0], a[1], a[2]); },
          priceRequest:function (a) { return adminPriceRequest(d.token, a[0], a[1], a[2], a[3]); },
          setSeasonDone:function (a) { return adminSetSeasonDone(d.token, a[0], a[1], a[2], a[3]); },
          listStaff:   function (a) { return adminListStaff(d.token); },
          setPerm:     function (a) { return adminSetPerm(d.token, a[0], a[1], a[2]); },
          resetPin:    function (a) { return adminResetPin(d.token, a[0]); },
          addStaff:    function (a) { return adminAddStaff(d.token, a[0], a[1], a[2]); },
          removeStaff: function (a) { return adminRemoveStaff(d.token, a[0]); },
          backupPreview: function (a) { return adminBackupPreview(d.token, a[0], a[1]); },
          backupRestore: function (a) { return adminBackupRestore(d.token, a[0], a[1], a[2]); }
        };
        if (!FNS[d.fn]) return json({ ok: 0, error: 'Unknown function.' });
        return json(FNS[d.fn](d.args || []));
      } catch (err) {
        return json({ ok: 0, error: String(err.message || err) });
      }
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    /* 1) READ every prior copy of this quote. Its payload governs merging and
       locking, and its reminder/photo cells carry over.

       Nothing is deleted here. The destination tab is not settled until after
       the merge below, because a staff relocation (manual.measured.storage)
       can move the quote to a different tab than the one the browser posted.
       Deleting against the posted tab and then writing to the rebuilt one
       would leave the quote on two tabs at once. Deletion happens in step 3b,
       once the final tab is known. */
    let carriedReminder = '';
    let oldPayloadJson = '';
    let oldPhotos = '';
    const postedTab = d.storageTab || 'No Storage';
    const copies = [];   // {sheet, row} for every copy found, in scan order
    ss.getSheets().forEach(function (other) {
      if (other.getRange(1, 3).getValue() !== 'Quote #') return;
      let r = findQuoteRow_(other, d.quoteNo);
      while (r > 0) {
        const remCell = String(other.getRange(r, COL.REM).getValue() || '');
        /* A lead's follow-up marker lives in the reminder column (the lead tab
           is skipped by dailyReminderCheck, so the column is free there). It
           must NOT ride along when the quote graduates to a real tab, or the
           genuine 10-day reminder would see a reminder already sent and stay
           silent forever. */
        if (!(isLeadFollowUpMark_(remCell) && !isStartedTab_(postedTab))) {
          carriedReminder = carriedReminder || remCell;
        }
        oldPayloadJson = oldPayloadJson || String(other.getRange(r, COL.PAYLOAD).getValue() || '');
        oldPhotos = oldPhotos || String(other.getRange(r, COL.PHOTOS).getValue() || '');
        copies.push({ sheet: other, row: r });
        r = findQuoteRowFrom_(other, d.quoteNo, r + 1);
      }
    });

    // 2) Merge / LOCK. Once a payment exists, the customer page may no longer
    //    change the quote — a locked save keeps the official version and only
    //    adopts the incoming status/pay intent.
    let manualRes = null;
    let cross = null;
    let driftNote = '';
    let oldD = {};
    try { oldD = oldPayloadJson ? JSON.parse(oldPayloadJson) : {}; } catch (err) {}
    const lockedByPayment = !!(oldD.payments && oldD.payments.length);
    if (lockedByPayment) {
      const incomingStatus = d.status, incomingPay = d.payMode, wantsEmail = d.emailCustomer;
      reconcileManual_(oldD);
      d = oldD;
      d.status = incomingStatus || d.status;
      d.payMode = incomingPay || d.payMode;
      d.emailCustomer = wantsEmail;
      d.ts = new Date().toISOString();
      d._manualNote = 'LOCKED (payment on file): customer save kept the official quote; only status updated.';
    } else {
      if (oldD.payments && oldD.payments.length) d.payments = oldD.payments;
      reconcileManual_(oldD);
      if (!d.manual && oldD.manual) d.manual = oldD.manual;
      /* Price it ourselves from the customer's selections, then replay the
         staff journal onto those clean lines exactly once. A lead row has no
         selections yet, so there is nothing to price and nothing to compare. */
      if (!isStartedQuote_(d)) {
        cross = rebuildLinesFromState_(d);
        if (d.manual) manualRes = applyManualOps_(d);
        else if (cross.rebuilt) recomputeTotals_(d);
        driftNote = driftNoteFor_(d, cross);
        /* Persist it: the row is written further down, so setting it here puts
           the warning in the stored payload and not only in a passing email. */
        if (driftNote) d._driftNote = driftNote; else delete d._driftNote;
      } else if (d.manual) {
        manualRes = applyManualOps_(d);
      }
    }

    // 3) Target tab (locked quotes stay on their original tab)
    const tabName = d.storageTab || 'No Storage';
    let sh = ss.getSheetByName(tabName);
    if (!sh) {
      sh = ss.insertSheet(tabName);
      sh.appendRow(HEADERS);
      sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }

    /* 3b) NOW clear the stale copies, with the destination finally settled.
       Keep the first copy already sitting on the destination tab (step 5 will
       overwrite it in place, preserving its position) and delete every other
       copy anywhere. Deleting bottom-up within a sheet keeps the remaining row
       numbers valid as we go. */
    pruneQuoteCopies_(copies, tabName);

    // 4) PDF after merge/lock — always the official version.
    //    A started quote has no selections yet, so there is nothing to render:
    //    skip it, and make sure no customer copy can be sent for a lead row.
    const startedRow = isStartedQuote_(d);
    if (startedRow) d.emailCustomer = 0;
    const pdfUrl = startedRow ? '' : savePdf_(d);

    // 5) Row in the new column order
    const paid0 = paymentsTotal_(d);
    const row = [
      d.lastName || String(d.owner || '').split(' ').slice(-1)[0] || '',
      d.firstName || String(d.owner || '').split(' ').slice(0, -1).join(' ') || '',
      d.quoteNo || '',
      Number(d.total || 0) - paid0,
      new Date(d.ts || Date.now()),
      d.status || '',
      d.unit || '',
      d.phone || '',
      d.email || '',
      d.ymm || '',
      d.dims || '',
      Number(d.total || 0),
      Number(d.deposit || 0),
      d.payMode || '',
      d.items || '',
      d.quotesRequested || '',
      d.notes || '',
      pdfUrl || '',
      d.adobeUrl || '',
      '',
      JSON.stringify(d),
      paid0,
      oldPhotos || (d.photosUrl || '')
    ];
    const existing = findQuoteRow_(sh, d.quoteNo);
    const rowNum = existing > 0 ? existing : sh.getLastRow() + 1;
    if (existing > 0) {
      row[COL.REM - 1] = sh.getRange(rowNum, COL.REM).getValue() || carriedReminder;
      row[COL.PHOTOS - 1] = sh.getRange(rowNum, COL.PHOTOS).getValue() || row[COL.PHOTOS - 1];
    } else row[COL.REM - 1] = carriedReminder;
    if (sh.getRange(1, HEADERS.length).getValue() !== HEADERS[HEADERS.length-1]) {
      sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    }
    sh.getRange(rowNum, 1, 1, row.length).setValues([row]);
    sh.getRange(rowNum, COL.TOTAL, 1, 2).setNumberFormat('$#,##0.00');
    sh.getRange(rowNum, COL.ITEMS).setWrap(true);
    writeMoneyCols_(sh, rowNum, d);
    if (manualRes) d._manualNote = 'Quest changes re-applied: ' + manualRes.applied +
      (manualRes.skipped ? ' · could NOT re-apply ' + manualRes.skipped + ' (' + manualRes.notes.join('; ') + ') — REVIEW THIS QUOTE' : '');

    // 3) Email service@
    sendNotification_(d, tabName, existing > 0, pdfUrl);

    // 4) Customer copy, when the Email-me button was used
    if (d.emailCustomer && d.email) { sendCustomerEmail_(d); recordEmail_(sh, rowNum, d, 'quote copy', 'Quote page'); }
    return ContentService.createTextOutput('ok');
  } catch (err) {
    console.error('Quote log failed: ' + err);
    return ContentService.createTextOutput('error');
  }
}

/* ================= QUOTE LOOKUP (load-my-quote on the page) =================
 * GET ?quote=QW-26-XXXX&ln=LastName&callback=fn  ->  JSONP with saved state.
 * Requires BOTH the quote number and a matching last name, so quote numbers
 * alone can't be enumerated to pull up someone else's contact details. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const cb = String(p.callback || '').replace(/[^\w$.]/g, '');
  const out = function (obj) {
    if (cb) {
      return ContentService.createTextOutput(cb + '(' + JSON.stringify(obj) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  };
  // staff console
  if (p.page === 'admin') {
    return HtmlService.createHtmlOutput(adminPage_())
      .setTitle('Quest Staff Console')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  /* Resume check: does this person already have an UNFINISHED quote?
     Called from the contact gate before a new quote number is minted, so a
     customer who wanders off and comes back does not accumulate duplicates.

     Scope is deliberately narrow: it only ever looks at the lead tab, and it
     requires BOTH the email and the last name to match. Lead rows hold no
     pricing and no selections -- just contact details the caller has already
     typed -- so the worst this can reveal is that an address started a quote.
     It must never be widened to real quote tabs: that would turn an email
     address into a way to pull somebody's priced quote, which today needs the
     quote number. */
  if (p.action === 'findlead') {
    try {
      const em = String(p.email || '').trim().toLowerCase();
      const ln = String(p.ln || '').trim().toLowerCase();
      if (!em || !ln) return out({ ok: 0 });
      const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STARTED_TAB);
      if (!sh) return out({ ok: 0 });
      const last = sh.getLastRow();
      if (last < 2) return out({ ok: 0 });
      const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
      for (let i = rows.length - 1; i >= 0; i--) {   // most recent first
        const r = rows[i];
        if (String(r[COL.EMAIL - 1] || '').trim().toLowerCase() !== em) continue;
        if (String(r[COL.LAST - 1] || '').trim().toLowerCase() !== ln) continue;
        const ts = r[COL.TS - 1];
        return out({
          ok: 1,
          quoteNo: String(r[COL.QN - 1] || ''),
          startedAt: (ts instanceof Date) ? ts.toLocaleDateString() : '',
          unit: String(r[COL.UNIT - 1] || '')
        });
      }
      return out({ ok: 0 });
    } catch (err) { return out({ ok: 0, error: String(err) }); }
  }

  // season-done survey from the quote email
  if (p.action === 'seasondone') {
    try {
      const qn2 = String(p.quote || '').trim().toUpperCase();
      const ln2 = String(p.ln || '').trim().toLowerCase();
      const choice = String(p.done || '');
      // if they picked "date" but haven't supplied one yet, show a tiny date form
      if (choice === 'date' && !p.d) {
        const feeAmt = 225; // display only; server recomputes from the quote's own season data
        return HtmlService.createHtmlOutput(
          '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
          'body{font-family:Arial,Helvetica,sans-serif;background:#EBF1F6;margin:0;color:#14293E}' +
          '.card{max-width:460px;margin:8vh auto;background:#fff;border:1px solid #C7D5E0;border-radius:14px;padding:26px 24px;box-shadow:0 2px 12px rgba(20,41,62,.1)}' +
          'h2{margin:0 0 6px}.sub{color:#5C7185;font-size:14px;margin-bottom:16px}' +
          'label{display:block;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#5C7185;margin:12px 0 5px}' +
          'input,textarea{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1.5px solid #C7D5E0;border-radius:9px;font-family:inherit}' +
          '.warn{display:none;background:#FBEEE2;border:1px solid #E4B48F;color:#A6541F;border-radius:9px;padding:11px 13px;font-size:13.5px;margin-top:10px}' +
          '.warn.show{display:block}button{margin-top:16px;width:100%;background:#14293E;color:#fff;border:0;border-radius:9px;padding:14px;font-size:16px;font-weight:bold;cursor:pointer}' +
          '</style></head><body><div class="card">' +
          '<h2>When will you be done?</h2><div class="sub">Pick the date you expect to be finished on the water for the season, so we can schedule your haul-out.</div>' +
          '<form>' +
          '<input type="hidden" name="action" value="seasondone"><input type="hidden" name="quote" value="' + encodeURIComponent(qn2) + '">' +
          '<input type="hidden" name="ln" value="' + encodeURIComponent(ln2) + '"><input type="hidden" name="done" value="date">' +
          '<label>Your finish date</label><input type="date" id="d" name="d" required>' +
          '<div class="warn" id="warn">Heads up: dates after November 15 include a <b>late retrieval surcharge of $' + feeAmt + '</b>, which we\'ll add to your balance.</div>' +
          '<label>Notes (optional)</label><textarea name="note" rows="3" placeholder="Anything we should know about timing or access?"></textarea>' +
          '<button type="submit">Save my date</button></form></div>' +
          '<script>var el=document.getElementById("d");el.addEventListener("change",function(){' +
          'var v=new Date(el.value+"T00:00:00");var cut=new Date(v.getFullYear(),10,15);' +
          'document.getElementById("warn").className=(!isNaN(v)&&v>cut)?"warn show":"warn";});</scr'+'ipt></body></html>');
      }
      const ss2 = SpreadsheetApp.getActiveSpreadsheet();
      let done = false, surcharge = false;
      ss2.getSheets().forEach(function (sh2) {
        if (done || sh2.getRange(1, 3).getValue() !== 'Quote #') return;
        const r2 = findQuoteRow_(sh2, qn2);
        if (r2 <= 0) return;
        if (String(sh2.getRange(r2, COL.LAST).getValue() || '').trim().toLowerCase() !== ln2) return;
        try {
          const d2 = JSON.parse(sh2.getRange(r2, COL.PAYLOAD).getValue() || '{}');
          surcharge = applySeasonDone_(d2, choice, p.d || '', p.note || '');
          sh2.getRange(r2, COL.PAYLOAD).setValue(JSON.stringify(d2));
          sh2.getRange(r2, COL.TOTAL).setValue(Number(d2.total || 0));
          writeMoneyCols_(sh2, r2, d2);
          savePdf_(d2);
          const label = choice === 'now' ? 'Done now' : choice === 'call' ? 'Will call when done' : 'Done by ' + (p.d || 'a set date');
          sh2.getRange(r2, COL.STATUS).setValue('Season timing: ' + label);
        } catch (e2) {}
        done = true;
      });
      const msg = choice === 'now' ? 'Thanks — we\'ll get you on the haul-out list.'
        : choice === 'call' ? 'Got it — just call us when you\'re ready and we\'ll schedule your haul-out.'
        : 'Thanks — we\'ve noted ' + esc_(p.d || 'your date') + '.' + (surcharge ? ' Since that\'s after Nov 15, a late retrieval surcharge has been added to your balance.' : '');
      return HtmlService.createHtmlOutput(
        '<div style="font-family:Arial;max-width:480px;margin:60px auto;text-align:center;color:#14293E">' +
        '<h2>' + (done ? 'All set — thank you!' : 'We couldn\'t match that quote.') + '</h2>' +
        '<p style="color:#5C7185">' + (done ? msg : 'Please call us at (815) 433-2200 and we\'ll note it for you.') + '</p></div>');
    } catch (e3) {
      return HtmlService.createHtmlOutput('<p style="font-family:Arial">Something went wrong — call (815) 433-2200.</p>');
    }
  }
  // one-click launch-window preference from the spring email
  if (p.action === 'launchpref') {
    try {
      const qn2 = String(p.quote || '').trim().toUpperCase();
      const ln2 = String(p.ln || '').trim().toLowerCase();
      const pref = { early: 'As early as possible', any: 'Any time', late: 'As late as possible' }[String(p.pref)] || '';
      const ss2 = SpreadsheetApp.getActiveSpreadsheet();
      let done = false;
      if (qn2 && pref) ss2.getSheets().forEach(function (sh2) {
        if (done || sh2.getRange(1, 3).getValue() !== 'Quote #') return;
        const r2 = findQuoteRow_(sh2, qn2);
        if (r2 <= 0) return;
        if (String(sh2.getRange(r2, COL.LAST).getValue() || '').trim().toLowerCase() !== ln2) return;
        try {
          const d2 = JSON.parse(sh2.getRange(r2, COL.PAYLOAD).getValue() || '{}');
          d2.launchPref = pref;
          sh2.getRange(r2, COL.PAYLOAD).setValue(JSON.stringify(d2));
        } catch (e2) {}
        sh2.getRange(r2, COL.STATUS).setValue('Launch pref: ' + pref);
        done = true;
      });
      return HtmlService.createHtmlOutput(
        '<div style="font-family:Arial;max-width:480px;margin:60px auto;text-align:center;color:#14293E">' +
        '<h2>' + (done ? 'Got it — thank you!' : 'Hmm, we couldn\'t match that quote.') + '</h2>' +
        '<p style="color:#5C7185">' + (done ? 'Your launch preference (<b>' + pref + '</b>) is noted. We\'ll email you when you\'re up next.' : 'Please call us at (815) 433-2200 and we\'ll note your preference.') + '</p></div>');
    } catch (e3) {
      return HtmlService.createHtmlOutput('<p style="font-family:Arial">Something went wrong — call (815) 433-2200.</p>');
    }
  }
  try {
    const qn = String(p.quote || '').trim().toUpperCase();
    const ln = String(p.ln || '').trim().toLowerCase();
    if (!qn || !ln) return out({ ok: 0, error: 'Enter both your quote number and last name.' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i];
      if (sh.getRange(1, 3).getValue() !== 'Quote #') continue;
      const rowNum = findQuoteRow_(sh, qn);
      if (rowNum <= 0) continue;
      const rowLn = String(sh.getRange(rowNum, COL.LAST).getValue() || '').trim().toLowerCase();
      if (rowLn !== ln) return out({ ok: 0, error: 'Quote not found. Check the quote number and last name.' });
      const payloadJson = sh.getRange(rowNum, COL.PAYLOAD).getValue();
      if (!payloadJson) return out({ ok: 0, error: 'This quote was saved before loading existed — call (815) 433-2200 and we\'ll pull it up.' });
      const d = JSON.parse(payloadJson);
      if (!d.state) return out({ ok: 0, error: 'This quote can\'t be reloaded — call (815) 433-2200 and we\'ll pull it up.' });
      if (reconcileManual_(d)) sh.getRange(rowNum, COL.PAYLOAD).setValue(JSON.stringify(d)); // persist migration
      return out({ ok: 1, state: d.state, manual: d.manual || null, payments: d.payments || [],
                   official: { total: d.total, deposit: d.deposit } });
    }
    return out({ ok: 0, error: 'Quote not found. Check the quote number and last name.' });
  } catch (err) {
    console.error('Quote lookup failed: ' + err);
    return out({ ok: 0, error: 'Something went wrong looking up the quote.' });
  }
}

// NOTE: Quote # deliberately stays in column 3 across layouts
function findQuoteRowFrom_(sh, quoteNo, startRow) {
  if (!quoteNo || sh.getLastRow() < startRow) return -1;
  const col = sh.getRange(startRow, 3, sh.getLastRow() - startRow + 1, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]) === String(quoteNo)) return i + startRow;
  }
  return -1;
}

function findQuoteRow_(sh, quoteNo) {
  if (!quoteNo || sh.getLastRow() < 2) return -1;
  const col = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues(); // Quote #
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]) === String(quoteNo)) return i + 2;
  }
  return -1;
}

/* ---------- PDF generation & Drive archive ---------- */

function savePdf_(d) {
  try {
    const folder = getFolder_();
    const fileName = (d.quoteNo || 'quote') + ' — ' + (d.owner || 'Unknown') + '.pdf';
    // replace any previous PDF for this quote number
    const old = folder.searchFiles('title contains "' + (d.quoteNo || '§none§') + '"');
    while (old.hasNext()) old.next().setTrashed(true);

    const blob = Utilities.newBlob(quoteHtml_(d), MimeType.HTML, fileName)
                          .getAs(MimeType.PDF)
                          .setName(fileName);
    const file = folder.createFile(blob);
    return file.getUrl();
  } catch (err) {
    console.error('PDF save failed: ' + err);
    return ''; // logging still proceeds without the PDF
  }
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function usd_(n) {
  n = Number(n || 0);
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ================= MANUAL QUOTE ADJUSTMENTS =================
 * In the spreadsheet: click any cell in a quote's row, then use the
 * "Quest Quotes" menu -> "Adjust selected quote...". Enter an amount
 * (negative for discounts, e.g. -50 for the Slipholder discount) and a
 * description. The quote's totals, PDF, and spreadsheet row update, and
 * the customer is emailed the revised quote automatically if we have
 * their email address. Run repeatedly for multiple adjustments. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Quest Quotes')
    .addItem('Adjust selected quote (no email)…', 'adjustSelectedQuote')
    .addItem('Adjust & email customer…', 'adjustAndEmail')
    .addItem('Email updated quote to customer…', 'emailUpdatedQuote')
    .addItem('Edit / remove line items…', 'editLineItems')
    .addItem('Price a quote request…', 'priceQuoteRequest')
    .addSeparator()
    .addItem('Record payment / deposit…', 'recordPayment')
    .addItem('Add late fee…', 'addLateFee')
    .addItem('Send late-fee warning email…', 'sendLateFeeWarning')
    .addSeparator()
    .addItem('Create / open photo folder…', 'photoFolder')
    .addItem('Send "We have your unit" email…', 'sendStoredEmail')
    .addItem('Send spring relaunch alert (this quote)…', 'sendSpringAlert')
    .addItem('Send spring relaunch alert to ALL stored…', 'sendSpringAlertAll')
    .addItem('Send "You\'re up next" email…', 'sendUpNextEmail')
    .addItem('Send "Back in the water" email…', 'sendSplashEmail')
    .addToUi();
}

function recomputeTotals_(d) {
  const newTotal = (d.lines || []).reduce(function (a, l) { return a + Number(l.amt || 0); }, 0);
  const depBase = Number(d.depositBase || d.deposit || 0);
  d.total = newTotal.toFixed(2);
  d.deposit = Math.min(depBase, newTotal).toFixed(2);
  d.totalCC = (newTotal * (1 + ADJ_CC_PCT / 100)).toFixed(2);
  d.totalLate = (newTotal * (1 + ADJ_LATE_PCT / 100)).toFixed(2);
  d.totalLateCC = (newTotal * (1 + ADJ_LATE_PCT / 100) * (1 + ADJ_CC_PCT / 100)).toFixed(2);
  d.items = (d.lines || []).map(function (l) { return l.label + ': ' + (l.amt ? usd_(l.amt) : 'incl.'); }).join('\n');
}

/* The manual-ops journal (d.manual) records every staff change so it can be
 * re-applied whenever the page rebuilds the quote from wizard selections:
 *   manual.removed:     [label, ...]                    lines deleted
 *   manual.edits:       [{label, newAmt, newLabel}]     lines changed (label = original wizard label)
 *   manual.priced:      [{rqLabel, label, amt, sec}]    quote-requests given a price
 *   manual.adjustments: [{label, amt}]                  added charge/discount lines */
function applyManualOps_(d) {
  const m = d.manual;
  const res = { applied: 0, skipped: 0, notes: [] };
  if (!m) { recomputeTotals_(d); return res; }
  d.lines = d.lines || [];
  (m.removed || []).forEach(function (lb) {
    const i = d.lines.findIndex(function (l) { return l.label === lb; });
    if (i > -1) { d.lines.splice(i, 1); res.applied++; }
    else { res.skipped++; res.notes.push('removal of "' + lb + '"'); }
  });
  (m.edits || []).forEach(function (e2) {
    const l = d.lines.find(function (x) { return x.label === e2.label; });
    if (l) {
      if (e2.newAmt != null) { l.amt = Number(e2.newAmt); l.calc = ''; }
      if (e2.newLabel) l.label = e2.newLabel;
      res.applied++;
    } else { res.skipped++; res.notes.push('edit of "' + e2.label + '"'); }
  });
  (m.priced || []).forEach(function (pr) {
    d.lines.push({ sec: pr.sec || 'Additional services', label: pr.label, calc: '', amt: Number(pr.amt), desc: '' });
    res.applied++;
    if (d.quotesRequested) {
      d.quotesRequested = String(d.quotesRequested).split('; ').filter(function (x) { return x !== pr.rqLabel; }).join('; ');
    }
  });
  (m.adjustments || []).forEach(function (a) {
    d.lines.push({ sec: 'Adjustments', label: a.label, calc: '', amt: Number(a.amt), desc: '' });
    res.applied++;
  });
  recomputeTotals_(d);
  return res;
}

/* Migration: adjustments made before the journal feature live only in d.lines.
 * Rebuild journal entries from any Adjustments-section lines it doesn't know. */
function reconcileManual_(d) {
  const adjLines = (d.lines || []).filter(function (l) { return l.sec === 'Adjustments'; });
  if (!adjLines.length) return false;
  const m = ensureManual_(d);
  let changed = false;
  adjLines.forEach(function (l) {
    const known = m.adjustments.some(function (a) { return a.label === l.label && Number(a.amt) === Number(l.amt); });
    if (!known) { m.adjustments.push({ label: l.label, amt: Number(l.amt) }); changed = true; }
  });
  return changed;
}

function ensureManual_(d) {
  d.manual = d.manual || {};
  d.manual.removed = d.manual.removed || [];
  d.manual.edits = d.manual.edits || [];
  d.manual.priced = d.manual.priced || [];
  d.manual.adjustments = d.manual.adjustments || [];
  return d.manual;
}

function originalLabelFor_(m, current) {
  const e2 = (m.edits || []).find(function (x) { return x.newLabel === current; });
  return e2 ? e2.label : current;
}

/* ================= SAVE-TIME PRICE CROSS-CHECK =================
 * The page and this script now run the SAME rules (see the engine block near
 * the top), so the server can price a quote itself instead of trusting the
 * browser's arithmetic. Two things follow from that.
 *
 * 1. THE LINE ITEMS ARE REBUILT FROM THE CUSTOMER'S OWN SELECTIONS.
 *    CLAUDE.md section 4 describes the intended flow: "the page recomputes
 *    clean lines from their selections, and applyManualOps_() replays every
 *    staff change on top". Until the server had an engine that could only be
 *    half true -- the page posts lines it has ALREADY replayed the journal
 *    onto, and this script then replayed it a second time. Adjustments and
 *    priced requests were appended twice (the total went UP on every customer
 *    re-save), while removals and edits could not find their targets and were
 *    reported as "could NOT re-apply -- REVIEW", which is why that warning
 *    could fire on quotes where nothing was actually wrong.
 *
 *    Rebuilding clean lines here means the journal is applied exactly once, by
 *    this script, where the official copy lives.
 *
 * 2. DISAGREEMENT IS REPORTED, NOT BANKED. If the server's figure differs from
 *    what the page saved, the save still completes with the server's number and
 *    a drift note rides along on the service@ notification. A stale browser
 *    tab, a hand-edited payload, or a future rule change that lands in one copy
 *    of the engine and not the other all surface here instead of quietly
 *    moving money.
 *
 * Fails open by design: a payload with no usable state -- an older quote, or
 * anything that reaches doPost without the wizard state -- keeps exactly the
 * behavior it had before.
 */
/* The state the quote is actually priced at.
 *
 * d.state is what the CUSTOMER selected. manual.measured is what QUEST
 * measured or assigned afterwards -- a re-measured beam, a storage location we
 * moved them to. The override lives in the journal, not in d.state, for the
 * reason every other staff change does (CLAUDE.md section 4): the customer page
 * posts its own state on the next save, and anything written into d.state would
 * be replaced by whatever is still typed in their browser. Keeping the two
 * apart also means we can always still see what they originally told us.
 */
function effectiveState_(d) {
  const base = (d && d.state) || null;
  if (!base) return null;
  const meas = d.manual && d.manual.measured;
  if (!meas) return base;
  const s = JSON.parse(JSON.stringify(base));
  Object.keys(meas).forEach(function (k) { s[k] = meas[k]; });
  return s;
}

function serverPrice_(d) {
  const st = effectiveState_(d);
  if (!st) return { ok: false, reason: 'no wizard state in payload' };
  let r;
  try {
    r = computeQuote(st);
  } catch (err) {
    return { ok: false, reason: 'engine threw: ' + (err && err.message ? err.message : err) };
  }
  if (!r || !r.lines) return { ok: false, reason: 'engine returned no lines' };
  /* Normalise to the exact shape the page posts, so a stored payload does not
     change shape depending on which side computed it. */
  const lines = r.lines.map(function (l) {
    return {
      sec: l.sec, label: l.label, calc: l.calc || '',
      amt: Number(l.amt || 0), desc: l.desc || ''
    };
  });
  return { ok: true, lines: lines, rq: r.rq || [], need: r.need || [], flags: r.flags || [], state: st };
}

/* Delete every copy of a quote except the first one already on `keepTab`.
 *
 * Row numbers are captured before any deletion, so they only stay valid if we
 * delete from the bottom up. Sorting the whole list by row descending does
 * that within each sheet (relative order inside a sheet is preserved), and
 * deletions in one sheet cannot disturb another's numbering.
 *
 * Returns the deleted entries, which is what makes it testable. */
function pruneQuoteCopies_(copies, keepTab) {
  const onKeep = copies.filter(function (c) { return c.sheet.getName() === keepTab; });
  const doomed = copies
    .filter(function (c) { return c.sheet.getName() !== keepTab; })
    .concat(onKeep.slice(1))
    .sort(function (a, b) { return b.row - a.row; });
  doomed.forEach(function (c) { c.sheet.deleteRow(c.row); });
  return doomed;
}

function linesTotal_(lines) {
  return (lines || []).reduce(function (a, l) { return a + Number(l.amt || 0); }, 0);
}

/* Replace the posted lines with the server's own. Call BEFORE applyManualOps_,
 * so the journal replays onto clean lines exactly once. */
function rebuildLinesFromState_(d) {
  const posted = Number(d.total || 0);
  const sp = serverPrice_(d);
  if (!sp.ok) return { rebuilt: false, reason: sp.reason, postedTotal: posted };
  d.lines = sp.lines;
  d.quotesRequested = sp.rq.join('; ');
  /* A staff re-measure or relocation changes what the sheet and PDF should
     say, so refresh both from the state that actually set the price. */
  d.dims = dimsString(sp.state);
  d.storageTab = storageTabFor(sp.state);
  /* Engine flags (e.g. a beam over the Inside limit) are advisory: they are
     recorded for staff, never acted on automatically. Relocating a customer's
     boat is a conversation, not a side effect of a save. */
  if (sp.flags.length) d._flags = sp.flags; else delete d._flags;
  /* Hand back the state that priced it: callers need it to describe what
     changed (the audit log and the console diff both do). */
  return { rebuilt: true, postedTotal: posted, serverRawTotal: linesTotal_(sp.lines), state: sp.state };
}

/* Compare AFTER the journal has been replayed: by then d.total is the server's
 * official figure and cross.postedTotal is what the browser believed. */
function driftNoteFor_(d, cross) {
  if (!cross || !cross.rebuilt) return '';
  const posted = Number(cross.postedTotal || 0);
  const server = Number(d.total || 0);
  const diff = server - posted;
  if (Math.abs(diff) <= 0.005) return '';
  return 'PRICE DRIFT — the quote page saved $' + posted.toFixed(2) +
    ', this script priced the same selections at $' + server.toFixed(2) +
    ' (' + (diff > 0 ? '+' : '') + diff.toFixed(2) + '). The server figure was stored. ' +
    'Check the quote before sending anything to the customer. Usual causes: a browser tab ' +
    'left open across a price change, or the page and backend running different engine versions.';
}

function paymentsTotal_(d) {
  return (d.payments || []).reduce(function (a, p) { return a + Number(p.amt || 0); }, 0);
}
function writeMoneyCols_(sh, rowNum, d) {
  const paid = paymentsTotal_(d);
  const bal = Number(d.total || 0) - paid; // negative = CREDIT owed to the customer
  sh.getRange(rowNum, COL.PAID).setValue(paid);
  sh.getRange(rowNum, COL.BAL).setValue(bal);
  sh.getRange(rowNum, COL.PAID).setNumberFormat('$#,##0.00');
  sh.getRange(rowNum, COL.BAL).setNumberFormat('$#,##0.00');
  return { paid: paid, bal: bal };
}

function getSelectedQuoteRow_() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  const rowNum = sh.getActiveRange().getRow();
  if (rowNum < 2 || sh.getRange(1, 3).getValue() !== 'Quote #') {
    ui.alert('Click a cell in a quote row first (on one of the quote tabs).');
    return null;
  }
  const quoteNo = sh.getRange(rowNum, COL.QN).getValue();
  const payloadJson = sh.getRange(rowNum, COL.PAYLOAD).getValue();
  if (!payloadJson) {
    ui.alert('Quote ' + quoteNo + ' has no stored data (it may predate the adjustment feature). ' +
             'Re-save it from the quote page first, then adjust.');
    return null;
  }
  const d = JSON.parse(payloadJson);
  reconcileManual_(d); // backfill pre-journal adjustments if any
  return { ui: ui, sh: sh, rowNum: rowNum, quoteNo: quoteNo, d: d };
}

function applyAdjustment_(ctx) {
  const ui = ctx.ui;
  const amtResp = ui.prompt('Adjust quote ' + ctx.quoteNo,
    'Adjustment amount in dollars.\nNegative = discount (e.g. -50), positive = added charge.', ui.ButtonSet.OK_CANCEL);
  if (amtResp.getSelectedButton() !== ui.Button.OK) return false;
  const amt = Number(String(amtResp.getResponseText()).replace(/[$,\s]/g, ''));
  if (!isFinite(amt) || amt === 0) { ui.alert('Enter a non-zero number, e.g. -50 or 125.50'); return false; }
  const descResp = ui.prompt('Adjust quote ' + ctx.quoteNo,
    'Description shown on the quote (e.g. "Heritage Harbor Slipholder discount — slip B-14").', ui.ButtonSet.OK_CANCEL);
  if (descResp.getSelectedButton() !== ui.Button.OK) return false;
  const desc = String(descResp.getResponseText()).trim();
  if (!desc) { ui.alert('A description is required — it appears on the customer quote.'); return false; }

  const d = ctx.d;
  d.lines = d.lines || [];
  d.lines.push({ sec: 'Adjustments', label: desc, calc: '', amt: amt, desc: '' });
  ensureManual_(d).adjustments.push({ label: desc, amt: amt });
  recomputeTotals_(d);
  const wasSigned = String(sh_status_(ctx)).indexOf('Signed & paying') === 0 ||
                    String(sh_status_(ctx)).indexOf('Adjusted after signing') === 0;
  d.status = wasSigned ? 'Adjusted after signing — review' : 'Adjusted — not yet sent';
  d.ts = new Date().toISOString();

  const pdfUrl = savePdf_(d);
  const sh = ctx.sh, rowNum = ctx.rowNum;
  sh.getRange(rowNum, COL.STATUS).setValue(d.status);
  sh.getRange(rowNum, COL.TOTAL).setValue(Number(d.total));
  sh.getRange(rowNum, COL.DEP).setValue(Number(d.deposit));
  sh.getRange(rowNum, COL.ITEMS).setValue(d.items).setWrap(true);
  sh.getRange(rowNum, COL.PDF).setValue(pdfUrl);
  sh.getRange(rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
  writeMoneyCols_(sh, rowNum, d);
  ctx.lastAdj = { amt: amt, desc: desc, pdfUrl: pdfUrl };
  return true;
}

function sh_status_(ctx) { return ctx.sh.getRange(ctx.rowNum, COL.STATUS).getValue() || ''; }

function sendUpdate_(ctx, noteDefault) {
  const ui = ctx.ui, d = ctx.d;
  if (!d.email) { ui.alert('Quote ' + ctx.quoteNo + ' has no customer email — nothing sent. You can print the updated PDF from the Quote PDF link instead.'); return; }
  const noteResp = ui.prompt('Email updated quote ' + ctx.quoteNo + ' to ' + d.email,
    'Optional note to include (e.g. "Applied your Slipholder discount and added the detail price"). Leave blank for a generic update message.', ui.ButtonSet.OK_CANCEL);
  if (noteResp.getSelectedButton() !== ui.Button.OK) return;
  const note = String(noteResp.getResponseText()).trim() || (noteDefault || '');
  sendCustomerEmail_(d, note, true);
  recordEmail_(ctx.sh, ctx.rowNum, d, 'updated', 'Sheet menu');
  const newStatus = String(sh_status_(ctx)).indexOf('after signing') > -1 ? 'Adjusted after signing & emailed' : 'Adjusted & emailed';
  ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue(newStatus);
  d.status = newStatus;
  ctx.sh.getRange(ctx.rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
  sendNotification_(d, ctx.sh.getName(), true, ctx.sh.getRange(ctx.rowNum, COL.PDF).getValue());
  ui.alert('Updated quote emailed to ' + d.email + '.\nTotal: ' + usd_(d.total) + ' · Deposit: ' + usd_(d.deposit));
}

/* Menu: adjust only — stack as many as needed, customer hears nothing yet */
function adjustSelectedQuote() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  if (!applyAdjustment_(ctx)) return;
  ctx.ui.alert('Quote ' + ctx.quoteNo + ' adjusted: ' + ctx.lastAdj.desc + ' (' + (ctx.lastAdj.amt < 0 ? '-' : '+') + usd_(Math.abs(ctx.lastAdj.amt)) + ')' +
    '\nNew total: ' + usd_(ctx.d.total) + ' · Deposit: ' + usd_(ctx.d.deposit) +
    '\n\nNo email sent. Add more adjustments, or use "Email updated quote to customer" when ready.');
}

/* Menu: adjust + email in one pass — the quick path for a single discount */
function adjustAndEmail() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  if (!applyAdjustment_(ctx)) return;
  sendUpdate_(ctx, ctx.lastAdj.desc + ' (' + (ctx.lastAdj.amt < 0 ? '-' : '+') + usd_(Math.abs(ctx.lastAdj.amt)) + ')');
}

/* Menu: send only — after stacking adjustments, or to resend the current quote */
function emailUpdatedQuote() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  sendUpdate_(ctx, '');
}

function saveQuoteRow_(ctx, statusOverride) {
  const d = ctx.d, sh = ctx.sh, rowNum = ctx.rowNum;
  const prev = String(sh.getRange(rowNum, COL.STATUS).getValue() || '');
  const signed = prev.indexOf('Signed & paying') === 0 || prev.indexOf('Adjusted after signing') === 0;
  d.status = statusOverride || (signed ? 'Adjusted after signing — review' : 'Adjusted — not yet sent');
  d.ts = new Date().toISOString();
  const pdfUrl = savePdf_(d);
  sh.getRange(rowNum, COL.STATUS).setValue(d.status);
  sh.getRange(rowNum, COL.TOTAL).setValue(Number(d.total));
  sh.getRange(rowNum, COL.DEP).setValue(Number(d.deposit));
  sh.getRange(rowNum, COL.ITEMS).setValue(d.items).setWrap(true);
  sh.getRange(rowNum, COL.RQ).setValue(d.quotesRequested || '');
  sh.getRange(rowNum, COL.PDF).setValue(pdfUrl);
  sh.getRange(rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
  writeMoneyCols_(sh, rowNum, d);
  return pdfUrl;
}

/* Menu: edit or remove any line on the quote — fix a wrong charge in place,
 * delete an accidental selection, or discount the Slipholder line directly */
function editLineItems() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const ui = ctx.ui, d = ctx.d;
  d.lines = d.lines || [];
  if (!d.lines.length) { ui.alert('Quote ' + ctx.quoteNo + ' has no line items.'); return; }
  const listing = d.lines.map(function (l, i) {
    return (i + 1) + '. ' + l.label + ' — ' + (l.amt ? usd_(l.amt) : 'incl.');
  }).join('\n');
  const pick = ui.prompt('Edit quote ' + ctx.quoteNo + ' — enter a line number',
    listing, ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  const idx = Math.floor(Number(pick.getResponseText())) - 1;
  if (!(idx >= 0 && idx < d.lines.length)) { ui.alert('Enter a line number between 1 and ' + d.lines.length + '.'); return; }
  const line = d.lines[idx];
  const act = ui.prompt('Line ' + (idx + 1) + ': ' + line.label + ' — ' + (line.amt ? usd_(line.amt) : 'incl.'),
    'Enter one of:\n• DELETE — remove this line\n• a new amount (e.g. 225 or -50)\n• amount|new wording (e.g. 225|Exterior detail & wax)',
    ui.ButtonSet.OK_CANCEL);
  if (act.getSelectedButton() !== ui.Button.OK) return;
  const raw = String(act.getResponseText()).trim();
  const m = ensureManual_(d);

  if (raw.toUpperCase() === 'DELETE') {
    if (line.sec === 'Adjustments') {
      const ai = m.adjustments.findIndex(function (a) { return a.label === line.label; });
      if (ai > -1) m.adjustments.splice(ai, 1);
    } else {
      const orig = originalLabelFor_(m, line.label);
      m.edits = m.edits.filter(function (e2) { return e2.label !== orig; });
      m.removed.push(orig);
    }
    d.lines.splice(idx, 1);
    recomputeTotals_(d);
    saveQuoteRow_(ctx);
    ui.alert('Removed: ' + line.label + '\nNew total: ' + usd_(d.total) +
      '\n\nNo email sent — use "Email updated quote to customer" when ready.');
    return;
  }

  const parts = raw.split('|');
  const newAmt = Number(String(parts[0]).replace(/[$,\s]/g, ''));
  if (!isFinite(newAmt)) { ui.alert('Could not read an amount from "' + parts[0] + '".'); return; }
  const newLabel = parts.length > 1 ? String(parts.slice(1).join('|')).trim() : '';

  if (line.sec === 'Adjustments') {
    const adj = m.adjustments.find(function (a) { return a.label === line.label; });
    if (adj) { adj.amt = newAmt; if (newLabel) adj.label = newLabel; }
  } else {
    const orig = originalLabelFor_(m, line.label);
    let e2 = m.edits.find(function (x) { return x.label === orig; });
    if (!e2) { e2 = { label: orig }; m.edits.push(e2); }
    e2.newAmt = newAmt;
    if (newLabel) e2.newLabel = newLabel;
  }
  line.amt = newAmt; line.calc = '';
  if (newLabel) line.label = newLabel;
  recomputeTotals_(d);
  saveQuoteRow_(ctx);
  ui.alert('Updated: ' + line.label + ' — ' + usd_(newAmt) + '\nNew total: ' + usd_(d.total) +
    '\n\nNo email sent — use "Email updated quote to customer" when ready.');
}

/* Menu: turn a "quote to follow" request into a priced line in its own section */
function priceQuoteRequest() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const ui = ctx.ui, d = ctx.d;
  const rqs = String(d.quotesRequested || '').split('; ').filter(function (x) { return x; });
  if (!rqs.length) { ui.alert('Quote ' + ctx.quoteNo + ' has no open quote requests.'); return; }
  const listing = rqs.map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n');
  const pick = ui.prompt('Price a quote request — quote ' + ctx.quoteNo, listing, ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  const idx = Math.floor(Number(pick.getResponseText())) - 1;
  if (!(idx >= 0 && idx < rqs.length)) { ui.alert('Enter a number between 1 and ' + rqs.length + '.'); return; }
  const item = rqs[idx];
  const amtResp = ui.prompt('Price: ' + item, 'Enter the price for this service.', ui.ButtonSet.OK_CANCEL);
  if (amtResp.getSelectedButton() !== ui.Button.OK) return;
  const amt = Number(String(amtResp.getResponseText()).replace(/[$,\s]/g, ''));
  if (!isFinite(amt) || amt <= 0) { ui.alert('Enter a positive amount, e.g. 225'); return; }

  ensureManual_(d).priced.push({ rqLabel: item, label: item, amt: amt, sec: 'Additional services' });
  d.lines = d.lines || [];
  d.lines.push({ sec: 'Additional services', label: item, calc: '', amt: amt, desc: '' });
  d.quotesRequested = rqs.filter(function (x, i2) { return i2 !== idx; }).join('; ');
  recomputeTotals_(d);
  saveQuoteRow_(ctx);
  ui.alert('Priced: ' + item + ' — ' + usd_(amt) + '\nNew total: ' + usd_(d.total) +
    '\n\nNo email sent — use "Email updated quote to customer" when ready.');
}

/* ============ STAFF CONSOLE: auth, permissions, actions ============ */
/* Staff records live in Script Properties key 'STAFF' as JSON:
 *   { "Chris": {pin:"1234", admin:true,  perms:{pay:1,adjust:1,email:1,photos:1}}, ... }
 * Run initStaff() ONCE from the editor to seed the roster with random PINs
 * (printed to the execution log — hand them out, then clear the log). */
function initStaff() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('STAFF')) { console.log('STAFF already exists — use the console Admin screen to manage. Delete the STAFF property first if you truly want to re-seed.'); return; }
  const mkpin = function () { return String(Math.floor(1000 + Math.random() * 9000)); };
  const roster = {
    'Chris':  { pin: mkpin(), admin: true,  perms: { pay: 1, adjust: 1, email: 1, photos: 1 } },
    'Jeff':   { pin: mkpin(), admin: true,  perms: { pay: 1, adjust: 1, email: 1, photos: 1 } },
    'John':   { pin: mkpin(), admin: false, perms: { pay: 1, adjust: 0, email: 1, photos: 1 } },
    'Rex':    { pin: mkpin(), admin: false, perms: { pay: 1, adjust: 0, email: 1, photos: 1 } },
    'Jess':   { pin: mkpin(), admin: false, perms: { pay: 1, adjust: 0, email: 1, photos: 1 } },
    'Marina': { pin: mkpin(), admin: false, perms: { pay: 0, adjust: 0, email: 0, photos: 1 } }
  };
  props.setProperty('STAFF', JSON.stringify(roster));
  Object.keys(roster).forEach(function (n) { console.log(n + ' — PIN: ' + roster[n].pin); });
  console.log('Roster created. Admins (Chris, Jeff) can change PINs & permissions from the console.');
}

function getStaff_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('STAFF') || '{}');
}
function saveStaff_(r) {
  PropertiesService.getScriptProperties().setProperty('STAFF', JSON.stringify(r));
}

const SESSION_HOURS = 12;
function adminAuth(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pinfails') || 0);
  if (fails >= 10) return { ok: 0, error: 'Too many wrong PINs — login is paused for a while. Try again later.' };
  const roster = getStaff_();
  const name = Object.keys(roster).find(function (n) { return roster[n].pin === String(pin).trim(); });
  if (!name) {
    cache.put('pinfails', String(fails + 1), 900);
    if (fails + 1 === 10) {
      try { GmailApp.sendEmail(REPORT_EMAIL, '⚠️ Staff console: repeated wrong PINs', 'The staff console login has been paused for 15 minutes after 10 failed PIN attempts.'); } catch (e) {}
    }
    return { ok: 0, error: 'Wrong PIN.' };
  }
  cache.remove('pinfails');
  const token = Utilities.getUuid();
  const sess = { name: name, exp: Date.now() + SESSION_HOURS * 3600 * 1000 };
  PropertiesService.getScriptProperties().setProperty('SESS_' + token, JSON.stringify(sess));
  const st = roster[name];
  return { ok: 1, token: token, name: name, admin: !!st.admin, perms: st.perms || {} };
}

function requireAuth_(token, perm) {
  const raw = PropertiesService.getScriptProperties().getProperty('SESS_' + token);
  if (!raw) throw new Error('Session expired — log in again.');
  const sess = JSON.parse(raw);
  if (Date.now() > sess.exp) {
    PropertiesService.getScriptProperties().deleteProperty('SESS_' + token);
    throw new Error('Session expired — log in again.');
  }
  const roster = getStaff_();
  const st = roster[sess.name];
  if (!st) throw new Error('Account removed.');
  if (perm && perm !== 'view' && !st.admin && !(st.perms && st.perms[perm])) {
    throw new Error('Your account doesn\'t have permission for that — ask Chris or Jeff.');
  }
  return { name: sess.name, admin: !!st.admin, perms: st.perms || {} };
}

function auditLog_(who, action) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Activity Log');
    if (!sh) {
      sh = ss.insertSheet('Activity Log');
      sh.appendRow(['Timestamp', 'Who', 'Action']);
      sh.getRange(1, 1, 1, 3).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), who, action]);
  } catch (e) {}
}

function findQuoteCtx_(qn) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (sh.getRange(1, 3).getValue() !== 'Quote #') continue;
    const rowNum = findQuoteRow_(sh, String(qn).trim().toUpperCase());
    if (rowNum > 0) {
      const payloadJson = sh.getRange(rowNum, COL.PAYLOAD).getValue();
      if (!payloadJson) return null;
      const d = JSON.parse(payloadJson);
      reconcileManual_(d);
      return { sh: sh, rowNum: rowNum, quoteNo: d.quoteNo, d: d,
               ui: { alert: function(){}, prompt: function(){} } };
    }
  }
  return null;
}

function adminSearch(token, query) {
  requireAuth_(token, 'view');
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return { ok: 0, error: 'Type at least 2 letters of the last name.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hits = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getRange(1, 3).getValue() !== 'Quote #') return;
    const last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (r) {
      const ln = String(r[COL.LAST - 1] || '').toLowerCase();
      if (!ln || ln.indexOf(q) === -1) return;
      const bal = Number(r[COL.BAL - 1] || 0);
      hits.push({ quoteNo: r[COL.QN - 1],
        name: [r[COL.FIRST - 1], r[COL.LAST - 1]].filter(Boolean).join(' '),
        unit: r[COL.UNIT - 1], ymm: r[COL.YMM - 1] || '',
        status: r[COL.STATUS - 1] || '',
        balance: bal < -0.005 ? 'CREDIT ' + usd_(-bal) : usd_(Math.max(0, bal)) });
    });
  });
  hits.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  return { ok: 1, hits: hits.slice(0, 25), truncated: hits.length > 25 };
}

/* Printable copy of the quote/invoice, for the console's Print button.
 * Returns the SAME html savePdf_ renders, so what staff print is what the
 * customer's PDF says -- one generator, no second layout to keep in step.
 *
 * Deliberately not a link to the filed Drive PDF. That file inherits the
 * season folder's permissions, so a staff member holding a console PIN but not
 * signed into the Quest Google account lands on "Request access" -- which is
 * most of the yard, on their own phones. Rendering here needs nothing but the
 * session they already have. Read-only, so it takes the same 'view' level as
 * a lookup. */
/* ================= DIMENSIONS & STORAGE (console) =================
 * Re-measure a unit, or move it to a different storage location, and let the
 * shared engine re-price it. Nothing moves until staff confirm a before/after
 * diff -- these are dollars on a real customer's quote.
 *
 * The new values go into manual.measured, NOT into d.state. d.state is what
 * the customer selected; manual.measured is what Quest measured or assigned
 * afterwards. Writing into d.state would work until the customer's next save,
 * which posts the state still sitting in their browser and would silently undo
 * the re-measure -- the same trap the manual journal exists to avoid
 * (CLAUDE.md section 4). Keeping them apart also preserves what the customer
 * originally told us, which is worth having when a measurement is disputed.
 *
 * Beam is FLAGGED, never auto-relocated. A boat outgrowing its storage class
 * is a conversation with the customer, not a side effect of a save.
 */
function storageLabel_(v) {
  return v === 'outside' ? 'Outside storage'
    : v === 'inside' ? 'Inside storage'
    : v === 'insidePrem' ? 'Premium inside storage'
    : v === 'none' ? 'No storage with Quest'
    : String(v || '');
}

const MEASURABLE_NUM_ = ['loa', 'beam', 'lwt', 'skiLen', 'skiWid'];
const STORAGE_VALUES_ = ['none', 'outside', 'inside', 'insidePrem'];

/* Which storage locations a unit type can actually occupy.
   Jet skis are inside-or-nothing on the quote page, and outside storage prices
   per foot of LOA -- a figure a jet ski quote does not carry. Allowing it here
   would build a state the customer page cannot represent and the engine cannot
   price. Golf carts and e-bikes have one tab each and no choice at all. */
function allowedStorageFor_(unitKind) {
  if (unitKind === 'jetski') return ['none', 'inside'];
  if (unitKind === 'boat') return STORAGE_VALUES_.slice();
  return [];
}

function sanitizeMeasured_(changes, unitKind) {
  const out = {};
  changes = changes || {};
  MEASURABLE_NUM_.forEach(function (k) {
    const raw = changes[k];
    if (raw === undefined || raw === null || String(raw).trim() === '') return;
    /* Strip only currency-ish noise, NOT the sign: removing "-" first would
       turn -5 into a perfectly valid 5. */
    const txt = String(raw).replace(/[,'"\s]|ft\.?$/gi, '').trim();
    const v = Number(txt);
    if (!isFinite(v) || v <= 0) throw new Error('Enter a positive number for every dimension you change.');
    if (v > 200) throw new Error('That dimension looks wrong (' + v + " ft). Check it before saving.");
    out[k] = v;
  });
  if (changes.hasTrailer !== undefined && String(changes.hasTrailer) !== '') {
    out.hasTrailer = !!Number(changes.hasTrailer);
  }
  if (changes.storage !== undefined && String(changes.storage) !== '') {
    const v = String(changes.storage);
    if (STORAGE_VALUES_.indexOf(v) < 0) throw new Error('Unknown storage location.');
    const allowed = allowedStorageFor_(unitKind);
    if (!allowed.length) throw new Error('This unit type has only one storage location.');
    if (allowed.indexOf(v) < 0) {
      throw new Error('A ' + (unitKind === 'jetski' ? 'jet ski' : unitKind) +
        ' can only be stored inside or not with us \u2014 ' + storageLabel_(v) + ' is not an option.');
    }
    out.storage = v;
  }
  return out;
}

/* Price a hypothetical change without touching the sheet. Returns the before
 * and after pictures plus a line-by-line diff. */
function dimsProposal_(d, changes) {
  const clean = sanitizeMeasured_(changes, String((effectiveState_(d) || {}).unit || ''));
  if (!Object.keys(clean).length) return { ok: 0, error: 'Nothing changed.' };

  const beforeLines = (d.lines || []).map(function (l) { return { label: l.label, amt: Number(l.amt || 0) }; });
  const beforeTotal = Number(d.total || 0);
  const beforeState = effectiveState_(d);
  if (!beforeState) {
    return { ok: 0, error: 'This quote has no stored selections, so it can\'t be re-priced automatically. Adjust the lines by hand instead.' };
  }

  const clone = JSON.parse(JSON.stringify(d));
  const m = ensureManual_(clone);
  m.measured = Object.assign({}, m.measured || {}, clean);
  const cross = rebuildLinesFromState_(clone);
  if (!cross.rebuilt) return { ok: 0, error: 'Could not re-price: ' + cross.reason };
  applyManualOps_(clone);

  const afterLines = (clone.lines || []).map(function (l) { return { label: l.label, amt: Number(l.amt || 0) }; });
  const afterTotal = Number(clone.total || 0);
  const paid = paymentsTotal_(d);

  return {
    ok: 1,
    diff: lineDiff_(beforeLines, afterLines),
    beforeTotal: usd_(beforeTotal), afterTotal: usd_(afterTotal),
    delta: (afterTotal - beforeTotal >= 0 ? '+' : '\u2212') + usd_(Math.abs(afterTotal - beforeTotal)),
    deltaNum: Math.round((afterTotal - beforeTotal) * 100) / 100,
    beforeDims: dimsString(beforeState) || '\u2014',
    afterDims: dimsString(cross.state || beforeState) || '\u2014',
    beforeTab: storageTabFor(beforeState),
    afterTab: clone.storageTab,
    paid: usd_(paid),
    newBalance: (function () {
      const b = afterTotal - paid;
      return b < -0.005 ? 'CREDIT ' + usd_(-b) : usd_(Math.max(0, b));
    })(),
    flags: (clone._flags || []).map(function (f) { return f.msg; })
  };
}

/* Match lines by label. Labels are unique within a quote in practice; a repeat
 * is treated as a second entry rather than silently collapsed. */
function lineDiff_(before, after) {
  const out = [];
  const seen = {};
  const idx = {};
  before.forEach(function (l) { (idx[l.label] = idx[l.label] || []).push(l.amt); });
  after.forEach(function (l) {
    const bucket = idx[l.label];
    seen[l.label] = true;
    if (bucket && bucket.length) {
      const wasAmt = bucket.shift();
      if (Math.abs(wasAmt - l.amt) > 0.005) {
        out.push({ kind: 'changed', label: l.label, was: usd_(wasAmt), now: usd_(l.amt) });
      }
    } else {
      out.push({ kind: 'added', label: l.label, was: '', now: usd_(l.amt) });
    }
  });
  Object.keys(idx).forEach(function (label) {
    idx[label].forEach(function (amt) {
      out.push({ kind: 'removed', label: label, was: usd_(amt), now: '' });
    });
  });
  return out;
}

function adminDimsPreview(token, qn, changes) {
  requireAuth_(token, 'adjust');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  try { return dimsProposal_(ctx.d, changes); }
  catch (err) { return { ok: 0, error: String(err.message || err) }; }
}

function adminDimsApply(token, qn, changes, note) {
  const who = requireAuth_(token, 'adjust');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  let clean;
  try { clean = sanitizeMeasured_(changes, String((effectiveState_(d) || {}).unit || '')); }
  catch (err) { return { ok: 0, error: String(err.message || err) }; }
  if (!Object.keys(clean).length) return { ok: 0, error: 'Nothing changed.' };

  const fromTab = ctx.sh.getName();
  const beforeTotal = Number(d.total || 0);
  const beforeDims = dimsString(effectiveState_(d) || {});

  const m = ensureManual_(d);
  m.measured = Object.assign({}, m.measured || {}, clean);
  if (note) m.measuredNote = String(note).slice(0, 400);

  const cross = rebuildLinesFromState_(d);
  if (!cross.rebuilt) {
    return { ok: 0, error: 'Could not re-price: ' + cross.reason + '. Nothing was changed.' };
  }
  applyManualOps_(d);

  const toTab = d.storageTab || fromTab;
  let moved = '';
  if (toTab !== fromTab && !isStartedTab_(fromTab)) {
    moveQuoteRow_(ctx, toTab);
    moved = ' Moved from ' + fromTab + ' to ' + toTab + '.';
  }
  saveQuoteRow_(ctx);

  const afterTotal = Number(d.total || 0);
  const delta = afterTotal - beforeTotal;
  auditLog_(who.name, 'Dimensions/storage updated on ' + d.quoteNo + ': ' +
    beforeDims + ' \u2192 ' + dimsString(cross.state || {}) +
    ' · ' + usd_(beforeTotal) + ' \u2192 ' + usd_(afterTotal) +
    (moved ? ' ·' + moved : '') + (note ? ' · note: ' + note : ''));

  const paid = paymentsTotal_(d);
  const bal = afterTotal - paid;
  return {
    ok: 1,
    msg: 'Re-priced: ' + usd_(beforeTotal) + ' \u2192 ' + usd_(afterTotal) +
      ' (' + (delta >= 0 ? '+' : '\u2212') + usd_(Math.abs(delta)) + ').' + moved +
      ' No email sent yet.',
    total: usd_(afterTotal),
    balance: bal < -0.005 ? 'CREDIT ' + usd_(-bal) : usd_(Math.max(0, bal)),
    movedTo: moved ? toTab : '',
    flags: (d._flags || []).map(function (f) { return f.msg; })
  };
}

/* Physically relocate a quote's row to another storage tab, carrying every
 * column with it (reminder marker, photos link, PDF link, payments) so nothing
 * is lost in the move. */
function moveQuoteRow_(ctx, newTab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dest = ss.getSheetByName(newTab);
  if (!dest) {
    dest = ss.insertSheet(newTab);
    dest.appendRow(HEADERS);
    dest.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    dest.setFrozenRows(1);
  }
  const vals = ctx.sh.getRange(ctx.rowNum, 1, 1, HEADERS.length).getValues()[0];
  const destRow = dest.getLastRow() + 1;
  dest.getRange(destRow, 1, 1, HEADERS.length).setValues([vals]);
  dest.getRange(destRow, COL.TOTAL, 1, 2).setNumberFormat('$#,##0.00');
  dest.getRange(destRow, COL.ITEMS).setWrap(true);
  ctx.sh.deleteRow(ctx.rowNum);
  ctx.sh = dest;
  ctx.rowNum = destRow;
  return dest;
}

function adminQuoteHtml(token, qn) {
  requireAuth_(token, 'view');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  return { ok: 1, quoteNo: ctx.d.quoteNo || qn, term: docTerm_(ctx.d), html: quoteHtml_(ctx.d) };
}

function adminLookup(token, qn) {
  const who = requireAuth_(token, 'view');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found (or saved before the current system — re-save it from the quote page once).' };
  const d = ctx.d;
  const paid = paymentsTotal_(d);
  const bal = Number(d.total || 0) - paid;
  return { ok: 1, quoteNo: d.quoteNo, name: [d.firstName, d.lastName].filter(Boolean).join(' '),
    /* Quote vs Invoice, so the console can follow the same terminology flip as
       the page, the PDF and the emails once a payment exists. */
    term: docTerm_(d),
    unit: d.unit, ymm: d.ymm || '', status: String(ctx.sh.getRange(ctx.rowNum, COL.STATUS).getValue() || ''),
    total: usd_(d.total), paid: usd_(paid), balance: bal < -0.005 ? 'CREDIT ' + usd_(-bal) : usd_(Math.max(0, bal)),
    balNum: Math.round(bal * 100) / 100,
    feeSuggest10: bal > 0 ? Math.round(bal * ADJ_LATE_PCT) / 100 : 0,
    feeSuggest2: bal > 0 ? Math.max(5, Math.round(bal * 2) / 100) : 0,
    payByShort: (d.season && d.season.payByShort) || 'Nov 15',
    hasEmail: !!d.email, email: d.email || '', phone: d.phone || '',
    photos: String(ctx.sh.getRange(ctx.rowNum, COL.PHOTOS).getValue() || ''),
    contractUrl: d.contractUrl || '',
    rq: String(d.quotesRequested || ''),
    rqList: String(d.quotesRequested || '').split('; ').filter(function (x) { return x; }),
    seasonDone: d.seasonDone || null,
    /* Terms acceptance, read-only on the console: which version this customer
       agreed to, and when. Falls back to the copy inside `state` for quotes
       saved before the field was promoted to the payload's top level. */
    terms: {
      accepted: !!(d.acceptedTerms || (d.state && d.state.acceptedTerms)),
      version: String(d.termsVersion || (d.state && d.state.termsVersion) || ''),
      at: String(d.termsAcceptedAt || (d.state && d.state.termsAcceptedAt) || '')
    },
    keyLoc: d.keyLoc || '', hhoAddr: d.hhoAddr || '',
    /* Everything the dimension editor needs to render itself pre-filled. The
       field list comes from the engine (DIM_FIELDS), so a newly priced
       dimension appears on the console without touching the console. */
    dims: (function () {
      const st = effectiveState_(d);
      if (!st) return { editable: false, why: 'This quote was saved before selections were stored, so it can\'t be re-priced automatically.' };
      const kind = String(st.unit || '');
      const fields = (DIM_FIELDS[kind] || []).map(function (f) {
        return { key: f[0], label: f[1], value: (st[f[0]] === undefined || st[f[0]] === null) ? '' : st[f[0]] };
      });
      return {
        editable: true, unitKind: kind, fields: fields,
        hasTrailer: !!st.hasTrailer,
        storage: String(st.storage || ''),
        /* Golf carts and e-bikes have exactly one tab each — there is nowhere
           to move them, so the console hides the control rather than offering
           a choice that does nothing. */
        canMoveStorage: allowedStorageFor_(kind).length > 1,
        /* The console renders exactly these, so the choices staff see can
           never include one the server would reject. */
        storageOptions: allowedStorageFor_(kind).map(function (v) {
          return { value: v, label: storageLabel_(v) };
        }),
        text: dimsString(st) || '',
        customerText: dimsString(d.state || {}) || '',
        measured: (d.manual && d.manual.measured) || null,
        measuredNote: (d.manual && d.manual.measuredNote) || ''
      };
    })(),
    lines: (d.lines || []).map(function (l, i) { return (i + 1) + '. ' + l.label + ' — ' + (l.amt ? usd_(l.amt) : 'incl.'); }),
    linesRaw: (d.lines || []).map(function (l, i) { return { i: i, label: l.label, amt: Number(l.amt || 0), sec: l.sec }; }),
    emailLog: (d.emailLog || []).slice().reverse() };
}

function adminRecordPayment(token, qn, amt, method, sendReceipt) {
  const who = requireAuth_(token, 'pay');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  const a = Number(String(amt).replace(/[$,\s]/g, ''));
  if (!isFinite(a) || a === 0) return { ok: 0, error: 'Enter a non-zero amount (negative = refund/settle-up).' };
  d.payments = d.payments || [];
  d.payments.push({ amt: a, method: String(method || 'Payment').trim(), date: new Date().toLocaleDateString() });
  const paid = paymentsTotal_(d);
  const bal = Number(d.total || 0) - paid;
  d.status = bal < -0.005 ? 'CREDIT DUE ' + usd_(-bal) : bal <= 0.005 ? 'Paid in full' : 'Payment received — balance ' + usd_(bal);
  d.ts = new Date().toISOString();
  const pdfUrl = savePdf_(d);
  ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue(d.status);
  ctx.sh.getRange(ctx.rowNum, COL.PDF).setValue(pdfUrl);
  ctx.sh.getRange(ctx.rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
  writeMoneyCols_(ctx.sh, ctx.rowNum, d);
  auditLog_(who.name, 'Payment ' + usd_(a) + ' (' + method + ') on ' + d.quoteNo + ' → ' + d.status);
  let receiptMsg = '';
  if (sendReceipt && d.email) { sendCustomerEmail_(d, '', false, { amt: a, method: method }); recordEmail_(ctx.sh, ctx.rowNum, d, 'receipt', who.name); receiptMsg = 'Receipt emailed to ' + d.email + '.'; }
  sendNotification_(d, ctx.sh.getName(), true, pdfUrl);
  return { ok: 1, msg: 'Recorded ' + usd_(a) + ' — ' + d.status + '. ' + receiptMsg };
}

function adminAdjust(token, qn, amt, desc, emailNow) {
  const who = requireAuth_(token, 'adjust');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  const a = Number(String(amt).replace(/[$,\s]/g, ''));
  const label = String(desc || '').trim();
  if (!isFinite(a) || a === 0 || !label) return { ok: 0, error: 'Need a non-zero amount and a description.' };
  d.lines = d.lines || [];
  d.lines.push({ sec: 'Adjustments', label: label, calc: '', amt: a, desc: '' });
  ensureManual_(d).adjustments.push({ label: label, amt: a });
  recomputeTotals_(d);
  saveQuoteRow_(ctx);
  auditLog_(who.name, 'Adjustment ' + (a < 0 ? '-' : '+') + usd_(Math.abs(a)) + ' "' + label + '" on ' + d.quoteNo);
  let mailMsg = 'Not emailed yet.';
  if (emailNow && d.email) {
    sendCustomerEmail_(d, label + ' (' + (a < 0 ? '-' : '+') + usd_(Math.abs(a)) + ')', true);
    const st = 'Adjusted & emailed';
    ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue(st); d.status = st;
    recordEmail_(ctx.sh, ctx.rowNum, d, 'updated', who.name);
    mailMsg = 'Updated copy emailed to ' + d.email + '.';
  }
  return { ok: 1, msg: 'New total ' + usd_(d.total) + '. ' + mailMsg };
}

function recordEmail_(sh, rowNum, d, kind, by) {
  d.emailLog = d.emailLog || [];
  d.emailLog.push({ ts: new Date().toLocaleString(), kind: kind, to: d.email || '', by: by || '' });
  if (sh) sh.getRange(rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
}

function adminSendEmail(token, qn, kind, extra) {
  const who = requireAuth_(token, 'email');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  if (!d.email) return { ok: 0, error: 'No customer email on this quote.' };
  const photos = String(ctx.sh.getRange(ctx.rowNum, COL.PHOTOS).getValue() || '');
  // notice kinds route through the shared builder (same HTML the preview showed)
  if (kind !== 'updated') {
    const built = buildEmailFor_(d, kind, extra, photos);
    if (!built) return { ok: 0, error: kind === 'latewarn' ? 'No unpaid balance — nothing to warn about.' : 'Unknown email type.' };
    const opts = { htmlBody: built.html, name: 'Quest Watersports', replyTo: REPLY_TO };
    const logo = getLogoBlob_();
    if (logo) opts.inlineImages = { questlogo: logo };
    /* Some notices carry the rebuilt quote/invoice — a re-measure is not much
       use to the customer without the paperwork that matches it. */
    if (built.attachPdf) {
      const pdf = getPdfBlob_(d.quoteNo);
      if (pdf) opts.attachments = [pdf];
    }
    if (FROM_ALIAS) opts.from = FROM_ALIAS;
    GmailApp.sendEmail(d.email, built.subject, built.subject, opts);
    ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue(built.status);
    recordEmail_(ctx.sh, ctx.rowNum, d, kind, who.name);
    auditLog_(who.name, 'Email "' + kind + '" sent for ' + d.quoteNo + ' to ' + d.email);
    return { ok: 1, msg: 'Sent to ' + d.email + '.' };
  }
  let statusVal = '';
  if (kind === 'updated') {
    sendCustomerEmail_(d, String(extra || ''), true);
    statusVal = 'Adjusted & emailed';
  } else return { ok: 0, error: 'Unknown email type.' };
  if (statusVal) ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue(statusVal);
  recordEmail_(ctx.sh, ctx.rowNum, d, kind, who.name);
  auditLog_(who.name, 'Email "' + kind + '" sent for ' + d.quoteNo + ' to ' + d.email);
  return { ok: 1, msg: 'Sent to ' + d.email + '.' };
}

function ensurePhotoFolders_(ctx) {
  const d = ctx.d;
  let url = String(ctx.sh.getRange(ctx.rowNum, COL.PHOTOS).getValue() || '');
  const season = getFolder_();
  let parentAll;
  const it = season.getFoldersByName('Unit Photos');
  parentAll = it.hasNext() ? it.next() : season.createFolder('Unit Photos');
  const name = (d.quoteNo || 'quote') + ' — ' + [d.firstName, d.lastName].filter(Boolean).join(' ');
  const it2 = parentAll.getFoldersByName(name);
  const f = it2.hasNext() ? it2.next() : parentAll.createFolder(name);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const sub = function (nm) {
    const i3 = f.getFoldersByName(nm);
    return i3.hasNext() ? i3.next() : f.createFolder(nm);
  };
  const winter = sub('Winter'), spring = sub('Spring');
  if (!url) {
    url = f.getUrl();
    ctx.sh.getRange(ctx.rowNum, COL.PHOTOS).setValue(url);
    d.photosUrl = url;
    ctx.sh.getRange(ctx.rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
  }
  return { folder: f, winter: winter, spring: spring, url: url };
}

function adminPhotoInfo(token, qn) {
  requireAuth_(token, 'photos');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const ff = ensurePhotoFolders_(ctx);
  return { ok: 1, url: ff.url,
    counts: { winter: (function(c,i){while(i.hasNext()){i.next();c++;}return c;})(0, ff.winter.getFiles()),
              spring: (function(c,i){while(i.hasNext()){i.next();c++;}return c;})(0, ff.spring.getFiles()) } };
}

function adminUploadContract(token, qn, fileName, base64Data, mimeType) {
  const who = requireAuth_(token, 'pay');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  const season = getFolder_();
  let cf;
  const it = season.getFoldersByName('Signed Contracts');
  cf = it.hasNext() ? it.next() : season.createFolder('Signed Contracts');
  // replace any prior copy for this quote
  const prior = cf.searchFiles('title contains "' + d.quoteNo + '"');
  while (prior.hasNext()) prior.next().setTrashed(true);
  const bytes = Utilities.base64Decode(base64Data);
  const nm = d.quoteNo + ' — ' + [d.firstName, d.lastName].filter(Boolean).join(' ') + ' — signed contract' +
    (String(fileName || '').match(/\.[A-Za-z0-9]+$/) ? String(fileName).match(/\.[A-Za-z0-9]+$/)[0] : '.pdf');
  const file = cf.createFile(Utilities.newBlob(bytes, mimeType || 'application/pdf', nm));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  d.contractUrl = file.getUrl();
  ctx.sh.getRange(ctx.rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
  auditLog_(who.name, 'Signed contract uploaded for ' + d.quoteNo + ' (' + fileName + ')');
  return { ok: 1, url: d.contractUrl };
}

function adminUploadPhoto(token, qn, seasonName, fileName, base64Data, mimeType) {
  const who = requireAuth_(token, 'photos');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const ff = ensurePhotoFolders_(ctx);
  const target = seasonName === 'spring' ? ff.spring : ff.winter;
  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', fileName || ('photo-' + Date.now() + '.jpg'));
  target.createFile(blob);
  auditLog_(who.name, 'Photo uploaded to ' + qn + ' (' + seasonName + '): ' + fileName);
  return { ok: 1 };
}

function adminLateFee(token, qn, amt, label, emailNow) {
  const who = requireAuth_(token, 'adjust');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  const paid = paymentsTotal_(d);
  const bal = Number(d.total || 0) - paid;
  if (bal <= 0.005) return { ok: 0, error: 'This invoice has no unpaid balance — no fee to apply.' };
  const a = Number(String(amt).replace(/[$,\s]/g, ''));
  if (!isFinite(a) || a <= 0) return { ok: 0, error: 'Enter a positive fee amount.' };
  const payBy = (d.season && d.season.payByShort) || 'the due date';
  const feeLabel = String(label || '').trim() || ('Late payment fee — balance unpaid after ' + payBy);
  d.lines = d.lines || [];
  d.lines.push({ sec: 'Adjustments', label: feeLabel, calc: '', amt: a, desc: '' });
  ensureManual_(d).adjustments.push({ label: feeLabel, amt: a });
  recomputeTotals_(d);
  const newBal = Number(d.total) - paid;
  saveQuoteRow_(ctx, 'Late fee added — balance ' + usd_(newBal));
  auditLog_(who.name, 'Late fee ' + usd_(a) + ' "' + feeLabel + '" on ' + d.quoteNo);
  let mailMsg = 'Customer not emailed yet.';
  if (emailNow && d.email) {
    sendCustomerEmail_(d, feeLabel + ' (+' + usd_(a) + ')', true);
    recordEmail_(ctx.sh, ctx.rowNum, d, 'late fee applied', who.name);
    mailMsg = 'Updated invoice emailed to ' + d.email + '.';
  }
  sendNotification_(d, ctx.sh.getName(), true, ctx.sh.getRange(ctx.rowNum, COL.PDF).getValue());
  return { ok: 1, msg: 'Fee applied — new balance ' + usd_(newBal) + '. ' + mailMsg };
}

function adminStorageView(token) {
  requireAuth_(token, 'view');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const groups = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getRange(1, 3).getValue() !== 'Quote #') return;
    const last = sh.getLastRow();
    const rows = [];
    if (last > 1) {
      sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (r) {
        if (!r[COL.QN - 1]) return;
        const bal = Number(r[COL.BAL - 1] || 0);
        let keys = '';
        try { const pd = JSON.parse(r[COL.PAYLOAD - 1] || '{}'); keys = pd.keyLoc || ''; } catch (e) {}
        rows.push({ qn: r[COL.QN - 1],
          name: [r[COL.LAST - 1], r[COL.FIRST - 1]].filter(Boolean).join(', '),
          unit: r[COL.UNIT - 1] || '', ymm: r[COL.YMM - 1] || '', dims: r[COL.DIMS - 1] || '',
          status: r[COL.STATUS - 1] || '', keys: keys,
          balance: bal < -0.005 ? 'CREDIT ' + usd_(-bal) : bal > 0.005 ? usd_(bal) : 'Paid' });
      });
    }
    rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    groups.push({ tab: sh.getName(), count: rows.length, rows: rows });
  });
  // storage areas first, No Storage last
  groups.sort(function (a, b) {
    const w = function (t) { return t === 'No Storage' ? 2 : 1; };
    return w(a.tab) - w(b.tab) || a.tab.localeCompare(b.tab);
  });
  return { ok: 1, groups: groups };
}

function adminPriceRequest(token, qn, rqLabel, amt, note) {
  const who = requireAuth_(token, 'adjust');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  const rqs = String(d.quotesRequested || '').split('; ').filter(function (x) { return x; });
  const item = String(rqLabel || '').trim();
  if (rqs.indexOf(item) === -1) return { ok: 0, error: 'That request is no longer open.' };
  const a = Number(String(amt).replace(/[$,\s]/g, ''));
  if (!isFinite(a) || a <= 0) return { ok: 0, error: 'Enter a positive price, e.g. 225.' };
  const nt = String(note || '').trim();
  const finalLabel = nt ? item + ' — ' + nt : item;
  ensureManual_(d).priced.push({ rqLabel: item, label: finalLabel, amt: a, sec: 'Additional services' });
  d.lines = d.lines || [];
  d.lines.push({ sec: 'Additional services', label: finalLabel, calc: '', amt: a, desc: '' });
  d.quotesRequested = rqs.filter(function (x) { return x !== item; }).join('; ');
  recomputeTotals_(d);
  saveQuoteRow_(ctx);
  auditLog_(who.name, 'Priced request "' + item + '" at ' + usd_(a) + ' on ' + d.quoteNo);
  return { ok: 1, msg: 'Priced "' + item + '" at ' + usd_(a) + ' — new total ' + usd_(d.total) + '. No email sent yet.' };
}

/* ============ SEASON-DONE SURVEY (from the quote email) ============ */
function applySeasonDone_(d, choice, doneDate, note) {
  d.seasonDone = { choice: choice, date: doneDate || '', note: String(note || '').trim(), at: new Date().toLocaleString() };
  // Late Retrieval Surcharge applies when the customer says they'll finish after Nov 15
  const RULE = (d.season && d.season.lateRetrievalLabel) || 'Late retrieval surcharge (after Nov 15)';
  const AMT = (d.season && Number(d.season.lateRetrievalFee)) || 225;
  const m = ensureManual_(d);
  const hasSurcharge = (d.lines || []).some(function (l) { return l.label === RULE; });
  let afterCutoff = false;
  if (choice === 'date' && doneDate) {
    const dt = new Date(doneDate);
    const cut = new Date(dt.getFullYear(), 10, 15); // Nov 15 of the stated year
    if (!isNaN(dt.getTime()) && dt > cut) afterCutoff = true;
  }
  if (afterCutoff && !hasSurcharge) {
    d.lines = d.lines || [];
    d.lines.push({ sec: 'Adjustments', label: RULE, calc: '', amt: AMT, desc: '' });
    m.adjustments.push({ label: RULE, amt: AMT });
    recomputeTotals_(d);
  } else if (!afterCutoff && hasSurcharge) {
    // customer changed their answer to an on-time date — remove a previously auto-added surcharge
    d.lines = d.lines.filter(function (l) { return l.label !== RULE; });
    m.adjustments = m.adjustments.filter(function (a) { return a.label !== RULE; });
    recomputeTotals_(d);
  }
  return afterCutoff;
}

function adminSetSeasonDone(token, qn, choice, doneDate, note) {
  const who = requireAuth_(token, 'adjust');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  const after = applySeasonDone_(d, choice, doneDate, note);
  saveQuoteRow_(ctx);
  auditLog_(who.name, 'Season-done set on ' + d.quoteNo + ': ' + choice + (doneDate ? ' ' + doneDate : '') + (after ? ' (surcharge applied)' : ''));
  return { ok: 1, msg: 'Saved' + (after ? ' — late retrieval surcharge applied. New total ' + usd_(d.total) + '.' : '.') + ' No email sent.' };
}

function adminEditLine(token, qn, idx, action, newAmt, newLabel) {
  const who = requireAuth_(token, 'adjust');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  d.lines = d.lines || [];
  idx = Math.floor(Number(idx));
  if (!(idx >= 0 && idx < d.lines.length)) return { ok: 0, error: 'Bad line number.' };
  const line = d.lines[idx];
  const m = ensureManual_(d);
  if (action === 'delete') {
    if (line.sec === 'Adjustments') {
      const ai = m.adjustments.findIndex(function (a) { return a.label === line.label; });
      if (ai > -1) m.adjustments.splice(ai, 1);
    } else {
      const orig = originalLabelFor_(m, line.label);
      m.edits = m.edits.filter(function (e2) { return e2.label !== orig; });
      m.removed.push(orig);
    }
    d.lines.splice(idx, 1);
    recomputeTotals_(d);
    saveQuoteRow_(ctx);
    auditLog_(who.name, 'Line removed on ' + d.quoteNo + ': "' + line.label + '"');
    return { ok: 1, msg: 'Removed "' + line.label + '" — new total ' + usd_(d.total) + '. No email sent yet.' };
  }
  const a = Number(String(newAmt).replace(/[$,\s]/g, ''));
  if (!isFinite(a)) return { ok: 0, error: 'Enter a valid amount.' };
  const nl = String(newLabel || '').trim();
  if (line.sec === 'Adjustments') {
    const adj = m.adjustments.find(function (x) { return x.label === line.label; });
    if (adj) { adj.amt = a; if (nl) adj.label = nl; }
  } else {
    const orig = originalLabelFor_(m, line.label);
    let e2 = m.edits.find(function (x) { return x.label === orig; });
    if (!e2) { e2 = { label: orig }; m.edits.push(e2); }
    e2.newAmt = a;
    if (nl) e2.newLabel = nl;
  }
  line.amt = a; line.calc = '';
  if (nl) line.label = nl;
  recomputeTotals_(d);
  saveQuoteRow_(ctx);
  auditLog_(who.name, 'Line edited on ' + d.quoteNo + ': "' + line.label + '" -> ' + usd_(a));
  return { ok: 1, msg: 'Updated — new total ' + usd_(d.total) + '. No email sent yet.' };
}

/* ---- admin-only: roster management ---- */
function adminListStaff(token) {
  const who = requireAuth_(token, 'view');
  if (!who.admin) return { ok: 0, error: 'Admins only.' };
  const roster = getStaff_();
  return { ok: 1, staff: Object.keys(roster).map(function (n) {
    return { name: n, admin: !!roster[n].admin, perms: roster[n].perms || {} };
  }) };
}
function adminSetPerm(token, name, perm, value) {
  const who = requireAuth_(token, 'view');
  if (!who.admin) return { ok: 0, error: 'Admins only.' };
  const roster = getStaff_();
  if (!roster[name]) return { ok: 0, error: 'No such person.' };
  if (perm === 'admin') {
    /* Same lockout hazard as removal: the console cannot recover a roster with
       no admins left in it. */
    if (!value && roster[name].admin && adminCount_(roster, name) === 0) {
      return { ok: 0, error: 'That is the last admin account. Make someone else an admin first.' };
    }
    roster[name].admin = !!value;
  }
  else { roster[name].perms = roster[name].perms || {}; roster[name].perms[perm] = value ? 1 : 0; }
  saveStaff_(roster);
  auditLog_(who.name, 'Permission "' + perm + '" for ' + name + ' set to ' + (value ? 'ON' : 'OFF'));
  return { ok: 1 };
}
/* A PIN is the ONLY credential on this console -- adminAuth looks the person
 * up BY pin, so two people sharing one would silently sign the second one in
 * as the first. Always mint through here. */
function freshPin_(roster) {
  const taken = {};
  Object.keys(roster).forEach(function (n) { taken[String(roster[n].pin)] = 1; });
  for (let i = 0; i < 500; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    if (!taken[pin]) return pin;
  }
  throw new Error('Could not find an unused PIN — the roster is implausibly large.');
}

/* How many admins would remain if `excluding` were removed or demoted. Guards
 * against the one mistake that cannot be undone from the console: leaving the
 * roster with nobody who can administer it. */
function adminCount_(roster, excluding) {
  return Object.keys(roster).filter(function (n) {
    return n !== excluding && roster[n].admin;
  }).length;
}

/* Drop every live session belonging to a person. requireAuth_ already refuses
 * a session whose roster entry is gone ("Account removed."), so this is belt
 * and braces -- but it also stops dead SESS_ properties accumulating. */
function revokeSessions_(name) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('SESS_') !== 0) return;
    try {
      if (JSON.parse(all[k]).name === name) { props.deleteProperty(k); n++; }
    } catch (e) {}
  });
  return n;
}

/* ================= RESTORE FROM A DAILY BACKUP =================
 * dailyBackup() emails a full .xlsx of this spreadsheet every evening. This is
 * the way back in when something goes wrong: upload one of those files and put
 * quotes back.
 *
 * Admin only, and deliberately a two-step: upload shows you a comparison and
 * writes nothing, then you choose what to restore. The rules that keep it from
 * making a bad day worse:
 *
 *  - A LIVE QUOTE IS NEVER DELETED. Restoring only ever writes rows the backup
 *    knows about. A quote taken since the backup stays exactly where it is,
 *    whichever mode you pick, so a restore can never lose newer work.
 *  - A SNAPSHOT OF THE CURRENT SHEET IS SAVED FIRST, to Drive, every time. The
 *    restore is itself undoable.
 *  - The default mode only fills in quotes that are MISSING. Overwriting rows
 *    that still exist is a separate, explicit choice.
 */
const BACKUP_TMP_PREFIX_ = 'Quest restore source — ';

/* ONE-TIME, run from the Apps Script editor after the restore feature is
 * pushed and BEFORE it is deployed. See docs/BACKUP-RESTORE.md.
 *
 * Reading an uploaded backup needs two things this script had never done:
 * open a spreadsheet by id (rather than the bound one), and upload to the
 * Drive API. Both widen the OAuth scopes Apps Script infers, and this web app
 * runs as the deploying user with anonymous access -- so a scope waiting on
 * approval can take the CUSTOMER page down, not just this feature. Running
 * this once triggers the approval prompt while nothing is live yet.
 *
 * Touches nothing: it reopens this same spreadsheet read-only and asks Drive
 * who we are. */
function checkRestoreAccess() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const again = SpreadsheetApp.openById(ss.getId());
  console.log('1/2 Sheets: reopened "' + again.getName() + '" by id — OK.');
  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.log('2/2 Drive API returned ' + res.getResponseCode() + ' — NOT ready. ' + res.getContentText().slice(0, 200));
    return;
  }
  console.log('2/2 Drive API: OK.');
  console.log('Both permissions are granted. The backup restore will work — safe to deploy.');
}

/* Upload bytes to Drive and let Drive convert them into a Sheet on the way in.
 * Apps Script cannot read .xlsx directly; this is the conversion step. Uses the
 * same OAuth token and Drive access the daily backup already relies on, so it
 * introduces no new Google permission. */
function uploadAsSheet_(blob, name) {
  const boundary = 'quest' + Utilities.getUuid();
  const meta = { name: name, mimeType: 'application/vnd.google-apps.spreadsheet' };
  const head = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + (blob.getContentType() || 'application/octet-stream') + '\r\n\r\n';
  const tail = '\r\n--' + boundary + '--\r\n';
  const bytes = Utilities.newBlob(head).getBytes()
    .concat(blob.getBytes())
    .concat(Utilities.newBlob(tail).getBytes());
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: Utilities.newBlob(bytes).getBytes(),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  if (res.getResponseCode() >= 300) {
    throw new Error('Drive could not read that file (' + res.getResponseCode() + '). ' +
      'Make sure it is one of the .xlsx backups from the nightly email, not a PDF or a screenshot.');
  }
  return JSON.parse(res.getContentText()).id;
}

/* Every quote row in a spreadsheet, keyed by quote number. Works on the live
 * sheet and on a converted backup alike -- same shape, same column order. */
function readQuoteRows_(ss) {
  const out = {};
  ss.getSheets().forEach(function (sh) {
    if (sh.getRange(1, 3).getValue() !== 'Quote #') return;
    const last = sh.getLastRow();
    if (last < 2) return;
    const vals = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    vals.forEach(function (row, i) {
      const qn = String(row[COL.QN - 1] || '').trim();
      if (!qn) return;
      out[qn] = { tab: sh.getName(), row: row, rowNum: i + 2 };
    });
  });
  return out;
}

function backupSummaryFor_(liveRows, backRows) {
  const missing = [], differ = [], same = [], newer = [];
  Object.keys(backRows).forEach(function (qn) {
    const b = backRows[qn], l = liveRows[qn];
    if (!l) { missing.push({ quoteNo: qn, tab: b.tab, total: Number(b.row[COL.TOTAL - 1] || 0) }); return; }
    const bp = String(b.row[COL.PAYLOAD - 1] || ''), lp = String(l.row[COL.PAYLOAD - 1] || '');
    if (bp === lp && b.tab === l.tab) { same.push(qn); return; }
    differ.push({
      quoteNo: qn, tab: b.tab, liveTab: l.tab,
      backupTotal: Number(b.row[COL.TOTAL - 1] || 0),
      liveTotal: Number(l.row[COL.TOTAL - 1] || 0)
    });
  });
  Object.keys(liveRows).forEach(function (qn) {
    if (!backRows[qn]) newer.push({ quoteNo: qn, tab: liveRows[qn].tab, total: Number(liveRows[qn].row[COL.TOTAL - 1] || 0) });
  });
  return { missing: missing, differ: differ, same: same, newer: newer };
}

function adminBackupPreview(token, fileName, base64Data) {
  const who = requireAuth_(token, 'view');
  if (!who.admin) return { ok: 0, error: 'Admins only.' };
  if (!base64Data) return { ok: 0, error: 'No file received.' };
  let fileId;
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      String(fileName || 'backup.xlsx'));
    fileId = uploadAsSheet_(blob, BACKUP_TMP_PREFIX_ + new Date().toISOString());
  } catch (err) {
    return { ok: 0, error: String(err.message || err) };
  }
  try {
    const backSs = SpreadsheetApp.openById(fileId);
    const backRows = readQuoteRows_(backSs);
    if (!Object.keys(backRows).length) {
      DriveApp.getFileById(fileId).setTrashed(true);
      return { ok: 0, error: 'That file has no quote tabs in it. Is it one of the nightly backup attachments?' };
    }
    const liveRows = readQuoteRows_(SpreadsheetApp.getActiveSpreadsheet());
    const sum = backupSummaryFor_(liveRows, backRows);
    auditLog_(who.name, 'Backup inspected: ' + fileName + ' — ' + Object.keys(backRows).length +
      ' quote(s); ' + sum.missing.length + ' missing live, ' + sum.differ.length + ' differing');
    return {
      ok: 1, fileId: fileId, fileName: String(fileName || ''),
      backupCount: Object.keys(backRows).length,
      liveCount: Object.keys(liveRows).length,
      missing: sum.missing, differ: sum.differ, newer: sum.newer, sameCount: sum.same.length
    };
  } catch (err) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
    return { ok: 0, error: 'Could not read that backup: ' + String(err.message || err) };
  }
}

/* Save the CURRENT sheet to Drive before touching anything, so the restore can
 * itself be undone. Same export the nightly backup uses. */
function snapshotBeforeRestore_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  const blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } })
    .getBlob().setName(ss.getName() + ' — before restore ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm') + '.xlsx');
  return getFolder_().createFile(blob);
}

function adminBackupRestore(token, fileId, mode, quoteNos) {
  const who = requireAuth_(token, 'view');
  if (!who.admin) return { ok: 0, error: 'Admins only.' };
  if (!fileId) return { ok: 0, error: 'Upload the backup again — the reference expired.' };

  let backSs;
  try { backSs = SpreadsheetApp.openById(fileId); }
  catch (err) { return { ok: 0, error: 'Upload the backup again — the reference expired.' }; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const backRows = readQuoteRows_(backSs);
  const liveRows = readQuoteRows_(ss);
  const sum = backupSummaryFor_(liveRows, backRows);

  let wanted;
  if (mode === 'all') {
    wanted = sum.missing.map(function (m) { return m.quoteNo; })
      .concat(sum.differ.map(function (m) { return m.quoteNo; }));
  } else if (mode === 'selected') {
    wanted = (quoteNos || []).map(function (q) { return String(q).trim().toUpperCase(); })
      .filter(function (q) { return backRows[q]; });
  } else {
    wanted = sum.missing.map(function (m) { return m.quoteNo; });
  }
  if (!wanted.length) return { ok: 0, error: 'Nothing to restore for that choice.' };

  const snap = snapshotBeforeRestore_();

  let restored = 0;
  wanted.forEach(function (qn) {
    const b = backRows[qn];
    if (!b) return;
    /* Clear any live copy wherever it sits, then write the backup's row onto
       the tab the backup had it on. Quotes absent from the backup are never
       touched. */
    ss.getSheets().forEach(function (sh) {
      if (sh.getRange(1, 3).getValue() !== 'Quote #') return;
      let r = findQuoteRow_(sh, qn);
      while (r > 0) { sh.deleteRow(r); r = findQuoteRow_(sh, qn); }
    });
    let dest = ss.getSheetByName(b.tab);
    if (!dest) {
      dest = ss.insertSheet(b.tab);
      dest.appendRow(HEADERS);
      dest.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      dest.setFrozenRows(1);
    }
    const rowNum = dest.getLastRow() + 1;
    dest.getRange(rowNum, 1, 1, HEADERS.length).setValues([b.row]);
    dest.getRange(rowNum, COL.TOTAL, 1, 2).setNumberFormat('$#,##0.00');
    dest.getRange(rowNum, COL.PAID, 1, 1).setNumberFormat('$#,##0.00');
    dest.getRange(rowNum, COL.BAL, 1, 1).setNumberFormat('$#,##0.00');
    dest.getRange(rowNum, COL.ITEMS).setWrap(true);
    restored++;
  });

  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  auditLog_(who.name, 'RESTORED ' + restored + ' quote(s) from backup (mode: ' + mode +
    '). Pre-restore snapshot: ' + snap.getUrl());
  return {
    ok: 1,
    msg: 'Restored ' + restored + ' quote(s). Nothing else was touched, and a snapshot of the sheet ' +
         'as it was a moment ago is saved in Drive.',
    restored: restored,
    snapshotUrl: snap.getUrl()
  };
}

function adminAddStaff(token, name, perms, isAdmin) {
  const who = requireAuth_(token, 'view');
  if (!who.admin) return { ok: 0, error: 'Admins only.' };
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: 0, error: 'Enter a name.' };
  if (clean.length > 40) return { ok: 0, error: 'That name is too long.' };
  const roster = getStaff_();
  /* Case-insensitive, because "chris" and "Chris" would be two roster entries
     that look like one person on screen. */
  const clash = Object.keys(roster).find(function (n) {
    return n.toLowerCase() === clean.toLowerCase();
  });
  if (clash) return { ok: 0, error: '"' + clash + '" is already on the roster.' };

  const p = perms || {};
  const pin = freshPin_(roster);
  roster[clean] = {
    pin: pin,
    admin: !!isAdmin,
    perms: { pay: p.pay ? 1 : 0, adjust: p.adjust ? 1 : 0, email: p.email ? 1 : 0, photos: p.photos ? 1 : 0 }
  };
  saveStaff_(roster);
  auditLog_(who.name, 'Added staff account "' + clean + '"' + (isAdmin ? ' (admin)' : '') +
    ' with ' + (Object.keys(roster[clean].perms).filter(function (k) { return roster[clean].perms[k]; }).join(', ') || 'no permissions'));
  return { ok: 1, name: clean, pin: pin };
}

function adminRemoveStaff(token, name) {
  const who = requireAuth_(token, 'view');
  if (!who.admin) return { ok: 0, error: 'Admins only.' };
  const roster = getStaff_();
  if (!roster[name]) return { ok: 0, error: 'No such person.' };
  /* Removing yourself would end your own session mid-action, and removing the
     last admin would leave the roster unmanageable from the console -- there
     is no way back from either without editing Script Properties by hand. */
  if (name === who.name) return { ok: 0, error: 'You can\'t remove your own account — ask the other admin.' };
  if (roster[name].admin && adminCount_(roster, name) === 0) {
    return { ok: 0, error: 'That is the last admin account. Make someone else an admin first.' };
  }
  delete roster[name];
  saveStaff_(roster);
  const killed = revokeSessions_(name);
  auditLog_(who.name, 'Removed staff account "' + name + '"' + (killed ? ' (' + killed + ' session(s) ended)' : ''));
  return { ok: 1, msg: '"' + name + '" removed.' + (killed ? ' Signed them out of ' + killed + ' device(s).' : '') };
}

function adminResetPin(token, name) {
  const who = requireAuth_(token, 'view');
  if (!who.admin) return { ok: 0, error: 'Admins only.' };
  const roster = getStaff_();
  if (!roster[name]) return { ok: 0, error: 'No such person.' };
  const pin = freshPin_(roster);
  roster[name].pin = pin;
  saveStaff_(roster);
  auditLog_(who.name, 'PIN reset for ' + name);
  return { ok: 1, pin: pin };
}

/* ============ LIFECYCLE: photos + seasonal notices ============ */
function noticeHtml_(d, introHtml, extraButtonsHtml, includeMoney) {
  const paid = paymentsTotal_(d);
  const balance = Number(d.total || 0) - paid;
  const logoTag = LOGO_URL
    ? '<img src="cid:questlogo" alt="Quest Watersports" width="104" height="56" style="width:104px;height:56px;display:block;border:0">'
    : '<div style="font-family:Arial Black,Arial;font-size:24px;color:#14293E;letter-spacing:1px">QUEST WATERSPORTS</div>';
  let money = '';
  if (includeMoney && balance < -0.005) {
    money = '<div style="background:#FDFCF7;border:1px solid #C7D5E0;border-radius:8px;padding:14px 18px;margin:16px 0">' +
      '<table width="100%" cellpadding="0" cellspacing="0">' +
      '<tr><td style="padding:4px 0;font-weight:bold;color:#1E6B3A">Credit on your account — we\'ll settle up with you</td>' +
      '<td align="right" style="padding:4px 0;font-weight:bold;color:#1E6B3A">' + usd_(-balance) + '</td></tr></table></div>';
  } else if (includeMoney && balance > 0.005) {
    money = '<div style="background:#FDFCF7;border:1px solid #C7D5E0;border-radius:8px;padding:14px 18px;margin:16px 0">' +
      '<table width="100%" cellpadding="0" cellspacing="0">' +
      moneyRow_('Open balance on this invoice', usd_(balance), true) + '</table>' +
      '<div style="margin-top:8px">' + buttonHtml_(PAYMENT_URL, 'Pay online', '#C08A22') + '</div></div>';
  }
  const html =
  '<div style="background:#EBF1F6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #C7D5E0">' +
      '<div style="padding:22px 28px;border-bottom:4px solid #C08A22">' + logoTag + '</div>' +
      '<div style="padding:26px 28px">' +
        '<p style="font-size:16px;color:#1D2B38;margin:0 0 6px">Hi ' + esc_(d.firstName || 'there') + ',</p>' +
        '<div style="font-size:15px;color:#1D2B38;line-height:1.55;margin:0 0 14px">' + introHtml + '</div>' +
        '<div style="font-family:Courier New,monospace;font-size:13px;color:#5C7185;margin-bottom:10px">' + docTerm_(d).toUpperCase() + '# ' + esc_(d.quoteNo) + ' &nbsp;·&nbsp; ' + esc_(d.unit) + (d.ymm ? ' &nbsp;·&nbsp; ' + esc_(d.ymm) : '') + '</div>' +
        (extraButtonsHtml || '') + money +
        '<p style="font-size:13px;color:#5C7185;line-height:1.5;margin:12px 0 0">Questions? Call us at (815) 433-2200.</p>' +
      '</div>' +
      '<div style="background:#14293E;color:#B9CDDD;padding:14px 28px;font-size:12px">Quest Watersports · 1851 Old Chicago Road, Ottawa, IL · (815) 433-2200</div>' +
    '</div>' +
  '</div>';
  return html;
}

function sendCustomerNotice_(d, subject, introHtml, extraButtonsHtml, includeMoney) {
  const html = noticeHtml_(d, introHtml, extraButtonsHtml, includeMoney);
  const opts = { htmlBody: html, name: 'Quest Watersports', replyTo: REPLY_TO };
  const logo = getLogoBlob_();
  if (logo) opts.inlineImages = { questlogo: logo };
  if (FROM_ALIAS) opts.from = FROM_ALIAS;
  GmailApp.sendEmail(d.email, subject, subject, opts);
}

/* One builder used by BOTH preview and send, so what you preview is what goes out */
function buildEmailFor_(d, kind, extra, photos) {
  /* Lead follow-up: someone started a quote and walked away. Deliberately
     short and low-pressure -- they have no pricing yet, so there is nothing to
     summarise and nothing to attach. The link carries quote number and last
     name so the page restores their quote without them typing anything, and
     the number is spelled out as well for anyone whose client mangles links. */
  if (kind === 'finishquote') {
    const resume = QUOTE_PAGE_URL + '?quote=' + encodeURIComponent(d.quoteNo || '') +
                   '&ln=' + encodeURIComponent(d.lastName || '');
    /* No greeting here: noticeHtml_ already opens with "Hi <first name>," for
       every kind, and a second one reads like a mail merge gone wrong. */
    const intro = 'It' +
      ' looks like you started a winter services quote with us and didn\'t get a chance to finish. ' +
      'No problem at all — everything you entered is saved, so you can pick up right where you left off.' +
      '<br><br>' +
      '<b>If anything was confusing, or you\'d rather not do it online, just call us at ' +
      '(815) 433-2200 or stop by the shop at 1851 Old Chicago Road.</b> We\'re glad to walk through ' +
      'it with you and build the quote together — measurements especially are often easier to sort ' +
      'out over the phone than on a form.' +
      '<br><br>' +
      'Otherwise, the button below picks your quote right back up where you left it.';
    const btn = '<div style="margin:6px 0 10px">' + buttonHtml_(resume, 'Finish my quote', '#14293E') + '</div>' +
      '<div style="font-size:13px;color:#5C7185;margin-bottom:4px">Your quote number is <b>' +
      esc_(d.quoteNo || '') + '</b> — you can also enter it with your last name on the quote page ' +
      'if the button doesn\'t work for you.</div>';
    return { subject: 'Your winter quote is saved — finish it any time · ' + (d.quoteNo || ''),
      html: noticeHtml_(d, intro, btn, false), status: 'Lead follow-up sent' };
  }
  /* Sent after staff re-measure a unit or move it between storage locations.
     Leads with what changed and what it costs, because that is the only thing
     the customer actually needs from this email. Attaches the rebuilt
     quote/invoice via attachPdf below. */
  if (kind === 'dims') {
    const cur = effectiveState_(d) || {};
    const orig = d.state || {};
    const term = docTerm_(d).toLowerCase();
    const paid = paymentsTotal_(d);
    const bal = Number(d.total || 0) - paid;
    const wasDims = dimsString(orig), nowDims = dimsString(cur);
    const meas = (d.manual && d.manual.measured) || {};
    const movedTo = meas.storage ? storageLabel_(meas.storage) : '';

    /* Say what actually happened. Telling someone we measured their boat when
       all we did was move it between buildings is the kind of small wrongness
       that costs you the customer's trust in the rest of the email. */
    const measuredDims = ['loa', 'beam', 'lwt', 'skiLen', 'skiWid', 'hasTrailer']
      .some(function (k) { return meas[k] !== undefined; });
    const unitTxt = esc_(d.unit || 'unit');
    let intro;
    if (measuredDims && movedTo) {
      intro = 'We measured your ' + unitTxt + ' here at the shop and moved it to <b>' + esc_(movedTo) +
        '</b>, and updated your ' + term + ' to match. Winter pricing depends on both size and where ' +
        'a unit is stored, so the figures below reflect those changes.';
    } else if (measuredDims) {
      intro = 'We measured your ' + unitTxt + ' here at the shop and updated your ' + term +
        ' to match. Winter pricing is based on size, so the figures below reflect the measurements we took.';
    } else if (movedTo) {
      intro = 'We\'ve moved your ' + unitTxt + ' to <b>' + esc_(movedTo) + '</b> and updated your ' +
        term + ' to match. Winter pricing depends on where a unit is stored, so the figures below ' +
        'reflect the change.';
    } else {
      intro = 'We\'ve updated your ' + term + '. The figures below are current.';
    }
    if (d.manual && d.manual.measuredNote) {
      intro += '<br><br><b>' + esc_(d.manual.measuredNote) + '</b>';
    }
    intro += '<br><br>If anything here looks off to you, call us at (815) 433-2200 — we\'d rather ' +
      (measuredDims ? 're-check a measurement' : 'sort it out now') +
      ' than have you wondering about it.';

    const row = function (k, v) {
      return '<tr><td style="padding:3px 12px 3px 0;font-size:14px;color:#5C7185">' + k +
        '</td><td style="padding:3px 0;font-size:14px;color:#1D2B38"><b>' + v + '</b></td></tr>';
    };
    const box = '<div style="background:#FDFCF7;border:1px solid #C7D5E0;border-radius:8px;padding:14px 16px;margin:4px 0 10px">' +
      '<table cellpadding="0" cellspacing="0">' +
      (measuredDims && wasDims && nowDims && wasDims !== nowDims
        ? row('Previously', esc_(wasDims)) + row('Now measured', esc_(nowDims))
        : (nowDims ? row('Measurements', esc_(nowDims)) : '')) +
      (movedTo ? row('Storage', esc_(movedTo)) : '') +
      row('Updated ' + term + ' total', usd_(d.total)) +
      (paid > 0 ? row('Payments received', '\u2212' + usd_(paid)) : '') +
      (paid > 0
        ? (bal < -0.005
            ? row('Credit due to you', usd_(-bal))
            : row('Balance due', usd_(Math.max(0, bal))))
        : '') +
      '</table></div>';

    return {
      subject: 'We\'ve updated your winter ' + term +
        (measuredDims ? ' after measuring' : movedTo ? ' — storage change' : '') +
        ' \u00b7 ' + (d.quoteNo || ''),
      html: noticeHtml_(d, intro, box, true),
      status: 'Dimensions updated — customer notified',
      attachPdf: true
    };
  }
  if (kind === 'stored') {
    const land = isLandUnit_(d);
    const intro = 'Good news — your ' + esc_(d.unit) + ' is safely with us for the winter. We photograph every unit as it arrives so you have a record of its condition' + (photos ? ' — you can view your photos any time using the button below.' : '.') + ' We\'ll see you in the spring, and we\'ll be in touch before ' + (land ? 'your ' + esc_(d.unit).toLowerCase() + '\'s return.' : 'relaunch.');
    const btn = photos ? '<div style="margin:6px 0 2px">' + buttonHtml_(photos, 'View arrival photos', '#14293E') + '</div>' : '';
    return { subject: 'We have your ' + d.unit + ' — Quest Watersports',
      html: noticeHtml_(d, intro, btn, true), status: 'Stored — customer notified' };
  }
  if (kind === 'spring') {
    const land = isLandUnit_(d);
    const base = WEB_APP_URL;
    const mk = function (pref, label, bg) {
      const u = base + '?action=launchpref&quote=' + encodeURIComponent(d.quoteNo) + '&ln=' + encodeURIComponent(d.lastName || '') + '&pref=' + pref;
      return buttonHtml_(u, label, bg);
    };
    const backPhrase = land ? 'heads back out' : 'goes back in the water';
    const whenQ = land ? 'When would you like it back?' : 'When would you like to launch?';
    const intro = 'It\'s almost spring — ' + (land ? 'time to plan your ' + esc_(d.unit) + '\'s return!' : 'relaunch season is coming up!') + ' Two quick things:<br><br>' +
      '<b>1. Any last-minute work?</b> If there\'s anything you want done before your ' + esc_(d.unit) + ' ' + backPhrase + ' — service, detail, accessories — reply to this email or call us now, while it\'s still easy to get to.<br><br>' +
      '<b>2. ' + whenQ + '</b> Tap one below. We can\'t commit to exact dates — weather and the occasional mechanical surprise on units ahead of you can shift the schedule — but your preference sets where you land in the line, and we\'ll email you when you\'re up next.';
    const buttons = '<div style="margin:6px 0 10px">' + mk('early', 'As early as possible', '#14293E') + mk('any', 'Any time works', '#4A81A6') + mk('late', 'As late as possible', '#C08A22') + '</div>';
    return { subject: 'It\'s almost spring — let\'s plan your ' + (land ? esc_(d.unit).toLowerCase() + '\'s return' : 'relaunch') + ' · ' + d.quoteNo,
      html: noticeHtml_(d, intro, buttons, true), status: 'Spring alert sent' };
  }
  if (kind === 'upnext') {
    const land = isLandUnit_(d);
    const whenTxt = String(extra || 'in the next few days');
    const verb = land ? 'bring your ' + esc_(d.unit) + ' back' : 'launch your ' + esc_(d.unit);
    const intro = 'You\'re up next! We expect to ' + verb + ' <b>' + esc_(whenTxt) + '</b>. As always, weather or a surprise on a unit ahead of you can shift things slightly — we\'ll let you know if anything changes. If you have any last-minute requests, now is the moment to call.';
    return { subject: 'You\'re up next — ' + (land ? 'return delivery ' : 'relaunch ') + whenTxt + ' · ' + d.quoteNo,
      html: noticeHtml_(d, intro, '', true), status: 'Up next — customer notified' };
  }
  if (kind === 'splash') {
    const bike = isBike_(d), land = isLandUnit_(d);
    const headline = bike ? 'Your e-bike is ready to ride!' : land ? 'Your ' + esc_(d.unit).toLowerCase() + ' is back home!' : 'You\'re back in the water!';
    const bodyLead = bike ? 'Your e-bike is tuned up, charged, and back with you' : land ? 'Your ' + esc_(d.unit) + ' is back at Heritage Harbor and ready to go' : 'Your ' + esc_(d.unit) + ' is back in the water';
    const photoWord = land ? 'return photos' : 'relaunch photos';
    const intro = bodyLead + (photos ? ' — ' + photoWord + ' are at the button below.' : '.') + (land ? ' Thanks for wintering with Quest. Have a great summer!' : ' Thanks for wintering with Quest. Have a great summer, and we\'ll see you on the water!');
    const btn = photos ? '<div style="margin:6px 0 2px">' + buttonHtml_(photos, 'View ' + photoWord, '#14293E') + '</div>' : '';
    return { subject: headline + ' · ' + d.quoteNo, html: noticeHtml_(d, intro, btn, true), status: 'Relaunched — customer notified' };
  }
  if (kind === 'latewarn') {
    const paid = paymentsTotal_(d);
    const bal = Number(d.total || 0) - paid;
    if (bal <= 0.005) return null;
    const intro = 'Just a heads-up on your winter ' + docTerm_(d).toLowerCase() + ': there\'s still an open balance of <b>' + usd_(bal) + '</b>. ' +
      'Per the storage terms on your ' + docTerm_(d).toLowerCase() + ', unpaid balances are subject to a late fee — the next one will be applied on <b>the 15th of this month</b>. ' +
      'Settling up before then avoids it entirely; the payment button below takes about a minute. ' +
      'If a payment is already on the way or you\'d like to talk it through, just call us — we\'re happy to work with you.';
    return { subject: 'Heads-up: open balance on your Quest winter ' + docTerm_(d).toLowerCase() + ' · ' + d.quoteNo,
      html: noticeHtml_(d, intro, '', true), status: 'Late fee warning sent' };
  }
  return null;
}

function adminEmailPreview(token, qn, kind, extra) {
  requireAuth_(token, 'email');
  const ctx = findQuoteCtx_(qn);
  if (!ctx) return { ok: 0, error: 'Quote not found.' };
  const d = ctx.d;
  if (!d.email) return { ok: 0, error: 'No customer email on this quote.' };
  const photos = String(ctx.sh.getRange(ctx.rowNum, COL.PHOTOS).getValue() || '');
  if (kind === 'updated') {
    const paid = paymentsTotal_(d);
    const balance = Number(d.total || 0) - paid;
    const dueToday = Number(d.total || 0) > 0 && Number(d.deposit || 0) >= Number(d.total || 0);
    const html = customerEmailHtml_({ firstName: d.firstName, quoteNo: d.quoteNo, unit: d.unit,
      total: d.total, deposit: d.deposit, dueToday: dueToday, paid: paid, balance: balance,
      paidInFull: paid > 0 && Math.abs(balance) <= 0.005, creditDue: balance < -0.005 ? -balance : 0,
      payBy: (d.season && d.season.payByShort) || '', signUrl: d.adobeUrl || '',
      reminder: false, updateNote: '', isUpdate: true, receipt: null, surveyBase: surveyBase_(d) });
    return { ok: 1, to: d.email, subject: 'Updated: your Quest Watersports winter ' + docTerm_(d).toLowerCase() + ' — ' + d.quoteNo, html: html };
  }
  const built = buildEmailFor_(d, kind, extra, photos);
  if (!built) return { ok: 0, error: kind === 'latewarn' ? 'No unpaid balance — nothing to warn about.' : 'Unknown email type.' };
  return { ok: 1, to: d.email, subject: built.subject, html: built.html };
}

function photoFolder() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const ff = ensurePhotoFolders_(ctx);
  ctx.ui.alert('Photo folder for ' + ctx.quoteNo + ' (Winter & Spring subfolders inside):\n' + ff.url +
    '\n\nTip: staff can also upload straight from their phones via the staff console.');
}

function requirePhotos_(ctx) {
  const url = String(ctx.sh.getRange(ctx.rowNum, COL.PHOTOS).getValue() || '');
  if (!url) ctx.ui.alert('Tip: no photo folder on this quote yet — run "Create / open photo folder" first if you want a photo link included.');
  return url;
}

function sendStoredEmail() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const d = ctx.d;
  if (!d.email) { ctx.ui.alert('No customer email on this quote.'); return; }
  const photos = requirePhotos_(ctx);
  const conf = ctx.ui.alert('Send "We have your ' + d.unit + '" to ' + d.email + '?',
    photos ? 'Includes the condition-photo link.' : 'No photo link will be included.', ctx.ui.ButtonSet.YES_NO);
  if (conf !== ctx.ui.Button.YES) return;
  const intro = 'Good news — your ' + esc_(d.unit) + ' is safely with us for the winter. ' +
    'We photograph every unit as it arrives so you have a record of its condition' +
    (photos ? ' — you can view your photos any time using the button below.' : '.') +
    ' We\'ll see you in the spring, and we\'ll be in touch before relaunch.';
  const buttons = photos ? '<div style="margin:6px 0 2px">' + buttonHtml_(photos, 'View arrival photos', '#14293E') + '</div>' : '';
  sendCustomerNotice_(d, 'We have your ' + d.unit + ' — Quest Watersports', intro, buttons, true);
  ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue('Stored — customer notified');
  recordEmail_(ctx.sh, ctx.rowNum, d, 'stored', 'Sheet menu');
  ctx.ui.alert('Sent to ' + d.email + '.');
}

function sendSpringAlert() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  if (!ctx.d.email) { ctx.ui.alert('No customer email on this quote.'); return; }
  const conf = ctx.ui.alert('Send the "It\'s almost spring" relaunch alert to ' + ctx.d.email + '?', '', ctx.ui.ButtonSet.YES_NO);
  if (conf !== ctx.ui.Button.YES) return;
  springAlertFor_(ctx.d);
  ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue('Spring alert sent');
  recordEmail_(ctx.sh, ctx.rowNum, ctx.d, 'spring', 'Sheet menu');
  ctx.ui.alert('Sent.');
}

function springAlertFor_(d) {
  const base = WEB_APP_URL;
  const mk = function (pref, label, bg) {
    const u = base + '?action=launchpref&quote=' + encodeURIComponent(d.quoteNo) +
      '&ln=' + encodeURIComponent(d.lastName || '') + '&pref=' + pref;
    return buttonHtml_(u, label, bg);
  };
  const land = isLandUnit_(d);
  const backPhrase = land ? 'heads back out' : 'goes back in the water';
  const whenQ = land ? 'When would you like it back?' : 'When would you like to launch?';
  const intro = 'It\'s almost spring — ' + (land ? 'time to plan your ' + esc_(d.unit) + '\'s return!' : 'relaunch season is coming up!') + ' Two quick things:<br><br>' +
    '<b>1. Any last-minute work?</b> If there\'s anything you want done before your ' + esc_(d.unit) +
    ' ' + backPhrase + ' — service, detail, accessories — reply to this email or call us now, while it\'s still easy to get to.<br><br>' +
    '<b>2. ' + whenQ + '</b> Tap one below. We can\'t commit to exact dates — weather and the occasional mechanical surprise on units ahead of you can shift the schedule — but your preference sets where you land in the line, and we\'ll email you when you\'re up next.';
  const buttons = '<div style="margin:6px 0 10px">' +
    mk('early', 'As early as possible', '#14293E') +
    mk('any', 'Any time works', '#4A81A6') +
    mk('late', 'As late as possible', '#C08A22') + '</div>';
  sendCustomerNotice_(d, 'It\'s almost spring — let\'s plan your ' + (isLandUnit_(d) ? esc_(d.unit).toLowerCase() + '\'s return' : 'relaunch') + ' · ' + d.quoteNo, intro, buttons, true);
}

function sendSpringAlertAll() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targets = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getRange(1, 3).getValue() !== 'Quote #') return;
    if (sh.getName() === 'No Storage') return;
    if (isStartedTab_(sh.getName())) return;  // leads are never emailed
    const last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (r, i) {
      const email = r[COL.EMAIL - 1];
      if (!email) return;
      let d2 = null;
      try { d2 = JSON.parse(r[COL.PAYLOAD - 1] || ''); } catch (e) {}
      if (d2) targets.push({ d: d2, sh: sh, row: i + 2 });
    });
  });
  if (!targets.length) { ui.alert('No stored quotes with email addresses found.'); return; }
  const conf = ui.alert('Send the spring relaunch alert to ' + targets.length + ' customer(s)?',
    'One branded email each, with launch-window buttons. This cannot be un-sent.', ui.ButtonSet.YES_NO);
  if (conf !== ui.Button.YES) return;
  let sent = 0;
  targets.forEach(function (t2) {
    try { springAlertFor_(t2.d); t2.sh.getRange(t2.row, COL.STATUS).setValue('Spring alert sent'); recordEmail_(t2.sh, t2.row, t2.d, 'spring', 'Sheet menu'); sent++; }
    catch (e) { console.error('Spring alert failed for ' + t2.d.quoteNo + ': ' + e); }
  });
  ui.alert('Spring alert sent to ' + sent + ' of ' + targets.length + '.');
}

function sendUpNextEmail() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const d = ctx.d;
  if (!d.email) { ctx.ui.alert('No customer email on this quote.'); return; }
  const land = isLandUnit_(d);
  const when = ctx.ui.prompt(land ? 'When is the return delivery?' : 'When is the launch?', 'e.g. "tomorrow", "Thursday", "in the next 2–3 days"', ctx.ui.ButtonSet.OK_CANCEL);
  if (when.getSelectedButton() !== ctx.ui.Button.OK) return;
  const whenTxt = String(when.getResponseText()).trim() || 'in the next few days';
  const verb = land ? 'bring your ' + esc_(d.unit) + ' back' : 'launch your ' + esc_(d.unit);
  const intro = 'You\'re up next! We expect to ' + verb + ' <b>' + esc_(whenTxt) + '</b>. ' +
    'As always, weather or a surprise on a unit ahead of you can shift things slightly — we\'ll let you know if anything changes. ' +
    'If you have any last-minute requests, now is the moment to call.';
  sendCustomerNotice_(d, 'You\'re up next — ' + (land ? 'return delivery ' : 'relaunch ') + whenTxt + ' · ' + d.quoteNo, intro, '', true);
  ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue('Up next — customer notified');
  recordEmail_(ctx.sh, ctx.rowNum, d, 'upnext', 'Sheet menu');
  ctx.ui.alert('Sent to ' + d.email + '.');
}

function sendSplashEmail() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const d = ctx.d;
  if (!d.email) { ctx.ui.alert('No customer email on this quote.'); return; }
  const photos = requirePhotos_(ctx);
  const conf = ctx.ui.alert('Send "You\'re back in the water" to ' + d.email + '?',
    photos ? 'Includes the photo link.' : 'No photo link will be included.', ctx.ui.ButtonSet.YES_NO);
  if (conf !== ctx.ui.Button.YES) return;
  const bike = isBike_(d), land = isLandUnit_(d);
  const headline = bike ? 'Your e-bike is ready to ride!'
                 : land ? 'Your ' + esc_(d.unit).toLowerCase() + ' is back home!'
                 : 'You\'re back in the water!';
  const bodyLead = bike ? 'Your e-bike is tuned up, charged, and back with you'
                 : land ? 'Your ' + esc_(d.unit) + ' is back at Heritage Harbor and ready to go'
                 : 'Your ' + esc_(d.unit) + ' is back in the water';
  const photoWord = land ? 'return photos' : 'relaunch photos';
  const sendoff = land ? ' Thanks for wintering with Quest. Have a great summer!'
                       : ' Thanks for wintering with Quest. Have a great summer, and we\'ll see you on the water!';
  const intro = bodyLead + (photos ? ' — ' + photoWord + ' are at the button below.' : '.') + sendoff;
  const buttons = photos ? '<div style="margin:6px 0 2px">' + buttonHtml_(photos, 'View ' + photoWord, '#14293E') + '</div>' : '';
  sendCustomerNotice_(d, headline + ' · ' + d.quoteNo, intro, buttons, true);
  ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue('Relaunched — customer notified');
  recordEmail_(ctx.sh, ctx.rowNum, d, 'splash', 'Sheet menu');
  ctx.ui.alert('Sent to ' + d.email + '.');
}

/* Menu: record a collected deposit/payment; offers an emailed receipt with
 * remaining-balance or paid-in-full language */
function recordPayment() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const ui = ctx.ui, d = ctx.d;
  const already = paymentsTotal_(d);
  const signedBal = Number(d.total || 0) - already;
  const owedTxt = signedBal < -0.005
    ? 'CREDIT DUE TO CUSTOMER ' + usd_(-signedBal) + ' (enter a negative amount to record the refund)'
    : usd_(Math.max(0, signedBal));
  const amtResp = ui.prompt('Record payment — quote ' + ctx.quoteNo,
    'Amount collected.\nCurrent balance: ' + owedTxt + (already ? ' (already paid: ' + usd_(already) + ')' : ''),
    ui.ButtonSet.OK_CANCEL);
  if (amtResp.getSelectedButton() !== ui.Button.OK) return;
  const amt = Number(String(amtResp.getResponseText()).replace(/[$,\s]/g, ''));
  if (!isFinite(amt) || amt <= 0) { ui.alert('Enter a positive amount, e.g. 500 or 1422.09'); return; }
  const mResp = ui.prompt('Record payment — quote ' + ctx.quoteNo,
    'How was it paid? (e.g. Cash, Check #1042, Debit, Credit card, Zelle, ACH)', ui.ButtonSet.OK_CANCEL);
  if (mResp.getSelectedButton() !== ui.Button.OK) return;
  const method = String(mResp.getResponseText()).trim() || 'Payment';

  d.payments = d.payments || [];
  d.payments.push({ amt: amt, method: method, date: new Date().toLocaleDateString() });
  const paid = paymentsTotal_(d);
  const bal = Number(d.total || 0) - paid;
  d.status = bal < -0.005 ? 'CREDIT DUE ' + usd_(-bal) : bal <= 0.005 ? 'Paid in full' : 'Payment received — balance ' + usd_(bal);
  d.ts = new Date().toISOString();

  const pdfUrl = savePdf_(d);
  const sh = ctx.sh, rowNum = ctx.rowNum;
  sh.getRange(rowNum, COL.STATUS).setValue(d.status);
  sh.getRange(rowNum, COL.PDF).setValue(pdfUrl);
  sh.getRange(rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
  writeMoneyCols_(sh, rowNum, d);

  let sentMsg = 'No receipt sent';
  if (d.email) {
    const conf = ui.alert('Email receipt to ' + d.email + '?',
      usd_(amt) + ' by ' + method + (bal < -0.005 ? ' — CREDIT DUE ' + usd_(-bal) : bal <= 0.005 ? ' — PAID IN FULL' : ' — remaining balance ' + usd_(bal)),
      ui.ButtonSet.YES_NO);
    if (conf === ui.Button.YES) {
      sendCustomerEmail_(d, '', false, { amt: amt, method: method });
      recordEmail_(sh, rowNum, d, 'receipt', 'Sheet menu');
      sentMsg = 'Receipt emailed to ' + d.email;
    }
  } else sentMsg = 'No customer email on file — hand them the updated PDF';
  sendNotification_(d, sh.getName(), true, pdfUrl);
  ui.alert('Payment recorded: ' + usd_(amt) + ' by ' + method +
    '\nPaid to date: ' + usd_(paid) + ' · Balance: ' + (bal < -0.005 ? 'CREDIT DUE ' + usd_(-bal) : bal <= 0.005 ? 'PAID IN FULL' : usd_(bal)) +
    '\n' + sentMsg + '.');
}

/* Menu: warn about an upcoming late fee (typically run from the 1st-of-month report) */
function sendLateFeeWarning() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const d = ctx.d;
  if (!d.email) { ctx.ui.alert('No customer email on this quote.'); return; }
  const paid = paymentsTotal_(d);
  const bal = Number(d.total || 0) - paid;
  if (bal <= 0.005) { ctx.ui.alert('No unpaid balance on ' + ctx.quoteNo + '.'); return; }
  const conf = ctx.ui.alert('Send the late-fee warning to ' + d.email + '?', 'Open balance: ' + usd_(bal), ctx.ui.ButtonSet.YES_NO);
  if (conf !== ctx.ui.Button.YES) return;
  const payBy = (d.season && d.season.payByShort) || 'Nov 15';
  const intro = 'Just a heads-up on your winter ' + docTerm_(d).toLowerCase() + ': there\'s still an open balance of <b>' + usd_(bal) + '</b>. ' +
    'Per the storage terms on your ' + docTerm_(d).toLowerCase() + ', unpaid balances are subject to a late fee — the next one will be applied on <b>the 15th of this month</b>. ' +
    'Settling up before then avoids it entirely; the payment button below takes about a minute. ' +
    'If a payment is already on the way or you\'d like to talk it through, just call us — we\'re happy to work with you.';
  sendCustomerNotice_(d, 'Heads-up: open balance on your Quest winter ' + docTerm_(d).toLowerCase() + ' · ' + d.quoteNo, intro, '', true);
  ctx.sh.getRange(ctx.rowNum, COL.STATUS).setValue('Late fee warning sent');
  recordEmail_(ctx.sh, ctx.rowNum, d, 'latewarn', 'Sheet menu');
  ctx.ui.alert('Sent to ' + d.email + '.');
}

/* Menu: add the late fee to an unpaid balance; suggests the standard % */
function addLateFee() {
  const ctx = getSelectedQuoteRow_();
  if (!ctx) return;
  const ui = ctx.ui, d = ctx.d;
  const paid = paymentsTotal_(d);
  const bal = Math.max(0, Number(d.total || 0) - paid);
  if (bal <= 0) { ui.alert('Quote ' + ctx.quoteNo + ' is paid in full — no balance to apply a late fee to.'); return; }
  const suggested = Math.round(bal * ADJ_LATE_PCT) / 100;
  const amtResp = ui.prompt('Add late fee — quote ' + ctx.quoteNo,
    'Late fee amount.\nSuggested: ' + usd_(suggested) + ' (' + ADJ_LATE_PCT + '% of the ' + usd_(bal) + ' unpaid balance).',
    ui.ButtonSet.OK_CANCEL);
  if (amtResp.getSelectedButton() !== ui.Button.OK) return;
  const amt = Number(String(amtResp.getResponseText()).replace(/[$,\s]/g, ''));
  if (!isFinite(amt) || amt <= 0) { ui.alert('Enter a positive amount, e.g. ' + suggested); return; }
  const payBy = (d.season && d.season.payByShort) || 'the due date';
  const defLabel = 'Late payment fee — balance unpaid after ' + payBy;
  const lblResp = ui.prompt('Fee wording — quote ' + ctx.quoteNo,
    'How should this fee read on the invoice?\nLeave blank for: "' + defLabel + '"\nExamples: "December service charge (2%)", "January service charge (2%)"',
    ui.ButtonSet.OK_CANCEL);
  if (lblResp.getSelectedButton() !== ui.Button.OK) return;

  d.lines = d.lines || [];
  const feeLabel = String(lblResp.getResponseText()).trim() || defLabel;
  d.lines.push({ sec: 'Adjustments', label: feeLabel, calc: '', amt: amt, desc: '' });
  ensureManual_(d).adjustments.push({ label: feeLabel, amt: amt });
  recomputeTotals_(d);
  d.status = 'Late fee added — balance ' + usd_(Math.max(0, Number(d.total) - paid));
  d.ts = new Date().toISOString();

  const pdfUrl = savePdf_(d);
  const sh = ctx.sh, rowNum = ctx.rowNum;
  sh.getRange(rowNum, COL.STATUS).setValue(d.status);
  sh.getRange(rowNum, COL.TOTAL).setValue(Number(d.total));
  sh.getRange(rowNum, COL.ITEMS).setValue(d.items).setWrap(true);
  sh.getRange(rowNum, COL.PDF).setValue(pdfUrl);
  sh.getRange(rowNum, COL.PAYLOAD).setValue(JSON.stringify(d));
  writeMoneyCols_(sh, rowNum, d);

  let sentMsg = 'No email sent';
  if (d.email) {
    const conf = ui.alert('Email updated quote with the late fee to ' + d.email + '?', '', ui.ButtonSet.YES_NO);
    if (conf === ui.Button.YES) {
      sendCustomerEmail_(d, 'Late payment fee applied — balance was unpaid after ' + payBy, true);
      recordEmail_(sh, rowNum, d, 'late fee applied', 'Sheet menu');
      sentMsg = 'Updated quote emailed to ' + d.email;
    }
  }
  sendNotification_(d, sh.getName(), true, pdfUrl);
  ui.alert('Late fee added: ' + usd_(amt) + '\nNew total: ' + usd_(d.total) +
    ' · Balance: ' + usd_(Math.max(0, Number(d.total) - paid)) + '\n' + sentMsg + '.');
}

/* ================= CUSTOMER-FACING EMAIL ================= */
function getPdfBlob_(quoteNo) {
  try {
    const it = getFolder_().searchFiles('title contains "' + quoteNo + '"');
    return it.hasNext() ? it.next().getBlob() : null;
  } catch (e) { return null; }
}

let _logoBlob = null;
function getLogoBlob_() {
  if (!LOGO_URL) return null;
  if (_logoBlob) return _logoBlob;
  try { _logoBlob = UrlFetchApp.fetch(LOGO_URL).getBlob().setName('questlogo'); return _logoBlob; }
  catch (e) { return null; }
}

/* Run from the editor (function dropdown -> testLogo -> Run). Reports the
 * raw result of the logo fetch with no error handling in the way. */
function testLogo() {
  console.log('Fetching: ' + LOGO_URL);
  const resp = UrlFetchApp.fetch(LOGO_URL, { muteHttpExceptions: true, followRedirects: true });
  const code = resp.getResponseCode();
  console.log('HTTP status: ' + code);
  console.log('Content-Type: ' + resp.getHeaders()['Content-Type']);
  console.log('Bytes: ' + resp.getContent().length);
  if (code !== 200) {
    console.log('Body (first 300 chars): ' + resp.getContentText().substring(0, 300));
    throw new Error('Fetch returned HTTP ' + code + ' - see body above.');
  }
  console.log('Logo fetch OK.');
}

function logoDataUri_() {
  const b = getLogoBlob_();
  if (!b) return '';
  try { return 'data:image/png;base64,' + Utilities.base64Encode(b.getBytes()); }
  catch (e) { return ''; }
}

function moneyRow_(label, amt, bold) {
  return '<tr><td style="padding:4px 0;color:#5C7185;font-size:14px">' + label +
    '</td><td align="right" style="padding:4px 0;font-size:' + (bold ? '18px;font-weight:bold;color:#14293E' : '14px;color:#1D2B38') + '">' + amt + '</td></tr>';
}

function buttonHtml_(url, label, bg) {
  return '<a href="' + url + '" style="display:inline-block;background:' + bg +
    ';color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;' +
    'padding:12px 22px;border-radius:8px;margin:4px 6px 4px 0">' + label + '</a>';
}

function customerEmailHtml_(o) {
  // o: {firstName, quoteNo, unit, total, deposit, dueToday, payBy, signUrl, hasPdf, reminder}
  // width/height ATTRIBUTES are required: Outlook's renderer ignores CSS
  // max-height and displays the full-size image without them
  const logo = LOGO_URL
    ? '<img src="cid:questlogo" alt="Quest Watersports" width="104" height="56" style="width:104px;height:56px;display:block;border:0">'
    : '<div style="font-family:Arial Black,Arial;font-size:24px;color:#14293E;letter-spacing:1px">QUEST WATERSPORTS</div>';
  const intro = o.receipt
    ? 'We\'ve received your payment of <b>' + usd_(o.receipt.amt) + '</b>' + (o.receipt.method ? ' by ' + esc_(o.receipt.method) : '') + ' — thank you!' + (o.paidInFull ? ' Your winter services are <b>paid in full</b>. Your updated quote is attached for your records.' : ' Your updated balance is below, and your quote reflecting this payment is attached.')
    : o.isUpdate
    ? 'We\'ve updated your winter services quote' + (o.updateNote ? ': <b>' + esc_(o.updateNote) + '</b>' : '') + '. Your revised quote is attached with the new totals below — the links to sign and pay are the same.'
    : o.reminder
    ? 'Just a friendly reminder — your winter services quote is still waiting for you. Everything below is ready whenever you are.'
    : 'Thanks for getting your winter services quote from Quest Watersports! Your full itemized quote is attached as a PDF. When you\'re ready, you can sign your agreement and pay online — no extra trip needed.';
  let money = '';
  if (o.dueToday) {
    money = moneyRow_('Total due today — Cash, Check, Debit, Zelle or ACH', usd_(o.total), true);
  } else {
    money = moneyRow_('Quote total (Cash, Check, Debit, Zelle or ACH' + (o.payBy ? ' by ' + o.payBy : '') + ')', usd_(o.total), true) +
            (o.paid > 0 ? '' : moneyRow_('Deposit to lock in your spot', usd_(o.deposit), false));
  }
  if (o.paid > 0) {
    money += moneyRow_('Payments received', '−' + usd_(o.paid), false);
    money += o.creditDue
      ? '<tr><td style="padding:6px 0;font-size:15px;font-weight:bold;color:#1E6B3A">CREDIT DUE TO YOU — we\'ll settle up</td><td align="right" style="padding:6px 0;font-size:18px;font-weight:bold;color:#1E6B3A">' + usd_(o.creditDue) + '</td></tr>'
      : o.paidInFull
      ? '<tr><td style="padding:6px 0;font-size:15px;font-weight:bold;color:#1E6B3A">PAID IN FULL — thank you!</td><td align="right" style="padding:6px 0;font-size:18px;font-weight:bold;color:#1E6B3A">$0.00</td></tr>'
      : moneyRow_('Balance due', usd_(o.balance), true);
  }
  let buttons = '';
  if (o.signUrl) buttons += buttonHtml_(o.signUrl, 'Review &amp; sign your agreement', '#14293E');
  if (!o.paidInFull && !o.creditDue) buttons += buttonHtml_(PAYMENT_URL, (o.dueToday || o.paid > 0) ? 'Pay online' : 'Pay your deposit online', '#C08A22');
  /* Season-done survey. Only for customers who have actually committed --
     a deposit or payment in full. Asking someone to book their haul-out
     before they have put money down is asking them to schedule work they
     have not agreed to buy, and it puts a date in our yard plan that nothing
     backs up. A refund that takes them back to zero drops the question again.
     Never on a receipt. */
  let survey = '';
  if (!o.receipt && o.quoteNo && o.surveyBase && Number(o.paid || 0) > 0) {
    const su = function (choice) { return o.surveyBase + '&done=' + choice; };
    survey =
      '<div style="background:#FDFCF7;border:1px solid #C7D5E0;border-radius:8px;padding:16px 18px;margin:4px 0 8px">' +
      '<div style="font-size:15px;font-weight:bold;color:#14293E;margin-bottom:4px">One quick question: when will you be done for the season?</div>' +
      '<div style="font-size:13px;color:#5C7185;margin-bottom:12px">' + surveyBlurb_(o) + '</div>' +
      '<div>' + buttonHtml_(su('now'), 'I\'m done now', '#14293E') +
      buttonHtml_(o.surveyBase + '&done=date', 'I\'ll be done on a set date', '#4A81A6') +
      buttonHtml_(su('call'), 'I\'ll call when I\'m done', '#C08A22') + '</div></div>';
  }
  buttons += survey ? '' : '';
  const steps = o.paidInFull
    ? '<b>You\'re all set.</b> Keep this email for your records — see you in the spring!'
    : o.signUrl
    ? '<b>1.</b> Review the attached quote &nbsp;·&nbsp; <b>2.</b> Sign the agreement &nbsp;·&nbsp; <b>3.</b> Pay online with quote # ' + o.quoteNo + ' in the memo'
    : '<b>1.</b> Review the attached quote &nbsp;·&nbsp; <b>2.</b> Pay online with quote # ' + o.quoteNo + ' in the memo &nbsp;·&nbsp; We\'ll have your agreement ready to sign';
  return '' +
  '<div style="background:#EBF1F6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #C7D5E0">' +
      '<div style="padding:22px 28px;border-bottom:4px solid #C08A22">' + logo + '</div>' +
      '<div style="padding:26px 28px">' +
        '<p style="font-size:16px;color:#1D2B38;margin:0 0 6px">Hi ' + esc_(o.firstName || 'there') + ',</p>' +
        '<p style="font-size:15px;color:#1D2B38;line-height:1.5;margin:0 0 18px">' + intro + '</p>' +
        '<div style="background:#FDFCF7;border:1px solid #C7D5E0;border-radius:8px;padding:16px 18px;margin-bottom:18px">' +
          '<div style="font-family:Courier New,monospace;font-size:13px;color:#5C7185;margin-bottom:8px">QUOTE# ' + esc_(o.quoteNo) + ' &nbsp;·&nbsp; ' + esc_(o.unit) + '</div>' +
          '<table width="100%" cellpadding="0" cellspacing="0">' + money + '</table>' +
        '</div>' +
        '<div style="margin-bottom:16px">' + buttons + survey + '</div>' +
        '<p style="font-size:13px;color:#5C7185;line-height:1.5;margin:0 0 6px">' + steps + '</p>' +
        '<p style="font-size:13px;color:#5C7185;line-height:1.5;margin:0">Questions or changes? Call us at (815) 433-2200 — have your quote number handy and we can adjust anything.</p>' +
      '</div>' +
      '<div style="background:#14293E;color:#B9CDDD;padding:14px 28px;font-size:12px">Quest Watersports · 1851 Old Chicago Road, Ottawa, IL · (815) 433-2200</div>' +
    '</div>' +
  '</div>';
}

function surveyBase_(d) {
  return WEB_APP_URL + '?action=seasondone&quote=' + encodeURIComponent(d.quoteNo || '') +
    '&ln=' + encodeURIComponent(d.lastName || '');
}

function sendCustomerEmail_(d, updateNote, isUpdate, receipt) {
  try {
    const dueToday = Number(d.total || 0) > 0 && Number(d.deposit || 0) >= Number(d.total || 0);
    const paid = paymentsTotal_(d);
    const balance = Number(d.total || 0) - paid;
    const html = customerEmailHtml_({
      firstName: d.firstName, quoteNo: d.quoteNo, unit: d.unit,
      total: d.total, deposit: d.deposit, dueToday: dueToday,
      paid: paid, balance: balance, paidInFull: paid > 0 && Math.abs(balance) <= 0.005,
      creditDue: balance < -0.005 ? -balance : 0,
      payBy: (d.season && d.season.payByShort) || '', signUrl: d.adobeUrl || '',
      reminder: false, updateNote: updateNote || '', isUpdate: !!(isUpdate || updateNote),
      receipt: receipt || null, surveyBase: receipt ? '' : surveyBase_(d)
    });
    const pdf = getPdfBlob_(d.quoteNo);
    const opts = { htmlBody: html, name: 'Quest Watersports', replyTo: REPLY_TO };
    if (pdf) opts.attachments = [pdf];
    const logo = getLogoBlob_();
    if (logo) opts.inlineImages = { questlogo: logo };
    if (FROM_ALIAS) opts.from = FROM_ALIAS;
    const term = docTerm_(d).toLowerCase();
    const subject = (receipt
      ? (paid > 0 && balance <= 0 ? 'Receipt — paid in full: Quest Watersports winter ' + term + ' ' : 'Receipt — payment received: Quest Watersports winter ' + term + ' ')
      : (isUpdate || updateNote) ? 'Updated: your Quest Watersports winter ' + term + ' — ' : 'Your Quest Watersports winter ' + term + ' — ') + (d.quoteNo || '');
    GmailApp.sendEmail(d.email, subject, 'Your winter quote is attached. Quote# ' + (d.quoteNo || ''), opts);
  } catch (err) { console.error('Customer email failed: ' + err); }
}

/* ================= AUTO REMINDER =================
 * Run setupReminderTrigger() ONCE from the editor (select it in the function
 * dropdown, click Run) to create a daily 9am check. */
/* ONE-TIME: reorder existing tabs from the old layout (Timestamp first) to the
 * new layout (Last, First, Quote #, Balance first). Safe to run twice. */
function migrateColumnOrder() {
  const OLDIDX = { TS:0,STATUS:1,QN:2,UNIT:3,LAST:4,FIRST:5,PHONE:6,EMAIL:7,YMM:8,DIMS:9,
    TOTAL:10,DEP:11,PAY:12,ITEMS:13,RQ:14,NOTES:15,PDF:16,SIGN:17,REM:18,PAYLOAD:19,PAID:20,BAL:21 };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let migrated = 0;
  ss.getSheets().forEach(function (sh) {
    if (sh.getRange(1, 1).getValue() !== 'Timestamp') return; // not old layout
    const last = sh.getLastRow();
    const data = last > 1 ? sh.getRange(2, 1, last - 1, 22).getValues() : [];
    const out = data.map(function (r) {
      return [ r[OLDIDX.LAST], r[OLDIDX.FIRST], r[OLDIDX.QN], r[OLDIDX.BAL] || 0,
        r[OLDIDX.TS], r[OLDIDX.STATUS], r[OLDIDX.UNIT], r[OLDIDX.PHONE], r[OLDIDX.EMAIL],
        r[OLDIDX.YMM], r[OLDIDX.DIMS], r[OLDIDX.TOTAL], r[OLDIDX.DEP], r[OLDIDX.PAY],
        r[OLDIDX.ITEMS], r[OLDIDX.RQ], r[OLDIDX.NOTES], r[OLDIDX.PDF], r[OLDIDX.SIGN],
        r[OLDIDX.REM], r[OLDIDX.PAYLOAD], r[OLDIDX.PAID] || 0, '' ];
    });
    sh.clearContents();
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    if (out.length) {
      sh.getRange(2, 1, out.length, HEADERS.length).setValues(out);
      sh.getRange(2, COL.BAL, out.length, 1).setNumberFormat('$#,##0.00');
      sh.getRange(2, COL.TOTAL, out.length, 2).setNumberFormat('$#,##0.00');
      sh.getRange(2, COL.PAID, out.length, 1).setNumberFormat('$#,##0.00');
      sh.getRange(2, COL.ITEMS, out.length, 1).setWrap(true);
    }
    sh.setFrozenRows(1);
    migrated++;
  });
  console.log('Migrated ' + migrated + ' tab(s) to the new column order.');
}

function setupBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(18).create();
}

function dailyBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  const blob = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  }).getBlob().setName(ss.getName() + ' — backup ' + new Date().toLocaleDateString().replace(/\//g, '-') + '.xlsx');
  const opts = { attachments: [blob], name: 'Quest Winter Quotes' };
  if (FROM_ALIAS) opts.from = FROM_ALIAS;
  GmailApp.sendEmail(BACKUP_EMAIL, 'Daily backup — ' + ss.getName() + ' — ' + new Date().toLocaleDateString(),
    'Attached: full spreadsheet backup including all tabs, statuses, payments, and stored quote data. Keep a few of these around — any one of them can rebuild the season.', opts);
}

function balanceReportCheck() {
  const now = new Date();
  const day = now.getDate(), month = now.getMonth() + 1;
  if (REPORT_MONTHS.indexOf(month) === -1) return;
  if (day !== 1 && day !== 15) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getRange(1, 3).getValue() !== 'Quote #') return;
    const last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (r) {
      const bal = Number(r[COL.BAL - 1] || 0);
      const paid = Number(r[COL.PAID - 1] || 0);
      const total = Number(r[COL.TOTAL - 1] || 0);
      if (total <= 0 || bal <= 0) return;
      rows.push({ last: r[COL.LAST-1], first: r[COL.FIRST-1], qn: r[COL.QN-1], unit: r[COL.UNIT-1],
                  phone: r[COL.PHONE-1], email: r[COL.EMAIL-1], total: total, paid: paid, bal: bal,
                  status: r[COL.STATUS-1] });
    });
  });
  if (!rows.length) return;
  rows.sort(function (a, b) { return b.bal - a.bal; });
  const isFeeDay = day === 15;
  const lines = rows.map(function (x) {
    return x.last + ', ' + x.first + ' · ' + x.qn + ' · ' + x.unit +
      ' · Balance ' + usd_(x.bal) + ' (paid ' + usd_(x.paid) + ' of ' + usd_(x.total) + ')' +
      ' · ' + (x.phone || 'no phone') + ' · ' + (x.email || 'no email') + ' · ' + x.status;
  });
  const totalOut = rows.reduce(function (a, x) { return a + x.bal; }, 0);
  const subject = (isFeeDay ? '💰 LATE FEE DAY — ' : '⏰ Heads up — ') + rows.length +
    ' unpaid balance' + (rows.length > 1 ? 's' : '') + ' · ' + usd_(totalOut) + ' outstanding';
  const body = (isFeeDay
    ? 'It\'s the 15th — these balances are due for their fee. Use "Add late fee…" in the Quest Quotes menu for each (2%/month, min $5, per your terms).'
    : 'It\'s the 1st — these balances will hit fee day on the 15th. A call or a reminder email now may save the awkward conversation later.') +
    '\n\n' + lines.join('\n') + '\n\nTotal outstanding: ' + usd_(totalOut) +
    '\n\nSpreadsheet: ' + ss.getUrl();
  const opts = { name: 'Quest Winter Quotes' };
  if (FROM_ALIAS) opts.from = FROM_ALIAS;
  GmailApp.sendEmail(REPORT_EMAIL, subject, body, opts);
}

/* ONE-TIME SETUP: creates/refreshes all three schedules — daily reminder check
 * (9am), daily backup (6pm), and the 1st/15th balance report (7am check). */
/* All times are in the SCRIPT'S timezone, which is America/Chicago — verified
   against the sheet, whose local Timestamp column runs UTC-5 in August (CDT).
   DST is handled by Apps Script, so these stay correct year round.

   Apps Script time triggers are approximate: "12:15" means Google will fire it
   somewhere inside roughly a quarter-hour window around then, not on the dot.
   That is fine for a lunchtime nudge and cannot be tightened from here. */
function setupAllTriggers() {
  const wanted = {
    dailyReminderCheck: { hour: 9 },
    dailyBackup:        { hour: 18 },
    balanceReportCheck: { hour: 7 },
    // Lunch break: people have a moment to actually deal with it.
    leadFollowUpCheck:  { hour: 12, minute: 15 }
  };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (wanted[t.getHandlerFunction()] !== undefined) ScriptApp.deleteTrigger(t);
  });
  Object.keys(wanted).forEach(function (fn) {
    const w = wanted[fn];
    let b = ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(w.hour);
    if (w.minute !== undefined) b = b.nearMinute(w.minute);
    b.create();
  });
}

function setupReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyReminderCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyReminderCheck').timeBased().everyDays(1).atHour(9).create();
}

function dailyReminderCheck() {
  if (!REMINDER_ENABLED) return;
  const cutoff = Date.now() - REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function (sh) {
    if (sh.getRange(1, 3).getValue() !== 'Quote #') return; // not a quote tab
    if (isStartedTab_(sh.getName())) return;  // leads are never emailed — see STARTED_TAB
    const last = sh.getLastRow();
    if (last < 2) return;
    const data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    data.forEach(function (r, i) {
      const ts = r[COL.TS-1], status = String(r[COL.STATUS-1] || ''), quoteNo = r[COL.QN-1], unit = r[COL.UNIT-1],
            first = r[COL.FIRST-1], email = r[COL.EMAIL-1], total = r[COL.TOTAL-1], deposit = r[COL.DEP-1],
            signUrl = r[COL.SIGN-1], reminder = r[COL.REM-1];
      let payByShort = '';
      try { const pd = JSON.parse(r[COL.PAYLOAD-1] || '{}'); payByShort = (pd.season && pd.season.payByShort) || ''; } catch (e) {}
      if (reminder) return;                                   // already reminded
      if (!email) return;                                     // nowhere to send
      if (status.indexOf('Signed & paying') === 0) return;    // already moving forward
      if (status.indexOf('Adjusted after signing') === 0) return; // signed, then tweaked
      if (Number(r[COL.PAID-1] || 0) > 0) return;              // has paid something — no nagging
      if (!(ts instanceof Date) || ts.getTime() > cutoff) return; // too recent
      try {
        const dueToday = Number(total) > 0 && Number(deposit) >= Number(total);
        const html = customerEmailHtml_({
          firstName: first, quoteNo: quoteNo, unit: unit,
          total: total, deposit: deposit, dueToday: dueToday,
          payBy: payByShort, signUrl: signUrl || '', reminder: true
        });
        const pdf = getPdfBlob_(quoteNo);
        const opts = { htmlBody: html, name: 'Quest Watersports', replyTo: REPLY_TO };
        if (pdf) opts.attachments = [pdf];
        const logo = getLogoBlob_();
        if (logo) opts.inlineImages = { questlogo: logo };
        if (FROM_ALIAS) opts.from = FROM_ALIAS;
        GmailApp.sendEmail(email, 'Your Quest Watersports winter quote is waiting — ' + quoteNo,
          'Your winter quote ' + quoteNo + ' is still available. Call (815) 433-2200 with questions.', opts);
        sh.getRange(i + 2, COL.REM).setValue('Reminder sent ' + new Date().toLocaleDateString());
        try { const dl = JSON.parse(sh.getRange(i + 2, COL.PAYLOAD).getValue() || '{}');
          if (dl.quoteNo) { dl.email = email; recordEmail_(sh, i + 2, dl, 'auto-reminder', 'System'); } } catch (e4) {}
      } catch (err) { console.error('Reminder failed for ' + quoteNo + ': ' + err); }
    });
  });
}

/* ---------------------------------------------------------------------------
   LEAD FOLLOW-UP — the "finish my quote" nudge.
   The SECOND automatic customer-facing email in this system (see CLAUDE.md
   section 5). It goes only to lead rows: someone who passed the contact gate
   and then walked away without saving, printing, emailing or paying. Once a
   quote does any of those, its row leaves the lead tab, so scanning that tab
   alone is what makes "walked away" true by construction.

   Sends once per lead, marked in the reminder column with a distinct prefix so
   it can be told apart from the real 10-day reminder and dropped when the row
   graduates (see doPost). The link carries quote number + last name so the
   page can restore the quote without the customer typing anything.
--------------------------------------------------------------------------- */
const LEAD_FOLLOWUP_ENABLED = true;
const LEAD_FOLLOWUP_AFTER_HOURS = 24;
const LEAD_FOLLOWUP_MARK = 'Lead follow-up sent ';
function isLeadFollowUpMark_(v) { return String(v || '').indexOf(LEAD_FOLLOWUP_MARK) === 0; }

function leadFollowUpCheck() {
  if (!LEAD_FOLLOWUP_ENABLED) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(STARTED_TAB);
  if (!sh) return;
  const last = sh.getLastRow();
  if (last < 2) return;
  const cutoff = Date.now() - LEAD_FOLLOWUP_AFTER_HOURS * 60 * 60 * 1000;
  const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  rows.forEach(function (r, i) {
    const rowNum = i + 2;
    const email = String(r[COL.EMAIL - 1] || '').trim();
    const ts = r[COL.TS - 1];
    if (!email) return;
    if (String(r[COL.REM - 1] || '')) return;                    // already nudged
    if (!(ts instanceof Date) || ts.getTime() > cutoff) return;   // not 24h yet
    const quoteNo = String(r[COL.QN - 1] || '');
    const lastName = String(r[COL.LAST - 1] || '');
    if (!quoteNo) return;
    try {
      let d = {};
      try { d = JSON.parse(r[COL.PAYLOAD - 1] || '{}'); } catch (e2) {}
      d.quoteNo = quoteNo; d.email = email;
      d.firstName = d.firstName || String(r[COL.FIRST - 1] || '');
      d.lastName = d.lastName || lastName;
      const built = buildEmailFor_(d, 'finishquote', '', null);
      const opts = { htmlBody: built.html, name: 'Quest Watersports', replyTo: REPLY_TO };
      const logo = getLogoBlob_();
      if (logo) opts.inlineImages = { questlogo: logo };
      if (FROM_ALIAS) opts.from = FROM_ALIAS;
      GmailApp.sendEmail(email, built.subject,
        'Pick your Quest Watersports winter quote back up: ' + quoteNo + '. Call (815) 433-2200 with questions.', opts);
      sh.getRange(rowNum, COL.REM).setValue(LEAD_FOLLOWUP_MARK + new Date().toLocaleDateString());
      recordEmail_(sh, rowNum, d, 'finish-quote', 'System');
    } catch (err) { console.error('Lead follow-up failed for ' + quoteNo + ': ' + err); }
  });
}

function docTerm_(d) { return (d.payments && d.payments.length) ? 'Invoice' : 'Quote'; }
function isLandUnit_(d) {
  const u = String(d.unit || '').toLowerCase();
  return u.indexOf('golf') > -1 || u.indexOf('bike') > -1;
}
function isBike_(d) { return String(d.unit || '').toLowerCase().indexOf('bike') > -1; }

/* Sub-heading under the season-done survey.
   Two things it has to get right:
   - WHAT TRIGGERS THE FEE. The surcharge is not a blanket "anything after
     Nov 15" charge. It applies when the customer asks us to retrieve the unit
     after the cutoff, or leaves setting up winter services until after it.
     Someone already in our queue before the date does not get charged because
     our schedule ran long.
   - UNIT WORDING (CLAUDE.md section 5). Golf carts and e-bikes are land units:
     they get picked up, never hauled out.
   The date comes from the quote's own season block, so it moves with the
   season instead of being frozen in a string. */
function surveyBlurb_(o) {
  const land = isLandUnit_(o);
  const sched = land ? 'schedule your pickup' : 'schedule your haul-out';
  const by = String(o.payBy || '').trim();
  const when = by ? 'after ' + esc_(by) : 'after the cutoff date';
  const noun = land ? 'Pickups' : 'Haul-outs';
  return 'This helps us ' + sched + '. ' + noun + ' scheduled ' + when +
    ' are subject to a late retrieval surcharge.';
}

function quoteHtml_(d) {
  const sn = d.season || {};
  const term = docTerm_(d);
  const dueToday = Number(d.total || 0) > 0 && Number(d.deposit || 0) >= Number(d.total || 0);
  const lines = Array.isArray(d.lines) ? d.lines : [];
  let body = '', lastSec = '';
  lines.forEach(function (li) {
    if (li.sec !== lastSec) {
      body += '<tr><td colspan="2" class="sec">' + esc_(li.sec) + '</td></tr>';
      lastSec = li.sec;
    }
    body += '<tr><td>' + esc_(li.label) +
      (li.calc ? '<br><span class="calc">' + esc_(li.calc) + '</span>' : '') +
      (li.desc ? '<br><span class="calc" style="font-style:italic">' + esc_(li.desc) + '</span>' : '') +
      '</td><td class="amt">' + (li.amt ? usd_(li.amt) : 'incl.') + '</td></tr>';
  });
  const rq = d.quotesRequested
    ? '<tr><td colspan="2" class="sec">Quotes requested (pricing to follow)</td></tr>' +
      '<tr><td colspan="2">' + esc_(d.quotesRequested) + '</td></tr>'
    : '';
  const notes = d.notes
    ? '<p class="notes"><b>Customer notes:</b> ' + esc_(d.notes) + '</p>' : '';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#1D2B38;margin:28px}' +
    'h1{font-size:20px;margin:0;color:#14293E;text-transform:uppercase;letter-spacing:1px}' +
    '.sub{color:#5C7185;font-size:10px;margin:2px 0 0}' +
    '.meta{margin:14px 0;padding:10px 12px;background:#EBF1F6;border:1px solid #C7D5E0}' +
    '.meta td{padding:2px 14px 2px 0;font-size:11px;vertical-align:top}' +
    'table.items{width:100%;border-collapse:collapse;margin-top:8px}' +
    'table.items td{border-bottom:1px solid #E2E8EE;padding:5px 4px;font-size:11px}' +
    'td.sec{background:#14293E;color:#fff;text-transform:uppercase;font-size:9.5px;letter-spacing:1px;padding:4px 6px}' +
    'td.amt{text-align:right;white-space:nowrap;width:90px;font-weight:bold}' +
    '.calc{color:#8A8672;font-size:9px}' +
    'table.tot{margin-top:12px;width:100%;border-collapse:collapse}' +
    'table.tot td{padding:4px 6px;font-size:11.5px}' +
    'tr.dep td{background:#F4E8CF;border:1px solid #C08A22;font-weight:bold}' +
    'tr.grand td{border-top:2px solid #14293E;font-weight:bold;font-size:13px}' +
    'td.r{text-align:right;white-space:nowrap}' +
    '.terms{margin-top:16px;font-size:8.5px;color:#5C7185;line-height:1.5}' +
    '.notes{margin-top:10px;font-size:10.5px}' +
    '.status{display:inline-block;margin-top:6px;padding:2px 8px;background:#D8E6EF;color:#14293E;font-size:9.5px;font-weight:bold;text-transform:uppercase;letter-spacing:1px}' +
    '</style></head><body>' +
    (function(){ const u = logoDataUri_();
      return u ? '<img src="' + u + '" style="height:52px;width:auto;display:block;margin-bottom:4px" alt="Quest Watersports">'
               : '<h1>Quest Watersports</h1>'; })() +
    '<p class="sub">Winter Services ' + term + ' · ' + esc_(sn.label || '') +
      ' · 1851 Old Chicago Rd, Ottawa, IL · (815) 433-2200</p>' +
    '<table class="meta"><tr>' +
      '<td><b>' + term + ' #</b><br>' + esc_(d.quoteNo) + '</td>' +
      '<td><b>Date</b><br>' + new Date(d.ts || Date.now()).toLocaleDateString('en-US') + '</td>' +
      '<td><b>Owner</b><br>' + esc_(d.owner) + '<br>' + esc_(d.phone) + '<br>' + esc_(d.email) + '</td>' +
      '<td><b>Unit</b><br>' + esc_(d.unit) + (d.ymm ? '<br>' + esc_(d.ymm) : '') +
        (d.dims ? '<br>' + esc_(d.dims) : '') +
        (d.keyLoc ? '<br>Keys: ' + esc_(d.keyLoc) : '') + '</td>' +
    '</tr></table>' +
    '<table class="items">' + body + rq + '</table>' +
    '<table class="tot">' +
      (function () {
        const pays = d.payments || [];
        const paid = pays.reduce(function (a, p) { return a + Number(p.amt || 0); }, 0);
        const bal = Number(d.total || 0) - paid;
        // No payments yet: classic quote layout
        if (!pays.length) {
          return dueToday
            ? '<tr class="grand"><td>Total due today — Cash, Check, Debit, Zelle or ACH</td><td class="r">' + usd_(d.total) + '</td></tr>' +
              '<tr><td>Paying by credit card (+3% fee)</td><td class="r">' + usd_(d.totalCC) + '</td></tr>'
            : '<tr class="dep"><td>Deposit due today to lock in</td><td class="r">' + usd_(d.deposit) + '</td></tr>' +
              '<tr class="grand"><td>Total — Cash, Check, Debit, Zelle or ACH by ' + esc_(sn.payByShort || '') + '</td><td class="r">' + usd_(d.total) + '</td></tr>' +
              '<tr><td>Paying by credit card (+3% fee)</td><td class="r">' + usd_(d.totalCC) + '</td></tr>' +
              '<tr><td>If paid after ' + esc_(sn.payByShort || '') + ' (+10%) — cash / card</td><td class="r">' + usd_(d.totalLate) + ' / ' + usd_(d.totalLateCC) + '</td></tr>';
        }
        // Payments exist: account summary — total, ledger, balance
        let t = '<tr class="grand"><td>Quote total</td><td class="r">' + usd_(d.total) + '</td></tr>';
        pays.forEach(function (p) {
          t += '<tr><td>Payment received — ' + esc_(p.method || 'Payment') + (p.date ? ' · ' + esc_(p.date) : '') + '</td><td class="r">−' + usd_(p.amt) + '</td></tr>';
        });
        if (bal < -0.005) {
          t += '<tr class="grand"><td style="color:#1E6B3A">CREDIT DUE TO YOU — we\'ll settle up</td><td class="r" style="color:#1E6B3A">' + usd_(-bal) + '</td></tr>';
        } else if (bal <= 0.005) {
          t += '<tr class="grand"><td style="color:#1E6B3A">PAID IN FULL — thank you</td><td class="r" style="color:#1E6B3A">$0.00</td></tr>';
        } else {
          t += '<tr class="grand"><td>Balance due — Cash, Check, Debit, Zelle or ACH' + (dueToday ? '' : ' by ' + esc_(sn.payByShort || '')) + '</td><td class="r">' + usd_(bal) + '</td></tr>';
          t += '<tr><td>Balance by credit card (+3% fee)</td><td class="r">' + usd_(bal * (1 + ADJ_CC_PCT / 100)) + '</td></tr>';
          if (!dueToday) {
            t += '<tr><td>If unpaid after ' + esc_(sn.payByShort || '') + ' (+' + ADJ_LATE_PCT + '%) — cash / card</td><td class="r">' + usd_(bal * (1 + ADJ_LATE_PCT / 100)) + ' / ' + usd_(bal * (1 + ADJ_LATE_PCT / 100) * (1 + ADJ_CC_PCT / 100)) + '</td></tr>';
          }
        }
        return t;
      })() +
    '</table>' +
    notes +
    (function () {
      const pays = d.payments || [];
      const paid = pays.reduce(function (a, p) { return a + Number(p.amt || 0); }, 0);
      const paidInFull = paid > 0 && Number(d.total || 0) - paid <= 0.005;
      if (paidInFull) {
        return '<p class="terms">Totals include sales tax and related supply costs, per invoice(s). All quoted charges are calculated from Owner-provided information and are subject to Quest\'s review; Quest reserves the right to remeasure the unit and to make corrective charges or credits in the event of any measurement discrepancy, calculation error, or misapplied rate. This quote is paid in full — thank you. Units not removed at end of storage term or within 10 days of service completion are subject to $25/day short-term storage. Storage runs ' + esc_(sn.storageStart || '') + ' – ' + esc_(sn.storageEnd || '') + ' and is subject to Quest\'s Storage Terms.</p>';
      }
      return dueToday
        ? '<p class="terms">Totals include sales tax and related supply costs, per invoice(s). All quoted charges are calculated from Owner-provided information and are subject to Quest\'s review; Quest reserves the right to remeasure the unit and to make corrective charges or credits in the event of any measurement discrepancy, calculation error, or misapplied rate. Payment is due today; no surcharge for cash, check, debit card, Zelle, or ACH, and credit card payments are subject to a 3% fee. Units not removed at end of storage term or within 10 days of service completion are subject to $25/day short-term storage. Storage runs ' + esc_(sn.storageStart || '') + ' – ' + esc_(sn.storageEnd || '') + ' and is subject to Quest\'s Storage Terms.</p>'
        : '<p class="terms">Totals include sales tax and related supply costs, per invoice(s). All quoted charges are calculated from Owner-provided information and are subject to Quest\'s review; Quest reserves the right to remeasure the unit and to make corrective charges or credits in the event of any measurement discrepancy, calculation error, or misapplied rate. Prices valid when balances are settled in full by ' + esc_(sn.payBy || '') + ' by cash, check, debit card, Zelle, or ACH; credit card payments subject to a 3% fee. Balances unpaid after ' + esc_(sn.payByShort || '') + ' increase by 10%, and a 2% monthly service charge (min. $5) applies beginning ' + esc_(sn.lateStart || '') + '. Units not removed at end of storage term or within 10 days of service completion are subject to $25/day short-term storage. Storage runs ' + esc_(sn.storageStart || '') + ' – ' + esc_(sn.storageEnd || '') + ' and is subject to Quest\'s Storage Terms.</p>';
    })() +
    '</body></html>';
}

/* ---------- Notification email ---------- */

function sendNotification_(d, tabName, wasUpdate, pdfUrl) {
  const signing = (d.status || '').indexOf('Signed') === 0;
  /* A price disagreement between the page and this script leads the subject.
     It means a human should look at the quote before anything goes out. */
  const subject = (d._driftNote ? '⚠️ PRICE DRIFT — ' : (signing ? '💰 SIGN & PAY — ' : '📋 New winter quote — ')) +
    (d.quoteNo || '') + ' · ' + (d.owner || 'Unknown') + ' · ' + (d.unit || '') +
    ' · $' + d.total;

  const lines = [
    'Status:      ' + d.status + (wasUpdate ? '  (updated existing quote)' : ''),
    (d._manualNote ? 'Manual:      ' + d._manualNote : null),
    (d._driftNote ? 'DRIFT:       ' + d._driftNote : null),
    (d._flags && d._flags.length
      ? 'Flags:       ' + d._flags.map(function (f) { return f.msg; }).join(' | ')
      : null),
    'Quote #:     ' + d.quoteNo,
    'Storage tab: ' + tabName,
    'Quote PDF:   ' + (pdfUrl || '(PDF generation failed — see Apps Script executions log)'),
    '',
    'Owner:       ' + ((d.lastName || d.firstName) ? (d.lastName + ', ' + d.firstName) : d.owner),
    'Phone:       ' + d.phone,
    'Email:       ' + d.email,
    'Unit:        ' + d.unit + (d.ymm ? '  (' + d.ymm + ')' : ''),
    'Dimensions:  ' + (d.dims || '—'),
    '',
    'Total:       $' + d.total,
    'Deposit:     $' + d.deposit,
    'Pay choice:  ' + (d.payMode || '—'),
    '',
    'Services:',
    '  ' + (d.items || '—').split(' | ').join('\n  '),
  ];
  if (d.quotesRequested) lines.push('', 'Quotes requested: ' + d.quotesRequested);
  if (d.notes) lines.push('', 'Customer notes: ' + d.notes);
  lines.push('', 'Spreadsheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());

  /* Filter once, for both paths. Optional rows are pushed as null; the
     MailApp fallback used to join them straight in, printing a literal
     "null" line whenever a quote had no manual note. */
  const body = lines.filter(function (x) { return x !== null; }).join('\n');
  if (FROM_ALIAS) {
    GmailApp.sendEmail(NOTIFY_EMAIL, subject, body,
      { from: FROM_ALIAS, name: 'Quest Winter Quotes' });
  } else {
    MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
  }
}


/* ============ STAFF CONSOLE PAGE (mobile-first) ============ */
function adminPage_() {
  return '<!DOCTYPE html><html><head><style>' +
  ':root{--navy:#14293E;--frost:#4A81A6;--gold:#C08A22;--ice:#EBF1F6;--line:#C7D5E0;--muted:#5C7185}' +
  '*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:var(--ice);color:#1D2B38}' +
  '.wrap{max-width:520px;margin:0 auto;padding:14px}' +
  '.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}' +
  'h1{font-size:19px;color:var(--navy);margin:4px 0 10px}h2{font-size:15px;color:var(--frost);margin:2px 0 8px}' +
  'input,select{width:100%;padding:12px;font-size:16px;border:1.5px solid var(--line);border-radius:9px;margin-bottom:8px}' +
  'button{width:100%;padding:13px;font-size:16px;font-weight:bold;border:0;border-radius:9px;background:var(--navy);color:#fff;margin-bottom:8px}' +
  'button.gold{background:var(--gold)}button.ghost{background:#fff;color:var(--navy);border:1.5px solid var(--navy)}' +
  'button:disabled{opacity:.5}.muted{color:var(--muted);font-size:13px}.ok{color:#1E6B3A;font-weight:bold}' +
  '.err{color:#A6541F;font-weight:bold}.row{display:flex;gap:8px}.row>*{flex:1}' +
  '.kv{display:flex;justify-content:space-between;padding:3px 0;font-size:14px}.kv b{color:var(--navy)}' +
  '.hdr{background:var(--navy);color:#fff;padding:14px 16px;font-weight:bold;letter-spacing:.04em}' +
  '.hdr small{color:#B9CDDD;font-weight:normal;display:block}' +
  '.perm{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--ice)}' +
  '.hide{display:none}.lines{font-size:13px;color:#333;background:#FDFCF7;border:1px solid var(--line);border-radius:8px;padding:8px 10px;white-space:pre-wrap}' +
  '</style></head><body>' +
  '<div class="hdr">QUEST STAFF CONSOLE<small id="whoami">Winter services</small></div><div class="wrap">' +

  '<div class="card" id="loginCard"><h1>Log in</h1>' +
  '<input id="pin" type="password" inputmode="numeric" placeholder="Your PIN">' +
  '<button onclick="doLogin()">Log in</button><div id="loginMsg" class="muted"></div></div>' +

  '<div class="card hide" id="lookupCard"><h1>Find a quote</h1>' +
  '<input id="qn" placeholder="Quote # e.g. QW-26-####" autocapitalize="characters">' +
  '<button onclick="doLookup()">Look up</button><div id="lookupMsg" class="muted"></div></div>' +

  '<div class="hide" id="quoteArea">' +
    '<div class="card"><h2 id="qTitle"></h2><div id="qInfo"></div>' +
    '<details style="margin-top:6px"><summary class="muted">Line items</summary><div class="lines" id="qLines"></div></details></div>' +

    '<div class="card hide" id="payCard"><h2>Record payment</h2>' +
    '<div class="row"><input id="payAmt" inputmode="decimal" placeholder="Amount (neg = refund)"><input id="payMethod" placeholder="Cash / Check #1042 / Zelle"></div>' +
    '<label style="font-size:14px"><input type="checkbox" id="payReceipt" checked style="width:auto"> Email receipt to customer</label>' +
    '<button class="gold" onclick="doPay()">Record payment</button><div id="payMsg"></div></div>' +

    '<div class="card hide" id="adjCard"><h2>Adjustment</h2>' +
    '<div class="row"><input id="adjAmt" inputmode="decimal" placeholder="Amount (neg = discount)"><input id="adjDesc" placeholder="Wording on the invoice"></div>' +
    '<label style="font-size:14px"><input type="checkbox" id="adjEmail" style="width:auto"> Email updated copy now</label>' +
    '<button onclick="doAdjust()">Apply adjustment</button><div id="adjMsg"></div></div>' +

    '<div class="card hide" id="photoCard"><h2>Photos</h2>' +
    '<div class="muted" id="photoCounts"></div>' +
    '<div class="row"><select id="photoSeason"><option value="winter">Winter (arrival)</option><option value="spring">Spring (relaunch)</option></select></div>' +
    '<input id="photoFiles" type="file" accept="image/*" capture="environment" multiple>' +
    '<button onclick="doUpload()">Upload selected photos</button>' +
    '<button class="ghost" onclick="openPhotos()">Open photo folder</button><div id="photoMsg"></div></div>' +

    '<div class="card hide" id="emailCard"><h2>Customer emails</h2>' +
    '<button onclick="sendKind(\'stored\')">📦 We have your unit (w/ photos)</button>' +
    '<button onclick="sendKind(\'spring\')">🌱 Spring relaunch alert</button>' +
    '<div class="row"><input id="upnextWhen" placeholder="tomorrow / Thursday"><button style="flex:0 0 42%" onclick="sendUpNext()">🚤 Up next</button></div>' +
    '<button onclick="sendKind(\'splash\')">🌊 Back in the water / back home</button>' +
    '<button class="ghost" onclick="sendKind(\'updated\')">📧 Re-send current quote/invoice</button><div id="emailMsg"></div></div>' +
  '</div>' +

  '<div class="card hide" id="adminCard"><h2>Staff & permissions (admins)</h2><div id="staffList"></div></div>' +
  '<button class="ghost hide" id="adminBtn" onclick="loadStaff()">⚙️ Manage staff</button>' +
  '<button class="ghost hide" id="logoutBtn" onclick="logout()">Log out</button>' +
  '<p class="muted" style="text-align:center">Quest Watersports · every action is logged</p></div>' +

  '<script>' +
  'var T=localStorage.getItem("qwtok")||"",ME=JSON.parse(localStorage.getItem("qwme")||"null"),QN="";' +
  'function $(i){return document.getElementById(i)}' +
  'function show(i,on){$(i).classList[on?"remove":"add"]("hide")}' +
  'function boot(){if(T&&ME){show("loginCard",false);show("lookupCard",true);show("logoutBtn",true);' +
  '$("whoami").textContent="Logged in as "+ME.name;if(ME.admin)show("adminBtn",true);}}' +
  'function doLogin(){$("loginMsg").textContent="Checking…";google.script.run.withSuccessHandler(function(r){' +
  'if(!r.ok){$("loginMsg").textContent=r.error;$("loginMsg").className="err";return}' +
  'T=r.token;ME=r;localStorage.setItem("qwtok",T);localStorage.setItem("qwme",JSON.stringify(r));boot();' +
  '}).withFailureHandler(fail("loginMsg")).adminAuth($("pin").value)}' +
  'function logout(){localStorage.clear();location.reload()}' +
  'function fail(id){return function(e){$(id).textContent=e.message||e;$(id).className="err";' +
  'if(String(e.message||e).indexOf("expired")>-1){localStorage.clear();setTimeout(function(){location.reload()},1500)}}}' +
  'function doLookup(){QN=$("qn").value.trim().toUpperCase();$("lookupMsg").textContent="Looking up…";' +
  'google.script.run.withSuccessHandler(function(r){if(!r.ok){$("lookupMsg").textContent=r.error;$("lookupMsg").className="err";show("quoteArea",false);return}' +
  '$("lookupMsg").textContent="";renderQuote(r)}).withFailureHandler(fail("lookupMsg")).adminLookup(T,QN)}' +
  'function renderQuote(r){show("quoteArea",true);' +
  '$("qTitle").textContent=r.quoteNo+" — "+r.name;' +
  'var kv=function(k,v){return "<div class=kv><span>"+k+"</span><b>"+v+"</b></div>"};' +
  '$("qInfo").innerHTML=kv("Unit",r.unit+(r.ymm?" · "+r.ymm:""))+kv("Status",r.status)+kv("Total",r.total)+kv("Paid",r.paid)+kv("Balance",r.balance)+' +
  '(r.keyLoc?kv("Keys",r.keyLoc):"")+(r.hhoAddr?kv("HHO addr",r.hhoAddr):"")+(r.rq?kv("Quotes open",r.rq):"")+' +
  'kv("Email",r.hasEmail?r.email:"— none —")+(r.phone?kv("Phone",r.phone):"");' +
  '$("qLines").textContent=r.lines.join("\\n");' +
  'var P=ME.admin?{pay:1,adjust:1,email:1,photos:1}:(ME.perms||{});' +
  'show("payCard",!!P.pay);show("adjCard",!!P.adjust);show("emailCard",!!P.email&&r.hasEmail);show("photoCard",!!P.photos);' +
  'if(P.photos)refreshPhotos()}' +
  'function doPay(){$("payMsg").textContent="Working…";google.script.run.withSuccessHandler(done("payMsg"))' +
  '.withFailureHandler(fail("payMsg")).adminRecordPayment(T,QN,$("payAmt").value,$("payMethod").value,$("payReceipt").checked)}' +
  'function doAdjust(){$("adjMsg").textContent="Working…";google.script.run.withSuccessHandler(done("adjMsg"))' +
  '.withFailureHandler(fail("adjMsg")).adminAdjust(T,QN,$("adjAmt").value,$("adjDesc").value,$("adjEmail").checked)}' +
  'function done(id){return function(r){if(!r.ok){$(id).textContent=r.error;$(id).className="err";return}' +
  '$(id).textContent=r.msg||"Done.";$(id).className="ok";google.script.run.withSuccessHandler(renderQuote).adminLookup(T,QN)}}' +
  'function sendKind(k){$("emailMsg").textContent="Sending…";google.script.run.withSuccessHandler(done("emailMsg"))' +
  '.withFailureHandler(fail("emailMsg")).adminSendEmail(T,QN,k,"")}' +
  'function sendUpNext(){$("emailMsg").textContent="Sending…";google.script.run.withSuccessHandler(done("emailMsg"))' +
  '.withFailureHandler(fail("emailMsg")).adminSendEmail(T,QN,"upnext",$("upnextWhen").value)}' +
  'function refreshPhotos(){google.script.run.withSuccessHandler(function(r){if(r.ok){' +
  'window._purl=r.url;$("photoCounts").textContent="Winter: "+r.counts.winter+" photo(s) · Spring: "+r.counts.spring+" photo(s)"}}).adminPhotoInfo(T,QN)}' +
  'function openPhotos(){if(window._purl)window.open(window._purl,"_blank")}' +
  'function doUpload(){var files=$("photoFiles").files;if(!files.length){$("photoMsg").textContent="Pick photos first.";$("photoMsg").className="err";return}' +
  'var i=0,season=$("photoSeason").value;' +
  'function next(){if(i>=files.length){$("photoMsg").textContent="Uploaded "+files.length+" photo(s).";$("photoMsg").className="ok";$("photoFiles").value="";refreshPhotos();return}' +
  'var f=files[i];$("photoMsg").textContent="Uploading "+(i+1)+" of "+files.length+"…";$("photoMsg").className="muted";' +
  'var rd=new FileReader();rd.onload=function(){var b64=rd.result.split(",")[1];' +
  'google.script.run.withSuccessHandler(function(r){if(!r.ok){$("photoMsg").textContent=r.error;$("photoMsg").className="err";return}i++;next()})' +
  '.withFailureHandler(fail("photoMsg")).adminUploadPhoto(T,QN,season,f.name,b64,f.type)};rd.readAsDataURL(f)}next()}' +
  'function loadStaff(){show("adminCard",true);google.script.run.withSuccessHandler(function(r){if(!r.ok){alert(r.error);return}' +
  'var h="";r.staff.forEach(function(st){h+="<div style=\'margin:10px 0 4px;font-weight:bold;color:var(--navy)\'>"+st.name+(st.admin?" (admin)":"")+"</div>";' +
  '["pay","adjust","email","photos","admin"].forEach(function(p){var on=p==="admin"?st.admin:st.perms[p];' +
  'h+="<div class=perm><span>"+({pay:"Payments",adjust:"Adjustments",email:"Customer emails",photos:"Photos",admin:"Admin"})[p]+"</span>"+' +
  '"<button style=\'width:auto;padding:6px 14px;margin:0\' class=\'"+(on?"":"ghost")+"\' onclick=togglePerm(\'"+st.name+"\',\'"+p+"\',"+(on?0:1)+")>"+(on?"ON":"off")+"</button></div>"});' +
  'h+="<button class=ghost style=\'margin-top:6px\' onclick=resetPin(\'"+st.name+"\')>Reset "+st.name+"\'s PIN</button>"});' +
  '$("staffList").innerHTML=h}).adminListStaff(T)}' +
  'function togglePerm(n,p,v){google.script.run.withSuccessHandler(function(r){if(!r.ok){alert(r.error);return}loadStaff()}).adminSetPerm(T,n,p,v)}' +
  'function resetPin(n){if(!confirm("Reset "+n+"\'s PIN?"))return;' +
  'google.script.run.withSuccessHandler(function(r){if(!r.ok){alert(r.error);return}alert(n+"\'s new PIN: "+r.pin+"\\nWrite it down now — it is not shown again.")}).adminResetPin(T,n)}' +
  'boot();' +
  '</scr'+'ipt></body></html>';
}
