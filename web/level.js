// SPDX-License-Identifier: AGPL-3.0-or-later
/* Level estimate from your guesses, computed in the page from data the dataset carries (no server, no model).
 *
 * Each position stores Maia's move probabilities at a few rating anchors (maia.by_elo). For any rating r in between,
 * the probability of a move is interpolated log-linearly. Given the moves you chose,
 *
 *     P(r | moves) is proportional to prior(r) * product over guesses of p(move | position, r)
 *
 * over a grid of ratings. Nothing here weights positions by hand: a position where every rating plays the same move
 * contributes the same factor at every r and so changes nothing, while one where ratings disagree moves the estimate
 * a lot. `information` makes that weight visible: the mutual information, in bits, between the move a player of
 * unknown rating makes and that rating, under the current posterior. `suggest` uses it to pick the position that is
 * expected to sharpen the estimate most.
 *
 * The likelihood is tempered: the product is raised to 1/TEMPERATURE. On real players of known rating the untempered
 * 80% interval held the truth only 72-81% of the time (docs/research/level-eval.json); 1.5 brings that to 77-89%. It is a
 * correction for a model that is not exactly right about real people, not something Bayes' rule asks for.
 *
 * Assumption, stated because it decides what the number means: you choose like a player of your rating does in a game.
 * The result is a "Lichess-equivalent" rating, never a FIDE rating. Pure functions, no DOM, no storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_LEVEL = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FLOOR = 0.001; // a move the model gave less than this (or does not list) counts as this, so one surprise cannot rule a rating out
  var TEMPERATURE = 1.5;
  var GRID = [];
  for (var r = 1000; r <= 2200; r += 50) GRID.push(r);

  /* The position's anchors as a sorted [{r, probs}] list, or null when it has fewer than two. */
  function anchorsOf(pos) {
    var by = pos && pos.maia && pos.maia.by_elo;
    if (!by) return null;
    var list = Object.keys(by).map(function (k) { return { r: Number(k), probs: by[k] }; })
      .filter(function (a) { return isFinite(a.r); }).sort(function (a, b) { return a.r - b.r; });
    return list.length >= 2 ? list : null;
  }

  /* The two anchors around r and the weight of the upper one; outside the range the nearest anchor alone. */
  function bracket(list, r) {
    if (r <= list[0].r) return [list[0], list[0], 0];
    var last = list[list.length - 1];
    if (r >= last.r) return [last, last, 0];
    var i = 1;
    while (r > list[i].r) i++; // ends before the last anchor: r is below it
    return [list[i - 1], list[i], (r - list[i - 1].r) / (list[i].r - list[i - 1].r)];
  }

  function probAt(list, uci, r) {
    var b = bracket(list, r);
    var lo = Math.log(Math.max(FLOOR, b[0].probs[uci] || 0)), hi = Math.log(Math.max(FLOOR, b[1].probs[uci] || 0));
    return Math.exp((1 - b[2]) * lo + b[2] * hi);
  }

  /* Probability that a player rated r chooses `uci` in `pos`; null when the position has no anchors. */
  function moveProb(pos, uci, r) {
    var list = anchorsOf(pos);
    return list ? probAt(list, uci, r) : null;
  }

  /* The moves of `pos` that share the best evaluation. Needs `pos.evals`. */
  function bestMoves(pos) {
    var ev = pos && pos.evals, keys = ev ? Object.keys(ev) : [];
    if (!keys.length) return [];
    var top = Math.max.apply(null, keys.map(function (k) { return ev[k]; }));
    return keys.filter(function (k) { return ev[k] === top; });
  }

  /* Probability that a player rated r plays the best move (the sum over moves tied for best); null when the position has no
   * anchors or no evaluations. This is the chance of that exact move, not of "a good move". */
  function bestProb(pos, r) {
    var list = anchorsOf(pos), best = bestMoves(pos);
    if (!list || !best.length) return null;
    return best.reduce(function (sum, m) { return sum + probAt(list, m, r); }, 0);
  }

  /* Bands for the chance of finding the best move: "match" is a position about as hard as a coin flip slightly in your
   * favour, "harder" one that fewer players of your rating solve. */
  var BANDS = { match: [0.4, 0.7], harder: [0.25, 0.5] };

  /* The position, among `candidates`, whose chance of the best move at `rating` falls in the band of `mode`; at random among
   * those, or the one nearest the middle of the band when none does. Returns {pos, p, mode} or null when nothing can be scored. */
  function matchPick(candidates, rating, mode, rng) {
    var m = BANDS[mode] ? mode : 'match', lo = BANDS[m][0], hi = BANDS[m][1], mid = (lo + hi) / 2, scored = [];
    candidates.forEach(function (c) { var p = bestProb(c, rating); if (p !== null) scored.push({ pos: c, p: p }); });
    if (!scored.length) return null;
    var inBand = scored.filter(function (s) { return s.p >= lo && s.p <= hi; });
    if (!inBand.length) {
      var near = Math.min.apply(null, scored.map(function (s) { return Math.abs(s.p - mid); }));
      inBand = scored.filter(function (s) { return Math.abs(s.p - mid) <= near + 1e-12; });
    }
    var chosen = inBand[Math.floor((rng || Math.random)() * inBand.length)];
    return { pos: chosen.pos, p: chosen.p, mode: m };
  }

  function uniformPrior() { return GRID.map(function () { return 1 / GRID.length; }); }

  /* observations: [{pos, uci}]. Those whose position has no anchors are skipped and counted. `temperature` defaults to
   * TEMPERATURE (1 is the plain Bayesian posterior). Returns {grid, p, used, skipped}. */
  function posterior(observations, prior, temperature) {
    var t = temperature || TEMPERATURE;
    var logp = (prior || uniformPrior()).map(function (q) { return q > 0 ? Math.log(q) : -Infinity; });
    var used = 0, skipped = 0;
    observations.forEach(function (o) {
      var list = anchorsOf(o.pos);
      if (!list) { skipped++; return; }
      used++;
      GRID.forEach(function (r, i) { logp[i] += Math.log(probAt(list, o.uci, r)) / t; });
    });
    var top = Math.max.apply(null, logp);
    var w = logp.map(function (v) { return Math.exp(v - top); });
    var total = w.reduce(function (a, b) { return a + b; }, 0);
    return { grid: GRID, p: w.map(function (v) { return v / total; }), used: used, skipped: skipped };
  }

  /* Mean, standard deviation, median and the narrowest run of grid points holding `mass` of the posterior. */
  function summary(post, mass) {
    mass = mass || 0.8;
    var g = post.grid, p = post.p, mean = 0, i, j, acc;
    for (i = 0; i < g.length; i++) mean += g[i] * p[i];
    var v = 0;
    for (i = 0; i < g.length; i++) v += p[i] * (g[i] - mean) * (g[i] - mean);
    var cum = 0, median = g[g.length - 1];
    for (i = 0; i < g.length; i++) { cum += p[i]; if (cum >= 0.5) { median = g[i]; break; } }
    var best = null;
    for (i = 0; i < g.length; i++) {
      acc = 0;
      for (j = i; j < g.length; j++) {
        acc += p[j];
        if (acc >= mass - 1e-9) {
          if (best === null || j - i < best.hi - best.lo || (j - i === best.hi - best.lo && acc > best.acc)) best = { lo: i, hi: j, acc: acc };
          break;
        }
      }
    }
    return { mean: mean, sd: Math.sqrt(v), median: median, lo: g[best.lo], hi: g[best.hi], mass: mass };
  }

  /* Mutual information, in bits, between the move chosen in `pos` and the rating, with the rating distributed as `post`.
   * The outcomes are the listed moves plus one "anything else" outcome. 0 when the position has no anchors. */
  function information(pos, post) {
    var list = anchorsOf(pos);
    if (!list) return 0;
    var moves = {};
    list.forEach(function (a) { Object.keys(a.probs).forEach(function (m) { moves[m] = true; }); });
    var names = Object.keys(moves);
    var dist = post.grid.map(function (r) {
      var row = names.map(function (m) { return probAt(list, m, r); });
      var listed = row.reduce(function (a, b) { return a + b; }, 0);
      row.push(Math.max(0, 1 - listed)); // everything the position does not list
      var s = row.reduce(function (a, b) { return a + b; }, 0);
      return row.map(function (x) { return x / s; });
    });
    var k = names.length + 1, marginal = [], j, i, bits = 0;
    for (j = 0; j < k; j++) {
      var m = 0;
      for (i = 0; i < post.grid.length; i++) m += post.p[i] * dist[i][j];
      marginal.push(m);
    }
    for (i = 0; i < post.grid.length; i++) {
      for (j = 0; j < k; j++) {
        var q = dist[i][j];
        if (q > 0 && post.p[i] > 0) bits += post.p[i] * q * Math.log(q / marginal[j]) / Math.LN2;
      }
    }
    return Math.max(0, bits);
  }

  /* The position, among `candidates`, expected to tell you most about the rating now. To keep the choice from being the
   * same few positions every time, one is drawn at random from the best `pool` (default 5). `rng` returns [0, 1).
   * Returns {pos, bits} or null when no candidate carries anchors. */
  function suggest(candidates, post, rng, pool) {
    var scored = candidates.map(function (p) { return { pos: p, bits: information(p, post) }; })
      .filter(function (s) { return s.bits > 0; }).sort(function (a, b) { return b.bits - a.bits; });
    if (!scored.length) return null;
    var top = scored.slice(0, Math.max(1, pool || 5));
    return top[Math.floor((rng || Math.random)() * top.length)];
  }

  return { GRID: GRID, FLOOR: FLOOR, TEMPERATURE: TEMPERATURE, anchorsOf: anchorsOf, moveProb: moveProb, bestProb: bestProb, matchPick: matchPick, BANDS: BANDS, posterior: posterior, summary: summary, information: information, suggest: suggest };
}));
