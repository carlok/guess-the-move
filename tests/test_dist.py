# SPDX-License-Identifier: AGPL-3.0-or-later
"""tools/build_dist.py: the deployable folder contains exactly what the page needs, nothing else, and stays within budget."""

import hashlib
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import build_dist as D  # noqa: E402

CODE_GZIP_BUDGET = 72 * 1024          # scripts and styles, gzipped; 60 KB until save-image, then 66; the pages, level matching and challenges took it to 68.6 KB measured (lazy-loading share.js and report.js would bring it back down)
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
    assert "data/positions.json" in files and "sw.js" not in "".join(files)
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
    (src / "data" / "positions.json").write_bytes((D.WEB / "data" / "positions.json").read_bytes())
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
    assert r["code_gzip"] <= CODE_GZIP_BUDGET, f"scripts and styles are {r['code_gzip'] / 1024:.1f} KB gzipped"
    assert r["data_gzip"] <= DATA_GZIP_BUDGET, f"the dataset is {r['data_gzip'] / 1024:.1f} KB gzipped"


def test_main_builds_and_reports(tmp_path, capsys):
    assert D.main(["--out", str(tmp_path / "d")]) == 0
    assert "files" in capsys.readouterr().err and (tmp_path / "d" / "version.json").exists()
