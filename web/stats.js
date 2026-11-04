// SPDX-License-Identifier: AGPL-3.0-or-later
/* The numbers behind the stats view: pure functions from the guess history to streaks, today's count, the clock and a summary
 * (`summarize`). No DOM, no dependencies, so they are unit-tested in node. The charts that draw them are in statscharts.js, which the
 * page loads only when the stats page is opened; this file is small because the timer and the streak line need it from the start.
 * A history entry: {mode, phase, cost, score, mb, mr, mm, t (when), dur (seconds spent, absent in older entries)}. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_STATS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var W_MAX = 640, W_MIN = 300, SERIES_MAX = 100, AVG_WINDOW = 10, MIN_POINTS = 3, MIN_TIMED = 3, MIN_SPLIT = 6;
  var PHASES = ['opening', 'middlegame', 'endgame'];
  var TIER_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']; // = GTM_CLASSIFY.TIERS (a test checks)
  var COST_EDGES = [0.5, 2, 5, 10, 20]; // upper bounds in win-% points; the last bucket is open

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function mean(a) { return a.length ? sum(a) / a.length : null; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function round(n) { return Math.round(n); }
  function clock(sec) {
    var s = Math.max(0, Math.round(sec)), m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  /* Share of true answers among entries where the key is known, in percent, or null. */
  function pctOf(list, key) {
    var known = list.filter(function (e) { return e[key] !== null && e[key] !== undefined; });
    return known.length ? 100 * known.filter(function (e) { return e[key]; }).length / known.length : null;
  }
  /* A guess counts for the streak when it was Excellent or better (older guesses without a tier: cost <= 2). */
  var GOOD = { brilliant: 1, great: 1, best: 1, excellent: 1 };
  function isGood(e) { return e.tier ? !!GOOD[e.tier] : typeof e.cost === 'number' && e.cost <= 2; }

  /* The current run of good best-mode guesses, and the longest one in the history. */
  function streaks(history) {
    var run = 0, best = 0;
    (history || []).forEach(function (e) {
      if (e.mode !== 'best') return;
      if (isGood(e)) { run++; if (run > best) best = run; } else run = 0;
    });
    return { current: run, best: best };
  }

  /* How many guesses were made on the same local calendar day as `now`. */
  function todayCount(history, now) {
    var d = new Date(now);
    return (history || []).filter(function (e) {
      var x = new Date(e.t);
      return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
    }).length;
  }

  function movingAverage(values, w) {
    return values.map(function (_, i) { return mean(values.slice(Math.max(0, i - w + 1), i + 1)); });
  }

  function summarize(history) {
    var h = history || [];
    var best = h.filter(function (e) { return e.mode === 'best'; });
    var pred = h.filter(function (e) { return e.mode === 'predict'; });
    var scoresOf = function (list) { return list.map(function (e) { return e.score; }).filter(function (v) { return typeof v === 'number'; }); };
    var timed = h.filter(function (e) { return typeof e.dur === 'number'; });
    var timedBest = best.filter(function (e) { return typeof e.dur === 'number' && typeof e.score === 'number'; });
    var costs = best.map(function (e) { return e.cost; }).filter(function (v) { return typeof v === 'number'; });
    var buckets = COST_EDGES.map(function () { return 0; }).concat([0]);
    costs.forEach(function (c) {
      var i = 0;
      while (i < COST_EDGES.length && c >= COST_EDGES[i]) i++;
      buckets[i]++;
    });
    var tiers = TIER_ORDER.map(function (t) { return { tier: t, n: best.filter(function (e) { return e.tier === t; }).length }; });
    var tiered = tiers.reduce(function (a, t) { return a + t.n; }, 0);
    var phases = PHASES.map(function (p) {
      var sc = scoresOf(best.filter(function (e) { return e.phase === p; }));
      return { phase: p, n: sc.length, mean: mean(sc) };
    }).filter(function (p) { return p.n > 0; });
    var medT = median(timedBest.map(function (e) { return e.dur; }));
    var fast = timedBest.filter(function (e) { return e.dur <= medT; }), slow = timedBest.filter(function (e) { return e.dur > medT; });
    return {
      streak: streaks(h).current, bestStreak: streaks(h).best,
      n: h.length, nBest: best.length, nPredict: pred.length,
      meanBest: mean(scoresOf(best)), meanPredict: mean(scoresOf(pred)),
      found: pctOf(h, 'mb'), real: pctOf(h, 'mr'), maia: pctOf(h, 'mm'),
      medianTime: median(timed.map(function (e) { return e.dur; })),
      bestScores: scoresOf(best).slice(-SERIES_MAX), predictScores: scoresOf(pred).slice(-SERIES_MAX),
      tiers: tiers, tiered: tiered, costBuckets: buckets, phases: phases, timedBest: timedBest,
      split: timedBest.length >= MIN_SPLIT && fast.length && slow.length ?
        { at: medT, fast: mean(fast.map(function (e) { return e.score; })), slow: mean(slow.map(function (e) { return e.score; })) } : null
    };
  }

  /* ---------- charts ---------- */

  return {
    streaks: streaks, todayCount: todayCount, TIER_ORDER: TIER_ORDER, summarize: summarize, clock: clock, median: median, movingAverage: movingAverage,
    // what the charts share with it
    esc: esc, sum: sum, mean: mean, round: round, W_MAX: W_MAX, W_MIN: W_MIN, AVG_WINDOW: AVG_WINDOW, MIN_POINTS: MIN_POINTS, MIN_TIMED: MIN_TIMED
  };
}));
