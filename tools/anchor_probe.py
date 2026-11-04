# SPDX-License-Identifier: AGPL-3.0-or-later
"""Raw material for checking the interpolation between rating anchors (see tools/level_eval.js --interp).

For a seeded sample of dataset positions this asks Maia for its distribution at the anchor ratings AND at ratings
halfway between anchors, so the interpolation the page does can be compared with what the model itself says there.
History is left out (the dataset does not keep it): rating dependence, which is what interpolation has to capture,
does not need it, and the same call is used for both sides of the comparison.

  .venv-maia/bin/python tools/anchor_probe.py --data web/data/positions.json --out data/real4/probe.json --n 150
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import chess

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.anchors import ANCHORS, by_elo, maia_probs  # noqa: E402


def midpoints(anchors: tuple[int, ...]) -> list[int]:
    return [(a + b) // 2 for a, b in zip(anchors, anchors[1:])]


def probe(positions: list[dict], maia, n: int, seed: int, anchors: tuple[int, ...] = ANCHORS) -> list[dict]:
    rows = [p for p in positions if p.get("maia")]
    chosen = random.Random(seed).sample(rows, min(n, len(rows)))
    out = []
    for p in chosen:
        legal = {m.uci() for m in chess.Board(p["fen"]).legal_moves}
        opp = p["opp_elo"] or p["player_elo"]
        exact = {str(r): {m: round(q, 4) for m, q in maia_probs(maia, p["fen"], r, opp).items() if q >= 0.003} for r in midpoints(anchors)}
        out.append({"id": p["id"], "by_elo": by_elo(maia, p["fen"], opp, legal, (), anchors), "exact": exact})
    return out


def main(argv: list[str] | None = None, maia=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--n", type=int, default=150)
    ap.add_argument("--seed", type=int, default=20261104)
    ap.add_argument("--maia-model", default="maia3-23m")
    ap.add_argument("--maia-home", default="./hf_cache")
    args = ap.parse_args(argv)
    if maia is None:
        from pipeline.backends import Maia3Backend

        maia = Maia3Backend(model=args.maia_model, cache_dir=args.maia_home)
    data = json.loads(args.data.read_text(encoding="utf-8"))
    rows = probe(data["positions"], maia, args.n, args.seed)
    if not rows:
        print("no position with Maia data", file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(rows)} positions to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
