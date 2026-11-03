"""Dataset invariants shared by the shipped-file test and the end-to-end pipeline tests.

Independent of the pipeline: legal moves and SAN come from python-chess again, not from the builder.
"""

import re

import chess

ALLOWED_FIELDS = {"id", "fen", "ply", "move_no", "stm", "phase", "player_elo", "opp_elo", "real", "evals", "san", "maia", "tags", "site"}
META_KEYS = ("engine", "nodes", "built", "source", "demo", "thresholds", "counts")


def check_schema_and_meta(data: dict) -> None:
    assert data["schema"] == 1
    for key in META_KEYS:
        assert key in data["meta"], key
    assert sum(data["meta"]["counts"].values()) == len(data["positions"]) > 0


def check_positions(data: dict) -> None:
    ids = set()
    for p in data["positions"]:
        assert set(p) == ALLOWED_FIELDS, "no personal data fields, nothing missing"
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


def check_dataset(data: dict) -> None:
    check_schema_and_meta(data)
    check_positions(data)
