import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import inspect_dataset as ins  # noqa: E402


def pos(i, elo=1500, phase="opening", tags=(), maia=None, san=None):
    evals = {"e2e4": 10, "d2d4": 5}
    return {"id": f"{i:010x}", "phase": phase, "player_elo": elo, "tags": list(tags), "maia": maia,
            "evals": evals, "san": san or {"e2e4": "e4", "d2d4": "d4"}}


def write(tmp_path, positions, **meta):
    p = tmp_path / "d.json"
    p.write_text(json.dumps({"schema": 1, "meta": {"engine": "x", "nodes": 1, **meta}, "positions": positions}))
    return p


def test_summary_counts_and_clean_exit(tmp_path):
    path = write(tmp_path, [pos(1, 1400, "opening", ["trivial"]), pos(2, 1800, "endgame", maia={"elo": 1800}), pos(3, None)],
                 sampling={"low_clock_dropped": 4}, min_clock_seconds=30)
    r = ins.summarise(path, 1200, 2000)
    assert r["positions"] == 3 and r["phases"] == {"opening": 2, "endgame": 1}
    assert r["elo"] == {"min": 1400, "max": 1800, "mean": 1600} and r["without_elo"] == 1
    assert r["with_maia"] == 1 and r["with_tags"] == 1 and r["tags"] == {"trivial": 1}
    assert r["sampling"] == {"low_clock_dropped": 4} and r["min_clock_seconds"] == 30
    assert r["problems"] == [] and r["mean_legal_moves"] == 2.0
    assert ins.main([str(path), "--min-elo", "1200", "--max-elo", "2000"]) == 0


def test_problems_are_reported_with_exit_code_1(tmp_path, capsys):
    path = write(tmp_path, [pos(1, 1100), pos(1, 2500, san={"e2e4": "e4"})])
    r = ins.summarise(path, 1200, 2000)
    assert set(r["problems"]) == {"evals and san cover different moves", "duplicate ids", "2 ratings outside the requested band"}
    assert ins.main([str(path), "--min-elo", "1200", "--max-elo", "2000"]) == 1


def test_an_empty_dataset_does_not_crash(tmp_path):
    r = ins.summarise(write(tmp_path, []))
    assert r["positions"] == 0 and r["bytes_per_position"] is None and r["elo"] is None
