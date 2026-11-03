'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../backup.js');

const entry = (id, t, over = {}) => ({ id, mode: 'best', phase: 'opening', tags: ['only_move'], cost: 1.5, score: 80, mb: false, mr: true, mm: null, t, dur: 12, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', uci: 'a1a2', opp: 1500, ...over });

test('build wraps the history with the app name, format, time and dataset identity; the file name carries the date', () => {
  const now = Date.UTC(2026, 10, 4, 12, 0, 0);
  const b = B.build([entry('a', 1)], new Set(['a', 'b']), { built: '2026-11-03', source: 'x.pgn.zst', other: 1 }, now);
  assert.equal(b.app, 'guess-the-move'); assert.equal(b.format, 1); assert.equal(b.exported, '2026-11-04T12:00:00.000Z');
  assert.deepEqual(b.dataset, { built: '2026-11-03', source: 'x.pgn.zst' });
  assert.deepEqual(b.seen, ['a', 'b']);
  assert.equal(B.fileName(now), 'guess-the-move-stats-2026-11-04.json');
  assert.deepEqual(B.build([], new Set(), null, now).dataset, { built: null, source: null });
});

test('a built file parses back to the same guesses', () => {
  const h = [entry('a', 1), entry('b', 2, { mode: 'predict', dur: undefined, mb: null })];
  const r = B.parse(JSON.stringify(B.build(h, new Set(['a']), {}, 0)));
  assert.equal(r.ok, true); assert.equal(r.skipped, 0);
  assert.equal(r.history[0].dur, 12); assert.equal(r.history[1].dur, undefined);
  assert.deepEqual(r.history.map((e) => [e.id, e.mode, e.score, e.mr]), [['a', 'best', 80, true], ['b', 'predict', 80, true]]);
  assert.deepEqual(r.seen, ['a']);
});

test('refusals: not JSON, another app, another format, no history, too large', () => {
  assert.deepEqual(B.parse('{nope'), { ok: false, error: 'json' });
  assert.equal(B.parse('null').error, 'app');
  assert.equal(B.parse(JSON.stringify({ app: 'other', format: 1, history: [] })).error, 'app');
  assert.equal(B.parse(JSON.stringify({ app: 'guess-the-move', format: 2, history: [] })).error, 'format');
  assert.equal(B.parse(JSON.stringify({ app: 'guess-the-move', format: 1 })).error, 'empty');
  assert.equal(B.parse('x'.repeat(5 * 1024 * 1024 + 1)).error, 'size');
  assert.equal(B.parse(42).error, 'size');
});

test('entries are rebuilt from known fields: unknown keys dropped, bad types defaulted, unusable entries skipped and counted', () => {
  const evil = { ...entry('x', 5), __proto__: { polluted: 1 }, html: '<img src=x onerror=alert(1)>', phase: 'nope', cost: 'high', tags: ['ok', 7, 'y'.repeat(41)], mb: 'yes', t: 'now', dur: -3, uci: 'zz', extra: { a: 1 } };
  const file = { app: 'guess-the-move', format: 1, history: [evil, null, 'str', entry('y', 1, { mode: 'sudden' }), entry('z', 1, { score: NaN }), entry('i'.repeat(65), 1), entry('good', 9)], seen: ['a', 5, 'b'.repeat(65), 'c'] };
  const r = B.parse(JSON.stringify(file));
  assert.equal(r.ok, true);
  assert.equal(r.skipped, 5);
  const [e, g] = r.history;
  assert.deepEqual(Object.keys(e).sort(), ['cost', 'id', 'mb', 'mm', 'mode', 'mr', 'phase', 'score', 't', 'tags'].sort(), 'no html, no extra, no fen without a valid uci');
  assert.equal(e.phase, null); assert.equal(e.cost, null); assert.equal(e.mb, null); assert.equal(e.t, 0);
  assert.deepEqual(e.tags, ['ok']);
  assert.equal(g.id, 'good');
  assert.deepEqual(r.seen, ['a', 'c']);
  assert.equal(B.parse(JSON.stringify({ app: 'guess-the-move', format: 1, history: [] })).seen.length, 0);
  assert.equal(Object.prototype.polluted, undefined);
});

test('merge: union by position and time, oldest first, newest kept up to the cap, duplicates counted', () => {
  const cur = [entry('a', 1), entry('b', 3)];
  const inc = [entry('a', 1), entry('c', 2), entry('d', 4)];
  const m = B.merge(cur, inc, 3);
  assert.deepEqual(m.history.map((e) => e.id), ['c', 'b', 'd']);
  assert.equal(m.added, 2); assert.equal(m.duplicates, 1);
  assert.deepEqual(cur.map((e) => e.id), ['a', 'b'], 'the input is not changed');
  assert.deepEqual(B.merge([], [entry('q', 0, { t: undefined })].map(B.cleanEntry), 10).history.length, 1);
  assert.equal(B.merge([entry('a', 1)], [entry('a', 2)], 9).added, 1, 'the same position guessed again later is a new guess');
});
