'use strict';
/* Pointer, keyboard, confirm, onboarding, theme and error-state wiring in jsdom.
 * jsdom has no layout, so these tests stub getBoundingClientRect (the board is 800x800 at the origin: client pixels equal
 * viewBox units). They check that events change state correctly; anything that depends on real geometry, scrolling or touch
 * behaviour is checked in a real browser by web/e2e. The fixtures are SYNTHETIC hand-written evals. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { newDom, loadApp, runScript, SCRIPTS } = require('./harness');
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

async function boot(data, { confirm, onboarded = true, theme, media = {}, fetchImpl, online, audio, clock, hash, ls = {} } = {}) {
  const dom = newDom();
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
  loadApp(dom);
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

test('onboarding appears on first run, closes, is remembered, and the menu brings the tour back', async () => {
  const w = await boot(dataOf(ROOK), { onboarded: false });
  assert.equal($(w, 'onboarding').hidden, false);
  $(w, 'onboardingClose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($(w, 'onboarding').hidden, true);
  assert.equal(JSON.parse(w.localStorage.getItem('gtm.v1.onboarded')), true);
  $(w, 'menuBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  $(w, 'tourBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($(w, 'onboarding').hidden, false);
  assert.equal($(w, 'menu').hidden, true, 'the menu steps aside for the tour');
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

test('the menu opens as a modal dialog, moves focus in, and Escape closes it and returns focus', async () => {
  const w = await boot(dataOf(ROOK));
  assert.equal($(w, 'menu').hidden, true);
  assert.equal($(w, 'menuBtn').getAttribute('aria-expanded'), 'false');
  $(w, 'menuBtn').focus();
  click(w, 'menuBtn');
  assert.equal($(w, 'menu').hidden, false);
  assert.equal($(w, 'menuBtn').getAttribute('aria-expanded'), 'true');
  assert.equal(w.document.activeElement, $(w, 'menuClose'));
  assert.ok(w.document.documentElement.classList.contains('menu-open'));
  docKey(w, 'Escape');
  assert.equal($(w, 'menu').hidden, true);
  assert.equal($(w, 'menuBackdrop').hidden, true);
  assert.equal($(w, 'menuBtn').getAttribute('aria-expanded'), 'false');
  assert.equal(w.document.activeElement, $(w, 'menuBtn'));
  assert.ok(!w.document.documentElement.classList.contains('menu-open'));
});

test('the menu closes with its button, its backdrop, and the hamburger toggles it', async () => {
  const w = await boot(dataOf(ROOK));
  click(w, 'menuBtn'); click(w, 'menuClose');
  assert.equal($(w, 'menu').hidden, true);
  click(w, 'menuBtn'); click(w, 'menuBackdrop');
  assert.equal($(w, 'menu').hidden, true);
  click(w, 'menuBtn'); click(w, 'menuBtn');
  assert.equal($(w, 'menu').hidden, true);
});

test('while the menu is open the board shortcuts are off and Tab stays inside it', async () => {
  const w = await boot(dataOf(ROOK));
  click(w, 'menuBtn');
  docKey(w, 'n');
  assert.equal($(w, 'menu').hidden, false, 'an unrelated key leaves the menu open');
  const items = [...$(w, 'menu').querySelectorAll('a[href], button:not([disabled])')];
  items[items.length - 1].focus();
  const tab = new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  items[items.length - 1].dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(w.document.activeElement, items[0], 'Tab from the last control wraps to the first');
  const back = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  items[0].dispatchEvent(back);
  assert.equal(w.document.activeElement, items[items.length - 1], 'Shift+Tab from the first wraps to the last');
  const mid = new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  items[1].focus(); items[1].dispatchEvent(mid);
  assert.equal(mid.defaultPrevented, false, 'Tab in the middle is left to the browser');
  const other = new w.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  items[1].dispatchEvent(other);
  assert.equal(other.defaultPrevented, false);
});

test('"The data" is written from the dataset\'s own provenance', async () => {
  const data = { schema: 1, meta: { demo: false, source: 'lichess_db_standard_rated_2026-09.pgn.zst', built: '2026-11-03T15:57:07+00:00', provenance: PROVENANCE },
    positions: [withGame('2026.09.01'), withGame('2026.09.01')] };
  const w = await boot(data);
  click(w, 'menuBtn');
  const text = $(w, 'aboutData').textContent;
  assert.match(text, /2 positions from real Lichess games, played on 2026\.09\.01/);
  assert.match(text, /Stockfish 19 scored every legal move.*400,000 nodes/);
  assert.match(text, /maia3-23m.*last 8 positions/);
  assert.match(text, /lichess_db_standard_rated_2026-09\.pgn\.zst \(CC0\)/);
  assert.match(text, /Built on 2026-11-03/);
  assert.match(text, /Player names are not stored\. Each result links to the original game/);
});

test('"The data" gives a date range, says when usernames are stored, and never claims what the file does not say', async () => {
  const stored = { schema: 1, meta: { demo: false, provenance: { ...PROVENANCE, players_stored: true } }, positions: [withGame('2026.09.01'), withGame('2026.09.30')] };
  const w = await boot(stored);
  click(w, 'menuBtn');
  assert.match($(w, 'aboutData').textContent, /played between 2026\.09\.01 and 2026\.09\.30/);
  assert.match($(w, 'aboutData').textContent, /also stores the players' Lichess usernames/);
  assert.doesNotMatch($(w, 'aboutData').textContent, /names are not stored/);
});

test('"The data" copes with demo data that has no provenance, no rating model and no games', async () => {
  const w = await boot({ schema: 1, meta: { demo: true, engine: 'Stockfish 19', nodes: 1000 }, positions: [ROOK] });
  click(w, 'menuBtn');
  const text = $(w, 'aboutData').textContent;
  assert.match(text, /^1 positions from real Lichess games\./);
  assert.match(text, /no human-model \(Maia\) data/);
  assert.doesNotMatch(text, /names/i, 'no claim about names without provenance');
  assert.doesNotMatch(text, /Built on|Source file/);
});

test('"The data" shows its loading line before the dataset arrives, then fills in', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = await boot(dataOf(ROOK), { fetchImpl: async () => { await gate; return { ok: true, json: async () => dataOf(ROOK) }; } });
  click(w, 'menuBtn');
  assert.equal($(w, 'aboutData').textContent, 'Loading…');
  release(); await tick();
  assert.match($(w, 'aboutData').textContent, /1 positions from real Lichess games/);
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

test('other actions have sounds: a stray click is an error tick, deselecting, confirm-pending, skip/next, theme and menu', async () => {
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
  assert.ok(heard(() => click(w, 'menuBtn')).includes('f880'), 'menu opens');
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

test('the timer pauses while the menu or the stats view is open and when the tab is hidden', async () => {
  const clock = { t: 0 };
  const w = await boot(dataOf(ROOK), { clock });
  clock.t += 10_000;
  click(w, 'menuBtn'); clock.t += 100_000; click(w, 'menuClose');
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
  assert.equal($(w, 'statsBody').querySelectorAll('.kpi').length, 7);
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

test('the adaptive setting picks the most informative position, is remembered, and does nothing in predict mode or without rating data', async () => {
  const data = dataOf(ANCHORED('same', ALIKE), ANCHORED('hard', STRONG_AT_HIGH));
  const off = await boot(data);
  assert.equal($(off, 'adaptiveToggle').checked, false);
  assert.equal($(off, 'pickChip').hidden, true);
  const on = await boot(data, { ls: { adaptive: true } });
  assert.equal($(on, 'adaptiveToggle').checked, true);
  assert.equal($(on, 'pickChip').hidden, false, 'the first position is already the informative one (the other teaches nothing)');
  assert.match($(on, 'pickChip').textContent, /bits/);
  $(on, 'adaptiveToggle').checked = false; $(on, 'adaptiveToggle').dispatchEvent(new on.Event('change', { bubbles: true }));
  assert.equal(JSON.parse(on.localStorage.getItem('gtm.v1.adaptive')), false);
  const predict = await boot(data, { ls: { adaptive: true } });
  predict.document.querySelector('input[value=predict]').click();
  click(predict, 'skip');
  assert.equal($(predict, 'pickChip').hidden, true, 'predict mode is not about your level');
  const plain = await boot(dataOf(ROOK, CAPTURE), { ls: { adaptive: true } });
  click(plain, 'skip');
  assert.equal($(plain, 'pickChip').hidden, true, 'no rating data: a random position');
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
  for (const missing of ['stats.js', 'level.js', 'backup.js']) {
    const dom = newDom(), w = dom.window;
    w.fetch = async () => ({ ok: true, json: async () => dataOf(ROOK) });
    SCRIPTS.filter((s) => s !== missing).forEach((s) => runScript(dom, s));
    await tick();
    const text = $(w, 'prompt').textContent;
    assert.match(text, /Part of the page did not load/);
    assert.ok(text.includes({ 'stats.js': 'GTM_STATS', 'level.js': 'GTM_LEVEL', 'backup.js': 'GTM_BACKUP' }[missing]), text);
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
