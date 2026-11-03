'use strict';
/* Evidence for the UI work: screenshots at the three viewports, a drag frame sequence, and colour-blindness simulations.
 * Run: node e2e/capture.js  (from web/). Writes to ../docs/screens. Uses the shipped demo data and the installed Chrome. */
const { chromium, devices } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const G = require('../scoring.js');

const OUT = path.resolve(__dirname, '../../docs/screens');
const VIEWPORTS = [
  { name: 'desktop-1280x800', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { name: 'tablet-768x1024', viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 },
  { name: 'phone-390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
];

async function newPage(browser, vp, { theme, onboarded = true } = {}) {
  const ctx = await browser.newContext(vp);
  const page = await ctx.newPage();
  await page.addInitScript(({ theme, onboarded }) => {
    if (onboarded) localStorage.setItem('gtm.v1.onboarded', 'true');
    if (theme) localStorage.setItem('gtm.v1.theme', JSON.stringify(theme));
  }, { theme, onboarded });
  let first;
  await page.route('**/data/positions.json', async (route) => {
    const res = await route.fetch(); const data = await res.json();
    data.positions = [data.positions.find((p) => p.stm === 'w' && Object.keys(p.evals).length > 20) || data.positions[0]];
    first = data.positions[0];
    await route.fulfill({ response: res, json: data });
  });
  await page.goto('/');
  await page.locator('[data-sq]').first().waitFor();
  return { ctx, page, pos: () => first };
}

async function playBest(page, pos) {
  const uci = G.bestMove(pos.evals);
  await page.locator(`[data-sq="${uci.slice(0, 2)}"]`).click();
  await page.locator(`[data-sq="${uci.slice(2, 4)}"]`).click();
  if (await page.locator('#confirm').isVisible()) await page.locator('#confirm').click();
  await page.locator('#result').waitFor();
  await page.waitForTimeout(500); // let the arrows fade in
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('node', [path.join(__dirname, 'serve.js'), '8766'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  process.env.PW_BASE = 'http://127.0.0.1:8766';
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const vp of VIEWPORTS) {
      const base = { baseURL: process.env.PW_BASE, ...vp };
      let { ctx, page, pos } = await newPage(browser, base);
      await page.screenshot({ path: `${OUT}/after-${vp.name}.png`, fullPage: false });
      await playBest(page, pos());
      await page.screenshot({ path: `${OUT}/after-${vp.name}-reveal.png`, fullPage: false });
      await page.screenshot({ path: `${OUT}/after-${vp.name}-reveal-full.png`, fullPage: true });
      await ctx.close();
      ({ ctx, page, pos } = await newPage(browser, base, { theme: 'dark' }));
      await playBest(page, pos());
      await page.screenshot({ path: `${OUT}/after-${vp.name}-reveal-dark.png`, fullPage: false });
      await ctx.close();
      ({ ctx, page } = await newPage(browser, base, { onboarded: false }));
      await page.screenshot({ path: `${OUT}/after-${vp.name}-onboarding.png`, fullPage: false });
      await ctx.close();
    }

    // Drag frame sequence on desktop: pressed, mid-flight over a legal square, dropped.
    {
      const base = { baseURL: process.env.PW_BASE, ...VIEWPORTS[0] };
      const { ctx, page, pos } = await newPage(browser, base);
      const uci = G.bestMove(pos().evals);
      const c = async (sq) => { const b = await page.locator(`[data-sq="${sq}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
      const a = await c(uci.slice(0, 2)), b = await c(uci.slice(2, 4));
      const board = await page.locator('#boardSvg').boundingBox();
      const shot = (n) => page.screenshot({ path: `${OUT}/drag-${n}.png`, clip: board });
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await shot(1);
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 10 }); await shot(2);
      await page.mouse.move(b.x, b.y, { steps: 10 }); await shot(3);
      await page.mouse.up(); await page.waitForTimeout(500); await shot(4);
      await ctx.close();
    }

    // Colour-blindness simulation (Chrome's own emulation) of a reveal where the guess differs from the engine's move.
    {
      const { ctx, page, pos } = await newPage(browser, { baseURL: process.env.PW_BASE, ...VIEWPORTS[0] });
      const ranked = Object.keys(pos().evals).sort((x, y) => pos().evals[y] - pos().evals[x]);
      const uci = ranked[Math.floor(ranked.length / 2)];
      await page.locator(`[data-sq="${uci.slice(0, 2)}"]`).click();
      await page.locator(`[data-sq="${uci.slice(2, 4)}"]`).click();
      await page.locator('#result').waitFor(); await page.waitForTimeout(500);
      const board = await page.locator('#boardSvg').boundingBox();
      await page.screenshot({ path: `${OUT}/cvd-normal.png`, clip: board });
      const cdp = await ctx.newCDPSession(page);
      for (const kind of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']) {
        await cdp.send('Emulation.setEmulatedVisionDeficiency', { type: kind });
        await page.screenshot({ path: `${OUT}/cvd-${kind}.png`, clip: board });
      }
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
  console.log('wrote', fs.readdirSync(OUT).filter((f) => /^(after|drag|cvd)/.test(f)).length, 'files to', OUT);
})();
