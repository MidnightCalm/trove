/* Trove service worker — offline app shell.
 *
 * Bump VERSION whenever you change style.css or app.js, and update the matching
 * ?v= on the <link>/<script> tags in index.html. Those two must move together.
 *
 * Cache strategy:
 *   navigations  -> network-first (a deploy is live on the next launch; cache is the offline fallback)
 *   everything else -> cache-first on an EXACT url match, which is safe because the
 *                      asset urls carry ?v= and therefore change whenever the bytes change.
 */
const VERSION = '2';
const CACHE = 'trove-v' + VERSION;
const ASSETS = [
  './',
  'style.css?v=' + VERSION,
  'app.js?v=' + VERSION,
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // {cache:'reload'} is load-bearing: without it these requests are answered by the
      // browser's HTTP cache, which would freeze stale bytes into a freshly-named cache
      // and — because reads below are cache-first — keep serving them indefinitely.
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ---- navigations: network-first ----
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./').then(hit => hit || Response.error()))
    );
    return;
  }

  // ---- assets: cache-first, exact match ----
  // NOTE: no {ignoreSearch:true} here. It would collapse "style.css?v=2" onto a cached
  // "style.css?v=1" entry and silently undo the versioning above.
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        const sameOrigin = url.origin === location.origin;
        const isFont = url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
        if ((res.ok || res.type === 'opaque') && (sameOrigin || isFont)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
      // A miss while offline rejects, which surfaces as a normal network error.
      // (The old code answered index.html here, handing HTML to <img> and <link> tags.)
    })
  );
});
