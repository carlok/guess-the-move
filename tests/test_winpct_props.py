"""Property tests for the scoring maths (hypothesis): invariants that must hold for every input."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from pipeline.winpct import accuracy_from_drop, cost, distance, similarity, win_pct

cps = st.integers(-30_000, 30_000)  # engine scores incl. mate-sized values
drops = st.floats(-50, 150, allow_nan=False)
MOVES = ["e2e4", "d2d4", "g1f3", "c2c4", "a2a3", "h2h3"]
evals = st.dictionaries(st.sampled_from(MOVES), st.integers(-12_000, 12_000), min_size=2)


@given(cps)
def test_win_pct_stays_between_0_and_100(cp):
    assert 0 <= win_pct(cp) <= 100


@given(cps, cps)
def test_win_pct_never_decreases_as_the_evaluation_improves(a, b):
    lo, hi = sorted((a, b))
    assert win_pct(lo) <= win_pct(hi)


@given(cps)
def test_win_pct_is_symmetric_around_50(cp):
    assert win_pct(cp) + win_pct(-cp) == pytest.approx(100)


@given(drops)
def test_accuracy_stays_between_0_and_100(d):
    assert 0 <= accuracy_from_drop(d) <= 100


@given(drops, drops)
def test_accuracy_never_increases_as_the_drop_grows(a, b):
    lo, hi = sorted((a, b))
    assert accuracy_from_drop(lo) >= accuracy_from_drop(hi)


@given(evals, st.data())
def test_cost_is_never_negative_and_zero_for_the_best_move(e, data):
    move = data.draw(st.sampled_from(sorted(e)))
    assert cost(e, move) >= 0
    assert cost(e, max(e, key=e.get)) == 0


@given(evals, st.data())
def test_distance_is_symmetric_and_similarity_is_bounded(e, data):
    a, b = data.draw(st.sampled_from(sorted(e))), data.draw(st.sampled_from(sorted(e)))
    assert distance(e, a, b) == distance(e, b, a)
    assert 0 <= similarity(e, a, b) <= 100
    assert similarity(e, a, a) >= 99.99


@given(evals, st.data())
def test_a_closer_move_is_never_less_similar(e, data):
    a, b, c = (data.draw(st.sampled_from(sorted(e))) for _ in range(3))
    if distance(e, a, b) <= distance(e, a, c):
        assert similarity(e, a, b) >= similarity(e, a, c)
