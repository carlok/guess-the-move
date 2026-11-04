// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../stats.js');
const CH = require('../statscharts.js');
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
  assert.match(CH.html([], T), /class="empty"/);
  const h = [];
  for (let i = 0; i < 12; i++) h.push(g(i, { score: 40 + i * 4, cost: i, phase: ['opening', 'middlegame', 'endgame'][i % 3], mb: i % 3 === 0, mr: i % 4 === 0, mm: i % 2 === 0, dur: 8 + i * 3 }));
  for (let i = 0; i < 4; i++) h.push(g(30 + i, { mode: 'predict', score: 60 + i, mr: i === 0, dur: 20 }));
  const html = CH.html(h, T);
  assert.equal((html.match(/<svg class="chart"/g) || []).length, 6, 'quality, closeness, cost, phase, agreement, time');
  assert.equal((html.match(/<div class="kpi">/g) || []).length, 9, 'seven numbers, the streak and the best streak');
  assert.match(html, /Move quality over time/); assert.match(html, /Closeness to the real move over time/);
  assert.match(html, /Your first 5 averaged 4[0-9], your last 5 averaged/);
  assert.match(html, /Guesses taking \d+:\d\d or less averaged/);
  assert.match(html, /role="img" aria-label="Move quality, 0 to 100, for each of your last 12 guesses/);
  assert.doesNotMatch(html, /style=/, 'no inline style (CSP)');
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('html: too little data shows what is needed instead of a chart; one phase asks for more variety; one dot is centred', () => {
  const one = CH.html([g(1)], T);
  assert.match(one, /Needs at least 3 guesses in &quot;Find the best move&quot; mode/);
  assert.match(one, /Play positions from other phases/);
  assert.equal((one.match(/<svg class="chart"/g) || []).length, 3, 'cost, phase and agreement need only one guess');
  const three = CH.html([g(1), g(2, { phase: 'endgame' }), g(3, { mode: 'predict' })], T);
  assert.match(three, /Closeness to the real move over time/);
  assert.match(three, /Needs at least 3 guesses in &quot;Predict the real move&quot; mode/);
  const line = CH.html([g(1), g(2), g(3)], T);
  assert.match(line, /<polyline class="ch-line c-best"/);
});

test('html: a history with no matches known leaves the agreement chart out and shows dashes', () => {
  const html = CH.html([g(1, { mb: null, mr: null, mm: null, mode: 'predict', dur: undefined })], T);
  assert.doesNotMatch(html, /Who you agree with/);
  assert.match(html, /<dd>—<\/dd>/);
});

test('html draws charts at the requested width, within 300 to 640, and uses a narrower label column on a phone', () => {
  const h = Array.from({ length: 12 }, (_, i) => g(i, { score: 40 + i * 4, cost: i }));
  const widths = (html) => (html.match(/<svg class="chart" viewBox="0 0 (\d+) /g) || []).map((m) => Number(m.match(/0 0 (\d+)/)[1]));
  assert.ok(widths(CH.html(h, T)).every((w) => w === 640), 'default width');
  assert.ok(widths(CH.html(h, T, { width: 350 })).every((w) => w === 350));
  assert.ok(widths(CH.html(h, T, { width: 100 })).every((w) => w === 300), 'floor');
  assert.ok(widths(CH.html(h, T, { width: 2000 })).every((w) => w === 640), 'ceiling');
  assert.match(CH.html(h, T, { width: 350 }), /class="ch-track" x="112"/);
  assert.match(CH.html(h, T, { width: 600 }), /class="ch-track" x="150"/);
});

test('the tier order in stats.js is the classifier\'s, and the tier card counts best-move guesses only', () => {
  assert.deepEqual(ST.TIER_ORDER, require('../classify.js').TIERS);
  const h = [g(1, { tier: 'best' }), g(2, { tier: 'best' }), g(3, { tier: 'blunder' }), g(4, { tier: 'excellent' }), g(5, { tier: 'best', mode: 'predict' }), g(6)];
  const s = ST.summarize(h);
  assert.equal(s.tiered, 4); assert.deepEqual(s.tiers.map((t) => t.n), [0, 0, 2, 1, 0, 0, 0, 1]);
  const html = CH.html(h, T);
  assert.match(html, /Your moves by tier/); assert.match(html, /75% of your 4 best-move guesses were Excellent or better/);
  assert.match(html, /class="ch-bar t-best"/);
  assert.doesNotMatch(CH.html([g(1)], T), /Your moves by tier/, 'no tiers recorded: no card');
});

test('streaks: the current run of Excellent-or-better best-mode guesses and the longest one; predict mode is ignored; old guesses use their cost', () => {
  const ok = (over = {}) => g(1, { tier: 'excellent', ...over }), bad = () => g(2, { tier: 'mistake' });
  assert.deepEqual(ST.streaks([]), { current: 0, best: 0 }); assert.deepEqual(ST.streaks(undefined), { current: 0, best: 0 });
  assert.deepEqual(ST.streaks([ok(), ok(), ok(), bad(), ok(), ok()]), { current: 2, best: 3 });
  assert.deepEqual(ST.streaks([ok(), bad()]), { current: 0, best: 1 });
  assert.deepEqual(ST.streaks([ok(), ok({ mode: 'predict', tier: 'blunder' }), ok()]), { current: 2, best: 2 }, 'predict guesses neither extend nor break it');
  assert.deepEqual(ST.streaks([g(1, { tier: undefined, cost: 1.9 }), g(2, { tier: undefined, cost: 2.5 })]), { current: 0, best: 1 }, 'no tier: cost <= 2 is good');
  assert.deepEqual(ST.streaks([g(1, { tier: 'good' })]), { current: 0, best: 0 }, 'Good is not enough');
  assert.equal(ST.summarize([ok(), ok()]).streak, 2); assert.equal(ST.summarize([ok(), bad(), ok()]).bestStreak, 1);
});

test('todayCount counts the guesses made on the same local calendar day', () => {
  const at = (y, m, d, h) => new Date(y, m, d, h).getTime();
  const h = [g(1, { t: at(2026, 10, 3, 23) }), g(2, { t: at(2026, 10, 4, 0) }), g(3, { t: at(2026, 10, 4, 12) }), g(4, { t: at(2026, 10, 4, 23) }), g(5, { t: at(2026, 10, 5, 0) })];
  assert.equal(ST.todayCount(h, at(2026, 10, 4, 15)), 3);
  assert.equal(ST.todayCount([], Date.now()), 0); assert.equal(ST.todayCount(undefined, 0), 0);
});

test('the stats page adds today (with the goal) when it is told the time, and not otherwise', () => {
  const t = at => new Date(2026, 10, 4, at).getTime();
  const h = [g(1, { t: t(9) }), g(2, { t: t(10) })];
  assert.match(CH.html(h, T, { now: t(12), goal: 10 }), /<dt>Today<\/dt><dd>2\/10<\/dd>/);
  assert.match(CH.html(h, T, { now: t(12), goal: 0 }), /<dt>Today<\/dt><dd>2<\/dd>/);
  assert.doesNotMatch(CH.html(h, T), /<dt>Today/);
});
