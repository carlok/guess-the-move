"""Sample candidate positions from PGN files (plain or .zst, e.g. Lichess monthly dumps).

Streaming and memory-bounded: games are read one at a time and a reservoir keeps at
most `limit` candidates, so a multi-GB archive can be sampled with `max_games`.
"""

from __future__ import annotations

import io
import random
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Iterator

import chess
import chess.pgn

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

        req = urllib.request.Request(src, headers={"User-Agent": "guess-the-move/0.1 (pgn sampler)"})
        raw = urllib.request.urlopen(req, timeout=60)
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

    eligible: list[Candidate] = []
    board = game.board()
    for node in game.mainline():
        move = node.move
        color = "w" if board.turn == chess.WHITE else "b"
        player, opp = (w_elo, b_elo) if board.turn == chess.WHITE else (b_elo, w_elo)
        in_ply = cfg.min_ply <= board.ply() <= cfg.max_ply
        in_elo = (
            (cfg.min_elo is None or (player is not None and player >= cfg.min_elo))
            and (cfg.max_elo is None or (player is not None and player <= cfg.max_elo))
        )
        low_clock = False
        if cfg.min_clock_s is not None and in_ply and in_elo:
            clock = node.clock()  # the mover's remaining time after this move
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
                )
            )
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

    If `stats` is given it is filled with games_read / games_used, so callers can notice an
    empty or silently truncated input, and with eligible (positions that passed every filter, before the per-game sample), low_clock_dropped / no_clock_info (positions the clock
    filter removed, and positions it could not judge because the PGN has no clock comments).
    """
    rng = random.Random(seed)
    reservoir: list[Candidate] = []
    seen = 0
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
            seen += 1
            if len(reservoir) < limit:
                reservoir.append(cand)
            else:
                j = rng.randrange(seen)
                if j < limit:
                    reservoir[j] = cand
    return reservoir
