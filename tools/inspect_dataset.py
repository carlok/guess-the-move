"""Eyeball a built dataset: `python tools/inspect_dataset.py web/data/positions.json [--min-elo N --max-elo N]`.

Prints what to check by eye before shipping: phase and tag distribution, rating spread (and whether any rating
falls outside the band the build asked for), SAN/eval completeness, bytes per position, duplicate ids, Maia presence
and the sampling counts recorded in meta. Exits 1 on a structural problem (see `problems`).
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


def summarise(path: Path, min_elo: int | None = None, max_elo: int | None = None) -> dict:
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    positions = data["positions"]
    elos = [p["player_elo"] for p in positions if p["player_elo"] is not None]
    problems = []
    if any(set(p["evals"]) != set(p["san"]) for p in positions):
        problems.append("evals and san cover different moves")
    ids = Counter(p["id"] for p in positions)
    if any(n > 1 for n in ids.values()):
        problems.append("duplicate ids")
    outside = [e for e in elos if (min_elo is not None and e < min_elo) or (max_elo is not None and e > max_elo)]
    if outside:
        problems.append(f"{len(outside)} ratings outside the requested band")
    n = len(positions)
    return {
        "positions": n,
        "bytes_per_position": round(len(raw.encode()) / n) if n else None,
        "phases": dict(Counter(p["phase"] for p in positions)),
        "tags": dict(Counter(t for p in positions for t in p["tags"]).most_common()),
        "with_tags": sum(1 for p in positions if p["tags"]),
        "elo": {"min": min(elos), "max": max(elos), "mean": round(sum(elos) / len(elos))} if elos else None,
        "without_elo": n - len(elos),
        "with_maia": sum(1 for p in positions if p["maia"] is not None),
        "mean_legal_moves": round(sum(len(p["evals"]) for p in positions) / n, 1) if n else None,
        "engine": data["meta"].get("engine"),
        "nodes": data["meta"].get("nodes"),
        "maia": data["meta"].get("maia"),
        "demo": data["meta"].get("demo"),
        "source": data["meta"].get("source"),
        "sampling": data["meta"].get("sampling"),
        "min_clock_seconds": data["meta"].get("min_clock_seconds"),
        "provenance": data["meta"].get("provenance"),
        "with_game_block": sum(1 for p in positions if p.get("game")),
        "dates": sorted({p["game"]["date"] for p in positions if p.get("game") and p["game"].get("date")})[:3],
        "bands": dict(sorted(Counter(((p["player_elo"] // 200) * 200) for p in positions if p["player_elo"] is not None).items())),
        "problems": problems,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", type=Path)
    ap.add_argument("--min-elo", type=int)
    ap.add_argument("--max-elo", type=int)
    args = ap.parse_args(argv)
    report = summarise(args.path, args.min_elo, args.max_elo)
    print(json.dumps(report, indent=2))
    return 1 if report["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
