'use strict';
/* The evaluation tool's own helpers: a wrong sampler or a biased synthetic player would make its numbers meaningless. */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../tools/level_eval.js');
const L = require('../level.js');

const BY = { 1000: { a: 0.2, b: 0.7 }, 1600: { a: 0.5, b: 0.4 }, 2200: { a: 0.9, b: 0.05 } };
const mk = (id, elo, real, by = BY) => ({ id, player_elo: elo, real, maia: { by_elo: by } });

test('the random generator is reproducible and uniform enough', () => {
  const a = E.rng(5), b = E.rng(5), xs = Array.from({ length: 2000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.ok(Math.abs(xs.reduce((s, x) => s + x, 0) / xs.length - 0.5) < 0.03);
  assert.notEqual(E.rng(6)(), E.rng(5)());
});

test('sample draws n distinct items and leaves the input alone', () => {
  const list = Array.from({ length: 30 }, (_, i) => i), copy = list.slice();
  const s = E.sample(list, 10, E.rng(1));
  assert.equal(new Set(s).size, 10); assert.deepEqual(list, copy);
  assert.ok(s.every((x) => list.includes(x)));
});

test('a synthetic player moves with the model\'s own probabilities, including the unlisted remainder', () => {
  const pos = mk('x', 1600, 'a'), rand = E.rng(3), counts = {};
  for (let i = 0; i < 20000; i++) { const m = E.drawMove(pos, 1600, rand); counts[m] = (counts[m] || 0) + 1; }
  const f = (m) => (counts[m] || 0) / 20000;
  assert.ok(Math.abs(f('a') - 0.5) < 0.02 && Math.abs(f('b') - 0.4) < 0.02 && Math.abs(f('__other__') - 0.1) < 0.02, JSON.stringify(counts));
  const high = Array.from({ length: 5000 }, () => E.drawMove(pos, 2200, rand)).filter((m) => m === 'a').length / 5000;
  assert.ok(high > 0.85, 'a stronger player plays the strong move more');
});

test('interpolation error is zero for a model that is exactly log-linear, and positive otherwise', () => {
  const exact = { by_elo: { 1000: { a: 0.2 }, 2000: { a: 0.8 } }, exact: { 1500: { a: 0.4 } } }; // sqrt(0.2 * 0.8) = 0.4
  const r0 = E.interpolation([exact]);
  assert.equal(r0.moves, 1); assert.ok(r0.max_abs_error < 1e-4 && r0.p95_log_ratio < 1e-3);
  const off = E.interpolation([{ ...exact, exact: { 1500: { a: 0.6 } } }]);
  assert.ok(off.max_abs_error > 0.19 && off.median_log_ratio > 0.3);
  assert.equal(E.interpolation([{ by_elo: exact.by_elo, exact: { 1500: { a: 0.005 } } }]).moves, 0, 'small probabilities are not compared');
});

test('realPlayers and selection produce well-formed rows on a small synthetic dataset', () => {
  const positions = [];
  for (let i = 0; i < 400; i++) { const elo = 1300 + (i % 7) * 100; positions.push(mk('p' + i, elo + (i % 3 - 1) * 10, elo > 1600 ? 'a' : 'b')); }
  const rows = E.realPlayers(positions, E.rng(2), 1);
  assert.ok(rows.length > 0);
  rows.forEach((r) => {
    assert.ok(r.coverage >= 0 && r.coverage <= 100 && r.mae >= 0 && r.width >= 0 && r.pool >= r.n * 3 && r.temperature === 1);
  });
  const hi = rows.find((r) => r.rating === 1900 && r.n === 10), lo = rows.find((r) => r.rating === 1300 && r.n === 10);
  assert.ok(hi && lo && (1900 + hi.bias) > (1300 + lo.bias) + 200, 'players who choose the strong move are estimated higher (estimate = truth + bias)');
  assert.equal(E.realPlayers(positions.slice(0, 20), E.rng(2)).length, 0, 'too few positions per rating: no rows rather than noise');
  const sel = E.selection(positions, E.rng(4));
  assert.equal(sel.length, 12, '3 ratings x 4 checkpoints');
  sel.forEach((r) => assert.ok(r.random_sd > 0 && r.adaptive_sd > 0 && r.n >= 5));
});
