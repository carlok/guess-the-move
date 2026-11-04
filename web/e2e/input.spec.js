// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Mouse and keyboard input (desktop and tablet projects). Spec: PROMPT.md 2.1. */
const { test, expect } = require('@playwright/test');
const { ROOK, PROMO, BLACK } = require('./fixtures');
const { serveDataset, preset, square, clickMove, mouseDrag } = require('./helpers');

test.beforeEach(async ({ page }) => { await preset(page, { confirm: false }); });

async function open(page, position = ROOK) {
  await serveDataset(page, [position]);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
}
const board = (page) => page.locator('#boardSvg');
const result = (page) => page.locator('#result');
const noStaleState = async (page) => {
  await expect(board(page)).not.toHaveAttribute('data-dragging', 'true');
  await expect(page.locator('#gGhost > *')).toHaveCount(0);
  await expect(page.locator('.sel')).toHaveCount(0);
  await expect(result(page)).toBeHidden();
};

test.describe('click, then click', () => {
  test('source then destination reveals the result', async ({ page }) => {
    await open(page);
    await clickMove(page, 'a1a8');
    await expect(result(page)).toContainText('Move quality: 100/100');
  });

  test('selecting another own piece switches; selecting the selected piece deselects', async ({ page }) => {
    await open(page);
    await square(page, 'a1').click();
    await expect(page.locator('.sel')).toHaveCount(1);
    await square(page, 'g1').click();
    await expect(page.locator('.dot, .ring')).toHaveCount(2); // king: g2, f1
    await square(page, 'g1').click();
    await expect(page.locator('.sel')).toHaveCount(0);
  });
});

test.describe('drag and drop', () => {
  test('a ghost follows the pointer, the origin is dimmed and the legal squares are marked', async ({ page }) => {
    await open(page);
    await mouseDrag(page, 'a1', 'a5', { release: false });
    await expect(board(page)).toHaveAttribute('data-dragging', 'true');
    await expect(page.locator('#gGhost > *')).toHaveCount(1);
    await expect(page.locator('.drag-origin')).toHaveCount(1);
    await expect(page.locator('.dot, .ring')).toHaveCount(3); // a2, a7, a8
    await page.mouse.up();
    await noStaleState(page); // a5 is not a legal destination: nothing committed
  });

  test('the ghost really moves with the pointer', async ({ page }) => {
    await open(page);
    await mouseDrag(page, 'a1', 'c3', { release: false });
    const ghost = page.locator('#gGhost > *').first();
    const g = await ghost.boundingBox(), t = await square(page, 'c3').boundingBox();
    expect(Math.abs(g.x + g.width / 2 - (t.x + t.width / 2))).toBeLessThan(t.width / 2);
    expect(Math.abs(g.y + g.height / 2 - (t.y + t.height / 2))).toBeLessThan(t.height / 2);
    await page.mouse.up();
  });

  test('dropping on a legal square commits the move', async ({ page }) => {
    await open(page);
    await mouseDrag(page, 'a1', 'a8');
    await expect(result(page)).toContainText('Move quality: 100/100');
    await expect(board(page)).not.toHaveAttribute('data-dragging', 'true');
    await expect(page.locator('#gGhost > *')).toHaveCount(0);
  });

  test('a movement under the threshold is a tap: it selects and does not drag', async ({ page }) => {
    await open(page);
    const c = await square(page, 'a1').boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2 + 2, c.y + c.height / 2 + 1);
    await expect(board(page)).not.toHaveAttribute('data-dragging', 'true');
    await page.mouse.up();
    await expect(page.locator('.sel')).toHaveCount(1);
    await expect(result(page)).toBeHidden();
  });

  test('Escape during a drag puts the piece back, and the board is not stuck afterwards', async ({ page }) => {
    await open(page);
    await mouseDrag(page, 'a1', 'a7', { release: false });
    await expect(board(page)).toHaveAttribute('data-dragging', 'true');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await noStaleState(page);
    await clickMove(page, 'a1a8');
    await expect(result(page)).toContainText('100/100');
  });

  test('dropping outside the board cancels', async ({ page }) => {
    await open(page);
    const b = await board(page).boundingBox();
    const a = await square(page, 'a1').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y - 4, { steps: 8 });
    await expect(board(page)).toHaveAttribute('data-dragging', 'true');
    await page.mouse.up();
    await noStaleState(page);
  });

  test('dropping on an illegal square cancels', async ({ page }) => {
    await open(page);
    await mouseDrag(page, 'a1', 'c4');
    await noStaleState(page);
  });

  test('dropping on the origin square counts as a select', async ({ page }) => {
    await open(page);
    const a = await square(page, 'a1').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y - a.height, { steps: 6 });
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.sel')).toHaveCount(1);
    await expect(page.locator('.dot, .ring')).toHaveCount(3);
    await expect(result(page)).toBeHidden();
    await expect(board(page)).not.toHaveAttribute('data-dragging', 'true');
  });

  test('click and drag are interchangeable within one position', async ({ page }) => {
    await open(page);
    await square(page, 'a1').click();
    await mouseDrag(page, 'a1', 'a8');
    await expect(result(page)).toContainText('100/100');
  });

  test('promotion by drag opens the chooser and commits the chosen piece', async ({ page }) => {
    await open(page, PROMO);
    await mouseDrag(page, 'a7', 'a8');
    await expect(page.locator('#promo')).toBeVisible();
    await expect(page.locator('#promo button')).toHaveCount(4);
    await expect(result(page)).toBeHidden();
    await page.locator('#promo [data-uci="a7a8n"]').click();
    await expect(result(page)).toContainText('a8=N');
  });

  test('Black to move: the board is oriented from Black and drag works', async ({ page }) => {
    await open(page, BLACK);
    const a1 = await square(page, 'a1').boundingBox(), h1 = await square(page, 'h1').boundingBox();
    const a8 = await square(page, 'a8').boundingBox();
    expect(a1.x).toBeGreaterThan(h1.x); // a-file on the right
    expect(a8.y).toBeGreaterThan(a1.y); // rank 8 at the bottom
    await mouseDrag(page, 'g8', 'f8');
    await expect(result(page)).toContainText('Move quality');
  });
});

test.describe('keyboard', () => {
  test('the board is one tab stop; arrows move a cursor; Enter selects, then commits; moves are announced', async ({ page }) => {
    await open(page);
    await expect(board(page)).toHaveAttribute('tabindex', '0');
    await expect(page.locator('[data-sq][tabindex]')).toHaveCount(0);
    await board(page).focus();
    await page.keyboard.press('Home'); // bottom-left from the player's side: a1 for White
    await expect(page.locator('#live')).toContainText('a1');
    await expect(page.locator('#live')).toContainText('white rook');
    await page.keyboard.press('Enter');
    await expect(page.locator('#live')).toContainText('a1 selected');
    await expect(page.locator('#live')).toContainText('3 legal moves');
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowUp');
    await expect(page.locator('#live')).toContainText('a8');
    await page.keyboard.press('Enter');
    await expect(result(page)).toContainText('Move quality: 100/100');
    await expect(page.locator('#live')).toContainText('a1 to a8');
  });

  test('arrows are relative to the screen, so they flip when Black is at the bottom', async ({ page }) => {
    await open(page, BLACK);
    await board(page).focus();
    await page.keyboard.press('Home'); // h8 for Black
    await expect(page.locator('#live')).toContainText('h8');
    await page.keyboard.press('ArrowRight'); // to the screen's right = towards the a-file for Black
    await expect(page.locator('#live')).toContainText('g8');
  });

  test('Escape cancels a keyboard selection', async ({ page }) => {
    await open(page);
    await board(page).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(page.locator('.sel')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sel')).toHaveCount(0);
    await expect(page.locator('#live')).toContainText('cancel');
  });

  test('n goes to the next position after a reveal', async ({ page }) => {
    await open(page);
    await clickMove(page, 'a1a8');
    await expect(result(page)).toBeVisible();
    await page.keyboard.press('n');
    await expect(result(page)).toBeHidden();
  });
});

test.describe('confirm before reveal', () => {
  test.beforeEach(async ({ page }) => { await preset(page, { confirm: true }); });

  test('a legal move is pending until confirmed, and can be changed or cancelled', async ({ page }) => {
    await open(page);
    await mouseDrag(page, 'a1', 'a7');
    await expect(page.locator('#confirm')).toBeVisible();
    await expect(result(page)).toBeHidden();
    await expect(page.locator('.pending')).not.toHaveCount(0);
    await mouseDrag(page, 'a1', 'a8'); // change of mind before confirming
    await page.locator('#confirm').click();
    await expect(result(page)).toContainText('Move quality: 100/100');
    await expect(page.locator('#confirm')).toBeHidden();
  });

  test('Escape clears a pending move', async ({ page }) => {
    await open(page);
    await clickMove(page, 'a1a7');
    await expect(page.locator('#confirm')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm')).toBeHidden();
    await expect(page.locator('.pending')).toHaveCount(0);
    await expect(result(page)).toBeHidden();
  });

  test('the setting is a labelled toggle and it persists', async ({ page }) => {
    await preset(page, { confirm: false });
    await open(page);
    await page.locator('#menuBtn').click(); // the settings are in the menu
    const toggle = page.getByLabel(/confirm moves/i);
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.reload();
    await page.locator('#menuBtn').click();
    await expect(page.getByLabel(/confirm moves/i)).toBeChecked();
  });
});
