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
