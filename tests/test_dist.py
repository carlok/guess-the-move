# SPDX-License-Identifier: AGPL-3.0-or-later
"""tools/build_dist.py: the deployable folder contains exactly what the page needs, nothing else, and stays within budget."""

import hashlib
import json
import re
import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import build_dist as D  # noqa: E402

FIRST_LOAD_GZIP_BUDGET = 60 * 1024    # scripts and styles the page loads at the start, gzipped (the budget the Lighthouse run was held to)
CODE_GZIP_BUDGET = 74 * 1024          # all of them, with the parts that load on first use (save image, stats file, stats charts, the worker setup); 72 -> 74 for the minute beep, the Share button and the update-bar check, with the first load well inside its own 60 KB
DATA_GZIP_BUDGET = 1600 * 1024        # the shipped dataset, gzipped


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("dist")
    return out, D.build(D.WEB, out)


def test_dist_has_exactly_the_files_the_page_loads_and_the_two_it_fetches(built):
    out, _ = built
    html = (D.WEB / "index.html").read_text(encoding="utf-8")
    expected = {"index.html", "version.json"} | set(D.EXTRAS) | set(D.local_assets(html))
    present = {str(p.relative_to(out)) for p in out.rglob("*") if p.is_file()}
    assert present == expected
    assert {"app.js", "classify.js", "tierview.js", "share.js", "report.js", "srs.js", "level.js", "style.css"} <= present


def test_no_development_file_can_reach_a_deploy(built):
    out, _ = built
    names = {p.name for p in out.rglob("*")}
    assert not names & {"package.json", "package-lock.json", "playwright.config.js", "node_modules", "test", "e2e", "serve.js", "harness.js"}
    assert not any(n.endswith((".test.js", ".spec.js", ".slow.js")) for n in names)


def test_version_json_lists_every_file_with_its_real_hash_and_a_build_id(built):
    out, r = built
    v = json.loads((out / "version.json").read_text(encoding="utf-8"))
    assert v["build"] == r["build"] and re.fullmatch(r"[0-9a-f]{10}", v["build"])
    assert set(v["files"]) == {str(p.relative_to(out)) for p in out.rglob("*") if p.is_file() and p.name != "version.json"}
    for name, info in v["files"].items():
        data = (out / name).read_bytes()
        assert info["bytes"] == len(data) and info["sha256"] == hashlib.sha256(data).hexdigest(), name


def test_every_script_and_style_reference_carries_the_build_id_so_an_old_cache_cannot_mix_versions(built):
    out, r = built
    html = (out / "index.html").read_text(encoding="utf-8")
    refs = re.findall(r'<(?:script|link)\b[^>]*?(?:src|href)="([^"?]+\.(?:js|css))(\?[^"]*)?"', html)
    assert len(refs) >= 10
    assert all(q == f"?v={r['build']}" for _, q in refs), refs
    assert "pieces.svg" not in html, "the sprite is fetched by the scripts, not referenced here"


def test_rebuilding_leaves_unchanged_files_and_the_folder_alone_and_removes_what_should_not_be_there(tmp_path):
    out = tmp_path / "dist"
    D.build(D.WEB, out)
    stamp = {p: p.stat().st_mtime_ns for p in out.rglob("*") if p.is_file()}
    inode = out.stat().st_ino
    (out / "stale.js").write_text("old")
    (out / "old-dir").mkdir()
    (out / "old-dir" / "x.txt").write_text("old")
    D.build(D.WEB, out)
    assert out.stat().st_ino == inode, "the folder itself is not deleted and recreated"
    assert {p: p.stat().st_mtime_ns for p in out.rglob("*") if p.is_file()} == stamp, "nothing unchanged was rewritten"
    assert not (out / "stale.js").exists() and not (out / "old-dir").exists(), "stale files and folders are removed"


def test_the_worker_is_stamped_with_this_build_and_precaches_exactly_the_urls_the_page_requests(built):
    out, r = built
    sw = (out / "sw.js").read_text(encoding="utf-8")
    assert f"var BUILD = '{r['build']}';" in sw
    assert "var BUILD = '__BUILD__';" not in sw and "var FILES = []; // @FILES@" not in sw, "the placeholders are replaced, not left beside the real values"
    files = json.loads(re.search(r"var FILES = (\[.*?\]);", sw).group(1))
    html = (out / "index.html").read_text(encoding="utf-8")
    assert files[0] == "index.html"
    for asset in D.local_assets(html):
        assert f"{asset}?v={r['build']}" in files, f"{asset}: the page asks for the stamped URL, so that is what must be cached"
    for f in files:
        assert (out / f.split("?")[0]).is_file(), f"{f} is cached but not in dist"
    assert "data/positions.json" in files and "data/first.json" in files and "sw.js" not in "".join(files)
    assert set(re.findall(r"\?v=([0-9a-f]+)", html)) == {r["build"]}, "every stamp in the page is this build's"


def test_the_source_tree_worker_keeps_its_placeholders_so_development_never_meets_a_cache():
    src = (D.WEB / "sw.js").read_text(encoding="utf-8")
    assert "var BUILD = '__BUILD__';" in src and "var FILES = []; // @FILES@" in src


def test_the_build_is_deterministic_and_changes_with_the_content(tmp_path):
    a, b = D.build(D.WEB, tmp_path / "a"), D.build(D.WEB, tmp_path / "b")
    assert a["build"] == b["build"] and (tmp_path / "a" / "index.html").read_bytes() == (tmp_path / "b" / "index.html").read_bytes()
    src = tmp_path / "web"
    src.mkdir()
    for p in D.WEB.iterdir():
        if p.is_file():
            (src / p.name).write_bytes(p.read_bytes())
    (src / "data").mkdir()
    for name in ("positions.json", "first.json"):
        (src / "data" / name).write_bytes((D.WEB / "data" / name).read_bytes())
    (src / "app.js").write_text((D.WEB / "app.js").read_text(encoding="utf-8") + "\n// changed\n", encoding="utf-8")
    assert D.build(src, tmp_path / "c")["build"] != a["build"]


def test_meta_csp_is_the_nginx_policy_without_frame_ancestors_and_is_off_by_default(tmp_path):
    plain = D.build(D.WEB, tmp_path / "plain")
    assert "Content-Security-Policy" not in (tmp_path / "plain" / "index.html").read_text(encoding="utf-8") and plain["files"] > 10
    D.build(D.WEB, tmp_path / "meta", with_meta_csp=True)
    html = (tmp_path / "meta" / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)">', html)
    assert m and m.group(1).startswith("default-src 'self'") and "frame-ancestors" not in m.group(1)
    assert "unsafe-inline" not in m.group(1) and "unsafe-eval" not in m.group(1)
    assert html.index("Content-Security-Policy") < html.index("<script"), "the policy comes before any script"
    nginx = D.csp_from_nginx()
    assert set(m.group(1).split("; ")) == set(nginx.split("; ")) - {"frame-ancestors 'none'"}
    assert '<meta name="referrer" content="no-referrer">' in html, "nginx sends Referrer-Policy: no-referrer; a host without headers gets the meta tag"
    assert 'name="referrer"' not in (tmp_path / "plain" / "index.html").read_text(encoding="utf-8")


def test_pages_build_has_the_meta_policy_and_the_no_api_answer_but_the_same_build_id(tmp_path):
    """A host that only serves files (GitHub Pages): no response headers, and no /api/healthz to ask."""
    plain = D.build(D.WEB, tmp_path / "plain")
    pages = D.build(D.WEB, tmp_path / "pages", pages=True)
    out = tmp_path / "pages"
    html = (out / "index.html").read_text(encoding="utf-8")
    assert "Content-Security-Policy" in html and 'name="referrer"' in html, "pages implies the meta tags"
    assert json.loads((out / "api" / "healthz").read_text(encoding="utf-8")) == {"status": "unavailable"}, "what nginx answers with no api"
    assert not (tmp_path / "plain" / "api").exists(), "the normal build is unchanged: only a host with no api needs the stub"
    version = json.loads((out / "version.json").read_text(encoding="utf-8"))
    assert "api/healthz" not in version["files"], "the stub is not part of the build: the update bar compares builds"
    assert "api/healthz" not in (out / "sw.js").read_text(encoding="utf-8"), "and the worker never caches the api path"
    assert pages["build"] == plain["build"], "the build id comes from the sources, not from the option"
    D.build(D.WEB, tmp_path / "pages", pages=True)  # a rebuild keeps the stub and wipes nothing else
    assert (out / "api" / "healthz").is_file()


def _social_tags(html: str) -> dict[str, str]:
    return dict(re.findall(r'<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)">', html))


def test_pages_build_adds_the_link_preview_tags_and_the_image_but_the_normal_build_does_not(tmp_path):
    """A pasted link shows a card (title, description, picture) only if the page names an absolute address for the picture, and only the
    build for the public site knows that address. The normal build and the container have no tags and no image."""
    D.build(D.WEB, tmp_path / "plain")
    pages = D.build(D.WEB, tmp_path / "pages", pages=True)
    plain_html = (tmp_path / "plain" / "index.html").read_text(encoding="utf-8")
    assert "og:" not in plain_html and "twitter:" not in plain_html and not (tmp_path / "plain" / "og-image.png").exists()

    src = (D.WEB / "index.html").read_text(encoding="utf-8")
    tags = _social_tags((tmp_path / "pages" / "index.html").read_text(encoding="utf-8"))
    site = "https://carlok.github.io/guess-the-move/"
    assert D.PAGES_URL == site
    assert tags["og:type"] == "website" and tags["og:site_name"] == "Guess the Move"
    assert tags["og:url"] == site and tags["og:image"] == site + "og-image.png", "the picture is named by an absolute address: crawlers do not resolve a relative one"
    assert tags["og:title"] == re.search(r"<title>(.*?)</title>", src).group(1), "the card says what the page says"
    assert tags["og:description"] == re.search(r'<meta name="description" content="([^"]*)">', src).group(1)
    assert tags["og:image:alt"] and tags["og:image:type"] == "image/png" and tags["twitter:card"] == "summary_large_image"
    html = (tmp_path / "pages" / "index.html").read_text(encoding="utf-8")
    assert len(html[:html.index('<meta charset="utf-8">')].encode("utf-8")) + len('<meta charset="utf-8">') <= 1024, "the HTML spec wants the encoding declaration inside the first 1024 bytes: the tags go after it"
    assert html.index('<meta property="og:type"') > html.index('<meta name="description"'), "the card tags follow the description, they do not push the page's own head down"

    png = (tmp_path / "pages" / "og-image.png").read_bytes()
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and png == (D.WEB / "og-image.png").read_bytes()
    width, height = struct.unpack(">II", png[16:24])
    assert (width, height) == (1200, 630), "the size the large card is drawn for (1.91:1)"
    assert (tags["og:image:width"], tags["og:image:height"]) == (str(width), str(height)), "the declared size is the real one"
    assert len(png) < 250 * 1024, f"the picture is {len(png) / 1024:.0f} KB: a crawler may give up on a heavy one"

    version = json.loads((tmp_path / "pages" / "version.json").read_text(encoding="utf-8"))
    assert "og-image.png" not in version["files"] and "og-image.png" not in (tmp_path / "pages" / "sw.js").read_text(encoding="utf-8"), "not part of the build, and never precached: the page does not use it"
    assert pages["build"] == D.build(D.WEB, tmp_path / "plain")["build"]


def test_the_public_address_can_be_changed_for_a_fork_and_gets_its_trailing_slash(tmp_path):
    D.build(D.WEB, tmp_path / "fork", pages=True, site_url="https://example.org/play")
    tags = _social_tags((tmp_path / "fork" / "index.html").read_text(encoding="utf-8"))
    assert tags["og:url"] == "https://example.org/play/" and tags["og:image"] == "https://example.org/play/og-image.png"
    assert D.main(["--out", str(tmp_path / "cli"), "--pages", "--site-url", "https://example.org/x/"]) == 0
    assert _social_tags((tmp_path / "cli" / "index.html").read_text(encoding="utf-8"))["og:url"] == "https://example.org/x/"


def test_a_pages_build_without_the_preview_image_stops_and_says_so(tmp_path):
    src = tmp_path / "web"
    src.mkdir()
    for p in D.WEB.iterdir():
        if p.is_file() and p.name != "og-image.png":
            (src / p.name).write_bytes(p.read_bytes())
    (src / "data").mkdir()
    for name in ("positions.json", "first.json"):
        (src / "data" / name).write_bytes((D.WEB / "data" / name).read_bytes())
    D.build(src, tmp_path / "ok")  # the normal build does not need it
    with pytest.raises(SystemExit, match="og-image.png"):
        D.build(src, tmp_path / "pages", pages=True)


def test_it_refuses_to_wipe_a_directory_that_is_not_a_previous_dist_and_reports_missing_files(tmp_path):
    keep = tmp_path / "precious"
    keep.mkdir()
    (keep / "notes.txt").write_text("do not delete")
    with pytest.raises(SystemExit, match="refusing to delete"):
        D.build(D.WEB, keep)
    assert (keep / "notes.txt").exists()
    D.build(D.WEB, tmp_path / "again")
    D.build(D.WEB, tmp_path / "again")  # a previous dist may be rebuilt in place
    broken = tmp_path / "web"
    broken.mkdir()
    (broken / "index.html").write_text('<script src="nope.js"></script><link rel="stylesheet" href="gone.css">')
    with pytest.raises(SystemExit, match="nope.js, gone.css"):
        D.build(broken, tmp_path / "out")


def test_local_assets_finds_scripts_and_styles_in_any_attribute_order_and_ignores_remote_ones():
    html = '<script defer src="a.js"></script><script src="b.js?x=1"></script><link rel="stylesheet" href="c.css"><script src="https://cdn.example/x.js"></script><link href="d.svg" rel="icon"><script defer src="a.js"></script>'
    assert D.local_assets(html) == ["a.js", "b.js", "c.css", "d.svg"]
    stamped = D.ATTR.sub(lambda m: f"{m.group(1)}{m.group(2)}?v=X{m.group(4)}", '<script src="b.js?old=1"></script><script defer src="a.js"></script>')
    assert stamped == '<script src="b.js?v=X"></script><script defer src="a.js?v=X"></script>', "an existing query is replaced, not doubled"


def test_the_shipped_site_is_within_its_size_budgets(built):
    _, r = built
    assert r["first_load_gzip"] <= FIRST_LOAD_GZIP_BUDGET, f"the first load is {r['first_load_gzip'] / 1024:.1f} KB of scripts and styles gzipped"
    assert r["code_gzip"] <= CODE_GZIP_BUDGET, f"scripts and styles are {r['code_gzip'] / 1024:.1f} KB gzipped"
    assert r["data_gzip"] <= DATA_GZIP_BUDGET, f"the dataset is {r['data_gzip'] / 1024:.1f} KB gzipped"


def test_main_builds_and_reports(tmp_path, capsys):
    assert D.main(["--out", str(tmp_path / "d")]) == 0
    assert "files" in capsys.readouterr().err and (tmp_path / "d" / "version.json").exists()


def test_lazy_assets_are_the_scripts_marked_text_lazy_in_any_attribute_order():
    html = ('<script defer src="a.js"></script><script type="text/lazy" src="b.js"></script>'
            '<script src="c.js" type="text/lazy"></script><script type="text/lazy" src="https://x.example/d.js"></script>')
    assert D.lazy_assets(html) == ["b.js", "c.js"]


def test_the_lazy_parts_are_not_in_the_first_load_but_are_built_stamped_and_precached(built):
    out, r = built
    html = (out / "index.html").read_text(encoding="utf-8")
    sw = (out / "sw.js").read_text(encoding="utf-8")
    assert sorted(r["lazy"]) == ["backup.js", "pwa.js", "report.js", "share.js", "statscharts.js"]
    for name in r["lazy"]:
        assert (out / name).is_file()
        assert re.search(r'<script type="text/lazy" src="%s\?v=%s"></script>' % (re.escape(name), r["build"]), html), f"{name} is listed, inert and stamped"
        assert f"{name}?v={r['build']}" in sw, f"{name} is precached, so it works offline"
    assert r["first_load_gzip"] < r["code_gzip"]
    eager = re.findall(r'<script defer src="([^"?]+)', html)
    assert not set(eager) & set(r["lazy"]), "a lazy part is not also loaded at the start"
