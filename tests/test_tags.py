import chess

from pipeline.tags import TagConfig, phase_of, tag_position

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
