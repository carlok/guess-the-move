# SPDX-License-Identifier: AGPL-3.0-or-later
"""Static checks on the CI workflow: that it only calls things that exist, and stays least-privilege."""

import re
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")
ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


@pytest.fixture(scope="module")
def wf():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_triggers_and_least_privilege(wf):
    triggers = wf.get("on", wf.get(True))  # YAML reads a bare `on` as the boolean True
    assert {"push", "pull_request", "workflow_dispatch"} <= set(triggers)
    assert wf["permissions"] == {"contents": "read"}, "the workflow needs to read the code and nothing else"
    assert "secrets." not in WORKFLOW.read_text(), "no secrets are needed, so none are used"
    assert "pull_request_target" not in WORKFLOW.read_text()


def test_every_make_target_the_workflow_calls_exists(wf):
    makefile = (ROOT / "Makefile").read_text()
    targets = set(re.findall(r"^([a-z][a-z-]*):", makefile, flags=re.M))
    called = {t for job in wf["jobs"].values() for step in job["steps"] for t in re.findall(r"\bmake ([a-z-]+)", step.get("run", ""))}
    assert called and called <= targets, called - targets


def test_ci_runs_the_same_steps_as_make_ci(wf):
    ci = re.search(r"^ci:(.*?)(?=^\S)", (ROOT / "Makefile").read_text(), flags=re.M | re.S).group(0)
    for needed in ("coverage-python", "coverage-js", "npm test", "playwright test", "lighthouse-check", "containers-check"):
        assert needed in ci, needed
    workflow_text = WORKFLOW.read_text()
    for needed in ("make coverage-python", "make coverage-js", "npm test", "npx playwright test", "make lighthouse-check", "make containers-check"):
        assert needed in workflow_text, needed


def test_actions_are_pinned_to_a_version_and_jobs_have_timeouts(wf):
    for job in wf["jobs"].values():
        assert job["timeout-minutes"] <= 30
        for step in job["steps"]:
            if "uses" in step:
                assert re.fullmatch(r"[\w.-]+/[\w.-]+@v\d+", step["uses"]), step["uses"]


def test_the_container_check_script_is_executable_and_strict():
    script = ROOT / "tools" / "containers_check.sh"
    assert script.stat().st_mode & 0o111, "chmod +x"
    text = script.read_text()
    assert "set -euo pipefail" in text and "trap cleanup EXIT" in text
    assert "Stockfish 19" in text, "it must notice an engine regression"


def test_the_pages_deploy_waits_for_every_other_job_and_only_runs_on_main(wf):
    job = wf["jobs"]["deploy"]
    assert set(job["needs"]) == set(wf["jobs"]) - {"deploy"}, "a red job anywhere must stop the deploy"
    assert "github.event_name == 'push'" in job["if"] and "refs/heads/main" in job["if"], "pull requests never deploy"
    assert job["permissions"] == {"contents": "read", "pages": "write", "id-token": "write"}, "only what Pages needs, only on this job"
    assert job["environment"]["name"] == "github-pages"
    assert job["concurrency"]["cancel-in-progress"] is False, "a deploy in flight is never cancelled half way"
    runs = " ".join(step.get("run", "") for step in job["steps"])
    uses = " ".join(step.get("uses", "") for step in job["steps"])
    assert "make pages" in runs
    for needed in ("actions/configure-pages", "actions/upload-pages-artifact", "actions/deploy-pages"):
        assert needed in uses, needed
    upload = next(s for s in job["steps"] if s.get("uses", "").startswith("actions/upload-pages-artifact"))
    assert upload["with"]["path"] == "dist-pages"


def test_the_pages_variant_is_tested_on_every_pull_request_and_in_make_ci(wf):
    web = " ".join(step.get("run", "") for step in wf["jobs"]["web"]["steps"])
    assert "make pages-check" in web, "the job that every pull request runs"
    ci = re.search(r"^ci:(.*?)(?=^\S)", (ROOT / "Makefile").read_text(), flags=re.M | re.S).group(0)
    assert "pages-check" in ci
    gitignore = (ROOT / ".gitignore").read_text()
    assert "/dist-pages/" in gitignore


def test_the_firefox_and_webkit_job_is_a_real_gate(wf):
    job = wf["jobs"]["other-browsers"]
    assert not job.get("continue-on-error"), "a failure there must fail the run"
    runs = " ".join(step.get("run", "") for step in job["steps"])
    assert "playwright install --with-deps firefox webkit" in runs and "make other-browsers" in runs
