'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../scoring.js');
const V = require('../../tests/vectors.json');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

test('win% and accuracy match the shared vectors (parity with pipeline/winpct.py)', () => {
  V.win_pct.forEach(([cp, want]) => near(G.winPct(cp), want));
  V.accuracy.forEach(([drop, want]) => near(G.accuracyFromDrop(drop), want));
});

test('cost, distance and similarity match the shared vectors', () => {
  Object.entries(V.cost).forEach(([m, want]) => near(G.cost(V.evals, m), want));
  V.pairs.forEach((c) => {
    near(G.distance(V.evals, c.a, c.b), c.distance);
    near(G.similarity(V.evals, c.a, c.b), c.similarity);
  });
});

test('seeded random vectors match (parity with pipeline/winpct.py)', () => {
  V.random_win_pct.forEach(([cp, want]) => near(G.winPct(cp), want));
  V.random_accuracy.forEach(([drop, want]) => near(G.accuracyFromDrop(drop), want));
  V.random_cases.forEach((c) => {
    near(G.cost(c.evals, c.a), c.cost_a);
    near(G.distance(c.evals, c.a, c.b), c.distance);
    near(G.similarity(c.evals, c.a, c.b), c.similarity);
  });
});

test('published Lichess anchors', () => {
  near(G.accuracyFromDrop(10), 64, 0.5);
  near(G.accuracyFromDrop(20), 40, 0.5);
  near(G.winPct(20), 51.8, 0.1);
  near(G.winPct(-40), 46.3, 0.1);
});

const pos = {
  id: 'x', real: 'g1f1',
  evals: { a1a8: 9999, a1a7: 300, g1g2: 0, g1f1: -5 },
  san: { a1a8: 'Ra8#', a1a7: 'Ra7', g1g2: 'Kg2', g1f1: 'Kf1' },
  maia: { elo: 1500, probs: { g1g2: 0.5, g1f1: 0.3, a1a7: 0.2 } }
};

test('analyse: best move in best-move mode', () => {
  const r = G.analyse(pos, 'a1a8', 'best');
  assert.equal(r.you.cost, 0);
  near(r.you.quality, 100, 1e-3);
  assert.equal(r.you.rank, 1);
  assert.deepEqual(r.refs.map((x) => x.key), ['best', 'real', 'maia']);
  assert.deepEqual(r.matched, { best: true, real: false, maia: false });
  assert.equal(r.refs[2].uci, 'g1g2'); // Maia's top move
  near(r.score, r.you.quality);
});

test('analyse: a worse move is ranked and costed', () => {
  const r = G.analyse(pos, 'g1g2', 'best');
  assert.deepEqual(r.matched, { best: false, real: false, maia: true }, 'g1g2 is Maia\'s top move but not the best');
  assert.equal(r.you.rank, 3);
  near(r.you.cost, G.winPct(9999) - G.winPct(0));
  assert.equal(r.you.plaus, 0.5);
});

test('analyse: predict mode scores exact match 100, otherwise closeness to the real move', () => {
  const hit = G.analyse(pos, 'g1f1', 'predict');
  assert.equal(hit.score, 100);
  assert.equal(hit.matched.real, true);
  const miss = G.analyse(pos, 'a1a8', 'predict');
  near(miss.score, G.similarity(pos.evals, 'a1a8', 'g1f1'));
  assert.ok(miss.score > 0 && miss.score < 15); // mate-in-one vs a quiet king move: ~48 win-% apart, ~9/100 close
});

test('analyse: no human-model data', () => {
  const r = G.analyse({ ...pos, maia: null }, 'g1g2', 'best');
  assert.deepEqual(r.refs.map((x) => x.key), ['best', 'real']);
  assert.equal(r.you.plaus, null);
  assert.equal(r.matched.maia, null);
});

test('ties share a rank and count as matching the best evaluation', () => {
  const p = { real: 'a', evals: { a: 10, b: 10, c: -50 }, san: {}, maia: null };
  assert.equal(G.rank(p.evals, 'b'), 1);
  assert.equal(G.rank(p.evals, 'c'), 3);
  assert.equal(G.analyse(p, 'b', 'best').matched.best, true);
});

test('reference moves know whether they are the guess, and fall back to UCI when SAN is missing', () => {
  const r = G.analyse(pos, 'a1a8', 'best');
  assert.deepEqual(r.refs.map((x) => x.same), [true, false, false]);
  assert.deepEqual(r.refs.map((x) => x.san), ['Ra8#', 'Kf1', 'Kg2']);
  const bare = G.analyse({ ...pos, san: {} }, 'a1a7', 'best');
  assert.equal(bare.you.san, 'a1a7');
  assert.equal(bare.refs[0].san, 'a1a8');
});

test('ties: the first listed move is the best move and the first listed Maia move is Maia\'s top', () => {
  assert.equal(G.bestMove({ a: 10, b: 10, c: -5 }), 'a');
  assert.equal(G.maiaTop({ maia: { probs: { a: 0.3, b: 0.3, c: 0.2 } } }), 'a');
});

test('Maia\'s top move is the most probable one wherever it sits in the list', () => {
  assert.equal(G.maiaTop({ maia: { probs: { a: 0.1, b: 0.6, c: 0.3 } } }), 'b');
  assert.equal(G.maiaTop({ maia: null }), null);
  assert.equal(G.maiaTop({ maia: { elo: 1500 } }), null);
});

test('a position without a real move (an arbitrary FEN) has no real reference and is scored as best-move', () => {
  const p = { real: null, evals: { a: 0, b: -100 }, san: { a: 'a', b: 'b' }, maia: null };
  const r = G.analyse(p, 'b', 'predict');
  assert.deepEqual(r.refs.map((x) => x.key), ['best']);
  assert.equal(r.matched.real, false);
  near(r.score, r.you.quality);
});
