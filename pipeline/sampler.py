# SPDX-License-Identifier: AGPL-3.0-or-later
"""Sample candidate positions from PGN files (plain or .zst, e.g. Lichess monthly dumps).

Streaming and memory-bounded: games are read one at a time and a reservoir keeps at
most `limit` candidates, so a multi-GB archive can be sampled with `max_games`.
"""

from __future__ import annotations

import io
import sys
import math
import random
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Iterator

import chess
import chess.pgn

from .tags import phase_of

SKIP_TERMINATIONS = {"Abandoned", "Rules infraction"}


@dataclass(frozen=True)
class SamplerConfig:
    min_elo: int | None = None        # applies to the player who made the move
    max_elo: int | None = None
    min_ply: int = 8                  # half-moves already played (skip the first book moves)
    max_ply: int = 120
    per_game: int = 2
    time_controls: frozenset[str] | None = None  # e.g. {"Rapid", "Classical"}; matched against the Event header
    require_elo: bool = True
    max_games: int | None = None
    # Drop a position when the player to move had less than this many seconds left AFTER playing the real move
    # (Lichess [%clk] comments). Time-trouble moves say little about how a player of that rating thinks. A position
    # without clock data is kept and counted in stats["no_clock_info"]. None switches the filter off.
    min_clock_s: float | None = None
    # Stratified sampling: keep an equal quota of candidates per (phase, 200-point rating band) instead of the population's
    # shares (which are mostly middlegame and mostly the middle of the rating range). `n_strata` sizes the quota.
    stratify: bool = False
    n_strata: int = 12


@dataclass(frozen=True)
class Candidate:
    fen: str
    real_uci: str
    ply: int
    move_no: int
    color: str                        # side to move: "w" or "b"
    player_elo: int | None
    opp_elo: int | None
    site: str | None
    game: dict | None = None          # provenance from the PGN headers, see game_info()
    phase: str = ""                   # opening | middlegame | endgame, as in the dataset
    history: tuple[str, ...] = ()     # FENs of up to 7 earlier positions of the game, oldest first (for models that read history)


_TEXT_HEADERS = {"white": "White", "black": "Black", "white_title": "WhiteTitle", "black_title": "BlackTitle", "date": "UTCDate",
                 "time": "UTCTime", "event": "Event", "time_control": "TimeControl", "result": "Result",
                 "termination": "Termination", "eco": "ECO", "opening": "Opening"}
_INT_HEADERS = {"white_elo": "WhiteElo", "black_elo": "BlackElo", "white_elo_diff": "WhiteRatingDiff", "black_elo_diff": "BlackRatingDiff"}


def game_info(h: chess.pgn.Headers) -> dict:
    """What the PGN headers say about the game (who, when, how long, how strong), None where absent or '?'.

    Lichess headers: usernames in White/Black (there are no real names), an optional title, UTC date and time of the game,
    the time control, ratings and their change, the result and how the game ended, the opening."""
    info = {k: (h.get(v) if h.get(v) not in (None, "", "?", "-") else None) for k, v in _TEXT_HEADERS.items()}
    for k, v in _INT_HEADERS.items():
        try:
            info[k] = int(h.get(v, ""))
        except ValueError:
            info[k] = None
    return info


def band_of(elo: int, cfg: SamplerConfig) -> int:
    """Lower edge of the 200-point rating band; a rating at the configured maximum belongs to the top band below it."""
    top = elo if cfg.max_elo is None else min(elo, cfg.max_elo - 1)
    return (top // 200) * 200


class ResumableHTTP(io.RawIOBase):
    """A streamed HTTP download that carries on from the byte it reached when the connection stalls or drops.

    A multi-GB archive read for minutes will meet a read timeout sooner or later; without this the whole run is lost.
    On an error it reopens the URL with `Range: bytes=<offset>-` (up to `retries` times in a row) and carries on. If the
    server answers a resume with the whole file (status 200 instead of 206) that is an error, not a silent restart."""

    def __init__(self, url: str, retries: int = 5, opener=None):
        self.url, self.retries, self.pos, self.opener, self.resp = url, retries, 0, opener or self._open, None

    @staticmethod
    def _open(url: str, offset: int):
        import urllib.request

        headers = {"User-Agent": "guess-the-move/0.1 (pgn sampler)"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        failures = 0
        while True:
            try:
                if self.resp is None:
                    self.resp = self.opener(self.url, self.pos)
                    if self.pos and getattr(self.resp, "status", 206) != 206:
                        raise RuntimeError(f"the server did not resume {self.url} at byte {self.pos} (status {self.resp.status})")
                data = self.resp.read(len(b))
                b[: len(data)] = data
                self.pos += len(data)
                return len(data)
            except RuntimeError:
                raise
            except (OSError, ValueError) as e:  # timeouts, resets and short reads
                failures += 1
                if failures > self.retries:
                    raise
                print(f"  stream error at byte {self.pos} ({e!r}); resuming ({failures}/{self.retries})", file=sys.stderr)
                self.resp = None

    def close(self) -> None:
        if self.resp is not None:
            self.resp.close()
        super().close()


def open_text(source: str | Path) -> IO[str]:
    """Open a PGN source as text: a local file, or an http(s) URL that is streamed.

    Streaming means only the bytes actually read are downloaded, so a multi-GB Lichess
    archive can be sampled with --max-games and closed early. A ".zst" suffix is
    decompressed on the fly. Note: python-zstandard ends SILENTLY on truncated input
    (a cut-off file yields fewer games, not an error), hence the stats in sample_candidates.
    """
    src = str(source)
    if src.startswith(("http://", "https://")):
        import urllib.request

        raw = ResumableHTTP(src)
        name = src.split("?", 1)[0]
    else:
        raw, name = open(src, "rb"), src
    if name.endswith(".zst"):
        import zstandard

        raw = zstandard.ZstdDecompressor().stream_reader(raw)
    return io.TextIOWrapper(raw, encoding="utf-8", errors="replace")


def _elo(headers: chess.pgn.Headers, key: str) -> int | None:
    try:
        return int(headers.get(key, ""))
    except ValueError:
        return None


def iter_games(handle: IO[str]) -> Iterator[chess.pgn.Game]:
    while True:
        game = chess.pgn.read_game(handle)
        if game is None:
            return
        yield game


def game_ok(game: chess.pgn.Game, cfg: SamplerConfig) -> bool:
    h = game.headers
    if h.get("Termination") in SKIP_TERMINATIONS:
        return False
    if cfg.time_controls is not None:
        event = h.get("Event", "")
        if not any(tc.lower() in event.lower() for tc in cfg.time_controls):
            return False
    if cfg.require_elo and (_elo(h, "WhiteElo") is None or _elo(h, "BlackElo") is None):
        return False
    return True


def positions_from_game(
    game: chess.pgn.Game, cfg: SamplerConfig, rng: random.Random, stats: dict | None = None
) -> list[Candidate]:
    h = game.headers
    w_elo, b_elo = _elo(h, "WhiteElo"), _elo(h, "BlackElo")
    site = h.get("Site") if (h.get("Site") or "").startswith("http") else None
    info = game_info(h)

    eligible: list[Candidate] = []
    board = game.board()
    earlier: deque[str] = deque(maxlen=7)
    for node in game.mainline():
        move = node.move
        color = "w" if board.turn == chess.WHITE else "b"
        player, opp = (w_elo, b_elo) if board.turn == chess.WHITE else (b_elo, w_elo)
        in_ply = cfg.min_ply <= board.ply() <= cfg.max_ply
        in_elo = (
            (cfg.min_elo is None or (player is not None and player >= cfg.min_elo))
            and (cfg.max_elo is None or (player is not None and player <= cfg.max_elo))
        )
        clock = node.clock()  # the mover's remaining time after this move
        low_clock = False
        if cfg.min_clock_s is not None and in_ply and in_elo:
            if clock is None:
                if stats is not None:
                    stats["no_clock_info"] += 1
            elif clock < cfg.min_clock_s:
                low_clock = True
                if stats is not None:
                    stats["low_clock_dropped"] += 1
        if in_ply and in_elo and not low_clock and board.legal_moves.count() >= 2:
            eligible.append(
                Candidate(
                    fen=board.fen(),
                    real_uci=move.uci(),
                    ply=board.ply(),
                    move_no=board.fullmove_number,
                    color=color,
                    player_elo=player,
                    opp_elo=opp,
                    site=site,
                    game={**info, "clock_after_move_s": clock},
                    phase=phase_of(board),
                    history=tuple(earlier),
                )
            )
        earlier.append(board.fen())
        board.push(move)

    if stats is not None:
        stats["eligible"] += len(eligible)
    if len(eligible) > cfg.per_game:
        eligible = rng.sample(eligible, cfg.per_game)
    return sorted(eligible, key=lambda c: c.ply)


def sample_candidates(
    handle: IO[str], cfg: SamplerConfig, limit: int, seed: int = 0, stats: dict | None = None
) -> list[Candidate]:
    """Reservoir-sample up to `limit` candidates over the whole stream (deterministic for a seed).

    With cfg.stratify there is one reservoir per (phase, rating band) with a quota of ceil(limit / cfg.n_strata) each, so
    a rare stratum (endgames, the top rating band) is as well represented as a common one, as far as the input has them.

    If `stats` is given it is filled with games_read / games_used, so callers can notice an
    empty or silently truncated input, and with eligible (positions that passed every filter, before the per-game sample), low_clock_dropped / no_clock_info (positions the clock
    filter removed, and positions it could not judge because the PGN has no clock comments).
    """
    rng = random.Random(seed)
    quota = math.ceil(limit / cfg.n_strata) if cfg.stratify else limit
    pools: dict[tuple, dict] = {}  # stratum -> {"res": reservoir, "seen": count}
    if stats is not None:
        stats.update(games_read=0, games_used=0, low_clock_dropped=0, no_clock_info=0, eligible=0)
    for n_games, game in enumerate(iter_games(handle)):
        if cfg.max_games is not None and n_games >= cfg.max_games:
            break
        if stats is not None:
            stats["games_read"] = n_games + 1
        if not game_ok(game, cfg):
            continue
        if stats is not None:
            stats["games_used"] += 1
        for cand in positions_from_game(game, cfg, rng, stats):
            key = (cand.phase, band_of(cand.player_elo, cfg) if cand.player_elo is not None else -1) if cfg.stratify else ()
            pool = pools.setdefault(key, {"res": [], "seen": 0})
            pool["seen"] += 1
            if len(pool["res"]) < quota:
                pool["res"].append(cand)
            else:
                j = rng.randrange(pool["seen"])
                if j < quota:
                    pool["res"][j] = cand
    return [c for key in sorted(pools, key=str) for c in pools[key]["res"]]
