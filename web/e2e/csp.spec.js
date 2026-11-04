// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const { test, expect } = require('@playwright/test');
const { serveSubset, watchProblems, preset } = require('./helpers');

// Negative control for smoke.spec.js: if an inline style is NOT reported as a violation, the "zero CSP
// violations" assertion there proves nothing. Only meaningful where the CSP header exists (the nginx container).
test('an inline style is blocked and reported by the container CSP', async ({ page }) => {
  test.skip(!process.env.GTM_BASE_URL, 'the CSP header comes from the nginx container');
  await preset(page);
  const watch = watchProblems(page);
  await serveSubset(page);
  await page.goto('/');
  await expect(page.locator('#boardWrap svg')).toBeVisible();
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p id="probe" style="color:red">x</p>'));
  await expect.poll(async () => (await watch.csp()).length).toBeGreaterThan(0);
  expect((await watch.csp())[0]).toContain('style-src');
});
