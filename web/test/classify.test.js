'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../classify.js');
const G = require('../scoring.js');
const B = require('../board.js');
const V = require('../../tests/attack_vectors.json');

/* A cp for the second move such that it costs `cost` win-% points against `best` cp (bisection on the shared win% curve). */
function cpForCost(best, cost) {
  let lo = -1000, hi = best;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (G.winPct(best) - G.winPct(mid) > cost) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
const posOf = (fen, evals, san = {}) => ({ fen, evals, san });
const FREE = '4k3/8/3p4/8/8/2N5/8/4K3 w - - 0 1';        // Ne5 walks into the d6 pawn, nothing defends it
const DEFENDED = '4k3/8/3p4/8/3P4/2N5/8/4K3 w - - 0 1';  // the same, but d4 defends e5

test('the tier thresholds are the documented ones (a Python test ties them to pipeline/tags.py)', () => {
  assert.deepEqual([C.BEST_EPS, C.EXCELLENT_DROP, C.GOOD_DROP, C.INACCURACY_DROP, C.MISTAKE_DROP, C.BLUNDER_DROP, C.ONLY_MOVE_GAP], [0.1, 2, 5, 5, 10, 20, 15]);
  assert.deepEqual(C.TIERS, ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']);
});

test('tierOf draws the boundaries at 0.1, 2, 5, 10 and 20 win-% points (lower bound inclusive for the worse tier)', () => {
  const at = (c) => C.tierOf(c);
  assert.deepEqual([0, 0.09].map(at), ['best', 'best']);
  assert.deepEqual([0.1, 2].map(at), ['excellent', 'excellent']);
  assert.deepEqual([2.01, 4.99].map(at), ['good', 'good']);
  assert.deepEqual([5, 9.99].map(at), ['inaccuracy', 'inaccuracy']);
  assert.deepEqual([10, 19.99].map(at), ['mistake', 'mistake']);
  assert.deepEqual([20, 99].map(at), ['blunder', 'blunder']);
});

test('attackers agrees with python-chess on every square of 68 positions (tests/attack_vectors.json)', () => {
  let checked = 0;
  for (const c of V.cases) {
    const board = B.parseFen(c.fen).board;
    for (const [color, table] of Object.entries(c.attackers)) {
      for (let sq = 0; sq < 64; sq++) {
        const got = C.attackers(board, sq, color).map(B.sqName).sort();
        assert.deepEqual(got, table[B.sqName(sq)] || [], `${c.fen} ${color} ${B.sqName(sq)}`);
        checked++;
      }
    }
  }
  assert.equal(checked, V.cases.length * 128);
});

test('exchange: a lone attacker wins the piece, a defender makes it a trade, cheapest attackers go first, a king cannot capture into cover', () => {
  assert.equal(C.exchange(3, [1], []), 3);          // a pawn takes a knight, no recapture
  assert.equal(C.exchange(3, [1], [1]), 2);         // ... and is recaptured: a knight for a pawn
  assert.equal(C.exchange(1, [3], [1]), 0);         // a knight will not take a defended pawn: stand pat
  assert.equal(C.exchange(3, [100], [1]), 0);       // a king cannot take a defended piece
  assert.equal(C.exchange(3, [100], []), 3);
  assert.equal(C.exchange(9, [5, 9], [5]), 9, 'rook takes queen; the recapture would lose the rook to the queen, so it is not made');
  assert.equal(C.exchange(5, [], [1]), 0, 'nothing attacks: nothing is lost');
});

test('isSacrifice: a minor piece left to a free capture is one; defended, traded, king moves, promotions and captures that pay are not', () => {
  assert.equal(C.isSacrifice(FREE, 'c3e5'), true);
  assert.equal(C.isSacrifice(DEFENDED, 'c3e5'), false, 'a knight for a pawn is not enough');
  assert.equal(C.isSacrifice(FREE, 'e1d1'), false, 'a king move');
  assert.equal(C.isSacrifice(FREE, 'c3b5'), false, 'nothing attacks b5');
  assert.equal(C.isSacrifice('8/P7/8/8/8/8/k6K/8 w - - 0 1', 'a7a8q'), false, 'promotions are excluded');
  assert.equal(C.isSacrifice('4k3/8/8/3n4/8/2N5/8/4K3 w - - 0 1', 'c3d5'), false, 'an even trade of knights');
  assert.equal(C.isSacrifice('4k3/8/8/8/8/2N5/8/4K3 w - - 0 1', 'c3d5'), false, 'a safe square');
  assert.equal(C.isSacrifice('4k3/8/5p2/8/8/8/1B6/4K3 w - - 0 1', 'b2e5'), true, 'a bishop walks into the f6 pawn');
  assert.equal(C.isSacrifice('4k3/8/5p2/4p3/8/8/1B6/4K3 w - - 0 1', 'b2e5'), true, 'a bishop for a pawn: the capture does not pay for it');
  assert.equal(C.isSacrifice('4k3/8/5p2/4n3/8/8/1B6/4K3 w - - 0 1', 'b2e5'), false, 'a bishop for a knight is a trade');
});

test('isGreat: only the best move, and only when the second best costs at least 15 win-% points', () => {
  const gap = (c) => ({ a: 200, b: cpForCost(200, c), c: -900 });
  assert.equal(C.isGreat(gap(15.5), 'a'), true);
  assert.equal(C.isGreat(gap(14), 'a'), false, 'a second move that is nearly as good');
  assert.equal(C.isGreat(gap(30), 'b'), false, 'not the best move');
  assert.equal(C.isGreat({ a: 100 }, 'a'), false, 'a single legal move');
  assert.equal(C.isGreat({ a: 100, b: 100, c: -900 }, 'a'), false, 'a tie for best');
});

test('isBrilliant: a best-or-nearly-best sacrifice, not already won, not lost afterwards; every condition matters', () => {
  const ev = (best, rest = -300) => ({ c3e5: best, c3b5: rest, e1d1: rest });
  assert.equal(C.isBrilliant(posOf(FREE, ev(60)), 'c3e5'), true, 'balanced position, the knight walks into a pawn and it is best');
  assert.equal(C.isBrilliant(posOf(FREE, ev(900)), 'c3e5'), false, 'already clearly winning');
  assert.equal(C.isBrilliant(posOf(FREE, ev(-80)), 'c3e5'), false, 'still worse afterwards');
  assert.equal(C.isBrilliant(posOf(FREE, { c3e5: cpForCost(60, 3), c3b5: 60 }), 'c3e5'), false, 'a sacrifice that is not near the best move');
  assert.equal(C.isBrilliant(posOf(FREE, { c3e5: 60, c3b5: 59 }), 'c3b5'), false, 'a best-ish move that is no sacrifice');
  assert.equal(C.isBrilliant(posOf(DEFENDED, ev(60)), 'c3e5'), false, 'defended: a trade, not a sacrifice');
  assert.equal(C.isBrilliant(posOf('4k3/8/8/8/8/2N5/4r3/4K3 w - - 0 1', { c3e2: 100, e1e2: 90 }), 'c3e2'), false, 'answering a check is never brilliant');
});

test('classifyAll gives every legal move a tier from its cost and its rank; the best is Best, or Great when nothing else comes close', () => {
  const costs = [0, 1, 3, 7, 15, 30];
  const evals = {}; costs.forEach((c, i) => { evals['m' + i] = cpForCost(100, c); }); evals.m0 = 100;
  const all = C.classifyAll(posOf(chessFen(), evals));
  assert.deepEqual(Object.keys(all).map((m) => all[m].tier), ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']);
  assert.equal(all.m0.rank, 1); assert.ok(all.m5.rank === 6);
  assert.ok(Math.abs(all.m3.cost - 7) < 1e-6);
  const plain = C.classifyAll(posOf(chessFen(), { m0: 100, m1: cpForCost(100, 3), m2: cpForCost(100, 4) }));
  assert.equal(plain.m0.tier, 'best', 'no wide gap to the second move: Best, not Great');
  const wide = C.classifyAll(posOf(chessFen(), { m0: 100, m1: cpForCost(100, 20), m2: cpForCost(100, 40) }));
  assert.deepEqual([wide.m0.tier, wide.m1.tier, wide.m2.tier], ['great', 'blunder', 'blunder']);
});

test('classifyAll marks a Brilliant move in a real sacrifice position, and leaves the others alone', () => {
  const all = C.classifyAll(posOf(FREE, { c3e5: 60, c3b5: -140, e1d1: -400 }));
  assert.equal(all.c3e5.tier, 'brilliant');
  assert.equal(all.c3b5.tier, 'mistake');
});

test('summary counts the moves per tier, finds yours, and says what share of the other moves it beats', () => {
  const pos = posOf(chessFen(), { m0: 100, m1: cpForCost(100, 1), m2: cpForCost(100, 3), m3: cpForCost(100, 25) });
  const s = C.summary(pos, 'm2');
  assert.equal(s.n, 4); assert.equal(s.yours.tier, 'good');
  assert.deepEqual(s.counts, { brilliant: 0, great: 0, best: 1, excellent: 1, good: 1, inaccuracy: 0, mistake: 0, blunder: 1 });
  assert.equal(s.betterThan, 33, 'beats one of the three other moves');
  assert.equal(C.summary(pos, 'm0').betterThan, 100); assert.equal(C.summary(pos, 'm3').betterThan, 0);
  assert.equal(C.summary(posOf(chessFen(), { m0: 5 }), 'm0').betterThan, 100, 'a single legal move');
});

function chessFen() { return '4k3/8/8/8/8/8/8/4K3 w - - 0 1'; }
