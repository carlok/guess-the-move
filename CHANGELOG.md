# Changelog

## Unreleased
- `api` service (T6): `api/` (Starlette + uvicorn): `GET /healthz`, `POST /v1/analyse` (any FEN, Stockfish evaluations of every legal move, Maia at a given rating), `POST /v1/posterior` (level estimate). Validation, size/node/history/concurrency/time caps, per-client rate limit, same-origin only, no body logging, in-process LRU with optional Valkey. `containers/api`, compose profiles `api` and `cache`, Quadlet units and a private `gtm` network, nginx `/api/` through a variable upstream (web starts and works without the api; `/api/healthz` then answers 200 `unavailable`). The page feature-detects the api and offers "Analyse any position" and "Estimate my level". 53 API tests on fake backends, coverage gate includes `api/`.
- Estimator (T5): `pipeline/estimator.py`, posterior over the 11 Maia-2 rating buckets with a floored likelihood and an 80% credible interval; `tools/estimator_eval.py` measures calibration on held-out real games.
- Data (T2/T3): `--min-clock-seconds` (default 30) drops positions where the mover ended under the limit; sampling counts in dataset `meta`; `--maia-home`; Maia-2 backend no longer clamps ratings (maia2 buckets them itself); `tools/maia_probe.py`, `tools/inspect_dataset.py`.
- UI (T9): drag and drop (Pointer Events), keyboard play, confirm-before-reveal (default on for coarse pointers), light/dark theme with toggle, three responsive layouts, SVG pieces (cburnett, GPLv2+) and icons (Lucide, ISC) with `NOTICE`, one labelled arrow per distinct move, cost bars, verdict and legend, onboarding, skeleton and error/offline states, all text in `web/strings.js`. New modules `board.js` (pure, unit-tested), `theme.js`. Playwright e2e in three viewports, axe-core clean, Lighthouse mobile 100/100/100 (one run), CLS 0.003.
- Containers verified (T1): both images and the Maia builder variant built, started and probed; compose and Quadlet (inside the podman machine VM) work. Health check moved from the Containerfile (ignored for OCI images) to run time. `make e2e` runs Playwright specs in Chrome (`web/e2e`), also against a running container (`GTM_BASE_URL`). README container section rewritten with what worked.
- Quality gate (T8): `make coverage` fails below 90% lines / 85% branches overall and 100% lines on `winpct`, `tags`, `sampler` (Python, `tools/check_coverage.py`) and 95% / 90% on `scoring.js` + `app.js` (JS, `npm run coverage`). The jsdom harness now measures `app.js` (`web/test/harness.js`, `vm.Script` with real file names). New tests: `build_dataset.main()` end to end with a UCI stub engine, `backends.py` through a fake `maia2` module and MultiPV fallbacks, `hypothesis` property tests, seeded shared vectors (`tests/gen_vectors.py`, freshness-checked). `make mutation` (mutmut, Stryker) is a spot-check, not a gate. Python coverage 84% -> 100%.
- Fix: `select()` keeps each position+move id once; two games reaching the same position and move used to yield duplicate ids.
- Fix: `tag_position` no longer raises `KeyError` when Maia's top move is not among the evaluated moves; the `trivial` rule drops a redundant clause.
- Repo: `git init`, `docs/screens/before-*.png` (the v1 UI at three viewports, for the T9 before/after).
- Docs: owner requirements recorded in `PROMPT.md` (2.1 move input incl. drag and keyboard, 2.2 professional UI/UX, 4.2 `api` service approved, 10.1 quality gate with measured coverage baseline) and as tasks T8, T9, T6 in `CONTINUE.md`.

## 0.2.0 - 2026-11-03
- Podman packaging: `containers/web` (nginx-unprivileged, strict CSP, `/healthz`), `containers/builder` (Python + Debian Stockfish, optional Maia-2), `compose.yaml`, `Makefile`, Quadlet unit, `.containerignore`, `requirements*.txt`. Images not yet built (no registry access when written); `tests/test_containers.py` checks the static invariants.
- Web: chip colours via CSS classes instead of inline `style=`, so the app runs under `default-src 'self'` without `unsafe-inline`.
- Pipeline: `--pgn` accepts http(s) URLs (streamed); the run reports games read and fails on zero games, because a truncated `.zst` ends silently.
- Docs: `CONTINUE.md` (continuation prompt for a networked session); `PROMPT.md` records the podman requirement, why v1 is static, and the planned `api`/`valkey` services.

## 0.1.0 - 2026-11-03
- Pipeline: PGN/.zst sampler, Stockfish backend (MultiPV over all legal moves, fixed nodes), Maia-2 backend (untested), tags, phase detection, dataset builder.
- Web app: static, dependency-free; best-move and predict-the-player modes; reveal table with cost, plausibility, distance/closeness; phase and kind filters; local session stats.
- Shared scoring maths (Lichess win% and accuracy curves) with cross-language test vectors.
- Demo dataset: 90 positions from three public-domain games (no ratings, no Maia data).
- Engineering brief in PROMPT.md.
