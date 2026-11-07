// SPDX-License-Identifier: AGPL-3.0-or-later
/* Service worker: lets the page open offline, without ever serving a file from the wrong build.
 *
 * `make dist` (tools/build_dist.py) replaces __BUILD__ with the build id and the FILES line with the list of files of that
 * build. Each build has its own cache, so an old build's files are never mixed with a new one's, and an old cache is deleted
 * when the new worker activates. Where the placeholders are still there (the source tree, not a build) the worker does nothing,
 * so development never meets a stale cache.
 *
 * Strategy: the page and the dataset go to the network first (you get the latest when online) and fall back to the cache
 * (offline); scripts, styles and images are cached by their exact URL, which carries the build id; the optional api is never
 * cached; anything that is not a same-origin GET is left alone. A new worker waits until the page asks it to take over
 * (the "reload to update" bar), so a page is never switched under the user. */
var BUILD = '__BUILD__';
var FILES = []; // @FILES@
var PREFIX = 'gtm-';
var CACHE = PREFIX + BUILD;
var DEV = BUILD.indexOf('__') === 0;

self.addEventListener('install', function (event) {
  if (DEV) return;
  // cache: 'reload' skips the HTTP cache: a host that sends max-age (GitHub Pages: 10 minutes) must not hand this build's cache the previous build's files
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(FILES.map(function (u) { return new Request(u, { cache: 'reload' }); })); }));
});

self.addEventListener('activate', function (event) {
  if (DEV) return;
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (event) {
  if (event.data === 'skip') self.skipWaiting();
});

function networkFirst(request, fallbackUrl) {
  return caches.open(CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(function () {
      return cache.match(request).then(function (hit) { return hit || cache.match(fallbackUrl); });
    });
  });
}

function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      return hit || fetch(request).then(function (response) {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  if (DEV) return;
  var request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || /\/api\//.test(url.pathname)) return;
  var scope = self.registration.scope;
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request, new URL('index.html', scope).href)); return; }
  if (url.pathname.indexOf('/data/') >= 0 || /\/version\.json$/.test(url.pathname)) { event.respondWith(networkFirst(request, request.url)); return; }
  event.respondWith(cacheFirst(request));
});
