"""Exercise exact partial changes against real index and worktree bytes."""
import json

from native_acceptance import open_ui
from native_worktree_scenarios import checkout_footprint


def wrapped_diff_rendering(driver, fixtures, report):
    """Read the real Git diff through the installed renderer, never injected patch data."""
    repository = fixtures.repository("wrapped-diff-rendering", commits=1)
    file = repository / "fixture.txt"
    context = "context line 120" + " long readable source content" * 8
    file.write_text(f"old opening\n{context}\nconst count = 1;\n", encoding="utf-8")
    fixtures.git(repository, "add", "--", file.name)
    fixtures.git(repository, "commit", "-qm", "Before wrapped review")
    file.write_text(f"new opening\n{context}\nconst count = 2;\n", encoding="utf-8")
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, (file.name,))
    driver.click_visible(".wip-nav")
    driver.click_visible('[title="View changes in fixture.txt"]')
    driver.wait("return !!document.querySelector('.diff-primary-view')")
    if not driver.script("return document.querySelector('.diff-workspace').classList.contains('word-wrap')"):
        driver.click_visible('.diff-wrap-toggle, .diff-footer-wrap-toggle')
    driver.wait("return !!document.querySelector('.diff-workspace.word-wrap')")
    report["wrappedDiffRendering"] = {}
    for mode in ("split", "hunk", "inline"):
        driver.click_visible(f'[data-diff-mode="{mode}"]')
        observation = driver.wait("""const mode = """ + json.dumps(mode) + """;
          if (document.querySelector('[data-diff-mode="' + mode + '"]')?.getAttribute('aria-pressed') !== 'true') return null;
          const primary = document.querySelector('.diff-primary-view');
          const codes = [...(primary?.querySelectorAll(
            '[data-diff-old-line="2"] code, [data-diff-new-line="2"] code') ?? [])];
          if (codes.length !== (mode === 'split' ? 2 : 1)) return null;
          return { context: codes.map(code => ({
            text: code.textContent, spans: code.querySelectorAll('span').length,
            number: code.querySelector('.syntax-number')?.textContent ?? null
          })), replacementHighlights: [...primary.querySelectorAll('.word-change')]
            .map(span => span.textContent) };""")
        report["wrappedDiffRendering"][mode] = observation
        assert all(code["text"] == " " + context for code in observation["context"]), observation
        assert all(code["number"] == "120" for code in observation["context"]), observation
        assert [code["spans"] for code in observation["context"]] == [3] * (2 if mode == "split" else 1), observation
        assert {"1", "2"} <= set(observation["replacementHighlights"]), observation
        assert checkout_footprint(fixtures, repository, (file.name,)) == before
    report["scenarios"].append("native-wrapped-diff-coalesces-context-and-preserves-text-and-word-highlights")
    return repository, repo_id


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


def discard_with_compact_blank_context(driver, fixtures, report):
    repository = fixtures.repository("discard-compact-blank-context", 2)
    file = repository / "fixture.txt"
    original = b"keep before\n\nold first\n\nkeep between\nold second\n\nkeep after\n"
    changed = original.replace(b"old", b"new")
    file.write_bytes(original)
    fixtures.git(repository, "add", "--", file.name)
    fixtures.git(repository, "commit", "-qm", "Before edits around blank context")
    fixtures.git(repository, "config", "diff.suppressBlankEmpty", "true")
    file.write_bytes(changed)
    repo_id = open_ui(driver, repository)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    preview = driver.invoke("inspect_working_tree_file", repoId=repo_id, path=file.name, staged=False)
    assert not preview["truncated"] and " keep before\n\n-old first\n+new first\n\n" in preview["patch"]
    index = fixtures.git(repository, "ls-files", "--stage", "-z")
    config = (repository / ".git/config").read_bytes()
    driver.invoke("apply_working_tree_lines", repoId=repo_id, path=file.name, staged=False,
                  hunkIndex=0, lineIndices=[0, 1], action="discard", expectedPatch=preview["patch"])
    assert file.read_bytes() == original.replace(b"old second", b"new second")
    captures = driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert len(captures) == 1, captures
    driver.invoke("apply_saved_discard", repoId=repo_id, id=captures[0]["id"], reverse=False)
    assert file.read_bytes() == changed
    assert fixtures.git(repository, "ls-files", "--stage", "-z") == index
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/config").read_bytes() == config
    report["scenarios"].append("native-compact-blank-diff-context-preserves-partial-discard-and-recovery")
    return repository, repo_id


def diff_line_selection(driver, fixtures, report):
    stage_after_patch_like_source_text(driver, fixtures, report)
    unterminated_final_line_actions(driver, fixtures, report)
    return discard_with_compact_blank_context(driver, fixtures, report)
