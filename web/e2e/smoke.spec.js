// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const { test, expect } = require('@playwright/test');
const { serveSubset, watchProblems, bestMove, clickMove, preset } = require('./helpers');

test('loads with no console errors or CSP violations and plays one position to the reveal', async ({ page }) => {
  await preset(page);
  const watch = watchProblems(page);
  const chosen = await serveSubset(page);
  await page.goto('/');
  await expect(page.locator('#boardWrap svg')).toBeVisible();
  await expect(page.locator('[data-sq]')).toHaveCount(64);

  await clickMove(page, bestMove(chosen[0]));
  if (await page.locator('#confirm').isVisible()) await page.locator('#confirm').click(); // phones confirm first
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result')).toContainText('Move quality: 100/100');
  await expect(page.locator('#result tbody tr')).not.toHaveCount(0);
  await expect(page.locator('#next')).toBeVisible();

  expect(await watch.csp(), 'CSP violations').toEqual([]);
  expect(watch.problems, 'console problems').toEqual([]);
});
