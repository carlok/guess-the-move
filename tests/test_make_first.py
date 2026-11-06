# SPDX-License-Identifier: AGPL-3.0-or-later
"""tools/make_first.py: the small file the page loads first is a fixed, faithful selection of the shipped dataset."""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import make_first as M  # noqa: E402

SHIPPED = ROOT / "web" / "data" / "positions.json"
FIRST = ROOT / "web" / "data" / "first.json"


def pos(i, phase="middlegame", moves=8, maia=True):
    return {"id": f"{i:010x}", "phase": phase, "evals": {f"a{j}a{j + 1}": 0 for j in range(moves)}, "maia": {"elo": 1500, "by_elo": {"1500": [1]}} if maia else None}


def test_only_positions_the_page_can_use_at_once_are_taken():
    pool = [pos(1, moves=2), pos(2, maia=False), pos(3), {**pos(4), "maia": {"elo": 1500, "by_elo": {}}}, pos(5)]
    assert [p["id"] for p in M.select_first(pool, 10)] == sorted([pos(3)["id"], pos(5)["id"]], key=lambda i: M.order_key({"id": i}))


def test_the_choice_is_fixed_spread_over_the_phases_and_exactly_n_long():
    pool = [pos(i, "opening") for i in range(50)] + [pos(100 + i, "middlegame") for i in range(30)] + [pos(200 + i, "endgame") for i in range(20)]
    a, b = M.select_first(pool, 20), M.select_first(list(reversed(pool)), 20)
    assert [p["id"] for p in a] == [p["id"] for p in b], "the order of the input does not matter"
    assert len(a) == 20
    by = {ph: sum(1 for p in a if p["phase"] == ph) for ph in M.PHASES}
    assert by == {"opening": 10, "middlegame": 6, "endgame": 4}, "the proportions of the pool"
    assert len({p["id"] for p in a}) == 20


def test_fewer_usable_positions_than_asked_gives_all_of_them():
    assert len(M.select_first([pos(1), pos(2)], 24)) == 2
    assert M.select_first([], 24) == []


def test_build_keeps_the_meta_and_says_how_big_the_whole_set_is():
    full = {"schema": 1, "meta": {"built": "2026-01-01", "engine": "x"}, "positions": [pos(i) for i in range(5)]}
    out = M.build(full, 3)
    assert out["schema"] == 1 and out["meta"]["built"] == "2026-01-01" and out["meta"]["partial"] == {"of": 5}
    assert len(out["positions"]) == 3 and "partial" not in full["meta"], "the full file's meta is not touched"


def test_main_writes_the_file_and_reports_it(tmp_path, capsys):
    src = tmp_path / "positions.json"
    src.write_text(json.dumps({"schema": 1, "meta": {}, "positions": [pos(i) for i in range(10)]}), encoding="utf-8")
    out = tmp_path / "first.json"
    assert M.main(["--src", str(src), "--out", str(out), "--n", "4"]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert len(data["positions"]) == 4 and data["meta"]["partial"] == {"of": 10}
    assert "4 of 10 positions" in capsys.readouterr().err


@pytest.mark.skipif(not SHIPPED.exists() or not FIRST.exists(), reason="no dataset built yet")
def test_the_shipped_first_file_is_exactly_what_the_tool_makes_from_the_shipped_dataset():
    full = json.loads(SHIPPED.read_text(encoding="utf-8"))
    first = json.loads(FIRST.read_text(encoding="utf-8"))
    assert first == M.build(full), "positions.json changed: run `python3 tools/make_first.py`"
    by_id = {p["id"]: p for p in full["positions"]}
    assert all(by_id[p["id"]] == p for p in first["positions"]), "every position is copied unchanged"
