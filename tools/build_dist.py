# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build `dist/`: the static site, and nothing else, ready to be copied to any web host.

    python tools/build_dist.py [--out dist] [--meta-csp]

It copies exactly the files web/index.html loads (scripts, style sheet) plus the two the scripts fetch (pieces.svg and
data/positions.json), so no test, config or node_modules file can leak into a deploy. Every file's SHA-256 goes into
dist/version.json together with a build id (the hash of those hashes, so the same inputs always give the same id), and
the script and style references in the copied index.html get `?v=<build id>`: an old browser cache cannot pair an old app.js
with a new index.html. `--meta-csp` adds the content security policy (the one containers/web/nginx.conf sends) as a <meta>
tag, for hosts that cannot set response headers; browsers ignore `frame-ancestors` there, so it is left out of the tag.
See docs/deploy.md for the headers a host should send.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
NGINX = ROOT / "containers" / "web" / "nginx.conf"
EXTRAS = ("pieces.svg", "data/positions.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "sw.js")  # fetched by the scripts or the browser, not referenced by index.html
ATTR = re.compile(r'(<script\b[^>]*\bsrc="|<link\b[^>]*\bhref=")([^"#:?]+\.(?:js|css|svg|webmanifest|png))(\?[^"]*)?(")')


def local_assets(html: str) -> list[str]:
    """Every local script, style sheet and sprite index.html references, in page order, without duplicates."""
    seen: list[str] = []
    for m in ATTR.finditer(html):
        if m.group(2) not in seen:
            seen.append(m.group(2))
    return seen


SCRIPT_TAG = re.compile(r"<script\b[^>]*>")


def lazy_assets(html: str) -> list[str]:
    """The scripts index.html lists as type="text/lazy": the browser does not fetch or run them, the page loads each when first used.
    They are still built, stamped and precached, so they work offline, but they are not part of the first load."""
    out = []
    for tag in SCRIPT_TAG.findall(html):
        src = re.search(r'\bsrc="([^"#:?]+\.js)', tag)
        if src and re.search(r'\btype="text/lazy"', tag):
            out.append(src.group(1))
    return out


def csp_from_nginx() -> str:
    m = re.search(r'Content-Security-Policy "([^"]+)"', NGINX.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("no Content-Security-Policy found in containers/web/nginx.conf")
    return m.group(1)


def meta_csp() -> str:
    """The nginx policy minus the directives a <meta> tag cannot carry."""
    policy = "; ".join(d for d in csp_from_nginx().split("; ") if not d.startswith("frame-ancestors"))
    return f'<meta http-equiv="Content-Security-Policy" content="{policy}">'


def stamp_worker(source: str, build_id: str, assets: list[str], plain: list[str]) -> str:
    """sw.js with its build id and the exact URLs of this build: the stamped references index.html makes, the page itself, and the rest."""
    files = ["index.html"] + [f"{a}?v={build_id}" for a in assets] + plain
    for marker in ("var BUILD = '__BUILD__';", "var FILES = []; // @FILES@"):
        if marker not in source:
            raise SystemExit(f"sw.js has lost its placeholder: {marker}")
    return source.replace("var BUILD = '__BUILD__';", f"var BUILD = '{build_id}';").replace("var FILES = []; // @FILES@", f"var FILES = {json.dumps(files)};")


def sync(out: Path, blobs: dict[str, bytes]) -> None:
    """Make `out` hold exactly `blobs`: write what is new or different, delete what should not be there, and leave everything
    else (and the directory itself) untouched. Deleting and recreating the folder, as a rebuild once did, left the Podman VM with
    a stale view of it and the next image build could not find dist/."""
    out.mkdir(parents=True, exist_ok=True)
    for name, data in blobs.items():
        target = out / name
        if target.is_file() and target.read_bytes() == data:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    for path in sorted(out.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        rel = str(path.relative_to(out))
        if path.is_file() and rel not in blobs:
            path.unlink()
        elif path.is_dir() and not any(path.iterdir()):
            path.rmdir()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build(src: Path = WEB, out: Path = ROOT / "dist", with_meta_csp: bool = False) -> dict:
    html = (src / "index.html").read_text(encoding="utf-8")
    assets = local_assets(html)
    wanted = ["index.html"] + assets + [e for e in EXTRAS if e not in assets]
    missing = [a for a in wanted if not (src / a).is_file()]
    if missing:
        raise SystemExit(f"index.html needs files that are not there: {', '.join(missing)}")
    if out.exists() and any(out.iterdir()) and not (out / "version.json").exists():
        raise SystemExit(f"{out} is not empty and is not a previous dist: refusing to delete it")
    blobs = {a: (src / a).read_bytes() for a in wanted}
    build_id = sha256("\n".join(f"{a}:{sha256(blobs[a])}" for a in sorted(blobs)).encode())[:10]
    stamped = ATTR.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={build_id}{m.group(4)}", html)  # any query already there is replaced
    if with_meta_csp:
        stamped = stamped.replace("<head>", "<head>\n  " + meta_csp(), 1) if "<head>" in stamped else stamped
    blobs["index.html"] = stamped.encode("utf-8")  # what is served differs from the source: hash what is written
    blobs["sw.js"] = stamp_worker(blobs["sw.js"].decode("utf-8"), build_id, assets, [e for e in wanted if e != "index.html" and e not in assets and e != "sw.js"]).encode("utf-8")

    files = {a: {"bytes": len(d), "sha256": sha256(d)} for a, d in sorted(blobs.items())}
    blobs["version.json"] = (json.dumps({"build": build_id, "files": files}, indent=1) + "\n").encode("utf-8")
    sync(out, blobs)

    def gz(names) -> int:
        return sum(len(gzip.compress(blobs[n], 9, mtime=0)) for n in names)

    code = [a for a in wanted if a.endswith((".js", ".css"))]
    lazy = [a for a in lazy_assets(html) if a in code]
    return {"build": build_id, "files": len(blobs), "bytes": sum(len(d) for d in blobs.values()),
            "code_gzip": gz(code), "first_load_gzip": gz([a for a in code if a not in lazy]), "lazy": lazy,
            "data_gzip": gz(["data/positions.json"]), "out": str(out)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "dist")
    ap.add_argument("--meta-csp", action="store_true", help="add the content security policy as a <meta> tag")
    args = ap.parse_args(argv)
    r = build(WEB, args.out, args.meta_csp)
    print(f"dist {r['build']}: {r['files']} files, {r['bytes'] / 1024:.0f} KB; scripts and styles {r['code_gzip'] / 1024:.0f} KB gzipped "
          f"({r['first_load_gzip'] / 1024:.0f} KB at the first load, {len(r['lazy'])} parts loaded on use), "
          f"dataset {r['data_gzip'] / 1024:.0f} KB gzipped -> {r['out']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
