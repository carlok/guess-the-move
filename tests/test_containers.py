# SPDX-License-Identifier: AGPL-3.0-or-later
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


@pytest.mark.parametrize("name", ["web", "builder", "api"])
def test_containerfile_is_sane(name):
    text = read(f"containers/{name}/Containerfile")
    assert not re.search(r"^HEALTHCHECK", text, flags=re.M), "podman builds OCI images, which ignore HEALTHCHECK; set it at run time"
    froms = re.findall(r"^FROM\s+(\S+)", text, flags=re.M)
    assert froms and all(f.startswith("docker.io/") for f in froms), "use fully-qualified image names"
    for src in copy_sources(text):
        assert (ROOT / src).exists() or src == "dist/", f"COPY source missing: {src}"  # dist/ is built by `make dist` before the image
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


def local_assets(html: str) -> list[str]:
    """Every local script, stylesheet and sprite index.html loads, whatever the attribute order (`defer` or not)."""
    found = re.findall(r'<script\b[^>]*\bsrc="([^"#:?]+)(?=[?"])', html) + re.findall(r'<link\b[^>]*\bhref="([^"#:?]+\.(?:css|js|svg|webmanifest|png))(?=[?"])', html)
    return sorted(set(found))


def test_the_scanner_and_the_dist_builder_agree_on_what_the_page_loads():
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    import build_dist

    html = read("web/index.html")
    assert set(local_assets(html)) == set(build_dist.local_assets(html)), "two independent scans of index.html must agree"
    assert {"theme.js", "app.js", "sound.js", "stats.js", "backup.js", "level.js", "style.css"} <= set(local_assets(html))
    assert set(local_assets('<script defer src="a.js"></script><script src="b.js"></script><link rel="stylesheet" href="c.css">')) == {"a.js", "b.js", "c.css"}


def test_web_assets_are_csp_clean():
    html = read("web/index.html")
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html), "inline <script> would be blocked"
    assert not re.search(r"<style\b", html), "inline <style> would be blocked"
    for rel in ["web/index.html", "web/pieces.svg"] + [f"web/{a}" for a in local_assets(html) if a.endswith(".js")]:
        assert not re.search(r"""\bstyle\s*=\s*["'\\]""", read(rel)), f"inline style= attribute in {rel}"
    assert len(local_assets(html)) >= 10, "the asset scan found too little: the regex is wrong"
    # the image is the built site: no hand-kept list that a new file can be missing from
    assert "COPY dist/ /usr/share/nginx/html/" in read("containers/web/Containerfile")
    assert re.search(r"^web-image:\s*dist\b", read("Makefile"), flags=re.M), "the image must be built from a fresh dist"


def test_every_chip_class_has_a_colour():
    css = read("web/style.css")
    for key in ("you", "best", "real", "maia"):
        assert re.search(rf"\.chip-{key}\s*\{{\s*background:\s*#[0-9a-f]{{6}}", css)


def test_compose_file():
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(read("compose.yaml"))
    web, builder, api = doc["services"]["web"], doc["services"]["builder"], doc["services"]["api"]
    assert builder["profiles"] == ["build"], "the builder must not start with `up`"
    assert api["profiles"] == ["api"] and doc["services"]["valkey"]["profiles"] == ["cache"], "web alone is what `up` starts"
    assert "ports" not in api and "ports" not in doc["services"]["valkey"], "the api and its cache are never published to the host"
    assert api["read_only"] is True and api["cap_drop"] == ["ALL"] and api["mem_limit"] and api["cpus"], "container limits"
    assert "/healthz" in " ".join(api["healthcheck"]["test"])
    assert "depends_on" not in web, "the static path must not depend on the api"
    assert all(p.startswith("127.0.0.1:") for p in web["ports"]), "bind to loopback by default"
    for svc in (web, builder, api):
        assert (ROOT / svc["build"]["dockerfile"]).exists()
    assert web["read_only"] is True
    assert "/healthz" in " ".join(web["healthcheck"]["test"]), "health is defined at run time (OCI images ignore HEALTHCHECK)"
    assert set(doc["services"]) == {"web", "builder", "api", "valkey"}
    assert "gtm-models" in doc["volumes"]


def test_nginx_proxies_the_api_without_needing_it_at_start():
    conf = read("containers/web/nginx.conf")
    block = re.search(r"location /api/ \{(.*?)\n    \}", conf, flags=re.S).group(1)
    assert "resolver ${NGINX_LOCAL_RESOLVERS}" in block and "set $api_upstream" in block and "proxy_pass $api_upstream;" in block, \
        "a variable upstream, so a missing api host cannot stop nginx from starting"
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in block, "never append to a client-supplied value"
    assert "proxy_set_header Host $http_host;" in block and "client_max_body_size" in block
    assert "add_header" not in block
    health = re.search(r"location = /api/healthz \{(.*?)\n    \}", conf, flags=re.S).group(1)
    assert "error_page 502 503 504 = @api_unavailable;" in health, "no api: answer 200, not an error the browser would log"
    assert "return 200 '{\"status\":\"unavailable\"}';" in conf
    assert "templates/default.conf.template" in read("containers/web/Containerfile")
    assert "NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1" in read("containers/web/Containerfile"), "the entrypoint only fills NGINX_LOCAL_RESOLVERS when asked"


def test_api_container_is_unprivileged_and_does_not_bake_in_weights():
    text = read("containers/api/Containerfile")
    assert re.search(r"^USER 10001", text, flags=re.M) and "\"--factory\"" in text and "api.main:build_app" in text
    assert "HOME=/tmp" in text, "gdown writes a cookie file under $HOME; the user has no home and the root fs is read-only"
    assert "--no-access-log" in text, "the app logs method, path and status itself; nothing else"
    assert "from_pretrained" not in text, "the 280 MB weights belong in the /models volume"


def test_api_quadlet_units_share_a_private_network_with_web():
    web, api = read("deploy/quadlet/guess-the-move-web.container"), read("deploy/quadlet/guess-the-move-api.container")
    assert "Network=gtm.network" in web and "Network=gtm.network" in api and "NetworkAlias=api" in api
    assert "PublishPort" not in api, "the api is not published to the host"
    for key in ("ReadOnly=true", "DropCapability=ALL", "NoNewPrivileges=true", "--memory"):
        assert key in api
    assert re.search(r"^NetworkName=gtm", read("deploy/quadlet/gtm.network"), flags=re.M)


def test_quadlet_unit():
    text = read("deploy/quadlet/guess-the-move-web.container")
    for key in ("Image=", "PublishPort=127.0.0.1:8080:8080", "ReadOnly=true", "Restart=always", "WantedBy=default.target"):
        assert key in text
    assert re.search(r"^HealthCmd=.*/healthz", text, flags=re.M)
    assert text.index("[Unit]") < text.index("[Container]") < text.index("[Service]") < text.index("[Install]")


def test_run_api_does_not_rebuild_the_image_behind_your_back():
    mk = read("Makefile")
    assert re.search(r"^run-api:\s*$", mk, flags=re.M), "a prerequisite would rebuild without the build arguments"


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


def test_run_targets_replace_a_leftover_container_of_the_same_name():
    mk = read("Makefile")
    run = mk.split("\nrun:")[1].split("\napi-image:")[0]
    api = mk.split("\nrun-api:")[1].split("\nstop:")[0]
    assert "rm -f $(WEB_NAME)" in run and run.index("rm -f") < run.index("run --rm"), "after a restart the old container is still there"
    assert "rm -f $(API_NAME)" in api and api.index("rm -f") < api.index("run --rm")


def test_nginx_serves_the_web_manifest_with_its_own_type_without_losing_the_standard_ones():
    conf = read("containers/web/nginx.conf")
    assert "include /etc/nginx/mime.types;" in conf and re.search(r"types\s*\{\s*application/manifest\+json\s+webmanifest;\s*\}", conf)
    assert conf.index("include /etc/nginx/mime.types;") < conf.index("application/manifest+json"), "the include comes first, so the extra type is added to it"


def test_plain_make_runs_the_site():
    mk = read("Makefile")
    assert re.search(r"^\.DEFAULT_GOAL\s*:=\s*run\b", mk, flags=re.M), "plain `make` should serve the site"
