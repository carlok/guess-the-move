'use strict';
const { test, expect } = require('@playwright/test');
const { serveSubset, watchProblems, bestMove, clickMove } = require('./helpers');

test('loads with no console errors or CSP violations and plays one position to the reveal', async ({ page }) => {
  const watch = watchProblems(page);
  const chosen = await serveSubset(page);
  await page.goto('/');
  await expect(page.locator('#boardWrap svg')).toBeVisible();
  await expect(page.locator('[data-sq]')).toHaveCount(64);

  await clickMove(page, bestMove(chosen[0]));
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result')).toContainText('Move quality: 100/100');
  await expect(page.locator('#result tbody tr')).not.toHaveCount(0);
  await expect(page.locator('#next')).toBeVisible();

  expect(await watch.csp(), 'CSP violations').toEqual([]);
  expect(watch.problems, 'console problems').toEqual([]);
});
