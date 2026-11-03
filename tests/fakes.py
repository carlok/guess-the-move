"""Deterministic stand-ins for the engine and the human-move model (no process, no torch)."""

import math

import chess

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


class FakeEngine:
    """1-ply material evaluation: cheap, deterministic, no external process."""

    name = "fake-material"

    def analyse_all(self, board, nodes=None):
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
