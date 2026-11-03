"""Maia-3 with the real package and weights. Skipped unless `maia3` is installed (the Maia venv, see requirements-maia3.txt);
the first run downloads the weights from Hugging Face. Checks behaviour that no fake can: legal keys, mirrored Black moves,
a proper distribution, and that the rating input actually changes the answer."""

import chess
import pytest

pytest.importorskip("maia3")
pytest.importorskip("torch")

from pipeline.backends import Maia3Backend  # noqa: E402

WHITE = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
BLACK = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3"


@pytest.fixture(scope="module")
def maia():
    return Maia3Backend(model="maia3-23m", device="cpu")


@pytest.mark.parametrize("fen", [WHITE, BLACK])
def test_real_maia3_returns_a_distribution_over_exactly_the_legal_moves(maia, fen):
    p = maia.probs(fen, 1500, 1500)
    assert set(p) == {m.uci() for m in chess.Board(fen).legal_moves}
    assert sum(p.values()) == pytest.approx(1.0, abs=1e-4) and all(v >= 0 for v in p.values())


def test_real_maia3_prefers_sensible_moves_in_the_players_own_frame(maia):
    black = maia.probs(BLACK, 1500, 1500)
    assert max(black, key=black.get) in {"a7a6", "g8f6", "f8c5", "d7d6", "g8e7", "f8e7"}, "a Ruy Lopez reply for Black, not a mirrored one"


def test_real_maia3_depends_on_the_rating_and_on_the_history(maia):
    low, high = maia.probs(WHITE, 1000, 1000), maia.probs(WHITE, 2200, 2200)
    assert max(abs(low[m] - high[m]) for m in low) > 0.01
    with_history = maia.probs(WHITE, 1500, 1500, history=(chess.STARTING_FEN,))
    assert with_history != maia.probs(WHITE, 1500, 1500)
