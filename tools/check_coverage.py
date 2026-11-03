"""Fail unless the Python coverage report meets the project thresholds (PROMPT.md 10.1).

Usage: pytest --cov --cov-report=json:coverage.json && python tools/check_coverage.py coverage.json

coverage.py gates only the combined line+branch figure, so lines and branches are checked separately
here. THRESHOLDS ONLY RATCHET UP: raise a number when coverage allows it, never lower one.
"""

import json
import sys

OVERALL_LINES = 90
OVERALL_BRANCHES = 85
FILE_LINES = {  # per-file floor on line coverage
    "pipeline/winpct.py": 100,
    "pipeline/tags.py": 100,
    "pipeline/sampler.py": 100,
}


def pct(covered: int, total: int) -> float:
    return 100.0 if total == 0 else 100.0 * covered / total


def check(report: dict) -> list[str]:
    problems = []
    t = report["totals"]
    lines, branches = pct(t["covered_lines"], t["num_statements"]), pct(t["covered_branches"], t["num_branches"])
    if lines < OVERALL_LINES:
        problems.append(f"overall line coverage {lines:.1f}% < {OVERALL_LINES}%")
    if branches < OVERALL_BRANCHES:
        problems.append(f"overall branch coverage {branches:.1f}% < {OVERALL_BRANCHES}%")
    for name, floor in FILE_LINES.items():
        if name not in report["files"]:
            problems.append(f"{name} is missing from the coverage report")
            continue
        s = report["files"][name]["summary"]
        got = pct(s["covered_lines"], s["num_statements"])
        if got < floor:
            problems.append(f"{name}: {got:.1f}% lines < {floor}%")
    return problems


def main(path: str) -> int:
    with open(path, encoding="utf-8") as fh:
        report = json.load(fh)
    t = report["totals"]
    print(
        f"python coverage: lines {pct(t['covered_lines'], t['num_statements']):.1f}% (>= {OVERALL_LINES}), "
        f"branches {pct(t['covered_branches'], t['num_branches']):.1f}% (>= {OVERALL_BRANCHES})"
    )
    problems = check(report)
    for p in problems:
        print("FAIL:", p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "coverage.json"))
