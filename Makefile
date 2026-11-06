# Plain-podman wrappers (no compose provider needed). Override with e.g. `make run PORT=9000`.
PODMAN      ?= podman
WEB_IMG     ?= localhost/gtm-web:dev
BUILDER_IMG ?= localhost/gtm-builder:dev
API_IMG     ?= localhost/gtm-api:dev
NET         ?= gtm
MODELS      ?= gtm-models
MAIA        ?= maia3
MAIA_MODEL  ?= maia3-23m
PORT        ?= 8080
WEB_NAME    ?= gtm-web
API_NAME    ?= gtm-api
IN          ?= $(CURDIR)/data
OUT         ?= $(CURDIR)/web/data
PYTHON      ?= .venv/bin/python

.DEFAULT_GOAL := run   # plain `make` serves the site; `make help` lists the targets
.PHONY: help test coverage coverage-python coverage-js containers-check dist dist-check ci mutation e2e lighthouse lighthouse-check web-image builder-image api-image api-weights run run-api stop dataset
help:
	@echo "make test            host tests (pytest + node)"
	@echo "make coverage        tests with coverage; fails below the thresholds (tools/check_coverage.py, web/package.json)"
	@echo "make ci               what GitHub Actions runs: coverage, all tests, browser tests, container checks"
	@echo "make containers-check build the images and probe them (podman)"
	@echo "make mutation        mutation spot-check (mutmut on winpct/tags, Stryker on scoring.js); not a gate"
	@echo "make lighthouse-check Lighthouse on the real build; fails below the budgets (part of make ci)"
	@echo "make lighthouse      Lighthouse mobile run against the container from `make run` (adjust the Chrome path on Linux)"
	@echo "make e2e             browser tests in Chrome; GTM_BASE_URL=http://127.0.0.1:8080 targets a running container"
	@echo "make web-image       build $(WEB_IMG)"
	@echo "make run             (the default: plain `make` does this) serve on http://127.0.0.1:$(PORT) (mounts web/data)"
	@echo "make api-image      build $(API_IMG)   (add WITH_MAIA=1 for Maia-2; then 'make api-weights' once)"
	@echo "make run-api         start the api next to the web container (same network, no published port)"
	@echo "make stop"
	@echo "make builder-image   build $(BUILDER_IMG)   (add WITH_MAIA=1 for Maia-2)"
	@echo "make dataset PGN=/in/games.pgn.zst ARGS='--min-elo 1200 --max-elo 2000 --maia none'"
	@echo "   PGN is a path inside $(IN) (mounted at /in) or an http(s) URL"

test:
	$(PYTHON) -m pytest -q
	cd web && npm test

coverage: coverage-python coverage-js

coverage-python:
	$(PYTHON) -m pytest -q --cov --cov-report=term-missing:skip-covered --cov-report=json:coverage.json
	$(PYTHON) tools/check_coverage.py coverage.json

coverage-js:
	cd web && npm run coverage

# Build the three images and probe them as a user would (needs podman); uses its own tags, names and port.
containers-check:
	tools/containers_check.sh

# Everything the CI workflow runs, in the same order. If `make ci` passes here, the workflow's logic passes there.
ci: coverage-python coverage-js
	cd web && npm test
	cd web && npx playwright test
	$(MAKE) dist-check
	$(MAKE) lighthouse-check
	$(MAKE) containers-check

# Stryker edits web/scoring.js in place and restores it: run on a clean tree (git status).
mutation:
	$(PYTHON) -m pip install -q -r requirements-mutation.txt
	$(PYTHON) -m mutmut run && $(PYTHON) -m mutmut results
	cd web && npx --yes -p @stryker-mutator/core -p @stryker-mutator/tap-runner stryker run stryker.config.json

# Browser tests in real Chrome (web/e2e). GTM_BASE_URL=http://127.0.0.1:8080 targets a running container.
# The static site and nothing else in dist/ (any web host can serve it; see docs/deploy.md). dist-check runs the page,
# CSP and layout browser tests against that folder, so a file missing from it fails here and not in production.
dist:
	$(DISTPY) tools/build_dist.py --out dist

dist-check: dist
	cd web && GTM_ROOT=../dist npx playwright test smoke csp ui pwa

e2e:
	cd web && npx playwright test

# Lighthouse (mobile) on `make dist` with the shipped dataset, served by the tool itself (gzip, like nginx); fails below the budgets in
# tools/lighthouse_check.js. Needs Chrome (CHROME_PATH, or the macOS default). Refresh the kept numbers with
#   node tools/lighthouse_check.js --write docs/lighthouse/summary.json
lighthouse-check: dist
	node tools/lighthouse_check.js

# Lighthouse (mobile) against the running container (`make run`); writes docs/lighthouse/mobile.report.{json,html}.
lighthouse:
	mkdir -p docs/lighthouse
	npx --yes lighthouse http://127.0.0.1:$(PORT)/ --only-categories=performance,accessibility,best-practices \
	  --chrome-path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --chrome-flags="--headless=new" \
	  --output=json --output=html --output-path=docs/lighthouse/mobile --quiet

DISTPY ?= python3   # build_dist.py is standard-library only

web-image: dist
	$(PODMAN) build -t $(WEB_IMG) -f containers/web/Containerfile .

builder-image:
	$(PODMAN) build --build-arg WITH_MAIA=$(or $(WITH_MAIA),0) -t $(BUILDER_IMG) -f containers/builder/Containerfile .

run: web-image
	-$(PODMAN) rm -f $(WEB_NAME)   # a leftover from before a restart or a crashed run would block the name
	@$(PODMAN) network exists $(NET) || $(PODMAN) network create $(NET)
	$(PODMAN) run --rm -d --name $(WEB_NAME) --network $(NET) -p 127.0.0.1:$(PORT):8080 \
	  --read-only --tmpfs /tmp --tmpfs /etc/nginx/conf.d:rw,mode=1777 --cap-drop=all --security-opt no-new-privileges \
	  --health-cmd "wget -q -O /dev/null http://127.0.0.1:8080/healthz" --health-interval 30s --health-timeout 3s \
	  -v $(OUT):/usr/share/nginx/html/data:ro,Z $(WEB_IMG)
	@echo "http://127.0.0.1:$(PORT)"

api-image:
	$(PODMAN) build --build-arg WITH_MAIA=$(or $(WITH_MAIA),0) --build-arg MAIA_MODE=$(if $(filter 1,$(WITH_MAIA)),$(MAIA),none) -t $(API_IMG) -f containers/api/Containerfile .

# One-off: download the Maia weights into the named volume the api reads (maia3: from Hugging Face, size by MAIA_MODEL;
# maia2: about 280 MB from Google Drive, build the image with MAIA=maia2).
api-weights:
	$(PODMAN) run --rm --user 10001 -e HOME=/tmp -v $(MODELS):/models $(API_IMG) \
	  $(if $(filter maia2,$(MAIA)),python -c "from maia2 import model; model.from_pretrained('rapid', 'cpu', '/models')",python -m maia3.cache --model $(MAIA_MODEL) --cache-dir /models)

# The api is never published to the host: only the web container reaches it, over the $(NET) network, at /api/.
# Needs the image from `make api-image` (not a prerequisite: it would rebuild without the arguments you gave there).
run-api:
	-$(PODMAN) rm -f $(API_NAME)
	@$(PODMAN) network exists $(NET) || $(PODMAN) network create $(NET)
	$(PODMAN) run --rm -d --name $(API_NAME) --network $(NET) --network-alias api \
	  --read-only --tmpfs /tmp --cap-drop=all --security-opt no-new-privileges --cpus 2 --memory 2g \
	  -e GTM_API_TRUST_PROXY=1 -v $(MODELS):/models \
	  --health-cmd "python -c \"import urllib.request as u; u.urlopen('http://127.0.0.1:8000/healthz')\"" --health-interval 30s --health-timeout 5s \
	  $(API_IMG)

stop:
	-$(PODMAN) stop $(WEB_NAME)
	-$(PODMAN) stop $(API_NAME)

dataset: builder-image
	@test -n "$(PGN)" || { echo "usage: make dataset PGN=/in/file.pgn.zst|URL [ARGS='...']"; exit 2; }
	mkdir -p $(IN) $(OUT)
	$(PODMAN) run --rm -v $(IN):/in:ro,Z -v $(OUT):/out:Z $(BUILDER_IMG) \
	  --pgn $(PGN) --out /out/positions.json $(ARGS)
