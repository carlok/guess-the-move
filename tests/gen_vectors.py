# SPDX-License-Identifier: AGPL-3.0-or-later
"""Generate tests/vectors.json, the numeric fixture shared by the Python and JS test suites.

Deterministic (fixed seed). Run `python tests/gen_vectors.py` to rewrite the file; tests/test_vectors.py
fails when the committed file differs from what this script produces, so the two cannot drift. The
expected values come from pipeline/winpct.py; web/test/scoring.test.js checks scoring.js against them.
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.winpct import accuracy_from_drop, cost, distance, similarity, win_pct  # noqa: E402

OUT = ROOT / "tests" / "vectors.json"
SEED = 20261103
N_RANDOM = 200

FIXED_CP = [-5000, -1500, -1000, -400, -100, -40, 0, 20, 100, 300, 1000, 1500, 5000]
FIXED_DROPS = [-3, 0, 1, 5, 10, 20, 50, 100]
FIXED_EVALS = {"e2e4": 100, "d2d4": 0, "g1f3": -300, "a2a3": -900}
FIXED_PAIRS = [("e2e4", "d2d4"), ("e2e4", "g1f3"), ("d2d4", "d2d4"), ("g1f3", "a2a3")]
MOVES = ["e2e4", "d2d4", "g1f3", "c2c4", "a2a3", "h2h3", "b1c3", "f2f4"]


def build() -> dict:
    rng = random.Random(SEED)
    random_cases = []
    for _ in range(N_RANDOM):
        names = rng.sample(MOVES, rng.randint(2, len(MOVES)))
        evals = {m: rng.choice([rng.randint(-2000, 2000), rng.choice([-9999, 9999])]) for m in names}
        a, b = rng.choice(names), rng.choice(names)
        random_cases.append(
            {
                "evals": evals, "a": a, "b": b,
                "cost_a": cost(evals, a), "distance": distance(evals, a, b), "similarity": similarity(evals, a, b),
            }
        )
    random_cp = [rng.randint(-3000, 3000) for _ in range(N_RANDOM)]
    random_drops = [round(rng.uniform(-5, 110), 6) for _ in range(N_RANDOM)]
    return {
        "win_pct": [[cp, win_pct(cp)] for cp in FIXED_CP],
        "accuracy": [[d, accuracy_from_drop(d)] for d in FIXED_DROPS],
        "evals": FIXED_EVALS,
        "cost": {m: cost(FIXED_EVALS, m) for m in FIXED_EVALS},
        "pairs": [
            {"a": a, "b": b, "distance": distance(FIXED_EVALS, a, b), "similarity": similarity(FIXED_EVALS, a, b)}
            for a, b in FIXED_PAIRS
        ],
        "random_win_pct": [[cp, win_pct(cp)] for cp in random_cp],
        "random_accuracy": [[d, accuracy_from_drop(d)] for d in random_drops],
        "random_cases": random_cases,
    }


def dumps(doc: dict) -> str:
    """One list item per line, compact items: small diffs, readable file."""
    compact = lambda v: json.dumps(v, separators=(",", ":"))
    parts = []
    for key, value in doc.items():
        if isinstance(value, list):
            body = ",\n".join("  " + compact(item) for item in value)
            parts.append(f" {json.dumps(key)}: [\n{body}\n ]")
        else:
            parts.append(f" {json.dumps(key)}: {compact(value)}")
    return "{\n" + ",\n".join(parts) + "\n}\n"


def main() -> None:
    OUT.write_text(dumps(build()), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
