"""Game phase and "kind of position" tags.

All thresholds live in TagConfig so they are recorded in the dataset meta and
can be tuned without touching code. Drops are in win%-points (see winpct.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import chess

from .winpct import cost

PIECE_VALUES = {chess.QUEEN: 9, chess.ROOK: 5, chess.BISHOP: 3, chess.KNIGHT: 3}

ALL_TAGS = (
    "real_mistake",
    "real_blunder",
    "real_is_best",
    "only_move",
    "maia_miss",
    "maia_error",
    "hard_find",
    "trivial",
)


@dataclass(frozen=True)
class TagConfig:
    mistake_drop: float = 10.0
    blunder_drop: float = 20.0
    only_move_gap: float = 15.0
    maia_miss_prob: float = 0.05
    maia_diverge_drop: float = 10.0
    hard_find_prob: float = 0.15
    opening_max_fullmove: int = 12
    endgame_max_material: int = 24  # combined non-pawn material of both sides, in pawns


def non_pawn_material(board: chess.Board) -> int:
    return sum(
        PIECE_VALUES.get(p.piece_type, 0) for p in board.piece_map().values()
    )


def phase_of(board: chess.Board, cfg: TagConfig = TagConfig()) -> str:
    if non_pawn_material(board) <= cfg.endgame_max_material:
        return "endgame"
    if board.fullmove_number <= cfg.opening_max_fullmove:
        return "opening"
    return "middlegame"


def tag_position(
    evals: dict[str, int],
    real: str,
    maia_probs: dict[str, float] | None,
    cfg: TagConfig = TagConfig(),
) -> list[str]:
    """Return the tags that apply. Maia-dependent tags need `maia_probs` to be non-empty."""
    ordered = sorted(evals, key=lambda m: evals[m], reverse=True)
    best = ordered[0]
    tags: list[str] = []

    real_cost = cost(evals, real)
    if real_cost >= cfg.blunder_drop:
        tags.append("real_blunder")
    elif real_cost >= cfg.mistake_drop:
        tags.append("real_mistake")

    real_is_best = evals[real] == evals[best]
    if real_is_best:
        tags.append("real_is_best")

    if len(ordered) > 1 and cost(evals, ordered[1]) >= cfg.only_move_gap:
        tags.append("only_move")

    if maia_probs:
        maia_top = max(maia_probs, key=lambda m: maia_probs[m])
        if maia_probs.get(real, 0.0) < cfg.maia_miss_prob:
            tags.append("maia_miss")
        if maia_top in evals and cost(evals, maia_top) >= cfg.maia_diverge_drop:
            tags.append("maia_error")
        if real_is_best and maia_probs.get(best, 0.0) < cfg.hard_find_prob:
            tags.append("hard_find")
        if real_is_best and evals[maia_top] == evals[best] and maia_top == real:
            tags.append("trivial")

    return tags
