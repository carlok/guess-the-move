// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SD = require('../seed.js');

const mk = (id, moves = 5) => ({ id, evals: Object.fromEntries(Array.from({ length: moves }, (_, i) => ['m' + i, i])) });
const pool = Array.from({ length: 40 }, (_, i) => mk(('0000000000' + (i * 7919).toString(16)).slice(-10)));

test('hash32 is a stable 32-bit hash: same text, same number; different text, different number', () => {
  assert.equal(SD.hash32('20261104'), SD.hash32('20261104'));
  assert.notEqual(SD.hash32('20261104'), SD.hash32('20261105'));
  assert.ok(SD.hash32('') >= 0 && SD.hash32('x'.repeat(500)) <= 0xffffffff);
  assert.equal(SD.hash32('abc'), 1792905582, 'pinned: a changed hash would change every shared challenge');
});

test('rng: a seeded generator that repeats its sequence and stays in [0, 1)', () => {
  const a = SD.rng(7), b = SD.rng(7), c = SD.rng(8);
  const xs = Array.from({ length: 50 }, () => a()), ys = Array.from({ length: 50 }, () => b());
  assert.deepEqual(xs, ys);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs, Array.from({ length: 50 }, () => c()));
});

test('todayToken is the local calendar date as eight digits, label turns it back into a date', () => {
  assert.equal(SD.todayToken(new Date(2026, 10, 4, 23, 59, 59).getTime()), '20261104');
  assert.equal(SD.todayToken(new Date(2026, 0, 2, 0, 0, 1).getTime()), '20260102');
  assert.equal(SD.label('20261104'), '2026-11-04'); assert.equal(SD.label('abc12'), 'abc12');
  assert.equal(SD.isDaily('20261104'), true); assert.equal(SD.isDaily('abc12'), false);
});

test('select: the same token gives the same positions whatever the order of the data; another token gives another set', () => {
  const a = SD.select(pool, '20261104', 5), b = SD.select(pool.slice().reverse(), '20261104', 5), c = SD.select(pool, '20261105', 5);
  assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
  assert.notDeepEqual(a.map((p) => p.id), c.map((p) => p.id));
  assert.equal(new Set(a.map((p) => p.id)).size, 5, 'no position twice');
  assert.ok(a.every((p) => pool.includes(p)));
});

test('select leaves out positions with fewer than three legal moves and custom ones, and gives what there is when asked for too many', () => {
  const small = [mk('a', 2), { ...mk('b'), custom: true }, mk('c'), mk('d')];
  assert.deepEqual(SD.select(small, 'x1y2z3', 5).map((p) => p.id).sort(), ['c', 'd']);
  assert.deepEqual(SD.select([], 'x1y2z3', 5), []);
  assert.equal(SD.select(pool, '20261104', 0).length, 0);
});

test('the dataset tag changes with the build and the size, and is four hex digits', () => {
  const t = SD.tagOf({ built: '2026-11-03T15:57:07+00:00' }, 2000);
  assert.match(t, /^[0-9a-f]{4}$/);
  assert.equal(t, SD.tagOf({ built: '2026-11-03T15:57:07+00:00' }, 2000));
  assert.notEqual(t, SD.tagOf({ built: '2026-11-04T15:57:07+00:00' }, 2000));
  assert.notEqual(t, SD.tagOf({ built: '2026-11-03T15:57:07+00:00' }, 2001));
  assert.match(SD.tagOf(null, 3), /^[0-9a-f]{4}$/);
});

test('a challenge code is token.tag; parse accepts only that shape', () => {
  assert.equal(SD.code('20261104', 'ab12'), '20261104.ab12');
  assert.deepEqual(SD.parseCode('20261104.ab12'), { token: '20261104', tag: 'ab12' });
  assert.deepEqual(SD.parseCode('k3j9x.0000'), { token: 'k3j9x', tag: '0000' });
  ['', 'ab.ab12', '20261104', '20261104.ab1', '20261104.AB12', 'a b c.ab12', '../x.ab12', null, undefined, '20261104.ab12.ab12', 'x'.repeat(17) + '.ab12'].forEach((s) => assert.equal(SD.parseCode(s), null, String(s)));
});

test('newToken makes a short lowercase code from a random source', () => {
  assert.match(SD.newToken(() => 0.5), /^[0-9a-z]{6}$/);
  assert.notEqual(SD.newToken(() => 0.1), SD.newToken(() => 0.9));
  assert.match(SD.newToken(), /^[0-9a-z]{6}$/);
});
