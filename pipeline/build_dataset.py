"""Build web/data/positions.json from a PGN file.

Example (real run, on a machine that can reach the Lichess database):
    python -m pipeline.build_dataset --pgn lichess_db_standard_rated_2026-09.pgn.zst \
        --out web/data/positions.json --candidates 1500 --keep 400 \
        --min-elo 1200 --max-elo 2000 --time-controls Rapid,Classical \
        --max-games 200000 --maia maia2
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import shlex
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import chess

from .sampler import Candidate, SamplerConfig, open_text, sample_candidates
from .tags import TagConfig, phase_of, tag_position
from .winpct import win_pct

SCHEMA = 1
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENGINE = f"node {ROOT / 'tools/engine-node/node_modules/stockfish/bin/stockfish-19-single.js'}"


def source_label(src: str) -> str:
    """File name of a path or URL, for meta/logging (never the query string)."""
    path = urlparse(src).path if src.startswith(("http://", "https://")) else src
    return Path(path).name


def build_positions(
    cands: list[Candidate],
    engine,
    maia,
    tag_cfg: TagConfig = TagConfig(),
    *,
    max_abs_cp: int | None = 500,
    drop_trivial: bool = True,
    progress: Callable[[int, int], None] | None = None,
) -> list[dict]:
    positions: list[dict] = []
    for i, c in enumerate(cands):
        if progress:
            progress(i, len(cands))
        board = chess.Board(c.fen)
        legal = {m.uci() for m in board.legal_moves}

        evals = engine.analyse_all(board)
        if set(evals) != legal:
            raise RuntimeError(f"engine evals do not cover the legal moves for {c.fen}")
        if c.real_uci not in legal:
            raise RuntimeError(f"real move {c.real_uci} is not legal in {c.fen}")
        if max_abs_cp is not None and abs(max(evals.values())) > max_abs_cp:
            continue  # position already decided: little to learn

        maia_block = None
        probs: dict[str, float] = {}
        if c.player_elo is not None and getattr(maia, "name", None):
            raw = maia.probs(c.fen, c.player_elo, c.opp_elo or c.player_elo)
            if not set(raw) <= legal:
                raise RuntimeError(
                    f"maia backend returned moves that are not legal UCI for {c.fen}: "
                    f"{sorted(set(raw) - legal)[:3]}"
                )
            probs = {m: round(p, 4) for m, p in raw.items() if p >= 0.001}
            maia_block = {"elo": c.player_elo, "probs": probs}

        tags = tag_position(evals, c.real_uci, probs, tag_cfg)
        if drop_trivial and "trivial" in tags:
            continue

        positions.append(
            {
                "id": hashlib.sha1(f"{c.fen}|{c.real_uci}".encode()).hexdigest()[:10],
                "fen": c.fen,
                "ply": c.ply,
                "move_no": c.move_no,
                "stm": c.color,
                "phase": phase_of(board, tag_cfg),
                "player_elo": c.player_elo,
                "opp_elo": c.opp_elo,
                "real": c.real_uci,
                "evals": {m: int(v) for m, v in evals.items()},
                "san": {m.uci(): board.san(m) for m in board.legal_moves},
                "maia": maia_block,
                "tags": tags,
                "site": c.site,
            }
        )
    if progress:
        progress(len(cands), len(cands))
    return positions


def select(positions: list[dict], keep: int, seed: int = 0) -> list[dict]:
    """Keep up to `keep` positions, balanced across phases (round-robin), deterministic for a seed.

    A position+move pair appears once: two games can reach the same position and play the same move
    (common in openings), and `id` is a hash of exactly that. The first occurrence wins.
    """
    rng = random.Random(seed)
    by_phase: dict[str, list[dict]] = {}
    seen: set[str] = set()
    for p in positions:
        if p["id"] in seen:
            continue
        seen.add(p["id"])
        by_phase.setdefault(p["phase"], []).append(p)
    for group in by_phase.values():
        rng.shuffle(group)
    out: list[dict] = []
    while len(out) < keep and any(by_phase.values()):
        for phase in sorted(by_phase):
            if by_phase[phase] and len(out) < keep:
                out.append(by_phase[phase].pop())
    return out


def write_dataset(path: Path, positions: list[dict], meta: dict) -> None:
    counts: dict[str, int] = {}
    for p in positions:
        counts[p["phase"]] = counts.get(p["phase"], 0) + 1
    payload = {"schema": SCHEMA, "meta": {**meta, "counts": counts}, "positions": positions}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pgn", required=True, help="PGN file (.pgn or .pgn.zst) or an http(s) URL, streamed")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--engine", default=os.environ.get("GTM_ENGINE", DEFAULT_ENGINE), help="UCI engine command")
    ap.add_argument("--nodes", type=int, default=400_000, help="node budget per position (MultiPV over all legal moves)")
    ap.add_argument("--maia", choices=["none", "maia2"], default="none")
    ap.add_argument("--maia-kind", choices=["rapid", "blitz"], default="rapid")
    ap.add_argument("--maia-home", default=os.environ.get("MAIA2_HOME", "./maia2_models"),
                    help="where maia2 keeps (and downloads) its weights; mount a volume here to avoid re-downloading")
    ap.add_argument("--candidates", type=int, default=1000, help="positions to analyse")
    ap.add_argument("--keep", type=int, default=300, help="positions to keep after filtering")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--min-elo", type=int)
    ap.add_argument("--max-elo", type=int)
    ap.add_argument("--min-ply", type=int, default=8)
    ap.add_argument("--max-ply", type=int, default=120)
    ap.add_argument("--per-game", type=int, default=2)
    ap.add_argument("--time-controls", help="comma list, e.g. Rapid,Classical")
    ap.add_argument("--max-games", type=int)
    ap.add_argument("--min-clock-seconds", type=float, default=30.0,
                    help="drop positions where the mover had less than this many seconds left after the real move "
                         "(Lichess [%%clk] comments); 0 switches the filter off. Positions without clock data are kept")
    ap.add_argument("--allow-missing-elo", action="store_true")
    ap.add_argument("--max-abs-cp", type=int, default=500, help="drop positions already decided beyond this")
    ap.add_argument("--keep-trivial", action="store_true")
    ap.add_argument("--demo", action="store_true", help="mark the dataset as demo data")
    args = ap.parse_args(argv)

    scfg = SamplerConfig(
        min_elo=args.min_elo,
        max_elo=args.max_elo,
        min_ply=args.min_ply,
        max_ply=args.max_ply,
        per_game=args.per_game,
        time_controls=frozenset(args.time_controls.split(",")) if args.time_controls else None,
        require_elo=not args.allow_missing_elo,
        max_games=args.max_games,
        min_clock_s=args.min_clock_seconds or None,
    )
    label = source_label(args.pgn)
    stats: dict = {}
    try:
        with open_text(args.pgn) as fh:
            cands = sample_candidates(fh, scfg, args.candidates, args.seed, stats)
    except OSError as exc:  # missing file, HTTP error, DNS/connection failure (urllib errors are OSErrors)
        print(f"cannot read {label}: {exc}", file=sys.stderr)
        return 2
    print(
        f"read {stats['games_read']} games ({stats['games_used']} passed the game filters) from {label}; "
        f"sampled {len(cands)} candidates from {stats['eligible']} eligible positions ({stats['low_clock_dropped']} dropped for low clock, "
        f"{stats['no_clock_info']} without clock data)",
        file=sys.stderr,
    )
    if stats["games_read"] == 0:
        print("no games read: wrong path/URL, empty input, or a truncated/corrupt .zst "
              "(python-zstandard ends silently on truncated input)", file=sys.stderr)
        return 1
    if not cands:
        print("no candidates: check the filters (rating range, time controls, ply window)", file=sys.stderr)
        return 1

    from .backends import Maia2Backend, NullMaia, StockfishBackend

    engine = StockfishBackend(shlex.split(args.engine), nodes=args.nodes)
    maia = Maia2Backend(kind=args.maia_kind, save_root=args.maia_home) if args.maia == "maia2" else NullMaia()
    tcfg = TagConfig()

    def progress(i: int, n: int) -> None:
        if i % 10 == 0 or i == n:
            print(f"  analysed {i}/{n}", file=sys.stderr)

    try:
        positions = build_positions(
            cands, engine, maia, tcfg,
            max_abs_cp=args.max_abs_cp, drop_trivial=not args.keep_trivial, progress=progress,
        )
    finally:
        engine.close()

    chosen = select(positions, args.keep, args.seed)
    meta = {
        "engine": engine.name,
        "nodes": args.nodes,
        "maia": maia.name,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": label,
        "demo": args.demo,
        "seed": args.seed,
        "min_clock_seconds": scfg.min_clock_s,
        "sampling": stats,
        "thresholds": asdict(tcfg),
        "win_pct_scale": "lichess",
    }
    write_dataset(args.out, chosen, meta)
    print(f"wrote {len(chosen)} positions ({len(positions)} passed filters) to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
