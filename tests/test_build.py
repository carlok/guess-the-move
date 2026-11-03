import json
import os
import re
import shlex

import chess
import pytest

from fakes import FakeEngine, FakeMaia
from pipeline.build_dataset import DEFAULT_ENGINE, build_positions, select, write_dataset
from pipeline.sampler import Candidate
from pipeline.tags import ALL_TAGS


def cand(fen=chess.STARTING_FEN, real="e2e4", ply=0, elo=1500):
    b = chess.Board(fen)
    return Candidate(fen=fen, real_uci=real, ply=ply, move_no=b.fullmove_number,
                     color="w" if b.turn else "b", player_elo=elo, opp_elo=elo, site=None)


# Black has just left a pawn hanging; White to move, plenty of choices.
FEN_A = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3"
FEN_B = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3"
FEN_QUEEN_EN_PRISE = "rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"


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


def test_decided_positions_are_filtered():
    decided = "6k1/8/8/8/8/8/Q7/QQ2K3 w - - 0 50"  # three queens up
    out = build_positions([cand(decided, "a2a8", 98)], FakeEngine(), FakeMaia(), max_abs_cp=500)
    assert out == []


def test_trivial_positions_are_dropped_unless_kept():
    # White wins the queen with Nxh4: the real move is the unique best move and Maia's favourite, so nothing to learn.
    c = cand(FEN_QUEEN_EN_PRISE, "f3h4", 4)
    assert build_positions([c], FakeEngine(), FakeMaia(), max_abs_cp=None, drop_trivial=True) == []
    (p,) = build_positions([c], FakeEngine(), FakeMaia(), max_abs_cp=None, drop_trivial=False)
    assert "trivial" in p["tags"]


def test_progress_is_reported_per_candidate_and_at_the_end():
    seen = []
    build_positions([cand(FEN_A, "e4d5", 4), cand(FEN_B, "g8f6", 5)], FakeEngine(), FakeMaia(),
                    max_abs_cp=None, drop_trivial=False, progress=lambda i, n: seen.append((i, n)))
    assert seen == [(0, 2), (1, 2), (2, 2)]


def test_engine_that_skips_a_legal_move_fails_loudly():
    class Lazy(FakeEngine):
        def analyse_all(self, board):
            out = super().analyse_all(board)
            out.popitem()
            return out

    with pytest.raises(RuntimeError, match="do not cover the legal moves"):
        build_positions([cand(FEN_B, "g8f6", 5)], Lazy(), FakeMaia(), max_abs_cp=None)


def test_real_move_that_is_not_legal_fails_loudly():
    with pytest.raises(RuntimeError, match="not legal in"):
        build_positions([cand(FEN_B, "e2e4", 5)], FakeEngine(), FakeMaia(), max_abs_cp=None)


def test_select_balances_phases_and_is_deterministic():
    pos = [{"id": f"o{i}", "phase": "opening"} for i in range(10)] + [{"id": f"e{i}", "phase": "endgame"} for i in range(2)]
    a = select(pos, 6, seed=1)
    assert sorted(p["phase"] for p in a).count("endgame") == 2
    assert a == select(pos, 6, seed=1)
    assert len(select(pos, 100)) == 12


def test_select_never_keeps_the_same_position_and_move_twice():
    # Two games can reach the same position and play the same move; the id is a hash of exactly that.
    pos = [{"id": "a", "phase": "opening", "player_elo": 1500}, {"id": "a", "phase": "opening", "player_elo": 1700},
           {"id": "b", "phase": "endgame", "player_elo": 1500}]
    out = select(pos, 10, seed=3)
    assert sorted(p["id"] for p in out) == ["a", "b"]
    assert next(p for p in out if p["id"] == "a")["player_elo"] == 1500, "the first occurrence wins"


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


def test_select_balances_across_phase_and_rating_band_and_reports_short_strata():
    pos = ([{"id": f"a{i}", "phase": "opening", "player_elo": 1300} for i in range(20)]
           + [{"id": f"b{i}", "phase": "opening", "player_elo": 1900} for i in range(3)]
           + [{"id": f"c{i}", "phase": "endgame", "player_elo": 1300} for i in range(2)])
    out = select(pos, 9, seed=1)
    strata = [(p["phase"], p["player_elo"] // 200) for p in out]
    assert len(out) == 9
    assert strata.count(("opening", 9)) == 3 and strata.count(("endgame", 6)) == 2 and strata.count(("opening", 6)) == 4, \
        "the scarce strata are taken whole, the common one fills the rest"
    assert select(pos, 9, seed=1) == out


def test_parallel_engines_give_the_same_positions_in_the_same_order():
    cands = [cand(FEN_A, "e4d5", 4), cand(FEN_B, "g8f6", 5), cand(FEN_A, "e4d5", 6, elo=1700), cand(FEN_B, "g8f6", 7, elo=1300)]
    seq = build_positions(cands, FakeEngine(), FakeMaia(), max_abs_cp=None, drop_trivial=False)
    engines = [FakeEngine(), FakeEngine(), FakeEngine()]
    par = build_positions(cands, engines, FakeMaia(), max_abs_cp=None, drop_trivial=False)
    assert par == seq and len(par) == 4


def test_every_parallel_engine_is_used_and_errors_in_a_worker_surface():
    import threading

    class Counting(FakeEngine):
        def __init__(self):
            self.n, self.threads = 0, set()

        def analyse_all(self, board, nodes=None):
            self.n += 1
            self.threads.add(threading.get_ident())
            return super().analyse_all(board, nodes)

    cands = [cand(FEN_B, "g8f6", i) for i in range(12)]
    engines = [Counting(), Counting()]
    build_positions(cands, engines, FakeMaia(), max_abs_cp=None, drop_trivial=False)
    assert sum(e.n for e in engines) == 12 and all(e.n > 0 for e in engines)

    class Lazy(FakeEngine):
        def analyse_all(self, board, nodes=None):
            return {}

    with pytest.raises(RuntimeError, match="do not cover the legal moves"):
        build_positions(cands[:3], [Lazy(), Lazy()], FakeMaia(), max_abs_cp=None)
