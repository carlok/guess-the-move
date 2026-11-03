"""Static checks on the container packaging (no podman or network needed).

What these cannot prove: that the images build and run. That needs a machine that can pull from
a registry; see CONTINUE.md task T1.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
read = lambda rel: (ROOT / rel).read_text(encoding="utf-8")


def copy_sources(containerfile: str):
    for line in containerfile.splitlines():
        m = re.match(r"\s*COPY\s+(?:--\S+\s+)*(.+)\s+\S+\s*$", line)
        if m:
            yield from m.group(1).split()


@pytest.mark.parametrize("name", ["web", "builder"])
def test_containerfile_is_sane(name):
    text = read(f"containers/{name}/Containerfile")
    assert not re.search(r"^HEALTHCHECK", text, flags=re.M), "podman builds OCI images, which ignore HEALTHCHECK; set it at run time"
    froms = re.findall(r"^FROM\s+(\S+)", text, flags=re.M)
    assert froms and all(f.startswith("docker.io/") for f in froms), "use fully-qualified image names"
    for src in copy_sources(text):
        assert (ROOT / src).exists(), f"COPY source missing: {src}"
    ignore = read(".containerignore")
    assert ignore == read(".dockerignore"), "keep the two ignore files identical"
    for src in copy_sources(text):
        top = src.split("/")[0]
        assert not re.search(rf"^{re.escape(top)}/?$", ignore, flags=re.M), f"{src} is excluded by .containerignore"


def test_nginx_csp_matches_what_the_app_needs():
    conf = read("containers/web/nginx.conf")
    lines = [l for l in conf.splitlines() if "Content-Security-Policy" in l and "add_header" in l]
    assert len(lines) == 1, "the CSP must be a single add_header line"
    csp = re.search(r'"(.*)"', lines[0]).group(1)
    for directive in ("default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"):
        assert directive in csp
    assert "unsafe-inline" not in csp and "unsafe-eval" not in csp
    # add_header inside a location would silently drop the server-level security headers
    assert not re.search(r"location[^{]*\{[^}]*add_header", conf), "add_header in a location replaces inherited headers"
    assert "listen 8080;" in conf and "[::]" not in conf  # IPv6 listen fails on hosts without IPv6


def test_web_assets_are_csp_clean():
    html = read("web/index.html")
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html), "inline <script> would be blocked"
    assert not re.search(r"<style\b", html), "inline <style> would be blocked"
    for rel in ("web/index.html", "web/app.js"):
        assert not re.search(r"""\bstyle\s*=\s*["'\\]""", read(rel)), f"inline style= attribute in {rel}"


def test_every_chip_class_has_a_colour():
    css = read("web/style.css")
    for key in ("you", "best", "real", "maia"):
        assert re.search(rf"\.chip-{key}\s*\{{\s*background:\s*#[0-9a-f]{{6}}", css)


def test_compose_file():
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(read("compose.yaml"))
    web, builder = doc["services"]["web"], doc["services"]["builder"]
    assert builder["profiles"] == ["build"], "the builder must not start with `up`"
    assert all(p.startswith("127.0.0.1:") for p in web["ports"]), "bind to loopback by default"
    for svc in (web, builder):
        assert (ROOT / svc["build"]["dockerfile"]).exists()
    assert web["read_only"] is True
    assert "/healthz" in " ".join(web["healthcheck"]["test"]), "health is defined at run time (OCI images ignore HEALTHCHECK)"
    assert set(doc["services"]) == {"web", "builder"}, "api/valkey stay commented out until implemented"


def test_quadlet_unit():
    text = read("deploy/quadlet/guess-the-move-web.container")
    for key in ("Image=", "PublishPort=127.0.0.1:8080:8080", "ReadOnly=true", "Restart=always", "WantedBy=default.target"):
        assert key in text
    assert re.search(r"^HealthCmd=.*/healthz", text, flags=re.M)
    assert text.index("[Unit]") < text.index("[Container]") < text.index("[Service]") < text.index("[Install]")


def test_makefile_run_hardening_and_health():
    run = read("Makefile").split("\nrun:")[1].split("\nstop:")[0]
    for flag in ("--read-only", "--tmpfs /tmp", "--cap-drop=all", "--security-opt no-new-privileges", "--health-cmd"):
        assert flag in run, flag


def test_makefile_targets_exist():
    mk = read("Makefile")
    for t in ("test", "web-image", "builder-image", "run", "stop", "dataset"):
        assert re.search(rf"^{t}:", mk, flags=re.M), t
    assert "\t" in mk  # recipes use tabs


def test_requirements_cover_pipeline_imports():
    reqs = read("requirements.txt").lower()
    assert "chess" in reqs and "zstandard" in reqs
    assert not (ROOT / "requirements-dev.txt").read_text().strip().startswith("chess")
