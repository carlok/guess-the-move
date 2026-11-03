'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../level.js');

const pos = (by) => ({ id: 'x', maia: { elo: 1500, probs: {}, by_elo: Object.fromEntries(Object.entries(by).map(([r, d]) => [String(r), d])) } });
/* Higher ratings play "best" more often; "swing" is the move a weak player makes. */
const HARD = pos({ 1000: { best: 0.2, swing: 0.7, other: 0.05 }, 1600: { best: 0.5, swing: 0.4, other: 0.05 }, 2200: { best: 0.9, swing: 0.05, other: 0.03 } });
/* Everyone agrees: carries no information. */
const SAME = pos({ 1000: { best: 0.9, odd: 0.05 }, 1600: { best: 0.9, odd: 0.05 }, 2200: { best: 0.9, odd: 0.05 } });
const sum = (a) => a.reduce((x, y) => x + y, 0);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('the grid runs 1000 to 2200 in steps of 50', () => {
  assert.equal(L.GRID[0], 1000); assert.equal(L.GRID[L.GRID.length - 1], 2200); assert.equal(L.GRID.length, 25);
});

test('anchorsOf: sorted, and null unless there are at least two', () => {
  assert.deepEqual(L.anchorsOf(HARD).map((a) => a.r), [1000, 1600, 2200]);
  assert.equal(L.anchorsOf(pos({ 1500: { a: 1 } })), null);
  assert.equal(L.anchorsOf({ maia: { probs: {} } }), null);
  assert.equal(L.anchorsOf({ maia: null }), null);
  assert.equal(L.anchorsOf(null), null);
  assert.equal(L.anchorsOf(pos({ 1000: { a: 1 }, nope: { a: 1 }, 2000: { a: 1 } })).length, 2, 'a non-numeric anchor key is ignored');
});

test('moveProb: exact at an anchor, geometric-mean halfway, clamped outside, floored when unlisted, null without anchors', () => {
  close(L.moveProb(HARD, 'best', 1000), 0.2); close(L.moveProb(HARD, 'best', 2200), 0.9);
  close(L.moveProb(HARD, 'best', 1300), Math.sqrt(0.2 * 0.5));
  close(L.moveProb(HARD, 'best', 500), 0.2, 1e-12); close(L.moveProb(HARD, 'best', 3000), 0.9, 1e-12);
  close(L.moveProb(HARD, 'never-listed', 1500), L.FLOOR, 1e-12);
  close(L.moveProb(pos({ 1000: { a: 0.0001 }, 2000: { a: 0 } }), 'a', 1500), L.FLOOR, 1e-12); // tiny listed values are floored too
  assert.equal(L.moveProb({ maia: null }, 'best', 1500), null);
  close(L.moveProb(HARD, 'best', 1600), 0.5);
});

test('with no guesses the posterior is the prior (uniform by default) and always sums to one', () => {
  const p = L.posterior([]);
  assert.equal(p.used, 0); close(sum(p.p), 1);
  assert.ok(p.p.every((v) => Math.abs(v - 1 / 25) < 1e-12));
  const lopsided = L.GRID.map((r) => (r < 1500 ? 2 : 1)); const norm = sum(lopsided);
  const q = L.posterior([], lopsided.map((v) => v / norm));
  assert.ok(q.p[0] > q.p[24], 'a prior is respected');
  const z = L.posterior([], L.GRID.map((r) => (r === 1500 ? 1 : 0)));
  close(z.p[L.GRID.indexOf(1500)], 1, 1e-12);
});

test('choosing the strong move pulls the estimate up, the weak move pulls it down', () => {
  const up = L.summary(L.posterior([{ pos: HARD, uci: 'best' }])), down = L.summary(L.posterior([{ pos: HARD, uci: 'swing' }]));
  assert.ok(up.mean > 1600 && down.mean < 1600, `${down.mean} < 1600 < ${up.mean}`);
  assert.ok(up.mean - down.mean > 150, 'tempering shrinks one guess\'s effect, but the direction and a clear gap remain');
});

test('a position every rating plays alike changes nothing; skipped positions are counted; order does not matter', () => {
  const a = L.posterior([{ pos: HARD, uci: 'best' }]);
  const b = L.posterior([{ pos: SAME, uci: 'best' }, { pos: HARD, uci: 'best' }, { pos: SAME, uci: 'odd' }]);
  a.p.forEach((v, i) => close(v, b.p[i], 1e-12));
  const c = L.posterior([{ pos: { maia: null }, uci: 'x' }, { pos: HARD, uci: 'best' }]);
  assert.equal(c.used, 1); assert.equal(c.skipped, 1);
  const d1 = L.posterior([{ pos: HARD, uci: 'best' }, { pos: HARD, uci: 'swing' }]), d2 = L.posterior([{ pos: HARD, uci: 'swing' }, { pos: HARD, uci: 'best' }]);
  d1.p.forEach((v, i) => close(v, d2.p[i], 1e-12));
});

test('more guesses from a player of known strength concentrate the posterior near it, and never underflow', () => {
  const at = (r, n) => Array.from({ length: n }, (_, i) => ({ pos: HARD, uci: i % 2 === 0 ? 'best' : 'swing' }));
  const few = L.summary(L.posterior(at(1600, 2))), many = L.summary(L.posterior(at(1600, 400)));
  assert.ok(many.sd < few.sd / 3, `${many.sd} < ${few.sd}/3`);
  assert.ok(Math.abs(many.mean - 1600) < 120, 'half best and half swing is what 1600 does here');
  const huge = L.posterior(Array.from({ length: 5000 }, () => ({ pos: HARD, uci: 'swing' })));
  close(sum(huge.p), 1, 1e-9); assert.ok(huge.p.every(Number.isFinite));
});

test('tempering widens the posterior without moving its centre: temperature 1 is plain Bayes, the default is 1.5', () => {
  const obs = Array.from({ length: 12 }, (_, i) => ({ pos: HARD, uci: i % 3 ? 'best' : 'swing' }));
  const plain = L.summary(L.posterior(obs, undefined, 1)), tempered = L.summary(L.posterior(obs)), same = L.summary(L.posterior(obs, undefined, L.TEMPERATURE));
  assert.equal(L.TEMPERATURE, 1.5);
  assert.deepEqual(tempered, same);
  assert.ok(tempered.sd > plain.sd * 1.1, `${tempered.sd} vs ${plain.sd}`);
  assert.ok(Math.abs(tempered.median - plain.median) <= 100, 'about the same centre');
  // plain Bayes by hand for one guess: p(r) proportional to p(move | r) on the grid
  const one = L.posterior([{ pos: HARD, uci: 'best' }], undefined, 1), raw = L.GRID.map((r) => L.moveProb(HARD, 'best', r)), total = sum(raw);
  one.p.forEach((v, i) => close(v, raw[i] / total, 1e-12));
});

test('summary: a point mass, a uniform posterior, and the narrowest interval', () => {
  const at = (pairs) => ({ grid: L.GRID, p: L.GRID.map((r) => pairs[r] || 0) });
  const s = L.summary(at({ 1500: 1 }));
  assert.deepEqual([s.mean, s.median, s.lo, s.hi, s.sd], [1500, 1500, 1500, 1500, 0]);
  const flat = L.summary(L.posterior([]));
  close(flat.mean, 1600, 1e-9);
  assert.equal(flat.hi - flat.lo, 950, '20 of the 25 grid points hold 80%');
  const skew = L.summary(at({ 1300: 0.5, 1350: 0.35, 2000: 0.15 }));
  assert.deepEqual([skew.lo, skew.hi], [1300, 1350], 'the narrowest run holding 80%, not a symmetric one around the mean');
  const spread = L.summary(at({ 1300: 0.5, 1700: 0.3, 2000: 0.2 }));
  assert.deepEqual([spread.lo, spread.hi], [1300, 1700]);
  assert.equal(spread.mass, 0.8); assert.equal(L.summary(at({ 1300: 1 }), 0.5).mass, 0.5);
  assert.equal(spread.median, 1300, 'the median is where the cumulative mass first reaches half');
  assert.equal(L.summary(at({ 1300: 0.4, 1700: 0.6 })).median, 1700);
});

test('information: zero without anchors or when ratings agree, positive when they differ, ordered by how much they differ', () => {
  const post = L.posterior([]);
  assert.equal(L.information({ maia: null }, post), 0);
  assert.ok(L.information(SAME, post) < 1e-9, 'everyone plays alike');
  const bits = L.information(HARD, post);
  assert.ok(bits > 0.05 && bits < Math.log2(25));
  const MILD = pos({ 1000: { best: 0.45, swing: 0.5, other: 0.05 }, 1600: { best: 0.5, swing: 0.45, other: 0.05 }, 2200: { best: 0.55, swing: 0.4, other: 0.05 } });
  assert.ok(L.information(MILD, post) < bits, 'a mild difference teaches less');
  const sure = { grid: L.GRID, p: L.GRID.map((r) => (r === 1600 ? 1 : 0)) };
  assert.ok(L.information(HARD, sure) < 1e-9, 'when the rating is already known, a move tells nothing new');
});

test('suggest: the most informative position (or one of the best few), nothing when none teaches anything', () => {
  const post = L.posterior([]);
  const MILD = pos({ 1000: { best: 0.45, swing: 0.5 }, 2200: { best: 0.55, swing: 0.4 } });
  assert.equal(L.suggest([SAME, MILD, HARD], post, () => 0, 1).pos, HARD);
  assert.equal(L.suggest([SAME, MILD, HARD], post, () => 0.99, 2).pos, MILD, 'the draw is among the best `pool`');
  assert.equal(L.suggest([SAME, { maia: null }], post), null);
  assert.equal(L.suggest([], post), null);
  assert.ok(L.suggest([HARD, MILD], post).bits > 0, 'defaults work without an rng');
  const afterSure = L.posterior(Array.from({ length: 60 }, () => ({ pos: HARD, uci: 'best' })));
  assert.ok(L.information(HARD, afterSure) < L.information(HARD, post), 'what a position can still teach shrinks as the estimate firms up');
});
