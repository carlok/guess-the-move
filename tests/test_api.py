# SPDX-License-Identifier: AGPL-3.0-or-later
"""The `api` service, against fake engine and fake Maia (no Stockfish, no torch). Real-engine and real-Maia runs are
reported separately (CONTINUE.md T6). Endpoint tests go through the ASGI app directly with httpx."""

import asyncio
import json
import logging
import math
import sys
import threading
import time
from pathlib import Path

import chess
import httpx
import pytest

from api.app import Settings, create_app
from api.backends import EnginePool, MaiaRunner
from api.cache import LRUCache, ValkeyCache, cache_key
from api.ratelimit import RateLimiter
from fakes import FakeEngine, FakeMaia
from pipeline.estimator import GRID

FEN = "rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"  # White to move, Nxh4 wins the queen
MATED = "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"  # Black is stalemated? no: checkmated below
STALEMATE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"


class Spy(FakeEngine):
    def __init__(self, delay=0.0):
        self.calls = []
        self.delay = delay

    def analyse_all(self, board, nodes=None):
        self.calls.append(nodes)
        if self.delay:
            time.sleep(self.delay)
        return super().analyse_all(board, nodes)


class EloAwareMaia(FakeMaia):
    """Probability of the first legal move rises with the rating: a stand-in for a model that knows strength."""

    name = "fake-maia-elo"

    def __init__(self):
        super().__init__()
        self.calls = []

    def probs(self, fen, elo_self, elo_oppo):
        self.calls.append((fen, elo_self, elo_oppo))
        legal = [m.uci() for m in chess.Board(fen).legal_moves]
        strength = min(max((elo_self - 1000) / 1100, 0.0), 1.0)
        first = 0.1 + 0.8 * strength
        rest = (1 - first) / (len(legal) - 1)
        return {m: (first if i == 0 else rest) for i, m in enumerate(legal)}


def build(engine=None, maia=None, **kw):
    engine = engine or Spy()
    settings = Settings(**{"rate_burst": 1000, "rate_per_minute": 100000, **kw.pop("settings", {})})
    app = create_app(EnginePool([engine]), MaiaRunner(maia) if maia else None, settings=settings, **kw)
    return app, engine


def call(app, method, path, *, json_body=None, content=None, headers=None):
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            return await c.request(method, path, json=json_body, content=content, headers=headers)

    return asyncio.run(go())


def post(app, path, body, **kw):
    return call(app, "POST", path, json_body=body, **kw)


# --- health ---------------------------------------------------------------------------------------------------------


def test_healthz_reports_the_backends_and_is_not_rate_limited():
    app, _ = build(maia=FakeMaia(), settings={"rate_burst": 1, "rate_per_minute": 1})
    for _ in range(5):
        r = call(app, "GET", "/healthz")
        assert r.status_code == 200
    assert r.json() == {"status": "ok", "engine": "fake-material", "maia": "fake-maia"}
    app, _ = build(maia=False)
    assert call(app, "GET", "/healthz").json()["maia"] is None


# --- /v1/analyse ----------------------------------------------------------------------------------------------------


def test_analyse_returns_the_dataset_position_shape_for_every_legal_move():
    app, engine = build(maia=FakeMaia())
    r = post(app, "/v1/analyse", {"fen": FEN, "elo": 1500, "nodes": 5000})
    assert r.status_code == 200
    body = r.json()
    board = chess.Board(FEN)
    legal = {m.uci() for m in board.legal_moves}
    assert set(body["evals"]) == legal == set(body["san"])
    assert body["san"]["f3h4"] == "Nxh4" and body["evals"]["f3h4"] == 900
    assert body["stm"] == "w" and body["phase"] in {"opening", "middlegame", "endgame"}
    assert set(body["maia"]["probs"]) <= legal and body["maia"]["elo"] == 1500
    assert all(0.001 <= p <= 1 for p in body["maia"]["probs"].values())
    assert body["engine"] == "fake-material" and body["model"] == "fake-maia" and body["nodes"] == 5000
    assert engine.calls == [5000]


def test_without_a_rating_there_is_no_maia_block_and_nodes_default_and_clamp():
    app, engine = build(maia=FakeMaia(), settings={"nodes_default": 1234, "nodes_max": 9000})
    assert post(app, "/v1/analyse", {"fen": FEN}).json()["maia"] is None
    post(app, "/v1/analyse", {"fen": FEN, "nodes": 10**9})
    assert engine.calls == [1234, 9000]


def test_a_rating_without_a_maia_backend_is_a_clear_503():
    app, _ = build(maia=False)
    r = post(app, "/v1/analyse", {"fen": FEN, "elo": 1500})
    assert r.status_code == 503 and r.json()["error"]["code"] == "maia_unavailable"


@pytest.mark.parametrize("body,code", [
    ({}, "invalid_request"),
    ({"fen": 5}, "invalid_request"),
    ({"fen": "not a fen"}, "invalid_fen"),
    ({"fen": "8/8/8/8/8/8/8/8 w - - 0 1"}, "invalid_fen"),  # no kings
    ({"fen": FEN + " " + "x" * 200}, "invalid_fen"),
    ({"fen": MATED}, "no_legal_moves"),
    ({"fen": STALEMATE}, "no_legal_moves"),
    ({"fen": FEN, "elo": 50}, "invalid_request"),
    ({"fen": FEN, "elo": "high"}, "invalid_request"),
    ({"fen": FEN, "elo": 1500, "opp_elo": 9000}, "invalid_request"),
    ({"fen": FEN, "nodes": 0}, "invalid_request"),
    ({"fen": FEN, "nodes": "many"}, "invalid_request"),
    ({"fen": FEN, "nodes": True}, "invalid_request"),
])
def test_bad_input_is_a_422_with_a_code(body, code):
    app, engine = build(maia=FakeMaia())
    r = post(app, "/v1/analyse", body)
    assert r.status_code == 422 and r.json()["error"]["code"] == code
    assert engine.calls == [], "the engine is never reached with bad input"


def test_transport_level_abuse_is_rejected_before_any_work():
    app, engine = build(settings={"max_body": 200})
    assert post(app, "/v1/analyse", {"fen": FEN, "pad": "x" * 500}).status_code == 413
    assert call(app, "POST", "/v1/analyse", content=b"x" * 500, headers={"content-type": "application/json"}).status_code == 413
    assert call(app, "POST", "/v1/analyse", content=b"{nope", headers={"content-type": "application/json"}).json()["error"]["code"] == "invalid_json"
    assert call(app, "POST", "/v1/analyse", content=b"{}", headers={"content-type": "text/plain"}).status_code == 415
    assert call(app, "POST", "/v1/analyse", content=b"[1]", headers={"content-type": "application/json"}).status_code == 422
    assert call(app, "GET", "/v1/analyse").status_code == 405
    assert engine.calls == []


def test_a_slow_engine_is_a_504_and_the_engine_is_reusable_afterwards():
    app, engine = build(engine=Spy(delay=0.4), settings={"timeout_s": 0.05})
    r = post(app, "/v1/analyse", {"fen": FEN})
    assert r.status_code == 504 and r.json()["error"]["code"] == "timeout"
    time.sleep(0.5)  # the abandoned search finishes and hands the engine back
    engine.delay = 0
    app2 = create_app(EnginePool([engine]), None, settings=Settings(rate_burst=100, rate_per_minute=10000))
    assert post(app2, "/v1/analyse", {"fen": FEN}).status_code == 200


def test_more_concurrent_requests_than_the_queue_allows_get_503():
    engine = Spy(delay=0.3)
    app, _ = build(engine=engine, settings={"max_inflight": 1})

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            first = asyncio.create_task(c.post("/v1/analyse", json={"fen": FEN}))
            await asyncio.sleep(0.05)
            second = await c.post("/v1/analyse", json={"fen": FEN, "nodes": 7})
            return await first, second

    first, second = asyncio.run(go())
    assert first.status_code == 200
    assert second.status_code == 503 and second.json()["error"]["code"] == "busy" and second.headers["retry-after"]


# --- limits, origin, logging ----------------------------------------------------------------------------------------


def test_per_client_rate_limit_with_retry_after_and_separate_buckets_behind_a_proxy():
    app, engine = build(settings={"rate_burst": 2, "rate_per_minute": 1, "trust_proxy": True})
    h1, h2 = {"x-forwarded-for": "10.0.0.1"}, {"x-forwarded-for": "10.0.0.2, 10.9.9.9"}
    assert [post(app, "/v1/analyse", {"fen": FEN}, headers=h1).status_code for _ in range(3)] == [200, 200, 429]
    r = post(app, "/v1/analyse", {"fen": FEN}, headers=h1)
    assert r.json()["error"]["code"] == "rate_limited" and int(r.headers["retry-after"]) >= 1
    assert post(app, "/v1/analyse", {"fen": FEN}, headers=h2).status_code == 200


def test_without_trust_proxy_the_forwarded_header_cannot_be_used_to_dodge_the_limit():
    app, _ = build(settings={"rate_burst": 1, "rate_per_minute": 1})
    codes = [post(app, "/v1/analyse", {"fen": FEN}, headers={"x-forwarded-for": f"10.0.0.{i}"}).status_code for i in range(3)]
    assert codes == [200, 429, 429]


def test_the_rate_limiter_refills_and_forgets_idle_clients():
    now = [0.0]
    rl = RateLimiter(per_minute=60, burst=2, clock=lambda: now[0], max_clients=3)
    assert [rl.allow("a") for _ in range(3)] == [True, True, False]
    assert rl.retry_after("a") == 1
    now[0] = 1.0
    assert rl.allow("a") is True and rl.allow("a") is False
    for c in "bcd":
        rl.allow(c)
    assert len(rl._buckets) <= 3, "memory is bounded"


def test_cross_origin_posts_are_refused_and_there_are_no_cors_headers():
    app, _ = build()
    assert post(app, "/v1/analyse", {"fen": FEN}, headers={"origin": "https://evil.example"}).status_code == 403
    ok = post(app, "/v1/analyse", {"fen": FEN}, headers={"origin": "http://test"})
    assert ok.status_code == 200 and "access-control-allow-origin" not in ok.headers
    pre = call(app, "OPTIONS", "/v1/analyse", headers={"origin": "https://evil.example", "access-control-request-method": "POST"})
    assert pre.status_code in (403, 405) and "access-control-allow-origin" not in pre.headers


def test_request_bodies_never_reach_the_logs(caplog):
    caplog.set_level(logging.DEBUG)
    secret = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
    app, _ = build(maia=FakeMaia(), settings={"timeout_s": 5})
    post(app, "/v1/analyse", {"fen": secret, "elo": 1500})
    post(app, "/v1/analyse", {"fen": secret.replace("w KQkq", "z KQkq")})  # an error path
    post(app, "/v1/posterior", {"history": [{"fen": secret, "move": "e2e4"}]})
    assert "PPPP1PPP" not in caplog.text and "KQkq" not in caplog.text
    assert any(r.name.startswith("gtm") for r in caplog.records), "something is logged: method, path and status"


# --- cache ----------------------------------------------------------------------------------------------------------


def test_identical_requests_hit_the_cache_and_different_budgets_do_not():
    app, engine = build(maia=FakeMaia())
    a = post(app, "/v1/analyse", {"fen": FEN, "elo": 1500, "nodes": 1000}).json()
    b = post(app, "/v1/analyse", {"fen": FEN, "elo": 1500, "nodes": 1000}).json()
    post(app, "/v1/analyse", {"fen": FEN, "elo": 1500, "nodes": 2000})
    assert a == b and engine.calls == [1000, 2000]


def test_cache_keys_include_every_input_that_changes_the_answer():
    base = cache_key("fen", 1000, "engine", "model")
    assert len({base, cache_key("fen2", 1000, "engine", "model"), cache_key("fen", 2000, "engine", "model"),
                cache_key("fen", 1000, "engine2", "model"), cache_key("fen", 1000, "engine", "model2")}) == 5
    assert len(base) == 40


def test_lru_cache_evicts_the_least_recently_used_entry():
    c = LRUCache(2)

    async def go():
        await c.set("a", {"v": 1}); await c.set("b", {"v": 2})
        await c.get("a")
        await c.set("c", {"v": 3})
        return [await c.get(k) for k in "abc"]

    assert asyncio.run(go()) == [{"v": 1}, None, {"v": 3}]


class FakeValkey:
    def __init__(self, fail=False):
        self.store, self.fail, self.ttls = {}, fail, []

    async def get(self, k):
        if self.fail:
            raise ConnectionError("down")
        return self.store.get(k)

    async def set(self, k, v, ex=None):
        if self.fail:
            raise ConnectionError("down")
        self.store[k] = v
        self.ttls.append(ex)


def test_valkey_cache_round_trips_json_with_a_ttl():
    fake = FakeValkey()
    c = ValkeyCache(fake, ttl_s=60)

    async def go():
        await c.set("k", {"a": [1, 2]})
        fresh = ValkeyCache(fake, ttl_s=60)  # another process: only Valkey has it
        return await fresh.get("k")

    assert asyncio.run(go()) == {"a": [1, 2]} and fake.ttls == [60]


def test_the_api_works_when_valkey_is_down_or_absent():
    down = ValkeyCache(FakeValkey(fail=True), ttl_s=60)
    app, engine = build(cache=down)
    assert post(app, "/v1/analyse", {"fen": FEN}).status_code == 200
    assert post(app, "/v1/analyse", {"fen": FEN}).status_code == 200
    assert engine.calls == [100000], "the in-process fallback still caches"
    app, engine = build()  # no cache configured at all
    assert post(app, "/v1/analyse", {"fen": FEN}).status_code == 200


# --- /v1/posterior --------------------------------------------------------------------------------------------------


def history(moves):
    board, out = chess.Board(), []
    for san in moves:
        m = board.parse_san(san)
        out.append({"fen": board.fen(), "move": m.uci(), "opp_elo": 1500})
        board.push(m)
    return out


def test_posterior_moves_towards_the_rating_that_explains_the_moves():
    maia = EloAwareMaia()
    app, _ = build(maia=maia)
    # the "first legal move" in the fake's ordering, played every time, is evidence for a strong player
    board, hist = chess.Board(), []
    for _ in range(4):
        first = next(iter(board.legal_moves))
        hist.append({"fen": board.fen(), "move": first.uci(), "opp_elo": 1500})
        board.push(first)
        board.push(next(iter(board.legal_moves)))
    r = post(app, "/v1/posterior", {"history": hist})
    assert r.status_code == 200
    body = r.json()
    assert body["grid"] == list(GRID) and math.isclose(sum(body["posterior"]), 1.0, abs_tol=1e-3)
    assert body["label"] == "Lichess-equivalent" and body["moves"] == 4
    assert body["posterior"][-1] > body["posterior"][0]
    lo, hi = body["interval80"]
    assert lo <= body["mean"] <= hi + 100 and body["mean"] > 1550
    assert len(maia.calls) == 4 * len(GRID)


def test_posterior_uses_a_prior_and_the_cache_across_requests():
    maia = EloAwareMaia()
    app, _ = build(maia=maia)
    prior = {str(e): (10.0 if e == 1450 else 1.0) for e in GRID}
    h = history(["e4"])
    a = post(app, "/v1/posterior", {"history": h, "prior": prior}).json()
    n_calls = len(maia.calls)
    b = post(app, "/v1/posterior", {"history": h}).json()
    assert len(maia.calls) == n_calls, "per-bucket Maia distributions are cached"
    assert a["posterior"][GRID.index(1450)] > b["posterior"][GRID.index(1450)]


@pytest.mark.parametrize("body,code", [
    ({}, "invalid_request"),
    ({"history": []}, "invalid_request"),
    ({"history": "e4"}, "invalid_request"),
    ({"history": [{"fen": FEN}]}, "invalid_request"),
    ({"history": [{"fen": FEN, "move": "a1a8"}]}, "illegal_move"),
    ({"history": [{"fen": "garbage", "move": "e2e4"}]}, "invalid_fen"),
    ({"history": [{"fen": FEN, "move": "f3h4", "opp_elo": 10}]}, "invalid_request"),
    ({"history": [{"fen": FEN, "move": "f3h4"}], "prior": {"1234": 1}}, "invalid_request"),
    ({"history": [{"fen": FEN, "move": "f3h4"}], "prior": {str(e): -1 for e in GRID}}, "invalid_request"),
    ({"history": [{"fen": FEN, "move": "f3h4"}], "prior": {str(e): 0 for e in GRID}}, "invalid_request"),
    ({"history": [{"fen": FEN, "move": "f3h4"}], "prior": [1]}, "invalid_request"),
])
def test_posterior_validation(body, code):
    app, _ = build(maia=EloAwareMaia())
    r = post(app, "/v1/posterior", body)
    assert r.status_code == 422 and r.json()["error"]["code"] == code


def test_posterior_history_length_is_capped_and_needs_maia():
    app, _ = build(maia=EloAwareMaia(), settings={"max_history": 2})
    assert post(app, "/v1/posterior", {"history": history(["e4", "e5", "Nf3"][:1]) * 3}).status_code == 422
    app, _ = build(maia=False)
    r = post(app, "/v1/posterior", {"history": history(["e4"])})
    assert r.status_code == 503 and r.json()["error"]["code"] == "maia_unavailable"


# --- backends and wiring ----------------------------------------------------------------------------------------------


def test_engine_pool_hands_a_backend_back_only_when_its_search_has_really_finished():
    started, release = threading.Event(), threading.Event()

    class Blocking(FakeEngine):
        def analyse_all(self, board, nodes=None):
            started.set()
            release.wait(2)
            return super().analyse_all(board, nodes)

    pool = EnginePool([Blocking()])

    async def go():
        with pytest.raises(asyncio.TimeoutError):
            await pool.analyse_all(chess.Board(), 10, timeout=0.05)
        assert started.is_set() and pool._free.qsize() == 0, "still busy: not handed to the next request"
        release.set()
        await asyncio.sleep(0.2)
        return pool._free.qsize()

    assert asyncio.run(go()) == 1


def test_from_env_wires_a_real_uci_engine_and_disables_maia_on_request(monkeypatch):
    from api.main import build_app

    stub = f"{sys.executable} {Path(__file__).parent / 'fixtures' / 'uci_stub.py'}"
    monkeypatch.setenv("GTM_API_ENGINE", stub)
    monkeypatch.setenv("GTM_API_ENGINES", "2")
    monkeypatch.setenv("GTM_API_MAIA", "none")
    monkeypatch.delenv("VALKEY_URL", raising=False)
    app = build_app()
    try:
        r = post(app, "/v1/analyse", {"fen": FEN, "nodes": 500})
        assert r.status_code == 200 and r.json()["engine"] == "StubFish 1.0" and r.json()["evals"]["f3h4"] == 900
        assert call(app, "GET", "/healthz").json()["maia"] is None
    finally:
        app.state.close()


# --- failure paths and wiring (second round, from the coverage report) -------------------------------------------------


def test_trust_proxy_without_a_forwarded_header_falls_back_to_the_socket_address():
    app, _ = build(settings={"trust_proxy": True, "rate_burst": 1, "rate_per_minute": 1})
    assert [post(app, "/v1/analyse", {"fen": FEN}).status_code for _ in range(2)] == [200, 429]


def test_a_body_without_content_length_is_still_capped_while_streaming():
    app, engine = build(settings={"max_body": 100})

    async def chunks():
        for _ in range(10):
            yield b'{"fen": "' + b"x" * 30

    r = call(app, "POST", "/v1/analyse", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413 and engine.calls == []


def test_an_unexpected_error_is_a_500_that_leaks_nothing(caplog):
    class Boom(FakeEngine):
        def analyse_all(self, board, nodes=None):
            raise RuntimeError(f"secret {board.fen()}")

    caplog.set_level(logging.DEBUG)
    app, _ = build(engine=Boom())
    r = post(app, "/v1/analyse", {"fen": FEN})
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal"
    assert "secret" not in r.text and "secret" not in caplog.text and "RuntimeError" in caplog.text


def test_a_backend_that_breaks_its_contract_is_a_502_not_a_wrong_answer():
    class Lazy(FakeEngine):
        def analyse_all(self, board, nodes=None):
            out = super().analyse_all(board, nodes)
            out.popitem()
            return out

    class Wild(FakeMaia):
        def probs(self, fen, a, b):
            return {"a1a8": 1.0}

    assert post(build(engine=Lazy())[0], "/v1/analyse", {"fen": FEN}).json()["error"]["code"] == "bad_engine_output"
    r = post(build(maia=Wild())[0], "/v1/analyse", {"fen": FEN, "elo": 1500})
    assert r.status_code == 502 and r.json()["error"]["code"] == "bad_model_output"


def test_more_posterior_validation():
    app, _ = build(maia=EloAwareMaia())
    assert post(app, "/v1/posterior", {"history": [{"fen": FEN, "move": "zzzz"}]}).json()["error"]["code"] == "illegal_move"
    r = post(app, "/v1/posterior", {"history": [{"fen": FEN, "move": "f3h4"}], "prior": {str(e): "x" for e in GRID}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_the_lifespan_closes_the_backends():
    closed = []
    app = create_app(EnginePool([Spy()]), None, on_close=lambda: closed.append(1))

    async def go():
        async with app.router.lifespan_context(app):
            assert closed == []

    asyncio.run(go())
    assert closed == [1]


def test_build_app_wires_maia_and_valkey_from_the_environment(monkeypatch):
    import types

    from api.main import build_app

    stub = f"{sys.executable} {Path(__file__).parent / 'fixtures' / 'uci_stub.py'}"
    store = FakeValkey()
    pkg = types.ModuleType("valkey")
    sub = types.ModuleType("valkey.asyncio")
    sub.from_url = lambda url: store
    pkg.asyncio = sub
    monkeypatch.setitem(sys.modules, "valkey", pkg)
    monkeypatch.setitem(sys.modules, "valkey.asyncio", sub)
    maia2 = types.ModuleType("maia2")
    maia2.model = types.SimpleNamespace(from_pretrained=lambda type, device, save_root: "M")
    maia2.inference = types.SimpleNamespace(prepare=lambda: "P", inference_each=lambda m, p, fen, a, b: ({"f3h4": 0.9, "a2a3": 0.1}, 0.5))
    monkeypatch.setitem(sys.modules, "maia2", maia2)
    for k, v in {"GTM_API_ENGINE": stub, "GTM_API_ENGINES": "1", "GTM_API_MAIA": "maia2", "GTM_API_TRUST_PROXY": "1",
                 "VALKEY_URL": "redis://valkey:6379", "MAIA2_HOME": "/models"}.items():
        monkeypatch.setenv(k, v)
    app = build_app()
    try:
        assert call(app, "GET", "/healthz").json()["maia"] == "maia2-rapid"
        r = post(app, "/v1/analyse", {"fen": FEN, "elo": 1500, "nodes": 500})
        assert r.status_code == 200 and r.json()["maia"]["probs"] == {"f3h4": 0.9, "a2a3": 0.1}
        assert len(store.store) == 2, "both the evaluations and the Maia distribution reached Valkey"
    finally:
        app.state.close()


def test_the_posterior_uses_the_grid_of_the_model_behind_it():
    from pipeline.estimator import FINE_GRID

    class Fine(EloAwareMaia):
        grid = FINE_GRID

    app, _ = build(maia=Fine())
    body = post(app, "/v1/posterior", {"history": history(["e4"])}).json()
    assert body["grid"] == list(FINE_GRID) and len(body["posterior"]) == 13
    prior = {str(e): 1 for e in FINE_GRID}
    assert post(app, "/v1/posterior", {"history": history(["e4"]), "prior": prior}).status_code == 200
    assert post(app, "/v1/posterior", {"history": history(["e4"]), "prior": {str(e): 1 for e in GRID}}).status_code == 422


def test_build_app_picks_maia3_by_default_with_its_model_and_cache_directory(monkeypatch):
    import types

    from api.main import build_app

    seen = {}

    class FakeMaia3:
        grid = ()
        name = "maia3-23m"

        def __init__(self, model, cache_dir):
            seen.update(model=model, cache_dir=cache_dir)
            from pipeline.estimator import FINE_GRID
            self.grid = FINE_GRID

        def probs(self, fen, a, b):
            return {}

    import pipeline.backends as pb

    monkeypatch.setattr(pb, "Maia3Backend", FakeMaia3)
    stub = f"{sys.executable} {Path(__file__).parent / 'fixtures' / 'uci_stub.py'}"
    for k, v in {"GTM_API_ENGINE": stub, "GTM_API_ENGINES": "1", "GTM_API_MAIA_MODEL": "maia3-23m", "MAIA2_HOME": "/models"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("GTM_API_MAIA", raising=False)
    monkeypatch.delenv("VALKEY_URL", raising=False)
    app = build_app()
    try:
        assert seen == {"model": "maia3-23m", "cache_dir": "/models"}
        assert call(app, "GET", "/healthz").json()["maia"] == "maia3-23m"
    finally:
        app.state.close()
