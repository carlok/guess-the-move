// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Lighthouse (mobile) on the real build: `make dist`, served from this process with gzip like the nginx container does, and the
 * shipped 2,000-position dataset, so the numbers include the cost of loading the data. Fails when a budget is missed.
 *
 *   node tools/lighthouse_check.js [--dist dist] [--write docs/lighthouse/summary.json]
 *
 * Chrome: CHROME_PATH, else the usual macOS location, else whatever lighthouse finds. The lighthouse version is pinned so a
 * score does not move because the tool did. Only `evaluate` is unit tested (web/test/lighthouse-check.test.js); running it
 * needs a browser. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const cp = require('node:child_process');

const LIGHTHOUSE = 'lighthouse@13.6.0';
/* Scores are 0 to 1, metrics are in ms (layout shift unitless). The performance score and the metrics that depend on the runner's
 * CPU (blocking time, interactive) are reported and not gated: the same build scored 92 on a Mac and 49 on a GitHub runner, because
 * parsing the 4.8 MB dataset at start-up took 340 ms against 1,650 ms of blocking time. They can be gated once the dataset is
 * split into shards (backlog item 5). Largest paint and layout shift are what the start-up fixes address, and they hold on both. */
const BUDGET = {
  categories: { accessibility: 0.95, 'best-practices': 0.95 },
  metrics: { 'largest-contentful-paint': 2500, 'cumulative-layout-shift': 0.1 }
};
const REPORTED = ['first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'speed-index', 'total-byte-weight'];

/* The summary to keep, and the list of budgets missed (empty when all hold). Pure. */
function evaluate(lhr, budget) {
  budget = budget || BUDGET;
  var scores = {}, metrics = {}, failures = [];
  Object.keys(lhr.categories).forEach(function (k) { scores[k] = Math.round(lhr.categories[k].score * 100); });
  REPORTED.forEach(function (k) { var a = lhr.audits[k]; if (a) metrics[k] = String(a.displayValue || '').replace(/ /g, ' '); });
  Object.keys(budget.categories).forEach(function (k) {
    var c = lhr.categories[k];
    if (!c || c.score < budget.categories[k]) failures.push(k + ' score ' + (c ? Math.round(c.score * 100) : 'missing') + ' is below ' + Math.round(budget.categories[k] * 100));
  });
  Object.keys(budget.metrics).forEach(function (k) {
    var a = lhr.audits[k];
    if (!a || typeof a.numericValue !== 'number' || a.numericValue > budget.metrics[k]) failures.push(k + ' ' + (a && typeof a.numericValue === 'number' ? Math.round(a.numericValue * 1000) / 1000 : 'missing') + ' is above ' + budget.metrics[k]);
  });
  return {
    summary: { tool: 'lighthouse ' + lhr.lighthouseVersion, formFactor: lhr.configSettings.formFactor, throttling: lhr.configSettings.throttlingMethod, scores: scores, metrics: metrics },
    failures: failures
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/* dist/ over http with gzip for text and no caching, and the "no api" answer the container gives, so the console stays clean. */
function serve(root) {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/api/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"unavailable"}'); return; }
      if (p.endsWith('/')) p += 'index.html';
      var file = path.join(root, path.normalize(p));
      if (file.indexOf(path.resolve(root)) !== 0) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, function (err, data) {
        if (err) { res.writeHead(404); res.end(); return; }
        var ext = path.extname(file), head = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-cache' };
        if (/gzip/.test(req.headers['accept-encoding'] || '') && /\.(html|js|css|json|svg|webmanifest)$/.test(ext)) { head['content-encoding'] = 'gzip'; res.writeHead(200, head); res.end(zlib.gzipSync(data)); }
        else { res.writeHead(200, head); res.end(data); }
      });
    }).listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  var mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return fs.existsSync(mac) ? mac : null;
}

async function main(argv) {
  var arg = function (name, dflt) { var i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
  var dist = path.resolve(arg('--dist', 'dist')), write = arg('--write', null);
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('no ' + dist + '/index.html: run `make dist` first'); return 2; }
  var server = await serve(dist), out = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gtm-lh-')), 'report.json');
  try {
    var args = ['--yes', LIGHTHOUSE, 'http://127.0.0.1:' + server.address().port + '/', '--only-categories=performance,accessibility,best-practices',
      '--chrome-flags=--headless=new --no-sandbox', '--output=json', '--output-path=' + out, '--quiet'];
    var chrome = chromePath(); if (chrome) args.push('--chrome-path=' + chrome);
    // Asynchronous on purpose: this process is also the web server, and a blocking call would never answer lighthouse.
    var status = await new Promise(function (resolve) { cp.spawn('npx', args, { stdio: ['ignore', 'inherit', 'inherit'] }).on('exit', resolve); });
    if (status !== 0 || !fs.existsSync(out)) { console.error('lighthouse did not produce a report'); return 2; }
  } finally { server.close(); }
  var result = evaluate(JSON.parse(fs.readFileSync(out, 'utf8')));
  console.log(JSON.stringify(result.summary, null, 2));
  if (write) {
    var n = JSON.parse(fs.readFileSync('web/data/positions.json', 'utf8')).positions.length;
    var keep = Object.assign({ target: 'dist/ served with gzip by tools/lighthouse_check.js, shipped dataset (' + n + ' positions), headless Chrome, one run, ' + new Date().toISOString().slice(0, 10) }, result.summary);
    fs.writeFileSync(write, JSON.stringify(keep, null, 2) + '\n');
  }
  result.failures.forEach(function (f) { console.error('BUDGET: ' + f); });
  return result.failures.length ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then(function (code) { process.exit(code); });
module.exports = { evaluate: evaluate, BUDGET: BUDGET };
