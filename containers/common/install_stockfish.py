# SPDX-License-Identifier: AGPL-3.0-or-later
"""Install the official Stockfish release into /usr/local/bin/stockfish, verifying its SHA-256.

Run during an image build (python is already there, curl and wget are not):
    python install_stockfish.py            # picks the build for this CPU architecture

The release, the file names and the digests are those published on
https://github.com/official-stockfish/Stockfish/releases/tag/sf_19 (read 2026-11-04). To move to a newer release, change
VERSION, TAG and the digests together, and nothing else: the digest of a download that is not listed here is never trusted.
"""

import hashlib
import io
import os
import platform
import shutil
import sys
import tarfile
import urllib.request

VERSION = "19"
TAG = "sf_19"
DIGESTS = {  # asset name -> sha256 published on the release page
    "stockfish-linux-x86-64-universal.tar.gz": "9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f",
    "stockfish-linux-arm64-universal.tar.gz": "fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01",
}
ASSET_FOR_MACHINE = {
    "x86_64": "stockfish-linux-x86-64-universal.tar.gz", "amd64": "stockfish-linux-x86-64-universal.tar.gz",
    "aarch64": "stockfish-linux-arm64-universal.tar.gz", "arm64": "stockfish-linux-arm64-universal.tar.gz",
}


def asset_for(machine: str) -> str:
    try:
        return ASSET_FOR_MACHINE[machine.lower()]
    except KeyError:
        raise SystemExit(f"no official Stockfish {VERSION} build for architecture {machine!r}") from None


def verify(data: bytes, asset: str) -> None:
    got = hashlib.sha256(data).hexdigest()
    if got != DIGESTS[asset]:
        raise SystemExit(f"SHA-256 mismatch for {asset}: expected {DIGESTS[asset]}, got {got}")


def binary_member(tar: tarfile.TarFile) -> tarfile.TarInfo:
    """The engine itself: the one executable regular file whose name starts with 'stockfish' and has no extension."""
    files = [m for m in tar.getmembers() if m.isfile() and os.path.basename(m.name).startswith("stockfish") and "." not in os.path.basename(m.name)]
    if len(files) != 1:
        raise SystemExit(f"expected one stockfish binary in the archive, found {[m.name for m in files]}")
    return files[0]


def install(data: bytes, asset: str, dest: str) -> None:
    verify(data, asset)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        member = binary_member(tar)
        with tar.extractfile(member) as src, open(dest, "wb") as out:
            shutil.copyfileobj(src, out)
    os.chmod(dest, 0o755)


def main(dest: str = "/usr/local/bin/stockfish") -> None:
    asset = asset_for(platform.machine())
    url = f"https://github.com/official-stockfish/Stockfish/releases/download/{TAG}/{asset}"
    print(f"downloading {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=300) as r:
        data = r.read()
    install(data, asset, dest)
    print(f"installed Stockfish {VERSION} ({asset}) at {dest}", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:])
