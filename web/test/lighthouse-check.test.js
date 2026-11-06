// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, lcpElement, BUDGET } = require('../../tools/lighthouse_check.js');

const lhr = (over = {}) => ({
  lighthouseVersion: '13.6.0', configSettings: { formFactor: 'mobile', throttlingMethod: 'simulate' },
  categories: { performance: { score: 0.93 }, accessibility: { score: 1 }, 'best-practices': { score: 0.96 } },
  audits: {
    'first-contentful-paint': { displayValue: '0.9 s', numericValue: 900 },
    'largest-contentful-paint': { displayValue: '0.9 s', numericValue: 900 },
    'cumulative-layout-shift': { displayValue: '0.002', numericValue: 0.002 },
    'total-blocking-time': { displayValue: '340 ms', numericValue: 340 },
    'speed-index': { displayValue: '0.9 s', numericValue: 900 },
    'total-byte-weight': { displayValue: 'Total size was 1,380 KiB', numericValue: 1413120 }
  },
  ...over
});

test('a build inside its budgets passes, and the summary keeps the scores and the readable metrics', () => {
  const r = evaluate(lhr());
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.summary.scores, { performance: 93, accessibility: 100, 'best-practices': 96 });
  assert.equal(r.summary.metrics['first-contentful-paint'], '0.9 s', 'no-break spaces become plain ones');
  assert.deepEqual([r.summary.tool, r.summary.formFactor, r.summary.throttling], ['lighthouse 13.6.0', 'mobile', 'simulate']);
});

test('a low accessibility score and a layout shift are reported; a slow largest paint and a low performance score are not', () => {
  const bad = lhr({ categories: { performance: { score: 0.49 }, accessibility: { score: 0.9 }, 'best-practices': { score: 0.96 } } });
  bad.audits['largest-contentful-paint'].numericValue = 8400; bad.audits['cumulative-layout-shift'].numericValue = 0.136;
  const f = evaluate(bad).failures.join('\n');
  assert.doesNotMatch(f, /performance/, 'the performance score is reported, not gated (it differs a lot between machines)');
  assert.match(f, /accessibility score 90 is below 95/);
  assert.doesNotMatch(f, /largest-contentful-paint/, 'the largest paint is reported, not gated (it depends on the machine)');
  assert.match(f, /cumulative-layout-shift 0\.136 is above 0\.1/);
  assert.doesNotMatch(f, /best-practices/);
});

test('a missing category or metric fails instead of passing by default; blocking time is reported, not gated', () => {
  const x = lhr(); delete x.categories.accessibility; delete x.audits['cumulative-layout-shift'];
  const f = evaluate(x).failures.join('\n');
  assert.match(f, /accessibility score missing/);
  assert.match(f, /cumulative-layout-shift missing/);
  const slow = lhr(); slow.audits['total-blocking-time'].numericValue = 5000;
  assert.deepEqual(evaluate(slow).failures, []);
  assert.deepEqual(Object.keys(BUDGET.metrics), ['cumulative-layout-shift']);
  assert.deepEqual(Object.keys(BUDGET.categories), ['accessibility', 'best-practices']);
});

test('the largest paint element is read from the breakdown, wherever it sits in the details, and is null when there is none', () => {
  const x = lhr(); x.audits['lcp-breakdown-insight'] = { details: { items: [{ type: 'table' }, { type: 'node', selector: 'main#gameMain > div#prompt', nodeLabel: 'Find the best move for the side to play. Tap or drag a piece' }] } };
  assert.equal(lcpElement(x), 'main#gameMain > div#prompt: Find the best move for the side to play. Tap or drag a piece');
  assert.equal(evaluate(x).summary.lcpElement, lcpElement(x));
  assert.equal(lcpElement(lhr()), null);
});
