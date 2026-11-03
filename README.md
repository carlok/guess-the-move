# Guess the Move

A small free-software chess trainer for learning to see a position through another player's eyes.

You get a real position, guess a move, and the app reveals three references and how far your guess is from each, on a normalized scale:

- **Stockfish's best move** (what is objectively best),
- **the real move** played by a real player of known rating,
- **Maia's move at that rating** (what a typical player of that strength would do).

Read `PROMPT.md` for the full engineering brief (goals, decisions, scoring spec, roadmap). It is written to be pasted into an agent session.

## Run the app

```bash
python3 -m http.server -d web 8000     # then open http://localhost:8000
```

`web/data/positions.json` ships as **demo data** (three public-domain historical games, no ratings, so no Maia data). Build a real set below.

## Tests

```bash
python3 -m venv .venv && .venv/bin/pip install chess zstandard pytest
.venv/bin/python -m pytest -q                      # maths, tags, sampler, dataset invariants
GTM_ENGINE="node tools/engine-node/node_modules/stockfish/bin/stockfish-19-single.js" \
  .venv/bin/python -m pytest -q                    # + real-engine integration test
cd web && npm install && npm test                  # scoring parity with Python + DOM flows (jsdom)
```

## Containers (rootless podman)

The app is meant to run as podman services. **UNTESTED as images**: the files were validated statically and the nginx config was run on the host, but no image could be pulled where they were written (see `CONTINUE.md`, T1).

```bash
make web-image && make run              # http://127.0.0.1:8080  (serves ./web/data, read-only rootfs)
make stop
make dataset PGN=/in/games.pgn.zst ARGS='--min-elo 1200 --max-elo 2000 --time-controls Rapid,Classical --max-games 200000 --maia none'
                                        # PGN is a path under ./data (mounted at /in) or an http(s) URL; writes web/data/positions.json
podman compose up --build               # or podman-compose; the builder is under --profile build
```

Pieces: `containers/web` (nginx-unprivileged, strict CSP, `/healthz`), `containers/builder` (Python + Debian Stockfish; `WITH_MAIA=1` adds CPU torch + maia2), `compose.yaml`, `Makefile`, `deploy/quadlet/` (systemd user unit). Planned services (`api`, optional Valkey) are in `PROMPT.md` section 4.1.

## Build a dataset

1. **Engine.** Any UCI engine works. The default is Stockfish 19 (GPL-3.0) from npm, run under Node:
   ```bash
   mkdir -p tools/engine-node && cd tools/engine-node && npm init -y && npm install stockfish
   ```
   Or use a native binary: `--engine /usr/bin/stockfish`.
2. **Games.** Use a monthly archive from https://database.lichess.org (check its licence terms before redistributing derived data; it is believed to be CC0). `--pgn` accepts a local `.pgn`/`.pgn.zst` or an `http(s)` URL, which is streamed, so with `--max-games` only the beginning of the archive is downloaded. The run prints how many games it read and exits with an error if that is zero (a truncated `.zst` otherwise ends silently).
3. **Run:**
   ```bash
   .venv/bin/python -m pipeline.build_dataset \
     --pgn lichess_db_standard_rated_2026-09.pgn.zst --out web/data/positions.json \
     --min-elo 1200 --max-elo 2000 --time-controls Rapid,Classical --max-games 200000 \
     --candidates 1500 --keep 400 --nodes 400000 --maia maia2
   ```
   Cost: about 2.5 s per position at 400k nodes on one core (every legal move is evaluated with MultiPV).
4. **Maia** (`--maia maia2`) needs `pip install maia2` (Python 3.10-3.12, pulls torch) and network access to download its weights. This path is **untested** in the environment that built v1; the pipeline fails loudly if the model returns anything other than legal UCI moves. Use `--maia none` (default) to build without human-model data.

Useful flags: `--per-game`, `--min-ply/--max-ply`, `--max-abs-cp` (drop already-decided positions), `--keep-trivial`, `--seed`, `--allow-missing-elo`.

## Layout

```
PROMPT.md            engineering brief (single source of truth)
CONTINUE.md          ready-to-paste prompt for the next session (needs network + podman)
compose.yaml, Makefile, containers/, deploy/quadlet/   podman packaging
pipeline/            PGN sampler, engine/Maia backends, tags, dataset builder, demo games
web/                 static app: index.html, app.js, scoring.js, style.css, data/positions.json
tests/               pytest suite + vectors.json (shared with the JS tests)
tools/engine-node/   Stockfish (npm), git-ignored
```

## Status

v1: pipeline + static app + demo data + podman packaging (images not yet built anywhere). Not yet done: real-game dataset, Maia path run for real, level estimator (see roadmap in `PROMPT.md`). Repo licence not chosen yet.
