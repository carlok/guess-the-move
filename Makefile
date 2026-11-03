# Plain-podman wrappers (no compose provider needed). Override with e.g. `make run PORT=9000`.
PODMAN      ?= podman
WEB_IMG     ?= localhost/gtm-web:dev
BUILDER_IMG ?= localhost/gtm-builder:dev
PORT        ?= 8080
IN          ?= $(CURDIR)/data
OUT         ?= $(CURDIR)/web/data
PYTHON      ?= .venv/bin/python

.PHONY: help test web-image builder-image run stop dataset
help:
	@echo "make test            host tests (pytest + node)"
	@echo "make web-image       build $(WEB_IMG)"
	@echo "make run             serve on http://127.0.0.1:$(PORT) (mounts web/data)"
	@echo "make stop"
	@echo "make builder-image   build $(BUILDER_IMG)   (add WITH_MAIA=1 for Maia-2)"
	@echo "make dataset PGN=/in/games.pgn.zst ARGS='--min-elo 1200 --max-elo 2000 --maia none'"
	@echo "   PGN is a path inside $(IN) (mounted at /in) or an http(s) URL"

test:
	$(PYTHON) -m pytest -q
	cd web && npm test

web-image:
	$(PODMAN) build -t $(WEB_IMG) -f containers/web/Containerfile .

builder-image:
	$(PODMAN) build --build-arg WITH_MAIA=$(or $(WITH_MAIA),0) -t $(BUILDER_IMG) -f containers/builder/Containerfile .

run: web-image
	$(PODMAN) run --rm -d --name gtm-web -p 127.0.0.1:$(PORT):8080 \
	  --read-only --tmpfs /tmp --cap-drop=all --security-opt no-new-privileges \
	  -v $(OUT):/usr/share/nginx/html/data:ro,Z $(WEB_IMG)
	@echo "http://127.0.0.1:$(PORT)"

stop:
	-$(PODMAN) stop gtm-web

dataset: builder-image
	@test -n "$(PGN)" || { echo "usage: make dataset PGN=/in/file.pgn.zst|URL [ARGS='...']"; exit 2; }
	mkdir -p $(IN) $(OUT)
	$(PODMAN) run --rm -v $(IN):/in:ro,Z -v $(OUT):/out:Z $(BUILDER_IMG) \
	  --pgn $(PGN) --out /out/positions.json $(ARGS)
