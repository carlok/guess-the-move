// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* Static file server for the browser tests: `node e2e/serve.js [port]`. Serves ./web (or $GTM_ROOT). Node's HTTP server has a deep listen
 * backlog; python's http.server dropped connections (ERR_SOCKET_NOT_CONNECTED) under 12 parallel page loads. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/* GTM_PAGES=1: behave like GitHub Pages, a host that only serves files: the site is also served under /guess-the-move/, and nothing is
 * answered for /api/healthz that is not a file (the Pages build ships api/healthz; without it the page would get a 404, as it would there). */
const PAGES = !!process.env.GTM_PAGES;
const PREFIX = '/guess-the-move';

const ROOT = process.env.GTM_ROOT ? path.resolve(process.env.GTM_ROOT) : path.resolve(__dirname, '..'); // GTM_ROOT=../dist serves a built dist/
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (PAGES && url.pathname === PREFIX) { res.writeHead(301, { Location: PREFIX + '/' }).end(); return; } // as GitHub Pages does
  const pathname = PAGES && url.pathname.startsWith(PREFIX + '/') ? url.pathname.slice(PREFIX.length) : url.pathname;
  if (!PAGES && pathname === '/api/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"unavailable"}'); return; } // like the container without an api
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}node_modules${path.sep}`)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  });
}).listen(Number(process.argv[2]) || 8765, '127.0.0.1', () => console.log('serving', ROOT));
