// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Offline use, against a built dist/ (make dist-check sets GTM_ROOT). The source tree's worker does nothing on purpose,
 * so there is nothing to test there. */
const { test, expect } = require('@playwright/test');
const { preset } = require('./helpers');

test.skip(!process.env.GTM_ROOT, 'needs a built dist/ (run make dist-check)');

test('the worker caches the build, and the page then opens and plays with the network off', async ({ page, context }) => {
  await preset(page, { confirm: false });
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('gtm-')).length), 'one cache for this build').toBe(1);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'the page is now controlled by the worker').toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#prompt')).not.toContainText('Could not load');
  const own = await page.evaluate(() => [...document.querySelectorAll('[data-psq]')].map((e) => e.getAttribute('data-psq')));
  let moved = false;
  for (const sq of own) {
    await page.locator(`[data-sq="${sq}"]`).click();
    if (await page.locator('#boardSvg .dot, #boardSvg .ring').count()) { await page.locator('#boardSvg .dot, #boardSvg .ring').first().click({ force: true }); moved = true; break; }
    await page.locator(`[data-sq="${sq}"]`).click();
  }
  expect(moved).toBe(true);
  await expect(page.locator('#result')).toBeVisible();
  await context.setOffline(false);
});

test('the lazy parts were precached: with the network off, Save FEN and the stats charts still load', async ({ page, context }) => {
  await preset(page, { confirm: false });
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => { const k = (await caches.keys()).find((n) => n.startsWith('gtm-')); return k ? (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname) : []; })).toEqual(expect.arrayContaining(['/share.js', '/backup.js', '/statscharts.js']));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  const own = await page.evaluate(() => [...document.querySelectorAll('[data-psq]')].map((e) => e.getAttribute('data-psq')));
  for (const sq of own) {
    await page.locator(`[data-sq="${sq}"]`).click();
    if (await page.locator('#boardSvg .dot, #boardSvg .ring').count()) { await page.locator('#boardSvg .dot, #boardSvg .ring').first().click({ force: true }); break; }
    await page.locator(`[data-sq="${sq}"]`).click();
  }
  await expect(page.locator('#result')).toBeVisible();
  await page.locator('#saveFen').click();
  await expect(page.locator('#linkMsg')).toHaveText('FEN saved.');
  await page.locator('#statsBtn').click();
  await expect(page.locator('#statsBody')).not.toContainText('could not be loaded');
  await expect(page.locator('#statsBody')).not.toHaveText('Loading…');
  await context.setOffline(false);
});

test('the manifest and icons are served, and the update bar is hidden until a new build is waiting', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(new URL(href, page.url()).href)).json();
  expect(manifest.name).toBe('Guess the Move');
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, page.url()).href);
    expect(res.ok(), icon.src).toBe(true);
  }
  expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  await expect(page.locator('#updateBar')).toBeHidden();
});
