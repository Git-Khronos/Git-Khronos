"""Exercise exact partial changes against real index and worktree bytes."""
from native_acceptance import open_ui


def stage_after_patch_like_source_text(driver, fixtures, report):
    repository = fixtures.repository("ui-patch-like-source-text", 2)
    file = repository / "fixture.txt"
    file.write_bytes(b"-- old heading\nkeep one\nkeep two\nold tail\n")
    fixtures.git(repository, "add", "--", file.name)
    fixtures.git(repository, "commit", "-qm", "Before patch-like heading")
    head = fixtures.git(repository, "rev-parse", "HEAD")
    current = b"++ new heading\nkeep one\nkeep two\nnew tail"
    file.write_bytes(current)
    repo_id = open_ui(driver, repository)
    driver.click_visible(".wip-nav")
    driver.click_visible('[title="View changes in fixture.txt"]')
    driver.click_visible('[data-diff-mode="inline"]')
    driver.wait("""const diff = document.querySelector('[aria-label="Diff viewer"]');
      return diff?.querySelector('.diff-additions')?.textContent.trim() === '+2'
        && diff.querySelector('.diff-deletions')?.textContent.trim() === '−2';""")
    assert driver.script("""return [...document.querySelectorAll('.focus-diff-line')].some(row =>
      row.textContent.includes('No newline at end of file') && !row.hasAttribute('data-diff-old-line')
        && !row.hasAttribute('data-diff-new-line'));""")
    driver.click_visible('[aria-label="Select added line 4"]:not(:disabled)')
    driver.click_visible('[aria-label="Selected line actions"] button:not(:disabled)', 'Stage')
    driver.wait("""return !!document.querySelector('[aria-label="Unstage fixture.txt"]:not(:disabled)');""")
    staged = fixtures.git(repository, "diff", "--cached", "--", file.name)
    assert "-old tail\n+new tail\n\\ No newline at end of file" in staged, staged
    assert "--- old heading" not in staged and "+++ new heading" not in staged, staged
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert file.read_bytes() == current
    report["scenarios"].append("native-ui-stages-later-lines-without-selecting-patch-like-source-content")
    return repository, repo_id


def unterminated_final_line_actions(driver, fixtures, report):
    repository = fixtures.repository("partial-unterminated-final-line", 2)
    file = repository / "fixture.txt"
    original, changed = b"old final line", b"new final line"
    file.write_bytes(original)
    fixtures.git(repository, "add", "--", file.name)
    fixtures.git(repository, "commit", "-qm", "Before unterminated line change")
    head = fixtures.git(repository, "rev-parse", "HEAD")
    file.write_bytes(changed)
    repo_id = open_ui(driver, repository)

    def index_is(expected):
        return fixtures.git(repository, "rev-parse", f":{file.name}") == fixtures.git(
            repository, "hash-object", "--stdin", input=expected,
        )

    def apply(action, index, staged=False):
        preview = driver.invoke("inspect_working_tree_file", repoId=repo_id, path=file.name, staged=staged)
        assert not preview["truncated"]
        return driver.invoke("apply_working_tree_lines", repoId=repo_id, path=file.name,
                             staged=staged, hunkIndex=0, lineIndices=[index],
                             action=action, expectedPatch=preview["patch"])

    driver.click_visible(".wip-nav")
    driver.click_visible('[title="View changes in fixture.txt"]')
    driver.click_visible('[data-diff-mode="split"]')
    driver.wait("""return [...document.querySelectorAll('.split-row')].some(row =>
      row.querySelector('[data-side="Before"]').textContent.includes('old final line') &&
      row.querySelector('[data-side="After"]').textContent.includes('new final line'));""")
    driver.click_visible('[data-diff-mode="inline"]')
    driver.click_visible('[aria-label="Select added line 1"]:not(:disabled)')
    driver.wait("""return !!document.querySelector('[aria-label="Deselect removed line 1"][aria-pressed="true"]');""")
    driver.click_visible('[aria-label="Selected line actions"] button:not(:disabled)', 'Stage')
    driver.wait("""return !!document.querySelector('[aria-label="Unstage fixture.txt"]:not(:disabled)');""")
    assert index_is(changed) and file.read_bytes() == changed
    report["scenarios"].append("native-ui-stages-unterminated-final-line-as-one-replacement")

    apply("unstage", 0, staged=True)
    assert index_is(original) and file.read_bytes() == changed
    report["scenarios"].append("native-unstage-restores-the-unterminated-index-without-changing-the-worktree")

    initial = driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert not initial
    apply("discard", 1)
    assert index_is(original) and file.read_bytes() == original
    recovery = driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert len(recovery) == 1, recovery
    driver.invoke("apply_saved_discard", repoId=repo_id, id=recovery[0]["id"], reverse=False)
    assert index_is(original) and file.read_bytes() == changed
    report["scenarios"].append("native-final-line-discard-and-recovery-preserve-exact-bytes-and-the-index")

    expanded = b"first revised line\nsecond revised line"
    file.write_bytes(expanded)
    try:
        apply("stage", 2)
    except RuntimeError as error:
        assert "partialFinalNewline" in str(error), str(error)
    else:
        raise AssertionError("Staging joined lines after the retained unterminated context")
    assert index_is(original) and file.read_bytes() == expanded
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    report["scenarios"].append("native-partial-stage-refuses-to-concatenate-final-lines")
    return repository, repo_id


def diff_line_selection(driver, fixtures, report):
    stage_after_patch_like_source_text(driver, fixtures, report)
    return unterminated_final_line_actions(driver, fixtures, report)
