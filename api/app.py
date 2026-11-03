"""The ASGI app. Stateless: the client sends everything it wants analysed, nothing is stored about a user.

Endpoints: GET /healthz, POST /v1/analyse, POST /v1/posterior. Guards on every POST, in this order: same-origin check,
per-client rate limit, body size and content type, in-flight limit, per-request timeout. Request bodies (FENs may come
from a user's own games) are never logged: only method, path, status and duration are."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import chess
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from pipeline.estimator import GRID, credible_interval, posterior, uniform_prior
from pipeline.tags import phase_of

from .cache import LRUCache, cache_key

log = logging.getLogger("gtm.api")


@dataclass(frozen=True)
class Settings:
    max_body: int = 64 * 1024
    max_fen_len: int = 100
    max_history: int = 100
    nodes_default: int = 100_000
    nodes_max: int = 400_000
    timeout_s: float = 20.0
    max_inflight: int = 8          # requests being worked on at once, beyond the engine pool's own queue
    rate_per_minute: float = 60.0
    rate_burst: int = 20
    trust_proxy: bool = False      # read the client address from X-Forwarded-For (only behind our own nginx)
    cache_size: int = 2048


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.headers = status, code, message, headers or {}


def invalid(message: str, code: str = "invalid_request") -> ApiError:
    return ApiError(422, code, message)


def int_field(obj: dict, name: str, lo: int, hi: int | None = None, default=None):
    if name not in obj or obj[name] is None:
        return default
    v = obj[name]
    if isinstance(v, bool) or not isinstance(v, int) or v < lo or (hi is not None and v > hi):
        raise invalid(f"{name} must be an integer" + (f" between {lo} and {hi}" if hi else f" of at least {lo}"))
    return v


def parse_fen(value, settings: Settings) -> chess.Board:
    if not isinstance(value, str):
        raise invalid("fen must be a string")
    if len(value) > settings.max_fen_len:
        raise invalid("fen is too long", "invalid_fen")
    try:
        board = chess.Board(value)
    except ValueError:  # the message would echo the FEN: not passed on, not logged
        raise invalid("not a valid FEN", "invalid_fen") from None
    if not board.is_valid():
        raise invalid("not a legal chess position", "invalid_fen")
    if not any(board.legal_moves):
        raise invalid("the side to move has no legal moves", "no_legal_moves")
    return board


def create_app(engine, maia, settings: Settings | None = None, cache=None, on_close=None) -> Starlette:
    st = settings or Settings()
    cache = cache if cache is not None else LRUCache(st.cache_size)
    from .ratelimit import RateLimiter

    limiter = RateLimiter(st.rate_per_minute, st.rate_burst)
    state = {"inflight": 0}
    maia_name = maia.name if maia else None

    def client_of(request: Request) -> str:
        if st.trust_proxy:
            fwd = request.headers.get("x-forwarded-for")
            if fwd:
                return fwd.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def read_json(request: Request) -> dict:
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            raise ApiError(415, "unsupported_media_type", "send application/json")
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > st.max_body:
            raise ApiError(413, "too_large", "request body too large")
        size, chunks = 0, []
        async for chunk in request.stream():
            size += len(chunk)
            if size > st.max_body:
                raise ApiError(413, "too_large", "request body too large")
            chunks.append(chunk)
        try:
            body = json.loads(b"".join(chunks))
        except ValueError:
            raise ApiError(400, "invalid_json", "the body is not valid JSON") from None
        if not isinstance(body, dict):
            raise invalid("the body must be a JSON object")
        return body

    def guarded(handler):
        async def run(request: Request):
            t0, status = time.monotonic(), 500
            try:
                origin = request.headers.get("origin")
                if origin and urlparse(origin).netloc != request.headers.get("host", ""):
                    raise ApiError(403, "forbidden_origin", "cross-origin requests are not accepted")
                who = client_of(request)
                if not limiter.allow(who):
                    raise ApiError(429, "rate_limited", "too many requests", {"Retry-After": str(limiter.retry_after(who))})
                body = await read_json(request)
                if state["inflight"] >= st.max_inflight:
                    raise ApiError(503, "busy", "the service is busy, try again shortly", {"Retry-After": "1"})
                state["inflight"] += 1
                try:
                    result = await asyncio.wait_for(handler(body), st.timeout_s)
                finally:
                    state["inflight"] -= 1
                status = 200
                return JSONResponse(result)
            except ApiError as e:
                status = e.status
                return JSONResponse({"error": {"code": e.code, "message": e.message}}, status_code=e.status, headers=e.headers)
            except asyncio.TimeoutError:
                status = 504
                return JSONResponse({"error": {"code": "timeout", "message": "the analysis took too long"}}, status_code=504)
            except Exception as exc:  # noqa: BLE001 - last resort; the message may contain user data, so only the type is logged
                log.error("unhandled %s", type(exc).__name__)
                return JSONResponse({"error": {"code": "internal", "message": "internal error"}}, status_code=500)
            finally:
                log.info("%s %s -> %s in %.0f ms", request.method, request.url.path, status, 1000 * (time.monotonic() - t0))
        return run

    async def maia_probs(fen: str, elo: int, opp: int, legal: set[str]) -> dict[str, float]:
        key = cache_key(fen, f"{elo}/{opp}", "", maia_name)
        hit = await cache.get(key)
        if hit is not None:
            return hit
        raw = await maia.probs(fen, elo, opp)
        if not set(raw) <= legal:
            raise ApiError(502, "bad_model_output", "the model returned moves that are not legal")
        probs = {m: round(p, 4) for m, p in raw.items() if p >= 0.001}
        await cache.set(key, probs)
        return probs

    def need_maia() -> None:
        if maia is None:
            raise ApiError(503, "maia_unavailable", "the human-move model is not loaded in this deployment")

    async def analyse(body: dict) -> dict:
        board = parse_fen(body.get("fen"), st)
        elo = int_field(body, "elo", 100, 3500)
        opp = int_field(body, "opp_elo", 100, 3500, default=elo)
        nodes = min(int_field(body, "nodes", 1, default=st.nodes_default), st.nodes_max)
        if elo is not None:
            need_maia()
        fen = board.fen()
        key = cache_key(fen, nodes, engine.name, "")
        evals = await cache.get(key)
        if evals is None:
            evals = {m: int(v) for m, v in (await engine.analyse_all(board, nodes, st.timeout_s)).items()}
            await cache.set(key, evals)
        legal = {m.uci() for m in board.legal_moves}
        if set(evals) != legal:
            raise ApiError(502, "bad_engine_output", "the engine did not evaluate every legal move")
        return {
            "fen": fen, "stm": "w" if board.turn else "b", "phase": phase_of(board), "evals": evals,
            "san": {m.uci(): board.san(m) for m in board.legal_moves},
            "maia": {"elo": elo, "probs": await maia_probs(fen, elo, opp, legal)} if elo is not None else None,
            "tags": [], "engine": engine.name, "model": maia_name, "nodes": nodes,
        }

    async def posterior_(body: dict) -> dict:
        hist = body.get("history")
        if not isinstance(hist, list) or not hist or len(hist) > st.max_history:
            raise invalid(f"history must be a list of 1 to {st.max_history} moves")
        items = []
        for h in hist:
            if not isinstance(h, dict) or not isinstance(h.get("move"), str) or "fen" not in h:
                raise invalid("each history item needs a fen and a move")
            board = parse_fen(h["fen"], st)
            opp = int_field(h, "opp_elo", 100, 3500, default=1500)
            try:
                move = chess.Move.from_uci(h["move"])
            except ValueError:
                move = None
            if move is None or move not in board.legal_moves:
                raise invalid("a move in the history is not legal in its position", "illegal_move")
            items.append((board, move.uci(), opp))
        prior = uniform_prior()
        if body.get("prior") is not None:
            raw = body["prior"]
            if not isinstance(raw, dict) or set(raw) != {str(e) for e in GRID}:
                raise invalid(f"prior must give a weight for each of {list(GRID)}")
            try:
                weights = {e: float(raw[str(e)]) for e in GRID}
            except (TypeError, ValueError):
                raise invalid("prior weights must be numbers") from None
            total = sum(weights.values())
            if any(w < 0 for w in weights.values()) or not total > 0:
                raise invalid("prior weights must be non-negative and not all zero")
            prior = {e: w / total for e, w in weights.items()}
        need_maia()
        observations = []
        for board, move, opp in items:
            legal = {m.uci() for m in board.legal_moves}
            by = {e: await maia_probs(board.fen(), e, opp, legal) for e in GRID}
            observations.append({"move": move, "probs": by})
        post = posterior(observations, prior)
        lo, hi = credible_interval(post, 0.8)
        return {
            "grid": list(GRID), "posterior": [round(post[e], 4) for e in GRID], "mean": round(sum(e * p for e, p in post.items())),
            "interval80": [lo, hi], "moves": len(items), "label": "Lichess-equivalent", "model": maia_name,
        }

    async def healthz(request: Request):
        return JSONResponse({"status": "ok", "engine": engine.name, "maia": maia_name})

    @contextlib.asynccontextmanager
    async def lifespan(app):
        yield
        if on_close:
            on_close()

    app = Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Route("/v1/analyse", guarded(analyse), methods=["POST"]),
            Route("/v1/posterior", guarded(posterior_), methods=["POST"]),
        ],
        lifespan=lifespan,
    )
    app.state.close = on_close or (lambda: None)
    return app
