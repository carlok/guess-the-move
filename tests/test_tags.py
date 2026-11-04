# SPDX-License-Identifier: AGPL-3.0-or-later
import chess

from pipeline.tags import TagConfig, phase_of, tag_position
from pipeline.winpct import cost

# win% reference points: 0cp=50, -300cp~=24.9 (drop ~25), -100cp~=40.9 (drop ~9)
EVALS = {"best": 0, "ok": -30, "bad": -100, "blunder": -300, "awful": -900}


def test_phase_detection():
    assert phase_of(chess.Board()) == "opening"
    mid = chess.Board("r2q1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 14")
    assert phase_of(mid) == "middlegame"
    rook_ending = chess.Board("8/5pk1/6p1/8/8/6P1/5PK1/3R2r1 w - - 0 40")
    assert phase_of(rook_ending) == "endgame"


def test_real_move_cost_tags():
    assert "real_blunder" in tag_position(EVALS, "blunder", None)
    assert "real_mistake" not in tag_position(EVALS, "blunder", None)
    cfg = TagConfig(mistake_drop=8.0)
    assert "real_mistake" in tag_position(EVALS, "bad", None, cfg)
    assert "real_is_best" in tag_position(EVALS, "best", None)
    assert not {"real_mistake", "real_blunder"} & set(tag_position(EVALS, "ok", None))


def test_only_move():
    one_good = {"a": 0, "b": -500, "c": -600}
    many_good = {"a": 0, "b": -10, "c": -20}
    assert "only_move" in tag_position(one_good, "a", None)
    assert "only_move" not in tag_position(many_good, "a", None)


def test_maia_dependent_tags_need_probs():
    assert not {"maia_miss", "maia_error", "hard_find", "trivial"} & set(tag_position(EVALS, "best", None))
    assert not {"maia_miss", "maia_error", "hard_find", "trivial"} & set(tag_position(EVALS, "best", {}))


def test_trivial_and_hard_find_and_miss_and_error():
    trivial = tag_position(EVALS, "best", {"best": 0.8, "ok": 0.2})
    assert "trivial" in trivial and "hard_find" not in trivial

    hard = tag_position(EVALS, "best", {"ok": 0.7, "best": 0.1, "bad": 0.2})
    assert "hard_find" in hard and "trivial" not in hard
    assert "maia_miss" not in hard  # 10% >= 5% threshold

    miss = tag_position(EVALS, "ok", {"best": 0.9, "bad": 0.09, "ok": 0.01})
    assert "maia_miss" in miss

    err = tag_position(EVALS, "best", {"blunder": 0.6, "best": 0.4})
    assert "maia_error" in err


# --- added after a mutation run (mutmut) showed these behaviours were not pinned down -------------------


def test_phase_boundaries_are_inclusive():
    # 24 pawns' worth of non-pawn material (Q+R vs R+R), kings and pawns do not count: still an endgame
    assert phase_of(chess.Board("r3r1k1/5ppp/8/8/8/8/5PPP/Q2R2K1 w - - 0 30")) == "endgame"
    assert phase_of(chess.Board("r3r1k1/5ppp/8/8/8/8/5PPP/Q2R2KN w - - 0 30")) == "middlegame"  # 27
    board = chess.Board()
    board.fullmove_number = 12
    assert phase_of(board) == "opening"
    board.fullmove_number = 13
    assert phase_of(board) == "middlegame"


def test_cost_tags_apply_exactly_at_their_thresholds():
    evals = {"a": 0, "b": -300}
    drop = cost(evals, "b")
    assert "real_blunder" in tag_position(evals, "b", None, TagConfig(blunder_drop=drop))
    assert "real_mistake" in tag_position(evals, "b", None, TagConfig(blunder_drop=drop + 1, mistake_drop=drop))
    assert "real_mistake" not in tag_position(evals, "b", None, TagConfig(blunder_drop=drop + 1, mistake_drop=drop + 0.01))


def test_only_move_looks_at_the_runner_up_and_survives_forced_moves():
    gap = cost({"a": 0, "b": -500}, "b")
    assert "only_move" in tag_position({"a": 0, "b": -500}, "a", None), "two legal moves are enough"
    assert "only_move" in tag_position({"a": 0, "b": -500}, "a", None, TagConfig(only_move_gap=gap))
    assert tag_position({"a": 0}, "a", None) == ["real_is_best"], "a forced move cannot be an only-move"
    assert "only_move" not in tag_position({"a": 0, "b": -10, "c": -900}, "a", None), "the third move is irrelevant"


def test_a_real_move_missing_from_maia_is_a_miss_and_the_threshold_is_exclusive():
    # the pipeline drops probabilities below 0.001, so "absent" must mean "(almost) never played"
    assert "maia_miss" in tag_position(EVALS, "ok", {"best": 0.9})
    assert "maia_miss" not in tag_position(EVALS, "ok", {"best": 0.9, "ok": 0.05})


def test_a_best_move_missing_from_maia_is_a_hard_find_and_the_threshold_is_exclusive():
    assert "hard_find" in tag_position(EVALS, "best", {"ok": 0.9})
    assert "hard_find" not in tag_position(EVALS, "best", {"ok": 0.85, "best": 0.15})


def test_maia_error_is_inclusive_and_ignores_a_top_move_that_is_not_in_the_evals():
    drop = cost(EVALS, "blunder")
    assert "maia_error" in tag_position(EVALS, "best", {"blunder": 0.6, "best": 0.4}, TagConfig(maia_diverge_drop=drop))
    assert "maia_error" not in tag_position(EVALS, "best", {"zzzz": 0.9, "best": 0.1})


def test_trivial_needs_the_real_move_to_be_best_and_maias_top_move():
    assert "trivial" not in tag_position(EVALS, "ok", {"ok": 0.9, "best": 0.1}), "Maia agrees with a non-best move"
    assert "trivial" not in tag_position(EVALS, "best", {"ok": 0.6, "best": 0.4})
