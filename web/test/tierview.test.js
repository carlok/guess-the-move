// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../tierview.js');
const C = require('../classify.js');
const T = require('../strings.js');
const G = require('../scoring.js');

const cpForCost = (best, cost) => { let lo = -1000, hi = best; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (G.winPct(best) - G.winPct(m) > cost) lo = m; else hi = m; } return (lo + hi) / 2; };
const pos = { fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', evals: { a: 100, b: cpForCost(100, 1), c: cpForCost(100, 3), d: cpForCost(100, 7), e: cpForCost(100, 15), f: cpForCost(100, 30), g: cpForCost(100, 40) },
  san: { a: 'Ka', b: 'Kb', c: 'Kc', d: 'Kd', e: 'Ke', f: 'Kf', g: '<b>' } };
const sum = C.summary(pos, 'd');

test('every tier has a name, a symbol, a description and its own colour class and glyph', () => {
  const glyphs = new Set();
  C.TIERS.forEach((t) => {
    assert.ok(T.tiers[t].name && T.tiers[t].sym && T.tiers[t].desc, t);
    const html = V.badge(t, T);
    assert.match(html, new RegExp(`class="tier tier-${t}"`)); assert.ok(html.includes(T.tiers[t].name));
    glyphs.add(V.icon(t, T).replace(/class="[^"]*"/g, ''));
  });
  assert.equal(glyphs.size, 8, 'no two tiers share a glyph');
  assert.match(V.icon('best', T), /<path/); assert.match(V.icon('blunder', T), /<text[^>]*>\?\?<\/text>/);
});

test('a compact badge keeps the name for screen readers only; titles carry the description', () => {
  const c = V.badge('mistake', T, true);
  assert.match(c, /compact/); assert.match(c, /<span class="sr-only">Mistake<\/span>/); assert.doesNotMatch(c, /tier-name/);
  assert.match(c, /title="Gives up 10 to 20 win-% points\."/);
});

test('the bar has one slot per legal move, grouped best tier first, yours marked, and says the same thing in words', () => {
  const html = V.bar(sum, T, 'd');
  const widths = [...html.matchAll(/class="tier-seg tier-(\w+)"[^>]*width="([\d.]+)"/g)];
  assert.deepEqual(widths.map((m) => m[1]), ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'], 'best tier first');
  assert.ok(Math.abs(widths.reduce((s, m) => s + Number(m[2]), 0) - 600) < 0.6, 'the segments fill the bar');
  assert.match(html, /role="img" aria-label="The 7 legal moves by tier: .*Yours is inaccuracy, better than \d+% of the others\./);
  assert.match(V.list(pos, sum, { d: ['you', 'real', 'maia'] }, T), /<span class="ml-marks">(<b class="mark[^]*?){3}<\/span>/, 'all role marks share one cell');
  assert.match(V.list(pos, sum, {}, T), /<svg class="tier-icon tier-best"/, 'the list icon carries its own tier class, so it has its colour');
  assert.match(html, /class="tier-you"/); assert.match(html, /class="tier-pin"/);
  assert.equal((html.match(/<li>/g) || []).length, widths.length, 'a key entry per tier present');
});

test('the marker sits on the slot of your move', () => {
  const order = V.ordered(sum.all), at = order.indexOf('d');
  const x = Number(V.bar(sum, T, 'd').match(/class="tier-you" x="([\d.]+)"/)[1]);
  assert.ok(Math.abs(x - at * (600 / 7)) < 0.2);
  const first = Number(V.bar(sum, T, order[0]).match(/class="tier-you" x="([\d.]+)"/)[1]);
  assert.equal(first, 0);
});

test('ordered puts the best tier first and ties by cost', () => {
  const o = V.ordered(sum.all);
  assert.equal(o[0], 'a'); assert.equal(o[o.length - 1], 'g');
  assert.deepEqual(o.map((m) => sum.all[m].cost), o.map((m) => sum.all[m].cost).slice().sort((a, b) => a - b));
});

test('the list has a button per legal move with rank, tier, cost and the roles that chose it; moves are escaped', () => {
  const html = V.list(pos, sum, { a: ['best'], d: ['you', 'real'] }, T);
  assert.equal((html.match(/<button type="button" class="ml-row"/g) || []).length, 7);
  assert.match(html, /<summary>All 7 legal moves, best to worst<\/summary>/);
  assert.match(html, /data-uci="d"[^>]*aria-pressed="false"/);
  assert.match(html, /<b class="mark mark-you" title="Your move"><span aria-hidden="true">Y<\/span><span class="sr-only">Your move<\/span><\/b>/);
  assert.doesNotMatch(html, /<b>/, 'a SAN string with markup is escaped, not rendered');
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /<span class="ml-cost">7\.0<\/span>/);
  const rows = [...html.matchAll(/data-uci="(\w)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, V.ordered(sum.all), 'listed best to worst');
});
