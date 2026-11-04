// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Shared jsdom harness. Runs the page's own <script src> files, in page order, through vm.Script with the real
 * file name, so V8 attributes coverage to web/*.js. (window.eval inside jsdom hides the code from coverage.) */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPT_TAG = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;

const LAZY_TAG = /<script\b[^>]*\btype="text\/lazy"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;
const rawHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HTML = rawHtml.replace(SCRIPT_TAG, '');
const SCRIPTS = Array.from(rawHtml.matchAll(SCRIPT_TAG), (m) => m[1]);
/* The parts index.html marks type="text/lazy": the browser neither fetches nor runs them, the page loads them when first used. */
const LAZY = Array.from(rawHtml.matchAll(LAZY_TAG), (m) => m[1]);
/* The same page with its lazy tags left in (inert, as in a browser), for tests of the loading itself. */
const HTML_LAZY = rawHtml.replace(SCRIPT_TAG, (m, src) => (LAZY.includes(src) ? m : ''));

/* The page keeps a 250 ms interval for the timer display; a live interval would keep node waiting after the tests end,
 * so jsdom windows get a stand-in that records the callbacks (window.__intervals) and lets a test call them. */
function newDom({ lazy = false } = {}) {
  const dom = new JSDOM(lazy ? HTML_LAZY : HTML, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.__intervals = [];
  dom.window.setInterval = (fn) => dom.window.__intervals.push(fn);
  return dom;
}

function runScript(dom, rel) {
  const filename = path.join(ROOT, rel);
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(dom.getInternalVMContext());
}

/* Run every script the page references, in order. Call after installing window.fetch and other stubs.
 * Default: the lazy ones too, up front (most tests are not about loading). With `lazy` (and a dom made with newDom({ lazy: true }))
 * they wait until the page appends a <script> for them, as in a browser: `fail` names files whose load errors, `empty` files that
 * load without defining anything; `window.__lazyLoads` lists the files asked for. */
function loadApp(dom, { lazy = false, fail = [], empty = [] } = {}) {
  const w = dom.window;
  if (lazy) {
    w.__lazyLoads = [];
    w.document.head.appendChild = function (el) {
      if (el.tagName !== 'SCRIPT' || !el.getAttribute('src')) return Object.getPrototypeOf(this).appendChild.call(this, el);
      const file = new URL(el.getAttribute('src'), 'http://localhost/').pathname.slice(1);
      w.__lazyLoads.push(file);
      w.setTimeout(() => {
        if (fail.includes(file) || !LAZY.includes(file)) { if (el.onerror) el.onerror(); return; }
        if (!empty.includes(file)) runScript(dom, file);
        if (el.onload) el.onload();
      }, 0);
      return el;
    };
  }
  SCRIPTS.filter((rel) => !lazy || !LAZY.includes(rel)).forEach((rel) => runScript(dom, rel));
}

module.exports = { ROOT, HTML, SCRIPTS, LAZY, newDom, runScript, loadApp };
