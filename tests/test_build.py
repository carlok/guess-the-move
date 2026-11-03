import json
import math
import os
import re
import shlex

import chess
import pytest

from pipeline.build_dataset import DEFAULT_ENGINE, build_positions, select, write_dataset
from pipeline.sampler import Candidate
from pipeline.tags import ALL_TAGS

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


class FakeEngine:
    """1-ply material evaluation: cheap, deterministic, no external process."""

    name = "fake-material"

    def analyse_all(self, board):
        out = {}
        for m in board.legal_moves:
            b = board.copy()
            b.push(m)
            score = sum(
                VALUES.get(p.piece_type, 0) * (1 if p.color == board.turn else -1)
                for p in b.piece_map().values()
            )
            out[m.uci()] = score * 100 + (10_000 if b.is_checkmate() else 0)
        return out


class FakeMaia:
    name = "fake-maia"

    def __init__(self):
        self.engine = FakeEngine()

    def probs(self, fen, elo_self, elo_oppo):
        board = chess.Board(fen)
        ev = self.engine.analyse_all(board)
        z = {m: math.exp(v / 100) for m, v in ev.items()}
        s = sum(z.values())
        return {m: v / s for m, v in z.items()}


def cand(fen=chess.STARTING_FEN, real="e2e4", ply=0, elo=1500):
    b = chess.Board(fen)
    return Candidate(fen=fen, real_uci=real, ply=ply, move_no=b.fullmove_number,
                     color="w" if b.turn else "b", player_elo=elo, opp_elo=elo, site=None)


# Black has just left a pawn hanging; White to move, plenty of choices.
FEN_A = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3"
FEN_B = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3"


def test_position_invariants_with_fake_backends():
    cands = [cand(FEN_A, "e4d5", 4), cand(FEN_B, "g8f6", 5)]
    positions = build_positions(cands, FakeEngine(), FakeMaia(), max_abs_cp=None, drop_trivial=False)
    assert len(positions) == 2
    ids = {p["id"] for p in positions}
    assert len(ids) == 2
    for p, c in zip(positions, cands):
        board = chess.Board(c.fen)
        legal = {m.uci() for m in board.legal_moves}
        assert set(p["evals"]) == legal and set(p["san"]) == legal
        assert p["real"] in legal and p["stm"] == c.color
        assert p["phase"] in {"opening", "middlegame", "endgame"}
        assert set(p["maia"]["probs"]) <= legal and p["maia"]["elo"] == 1500
        assert all(0.001 <= v <= 1 for v in p["maia"]["probs"].values())
        assert set(p["tags"]) <= set(ALL_TAGS)
        assert re.fullmatch(r"[0-9a-f]{10}", p["id"])
    json.dumps(positions)  # serialisable


def test_no_maia_means_null_block_and_no_maia_tags():
    from pipeline.backends import NullMaia

    (p,) = build_positions([cand(FEN_B, "g8f6", 5)], FakeEngine(), NullMaia(), max_abs_cp=None)
    assert p["maia"] is None
    assert not {"maia_miss", "maia_error", "hard_find", "trivial"} & set(p["tags"])


def test_missing_elo_skips_maia_but_keeps_position():
    c = cand(FEN_B, "g8f6", 5, elo=None)
    (p,) = build_positions([c], FakeEngine(), FakeMaia(), max_abs_cp=None, drop_trivial=False)
    assert p["maia"] is None and p["player_elo"] is None


def test_illegal_maia_moves_fail_loudly():
    class BadMaia:
        name = "bad"

        def probs(self, fen, a, b):
            return {"Nf3": 1.0}  # SAN instead of UCI

    with pytest.raises(RuntimeError, match="not legal UCI"):
        build_positions([cand(FEN_B, "g8f6", 5)], FakeEngine(), BadMaia(), max_abs_cp=None)


def test_decided_positions_and_trivial_are_filtered():
    decided = "6k1/8/8/8/8/8/Q7/QQ2K3 w - - 0 50"  # three queens up
    out = build_positions([cand(decided, "a2a8", 98)], FakeEngine(), FakeMaia(), max_abs_cp=500)
    assert out == []


def test_select_balances_phases_and_is_deterministic():
    pos = [{"id": f"o{i}", "phase": "opening"} for i in range(10)] + [{"id": f"e{i}", "phase": "endgame"} for i in range(2)]
    a = select(pos, 6, seed=1)
    assert sorted(p["phase"] for p in a).count("endgame") == 2
    assert a == select(pos, 6, seed=1)
    assert len(select(pos, 100)) == 12


def test_write_dataset_roundtrip(tmp_path):
    out = tmp_path / "d" / "positions.json"
    write_dataset(out, [{"id": "x", "phase": "opening"}], {"engine": "t"})
    data = json.loads(out.read_text())
    assert data["schema"] == 1 and data["meta"]["counts"] == {"opening": 1} and data["positions"][0]["id"] == "x"


@pytest.mark.skipif(not os.environ.get("GTM_ENGINE"), reason="set GTM_ENGINE to a UCI engine command to run")
def test_real_engine_integration():
    from pipeline.backends import StockfishBackend

    eng = StockfishBackend(shlex.split(os.environ["GTM_ENGINE"]), nodes=60_000)
    try:
        board = chess.Board(FEN_B)
        evals = eng.analyse_all(board)
        assert set(evals) == {m.uci() for m in board.legal_moves}
        best = max(evals, key=evals.get)
        assert best in {"g8f6", "a7a6", "g7g6", "g8e7", "f8c5", "f8e7", "d7d6"}  # sane Ruy Lopez replies
        assert evals["d8h4"] < -300  # hangs the queen's tempo / loses material
        mate = eng.analyse_all(chess.Board("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"))
        assert mate["a1a8"] > 9_000  # back-rank mate in one is encoded as a near-MATE_CP score
    finally:
        eng.close()
