'use strict';
/* The optional api. Without it the page must show nothing of it (runs everywhere); with a real api behind the container's
 * nginx (GTM_BASE_URL=http://127.0.0.1:8080 GTM_API=1) the panel works end to end with real Stockfish and Maia. */
const { test, expect } = require('@playwright/test');
const { serveSubset, watchProblems, preset, bestMove, clickMove } = require('./helpers');

test('without an api nothing of it is shown and the console stays clean', async ({ page }) => {
  test.skip(!!process.env.GTM_API, 'an api is present in this run');
  await preset(page);
  const watch = watchProblems(page);
  await serveSubset(page);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#apiPanel')).toBeHidden();
  await expect(page.locator('#estimateBtn')).toBeHidden();
  expect(watch.problems).toEqual([]);
});

test.describe('with a real api', () => {
  test.skip(!process.env.GTM_API, 'set GTM_API=1 with GTM_BASE_URL pointing at a container that has the api');
  test.beforeEach(async ({ page }) => { await preset(page, { confirm: false }); });

  test('analyse any FEN: Stockfish for every legal move, Maia at the given rating, then play it', async ({ page }) => {
    const watch = watchProblems(page);
    await page.goto('/');
    await expect(page.locator('#apiPanel')).toBeVisible();
    await page.locator('#apiPanel summary').click();
    await page.locator('#fenInput').fill('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
    await page.locator('#eloInput').fill('1500');
    await page.locator('#analyseBtn').click();
    await expect(page.locator('#posInfo')).toContainText('Black to move · move 3');
    await clickMove(page, 'c6d4');
    if (await page.locator('#confirm').isVisible()) await page.locator('#confirm').click();
    await expect(page.locator('#result')).toContainText('Move quality');
    await expect(page.locator('#result')).toContainText('Maia 1500');
    await expect(page.locator('#legend [data-key]')).toHaveCount(3); // you, Stockfish, Maia: a pasted position has no real player
    expect(watch.problems).toEqual([]);
  });

  test('a bad FEN is explained and the board stays', async ({ page }) => {
    await page.goto('/');
    await page.locator('#apiPanel summary').click();
    await page.locator('#fenInput').fill('this is not a fen');
    await page.locator('#analyseBtn').click();
    await expect(page.locator('#apiMsg')).toContainText(/not a valid FEN/i);
    await expect(page.locator('[data-sq]')).toHaveCount(64);
  });

  test('estimate my level after five best-move guesses', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/');
    await page.locator('summary', { hasText: 'Session stats' }).click(); // the estimate lives under the stats
    await expect(page.locator('#estimateBtn')).toBeVisible();
    await expect(page.locator('#estimateBtn')).toBeDisabled();
    for (let i = 0; i < 5; i++) {
      const chosen = await serveSubset(page, (ps) => [ps[i]]); // five different real positions, in order
      await page.goto('/');
      await expect(page.locator('[data-sq]')).toHaveCount(64);
      await clickMove(page, bestMove(chosen[0]));
      if (await page.locator('#confirm').isVisible()) await page.locator('#confirm').click();
      await expect(page.locator('#result')).toBeVisible();
      await page.unroute('**/data/positions.json');
    }
    await page.locator('summary', { hasText: 'Session stats' }).click();
    await expect(page.locator('#estimateBtn')).toBeEnabled();
    await page.locator('#estimateBtn').click();
    await expect(page.locator('#estimate')).toContainText(/About \d{4} \(80% range \d{4} to \d{4}\).*Lichess-equivalent/, { timeout: 60000 });
  });
});
