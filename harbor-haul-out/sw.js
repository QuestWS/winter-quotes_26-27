/* Harbor Haul Out — the service worker.
   ---------------------------------------------------------------------------
   What it is for: the app is opened on a phone at the harbor, on whatever
   signal the harbor has. Before this, every open fetched the page from GitHub
   Pages, the stylesheet, and three font families from Google before a single
   thing could be drawn — and on two bars that alone was a long blank screen,
   before Apps Script had even been asked for the list.

   After the first visit the SHELL (this page, its stylesheet, the manifest,
   the icon, the fonts) is served from here. Two rules, both deliberate:

   1. NETWORK FIRST, with a short timeout, for everything on this site. A
      deploy still reaches the phone on the next open that has signal; the
      cache only answers when the network is slow or gone. Cache-first would
      have made the "hard-refresh or you are debugging a ghost" rule in
      CLAUDE.md permanent on every phone in the crew.
   2. THE API IS NEVER TOUCHED. Nothing from script.google.com (the console
      API) or googleusercontent.com (the redirect leg its POST answers with)
      goes through this worker. A cached console reply would be a stale list
      that looks fresh — the app keeps its own copy of the list in
      localStorage, with the time on it, and that is the only stale data it
      is allowed to show. tools/check-harbor-haul-out.js executes this file
      and asserts both rules.

   Bump V whenever the shell changes shape enough that an old copy must not
   be served even for the four seconds the timeout allows. */
'use strict';
const V = 'hho-shell-v1';
const SHELL = ['./', './index.html', './manifest.json', '../quest.css', '../favicon.png'];
const NET_MS = 4000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) {
    /* One at a time and tolerant: a shell file that fails to fetch on the
       first visit must not stop the rest from being kept. */
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== V; })
                           .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isApi_(url) {
  return url.hostname === 'script.google.com' || /\.googleusercontent\.com$/.test(url.hostname);
}
function isFont_(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (isApi_(url)) return;                       // rule 2 — the browser handles it
  if (isFont_(url)) { e.respondWith(cacheFirst_(req)); return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(networkFirst_(req));
});

function withTimeout_(p, ms) {
  return new Promise(function (res, rej) {
    const t = setTimeout(function () { rej(new Error('timeout')); }, ms);
    p.then(function (v) { clearTimeout(t); res(v); }, function (err) { clearTimeout(t); rej(err); });
  });
}

/* The site's own files: the network's answer when it arrives in time, the
   cached copy when it does not, and the cache refreshed by every answer that
   does arrive. A navigation with nothing cached under its exact URL falls
   back to the page itself. */
async function networkFirst_(req) {
  const cache = await caches.open(V);
  try {
    const res = await withTimeout_(fetch(req), NET_MS);
    if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    throw err;
  }
}

/* Fonts never change under a given URL, so the copy on the phone is the
   answer; the network is asked only for one it has not seen. */
async function cacheFirst_(req) {
  const cache = await caches.open(V);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(function () {});
  return res;
}
