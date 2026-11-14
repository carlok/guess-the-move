# SPDX-License-Identifier: AGPL-3.0-or-later
"""The files that make the repository welcoming (and safe to open): they exist, say true things, and match the app."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
read = lambda rel: (ROOT / rel).read_text(encoding="utf-8")


def test_contributing_names_the_real_commands_and_the_licence():
    text = read("CONTRIBUTING.md")
    for needle in ("make ci", "make test", "strings.js", "AGPL", "SPDX-License-Identifier: AGPL-3.0-or-later", "python tools/add_spdx.py", "CHANGELOG.md", "SECURITY.md"):
        assert needle in text, needle
    makefile = read("Makefile")
    assert re.search(r"^ci:", makefile, flags=re.M) and re.search(r"^test:", makefile, flags=re.M), "the commands CONTRIBUTING names exist"


def test_security_policy_says_how_to_report_privately_and_publishes_no_address():
    text = read("SECURITY.md")
    assert "private vulnerability reporting" in text
    assert "security/advisories/new" in text
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text), "no personal email address is published"


def test_code_of_conduct_names_the_enforcement_contact():
    text = read("CODE_OF_CONDUCT.md")
    assert "carlo.perassi@gmail.com" in text
    assert "carlok on GitHub" not in text


def test_the_position_issue_form_has_the_fields_the_report_link_fills_in():
    form = read(".github/ISSUE_TEMPLATE/position.yml")
    ids = re.findall(r"^\s+id: (\w+)", form, flags=re.M)
    app = read("web/app.js")
    params = re.findall(r"[?&](\w+)=", re.search(r"issues/new\?template=position\.yml.*", app).group(0))
    assert "template" in params
    for param in ("position", "dataset"):
        assert param in ids and param in params, f"the link fills `{param}` and the form must have a field with that id"


def test_every_issue_form_is_valid_enough_to_load():
    yaml = __import__("pytest").importorskip("yaml")
    for name in ("position.yml", "bug.yml", "config.yml"):
        doc = yaml.safe_load(read(f".github/ISSUE_TEMPLATE/{name}"))
        assert isinstance(doc, dict)
        if name != "config.yml":
            assert doc["name"] and doc["description"] and doc["body"] and all(b["type"] for b in doc["body"])
    assert "make ci" in read(".github/pull_request_template.md")


def test_readme_screenshots_exist_and_every_image_it_shows_is_in_the_repository():
    imgs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", read("README.md"))
    assert len(imgs) >= 4, "the README shows the app"
    for src in imgs:
        assert (ROOT / src).is_file(), src
