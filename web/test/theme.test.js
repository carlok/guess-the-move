// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const factory = require('../theme.js');

/* A stand-in window: just what theme.js touches. */
function fakeWindow({ stored, dark = false, storage = true, matchMedia = true } = {}) {
  const attrs = {};
  const kv = stored === undefined ? {} : { 'gtm.v1.theme': stored };
  const w = {
    document: { documentElement: { getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } } },
    localStorage: storage ? { getItem: (k) => (k in kv ? kv[k] : null), setItem: (k, v) => { kv[k] = v; } }
      : { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } },
    matchMedia: matchMedia ? (q) => ({ matches: q.includes('dark') && dark }) : undefined
  };
  return { w, attrs, kv };
}

test('follows the system theme when nothing is stored', () => {
  assert.equal(factory(fakeWindow({ dark: true }).w).current(), 'dark');
  assert.equal(factory(fakeWindow({ dark: false }).w).current(), 'light');
});

test('a stored choice wins over the system', () => {
  assert.equal(factory(fakeWindow({ stored: '"light"', dark: true }).w).current(), 'light');
  assert.equal(factory(fakeWindow({ stored: '"dark"', dark: false }).w).current(), 'dark');
});

test('garbage in storage is ignored', () => {
  assert.equal(factory(fakeWindow({ stored: '"purple"', dark: true }).w).current(), 'dark');
  assert.equal(factory(fakeWindow({ stored: 'not json', dark: false }).w).current(), 'light');
});

test('toggle flips the theme and remembers it', () => {
  const { w, kv } = fakeWindow({ dark: false });
  const t = factory(w);
  assert.equal(t.toggle(), 'dark');
  assert.equal(JSON.parse(kv['gtm.v1.theme']), 'dark');
  assert.equal(t.toggle(), 'light');
  assert.equal(t.current(), 'light');
});

test('works with storage denied and without matchMedia', () => {
  const t = factory(fakeWindow({ storage: false, matchMedia: false }).w);
  assert.equal(t.current(), 'light');
  assert.equal(t.toggle(), 'dark');
});
