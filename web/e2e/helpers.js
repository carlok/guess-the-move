// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const G = require('../scoring.js');

/* Serve only the positions that `pick` selects from the real data file (still fetched through whatever
 * serves the page, so a container's headers, compression and CSP are exercised). Returns the chosen list. */
async function serveSubset(page, pick = (positions) => positions.slice(0, 1)) {
  const chosen = [];
  await page.route('**/data/positions.json', async (route) => {
    try {
      const res = await route.fetch();
      const data = await res.json();
      data.positions = pick(data.positions);
      chosen.splice(0, chosen.length, ...data.positions);
      await route.fulfill({ response: res, json: data });
    } catch (e) {
      // The page can end while a second request for the file (the preload) is still being read: not a failure of the test.
      if (!page.isClosed()) throw e;
    }
  });
  return chosen;
}

/* Console errors, warnings, page errors and CSP violations seen so far. */
function watchProblems(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp = (window.__csp || []).concat(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return { problems, csp: () => page.evaluate(() => window.__csp || []) };
}

/* Serve a synthetic dataset instead of the shipped one (UI behaviour tests need known positions). */
async function serveDataset(page, positions) {
  await page.route('**/data/positions.json', (route) =>
    route.fulfill({ json: { schema: 1, meta: { demo: false, engine: 'synthetic' }, positions } }));
}

/* Skip the first-run onboarding (its own spec covers it) and start from a known theme/confirm setting. */
async function preset(page, { onboarded = true, theme, confirm, store = {} } = {}) {
  const id = `gtm.preset.${Math.random().toString(36).slice(2)}`;
  await page.addInitScript(({ id, onboarded, theme, confirm, store }) => {
    try {
      if (sessionStorage.getItem(id)) return; // already applied in this tab: do not undo what the page saved since
      sessionStorage.setItem(id, '1');
      if (onboarded) localStorage.setItem('gtm.v1.onboarded', 'true');
      if (theme) localStorage.setItem('gtm.v1.theme', JSON.stringify(theme));
      if (confirm !== undefined) localStorage.setItem('gtm.v1.confirm', JSON.stringify(confirm));
      Object.keys(store).forEach((k) => localStorage.setItem('gtm.v1.' + k, JSON.stringify(store[k])));
    } catch (e) { /* storage unavailable */ }
  }, { id, onboarded, theme, confirm, store });
}

const bestMove = (pos) => G.bestMove(pos.evals);
const square = (page, name) => page.locator(`[data-sq="${name}"]`);

/* Click source then destination (the board is re-rendered after every click, so locators are re-resolved). */
async function clickMove(page, uci) {
  await square(page, uci.slice(0, 2)).click();
  await square(page, uci.slice(2, 4)).click();
}

async function center(page, name) {
  const box = await square(page, name).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/* Mouse drag from one square to another. `release: false` leaves the button down (for mid-drag assertions). */
async function mouseDrag(page, from, to, { release = true, steps = 8 } = {}) {
  const a = await center(page, from), b = await center(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  if (release) await page.mouse.up();
}

/* One raw-CDP session per page for every touch this file sends. Mixing it with page.touchscreen.tap in one test (a CDP drag, then a
 * Playwright tap) failed every time on the GitHub runner's Linux Chrome while passing on macOS: the tap reached the page's
 * coordinates but no click came out. So a test that drags with CDP also taps with CDP (touchTap below). */
const sessions = new WeakMap();
async function cdpSession(page) {
  if (!sessions.has(page)) sessions.set(page, await page.context().newCDPSession(page));
  return sessions.get(page);
}

/* Touch drag through Chrome's input pipeline (page.touchscreen can only tap).
 * It moves like a finger: a few milliseconds between moves, and a short hold before lifting. Scripted moves sent back to back,
 * with the lift at full speed, look like a FLING to Chrome; on the GitHub runner's Linux Chrome the next tap (about 100 ms later)
 * was then swallowed: pointerup and touchend reached the page but Chrome never produced the click (see the event log this test
 * prints when it fails). A real finger stops before it lifts. */
const MOVE_GAP_MS = 12, HOLD_BEFORE_LIFT_MS = 150;

async function touchPath(page, points, { release = true } = {}) {
  const cdp = await cdpSession(page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
  await send('touchStart', [points[0]]);
  for (const p of points.slice(1)) { await send('touchMove', [p]); await page.waitForTimeout(MOVE_GAP_MS); }
  const lift = async () => { await page.waitForTimeout(HOLD_BEFORE_LIFT_MS); await send('touchEnd', []); };
  if (release) await lift();
  return { cdp, end: lift };
}

/* A tap on an element through the same CDP session as touchDrag. */
async function touchTap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const cdp = await cdpSession(page);
  const point = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function touchDrag(page, from, to, { release = true, steps = 8 } = {}) {
  const a = await center(page, from), b = await center(page, to);
  const pts = [[a.x, a.y]];
  for (let i = 1; i <= steps; i++) pts.push([a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps]);
  return touchPath(page, pts, { release });
}

module.exports = {
  serveSubset, serveDataset, preset, watchProblems, bestMove, square, clickMove, center, mouseDrag, touchPath, touchDrag, touchTap,
};
