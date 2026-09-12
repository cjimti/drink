/* Offline shell for fewbottles.com. A phone propped against the back bar
   has no business needing signal to show a recipe.

   VERSION is stamped from the tag at deploy time, and only a tag
   deploys, so every release invalidates the old cache and a push to
   main leaves it alone. Shell assets are cache-first, data is
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

/* cache: 'reload' skips the browser's cache and nothing else. Cloudflare
   and GitHub's own edge both hold a file for ten minutes after a deploy,
   so a worker installing in that window would fetch the previous
   release's shell and pin it under the new cache name until the next
   tag. A query nobody has asked for before misses every edge. */
function fresh(path) {
  return path + (path.indexOf('?') < 0 ? '?' : '&') + 'v=' + VERSION;
}

var SHELL = [
  './',
  'index.html',
  /* What a navigation falls back on when there is no signal and no copy
     of the page asked for. Cached with the shell so it is always there
     by the time it is needed. */
  'offline.html',
  'assets/app.css',
  'assets/app.js',
  'assets/icon.svg',
  /* Chrome asks for a 192 and a 512 before it will offer to install,
     and Android's launcher wants the maskable one or the mark sits
     in a white circle. An icon missing the first time the site is
     added with no signal is a blank square on somebody's home
     screen for good. */
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-512-maskable.png',
  'manifest.webmanifest',
  /* The three faces. Cached with the shell because the printed
     menu is what this project preserves, and a phone offline was
     setting it in Helvetica. latin-ext is here on the same terms:
     no drink needs it today, and the day one does is the day
     there is no signal. */
  'assets/fonts/dm-mono-400-latin-ext.woff2',
  'assets/fonts/dm-mono-400-latin.woff2',
  'assets/fonts/dm-mono-500-latin-ext.woff2',
  'assets/fonts/dm-mono-500-latin.woff2',
  'assets/fonts/lato-400-italic-latin-ext.woff2',
  'assets/fonts/lato-400-italic-latin.woff2',
  'assets/fonts/lato-400-latin-ext.woff2',
  'assets/fonts/lato-400-latin.woff2',
  'assets/fonts/lato-700-latin-ext.woff2',
  'assets/fonts/lato-700-latin.woff2',
  'assets/fonts/montserrat-500-800-latin-ext.woff2',
  'assets/fonts/montserrat-500-800-latin.woff2',
  /* The plates on the Info tab. A help page that loses its pictures
     the first time it is opened with no signal is not much help. */
  'assets/tools/boston-shaker.png',
  'assets/tools/japanese-jigger.png',
  'assets/tools/hawthorne-strainer.png',
  'assets/tools/barspoon.png',
  'assets/tools/citrus-peeler.png',
  'assets/tools/paring-knife.png',
  'assets/tools/bitters-bottles.png',
  'assets/tools/bottle-pourers.png',
  'assets/tools/bar-mat.png',
  'assets/tools/nick-nora.png',
  'assets/tools/rocks-glass.png',
  'assets/tools/highball-glass.png'
];

var SHELL_PATHS = SHELL.map(function (path) {
  return new URL(path, self.location.href).pathname;
});

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        /* reload, not addAll: GitHub Pages caches JS for four hours, and
           filling a new shell from that copy would stamp the old app into
           the new cache. */
        return Promise.all(SHELL.map(function (path) {
          return fetch(fresh(path), { cache: 'reload' }).then(function (res) {
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

  /* Store a copy only when the network said yes. A 404 or a 5xx that
     got cached would be served cache-first until the next tag. */
  function keep(req, res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }

  /* A link to a drink this phone has never opened, tapped with no
     signal, has no cached copy to fall back on and lands on the
     browser's own error page. The shell carries one page for that. */
  function offlineOr(hit, req) {
    if (hit) return hit;
    if (req.mode !== 'navigate') return Response.error();
    return caches.match('offline.html').then(function (page) {
      return page || Response.error();
    });
  }

  var isData = /\/data\/.*\.json$/.test(url.pathname);
  var isShell = SHELL_PATHS.indexOf(url.pathname) >= 0;
  /* A shared menu arrives as /?s=<code>, and a drink link can carry a
     query too. The cached copy is keyed on the path, so a navigation has
     to match on the path alone or every link opened offline misses the
     cache it is standing next to. */
  var opts = req.mode === 'navigate' ? { ignoreSearch: true } : undefined;

  /* The shell was fetched fresh at install and is keyed to this version,
     so it is safe cache-first. Everything else, a drink page, a glass, a
     card, the data, goes to the network first and falls back to the copy
     from last time. That is what stops an edge cache serving the old
     release for ten minutes after a deploy from being pinned here for
     good, and it keeps the offline copy no more than one visit old. */
  if (!isShell) {
    e.respondWith(
      fetch(req, isData ? { cache: 'no-store' } : undefined)
        .then(function (res) { return keep(req, res); })
        .catch(function () {
          return caches.match(req, opts).then(function (hit) {
            return offlineOr(hit, req);
          });
        })
    );
    return;
  }

  e.respondWith(
    caches.match(req, opts).then(function (hit) {
      return hit || fetch(req).then(function (res) { return keep(req, res); });
    })
  );
});
