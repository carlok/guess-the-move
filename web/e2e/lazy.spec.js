// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Parts of the page that load on first use (save image, the stats file, the stats charts): not at the start, there when needed. */
const { test, expect } = require('@playwright/test');
const { ROOK } = require('./fixtures');
const { serveDataset, preset, clickMove } = require('./helpers');

const LAZY = ['share.js', 'backup.js', 'statscharts.js'];
const asked = (urls) => LAZY.filter((n) => urls.some((u) => new URL(u).pathname.endsWith('/' + n)));

async function open(page, urls) {
  page.on('request', (r) => urls.push(r.url()));
  await preset(page, { confirm: false });
  await serveDataset(page, [ROOK]);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
}

test('the first load fetches none of the lazy parts, and each is fetched the first time it is used', async ({ page }) => {
  const urls = [];
  await open(page, urls);
  expect(asked(urls), 'nothing lazy at the start').toEqual([]);
  expect(await page.evaluate(() => [typeof window.GTM_SHARE, typeof window.GTM_BACKUP, typeof window.GTM_STATSCHARTS])).toEqual(['undefined', 'undefined', 'undefined']);

  await clickMove(page, 'a1a8');
  await page.locator('#saveFen').click();
  await expect(page.locator('#linkMsg')).toHaveText('FEN saved.');
  expect(asked(urls)).toEqual(['share.js']);

  await page.locator('#statsBtn').click();
  await expect(page.locator('#statsBody .chart-card, #statsBody p').first()).toBeVisible();
  await expect.poll(() => asked(urls)).toEqual(['share.js', 'statscharts.js']);
  await page.locator('#exportBtn').click();
  await expect.poll(() => asked(urls)).toEqual(['share.js', 'backup.js', 'statscharts.js']);
  await expect(page.locator('#backupMsg')).toContainText('Downloaded');
});

test('the board, timer and stats line work without any lazy part, and a part that cannot be fetched is reported', async ({ page }) => {
  await open(page, []);
  await page.route(/\/share\.js/, (route) => route.abort());
  await clickMove(page, 'a1a8');
  await page.locator('#saveFen').click();
  await expect(page.locator('#linkMsg')).toHaveText(/could not be loaded/);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#progress')).toContainText('Streak');
});
