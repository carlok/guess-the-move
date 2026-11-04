// SPDX-License-Identifier: AGPL-3.0-or-later
/* Colour theme. Loaded in <head> so the theme is set before first paint (no flash). Follows the system unless the
 * user chose one; the choice is kept in localStorage (always inside try/catch, the app works without it). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.GTM_THEME = factory(root);
}(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var KEY = 'gtm.v1.theme';

  function stored() {
    try {
      var v = JSON.parse(win.localStorage.getItem(KEY));
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) { return null; }
  }
  function system() {
    return win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function current() { return win.document.documentElement.getAttribute('data-theme'); }
  function apply(t) { win.document.documentElement.setAttribute('data-theme', t); return t; }
  function toggle() {
    var t = apply(current() === 'dark' ? 'light' : 'dark');
    try { win.localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) { /* optional */ }
    return t;
  }

  apply(stored() || system());
  return { current: current, toggle: toggle };
}));
