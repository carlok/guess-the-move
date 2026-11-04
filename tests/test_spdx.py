# SPDX-License-Identifier: AGPL-3.0-or-later
"""Every source file says which licence it is under, in one short line (tools/add_spdx.py adds it)."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import add_spdx as S  # noqa: E402


def test_every_source_file_carries_the_licence_line():
    missing = [str(p.relative_to(ROOT)) for p in S.source_files() if not S.has_header(p.read_text(encoding="utf-8"))]
    assert not missing, f"run `python tools/add_spdx.py`: {missing}"


def test_the_file_set_covers_the_whole_project():
    names = {str(p.relative_to(ROOT)) for p in S.source_files()}
    assert {"web/app.js", "web/sw.js", "web/test/app-input.test.js", "web/e2e/features.spec.js", "pipeline/build_dataset.py", "api/app.py",
            "tools/build_dist.py", "tools/level_eval.js", "tools/containers_check.sh", "tests/test_dist.py", "containers/common/install_stockfish.py"} <= names
    assert len(names) > 70


def test_the_header_goes_after_a_shebang_and_is_added_once(tmp_path):
    sh, js = tmp_path / "a.sh", tmp_path / "b.js"
    assert S.with_header(sh, "#!/usr/bin/env bash\necho hi\n") == f"#!/usr/bin/env bash\n# {S.ID}\necho hi\n"
    assert S.with_header(js, "'use strict';\n") == f"// {S.ID}\n'use strict';\n"
    once = S.with_header(js, "'use strict';\n")
    assert S.with_header(js, once) == once
    assert S.with_header(tmp_path / "c.py", '"""doc"""\n').startswith(f"# {S.ID}\n")


def test_check_mode_succeeds_on_a_complete_tree_and_fails_on_a_missing_header(tmp_path, monkeypatch, capsys):
    assert S.main(["--check"]) == 0
    bare = tmp_path / "web"
    bare.mkdir()
    (bare / "x.js").write_text("'use strict';\n")
    monkeypatch.setattr(S, "ROOT", tmp_path)
    assert S.main(["--check"]) == 1 and "missing SPDX header: web/x.js" in capsys.readouterr().err
    assert S.main([]) == 0 and (bare / "x.js").read_text().startswith(f"// {S.ID}\n")
