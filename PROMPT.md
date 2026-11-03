# Guess-the-Move — engineering brief

> Paste this whole file at the start of any agent session on this repo. It is the single source of truth for goals, decisions, constraints and roadmap. If code and this file disagree, stop and reconcile (fix the code, or propose an edit to this file). Never let them drift.

## 1. Goal

A small, free-software chess trainer for **learning to see a position through another player's eyes**, not for winning games.

The user is shown a real position (FEN) from a real game and guesses a move. The app then reveals three reference moves and measures how far the guess is from each, on a normalized scale:

| Reference | What it teaches |
|---|---|
| **Stockfish best move** | what is objectively best |
| **The real move** (played by a real player of known Elo) | what a human actually did |
| **The Maia move at that player's Elo** | what a *typical* player of that strength would do |

The interesting learning is in the disagreements between the three:

- real ≠ Maia → this player did something unusual (blunder or inspiration)
- Maia ≠ Stockfish → a typical human error at that level
- real = Stockfish but ≠ Maia → a good move that is hard to find
- all three agree → trivial position (dropped by default)

## 2. Product definition (v1)

- Static web app, no server, no build step, no runtime dependencies.
- Pick positions by **phase** (opening / middlegame / endgame) and by **tag** (see §5).
- Two modes on the same data:
  - **Best move**: scored on *cost* (how much expected score the guess loses vs Stockfish's best).
  - **Predict the player**: scored on matching/approaching the real move, plus *plausibility* (Maia probability of the guess at the real player's Elo).
- After each guess show a reveal table: your move / Stockfish / real / Maia, each with SAN, cost, plausibility, and **distance from your guess** (normalized 0–100 similarity).
- Session statistics kept locally (localStorage, always inside try/catch, app must work without it).

### 2.1 Move input (owner requirement, 2026-11-03)

Every way of playing a move must work with **mouse, touch, pen and keyboard**:

1. **Click/tap source, then destination** (exists; select another own piece to switch; tapping the selected piece deselects). Covered by jsdom tests; **UNTESTED on real touch devices**.
2. **Drag and drop** (does **not exist yet**; the app has no pointer-event code). Use Pointer Events, not mouse+touch pairs:
   - `pointerdown` on an own piece selects it and arms a drag; the drag starts after a small movement threshold (~4 px) so a plain tap still means "select". A ghost piece follows the pointer (`setPointerCapture`), the origin square is dimmed, legal destinations are shown, the square under the pointer is highlighted.
   - `pointerup` on a legal square commits (promotion chooser if needed). `pointerup` elsewhere, `Escape` or `pointercancel` puts the piece back: no commit, no stale selection, no stuck ghost.
   - On the board `touch-action: none` (so a drag does not scroll the page); outside the board the page must still scroll normally on touch. Verify on a real phone-sized emulation with touch events.
   - Tap-tap and drag are interchangeable within one position. Dropping on the origin square counts as a select.
   - **Architecture constraint:** `render()` rebuilds the board with `innerHTML` on every state change. Never re-render during `pointermove`. Keep the ghost on a layer outside the re-rendered subtree, or move to keyed DOM updates; 60 fps on a mid-range phone is the budget.
3. **Keyboard:** the board is one tab stop with a roving cursor (arrows move, Enter/Space select then commit, Escape cancels), plus `n` for next. Announce changes in an `aria-live` region ("e2 selected, 3 legal moves"; "moved e2 to e4").
4. **Accidental-commit safety (decide, justify, test):** a commit is irreversible because it reveals the answer. Offer "confirm move" (default on for coarse pointers) or a short undo window. Record the choice in the README.
   **Decision (T9, 2026-11-03, not yet confirmed by the owner, CONTINUE §6 q7):** confirm-before-reveal, on by default when `(pointer: coarse)` matches, off for mouse, a labelled toggle in the panel, the choice kept in `localStorage`. A legal move becomes *pending* (drawn as an arrow, marked on the board); another drag or tap changes it, Escape cancels it, the "Confirm move" button reveals. An undo window was rejected: the reveal itself is the commit, so there is nothing to undo after it. Tested in e2e (`input.spec.js`, `touch.spec.js`) and jsdom.

### 2.2 UI/UX and visual design (owner requirement, 2026-11-03: "professional look, desktop and mobile")

The v1 UI is functional and plain: Unicode piece glyphs (font-dependent), default-looking controls, no visual hierarchy for the reveal. Target a polished, calm, consistent product that holds up next to Lichess-level tools. Requirements, not suggestions:

- **Board is the hero; one primary action is always visible** (Next / Confirm). The reveal is the "aha" moment: design it, do not just print a table.
- **Layouts:** desktop >= 1100 px (board left sized to the viewport height, panel right); tablet (768); phone <= 480 (board edge-to-edge with no side padding, controls in thumb reach, sticky bottom action bar, filters in a collapsible sheet, result as a card or bottom sheet). **No layout shift** when the result appears.
- **Design tokens** in CSS custom properties (colour, spacing, radius, type scale, elevation). Light and dark follow the system and can be overridden by a toggle persisted in `localStorage` (try/catch). WCAG 2.2 AA contrast for text (4.5:1) and UI components (3:1).
- **Pieces:** replace Unicode glyphs with an open-licensed SVG piece set, self-hosted (the CSP forbids external assets). **Verify each candidate set's licence from its upstream repository** (UNVERIFIED here; do not trust memory) and record name, licence, source and attribution in `NOTICE`; it must be compatible with the repo licence. Optionally 2-3 board colour themes.
- **Icons:** inline SVG from a free-licensed set (verify licence), no icon fonts. **Typography:** system font stack or a self-hosted OFL font; no external font requests.
- **Reveal design:** arrows with a legend that matches the table, drawn in with a short animation that respects `prefers-reduced-motion`; arrows must not rely on colour alone (labels or distinct line styles; colour-blind-safe palette, check with a simulator); cost shown as normalized bars next to numbers; one plain-language verdict ("You found Stockfish's choice", "You played what a ~1500 player typically plays"); tags as chips; units explained once in a tooltip or help sheet (win-% points, closeness).
- **Microcopy and states:** short, no unexplained jargon; first-run onboarding (<= 3 steps, dismissible, remembered); loading skeleton; empty, error and offline states; UI strings centralised in one object (Italian/English later, roadmap v4).
- **Accessibility:** focus always visible; touch targets >= 44x44 CSS px (360 px viewport / 8 = 45 px per square, so keep the board edge-to-edge on phones); square `aria-label`s ("e4, white pawn"); results announced via `aria-live`; works at 200% text zoom; no information by colour alone.
- **Budgets:** JS+CSS <= 60 KB gzipped excluding dataset and piece set (v1 today: app.js 6.0 KB, scoring.js 1.3 KB, style.css 1.8 KB, index.html 1.0 KB gzipped); CLS < 0.1; LCP < 2.5 s on a throttled mobile profile with the shipped dataset; drag at 60 fps.
- **Verification (all three, in a real browser, attach screenshots to the report):** Playwright e2e at 1280x800, 768x1024 and 390x844 with touch and deviceScaleFactor 2, covering click-click, mouse drag, touch drag, cancel, promotion, keyboard, theme toggle; `axe-core` with zero serious/critical violations; Lighthouse mobile >= 90 for Performance, Accessibility and Best Practices. jsdom cannot test any of this (no layout, no real pointer geometry).

## 3. Non-goals (for now)

Playing full games, accounts/servers, a move-by-move opponent, rating the user officially, mobile apps, monetization. The earlier "swap colors every move pair against an engine" idea is parked as an *experimental mode* (roadmap v3) because it splits each side's plan between two minds.

## 4. Architecture

```
games.pgn[.zst] ──► pipeline/sampler.py ──► candidates (FEN, real move, Elo)
                                              │
              Stockfish (UCI, MultiPV = ALL legal moves, fixed nodes)
              Maia policy at the real player's Elo
                                              ▼
                       pipeline/build_dataset.py ──► web/data/positions.json
                                                          │
                                       web/ (index.html, app.js, scoring.js)
```

**Key design decision:** the pipeline evaluates **every legal move** of every position offline (MultiPV = number of legal moves, fixed node budget). Whatever the user guesses is therefore already scored, and the browser needs **no engine**. This is what makes static hosting possible. Do not reintroduce a runtime engine in v1.

### 4.1 Delivery: podman services (owner requirement)

The owner wants **everything runnable as podman services** (rootless; free software; no Docker daemon assumed). The browser app is static *as an implementation detail of v1*, not as a product decision: it is served by an `nginx-unprivileged` container, the dataset is built by a one-shot `builder` container, and both are wired by `compose.yaml`, a `Makefile` (plain `podman`, no compose provider needed) and a Quadlet unit for systemd. Rules: fully-qualified image names (`docker.io/...`), non-root where the image allows it, `:Z` on bind mounts, loopback-only published ports by default, read-only root filesystem with a tmpfs `/tmp`, strict CSP (no inline script/style, enforced by `tests/test_containers.py`).

Why v1 is static (so the next agent does not have to guess): every legal move of every position is scored offline, so playing needs no engine, no database and no session, and the whole product is a few files behind any web server. That is a cost and simplicity choice that was made **without asking the owner**, who expected a service. The static front end stays, but the stack grows services as soon as a feature needs state or computation that cannot be precomputed:

| Service | Image | Status | Purpose |
|---|---|---|---|
| `web` | `containers/web` (nginx-unprivileged) | v1, written, image build UNTESTED | serves the app, CSP headers, `/healthz`, reverse proxy `/api/` (commented until `api` exists) |
| `builder` | `containers/builder` (python + Debian stockfish, optional Maia-2) | v1, written, image build UNTESTED | one-shot job: PGN (file or URL) -> `positions.json` |
| `api` | `containers/api` (to write; small Python ASGI app, see 4.2) | v2, **approved by the owner** | arbitrary FEN/PGN analysis (Stockfish + Maia at any Elo), per-user Elo posterior, adaptive position selection |
| `valkey` | `docker.io/valkey/valkey` | v2, optional | session/posterior cache, rate limits. Prefer Valkey to Redis (licence). Skip it if a file or SQLite is enough. |

Keep the static path working: `web` must still run on its own with the shipped dataset, and the front end must keep working with `/api/` absent (feature-detect, fall back to the static dataset).

### 4.2 The `api` service (approved by the owner, 2026-11-03)

Why it exists: anything the static dataset cannot answer. Arbitrary FEN/PGN (the user's own games), Maia at any Elo, the Elo posterior, adaptive position choice. Shape: **a small, stateless HTTP JSON service in its own container**, behind the `web` nginx at `/api/`, with the static path still working when it is absent (the UI feature-detects `GET /api/healthz`).

- **Stack:** Python 3.12; prefer Starlette + uvicorn (BSD, small) over a heavier framework; FastAPI is acceptable if its validation models earn their weight. Decide and justify in one line. Engine: native Stockfish through `python-chess` async UCI, a bounded pool (Threads=1 per process), Maia-2 loaded once at start-up. Same Debian-Stockfish approach as the `builder` image; share a base layer if it helps.
- **Endpoints (v1 of the API, versioned under `/v1`):** `GET /healthz`; `POST /v1/analyse` `{fen, elo?, nodes?}` -> all-legal-move evals + SAN (+ Maia probabilities at `elo`, optionally an Elo grid), i.e. exactly the position object of the dataset schema so the front end has one code path; `POST /v1/posterior` `{history:[{fen, move}], prior?}` -> posterior over the Elo grid with a credible interval (roadmap v2); `GET /v1/next?phase=&tag=&elo=` (adaptive selection, v2.1, later).
- **Stateless by default:** the client sends its own history; no accounts, no server-side user data. Valkey (`docker.io/valkey/valkey`, verify the tag) is **optional and used only as a cache** of analyses keyed by `sha1(fen|nodes|engine|model)` with a TTL, plus rate-limit counters. The API must run without it (in-process LRU fallback) and a test must prove that.
- **Safety:** validate FEN with python-chess (`Board.is_valid()`, length cap, reject illegal/unreachable positions), cap request size, node budget and concurrency, per-request timeout returning 503/504 with a clear message, per-IP rate limit, same-origin only (no permissive CORS), never log request bodies (FENs may come from a user's own games), container limits (`--cpus`, `--memory`, read-only rootfs, non-root, cap-drop all).
- **Tests:** unit tests with fake engine and fake Maia (like `tests/test_build.py`), endpoint tests through the ASGI test client, validation/abuse tests (bad FEN, huge body, timeout, queue full), cache on/off. Real-engine and real-Maia checks stay separate and are reported as such. Coverage thresholds as in 10.1 apply from the first commit.
- **Deployment:** `containers/api/Containerfile`, a service in `compose.yaml` (un-comment the stub), a Quadlet unit, `make api-image`. Done = built, started, probed (`/healthz`, one real `/v1/analyse`), as for the other images.

`web/scoring.js` and `pipeline/winpct.py` implement the same maths. `tests/vectors.json` is checked by both test suites; they must stay numerically identical.

## 5. Data schema (`schema: 1`)

```jsonc
{
  "schema": 1,
  "meta": { "engine": "Stockfish 19 WASM", "nodes": 400000, "maia": "maia2-rapid|null",
            "built": "ISO-8601 UTC", "source": "file name", "demo": false,
            "thresholds": { /* TagConfig */ }, "counts": { /* per phase */ } },
  "positions": [{
    "id": "10-hex sha1 of fen+real",
    "fen": "...", "ply": 24, "move_no": 13, "stm": "w|b",
    "phase": "opening|middlegame|endgame",
    "player_elo": 1634, "opp_elo": 1601,        // null when unknown
    "real": "e2e4",                              // UCI
    "evals": { "e2e4": 31, "d2d4": 28 },         // ALL legal moves, centipawns, side-to-move POV, mate = ±(10000-dist)
    "san":   { "e2e4": "e4", "d2d4": "d4" },     // ALL legal moves
    "maia":  { "elo": 1634, "probs": { "e2e4": 0.31 } },  // p >= 0.001 only; null if unavailable
    "tags":  ["real_mistake", "only_move"],
    "site":  "https://lichess.org/xxxxxxxx"      // attribution; never store player names
  }]
}
```

Tags (thresholds in `TagConfig`, win%-points): `real_mistake` (drop ≥ 10), `real_blunder` (≥ 20), `real_is_best`, `only_move` (2nd-best drops ≥ 15), `maia_miss` (Maia gives the real move < 5%), `maia_error` (Maia's top move drops ≥ 10), `hard_find` (real = best but Maia gives it < 15%), `trivial` (real = best = Maia top).

## 6. Scoring spec

Published Lichess formulas (https://lichess.org/page/accuracy):

```
Win%(cp)        = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
Accuracy%(drop) = 103.1668 * exp(-0.04354 * drop) - 3.1669      // drop = winBefore - winAfter, clamped to [0,100]
```

This project's own choices: cp clamped to ±1000 before Win%; mate mapped to ±10000 first.

- `cost(move)` = Win%(best) − Win%(move), from the side to move's point of view, ≥ 0. This is "expected score lost", directly interpretable.
- `quality(move)` = Accuracy%(cost). Used as the headline score in *Best move* mode.
- `distance(a, b)` = |Win%(a) − Win%(b)|; `similarity(a, b)` = Accuracy%(distance). Used for "your distance from X".
- `plausibility(move)` = Maia probability at the real player's Elo (0 if absent).
- Do **not** average per-move accuracies into a "game accuracy" (Lichess's own game accuracy is a harmonic-style aggregate and is contested). Show per-move values and a plain running mean.

## 7. Evidence and open facts

Verified in sources (links in the final summary of the session that wrote this file):
- Lichess formulas above; their stated calibration is reportedly games of ~2300-rated players (second-hand: treat as approximate).
- Maia-1: nine models, one per Elo 1100–1900, trained on Lichess games. Depth-limited Stockfish does *not* look human at low levels (noise on top of strong play), which is why Maia is used for the human reference.
- Maia-2: single Elo-conditioned model; `pip install maia2` (Python 3.10–3.12); its README now recommends Maia-3 for new projects.
- Maia-3 (Chessformer): `maia3-js` on npm runs it in Node and browser via ONNX Runtime Web; ONNX sizes ≈ 7 MB (3M params) to ≈ 156 MB (79M params, fp16).
- `stockfish` on npm 19.0.1, GPL-3.0: full single-thread WASM ≈ 94 MB, lite single-thread ≈ 1.7 MB; runs under Node as a UCI process.

Measured in this sandbox (full single WASM under Node, 30 legal moves, MultiPV = 30): ≈ 170k nodes/s; 300k nodes → depth 10 in 1.8 s; 1.5M nodes → depth 13 in 9 s. Default is 400k nodes. Ranks beyond ~10 are noisy at this budget; that is acceptable because those moves are blunders by any definition, and the cost near the top is what matters.

**Settled on 2026-11-03** (read from primary sources by a subagent, then confirmed by running the code where possible; every URL and the claim table are in `docs/research/t4-unverified.md`):
1. **Maia-2 Elo handling.** `maia2` buckets any rating itself: `<1100`, nine 100-point buckets 1100-1999, `>=2000`. Nothing errors outside the range, so the `(1100, 2000)` clamp in `Maia2Backend` was wrong for sub-1100 players and is now off by default (`elo_range=None`). Resolution is 100 points; do not present Maia's Elo dependence as finer than that.
2. **`inference_each` contract.** `(model, prepared, fen, elo_self, elo_oppo)` with `elo_self` the side to move; returns `(move_probs, win_prob)`. `move_probs` keys are UCI strings in the real board's frame (Black's moves are mirrored back), probabilities over legal moves summing to 1, rounded to 4 decimals. `win_prob` is White's expected score. **Run for real (T3):** 400 real Lichess positions, 0 illegal keys, probability mass >= 0.999, median 5.5 ms per call on this Mac's CPU.
3. **Maia-2 weights.** Downloaded from Google Drive by `gdown` (`rapid_model.pt`, 279,704,570 bytes, about 100 s here), SHA-256 pinned in the package; package licence MIT, **weights licence not stated**. Drive quotas make this host fragile; the builder takes `--maia-home` (or `MAIA2_HOME`) so the file can be kept on a volume. Python 3.10-3.12 only (`requires_python <3.13`), torch 2.8.
4. **Maia-2 vs the real move (T3 sanity metric, not tuned):** top-1 match 48.2% over 400 positions (chance 5.3%, Stockfish at 2,000 nodes 29.2%); by rating band 42.6% (1200-1399), 50.4% (1400-1599), 46.1% (1600-1799), 56.5% (1800-2000); White 50.0%, Black 46.5%, so no colour or perspective bug. The swapped-Elo control showed no difference (49.0%), so that control cannot detect an argument-order bug; the order was settled by reading the source. Raw numbers: `docs/research/maia-probe-2026-11-03.json`, tool `tools/maia_probe.py`.
5. **Maia-3 licences.** The official repo is AGPL-3.0; the 79M Hugging Face card says AGPLv3, the 5M and 23M cards say "see repo"; the third-party ONNX conversions that declare a licence say AGPL-3.0; `maia3-js` on npm is labelled MIT but is third-party and ships AGPL-derived weights. Treat Maia-3 weights as AGPL-3.0. Maia-1 (repo GPL-3.0, nine `.pb.gz` lc0 weights, no separate weights licence stated) and its roughly 3.5 MB per level ONNX conversions are the cleanest licence fit for a browser-only trainer; convert the official files with lc0's `leela2onnx` rather than trusting a third-party conversion. `matilda-uci` (GPL-3.0, Maia-3 plus Stockfish, last commit 2026-07-22) is not usable in a browser.
6. **WebGPU / WASM for `maia3-js`:** its README claims neither; **still UNVERIFIED**, measured in the T7 spike. Its own latency claim ("about 5 x 10 ms on CPU") is the author's, not measured here.
7. **Lichess database.** CC0, the page allows modification and redistribution without asking. `[%clk]` comments exist in the dumps since April 2017 (to the second); only about 6% of games carry `[%eval]`. A recent standard month is about 31 GB (`lichess_db_standard_rated_2026-10.pgn.zst` is 30,982,323,881 bytes), so the sampler streams. The same page offers `lichess_db_eval.jsonl.zst` (417 million positions with Stockfish evaluations, UCI lines in Chess960 castling notation). **Not read:** lichess.org's terms of service and privacy text.
8. **Piece sets and icons (T9).** Shipped: cburnett (GPLv2+, tri-licensed on Commons) and Lucide (ISC; `moon` and `sun` are Feather-derived, so the Feather MIT notice is in `NOTICE` too). Rejected as non-commercial or share-alike (lila `COPYING.md`): staunty, fresca, cardinal, icpieces, gioco, tatiana, dubrovny, maestro, california, caliente, anarcandy, disguised, cooke, monarchy, minimal-warmth, horsey, xkcd (CC BY-NC-SA), alpha (non-commercial); no licence stated: governor, kosal, reillycraig, riohacha.

Still measured or decided elsewhere: Maia-3 in the browser (T7), the level estimator (T5).

Historical: the sandbox that built v1 could not reach Hugging Face or the Lichess database, so the Maia path and real-game data were first exercised in the 2026-11-03 session (14.1). The demo dataset is built from three public-domain historical games without Elo, hence without Maia data.

## 8. Principles and constraints

- **Free software, actively maintained, lightweight.** Prefer small dependencies; no frameworks in the web app v1; no build step. Pin versions in lockfiles/requirements.
- **Never fabricate data.** Missing Elo stays `null`. Demo data is labelled `meta.demo = true` and the UI says so.
- **Reproducible datasets.** Seeded sampling; record engine name, node budget, Maia model and thresholds in `meta`.
- **Math before UI.** Any change to formulas updates `tests/vectors.json` and both implementations in the same commit.
- **The static path must keep working.** `web` alone, with the shipped dataset: no cookies, no server state, no remote calls at runtime. New services are additive and feature-detected.
- **Quality gate.** Tests and coverage are part of every change (10.1); coverage thresholds only ratchet up.
- **Podman first.** Everything that runs must run as a rootless podman container (see 4.1). Do not require Docker, root, or a compose provider (the Makefile is the lowest common denominator).
- **Privacy.** Do not store player names or usernames. Local stats only.
- No `localStorage` dependence for correctness; wrap every access in try/catch.

## 9. Working agreements for agents

1. Read this file, then `README.md`, then run the tests before changing anything.
2. Tests first for maths and data invariants; add a failing test, then fix.
3. State what you verified and what you did not. Mark anything untested as **UNTESTED** in the PR/summary; never claim a Maia, Lichess-data or browser result you did not run.
4. When a decision here changes, edit this file in the same change and add a line to `CHANGELOG.md`.
5. Keep outputs small and explainable; prefer one precise function over a configurable framework.
6. If a requirement is ambiguous in a way that changes what you build, ask once, then proceed on the most reasonable reading and say which one you took.
7. **Say the shape before building it.** Static page vs service vs CLI, and where it runs, is a decision the owner cares about. State your choice and the reason in one sentence at the start; do not discover it in the hand-off.
8. Container work is only "done" when the image was built and the container was started and probed (`curl -fsS localhost:8080/healthz`, load the page in a headless browser). Static checks (`tests/test_containers.py`) are necessary, not sufficient.

## 10. Definition of done — v1

- `python -m pytest` green (maths, tags, sampler incl. `.zst`, dataset invariants with fake backends; real-engine integration test when `GTM_ENGINE` is set).
- `cd web && npm test` green (scoring parity with `tests/vectors.json`; DOM flows in jsdom; every shipped position playable by clicking its best move).
- `python -m pipeline.build_dataset ...` produces a valid `schema: 1` file; every position has `evals`/`san` for all legal moves.
- App works from any static server; filters, both modes, reveal table, session stats; degrades gracefully when `maia` is null.
- README documents the real-data run (Lichess PGN → dataset) and how to enable Maia.
- `podman build` of both images succeeds; `make run` serves the app; `make dataset PGN=...` writes a valid `positions.json`; the page loads with zero console errors and zero CSP violations (see `CONTINUE.md`, T1).

### 10.1 Quality gate (owner requirement, 2026-11-03: unit tests and code coverage)

- **Unit tests** for every pure function and every branch of data logic; new modules arrive with their tests. Tests assert behaviour (a wrong result must fail), not just execution.
- **Coverage is measured and enforced**, locally (`make coverage`) and in CI: Python with `pytest-cov --cov-branch --cov-fail-under=N`; JS with Node's built-in `node --test --experimental-test-coverage` (Node 22, no extra dependency; thresholds via `--test-coverage-lines/-branches/-functions`, verified to work on Node 22.23: exit code 1 below the threshold).
- **Baseline measured on 2026-11-03** (before any of this work): Python 84% total without an engine (89% with `GTM_ENGINE`): `winpct`, `tags`, `sampler` 100%; `build_dataset.py` 79% (the CLI `main()` body, lines 182-218, is untested); `backends.py` 30% (72% with an engine; `Maia2Backend` needs torch). JS: `scoring.js` 98.9% lines / 95.1% branches. `app.js` is **not measured by the current harness**, because `window.eval` inside jsdom hides it from V8 coverage. **Tried and works:** run the scripts with `new vm.Script(code, {filename: <real path>}).runInContext(dom.getInternalVMContext())` instead of `w.eval`; that gave `app.js` 98.75% lines / 89.1% branches / 95.4% functions with the existing tests. **Applied in T8** (`web/test/harness.js`, shared by every jsdom test; it runs the `<script src>` files of `index.html` in page order).
- **After T8 (measured 2026-11-03, Node 22.22, Python 3.11, no engine):** Python 100% lines and 100% branches in every file of `pipeline/` (was 84% combined; `backends.py` 30%, `build_dataset.py` 79%); JS `scoring.js` 100% / 100%, `app.js` 98.75% lines / 92.27% branches / 95.38% functions. No `# pragma: no cover` is used anywhere: `Maia2Backend` is covered through a fake `maia2` module, the engine path through a UCI stub script (`tests/fixtures/uci_stub.py`). `make coverage` enforces the thresholds below; `tools/check_coverage.py` and `web/package.json` hold the numbers.
- **Mutation spot-check after T8 (not a gate):** `mutmut` on `winpct` + `tags`: first run 163 mutants with 21 survivors (boundary comparisons, missing-probability defaults, phase limits); after the added tests and one simplification 161 mutants, 160 killed, 1 survivor, an equivalent mutant (`min(100.0, acc)` in `accuracy_from_drop`: the accuracy of a zero drop is 99.9999, so the upper clamp is unreachable). Stryker on `scoring.js`: 83% before the added tests, 96.2% after; the 4 survivors are the UMD loader branches. The runs found two real defects, both fixed: `select()` could keep the same position+move id twice, and `tag_position` raised `KeyError` when Maia's top move was not among the evaluated moves. `make mutation` re-runs both.
- **Thresholds (ratchet, never lower):** Python >= 90% lines and >= 85% branches overall, 100% lines on `winpct`, `tags`, `sampler`; JS >= 95% lines and >= 90% branches on `scoring.js` and `app.js`; new code (diff) >= 90% where tooling allows. `Maia2Backend` may be excluded only through an explicit `# pragma: no cover` with a reason, and its parsing must be covered by a fixture-based test (a recorded output, no torch).
- **Close the known gaps:** test `build_dataset.main()` end to end with a tiny UCI stub script as engine (no Stockfish needed) and with a fake Maia; error paths already tested for unreadable sources and zero games.
- **Property-based tests** (`hypothesis`, dev-only) for the maths: `win_pct` monotonic in cp and in [0,100]; `cost >= 0`; `distance` symmetric; `similarity` and `accuracy` in [0,100] and decreasing in the drop; Python/JS parity on random inputs via a deterministically generated `tests/vectors.json`.
- **Mutation testing** (stretch, not a gate): `mutmut` on `winpct`/`tags`, Stryker on `scoring.js`; list surviving mutants in the report. Coverage is a floor, not a goal.
- **Browser e2e** (Playwright) covers what jsdom cannot (2.1, 2.2). Its coverage is reported but not gated.
- **CI:** one workflow that runs pytest+coverage, npm test+coverage, e2e, `test_containers.py` and builds the images. Ask the owner where the repo lives before choosing GitHub Actions or another runner.
- `make test`, `make coverage`, `make e2e` are the only commands a contributor needs.

## 11. Roadmap

- **Status 2026-11-03:** v1.1 to v1.4 and the first cut of v2 are built; details and evidence in 14.1.
- **v1.1 Real data.** Run on a Lichess monthly archive on a machine with network and Python ≤ 3.12 for `maia2`; verify the unverified items above; ship a first real `positions.json`.
- **v1.2 Services verified.** Build and run the two images on a machine with a registry; fix what breaks (CONTINUE.md T1).
- **v1.3 Quality gate.** 10.1 (CONTINUE.md T8). Do this before the UI rewrite: it is the safety net.
- **v1.4 Interaction + UI.** 2.1 and 2.2: drag, keyboard, redesign, piece set (CONTINUE.md T9).
- **v2 `api` service + level estimator.** 4.2 (approved); the estimator runs behind `/v1/posterior`. Bayesian posterior over an Elo grid (e.g. 1000–2200 step 100): for each user guess, multiply by Maia's probability of that move at each Elo; start from a declared-rating prior; show a credible interval and label it "Lichess-equivalent", not FIDE. Needs `maia.by_elo` in the data or in-browser Maia. Moves that every Elo agrees on carry no information; weight naturally falls out of the likelihood.
- **v2.1 Adaptive selection.** Serve positions where Maia's policy differs most across Elos near the user's posterior.
- **v2.2 In-browser Maia-3** (`maia3-js`, WASM default, WebGPU optional) so any pasted FEN/PGN, including the user's own games, can be drilled in the same UI.
- **v3 Experimental swap/live mode.** Human move, then engine move, roles flip every ply-pair (interval configurable: 1, 5, per game); opponent = Maia or weakened engine; optional hide-eval until the end; predict-the-engine's-reply drill.
- **v3.1 Personal drills.** Import own games (Lichess/Chess.com), spaced repetition by tag, weakness report.
- **v4 Polish.** Italian/English UI, PWA/offline, optional sound. (Piece set, accessibility and keyboard play moved to v1.4.)

## 12. Open questions for the owner

- ~~Static page vs service~~ **Answered 2026-11-03:** yes to the `api` service (4.2), `valkey` optional as a cache only.
- Visual reference: is there a site whose look and feel is the bar (Lichess-like, Chess.com-like, something else)? Default: calm, Lichess-like density, own identity.
- Where does the repo live (GitHub? self-hosted Forgejo/GitLab?) so CI is written for the right runner?
- Licence of the repo (GPL-3.0-or-later vs MIT; AGPL if Maia-3 weights are bundled).
- Preferred default rating band and time controls for the first real dataset (Rapid/Classical recommended: less time-trouble noise).
- Should low-clock positions (Lichess `[%clk]`) be excluded from the real dataset? (Recommended yes, v1.1.)

## 13. First 30 minutes of a new session

(If you have network access and podman, follow `CONTINUE.md` instead; it is the ordered task list for the next session.)

1. `python -m pytest -q` and `cd web && npm test` — both green? (Set `GTM_ENGINE` to run the real-engine test, see README.)
2. Open `web/index.html` through `python -m http.server -d web`.
3. Pick the top roadmap item the owner names, restate the acceptance criterion in one line, write the failing test, then implement.

## 14. State at hand-off (end of the v1 session)

Verified (run, not assumed): pipeline unit tests; real Stockfish 19 (npm, WASM, under Node) integration incl. mate encoding; demo dataset of 90 positions (all legal moves evaluated, SAN cross-checked against python-chess); scoring parity Python/JS; DOM flows incl. promotion, orientation, storage failure, HTML escaping; every shipped position playable by clicking its best move; headless Chrome load with no console errors, desktop and phone-width screenshots checked by eye.

Added after the hand-off request for podman services: sampler streams `http(s)` URLs and reports `games_read` (a truncated `.zst` ends silently, so zero games is now an error exit); the UI uses CSS classes instead of inline `style=` and loads under the strict CSP in headless Chrome with zero violations (negative control confirmed that an inline style *is* blocked); `containers/web/nginx.conf` ran under real nginx 1.24 and served the right headers, gzip, MIME types, `/healthz` and 404; both Containerfiles' COPY lines were built on `scratch` and the resulting file lists checked; pipeline tests pass with Debian Stockfish 16 (`/usr/games/stockfish`) and npm Stockfish 19. Podman 4.9.3 exists in the build sandbox but the registry answers 403, so **no real image was built or run**.

**UNTESTED:** `podman build` of either image (base images, `apt-get install stockfish` inside `python:3.12-slim`, CPU torch + `maia2` install), `podman compose` / `podman-compose` (profiles), the Quadlet unit, `--read-only` + tmpfs with `nginx-unprivileged`, SELinux `:Z` behaviour, healthcheck; the Maia path (`--maia maia2`) and any real Lichess data (neither host was reachable from the build sandbox); behaviour in Safari/Firefox; long sessions with thousands of positions (dataset size ≈ 1.1 KB per position without Maia, more with); screen readers.

Known limitations (UI, measured/read 2026-11-03): moves are made by click-source-then-click-destination only, with no drag and no pointer-event code; keyboard support is limited to `n` and `Escape`; commit is irreversible; the layout is functional but plain; unicode piece glyphs (look depends on installed fonts); no en-passant/castling-specific UI hints; rank beyond ~10 in the engine ordering is noisy at 400k nodes; the demo set has no endgames and no ratings.

### 14.1 Progress log of the continuation session (2026-11-03, a machine with network, podman 5.8.2 machine, Chrome)

Updated at the end of every task (CONTINUE.md order). Evidence is in the commit messages and `CHANGELOG.md`.

- **T0 done.** Baseline reproduced exactly: pytest 61 passed + 1 skipped (62 with an engine, both native Stockfish 19 and the npm WASM build), JS 18 passing. Reachable: Hugging Face, GitHub, database.lichess.org, PyPI, npm, download.pytorch.org (HTTP 200); Docker Hub and Quay `/v2/` answer 401 (normal without a token). Podman 5.8.2 via a `libkrun` machine (8 CPUs, 8 GB, arm64 Linux), rootless, cgroup v2. Python 3.11 is the venv interpreter (the default `python3` is 3.14, too new for `maia2`). Engine for host builds: native Stockfish 19 (`/opt/homebrew/bin/stockfish`); native and WASM both need about 0.65 s per position at 400k nodes with MultiPV 30 on this machine, so speed does not decide it. The builder container uses Debian's `stockfish`, whose version follows the distro; `meta.engine` records whichever ran.
- **T8 done.** See 10.1 for numbers. Node 22.22 supports the coverage flags (CONTINUE had them verified on 22.23).
- **T1 done** (macOS, podman 5.8.2, `libkrun` machine). Pass: `make web-image && make run` (image 62 MB): `/healthz` returns `ok`; CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` present; `/data/positions.json` served `Content-Encoding: gzip` with `Cache-Control: no-cache`; container runs as uid 101 with `--read-only --tmpfs /tmp --cap-drop=all --security-opt no-new-privileges` (CapEff 0, NoNewPrivs 1, writes to the rootfs refused), so the "nginx needs only /tmp" assumption held. Playwright in Chrome against the container: zero console errors, zero `securitypolicyviolation`, one position played to the reveal; a negative control (an injected inline style) IS reported, so the zero is meaningful. Builder image (252 MB): Debian's `stockfish` is at `/usr/games/stockfish` and is version 17.1 on arm64; `make dataset` on the demo PGN wrote a valid `schema: 1` file. Bind-mount ownership: files written by the builder belong to the Mac user (mode 600 on the Mac), readable by nginx uid 101; no `--userns=keep-id` needed. `podman compose up --build` (provider: Docker Compose v5.6.1 on podman's socket; `podman-compose` is not installed) starts `web` only, healthy; `--profile build run --rm builder --help` works. Quadlet: installed inside the machine VM (`podman machine ssh`, user `core`), `systemctl --user start` active, container healthy, `/healthz` ok; unit and data removed afterwards. `WITH_MAIA=1` builds: 981 MB, torch 2.8.0+cpu, `maia2` 0.11.0 imports (weights not downloaded or run: that is T3). Fixed: `HEALTHCHECK` in the Containerfile is ignored for OCI images (build warning), so the health check is now passed at run time (Makefile, compose, Quadlet). **UNTESTED:** Linux host (SELinux `:Z`, native uid mapping), `podman-compose`, `--platform linux/amd64` builds.
- **T4 research input (read 2026-11-03 by a subagent from primary sources, full table in `docs/research/t4-unverified.md`):** Lichess database is CC0 and its page allows redistribution; `[%clk]` comments exist since April 2017, `[%eval]` on about 6% of games. Maia-2 weights are downloaded from Google Drive (gdown, SHA-256 pinned in the code), weights licence not stated; Elo buckets are below 1100, 1100-1999 in steps of 100, and 2000 and above (clamped, not an error range); moves are UCI strings for the side to move; win score is from White's side. Maia-3 official repo is AGPL-3.0; `maia3-js` (third party) is labelled MIT but ships AGPL-derived weights. Piece sets: cburnett and merida GPLv2+, chessnut Apache-2.0 are usable; staunty, fresca, california, caliente, anarcandy, cooke, horsey, xkcd are CC BY-NC-SA 4.0 and alpha is non-commercial (excluded). Lucide ISC, Tabler MIT. These are NOT yet written into section 7; T3 re-checks the Maia-2 items by running the code, T4 finishes the list.
- **T9 done** (specs 2.1, 2.2). Built: Pointer-Events drag (4 px threshold; ghost on a layer that `render` never touches; `pointermove` only sets attributes; Escape, `pointercancel` and lost capture cancel; `touch-action: none` on the board only), tap-tap, roving-cursor keyboard play with `aria-live` announcements, confirm-before-reveal, tokens with light/dark and a toggle (`theme.js` sets it before first paint), three layouts (desktop >= 900 two columns with the board sized to the viewport height, tablet one column up to 600 px, phone edge-to-edge with a sticky action bar and collapsed filters), one arrow per distinct move with a pill naming every key that chose it (colour from the Okabe-Ito set plus dash style plus letter), cost bars, a verdict line and legend, onboarding (3 steps, overlay so it cannot shift the layout), loading skeleton, error/offline states with retry, `strings.js` for all text, `board.js` (pure geometry and gesture state machine, node-tested), cburnett SVG pieces and Lucide icons (`NOTICE`). **Evidence:** Playwright e2e 88 passed + 5 skipped by design (3 container-only, 2 phone-only) at 1280x800, 768x1024 and 390x844 (touch, DPR 2), repeated 3x with 0 flaky; axe-core zero findings of any severity in both themes across onboarding, position, pending move, reveal, stats and error states (a negative control proves axe fires: missing alt and low contrast are caught); Lighthouse mobile (13.6.0, simulated throttling, one run against the nginx container, demo data): Performance 100, Accessibility 100, Best Practices 100, CLS 0.003, LCP 1.4 s, TBT 0 (`docs/lighthouse/summary.json`; the first run scored Performance 81 with CLS 0.388 because the onboarding card and demo banner were inserted above `<main>` after load; fixed by an overlay, a footer banner, `defer` and a dataset preload); JS+CSS 17 KB gzipped against the 60 KB budget; JS coverage `app.js` 100% lines / 95.6% branches, `board.js`, `theme.js`, `scoring.js` 100%. Screenshots: `docs/screens/before-*` and `after-*` (position, reveal, dark, onboarding, full page) at the three viewports, `drag-1..4.png` (press, mid-flight, over the target, dropped), `cvd-*.png` (protanopia, deuteranopia, tritanopia, achromatopsia, via Chrome's emulation), `focus-keyboard.png`. **What I would still fix:** on a 800 px-high desktop the result table is below the fold; the dotted "you" arrow is the weakest of the four styles; the onboarding sheet covers the prompt line while it is open; "0 positions match" after the last unseen position reads oddly. **UNTESTED:** a real phone, Safari/iOS, Firefox, Android Chrome (all e2e ran in desktop Chrome with touch emulation); screen readers (only axe and the live-region text were checked); Lighthouse on a real device or with a throttled network other than Lighthouse's own simulation. The "Known limitations" list in section 14 above is superseded for input and look.
