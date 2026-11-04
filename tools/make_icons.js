// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Draws the app icon: the cburnett white knight (GPL-2.0-or-later, already bundled as web/pieces.svg, see NOTICE) on a
 * 2x2 board square pattern in the app's board colours. Writes web/icon.svg and renders web/icon-192.png, icon-512.png
 * and icon-maskable-512.png (full-bleed, the knight inside the 80% safe zone) with the installed Chrome.
 *   node tools/make_icons.js */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../web/node_modules/@playwright/test');

const WEB = path.resolve(__dirname, '..', 'web');
const sprite = fs.readFileSync(path.join(WEB, 'pieces.svg'), 'utf8');
const knight = sprite.match(/<symbol id="wN"[^>]*>([\s\S]*?)<\/symbol>/)[1];
const LIGHT = '#f0d9b5', DARK = '#b58863';

function svg({ rounded, knightSize }) {
  const k = knightSize, off = (512 - k) / 2, s = k / 45;
  const board = `<rect width="512" height="512" fill="${DARK}"/><rect width="256" height="256" fill="${LIGHT}"/><rect x="256" y="256" width="256" height="256" fill="${LIGHT}"/>`;
  const body = rounded ? `<clipPath id="r"><rect width="512" height="512" rx="104"/></clipPath><g clip-path="url(#r)">${board}</g>` : board;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${body}<g transform="translate(${off} ${off}) scale(${s})">${knight}</g></svg>\n`;
}

(async () => {
  fs.writeFileSync(path.join(WEB, 'icon.svg'), svg({ rounded: true, knightSize: 400 }));
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  for (const [file, size, opts] of [['icon-192.png', 192, { rounded: true, knightSize: 400 }], ['icon-512.png', 512, { rounded: true, knightSize: 400 }], ['icon-maskable-512.png', 512, { rounded: false, knightSize: 300 }]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${svg(opts).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body>`);
    await page.screenshot({ path: path.join(WEB, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
  console.log('wrote icon.svg and 3 PNGs to', WEB);
})();
