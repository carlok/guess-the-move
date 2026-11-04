# SPDX-License-Identifier: AGPL-3.0-or-later
"""Win-probability and move-quality maths.

Formulas are the published Lichess ones (https://lichess.org/page/accuracy):

    Win%      = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
    Accuracy% = 103.1668 * exp(-0.04354 * (winBefore - winAfter)) - 3.1669

The cp clamp (+-1000) and the mate mapping (MATE_CP) are this project's own
choices. web/scoring.js must stay numerically identical; tests/vectors.json
is checked by both test suites.
"""

from __future__ import annotations

import math

MATE_CP = 10_000  # mate is mapped to +-(MATE_CP - distance) by the engine backend
CP_CLAMP = 1_000  # centipawns are clamped to +-CP_CLAMP before the win% curve


def win_pct(cp: float) -> float:
    """Expected score in percent (0..100) for a centipawn value from one side's POV."""
    cp = max(-CP_CLAMP, min(CP_CLAMP, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def accuracy_from_drop(drop: float) -> float:
    """Lichess per-move accuracy (0..100) from a win% drop; negative drops count as 0."""
    drop = max(0.0, drop)
    acc = 103.1668 * math.exp(-0.04354 * drop) - 3.1669
    return max(0.0, min(100.0, acc))


def cost(evals: dict[str, int], move: str) -> float:
    """Win% points lost by `move` relative to the best legal move (>= 0)."""
    return win_pct(max(evals.values())) - win_pct(evals[move])


def distance(evals: dict[str, int], a: str, b: str) -> float:
    """Absolute win% gap between two moves in the same position."""
    return abs(win_pct(evals[a]) - win_pct(evals[b]))


def similarity(evals: dict[str, int], a: str, b: str) -> float:
    """Normalized 0..100 closeness of two moves (100 = same evaluation)."""
    return accuracy_from_drop(distance(evals, a, b))
