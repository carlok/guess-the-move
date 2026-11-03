'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../stats.js');
const T = require('../strings.js');

const g = (i, over = {}) => ({ id: 'p' + i, mode: 'best', phase: 'opening', cost: 1, score: 80, mb: false, mr: false, mm: false, t: i, dur: 10 + i, ...over });

test('clock formats seconds as m:ss, rounding and clamping', () => {
  assert.equal(ST.clock(0), '0:00'); assert.equal(ST.clock(65), '1:05'); assert.equal(ST.clock(599.6), '10:00');
  assert.equal(ST.clock(-4), '0:00'); assert.equal(ST.clock(3725), '62:05');
});

test('median and moving average', () => {
  assert.equal(ST.median([]), null); assert.equal(ST.median([5, 1, 3]), 3); assert.equal(ST.median([4, 1, 3, 2]), 2.5);
  assert.deepEqual(ST.movingAverage([10, 20, 30, 40], 2), [10, 15, 25, 35]);
});

test('summarize: modes, matches, time, cost buckets, phases, and the fast/slow split', () => {
  const h = [];
  for (let i = 0; i < 8; i++) h.push(g(i, { cost: [0, 0.4, 1, 3, 7, 15, 30, 1][i], score: 50 + i * 5, dur: i < 4 ? 5 : 60, phase: ['opening', 'middlegame', 'endgame'][i % 3], mb: i % 2 === 0, mr: i < 2, mm: i === 7 ? null : i < 3 }));
  h.push(g(20, { mode: 'predict', score: 90, cost: 2, dur: undefined, mr: true, mb: null, mm: null }));
  const s = ST.summarize(h);
  assert.equal(s.n, 9); assert.equal(s.nBest, 8); assert.equal(s.nPredict, 1);
  assert.equal(s.meanBest, (50 + 55 + 60 + 65 + 70 + 75 + 80 + 85) / 8); assert.equal(s.meanPredict, 90);
  assert.equal(s.found, 100 * 4 / 8, 'mb counted where known');
  // costs 0, 0.4 | 1, 1 | 3 | 7 | 15 | 30 against the edges 0.5, 2, 5, 10, 20
  assert.deepEqual(s.costBuckets, [2, 2, 1, 1, 1, 1]);
  assert.deepEqual(s.phases.map((p) => [p.phase, p.n]), [['opening', 3], ['middlegame', 3], ['endgame', 2]]);
  assert.equal(s.medianTime, 32.5);
  assert.deepEqual([s.split.fast, s.split.slow], [57.5, 77.5]);
  assert.equal(s.split.at, 32.5);
});

test('summarize copes with nothing, with old entries without time, and with a single time value', () => {
  const none = ST.summarize([]);
  assert.equal(none.n, 0); assert.equal(none.meanBest, null); assert.equal(none.found, null); assert.equal(none.medianTime, null);
  assert.equal(ST.summarize(undefined).n, 0);
  const old = ST.summarize([g(1, { dur: undefined }), g(2, { dur: undefined })]);
  assert.equal(old.timedBest.length, 0); assert.equal(old.split, null);
  const same = ST.summarize([1, 2, 3, 4, 5, 6].map((i) => g(i, { dur: 30 })));
  assert.equal(same.split, null, 'no split when every guess took the same time');
});

test('html: empty history says so; a rich history draws tiles and every chart; text is escaped', () => {
  assert.match(ST.html([], T), /class="empty"/);
  const h = [];
  for (let i = 0; i < 12; i++) h.push(g(i, { score: 40 + i * 4, cost: i, phase: ['opening', 'middlegame', 'endgame'][i % 3], mb: i % 3 === 0, mr: i % 4 === 0, mm: i % 2 === 0, dur: 8 + i * 3 }));
  for (let i = 0; i < 4; i++) h.push(g(30 + i, { mode: 'predict', score: 60 + i, mr: i === 0, dur: 20 }));
  const html = ST.html(h, T);
  assert.equal((html.match(/<svg class="chart"/g) || []).length, 6, 'quality, closeness, cost, phase, agreement, time');
  assert.equal((html.match(/<div class="kpi">/g) || []).length, 7);
  assert.match(html, /Move quality over time/); assert.match(html, /Closeness to the real move over time/);
  assert.match(html, /Your first 5 averaged 4[0-9], your last 5 averaged/);
  assert.match(html, /Guesses taking \d+:\d\d or less averaged/);
  assert.match(html, /role="img" aria-label="Move quality, 0 to 100, for each of your last 12 guesses/);
  assert.doesNotMatch(html, /style=/, 'no inline style (CSP)');
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('html: too little data shows what is needed instead of a chart; one phase asks for more variety; one dot is centred', () => {
  const one = ST.html([g(1)], T);
  assert.match(one, /Needs at least 3 guesses in &quot;Find the best move&quot; mode/);
  assert.match(one, /Play positions from other phases/);
  assert.equal((one.match(/<svg class="chart"/g) || []).length, 3, 'cost, phase and agreement need only one guess');
  const three = ST.html([g(1), g(2, { phase: 'endgame' }), g(3, { mode: 'predict' })], T);
  assert.match(three, /Closeness to the real move over time/);
  assert.match(three, /Needs at least 3 guesses in &quot;Predict the real move&quot; mode/);
  const line = ST.html([g(1), g(2), g(3)], T);
  assert.match(line, /<polyline class="ch-line c-best"/);
});

test('html: a history with no matches known leaves the agreement chart out and shows dashes', () => {
  const html = ST.html([g(1, { mb: null, mr: null, mm: null, mode: 'predict', dur: undefined })], T);
  assert.doesNotMatch(html, /Who you agree with/);
  assert.match(html, /<dd>—<\/dd>/);
});

test('html draws charts at the requested width, within 300 to 640, and uses a narrower label column on a phone', () => {
  const h = Array.from({ length: 12 }, (_, i) => g(i, { score: 40 + i * 4, cost: i }));
  const widths = (html) => (html.match(/<svg class="chart" viewBox="0 0 (\d+) /g) || []).map((m) => Number(m.match(/0 0 (\d+)/)[1]));
  assert.ok(widths(ST.html(h, T)).every((w) => w === 640), 'default width');
  assert.ok(widths(ST.html(h, T, { width: 350 })).every((w) => w === 350));
  assert.ok(widths(ST.html(h, T, { width: 100 })).every((w) => w === 300), 'floor');
  assert.ok(widths(ST.html(h, T, { width: 2000 })).every((w) => w === 640), 'ceiling');
  assert.match(ST.html(h, T, { width: 350 }), /class="ch-track" x="112"/);
  assert.match(ST.html(h, T, { width: 600 }), /class="ch-track" x="150"/);
});
