"""Engine and human-model backends, exercised without Stockfish or torch.

The UCI stub (tests/fixtures/uci_stub.py) stands in for a real engine; a fake `maia2` module stands in for
the model. What a real engine or real Maia weights add is checked separately (GTM_ENGINE, CONTINUE.md T3).
"""

import sys
import types
from fractions import Fraction
from pathlib import Path

import chess
import pytest

from pipeline.backends import Maia2Backend, NullMaia, StockfishBackend

STUB = [sys.executable, str(Path(__file__).parent / "fixtures" / "uci_stub.py")]
FEN = "rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"  # White to move: Nxh4 wins the queen
BACK_RANK = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"  # Ra8# is mate in one


@pytest.fixture
def backend():
    made = []

    def make(nodes=1000):
        b = StockfishBackend(STUB, nodes=nodes)
        made.append(b)
        return b

    yield make
    for b in made:
        b.close()


def test_stockfish_backend_scores_every_legal_move_from_the_movers_point_of_view(backend):
    eng = backend()
    board = chess.Board(FEN)
    evals = eng.analyse_all(board)
    assert eng.name == "StubFish 1.0"
    assert set(evals) == {m.uci() for m in board.legal_moves}
    assert evals["f3h4"] == 900, "winning the queen is +9 for the side to move"
    assert evals["f3e5"] == 100 and evals["a2a3"] == 0
    assert max(evals, key=evals.get) == "f3h4"


def test_mate_is_encoded_as_a_near_mate_score(backend):
    evals = backend().analyse_all(chess.Board(BACK_RANK))
    assert evals["a1a8"] == 9999  # mate in 1 -> MATE_CP - 1
    assert all(v < 9000 for m, v in evals.items() if m != "a1a8")


def test_moves_missing_from_multipv_are_searched_one_by_one(backend, monkeypatch):
    board = chess.Board(FEN)
    full = backend().analyse_all(board)

    monkeypatch.setenv("STUB_MAX_PV", "3")  # an engine that refuses to report more than 3 lines
    eng = backend()
    calls = []
    real = eng._engine.analyse
    monkeypatch.setattr(eng._engine, "analyse", lambda *a, **k: (calls.append(k), real(*a, **k))[1])
    evals = eng.analyse_all(board)

    assert evals == full, "the fallback fills in exactly the moves MultiPV left out"
    fallback = [k for k in calls if "root_moves" in k]
    assert len(calls) == 1 + len(full) - 3 and len(fallback) == len(full) - 3
    assert all(len(k["root_moves"]) == 1 for k in fallback)


def test_an_info_line_without_a_pv_is_not_trusted_and_the_move_is_searched_alone(backend, monkeypatch):
    board = chess.Board(FEN)
    full = backend().analyse_all(board)

    monkeypatch.setenv("STUB_NO_PV", "2")
    eng = backend()
    calls = []
    real = eng._engine.analyse
    monkeypatch.setattr(eng._engine, "analyse", lambda *a, **k: (calls.append(k), real(*a, **k))[1])
    assert eng.analyse_all(board) == full
    assert len(calls) == 2 and "root_moves" in calls[1]


def test_null_maia_has_no_name_and_no_probabilities():
    assert NullMaia.name is None
    assert NullMaia().probs(FEN, 1500, 1500) == {}


@pytest.fixture
def fake_maia2(monkeypatch):
    seen = {}

    def from_pretrained(type, device, save_root="./maia2_models"):
        seen["load"] = (type, device, save_root)
        return "MODEL"

    def inference_each(model, prepared, fen, elo_self, elo_oppo):
        seen["each"] = (model, prepared, fen, elo_self, elo_oppo)
        return {"f3h4": Fraction(1, 2), "a2a3": Fraction(1, 4)}, 0.5

    pkg = types.ModuleType("maia2")
    pkg.model = types.SimpleNamespace(from_pretrained=from_pretrained)
    pkg.inference = types.SimpleNamespace(prepare=lambda: "PREPARED", inference_each=inference_each)
    monkeypatch.setitem(sys.modules, "maia2", pkg)
    return seen


def test_maia2_backend_passes_the_real_elo_self_before_opponent_and_floats_the_probabilities(fake_maia2):
    # maia2 itself maps any rating to one of its buckets (<1100, 1100-1199 ... 1900-1999, >=2000): no clamp is needed
    m = Maia2Backend(kind="blitz", device="cpu")
    assert m.name == "maia2-blitz" and fake_maia2["load"] == ("blitz", "cpu", "./maia2_models")
    probs = m.probs(FEN, 900, 2500)
    assert fake_maia2["each"] == ("MODEL", "PREPARED", FEN, 900, 2500)
    assert probs == {"f3h4": 0.5, "a2a3": 0.25}
    assert all(type(p) is float for p in probs.values())


def test_maia2_backend_keeps_its_weights_where_it_is_told(fake_maia2, tmp_path):
    Maia2Backend(save_root=str(tmp_path / "models"))
    assert fake_maia2["load"][2] == str(tmp_path / "models")


def test_maia2_backend_can_still_clamp_when_asked(fake_maia2):
    m = Maia2Backend(elo_range=(1000, 1500))
    m.probs(FEN, 1700, 1200)
    assert fake_maia2["each"][3:] == (1500, 1200)
    assert m.name == "maia2-rapid"
