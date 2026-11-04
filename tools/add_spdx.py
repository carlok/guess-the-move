# SPDX-License-Identifier: AGPL-3.0-or-later
"""Put `SPDX-License-Identifier: AGPL-3.0-or-later` on the first line of every source file of the project (after a shebang).

    python tools/add_spdx.py            # add what is missing
    python tools/add_spdx.py --check    # list what is missing, exit 1 if anything (tests/test_spdx.py does the same)

The copyright holder is named once, in NOTICE; a single short line per file keeps the shipped scripts small. Idempotent."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ID = "SPDX-License-Identifier: AGPL-3.0-or-later"
PATTERNS = ("web/*.js", "web/test/*.js", "web/e2e/*.js", "pipeline/*.py", "api/*.py", "tools/*.py", "tools/*.js", "tools/*.sh",
            "tests/*.py", "tests/fixtures/*.py", "containers/common/*.py")


def source_files() -> list[Path]:
    return sorted({p for pattern in PATTERNS for p in ROOT.glob(pattern) if p.is_file()})


def has_header(text: str) -> bool:
    return ID in "\n".join(text.splitlines()[:3])


def comment(path: Path) -> str:
    return f"// {ID}\n" if path.suffix == ".js" else f"# {ID}\n"


def with_header(path: Path, text: str) -> str:
    if has_header(text):
        return text
    if text.startswith("#!"):  # a shebang must stay on the first line
        first, _, rest = text.partition("\n")
        return first + "\n" + comment(path) + rest
    return comment(path) + text


def main(argv: list[str] | None = None) -> int:
    check = "--check" in (argv if argv is not None else sys.argv[1:])
    missing = [p for p in source_files() if not has_header(p.read_text(encoding="utf-8"))]
    if check:
        for p in missing:
            print(f"missing SPDX header: {p.relative_to(ROOT)}", file=sys.stderr)
        return 1 if missing else 0
    for p in missing:
        p.write_text(with_header(p, p.read_text(encoding="utf-8")), encoding="utf-8")
    print(f"added the header to {len(missing)} files", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
