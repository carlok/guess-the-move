// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../share.js');
const B = require('../board.js');
const C = require('../classify.js');
const TV = require('../tierview.js');
const T = require('../strings.js');

const pos = { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', evals: { a1a8: 9999, a1a7: 300, g1g2: 0, g1f1: -5 }, san: { a1a8: 'Ra8#', a1a7: 'Ra7', g1g2: 'Kg2', g1f1: 'Kf1' } };
const model = (over = {}) => ({
  fen: pos.fen, flipped: false, board: B.parseFen(pos.fen).board, symbols: '<symbol id="wR"><path d="M0 0"/></symbol>', arrows: '<g class="arrow arrow-you"><line class="main"/></g>',
  posLine: 'White to move · endgame · ~1500', ratingLine: '', opening: 'Sicilian Defence: Najdorf Variation (B90)', yourSan: 'Kf1', tier: 'blunder',
  headline: 'Move quality: 3/100 · lost 48.0 win-% points', better: 'Better than 0% of the legal moves', sum: C.summary(pos, 'g1f1'), yours: 'g1f1',
  rows: [{ key: 'you', label: 'You', san: 'Kf1', cost: '48.0' }, { key: 'best', label: 'Stockfish', san: 'Ra8#', cost: '0.0' }], date: '2026-11-04', ...over
});

test('wrap breaks at the width, keeps a long word whole, and cuts only when asked', () => {
  assert.deepEqual(S.wrap('aaa bbb ccc', 7), ['aaa bbb', 'ccc']);
  assert.deepEqual(S.wrap('averyveryverylongword x', 5), ['averyveryverylongword', 'x']);
  assert.deepEqual(S.wrap('abcdefghij kl', 4, true), ['abcd', 'efgh', 'ij', 'kl']);
  assert.deepEqual(S.wrap('', 5), []);
});

test('the squares are the page\'s own: 64 of them, alternating, with letters and numbers on the edges, for either side', () => {
  [false, true].forEach((flipped) => {
    const s = S.squares(flipped);
    assert.equal((s.match(/<rect class="sq /g) || []).length, 64);
    assert.equal((s.match(/class="coord /g) || []).length, 16);
    const a1 = new RegExp(`data-sq="a1" x="${flipped ? 700 : 0}" y="${flipped ? 0 : 700}"`);
    assert.match(s, a1);
    assert.match(s, /class="sq dark" data-sq="a1"/);
    assert.match(s, /class="sq light" data-sq="h1"/);
  });
});

test('symbolsOf keeps only the piece symbols of the sprite', () => {
  assert.equal(S.symbolsOf('<svg><defs/><symbol id="a"><path/></symbol>\n<symbol id="b"><g/></symbol></svg>'), '<symbol id="a"><path/></symbol><symbol id="b"><g/></symbol>');
  assert.equal(S.symbolsOf(''), ''); assert.equal(S.symbolsOf(null), '');
});

test('the card is one standalone SVG: size, style, symbols, board, the facts, the FEN', () => {
  const c = S.card(model(), T);
  assert.deepEqual([c.width, c.height], [1200, 760]);
  assert.match(c.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1200" height="760" viewBox="0 0 1200 760"><style>/);
  assert.ok(c.svg.includes('<symbol id="wR">'), 'the symbols are inlined');
  assert.equal((c.svg.match(/<use href="#/g) || []).length, 6, 'six pieces on the board');
  assert.equal((c.svg.match(/class="sq /g) || []).length, 64);
  ['Guess the Move', 'Kf1', 'Blunder', 'White to move', 'Ra8#', 'Stockfish', '48.0', 'Better than 0%', 'Sicilian Defence', '2026-11-04'].forEach((x) => assert.ok(c.svg.includes(x), x));
  assert.ok(c.svg.includes('class="arrow arrow-you"'), 'the arrows are drawn');
  assert.ok(c.svg.includes('6k1/5ppp/8/8/8/8/8/R5K1'), 'the FEN, in pieces no wider than the column');
  assert.doesNotMatch(c.svg, /var\(--(bg|fg|surface)/, 'no page variable the picture could not resolve');
  assert.doesNotMatch(c.svg, /<script|href="http|xlink:href="(?!#)/, 'nothing active or external');
});

test('everything shown is escaped, the rating and opening lines are optional, a long FEN wraps', () => {
  const evil = S.card(model({ yourSan: '<b id="x">Kf1</b>', opening: '', ratingLine: 'Rated <1500>', headline: 'a & b ' + 'word '.repeat(30), fen: 'x'.repeat(130) + ' w - - 0 1' }), T);
  assert.doesNotMatch(evil.svg, /<b id="x">/); assert.ok(evil.svg.includes('&lt;b id=&quot;x&quot;&gt;')); assert.ok(evil.svg.includes('Rated &lt;1500&gt;'));
  assert.ok(evil.svg.includes('a &amp; b'));
  assert.ok((evil.svg.match(/class="t mono"/g) || []).length >= 3, 'the FEN takes several lines');
  const flipped = S.card(model({ flipped: true }), T);
  assert.match(flipped.svg, /data-sq="a1" x="700" y="0"/);
  C.TIERS.forEach((t) => assert.ok(S.card(model({ tier: t }), T).svg.includes(T.tiers[t].name), t));
});

test('the card\'s colours are the light-theme ones the page uses', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="dark"]'));
  const tok = (n) => (new RegExp('--' + n + ':\\s*([^;]+);').exec(root) || [])[1];
  const map = { sqLight: 'sq-light', sqDark: 'sq-dark', coordLight: 'coord-light', coordDark: 'coord-dark', you: 'c-you', best: 'c-best', real: 'c-real', maia: 'c-maia', bg: 'bg', fg: 'fg', muted: 'muted', line: 'line', halo: 'halo' };
  Object.keys(map).forEach((k) => assert.equal(S.COLORS[k].toLowerCase(), tok(map[k]).trim().toLowerCase(), k));
  C.TIERS.forEach((t) => assert.equal(S.TIER_COLORS[t], tok('t-' + t).trim(), t));
});

test('the card agrees with the page about the tier colours the list uses', () => {
  assert.deepEqual(Object.keys(S.TIER_COLORS).sort(), C.TIERS.slice().sort());
  assert.ok(TV.icon('best', T).includes('tier-icon'));
});

test('crc32 matches the PNG standard\'s check values', () => {
  assert.equal(S.crc32(Buffer.from('IEND')), 0xae426082);
  assert.equal(S.crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(S.crc32([]), 0);
});

function png(width, height) {
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const type = (s) => [...s].map((c) => c.charCodeAt(0));
  const chunk = (t, d) => [...u32(d.length), ...type(t), ...d, ...u32(S.crc32(type(t).concat(d)))];
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]), ...chunk('IDAT', [1, 2, 3]), ...chunk('IEND', [])]);
}

test('text goes into a PNG as tEXt chunks after the header, with correct checksums, and reads back', () => {
  const src = png(2400, 1520), out = S.addPngText(src, { FEN: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', Software: 'Guess the Move' });
  assert.equal(out.length, src.length + 2 * 12 + 'FEN'.length + 1 + 33 + 'Software'.length + 1 + 14);
  assert.deepEqual(S.readPng(out), { width: 2400, height: 1520, FEN: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', Software: 'Guess the Move' });
  assert.deepEqual(Array.from(out.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  // every chunk's checksum is right, the original data is intact, and the end chunk is still last
  let pos = 8, kinds = [];
  while (pos < out.length) {
    const len = ((out[pos] << 24) | (out[pos + 1] << 16) | (out[pos + 2] << 8) | out[pos + 3]) >>> 0;
    const body = out.subarray(pos + 4, pos + 8 + len), crc = ((out[pos + 8 + len] << 24) | (out[pos + 9 + len] << 16) | (out[pos + 10 + len] << 8) | out[pos + 11 + len]) >>> 0;
    assert.equal(S.crc32(body), crc); kinds.push(String.fromCharCode(...body.subarray(0, 4))); pos += 12 + len;
  }
  assert.deepEqual(kinds, ['IHDR', 'tEXt', 'tEXt', 'IDAT', 'IEND']);
  assert.deepEqual(S.readPng(S.addPngText(src, {})), { width: 2400, height: 1520 });
});

test('anything that is not a PNG is refused, not corrupted further', () => {
  assert.throws(() => S.addPngText(Uint8Array.from([1, 2, 3]), { A: 'b' }), /not a PNG/);
  assert.throws(() => S.readPng(Uint8Array.from([1, 2, 3])), /not a PNG/);
  assert.equal(S.isPng(png(1, 1)), true); assert.equal(S.isPng(Uint8Array.from([0])), false);
});

test('file names are safe and say what they hold', () => {
  assert.equal(S.fileName('png', 'a1b2c3d4e5'), 'guess-the-move-a1b2c3d4e5.png');
  assert.equal(S.fileName('fen', '../../x y'), 'guess-the-move-xy.fen');
  assert.equal(S.fileName('fen', ''), 'guess-the-move-position.fen');
  assert.equal(S.fileName('png'), 'guess-the-move-position.png');
});
