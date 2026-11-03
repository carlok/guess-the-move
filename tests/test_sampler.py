import io
import random

import chess.pgn
import zstandard

from pipeline.sampler import SamplerConfig, game_ok, open_text, sample_candidates

OPERA = "1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6"  # 16 plies


def game(event="Rated Rapid game", white=1500, black=1600, extra=""):
    elos = ""
    if white is not None:
        elos += f'[WhiteElo "{white}"]\n'
    if black is not None:
        elos += f'[BlackElo "{black}"]\n'
    return (
        f'[Event "{event}"]\n[Site "https://lichess.org/abcd1234"]\n[Result "*"]\n{elos}{extra}\n{OPERA} *\n\n'
    )


def sample(text, **kw):
    limit = kw.pop("limit", 100)
    seed = kw.pop("seed", 0)
    return sample_candidates(io.StringIO(text), SamplerConfig(**kw), limit, seed)


def test_basic_sampling_and_fields():
    cands = sample(game(), per_game=100, min_ply=0)
    assert len(cands) == 16
    c = cands[0]
    assert c.ply == 0 and c.color == "w" and c.real_uci == "e2e4"
    assert (c.player_elo, c.opp_elo) == (1500, 1600)
    assert c.site == "https://lichess.org/abcd1234"
    black = next(x for x in cands if x.ply == 1)
    assert black.color == "b" and (black.player_elo, black.opp_elo) == (1600, 1500)


def test_ply_window_and_per_game_limit():
    cands = sample(game(), per_game=3, min_ply=8, max_ply=12)
    assert len(cands) == 3 and all(8 <= c.ply <= 12 for c in cands)


def test_elo_and_time_control_filters():
    text = game(white=1100, black=1100) + game(white=1800, black=1800, event="Rated Blitz game") + game(white=1800, black=1800)
    assert len(sample(text, per_game=1, min_ply=0, min_elo=1500)) == 2
    both = sample(text, per_game=1, min_ply=0, min_elo=1500, time_controls=frozenset({"Rapid"}))
    assert len(both) == 1 and both[0].player_elo == 1800


def test_missing_elo_policy():
    text = game(white=None, black=None)
    assert sample(text, per_game=2) == []
    assert len(sample(text, per_game=2, require_elo=False)) == 2


def test_abandoned_games_skipped():
    g = chess.pgn.read_game(io.StringIO(game(extra='[Termination "Abandoned"]\n')))
    assert not game_ok(g, SamplerConfig())


def test_deterministic_for_seed_and_reservoir_bound():
    text = "".join(game() for _ in range(10))
    a = sample(text, per_game=2, limit=5, seed=7)
    b = sample(text, per_game=2, limit=5, seed=7)
    c = sample(text, per_game=2, limit=5, seed=8)
    assert len(a) == 5 and a == b and a != c


def test_zst_roundtrip(tmp_path):
    p = tmp_path / "games.pgn.zst"
    p.write_bytes(zstandard.ZstdCompressor().compress((game() + game()).encode()))
    with open_text(p) as fh:
        cands = sample_candidates(fh, SamplerConfig(per_game=2), 100, 0)
    assert len(cands) == 4


def test_max_games():
    text = "".join(game() for _ in range(5))
    assert len(sample(text, per_game=1, max_games=2)) == 2


# ---- streaming from a URL, and stats -------------------------------------------------------------
import functools
import http.server
import threading


def _serve(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_stats_report_games_read_and_used():
    stats = {}
    text = game() + game(white=None, black=None) + game()
    sample_candidates(io.StringIO(text), SamplerConfig(per_game=1), 100, 0, stats)
    assert stats == {"games_read": 3, "games_used": 2, "low_clock_dropped": 0, "no_clock_info": 0, "eligible": 16}  # 2 games x plies 8..15
    stats = {}
    sample_candidates(io.StringIO(""), SamplerConfig(), 100, 0, stats)
    assert stats == {"games_read": 0, "games_used": 0, "low_clock_dropped": 0, "no_clock_info": 0, "eligible": 0}


def test_stream_zst_from_url_and_stop_early(tmp_path, monkeypatch):
    monkeypatch.setenv("no_proxy", "127.0.0.1,localhost")
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    (tmp_path / "g.pgn.zst").write_bytes(zstandard.ZstdCompressor().compress(("".join(game() for _ in range(20))).encode()))
    (tmp_path / "plain.pgn").write_text(game() + game())
    srv = _serve(tmp_path)
    try:
        base = f"http://127.0.0.1:{srv.server_port}"
        stats = {}
        with open_text(f"{base}/g.pgn.zst?x=1") as fh:
            cands = sample_candidates(fh, SamplerConfig(per_game=1, max_games=3), 100, 0, stats)
        assert len(cands) == 3 and stats["games_read"] == 3
        with open_text(f"{base}/plain.pgn") as fh:
            assert len(sample_candidates(fh, SamplerConfig(per_game=2), 100, 0)) == 4
    finally:
        srv.shutdown()


def test_source_label():
    from pipeline.build_dataset import source_label

    assert source_label("https://database.lichess.org/standard/lichess_db_2026-09.pgn.zst?x=1") == "lichess_db_2026-09.pgn.zst"
    assert source_label("/data/games.pgn") == "games.pgn"


def test_cli_reports_unreadable_sources_without_a_traceback(tmp_path, capsys, monkeypatch):
    from pipeline.build_dataset import main

    monkeypatch.setenv("no_proxy", "127.0.0.1,localhost")
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    srv = _serve(tmp_path)  # serves an empty directory: every URL is a 404
    try:
        assert main(["--pgn", f"http://127.0.0.1:{srv.server_port}/nope.pgn", "--out", str(tmp_path / "o.json")]) == 2
    finally:
        srv.shutdown()
    assert main(["--pgn", str(tmp_path / "missing.pgn"), "--out", str(tmp_path / "o.json")]) == 2
    err = capsys.readouterr().err
    assert "cannot read nope.pgn" in err and "cannot read missing.pgn" in err and "Traceback" not in err
    empty = tmp_path / "empty.pgn"
    empty.write_text("")
    assert main(["--pgn", str(empty), "--out", str(tmp_path / "o.json")]) == 1
    assert "no games read" in capsys.readouterr().err


# --- low-clock exclusion (T2) --------------------------------------------------------------------------------------

MOVES = "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6".split()  # the same 16 plies as OPERA


def clocked_game(clocks, event="Rated Rapid game", white=1500, black=1600):
    """`clocks` maps a ply (0 = White's first move) to its [%clk] text; plies not listed get a comfortable 0:05:00."""
    text = ""
    for ply, san in enumerate(MOVES):
        if ply % 2 == 0:
            text += f"{ply // 2 + 1}. "
        text += f"{san} {{ [%clk {clocks.get(ply, '0:05:00')}] }} "
    return (f'[Event "{event}"]\n[Site "https://lichess.org/abcd1234"]\n[Result "*"]\n'
            f'[WhiteElo "{white}"]\n[BlackElo "{black}"]\n\n{text}*\n\n')


def sample_stats(text, **kw):
    stats = {}
    cands = sample_candidates(io.StringIO(text), SamplerConfig(per_game=100, min_ply=0, **kw), 100, 0, stats)
    return cands, stats


def test_a_position_is_dropped_when_the_mover_ends_it_under_the_clock_limit():
    cands, stats = sample_stats(clocked_game({12: "0:00:20", 13: "0:00:45"}), min_clock_s=30)
    plies = {c.ply for c in cands}
    assert 12 not in plies, "White had 20 s left after Qb3"
    assert 13 in plies, "Black still had 45 s after Qe7: the clock is the mover's own"
    assert len(cands) == 15 and stats["low_clock_dropped"] == 1 and stats["no_clock_info"] == 0
    assert stats["eligible"] == 15, "positions that passed every filter, before the per-game sample"


def test_the_clock_limit_is_exclusive_and_takes_fractions_of_a_second():
    cands, _ = sample_stats(clocked_game({12: "0:00:30", 13: "0:00:29.5"}), min_clock_s=30)
    plies = {c.ply for c in cands}
    assert 12 in plies and 13 not in plies


def test_without_a_limit_nothing_is_dropped_and_nothing_is_counted():
    cands, stats = sample_stats(clocked_game({12: "0:00:01"}), min_clock_s=None)
    assert len(cands) == 16 and stats["low_clock_dropped"] == 0 and stats["no_clock_info"] == 0 and stats["eligible"] == 16


def test_positions_without_clock_comments_are_kept_and_counted_when_the_limit_is_on():
    cands, stats = sample_stats(game(), min_clock_s=30)  # plain PGN, no [%clk]
    assert len(cands) == 16 and stats["low_clock_dropped"] == 0 and stats["no_clock_info"] == 16


def test_clock_stats_accumulate_over_games_and_reset_per_call():
    text = clocked_game({12: "0:00:10"}) + clocked_game({2: "0:00:05", 4: "0:00:05"})
    _, stats = sample_stats(text, min_clock_s=30)
    assert stats["low_clock_dropped"] == 3


def test_the_clock_filter_works_when_the_caller_passes_no_stats():
    from pipeline.sampler import positions_from_game

    cfg = SamplerConfig(per_game=100, min_ply=0, min_clock_s=30)
    low = chess.pgn.read_game(io.StringIO(clocked_game({12: "0:00:20"})))
    assert 12 not in {c.ply for c in positions_from_game(low, cfg, random.Random(0))}
    plain = chess.pgn.read_game(io.StringIO(game()))
    assert len(positions_from_game(plain, cfg, random.Random(0))) == 16


# --- previous positions, for models that read the recent history (Maia-3) ------------------------------------------------


def test_candidates_carry_up_to_seven_previous_positions_oldest_first():
    cands = sample(game(), per_game=100, min_ply=0)
    by_ply = {c.ply: c for c in cands}
    assert by_ply[0].history == ()
    assert len(by_ply[3].history) == 3 and by_ply[3].history[-1] == by_ply[2].fen and by_ply[3].history[0] == by_ply[0].fen
    assert len(by_ply[12].history) == 7, "the model reads at most 8 positions: the current one and seven before it"
    assert by_ply[12].history[-1] == by_ply[11].fen and by_ply[12].history[0] == by_ply[5].fen


# --- stratified sampling: equal shares of each phase x rating band instead of the population's skew -----------------------


def long_game(white, black, plies_text):
    return (f'[Event "Rated Rapid game"]\n[Site "https://lichess.org/abcd1234"]\n[Result "*"]\n'
            f'[WhiteElo "{white}"]\n[BlackElo "{black}"]\n\n{plies_text} *\n\n')


# 16 opening plies, so with min_ply=8 every eligible position of this game is "opening"
OPENING = "1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6"


def test_candidates_know_their_phase():
    cands = sample(game(), per_game=100, min_ply=0)
    assert {c.phase for c in cands} == {"opening"}


def test_band_of_groups_ratings_in_200_point_bands_and_folds_the_top_edge_in():
    from pipeline.sampler import band_of

    cfg = SamplerConfig(min_elo=1200, max_elo=2000)
    assert [band_of(e, cfg) for e in (1200, 1399, 1400, 1999, 2000)] == [1200, 1200, 1400, 1800, 1800]
    assert band_of(2431, SamplerConfig()) == 2400


def test_stratified_sampling_gives_each_band_its_share_however_unbalanced_the_input():
    # 30 games at ~1300 and 3 games at ~1900: a plain reservoir of 8 would be almost all 1300
    text = "".join(long_game(1300, 1300, OPENING) for _ in range(30)) + "".join(long_game(1900, 1900, OPENING) for _ in range(3))
    cfg = SamplerConfig(min_elo=1200, max_elo=2000, per_game=2, stratify=True, n_strata=2)
    cands = sample_candidates(io.StringIO(text), cfg, 8, 0)
    low, high = [c for c in cands if c.player_elo < 1600], [c for c in cands if c.player_elo >= 1600]
    assert len(cands) == 8 and len(low) == 4 and len(high) == 4
    plain = sample_candidates(io.StringIO(text), SamplerConfig(min_elo=1200, max_elo=2000, per_game=2), 8, 0)
    assert sum(1 for c in plain if c.player_elo >= 1600) < 4, "without stratification the rare band is under-represented"


def test_stratified_sampling_is_deterministic_for_a_seed_and_never_exceeds_the_limit():
    text = "".join(long_game(1300 + 20 * i, 1500, OPENING) for i in range(20))
    cfg = SamplerConfig(min_elo=1200, max_elo=2000, per_game=2, stratify=True, n_strata=4)
    a = sample_candidates(io.StringIO(text), cfg, 6, 5)
    assert a == sample_candidates(io.StringIO(text), cfg, 6, 5)
    assert len(a) <= 6 * 1 + 4  # quota per stratum is ceil(limit / n_strata)
