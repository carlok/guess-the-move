// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* The daily challenge and challenge links, in a real browser on all three viewports. */
const { test, expect } = require('@playwright/test');
const { ROOK } = require('./fixtures');
const { serveDataset, preset, clickMove } = require('./helpers');

const POSITIONS = Array.from({ length: 12 }, (_, i) => ({ ...ROOK, id: 'c0000000' + String(i).padStart(2, '0') }));

async function open(page, hash = '') {
  await preset(page, { confirm: false });
  await serveDataset(page, POSITIONS);
  await page.goto('/' + hash);
  await expect(page.locator('[data-sq]')).toHaveCount(64);
}
const idOf = async (page) => {
  await page.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await page.locator('#linkBtn').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toMatch(/#p=[0-9a-f]{10}/);
  return page.evaluate(() => /#p=([0-9a-f]{10})/.exec(window.__copied)[1]);
};

test('the daily challenge runs five fixed positions with no skip, then shows a report that copies a shareable result', async ({ page }) => {
  await open(page);
  await expect(page.locator('#dailyBtn')).toBeVisible();
  await page.locator('#dailyBtn').click();
  await expect(page.locator('#sessionChip')).toHaveText('Daily 1/5');
  await expect(page.locator('#skip')).toBeHidden();
  const seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push(await idOf(page));
    await clickMove(page, 'a1a8');
    await page.locator('#next').click();
  }
  expect(new Set(seen).size, 'five different positions').toBe(5);
  await expect(page.locator('#reportView')).toBeVisible();
  await expect(page.locator('#reportTitle')).toHaveText(/^Daily \d{4}-\d\d-\d\d$/);
  await page.locator('#reportCopy').click();
  const text = await page.evaluate(() => window.__copied);
  expect(text).toMatch(/^Guess the Move · Daily \d{4}-\d\d-\d\d\n[🟦🟩🟨🟧🟥⬛]{5}\nMove quality \d+ · best move found \d\/5\nhttp:\/\/[\w.]+:\d+\/#c=\d{8}\.[0-9a-f]{4}$/u);
  await page.locator('#reportBack').click();
  await expect(page.locator('#dailyBtn')).toContainText('done');
});

test('a challenge link opens the same positions on another page, and the two buttons fit a phone', async ({ page, browser }) => {
  await open(page);
  const box = await page.locator('#challengeRow').boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  for (const id of ['dailyBtn', 'friendBtn']) { const b = await page.locator('#' + id).boundingBox(); expect(b.height, id).toBeGreaterThanOrEqual(44); }
  await page.locator('#friendBtn').click();
  await expect(page.locator('#sessionChip')).toHaveText('Challenge 1/5');
  const first = await idOf(page);
  for (let i = 0; i < 5; i++) { if (i) await idOf(page); await clickMove(page, 'a1a8'); await page.locator('#next').click(); }
  await page.locator('#reportLink').click();
  const link = await page.evaluate(() => window.__copied);
  expect(link).toMatch(/#c=[0-9a-z]{6}\.[0-9a-f]{4}$/);
  const other = await (await browser.newContext({ viewport: page.viewportSize(), baseURL: new URL(page.url()).origin })).newPage();
  await preset(other, { confirm: false }); await serveDataset(other, POSITIONS);
  await other.goto(link.slice(link.indexOf('/#')));
  await expect(other.locator('#sessionChip')).toHaveText('Challenge 1/5');
  expect(await idOf(other)).toBe(first);
  expect(other.url()).not.toContain('#c=');
});
