"""The dataset CLI end to end: PGN file in, schema-1 JSON out.

The engine is the UCI stub (tests/fixtures/uci_stub.py) and Maia is a fake injected in place of Maia2Backend,
so no Stockfish, torch or network is needed. Real engine / real Maia runs are reported separately.
"""

import json
import runpy
import shlex
import sys
from pathlib import Path

import pytest

import pipeline.backends
from dataset_checks import check_dataset
from fakes import FakeMaia
from pipeline.build_dataset import main

STUB = shlex.join([sys.executable, str(Path(__file__).parent / "fixtures" / "uci_stub.py")])
OPERA = "1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6"  # 16 plies


def pgn(*games):
    out = []
    for event, white, black in games:
        elos = (f'[WhiteElo "{white}"]\n' if white else "") + (f'[BlackElo "{black}"]\n' if black else "")
        out.append(f'[Event "{event}"]\n[Site "https://lichess.org/abcd1234"]\n[Result "*"]\n{elos}\n{OPERA} *\n\n')
    return "".join(out)


TWO_GAMES = pgn(("Rated Rapid game", 1500, 1600), ("Rated Classical game", 1700, 1650))


def run(tmp_path, *extra, text=TWO_GAMES):
    src = tmp_path / "games.pgn"
    src.write_text(text)
    out = tmp_path / "out" / "positions.json"
    argv = ["--pgn", str(src), "--out", str(out), "--engine", STUB, "--nodes", "1000", "--candidates", "20",
            "--keep", "6", "--min-ply", "4", "--per-game", "4", "--max-abs-cp", "100000", "--keep-trivial", *extra]
    return main(argv), out


def test_builds_a_valid_dataset_without_maia(tmp_path, capsys):
    rc, out = run(tmp_path)
    assert rc == 0
    data = json.loads(out.read_text())
    check_dataset(data)
    meta = data["meta"]
    assert (meta["engine"], meta["nodes"], meta["maia"], meta["demo"], meta["seed"]) == ("StubFish 1.0", 1000, None, False, 0)
    assert meta["source"] == "games.pgn" and meta["win_pct_scale"] == "lichess"
    assert 0 < len(data["positions"]) <= 6
    assert all(p["maia"] is None and p["player_elo"] in (1500, 1600, 1700, 1650) for p in data["positions"])
    err = capsys.readouterr().err
    assert "read 2 games (2 passed the game filters)" in err and "analysed" in err and "wrote " in err


def test_a_maia_backend_adds_probabilities_in_the_players_frame(tmp_path, monkeypatch):
    made = []

    class FakeMaia2(FakeMaia):
        def __init__(self, kind="rapid", save_root=None):
            super().__init__()
            self.name = f"fake-maia2-{kind}"
            made.append((kind, save_root))

    monkeypatch.setattr(pipeline.backends, "Maia2Backend", FakeMaia2)
    rc, out = run(tmp_path, "--maia", "maia2", "--maia-kind", "blitz", "--maia-home", str(tmp_path / "w"))
    assert rc == 0 and made == [("blitz", str(tmp_path / "w"))]
    data = json.loads(out.read_text())
    check_dataset(data)
    assert data["meta"]["maia"] == "fake-maia2-blitz"
    assert all(p["maia"]["elo"] == p["player_elo"] for p in data["positions"])


def test_same_seed_same_positions_and_demo_flag(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    _, a = run(tmp_path / "a", "--seed", "7", "--demo")
    _, b = run(tmp_path / "b", "--seed", "7")
    da, db = json.loads(a.read_text()), json.loads(b.read_text())
    assert da["positions"] == db["positions"]
    assert (da["meta"]["demo"], db["meta"]["demo"], da["meta"]["seed"]) == (True, False, 7)


def test_games_without_ratings_need_the_explicit_flag(tmp_path, capsys):
    unrated = pgn(("Casual Rapid game", None, None))
    rc, _ = run(tmp_path, text=unrated)
    assert rc == 1 and "read 1 games (0 passed the game filters)" in capsys.readouterr().err
    (tmp_path / "x").mkdir()
    rc, out = run(tmp_path / "x", "--allow-missing-elo", "--time-controls", "Rapid,Classical", text=unrated)
    data = json.loads(out.read_text())
    assert rc == 0
    check_dataset(data)
    assert all(p["player_elo"] is None and p["maia"] is None for p in data["positions"])


def test_unreadable_source_is_exit_code_2(tmp_path, capsys):
    rc = main(["--pgn", str(tmp_path / "missing.pgn"), "--out", str(tmp_path / "o.json"), "--engine", STUB])
    assert rc == 2 and "cannot read missing.pgn" in capsys.readouterr().err
    assert not (tmp_path / "o.json").exists()


def test_empty_input_is_an_error_not_an_empty_dataset(tmp_path, capsys):
    rc, out = run(tmp_path, text="")
    assert rc == 1 and not out.exists()
    assert "no games read" in capsys.readouterr().err


def test_filters_that_exclude_everything_are_an_error(tmp_path, capsys):
    rc, out = run(tmp_path, "--min-elo", "3000")
    assert rc == 1 and not out.exists()
    assert "no candidates" in capsys.readouterr().err


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
def test_module_entry_point_runs_main(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["build_dataset", "--help"])
    with pytest.raises(SystemExit) as exc:
        runpy.run_module("pipeline.build_dataset", run_name="__main__")
    assert exc.value.code == 0
    assert "--pgn" in capsys.readouterr().out


def clocked(first_clocks):
    moves = "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6".split()
    body = "".join((f"{i // 2 + 1}. " if i % 2 == 0 else "") + f"{m} {{ [%clk {first_clocks.get(i, '0:05:00')}] }} " for i, m in enumerate(moves))
    return f'[Event "Rated Rapid game"]\n[Site "https://lichess.org/abcd1234"]\n[Result "*"]\n[WhiteElo "1500"]\n[BlackElo "1600"]\n\n{body}*\n\n'


def test_low_clock_positions_are_excluded_by_default_and_the_counts_are_recorded(tmp_path, capsys):
    text = clocked({i: "0:00:10" for i in range(8, 16)})  # the last eight plies are played with 10 s left
    rc, out = run(tmp_path, "--per-game", "100", "--candidates", "100", "--keep", "100", text=text)
    data = json.loads(out.read_text())
    assert rc == 0
    assert max(p["ply"] for p in data["positions"]) < 8
    assert data["meta"]["min_clock_seconds"] == 30
    assert data["meta"]["sampling"]["low_clock_dropped"] == 8
    err = capsys.readouterr().err
    assert "8 dropped for low clock" in err and "eligible positions" in err


def test_the_clock_filter_can_be_switched_off_or_tuned(tmp_path):
    text = clocked({i: "0:00:10" for i in range(8, 16)})
    (tmp_path / "off").mkdir()
    rc, out = run(tmp_path / "off", "--per-game", "100", "--candidates", "100", "--keep", "100", "--min-clock-seconds", "0", text=text)
    data = json.loads(out.read_text())
    assert max(p["ply"] for p in data["positions"]) >= 8
    assert data["meta"]["min_clock_seconds"] is None and data["meta"]["sampling"]["low_clock_dropped"] == 0
    (tmp_path / "five").mkdir()
    rc, out = run(tmp_path / "five", "--per-game", "100", "--candidates", "100", "--keep", "100", "--min-clock-seconds", "5", text=text)
    assert max(p["ply"] for p in json.loads(out.read_text())["positions"]) >= 8, "10 s is above a 5 s limit"


def test_maia3_is_given_the_games_earlier_positions_and_named_in_the_meta(tmp_path, monkeypatch):
    seen = []

    class FakeMaia3(FakeMaia):
        uses_history = True

        def __init__(self, model="maia3-5m", cache_dir=None):
            super().__init__()
            self.name = model
            seen.append(("init", model, cache_dir))

        def probs(self, fen, elo_self, elo_oppo, history=()):
            seen.append(("probs", len(history)))
            return super().probs(fen, elo_self, elo_oppo)

    monkeypatch.setattr(pipeline.backends, "Maia3Backend", FakeMaia3)
    rc, out = run(tmp_path, "--maia", "maia3", "--maia-model", "maia3-23m", "--maia-home", str(tmp_path / "hf"))
    assert rc == 0 and seen[0] == ("init", "maia3-23m", str(tmp_path / "hf"))
    data = json.loads(out.read_text())
    check_dataset(data)
    assert data["meta"]["maia"] == "maia3-23m"
    assert max(n for kind, n in seen[1:] if kind == "probs") == 7 and any(n > 0 for kind, n in seen[1:] if kind == "probs")
