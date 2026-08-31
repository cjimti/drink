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
      .then(function (c) {
        /* reload, not addAll: GitHub Pages caches JS for four hours, and
           filling a new shell from that copy would stamp the old app into
           the new cache. */
        return Promise.all(SHELL.map(function (path) {
          return fetch(path, { cache: 'reload' }).then(function (res) {
            if (!res.ok) throw new Error(path);
            return c.put(path, res);
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      var stale = keys.filter(function (k) { return k !== CACHE; });
      return Promise.all(stale.map(function (k) { return caches.delete(k); }))
        .then(function () { return stale.length; });
    }).then(function (n) {
      return self.clients.claim().then(function () { return n; });
    }).then(function (n) {
      if (!n) return;
      /* Claiming is not enough. An iOS home-screen WebView resumes in
         place, old shell still parsed, and will sit on it until something
         navigates. The https eviction already uses this; a replacing
         cache has to as well. */
      return self.clients.matchAll({ type: 'window' }).then(function (cs) {
        cs.forEach(function (c) { c.navigate(c.url); });
      });
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  /* Never cache the worker itself. A cache-first hit here is how a
     phone keeps an old sw.js after a deploy. */
  if (/\/sw\.js$/.test(url.pathname)) return;

  var isData = /\/data\/.*\.json$/.test(url.pathname);

  if (isData) {
    e.respondWith(
      fetch(req, { cache: 'no-store' }).then(function (res) {
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
