// SPDX-License-Identifier: AGPL-3.0-or-later
/* Seeded choices: the same token always gives the same positions, with no server. A "challenge" is a token (today's date for the
 * daily one, or a short random code for one sent to a friend) plus a short tag of the dataset it was made with; the positions are
 * chosen from the token alone. Pure functions, no DOM, no storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_SEED = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_MOVES = 3;                        // a position with one or two legal moves is no challenge
  var CODE = /^([0-9a-z]{3,16})\.([0-9a-f]{4})$/;

  /* xmur3-style string hash: a 32-bit unsigned number. */
  function hash32(str) {
    var h = 1779033703 ^ str.length, i;
    for (i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /* mulberry32: a seeded generator returning numbers in [0, 1). */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* The local calendar date as YYYYMMDD: the daily challenge's token. */
  function todayToken(ms) {
    var d = new Date(ms), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }
  function isDaily(token) { return /^\d{8}$/.test(token); }
  function label(token) { return isDaily(token) ? token.slice(0, 4) + '-' + token.slice(4, 6) + '-' + token.slice(6) : token; }

  /* A short tag of the dataset (its build date and size): a link made with another dataset would pick other positions. */
  function tagOf(meta, count) {
    return ('0000' + (hash32(String(meta && meta.built || '') + '|' + count) & 0xffff).toString(16)).slice(-4);
  }

  function code(token, tag) { return token + '.' + tag; }
  function parseCode(s) {
    var m = typeof s === 'string' ? CODE.exec(s) : null;
    return m ? { token: m[1], tag: m[2] } : null;
  }
  function newToken(rand) {
    var r = rand || Math.random, out = '', i;
    for (i = 0; i < 6; i++) out += '0123456789abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(r() * 36));
    return out;
  }

  /* `n` positions for `token`: the eligible ones, sorted by id (so the order of the data does not matter), then a seeded partial shuffle. */
  function select(positions, token, n) {
    var pool = positions.filter(function (p) { return !p.custom && p.evals && Object.keys(p.evals).length >= MIN_MOVES; })
      .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    var rand = rng(hash32(token)), k = Math.min(n, pool.length), i, j, t;
    for (i = 0; i < k; i++) { j = i + Math.floor(rand() * (pool.length - i)); t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    return pool.slice(0, k);
  }

  return { hash32: hash32, rng: rng, todayToken: todayToken, isDaily: isDaily, label: label, tagOf: tagOf, code: code, parseCode: parseCode, newToken: newToken, select: select, MIN_MOVES: MIN_MOVES };
}));
