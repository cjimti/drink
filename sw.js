/* Offline shell for drink.shoephone. A phone propped against the back bar
   has no business needing signal to show a recipe.

   VERSION is stamped with the commit SHA at deploy time, so every push
   invalidates the old cache. Shell assets are cache-first, data is
   network-first with a cached fallback. */

/* Dev safety net. A worker that got installed on http://localhost is
   squatting on an origin every static site here shares, and it will keep
   answering cache-first long after the server that served it is gone.
   If this ever wakes up off https, it takes itself out. */
if (self.location.protocol !== 'https:') {
  self.registration.unregister()
    .then(function () { return caches.keys(); })
    .then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    })
    .then(function () { return self.clients.matchAll({ type: 'window' }); })
    .then(function (cs) { cs.forEach(function (c) { c.navigate(c.url); }); });
}

var VERSION = '__BUILD__';
var CACHE = 'drink-' + VERSION;

var SHELL = [
  './',
  'index.html',
  'assets/app.css',
  'assets/app.js',
  'assets/icon.svg',
  'assets/icon-180.png',
  'manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  var isData = /\/data\/.*\.json$/.test(new URL(req.url).pathname);

  if (isData) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      });
    })
  );
});
