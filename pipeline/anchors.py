# SPDX-License-Identifier: AGPL-3.0-or-later
"""Maia's move probabilities at a few fixed rating anchors, stored per position (`maia.by_elo`).

The level estimator in the browser asks "how likely is this move for a player rated r?" for any r. Computing that
needs the model, so instead the dataset carries Maia's distribution at five anchors and the page interpolates between
them (log-linearly, in web/level.js). The opponent's rating is the real opponent's, as for `maia.probs`.
Only moves with probability >= MIN_P are kept: the page treats every other move as having the estimator's floor
probability, which keeps the file small (about 12 bytes per move).
"""

from __future__ import annotations

ANCHORS: tuple[int, ...] = (1000, 1300, 1600, 1900, 2200)
MIN_P = 0.003


def maia_probs(maia, fen: str, elo_self: int, elo_oppo: int, history: tuple[str, ...] = ()) -> dict[str, float]:
    """Maia's distribution over the legal moves, passing the game history only to models that read it."""
    if getattr(maia, "uses_history", False):
        return maia.probs(fen, elo_self, elo_oppo, history=history)
    return maia.probs(fen, elo_self, elo_oppo)


def by_elo(maia, fen: str, opp_elo: int, legal: set[str], history: tuple[str, ...] = (), anchors: tuple[int, ...] = ANCHORS) -> dict[str, dict[str, float]]:
    """{anchor rating (as text, JSON keys are text): {uci: probability >= MIN_P}}."""
    out: dict[str, dict[str, float]] = {}
    for a in anchors:
        raw = maia_probs(maia, fen, a, opp_elo, history)
        if not set(raw) <= legal:
            raise RuntimeError(f"maia backend returned moves that are not legal UCI for {fen}: {sorted(set(raw) - legal)[:3]}")
        out[str(a)] = {m: round(p, 4) for m, p in raw.items() if p >= MIN_P}
    return out


def describe(anchors: tuple[int, ...] = ANCHORS) -> dict:
    return {"ratings": list(anchors), "min_probability": MIN_P,
            "opponent_rating": "the real opponent's rating in the source game",
            "use": "web/level.js interpolates log-probabilities between anchors; unlisted moves get the estimator floor"}
