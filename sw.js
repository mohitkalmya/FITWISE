'use strict';
/* FITWISE service worker.
 * Strategy: network-first (revalidating) for every same-origin file, with the cache as the offline fallback.
 * This means an online visit always gets the newest version, and offline visits still open the app.
 * Bump VERSION on every release so old caches are removed. */
const VERSION = '1.3.2';
const CACHE = 'fitwise-' + VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css', './js/theme.js', './js/core.js', './js/foods.js', './js/vault.js', './js/app.js',
  './icons/fitwise-192.png', './icons/fitwise-512.png', './icons/fitwise-maskable-512.png', './icons/fitwise-icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('fitwise-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
