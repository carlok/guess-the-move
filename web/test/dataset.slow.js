'use strict';
/* Slow (about 30 s for 2,000 positions) and run by `npm test` but not by `npm run coverage`: instrumented, a fresh jsdom per position
 * exhausts memory, and the lines it exercises are covered by the other tests.
 * End-to-end on the shipped dataset: for EVERY position, play the engine's best move by clicking squares
 * and check the app reports a perfect guess. Catches FEN/orientation/promotion/castling mismatches. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, newDom, loadApp } = require('./harness');
const G = require('../scoring.js');

const DATA_PATH = path.join(ROOT, 'data', 'positions.json');

const skip = fs.existsSync(DATA_PATH) ? false : 'no dataset built yet';
const tick = () => new Promise((r) => setTimeout(r, 5));
const mouse = (w) => new w.MouseEvent('click', { bubbles: true });

test('best move can be played by clicking on every shipped position', { skip }, async () => {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let promotions = 0, checked = 0;
  for (const pos of data.positions) {
    const dom = newDom();
    const w = dom.window;
    w.fetch = async () => ({ ok: true, json: async () => ({ schema: 1, meta: data.meta, positions: [pos] }) });
    loadApp(dom);
    await tick();

    const best = G.bestMove(pos.evals);
    // The board is re-rendered after every click, so always re-query the square (never reuse a node).
    const sq = (name) => w.document.querySelector(`[data-sq="${name}"]`);
    assert.ok(sq(best.slice(0, 2)) && sq(best.slice(2, 4)), `${pos.id}: squares exist`);
    sq(best.slice(0, 2)).dispatchEvent(mouse(w));
    assert.ok(w.document.querySelector('.sel'), `${pos.id}: ${best.slice(0, 2)} is selectable`);
    sq(best.slice(2, 4)).dispatchEvent(mouse(w));
    if (!w.document.getElementById('promo').hidden) {
      promotions++;
      w.document.querySelector(`#promo [data-uci="${best}"]`).dispatchEvent(mouse(w));
    }
    const text = w.document.getElementById('result').textContent;
    assert.match(text, /Move quality:\s*100\/100/, `${pos.id}: best move scores 100 (${pos.fen} ${best})`);
    assert.match(text, /ranks 1 of \d+/, `${pos.id}: rank 1`);
    assert.ok(text.includes(pos.san[best]), `${pos.id}: SAN shown`);
    assert.ok(w.document.querySelectorAll('line').length >= 2, `${pos.id}: arrows drawn`);
    checked++;
    w.close();
  }
  assert.equal(checked, data.positions.length);
  console.log(`# checked ${checked} positions (${promotions} with promotion chooser)`);
});
