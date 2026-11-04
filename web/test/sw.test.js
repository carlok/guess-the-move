// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* The service worker, run in a fake worker scope: the caching rules are what keep a user from getting a mixed build. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function scope({ build = 'abc123', files = ['index.html', 'app.js?v=abc123'], network = {}, offline = false, existing = {} } = {}) {
  const store = Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const listeners = {}, fetched = [], state = { skipped: false, claimed: false };
  const cacheOf = (name) => ({
    addAll: async (urls) => { const m = store[name]; urls.forEach((u) => m.set(new URL(u, 'https://x.test/app/sw.js').href, { body: 'precached ' + u, ok: true })); },
    put: async (req, res) => { store[name].set(typeof req === 'string' ? req : req.url, res); },
    match: async (req) => store[name].get(typeof req === 'string' ? req : req.url)
  });
  const caches = {
    open: async (name) => { store[name] = store[name] || new Map(); return cacheOf(name); },
    keys: async () => Object.keys(store), delete: async (k) => { delete store[k]; return true; }
  };
  const self = {
    location: { origin: 'https://x.test' }, registration: { scope: 'https://x.test/app/' },
    addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting: () => { state.skipped = true; },
    clients: { claim: async () => { state.claimed = true; } }
  };
  const fetchFn = async (req) => {
    fetched.push(req.url);
    if (offline) throw new Error('offline');
    const body = network[req.url];
    return body === undefined ? { ok: false, status: 404, clone() { return this; } } : { ok: true, body, clone() { return this; } };
  };
  const code = SOURCE.replace("'__BUILD__'", JSON.stringify(build)).replace('var FILES = []; // @FILES@', 'var FILES = ' + JSON.stringify(files) + ';');
  vm.runInNewContext(code, { self, caches, fetch: fetchFn, URL, Promise, Object, Array, RegExp });
  const dispatch = async (type, event) => { let done; event.waitUntil = (p) => { done = p; }; event.respondWith = (p) => { event.response = p; }; listeners[type](event); if (done) await done; return event; };
  const get = async (url, mode = 'no-cors') => dispatch('fetch', { request: { method: 'GET', url, mode } });
  return { store, state, fetched, dispatch, get, listeners };
}

test('install precaches the build\'s files into a cache named after the build', async () => {
  const s = scope({ files: ['index.html', 'app.js?v=abc123', 'data/positions.json'] });
  await s.dispatch('install', {});
  assert.deepEqual(Object.keys(s.store), ['gtm-abc123']);
  assert.deepEqual([...s.store['gtm-abc123'].keys()], ['https://x.test/app/index.html', 'https://x.test/app/app.js?v=abc123', 'https://x.test/app/data/positions.json']);
});

test('activate deletes the caches of other builds, keeps foreign ones, and takes over the open pages', async () => {
  const s = scope({ existing: { 'gtm-old': { a: 1 }, 'gtm-abc123': { b: 1 }, 'someone-elses': { c: 1 } } });
  await s.dispatch('activate', {});
  assert.deepEqual(Object.keys(s.store).sort(), ['gtm-abc123', 'someone-elses']);
  assert.equal(s.state.claimed, true);
});

test('a new worker waits to be told to take over: skipWaiting only on the page\'s message', async () => {
  const s = scope();
  await s.dispatch('install', {});
  assert.equal(s.state.skipped, false, 'installing does not skip waiting by itself');
  await s.dispatch('message', { data: 'something else' });
  assert.equal(s.state.skipped, false);
  await s.dispatch('message', { data: 'skip' });
  assert.equal(s.state.skipped, true);
});

test('scripts are served from the cache by their exact versioned URL; an unknown version goes to the network, never to another build\'s file', async () => {
  const s = scope({ network: { 'https://x.test/app/app.js?v=new': 'NEW CODE' } });
  await s.dispatch('install', {});
  const hit = await (await s.get('https://x.test/app/app.js?v=abc123')).response;
  assert.equal(hit.body, 'precached app.js?v=abc123'); assert.deepEqual(s.fetched, [], 'no network for a cached file');
  const fresh = await (await s.get('https://x.test/app/app.js?v=new')).response;
  assert.equal(fresh.body, 'NEW CODE'); assert.deepEqual(s.fetched, ['https://x.test/app/app.js?v=new']);
  assert.ok(s.store['gtm-abc123'].has('https://x.test/app/app.js?v=new'), 'and it is kept for next time');
});

test('the page is network-first and falls back to the cached index.html offline, for any address in the scope', async () => {
  const online = scope({ network: { 'https://x.test/app/': 'LATEST PAGE' } });
  await online.dispatch('install', {});
  assert.equal((await (await online.get('https://x.test/app/', 'navigate')).response).body, 'LATEST PAGE', 'online: the latest');
  const off = scope({ offline: true });
  await off.dispatch('install', {});
  assert.equal((await (await off.get('https://x.test/app/', 'navigate')).response).body, 'precached index.html', 'offline: the cached page');
  assert.equal((await (await off.get('https://x.test/app/?data=other.json', 'navigate')).response).body, 'precached index.html');
});

test('the dataset is network-first too, with the cached copy as the offline fallback', async () => {
  const s = scope({ files: ['index.html', 'data/positions.json'], network: { 'https://x.test/app/data/positions.json': 'NEW DATA' } });
  await s.dispatch('install', {});
  assert.equal((await (await s.get('https://x.test/app/data/positions.json')).response).body, 'NEW DATA');
  const off = scope({ files: ['index.html', 'data/positions.json'], offline: true });
  await off.dispatch('install', {});
  assert.equal((await (await off.get('https://x.test/app/data/positions.json')).response).body, 'precached data/positions.json');
  assert.equal((await (await off.get('https://x.test/app/version.json')).response), undefined, 'nothing cached for it: no answer rather than a wrong one');
});

test('the api, other origins, and anything but GET are not touched', async () => {
  const s = scope();
  await s.dispatch('install', {});
  for (const request of [{ method: 'GET', url: 'https://x.test/app/api/healthz', mode: 'cors' }, { method: 'GET', url: 'https://x.test/api/v1/analyse', mode: 'cors' },
    { method: 'POST', url: 'https://x.test/app/app.js', mode: 'cors' }, { method: 'GET', url: 'https://other.test/app/app.js', mode: 'no-cors' }]) {
    const e = await s.dispatch('fetch', { request });
    assert.equal(e.response, undefined, request.method + ' ' + request.url);
  }
});

test('a failed response is not cached, so a 404 is not remembered', async () => {
  const s = scope({ network: {} });
  await s.dispatch('install', {});
  const res = await (await s.get('https://x.test/app/missing.js')).response;
  assert.equal(res.ok, false);
  assert.equal(s.store['gtm-abc123'].has('https://x.test/app/missing.js'), false);
});

test('in the source tree (placeholders left) the worker does nothing at all, so development never meets a stale cache', async () => {
  const s = scope({ build: '__BUILD__' });
  await s.dispatch('install', {}); await s.dispatch('activate', {});
  assert.deepEqual(Object.keys(s.store), [], 'nothing cached');
  const e = await s.dispatch('fetch', { request: { method: 'GET', url: 'https://x.test/app/app.js', mode: 'no-cors' } });
  assert.equal(e.response, undefined, 'every request goes to the network untouched');
});
