"""Analysis cache. Always an in-process LRU; Valkey is an optional second level shared between processes.

Nothing here is needed for correctness: a miss, a Valkey outage or no Valkey at all just means recomputing."""

from __future__ import annotations

import hashlib
import json
import logging
from collections import OrderedDict

log = logging.getLogger("gtm.api.cache")


def cache_key(fen: str, nodes: object, engine: str, model: str) -> str:
    """sha1 of everything that changes the answer (PROMPT.md 4.2)."""
    return hashlib.sha1(f"{fen}|{nodes}|{engine}|{model}".encode()).hexdigest()


class LRUCache:
    def __init__(self, size: int = 2048):
        self._size, self._data = size, OrderedDict()

    async def get(self, key: str):
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    async def set(self, key: str, value) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        while len(self._data) > self._size:
            self._data.popitem(last=False)


class ValkeyCache:
    """Valkey (Redis protocol) behind the same interface, with an in-process LRU in front.

    `client` is any object with async get(key) and set(key, value, ex=seconds), e.g. valkey.asyncio.Valkey. Any error
    from it is logged by type only (never the payload) and treated as a miss."""

    def __init__(self, client, ttl_s: int = 3600, fallback: LRUCache | None = None):
        self._client, self._ttl, self._local = client, ttl_s, fallback or LRUCache()

    async def get(self, key: str):
        hit = await self._local.get(key)
        if hit is not None:
            return hit
        try:
            raw = await self._client.get(key)
        except Exception as exc:  # noqa: BLE001 - a cache must never take the service down
            log.warning("valkey get failed: %s", type(exc).__name__)
            return None
        if raw is None:
            return None
        value = json.loads(raw)
        await self._local.set(key, value)
        return value

    async def set(self, key: str, value) -> None:
        await self._local.set(key, value)
        try:
            await self._client.set(key, json.dumps(value, separators=(",", ":")), ex=self._ttl)
        except Exception as exc:  # noqa: BLE001
            log.warning("valkey set failed: %s", type(exc).__name__)
