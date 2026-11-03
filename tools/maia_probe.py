"""Measure Maia-2 on real positions (CONTINUE.md T3). Needs network and the Maia venv:

    .venv-maia/bin/python tools/maia_probe.py --pgn <url or file> --n 400 --engine /opt/homebrew/bin/stockfish

Reports, per rating band of the player who moved: how often Maia's top move equals the real move, the same with the
control (maia2: the two Elo arguments swapped, which cannot detect an order bug; maia3: no game history), the same for
Stockfish at a tiny node budget and at the dataset budget, and the chance level (1 / legal moves). It also checks that
every key Maia returns is a legal UCI move of the position. This reports numbers; it does not tune anything.
"""

import argparse
import json
import shlex
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import chess

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.backends import Maia2Backend, Maia3Backend, StockfishBackend  # noqa: E402
from pipeline.sampler import SamplerConfig, open_text, sample_candidates  # noqa: E402

BANDS = [(1200, 1399), (1400, 1599), (1600, 1799), (1800, 2000)]


def top(d: dict) -> str:
    return max(d, key=d.get)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pgn", required=True)
    ap.add_argument("--n", type=int, default=400)
    ap.add_argument("--max-games", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--engine", default="/opt/homebrew/bin/stockfish")
    ap.add_argument("--low-nodes", type=int, default=2000, help="'Stockfish at low depth' control")
    ap.add_argument("--full-nodes", type=int, default=0, help="also run Stockfish at this budget (0 = skip; the dataset uses 400000)")
    ap.add_argument("--maia", default="maia2", choices=["maia2", "maia3"])
    ap.add_argument("--maia-model", default="maia3-5m", help="maia3 alias: maia3-5m, maia3-23m, maia3-79m")
    ap.add_argument("--kind", default="rapid", choices=["rapid", "blitz"])
    ap.add_argument("--maia-home", default="./maia2_models")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    cfg = SamplerConfig(min_elo=1200, max_elo=2000, per_game=2, time_controls=frozenset({"Rapid", "Classical"}),
                        max_games=args.max_games, min_clock_s=30)
    stats: dict = {}
    with open_text(args.pgn) as fh:
        cands = sample_candidates(fh, cfg, args.n, args.seed, stats)
    print(f"{len(cands)} candidates from {stats['games_read']} games", file=sys.stderr)

    t0 = time.time()
    maia = (Maia3Backend(model=args.maia_model, cache_dir=args.maia_home) if args.maia == "maia3"
            else Maia2Backend(kind=args.kind, save_root=args.maia_home))
    history = getattr(maia, "uses_history", False)
    print(f"maia2 loaded in {time.time() - t0:.1f}s", file=sys.stderr)
    low = StockfishBackend(shlex.split(args.engine), nodes=args.low_nodes)
    full = StockfishBackend(shlex.split(args.engine), nodes=args.full_nodes) if args.full_nodes else None

    rows, bad_keys, maia_secs = [], 0, []
    try:
        for i, c in enumerate(cands):
            board = chess.Board(c.fen)
            legal = {m.uci() for m in board.legal_moves}
            opp = c.opp_elo or c.player_elo
            t = time.time()
            p = maia.probs(c.fen, c.player_elo, opp, history=c.history) if history else maia.probs(c.fen, c.player_elo, opp)
            maia_secs.append(time.time() - t)
            if not set(p) <= legal:
                bad_keys += 1
            # control: maia2 with the two ratings swapped; maia3 without the game history
            swapped = maia.probs(c.fen, c.player_elo, opp) if history else maia.probs(c.fen, opp, c.player_elo)
            row = {
                "elo": c.player_elo, "stm": c.color, "n_legal": len(legal), "real": c.real_uci,
                "maia_top": top(p), "maia_swapped_top": top(swapped), "p_real": p.get(c.real_uci, 0.0),
                "p_sum": sum(p.values()), "n_keys": len(p), "sf_low_top": top(low.analyse_all(board)),
            }
            if full:
                row["sf_full_top"] = top(full.analyse_all(board))
            rows.append(row)
            if (i + 1) % 50 == 0:
                print(f"  {i + 1}/{len(cands)}", file=sys.stderr)
    finally:
        low.close()
        if full:
            full.close()

    def rate(sub, key):
        return round(100 * sum(1 for r in sub if r[key] == r["real"]) / len(sub), 1) if sub else None

    report = {"n": len(rows), "illegal_key_positions": bad_keys, "maia_ms_per_call_median": round(1000 * statistics.median(maia_secs), 1),
              "model": maia.name, "bands": {}, "colour": {}}
    groups = {f"{lo}-{hi}": [r for r in rows if lo <= r["elo"] <= hi] for lo, hi in BANDS}
    groups["all"] = rows
    for name, sub in groups.items():
        entry = {"n": len(sub), "chance": round(100 * statistics.mean(1 / r["n_legal"] for r in sub), 1) if sub else None,
                 "maia_top1": rate(sub, "maia_top"), "control_top1": rate(sub, "maia_swapped_top"),
                 "stockfish_low_top1": rate(sub, "sf_low_top"),
                 "mean_p_real": round(statistics.mean(r["p_real"] for r in sub), 3) if sub else None}
        if full:
            entry["stockfish_full_top1"] = rate(sub, "sf_full_top")
        report["bands"][name] = entry
    for colour in "wb":
        sub = [r for r in rows if r["stm"] == colour]
        report["colour"][colour] = {"n": len(sub), "maia_top1": rate(sub, "maia_top")}
    report["prob_mass_min"] = round(min(r["p_sum"] for r in rows), 3)
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        args.out.write_text(text + "\n")
    return 1 if bad_keys else 0


if __name__ == "__main__":
    sys.exit(main())
