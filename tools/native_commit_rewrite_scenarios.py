"""Check reviewed commit rewrites through the packaged IPC and editor."""
import json

from native_acceptance import open_ui
from native_worktree_scenarios import checkout_footprint


def reviewed_commit_rewrite(driver, fixtures, report):
    repository = fixtures.repository("reviewed-commit-rewrite", commits=3)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    target = fixtures.git(repository, "rev-parse", "HEAD^")
    fixtures.git(repository, "switch", "-c", "parallel")
    file = repository / "fixture.txt"
    file.write_bytes(b"staged content\n")
    fixtures.git(repository, "add", "--", file.name)
    file.write_bytes(b"working content\n")
    before = checkout_footprint(fixtures, repository)
    report["reviewedCommitRewrite"] = {"before": before}
    repo_id = open_ui(driver, repository)

    stale = {"headOid": head, "branch": "main"}
    author = {"name": "Native Rewrite Fixture", "email": "rewrite@example.test"}
    for command, extra in (
        ("update_head_message", {}),
        ("edit_commit", {"targetOid": target, "author": author}),
    ):
        try:
            driver.invoke(command, repoId=repo_id, checkout=stale, message="Stale reviewed edit",
                          skipHooks=False, **extra)
        except RuntimeError as refusal:
            error = json.loads(str(refusal))
            assert error["kind"] == "staleCommit", error
        else:
            raise AssertionError(f"{command} accepted a review for a different branch")
        assert checkout_footprint(fixtures, repository) == before
    report["scenarios"].append("native-commit-rewrite-refuses-a-stale-branch-at-the-same-head")

    trees = fixtures.git(repository, "log", "--first-parent", "--format=%T")
    driver.click_visible(f'.commit-row[data-commit-oid="{target}"]')
    driver.click_visible('.editable-commit-message')
    driver.wait('''return document.querySelector('.commit-message-editor [name="editedCommitSummary"]')
                          ?.value === 'Native commit 000001';''')
    message = "Reviewed ancestor rewrite"
    driver.script('''const field = document.querySelector('.commit-message-editor [name="editedCommitSummary"]');
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', message)
    driver.click_visible('.commit-message-editor button[type="submit"]', 'Save Commit')
    driver.wait("return !document.querySelector('.commit-message-editor');")
    after = checkout_footprint(fixtures, repository)
    replacement = fixtures.git(repository, "rev-parse", "HEAD^")
    assert after["head"] != head and replacement != target, after
    assert fixtures.git(repository, "show", "-s", "--format=%s", replacement) == message
    assert fixtures.git(repository, "show", "-s", "--format=%s", "HEAD") == "Native commit 000002"
    assert fixtures.git(repository, "log", "--first-parent", "--format=%T") == trees
    assert fixtures.git(repository, "rev-parse", "refs/heads/main") == head
    assert fixtures.git(repository, "rev-parse", "refs/heads/parallel") == after["head"]
    for key in ("branch", "status", "indexSha256", "configSha256", "files"):
        assert before[key] == after[key], key
    driver.wait(f'''return document.querySelector('.commit-inspector-revision')
      ?.getAttribute('title') === 'Commit {replacement}';''')
    report["reviewedCommitRewrite"].update({"after": after, "replacement": replacement})
    report["scenarios"].append("native-commit-editor-rewrites-only-the-reviewed-branch-and-keeps-staged-and-working-bytes")
    return repository, repo_id
