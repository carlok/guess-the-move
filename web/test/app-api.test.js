'use strict';
/* The optional api: feature detection, analysing any position, and the level estimate. The api itself is stubbed with
 * hand-written JSON (SYNTHETIC); the real service is exercised by tests/test_api.py and the container run. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { newDom, loadApp } = require('./harness');
const B = require('../board.js');

const ROOK = {
  id: 'rook', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ply: 0, move_no: 1, stm: 'w', phase: 'endgame',
  player_elo: 1500, opp_elo: 1400, real: 'g1g2',
  evals: { a1a8: 9999, a1a7: 300, g1g2: 0 }, san: { a1a8: 'Ra8#', a1a7: 'Ra7', g1g2: 'Kg2' },
  maia: { elo: 1500, probs: { g1g2: 0.5, a1a7: 0.5 } }, tags: [], site: null
};
const ANALYSED = {
  fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 7', stm: 'w', phase: 'endgame', evals: { a1a8: 9999, g1g2: 0 },
  san: { a1a8: 'Ra8#', g1g2: 'Kg2' }, maia: { elo: 1600, probs: { g1g2: 0.7, a1a8: 0.3 } }, tags: [], engine: 'e', model: 'm', nodes: 1
};
const tick = () => new Promise((r) => setTimeout(r, 25));
const $ = (w, id) => w.document.getElementById(id);
const click = (w, id) => $(w, id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/* A fetch that routes by URL. `api` is the health answer; `handlers` maps api paths to (body) => {status, json}. */
async function boot({ api, handlers = {}, positions = [ROOK] } = {}) {
  const dom = newDom();
  const w = dom.window;
  w.localStorage.setItem('gtm.v1.onboarded', 'true');
  const calls = [];
  w.fetch = async (url, opts) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const res = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
    if (url === 'api/healthz') {
      if (api === 'down') throw new Error('network');
      if (api === 'error') return res(502, {});
      return res(200, api);
    }
    if (url.startsWith('api/')) {
      const h = handlers[url];
      const out = h ? h(calls[calls.length - 1].body) : { status: 404, json: {} };
      return res(out.status, out.json);
    }
    return res(200, { schema: 1, meta: { demo: false }, positions });
  };
  w.Math.random = () => 0;
  loadApp(dom);
  await tick();
  w.document.getElementById('boardSvg').getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 800 });
  return { w, calls };
}
function move(w, from, to) {
  const a = B.center(from, false), b = B.center(to, false);
  const svg = $(w, 'boardSvg');
  const ev = (type, [x, y]) => svg.dispatchEvent(new w.PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y }));
  ev('pointerdown', a); ev('pointermove', [a[0] + 10, a[1]]); ev('pointermove', b); ev('pointerup', b);
}

test('without an api nothing appears: no panel, no estimate button, and no error', async () => {
  for (const api of [{ status: 'unavailable' }, 'down', 'error', { status: 'ok', maia: null, bogus: true }.status === 'ok' ? { nope: 1 } : null]) {
    const { w } = await boot({ api });
    assert.equal($(w, 'apiPanel').hidden, true);
    assert.equal($(w, 'estimateBtn').hidden, true);
    assert.equal(w.document.querySelectorAll('[data-sq]').length, 64, 'the app itself is unaffected');
  }
});

test('with an api the panel appears; the estimate button needs Maia', async () => {
  const withMaia = await boot({ api: { status: 'ok', engine: 'e', maia: 'maia2-rapid' } });
  assert.equal($(withMaia.w, 'apiPanel').hidden, false);
  assert.equal($(withMaia.w, 'estimateBtn').hidden, false);
  const noMaia = await boot({ api: { status: 'ok', engine: 'e', maia: null } });
  assert.equal($(noMaia.w, 'apiPanel').hidden, false);
  assert.equal($(noMaia.w, 'estimateBtn').hidden, true);
});

test('analysing a pasted FEN loads it as a playable best-move position that leaves the session stats alone', async () => {
  const { w, calls } = await boot({ api: { status: 'ok', maia: 'm' }, handlers: { 'api/v1/analyse': () => ({ status: 200, json: ANALYSED }) } });
  $(w, 'fenInput').value = '  6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 7 ';
  $(w, 'eloInput').value = '1600';
  click(w, 'analyseBtn');
  await tick();
  assert.deepEqual(calls.find((c) => c.url === 'api/v1/analyse').body, { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 7', elo: 1600 });
  assert.match($(w, 'posInfo').textContent, /White to move · move 7 · endgame$/);
  assert.equal($(w, 'apiMsg').textContent, '');
  w.document.querySelector('input[value=predict]').checked = true;
  w.document.querySelector('input[value=predict]').dispatchEvent(new w.Event('change', { bubbles: true }));
  move(w, 'a1', 'a8');
  assert.match($(w, 'result').textContent, /Move quality:\s*100\/100/, 'predict mode makes no sense without a real move: it is scored as best-move');
  assert.deepEqual(Array.from($(w, 'legend').querySelectorAll('[data-key]')).map((e) => e.getAttribute('data-key')), ['you', 'best', 'maia']);
  assert.equal(w.localStorage.getItem('gtm.v1.history'), null, 'pasted positions do not count towards the session stats');
  assert.match($(w, 'stats').textContent, /No guesses yet/);
});

test('the rating is only sent when the api has Maia; an empty FEN and api errors are explained', async () => {
  const seen = [];
  const { w } = await boot({ api: { status: 'ok', maia: null }, handlers: { 'api/v1/analyse': (b) => { seen.push(b); return { status: 422, json: { error: { code: 'invalid_fen', message: 'not a valid FEN' } } }; } } });
  click(w, 'analyseBtn');
  assert.match($(w, 'apiMsg').textContent, /Paste a FEN/);
  $(w, 'fenInput').value = 'garbage'; $(w, 'eloInput').value = '1500';
  click(w, 'analyseBtn');
  await tick();
  assert.deepEqual(seen, [{ fen: 'garbage' }]);
  assert.match($(w, 'apiMsg').textContent, /The analysis failed: not a valid FEN/);
  assert.equal($(w, 'analyseBtn').disabled, false);
  assert.equal(w.document.querySelectorAll('[data-sq]').length, 64, 'the previous position stays');

  const down = await boot({ api: { status: 'ok', maia: 'm' }, handlers: { 'api/v1/analyse': () => ({ status: 503, json: {} }) } });
  $(down.w, 'fenInput').value = 'x';
  click(down.w, 'analyseBtn');
  await tick();
  assert.match($(down.w, 'apiMsg').textContent, /HTTP 503/);
});

test('the level estimate needs five best-move guesses, sends the last ones, and shows the answer', async () => {
  const positions = Array.from({ length: 6 }, (_, i) => ({ ...ROOK, id: 'p' + i }));
  const posterior = { mean: 1480, interval80: [1350, 1650], moves: 6, grid: [], posterior: [] };
  const { w, calls } = await boot({ api: { status: 'ok', maia: 'm' }, positions, handlers: { 'api/v1/posterior': () => ({ status: 200, json: posterior }) } });
  assert.equal($(w, 'estimateBtn').disabled, true);
  assert.match($(w, 'estimate').textContent, /Play 5 more positions/);
  for (let i = 0; i < 5; i++) { move(w, 'a1', 'a8'); click(w, 'next'); }
  assert.equal($(w, 'estimateBtn').disabled, false);
  click(w, 'estimateBtn');
  await tick();
  const sent = calls.find((c) => c.url === 'api/v1/posterior').body.history;
  assert.equal(sent.length, 5);
  assert.deepEqual(sent[0], { fen: ROOK.fen, move: 'a1a8', opp_elo: 1400 });
  assert.match($(w, 'estimate').textContent, /About 1480 \(80% range 1350 to 1650\).*Lichess-equivalent.*not FIDE/);
  click(w, 'resetStats');
  assert.equal($(w, 'estimateBtn').disabled, true);
});

test('predict-mode guesses do not feed the estimate, and an estimate failure is explained', async () => {
  const positions = Array.from({ length: 6 }, (_, i) => ({ ...ROOK, id: 'p' + i, opp_elo: null }));
  const { w, calls } = await boot({ api: { status: 'ok', maia: 'm' }, positions, handlers: { 'api/v1/posterior': () => ({ status: 503, json: { error: { message: 'busy' } } }) } });
  const radio = w.document.querySelector('input[value=predict]');
  radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  for (let i = 0; i < 5; i++) { move(w, 'g1', 'g2'); click(w, 'next'); }
  assert.equal($(w, 'estimateBtn').disabled, true, 'predict-mode guesses say nothing about strength');
  const best = w.document.querySelector('input[value=best]');
  best.checked = true; best.dispatchEvent(new w.Event('change', { bubbles: true }));
  for (let i = 0; i < 5; i++) { move(w, 'a1', 'a8'); click(w, 'next'); if (i < 0) break; }
  await tick();
  click(w, 'estimateBtn');
  await tick();
  assert.equal(calls.find((c) => c.url === 'api/v1/posterior').body.history[0].opp_elo, 1500, 'unknown opponent rating defaults to 1500');
  assert.match($(w, 'estimate').textContent, /The analysis failed: busy/);
});
