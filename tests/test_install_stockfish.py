"""The image-build helper that installs the official Stockfish: it must refuse anything it cannot verify."""

import hashlib
import io
import re
import sys
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "containers" / "common"))

import install_stockfish as ins  # noqa: E402


def archive(binary=b"#!engine", extra=()):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in [("stockfish/stockfish-linux-test", binary), ("stockfish/Copying.txt", b"gpl"), ("stockfish/src/Makefile", b"all:"), *extra]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_the_published_digests_cover_exactly_the_architectures_we_build_for():
    assert set(ins.DIGESTS) == {"stockfish-linux-x86-64-universal.tar.gz", "stockfish-linux-arm64-universal.tar.gz"}
    assert all(re.fullmatch(r"[0-9a-f]{64}", d) for d in ins.DIGESTS.values())
    assert ins.asset_for("x86_64") == ins.asset_for("AMD64") == "stockfish-linux-x86-64-universal.tar.gz"
    assert ins.asset_for("aarch64") == ins.asset_for("arm64") == "stockfish-linux-arm64-universal.tar.gz"
    with pytest.raises(SystemExit, match="no official Stockfish"):
        ins.asset_for("ppc64le")


def test_a_download_with_the_wrong_digest_is_refused_and_nothing_is_written(tmp_path):
    dest = tmp_path / "stockfish"
    with pytest.raises(SystemExit, match="SHA-256 mismatch"):
        ins.install(archive(), "stockfish-linux-arm64-universal.tar.gz", str(dest))
    assert not dest.exists()


def test_a_verified_archive_installs_only_the_engine_and_makes_it_executable(tmp_path, monkeypatch):
    data = archive(binary=b"ENGINE-BYTES")
    monkeypatch.setitem(ins.DIGESTS, "stockfish-linux-arm64-universal.tar.gz", hashlib.sha256(data).hexdigest())
    dest = tmp_path / "stockfish"
    ins.install(data, "stockfish-linux-arm64-universal.tar.gz", str(dest))
    assert dest.read_bytes() == b"ENGINE-BYTES" and dest.stat().st_mode & 0o111 == 0o111


def test_an_archive_without_exactly_one_engine_is_refused(tmp_path, monkeypatch):
    for extra, what in (([("stockfish/stockfish-other", b"x")], "two engines"),):
        data = archive(extra=extra)
        monkeypatch.setitem(ins.DIGESTS, "stockfish-linux-arm64-universal.tar.gz", hashlib.sha256(data).hexdigest())
        with pytest.raises(SystemExit, match="expected one stockfish binary"):
            ins.install(data, "stockfish-linux-arm64-universal.tar.gz", str(tmp_path / "sf"))
    empty = io.BytesIO()
    with tarfile.open(fileobj=empty, mode="w:gz") as tar:
        info = tarfile.TarInfo("stockfish/README.md")
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))
    data = empty.getvalue()
    monkeypatch.setitem(ins.DIGESTS, "stockfish-linux-arm64-universal.tar.gz", hashlib.sha256(data).hexdigest())
    with pytest.raises(SystemExit, match="expected one stockfish binary"):
        ins.install(data, "stockfish-linux-arm64-universal.tar.gz", str(tmp_path / "sf"))


def test_main_downloads_the_release_asset_for_this_machine_and_verifies_it(tmp_path, monkeypatch):
    data = archive(binary=b"E")
    asset = ins.asset_for("aarch64")
    monkeypatch.setitem(ins.DIGESTS, asset, hashlib.sha256(data).hexdigest())
    monkeypatch.setattr(ins.platform, "machine", lambda: "aarch64")
    seen = []

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(ins.urllib.request, "urlopen", lambda url, timeout: seen.append(url) or Resp(data))
    ins.main(str(tmp_path / "stockfish"))
    assert seen == [f"https://github.com/official-stockfish/Stockfish/releases/download/sf_19/{asset}"]
    assert (tmp_path / "stockfish").read_bytes() == b"E"


def test_the_images_install_the_official_build_instead_of_the_distribution_package():
    for name in ("builder", "api"):
        text = (ROOT / f"containers/{name}/Containerfile").read_text()
        assert "install_stockfish.py" in text, name
        assert not re.search(r"apt-get install[^\n]*stockfish", text), f"{name} must not use Debian's older Stockfish"
        assert "/usr/local/bin/stockfish" in text and "/usr/games/stockfish" not in text.replace("# ", "")
