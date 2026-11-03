"""Maia at rating anchors: the pipeline module, the builder flag, and tools/add_anchors.py (history replayed from the archive)."""

import io
import json
import sys
from pathlib import Path

import chess
import chess.pgn
import pytest

import pipeline.backends
from dataset_checks import check_dataset
from fakes import FakeEngine, FakeMaia
from pipeline import anchors as A
from pipeline.build_dataset import build_positions, main, resolve_anchors
from pipeline.sampler import Candidate

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import add_anchors as T  # noqa: E402

from test_main import OPERA, STUB, TWO_GAMES, pgn, run  # noqa: E402

FEN = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3"


class RatingAwareMaia(FakeMaia):
    """A distribution that depends on the rating asked for, and records the history it was given."""
    name = "rating-aware"
    uses_history = True

    def __init__(self):
        super().__init__()
        self.calls = []

    def probs(self, fen, elo_self, elo_oppo, history=()):
        self.calls.append((fen, elo_self, elo_oppo, history))
        base = super().probs(fen, 1500, 1500)
        z = {m: p ** (1 + (elo_self - 1000) / 2000) for m, p in base.items()}  # a higher rating sharpens the distribution
        s = sum(z.values())
        return {m: v / s for m, v in z.items()}


def legal(fen):
    return {m.uci() for m in chess.Board(fen).legal_moves}


def test_by_elo_has_one_distribution_per_anchor_with_small_moves_dropped_and_the_opponents_rating_passed_on():
    maia = RatingAwareMaia()
    out = A.by_elo(maia, FEN, 1666, legal(FEN), history=("h1", "h2"))
    assert list(out) == [str(a) for a in A.ANCHORS]
    assert [c[1] for c in maia.calls] == list(A.ANCHORS) and {c[2] for c in maia.calls} == {1666} and {c[3] for c in maia.calls} == {("h1", "h2")}
    for dist in out.values():
        assert dist and all(q >= A.MIN_P for q in dist.values()) and set(dist) <= legal(FEN)
    top = lambda r: max(out[r].values())
    assert top("2200") > top("1000"), "the fake model sharpens with rating, and the anchors keep that"


def test_a_model_without_history_is_not_given_any_and_illegal_moves_fail_loudly():
    out = A.by_elo(FakeMaia(), FEN, 1500, legal(FEN), history=("ignored",), anchors=(1200, 1800))
    assert list(out) == ["1200", "1800"]
    class Bad(FakeMaia):
        def probs(self, fen, a, b):
            return {"a1a1": 1.0}
    with pytest.raises(RuntimeError, match="not legal UCI"):
        A.by_elo(Bad(), FEN, 1500, legal(FEN))
    assert A.describe()["ratings"] == list(A.ANCHORS)


def test_build_positions_stores_by_elo_only_when_asked_and_only_with_maia_data():
    c = Candidate(fen=FEN, real_uci="e4d5", ply=4, move_no=3, color="w", player_elo=1500, opp_elo=1450, site=None)
    (plain,) = build_positions([c], FakeEngine(), RatingAwareMaia(), max_abs_cp=None, drop_trivial=False)
    assert "by_elo" not in plain["maia"]
    maia = RatingAwareMaia()
    (p,) = build_positions([c], FakeEngine(), maia, max_abs_cp=None, drop_trivial=False, anchors=(1000, 2000))
    assert set(p["maia"]["by_elo"]) == {"1000", "2000"} and p["maia"]["elo"] == 1500
    assert {call[2] for call in maia.calls[-2:]} == {1450}, "the real opponent's rating"
    nobody = Candidate(fen=FEN, real_uci="e4d5", ply=4, move_no=3, color="w", player_elo=None, opp_elo=None, site=None)
    (q,) = build_positions([nobody], FakeEngine(), RatingAwareMaia(), max_abs_cp=None, drop_trivial=False, anchors=(1000, 2000))
    assert q["maia"] is None


def test_the_anchors_flag_auto_none_and_a_list():
    assert resolve_anchors("auto", "maia3") == A.ANCHORS
    assert resolve_anchors("auto", "maia2") == () and resolve_anchors("auto", "none") == ()
    assert resolve_anchors("none", "maia3") == () and resolve_anchors("1500,1000,1500", "maia2") == (1000, 1500)
    assert resolve_anchors("1000,1200", "none") == (), "no Maia, no anchors"
    for bad in ("x", "1000", "1000,9999", "-5,1000"):
        with pytest.raises(ValueError):
            resolve_anchors(bad, "maia3")


def test_the_cli_writes_by_elo_and_records_the_anchors_in_the_provenance(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline.backends, "Maia3Backend", lambda model, cache_dir: RatingAwareMaia())
    rc, out = run(tmp_path, "--maia", "maia3", "--maia-anchors", "1100,1900")
    data = json.loads(out.read_text())
    assert rc == 0
    check_dataset(data)
    assert all(set(p["maia"]["by_elo"]) == {"1100", "1900"} for p in data["positions"])
    assert data["meta"]["provenance"]["maia_anchors"]["ratings"] == [1100, 1900]
    rc, out2 = run(tmp_path / "x" if (tmp_path / "x").mkdir() is None else tmp_path, "--maia", "maia3", "--maia-anchors", "none")
    assert "by_elo" not in json.loads(out2.read_text())["positions"][0]["maia"]
    assert json.loads(out2.read_text())["meta"]["provenance"]["maia_anchors"] is None


def test_a_bad_anchors_flag_stops_before_any_work(tmp_path, capsys):
    with pytest.raises(SystemExit):
        run(tmp_path, "--maia", "maia3", "--maia-anchors", "1000")
    assert "--maia-anchors" in capsys.readouterr().err


# ---- tools/add_anchors.py ----

GAME = f'[Event "e"]\n[Site "https://lichess.org/abcd1234"]\n[Result "*"]\n[WhiteElo "1500"]\n[BlackElo "1600"]\n\n{OPERA} *\n\n'


def games_of(text):
    return list(__import__("pipeline.sampler", fromlist=["iter_games"]).iter_games(io.StringIO(text)))


def stored(ply, maia):
    """A dataset position from the OPERA game at `ply`, with Maia's stored distribution made the way the builder makes it."""
    g = games_of(GAME)[0]
    board, earlier = g.board(), []
    for node in g.mainline():
        if board.ply() == ply:
            fen, hist = board.fen(), tuple(earlier[-7:])
            break
        earlier.append(board.fen())
        board.push(node.move)
    pr = {m: round(p, 4) for m, p in maia.probs(fen, 1500, 1600, history=hist).items() if p >= 0.001}
    return {"id": f"{ply:010x}", "fen": fen, "ply": ply, "player_elo": 1500, "opp_elo": 1600, "site": "https://lichess.org/abcd1234",
            "maia": {"elo": 1500, "probs": pr}}, hist


def test_histories_are_the_up_to_seven_earlier_positions_and_the_search_stops_when_all_are_found():
    p3, h3 = stored(3, RatingAwareMaia())
    p10, h10 = stored(10, RatingAwareMaia())
    assert len(h3) == 3 and len(h10) == 7
    many = games_of(GAME + GAME.replace("abcd1234", "zzzz9999") * 5)
    found, read = T.histories(iter(many), {"abcd1234": {3: p3["fen"], 10: p10["fen"]}})
    assert found == {("abcd1234", 3): h3, ("abcd1234", 10): h10} and read == 1, "stopped after the first game"
    _, read_all = T.histories(iter(many), {"nothere": {3: "x"}})
    assert read_all == 6
    _, limited = T.histories(iter(many), {"nothere": {3: "x"}}, limit=2)
    assert limited == 2


def test_a_replayed_position_that_is_not_the_stored_one_is_an_error():
    with pytest.raises(RuntimeError, match="differs from the stored one"):
        T.histories(iter(games_of(GAME)), {"abcd1234": {3: FEN}})


def test_enrich_reproduces_the_stored_probabilities_then_adds_the_anchors():
    maia = RatingAwareMaia()
    p3, h3 = stored(3, maia)
    p10, h10 = stored(10, maia)
    data = {"meta": {"provenance": {}}, "positions": [p3, p10, {"id": "x", "fen": FEN, "ply": 4, "site": None, "maia": None}]}
    st = T.enrich(data, {("abcd1234", 3): h3, ("abcd1234", 10): h10}, maia)
    assert (st["enriched"], st["reproduced"], st["no_maia"], st["no_history"], st["mismatches"]) == (2, 2, 1, 0, [])
    assert st["max_abs_diff"] < T.TOLERANCE
    assert set(p3["maia"]["by_elo"]) == {str(a) for a in A.ANCHORS}
    assert data["meta"]["provenance"]["maia_anchors"]["added_by"].startswith("tools/add_anchors.py")


def test_enrich_refuses_positions_whose_history_does_not_reproduce_the_stored_numbers():
    maia = RatingAwareMaia()
    p10, h10 = stored(10, maia)
    data = {"positions": [p10]}
    st = T.enrich(data, {("abcd1234", 10): h10[:-1] + ("8/8/8/8/8/8/8/K6k w - - 0 1",)}, FakeHistorySensitive())
    assert st["enriched"] == 0 and st["mismatches"] and "by_elo" not in p10["maia"]
    assert T.enrich({"positions": [p10]}, {}, maia)["no_history"] == 1


class FakeHistorySensitive(RatingAwareMaia):
    def probs(self, fen, elo_self, elo_oppo, history=()):
        out = super().probs(fen, elo_self, elo_oppo, history)
        k = next(iter(out))
        out[k] = out[k] / 2 if history and history[-1].startswith("8/8") else out[k]
        return out


def test_main_end_to_end_with_a_fake_model_and_game_source(tmp_path, capsys):
    maia = RatingAwareMaia()
    p, _ = stored(10, maia)
    f = tmp_path / "d.json"
    f.write_text(json.dumps({"schema": 1, "meta": {"provenance": {}}, "positions": [p]}))
    rc = T.main(["--data", str(f), "--pgn", "unused"], maia=maia, games=iter(games_of(GAME)))
    assert rc == 0 and "by_elo" in json.loads(f.read_text())["positions"][0]["maia"]
    assert "recovered history for 1 of 1" in capsys.readouterr().err
    out = tmp_path / "o.json"
    assert T.main(["--data", str(f), "--out", str(out), "--pgn", "unused"], maia=maia, games=iter(games_of(GAME))) == 0 and out.exists()


def test_main_stops_with_an_error_on_no_usable_positions_or_a_mismatch(tmp_path, capsys):
    f = tmp_path / "d.json"
    f.write_text(json.dumps({"positions": [{"id": "a", "fen": FEN, "ply": 4, "site": None, "maia": None}]}))
    assert T.main(["--data", str(f), "--pgn", "x"]) == 1
    maia = RatingAwareMaia()
    p, h = stored(10, maia)
    p["maia"]["probs"] = {m: 1 / len(p["maia"]["probs"]) for m in p["maia"]["probs"]}  # not what the model says
    f.write_text(json.dumps({"positions": [p]}))
    assert T.main(["--data", str(f), "--pgn", "x"], maia=maia, games=iter(games_of(GAME))) == 2
    assert "does not reproduce" in capsys.readouterr().err
    assert T.game_id(None) is None and T.game_id("https://example.org/x") is None and T.game_id("https://lichess.org/abc/") == "abc"


# ---- tools/anchor_probe.py ----

import anchor_probe as PR  # noqa: E402


def test_the_probe_asks_for_anchors_and_for_the_ratings_between_them(tmp_path, capsys):
    assert PR.midpoints((1000, 1300, 1900)) == [1150, 1600]
    maia = RatingAwareMaia()
    pos = [{"id": "a", "fen": FEN, "player_elo": 1500, "opp_elo": 1450, "maia": {"elo": 1500, "probs": {}}},
           {"id": "nomaia", "fen": FEN, "player_elo": None, "opp_elo": None, "maia": None}]
    rows = PR.probe(pos, maia, 10, 1)
    assert [r["id"] for r in rows] == ["a"]
    assert set(rows[0]["by_elo"]) == {str(a) for a in A.ANCHORS} and set(rows[0]["exact"]) == {"1150", "1450", "1750", "2050"}
    assert all(c[3] == () for c in maia.calls), "no history: the same call on both sides of the comparison"
    f = tmp_path / "d.json"
    f.write_text(json.dumps({"positions": pos}))
    out = tmp_path / "p" / "probe.json"
    assert PR.main(["--data", str(f), "--out", str(out), "--n", "5"], maia=maia) == 0 and json.loads(out.read_text())[0]["id"] == "a"
    f.write_text(json.dumps({"positions": [pos[1]]}))
    assert PR.main(["--data", str(f), "--out", str(out)], maia=maia) == 1
    assert "no position with Maia data" in capsys.readouterr().err
