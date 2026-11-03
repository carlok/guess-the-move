# Changelog

## Unreleased
- Docs only: owner requirements recorded in `PROMPT.md` (2.1 move input incl. drag and keyboard, 2.2 professional UI/UX, 4.2 `api` service approved, 10.1 quality gate with measured coverage baseline) and as tasks T8, T9, T6 in `CONTINUE.md`. No code changed.

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
