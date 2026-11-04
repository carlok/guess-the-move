# SPDX-License-Identifier: AGPL-3.0-or-later
"""Entry point: `uvicorn --factory api.main:build_app`. Everything is configured by environment variables so the same
image runs anywhere:

  GTM_API_ENGINE        UCI engine command (default /usr/local/bin/stockfish)
  GTM_API_ENGINES       size of the engine pool, one process each (default 2)
  GTM_API_MAIA          maia3 | maia2 | none (default maia3)   GTM_API_MAIA_MODEL maia3-5m | maia3-23m | maia3-79m
  GTM_API_MAIA_KIND     rapid | blitz (maia2 only)           MAIA2_HOME directory for the downloaded weights
  GTM_API_TRUST_PROXY   1 when behind our nginx (client address from X-Forwarded-For)
  VALKEY_URL            optional shared cache, e.g. redis://valkey:6379 (absent: in-process LRU only)
"""

from __future__ import annotations

import logging
import os
import shlex

from .app import Settings, create_app
from .backends import EnginePool, MaiaRunner
from .cache import LRUCache, ValkeyCache


def build_app():
    from pipeline.backends import Maia2Backend, Maia3Backend, StockfishBackend

    logging.basicConfig(level=os.environ.get("GTM_API_LOG", "INFO"), format="%(asctime)s %(name)s %(message)s")
    settings = Settings(trust_proxy=os.environ.get("GTM_API_TRUST_PROXY") == "1")
    command = shlex.split(os.environ.get("GTM_API_ENGINE", "/usr/local/bin/stockfish"))
    backends = [StockfishBackend(command, nodes=settings.nodes_default) for _ in range(int(os.environ.get("GTM_API_ENGINES", "2")))]
    maia = None
    which, home = os.environ.get("GTM_API_MAIA", "maia3"), os.environ.get("MAIA2_HOME", "./maia2_models")
    if which == "maia3":
        maia = MaiaRunner(Maia3Backend(model=os.environ.get("GTM_API_MAIA_MODEL", "maia3-23m"), cache_dir=home))
    elif which == "maia2":
        maia = MaiaRunner(Maia2Backend(kind=os.environ.get("GTM_API_MAIA_KIND", "rapid"), save_root=home))
    cache = LRUCache(settings.cache_size)
    if os.environ.get("VALKEY_URL"):
        import valkey.asyncio as valkey

        cache = ValkeyCache(valkey.from_url(os.environ["VALKEY_URL"]), fallback=cache)
    pool = EnginePool(backends)
    return create_app(pool, maia, settings=settings, cache=cache, on_close=pool.close)
