'use strict';
/* Visual design, states and accessibility contracts, on all three viewports. Spec: PROMPT.md 2.2. */
const { test, expect } = require('@playwright/test');
const { ROOK } = require('./fixtures');
const { serveDataset, preset, clickMove } = require('./helpers');

async function open(page, opts = {}) {
  await preset(page, { confirm: false, ...opts });
  await serveDataset(page, [ROOK]);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
}
const play = async (page) => {
  await clickMove(page, 'a1a8');
  if (await page.locator('#confirm').isVisible()) await page.locator('#confirm').click();
  await expect(page.locator('#result')).toBeVisible();
};

test('theme follows the system, can be toggled, and the choice persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#themeToggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('first-run onboarding is at most 3 steps, dismissible and remembered', async ({ page }) => {
  await open(page, { onboarded: false });
  await expect(page.locator('#onboarding')).toBeVisible();
  expect(await page.locator('#onboarding .onboarding-step').count()).toBeLessThanOrEqual(3);
  await page.locator('#onboardingClose').click();
  await expect(page.locator('#onboarding')).toBeHidden();
  await page.reload();
  await expect(page.locator('#onboarding')).toBeHidden();
});

test('a loading skeleton shows while the data loads, then the board replaces it', async ({ page }) => {
  await preset(page);
  await page.route('**/data/positions.json', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ json: { schema: 1, meta: { demo: false }, positions: [ROOK] } });
  });
  await page.goto('/');
  await expect(page.locator('#skeleton')).toBeVisible();
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#skeleton')).toBeHidden();
});

test('a failed load explains itself and offers a retry that works', async ({ page }) => {
  await preset(page);
  let fail = true;
  await page.route('**/data/positions.json', (route) =>
    fail ? route.fulfill({ status: 503, body: 'down' }) : route.fulfill({ json: { schema: 1, meta: { demo: false }, positions: [ROOK] } }));
  await page.goto('/');
  await expect(page.locator('#prompt')).toContainText(/could not load/i);
  fail = false;
  await page.locator('#retry').click();
  await expect(page.locator('[data-sq]')).toHaveCount(64);
});

test('no layout shift when the result appears: the board does not move or resize', async ({ page }) => {
  await open(page);
  const before = await page.locator('#boardSvg').boundingBox();
  await play(page);
  const after = await page.locator('#boardSvg').boundingBox();
  expect(after).toEqual(before);
});

test('the action bar is in view before and after the reveal, and the next button leads it', async ({ page }) => {
  await open(page);
  const vh = page.viewportSize().height;
  const inView = async () => {
    const box = await page.locator('#actionBar').boundingBox();
    return box !== null && box.y >= 0 && box.y + box.height <= vh + 1;
  };
  expect(await inView()).toBe(true);
  await play(page);
  expect(await inView()).toBe(true);
  await expect(page.locator('#next')).toBeVisible();
  await expect(page.locator('#next')).toContainText(/next/i);
});

test('the board fits the viewport: edge to edge on a phone, within the height on desktop', async ({ page }) => {
  await open(page);
  const { width, height } = page.viewportSize();
  const b = await page.locator('#boardSvg').boundingBox();
  expect(b.width).toBeCloseTo(b.height, 0);
  if (width <= 480) expect(b.width).toBeGreaterThanOrEqual(width - 1);
  else expect(b.x + b.width).toBeLessThanOrEqual(width);
  if (width >= 1100) expect(b.y + b.height).toBeLessThanOrEqual(height);
});

test('touch targets are at least 44x44 CSS px on a phone', async ({ page }) => {
  test.skip(page.viewportSize().width > 480, 'phone layout only');
  await open(page);
  const small = await page.evaluate(() => Array.from(document.querySelectorAll('button, select, input, summary, a[href]'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden'; }) // visually hidden helpers are 1px
    .map((el) => { const r = el.closest('label')?.getBoundingClientRect() || el.getBoundingClientRect(); return { id: el.id || el.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((r) => r.w < 44 || r.h < 44));
  expect(small).toEqual([]);
});

test('the reveal draws labelled arrows with a legend, so colour is not the only cue', async ({ page }) => {
  await open(page);
  await play(page);
  expect(await page.locator('#boardSvg .arrow').count()).toBeGreaterThanOrEqual(3);
  expect(await page.locator('#boardSvg .arrow-label').count()).toBeGreaterThanOrEqual(3);
  const dashes = await page.locator('#boardSvg .arrow').evaluateAll((els) => new Set(els.map((e) => e.getAttribute('data-dash'))).size);
  expect(dashes).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#legend')).toBeVisible();
  await expect(page.locator('#legend [data-key]')).toHaveCount(4);
  await expect(page.locator('#result .cost-bar').first()).toBeVisible();
  await expect(page.locator('#verdict')).not.toBeEmpty();
});

test('arrows are not animated under prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await play(page);
  const names = await page.locator('#boardSvg .arrow').evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((n) => n === 'none')).toBe(true);
});
