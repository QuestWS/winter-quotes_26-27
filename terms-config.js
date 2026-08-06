/* ============================================================================
   Quest Watersports — TERMS VERSION, single source of truth
   ----------------------------------------------------------------------------
   Read by index.html (which stamps the accepted version into every quote
   payload), terms.html and privacy.html (which display it). One constant, so
   the version a customer SEES can never drift from the version RECORDED
   against their acceptance — that gap is exactly what would undermine the
   record later.

   WHEN YOU CHANGE THE LEGAL TEXT:
   1. Bump `version` here and update `updated` / `updatedLong`.
   2. Edit terms.html / privacy.html.
   3. Deploy all of it together.
   Quotes already accepted keep the version they agreed to — that is the point
   of stamping it rather than looking it up later.

   No build step. Plain script, loaded with a <script> tag by all three pages.
============================================================================ */
'use strict';
(function (root) {
  const TERMS = {
    version: '1.0',
    updated: '8/6/26',
    updatedLong: 'August 6, 2026',
    entity: 'Riverview Enterprises LLC, doing business as Quest Watersports',
    address: '1851 Old Chicago Road, Ottawa, IL',
    phone: '(815) 433-2200',
    contactEmail: 'contact@questwatersports.com',
  };
  root.QuestTerms = TERMS;
  if (typeof module !== 'undefined' && module.exports) module.exports = TERMS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
