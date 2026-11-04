# SPDX-License-Identifier: AGPL-3.0-or-later
"""Level estimator (roadmap v2): a posterior over a player's rating from the moves they chose.

    P(e | moves) is proportional to prior(e) * product over moves of p_maia(move | position, e)

`e` runs over a grid of ratings. For Maia-2 (GRID) these are the eleven buckets it distinguishes (<1100, nine 100-point
buckets, >=2000), each named by its midpoint: 1050 means "below 1100" and 2050 "2000 and above". A model with a continuous
rating input uses FINE_GRID. Probabilities are floored at
FLOOR so one move Maia thought nearly impossible cannot zero a hypothesis. Moves that every rating agrees on carry no
information, which falls out of the likelihood by itself. The result is a "Lichess-equivalent" rating (it learns from
Lichess games), never a FIDE rating. Pure functions, no model and no I/O: the caller supplies Maia's distributions.

An observation is {"move": uci, "probs": {bucket_midpoint: {uci: probability}}}.
"""

from __future__ import annotations

import math

GRID: tuple[int, ...] = tuple(range(1050, 2051, 100))        # Maia-2: its eleven rating buckets, by midpoint
FINE_GRID: tuple[int, ...] = tuple(range(1000, 2201, 100))   # a model with a continuous rating input (Maia-3)
FLOOR = 0.001


def bucket(elo: int) -> int:
    """Midpoint of the Maia-2 bucket a rating falls in (1050 = below 1100, 2050 = 2000 and above)."""
    return GRID[0] if elo < 1100 else GRID[-1] if elo >= 2000 else (elo // 100) * 100 + 50


def uniform_prior(grid: tuple[int, ...] = GRID) -> dict[int, float]:
    return {e: 1 / len(grid) for e in grid}


def posterior(observations: list[dict], prior: dict[int, float], grid: tuple[int, ...] = GRID) -> dict[int, float]:
    """Normalised posterior over `grid`. Works in log space, so thousands of moves cannot underflow."""
    logp = {e: math.log(prior[e]) if prior[e] > 0 else -math.inf for e in grid}
    for o in observations:
        for e in grid:
            logp[e] += math.log(max(FLOOR, o["probs"][e].get(o["move"], 0.0)))
    top = max(logp.values())
    weights = {e: math.exp(v - top) for e, v in logp.items()}
    total = sum(weights.values())
    return {e: w / total for e, w in weights.items()}


def credible_interval(post: dict[int, float], mass: float = 0.8, grid: tuple[int, ...] = GRID) -> tuple[int, int]:
    """Narrowest run of adjacent grid points holding at least `mass` of the posterior (ties: the heavier run)."""
    best: tuple[int, float, int, int] | None = None  # (width, -mass, lo index, hi index)
    for i in range(len(grid)):
        acc = 0.0
        for j in range(i, len(grid)):
            acc += post[grid[j]]
            if acc >= mass - 1e-9:
                cand = (j - i, -acc, i, j)
                if best is None or cand < best:
                    best = cand
                break
    assert best is not None, "the posterior does not hold the requested mass"
    return grid[best[2]], grid[best[3]]
