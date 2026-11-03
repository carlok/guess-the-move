import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from pipeline.estimator import FINE_GRID, FLOOR, GRID, bucket, credible_interval, posterior, uniform_prior

MOVES = ["e2e4", "d2d4", "g1f3"]


def obs(move, by_grid):
    """One observed move: `by_grid[elo]` is Maia's distribution at that Elo bucket."""
    return {"move": move, "probs": {e: dict(zip(MOVES, p)) for e, p in by_grid.items()}}


def flat(p):
    return {e: p for e in GRID}


def test_grid_is_the_eleven_maia2_buckets_and_the_prior_is_a_distribution():
    assert GRID == (1050, 1150, 1250, 1350, 1450, 1550, 1650, 1750, 1850, 1950, 2050)
    prior = uniform_prior()
    assert set(prior) == set(GRID) and math.isclose(sum(prior.values()), 1.0)


def test_moves_that_every_elo_agrees_on_carry_no_information():
    post = posterior([obs("e2e4", flat([0.5, 0.3, 0.2]))] * 5, uniform_prior())
    assert all(math.isclose(p, 1 / len(GRID)) for p in post.values())


def test_a_move_that_only_strong_players_find_moves_the_posterior_up():
    strong = {e: [0.05 + 0.9 * (i / 10), 0.5, 0.45 - 0.9 * (i / 10)] for i, e in enumerate(GRID)}  # p(e2e4) rises with Elo
    strong = {e: [max(0.01, v) for v in vs] for e, vs in strong.items()}
    post = posterior([obs("e2e4", strong)] * 6, uniform_prior())
    assert post[GRID[-1]] > post[GRID[0]] * 50
    assert max(post, key=post.get) == GRID[-1]


def test_one_miss_cannot_zero_a_hypothesis():
    by = {e: ([0.0, 0.6, 0.4] if e == GRID[0] else [0.5, 0.3, 0.2]) for e in GRID}
    post = posterior([obs("e2e4", by)], uniform_prior())
    assert post[GRID[0]] > 0
    assert math.isclose(post[GRID[0]] / post[GRID[1]], FLOOR / 0.5)


def test_posterior_sums_to_one_and_respects_the_prior():
    prior = {e: (4.0 if e == 1450 else 1.0) for e in GRID}
    total = sum(prior.values())
    prior = {e: v / total for e, v in prior.items()}
    post = posterior([obs("d2d4", flat([0.5, 0.3, 0.2]))], prior)
    assert math.isclose(sum(post.values()), 1.0) and max(post, key=post.get) == 1450


def test_no_observations_returns_the_prior():
    assert posterior([], uniform_prior()) == uniform_prior()


def test_a_long_history_does_not_underflow():
    by = flat([0.001, 0.001, 0.998])
    post = posterior([obs("e2e4", by)] * 5000, uniform_prior())
    assert math.isclose(sum(post.values()), 1.0) and all(math.isfinite(p) for p in post.values())


def test_credible_interval_covers_the_requested_mass_around_the_bulk():
    post = {e: 0.0 for e in GRID}
    post[1450] = 0.2; post[1550] = 0.5; post[1650] = 0.2; post[1250] = 0.05; post[1850] = 0.05
    lo, hi = credible_interval(post, 0.8)
    assert lo <= 1550 <= hi and (lo, hi) == (1450, 1650)
    assert credible_interval({e: 1 / len(GRID) for e in GRID}, 1.0) == (GRID[0], GRID[-1])
    assert credible_interval({**{e: 0.0 for e in GRID}, 1850: 1.0}, 0.8) == (1850, 1850)


@given(st.lists(st.sampled_from(MOVES), min_size=0, max_size=12))
def test_posterior_is_always_a_distribution(moves):
    rising = {e: [0.2 + 0.05 * i, 0.5 - 0.02 * i, 0.3 - 0.03 * i] for i, e in enumerate(GRID)}
    post = posterior([obs(m, rising) for m in moves], uniform_prior())
    assert math.isclose(sum(post.values()), 1.0) and all(p >= 0 for p in post.values())


def test_a_move_outside_the_distribution_gets_the_floor():
    by = flat([0.5, 0.3, 0.2])
    o = {"move": "h2h3", "probs": {e: dict(zip(MOVES, p)) for e, p in by.items()}}
    post = posterior([o], uniform_prior())
    assert all(math.isclose(p, 1 / len(GRID)) for p in post.values())
    with pytest.raises(KeyError):
        posterior([{"move": "e2e4", "probs": {1050: {"e2e4": 1.0}}}], uniform_prior())


def test_ratings_map_to_the_maia_bucket_midpoints():
    assert [bucket(e) for e in (800, 1099, 1100, 1199, 1200, 1999, 2000, 2800)] == [1050, 1050, 1150, 1150, 1250, 1950, 2050, 2050]
    assert all(bucket(e) in GRID for e in range(600, 3000, 7))


def test_asking_for_more_mass_than_the_posterior_holds_is_an_error():
    with pytest.raises(AssertionError):
        credible_interval(uniform_prior(), 1.5)


def test_a_finer_grid_works_everywhere_a_grid_is_taken():
    assert FINE_GRID == tuple(range(1000, 2201, 100)) and len(FINE_GRID) == 13
    prior = uniform_prior(FINE_GRID)
    assert math.isclose(sum(prior.values()), 1.0) and set(prior) == set(FINE_GRID)
    rising = {e: [0.1 + 0.07 * i, 0.5, 0.4 - 0.07 * i] for i, e in enumerate(FINE_GRID)}
    o = {"move": "e2e4", "probs": {e: dict(zip(MOVES, p)) for e, p in rising.items()}}
    post = posterior([o] * 8, prior, FINE_GRID)
    assert set(post) == set(FINE_GRID) and max(post, key=post.get) == FINE_GRID[-1]
    lo, hi = credible_interval(post, 0.8, FINE_GRID)
    assert FINE_GRID[0] <= lo <= hi == FINE_GRID[-1]
