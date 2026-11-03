import json

import gen_vectors


def test_committed_vectors_are_exactly_what_the_generator_produces():
    committed = json.loads(gen_vectors.OUT.read_text(encoding="utf-8"))
    assert committed == gen_vectors.build(), "run `python tests/gen_vectors.py` and commit the result"
    assert gen_vectors.OUT.read_text(encoding="utf-8") == gen_vectors.dumps(gen_vectors.build())


def test_generation_is_deterministic():
    assert gen_vectors.build() == gen_vectors.build()
