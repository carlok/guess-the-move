// SPDX-License-Identifier: AGPL-3.0-or-later
/* Registers the service worker (sw.js) and offers "Reload" when a new build is waiting. It only registers on https or on
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

    function offer(worker) { waiting = worker; if (bar) bar.hidden = false; }
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

  if (typeof window !== 'undefined' && window.document && !window.__GTM_NO_PWA) {
    window.addEventListener('load', function () { setup(window); });
  }

  return { setup: setup };
}));
