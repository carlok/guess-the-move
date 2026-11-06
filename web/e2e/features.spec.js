// SPDX-License-Identifier: AGPL-3.0-or-later
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

test('the top bar fits: stats, settings, sound, help and theme are all visible, at least 44 px, with no horizontal scroll', async ({ page }) => {
  await open(page);
  const vw = page.viewportSize().width; // not innerWidth: that grows when something overflows, which would hide the very failure
  for (const id of ['statsBtn', 'settingsBtn', 'soundToggle', 'helpBtn', 'themeToggle']) {
    const box = await page.locator('#' + id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box.width, id).toBeGreaterThanOrEqual(43.9); expect(box.height, id).toBeGreaterThanOrEqual(43.9); // Firefox reports 43.999998 for a 44 px box
    expect(box.x, id + ' inside the viewport').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id + ' inside the viewport').toBeLessThanOrEqual(vw);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);
});

test('the top bar still fits with a much wider font (Linux and Android default fonts are wider than macOS ones)', async ({ page }) => {
  await page.addInitScript(() => {
    const sheet = new CSSStyleSheet(); // a constructed sheet: the strict CSP forbids injected <style> elements
    sheet.replaceSync('* { font-family: "DejaVu Sans", Verdana, "Courier New", monospace !important; }');
    document.adoptedStyleSheets = [sheet];
  });
  await open(page);
  const vw = page.viewportSize().width;
  const right = await page.locator('#themeToggle').evaluate((e) => e.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(vw);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);
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
  await page.locator('#helpBtn').click();
  await page.waitForTimeout(1300);
  await page.locator('#helpBack').click();
  await expect(timer, 'time spent on a page is not counted').toHaveText('0:00');
});

test('the timer can be hidden and stays hidden after a reload', async ({ page }) => {
  await open(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#timerToggle').uncheck();
  await page.locator('#settingsBack').click();
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
  await expect(page.locator('#statsBody .kpi')).toHaveCount(10); // seven numbers, two streaks, today
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

test('Previous reopens an answered position to study: answer and arrows shown, timer stopped; Try again resets it; Next goes forward', async ({ page }) => {
  await open(page);
  await clickMove(page, 'a1a8');
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#back')).toBeHidden();
  await page.locator('#next').click();
  await expect(page.locator('#result')).toBeHidden();
  await page.locator('#back').click();
  await expect(page.locator('#reviewChip')).toBeVisible();
  await expect(page.locator('#result')).toBeVisible();
  expect(await page.locator('#gArrows .arrow').count()).toBeGreaterThanOrEqual(2);
  const stopped = await page.locator('#timer').textContent();
  await page.waitForTimeout(1300);
  await expect(page.locator('#timer'), 'stopped while reviewing').toHaveText(stopped);
  // every visible action button is a full-size tap target and inside the screen
  const vw = page.viewportSize().width;
  for (const b of await page.locator('#actionBar button:visible').all()) {
    const box = await b.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(vw);
  }
  await page.locator('#tryAgain').click();
  await expect(page.locator('#reviewChip')).toBeHidden();
  await expect(page.locator('#result')).toBeHidden();
  await expect(page.locator('#timer')).not.toHaveText(stopped === '0:00' ? 'never' : stopped, { timeout: 100 }).catch(() => {});
  await clickMove(page, 'a1a8');
  await expect(page.locator('#result')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.locator('#reviewChip')).toBeVisible();
  await page.keyboard.press('n');
  await expect(page.locator('#reviewChip'), 'forward to the retry, still a review').toBeVisible();
  await page.keyboard.press('n');
  await expect(page.locator('#reviewChip'), 'past the last reviewed one: a new position').toBeHidden();
});

/* ---------- the level estimate ---------- */

const BY = {
  1000: { a1a8: 0.1, g1g2: 0.6, a1a7: 0.2 }, 1600: { a1a8: 0.4, g1g2: 0.3, a1a7: 0.2 }, 2200: { a1a8: 0.8, g1g2: 0.05, a1a7: 0.1 }
};
const ALIKE = { 1000: { a1a8: 0.7, g1g2: 0.1 }, 1600: { a1a8: 0.7, g1g2: 0.1 }, 2200: { a1a8: 0.7, g1g2: 0.1 } };
const anchored = (id, by) => ({ ...ROOK, id, maia: { ...ROOK.maia, by_elo: by } });
const POSITIONS = [...Array.from({ length: 12 }, (_, i) => anchored('h' + i, BY)), anchored('flat', ALIKE)];
const FIRST_TIME = Array.from({ length: 8 }, (_, i) => ({
  id: 'h' + i, mode: 'best', phase: 'endgame', tags: [], cost: i % 2 ? 40 : 0, score: i % 2 ? 40 : 100, mb: i % 2 === 0, mr: false, mm: false,
  t: 1_700_000_000_000 + i * 60_000, dur: 10 + i, fen: ROOK.fen, uci: i % 2 ? 'g1g2' : 'a1a8', opp: 1500
}));

async function openLevel(page, hash = '', store = { history: FIRST_TIME }) {
  await preset(page, { confirm: false, store });
  await serveDataset(page, POSITIONS);
  await page.goto('/' + hash);
}

test('"Your level" on the stats page: an estimate with its range and two charts, no horizontal scroll', async ({ page }) => {
  await openLevel(page, '#stats');
  const card = page.locator('.level-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.level-big')).toHaveText(/About \d{4}/);
  await expect(card.locator('.level-range')).toContainText('80% range');
  await expect(card.locator('svg.chart')).toHaveCount(2);
  for (const c of await card.locator('svg.chart').all()) { const b = await c.boundingBox(); expect(b.width).toBeGreaterThan(200); expect(b.height).toBeGreaterThan(60); }
  expect(await noHScroll(page)).toBe(true);
  const n = Number((await card.locator('.level-big').textContent()).match(/\d+/)[0]);
  expect(n).toBeGreaterThanOrEqual(1000); expect(n).toBeLessThanOrEqual(2200);
});

test('with too few guesses the card says how many more are needed', async ({ page }) => {
  await openLevel(page, '#stats', { history: FIRST_TIME.slice(0, 2) });
  await expect(page.locator('.level-card')).toContainText('Play 3 more positions');
  await expect(page.locator('.level-card svg.chart')).toHaveCount(0);
});

test('Suggest a position leaves the stats page for the board, with a chip naming why, and the position can be played', async ({ page }) => {
  await openLevel(page, '#stats');
  await page.locator('#suggestBtn').click();
  await expect(page.locator('#statsView')).toBeHidden();
  await expect(page.locator('#pickChip')).toBeVisible();
  await expect(page.locator('#pickChip')).toContainText('bits');
  await expect(page.locator('#timer')).not.toHaveText('9:99');
  await clickMove(page, 'a1a8');
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#pickChip'), 'the chip is about the position being chosen, not the answer').toBeVisible();
});

test('level-sharpening picks are the default, show their chip, and choosing random picks is remembered across a reload', async ({ page }) => {
  await openLevel(page, '', { history: [] });
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#pickChip')).toBeVisible();
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#picker')).toHaveValue('sharpen');
  await page.locator('#picker').selectOption('random');
  await page.locator('#settingsBack').click();
  await page.reload();
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#picker')).toHaveValue('random');
  await page.locator('#settingsBack').click();
  await expect(page.locator('#pickChip')).toBeHidden();
});

/* ---------- move tiers ---------- */

test('the reveal shows the tier of your move, the distribution bar and every legal move; a row draws its move on the board', async ({ page }) => {
  await preset(page, { confirm: false }); await serveDataset(page, [ROOK]); await page.goto('/'); await expect(page.locator('[data-sq]')).toHaveCount(64);
  await clickMove(page, 'a1a8');
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('.tier-line')).toContainText('Your move beats 100% of the other legal moves');
  const bar = await page.locator('svg.tier-bar').boundingBox();
  expect(bar.width).toBeGreaterThan(200); expect(bar.height).toBeGreaterThan(20);
  await page.locator('.all-moves summary').click();
  await expect(page.locator('.ml-row')).toHaveCount(5);
  for (const row of await page.locator('.ml-row').all()) { const b = await row.boundingBox(); expect(b.height).toBeGreaterThanOrEqual(44); }
  const arrows = await page.locator('#gArrows .arrow').count();
  await page.locator('.ml-row[data-uci="a1a7"]').click();
  await expect(page.locator('#gArrows .arrow')).toHaveCount(arrows + 1);
  await expect(page.locator('.ml-row[data-uci="a1a7"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.ml-row[data-uci="a1a7"]').click();
  await expect(page.locator('#gArrows .arrow')).toHaveCount(arrows);
  expect(await noHScroll(page)).toBe(true);
});

test('the tier badges are not colour-only: each carries a name, and the discs differ in glyph', async ({ page }) => {
  await preset(page, { confirm: false }); await serveDataset(page, [ROOK]); await page.goto('/'); await expect(page.locator('[data-sq]')).toHaveCount(64);
  await clickMove(page, 'a1a8');
  const names = await page.locator('.tier-key .tier-name').allTextContents();
  expect(names.length).toBeGreaterThan(0); names.forEach((n) => expect(n.length).toBeGreaterThan(2));
  const compact = await page.locator('tbody .tier.compact .sr-only').allTextContents();
  expect(compact.length).toBe(4);
});

/* ---------- links ---------- */

const LINKED = { ...ROOK, id: 'aaaaaaaaaa' };

test('a link to a position or to an answer opens it in a real browser, and the copy buttons put the right address on the clipboard', async ({ page, context, browserName }) => {
  const chromium = browserName === 'chromium'; // only Chromium lets a test grant and read the clipboard
  if (chromium) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await preset(page, { confirm: false });
  await serveDataset(page, [LINKED]);
  await page.goto('/#p=aaaaaaaaaa&m=a1a7');
  await expect(page.locator('#reviewChip')).toHaveText('Shared answer');
  await expect(page.locator('#result')).toBeVisible();
  await expect(page).not.toHaveURL(/#p=/);
  await page.goto('/#p=aaaaaaaaaa');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#result')).toBeHidden();
  const box = await page.locator('#linkBtn').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  await page.locator('#linkBtn').click();
  await expect(page.locator('#linkMsg')).toHaveText(chromium ? 'Link copied.' : /^(Link copied\.|Copy this link: )/);
  const origin = new URL(page.url()).origin;
  if (chromium) expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/#p=aaaaaaaaaa`);
  await clickMove(page, 'a1a8');
  await page.locator('#copyAnswer').click();
  await expect(page.locator('#linkMsg')).toHaveText(chromium ? 'Link to your answer copied.' : /^(Link to your answer copied\.|Copy this link: )/);
  if (chromium) expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/#p=aaaaaaaaaa&m=a1a8`);
  expect(await noHScroll(page)).toBe(true);
});

/* ---------- retry your mistakes ---------- */

test('a position queued for retry comes back with a Retry chip, and the stats page can fetch it on demand', async ({ page }) => {
  const positions = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'].map((id) => ({ ...ROOK, id }));
  await preset(page, { confirm: false, store: { srs: { bbbbbbbbbb: { box: 1, due: 4, ok: 0 } }, plays: 9, history: FIRST_TIME.slice(0, 2) } });
  await serveDataset(page, positions);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#retryChip')).toBeVisible();
  await clickMove(page, 'a1a8');                 // a good retry: it climbs a box and is not due again soon
  await expect(page.locator('#result')).toBeVisible();
  await page.locator('#statsBtn').click();
  await expect(page.locator('.srs-card')).toContainText('0 due now, 1 in the queue');
  await page.locator('#retryNowBtn').click();
  await expect(page.locator('#statsView')).toBeHidden();
  await expect(page.locator('#retryChip')).toBeVisible();
  expect(await noHScroll(page)).toBe(true);
});

/* ---------- training sessions ---------- */

const MANY = Array.from({ length: 12 }, (_, i) => ({ ...ROOK, id: 'd' + String(i).padStart(9, '0') }));

async function sessionPage(page, theme) {
  await preset(page, { confirm: false, ...(theme ? { theme } : {}) });
  await serveDataset(page, MANY);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
}

test('a session shows its progress, ends in a report that lists every move, and a move can be reviewed from it', async ({ page }) => {
  await sessionPage(page);
  await page.locator('#sessionBtn').click();
  await expect(page.locator('#sessionChip')).toHaveText('Session 1/10');
  await clickMove(page, 'a1a8'); await page.locator('#next').click();
  await clickMove(page, 'g1f1'); await page.locator('#next').click();
  await page.locator('#sessionEnd').click();
  await expect(page.locator('#reportView')).toBeVisible();
  await expect(page.locator('#gameMain')).toBeHidden();
  await expect(page.locator('#reportBody .kpi')).toHaveCount(4);
  await expect(page.locator('#reportBody .session-row')).toHaveCount(2);
  for (const r of await page.locator('.session-row').all()) { const b = await r.boundingBox(); expect(b.height).toBeGreaterThanOrEqual(44); }
  expect(await noHScroll(page)).toBe(true);
  await page.locator('.session-row').nth(1).click();
  await expect(page.locator('#reportView')).toBeHidden();
  await expect(page.locator('#reviewChip')).toBeVisible();
  await expect(page.locator('.tier-line')).toContainText('Blunder');
});

/* ---------- settings, keyboard, progress ---------- */

test('turning the board with the setting keeps moves working through real pointer geometry', async ({ page }) => {
  await open(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#orientation').selectOption('black');
  await page.locator('#settingsBack').click();
  const a1 = await page.locator('[data-sq="a1"]').boundingBox(), h8 = await page.locator('[data-sq="h8"]').boundingBox();
  expect(a1.x).toBeGreaterThan(h8.x); expect(a1.y).toBeLessThan(h8.y);
  await clickMove(page, 'a1a8');
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#progress')).toContainText('Today 1/10');
});

test('? opens the keyboard list and s skips, from the keyboard alone', async ({ page }) => {
  await open(page);
  await page.keyboard.press('?');
  await expect(page.locator('#helpView')).toBeVisible();
  await expect(page.locator('#helpKeys')).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.locator('#helpView')).toBeHidden();
  await page.keyboard.press('s');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtm.v1.seen') || '[]').length), 'the skipped position is marked seen').toBe(1);
});
