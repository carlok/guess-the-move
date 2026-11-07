// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Draws the picture a pasted link shows (web/og-image.png, 1200x630, the size the large Open Graph / Twitter card is made for):
 * the Italian Game after 3.Bc4 on the app's board colours, black to move, the g8 knight marked with its two moves, and the title.
 * The pieces are the cburnett set from web/pieces.svg (GPL-2.0-or-later, see NOTICE), so the picture carries that licence too.
 * Rendered with the installed Chrome; the text uses the system font of the machine that runs this, so a re-run elsewhere may differ
 * slightly in letter shapes. tools/build_dist.py --pages copies the file; tests/test_dist.py checks its size and format.
 *   node tools/make_og.js */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../web/node_modules/@playwright/test');

const WEB = path.resolve(__dirname, '..', 'web');
const sprite = fs.readFileSync(path.join(WEB, 'pieces.svg'), 'utf8');
const symbol = (id) => sprite.match(new RegExp(`<symbol id="${id}"[^>]*>([\\s\\S]*?)</symbol>`))[1];

const W = 1200, H = 630, S = H / 8; // the board fills the height; a square is 78.75 px
const LIGHT = '#f0d9b5', DARK = '#b58863', BG = '#f6f5f1', INK = '#1d1d1b', MUTED = '#5f5f59', ACCENT = '#1d5fd1';
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const at = (col, row) => [col * S, row * S];
const center = (col, row) => [col * S + S / 2, row * S + S / 2];

function board() {
  let out = `<rect width="${H}" height="${H}" fill="${DARK}"/>`;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    if ((row + col) % 2 === 0) out += `<rect x="${col * S}" y="${row * S}" width="${S}" height="${S}" fill="${LIGHT}"/>`;
  }
  return out;
}

function pieces() {
  let out = '';
  FEN.split(' ')[0].split('/').forEach((rank, row) => {
    let col = 0;
    for (const ch of rank) {
      if (/\d/.test(ch)) { col += Number(ch); continue; }
      const id = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
      const [x, y] = at(col, row);
      out += `<g transform="translate(${x} ${y}) scale(${S / 45})">${symbol(id)}</g>`;
      col++;
    }
  });
  return out;
}

function guess() { // the g8 knight (col 6, row 0) and where it can go: f6 (col 5, row 2), h6 (col 7, row 2)
  const [gx, gy] = at(6, 0);
  let out = `<rect x="${gx}" y="${gy}" width="${S}" height="${S}" fill="${ACCENT}" fill-opacity="0.38"/>`;
  for (const [col, row] of [[5, 2], [7, 2]]) {
    const [cx, cy] = center(col, row);
    out += `<circle cx="${cx}" cy="${cy}" r="${S * 0.17}" fill="${ACCENT}" fill-opacity="0.6"/>`;
  }
  return out;
}

function text() {
  const x = H + 62;
  const line = (y, size, weight, fill, s, extra = '') => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${s}</text>`;
  return [
    line(236, 96, 800, INK, 'Guess the', 'letter-spacing="-2"'),
    line(334, 96, 800, INK, 'Move', 'letter-spacing="-2"'),
    line(408, 33, 400, MUTED, 'See each position through'),
    line(452, 33, 400, MUTED, "another player's eyes."),
    line(536, 27, 600, ACCENT, 'Stockfish · a real player · Maia'),
  ].join('');
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${BG}"/>${board()}${guess()}${pieces()}${text()}</svg>`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:${BG}">${svg}</body>`);
  const file = path.join(WEB, 'og-image.png');
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  console.log('wrote', file, `${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
})();
