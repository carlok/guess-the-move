# Continuation prompt — Guess the Move

Paste everything below the line into a new agent session that has the project directory (unpack the archive first) **and network access** (Hugging Face, GitHub, database.lichess.org, a container registry, podman). Everything above the line is for the human.

Added on 2026-11-03: the owner said yes to the `api` service and asked for unit tests + code coverage, a professional desktop/mobile UI, and click-or-drag move input. These are tasks T8, T9 and T6 below, with the specs in `PROMPT.md` 2.1, 2.2, 4.2 and 10.1. T8 and T9 need no network, so they can run in a session without registry access.

What the previous session could not do, and this one should: build and run the two container images, run on real Lichess data, run Maia, and settle the facts marked UNVERIFIED in `PROMPT.md` §7. Questions only you can answer are in §6 of the prompt; answer them in your first message to speed things up.

---

# Role and context

You are continuing a small free-software project, **Guess the Move**: a chess trainer where the user sees a real position from a real game, guesses a move, and the app reveals Stockfish's best move, the real move, and what Maia (a human-like model) would play at the real player's Elo, with a normalized distance of the guess from each. The owner, Carlo, is an ML engineer. He prefers free, actively maintained, lightweight software (e.g. Valkey over Redis), wants answers in **English**, and wants **everything runnable as rootless podman services**. He did not expect the v1 front end to be a static page and was not told why: it is static because every legal move of every position is pre-scored offline, so no engine runs at play time (`PROMPT.md` §4.1). That choice was made without asking him; do not repeat that mistake — **state the shape of anything you build (static / service / CLI) and why, in one sentence, before building it.**

The single source of truth is `PROMPT.md` (goal, architecture, data schema, scoring spec, evidence, roadmap, working agreements, state at hand-off). Read it fully, then `README.md`, `CHANGELOG.md`, and this file. Do not re-derive decisions recorded there; change them only with the owner's agreement and edit `PROMPT.md` + `CHANGELOG.md` in the same change.

# Ground rules

1. **Honesty over polish.** Report what you ran and what you did not. Anything you could not run is **UNTESTED** in your summary. Never claim a Maia, Lichess-data, container or browser result you did not obtain. If a fact in `PROMPT.md` §7 is UNVERIFIED, either verify it from a primary source (cite the URL and what it says) or leave it marked.
2. **Tests first** for maths and data invariants. Python and JS scoring must stay numerically identical (`tests/vectors.json`).
3. **Never fabricate data.** Missing Elo stays `null`; demo data stays labelled. Do not store player names or usernames.
4. **Keep the static path working**: `web` alone with the shipped dataset, no runtime remote calls. New services are additive and feature-detected.
5. **Podman first, fully-qualified image names, rootless, no Docker assumptions.** A container task is done only when the image was built, the container started, and it was probed (see T1).
6. Small, explainable changes. One precise function beats a configurable framework. No frameworks in the web app, no build step.
7. Work unattended if the owner is away: pick the most reasonable reading, say which one at the top of your report, and carry on — except for decisions that are expensive to reverse (licence, public release, data licensing), which you prepare and stop at.

# Tasks

**Order:** T0 → T8 (quality gate: the safety net) → T1 (containers) → T9 (interaction + UI) → T2 → T3 → T4 → T5 → T6 (`api`, approved) → T7. If there is no registry or network, do T0, T8, T9 and report the rest as blocked. Stop and report after each block if a result changes the plan. IDs are stable references, not the order.

## T0 — Orient and probe (≤ 30 min)
- Unpack, read the docs, run the baseline:
  `python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`, `.venv/bin/python -m pytest -q` (expect 61 passed + 1 skipped without an engine; 62 passed with `GTM_ENGINE`), `cd web && npm install && npm test` (expect 18 passing).
- Probe reachability and write the result in your report: `curl -sI` for `https://huggingface.co`, `https://github.com`, `https://database.lichess.org/`, `https://registry-1.docker.io/v2/`, `https://quay.io/v2/`, plus `podman info` (rootless? cgroup version?). Everything later depends on this; if a host is unreachable, say which tasks that blocks and do the rest.
- Pick the engine for dataset builds: Debian's `stockfish` package (`/usr/games/stockfish`, version follows the distro) or npm `stockfish` 19 under Node (GPL-3.0, WASM, ~2.5 s/position at 400k nodes). Record the choice; the dataset `meta.engine` must name it.

## T1 — Make the containers real (needs a registry; first thing to do once T8 is in place)
Files already written, **never built**: `containers/web/{Containerfile,nginx.conf}`, `containers/builder/Containerfile`, `compose.yaml`, `Makefile`, `deploy/quadlet/guess-the-move-web.container`, `.containerignore`/`.dockerignore`, `requirements*.txt`. Static checks exist (`tests/test_containers.py`); real runs do not.
Acceptance (report each as pass/fail with the command and output):
- `make web-image && make run` → `curl -fsS http://127.0.0.1:8080/healthz` prints `ok`; response headers include the CSP, `X-Content-Type-Options`, `Referrer-Policy`; `/data/positions.json` is served gzip-compressed with `Cache-Control: no-cache`.
- The container runs with `--read-only --tmpfs /tmp --cap-drop=all --security-opt no-new-privileges` (as in the Makefile). **Unverified assumption:** `nginx-unprivileged` keeps all its temp/pid files under `/tmp`; if it does not start, find the writable paths it needs and add tmpfs mounts for them (do not drop `--read-only` without telling the owner).
- Load the page in a headless browser against the *container* (Playwright/Chromium or Chrome): zero console errors, zero `securitypolicyviolation` events, play one position to the reveal table. A previous session did exactly this against a host nginx using the same `nginx.conf`; repeat it against the real container.
- `make builder-image` then `make dataset PGN=<small .pgn or URL> ARGS='--candidates 20 --keep 10 --maia none'` → valid `schema: 1` file (the existing `tests/test_dataset_file.py` invariants pass on it). Confirm `apt-get install stockfish` works inside `python:3.12-slim` and that `/usr/games/stockfish` is the real path (it is on Ubuntu 24.04, where `stockfish` 16 installs there).
- Rootless file ownership: files written to the bind-mounted `web/data` are owned by your user, not a subuid. If not, fix with `--userns=keep-id` (document it).
- `podman compose up --build` (or `podman-compose`) brings up `web` only; `--profile build run --rm builder --help` works. Note which compose provider you used and its version.
- Quadlet: install the unit as the header comment says, `systemctl --user start guess-the-move-web`, probe `/healthz`. If the host has no user systemd, say so.
- `WITH_MAIA=1 make builder-image` builds (CPU torch from `https://download.pytorch.org/whl/cpu`, then `maia2`). Report image size.
- Fix what breaks, keep `tests/test_containers.py` green, and update README's container section with the commands that actually worked.

## T2 — Real data (roadmap v1.1)
- Read the Lichess database page and record the licence/terms of the monthly dumps in `PROMPT.md` §7 with the URL (believed CC0; UNVERIFIED until you read it). Decide whether a derived `positions.json` may be redistributed; if unclear, ask the owner.
- Time a small run first (`--max-games 20000 --candidates 200 --keep 100`), then build the real set: Rapid/Classical, roughly 1200–2000 Elo unless the owner says otherwise, ~400 positions balanced across phases, `--seed` fixed. The sampler streams `http(s)` URLs and stops early with `--max-games`, so a multi-GB archive is never fully downloaded; it prints `games_read` and exits non-zero on 0 games (a truncated `.zst` otherwise ends silently).
- Implement **low-clock exclusion** (Lichess `[%clk h:mm:ss]` comments; drop positions where the mover had < N seconds, N configurable, default ~30 s on Rapid) with tests on hand-written PGN snippets. This is an open question for the owner; implement it behind a flag, default on for the real build, and say so.
- Sanity-check the result by eye: distribution of tags and phases, no ratings leaking beyond the band, SAN present for all legal moves, size per position (≈1.1 KB without Maia). Ship it as `web/data/positions.json` with `meta.demo=false`, keeping the demo set as `web/data/demo.json` if useful.

## T3 — Maia, for real
- Install `maia2` (Python 3.10–3.12) and run it on 50 real positions. Check against the recorded facts: `model.from_pretrained(type="rapid"|"blitz", device=...)`, `inference.prepare()`, `inference.inference_each(model, prepared, fen, elo_self, elo_oppo)` returning `(move_probs, win_prob)`. Verify (a) the keys are legal UCI strings in the position's frame (the pipeline already raises if not); (b) the valid Elo range, then fix the `elo_range=(1100, 2000)` clamp in `Maia2Backend` accordingly; (c) the argument order `elo_self`, `elo_oppo`; (d) where the weights are downloaded from — **UNVERIFIED**, possibly a host other than Hugging Face; name it and whether it is reachable; (e) the weights' licence.
- Sanity metric to report, not to optimise: how often Maia's top move equals the real move at the real Elo, per rating band. It should be clearly above chance and well above Stockfish-at-low-depth; if it is near chance suspect a perspective/colour or Elo-order bug before anything else.
- Add a small test with a recorded Maia output (a fixture, not the model) so the backend's parsing is covered in CI without torch.
- Rebuild the dataset with `--maia maia2`; confirm the UI shows the Plausible column and the Maia arrow.

## T4 — Settle the UNVERIFIED list
Walk `PROMPT.md` §7 item by item: licence of the Maia-3 ONNX conversions (one Hugging Face conversion lists AGPL-3.0; find the upstream licence), `maia3-js` size/speed/WebGPU, matilda-uci status, any Maia-1 ONNX alternative. Update §7 with dated, cited results. Decide the repo licence recommendation (GPL-3.0-or-later vs MIT; AGPL if Maia-3 weights are bundled) and put it to the owner; do not add a LICENSE file without his answer.

## T5 — Level estimator, offline first (roadmap v2)
Prototype in Python before any UI: posterior over an Elo grid (1000–2200, step 100), `P(e | moves) ∝ prior(e) · Π p_maia(move_i | position_i, e)`, with probabilities floored (e.g. 0.001) so one miss cannot zero a hypothesis. Evaluate on held-out *real* games: for players of known Elo, feed N of their real moves and report calibration (does the 80 % interval contain the true Elo ~80 % of the time?) and error versus N. Label output "Lichess-equivalent", never FIDE. This needs Maia probabilities **per Elo** for each position: decide between a `maia.by_elo` table in the data (≈13× size) and computing it in the approved `api` (`POST /v1/posterior`, T6); default to the `api`, keep the static path working without the estimator, and justify with numbers.

## T6 — `api` service (APPROVED by the owner on 2026-11-03; spec: `PROMPT.md` 4.2)
Build it after T3 (needs real Maia) and T5 (needs the posterior), in this order: skeleton with `/healthz` and `POST /v1/analyse` using fake backends and tests → real Stockfish → real Maia → `POST /v1/posterior` → container, compose service, Quadlet unit, nginx `/api/` location (un-comment) → front-end feature detection (`GET /api/healthz`; when present, enable "analyse any FEN/PGN" and the Elo estimate; when absent, behave exactly as today). Stateless; Valkey only as an optional analysis cache with an in-process LRU fallback, and a test that proves the API works without it. State the framework choice and why in one sentence before you start (Starlette+uvicorn preferred). Same acceptance bar as T1 (built, started, probed with a real `/v1/analyse`), plus: validation/abuse tests (bad FEN, oversized body, timeout, queue full), no request bodies in logs, same-origin only, container resource limits, coverage thresholds from T8 applied from the first commit. Do not add accounts or server-side user data.

## T7 — Spike: in-browser Maia-3 (roadmap v2.2) — report only
Measure `maia3-js` download size, cold start, per-move latency on CPU/WASM and WebGPU in a headless browser, and its licence. Recommend go/no-go with numbers; do not integrate without the owner.

## T8 — Quality gate: unit tests and code coverage (spec: `PROMPT.md` 10.1; no network needed)
Baseline measured on 2026-11-03: Python 84% (89% with an engine), `build_dataset.main()` and `backends.py` are the gaps; JS `scoring.js` 98.9% lines; `app.js` is invisible to the current harness.
1. Switch the jsdom harness to `new vm.Script(code, {filename: realPath}).runInContext(dom.getInternalVMContext())` (proven to make `app.js` measurable: 98.75% lines, 89.1% branches with the existing tests) in every test file that evals the scripts. Add `npm run coverage` using `node --test --experimental-test-coverage --test-coverage-include=scoring.js --test-coverage-include=app.js --test-coverage-lines=95 --test-coverage-branches=90 "test/*.test.js"` (flags verified on Node 22.23; the run exits non-zero below a threshold).
2. Add `pytest-cov` to `requirements-dev.txt`; configure `[tool.coverage]`/`.coveragerc` (branch coverage, `source=pipeline`, omit nothing silently) and `--cov-fail-under` at the 10.1 thresholds.
3. Close the gaps with meaningful tests, not line-touching: `build_dataset.main()` end to end with a tiny UCI stub script as engine and a fake Maia (no Stockfish needed); `backends.py` parsing with recorded fixtures; `StockfishBackend` fallbacks (MultiPV refusal → per-move search) with a stub. `# pragma: no cover` only for code that needs torch, with a one-line reason.
4. Add `hypothesis` (dev-only) property tests for the maths (monotonicity, bounds, symmetry) and make `tests/vectors.json` generation deterministic and committed, still shared by both languages.
5. Add `make coverage` (both languages, fails under threshold) and `make e2e` (placeholder until T9), and a CI workflow file once the owner says where the repo lives (§6, question 5); until then a documented local command is enough.
6. Spot-check test quality with a mutation run on `winpct`/`tags` (`mutmut`) and `scoring.js` (Stryker) if installable; report surviving mutants and add tests for the meaningful ones. Not a gate.
Acceptance: `make coverage` green at the stated thresholds; the report lists before/after numbers per file and every `pragma: no cover` with its reason. Thresholds are written into the Makefile/config so they ratchet, never silently drop.

## T9 — Move input and professional UI, desktop and mobile (specs: `PROMPT.md` 2.1 and 2.2; no registry needed)
Current state, verified by reading the code: click/tap source then destination **works** (select, switch piece, promotion chooser, tested in jsdom); **drag does not exist** (no pointer events); keyboard only has `n` and `Escape`; pieces are Unicode glyphs; the board is rebuilt with `innerHTML` on every state change.
1. **State the shape and the plan first** (one paragraph): how you will keep the ghost piece alive across re-renders (overlay layer outside the re-rendered subtree, or keyed updates), and your decision on accidental-commit safety (confirm-before-reveal / undo window).
2. **Write the e2e tests first** (Playwright; `npx playwright install chromium`, or the system Chrome via `executablePath` when the download is blocked): click-click, mouse drag, touch drag (emulated touch, `hasTouch`), cancel by Escape and by dropping off-board, drop on origin = select, promotion by drag, keyboard play, and "page still scrolls when touching outside the board". They must fail before the feature exists.
3. Implement drag (Pointer Events, `touch-action: none` on the board only), keyboard play with `aria-live` announcements, and the confirm/undo behaviour. Keep the jsdom unit tests for logic; do not mock layout in jsdom.
4. Redesign to the 2.2 spec: tokens, light/dark + toggle, three responsive layouts, edge-to-edge board on phones, sticky action bar, collapsible filters, designed reveal (arrows with labels, cost bars, verdict line, legend), onboarding, empty/error/loading states, SVG piece set (verify licence upstream, add `NOTICE`), inline SVG icons, centralised UI strings. No inline `style=`/`<script>`: the strict CSP stays (`tests/test_containers.py`).
5. Verify: e2e green at 1280x800, 768x1024, 390x844 (touch, DPR 2); `axe-core` zero serious/critical; Lighthouse mobile >= 90 (Performance, Accessibility, Best Practices); size and CLS/LCP budgets from 2.2; attach before/after screenshots for the three viewports and one drag recording or frame sequence. Look at the screenshots yourself and say what you would still fix.
6. Run T8's coverage gate; the new UI code must meet the thresholds.
Acceptance: all of 5 reported with evidence; anything you could not run on a real phone or other browsers (Safari/iOS, Firefox, Android Chrome) is listed as **UNTESTED**.

# Gotchas learned in the previous session
- `apt-get install` needs `apt-get update` first; an earlier "package not found" was only stale lists.
- python-zstandard returns a clean EOF on a truncated `.zst` (zero or fewer games, no error). The CLI now exits non-zero on zero games and logs `games_read`.
- On Node 22 `node --test test` fails; use the glob form already in `web/package.json`.
- The board is fully re-rendered on every click, so DOM references go stale in tests; re-query squares after each click.
- Lichess formulas: Win% = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1); Accuracy% = 103.1668·e^(−0.04354·drop) − 3.1669. Project-own choices: cp clamped to ±1000; mate → ±(10000 − distance).
- MultiPV = number of legal moves at 400k nodes: ranks beyond ~10 are noisy; do not present them as precise.
- CSP is `default-src 'self'` and friends with no `unsafe-inline`: any new inline `style=` or `<script>` in `web/` breaks the page in the container (and fails `tests/test_containers.py`).
- jsdom's `window.eval` hides code from V8 coverage; use `vm.Script` with the real filename (T8). jsdom has no layout, so pointer geometry, scrolling and touch behaviour must be tested in a real browser (T9).
- The board is rebuilt with `innerHTML` per state change: a drag implementation must not re-render on `pointermove`.
- In nginx, `add_header` inside a `location` replaces the server-level security headers; use `expires` there.

# 6. Questions for the owner (ask once, in your first message; proceed on the defaults)
1. Repo licence? (default: none added; recommend GPL-3.0-or-later)
2. Rating band and time controls for the first real set? (default: ~1200–2000, Rapid + Classical)
3. Exclude low-clock positions? (default: yes, < 30 s)
4. May the derived `positions.json` be published publicly, once the Lichess terms are confirmed? (default: keep private)
5. Where does the repo live (GitHub, Forgejo, GitLab, other)? CI is written for that runner. (default: a documented local `make coverage`/`make e2e` only)
6. Is there a site whose look and feel is the bar? (default: calm, Lichess-like density with its own identity)
7. Confirm-before-reveal on touch devices: on by default? (default: on for coarse pointers, off for mouse)

Already answered by the owner: the `api` service is **approved** (2026-11-03); unit tests with enforced code coverage are required; drag and click-click move input and a professional desktop/mobile look are required.

# Report format (final message)
Start with what changed for the owner in two or three sentences. Then a table: task → result → evidence (command/URL). Then **UNTESTED / blocked** items, each with the reason. Then the answers you assumed for §6. Attach or point to the changed files; do not paste whole files. Update `PROMPT.md` §14 (state at hand-off) and `CHANGELOG.md` as part of the work.
