// SPDX-License-Identifier: AGPL-3.0-or-later
/* Scoring maths for Guess-the-Move. Must stay numerically identical to pipeline/winpct.py
 * (tests/vectors.json is checked by both test suites).
 *
 * Win%      = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)          (Lichess)
 * Accuracy% = 103.1668 * exp(-0.04354 * drop) - 3.1669                  (Lichess)
 * cp is clamped to +-1000 first (this project's choice).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CP_CLAMP = 1000;

  function winPct(cp) {
    var c = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  }

  function accuracyFromDrop(drop) {
    var d = Math.max(0, drop);
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * d) - 3.1669));
  }

  function bestMove(evals) {
    var best = null;
    for (var m in evals) if (best === null || evals[m] > evals[best]) best = m;
    return best;
  }

  function cost(evals, move) { return winPct(evals[bestMove(evals)]) - winPct(evals[move]); }
  function distance(evals, a, b) { return Math.abs(winPct(evals[a]) - winPct(evals[b])); }
  function similarity(evals, a, b) { return accuracyFromDrop(distance(evals, a, b)); }

  /* Competition rank: ties share the better rank. */
  function rank(evals, move) {
    var r = 1;
    for (var k in evals) if (evals[k] > evals[move]) r++;
    return r;
  }

  function maiaTop(pos) {
    if (!pos.maia || !pos.maia.probs) return null;
    var top = null, probs = pos.maia.probs;
    for (var m in probs) if (top === null || probs[m] > probs[top]) top = m;
    return top;
  }

  function plausibility(pos, move) {
    if (!pos.maia || !pos.maia.probs) return null;
    return pos.maia.probs[move] || 0;
  }

  /* Everything the reveal needs for one guess. */
  function analyse(pos, guess, mode) {
    var evals = pos.evals;
    var best = bestMove(evals);
    var mTop = maiaTop(pos);

    function ref(key, uci) {
      return {
        key: key, uci: uci, san: pos.san[uci] || uci,
        cost: cost(evals, uci), plaus: plausibility(pos, uci), rank: rank(evals, uci),
        distance: distance(evals, guess, uci), similarity: similarity(evals, guess, uci),
        same: uci === guess
      };
    }

    var refs = [ref('best', best)];
    if (pos.real) refs.push(ref('real', pos.real));  // an arbitrary position (from the api) has no real move
    if (mTop) refs.push(ref('maia', mTop));

    var c = cost(evals, guess);
    var you = {
      uci: guess, san: pos.san[guess] || guess, cost: c, quality: accuracyFromDrop(c),
      rank: rank(evals, guess), n: Object.keys(evals).length, plaus: plausibility(pos, guess)
    };
    var exactReal = guess === pos.real;
    var score = mode === 'predict' && pos.real ? (exactReal ? 100 : refs[1].similarity) : you.quality;

    return {
      mode: mode, you: you, refs: refs, score: score,
      matched: { best: evals[guess] === evals[best], real: exactReal, maia: mTop ? guess === mTop : null }
    };
  }

  return {
    winPct: winPct, accuracyFromDrop: accuracyFromDrop, bestMove: bestMove, cost: cost,
    distance: distance, similarity: similarity, rank: rank, maiaTop: maiaTop,
    plausibility: plausibility, analyse: analyse
  };
}));
