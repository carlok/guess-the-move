'use strict';
/* Shared jsdom harness. Runs the page's own <script src> files, in page order, through vm.Script with the real
 * file name, so V8 attributes coverage to web/*.js. (window.eval inside jsdom hides the code from coverage.) */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPT_TAG = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;

const rawHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HTML = rawHtml.replace(SCRIPT_TAG, '');
const SCRIPTS = Array.from(rawHtml.matchAll(SCRIPT_TAG), (m) => m[1]);

/* The page keeps a 250 ms interval for the timer display; a live interval would keep node waiting after the tests end,
 * so jsdom windows get a stand-in that records the callbacks (window.__intervals) and lets a test call them. */
function newDom() {
  const dom = new JSDOM(HTML, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.__intervals = [];
  dom.window.setInterval = (fn) => dom.window.__intervals.push(fn);
  return dom;
}

function runScript(dom, rel) {
  const filename = path.join(ROOT, rel);
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(dom.getInternalVMContext());
}

/* Run every script the page references, in order. Call after installing window.fetch and other stubs. */
function loadApp(dom) {
  SCRIPTS.forEach((rel) => runScript(dom, rel));
}

module.exports = { ROOT, HTML, SCRIPTS, newDom, runScript, loadApp };
