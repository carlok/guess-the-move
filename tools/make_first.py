# SPDX-License-Identifier: AGPL-3.0-or-later
"""Make `first.json`: a small, fixed selection of the shipped positions that the page loads first, so the first position can be played
before the whole dataset (1.3 MB gzipped) has arrived. Every position in it is copied unchanged from the full file; the page
swaps in the full file when it arrives.

    python3 tools/make_first.py [--src web/data/positions.json] [--out web/data/first.json] [--n 24]

The choice is deterministic (a hash of the id), spread over the three phases in the proportions of the full file, and only takes
positions the page can use at once: at least five legal moves and the Maia data the level estimate needs. Run it again whenever
positions.json changes (`make dataset` does); a test fails when the two files disagree.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHASES = ("opening", "middlegame", "endgame")
MIN_MOVES = 5


def usable(p: dict) -> bool:
    maia = p.get("maia")
    return len(p.get("evals", {})) >= MIN_MOVES and bool(maia) and bool(maia.get("by_elo"))


def order_key(p: dict) -> str:
    return hashlib.sha256(p["id"].encode("ascii")).hexdigest()


def select_first(positions: list[dict], n: int = 24) -> list[dict]:
    """n positions, spread over the phases like `positions` is, each phase in hash order of the ids."""
    pool = [p for p in positions if usable(p)]
    total = sum(1 for p in pool if p.get("phase") in PHASES) or 1
    quota, left = {}, n
    for phase in PHASES:
        quota[phase] = round(n * sum(1 for p in pool if p.get("phase") == phase) / total)
        left -= quota[phase]
    quota[PHASES[0]] += left  # rounding: the remainder goes to the largest phase's slot, so the total is exactly n
    chosen = []
    for phase in PHASES:
        chosen += sorted((p for p in pool if p.get("phase") == phase), key=order_key)[: max(0, quota[phase])]
    return sorted(chosen, key=order_key)[:n]


def build(full: dict, n: int = 24) -> dict:
    meta = dict(full.get("meta", {}))
    meta["partial"] = {"of": len(full["positions"])}
    return {"schema": full["schema"], "meta": meta, "positions": select_first(full["positions"], n)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=str(ROOT / "web" / "data" / "positions.json"))
    ap.add_argument("--out", default=str(ROOT / "web" / "data" / "first.json"))
    ap.add_argument("--n", type=int, default=24)
    args = ap.parse_args(argv)
    full = json.loads(Path(args.src).read_text(encoding="utf-8"))
    out = build(full, args.n)
    Path(args.out).write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{args.out}: {len(out['positions'])} of {len(full['positions'])} positions", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
