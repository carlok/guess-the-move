# SPDX-License-Identifier: AGPL-3.0-or-later
import json

import gen_attack_vectors as g


def test_committed_attack_vectors_are_exactly_what_the_generator_produces():
    assert g.OUT.read_text(encoding="utf-8") == g.dumps(g.build()), "run `python tests/gen_attack_vectors.py` and commit the result"


def test_generation_is_deterministic_and_covers_hand_made_and_dataset_positions():
    a, b = g.build(), g.build()
    assert a == b and len(a["cases"]) == len(g.HAND) + g.N_DATASET
    start = a["cases"][0]["attackers"]
    assert start["w"]["f3"] == ["e2", "g1", "g2"], "the table is {colour: {square: [attacker squares]}}"
    assert "e4" not in start["w"], "squares nobody attacks are left out"
    assert json.loads(g.OUT.read_text(encoding="utf-8"))["cases"][0]["fen"].startswith("rnbqkbnr/")
