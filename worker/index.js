const CANONICAL_HOST = "fewbottles.com";

/* Old-origin service worker. Returning visitors never see the 301
   because the installed worker answers cache-first. A cross-origin
   redirect of sw.js also fails the update check, so this file has to
   keep being served from drink.shoephone.net until it can evict itself. */
const EVICT_SW = `if (self.location.protocol !== 'https:') {
  self.registration.unregister()
    .then(function () { return caches.keys(); })
    .then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    })
    .then(function () { return self.clients.matchAll({ type: 'window' }); })
    .then(function (cs) { cs.forEach(function (c) { c.navigate(c.url); }); });
}

self.addEventListener('install', function (e) {
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
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "drink.shoephone.net" && /\/sw\.js$/.test(url.pathname)) {
      return new Response(EVICT_SW, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (url.hostname === "www.fewbottles.com" || url.hostname === "drink.shoephone.net") {
      return Response.redirect(canonicalUrl(url), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
