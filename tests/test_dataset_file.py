"""Validates the dataset shipped in web/data against an independent legal-move generator."""
import json
import pathlib
import re

import chess
import pytest

PATH = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "positions.json"
pytestmark = pytest.mark.skipif(not PATH.exists(), reason="no dataset built yet")


@pytest.fixture(scope="module")
def data():
    return json.loads(PATH.read_text(encoding="utf-8"))


def test_schema_and_meta(data):
    assert data["schema"] == 1
    for key in ("engine", "nodes", "built", "source", "demo", "thresholds", "counts"):
        assert key in data["meta"], key
    assert sum(data["meta"]["counts"].values()) == len(data["positions"]) > 0


def test_every_position_is_complete_and_consistent(data):
    ids = set()
    for p in data["positions"]:
        board = chess.Board(p["fen"])
        legal = {m.uci() for m in board.legal_moves}
        assert set(p["evals"]) == legal == set(p["san"]), p["id"]
        assert p["real"] in legal
        assert p["stm"] == ("w" if board.turn else "b")
        assert re.fullmatch(r"[0-9a-f]{10}", p["id"]) and p["id"] not in ids
        ids.add(p["id"])
        assert p["phase"] in {"opening", "middlegame", "endgame"}
        for m in board.legal_moves:  # SAN strings agree with python-chess
            assert p["san"][m.uci()] == board.san(m)
        if p["maia"] is not None:
            assert set(p["maia"]["probs"]) <= legal
            assert p["player_elo"] == p["maia"]["elo"]
        if p["player_elo"] is None:
            assert p["maia"] is None


def test_no_personal_data_fields(data):
    allowed = {"id", "fen", "ply", "move_no", "stm", "phase", "player_elo", "opp_elo", "real", "evals", "san", "maia", "tags", "site"}
    for p in data["positions"]:
        assert set(p) == allowed
