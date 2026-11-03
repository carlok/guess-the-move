# Changelog

## Unreleased
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
