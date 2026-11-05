// SPDX-License-Identifier: AGPL-3.0-or-later
/* Registers the service worker (sw.js; app.js loads this part after the page has loaded) and offers "Reload" when a new build is waiting. It only registers on https or on
 * localhost (browsers refuse otherwise), and the worker itself does nothing outside a `make dist` build.
 * A new build never replaces the running page by itself: the worker waits, the bar appears, and the page switches only when
 * the person presses Reload. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_PWA = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* opts.sw: a stand-in for navigator.serviceWorker (tests); opts.reload: what to do when the new worker has taken over. */
  function setup(win, opts) {
    opts = opts || {};
    var sw = opts.sw || (win.navigator && win.navigator.serviceWorker);
    if (!sw) return Promise.resolve(null);
    var host = win.location.hostname;
    if (win.location.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') return Promise.resolve(null);
    var doc = win.document, bar = doc.getElementById('updateBar'), button = doc.getElementById('updateBtn'), waiting = null, asked = false;

    /* The build this page is running, from the ?v= that `make dist` puts on its scripts (none in the source tree). */
    var tag = doc.querySelector('script[src*="?v="]'), mine = tag && /[?]v=([0-9a-f]+)/.exec(tag.getAttribute('src'));
    mine = mine && mine[1];
    /* A plain reload already loads the newest page (the worker fetches the page from the network first), yet the new worker keeps
     * waiting until every tab closes. Then the page is current and the bar would never go away: only offer a build the page is not
     * running. If that cannot be told (offline, no fetch), offer it. */
    function offer(worker) {
      waiting = worker;
      if (!bar) return;
      if (!mine || !win.fetch) { bar.hidden = false; return; }
      win.fetch('version.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (v) { return v.build === mine; }, function () { return false; })
        .then(function (current) { bar.hidden = current; });
    }
    if (button) button.addEventListener('click', function () { asked = true; if (waiting) waiting.postMessage('skip'); });
    sw.addEventListener('controllerchange', function () { if (asked) (opts.reload || function () { win.location.reload(); })(); });

    return sw.register('sw.js').then(function (reg) {
      if (reg.waiting && sw.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var worker = reg.installing;
        worker.addEventListener('statechange', function () { if (worker.state === 'installed' && sw.controller) offer(worker); });
      });
      return reg;
    }, function () { return null; });
  }

  return { setup: setup };
}));
