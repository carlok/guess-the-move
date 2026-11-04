"""web/classify.js keeps the tier cut-offs in its own constants; the dataset's tags use the same numbers (pipeline/tags.py).
Reading the JS source is crude but it is the only place the two can drift apart unnoticed."""

import re
from pathlib import Path

from pipeline.tags import TagConfig

JS = (Path(__file__).resolve().parent.parent / "web" / "classify.js").read_text(encoding="utf-8")


def const(name: str) -> float:
    m = re.search(rf"\b{name}\s*=\s*([0-9.]+)", JS)
    assert m, f"{name} not found in web/classify.js"
    return float(m.group(1))


def test_the_tier_cut_offs_equal_the_dataset_tag_thresholds():
    cfg = TagConfig()
    assert const("MISTAKE_DROP") == cfg.mistake_drop == 10.0
    assert const("BLUNDER_DROP") == cfg.blunder_drop == 20.0
    assert const("ONLY_MOVE_GAP") == cfg.only_move_gap == 15.0


def test_the_remaining_cut_offs_are_the_documented_ones():
    assert [const(n) for n in ("BEST_EPS", "EXCELLENT_DROP", "GOOD_DROP", "INACCURACY_DROP")] == [0.1, 2.0, 5.0, 5.0]
