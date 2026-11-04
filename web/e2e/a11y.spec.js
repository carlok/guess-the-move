'use strict';
/* axe-core on every state of the page, in both themes, on all three viewports. Gate: zero serious or critical
 * violations (PROMPT.md 2.2). Moderate and minor findings are printed so they are not invisible. */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { ROOK } = require('./fixtures');
const { serveDataset, preset, clickMove } = require('./helpers');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function scan(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of violations) {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ');
    console.log(`axe [${label}] ${v.impact} ${v.id}: ${v.help} -> ${where}`);
  }
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), `${label}: serious/critical axe violations`).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`axe: ${theme} theme, first-run onboarding, position, pending move and reveal`, async ({ page }) => {
    await preset(page, { onboarded: false, theme, confirm: true });
    await serveDataset(page, [ROOK]);
    await page.goto('/');
    await expect(page.locator('[data-sq]')).toHaveCount(64);
    await scan(page, `${theme} onboarding`);
    await page.locator('#onboardingClose').click();
    await scan(page, `${theme} position`);
    await page.locator('#menuBtn').click();
    await expect(page.locator('#menu')).toBeVisible();
    await scan(page, `${theme} menu`);
    await page.keyboard.press('Escape');
    await clickMove(page, 'a1a8');
    await expect(page.locator('#confirm')).toBeVisible();
    await scan(page, `${theme} pending`);
    await page.locator('#confirm').click();
    await expect(page.locator('#result')).toBeVisible();
    await scan(page, `${theme} reveal`);
    await page.locator('summary', { hasText: 'Your stats' }).click();
    await scan(page, `${theme} reveal+stats`);
  });
}

for (const theme of ['light', 'dark']) {
  test(`axe: ${theme} theme, the stats view with charts and the empty stats view`, async ({ page }) => {
    const history = Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, mode: i % 5 === 4 ? 'predict' : 'best', phase: ['opening', 'middlegame', 'endgame'][i % 3], tags: [], cost: (i * 3) % 25, score: 35 + ((i * 17) % 60), mb: i % 3 === 0, mr: i % 2 === 0, mm: i % 4 === 0, t: 1_700_000_000_000 + i * 60_000, dur: 6 + ((i * 7) % 50) }));
    await preset(page, { theme, store: { history } });
    await serveDataset(page, [ROOK]);
    await page.goto('/#stats');
    await expect(page.locator('#statsBody svg.chart')).toHaveCount(6);
    await scan(page, `${theme} stats`);
    await page.evaluate(() => { localStorage.removeItem('gtm.v1.history'); });
    await page.reload();
    await expect(page.locator('#statsBody .empty')).toBeVisible();
    await scan(page, `${theme} stats empty`);
  });
}

for (const theme of ['light', 'dark']) {
  test(`axe: ${theme} theme, a position reopened for review`, async ({ page }) => {
    await preset(page, { theme, confirm: false });
    await serveDataset(page, [ROOK, { ...ROOK, id: 'second' }]);
    await page.goto('/');
    await expect(page.locator('[data-sq]')).toHaveCount(64);
    await clickMove(page, 'a1a8');
    await page.locator('#next').click();
    await page.locator('#back').click();
    await expect(page.locator('#reviewChip')).toBeVisible();
    await scan(page, `${theme} review`);
  });
}

for (const theme of ['light', 'dark']) {
  test(`axe: ${theme} theme, the stats page with the level card`, async ({ page }) => {
    const BY = { 1000: { a1a8: 0.1, g1g2: 0.6 }, 2200: { a1a8: 0.8, g1g2: 0.05 } };
    const positions = Array.from({ length: 10 }, (_, i) => ({ ...ROOK, id: 'h' + i, maia: { ...ROOK.maia, by_elo: BY } }));
    const history = Array.from({ length: 8 }, (_, i) => ({ id: 'h' + i, mode: 'best', phase: 'endgame', tags: [], cost: 0, score: 100, mb: true, mr: false, mm: false, t: 1_700_000_000_000 + i * 60_000, dur: 10, fen: ROOK.fen, uci: i % 2 ? 'g1g2' : 'a1a8', opp: 1500 }));
    await preset(page, { theme, store: { history } });
    await serveDataset(page, positions);
    await page.goto('/#stats');
    await expect(page.locator('.level-card svg.chart')).toHaveCount(2);
    await scan(page, `${theme} level card`);
  });
}

for (const theme of ['light', 'dark']) {
  test(`axe: ${theme} theme, the reveal with move tiers and the open list of all moves`, async ({ page }) => {
    await preset(page, { theme, confirm: false });
    await serveDataset(page, [ROOK]);
    await page.goto('/');
    await expect(page.locator('[data-sq]')).toHaveCount(64);
    await clickMove(page, 'a1a2'); // a middling move, so several tiers are on screen
    await expect(page.locator('svg.tier-bar')).toBeVisible();
    await page.locator('.all-moves summary').click();
    await page.locator('.ml-row').first().click();
    await scan(page, `${theme} tiers`);
  });
}

for (const theme of ['light', 'dark']) {
  test(`axe: ${theme} theme, the session report`, async ({ page }) => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...ROOK, id: 'd' + String(i).padStart(9, '0') }));
    await preset(page, { theme, confirm: false });
    await serveDataset(page, many);
    await page.goto('/');
    await expect(page.locator('[data-sq]')).toHaveCount(64);
    await page.locator('#sessionBtn').click();
    await clickMove(page, 'a1a8'); await page.locator('#next').click();
    await clickMove(page, 'a1a2'); await page.locator('#next').click();
    await clickMove(page, 'g1f1'); await page.locator('#sessionEnd').click();
    await expect(page.locator('#reportView')).toBeVisible();
    await scan(page, `${theme} report`);
  });
}

test('axe: error state', async ({ page }) => {
  await preset(page);
  await page.route('**/data/positions.json', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.goto('/');
  await expect(page.locator('#retry')).toBeVisible();
  await scan(page, 'error');
});

// Negative control: the scans above report nothing, which only means something if axe can fail here.
test('axe control: a missing alt text and low-contrast text are detected', async ({ page }) => {
  await preset(page);
  await serveDataset(page, [ROOK]);
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40">');
    document.body.insertAdjacentHTML('beforeend', '<p id="lowc">low contrast</p>');
    document.getElementById('lowc').style.color = '#cccccc'; // CSSOM, allowed by the CSP
    document.getElementById('lowc').style.background = '#ffffff';
  });
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const ids = violations.map((v) => v.id);
  expect(ids).toContain('image-alt');
  expect(ids).toContain('color-contrast');
});
