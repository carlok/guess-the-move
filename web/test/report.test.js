// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../report.js');
const T = require('../strings.js');

const row = (san, tier, cost, score, dur) => ({ san, uci: 'a1a2', tier, cost, score, dur });
const rows = [row('e4', 'best', 0, 100, 10), row('Nf3', 'good', 3, 80, 20), row('Qh5', 'blunder', 30, 10, 60), row('Bxf7+', 'brilliant', 0, 100, 30), row('<i>', 'mistake', 12, 50, 0)];

test('summarize: average quality, best moves found (Best, Great and Brilliant count), time, tiers and the weakest moves', () => {
  const s = R.summarize(rows);
  assert.equal(s.n, 5); assert.equal(s.quality, (100 + 80 + 10 + 100 + 50) / 5);
  assert.equal(s.found, 2); assert.equal(s.time, 120); assert.equal(s.avgTime, 24);
  assert.deepEqual(s.counts, { brilliant: 1, great: 0, best: 1, excellent: 0, good: 1, inaccuracy: 0, mistake: 1, blunder: 1 });
  assert.deepEqual(s.worst.map((x) => x.index), [2, 4], 'by cost, only moves that gave up 5 or more');
  const tie = R.summarize([row('a', 'blunder', 20, 5, 1), row('b', 'blunder', 20, 5, 1)]);
  assert.deepEqual(tie.worst.map((x) => x.index), [0, 1], 'ties keep session order');
  assert.equal(R.summarize(Array.from({ length: 6 }, (_, i) => row('m' + i, 'blunder', 20 + i, 5, 1))).worst.length, 3, 'at most three');
});

test('summarize copes with an empty session and with rows that have no time', () => {
  const s = R.summarize([]);
  assert.deepEqual([s.n, s.quality, s.found, s.time, s.avgTime, s.worst.length], [0, 0, 0, 0, 0, 0]);
  assert.equal(R.summarize([{ san: 'x', tier: 'best', cost: 0, score: 100 }]).time, 0);
});

test('html: the four numbers, the tiers present, a row per move with its tier, time and a review button; moves are escaped', () => {
  const html = R.html(rows, T, false);
  assert.match(html, /<dt>Average move quality<\/dt><dd>68<\/dd>/); assert.match(html, /<dt>Best move found<\/dt><dd>2\/5<\/dd>/);
  assert.match(html, /<dt>Time<\/dt><dd>2:00<\/dd>/); assert.match(html, /<dt>Per position<\/dt><dd>0:24<\/dd>/);
  assert.equal((html.match(/class="ml-row session-row"/g) || []).length, 5);
  assert.match(html, /data-index="2"/); assert.match(html, /<span class="ml-marks">1:00<\/span>/);
  assert.match(html, /The weakest were moves 3, 5\./);
  assert.doesNotMatch(html, /<i>/); assert.match(html, /&lt;i&gt;/);
  assert.doesNotMatch(html, /A shorter session/);
  assert.match(R.html(rows.slice(0, 1), T, true), /A shorter session: 1 position answered\./);
  assert.match(R.html([row('e4', 'best', 0, 100, 5)], T, false), /Nothing gave up 5 or more win-% points\./);
  assert.match(R.html([rows[2]], T, false), /The weakest were move 1\./);
});

test('text is a short summary with the tiers, and a link only when one is given', () => {
  const t = R.text(rows, T, 'https://example.org/app/');
  assert.match(t, /^Guess the Move, 5 positions: average move quality 68, best move found 2 of 5, 0:24 per position\. 1 brilliant, 1 best, 1 good, 1 mistake, 1 blunder\.\nhttps:\/\/example\.org\/app\/$/);
  assert.doesNotMatch(R.text(rows, T), /http/);
});

test('clock formats seconds as m:ss', () => {
  assert.deepEqual([0, 5, 65, 600, -3].map(R.clock), ['0:00', '0:05', '1:05', '10:00', '0:00']);
});

test('grid: one coloured square per move, by tier, in the order played', () => {
  assert.equal(R.grid(rows, T), '🟩🟨⬛🟦🟥');
  assert.equal(R.grid([], T), '');
  const every = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'].map((t) => row('x', t, 0, 0, 0));
  assert.equal(R.grid(every, T), '🟦🟦🟩🟩🟨🟧🟥⬛');
});

test('challengeText: the title, the squares, the numbers and the link; no move or position is named', () => {
  const t = R.challengeText(rows, T, 'Daily 2026-11-04', 'https://x.example/#c=20261104.ab12');
  assert.equal(t.split('\n').length, 4);
  assert.match(t, /^Guess the Move · Daily 2026-11-04\n🟩🟨⬛🟦🟥\nMove quality 68 · best move found 2\/5\nhttps:\/\/x\.example\/#c=20261104\.ab12$/);
  assert.doesNotMatch(t, /e4|Nf3|Qh5/);
  assert.equal(R.challengeText(rows, T, 'Challenge k3j9x').split('\n').length, 3, 'no link given: three lines');
});
