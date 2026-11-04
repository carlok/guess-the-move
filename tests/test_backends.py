# SPDX-License-Identifier: AGPL-3.0-or-later
"""Engine and human-model backends, exercised without Stockfish or torch.

The UCI stub (tests/fixtures/uci_stub.py) stands in for a real engine; a fake `maia2` module stands in for
the model. What a real engine or real Maia weights add is checked separately (GTM_ENGINE, CONTINUE.md T3).
"""

import math
import sys
import types
from fractions import Fraction
from pathlib import Path

import chess
import pytest

from pipeline.backends import Maia2Backend, Maia3Backend, NullMaia, StockfishBackend
from pipeline.estimator import FINE_GRID

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


# --- Maia-3 through fake `maia3` modules: the vocabulary mapping, Black's mirror, history and ratings -------------------------


def mirror(uci):
    return uci[0] + str(9 - int(uci[1])) + uci[2] + str(9 - int(uci[3])) + uci[4:]


@pytest.fixture
def fake_maia3(monkeypatch):
    """A stand-in for the maia3 package. Tokens are just the FEN strings, the vocabulary is White's view of a few moves,
    and the 'model' prefers the first legal move of the (possibly mirrored) board with a probability set by the rating."""
    seen = {"parse": None, "tokenised": [], "window": None, "forward": None}
    vocab = ["e2e4", "d2d4", "g1f3", "b1c3", "a7a8q"]

    cfg = types.SimpleNamespace(history=8, model_spec="SPEC")

    def parse_args(argv):
        seen["parse"] = argv
        return cfg

    def tokenize(board):
        seen["tokenised"].append(board.fen())
        return board.fen()

    def window(deq, cfg_, *zeros):
        seen["window"] = list(deq)
        return types.SimpleNamespace(unsqueeze=lambda d: None)

    def mask(board, index):
        views = [mv.uci() if board.turn == chess.WHITE else mirror(mv.uci()) for mv in board.legal_moves]
        return {index[v] for v in views if v in index}

    modules = {
        "maia3": types.ModuleType("maia3"),
        "maia3.dataset": types.SimpleNamespace(tokenize_board=tokenize, get_historical_tokens=window, get_legal_moves_mask=mask),
        "maia3.model_registry": types.SimpleNamespace(resolve_checkpoint_path=lambda spec, **kw: seen.update(resolve=(spec, kw)) or seen.get("checkpoint", "/ckpt.pt")),
        "maia3.uci": types.SimpleNamespace(parse_args=parse_args, load_model=lambda c: seen.update(loaded=c.checkpoint_path) or "MODEL"),
        "maia3.utils": types.SimpleNamespace(get_all_possible_moves=lambda: vocab, mirror_move=mirror),
    }
    for name, mod in modules.items():
        monkeypatch.setitem(sys.modules, name, mod)

    def forward(self, tokens, elo_self, elo_oppo, legal):
        seen["forward"] = (elo_self, elo_oppo, sorted(legal))
        strength = elo_self / 3000
        ordered = sorted(legal)
        first, rest = 0.3 + 0.5 * strength, None
        rest = (1 - first) / (len(ordered) - 1)
        return {i: (first if k == 0 else rest) for k, i in enumerate(ordered)}

    monkeypatch.setattr(Maia3Backend, "_forward", forward)
    return seen


def test_maia3_backend_loads_the_named_model_on_the_requested_device(fake_maia3):
    m = Maia3Backend(model="maia3-23m", device="cpu", cache_dir="/hf")
    assert m.name == "maia3-23m" and fake_maia3["parse"] == ["--model", "maia3-23m", "--device", "cpu", "--no-use-amp"]
    assert fake_maia3["resolve"][0] == "SPEC" and fake_maia3["resolve"][1]["cache_dir"] == "/hf"
    assert fake_maia3["loaded"] == "/ckpt.pt"
    assert Maia3Backend.uses_history is True and Maia3Backend.grid == FINE_GRID


def test_maia3_backend_returns_probabilities_over_the_legal_moves_with_the_rating_passed_through(fake_maia3):
    m = Maia3Backend()
    board = chess.Board()
    legal_in_vocab = {mv.uci() for mv in board.legal_moves} & {"e2e4", "d2d4", "g1f3", "b1c3"}
    probs = m.probs(chess.STARTING_FEN, 1850, 1200)
    assert set(probs) == legal_in_vocab == {"e2e4", "d2d4", "g1f3", "b1c3"}
    assert math.isclose(sum(probs.values()), 1.0) and fake_maia3["forward"][:2] == (1850, 1200)


def test_maia3_backend_mirrors_blacks_moves_back_to_the_real_board(fake_maia3):
    m = Maia3Backend()
    black = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    probs = m.probs(black, 1500, 1500)
    assert set(probs) == {mirror(x) for x in ("e2e4", "d2d4", "g1f3", "b1c3")} == {"e7e5", "d7d5", "g8f6", "b8c6"}


def test_maia3_backend_feeds_the_model_the_earlier_positions_oldest_first_capped_at_the_window(fake_maia3):
    m = Maia3Backend()
    board, fens = chess.Board(), []
    for san in "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O".split():  # nine earlier positions, oldest first
        fens.append(board.fen())
        board.push_san(san)
    earlier = tuple(fens)
    m.probs(chess.STARTING_FEN, 1500, 1500, history=earlier)
    window = fake_maia3["window"]
    assert len(window) == 8, "the model's window is eight positions: the current one and seven before it"
    assert window[-1] == chess.STARTING_FEN and window[0] == earlier[-7] and window[-2] == earlier[-1]
    m.probs(chess.STARTING_FEN, 1500, 1500)
    assert fake_maia3["window"] == [chess.STARTING_FEN], "no history: just the current position (the model pads it itself)"


def test_backends_describe_themselves_for_the_dataset_provenance(backend, fake_maia2, fake_maia3, tmp_path, monkeypatch):
    info = backend(nodes=1234).info()
    assert info == {"name": "StubFish 1.0", "author": None, "nodes": 1234, "hash_mb": 64, "threads": 1,
                    "multipv": "every legal move", "analysis": "fixed node budget, side-to-move point of view, mate = +-(10000 - distance)"}
    assert NullMaia().info() is None

    import importlib.metadata as md

    monkeypatch.setattr(md, "version", lambda name: {"maia2": "0.11.0", "maia3": "0.1.0"}[name])
    weights = tmp_path / "rapid_model.pt"
    weights.write_bytes(b"weights")
    m2 = Maia2Backend(kind="rapid", save_root=str(tmp_path)).info()
    assert m2["family"] == "maia2" and m2["model"] == "maia2-rapid" and m2["package_version"] == "0.11.0"
    assert m2["weights_file"] == "rapid_model.pt" and len(m2["weights_sha256"]) == 64 and "1100" in m2["rating_input"]
    assert Maia2Backend(kind="blitz", save_root=str(tmp_path)).info()["weights_sha256"] is None, "no file, no hash"

    ckpt = tmp_path / "maia3-23m.pt"
    ckpt.write_bytes(b"checkpoint")
    fake_maia3["checkpoint"] = str(ckpt)
    m3 = Maia3Backend(model="maia3-23m").info()
    assert m3["family"] == "maia3" and m3["model"] == "maia3-23m" and m3["package_version"] == "0.1.0"
    assert m3["checkpoint"] == "maia3-23m.pt" and len(m3["checkpoint_sha256"]) == 64
    assert m3["history_plies"] == 8 and m3["package_commit"] in (ROOT_REQ := (Path(__file__).parent.parent / "requirements-maia3.txt").read_text())
    assert "continuous" in m3["rating_input"]
