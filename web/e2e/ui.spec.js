// SPDX-License-Identifier: AGPL-3.0-or-later
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
    await new Promise((r) => setTimeout(r, 2500)); // long enough that a busy machine still sees the skeleton before the data arrives
    await route.fulfill({ json: { schema: 1, meta: { demo: false }, positions: [ROOK] } });
  });
  await page.goto('/');
  await expect(page.locator('#skeleton')).toBeVisible();
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#skeleton')).toBeHidden();
});

test('the board does not jump when the first position arrives (the opening line and chips have their rows reserved)', async ({ page }) => {
  test.skip(page.viewportSize().width >= 900, 'the stacked layout only: on the desktop grid the rows are not reserved, to keep the board large');
  await preset(page);
  await page.route('**/data/positions.json', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.fulfill({ json: { schema: 1, meta: { demo: false }, positions: [{ ...ROOK, game: { opening: 'Scandinavian Defense', eco: 'B01' } }] } });
  });
  await page.addInitScript(() => {
    window.__cls = 0; window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        window.__shifts.push((e.sources || []).map((s) => `${s.node && (s.node.id || s.node.className || s.node.nodeName)}: y ${s.previousRect.y | 0}->${s.currentRect.y | 0}, h ${s.previousRect.height | 0}->${s.currentRect.height | 0}`)); // what moved, for a failure message
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#openingLine')).toBeVisible();
  await page.waitForTimeout(300);
  const cls = await page.evaluate(() => window.__cls), moved = await page.evaluate(() => JSON.stringify(window.__shifts));
  expect(cls, 'cumulative layout shift while the data arrives; what moved: ' + moved).toBeLessThan(0.02);
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
  // ROOK: you and Stockfish chose a1a8, the real player and Maia chose g1g2: two arrows, each with one pill naming its keys
  expect(await page.locator('#boardSvg .arrow').count()).toBe(2);
  const labels = await page.locator('#boardSvg .arrow-label').allTextContents();
  expect(labels.map((t) => t.replace(/\s+/g, ' ').trim()).sort()).toEqual(['R M', 'Y S']);
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

test('How it works, About and Settings are pages of their own; each opens, takes focus, and closes with Escape', async ({ page }) => {
  await open(page);
  const pages = [['help', 'helpBtn', ['How it works', 'Keyboard']], ['settings', 'settingsBtn', ['Settings']], ['about', null, ['About Guess the Move', 'The data', 'Credits and licences']]];
  for (const [name, btn, headings] of pages) {
    const view = page.locator('#' + name + 'View');
    await expect(view).toBeHidden();
    if (btn) await page.locator('#' + btn).click(); else await page.locator('footer a[href="#about"]').click();
    await expect(view).toBeVisible();
    await expect(page.locator('#gameMain')).toBeHidden();
    await expect(page.locator('#' + name + 'Title')).toBeFocused();
    for (const h of headings) await expect(view.getByRole('heading', { name: h })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view).toBeHidden();
    await expect(page.locator('#gameMain')).toBeVisible();
  }
  await page.locator('#helpBtn').click();
  await page.locator('#helpView .pagenav a[href="#about"]').click();
  await expect(page.locator('#aboutList')).toContainText('1 positions from real Lichess games');
  await expect(page.locator('#aboutView .pagenav [aria-current=page]')).toHaveText('About');
});

test('each page: no horizontal scroll and every button and link is a comfortable target', async ({ page }) => {
  await open(page);
  for (const [name, btn] of [['help', 'helpBtn'], ['settings', 'settingsBtn'], ['stats', 'statsBtn']]) {
    await page.locator('#' + btn).click();
    await page.locator('#' + name + 'View a').last().scrollIntoViewIfNeeded().catch(() => {});
    const m = await page.evaluate((n) => {
      const view = document.getElementById(n + 'View');
      const small = [...view.querySelectorAll('.statsview-head button, .pagenav a')].map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44).length;
      return { page: document.documentElement.scrollWidth > innerWidth, small };
    }, name);
    expect(m.page, name).toBe(false);
    expect(m.small, name + ': buttons and nav links under 44 px high').toBe(0);
    await page.keyboard.press('Escape');
  }
});

test('"Show the quick tour" on the help page brings the onboarding back', async ({ page }) => {
  await open(page);
  await page.locator('#helpBtn').click();
  await page.locator('#tourBtn').click();
  await expect(page.locator('#helpView')).toBeHidden();
  await expect(page.locator('#onboarding')).toBeVisible();
});

test('every credit link opens in a new tab without leaking the opener', async ({ page }) => {
  await open(page);
  await page.locator('footer a[href="#about"]').click();
  const bad = await page.$$eval('#aboutView a[href^="http"], #helpView a[href^="http"]', (as) => as.filter((a) => a.target !== '_blank' || !/noopener/.test(a.rel)).map((a) => a.href));
  expect(bad).toEqual([]);
});

test('the filter dropdowns stay inside the panel however long their options are', async ({ page }) => {
  const tags = ['real_blunder', 'real_is_best', 'maia_miss', 'maia_error', 'hard_find', 'only_move', 'real_mistake', 'trivial'];
  const long = (i) => ({ ...ROOK, id: 'f' + String(i).padStart(9, '0'), tags: [tags[i % tags.length]],
    game: { opening: 'Queen\'s Gambit Declined: Orthodox Defense, Rubinstein Attack, Carlsbad Variation', eco: 'D63' } });
  await preset(page, { confirm: false });
  await serveDataset(page, Array.from({ length: 12 }, (_, i) => long(i)));
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  const m = await page.evaluate(() => {
    const right = (s) => document.querySelector(s).getBoundingClientRect().right;
    return { panel: right('#panel'), filters: right('#filters'), tag: right('#tag'), opening: right('#opening'), phase: right('#phase'), vw: innerWidth, sw: document.documentElement.scrollWidth };
  });
  expect(m.tag, 'Kind').toBeLessThanOrEqual(m.filters + 0.5);
  expect(m.opening, 'Opening').toBeLessThanOrEqual(m.filters + 0.5);
  expect(m.phase, 'Phase').toBeLessThanOrEqual(m.filters + 0.5);
  expect(m.filters).toBeLessThanOrEqual(m.panel + 0.5);
  expect(m.sw, 'no horizontal scroll').toBeLessThanOrEqual(m.vw);
});

test('on a large screen the board grows with the window height instead of leaving empty bands on both sides', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'sizes are set here, whatever the project');
  // positions with an opening and rating data, so the opening line and the "chosen to sharpen" chip are on screen, as in real use
  const by = { 1000: { a1a8: 0.1, g1g2: 0.6 }, 2200: { a1a8: 0.8, g1g2: 0.05 } };
  const real = (i) => ({ ...ROOK, id: 'g' + String(i).padStart(9, '0'), game: { opening: 'Scandinavian Defense: Modern Variation', eco: 'B01' }, maia: { ...ROOK.maia, by_elo: by } });
  await preset(page, { confirm: false });
  await serveDataset(page, Array.from({ length: 6 }, (_, i) => real(i)));
  await page.goto('/');
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#openingLine')).toBeVisible();
  await expect(page.locator('#pickChip')).toBeVisible();
  const measure = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(100);
    return page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { board: r('#boardSvg'), main: r('#gameMain'), panel: r('#panel'), prompt: r('#prompt'), top: r('.topbar'), vh: innerHeight, vw: innerWidth, sw: document.documentElement.scrollWidth };
    });
  };
  const small = await measure(1280, 800);
  expect(small.board.width, 'unchanged at 1280x800').toBeLessThanOrEqual(680);
  const hd = await measure(1920, 1080);
  expect(hd.board.width, 'full HD').toBeGreaterThanOrEqual(800);
  expect(hd.prompt.bottom, 'the board and its prompt are visible without scrolling').toBeLessThanOrEqual(hd.vh);
  expect(hd.main.width, 'the page uses the width').toBeGreaterThanOrEqual(1500);
  const qhd = await measure(2560, 1440);
  expect(qhd.board.width, 'QHD').toBeGreaterThanOrEqual(1100);
  expect(qhd.prompt.bottom).toBeLessThanOrEqual(qhd.vh);
  expect(qhd.main.width).toBeGreaterThanOrEqual(2000);
  expect(qhd.panel.width, 'the panel stays readable, not stretched across the leftover width').toBeLessThanOrEqual(800);
  expect(Math.abs((qhd.main.left + qhd.main.right) / 2 - qhd.vw / 2), 'centred').toBeLessThan(2);
  expect(Math.abs(qhd.board.left - qhd.top.left - 16), 'the board lines up with the header').toBeLessThan(2);
  for (const m of [small, hd, qhd]) expect(m.sw).toBeLessThanOrEqual(m.vw);
});
