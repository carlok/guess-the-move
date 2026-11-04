# Contributing

Thanks for looking. This is a small free-software chess trainer; changes are welcome when they keep it small, honest and tested.

## Run it and the tests

```bash
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
(cd web && npm install)
make ci          # Python and JavaScript tests with coverage gates, the browser tests (Chrome), a build of dist/ tested in a browser, and the container check (needs podman)
```

`make test` is the quick loop (pytest and the jsdom tests). The README has the details, and `docs/deploy.md` covers putting `dist/` on a host.

## Rules the project keeps

- **Tests first for logic and data invariants.** A bug fix starts with a test that fails. The coverage gates (`tools/check_coverage.py`, `web/package.json`) only ratchet up.
- **Say what you did not run.** Claims in docs and commit messages are about things that were run; the rest is marked UNTESTED.
- **No inline `style=` or `<script>`.** The page runs under a strict content security policy. Colours come from classes.
- **All user-facing text lives in `web/strings.js`.**
- **No build step for the web app:** classic scripts, no framework. A new script goes in `web/index.html` (the build and the container pick it up from there).
- **Never invent data.** A dataset comes from the pipeline (`pipeline/`), recorded with its provenance.
- **Say what it assumes.** Estimates and classifications state their limits next to the number.

## Making a change

1. Open an issue first for anything bigger than a fix, so we agree on the shape.
2. Branch from `main`, keep the change focused, update `CHANGELOG.md` (and `PROMPT.md` section 14.1 when it records a decision or evidence).
3. Run `make ci`. Open a pull request; the template lists what to confirm.

## Licence

The project is under the GNU Affero General Public License, version 3 or (at your option) any later version (`LICENSE`).
By contributing you agree your contribution is under the same licence. Each source file carries
`SPDX-License-Identifier: AGPL-3.0-or-later` (`python tools/add_spdx.py` adds it). Third-party material and its licences are in `NOTICE`.
Please do not add anything whose licence you have not read.

## Reporting a problem with a position

Every answer card has a "Report a problem with this position" link that opens a pre-filled issue. Wrong evaluations, odd tags and
broken boards are all useful to hear about.
