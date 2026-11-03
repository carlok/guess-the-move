'use strict';
/* Pointer, keyboard, confirm, onboarding, theme and error-state wiring in jsdom.
 * jsdom has no layout, so these tests stub getBoundingClientRect (the board is 800x800 at the origin: client pixels equal
 * viewBox units). They check that events change state correctly; anything that depends on real geometry, scrolling or touch
 * behaviour is checked in a real browser by web/e2e. The fixtures are SYNTHETIC hand-written evals. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { newDom, loadApp } = require('./harness');
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

async function boot(data, { confirm, onboarded = true, theme, media = {}, fetchImpl, online } = {}) {
  const dom = newDom();
  const w = dom.window;
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
