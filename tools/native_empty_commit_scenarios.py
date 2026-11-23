"""Packaged UI acceptance for intentionally empty commits."""
from pathlib import Path
import shlex
import time

from native_acceptance import open_ui


def empty_commit_policy(driver, fixtures, report):
    repository = fixtures.repository("empty-commit-policy", commits=2)
    original_head = fixtures.git(repository, "rev-parse", "HEAD")
    original_tree = fixtures.git(repository, "rev-parse", "HEAD^{tree}")
    tracked = repository / "fixture.txt"
    index_before = (repository / ".git/index").read_bytes()
    tracked.write_text("intentionally left unstaged\n")

    hooks = repository / ".git/empty-commit-hooks"
    hooks.mkdir()
    marker = repository / ".git/empty-commit-hook-ran"
    hook = hooks / "pre-commit"
    hook.write_text(f"#!/bin/sh\nprintf '%s\\n' invoked > {shlex.quote(str(marker))}\n")
    hook.chmod(0o700)
    fixtures.git(repository, "config", "core.hooksPath", str(hooks))

    repo_id = open_ui(driver, repository)
    driver.click(".wip-nav")
    driver.wait("return !!document.querySelector('[aria-label=\"Commit summary\"]')")
    driver.script("""const input = document.querySelector('[aria-label="Commit summary"]');
      input.value = 'Record intentional empty checkpoint';
      input.dispatchEvent(new Event('input', {bubbles: true}));""")
    submit = '.commit-form button[type="submit"]'
    driver.wait(f"return document.querySelector({submit!r})?.disabled === true")
    driver.click('.commit-policy summary')
    driver.wait("return !!document.querySelector('gk-commit-policy-fields input[name=allowEmptyCommit]')")
    driver.click('gk-commit-policy-fields input[name="allowEmptyCommit"]')
    driver.wait(f"return document.querySelector({submit!r})?.disabled === false")
    assert "Create commit without staged changes" in driver.script(
        f"return document.querySelector({submit!r})?.textContent"
    )
    driver.click_visible(submit)

    deadline = time.monotonic() + 20
    new_head = original_head
    while time.monotonic() < deadline:
        new_head = fixtures.git(repository, "rev-parse", "HEAD")
        if new_head != original_head:
            break
        time.sleep(.1)
    assert new_head != original_head, "The explicit empty commit was not created"
    assert fixtures.git(repository, "rev-parse", "HEAD^{tree}") == original_tree
    assert fixtures.git(repository, "show", "-s", "--format=%s", "HEAD") == "Record intentional empty checkpoint"
    assert fixtures.git(repository, "rev-parse", "HEAD^") == original_head
    assert (repository / ".git/index").read_bytes() == index_before
    assert tracked.read_text() == "intentionally left unstaged\n"
    # The harness trims Git output, so porcelain's leading worktree/index space
    # is also removed; the remaining M proves the file stayed unstaged.
    assert fixtures.git(repository, "status", "--porcelain") == "M fixture.txt"
    assert marker.read_text().strip() == "invoked"
    report["scenarios"].append(
        "native-ui-empty-commit-requires-explicit-policy-keeps-tree-and-unstaged-work-runs-hooks"
    )
    return repository, repo_id
