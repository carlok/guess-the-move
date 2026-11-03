"""A tiny UCI engine for tests: no search, the score of a move is the material balance after it.

It speaks just enough UCI for python-chess's `analyse` (uci, isready, setoption, position, go, quit).
Environment knobs, so tests can reach the backend's fallback paths without a real engine:

    STUB_MAX_PV=N   never report more than N principal variations, however many MultiPV asks for
    STUB_NO_PV=K    report line K (1-based) without a `pv`, like an engine sending a bare info line
"""

import os
import sys

import chess

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
GO_KEYWORDS = {"nodes", "depth", "movetime", "wtime", "btime", "winc", "binc", "movestogo", "mate", "infinite", "ponder"}


def evaluate(board: chess.Board, move: chess.Move) -> tuple[str, int]:
    """(UCI score text, sort key) for `move`, from the side to move's point of view."""
    after = board.copy()
    after.push(move)
    if after.is_checkmate():
        return "mate 1", 1_000_000
    balance = sum(
        VALUES.get(p.piece_type, 0) * (1 if p.color == board.turn else -1) for p in after.piece_map().values()
    )
    return f"cp {balance * 100}", balance * 100


def main() -> None:
    multipv, board = 1, chess.Board()
    max_pv = int(os.environ.get("STUB_MAX_PV", "0")) or None
    no_pv = int(os.environ.get("STUB_NO_PV", "0"))
    for line in sys.stdin:
        tok = line.split()
        if not tok:
            continue
        cmd = tok[0]
        if cmd == "uci":
            print("id name StubFish 1.0")
            print("option name Threads type spin default 1 min 1 max 1024")
            print("option name Hash type spin default 16 min 1 max 33554432")
            print("option name MultiPV type spin default 1 min 1 max 500")
            print("uciok")
        elif cmd == "isready":
            print("readyok")
        elif cmd == "setoption" and "name" in tok and "value" in tok:
            if tok[tok.index("name") + 1] == "MultiPV":
                multipv = int(tok[tok.index("value") + 1])
        elif cmd == "position":
            end = tok.index("moves") if "moves" in tok else len(tok)
            board = chess.Board(" ".join(tok[2:end])) if tok[1] == "fen" else chess.Board()
            for uci in tok[end + 1 :]:
                board.push_uci(uci)
        elif cmd == "go":
            nodes = int(tok[tok.index("nodes") + 1]) if "nodes" in tok else 1
            legal = list(board.legal_moves)
            if "searchmoves" in tok:
                names = []
                for t in tok[tok.index("searchmoves") + 1 :]:
                    if t in GO_KEYWORDS:
                        break
                    names.append(t)
                legal = [m for m in legal if m.uci() in names]
            ranked = sorted(legal, key=lambda m: -evaluate(board, m)[1])
            shown = ranked[: min(multipv, max_pv or multipv)]
            for i, m in enumerate(shown, 1):
                pv = "" if i == no_pv else f" pv {m.uci()}"
                print(f"info depth 1 seldepth 1 multipv {i} score {evaluate(board, m)[0]} nodes {nodes} nps 1000 time 1{pv}")
            print(f"bestmove {ranked[0].uci()}" if ranked else "bestmove (none)")
        elif cmd == "quit":
            return
        sys.stdout.flush()


if __name__ == "__main__":
    main()
