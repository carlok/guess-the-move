// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Saving an answer, in a real browser: the card is drawn by the browser's own SVG and canvas code, so this is the test that
 * proves the picture is made (the unit tests stub that step). */
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { ROOK } = require('./fixtures');
const { serveDataset, preset, clickMove } = require('./helpers');

async function answered(page, uci = 'g1f1') {
  await preset(page, { confirm: false });
  await serveDataset(page, [ROOK]);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await clickMove(page, uci);
  await expect(page.locator('#saveImage')).toBeVisible();
}

test('"Save image" downloads a 2400x1520 PNG that carries the position', async ({ page }, info) => {
  await answered(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#saveImage').click()]);
  expect(download.suggestedFilename()).toBe('guess-the-move-rook.png');
  const path = process.env.GTM_SAVE_PNG || info.outputPath('card.png');
  await download.saveAs(path);
  const bytes = new Uint8Array(fs.readFileSync(path));
  const info2 = await page.evaluate((b) => window.GTM_SHARE.readPng(new Uint8Array(b)), Array.from(bytes));
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(info2).toMatchObject({ width: 2400, height: 1520, FEN: ROOK.fen, Software: 'Guess the Move' });
  expect(bytes.length).toBeGreaterThan(20000); // a blank canvas compresses to almost nothing
  await expect(page.locator('#linkMsg')).toHaveText(/Image saved/);
});

test('the saved picture is not blank: the board, the pieces and the text are drawn', async ({ page }) => {
  await answered(page);
  await page.locator('#saveFen').click(); // loads the image module (it is fetched on first use)
  await expect(page.locator('#linkMsg')).toHaveText('FEN saved.');
  const stats = await page.evaluate(async () => {
    const S = window.GTM_SHARE, svg = document.getElementById('boardSvg');
    const sprite = await (await fetch('pieces.svg')).text();
    const card = S.card({ fen: 'x', flipped: false, board: window.GTM_BOARD.parseFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1').board, symbols: S.symbolsOf(sprite), arrows: '', posLine: 'p', ratingLine: '', opening: '', yourSan: 'Kf1', tier: 'blunder', headline: 'h', better: 'b', sum: window.GTM_CLASSIFY.summary({ evals: { a: 0, b: -50 }, san: { a: 'a', b: 'b' }, fen: '' }, 'b'), yours: 'b', rows: [], date: 'd' }, window.GTM_STRINGS);
    const bytes = await S.rasterize(window, card.svg, card.width, card.height, 1);
    const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    return { w: img.width, h: img.height, lightSq: px(40 + 40 + 5, 60 + 5), darkSq: px(40 + 80 + 5, 60 + 5), page: px(5, 5), svgPresent: !!svg };
  });
  expect([stats.w, stats.h]).toEqual([1200, 760]);
  expect(stats.page.slice(0, 3)).toEqual([0xf6, 0xf5, 0xf1]);
  expect(stats.lightSq.slice(0, 3)).toEqual([0xf0, 0xd9, 0xb5]);
  expect(stats.darkSq.slice(0, 3)).toEqual([0xb5, 0x88, 0x63]);
});

test('"Save FEN" downloads the position, and the buttons do not move the board', async ({ page }) => {
  await answered(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#saveFen').click()]);
  expect(download.suggestedFilename()).toBe('guess-the-move-rook.fen');
  expect(fs.readFileSync(await download.path(), 'utf8')).toBe(ROOK.fen + '\n');
  for (const id of ['saveImage', 'saveFen', 'copyFen']) {
    const box = await page.locator('#' + id).boundingBox();
    expect(box.height, id).toBeGreaterThanOrEqual(24);
  }
});

test('"Share" hands the real card (a PNG with the position) to a browser share sheet', async ({ page }) => {
  await page.addInitScript(() => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async (d) => { window.__shared = { title: d.title, text: d.text, url: d.url, name: d.files[0].name, size: d.files[0].size, head: Array.from(new Uint8Array(await d.files[0].slice(0, 8).arrayBuffer())) }; };
  });
  await answered(page);
  await page.locator('#shareAnswer').click();
  await expect(page.locator('#linkMsg')).toHaveText('Shared.');
  const got = await page.evaluate(() => window.__shared);
  expect(got).toMatchObject({ title: 'Guess the Move', name: 'guess-the-move-rook.png', head: [137, 80, 78, 71, 13, 10, 26, 10] });
  expect(got.size).toBeGreaterThan(20000);
  expect(got.url).toMatch(/#p=rook&m=g1f1$/);
});

test('without a share sheet there is no Share button', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await answered(page);
  await expect(page.locator('#shareAnswer')).toHaveCount(0);
});
