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
EXTRAS = ("pieces.svg", "data/positions.json")  # fetched by the scripts, not referenced by index.html
ATTR = re.compile(r'(<script\b[^>]*\bsrc="|<link\b[^>]*\bhref=")([^"#:?]+\.(?:js|css|svg))(\?[^"]*)?(")')


def local_assets(html: str) -> list[str]:
    """Every local script, style sheet and sprite index.html references, in page order, without duplicates."""
    seen: list[str] = []
    for m in ATTR.finditer(html):
        if m.group(2) not in seen:
            seen.append(m.group(2))
    return seen


def csp_from_nginx() -> str:
    m = re.search(r'Content-Security-Policy "([^"]+)"', NGINX.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("no Content-Security-Policy found in containers/web/nginx.conf")
    return m.group(1)


def meta_csp() -> str:
    """The nginx policy minus the directives a <meta> tag cannot carry."""
    policy = "; ".join(d for d in csp_from_nginx().split("; ") if not d.startswith("frame-ancestors"))
    return f'<meta http-equiv="Content-Security-Policy" content="{policy}">'


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
    shutil.rmtree(out, ignore_errors=True)

    blobs = {a: (src / a).read_bytes() for a in wanted}
    build_id = sha256("\n".join(f"{a}:{sha256(blobs[a])}" for a in sorted(blobs)).encode())[:10]
    stamped = ATTR.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={build_id}{m.group(4)}", html)  # any query already there is replaced
    if with_meta_csp:
        stamped = stamped.replace("<head>", "<head>\n  " + meta_csp(), 1) if "<head>" in stamped else stamped
    blobs["index.html"] = stamped.encode("utf-8")  # what is served differs from the source: hash what is written

    for name, data in blobs.items():
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    files = {a: {"bytes": len(d), "sha256": sha256(d)} for a, d in sorted(blobs.items())}
    (out / "version.json").write_text(json.dumps({"build": build_id, "files": files}, indent=1) + "\n", encoding="utf-8")

    def gz(names) -> int:
        return sum(len(gzip.compress(blobs[n], 9, mtime=0)) for n in names)

    code = [a for a in wanted if a.endswith((".js", ".css"))]
    return {"build": build_id, "files": len(blobs), "bytes": sum(len(d) for d in blobs.values()),
            "code_gzip": gz(code), "data_gzip": gz(["data/positions.json"]), "out": str(out)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "dist")
    ap.add_argument("--meta-csp", action="store_true", help="add the content security policy as a <meta> tag")
    args = ap.parse_args(argv)
    r = build(WEB, args.out, args.meta_csp)
    print(f"dist {r['build']}: {r['files']} files, {r['bytes'] / 1024:.0f} KB; scripts and styles {r['code_gzip'] / 1024:.0f} KB gzipped, "
          f"dataset {r['data_gzip'] / 1024:.0f} KB gzipped -> {r['out']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
