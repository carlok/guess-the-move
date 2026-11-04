/* Export and import of the stats (the guess history and the played-position list). Pure functions: no DOM, no storage.
 * The file is plain JSON: {app, format, exported, dataset, history, seen}. An imported file is untrusted input, so every
 * entry is rebuilt from known fields with their types checked; anything else in it is dropped, never stored or shown. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_BACKUP = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var APP = 'guess-the-move', FORMAT = 1, MAX_BYTES = 5 * 1024 * 1024, MAX_SEEN = 20000;
  var MODES = { best: 1, predict: 1 }, PHASES = { opening: 1, middlegame: 1, endgame: 1 };
  var UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
  var TIERS = { brilliant: 1, great: 1, best: 1, excellent: 1, good: 1, inaccuracy: 1, mistake: 1, blunder: 1 };

  var num = function (v) { return typeof v === 'number' && isFinite(v); };
  var bool = function (v) { return v === true || v === false ? v : null; };

  function build(history, seen, meta, now) {
    return {
      app: APP, format: FORMAT, exported: new Date(now).toISOString(),
      dataset: { built: (meta && meta.built) || null, source: (meta && meta.source) || null },
      history: history, seen: Array.from(seen)
    };
  }

  function fileName(now) { return APP + '-stats-' + new Date(now).toISOString().slice(0, 10) + '.json'; }

  /* One history entry rebuilt from known fields, or null when it is not a usable guess. */
  function cleanEntry(e) {
    if (!e || typeof e !== 'object' || !MODES[e.mode] || !num(e.score) || typeof e.id !== 'string' || e.id.length > 64) return null;
    var out = {
      id: e.id, mode: e.mode, phase: PHASES[e.phase] ? e.phase : null,
      tags: Array.isArray(e.tags) ? e.tags.filter(function (t) { return typeof t === 'string' && t.length <= 40; }).slice(0, 12) : [],
      cost: num(e.cost) ? e.cost : null, score: e.score, mb: bool(e.mb), mr: bool(e.mr), mm: bool(e.mm), t: num(e.t) ? e.t : 0
    };
    if (num(e.dur) && e.dur >= 0) out.dur = Math.round(e.dur);
    if (typeof e.tier === 'string' && TIERS.hasOwnProperty(e.tier)) out.tier = e.tier;
    if (typeof e.fen === 'string' && e.fen.length <= 100 && typeof e.uci === 'string' && UCI.test(e.uci)) {
      out.fen = e.fen; out.uci = e.uci; out.opp = num(e.opp) ? e.opp : null;
    }
    return out;
  }

  /* -> {ok: true, history, seen, skipped} or {ok: false, error: 'size' | 'json' | 'app' | 'format' | 'empty'} */
  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES) return { ok: false, error: 'size' };
    var d;
    try { d = JSON.parse(text); } catch (e) { return { ok: false, error: 'json' }; }
    if (!d || typeof d !== 'object' || d.app !== APP) return { ok: false, error: 'app' };
    if (d.format !== FORMAT) return { ok: false, error: 'format' };
    if (!Array.isArray(d.history)) return { ok: false, error: 'empty' };
    var history = [], skipped = 0;
    d.history.forEach(function (e) { var c = cleanEntry(e); if (c) history.push(c); else skipped++; });
    var seen = Array.isArray(d.seen) ? d.seen.filter(function (s) { return typeof s === 'string' && s.length <= 64; }).slice(0, MAX_SEEN) : [];
    return { ok: true, history: history, seen: seen, skipped: skipped };
  }

  /* Union by guess (position id + time), oldest first, newest `max` kept. */
  function merge(current, incoming, max) {
    var have = {}, added = 0, dups = 0, all = current.slice();
    current.forEach(function (e) { have[e.id + '|' + e.t] = true; });
    incoming.forEach(function (e) {
      var k = e.id + '|' + e.t;
      if (have[k]) { dups++; return; }
      have[k] = true; added++; all.push(e);
    });
    all.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    return { history: all.slice(-max), added: added, duplicates: dups };
  }

  return { FORMAT: FORMAT, build: build, fileName: fileName, parse: parse, merge: merge, cleanEntry: cleanEntry };
}));
