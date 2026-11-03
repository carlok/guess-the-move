'use strict';
/* Touch input on a phone-sized viewport with touch events and DPR 2 (phone project). Spec: PROMPT.md 2.1. */
const { test, expect } = require('@playwright/test');
const { ROOK } = require('./fixtures');
const { serveDataset, preset, square, center, touchDrag, touchPath, touchTap } = require('./helpers');

test.beforeEach(async ({ page }) => { await preset(page); }); // confirm is NOT preset: coarse pointers default to on

async function open(page) {
  await serveDataset(page, [ROOK]);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
}
const board = (page) => page.locator('#boardSvg');

test('confirm-before-reveal is on by default for a coarse pointer, and tap-tap needs a confirmation', async ({ page }) => {
  await open(page);
  await expect(page.getByLabel(/confirm moves/i)).toBeChecked();
  await square(page, 'a1').tap();
  await square(page, 'a8').tap();
  await expect(page.locator('#confirm')).toBeVisible();
  await expect(page.locator('#result')).toBeHidden();
  await page.locator('#confirm').tap();
  await expect(page.locator('#result')).toContainText('Move quality: 100/100');
});

test('a touch drag moves a ghost, drops as a pending move, and confirm reveals it', async ({ page }) => {
  await open(page);
  // Diagnostics for a failure seen only on the GitHub runner's Linux Chrome: record what the page really receives.
  await page.evaluate(() => {
    window.__ev = [];
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click', 'gotpointercapture', 'lostpointercapture']) {
      document.addEventListener(t, (e) => window.__ev.push([Math.round(performance.now()), t, (e.target.id || e.target.tagName || '') + '', Math.round(e.clientX || 0), Math.round(e.clientY || 0), e.pointerId ?? '', e.pointerType || '']), true);
    }
  });
  const drag = await touchDrag(page, 'a1', 'a8', { release: false });
  await expect(board(page)).toHaveAttribute('data-dragging', 'true');
  await expect(page.locator('#gGhost > *')).toHaveCount(1);
  await drag.end();
  await expect(board(page)).not.toHaveAttribute('data-dragging', 'true');
  await expect(page.locator('#confirm')).toBeVisible();
  await expect(page.locator('#result')).toBeHidden();
  await touchTap(page, page.locator('#confirm')); // same CDP session as the drag, see helpers.js
  try {
    await expect(page.locator('#result')).toContainText('Move quality: 100/100');
  } catch (e) {
    const ev = await page.evaluate(() => window.__ev);
    console.log('PAGE EVENTS (ms, type, target, x, y, pointerId, pointerType):\n' + ev.map((x) => x.join(' ')).join('\n'));
    throw e;
  }
});

test('dropping a touch drag outside the board cancels it', async ({ page }) => {
  await open(page);
  const a = await center(page, 'a1');
  const b = await board(page).boundingBox();
  await touchPath(page, [[a.x, a.y], [a.x + 4, a.y - 20], [a.x + 8, a.y - 80], [b.x + b.width / 2, b.y - 10]]);
  await expect(page.locator('#gGhost > *')).toHaveCount(0);
  await expect(page.locator('#confirm')).toBeHidden();
  await expect(page.locator('.sel')).toHaveCount(0);
});

test('touchcancel (the OS takes the gesture) cancels the drag cleanly', async ({ page }) => {
  await open(page);
  const drag = await touchDrag(page, 'a1', 'a7', { release: false });
  await expect(board(page)).toHaveAttribute('data-dragging', 'true');
  await drag.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(board(page)).not.toHaveAttribute('data-dragging', 'true');
  await expect(page.locator('#gGhost > *')).toHaveCount(0);
  await expect(page.locator('#confirm')).toBeHidden();
  await expect(page.locator('.sel')).toHaveCount(0);
});

test('the page still scrolls when a touch starts outside the board, and does not when it starts on the board', async ({ page }) => {
  await open(page);
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(scrollable, 'the phone layout must be taller than the viewport for this test to mean anything').toBeGreaterThan(120);

  const b = await board(page).boundingBox();
  await touchPath(page, [[b.x + b.width / 2, b.y + b.height * 0.5], [b.x + b.width / 2, b.y + b.height * 0.5 - 60], [b.x + b.width / 2, b.y + b.height * 0.5 - 160]]);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY), 'a swipe on the board must not scroll the page').toBe(0);

  const outside = await page.locator('#panel').boundingBox();
  const x = outside.x + outside.width / 2, y = Math.min(outside.y + 30, 800);
  await touchPath(page, [[x, y], [x, y - 40], [x, y - 120], [x, y - 220]]);
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'a swipe outside the board scrolls' }).toBeGreaterThan(40);
});
