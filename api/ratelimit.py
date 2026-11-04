# SPDX-License-Identifier: AGPL-3.0-or-later
"""Per-client token bucket, in process. Memory is bounded: the least recently seen client is forgotten first."""

from __future__ import annotations

import math
import time
from collections import OrderedDict


class RateLimiter:
    def __init__(self, per_minute: float, burst: int, clock=time.monotonic, max_clients: int = 10_000):
        self._rate, self._burst, self._clock, self._max = per_minute / 60.0, float(burst), clock, max_clients
        self._buckets: OrderedDict[str, tuple[float, float]] = OrderedDict()  # client -> (tokens, last seen)

    def _refill(self, client: str) -> float:
        now = self._clock()
        tokens, last = self._buckets.get(client, (self._burst, now))
        return min(self._burst, tokens + (now - last) * self._rate)

    def allow(self, client: str) -> bool:
        tokens = self._refill(client)
        ok = tokens >= 1.0
        self._buckets[client] = (tokens - 1.0 if ok else tokens, self._clock())
        self._buckets.move_to_end(client)
        while len(self._buckets) > self._max:
            self._buckets.popitem(last=False)
        return ok

    def retry_after(self, client: str) -> int:
        """Whole seconds until a request would be allowed (at least 1)."""
        return max(1, math.ceil((1.0 - self._refill(client)) / self._rate))
