# SPDX-License-Identifier: AGPL-3.0-or-later
"""Evaluate the level estimator on held-out REAL games (CONTINUE.md T5). Needs network and the Maia venv:

    .venv-maia/bin/python tools/estimator_eval.py --pgn <url or file> --skip-games 200000 --players 150

The games are taken AFTER the first `--skip-games` games, so they are disjoint from the ones the dataset build read
(it reads the first 200,000). For each sampled player of known rating we feed the first N of their real moves (own
moves only, same filters as the dataset: Rapid/Classical, 1100-2000, at least 30 s on the clock) and report:
  - calibration: how often the 80% credible interval contains the player's true rating bucket, per N;
  - error: mean absolute error of the posterior mean (in Elo points) per N, next to a constant guess;
  - cost: bytes of a by-Elo table per position versus the single-Elo block the dataset stores today.
It reports numbers; it tunes nothing.
"""

import argparse
import json
import shlex
import statistics
import sys
from pathlib import Path

import chess
import chess.pgn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.backends import Maia2Backend, Maia3Backend  # noqa: E402
from pipeline.estimator import GRID, bucket, credible_interval, posterior, uniform_prior  # noqa: E402
from pipeline.sampler import _elo, open_text  # noqa: E402

NS = (5, 10, 20, 30)


def player_moves(game, color, min_clock=30.0, min_ply=8):
    """Observations (position, move) for one side, in game order, under the dataset's filters."""
    board, out, earlier = game.board(), [], []
    for node in game.mainline():
        mover = chess.WHITE if board.turn == chess.WHITE else chess.BLACK
        clk = node.clock()
        if mover == color and board.ply() >= min_ply and board.legal_moves.count() >= 2 and (clk is None or clk >= min_clock):
            out.append((board.fen(), node.move.uci(), tuple(earlier[-7:])))
        earlier.append(board.fen())
        board.push(node.move)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pgn", required=True)
    ap.add_argument("--skip-games", type=int, default=200000)
    ap.add_argument("--read-games", type=int, default=30000, help="games to read after the skipped ones")
    ap.add_argument("--players", type=int, default=150)
    ap.add_argument("--maia", default="maia2", choices=["maia2", "maia3"])
    ap.add_argument("--maia-model", default="maia3-23m")
    ap.add_argument("--kind", default="rapid")
    ap.add_argument("--maia-home", default="./maia2_models")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    players = []  # (true elo, opp elo, [(fen, move)])
    with open_text(args.pgn) as fh:
        for _ in range(args.skip_games):
            if not chess.pgn.skip_game(fh):
                break
        for i in range(args.read_games):
            game = chess.pgn.read_game(fh)
            if game is None or len(players) >= args.players:
                break
            h = game.headers
            if not any(t in h.get("Event", "") for t in ("Rapid", "Classical")) or h.get("Termination") in ("Abandoned", "Rules infraction"):
                continue
            w, b = _elo(h, "WhiteElo"), _elo(h, "BlackElo")
            if w is None or b is None:
                continue
            color = chess.WHITE if i % 2 == 0 else chess.BLACK  # alternate sides so both colours are tested
            me, opp = (w, b) if color == chess.WHITE else (b, w)
            moves = player_moves(game, color)
            if 1100 <= me <= 2000 and len(moves) >= max(NS):
                players.append((me, opp, moves[: max(NS)]))
    print(f"{len(players)} held-out players (games {args.skip_games}+)", file=sys.stderr)

    maia = (Maia3Backend(model=args.maia_model, cache_dir=args.maia_home) if args.maia == "maia3"
            else Maia2Backend(kind=args.kind, save_root=args.maia_home))
    grid = getattr(maia, "grid", GRID)
    use_history = getattr(maia, "uses_history", False)
    prior = uniform_prior(grid)
    nearest = (lambda e: min(grid, key=lambda g: abs(g - e))) if args.maia == "maia3" else bucket
    cover = {n: [] for n in NS}
    width = {n: [] for n in NS}
    err = {n: [] for n in NS}
    const_err = {n: [] for n in NS}
    sizes_by_elo, sizes_single = [], []
    for k, (me, opp, moves) in enumerate(players):
        obs = []
        for fen, mv, hist in moves:
            by = {e: (maia.probs(fen, e, opp, history=hist) if use_history else maia.probs(fen, e, opp)) for e in grid}
            obs.append({"move": mv, "probs": by})
            if k < 20:  # size of what a by-Elo table would add to one position
                tiny = lambda d: {m: round(p, 3) for m, p in d.items() if p >= 0.001}
                sizes_by_elo.append(len(json.dumps({str(e): tiny(by[e]) for e in grid}, separators=(",", ":"))))
                sizes_single.append(len(json.dumps({"elo": me, "probs": tiny(by[nearest(me)])}, separators=(",", ":"))))
        truth = nearest(me)
        for n in NS:
            post = posterior(obs[:n], prior, grid)
            lo, hi = credible_interval(post, 0.8, grid)
            cover[n].append(lo <= truth <= hi)
            width[n].append(hi - lo + 100)
            err[n].append(abs(sum(e * p for e, p in post.items()) - me))
            const_err[n].append(abs(1550 - me))
        if (k + 1) % 25 == 0:
            print(f"  {k + 1}/{len(players)}", file=sys.stderr)

    report = {
        "players": len(players), "ratings": {"min": min(p[0] for p in players), "max": max(p[0] for p in players)},
        "model": maia.name, "grid": list(grid), "interval": "80% credible, narrowest run of adjacent 100-point grid points",
        "by_moves_observed": {
            str(n): {"coverage_pct": round(100 * statistics.mean(cover[n]), 1), "mean_interval_width_elo": round(statistics.mean(width[n])),
                     "mae_elo": round(statistics.mean(err[n])), "constant_guess_mae_elo": round(statistics.mean(const_err[n]))}
            for n in NS},
        "bytes_per_position": {"single_elo_block": round(statistics.mean(sizes_single)), "by_elo_table": round(statistics.mean(sizes_by_elo))},
    }
    report["bytes_per_position"]["ratio"] = round(report["bytes_per_position"]["by_elo_table"] / report["bytes_per_position"]["single_elo_block"], 1)
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        args.out.write_text(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
