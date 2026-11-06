# SPDX-License-Identifier: AGPL-3.0-or-later
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


def test_the_in_app_credits_name_everything_notice_lists_and_link_to_it():
    html = read("web/index.html")
    credits = html[html.index('id="aboutCredits"'):html.index("</section>", html.index('id="aboutCredits"'))]
    for item in ("cburnett", "Lucide", "Feather", "Stockfish", "Maia-3", "Lichess", "AGPL", "NOTICE"):
        assert item in credits, item
    for licence in ("GPL-3.0", "AGPL-3.0", "GPL-2.0-or-later", "ISC", "MIT", "CC0"):
        assert licence in credits, licence
    assert 'id="sourceLink"' in credits
    assert 'id="authorLink"' in credits and "Carlo Perassi" in credits and "https://github.com/carlok" in credits, "the author and their GitHub"
    assert "2026" in credits, "the year"
    assert "Copyright (C) 2026 Carlo Perassi" in read("NOTICE")


BUYMEACOFFEE = "https://buymeacoffee.com/carlok"
SATISPAY = "https://web.satispay.com/download/qrcode/S6Y-CON--974A8B11-B631-4E2D-8A11-ED1CA5F3749B?locale=it"


def test_the_about_page_and_the_footer_link_to_the_donation_pages_safely():
    html = read("web/index.html")
    about = html[html.index('id="aboutSupport"'):html.index("</section>", html.index('id="aboutSupport"'))]
    footer = html[html.index("<footer>"):html.index("</footer>")]
    for part, ids in ((about, ("coffeeLink", "satispayLink")), (footer, ("footCoffee", "footSatispay"))):
        for url in (BUYMEACOFFEE, SATISPAY):
            assert f'href="{url}"' in part, url
        for id_ in ids:
            tag = re.search(r'<a id="%s"[^>]*>' % id_, part).group(0)
            assert 'rel="noopener noreferrer"' in tag and 'target="_blank"' in tag, id_
    assert "no ads" in about and "never required" in about, "it says plainly that giving is optional"
