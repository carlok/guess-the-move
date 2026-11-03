"""Async wrappers around the blocking engine and model backends of the pipeline."""

from __future__ import annotations

import asyncio

from pipeline.estimator import GRID


class EnginePool:
    """A fixed set of engine backends (one UCI process each, Threads=1). A backend serves one search at a time.

    On timeout the caller gives up at once, but the backend is handed back to the pool only when its search has really
    finished (a callback on the worker), so a half-finished search is never mixed with the next request."""

    def __init__(self, backends: list):
        self._backends = list(backends)
        self._free: asyncio.Queue | None = None
        self.name = self._backends[0].name

    def _queue(self) -> asyncio.Queue:
        if self._free is None:
            self._free = asyncio.Queue()
            for b in self._backends:
                self._free.put_nowait(b)
        return self._free

    async def analyse_all(self, board, nodes: int, timeout: float) -> dict[str, int]:
        free = self._queue()
        backend = await free.get()
        fut = asyncio.ensure_future(asyncio.to_thread(backend.analyse_all, board, nodes))
        fut.add_done_callback(lambda f: (f.cancelled() or f.exception(), free.put_nowait(backend)))
        return await asyncio.wait_for(asyncio.shield(fut), timeout)

    def close(self) -> None:
        for b in self._backends:
            close = getattr(b, "close", None)
            if close:
                close()


class MaiaRunner:
    """The human-move model, loaded once; calls are serialised (one model instance)."""

    def __init__(self, backend):
        self._backend = backend
        self.name = backend.name
        self.grid = getattr(backend, "grid", GRID)  # the rating grid the level estimator uses with this model
        self._lock = asyncio.Lock()

    async def probs(self, fen: str, elo_self: int, elo_oppo: int) -> dict[str, float]:
        async with self._lock:
            return await asyncio.to_thread(self._backend.probs, fen, elo_self, elo_oppo)
