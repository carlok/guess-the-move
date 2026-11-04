'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../srs.js');

test('a mistake (10+ win-% points) enters box 1, due after 5 more positions; smaller slips do not enter', () => {
  const q = S.update({}, 10, 'a', 10);
  assert.deepEqual(q, { a: { box: 1, due: 15, ok: 0 } });
  assert.deepEqual(S.update({}, 10, 'a', 9.99), {});
  assert.deepEqual(S.update({}, 10, 'a', 0), {});
  assert.deepEqual(S.update({}, 10, 'a', 55), { a: { box: 1, due: 15, ok: 0 } });
});

test('good retries climb the boxes (5, 15, 40 positions) and graduate after four in a row', () => {
  let q = S.update({}, 0, 'a', 30);                    // box 1, due 5
  q = S.update(q, 6, 'a', 1);   assert.deepEqual(q.a, { box: 2, due: 21, ok: 1 });
  q = S.update(q, 22, 'a', 4.9); assert.deepEqual(q.a, { box: 3, due: 62, ok: 2 });
  q = S.update(q, 63, 'a', 0);  assert.deepEqual(q.a, { box: 3, due: 103, ok: 3 }, 'box 3 is the top');
  q = S.update(q, 104, 'a', 0); assert.deepEqual(q, {}, 'the fourth good retry graduates it');
});

test('an inaccuracy waits the same time again, a new mistake starts over, and an unqueued position is left alone', () => {
  let q = S.update({}, 0, 'a', 30);
  q = S.update(q, 6, 'a', 1);                            // box 2
  const slip = S.update(q, 22, 'a', 7);
  assert.deepEqual(slip.a, { box: 2, due: 37, ok: 1 }, 'same box, due after another 15');
  const again = S.update(q, 22, 'a', 12);
  assert.deepEqual(again.a, { box: 1, due: 27, ok: 0 });
  assert.deepEqual(S.update({ b: { box: 1, due: 1, ok: 0 } }, 3, 'a', 1), { b: { box: 1, due: 1, ok: 0 } });
});

test('update does not change its input', () => {
  const q = { a: { box: 1, due: 5, ok: 0 } }, snapshot = JSON.stringify(q);
  S.update(q, 6, 'a', 0); S.update(q, 6, 'b', 30); S.update(q, 6, 'a', 50);
  assert.equal(JSON.stringify(q), snapshot);
});

test('due lists what is due now, longest overdue first, with ids as the tie-break; queue lists everything by due date', () => {
  const q = { c: { box: 1, due: 9, ok: 0 }, a: { box: 1, due: 4, ok: 0 }, b: { box: 2, due: 4, ok: 1 }, d: { box: 3, due: 50, ok: 0 } };
  assert.deepEqual(S.due(q, 10), ['a', 'b', 'c']);
  assert.deepEqual(S.due(q, 3), []);
  assert.deepEqual(S.queue(q), ['a', 'b', 'c', 'd']);
  assert.deepEqual(S.summary(q, 10), { total: 4, due: 3 });
  assert.deepEqual(S.summary({}, 0), { total: 0, due: 0 });
});

test('sanitize keeps only valid entries; merge keeps the one that is further along', () => {
  const dirty = { a: { box: 1, due: 5, ok: 0 }, b: { box: 4, due: 5, ok: 0 }, c: { box: 1, due: -1, ok: 0 }, d: { box: 1, due: 'x', ok: 0 }, e: { box: 1, due: 1, ok: 4 }, f: null, ['g'.repeat(65)]: { box: 1, due: 1, ok: 0 }, h: { box: 1.5, due: 1, ok: 0 }, i: { box: 2, due: 7, ok: 3, extra: 1 } };
  assert.deepEqual(S.sanitize(dirty), { a: { box: 1, due: 5, ok: 0 }, i: { box: 2, due: 7, ok: 3 } });
  assert.deepEqual(S.sanitize(null), {}); assert.deepEqual(S.sanitize('x'), {});
  const big = {}; for (let i = 0; i < 5100; i++) big['p' + i] = { box: 1, due: 1, ok: 0 };
  assert.equal(Object.keys(S.sanitize(big)).length, 5000);
  const m = S.merge({ a: { box: 1, due: 5, ok: 0 }, b: { box: 2, due: 9, ok: 2 } }, { a: { box: 2, due: 20, ok: 1 }, b: { box: 1, due: 6, ok: 0 }, c: { box: 1, due: 3, ok: 0 } });
  assert.deepEqual(m, { a: { box: 2, due: 20, ok: 1 }, b: { box: 2, due: 9, ok: 2 }, c: { box: 1, due: 3, ok: 0 } });
});
