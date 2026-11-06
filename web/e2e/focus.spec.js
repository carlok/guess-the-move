// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Focus mode: only the board and the timer, as large as the screen allows, until you move. */
const { test, expect } = require('@playwright/test');
const { ROOK } = require('./fixtures');
const { serveDataset, preset, clickMove } = require('./helpers');

async function open(page) {
  await preset(page, { confirm: false });
  await serveDataset(page, [ROOK]);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
}
const boardBox = (page) => page.locator('#boardWrap').boundingBox();

test('the board grows to the largest square the screen allows, the rest of the page steps aside, and a move brings it back', async ({ page }) => {
  await open(page);
  const vp = page.viewportSize();
  const before = await boardBox(page);
  await page.locator('#focusBtn').click();
  await expect(page.locator('html')).toHaveClass(/focus-mode/);
  for (const sel of ['.topbar', '.panel', '.actionbar', 'footer']) await expect(page.locator(sel).first(), sel).toBeHidden();
  await expect(page.locator('#timer')).toBeVisible();
  await expect(page.locator('#posInfo')).toBeVisible();
  // A browser that really enters full screen (Firefox) is still resizing for a moment after the class appears: wait for the size.
  await expect.poll(async () => (await boardBox(page)).width, 'using nearly all of the shorter side (3.5rem is left for the line above)').toBeGreaterThan(Math.min(vp.width, vp.height - 56) - 4);
  const after = await boardBox(page);
  expect(after.width, 'the board is not smaller').toBeGreaterThanOrEqual(before.width - 1);
  expect(after.width, 'and is a square that fits the screen').toBeLessThanOrEqual(Math.min(vp.width, vp.height) + 1);
  expect(after.width, 'using nearly all of the shorter side (3.5rem is left for the line above)').toBeGreaterThan(Math.min(vp.width, vp.height - 56) - 4);
  expect(after.y + after.height, 'it fits without scrolling').toBeLessThanOrEqual(vp.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth), 'no scrollbars').toBe(true);
  await clickMove(page, 'a1a8');
  await expect(page.locator('html')).not.toHaveClass(/focus-mode/);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('#result')).toBeVisible();
});

test('a tap on a piece keeps it, Escape and the button leave it, and the board can still be played in it', async ({ page }) => {
  await open(page);
  await page.locator('#focusBtn').click();
  await page.locator('[data-sq="a1"]').click();
  await expect(page.locator('html')).toHaveClass(/focus-mode/);
  await expect(page.locator('#boardSvg .dot, #boardSvg .ring').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveClass(/focus-mode/);
  await page.keyboard.press('f');
  await expect(page.locator('html')).toHaveClass(/focus-mode/);
  await page.locator('#focusBtn').click();
  await expect(page.locator('html')).not.toHaveClass(/focus-mode/);
});

test('the focus button is a comfortable target and has a name', async ({ page }) => {
  await open(page);
  const b = await page.locator('#focusBtn').boundingBox();
  expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('#focusBtn')).toHaveAccessibleName('Focus on the board');
  await page.locator('#focusBtn').click();
  await expect(page.locator('#focusBtn')).toHaveAccessibleName('Back to the full page');
});
