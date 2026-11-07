# Deploying the static site

Guess the Move is a static site: HTML, JavaScript, one style sheet, one SVG sprite and one JSON dataset. There is no
server-side code on this path, so any web host can serve it. Nothing here is specific to one host; no host has been chosen.

```bash
make dist          # builds dist/ : exactly the files index.html loads, plus pieces.svg and data/positions.json
make dist-check    # runs the browser tests against dist/ (smoke, CSP, layout)
```

`dist/version.json` lists every file with its SHA-256 and a build id. The script and style references in the copied
`index.html` carry `?v=<build id>`, so a browser that cached an old `app.js` cannot pair it with a new page. The dataset is
fetched by the scripts without a version, so the host should make browsers revalidate it (below).

## What the host should send

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | the one in `containers/web/nginx.conf` (no inline script or style is used: `default-src 'self'` and friends) | the page works under it, and it is the main defence if a string is ever rendered unescaped |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `no-referrer` | |
| `Cache-Control` | `no-cache` for `index.html` and `data/positions.json` (revalidate, do not skip the request) | the dataset has no version in its URL |
| compression | gzip or brotli for `.js`, `.css`, `.json`, `.svg` | the dataset is 4.8 MB raw and about 1.3 MB gzipped |

A host that cannot set response headers (static page hosting, some object stores) can use `python tools/build_dist.py --meta-csp`:
the policy is then written into `index.html` as a `<meta>` tag. Browsers ignore `frame-ancestors` in a meta tag, so clickjacking
protection is the one thing that needs a real header.

## Service worker and install

`dist/sw.js` caches the build for offline use and `manifest.webmanifest` makes the page installable. Browsers only run service
workers on https or localhost. The host must serve `sw.js` and `index.html` without long caching (`no-cache` is right: they are
revalidated, not skipped), so that a new build is noticed; everything else is cached by the worker under the build id. Serve
`.webmanifest` as `application/manifest+json`.

## The optional api

The page asks `api/healthz`. Without an answer it hides the "Analyse any position" panel and everything else works. A 404 is harmless to the page (the
error is caught) but the browser still logs it in the console, which the browser tests treat as a failure; if you can, answer
`200 {"status":"unavailable"}` like the nginx image does (on a host that only serves files, publish a file named `api/healthz`
with that content). The api (Stockfish and Maia in a container, see the README) cannot run on a static host; if you want it, run it
somewhere that can run containers and route `/api/` to it from the same origin, because the api refuses cross-origin POSTs
by design.

## Sub-paths

Every URL in the page is relative, so the site works from a sub-path (`https://example.org/guess-the-move/`) as well as from a
root.

## The container

`make web-image && make run` serves the same files with nginx, a read-only root file system and the headers above
(`containers/web/Containerfile`, `containers/web/nginx.conf`). It copies an explicit file list, which `tests/test_containers.py`
checks against `index.html`.
