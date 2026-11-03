import json
import pathlib

import pytest

from pipeline.winpct import accuracy_from_drop, cost, distance, similarity, win_pct

V = json.loads((pathlib.Path(__file__).parent / "vectors.json").read_text())


@pytest.mark.parametrize("cp,expected", V["win_pct"])
def test_win_pct_matches_shared_vectors(cp, expected):
    assert win_pct(cp) == pytest.approx(expected, abs=1e-9)


@pytest.mark.parametrize("drop,expected", V["accuracy"])
def test_accuracy_matches_shared_vectors(drop, expected):
    assert accuracy_from_drop(drop) == pytest.approx(expected, abs=1e-9)


def test_cost_and_pairs_match_shared_vectors():
    evals = V["evals"]
    for move, expected in V["cost"].items():
        assert cost(evals, move) == pytest.approx(expected, abs=1e-9)
    for case in V["pairs"]:
        assert distance(evals, case["a"], case["b"]) == pytest.approx(case["distance"], abs=1e-9)
        assert similarity(evals, case["a"], case["b"]) == pytest.approx(case["similarity"], abs=1e-9)


def test_independent_anchors_from_published_sources():
    # Lichess forum: a 10-point win% drop ~ 64% move accuracy, a 20-point drop ~ 40%.
    assert accuracy_from_drop(10) == pytest.approx(64, abs=0.5)
    assert accuracy_from_drop(20) == pytest.approx(40, abs=0.5)
    # Lichess blog example: winProb(+20cp) ~ 0.518 and winProb(-40cp) ~ 0.463.
    assert win_pct(20) == pytest.approx(51.8, abs=0.1)
    assert win_pct(-40) == pytest.approx(46.3, abs=0.1)


def test_symmetry_clamp_and_bounds():
    assert win_pct(0) == pytest.approx(50)
    assert win_pct(250) + win_pct(-250) == pytest.approx(100)
    assert win_pct(5000) == win_pct(1000) == pytest.approx(97.55, abs=0.05)
    assert accuracy_from_drop(0) == pytest.approx(100, abs=1e-3)
    assert accuracy_from_drop(-10) == accuracy_from_drop(0)
    assert accuracy_from_drop(100) >= 0


def test_best_move_has_zero_cost_and_full_similarity_with_itself():
    evals = {"a": 50, "b": -20}
    assert cost(evals, "a") == 0
    assert cost(evals, "b") > 0
    assert similarity(evals, "b", "b") == pytest.approx(100, abs=1e-3)
