# SPDX-License-Identifier: AGPL-3.0-or-later
"""Validates the dataset shipped in web/data against an independent legal-move generator."""
import json
import pathlib

import pytest

from dataset_checks import check_positions, check_schema_and_meta

PATH = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "positions.json"
pytestmark = pytest.mark.skipif(not PATH.exists(), reason="no dataset built yet")


@pytest.fixture(scope="module")
def data():
    return json.loads(PATH.read_text(encoding="utf-8"))


def test_schema_and_meta(data):
    check_schema_and_meta(data)


def test_every_position_is_complete_consistent_and_free_of_personal_data(data):
    check_positions(data)


def test_the_shipped_dataset_carries_the_rating_anchors_the_level_estimate_needs():
    import json
    from pathlib import Path

    from pipeline.anchors import ANCHORS

    data = json.loads((Path(__file__).resolve().parent.parent / "web" / "data" / "positions.json").read_text(encoding="utf-8"))
    if data["meta"].get("demo"):
        return  # the demo set has no Maia data at all
    with_maia = [p for p in data["positions"] if p["maia"]]
    assert with_maia
    for p in with_maia:
        assert set(p["maia"]["by_elo"]) == {str(a) for a in ANCHORS}, p["id"]
        assert all(p["maia"]["by_elo"][str(a)] for a in ANCHORS), "every anchor lists at least one move"
    anchors = data["meta"]["provenance"]["maia_anchors"]
    assert anchors["ratings"] == list(ANCHORS) and "add_anchors" in anchors["added_by"]
