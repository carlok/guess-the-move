'use strict';
/* Timer, sounds, the stats view and the stats download/load, in a real browser on all three viewports. */
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { ROOK } = require('./fixtures');
const { serveDataset, preset, clickMove } = require('./helpers');

const SECOND = { ...ROOK, id: 'second', fen: 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1', evals: { a1a8: 500, a1a2: 0 }, san: { a1a8: 'Rxa8+', a1a2: 'Ra2' }, real: 'a1a2', maia: null };
const guess = (i) => ({ id: 'p' + i, mode: i % 5 === 4 ? 'predict' : 'best', phase: ['opening', 'middlegame', 'endgame'][i % 3], tags: [], cost: (i * 3) % 25, score: 35 + ((i * 17) % 60), mb: i % 3 === 0, mr: i % 2 === 0, mm: i % 4 === 0, t: 1_700_000_000_000 + i * 60_000, dur: 6 + ((i * 7) % 50) });
const HISTORY = Array.from({ length: 30 }, (_, i) => guess(i));

async function open(page, opts = {}) {
  await preset(page, { confirm: false, ...opts });
  await serveDataset(page, [ROOK, SECOND]);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('the top bar fits: stats, sound, menu and theme are all visible, at least 44 px, with no horizontal scroll', async ({ page }) => {
  await open(page);
  for (const id of ['statsBtn', 'soundToggle', 'menuBtn', 'themeToggle']) {
    const box = await page.locator('#' + id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box.width, id).toBeGreaterThanOrEqual(44); expect(box.height, id).toBeGreaterThanOrEqual(44);
    const inside = await page.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }, id);
    expect(inside, id + ' inside the viewport').toBe(true);
  }
  expect(await noHScroll(page)).toBe(true);
});

test('the timer runs while a position is open, freezes at the reveal and starts again on the next one', async ({ page }) => {
  await open(page);
  const timer = page.locator('#timer');
  await expect(timer).toBeVisible();
  await expect(timer).not.toHaveText('0:00', { timeout: 4000 });
  await clickMove(page, 'a1a8');
  await expect(page.locator('#result')).toBeVisible();
  const frozen = await timer.textContent();
  await page.waitForTimeout(1300);
  await expect(timer).toHaveText(frozen);
  await page.locator('#next').click();
  await expect(timer).toHaveText('0:00');
  await page.locator('#menuBtn').click();
  await page.waitForTimeout(1300);
  await page.locator('#menuClose').click();
  await expect(timer, 'time spent in the menu is not counted').toHaveText('0:00');
});

test('the timer can be hidden and stays hidden after a reload', async ({ page }) => {
  await open(page);
  await page.locator('#timerToggle').uncheck();
  await expect(page.locator('#timer')).toBeHidden();
  await page.reload();
  await expect(page.locator('#timer')).toBeHidden();
});

async function watchAudio(page) {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    window.__audio = { osc: 0, noise: 0 };
    window.AudioContext = class extends Real {
      createOscillator() { window.__audio.osc++; return super.createOscillator(); }
      createBufferSource() { window.__audio.noise++; return super.createBufferSource(); }
    };
  });
}
const audio = (page) => page.evaluate(() => window.__audio);

test('moves and results make sound through the real Web Audio API, and the speaker button mutes them', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await watchAudio(page);
  await open(page);
  expect(await audio(page)).toEqual({ osc: 0, noise: 0 });
  await page.locator('[data-sq="a1"]').click();
  await expect.poll(async () => (await audio(page)).osc, 'a select click').toBeGreaterThan(0);
  const before = await audio(page);
  await page.locator('[data-sq="a8"]').click();
  await expect.poll(async () => (await audio(page)).noise, 'the move has a noise burst').toBeGreaterThan(before.noise);
  expect((await audio(page)).osc, 'and the outcome chime').toBeGreaterThan(before.osc + 1);
  await page.locator('#soundToggle').click();
  await expect(page.locator('#soundToggle')).toHaveAttribute('data-state', 'off');
  const muted = await audio(page);
  await page.locator('#next').click();
  await clickMove(page, 'a1a8');
  expect(await audio(page)).toEqual(muted);
  await page.reload();
  await expect(page.locator('#soundToggle')).toHaveAttribute('data-state', 'off');
  expect(errors).toEqual([]);
});

test('the stats view is its own page: charts, no horizontal scroll, Back returns to a playable board', async ({ page }) => {
  await open(page, { store: { history: HISTORY, seen: ['p1'] } });
  await page.locator('#statsBtn').click();
  await expect(page.locator('#statsView')).toBeVisible();
  await expect(page.locator('#gameMain')).toBeHidden();
  await expect(page).toHaveURL(/#stats$/);
  await expect(page.locator('#statsBody svg.chart')).toHaveCount(6);
  await expect(page.locator('#statsBody .kpi')).toHaveCount(7);
  for (const c of await page.locator('#statsBody svg.chart').all()) {
    await c.scrollIntoViewIfNeeded();
    const b = await c.boundingBox();
    expect(b.width).toBeGreaterThan(200); expect(b.height).toBeGreaterThan(40);
  }
  expect(await noHScroll(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#statsView')).toBeHidden();
  await expect(page).not.toHaveURL(/#stats/);
  await clickMove(page, 'a1a8');
  await expect(page.locator('#result')).toBeVisible();
});

test('opening the page at #stats lands on the stats view, and the browser Back button leaves it', async ({ page }) => {
  await open(page, { store: { history: HISTORY } });
  await page.goto('/#stats');
  await expect(page.locator('#statsView')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#statsView')).toBeHidden();
});

test('download then load: the file round-trips the stats, through a real download and a real file input', async ({ page }, info) => {
  await open(page, { store: { history: HISTORY, seen: ['p1', 'p2'] } });
  await page.locator('#statsBtn').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  expect(download.suggestedFilename()).toMatch(/^guess-the-move-stats-\d{4}-\d\d-\d\d\.json$/);
  const path = info.outputPath('stats.json');
  await download.saveAs(path);
  const body = JSON.parse(fs.readFileSync(path, 'utf8'));
  expect(body).toMatchObject({ app: 'guess-the-move', format: 1 });
  expect(body.history).toHaveLength(30); expect(body.seen).toEqual(['p1', 'p2']);

  await page.evaluate(() => localStorage.setItem('gtm.v1.history', '[]')); // as after "Reset stats"
  await page.reload();
  await expect(page.locator('#statsBody')).toContainText('Play a few positions');
  await page.locator('#importFile').setInputFiles(path);
  await expect(page.locator('#backupMsg')).toContainText('Loaded 30 new guesses');
  await expect(page.locator('#statsBody .kpi dd').first()).toHaveText('30');
  await page.locator('#importFile').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"nope"}') });
  await expect(page.locator('#backupMsg')).toContainText('not a Guess the Move stats file');
});
