// SPDX-License-Identifier: AGPL-3.0-or-later
/* Move tiers, relative to the position: Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Blunder.
 *
 * A move's tier comes from its cost (win-% points below the best move, GTM.cost), so the scale is relative by
 * construction: in a lost position the best move is still "Best". The cut-offs follow chess.com's expected-points
 * bands (0.02 / 0.05 / 0.10 / 0.20, here as 2 / 5 / 10 / 20 win-% points) and the 10 and 20 that the dataset's own
 * real_mistake / real_blunder tags use (tests/test_classify_thresholds.py keeps them equal to pipeline/tags.py).
 * Chess.com's real classification depends on the player's rating and is not reproduced; neither are Book and Miss.
 *
 * Great: the best move when the second best costs at least ONLY_MOVE_GAP (the dataset's only_move rule).
 * Brilliant: a best-or-nearly-best move (cost <= EXCELLENT_DROP) that is a real sacrifice, in a position that is not
 * already won (best win% <= 90) and not lost afterwards (eval >= 0). A sacrifice is a move that leaves a piece to an
 * exchange that costs at least a minor piece net of what the move itself captured. The exchange is the classic swap
 * list on the destination square: pins and x-rays are ignored, so it is an approximation, and the position's own
 * engine evals decide whether the sacrifice is any good. Criteria described publicly, implemented here independently.
 * Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./scoring.js'), require('./board.js'));
  else root.GTM_CLASSIFY = factory(root.GTM, root.GTM_BOARD);
}(typeof self !== 'undefined' ? self : this, function (G, B) {
  'use strict';

  var TIERS = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
  var BEST_EPS = 0.1, EXCELLENT_DROP = 2, GOOD_DROP = 5, INACCURACY_DROP = 5, MISTAKE_DROP = 10, BLUNDER_DROP = 20, ONLY_MOVE_GAP = 15;
  var WON_WIN_PCT = 90, SAC_LOST = 3, SAC_NET = 2;
  var VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  var KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]], BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  function tierOf(cost) {
    if (cost < BEST_EPS) return 'best';
    if (cost <= EXCELLENT_DROP) return 'excellent';
    if (cost < GOOD_DROP) return 'good';
    if (cost < MISTAKE_DROP) return 'inaccuracy';
    if (cost < BLUNDER_DROP) return 'mistake';
    return 'blunder';
  }

  function isColor(ch, color) { return !!ch && (color === 'w' ? ch === ch.toUpperCase() : ch === ch.toLowerCase()); }

  /* Squares (0..63, a1 = 0) of `color` pieces that attack `sq`, as the rules of attack say (no pins, no x-rays). */
  function attackers(board, sq, color) {
    var out = [], f = sq & 7, r = sq >> 3, i, t, df, dr, ch;
    function at(file, rank) { return file >= 0 && file < 8 && rank >= 0 && rank < 8 ? board[rank * 8 + file] : undefined; }
    var pawnRank = color === 'w' ? r - 1 : r + 1, pawn = color === 'w' ? 'P' : 'p';
    [f - 1, f + 1].forEach(function (pf) { if (at(pf, pawnRank) === pawn) out.push(pawnRank * 8 + pf); });
    var knight = color === 'w' ? 'N' : 'n', king = color === 'w' ? 'K' : 'k';
    KNIGHT.forEach(function (d) { if (at(f + d[0], r + d[1]) === knight) out.push((r + d[1]) * 8 + f + d[0]); });
    KING.forEach(function (d) { if (at(f + d[0], r + d[1]) === king) out.push((r + d[1]) * 8 + f + d[0]); });
    function ray(dirs, kinds) {
      for (i = 0; i < dirs.length; i++) {
        df = dirs[i][0]; dr = dirs[i][1];
        for (t = 1; t < 8; t++) {
          ch = at(f + df * t, r + dr * t);
          if (ch === undefined) break;
          if (ch !== null) { if (isColor(ch, color) && kinds.indexOf(ch.toLowerCase()) >= 0) out.push((r + dr * t) * 8 + f + df * t); break; }
        }
      }
    }
    ray(ROOK_DIRS, ['r', 'q']); ray(BISHOP_DIRS, ['b', 'q']);
    return out;
  }

  /* Best net gain, in pawns, for the side that captures first on a square holding a piece worth `occ`, given the values
   * of each side's attackers sorted cheapest first. Either side may stop capturing, so the result is never negative. */
  function exchange(occ, first, second) {
    if (!first.length) return 0;
    return Math.max(0, occ - exchange(first[0], second, first.slice(1)));
  }

  function values(board, list) { return list.map(function (s) { return VALUE[board[s].toLowerCase()]; }).sort(function (a, b) { return a - b; }); }

  /* Does `uci` leave a piece to an exchange that costs at least a minor piece net of what the move itself captures? */
  function isSacrifice(fen, uci) {
    var parsed = B.parseFen(fen), board = parsed.board, from = B.sqIndex(uci.slice(0, 2)), to = B.sqIndex(uci.slice(2, 4)), p = board[from];
    if (!p || uci.length === 5) return false; // no piece, or a promotion
    var type = p.toLowerCase(), color = p === p.toUpperCase() ? 'w' : 'b', opp = color === 'w' ? 'b' : 'w';
    if (type === 'k') return false;
    var kingAt = board.indexOf(color === 'w' ? 'K' : 'k');
    if (kingAt >= 0 && attackers(board, kingAt, opp).length) return false; // answering a check
    var enPassant = type === 'p' && (from & 7) !== (to & 7) && !board[to];
    var captured = enPassant ? 1 : (board[to] ? VALUE[board[to].toLowerCase()] : 0);
    var after = board.slice();
    after[from] = null; after[to] = p;
    if (enPassant) after[to + (color === 'w' ? -8 : 8)] = null;
    var lost = exchange(VALUE[type], values(after, attackers(after, to, opp)), values(after, attackers(after, to, color)));
    return lost >= SAC_LOST && lost - captured >= SAC_NET;
  }

  function orderedCps(evals) { return Object.keys(evals).map(function (m) { return evals[m]; }).sort(function (a, b) { return b - a; }); }

  /* The best move, when the second best (by eval) costs at least ONLY_MOVE_GAP. */
  function isGreat(evals, uci) {
    var cps = orderedCps(evals);
    return cps.length > 1 && evals[uci] === cps[0] && G.winPct(cps[0]) - G.winPct(cps[1]) >= ONLY_MOVE_GAP;
  }

  function isBrilliant(pos, uci) {
    var evals = pos.evals, best = orderedCps(evals)[0];
    return G.cost(evals, uci) <= EXCELLENT_DROP && evals[uci] >= 0 && G.winPct(best) <= WON_WIN_PCT && isSacrifice(pos.fen, uci);
  }

  /* {uci: {tier, cost, rank}} for every legal move of the position. */
  function classifyAll(pos) {
    var out = {};
    Object.keys(pos.evals).forEach(function (m) {
      var cost = G.cost(pos.evals, m), tier = tierOf(cost);
      if (cost <= EXCELLENT_DROP && isBrilliant(pos, m)) tier = 'brilliant';
      else if (cost < BEST_EPS && isGreat(pos.evals, m)) tier = 'great';
      out[m] = { tier: tier, cost: cost, rank: G.rank(pos.evals, m) };
    });
    return out;
  }

  /* How the position's moves split across the tiers, and where `uci` sits. betterThan: percent of the other legal moves it beats. */
  function summary(pos, uci) {
    var all = classifyAll(pos), moves = Object.keys(all), counts = {}, worse = 0;
    TIERS.forEach(function (t) { counts[t] = 0; });
    moves.forEach(function (m) { counts[all[m].tier]++; if (all[m].cost > all[uci].cost) worse++; });
    return { counts: counts, n: moves.length, yours: all[uci], all: all, betterThan: moves.length > 1 ? Math.round(100 * worse / (moves.length - 1)) : 100 };
  }

  return {
    TIERS: TIERS, BEST_EPS: BEST_EPS, EXCELLENT_DROP: EXCELLENT_DROP, GOOD_DROP: GOOD_DROP, INACCURACY_DROP: INACCURACY_DROP,
    MISTAKE_DROP: MISTAKE_DROP, BLUNDER_DROP: BLUNDER_DROP, ONLY_MOVE_GAP: ONLY_MOVE_GAP,
    tierOf: tierOf, attackers: attackers, exchange: exchange, isSacrifice: isSacrifice, isGreat: isGreat, isBrilliant: isBrilliant,
    classifyAll: classifyAll, summary: summary
  };
}));
