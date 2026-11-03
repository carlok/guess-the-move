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
    await clickMove(page, 'a1a8');
    await expect(page.locator('#confirm')).toBeVisible();
    await scan(page, `${theme} pending`);
    await page.locator('#confirm').click();
    await expect(page.locator('#result')).toBeVisible();
    await scan(page, `${theme} reveal`);
    await page.locator('summary', { hasText: 'Session stats' }).click();
    await scan(page, `${theme} reveal+stats`);
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
