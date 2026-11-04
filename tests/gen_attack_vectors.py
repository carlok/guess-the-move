# SPDX-License-Identifier: AGPL-3.0-or-later
"""Generate tests/attack_vectors.json: for a set of positions, which pieces attack each square, as python-chess says.

web/classify.js has its own attack detector (it needs one to spot sacrifices); web/test/classify.test.js checks it against
this file square by square. Deterministic (fixed seed); tests/test_attack_vectors.py fails if the committed file differs
from what this produces, so run `python tests/gen_attack_vectors.py` after changing the position list.
"""

import json
import random
import sys
from pathlib import Path

import chess

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "attack_vectors.json"
DATASET = ROOT / "web" / "data" / "positions.json"
SEED = 20261104
N_DATASET = 60

HAND = [
    chess.STARTING_FEN,
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",   # the "kiwipete" test position
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",                              # rook and pawn endgame with long rays
    "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1",                                      # en passant available
    "8/P7/8/8/8/8/k6K/8 w - - 0 1",                                           # a pawn about to promote
    "rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",        # queen on h4 gives a check line
    "4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1",                                       # castling both ways
    "7k/8/8/8/3q4/8/8/K7 w - - 0 1",                                          # a lone queen: long diagonals and files
]


def attackers_of(fen: str) -> dict:
    board = chess.Board(fen)
    out = {}
    for color, key in ((chess.WHITE, "w"), (chess.BLACK, "b")):
        table = {}
        for sq in chess.SQUARES:
            who = sorted(chess.square_name(a) for a in board.attackers(color, sq))
            if who:
                table[chess.square_name(sq)] = who
        out[key] = table
    return out


def fens() -> list[str]:
    positions = json.loads(DATASET.read_text(encoding="utf-8"))["positions"]
    sample = random.Random(SEED).sample(positions, N_DATASET)
    return HAND + [p["fen"] for p in sample]


def build() -> dict:
    return {"cases": [{"fen": f, "attackers": attackers_of(f)} for f in fens()]}


def dumps(data: dict) -> str:
    return json.dumps(data, separators=(",", ":"), sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(dumps(build()), encoding="utf-8")
    print(f"wrote {OUT} ({len(build()['cases'])} positions)", file=sys.stderr)
