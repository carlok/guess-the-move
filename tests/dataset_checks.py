"""Dataset invariants shared by the shipped-file test and the end-to-end pipeline tests.

Independent of the pipeline: legal moves and SAN come from python-chess again, not from the builder.
"""

import re

import chess

REQUIRED_FIELDS = {"id", "fen", "ply", "move_no", "stm", "phase", "player_elo", "opp_elo", "real", "evals", "san", "maia", "tags", "site"}
ALLOWED_FIELDS = REQUIRED_FIELDS | {"game"}  # "game": per-position provenance from the PGN headers (absent in datasets built before 2026-11-04)
GAME_KEYS = {"white", "black", "white_title", "black_title", "white_elo", "black_elo", "white_elo_diff", "black_elo_diff", "date", "time", "event", "time_control", "result", "termination", "eco", "opening", "clock_after_move_s"}
META_KEYS = ("engine", "nodes", "built", "source", "demo", "thresholds", "counts")


def check_schema_and_meta(data: dict) -> None:
    assert data["schema"] == 1
    for key in META_KEYS:
        assert key in data["meta"], key
    assert sum(data["meta"]["counts"].values()) == len(data["positions"]) > 0


def check_positions(data: dict) -> None:
    ids = set()
    for p in data["positions"]:
        assert REQUIRED_FIELDS <= set(p) <= ALLOWED_FIELDS, "nothing missing, nothing unexpected"
        if p.get("game") is not None:
            assert set(p["game"]) <= GAME_KEYS
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
            assert set(p["maia"]) <= {"elo", "probs", "by_elo"}
            assert set(p["maia"]["probs"]) <= legal
            assert p["player_elo"] == p["maia"]["elo"]
            for rating, dist in (p["maia"].get("by_elo") or {}).items():  # Maia at fixed rating anchors, for the in-browser estimate
                assert rating.isdigit() and 0 <= int(rating) <= 5000
                assert set(dist) <= legal and all(0 < q <= 1 for q in dist.values()) and sum(dist.values()) <= 1.01  # 4-decimal rounding of up to ~40 moves can add a little
        if p["player_elo"] is None:
            assert p["maia"] is None


def check_dataset(data: dict) -> None:
    check_schema_and_meta(data)
    check_positions(data)
