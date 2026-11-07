// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* The GitHub Pages build (`make pages`) served from a sub-path, https://carlok.github.io/guess-the-move/, by a host that only serves files:
 * no response headers (the policy is a <meta> tag), no /api/healthz of its own (the build ships a file that answers "unavailable"), and
 * a service worker whose scope is the sub-path. `make pages-check` sets GTM_PAGES, which makes e2e/serve.js behave like that host. */
const { test, expect } = require('@playwright/test');
const { serveSubset, watchProblems, preset } = require('./helpers');

const BASE = '/guess-the-move/';

test.skip(!process.env.GTM_PAGES, 'needs the Pages build served as a file host (run make pages-check)');

test('opens under the sub-path with the meta policy, no console problem, and no api panel', async ({ page }) => {
  await preset(page);
  const watch = watchProblems(page);
  await serveSubset(page);
  await page.goto(BASE);
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await expect(page.locator('#apiPanel')).toBeHidden();
  const answer = await page.evaluate(() => fetch('api/healthz').then((r) => ({ ok: r.ok, body: r.text() })).then(async (x) => ({ ok: x.ok, body: await x.body })));
  expect(answer.ok, 'the stub is served, not a 404 the browser would log').toBe(true);
  expect(JSON.parse(answer.body)).toEqual({ status: 'unavailable' });
  expect(await watch.csp(), 'CSP violations').toEqual([]);
  expect(watch.problems, 'console problems').toEqual([]);
});

test('the manifest, its icons and the worker all resolve under the sub-path', async ({ page }) => {
  await preset(page);
  await serveSubset(page);
  await page.goto(BASE);
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  const m = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    const manifest = await (await fetch(href)).json();
    const urls = manifest.icons.map((i) => new URL(i.src, href).pathname);
    const icons = await Promise.all(urls.map((u) => fetch(u).then((r) => r.ok)));
    const reg = await navigator.serviceWorker.ready;
    return { manifest: new URL(href).pathname, start: new URL(manifest.start_url, href).pathname, scope: new URL(manifest.scope, href).pathname, icons, urls, worker: new URL(reg.scope).pathname };
  });
  expect(m.manifest).toBe(BASE + 'manifest.webmanifest');
  expect(m.start).toBe(BASE);
  expect(m.scope).toBe(BASE);
  expect(m.urls.every((u) => u.startsWith(BASE)), m.urls.join(' ')).toBe(true);
  expect(m.icons.every(Boolean), 'every icon is served').toBe(true);
  expect(m.worker).toBe(BASE);
});

test('a copied link to a position keeps the sub-path', async ({ page }) => {
  await preset(page, { confirm: false });
  await serveSubset(page);
  await page.goto(BASE);
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await page.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await page.locator('#linkBtn').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toMatch(/\/guess-the-move\/#p=[0-9a-f]{10}$/);
});

test('after one visit the page opens and plays with the network off, from the sub-path', async ({ page, context }) => {
  await preset(page, { confirm: false });
  await page.goto(BASE);
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('gtm-')).length), 'one cache for this build').toBe(1);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'the page is now controlled by the worker').toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-sq]')).toHaveCount(64);
  await expect(page.locator('#prompt')).not.toContainText('Could not load');
  await context.setOffline(false);
});
