# Notes for coding agents

This file is a **routing and runbook** for automated coding agents (Cursor Cloud Agents, Claude Code, and similar). Humans should start with `README.md` and `CONTRIBUTING.md`. The engineering brief is `PROMPT.md`; if your change disagrees with it, stop and reconcile before shipping.

## Non-negotiables

- **Coverage before each commit:** run `make coverage` (or the relevant part) and **try to increase** test coverage for the code you touch. Thresholds in `tools/check_coverage.py` and `web/package.json` only ratchet up; never lower them.
- **No secrets or host-specific values** in the repository: no API keys, tokens, `.env` contents, personal paths, machine-specific Chrome paths, or private URLs. Use placeholders in docs and environment variables at runtime.
- **Keep public docs general:** README, `CONTRIBUTING.md`, `docs/deploy.md`, and issue templates describe what anyone can reproduce on a normal machine, not one developer's setup.

## Setup

Python **3.10–3.12** (Maia-2 tooling does not install on 3.13+). Node **22** (matches CI).

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cd web && npm ci
```

Optional: `cd web && npx playwright install --with-deps chrome` before browser tests. Rootless **podman** is needed for `make containers-check` and the tail of `make ci`.

## Commands (same as CI)

| Goal | Command |
|------|---------|
| Quick loop | `make test` — pytest at repo root, then `npm test` in `web/` |
| **Coverage gate** | `make coverage` — runs both rows below; fails below thresholds |
| Python coverage | `make coverage-python` — `pytest -q --cov` + `tools/check_coverage.py coverage.json` |
| JS coverage | `make coverage-js` — `cd web && npm run coverage` |
| Full CI locally | `make ci` — coverage, all unit tests, Playwright (Chrome), `dist-check`, `pages-check`, `lighthouse-check`, `containers-check` |

CI (`.github/workflows/ci.yml`) splits Python and web jobs but uses the same `make` targets: `make coverage-python` in the python job; `make coverage-js`, `npm test`, Playwright, `make pages-check`, and `make lighthouse-check` in the web job.

Before opening a pull request, run at least **`make coverage`** and **`make test`**. Run **`make ci`** when you changed packaging, CSP, PWA, dist/pages builds, or containers — that is what must be green on GitHub.

## Layout

```
PROMPT.md              engineering brief (single source of truth)
README.md              product overview and operator docs
CONTINUE.md            hand-off prompt for long sessions
pipeline/              dataset sampler, tags, build_dataset, backends
api/                   optional Starlette analysis service (container)
web/                   static app (no bundler): app.js, scoring.js, strings.js, e2e/, test/
tests/                 pytest + tests/vectors.json (parity with JS)
tools/                 check_coverage.py, build_dist.py, container probes, research scripts
containers/, Makefile, compose.yaml, deploy/quadlet/   podman images and run targets
.github/workflows/     ci.yml (thin wrapper around make targets)
```

## Conventions (short)

- **Tests first** for maths and data invariants; bug fixes start with a failing test.
- **Say what you did not run** — mark **UNTESTED** in summaries; do not claim engine, Maia, or real-browser results you did not execute.
- **No inline `style=` or `<script>`** in HTML; strict CSP. User-facing copy lives in `web/strings.js`.
- **No web build step** for the app: classic scripts listed in `web/index.html`.
- **Never invent dataset fields**; provenance belongs in `meta` from `pipeline/`.
- **SPDX:** `AGPL-3.0-or-later` on source files (`python tools/add_spdx.py` when adding files).
- **Changelog:** update `CHANGELOG.md` for user-visible or policy changes; `PROMPT.md` §14.1 when recording a decision or measured evidence.
- **Licence:** leave `LICENSE` and AGPL choice unchanged unless the owner explicitly asks.

## Pull requests

Follow `.github/pull_request_template.md`. Confirm `make ci` when your change can affect it. Respect `CODE_OF_CONDUCT.md`.

## More detail

- `CONTRIBUTING.md` — human contributor rules
- `SECURITY.md` — private vulnerability reports
- `docs/deploy.md` — static hosting headers and Pages vs container builds
