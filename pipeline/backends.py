"""Engine backends.

* StockfishBackend  - any UCI engine; scores EVERY legal move with MultiPV at a fixed node budget.
* Maia2Backend      - human-like move probabilities via the `maia2` PyPI package (UNTESTED in the
                      sandbox that wrote v1: its weights and torch were not reachable there).
* NullMaia          - no human model; the dataset is then built without plausibility data.

A Maia backend is any object with `.name` and `.probs(fen, elo_self, elo_oppo) -> {uci: p}`. Optional attributes:
`uses_history` (True: `.probs` also takes `history=` FENs of earlier positions) and `grid` (the rating grid the level
estimator should use with it; default pipeline.estimator.GRID).
"""

from __future__ import annotations

from collections import deque

import chess
import chess.engine

from .estimator import FINE_GRID, GRID
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


class Maia3Backend:
    """Maia-3 (Chessformer) through the `maia3` package (https://github.com/CSSLab/maia3, AGPL-3.0; weights from Hugging Face).

    Unlike Maia-2 the rating input is continuous (self and opponent, any integer 0..5000) and the model reads up to eight
    positions of the game, so `probs` takes the earlier positions as `history`. Without history the model repeats the
    current position to fill its window, which is what the package's own UCI engine does by default. Returns probabilities
    over the legal moves of the position as given (Black's moves are mirrored back), summing to 1.

    Internals of `maia3` are used directly (the UCI front end only exposes the top 20 moves, rounded to a thousandth).
    The version is pinned in requirements-maia.txt for that reason."""

    uses_history = True
    grid = FINE_GRID

    def __init__(self, model: str = "maia3-23m", device: str = "cpu", cache_dir: str | None = None):
        from maia3.dataset import get_historical_tokens, get_legal_moves_mask, tokenize_board
        from maia3.model_registry import resolve_checkpoint_path
        from maia3.uci import load_model, parse_args
        from maia3.utils import get_all_possible_moves, mirror_move

        self.name = model
        self._cfg = parse_args(["--model", model, "--device", device, "--no-use-amp"])
        self._cfg.checkpoint_path = resolve_checkpoint_path(
            self._cfg.model_spec, checkpoint_filename=None, cache_dir=cache_dir, revision=None,
            local_files_only=False, force_download=False, token=None,
        )
        self._model = load_model(self._cfg)
        self._tokenize, self._mask, self._window, self._mirror = tokenize_board, get_legal_moves_mask, get_historical_tokens, mirror_move
        moves = get_all_possible_moves()
        self._index = {m: i for i, m in enumerate(moves)}
        self._uci = {i: m for m, i in self._index.items()}

    def probs(self, fen: str, elo_self: int, elo_oppo: int, history: tuple[str, ...] = ()) -> dict[str, float]:
        board = chess.Board(fen)
        window = deque((self._tokenize(chess.Board(f)) for f in history[-(self._cfg.history - 1):]), maxlen=self._cfg.history)
        window.append(self._tokenize(board))
        tokens = self._window(window, self._cfg, 0.0, 0.0, 0.0, 0.0)
        by_index = self._forward(tokens, elo_self, elo_oppo, self._mask(board, self._index))
        black = board.turn == chess.BLACK
        return {(self._mirror(self._uci[i]) if black else self._uci[i]): p for i, p in by_index.items()}

    def _forward(self, tokens, elo_self: int, elo_oppo: int, mask) -> dict[int, float]:  # pragma: no cover - needs torch and the weights; tests/test_maia3_real.py runs it where they are installed
        import torch

        with torch.no_grad():
            logits = self._model(tokens.unsqueeze(0), torch.tensor([elo_self]), torch.tensor([elo_oppo]))[0][0].float()
        probs = torch.softmax(logits.masked_fill(~mask, float("-inf")), dim=-1)
        return {int(i): float(probs[i]) for i in mask.nonzero(as_tuple=True)[0]}
