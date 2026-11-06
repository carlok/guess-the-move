// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Pointer, keyboard, confirm, onboarding, theme and error-state wiring in jsdom.
 * jsdom has no layout, so these tests stub getBoundingClientRect (the board is 800x800 at the origin: client pixels equal
 * viewBox units). They check that events change state correctly; anything that depends on real geometry, scrolling or touch
 * behaviour is checked in a real browser by web/e2e. The fixtures are SYNTHETIC hand-written evals. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { newDom, loadApp, runScript, SCRIPTS, LAZY } = require('./harness');
const B = require('../board.js');

const ROOK = {
  id: 'rook', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ply: 0, move_no: 1, stm: 'w', phase: 'endgame',
  player_elo: 1500, opp_elo: 1500, real: 'g1g2',
  evals: { a1a8: 9999, a1a7: 300, a1a2: 120, g1g2: 0, g1f1: -5 },
  san: { a1a8: 'Ra8#', a1a7: 'Ra7', a1a2: 'Ra2', g1g2: 'Kg2', g1f1: 'Kf1' },
  maia: { elo: 1500, probs: { g1g2: 0.5, g1f1: 0.3, a1a7: 0.2 } }, tags: ['hard_find'], site: 'https://lichess.org/abcd1234'
};
const PROMO = {
  id: 'promo', fen: '8/P7/8/8/8/8/k6K/8 w - - 0 1', ply: 40, move_no: 21, stm: 'w', phase: 'middlegame',
  player_elo: null, opp_elo: null, real: 'a7a8q',
  evals: { a7a8q: 900, a7a8r: 500, a7a8b: 200, a7a8n: 200, h2h3: 0 },
  san: { a7a8q: 'a8=Q', a7a8r: 'a8=R', a7a8b: 'a8=B', a7a8n: 'a8=N', h2h3: 'Kh3' }, maia: null, tags: [], site: null
};
const BLACK = {
  id: 'black', fen: '6k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', ply: 41, move_no: 22, stm: 'b', phase: 'opening',
  player_elo: null, opp_elo: null, real: 'g8f8', evals: { g8f8: 0, h7h6: 10 }, san: { g8f8: 'Kf8', h7h6: 'h6' }, maia: null, tags: [], site: null
};
const dataOf = (...positions) => ({ schema: 1, meta: { demo: false }, positions });
const tick = () => new Promise((r) => setTimeout(r, 25));

async function boot(data, { confirm, onboarded = true, theme, media = {}, fetchImpl, online, audio, clock, hash, ls = {}, lazy } = {}) {
  const dom = newDom({ lazy: !!lazy });
  const w = dom.window;
  Object.keys(ls).forEach((k) => w.localStorage.setItem('gtm.v1.' + k, JSON.stringify(ls[k])));
  if (audio) w.AudioContext = audio;
  if (clock) w.Date.now = () => clock.t;
  if (hash) w.location.hash = hash;
  if (onboarded) w.localStorage.setItem('gtm.v1.onboarded', 'true');
  if (confirm !== undefined) w.localStorage.setItem('gtm.v1.confirm', JSON.stringify(confirm));
  if (theme) w.localStorage.setItem('gtm.v1.theme', JSON.stringify(theme));
  w.matchMedia = (q) => ({ matches: Object.keys(media).some((k) => q.includes(k) && media[k]) });
  if (online !== undefined) Object.defineProperty(w.navigator, 'onLine', { value: online, configurable: true });
  w.fetch = fetchImpl || (async () => ({ ok: true, json: async () => data }));
  w.Math.random = () => 0;
  loadApp(dom, lazy ? { lazy: true, ...lazy } : undefined);
  await tick();
  const svg = w.document.getElementById('boardSvg');
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 800 });
  return w;
}
const $ = (w, id) => w.document.getElementById(id);
const live = (w) => $(w, 'live').textContent.replace(/ /g, '');
const pt = (sq, flipped = false) => B.center(sq, flipped);
function ptr(w, type, [x, y], extra = {}) {
  $(w, 'boardSvg').dispatchEvent(new w.PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra }));
}
function drag(w, from, to, { release = true, flipped = false, ...extra } = {}) {
  const a = pt(from, flipped), b = typeof to === 'string' ? pt(to, flipped) : to;
  ptr(w, 'pointerdown', a, extra);
  ptr(w, 'pointermove', [a[0] + 10, a[1]], extra);
  ptr(w, 'pointermove', b, extra);
  if (release) ptr(w, 'pointerup', b, extra);
}
const key = (w, k, opts = {}) => $(w, 'boardSvg').dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
const docKey = (w, k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
const idle = (w) => {
  assert.equal($(w, 'boardSvg').getAttribute('data-dragging'), null, 'no drag in progress');
  assert.equal($(w, 'gGhost').children.length, 0, 'no ghost');
  assert.equal(w.document.querySelectorAll('.sel').length, 0, 'nothing selected');
  assert.equal($(w, 'result').hidden, true, 'nothing revealed');
};

test('dragging shows a ghost, dims the origin and marks the targets; dropping on a legal square reveals', async () => {
  const w = await boot(dataOf(ROOK));
  drag(w, 'a1', 'a5', { release: false });
  assert.equal($(w, 'boardSvg').getAttribute('data-dragging'), 'true');
  assert.equal($(w, 'gGhost').children.length, 1);
  assert.ok(w.document.querySelector('.drag-origin'));
  assert.equal(w.document.querySelectorAll('.dot, .ring').length, 3);
  assert.equal($(w, 'hoverSq').getAttribute('class'), 'hover no', 'a5 is not a legal target');
  ptr(w, 'pointermove', pt('a8'));
  assert.equal($(w, 'hoverSq').getAttribute('class'), 'hover ok');
  assert.equal($(w, 'hoverSq').getAttribute('x'), '0');
  ptr(w, 'pointermove', [-30, -30]);
  assert.equal($(w, 'hoverSq').getAttribute('class'), 'hover off', 'off the board');
  ptr(w, 'pointermove', pt('a8'));
  ptr(w, 'pointerup', pt('a8'));
  assert.match($(w, 'result').textContent, /Move quality:\s*100\/100/);
  assert.equal($(w, 'gGhost').children.length, 0);
  assert.match(live(w), /a1 to a8 played/);
});

test('a touch drag lifts the ghost above the finger', async () => {
  const w = await boot(dataOf(ROOK));
  drag(w, 'a1', 'c3', { release: false, pointerType: 'touch' });
  const ghost = $(w, 'gGhost').firstChild;
  assert.equal(Number(ghost.getAttribute('y')), pt('c3')[1] - 60 - 55);
  assert.equal(Number(ghost.getAttribute('x')), pt('c3')[0] - 60);
});

test('Escape, pointercancel and lost capture each put a dragged piece back', async () => {
  for (const cancel of [
    (w) => docKey(w, 'Escape'),
    (w) => ptr(w, 'pointercancel', pt('a7')),
    (w) => ptr(w, 'lostpointercapture', pt('a7'))
  ]) {
    const w = await boot(dataOf(ROOK));
    drag(w, 'a1', 'a7', { release: false });
    assert.equal($(w, 'boardSvg').getAttribute('data-dragging'), 'true');
    cancel(w);
    ptr(w, 'pointerup', pt('a7')); // the button is released afterwards: must do nothing
    idle(w);
    assert.match(live(w), /cancelled/);
    drag(w, 'a1', 'a8'); // not stuck
    assert.match($(w, 'result').textContent, /100\/100/);
  }
});

test('dropping off the board or on an illegal square cancels; dropping on the origin keeps the selection', async () => {
  let w = await boot(dataOf(ROOK));
  drag(w, 'a1', [-20, 400]);
  idle(w);
  w = await boot(dataOf(ROOK));
  drag(w, 'a1', 'c4');
  idle(w);
  w = await boot(dataOf(ROOK));
  drag(w, 'a1', pt('a1'));
  assert.equal(w.document.querySelectorAll('.sel').length, 1);
  assert.equal($(w, 'result').hidden, true);
  assert.match(live(w), /a1 selected, 3 legal moves/);
});

test('a press that barely moves is a tap: it selects, a second tap on the piece deselects, a tap on a target moves', async () => {
  const w = await boot(dataOf(ROOK));
  const tap = (sq) => { ptr(w, 'pointerdown', pt(sq)); ptr(w, 'pointermove', [pt(sq)[0] + 1, pt(sq)[1]]); ptr(w, 'pointerup', pt(sq)); };
  tap('a1');
  assert.equal(w.document.querySelectorAll('.sel').length, 1);
  tap('g1');
  assert.equal(w.document.querySelectorAll('.dot, .ring').length, 2, 'switched to the king');
  tap('g1');
  assert.equal(w.document.querySelectorAll('.sel').length, 0, 'tapping the selected piece deselects');
  tap('a1'); tap('a7');
  assert.match($(w, 'result').textContent, /ranks 2 of 5/);
});

test('input is ignored for other buttons, other pointers, off-board presses and after the reveal', async () => {
  const w = await boot(dataOf(ROOK));
  ptr(w, 'pointerdown', pt('a1'), { button: 2 });
  assert.equal(w.document.querySelectorAll('.sel').length, 0);
  ptr(w, 'pointerdown', [-5, -5]);
  assert.equal(w.document.querySelectorAll('.sel').length, 0);
  ptr(w, 'pointerdown', pt('a1'));
  ptr(w, 'pointerdown', pt('g1'), { pointerId: 2 });
  ptr(w, 'pointermove', pt('a7'), { pointerId: 2 });
  ptr(w, 'pointerup', pt('a8'), { pointerId: 2 });
  assert.equal(w.document.querySelectorAll('.sel').length, 1, 'the second pointer did nothing');
  ptr(w, 'pointerup', pt('a1'));
  drag(w, 'a1', 'a8');
  assert.equal($(w, 'result').hidden, false);
  drag(w, 'g1', 'g2');
  assert.equal(w.document.querySelectorAll('.sel').length, 0, 'the board is locked after the reveal');
});

test('a click with detail > 0 was already handled by the pointer events; one with detail 0 (assistive tech) still plays', async () => {
  const w = await boot(dataOf(ROOK));
  const sq = (n) => w.document.querySelector(`[data-sq="${n}"]`);
  sq('a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(w.document.querySelectorAll('.sel').length, 0);
  sq('a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true, detail: 0 }));
  assert.equal(w.document.querySelectorAll('.sel').length, 1);
  w.document.getElementById('boardSvg').dispatchEvent(new w.MouseEvent('click', { bubbles: true, detail: 0 }));
  assert.equal(w.document.querySelectorAll('.sel').length, 1, 'a click on the svg itself is ignored');
});

test('confirm mode: a chosen move is pending, can be changed, cancelled or confirmed', async () => {
  const w = await boot(dataOf(ROOK), { confirm: true });
  assert.equal($(w, 'confirmToggle').checked, true);
  drag(w, 'a1', 'a7');
  assert.equal($(w, 'confirm').hidden, false);
  assert.equal($(w, 'result').hidden, true);
  assert.equal(w.document.querySelectorAll('.pending').length, 2);
  assert.equal(w.document.querySelectorAll('.arrow').length, 1, 'the pending move is drawn as an arrow');
  assert.equal(w.document.querySelector('.arrow-label').textContent, 'Y');
  assert.match(live(w), /a1 to a7 chosen/);
  drag(w, 'a1', 'a8'); // change of mind
  docKey(w, 'Escape');
  assert.equal($(w, 'confirm').hidden, true);
  assert.equal(w.document.querySelectorAll('.pending').length, 0);
  drag(w, 'a1', 'a8');
  $(w, 'confirm').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.match($(w, 'result').textContent, /100\/100/);
  assert.equal($(w, 'confirm').hidden, true);
  $(w, 'confirm').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); // nothing pending: no effect
});

test('turning confirmation off drops a pending move and is remembered; promotion goes through the same gate', async () => {
  const w = await boot(dataOf(PROMO), { confirm: true });
  drag(w, 'a7', 'a8');
  assert.equal($(w, 'promo').hidden, false);
  assert.match(live(w), /promote/);
  $(w, 'promo').querySelector('[data-uci=a7a8n]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($(w, 'confirm').hidden, false);
  assert.equal($(w, 'promo').hidden, true);
  $(w, 'confirmToggle').checked = false;
  $(w, 'confirmToggle').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($(w, 'confirm').hidden, true);
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.confirm')), false);
  $(w, 'confirmToggle').checked = true;
  $(w, 'confirmToggle').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.confirm')), true);
});

test('coarse pointers default to confirmation; a stored choice overrides; narrow screens collapse the filters', async () => {
  const touch = await boot(dataOf(ROOK), { media: { coarse: true, 'max-width': true } });
  assert.equal($(touch, 'confirmToggle').checked, true);
  assert.equal($(touch, 'filters').open, false);
  const mouse = await boot(dataOf(ROOK));
  assert.equal($(mouse, 'confirmToggle').checked, false);
  assert.equal($(mouse, 'filters').open, true);
  const chosen = await boot(dataOf(ROOK), { media: { coarse: true }, confirm: false });
  assert.equal($(chosen, 'confirmToggle').checked, false);
});

test('keyboard: Home, arrows, Enter select then commit, with announcements; focus shows the cursor', async () => {
  const w = await boot(dataOf(ROOK));
  const svg = $(w, 'boardSvg');
  svg.dispatchEvent(new w.Event('focus'));
  assert.equal(w.document.querySelectorAll('.cursor').length, 1);
  key(w, 'Home');
  assert.match(live(w), /a1, white rook/);
  key(w, 'Enter');
  assert.match(live(w), /a1 selected, 3 legal moves/);
  key(w, 'ArrowUp');
  assert.match(live(w), /a2, empty/);
  key(w, 'ArrowRight');
  key(w, 'ArrowLeft');
  key(w, 'ArrowDown');
  key(w, 'ArrowUp', { ctrlKey: true }); // shortcuts are left alone
  assert.match(live(w), /a1, white rook/);
  key(w, 'Escape'); // only the document handles Escape: bubbling from the board is enough
  assert.equal(w.document.querySelectorAll('.sel').length, 0);
  key(w, ' ');
  for (let i = 0; i < 7; i++) key(w, 'ArrowUp');
  key(w, ' ');
  assert.match($(w, 'result').textContent, /100\/100/);
  svg.dispatchEvent(new w.Event('blur'));
  assert.equal(w.document.querySelectorAll('.cursor').length, 0);
});

test('keyboard: Enter on an empty square says so, and a position can be left with n after the reveal', async () => {
  const w = await boot(dataOf(ROOK));
  key(w, 'Enter');
  assert.match(live(w), /a1 selected/);
  key(w, 'ArrowRight'); key(w, 'Enter');
  assert.match(live(w), /No movable piece on b1/);
  docKey(w, 'n');
  assert.equal($(w, 'result').hidden, true, 'n does nothing before the reveal');
});

test('keyboard: the arrows flip with the board for Black', async () => {
  const w = await boot(dataOf(BLACK));
  key(w, 'Home');
  assert.match(live(w), /h8/);
  key(w, 'ArrowRight');
  assert.match(live(w), /g8, black king/);
});

test('the board is not driven by the keyboard when no position is loaded', async () => {
  const w = await boot(dataOf());
  key(w, 'Enter');
  $(w, 'boardSvg').dispatchEvent(new w.Event('focus'));
  assert.equal(live(w), '');
  drag(w, 'a1', 'a8');
  assert.equal($(w, 'result').hidden, true);
});

test('verdict, legend and cost bars after the reveal', async () => {
  const best = await boot(dataOf(ROOK));
  drag(best, 'a1', 'a8');
  assert.match($(best, 'verdict').textContent, /found Stockfish/);
  assert.equal($(best, 'legend').querySelectorAll('[data-key]').length, 4);
  assert.ok($(best, 'result').querySelector('.cost-bar'));
  assert.match($(best, 'result').textContent, /See the original game/);
  assert.equal($(best, 'prompt').hidden, true);

  const maia = await boot(dataOf(ROOK));
  drag(maia, 'g1', 'g2'); // Maia's top move and the real move
  assert.match($(maia, 'verdict').textContent, /~1500 player typically plays/);

  const real = await boot(dataOf({ ...ROOK, maia: null }));
  drag(real, 'g1', 'g2'); // the real move, no Maia
  assert.match($(real, 'verdict').textContent, /same move as the real player/);
  assert.equal($(real, 'legend').querySelectorAll('[data-key]').length, 3);

  const lost = await boot(dataOf(ROOK));
  drag(lost, 'a1', 'a2');
  assert.match($(lost, 'verdict').textContent, /gave up [\d.]+ win-% points/);

  const predict = await boot(dataOf(ROOK));
  predict.document.querySelector('input[value=predict]').checked = true;
  predict.document.querySelector('input[value=predict]').dispatchEvent(new predict.Event('change', { bubbles: true }));
  drag(predict, 'a1', 'a8');
  assert.match($(predict, 'verdict').textContent, /\d+\/100 close to the real move/);
  const exact = await boot(dataOf(ROOK));
  exact.document.querySelector('input[value=predict]').checked = true;
  exact.document.querySelector('input[value=predict]').dispatchEvent(new exact.Event('change', { bubbles: true }));
  drag(exact, 'g1', 'g2');
  assert.match($(exact, 'verdict').textContent, /predicted the real move/);
});

test('references that chose the same move share one arrow and one pill; different moves get their own style', async () => {
  const w = await boot(dataOf(ROOK));
  drag(w, 'g1', 'g2'); // you = real = Maia's top: one arrow; Stockfish plays a1a8: another
  const arrows = Array.from(w.document.querySelectorAll('.arrow'));
  assert.equal(arrows.length, 2);
  const byKey = Object.fromEntries(arrows.map((a) => [a.getAttribute('data-key'), a]));
  assert.deepEqual(Object.keys(byKey).sort(), ['best', 'real']);
  assert.equal(byKey.real.getAttribute('data-keys'), 'you real maia');
  assert.equal(byKey.real.querySelector('.arrow-label').textContent, 'Y R M');
  assert.equal(byKey.best.querySelector('.arrow-label').textContent, 'S');
  assert.deepEqual(arrows.map((a) => a.getAttribute('data-dash')).sort(), ['dashed', 'solid']);
  assert.ok(byKey.best.querySelectorAll('line').length >= 2, 'a halo and a shaft');
});

test('onboarding appears on first run, closes, is remembered, and the help page brings the tour back', async () => {
  const w = await boot(dataOf(ROOK), { onboarded: false });
  assert.equal($(w, 'onboarding').hidden, false);
  $(w, 'onboardingClose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($(w, 'onboarding').hidden, true);
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.onboarded')), true);
  $(w, 'helpBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  $(w, 'tourBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal($(w, 'onboarding').hidden, false);
  assert.equal($(w, 'helpView').hidden, true, 'the page steps aside for the tour');
  const seen = await boot(dataOf(ROOK));
  assert.equal($(seen, 'onboarding').hidden, true);
});

test('the theme button flips the theme and its own label', async () => {
  const w = await boot(dataOf(ROOK), { theme: 'light' });
  const html = w.document.documentElement;
  assert.equal(html.getAttribute('data-theme'), 'light');
  assert.match($(w, 'themeToggle').getAttribute('aria-label'), /dark/);
  $(w, 'themeToggle').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(html.getAttribute('data-theme'), 'dark');
  assert.match($(w, 'themeToggle').getAttribute('aria-label'), /light/);
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.theme')), 'dark');
});

test('a failed load offers a retry; offline gets its own message; success clears the skeleton', async () => {
  let ok = false;
  const fetchImpl = async () => (ok ? { ok: true, json: async () => dataOf(ROOK) } : { ok: false, status: 503 });
  const w = await boot(null, { fetchImpl });
  assert.match($(w, 'prompt').textContent, /Could not load.*HTTP 503/s);
  assert.equal($(w, 'skeleton').hidden, true);
  ok = true;
  $(w, 'retry').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal(w.document.querySelectorAll('[data-sq]').length, 64);
  assert.equal($(w, 'prompt').hidden, false);

  const off = await boot(null, { fetchImpl: async () => { throw new Error('Failed to fetch'); }, online: false });
  assert.match($(off, 'prompt').textContent, /offline/);
});

test('skip marks the position seen, and the empty states explain themselves', async () => {
  const w = await boot(dataOf(ROOK));
  $(w, 'skip').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.match($(w, 'prompt').textContent, /No unseen positions match/);
  assert.equal($(w, 'skip').hidden, true);
  assert.equal(w.document.querySelectorAll('.piece').length, 0, 'the board is cleared');
  $(w, 'resetStats').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.match($(w, 'stats').textContent, /No guesses yet/);
});

test('changing the mode after the reveal does not rewrite the finished prompt', async () => {
  const w = await boot(dataOf(ROOK));
  drag(w, 'a1', 'a8');
  const radio = w.document.querySelector('input[value=predict]');
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($(w, 'prompt').hidden, true);
  assert.match($(w, 'verdict').textContent, /found Stockfish/);
});

const PROVENANCE = {
  engine: { name: 'Stockfish 19', nodes: 400000 }, maia: { model: 'maia3-23m', history_plies: 8 }, players_stored: false
};
const withGame = (date) => ({ ...ROOK, id: 'g' + date, game: { date } });
const click = (w, id) => $(w, id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

const PAGE_BUTTONS = { stats: 'statsBtn', settings: 'settingsBtn', help: 'helpBtn' };

test('each page opens from its top-bar button, shows only itself, takes focus, and Escape returns to the board and the button', async () => {
  for (const [name, btn] of Object.entries(PAGE_BUTTONS)) {
    const w = await boot(dataOf(ROOK));
    assert.equal($(w, name + 'View').hidden, true);
    $(w, btn).focus(); click(w, btn);
    assert.equal($(w, name + 'View').hidden, false, name);
    assert.equal($(w, 'gameMain').hidden, true);
    ['stats', 'settings', 'help', 'about'].filter((n) => n !== name).forEach((n) => assert.equal($(w, n + 'View').hidden, true, n + ' stays closed'));
    assert.equal(w.document.activeElement, $(w, name + 'Title'));
    assert.equal(w.location.hash, '#' + name);
    docKey(w, 'Escape'); await tick();
    assert.equal($(w, name + 'View').hidden, true);
    assert.equal($(w, 'gameMain').hidden, false);
    assert.equal(w.document.activeElement, $(w, btn));
  }
});

test('a page closes with its Back button, and its own top-bar button toggles it', async () => {
  const w = await boot(dataOf(ROOK));
  click(w, 'settingsBtn'); click(w, 'settingsBack'); await tick();
  assert.equal($(w, 'settingsView').hidden, true);
  click(w, 'helpBtn'); click(w, 'helpBtn'); await tick();
  assert.equal($(w, 'helpView').hidden, true);
});

test('every page carries the same links to the others, marks the current one, and a click switches in place', async () => {
  const w = await boot(dataOf(ROOK));
  click(w, 'helpBtn');
  const nav = (n) => [...$(w, n + 'View').querySelectorAll('.pagenav a')];
  ['stats', 'settings', 'help', 'about'].forEach((n) => assert.deepEqual(nav(n).map((a) => a.getAttribute('href')), ['#stats', '#settings', '#help', '#about'], n));
  assert.equal($(w, 'helpView').querySelector('.pagenav [aria-current=page]').getAttribute('href'), '#help');
  nav('help')[3].dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal($(w, 'aboutView').hidden, false); assert.equal($(w, 'helpView').hidden, true);
  assert.equal(w.location.hash, '#about');
  assert.equal($(w, 'aboutView').querySelector('.pagenav [aria-current=page]').getAttribute('href'), '#about');
  nav('about')[3].dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); // the page you are on: nothing happens
  assert.equal($(w, 'aboutView').hidden, false);
  docKey(w, 'Escape'); await tick();
  assert.equal($(w, 'gameMain').hidden, false);
  const f = w.document.querySelector('footer a[href="#about"]');
  assert.ok(f, 'the footer links to the credits');
});

test('the page links work from the address too: #settings opens settings, #about the about page, and a hash change moves between them', async () => {
  const w = await boot(dataOf(ROOK), { hash: '#settings' });
  assert.equal($(w, 'settingsView').hidden, false);
  assert.equal($(w, 'gameMain').hidden, true);
  w.location.hash = '#about'; await tick();
  assert.equal($(w, 'aboutView').hidden, false); assert.equal($(w, 'settingsView').hidden, true);
  w.location.hash = ''; await tick();
  assert.equal($(w, 'gameMain').hidden, false);
});

test('"The data" is written from the dataset\'s own provenance', async () => {
  const data = { schema: 1, meta: { demo: false, source: 'lichess_db_standard_rated_2026-09.pgn.zst', built: '2026-11-03T15:57:07+00:00', provenance: PROVENANCE },
    positions: [withGame('2026.09.01'), withGame('2026.09.01')] };
  const w = await boot(data, { hash: '#about' });
  const text = $(w, 'aboutList').textContent;
  assert.match(text, /2 positions from real Lichess games, played on 2026\.09\.01/);
  assert.match(text, /Stockfish 19 scored every legal move.*400,000 nodes/);
  assert.match(text, /maia3-23m.*last 8 positions/);
  assert.match(text, /lichess_db_standard_rated_2026-09\.pgn\.zst \(CC0\)/);
  assert.match(text, /Built on 2026-11-03/);
  assert.match(text, /Player names are not stored\. Each result links to the original game/);
});

test('"The data" gives a date range, says when usernames are stored, and never claims what the file does not say', async () => {
  const stored = { schema: 1, meta: { demo: false, provenance: { ...PROVENANCE, players_stored: true } }, positions: [withGame('2026.09.01'), withGame('2026.09.30')] };
  const w = await boot(stored, { hash: '#about' });
  assert.match($(w, 'aboutList').textContent, /played between 2026\.09\.01 and 2026\.09\.30/);
  assert.match($(w, 'aboutList').textContent, /also stores the players' Lichess usernames/);
  assert.doesNotMatch($(w, 'aboutList').textContent, /names are not stored/);
});

test('"The data" copes with demo data that has no provenance, no rating model and no games', async () => {
  const w = await boot({ schema: 1, meta: { demo: true, engine: 'Stockfish 19', nodes: 1000 }, positions: [ROOK] }, { hash: '#about' });
  const text = $(w, 'aboutList').textContent;
  assert.match(text, /^1 positions from real Lichess games\./);
  assert.match(text, /no human-model \(Maia\) data/);
  assert.doesNotMatch(text, /names/i, 'no claim about names without provenance');
  assert.doesNotMatch(text, /Built on|Source file/);
});

test('"The data" shows its loading line before the dataset arrives, then fills in', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = await boot(dataOf(ROOK), { hash: '#about', fetchImpl: async () => { await gate; return { ok: true, json: async () => dataOf(ROOK) }; } });
  assert.equal($(w, 'aboutList').textContent, 'Loading…');
  release(); await tick();
  assert.match($(w, 'aboutList').textContent, /1 positions from real Lichess games/);
});

/* ---------- sounds ---------- */

function fakeAudio() {
  const log = [];
  class Ctx {
    constructor() { this.currentTime = 2; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime(f) { log.push('f' + f); }, exponentialRampToValueAtTime(f) { log.push('glide' + f); } }, connect() {}, start() {}, stop() {} }; }
    createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, connect() {} }; }
  }
  return { Ctx, log };
}
const CAPTURE = {
  ...ROOK, id: 'cap', fen: 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1', evals: { a1a8: 500, a1a2: 0 }, san: { a1a8: 'Rxa8+', a1a2: 'Ra2' }, real: 'a1a2', maia: null
};
const EP = { ...ROOK, id: 'ep', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', evals: { e5d6: 100, e5e6: 0 }, san: { e5d6: 'exd6', e5e6: 'e6' }, real: 'e5e6', maia: null };
const sq = (w, name) => w.document.querySelector(`[data-sq="${name}"]`);

test('selecting a piece clicks, a plain move thuds and a best move chimes; nothing sounds before the first action', async () => {
  const { Ctx, log } = fakeAudio();
  const w = await boot(dataOf(ROOK), { audio: Ctx });
  assert.deepEqual(log, [], 'no audio activity at load');
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(log.includes('f620'), 'select');
  log.length = 0;
  sq(w, 'a8').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(log.includes('glide120') && !log.includes('glide80'), 'a move, not a capture');
  assert.ok(log.includes('f784'), 'the best move gets the rising chime');
});

test('a beep sounds for each full minute spent on a position, never twice for the same minute, and starts over on the next one', async () => {
  const { Ctx, log } = fakeAudio(), clock = { t: 5_000_000 };
  const w = await boot(dataOf(ROOK, CAPTURE), { audio: Ctx, clock });
  const beeps = () => log.filter((x) => x === 'f1047').length;
  clock.t += 59_000; w.__intervals[0]();
  assert.equal(beeps(), 0, 'not yet a minute');
  clock.t += 2_000; w.__intervals[0](); w.__intervals[0]();
  assert.equal(beeps(), 1, 'one beep at the minute, however often the display is refreshed');
  clock.t += 60_000; w.__intervals[0]();
  assert.equal(beeps(), 2, 'and one more a minute later');
  click(w, 'next');
  clock.t += 59_000; w.__intervals[0]();
  assert.equal(beeps(), 2, 'a new position counts its own minutes');
  clock.t += 2_000; w.__intervals[0]();
  assert.equal(beeps(), 3);
});

test('no beep after the reveal, while a page covers the board, or when it is switched off or the sound is muted', async () => {
  const { Ctx, log } = fakeAudio(), clock = { t: 5_000_000 };
  const w = await boot(dataOf(ROOK, CAPTURE), { audio: Ctx, clock });
  const beeps = () => log.filter((x) => x === 'f1047').length;
  assert.equal($(w, 'beepToggle').checked, true, 'on by default');
  click(w, 'settingsBtn');
  clock.t += 125_000; w.__intervals[0]();
  assert.equal(beeps(), 0, 'the time on a page does not count as thinking');
  click(w, 'settingsBack');
  $(w, 'beepToggle').checked = false; $(w, 'beepToggle').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.beep')), false);
  clock.t += 61_000; w.__intervals[0]();
  assert.equal(beeps(), 0, 'switched off');
  $(w, 'beepToggle').checked = true; $(w, 'beepToggle').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.beep')), true);
  click(w, 'soundToggle');
  clock.t += 61_000; w.__intervals[0]();
  assert.equal(beeps(), 0, 'the sound button mutes it too');
  click(w, 'soundToggle');
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'a8').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  clock.t += 200_000; w.__intervals[0]();
  assert.equal(beeps(), 0, 'once answered the clock is stopped');
});

test('the beep setting is remembered and restored', async () => {
  const w = await boot(dataOf(ROOK), { ls: { beep: false } });
  assert.equal($(w, 'beepToggle').checked, false);
});

/* ---------- the data arrives in two steps: a small sample first, then the full file ---------- */

function twoSteps({ first, full, failFirst = false, failFull = false, holdFirst = false, holdFull = true }) {
  const gates = {}, urls = [];
  const wait = (name, hold) => (hold ? new Promise((r) => { gates[name] = r; }) : Promise.resolve());
  const fetchImpl = async (url) => {
    urls.push(url);
    if (!/(first|positions)\.json$/.test(url)) return { ok: false, status: 404, json: async () => ({}) }; // the api probe and anything else
    const isFirst = /first\.json$/.test(url);
    await wait(isFirst ? 'first' : 'full', isFirst ? holdFirst : holdFull);
    if (isFirst ? failFirst : failFull) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, json: async () => (isFirst ? first : full) };
  };
  return { fetchImpl, urls, release: (name) => gates[name] && gates[name]() };
}
const sample = (positions, of) => ({ schema: 1, meta: { demo: false, partial: { of } }, positions });
const matchText = (w) => $(w, 'matchCount').textContent;

test('the first position is playable from the sample while the full file is still on its way, and the full file then arrives without changing the board', async () => {
  const t = twoSteps({ first: sample([ROOK], 3), full: dataOf(ROOK, CAPTURE, EP) });
  const w = await boot(dataOf(ROOK), { fetchImpl: t.fetchImpl });
  assert.deepEqual(t.urls.slice(0, 2).sort(), ['data/first.json', 'data/positions.json']);
  assert.equal(matchText(w), '1 position match');
  assert.equal($(w, 'skeleton').hidden, true); assert.ok(w.document.querySelectorAll('[data-sq]').length === 64, 'the board is drawn');
  assert.equal($(w, 'dailyBtn').disabled, true); assert.equal($(w, 'friendBtn').disabled, true, 'challenges pick from every position');
  play(w, 'a1', 'a8');
  assert.equal($(w, 'result').hidden, false, 'a move can be answered from the sample');
  const info = $(w, 'posInfo').textContent;
  t.release('full'); await tick();
  assert.equal(matchText(w), '2 positions match', 'all three now, minus the one just answered (the unseen filter is on)');
  assert.equal($(w, 'dailyBtn').disabled, false); assert.equal($(w, 'friendBtn').disabled, false);
  assert.equal($(w, 'result').hidden, false, 'the answer on the board is still there');
  assert.equal($(w, 'posInfo').textContent, info, 'and so is the position');
});

test('when the full file arrives first the sample is ignored', async () => {
  const t = twoSteps({ first: sample([ROOK], 3), full: dataOf(ROOK, CAPTURE, EP), holdFull: false, holdFirst: true });
  const w = await boot(dataOf(ROOK), { fetchImpl: t.fetchImpl });
  assert.equal(matchText(w), '3 positions match');
  t.release('first'); await tick();
  assert.equal(matchText(w), '3 positions match', 'a late sample does not replace the full data');
  assert.equal($(w, 'dailyBtn').disabled, false);
});

test('with no sample file the page waits for the full one, silently', async () => {
  const t = twoSteps({ first: null, full: dataOf(ROOK, CAPTURE), failFirst: true, holdFull: false });
  const w = await boot(dataOf(ROOK), { fetchImpl: t.fetchImpl });
  assert.equal(matchText(w), '2 positions match');
  assert.equal($(w, 'prompt').textContent.includes('Could not load'), false);
});

test('a link to a position in the sample opens at once; a link to another one waits for the full file, then opens', async () => {
  const inSample = twoSteps({ first: sample([HA], 2), full: dataOf(HA, HB) });
  const a = await boot(dataOf(HA), { fetchImpl: inSample.fetchImpl, hash: '#p=' + HA.id });
  assert.equal($(a, 'skeleton').hidden, true);
  assert.ok(a.document.getElementById('posInfo').textContent.length > 0, 'opened from the sample');
  const later = twoSteps({ first: sample([HA], 2), full: dataOf(HA, HB) });
  const b = await boot(dataOf(HA), { fetchImpl: later.fetchImpl, hash: '#p=' + HB.id });
  assert.equal(b.document.getElementById('posInfo').textContent, '', 'nothing is shown, and no "not in this dataset" yet');
  assert.equal($(b, 'prompt').textContent.includes('not in this dataset'), false);
  later.release('full'); await tick();
  assert.equal($(b, 'prompt').textContent.includes('not in this dataset'), false);
  assert.equal(b.document.getElementById('posInfo').textContent.includes('to move'), true, 'opened once the full file is here');
  assert.equal(b.document.querySelector('[data-sq="a1"] , [data-sq="e5"]') !== null, true);
});

test('a challenge link waits for the full file too', async () => {
  const t = twoSteps({ first: sample([ROOK], 12), full: chData() });
  const w = await boot(dataOf(ROOK), { fetchImpl: t.fetchImpl, hash: '#c=abc123.0000' });
  assert.equal($(w, 'sessionChip').hidden, true, 'not started on the sample');
  assert.equal($(w, 'posInfo').textContent, '', 'and no position is shown yet');
  t.release('full'); await tick();
  assert.equal($(w, 'posInfo').textContent.includes('to move'), true, 'the link is followed once the full file is here');
});

test('if the full file cannot be loaded the sample stays playable and the page says so', async () => {
  const t = twoSteps({ first: sample([ROOK], 3), full: null, failFull: true, holdFull: false });
  const w = await boot(dataOf(ROOK), { fetchImpl: t.fetchImpl });
  assert.equal(matchText(w), '1 position match');
  assert.equal($(w, 'linkMsg').textContent, 'Could not load all the positions, so you are playing a small sample. Reload to try again.');
  assert.equal($(w, 'dailyBtn').disabled, true);
});

test('the menus keep the chosen filter when the full file replaces the sample', async () => {
  const withTag = (p) => ({ ...p, tags: ['hard_find'] });
  const t = twoSteps({ first: sample([withTag(ROOK)], 3), full: dataOf(withTag(ROOK), withTag(CAPTURE), CAPTURE) });
  const w = await boot(dataOf(ROOK), { fetchImpl: t.fetchImpl });
  $(w, 'tag').value = 'hard_find'; $(w, 'tag').dispatchEvent(new w.Event('change', { bubbles: true }));
  t.release('full'); await tick();
  assert.equal($(w, 'tag').value, 'hard_find');
  assert.match($(w, 'tag').selectedOptions[0].textContent, /\(\d\)/);
});

test('a capture and en passant sound heavier; a poor move ends on the low tone; a middling one on the neutral pair', async () => {
  const cap = fakeAudio();
  let w = await boot(dataOf(CAPTURE), { audio: cap.Ctx });
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'a8').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(cap.log.includes('glide80'), 'capture');
  const ep = fakeAudio();
  w = await boot(dataOf(EP), { audio: ep.Ctx });
  sq(w, 'e5').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'd6').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(ep.log.includes('glide80'), 'en passant is a capture');
  const bad = fakeAudio();
  w = await boot(dataOf(ROOK), { audio: bad.Ctx });
  sq(w, 'g1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'f1').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(bad.log.includes('glide196'), 'a move that gives up the game');
  const fine = fakeAudio();
  w = await boot(dataOf(ROOK), { audio: fine.Ctx });
  sq(w, 'g1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'g2').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(fine.log.includes('f587') && !fine.log.includes('f784'), 'the real move is neither best nor bad');
});

test('predict mode: the real move chimes, a distant guess does not', async () => {
  const a = fakeAudio();
  let w = await boot(dataOf(ROOK), { audio: a.Ctx });
  w.document.querySelector('input[value=predict]').click();
  sq(w, 'g1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'g2').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(a.log.includes('f784'));
  const b = fakeAudio();
  w = await boot(dataOf(ROOK), { audio: b.Ctx });
  w.document.querySelector('input[value=predict]').click();
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'a8').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(!b.log.includes('f784'));
});

test('other actions have sounds: a stray click is an error tick, deselecting, confirm-pending, skip/next, theme and pages', async () => {
  const { Ctx, log } = fakeAudio();
  const w = await boot(dataOf(ROOK, CAPTURE), { audio: Ctx, confirm: true });
  const heard = (fn) => { log.length = 0; fn(); return log.slice(); };
  assert.ok(heard(() => sq(w, 'e5').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))).includes('f150'), 'error on an empty square');
  const first = { from: 'a1', to: 'a8' }; // both fixtures: White to move, rook on a1
  sq(w, first.from).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(heard(() => sq(w, first.from).dispatchEvent(new w.MouseEvent('click', { bubbles: true }))).includes('f420'), 'deselect');
  sq(w, first.from).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(heard(() => sq(w, first.to).dispatchEvent(new w.MouseEvent('click', { bubbles: true }))).includes('f880'), 'a pending move ticks');
  assert.ok(heard(() => docKey(w, 'Escape')).includes('f420'), 'Escape cancels with the deselect sound');
  assert.ok(heard(() => click(w, 'skip')).includes('f500'), 'skip');
  assert.ok(heard(() => click(w, 'themeToggle')).includes('f880'), 'theme');
  assert.ok(heard(() => click(w, 'settingsBtn')).includes('f880'), 'a page opens');
});

test('the speaker button mutes and unmutes, remembers it, and a muted page stays silent', async () => {
  const { Ctx, log } = fakeAudio();
  const w = await boot(dataOf(ROOK), { audio: Ctx });
  assert.match($(w, 'soundToggle').getAttribute('aria-label'), /Mute/);
  assert.equal($(w, 'soundToggle').getAttribute('data-state'), 'on');
  click(w, 'soundToggle');
  assert.match($(w, 'soundToggle').getAttribute('aria-label'), /on$/);
  assert.equal($(w, 'soundToggle').getAttribute('data-state'), 'off');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.sound')), false);
  log.length = 0;
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(log, [], 'muted');
  click(w, 'soundToggle');
  assert.ok(log.includes('f880'), 'turning sound on confirms with a tick');
  const quiet = fakeAudio();
  const w2 = await boot(dataOf(ROOK), { audio: quiet.Ctx, ls: { sound: false } });
  assert.equal($(w2, 'soundToggle').getAttribute('data-state'), 'off');
  sq(w2, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(quiet.log, []);
});

test('without Web Audio the page works and the speaker button still toggles its state', async () => {
  const w = await boot(dataOf(ROOK));
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'a8').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($(w, 'result').hidden, false);
  click(w, 'soundToggle');
  assert.equal($(w, 'soundToggle').getAttribute('data-state'), 'off');
});

/* ---------- timer ---------- */

test('the timer counts up from 0:00, restarts with each position and freezes at the reveal; the guess records its time', async () => {
  const clock = { t: 1_000_000 };
  const w = await boot(dataOf(ROOK, CAPTURE), { clock });
  const tickTimer = () => w.__intervals[0]();
  assert.equal($(w, 'timer').hidden, false);
  assert.equal($(w, 'timer').textContent, '0:00');
  clock.t += 65_400; tickTimer();
  assert.equal($(w, 'timer').textContent, '1:05');
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'a8').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  clock.t += 30_000; tickTimer();
  assert.equal($(w, 'timer').textContent, '1:05', 'frozen at the reveal');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.history'))[0].dur, 65);
  click(w, 'next');
  assert.equal($(w, 'timer').textContent, '0:00', 'a new position starts again');
  clock.t += 3_000; tickTimer();
  assert.equal($(w, 'timer').textContent, '0:03');
});

test('the timer pauses while a page or the stats view is open and when the tab is hidden', async () => {
  const clock = { t: 0 };
  const w = await boot(dataOf(ROOK), { clock });
  clock.t += 10_000;
  click(w, 'helpBtn'); clock.t += 100_000; click(w, 'helpBack'); await tick();
  clock.t += 5_000;
  click(w, 'statsBtn'); clock.t += 100_000; click(w, 'statsBack'); await tick();
  clock.t += 2_000;
  const hide = (v) => { Object.defineProperty(w.document, 'hidden', { value: v, configurable: true }); w.document.dispatchEvent(new w.Event('visibilitychange')); };
  hide(true); clock.t += 100_000; hide(false);
  clock.t += 3_000;
  w.__intervals[0]();
  assert.equal($(w, 'timer').textContent, '0:20', '10 + 5 + 2 + 3 seconds, none of the waiting counted');
});

test('the timer can be hidden in the settings (the time is still recorded) and the choice is remembered', async () => {
  const clock = { t: 0 };
  const w = await boot(dataOf(ROOK), { clock });
  $(w, 'timerToggle').checked = false;
  $(w, 'timerToggle').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($(w, 'timer').hidden, true);
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.timer')), false);
  clock.t += 8_000;
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, 'a8').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.history'))[0].dur, 8);
  const again = await boot(dataOf(ROOK), { ls: { timer: false } });
  assert.equal($(again, 'timer').hidden, true); assert.equal($(again, 'timerToggle').checked, false);
});

test('with no position to show the timer rests at 0:00', async () => {
  const clock = { t: 0 };
  const w = await boot(dataOf(ROOK), { clock });
  clock.t += 9_000;
  $(w, 'phase').value = 'opening'; $(w, 'phase').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($(w, 'timer').textContent, '0:00');
  clock.t += 9_000; w.__intervals[0]();
  assert.equal($(w, 'timer').textContent, '0:00');
});

/* ---------- the stats view ---------- */

const guess = (i, over = {}) => ({ id: 'p' + i, mode: 'best', phase: 'opening', tags: [], cost: i % 7, score: 50 + (i % 5) * 10, mb: i % 3 === 0, mr: i % 2 === 0, mm: i % 4 === 0, t: 1000 + i, dur: 10 + i, ...over });
const many = (n) => Array.from({ length: n }, (_, i) => guess(i));

test('the stats view is a page of its own: it hides the board, draws charts from the stored history, and Back returns', async () => {
  const w = await boot(dataOf(ROOK), { ls: { history: many(12) } });
  assert.equal($(w, 'statsView').hidden, true);
  click(w, 'statsBtn');
  assert.equal($(w, 'statsView').hidden, false);
  assert.equal($(w, 'gameMain').hidden, true); assert.equal(w.document.querySelector('footer').hidden, true);
  assert.equal(w.document.activeElement, $(w, 'statsTitle'));
  assert.equal(w.location.hash, '#stats');
  assert.ok($(w, 'statsBody').querySelectorAll('svg.chart').length >= 5);
  assert.equal($(w, 'statsBody').querySelector('.kpi dd').textContent, '12');
  click(w, 'statsBack'); await tick();
  assert.equal($(w, 'statsView').hidden, true);
  assert.equal($(w, 'gameMain').hidden, false);
  assert.equal(w.location.hash, '');
  assert.equal(w.document.activeElement, $(w, 'statsBtn'));
});

test('Escape leaves the stats view; board keys do nothing there; the browser Back button works too', async () => {
  const w = await boot(dataOf(ROOK));
  click(w, 'openStats');
  assert.equal($(w, 'statsView').hidden, false);
  assert.match($(w, 'statsBody').textContent, /Play a few positions/);
  docKey(w, 'x');
  assert.equal($(w, 'statsView').hidden, false);
  docKey(w, 'Escape'); await tick();
  assert.equal($(w, 'statsView').hidden, true);
  click(w, 'statsBtn');
  w.history.back(); await tick();
  assert.equal($(w, 'statsView').hidden, true, 'hashchange closes it');
});

test('#stats opens the view straight away, and closing it then leaves the URL clean', async () => {
  const w = await boot(dataOf(ROOK), { hash: '#stats', ls: { history: many(3) } });
  assert.equal($(w, 'statsView').hidden, false);
  assert.equal($(w, 'statsBody').querySelectorAll('.kpi').length, 10, 'with today');
  click(w, 'statsBack');
  assert.equal($(w, 'statsView').hidden, true);
  assert.equal(w.location.hash, '');
});

test('resetting the stats clears the history and the played list; the view then shows the empty message', async () => {
  const w = await boot(dataOf(ROOK), { ls: { history: many(4), seen: ['p1'] } });
  click(w, 'resetStats');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.history')).length, 0);
  click(w, 'statsBtn');
  assert.match($(w, 'statsBody').textContent, /Play a few positions/);
});

/* ---------- download and load ---------- */

function spyDownload(w) {
  const got = { files: [], text: null };
  const RealBlob = w.Blob;
  w.Blob = function (parts, o) { got.text = parts.join(''); return new RealBlob(parts, o); };
  w.URL.createObjectURL = () => 'blob:stats';
  w.URL.revokeObjectURL = () => { got.revoked = true; };
  w.HTMLAnchorElement.prototype.click = function () { got.files.push({ href: this.href, name: this.download }); };
  return got;
}
async function loadFile(w, text, name = 'stats.json') {
  const input = $(w, 'importFile');
  Object.defineProperty(input, 'files', { value: [new w.File([text], name)], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
}

test('"Download my stats" saves a dated .json with the history and the played list', async () => {
  const clock = { t: Date.UTC(2026, 10, 4, 9, 0, 0) };
  const w = await boot(dataOf(ROOK), { clock, ls: { history: many(3), seen: ['p0', 'p1'] } });
  const got = spyDownload(w);
  click(w, 'statsBtn'); click(w, 'exportBtn');
  await tick();
  assert.deepEqual(got.files, [{ href: 'blob:stats', name: 'guess-the-move-stats-2026-11-04.json' }]);
  const body = JSON.parse(got.text);
  assert.equal(body.app, 'guess-the-move'); assert.equal(body.format, 1);
  assert.equal(body.history.length, 3); assert.deepEqual(body.seen, ['p0', 'p1']);
  assert.equal(got.revoked, true);
  assert.match($(w, 'backupMsg').textContent, /Downloaded 3 guesses/);
});

test('"Load stats from a file" merges what is in the file with what is here, and says what happened', async () => {
  const w = await boot(dataOf(ROOK), { ls: { history: many(3), seen: ['p0'] } });
  click(w, 'statsBtn');
  const file = { app: 'guess-the-move', format: 1, history: [...many(5), { junk: true }], seen: ['p0', 'z9'] };
  $(w, 'importBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await loadFile(w, JSON.stringify(file));
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.history')).length, 5, '3 already here + 2 new');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('gtm.v1.seen')).sort(), ['p0', 'z9']);
  assert.match($(w, 'backupMsg').textContent, /Loaded 2 new guesses, 3 were already here, 1 entries in the file were not usable/);
  assert.equal($(w, 'statsBody').querySelector('.kpi dd').textContent, '5', 'the charts are redrawn');
  assert.match($(w, 'stats').textContent, /5/, 'and so is the small summary');
});

test('a file that is not a stats file changes nothing and is explained', async () => {
  const w = await boot(dataOf(ROOK), { ls: { history: many(2) } });
  const msg = async (text) => { await loadFile(w, text); return $(w, 'backupMsg').textContent; };
  assert.match(await msg('{oops'), /not valid JSON/);
  assert.match(await msg('{"app":"other"}'), /not a Guess the Move stats file/);
  assert.match(await msg('{"app":"guess-the-move","format":9,"history":[]}'), /version this page does not understand/);
  assert.match(await msg('{"app":"guess-the-move","format":1}'), /no guess history/);
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.history')).length, 2);
});

test('an unreadable file is reported, and a cancelled file dialog does nothing', async () => {
  const w = await boot(dataOf(ROOK));
  const RealReader = w.FileReader;
  w.FileReader = function () { const r = new RealReader(); r.readAsText = function () { setTimeout(() => this.onerror && this.onerror(new w.Event('error')), 0); }; return r; };
  await loadFile(w, '{}');
  assert.match($(w, 'backupMsg').textContent, /could not be read/);
  Object.defineProperty($(w, 'importFile'), 'files', { value: [], configurable: true });
  $(w, 'importFile').dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick();
  assert.match($(w, 'backupMsg').textContent, /could not be read/, 'unchanged');
});

test('the charts are drawn at the width of the page and redrawn when the window is resized', async () => {
  const w = await boot(dataOf(ROOK), { ls: { history: many(12) } });
  Object.defineProperty($(w, 'statsBody'), 'clientWidth', { value: 360, configurable: true });
  click(w, 'statsBtn');
  assert.match($(w, 'statsBody').innerHTML, /viewBox="0 0 360 /);
  Object.defineProperty($(w, 'statsBody'), 'clientWidth', { value: 520, configurable: true });
  w.dispatchEvent(new w.Event('resize'));
  assert.match($(w, 'statsBody').innerHTML, /viewBox="0 0 520 /);
  click(w, 'statsBack'); await tick();
  Object.defineProperty($(w, 'statsBody'), 'clientWidth', { value: 400, configurable: true });
  w.dispatchEvent(new w.Event('resize'));
  assert.match($(w, 'statsBody').innerHTML, /viewBox="0 0 520 /, 'not redrawn while the view is closed');
});

/* ---------- going back to study a position again ---------- */

const play = (w, a, b) => { sq(w, a).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); sq(w, b).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const histLen = (w) => JSON.parse(w.localStorage.getItem('gtm.v1.history') || '[]').length;
const timerText = (w) => $(w, 'timer').textContent;

test('Previous is hidden until a position has been answered, then reopens it as a review: answer shown, timer stopped, nothing recorded again', async () => {
  const clock = { t: 0 };
  const w = await boot(dataOf(ROOK, CAPTURE, EP), { clock });
  assert.equal($(w, 'back').hidden, true, 'nothing to go back to yet');
  clock.t += 42_000; play(w, 'a1', 'a8'); // ROOK, 42 s
  click(w, 'next');
  assert.equal($(w, 'back').hidden, false);
  assert.equal($(w, 'result').hidden, true, 'the next position is live and unanswered');
  clock.t += 5_000;
  click(w, 'back');
  assert.equal($(w, 'reviewChip').hidden, false);
  assert.equal($(w, 'result').hidden, false, 'the full answer is shown');
  assert.match($(w, 'result').textContent, /Move quality:\s*100\/100/);
  assert.ok(w.document.querySelectorAll('#gArrows .arrow').length >= 2, 'arrows are drawn');
  assert.equal(timerText(w), '0:42', 'the time it took then');
  clock.t += 60_000; w.__intervals[0]();
  assert.equal(timerText(w), '0:42', 'and it stays stopped');
  assert.equal(histLen(w), 1, 'nothing is recorded twice');
  assert.equal($(w, 'back').hidden, true, 'this is the earliest');
  assert.equal($(w, 'tryAgain').hidden, false);
  assert.equal($(w, 'skip').hidden, true); assert.equal($(w, 'confirm').hidden, true);
  assert.match(live(w), /Reviewing an earlier position.*timer is stopped/);
  sq(w, 'g1').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(histLen(w), 1, 'the board does not take moves while reviewing');
});

test('Next from a review walks forward through the reviewed ones, then suggests a new position with the timer reset', async () => {
  const clock = { t: 0 };
  const w = await boot(dataOf(ROOK, CAPTURE, EP), { clock });
  clock.t += 10_000; play(w, 'a1', 'a8'); click(w, 'next');   // ROOK answered
  clock.t += 20_000; play(w, 'a1', 'a8'); click(w, 'next');   // CAPTURE answered, EP live
  click(w, 'back'); click(w, 'back');                          // CAPTURE, then ROOK
  assert.equal(timerText(w), '0:10');
  click(w, 'next');
  assert.equal($(w, 'reviewChip').hidden, false, 'still reviewing: the next reviewed position');
  assert.equal(timerText(w), '0:20');
  assert.equal($(w, 'back').hidden, false);
  click(w, 'next');
  assert.equal($(w, 'reviewChip').hidden, true, 'past the last reviewed one: a live position');
  assert.equal($(w, 'result').hidden, true);
  assert.equal(timerText(w), '0:00');
  assert.equal(histLen(w), 2);
});

test('Try again plays the reviewed position afresh: timer reset, board live, and the new guess is recorded', async () => {
  const clock = { t: 0 };
  const w = await boot(dataOf(ROOK, CAPTURE), { clock });
  clock.t += 30_000; play(w, 'g1', 'f1'); click(w, 'next'); // a poor first attempt at ROOK
  click(w, 'back');
  assert.match($(w, 'result').textContent, /Move quality:\s*10\/100/, 'the poor first attempt');
  click(w, 'tryAgain');
  assert.equal($(w, 'reviewChip').hidden, true);
  assert.equal($(w, 'result').hidden, true);
  assert.equal(timerText(w), '0:00');
  clock.t += 7_000; w.__intervals[0]();
  assert.equal(timerText(w), '0:07', 'the timer runs again');
  play(w, 'a1', 'a8');
  assert.match($(w, 'result').textContent, /Move quality:\s*100\/100/);
  const h = JSON.parse(w.localStorage.getItem('gtm.v1.history'));
  assert.equal(h.length, 2); assert.equal(h[1].id, 'rook'); assert.equal(h[1].dur, 7);
  click(w, 'back');
  assert.equal(timerText(w), '0:30', 'Previous from the retry reaches the first attempt');
  click(w, 'next');
  assert.equal($(w, 'reviewChip').hidden, false, 'forward reaches the retry, as a review');
  assert.equal(timerText(w), '0:07');
});

test('Previous also works from the keyboard (p), and a predict-mode guess is reviewed as one', async () => {
  const w = await boot(dataOf(ROOK, CAPTURE));
  w.document.querySelector('input[value=predict]').click();
  play(w, 'g1', 'g2'); click(w, 'next');
  docKey(w, 'p');
  assert.equal($(w, 'reviewChip').hidden, false);
  assert.match($(w, 'result').textContent, /Exact match with the real move/);
  docKey(w, 'p'); // already the earliest: nothing happens
  assert.equal($(w, 'reviewChip').hidden, false);
  docKey(w, 'n');
  assert.equal($(w, 'reviewChip').hidden, true, 'n goes forward');
});

test('changing a filter while reviewing leaves the review for a live position; pasted positions are not part of the trail', async () => {
  const w = await boot(dataOf(ROOK, CAPTURE));
  play(w, 'a1', 'a8'); click(w, 'next'); click(w, 'back');
  assert.equal($(w, 'reviewChip').hidden, false);
  $(w, 'phase').value = 'endgame'; $(w, 'phase').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($(w, 'reviewChip').hidden, true);
  const none = await boot(dataOf(ROOK));
  play(none, 'a1', 'a8');
  assert.equal($(none, 'back').hidden, true, 'the only answered position is the one on screen: nothing earlier');
  click(none, 'back');
  assert.equal($(none, 'reviewChip').hidden, true, 'and a stray Previous does nothing');
});

test('the visit trail keeps the latest 100 answers', async () => {
  const many100 = Array.from({ length: 102 }, (_, i) => ({ ...ROOK, id: 'r' + i }));
  const w = await boot(dataOf(...many100));
  for (let i = 0; i < 102; i++) { play(w, 'a1', 'a8'); click(w, 'next'); }
  let back = 0;
  while (!$(w, 'back').hidden && back < 200) { click(w, 'back'); back++; }
  assert.equal(back, 100, 'all 102 were answered; only the latest 100 can be reviewed, even with no live position left');
});

test('right after answering, Previous goes to the answer before it, not to the one on screen', async () => {
  const clock = { t: 0 };
  const w = await boot(dataOf(ROOK, CAPTURE), { clock });
  clock.t += 11_000; play(w, 'a1', 'a8'); click(w, 'next');
  clock.t += 22_000; play(w, 'a1', 'a8');            // CAPTURE answered and still on screen
  assert.equal($(w, 'back').hidden, false);
  click(w, 'back');
  assert.equal(timerText(w), '0:11', 'the first answer, not the one just given');
  assert.equal($(w, 'back').hidden, true);
  click(w, 'next');
  assert.equal(timerText(w), '0:22', 'forward again reaches the second');
});

/* ---------- the level estimate ---------- */

const ANCHORED = (id, by) => ({ ...ROOK, id, maia: { elo: 1500, probs: {}, by_elo: by } });
const STRONG_AT_HIGH = { 1000: { a1a8: 0.1, g1g2: 0.6, a1a7: 0.2 }, 1600: { a1a8: 0.4, g1g2: 0.3, a1a7: 0.2 }, 2200: { a1a8: 0.8, g1g2: 0.05, a1a7: 0.1 } };
const ALIKE = { 1000: { a1a8: 0.7, g1g2: 0.1 }, 1600: { a1a8: 0.7, g1g2: 0.1 }, 2200: { a1a8: 0.7, g1g2: 0.1 } };
const entryFor = (id, uci, over = {}) => ({ id, mode: 'best', phase: 'endgame', tags: [], cost: 1, score: 90, mb: true, mr: false, mm: false, t: Date.now(), dur: 5, fen: ROOK.fen, uci, opp: 1500, ...over });
const levelData = (n) => dataOf(...Array.from({ length: n }, (_, i) => ANCHORED('h' + i, STRONG_AT_HIGH)));
const levelText = (w) => $(w, 'statsBody').querySelector('.level-card');

test('"Your level" says so when the dataset has no rating data, and how many more guesses are needed before an estimate', async () => {
  let w = await boot(dataOf(ROOK), { ls: { history: many(6) } });
  click(w, 'statsBtn');
  assert.match($(w, 'statsBody').textContent, /carries no rating data for the models/);
  w = await boot(levelData(10), { ls: { history: [entryFor('h0', 'a1a8'), entryFor('h1', 'a1a8')] } });
  click(w, 'statsBtn');
  assert.match(levelText(w).textContent, /Play 3 more positions in "Find the best move" mode/);
  assert.ok(levelText(w).querySelector('#suggestBtn'));
  assert.equal(levelText(w).querySelectorAll('svg.chart').length, 0);
});

test('with five or more first-time guesses the card shows an estimate, its range, a density and the trend; stronger moves give a higher estimate', async () => {
  const hist = (uci) => Array.from({ length: 8 }, (_, i) => entryFor('h' + i, uci, { t: i }));
  const strong = await boot(levelData(10), { ls: { history: hist('a1a8') } });
  click(strong, 'statsBtn');
  const card = levelText(strong), num = (w) => Number(levelText(w).querySelector('.level-big').textContent.match(/\d+/)[0]);
  assert.match(card.querySelector('.level-range').textContent, /80% range \d+ to \d+, from your last 8 first-time guesses/);
  assert.equal(card.querySelectorAll('svg.chart').length, 2, 'density and trend');
  assert.ok(card.querySelector('.ch-band') && card.querySelector('.ch-area') && card.querySelector('.ch-mean'));
  const weak = await boot(levelData(10), { ls: { history: hist('g1g2') } });
  click(weak, 'statsBtn');
  assert.ok(num(strong) > num(weak) + 300, `${num(strong)} vs ${num(weak)}`);
  assert.ok(num(strong) >= 1000 && num(strong) <= 2200);
});

test('only the first time a position was seen counts, and only when it was a best-move guess', async () => {
  const repeats = Array.from({ length: 6 }, (_, i) => entryFor('h0', 'a1a8', { t: i }));
  let w = await boot(levelData(10), { ls: { history: repeats } });
  click(w, 'statsBtn');
  assert.match(levelText(w).textContent, /Play 4 more positions/, 'six looks at one position are one guess');
  const firstInPredict = [entryFor('h0', 'a1a8', { mode: 'predict', t: 0 }), ...Array.from({ length: 5 }, (_, i) => entryFor('h' + (i + 1), 'a1a8', { t: i + 1 })), entryFor('h0', 'a1a8', { t: 9 })];
  w = await boot(levelData(10), { ls: { history: firstInPredict } });
  click(w, 'statsBtn');
  assert.match(levelText(w).textContent, /Play 0 more|80% range/, 'five counted guesses are enough');
  assert.match(levelText(w).querySelector('.level-range').textContent, /from your last 5 first-time guesses/, 'h0 was first met in predict mode: not counted, not counted again');
  w = await boot(levelData(10), { ls: { history: [entryFor('zz-not-in-the-data', 'a1a8'), ...Array.from({ length: 4 }, (_, i) => entryFor('h' + i, 'a1a8', { t: i }))] } });
  click(w, 'statsBtn');
  assert.match(levelText(w).textContent, /Play 1 more position /, 'a guess whose position is no longer in the data is skipped');
});

test('Suggest a position goes back to the board with the position that teaches most, in best-move mode, with a fresh timer and a chip', async () => {
  const clock = { t: 0 };
  const data = dataOf(ANCHORED('same', ALIKE), ANCHORED('hard', STRONG_AT_HIGH), ANCHORED('same2', ALIKE));
  const w = await boot(data, { clock, ls: { history: [entryFor('same', 'a1a8')] } });
  w.document.querySelector('input[value=predict]').click();
  clock.t += 20_000;
  click(w, 'statsBtn');
  click(w, 'suggestBtn');
  await tick();
  assert.equal($(w, 'statsView').hidden, true);
  assert.equal(w.document.querySelector('input[name=mode]:checked').value, 'best');
  assert.equal($(w, 'pickChip').hidden, false);
  assert.match($(w, 'pickChip').textContent, /Chosen to sharpen your estimate \(\d\.\d\d bits\)/);
  assert.equal(timerText(w), '0:00');
  assert.equal($(w, 'result').hidden, true, 'a live, unanswered position');
  clock.t += 4_000; w.__intervals[0]();
  assert.equal(timerText(w), '0:04', 'and the timer is running');
});

test('Suggest does nothing when no position carries rating data or has anything to teach', async () => {
  const w = await boot(dataOf(ROOK), { ls: { history: many(6) } });
  click(w, 'statsBtn');
  assert.equal(w.document.getElementById('suggestBtn'), null, 'the unavailable card has no button');
  const flat = await boot(dataOf(ANCHORED('a', ALIKE), ANCHORED('b', ALIKE)), { ls: { history: [entryFor('a', 'a1a8')] } });
  click(flat, 'statsBtn');
  click(flat, 'suggestBtn');
  assert.equal($(flat, 'statsView').hidden, false, 'stays on the stats page: nothing to suggest');
});

const setPicker = (w, v) => { $(w, 'picker').value = v; $(w, 'picker').dispatchEvent(new w.Event('change', { bubbles: true })); };

test('sharpening the level estimate is the default way of picking; the choice is remembered, an old "off" means random, and it does nothing in predict mode or without rating data', async () => {
  const data = dataOf(ANCHORED('same', ALIKE), ANCHORED('hard', STRONG_AT_HIGH));
  const on = await boot(data);
  assert.equal($(on, 'picker').value, 'sharpen', 'the default');
  assert.equal($(on, 'pickChip').hidden, false, 'the first position is already the informative one (the other teaches nothing)');
  assert.equal($(on, 'chips').hidden, false, 'and the row that holds the chip is shown');
  assert.match($(on, 'pickChip').textContent, /bits/);
  setPicker(on, 'random');
  assert.equal(JSON.parse(on.localStorage.getItem('gtm.v1.picker')), 'random');
  const off = await boot(data, { ls: { picker: 'random' } });
  assert.equal($(off, 'picker').value, 'random');
  assert.equal($(off, 'pickChip').hidden, true);
  assert.equal($(off, 'chips').hidden, true, 'no chip, no row');
  const old = await boot(data, { ls: { adaptive: false } });
  assert.equal($(old, 'picker').value, 'random', 'the first version stored a yes/no');
  const junk = await boot(data, { ls: { picker: 'bogus' } });
  assert.equal($(junk, 'picker').value, 'sharpen', 'an unknown value is the default');
  const predict = await boot(data);
  predict.document.querySelector('input[value=predict]').click();
  click(predict, 'skip');
  assert.equal($(predict, 'pickChip').hidden, true, 'predict mode is not about your level');
  const plain = await boot(dataOf(ROOK, CAPTURE));
  assert.equal($(plain, 'pickChip').hidden, true, 'no rating data: a random position');
  click(plain, 'skip');
  assert.equal($(plain, 'pickChip').hidden, true);
});

/* Five counted guesses give an estimate (STRONG_AT_HIGH played with the weak move: a low level). The candidates are then
 * the positions that were not played. a1a8 is the best move in all of them; `chance` is how often it is chosen at every rating. */
const byChance = (id, chance) => ANCHORED(id, { 1000: { a1a8: chance, g1g2: 0.1 }, 1600: { a1a8: chance, g1g2: 0.1 }, 2200: { a1a8: chance, g1g2: 0.1 } });
const playedFive = () => Array.from({ length: 5 }, (_, i) => ANCHORED('g' + i, STRONG_AT_HIGH));
const withEstimate = (...candidates) => ({ data: dataOf(...playedFive(), ...candidates), ls: { history: playedFive().map((p) => entryFor(p.id, 'g1g2')), seen: playedFive().map((p) => p.id) } });

test('"To match my level" picks a position about half the players at your level solve, and the chip says how many', async () => {
  const { data, ls } = withEstimate(byChance('easy', 0.95), byChance('half', 0.5), byChance('tough', 0.05));
  const w = await boot(data, { ls: { ...ls, picker: 'match' } });
  assert.equal($(w, 'pickChip').hidden, false);
  assert.equal($(w, 'pickChip').textContent, 'Matched to your level (about 50% find the best move)');
});

test('"A bit harder" goes for positions fewer players solve, and with nothing in the band takes the nearest', async () => {
  const { data, ls } = withEstimate(byChance('easy', 0.95), byChance('tough', 0.05));
  const w = await boot(data, { ls: { ...ls, picker: 'harder' } });
  assert.equal($(w, 'pickChip').textContent, 'A bit above your level (about 5% find the best move)');
  const m = await boot(data, { ls: { ...ls, picker: 'match' } });
  assert.equal($(m, 'pickChip').textContent, 'Matched to your level (about 95% find the best move)', 'nothing in 40-70%: the nearer one');
});

test('before five counted guesses matching has no level to go by: the position is random and there is no chip; predict mode is left alone', async () => {
  const data = dataOf(byChance('a', 0.5), byChance('b', 0.5));
  const w = await boot(data, { ls: { picker: 'match' } });
  assert.equal($(w, 'pickChip').hidden, true);
  assert.ok($(w, 'posInfo').textContent.length > 0, 'a position is shown all the same');
  const { data: d2, ls } = withEstimate(byChance('half', 0.5));
  const p = await boot(d2, { ls: { ...ls, picker: 'match' } });
  p.document.querySelector('input[value=predict]').click();
  click(p, 'skip');
  assert.equal($(p, 'pickChip').hidden, true);
});

test('opening the page at #stats before the data has loaded fills in the level card once it arrives', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const data = levelData(10);
  const w = await boot(data, { hash: '#stats', ls: { history: Array.from({ length: 6 }, (_, i) => entryFor('h' + i, 'a1a8', { t: i })) },
    fetchImpl: async () => { await gate; return { ok: true, json: async () => data }; } });
  assert.equal(levelText(w), null, 'no data yet: no level card');
  release(); await tick();
  assert.match(levelText(w).querySelector('.level-big').textContent, /About \d+/);
});

test('a script that failed to load is named on the page instead of breaking the first move', async () => {
  for (const missing of ['stats.js', 'level.js']) {
    const dom = newDom(), w = dom.window;
    w.fetch = async () => ({ ok: true, json: async () => dataOf(ROOK) });
    SCRIPTS.filter((s) => s !== missing && !LAZY.includes(s)).forEach((s) => runScript(dom, s)); // the lazy parts are not run at the start
    await tick();
    const text = $(w, 'prompt').textContent;
    assert.match(text, /Part of the page did not load/);
    assert.ok(text.includes({ 'stats.js': 'GTM_STATS', 'level.js': 'GTM_LEVEL' }[missing]), text);
    assert.equal($(w, 'skeleton').hidden, true);
    assert.equal(w.document.querySelectorAll('[data-sq]').length, 0, 'no half-working board');
  }
  const dom = newDom();
  dom.window.fetch = async () => ({ ok: true, json: async () => dataOf(ROOK) });
  SCRIPTS.filter((s) => s !== 'sound.js').forEach((s) => runScript(dom, s));
  await tick();
  assert.equal(dom.window.document.querySelectorAll('[data-sq]').length, 64, 'sound.js is optional: the page works without it');
});

/* ---------- move tiers ---------- */

const tierLineOf = (w) => $(w, 'result').querySelector('.tier-line');

test('the reveal names the tier of your move, draws the distribution bar and lists every legal move; the table keeps its rows', async () => {
  const w = await boot(dataOf(ROOK));
  play(w, 'a1', 'a8'); // Ra8#: the only move that wins
  assert.match(tierLineOf(w).textContent, /Great\s*Your move beats 100% of the other legal moves\./);
  assert.ok(tierLineOf(w).querySelector('.tier-great'));
  assert.equal($(w, 'result').querySelectorAll('svg.tier-bar').length, 1);
  assert.match($(w, 'result').querySelector('.tier-bar').getAttribute('aria-label'), /The 5 legal moves by tier:/);
  assert.equal($(w, 'result').querySelectorAll('.ml-row').length, 5);
  assert.match($(w, 'result').querySelector('.all-moves summary').textContent, /All 5 legal moves, best to worst/);
  assert.equal($(w, 'result').querySelectorAll('tbody tr').length, 4, 'the table still has you, Stockfish, the real player and Maia');
  assert.ok($(w, 'result').querySelector('tbody .tier.compact'), 'a compact tier badge in every row');
  const first = $(w, 'result').querySelector('.ml-row');
  assert.equal(first.getAttribute('data-uci'), 'a1a8');
  assert.match(first.textContent, /Great/); assert.ok(first.querySelector('.mark-you') && first.querySelector('.mark-best'));
});

test('a poor move is named for what it is, and beats none of the others', async () => {
  const w = await boot(dataOf(ROOK));
  play(w, 'g1', 'f1');
  assert.match(tierLineOf(w).textContent, /Blunder\s*Your move beats 0% of the other legal moves\./);
  assert.ok(tierLineOf(w).querySelector('.tier-blunder'));
});

test('choosing a move in the list draws it on the board, once more takes it off, and a move already drawn adds nothing', async () => {
  const w = await boot(dataOf(ROOK));
  play(w, 'a1', 'a8');
  const arrows = () => w.document.querySelectorAll('#gArrows .arrow').length;
  const row = (u) => $(w, 'result').querySelector(`.ml-row[data-uci="${u}"]`);
  const before = arrows();
  row('a1a7').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(arrows(), before + 1);
  assert.ok(w.document.querySelector('#gArrows .arrow-preview'));
  assert.equal(row('a1a7').getAttribute('aria-pressed'), 'true');
  assert.equal(w.document.querySelector('#gArrows .arrow-preview text').textContent, T_sym('a1a7', w), 'labelled with the tier symbol');
  row('a1a2').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(arrows(), before + 1, 'one preview at a time');
  assert.equal(row('a1a7').getAttribute('aria-pressed'), 'false');
  row('a1a2').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(arrows(), before, 'a second click removes it');
  row('g1g2').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(arrows(), before, 'g1g2 is already drawn (real and Maia): nothing extra');
  click(w, 'next');
  assert.equal(w.document.querySelector('#gArrows .arrow-preview'), null, 'a new position starts clean');
});
function T_sym(uci, w) { return w.GTM_STRINGS.tiers[w.GTM_CLASSIFY.summary(ROOK, 'a1a8').all[uci].tier].sym; }

test('the tier is saved with the guess, shown again in a review, and also in predict mode', async () => {
  const w = await boot(dataOf(ROOK, CAPTURE));
  play(w, 'a1', 'a8'); click(w, 'next');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.history'))[0].tier, 'great');
  click(w, 'back');
  assert.ok(tierLineOf(w).querySelector('.tier-great'), 'the review shows it too');
  const p = await boot(dataOf(ROOK));
  p.document.querySelector('input[value=predict]').click();
  play(p, 'g1', 'g2');
  assert.match(tierLineOf(p).textContent, /(Blunder|Mistake|Inaccuracy|Good|Excellent|Best|Great|Brilliant)\s*Your move beats \d+%/);
});

test('guesses saved before tiers existed get theirs from the dataset on the stats page, and nothing is written back', async () => {
  const old = Array.from({ length: 6 }, (_, i) => entryFor('h' + i, i % 2 ? 'g1g2' : 'a1a8', { t: i, tier: undefined }));
  old.forEach((e) => delete e.tier);
  const w = await boot(levelData(8), { ls: { history: old } });
  click(w, 'statsBtn');
  assert.match($(w, 'statsBody').textContent, /Your moves by tier/);
  const card = [...$(w, 'statsBody').querySelectorAll('figure')].find((f) => /Your moves by tier/.test(f.textContent));
  const values = [...card.querySelectorAll('.ch-value')].map((t) => t.textContent);
  assert.deepEqual(values, ['0 (0%)', '3 (50%)', '0 (0%)', '0 (0%)', '0 (0%)', '0 (0%)', '0 (0%)', '3 (50%)'], 'a1a8 is Great, g1g2 a Blunder: three of each, in tier order');
  assert.match(card.querySelector('figcaption').textContent, /50% of your 6 best-move guesses were Excellent or better/);
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.history'))[0].tier, undefined, 'not saved back');
});

test('finding a great move in best-move mode plays the fanfare; predicting does not', async () => {
  const best = fakeAudio();
  let w = await boot(dataOf(ROOK), { audio: best.Ctx });
  play(w, 'a1', 'a8');
  assert.ok(best.log.includes('f1319'), 'the fanfare');
  const pred = fakeAudio();
  w = await boot(dataOf(ROOK), { audio: pred.Ctx });
  w.document.querySelector('input[value=predict]').click();
  play(w, 'a1', 'a8');
  assert.ok(!pred.log.includes('f1319'));
});

/* ---------- links ---------- */

const HA = { ...ROOK, id: 'aaaaaaaaaa' }, HB = { ...CAPTURE, id: 'bbbbbbbbbb' }, HC = { ...EP, id: 'cccccccccc' };
const linkData = () => dataOf(HA, HB, HC);
const pieceAt = (w, sqName) => w.document.querySelector(`[data-psq="${sqName}"]`);
function clipboard(w, { fail = false } = {}) {
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: (t) => { copied.push(t); return fail ? Promise.reject(new Error('denied')) : Promise.resolve(); } }, configurable: true });
  return copied;
}

test('a link to a position opens it, and the address is cleaned so a reload does not repeat it', async () => {
  const w = await boot(linkData(), { hash: '#p=cccccccccc' });
  assert.ok(pieceAt(w, 'd5') && pieceAt(w, 'e5'), 'the en passant position, not the first one in the data');
  assert.equal($(w, 'result').hidden, true, 'live and unanswered');
  assert.equal(w.location.hash, '');
});

test('a link to an answer opens a review of that move, labelled as shared, and records nothing', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa&m=a1a8' });
  assert.equal($(w, 'reviewChip').hidden, false);
  assert.equal($(w, 'reviewChip').textContent, 'Shared answer');
  assert.equal($(w, 'result').hidden, false);
  assert.ok(tierLineOf(w).querySelector('.tier-great'));
  assert.equal(w.localStorage.getItem('gtm.v1.history'), null, 'someone else\'s answer is not your guess');
  assert.equal($(w, 'back').hidden, true);
  click(w, 'next');
  assert.equal($(w, 'reviewChip').hidden, true, 'Next goes on to a new position');
  assert.equal($(w, 'reviewChip').textContent, 'Review', 'and the label is back to normal for the next review');
});

test('a move that is not legal there is ignored, and an unknown position says so and shows another', async () => {
  let w = await boot(linkData(), { hash: '#p=aaaaaaaaaa&m=h1h8' });
  assert.equal($(w, 'result').hidden, true); assert.equal($(w, 'reviewChip').hidden, true);
  assert.ok(pieceAt(w, 'a1'));
  w = await boot(linkData(), { hash: '#p=dddddddddd' });
  assert.match($(w, 'prompt').textContent, /That position is not in this dataset, so here is another one\./);
  assert.equal(w.document.querySelectorAll('[data-sq]').length, 64);
  w = await boot(linkData(), { hash: '#p=not-an-id' });
  assert.doesNotMatch($(w, 'prompt').textContent, /not in this dataset/, 'a malformed link is just ignored');
});

test('changing the address while the page is open loads the position, and leaves the stats page', async () => {
  const w = await boot(linkData());
  click(w, 'statsBtn');
  assert.equal($(w, 'statsView').hidden, false);
  w.location.hash = '#p=cccccccccc';
  await tick();
  assert.equal($(w, 'statsView').hidden, true);
  assert.ok(pieceAt(w, 'd5'));
  assert.equal(w.location.hash, '');
});

test('the link buttons copy the right addresses, and say so; without a clipboard the link is shown to copy by hand', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  const copied = clipboard(w);
  assert.equal($(w, 'linkBtn').hidden, false);
  click(w, 'linkBtn'); await tick();
  assert.deepEqual(copied, ['http://localhost/#p=aaaaaaaaaa']);
  assert.equal($(w, 'linkMsg').textContent, 'Link copied.');
  play(w, 'a1', 'a8');
  click(w, 'copyAnswer'); await tick();
  assert.equal(copied[1], 'http://localhost/#p=aaaaaaaaaa&m=a1a8');
  assert.equal($(w, 'linkMsg').textContent, 'Link to your answer copied.');
  const none = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  click(none, 'linkBtn');
  assert.equal($(none, 'linkMsg').textContent, 'Copy this link: http://localhost/#p=aaaaaaaaaa');
  const denied = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  clipboard(denied, { fail: true });
  click(denied, 'linkBtn'); await tick();
  assert.match($(denied, 'linkMsg').textContent, /^Copy this link: /);
});

test('every position of the shipped dataset has an id the link router accepts', () => {
  const data = require('../data/positions.json');
  assert.ok(data.positions.every((p) => /^[0-9a-f]{10}$/.test(p.id)));
});

/* ---------- retry your mistakes ---------- */

const six = () => dataOf(...Array.from({ length: 8 }, (_, i) => ({ ...ROOK, id: 'e' + String(i).repeat(9) })));
const srsOf = (w) => JSON.parse(w.localStorage.getItem('gtm.v1.srs') || '{}');
const playsOf = (w) => JSON.parse(w.localStorage.getItem('gtm.v1.plays') || '0');
const bestThenNext = (w) => { play(w, 'a1', 'a8'); click(w, 'next'); };
const blunderThenNext = (w) => { play(w, 'g1', 'f1'); click(w, 'next'); };
const chip = (w) => $(w, 'retryChip').hidden === false;

test('a mistake joins the queue, due after five more positions; a good guess does not', async () => {
  const w = await boot(six());
  bestThenNext(w);
  assert.deepEqual(srsOf(w), {});
  blunderThenNext(w);
  const q = srsOf(w);
  assert.deepEqual(Object.values(q), [{ box: 1, due: 7, ok: 0 }], 'the 2nd play + 5');
  assert.equal(playsOf(w), 2);
});

test('the position comes back when it is due, even though "unseen only" is on, and wears a Retry chip', async () => {
  const w = await boot(six());
  blunderThenNext(w);                                  // play 1: due at 6
  assert.equal(chip(w), false);
  for (let i = 0; i < 5; i++) { assert.equal(chip(w), false, `play ${i + 2}`); bestThenNext(w); }
  assert.equal(chip(w), true, 'six plays done: the mistake is due');
  assert.equal($(w, 'result').hidden, true, 'live, not a review');
  assert.ok(pieceAt(w, 'a1'));
});

test('a good retry moves the position up a box; a retry is never followed by another retry straight away', async () => {
  const w = await boot(six());
  blunderThenNext(w); blunderThenNext(w);              // both queued: due 6 and 7
  for (let i = 0; i < 4; i++) bestThenNext(w);         // plays 3..6
  assert.equal(chip(w), true, 'the first is due at 6');
  bestThenNext(w);                                     // a good retry, play 7
  const boxes = Object.values(srsOf(w)).map((e) => e.box).sort();
  assert.deepEqual(boxes, [1, 2], 'one climbed to box 2, the other still waits in box 1');
  assert.equal(chip(w), false, 'the second one is due too but a retry does not follow a retry');
  bestThenNext(w);
  assert.equal(chip(w), false);
  bestThenNext(w);
  assert.equal(chip(w), true, 'after two ordinary positions it is its turn');
});

test('the switch, predict mode and the phase filter all keep retries away', async () => {
  const off = await boot(six(), { ls: { srson: false } });
  assert.equal($(off, 'srsToggle').checked, false);
  blunderThenNext(off); for (let i = 0; i < 6; i++) bestThenNext(off);
  assert.equal(chip(off), false, 'switched off');
  assert.deepEqual(Object.keys(srsOf(off)).length, 1, 'but the mistake is still queued');
  const pred = await boot(six());
  pred.document.querySelector('input[value=predict]').click();
  play(pred, 'g1', 'f1');
  assert.deepEqual(srsOf(pred), {}, 'predicting is not solving');
  const filtered = await boot(six());
  blunderThenNext(filtered); for (let i = 0; i < 5; i++) bestThenNext(filtered);
  $(filtered, 'unseen').checked = false;
  $(filtered, 'phase').value = 'opening'; $(filtered, 'phase').dispatchEvent(new filtered.Event('change', { bubbles: true }));
  assert.equal($(filtered, 'prompt').textContent.includes('No positions match') || chip(filtered) === false, true);
  const stored = await boot(six());
  $(stored, 'srsToggle').checked = false; $(stored, 'srsToggle').dispatchEvent(new stored.Event('change', { bubbles: true }));
  assert.equal(JSON.parse(stored.localStorage.getItem('gtm.v1.srson')), false);
});

test('the stats page shows how many are due; "Retry one now" jumps to one in best-move mode', async () => {
  const w = await boot(six(), { ls: { srs: { e000000000: { box: 1, due: 99, ok: 0 }, nope: { box: 1, due: 1, ok: 0 } }, plays: 3, history: many(2) } });
  click(w, 'statsBtn');
  const card = $(w, 'statsBody').querySelector('.srs-card');
  assert.match(card.textContent, /Mistakes to retry/); assert.match(card.textContent, /0 due now, 1 in the queue/);
  assert.doesNotMatch(card.textContent, /2 in the queue/, 'an id the dataset does not have is not counted');
  w.document.querySelector('input[value=predict]').click();
  click(w, 'retryNowBtn'); await tick();
  assert.equal($(w, 'statsView').hidden, true);
  assert.equal(w.document.querySelector('input[name=mode]:checked').value, 'best');
  assert.equal(chip(w), true, 'the queued position that exists in the data, even though it is not due yet');
  const empty = await boot(six(), { ls: { history: many(2) } });
  click(empty, 'statsBtn');
  assert.match($(empty, 'statsBody').querySelector('.srs-card').textContent, /Nothing to retry/);
  assert.equal(empty.document.getElementById('retryNowBtn'), null);
});

test('the queue is saved with the stats file, merged back on loading, reset with the stats, and corrupt storage is ignored', async () => {
  const q = { e000000000: { box: 2, due: 30, ok: 1 } };
  const w = await boot(six(), { clock: { t: 0 }, ls: { srs: q, plays: 12, history: many(2) } });
  const got = { text: null }; const RealBlob = w.Blob;
  w.Blob = function (parts, o) { got.text = parts.join(''); return new RealBlob(parts, o); };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; w.HTMLAnchorElement.prototype.click = () => {};
  click(w, 'statsBtn'); click(w, 'exportBtn');
  const body = JSON.parse(got.text);
  assert.deepEqual(body.srs, q); assert.equal(body.plays, 12);
  const other = await boot(six(), { ls: { srs: { e111111111: { box: 1, due: 5, ok: 0 } }, plays: 3, history: many(1) } });
  click(other, 'statsBtn');
  await loadFile(other, JSON.stringify({ app: 'guess-the-move', format: 1, history: many(2), seen: [], srs: { ...q, bad: { box: 9 } }, plays: 12 }));
  assert.deepEqual(Object.keys(srsOf(other)).sort(), ['e000000000', 'e111111111'], 'merged, and the invalid entry dropped');
  assert.equal(playsOf(other), 12, 'the larger play count wins');
  click(other, 'resetStats');
  assert.deepEqual(srsOf(other), {}); assert.equal(playsOf(other), 0);
  const corrupt = await boot(six(), { ls: { srs: 'garbage', plays: 'many' } });
  assert.equal(chip(corrupt), false); bestThenNext(corrupt);
  assert.equal(playsOf(corrupt), 1);
});

/* ---------- training sessions ---------- */

const twelve = () => dataOf(...Array.from({ length: 12 }, (_, i) => ({ ...ROOK, id: 's' + String(i % 10).repeat(8) + (i < 10 ? '0' : '1') })));
const chipText = (w) => $(w, 'sessionChip').textContent;
async function sessionOf(w, moves) { // moves: array of 'good' | 'bad'
  for (const m of moves) { if (m === 'good') play(w, 'a1', 'a8'); else play(w, 'g1', 'f1'); if (!$(w, 'next').hidden) click(w, 'next'); }
}

test('a session counts ten answered positions in best-move mode, with a progress chip, and ends in a report', async () => {
  const w = await boot(twelve());
  assert.equal($(w, 'sessionBtn').hidden, false); assert.equal($(w, 'sessionChip').hidden, true);
  w.document.querySelector('input[value=predict]').click();
  click(w, 'sessionBtn');
  assert.equal(w.document.querySelector('input[name=mode]:checked').value, 'best');
  assert.equal($(w, 'sessionBtn').hidden, true); assert.equal(chipText(w), 'Session 1/10'); assert.equal($(w, 'sessionEnd').hidden, false);
  play(w, 'a1', 'a8');
  assert.equal(chipText(w), 'Session 1/10', 'answered: one done');
  click(w, 'next');
  assert.equal(chipText(w), 'Session 2/10');
  click(w, 'skip');
  assert.equal(chipText(w), 'Session 2/10', 'a skipped position does not count');
  await sessionOf(w, ['bad', 'good', 'good', 'good', 'good', 'good', 'good', 'bad']); // answers 2 to 9
  assert.equal(chipText(w), 'Session 10/10', 'the tenth position is on screen');
  assert.equal($(w, 'next').textContent, 'Next position (n)', 'not answered yet');
  play(w, 'a1', 'a8');
  assert.equal(chipText(w), 'Session 10/10');
  assert.equal($(w, 'next').textContent, 'See report', 'the tenth answer is on screen: Next becomes See report');
  click(w, 'next');
  assert.equal($(w, 'reportView').hidden, false); assert.equal($(w, 'gameMain').hidden, true);
  assert.equal(w.document.activeElement, $(w, 'reportTitle'));
  const kpi = [...$(w, 'reportBody').querySelectorAll('.kpi dd')].map((d) => d.textContent);
  assert.equal(kpi[1], '8/10', 'eight great moves found out of ten');
  assert.equal($(w, 'reportBody').querySelectorAll('.session-row').length, 10);
  const last = JSON.parse(w.localStorage.getItem('gtm.v1.lastSession'));
  assert.deepEqual([last.n, last.found], [10, 8]);
});

test('guesses in predict mode and in positions pasted in do not count for the session', async () => {
  const w = await boot(twelve());
  click(w, 'sessionBtn');
  w.document.querySelector('input[value=predict]').click();
  play(w, 'a1', 'a8'); click(w, 'next');
  assert.equal(chipText(w), 'Session 1/10', 'still on the first: nothing counted');
});

test('ending early shows a shorter report; ending with nothing answered just drops the session', async () => {
  const w = await boot(twelve());
  click(w, 'sessionBtn'); click(w, 'sessionEnd');
  assert.equal($(w, 'reportView').hidden, true); assert.equal($(w, 'sessionBtn').hidden, false); assert.equal($(w, 'sessionChip').hidden, true);
  click(w, 'sessionBtn');
  await sessionOf(w, ['good', 'bad', 'good']);
  click(w, 'sessionEnd');
  assert.equal($(w, 'reportView').hidden, false);
  assert.match($(w, 'reportBody').textContent, /A shorter session: 3 positions answered\./);
});

test('from the report: review a move, copy the summary, start again, go back, or press Escape', async () => {
  const w = await boot(twelve());
  const copied = clipboard(w);
  click(w, 'sessionBtn'); await sessionOf(w, ['bad', 'good', 'good']); click(w, 'sessionEnd');
  click(w, 'reportCopy'); await tick();
  assert.match(copied[0], /^Guess the Move, 3 positions: average move quality \d+, best move found 2 of 3,/);
  assert.match(copied[0], /http:\/\/localhost\/$/m);
  assert.equal($(w, 'reportMsg').textContent, 'Summary copied.');
  w.document.querySelector('.session-row[data-index="0"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($(w, 'reportView').hidden, true); assert.equal($(w, 'reviewChip').hidden, false);
  assert.ok(tierLineOf(w).querySelector('.tier-blunder'), 'the blunder it was');
  assert.equal($(w, 'sessionBtn').hidden, false, 'the session is over');
  click(w, 'sessionBtn'); play(w, 'a1', 'a8'); click(w, 'sessionEnd');
  click(w, 'reportAgain');
  assert.equal($(w, 'reportView').hidden, true); assert.equal(chipText(w), 'Session 1/10');
  click(w, 'sessionEnd');
  play(w, 'a1', 'a8'); click(w, 'sessionEnd');
  docKey(w, 'Escape');
  assert.equal($(w, 'reportView').hidden, true); assert.equal($(w, 'gameMain').hidden, false);
  click(w, 'sessionBtn'); play(w, 'a1', 'a8'); click(w, 'sessionEnd');
  click(w, 'reportBack');
  assert.equal($(w, 'reportView').hidden, true); assert.equal($(w, 'sessionBtn').hidden, false);
});

test('the timer rests while the report is open, and the stats page remembers the last session', async () => {
  const clock = { t: 0 };
  const w = await boot(twelve(), { clock });
  click(w, 'sessionBtn'); await sessionOf(w, ['good', 'good']);
  clock.t += 1000; click(w, 'sessionEnd'); clock.t += 100_000; click(w, 'reportBack');
  clock.t += 3000; w.__intervals[0]();
  assert.equal(timerText(w), '0:03', 'the 100 s in the report were not counted');
  click(w, 'statsBtn');
  assert.match($(w, 'statsBody').textContent, /Last session2 positions, average move quality 100, best move found 2 times\./);
  click(w, 'statsBack'); await tick(); click(w, 'resetStats');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.lastSession')), null);
});

/* ---------- openings ---------- */

const withOpening = (id, opening, eco) => ({ ...ROOK, id, game: { opening, eco } });
const openings = () => dataOf(
  ...Array.from({ length: 6 }, (_, i) => withOpening('o1' + String(i).repeat(8), 'Sicilian Defense: Najdorf Variation', 'B90')),
  ...Array.from({ length: 5 }, (_, i) => withOpening('o2' + String(i).repeat(8), 'Italian Game', 'C50')),
  withOpening('o3000000000', 'Rare <b>Opening</b>: Line', 'A00'),
  { ...ROOK, id: 'o4000000000' });

test('the opening and its ECO code are shown on the position line, and escaped', async () => {
  const w = await boot(openings());
  assert.equal($(w, 'openingLine').hidden, false);
  assert.equal($(w, 'openingLine').textContent, 'Opening: Sicilian Defense: Najdorf Variation (B90)');
  const rare = await boot(dataOf(withOpening('o3000000000', 'Rare <b>Opening</b>: Line', 'A00')));
  assert.equal($(rare, 'openingLine').textContent, 'Opening: Rare <b>Opening</b>: Line (A00)');
  assert.equal(rare.document.querySelectorAll('#openingLine b').length, 0, 'text, not markup');
  const none = await boot(dataOf(ROOK));
  assert.equal($(none, 'openingLine').hidden, true, 'no game data (the demo set): no line');
  assert.equal($(none, 'openingLabel').hidden, true, 'and no filter');
});

test('the opening filter lists families with at least five positions, by size, and narrows the positions', async () => {
  const w = await boot(openings());
  const opts = [...$(w, 'opening').options].map((o) => o.textContent);
  assert.deepEqual(opts, ['Any', 'Sicilian Defense (6)', 'Italian Game (5)'], 'the rare one and the one without data are not offered');
  assert.equal($(w, 'openingLabel').hidden, false);
  $(w, 'opening').value = 'Italian Game'; $(w, 'opening').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match($(w, 'matchCount').textContent, /^5 positions match/);
  assert.match($(w, 'openingLine').textContent, /Italian Game \(C50\)/);
  $(w, 'opening').value = 'any'; $(w, 'opening').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match($(w, 'matchCount').textContent, /^13 positions match/);
});

test('retries respect the opening filter too: a due Sicilian retry stays away while Italian is chosen, and returns when the filter is cleared', async () => {
  const w = await boot(openings(), { ls: { srs: { o100000000: { box: 1, due: 0, ok: 0 } }, plays: 5 } });
  assert.equal($(w, 'retryChip').hidden, false, 'due, no filter: it comes first');
  const choose = (v) => { $(w, 'opening').value = v; $(w, 'opening').dispatchEvent(new w.Event('change', { bubbles: true })); };
  choose('Italian Game');
  click(w, 'skip'); click(w, 'skip');
  assert.equal($(w, 'retryChip').hidden, true);
  assert.match($(w, 'openingLine').textContent, /Italian Game/);
  choose('any');
  assert.equal($(w, 'retryChip').hidden, false, 'the filter no longer excludes it');
  assert.match($(w, 'openingLine').textContent, /Sicilian Defense/);
});

/* ---------- settings page ---------- */

const rectOf = (w, sqName) => { const r = sq(w, sqName); return [Number(r.getAttribute('x')), Number(r.getAttribute('y'))]; };

test('the settings are a page of their own, with the controls that used to be in the panel', async () => {
  const w = await boot(dataOf(ROOK));
  const section = $(w, 'settingsBody');
  for (const id of ['confirmToggle', 'timerToggle', 'srsToggle', 'picker', 'orientation', 'coordsToggle']) assert.ok(section.querySelector('#' + id), id);
  assert.equal($(w, 'panel').querySelector('#confirmToggle'), null, 'no longer in the panel');
  assert.ok($(w, 'settingsView').contains(section));
});

test('board orientation: automatic follows the side to move, White and Black are fixed, and the choice is remembered', async () => {
  const w = await boot(dataOf(ROOK));                         // White to move
  assert.deepEqual(rectOf(w, 'a1'), [0, 700], 'automatic, White to move: a1 bottom left');
  const choose = (win, v) => { $(win, 'orientation').value = v; $(win, 'orientation').dispatchEvent(new win.Event('change', { bubbles: true })); };
  choose(w, 'black');
  assert.deepEqual(rectOf(w, 'a1'), [700, 0], 'Black at the bottom: a1 top right, redrawn at once');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.orientation')), 'black');
  const kept = await boot(dataOf(ROOK), { ls: { orientation: 'black' } });
  assert.deepEqual(rectOf(kept, 'a1'), [700, 0]); assert.equal($(kept, 'orientation').value, 'black');
  const blackToMove = await boot(dataOf(BLACK), { ls: { orientation: 'white' } });
  assert.deepEqual(rectOf(blackToMove, 'a1'), [0, 700], 'White at the bottom even though Black is to move');
  const auto = await boot(dataOf(BLACK));
  assert.deepEqual(rectOf(auto, 'a1'), [700, 0], 'automatic, Black to move');
  const junk = await boot(dataOf(ROOK), { ls: { orientation: 'sideways' } });
  assert.equal($(junk, 'orientation').value, 'auto', 'an unknown stored value is ignored');
});

test('a move still works after the board is turned, and the coordinates can be hidden', async () => {
  const w = await boot(dataOf(ROOK));
  $(w, 'orientation').value = 'black'; $(w, 'orientation').dispatchEvent(new w.Event('change', { bubbles: true }));
  play(w, 'a1', 'a8');
  assert.equal($(w, 'result').hidden, false);
  const c = await boot(dataOf(ROOK));
  assert.equal($(c, 'boardSvg').classList.contains('no-coords'), false);
  $(c, 'coordsToggle').checked = false; $(c, 'coordsToggle').dispatchEvent(new c.Event('change', { bubbles: true }));
  assert.equal($(c, 'boardSvg').classList.contains('no-coords'), true);
  assert.equal(JSON.parse(c.localStorage.getItem('gtm.v1.coords')), false);
  const kept = await boot(dataOf(ROOK), { ls: { coords: false } });
  assert.equal($(kept, 'boardSvg').classList.contains('no-coords'), true); assert.equal($(kept, 'coordsToggle').checked, false);
  const nothing = await boot({ schema: 1, meta: { demo: false }, positions: [] });
  $(nothing, 'orientation').value = 'black'; $(nothing, 'orientation').dispatchEvent(new nothing.Event('change', { bubbles: true }));
  assert.equal($(nothing, 'orientation').value, 'black', 'with no position on screen it only remembers the choice');
});


/* ---------- streaks and the daily goal ---------- */

test('the progress line shows the streak and today against the goal, and moves with every guess', async () => {
  const clock = { t: new Date(2026, 10, 4, 10).getTime() };
  const w = await boot(twelve(), { clock });
  assert.equal($(w, 'progress').textContent, 'Streak 0 · Today 0/10');
  bestThenNext(w); bestThenNext(w);
  assert.equal($(w, 'progress').textContent, 'Streak 2 · Today 2/10');
  blunderThenNext(w);
  assert.equal($(w, 'progress').textContent, 'Streak 0 · Today 3/10');
  clock.t += 24 * 3600 * 1000;
  w.document.getElementById('resetStats').click();
  assert.equal($(w, 'progress').textContent, 'Streak 0 · Today 0/10');
});

test('the goal is chosen in the settings and remembered; no goal shows just the count; an unknown stored goal falls back to 10', async () => {
  const w = await boot(twelve());
  $(w, 'goalSelect').value = '5'; $(w, 'goalSelect').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($(w, 'progress').textContent, 'Streak 0 · Today 0/5');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.goal')), 5);
  $(w, 'goalSelect').value = '0'; $(w, 'goalSelect').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($(w, 'progress').textContent, 'Streak 0 · Today 0');
  assert.equal((await boot(twelve(), { ls: { goal: 20 } })).document.getElementById('goalSelect').value, '20');
  assert.equal((await boot(twelve(), { ls: { goal: 7 } })).document.getElementById('goalSelect').value, '10');
});

test('reaching the daily goal is announced once that day, with a sound', async () => {
  const clock = { t: new Date(2026, 10, 4, 10).getTime() };
  const { Ctx, log } = fakeAudio();
  const w = await boot(twelve(), { clock, audio: Ctx, ls: { goal: 5 } });
  for (let i = 0; i < 4; i++) bestThenNext(w);
  assert.doesNotMatch(live(w), /Daily goal/);
  play(w, 'a1', 'a8');
  assert.match($(w, 'live').textContent, /Daily goal reached: 5 guesses today\./);
  assert.ok(log.includes('f784'), 'a chime');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.goalday')), '2026-11-4');
  click(w, 'next');
  $(w, 'live').textContent = '';
  play(w, 'a1', 'a8');
  assert.doesNotMatch($(w, 'live').textContent, /Daily goal/, 'not again on the sixth');
});

/* ---------- keyboard ---------- */

test('? opens the help page at the keyboard list, s skips the position, and typing in a field does neither', async () => {
  const w = await boot(twelve());
  assert.ok($(w, 'helpKeys').querySelectorAll('tbody tr').length >= 9);
  assert.ok($(w, 'helpView').contains($(w, 'helpKeys')));
  docKey(w, 's');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.seen')).length, 1, 'skipped: counted as seen');
  assert.equal(chipText(w), '');
  docKey(w, '?');
  assert.equal($(w, 'helpView').hidden, false);
  docKey(w, 's');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.seen')).length, 1, 'an open page: no skipping behind it');
  docKey(w, 'Escape');
  play(w, 'a1', 'a8');
  docKey(w, 's');
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.seen')).length, 2, 'after the answer there is nothing to skip (the answered position is only marked seen)');
  const field = await boot(twelve());
  const input = field.document.getElementById('fenInput');
  input.dispatchEvent(new field.KeyboardEvent('keydown', { key: '?', bubbles: true }));
  input.dispatchEvent(new field.KeyboardEvent('keydown', { key: 's', bubbles: true }));
  assert.equal($(field, 'helpView').hidden, true); assert.equal(field.localStorage.getItem('gtm.v1.seen'), null);
});

/* ---------- offline / installable: the page side ---------- */

function fakeSw({ waiting = null, controller = {}, fail = false } = {}) {
  const swListeners = {}, regListeners = {}, posted = [];
  const reg = { waiting, installing: null, addEventListener: (t, f) => { regListeners[t] = f; } };
  const sw = { controller, registered: [], addEventListener: (t, f) => { swListeners[t] = f; },
    register: async (u) => { sw.registered.push(u); if (fail) throw new Error('refused'); return reg; } };
  return { sw, reg, swListeners, regListeners, posted, worker: (state) => ({ state, postMessage: (m) => posted.push(m), addEventListener(t, f) { this.fire = f; } }) };
}

test('the page registers sw.js only on https or localhost, with a stand-in for the browser API', async () => {
  const w = await boot(dataOf(ROOK));
  const insecure = { navigator: {}, location: { hostname: 'example.org', protocol: 'http:' }, document: w.document };
  assert.equal(await w.GTM_PWA.setup(insecure, { sw: fakeSw().sw }), null, 'plain http on a real host: browsers refuse, so do not try');
  assert.equal(await w.GTM_PWA.setup(w, {}), null, 'no serviceWorker in the browser: nothing to do');
  for (const where of [{ hostname: 'localhost', protocol: 'http:' }, { hostname: '127.0.0.1', protocol: 'http:' }, { hostname: 'example.org', protocol: 'https:' }]) {
    const f = fakeSw();
    await w.GTM_PWA.setup({ navigator: {}, location: where, document: w.document }, { sw: f.sw });
    assert.deepEqual(f.sw.registered, ['sw.js'], where.hostname);
  }
  assert.equal($(w, 'updateBar').hidden, true, 'no update waiting: no bar');
  const refused = fakeSw({ fail: true });
  assert.equal(await w.GTM_PWA.setup(w, { sw: refused.sw }), null, 'a refused registration is not an error for the page');
});

test('a waiting build shows the bar, and the page switches only after Reload is pressed', async () => {
  const w = await boot(dataOf(ROOK));
  const f = fakeSw(); const waiting = f.worker('installed'); f.reg.waiting = waiting;
  let reloads = 0;
  await w.GTM_PWA.setup(w, { sw: f.sw, reload: () => { reloads++; } });
  assert.equal($(w, 'updateBar').hidden, false);
  f.swListeners.controllerchange();
  assert.equal(reloads, 0, 'a worker taking over on its own does not reload the page under the user');
  click(w, 'updateBtn');
  assert.deepEqual(f.posted, ['skip']);
  f.swListeners.controllerchange();
  assert.equal(reloads, 1);
});

test('the bar is not shown for a build the page is already running (a plain reload loads the newest page)', async () => {
  const run = async (reply) => {
    const w = await boot(dataOf(ROOK));
    const tag = w.document.createElement('script'); tag.type = 'text/lazy'; tag.setAttribute('src', 'app.js?v=abc123'); w.document.head.appendChild(tag);
    const asked = []; w.fetch = (url, o) => { asked.push([url, o && o.cache]); return reply(); };
    const f = fakeSw(); f.reg.waiting = f.worker('installed');
    await w.GTM_PWA.setup(w, { sw: f.sw });
    await tick();
    return { bar: $(w, 'updateBar').hidden, asked };
  };
  const same = await run(() => Promise.resolve({ json: async () => ({ build: 'abc123' }) }));
  assert.equal(same.bar, true, 'the page is current: nothing to reload for');
  assert.deepEqual(same.asked, [['version.json', 'no-store']]);
  assert.equal((await run(() => Promise.resolve({ json: async () => ({ build: 'def456' }) }))).bar, false, 'a newer build exists: offer it');
  assert.equal((await run(() => Promise.reject(new Error('offline')))).bar, false, 'cannot tell: offer it');
});

test('an update found while the page is open is offered; the very first install is not an update', async () => {
  const w = await boot(dataOf(ROOK));
  const f = fakeSw(); f.reg.installing = f.worker('installing');
  await w.GTM_PWA.setup(w, { sw: f.sw });
  f.regListeners.updatefound();
  f.reg.installing.state = 'installed';
  f.reg.installing.fire();
  assert.equal($(w, 'updateBar').hidden, false, 'a controlled page and a new worker: offer it');
  const w2 = await boot(dataOf(ROOK));
  const first = fakeSw({ controller: null }); first.reg.installing = first.worker('installing');
  await w2.GTM_PWA.setup(w2, { sw: first.sw });
  first.regListeners.updatefound(); first.reg.installing.state = 'installed'; first.reg.installing.fire();
  assert.equal($(w2, 'updateBar').hidden, true, 'no controller yet: this is the first install, nothing to update');
});

/* ---------- report a problem with a position ---------- */

test('the answer card links to a pre-filled issue for the position, built from the repository link, and carries nothing else', async () => {
  const data = { schema: 1, meta: { demo: false, built: '2026-11-03T15:57:07+00:00' }, positions: [{ ...ROOK, id: 'aaaaaaaaaa' }] };
  const w = await boot(data);
  play(w, 'a1', 'a8');
  const a = $(w, 'result').querySelector('#reportIssue');
  assert.equal(a.textContent, 'Report a problem with this position');
  assert.equal(a.getAttribute('href'), 'https://github.com/carlok/guess-the-move/issues/new?template=position.yml&title=Position%20aaaaaaaaaa&position=aaaaaaaaaa&dataset=2026-11-03');
  assert.equal(a.getAttribute('target'), '_blank'); assert.match(a.getAttribute('rel'), /noopener/);
  const plain = await boot(dataOf(ROOK));
  play(plain, 'a1', 'a8');
  assert.match($(plain, 'result').querySelector('#reportIssue').getAttribute('href'), /&dataset=$/, 'no build date in the data: an empty field');
});

/* ---------- saving the answer: the image and the FEN ---------- */

function pngStub(width = 2400, height = 1520) {
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...u32(13), 73, 72, 68, 82, ...u32(width), ...u32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0, ...u32(0), 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82]);
}
function spySave(w) {
  const got = { files: [], blobs: [] };
  const RealBlob = w.Blob;
  w.Blob = function (parts, o) { got.blobs.push({ parts, type: o && o.type }); return new RealBlob(parts, o); };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { got.files.push(this.download); };
  return got;
}

test('after an answer the result offers the image and the FEN; before it nothing is offered', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  assert.equal($(w, 'saveImage'), null);
  play(w, 'a1', 'a8');
  ['saveImage', 'saveFen', 'copyFen'].forEach((id) => assert.ok($(w, id), id));
  assert.match($(w, 'result').textContent, /Save image.*Save FEN.*Copy FEN/);
});

test('"Save image" draws the card of this answer, stores the position in the PNG and downloads it', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa', clock: { t: Date.UTC(2026, 10, 4, 9) } });
  const got = spySave(w), seen = [];
  w.GTM_SHARE.rasterize = async (win, svg, width, height, scale) => { seen.push({ svg, width, height, scale }); return pngStub(width * scale, height * scale); };
  play(w, 'a1', 'a8');
  click(w, 'saveImage');
  assert.equal($(w, 'linkMsg').textContent, 'Drawing the image…');
  await tick();
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].width, seen[0].height, seen[0].scale], [1200, 760, 2]);
  assert.ok(seen[0].svg.includes('Ra8#') && seen[0].svg.includes('2026-11-04') && seen[0].svg.includes('class="arrow'), 'the move, the date and the arrows are on the card');
  assert.deepEqual(got.files, ['guess-the-move-aaaaaaaaaa.png']);
  assert.equal(got.blobs.at(-1).type, 'image/png');
  const info = w.GTM_SHARE.readPng(got.blobs.at(-1).parts[0]);
  assert.equal(info.FEN, HA.fen); assert.equal(info.Software, 'Guess the Move'); assert.equal(info.width, 2400);
  assert.equal($(w, 'linkMsg').textContent, 'Image saved. The FEN is also stored inside the PNG.');
});

test('"Save image" says so when the browser cannot draw it, and works in predict mode and on a flipped board too', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  spySave(w);
  w.GTM_SHARE.rasterize = async () => { throw new Error('the card could not be drawn'); };
  play(w, 'a1', 'a8');
  click(w, 'saveImage'); await tick();
  assert.equal($(w, 'linkMsg').textContent, 'Could not make the image: the card could not be drawn');
  w.GTM_SHARE.rasterize = async () => { throw 'plain'; };
  click(w, 'saveImage'); await tick();
  assert.equal($(w, 'linkMsg').textContent, 'Could not make the image: plain');
  const p = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  const got = spySave(p), svgs = [];
  p.GTM_SHARE.rasterize = async (win, svg) => { svgs.push(svg); return pngStub(); };
  p.document.querySelector('input[value=predict]').checked = true;
  p.document.querySelector('input[value=predict]').dispatchEvent(new p.Event('change', { bubbles: true }));
  await tick();
  play(p, 'a1', 'a8'); click(p, 'saveImage'); await tick();
  assert.equal(svgs.length, 1); assert.deepEqual(got.files, ['guess-the-move-aaaaaaaaaa.png']);
});

test('"Save FEN" downloads the position as a one-line .fen file; "Copy FEN" copies it, or shows it when it cannot', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  const got = spySave(w), copied = clipboard(w);
  play(w, 'a1', 'a8');
  click(w, 'saveFen');
  assert.deepEqual(got.files, ['guess-the-move-aaaaaaaaaa.fen']);
  assert.deepEqual(Array.from(got.blobs.at(-1).parts), [HA.fen + '\n']);
  assert.equal($(w, 'linkMsg').textContent, 'FEN saved.');
  click(w, 'copyFen'); await tick();
  assert.deepEqual(copied, [HA.fen]);
  assert.equal($(w, 'linkMsg').textContent, 'FEN copied.');
  const none = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  play(none, 'a1', 'a8'); click(none, 'copyFen');
  assert.equal($(none, 'linkMsg').textContent, 'Copy this link: ' + HA.fen);
});

function shareSpy(w, over = {}) {
  const calls = [];
  Object.defineProperty(w.navigator, 'share', { value: over.share || (async (d) => { calls.push(d); }), configurable: true });
  if (over.canShare) Object.defineProperty(w.navigator, 'canShare', { value: over.canShare, configurable: true });
  w.GTM_SHARE.rasterize = async (win, svg, width, height, scale) => pngStub(width * scale, height * scale);
  return calls;
}

test('"Share" is offered only where the browser has a share sheet', async () => {
  const none = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  play(none, 'a1', 'a8');
  assert.equal($(none, 'shareAnswer'), null);
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  Object.defineProperty(w.navigator, 'share', { value: async () => {}, configurable: true });
  assert.equal($(w, 'shareAnswer'), null, 'not before the reveal');
  play(w, 'a1', 'a8');
  assert.equal($(w, 'shareAnswer').textContent, 'Share');
  assert.match($(w, 'result').textContent, /Share.*Save image/);
});

test('"Share" sends the card, a line about the answer and the link to it', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  spySave(w);
  const calls = shareSpy(w, { canShare: () => true });
  play(w, 'a1', 'a8');
  click(w, 'shareAnswer');
  assert.equal($(w, 'linkMsg').textContent, 'Drawing the image…');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, 'Guess the Move');
  assert.match(calls[0].text, /^I played Ra8# \(\w+\) on Guess the Move\.$/);
  assert.match(calls[0].url, /#p=aaaaaaaaaa&m=a1a8$/);
  assert.equal(calls[0].files[0].name, 'guess-the-move-aaaaaaaaaa.png');
  assert.equal(w.GTM_SHARE.readPng(new Uint8Array(await calls[0].files[0].arrayBuffer())).FEN, HA.fen);
  assert.equal($(w, 'linkMsg').textContent, 'Shared.');
});

test('"Share" sends no file where the browser cannot share files; closing the sheet is quiet; a failure is reported', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa' });
  spySave(w);
  const calls = shareSpy(w);
  play(w, 'a1', 'a8');
  click(w, 'shareAnswer'); await tick();
  assert.equal('files' in calls[0], false);
  Object.defineProperty(w.navigator, 'share', { value: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })), configurable: true });
  click(w, 'shareAnswer'); await tick();
  assert.equal($(w, 'linkMsg').textContent, '');
  Object.defineProperty(w.navigator, 'share', { value: () => Promise.reject(new Error('not allowed')), configurable: true });
  click(w, 'shareAnswer'); await tick();
  assert.equal($(w, 'linkMsg').textContent, 'Could not make the image: not allowed');
  w.GTM_SHARE.rasterize = async () => { throw new Error('the card could not be drawn'); };
  click(w, 'shareAnswer'); await tick();
  assert.equal($(w, 'linkMsg').textContent, 'Could not make the image: the card could not be drawn');
});

test('"Share" says so when its part of the page cannot be loaded', async () => {
  const w = await boot(dataOf(ROOK), lazyOn({ fail: ['share.js'] }));
  Object.defineProperty(w.navigator, 'share', { value: async () => {}, configurable: true });
  play(w, 'a1', 'a8');
  click(w, 'shareAnswer'); await tick();
  assert.equal($(w, 'linkMsg').textContent, 'That part of the page could not be loaded. Check your connection and try again.');
});

test('the buttons are there when a shared answer is reviewed, and the review is still not recorded', async () => {
  const w = await boot(linkData(), { hash: '#p=aaaaaaaaaa&m=a1a8' });
  ['saveImage', 'saveFen', 'copyFen'].forEach((id) => assert.ok($(w, id), id));
  const got = spySave(w);
  click(w, 'saveFen');
  assert.deepEqual(got.files, ['guess-the-move-aaaaaaaaaa.fen']);
  assert.equal(w.localStorage.getItem('gtm.v1.history'), null);
});

/* ---------- challenges: the daily one, and the ones sent to a friend ---------- */

const SDm = require('../seed.js');
const chPos = (i) => ({ ...ROOK, id: ('c0000000' + String(i).padStart(2, '0')).slice(0, 10) });
const chData = (n = 12) => ({ schema: 1, meta: { demo: false, built: '2026-11-03T15:57:07+00:00' }, positions: Array.from({ length: n }, (_, i) => chPos(i)) });
const noon = () => ({ t: new Date(2026, 10, 4, 12).getTime() });
const tagFor = (data) => SDm.tagOf(data.meta, data.positions.length);
const idsOf = (data, token) => SDm.select(data.positions, token, 5).map((p) => p.id);
/* Answer the live position with the best move and go on; returns the id of the position that was shown (from its link). */
async function answerChallenge(w, copied) {
  click(w, 'linkBtn'); await tick();
  const id = /#p=([0-9a-f]{10})/.exec(copied[copied.length - 1])[1];
  play(w, 'a1', 'a8'); click(w, 'next');
  return id;
}

test('the daily challenge is five fixed positions for today\'s date, in order, with no skipping, and a report at the end', async () => {
  const data = chData(), clock = noon();
  const w = await boot(data, { clock }), copied = clipboard(w);
  assert.equal($(w, 'dailyBtn').textContent, 'Daily challenge');
  click(w, 'dailyBtn');
  assert.equal($(w, 'sessionChip').textContent, 'Daily 1/5');
  assert.equal($(w, 'skip').hidden, true, 'no skipping in a challenge');
  assert.equal($(w, 'challengeRow').hidden, true); assert.equal($(w, 'sessionBtn').hidden, true);
  const shown = [];
  for (let i = 0; i < 5; i++) shown.push(await answerChallenge(w, copied));
  assert.deepEqual(shown, idsOf(data, '20261104'), 'the positions are the ones the date picks, in that order');
  assert.equal($(w, 'reportView').hidden, false);
  assert.equal($(w, 'reportTitle').textContent, 'Daily 2026-11-04');
  assert.equal($(w, 'reportCopy').textContent, 'Copy result');
  assert.equal($(w, 'reportLink').hidden, false);
  const saved = JSON.parse(w.localStorage.getItem('gtm.v1.challenges'));
  assert.deepEqual(Object.keys(saved), ['20261104']); assert.equal(saved['20261104'].score, 100); assert.equal(saved['20261104'].found, 5);
  click(w, 'reportCopy'); await tick();
  assert.equal(copied.at(-1), `Guess the Move · Daily 2026-11-04\n🟦🟦🟦🟦🟦\nMove quality 100 · best move found 5/5\nhttp://localhost/#c=20261104.${tagFor(data)}`);
  assert.equal($(w, 'reportMsg').textContent, 'Result copied.');
  click(w, 'reportLink'); await tick();
  assert.equal(copied.at(-1), `http://localhost/#c=20261104.${tagFor(data)}`);
  assert.equal($(w, 'reportMsg').textContent, 'Challenge link copied.');
  click(w, 'reportBack');
  assert.equal($(w, 'dailyBtn').textContent, 'Daily challenge · done (100)');
});

test('a second page gets the same positions for the same day; another day gets others', async () => {
  const data = chData(30);
  const a = await boot(data, { clock: noon() }), b = await boot(data, { clock: noon() });
  const ca = clipboard(a), cb = clipboard(b);
  click(a, 'dailyBtn'); click(b, 'dailyBtn');
  const first = [await answerChallenge(a, ca), await answerChallenge(b, cb)];
  assert.equal(first[0], first[1]);
  const next = { t: new Date(2026, 10, 5, 12).getTime() };
  const c = await boot(data, { clock: next }), cc = clipboard(c);
  click(c, 'dailyBtn');
  assert.deepEqual(idsOf(data, '20261105'), idsOf(data, '20261105'));
  assert.notDeepEqual(idsOf(data, '20261105'), idsOf(data, '20261104'));
  assert.equal(await answerChallenge(c, cc), idsOf(data, '20261105')[0]);
});

test('only the first full attempt counts; a replay does not overwrite it, and an early end saves nothing', async () => {
  const data = chData(), clock = noon();
  const w = await boot(data, { clock }), copied = clipboard(w);
  click(w, 'dailyBtn');
  for (let i = 0; i < 5; i++) await answerChallenge(w, copied);
  w.localStorage.setItem('gtm.v1.challenges', JSON.stringify({ '20261104': { score: 61, found: 2, n: 5, t: 1 } }));
  click(w, 'reportBack');
  const w2 = await boot(data, { clock, ls: { challenges: { '20261104': { score: 61, found: 2, n: 5, t: 1 } } } }), c2 = clipboard(w2);
  assert.equal($(w2, 'dailyBtn').textContent, 'Daily challenge · done (61)');
  click(w2, 'dailyBtn');
  for (let i = 0; i < 5; i++) await answerChallenge(w2, c2);
  assert.equal(JSON.parse(w2.localStorage.getItem('gtm.v1.challenges'))['20261104'].score, 61, 'the replay did not replace the first result');
  const w3 = await boot(data, { clock }), c3 = clipboard(w3);
  click(w3, 'dailyBtn'); await answerChallenge(w3, c3);
  click(w3, 'sessionEnd');
  assert.equal($(w3, 'reportView').hidden, false);
  assert.equal(w3.localStorage.getItem('gtm.v1.challenges'), null, 'a shortened attempt is not a result');
  assert.match($(w3, 'reportBody').textContent, /A shorter session: 1 position answered/);
});

test('a link starts the challenge it names, cleans the address, and is the same as the one the report copies', async () => {
  const data = chData(), code = SDm.code('k3j9xz', tagFor(data));
  const w = await boot(data, { hash: '#c=' + code }), copied = clipboard(w);
  assert.equal($(w, 'sessionChip').textContent, 'Challenge 1/5');
  assert.equal(w.location.hash, '', 'the address is cleaned');
  assert.equal(await answerChallenge(w, copied), idsOf(data, 'k3j9xz')[0]);
  const late = await boot(data, { hash: '#settings' });
  late.location.hash = '#c=' + code; await tick();
  assert.equal($(late, 'sessionChip').textContent, 'Challenge 1/5', 'also when the page is already open');
  assert.equal($(late, 'settingsView').hidden, true);
});

test('a link made with a different dataset says so and shows a normal position; a bad code is ignored; too few positions says so', async () => {
  const data = chData();
  const other = await boot(data, { hash: '#c=k3j9xz.0000' });
  assert.equal($(other, 'sessionChip').hidden, true);
  assert.match($(other, 'prompt').textContent, /different set of positions/);
  assert.ok($(other, 'posInfo').textContent.length > 0, 'a position is shown all the same');
  const bad = await boot(data, { hash: '#c=nonsense' });
  assert.equal($(bad, 'sessionChip').hidden, true);
  const tiny = { schema: 1, meta: { demo: false }, positions: [{ ...ROOK, id: 'c000000001', evals: { a1a8: 1, g1g2: 0 }, san: { a1a8: 'Ra8', g1g2: 'Kg2' } }] };
  const few = await boot(tiny);
  click(few, 'dailyBtn');
  assert.equal($(few, 'sessionChip').hidden, true);
  assert.match($(few, 'prompt').textContent, /not enough positions/);
});

test('"Challenge a friend" starts a new challenge with a fresh code, and its link reproduces it', async () => {
  const data = chData(), w = await boot(data), copied = clipboard(w);
  click(w, 'friendBtn');
  assert.equal($(w, 'sessionChip').textContent, 'Challenge 1/5');
  const shown = [];
  for (let i = 0; i < 5; i++) shown.push(await answerChallenge(w, copied));
  assert.equal($(w, 'reportTitle').textContent, 'Challenge 000000', 'Math.random is 0 in the tests');
  click(w, 'reportLink'); await tick();
  const link = copied.at(-1);
  assert.match(link, /^http:\/\/localhost\/#c=000000\.[0-9a-f]{4}$/);
  const friend = await boot(data, { hash: link.slice(link.indexOf('#')) }), fc = clipboard(friend);
  assert.equal(await answerChallenge(friend, fc), shown[0]);
});

test('saved results are untrusted: junk entries are ignored, valid ones kept, and "Reset stats" clears them', async () => {
  const data = chData();
  const w = await boot(data, { clock: noon(), ls: { challenges: { '20261104': { score: 77.4, found: 3, n: 5, t: 5 }, 'bad key!': { score: 1, t: 1 }, '20261103': { score: 'x', t: 1 }, k3j9xz: null } } });
  assert.equal($(w, 'dailyBtn').textContent, 'Daily challenge · done (77)');
  const junk = await boot(data, { clock: noon(), ls: { challenges: [1, 2, 3] } });
  assert.equal($(junk, 'dailyBtn').textContent, 'Daily challenge');
  const str = await boot(data, { clock: noon(), ls: { challenges: 'nope' } });
  assert.equal($(str, 'dailyBtn').textContent, 'Daily challenge');
  click(w, 'resetStats'); await tick();
  assert.equal($(w, 'dailyBtn').textContent, 'Daily challenge');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('gtm.v1.challenges')), {});
});

test('more than sixty saved results keep the newest sixty', async () => {
  const data = chData(), clock = noon();
  const many60 = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['t' + String(i).padStart(3, '0'), { score: 50, found: 1, n: 5, t: 100 + i }]));
  const w = await boot(data, { clock, ls: { challenges: many60 } }), copied = clipboard(w);
  click(w, 'dailyBtn');
  for (let i = 0; i < 5; i++) await answerChallenge(w, copied);
  const saved = JSON.parse(w.localStorage.getItem('gtm.v1.challenges'));
  assert.equal(Object.keys(saved).length, 60);
  assert.ok(saved['20261104'] && !saved.t000, 'the oldest went');
});

/* ---------- parts of the page that load when first used ---------- */

const lazyOn = (over = {}) => ({ lazy: { ...over } });

test('at the start only what the first move needs is loaded: no image saving, no stats file, no charts', async () => {
  const w = await boot(dataOf(ROOK), lazyOn());
  assert.equal(w.GTM_SHARE, undefined); assert.equal(w.GTM_BACKUP, undefined); assert.equal(w.GTM_STATSCHARTS, undefined);
  assert.equal(w.document.querySelectorAll('[data-sq]').length, 64, 'the board is drawn without them');
  assert.equal($(w, 'timer').textContent, '0:00');
  assert.match($(w, 'progress').textContent, /Streak 0/, 'the streak line works from the small stats module');
  assert.deepEqual(w.__lazyLoads, []);
  assert.equal(w.document.querySelectorAll('script[type="text/lazy"]').length, 5, 'the five lazy parts stay listed in the page');
});

test('the service worker part is fetched after the page has loaded, not before, and runs its setup', async () => {
  const w = await boot(dataOf(ROOK), lazyOn());
  w.__GTM_NO_PWA = false;
  w.dispatchEvent(new w.Event('load'));
  await tick();
  assert.deepEqual(w.__lazyLoads, ['pwa.js']);
  assert.equal(typeof w.GTM_PWA.setup, 'function');
});

test('the session report loads its part when the first session ends, and says so when it cannot', async () => {
  const w = await boot(dataOf(ROOK, CAPTURE), lazyOn());
  click(w, 'sessionBtn');
  play(w, 'a1', 'a8');
  assert.deepEqual(w.__lazyLoads, [], 'nothing about the report is fetched while playing');
  click(w, 'sessionEnd'); await tick();
  assert.deepEqual(w.__lazyLoads, ['report.js']);
  assert.equal($(w, 'reportView').hidden, false);
  assert.match($(w, 'reportBody').textContent, /\S/, 'the report is drawn');
  click(w, 'reportCopy'); await tick();
  const bad = await boot(dataOf(ROOK, CAPTURE), lazyOn({ fail: ['report.js'] }));
  click(bad, 'sessionBtn'); play(bad, 'a1', 'a8');
  click(bad, 'sessionEnd'); await tick();
  assert.equal($(bad, 'reportView').hidden, true, 'the board stays');
  assert.equal($(bad, 'linkMsg').textContent, 'That part of the page could not be loaded. Check your connection and try again.');
});

test('the stats page loads its charts the first time, shows a loading line meanwhile, and draws at once afterwards', async () => {
  const w = await boot(dataOf(ROOK), { ...lazyOn(), ls: { history: many(12) } });
  click(w, 'statsBtn');
  assert.equal($(w, 'statsBody').textContent, 'Loading…');
  await tick();
  assert.deepEqual(w.__lazyLoads, ['statscharts.js']);
  assert.ok($(w, 'statsBody').querySelector('.chart-card'), 'the charts are there');
  click(w, 'statsBack'); await tick();
  click(w, 'statsBtn');
  assert.ok($(w, 'statsBody').querySelector('.chart-card'), 'drawn straight away this time');
  assert.deepEqual(w.__lazyLoads, ['statscharts.js'], 'not fetched twice');
});

test('saving the FEN loads the image module once even when asked twice, and the later save needs no loading', async () => {
  const w = await boot(dataOf(ROOK), lazyOn()), got = spySave(w);
  play(w, 'a1', 'a8');
  click(w, 'saveFen'); click(w, 'saveFen');
  assert.deepEqual(w.__lazyLoads, ['share.js'], 'one request for two clicks');
  await tick();
  assert.deepEqual(got.files, ['guess-the-move-rook.fen', 'guess-the-move-rook.fen'].slice(0, 2).map((n) => n.replace('rook', ROOK.id)));
  click(w, 'saveFen');
  assert.equal(got.files.length, 3, 'saved at once');
  w.GTM_SHARE.rasterize = async () => pngStub();
  click(w, 'saveImage'); await tick();
  assert.equal(got.files.at(-1), `guess-the-move-${ROOK.id}.png`);
  assert.deepEqual(w.__lazyLoads, ['share.js']);
});

test('the stats file is loaded on the first download or load, and both work through it', async () => {
  const w = await boot(dataOf(ROOK), { ...lazyOn(), ls: { history: many(3), seen: ['p0'] } }), got = spyDownload(w);
  click(w, 'statsBtn'); await tick();
  click(w, 'exportBtn'); await tick();
  assert.deepEqual(w.__lazyLoads, ['statscharts.js', 'backup.js']);
  assert.equal(got.files.length, 1);
  const text = got.text;
  const fresh = await boot(dataOf(ROOK), lazyOn());
  click(fresh, 'statsBtn'); await tick();
  await loadFile(fresh, text);
  assert.ok(fresh.__lazyLoads.includes('backup.js'));
  assert.match($(fresh, 'backupMsg').textContent, /^Loaded 3 new guesses/);
  assert.equal(JSON.parse(fresh.localStorage.getItem('gtm.v1.history')).length, 3);
});

test('when a part cannot be loaded the place that needed it says so, and nothing else breaks', async () => {
  const w = await boot(dataOf(ROOK), lazyOn({ fail: ['share.js', 'backup.js', 'statscharts.js'] }));
  const msg = 'That part of the page could not be loaded. Check your connection and try again.';
  play(w, 'a1', 'a8');
  click(w, 'saveFen'); await tick();
  assert.equal($(w, 'linkMsg').textContent, msg);
  click(w, 'saveImage'); await tick();
  assert.equal($(w, 'linkMsg').textContent, msg);
  click(w, 'statsBtn'); await tick();
  assert.equal($(w, 'statsBody').textContent, msg);
  click(w, 'exportBtn'); await tick();
  assert.equal($(w, 'backupMsg').textContent, msg);
  await loadFile(w, '{}');
  assert.equal($(w, 'backupMsg').textContent, msg);
  assert.equal($(w, 'reportView').hidden, true); assert.equal($(w, 'result').hidden, false, 'the answer is still shown');
});

test('a part that loads but defines nothing counts as a failure, and a second try can still succeed', async () => {
  const w = await boot(dataOf(ROOK), lazyOn({ empty: ['share.js'] }));
  play(w, 'a1', 'a8');
  click(w, 'saveFen'); await tick();
  assert.equal($(w, 'linkMsg').textContent, 'That part of the page could not be loaded. Check your connection and try again.');
  click(w, 'saveFen'); await tick();
  assert.deepEqual(w.__lazyLoads, ['share.js', 'share.js'], 'asked again after the failure');
});

test('a lazy part is requested under the address the build stamped, not the bare name', async () => {
  const dom = newDom({ lazy: true }), w = dom.window;
  const tag = w.document.querySelector('script[type="text/lazy"][src^="share.js"]');
  tag.setAttribute('src', 'share.js?v=abc123');
  w.fetch = async () => ({ ok: true, json: async () => dataOf(ROOK) });
  loadApp(dom, { lazy: true }); await tick();
  w.localStorage.setItem('gtm.v1.onboarded', 'true');
  play(w, 'a1', 'a8');
  spySave(w);
  const seen = [];
  const append = w.document.head.appendChild;
  w.document.head.appendChild = function (el) { seen.push(el.getAttribute('src')); return append.call(this, el); };
  click(w, 'saveFen'); await tick();
  assert.deepEqual(seen, ['share.js?v=abc123']);
});

/* ---------- focus mode: only the board and the timer until you move ---------- */

const rootOf = (w) => w.document.documentElement;
const inFocus = (w) => rootOf(w).classList.contains('focus-mode');
function fakeFullscreen(w, { reject = false } = {}) {
  const calls = { enter: 0, exit: 0 };
  let el = null;
  Object.defineProperty(w.document, 'fullscreenElement', { get: () => el, configurable: true });
  rootOf(w).requestFullscreen = () => { calls.enter++; if (reject) return Promise.reject(new Error('denied')); el = rootOf(w); return Promise.resolve(); };
  w.document.exitFullscreen = () => { calls.exit++; el = null; return Promise.resolve(); };
  calls.end = () => { el = null; w.document.dispatchEvent(new w.Event('fullscreenchange')); }; // the browser's own Esc
  return calls;
}

test('the focus button is on the board, labelled, and toggles the mode, its label and its pressed state', async () => {
  const w = await boot(dataOf(ROOK));
  const b = $(w, 'focusBtn');
  assert.equal(b.classList.contains('off'), false); assert.equal(b.getAttribute('aria-label'), 'Focus on the board'); assert.equal(b.getAttribute('aria-pressed'), 'false');
  click(w, 'focusBtn');
  assert.equal(inFocus(w), true);
  assert.equal(b.getAttribute('aria-label'), 'Back to the full page'); assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.equal($(w, 'timer').hidden, false, 'the timer stays');
  click(w, 'focusBtn');
  assert.equal(inFocus(w), false); assert.equal(b.getAttribute('aria-label'), 'Focus on the board');
});

test('the late "left full screen" event after Esc does not switch off a focus mode started in the meantime', async () => {
  const w = await boot(dataOf(ROOK)), fs = fakeFullscreen(w);
  click(w, 'focusBtn'); await tick();
  docKey(w, 'Escape'); await tick();
  assert.equal(inFocus(w), false); assert.equal(fs.exit, 1);
  rootOf(w).requestFullscreen = () => new Promise(() => {}); // the browser is still busy leaving: the new request is pending
  docKey(w, 'f');
  assert.equal(inFocus(w), true);
  w.document.dispatchEvent(new w.Event('fullscreenchange')); // the event for our own exit arrives late
  assert.equal(inFocus(w), true, 'our own exit does not undo the new focus mode');
  w.document.dispatchEvent(new w.Event('fullscreenchange')); // a second event with no full screen is the person leaving it
  assert.equal(inFocus(w), false, 'a real Esc in the browser still ends it');
});

test('a refused exit does not make the next real Esc get ignored', async () => {
  const w = await boot(dataOf(ROOK)), fs = fakeFullscreen(w);
  click(w, 'focusBtn'); await tick();
  w.document.exitFullscreen = () => Promise.reject(new Error('refused'));
  click(w, 'focusBtn'); await tick();
  assert.equal(inFocus(w), false);
  click(w, 'focusBtn'); await tick();
  assert.equal(inFocus(w), true);
  fs.end();
  assert.equal(inFocus(w), false, 'the person\'s Esc counts');
});

test('it asks the browser for full screen too, and leaves it again; a refusal keeps the page-level mode', async () => {
  const w = await boot(dataOf(ROOK)), fs = fakeFullscreen(w);
  click(w, 'focusBtn'); await tick();
  assert.equal(fs.enter, 1); assert.equal(inFocus(w), true);
  click(w, 'focusBtn'); await tick();
  assert.equal(fs.exit, 1); assert.equal(inFocus(w), false);
  const denied = await boot(dataOf(ROOK)); fakeFullscreen(denied, { reject: true });
  click(denied, 'focusBtn'); await tick();
  assert.equal(inFocus(denied), true, 'refused: still focused on the page');
  const plain = await boot(dataOf(ROOK));
  click(plain, 'focusBtn');
  assert.equal(inFocus(plain), true, 'no full screen API: still works');
  click(plain, 'focusBtn');
  assert.equal(inFocus(plain), false);
});

test('Esc in the browser\'s full screen ends the focus mode too', async () => {
  const w = await boot(dataOf(ROOK)), fs = fakeFullscreen(w);
  click(w, 'focusBtn'); await tick();
  w.document.dispatchEvent(new w.Event('fullscreenchange'));
  assert.equal(inFocus(w), true, 'entering full screen is not a reason to leave');
  fs.end();
  assert.equal(inFocus(w), false);
  fs.end();
  assert.equal(inFocus(w), false, 'a full screen change with no focus mode does nothing');
});

test('f toggles it, Cmd/Ctrl+F is left to the browser, and Escape leaves it', async () => {
  const w = await boot(dataOf(ROOK));
  docKey(w, 'f'); assert.equal(inFocus(w), true);
  docKey(w, 'Escape'); assert.equal(inFocus(w), false);
  docKey(w, 'F'); assert.equal(inFocus(w), true);
  docKey(w, 'f'); assert.equal(inFocus(w), false);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
  assert.equal(inFocus(w), false);
  const field = await boot(dataOf(ROOK));
  const input = field.document.getElementById('fenInput');
  input.dispatchEvent(new field.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
  assert.equal(inFocus(field), false, 'typing in a field does not toggle it');
});

test('selecting a piece keeps the focus mode; making the move leaves it, whether it is revealed at once or waits for a confirm', async () => {
  const w = await boot(dataOf(ROOK), { confirm: false });
  click(w, 'focusBtn');
  sq(w, 'a1').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(inFocus(w), true, 'a selected piece is not a move');
  sq(w, 'a8').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(inFocus(w), false); assert.equal($(w, 'result').hidden, false);
  const c = await boot(dataOf(ROOK), { confirm: true });
  click(c, 'focusBtn'); play(c, 'a1', 'a8');
  assert.equal(inFocus(c), false, 'with confirmation the move is proposed first: already back, so the Confirm button can be seen');
  assert.equal($(c, 'confirm').hidden, false);
  const d = await boot(dataOf(ROOK), { confirm: false });
  click(d, 'focusBtn');
  drag(d, 'a1', 'a8');
  assert.equal(inFocus(d), false, 'a drag counts too');
});

test('a promotion leaves it as soon as the piece is chosen to be asked, so the chooser can be seen', async () => {
  const w = await boot(dataOf(PROMO), { confirm: false });
  click(w, 'focusBtn'); play(w, 'a7', 'a8');
  assert.equal(inFocus(w), false); assert.equal($(w, 'promo').hidden, false);
});

test('a new position, a page, or having answered all leave it; the button is not offered after the answer or in a review', async () => {
  const w = await boot(dataOf(ROOK, CAPTURE));
  click(w, 'focusBtn'); click(w, 'skip');
  assert.equal(inFocus(w), false, 'a new position is shown in the normal layout');
  click(w, 'focusBtn'); click(w, 'settingsBtn');
  assert.equal(inFocus(w), false, 'a page needs the whole page');
  click(w, 'settingsBack'); await tick();
  play(w, 'a1', 'a8');
  assert.equal($(w, 'focusBtn').classList.contains('off'), true, 'nothing to focus on once the answer is shown (it keeps its place, invisible)');
  docKey(w, 'f'); assert.equal(inFocus(w), false, 'and f does nothing then');
  click(w, 'next'); click(w, 'back');
  assert.equal($(w, 'focusBtn').classList.contains('off'), true, 'not in a review either');
});
