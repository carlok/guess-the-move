'use strict';
/* DOM-level tests with jsdom. The fixtures below are SYNTHETIC (hand-written evals) and exist only to
 * exercise UI logic; they are not chess data and are never shipped. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { newDom, loadApp } = require('./harness');

const ROOK = {
  id: 'rook', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ply: 0, move_no: 1, stm: 'w', phase: 'endgame',
  player_elo: 1500, opp_elo: 1500, real: 'g1g2',
  evals: { a1a8: 9999, a1a7: 300, g1g2: 0, g1f1: -5 },
  san: { a1a8: 'Ra8#', a1a7: 'Ra7', g1g2: 'Kg2', g1f1: 'Kf1' },
  maia: { elo: 1500, probs: { g1g2: 0.5, g1f1: 0.3, a1a7: 0.2 } }, tags: ['real_mistake', 'hard_find'], site: null
};
const PROMO = {
  id: 'promo', fen: '8/P7/8/8/8/8/k6K/8 w - - 0 1', ply: 40, move_no: 21, stm: 'w', phase: 'middlegame',
  player_elo: null, opp_elo: null, real: 'a7a8q',
  evals: { a7a8q: 900, a7a8r: 500, a7a8b: 200, a7a8n: 200, h2h3: 0 },
  san: { a7a8q: 'a8=Q', a7a8r: 'a8=R', a7a8b: 'a8=B', a7a8n: 'a8=N', h2h3: 'Kh3' },
  maia: null, tags: ['real_is_best'], site: null
};
const BLACK = {
  id: 'black', fen: '6k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', ply: 41, move_no: 22, stm: 'b', phase: 'opening',
  player_elo: null, opp_elo: null, real: 'g8f8', evals: { g8f8: 0, h7h6: 10 }, san: { g8f8: 'Kf8', h7h6: 'h6' },
  maia: null, tags: [], site: null
};
const EVIL = {
  id: 'evil', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ply: 0, move_no: 1, stm: 'w', phase: 'endgame', player_elo: null, opp_elo: null,
  real: 'g1g2', evals: { g1g2: 0, g1f1: -5 }, san: { g1g2: '<b id="pwn">Kg2</b>', g1f1: 'Kf1' }, maia: null, tags: [], site: null
};
const dataOf = (...positions) => ({ schema: 1, meta: { demo: false }, positions });

async function boot(data, { brokenStorage = false, fetchImpl } = {}) {
  const dom = newDom();
  const w = dom.window;
  if (brokenStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('storage denied'); } });
  w.fetch = fetchImpl || (async () => ({ ok: true, json: async () => data }));
  w.Math.random = () => 0; // deterministic pick: first matching position
  loadApp(dom);
  await tick();
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 25));
const click = (w, sq) => w.document.querySelector(`[data-sq="${sq}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const setSelect = async (w, id, value) => {
  const el = w.document.getElementById(id);
  if (el.type === 'checkbox') el.checked = value; else el.value = value;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick();
};
const $ = (w, id) => w.document.getElementById(id);

test('best-move flow: select, move, reveal table, stats, storage', async () => {
  const w = await boot(dataOf(ROOK));
  assert.match($(w, 'posInfo').textContent, /White to move.*endgame.*~1500/);
  click(w, 'a1');
  assert.ok(w.document.querySelector('.sel'), 'selected square is highlighted');
  assert.equal(w.document.querySelectorAll('.dot, .ring').length, 2, 'two legal targets from a1');
  click(w, 'a8');
  assert.equal($(w, 'result').hidden, false);
  assert.match($(w, 'result').textContent, /Move quality:\s*100\/100/);
  assert.equal($(w, 'result').querySelectorAll('tbody tr').length, 4);
  assert.match($(w, 'result').textContent, /Maia 1500/);
  assert.match($(w, 'result').textContent, /Real player 1500/);
  assert.equal($(w, 'next').hidden, false);
  assert.ok(w.document.querySelectorAll('line').length >= 3, 'arrows are drawn');
  assert.match($(w, 'stats').textContent, /Guesses\s*1/);
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.history')).length, 1);
  click(w, 'a7'); // board is locked after the reveal
  assert.equal(w.document.querySelector('.sel'), null);
});

test('a wrong guess is costed and ranked; predict mode reports closeness', async () => {
  const w = await boot(dataOf(ROOK));
  await setSelect(w, 'unseen', false);
  click(w, 'g1'); click(w, 'f1');
  const text = $(w, 'result').textContent;
  assert.match(text, /ranks 4 of 4/);
  const G = require('../scoring.js');
  const expected = (G.winPct(ROOK.evals.a1a8) - G.winPct(ROOK.evals.g1f1)).toFixed(1); // 48.0
  assert.ok(text.includes(`lost ${expected} win-% points`), `expected "lost ${expected}" in: ${text}`);

  const w2 = await boot(dataOf(ROOK));
  w2.document.querySelector('input[value=predict]').checked = true;
  w2.document.querySelector('input[value=predict]').dispatchEvent(new w2.Event('change', { bubbles: true }));
  click(w2, 'g1'); click(w2, 'g2');
  assert.match($(w2, 'result').textContent, /Exact match with the real move/);
});

test('promotion shows a chooser and scores the chosen piece; null Maia is handled', async () => {
  const w = await boot(dataOf(PROMO));
  click(w, 'a7'); click(w, 'a8');
  assert.equal($(w, 'promo').hidden, false);
  assert.equal($(w, 'promo').querySelectorAll('button').length, 4);
  assert.equal($(w, 'result').hidden, true, 'nothing is committed before the piece is chosen');
  $(w, 'promo').querySelector('[data-uci=a7a8n]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($(w, 'result').hidden, false);
  assert.match($(w, 'result').textContent, /a8=N/);
  assert.equal($(w, 'result').querySelectorAll('tbody tr').length, 3); // you, Stockfish, real - no Maia row
  assert.match($(w, 'result').textContent, /No human-model data/);
  assert.equal($(w, 'promo').hidden, true);
});

test('board is oriented from the side to move', async () => {
  const white = await boot(dataOf(ROOK));
  const wa1 = white.document.querySelector('[data-sq=a1]');
  assert.deepEqual([wa1.getAttribute('x'), wa1.getAttribute('y')], ['0', '700']);
  const black = await boot(dataOf(BLACK));
  const ba1 = black.document.querySelector('[data-sq=a1]');
  assert.deepEqual([ba1.getAttribute('x'), ba1.getAttribute('y')], ['700', '0']);
});

test('filters narrow the pool and empty results explain themselves', async () => {
  const w = await boot(dataOf(ROOK, PROMO));
  assert.match($(w, 'matchCount').textContent, /^2 positions/);
  await setSelect(w, 'phase', 'middlegame');
  assert.match($(w, 'matchCount').textContent, /^1 position match/);
  assert.match($(w, 'posInfo').textContent, /move 21/);
  await setSelect(w, 'phase', 'opening');
  assert.match($(w, 'prompt').textContent, /No unseen positions match/);
  await setSelect(w, 'phase', 'any');
  await setSelect(w, 'tag', 'hard_find');
  assert.match($(w, 'posInfo').textContent, /move 1 /);
});

test('hostile text in the data is escaped, not executed', async () => {
  const w = await boot(dataOf(EVIL));
  click(w, 'g1'); click(w, 'g2');
  assert.equal(w.document.getElementById('pwn'), null);
  assert.match($(w, 'result').textContent, /<b id="pwn">Kg2<\/b>/);
});

test('works with localStorage unavailable', async () => {
  const w = await boot(dataOf(ROOK), { brokenStorage: true });
  click(w, 'a1'); click(w, 'a8');
  assert.match($(w, 'result').textContent, /Move quality/);
});

test('bad or missing data shows a helpful message', async () => {
  const w = await boot(null, { fetchImpl: async () => ({ ok: true, json: async () => ({ schema: 2, positions: [] }) }) });
  assert.match($(w, 'prompt').textContent, /Could not load.*schema 1/s);
  const w2 = await boot(null, { fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.match($(w2, 'prompt').textContent, /HTTP 404/);
});

test('demo banner appears for demo datasets', async () => {
  const d = dataOf(ROOK); d.meta.demo = true;
  const w = await boot(d);
  assert.equal($(w, 'banner').hidden, false);
  assert.match($(w, 'banner').textContent, /Demo data/);
});
