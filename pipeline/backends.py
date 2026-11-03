"""Engine backends.

* StockfishBackend  - any UCI engine; scores EVERY legal move with MultiPV at a fixed node budget.
* Maia2Backend      - human-like move probabilities via the `maia2` PyPI package (UNTESTED in the
                      sandbox that wrote v1: its weights and torch were not reachable there).
* NullMaia          - no human model; the dataset is then built without plausibility data.

A Maia backend is any object with `.name` and `.probs(fen, elo_self, elo_oppo) -> {uci: p}`.
"""

from __future__ import annotations

import chess
import chess.engine

from .winpct import MATE_CP


class StockfishBackend:
    def __init__(self, command: list[str], nodes: int = 400_000, hash_mb: int = 64):
        self.nodes = nodes
        self._engine = chess.engine.SimpleEngine.popen_uci(command, timeout=120)
        self._engine.configure({"Threads": 1, "Hash": hash_mb})
        self.name = self._engine.id.get("name", "unknown UCI engine")

    def _cp(self, info: chess.engine.InfoDict, turn: chess.Color) -> int:
        return info["score"].pov(turn).score(mate_score=MATE_CP)

    def analyse_all(self, board: chess.Board, nodes: int | None = None) -> dict[str, int]:
        """UCI move -> centipawns from the side to move's point of view, for every legal move.

        `nodes` overrides the budget given at construction for this call (the API sets it per request)."""
        moves = list(board.legal_moves)
        limit = chess.engine.Limit(nodes=nodes or self.nodes)
        infos = self._engine.analyse(board, limit, multipv=len(moves))
        out: dict[str, int] = {}
        for info in infos:
            pv = info.get("pv")
            if pv:
                out[pv[0].uci()] = self._cp(info, board.turn)
        for m in moves:  # fallback for any move the engine did not report
            if m.uci() not in out:
                info = self._engine.analyse(board, limit, root_moves=[m])
                out[m.uci()] = self._cp(info, board.turn)
        return out

    def close(self) -> None:
        self._engine.quit()


class NullMaia:
    name = None

    def probs(self, fen: str, elo_self: int, elo_oppo: int) -> dict[str, float]:
        return {}


class Maia2Backend:
    """Maia-2 through `pip install maia2` (Python 3.10-3.12).

    API as documented in the maia2 README and confirmed against maia2 0.11.0's source (T3):
        model.from_pretrained(type="rapid"|"blitz", device=..., save_root=...)   # weights come from Google Drive (gdown)
        inference.prepare()
        inference.inference_each(model, prepared, fen, elo_self, elo_oppo) -> (move_probs, win_prob)
    `move_probs` maps UCI moves of the position as given (already mirrored back for Black) to probabilities. Ratings
    are bucketed by maia2 itself (<1100, 1100-1199 ... 1900-1999, >=2000), so any Elo is accepted as is; `elo_range`
    exists only to clamp deliberately.
    """

    def __init__(self, kind: str = "rapid", device: str = "cpu", elo_range: tuple[int, int] | None = None,
                 save_root: str = "./maia2_models"):
        from maia2 import inference, model  # lazy: heavy and optional

        self.name = f"maia2-{kind}"
        self.elo_range = elo_range
        self._inference = inference
        self._model = model.from_pretrained(type=kind, device=device, save_root=save_root)
        self._prepared = inference.prepare()

    def _clamp(self, elo: int) -> int:
        if self.elo_range is None:
            return elo
        lo, hi = self.elo_range
        return max(lo, min(hi, elo))

    def probs(self, fen: str, elo_self: int, elo_oppo: int) -> dict[str, float]:
        move_probs, _win = self._inference.inference_each(
            self._model, self._prepared, fen, self._clamp(elo_self), self._clamp(elo_oppo)
        )
        return {m: float(p) for m, p in move_probs.items()}
