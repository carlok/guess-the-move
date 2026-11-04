# SPDX-License-Identifier: AGPL-3.0-or-later
"""Add Maia's move probabilities at the rating anchors (`maia.by_elo`) to a dataset that was built without them.

The builder stores Maia's probabilities only at the real player's rating, and Maia-3 also reads the eight positions
before the one asked about, which the dataset does not keep. So this tool streams the same Lichess archive again,
finds the dataset's games by their id (the `site` link), replays each to the position, and then:

  1. checks that the replayed position IS the stored FEN (otherwise the history would be wrong);
  2. recomputes Maia at the real player's rating with that history and compares with the stored `maia.probs`: if the
     history were reconstructed differently the numbers would not match, so this is a real test of it;
  3. computes Maia at each anchor rating with the same history and opponent rating, and stores it.

Needs the Maia-3 environment (.venv-maia) and the weights. Example:
  .venv-maia/bin/python tools/add_anchors.py --data web/data/positions.json \\
      --pgn https://database.lichess.org/standard/lichess_db_standard_rated_2026-09.pgn.zst --maia-home hf_cache
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

import chess
import chess.pgn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.anchors import ANCHORS, by_elo, describe, maia_probs  # noqa: E402
from pipeline.sampler import iter_games, open_text  # noqa: E402

TOLERANCE = 0.0006  # stored probabilities are rounded to 4 decimals: the recomputation must agree to well within this


def game_id(site: str | None) -> str | None:
    return site.rstrip("/").rsplit("/", 1)[-1] if site and site.startswith("https://lichess.org/") else None


def histories(games, wanted: dict[str, dict[int, str]], limit: int | None = None) -> tuple[dict[tuple[str, int], tuple[str, ...]], int]:
    """{(game id, ply): the up to seven earlier FENs} for every wanted (game, ply), read from `games` (PGN game objects).
    `wanted` is {game id: {ply: the FEN the dataset stores}}. Stops once everything is found. Returns (histories, games read).
    A replayed position that is not the stored FEN is an error: the dataset and the archive disagree."""
    found: dict[tuple[str, int], tuple[str, ...]] = {}
    total = sum(len(v) for v in wanted.values())
    read = 0
    for game in games:
        read += 1
        gid = game_id(game.headers.get("Site"))
        if gid in wanted:
            board, earlier = game.board(), deque(maxlen=7)
            plies = wanted[gid]
            for node in game.mainline():
                if board.ply() in plies:
                    if board.fen() != plies[board.ply()]:
                        raise RuntimeError(f"game {gid} ply {board.ply()}: replayed position differs from the stored one")
                    found[(gid, board.ply())] = tuple(earlier)
                earlier.append(board.fen())
                board.push(node.move)
        if len(found) == total or (limit is not None and read >= limit):
            break
    return found, read


def enrich(data: dict, hist: dict[tuple[str, int], tuple[str, ...]], maia, anchors: tuple[int, ...] = ANCHORS) -> dict:
    """Adds `by_elo` to every position that has Maia data and a recovered history. Returns what was checked."""
    stats = {"positions": 0, "enriched": 0, "no_history": 0, "no_maia": 0, "reproduced": 0, "max_abs_diff": 0.0, "mismatches": []}
    for p in data["positions"]:
        stats["positions"] += 1
        if not p.get("maia"):
            stats["no_maia"] += 1
            continue
        h = hist.get((game_id(p.get("site")), p["ply"]))
        if h is None:
            stats["no_history"] += 1
            continue
        legal = {m.uci() for m in chess.Board(p["fen"]).legal_moves}
        opp = p["opp_elo"] or p["player_elo"]
        again = maia_probs(maia, p["fen"], p["player_elo"], opp, h)
        diff = max((abs(again.get(m, 0.0) - q) for m, q in p["maia"]["probs"].items()), default=0.0)
        stats["max_abs_diff"] = max(stats["max_abs_diff"], diff)
        if diff > TOLERANCE:
            stats["mismatches"].append({"id": p["id"], "diff": round(diff, 5)})
            continue
        stats["reproduced"] += 1
        p["maia"]["by_elo"] = by_elo(maia, p["fen"], opp, legal, h, anchors)
        stats["enriched"] += 1
    if stats["enriched"]:
        prov = data.setdefault("meta", {}).setdefault("provenance", {})
        prov["maia_anchors"] = {**describe(anchors), "added_by": "tools/add_anchors.py (history replayed from the source archive)"}
    return stats


def main(argv: list[str] | None = None, maia=None, games=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--out", type=Path, help="default: rewrite --data")
    ap.add_argument("--pgn", required=True, help="the archive the dataset was built from (path or URL)")
    ap.add_argument("--maia-model", default="maia3-23m")
    ap.add_argument("--maia-home", default="./hf_cache")
    ap.add_argument("--max-games", type=int, help="stop reading the archive after this many games")
    args = ap.parse_args(argv)
    data = json.loads(args.data.read_text(encoding="utf-8"))
    wanted: dict[str, dict[int, str]] = {}
    for p in data["positions"]:
        gid = game_id(p.get("site"))
        if gid and p.get("maia"):
            wanted.setdefault(gid, {})[p["ply"]] = p["fen"]
    if not wanted:
        print("no position with Maia data and a Lichess game link", file=sys.stderr)
        return 1
    if games is None:
        games = iter_games(open_text(args.pgn))
    hist, read = histories(games, wanted, args.max_games)
    print(f"read {read} games, recovered history for {len(hist)} of {sum(len(v) for v in wanted.values())} positions", file=sys.stderr)
    if maia is None:
        from pipeline.backends import Maia3Backend

        maia = Maia3Backend(model=args.maia_model, cache_dir=args.maia_home)
    stats = enrich(data, hist, maia)
    print(json.dumps({k: v for k, v in stats.items() if k != "mismatches"}) + f" mismatches={len(stats['mismatches'])}", file=sys.stderr)
    if stats["mismatches"]:
        print("history reconstruction does not reproduce the stored probabilities for: " + ", ".join(m["id"] for m in stats["mismatches"][:10]), file=sys.stderr)
        return 2
    out = args.out or args.data
    out.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
