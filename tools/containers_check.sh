#!/usr/bin/env bash
# Build the three images and probe them the way a user would: web + api on a private network, started by the same
# `make run` / `make run-api` targets as in daily use. Needs podman. Uses its own image tags (:ci), container names and port,
# so it does not disturb a stack you are running. Prints one line per check and exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

PODMAN=${PODMAN:-podman}; PORT=${PORT:-18080}; NET=gtm-ci
WEB_IMG=localhost/gtm-web:ci; API_IMG=localhost/gtm-api:ci; BUILDER_IMG=localhost/gtm-builder:ci
ARGS=(PODMAN="$PODMAN" PORT="$PORT" NET="$NET" WEB_IMG="$WEB_IMG" API_IMG="$API_IMG" BUILDER_IMG="$BUILDER_IMG" WEB_NAME=gtm-ci-web API_NAME=gtm-ci-api)
BASE="http://127.0.0.1:$PORT"
tmp=$(mktemp -d)

cleanup() { $PODMAN rm -f gtm-ci-web gtm-ci-api >/dev/null 2>&1 || true; $PODMAN network rm "$NET" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
cleanup
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1" >&2; exit 1; }
check() { local what=$1; shift; if "$@" >/dev/null 2>&1; then ok "$what"; else fail "$what"; fi; }
healthy() { for _ in $(seq 1 60); do [ "$($PODMAN inspect "$1" --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && return 0; sleep 2; done; return 1; }

echo "== build"
make "${ARGS[@]}" web-image builder-image api-image >/dev/null
ok "web, builder and api images build"

echo "== builder"
check "builder --help" $PODMAN run --rm "$BUILDER_IMG" --help
mkdir -p "$tmp/in" "$tmp/out"; cp pipeline/demo_games.pgn "$tmp/in/demo.pgn"
$PODMAN run --rm -v "$tmp/in":/in:ro,Z -v "$tmp/out":/out:Z "$BUILDER_IMG" --pgn /in/demo.pgn --out /out/positions.json \
  --allow-missing-elo --candidates 6 --keep 3 --maia none --min-ply 8 --nodes 20000 --workers 2 >/dev/null 2>&1
python3 - "$tmp/out/positions.json" <<'PY' && ok "builder writes a valid schema-1 dataset with the official Stockfish 19" || fail "builder dataset"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["schema"] == 1 and len(d["positions"]) >= 1 and d["meta"]["provenance"]["engine"]["name"] == "Stockfish 19", d["meta"]
PY

echo "== web"
make "${ARGS[@]}" run >/dev/null 2>&1; healthy gtm-ci-web && ok "web container is healthy (read-only rootfs, cap-drop all)" || fail "web health"
[ "$(curl -fsS "$BASE/healthz")" = ok ] && ok "/healthz" || fail "/healthz"
hdr=$(curl -fsSI "$BASE/")
for h in "content-security-policy: default-src 'self'" "x-content-type-options: nosniff" "referrer-policy: no-referrer"; do
  grep -qi "$h" <<<"$hdr" && ok "header $h" || fail "header $h"
done
dh=$(curl -fsSI -H 'Accept-Encoding: gzip' "$BASE/data/positions.json")
grep -qi 'content-encoding: gzip' <<<"$dh" && grep -qi 'cache-control: no-cache' <<<"$dh" && ok "dataset is gzip-compressed and revalidated" || fail "dataset headers"
# Every script, style sheet and sprite the page loads must be served with the right type: a 404 here is a blank board
# (the page then runs without its scripts), which no header check notices.
assets=$(grep -oE '(src|href)="[^"#:]+\.(js|css|svg)"' web/index.html | cut -d'"' -f2 | sort -u)
[ -n "$assets" ] || fail "no assets found in web/index.html"
for f in $assets; do
  ct=$( { curl -fsSI "$BASE/$f" 2>/dev/null || true; } | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')  # a 404 must reach fail below, not abort here
  case "$f|$ct" in *.js\|*javascript*|*.css\|*text/css*|*.svg\|*svg*) ;; *) fail "asset $f is not served as expected (content-type: ${ct:-none, 404?})";; esac
done
ok "every script, style sheet and sprite index.html references is served with the right type ($(echo "$assets" | wc -l | tr -d ' ') files)"
[ "$(curl -fsS "$BASE/api/healthz")" = '{"status":"unavailable"}' ] && ok "no api yet: /api/healthz answers 200 unavailable (the page stays silent)" || fail "api absent answer"

echo "== api"
make "${ARGS[@]}" run-api >/dev/null 2>&1; healthy gtm-ci-api && ok "api container is healthy" || fail "api health"
curl -fsS "$BASE/api/healthz" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"]=="ok" and d["engine"]=="Stockfish 19", d' && ok "/api/healthz through nginx: Stockfish 19" || fail "api healthz"
FEN='r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
curl -fsS -H 'content-type: application/json' -d "{\"fen\":\"$FEN\",\"nodes\":20000}" "$BASE/api/v1/analyse" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d["evals"])==30 and d["engine"]=="Stockfish 19" and d["maia"] is None, d' \
  && ok "real /v1/analyse: all 30 legal moves evaluated" || fail "analyse"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
[ "$(code -H 'content-type: application/json' -d '{"fen":"nope"}' "$BASE/api/v1/analyse")" = 422 ] && ok "bad FEN -> 422" || fail "bad FEN"
[ "$(code -H 'content-type: application/json' -H 'origin: https://evil.example' -d "{\"fen\":\"$FEN\"}" "$BASE/api/v1/analyse")" = 403 ] && ok "cross-origin POST -> 403" || fail "cross-origin"
head -c 70000 /dev/zero | tr '\0' x > "$tmp/big"
[ "$(code -H 'content-type: application/json' --data-binary @"$tmp/big" "$BASE/api/v1/analyse")" = 413 ] && ok "oversized body -> 413" || fail "oversized"
echo "all container checks passed"
