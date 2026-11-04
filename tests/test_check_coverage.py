# SPDX-License-Identifier: AGPL-3.0-or-later
"""The coverage gate itself needs tests: a gate that cannot fail is worth nothing."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import check_coverage as cc  # noqa: E402


def summary(lines_covered, lines_total, br_covered=0, br_total=0):
    return {"covered_lines": lines_covered, "num_statements": lines_total,
            "covered_branches": br_covered, "num_branches": br_total}


def report(total, **files):
    full = {name: {"summary": summary(100, 100)} for name in cc.FILE_LINES}
    full.update({f"pipeline/{k}.py": {"summary": v} for k, v in files.items()})
    return {"totals": total, "files": full}


GOOD = summary(95, 100, 90, 100)


def test_a_report_at_the_thresholds_passes():
    assert cc.check(report(summary(90, 100, 85, 100))) == []


def test_low_overall_lines_or_branches_fail():
    assert any("line" in p for p in cc.check(report(summary(89, 100, 100, 100))))
    assert any("branch" in p for p in cc.check(report(summary(100, 100, 84, 100))))


def test_the_per_file_floor_fails_below_100_for_the_core_modules():
    problems = cc.check(report(GOOD, winpct=summary(99, 100)))
    assert problems == ["pipeline/winpct.py: 99.0% lines < 100%"]


def test_a_core_module_missing_from_the_report_is_a_failure_not_a_pass():
    r = report(GOOD)
    del r["files"]["pipeline/tags.py"]
    assert cc.check(r) == ["pipeline/tags.py is missing from the coverage report"]


def test_no_branches_counts_as_fully_covered():
    assert cc.pct(0, 0) == 100.0
    assert cc.check(report(summary(100, 100, 0, 0))) == []


def test_main_returns_the_exit_code(tmp_path, capsys):
    ok, bad = tmp_path / "ok.json", tmp_path / "bad.json"
    ok.write_text(json.dumps(report(GOOD)))
    bad.write_text(json.dumps(report(summary(10, 100, 10, 100))))
    assert cc.main(str(ok)) == 0
    assert cc.main(str(bad)) == 1
    assert "FAIL" in capsys.readouterr().err
