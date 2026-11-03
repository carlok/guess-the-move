"""The repository licence is a deliberate decision; these keep it from drifting by accident."""

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
read = lambda rel: (ROOT / rel).read_text(encoding="utf-8")


def test_licence_is_the_unmodified_agpl_3_text():
    text = read("LICENSE")
    assert text.lstrip().startswith("GNU AFFERO GENERAL PUBLIC LICENSE") and "Version 3, 19 November 2007" in text
    assert hashlib.sha256((ROOT / "LICENSE").read_bytes()).hexdigest() == "8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef", \
        "LICENSE changed: it must stay the verbatim AGPL v3 text"


def test_notice_and_readme_say_which_licence_and_why():
    assert "GNU Affero General Public License, version 3 or (at your option) any later version" in read("NOTICE")
    readme = read("README.md")
    assert re.search(r"^## Licence", readme, flags=re.M) and "AGPL-3.0-or-later" in readme and "Maia-3" in readme.split("## Licence")[1][:600]
    assert "Repo licence not chosen yet" not in readme


def test_every_bundled_third_party_item_is_listed_with_its_licence():
    notice = read("NOTICE")
    for item in ("cburnett", "Lucide", "Feather", "Stockfish", "Maia-3", "Lichess"):
        assert item in notice, item
