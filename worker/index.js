const CANONICAL_HOST = "fewbottles.com";

/* This Worker is not the site. GitHub Pages is. It only answers
   drink.shoephone.net.

   Returning visitors never see a 301 because the installed worker
   answers cache-first. A cross-origin redirect of sw.js also fails
   the update check, so this origin has to keep serving a real sw.js
   that evicts itself and then navigates. Everything else 301s. */

const EVICT_SW = `self.addEventListener('install', function (e) {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    self.clients.claim()
      .then(function () { return self.registration.unregister(); })
      .then(function () { return caches.keys(); })
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.matchAll({ type: 'window' }); })
      .then(function (cs) {
        cs.forEach(function (c) {
          var u = new URL(c.url);
          u.hostname = '${CANONICAL_HOST}';
          u.protocol = 'https:';
          c.navigate(u.href);
        });
      })
  );
});
`;

function canonicalUrl(url) {
  const next = new URL(url);
  next.hostname = CANONICAL_HOST;
  next.protocol = "https:";
  return next.toString();
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (/\/sw\.js$/.test(url.pathname)) {
      return new Response(EVICT_SW, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return Response.redirect(canonicalUrl(url), 301);
  },
};
