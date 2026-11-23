"""Review exact local tag metadata without reusing a stale annotation."""
import json

from native_acceptance import open_ui


def tag_preview(driver, fixtures, report):
    repository = fixtures.repository("tag-preview", commits=3)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    before = (repository / "fixture.txt").read_bytes(), (repository / ".git/index").read_bytes()
    fixtures.git(repository, "tag", "-a", "release", "-m", "Original release note", head)
    original_object = fixtures.git(repository, "rev-parse", "refs/tags/release")
    repo_id = open_ui(driver, repository)

    heading = "#reference-section-tags button.sidebar-heading"
    tag = '.tag-item[aria-label="Tag release"]'
    tooltip = "#tag-reference-preview"
    driver.wait(f"return !!document.querySelector({json.dumps(heading)})")
    if driver.script(f"return document.querySelector({json.dumps(heading)}).getAttribute('aria-expanded')") == "false":
        driver.click(heading)
    driver.wait(f"return !!document.querySelector({json.dumps(tag)})")

    def focus_note(note):
        driver.script("document.querySelector(arguments[0]).focus()", tag)
        driver.wait(f"return document.querySelector({json.dumps(tooltip)})?.textContent.includes({json.dumps(note)})")
        assert driver.script("return document.querySelector(arguments[0]).textContent.includes('Annotated tag')", tooltip)
        driver.script("document.querySelector(arguments[0]).blur()", tag)
        driver.wait(f"return !document.querySelector({json.dumps(tooltip)})")

    focus_note("Original release note")
    fixtures.git(repository, "tag", "-fa", "release", "-m", "Replacement release note", head)
    assert fixtures.git(repository, "rev-parse", "refs/tags/release") != original_object
    assert fixtures.git(repository, "rev-parse", "refs/tags/release^{}") == head
    focus_note("Replacement release note")
    report["scenarios"].append("native-tag-preview-rereads-recreated-annotation-at-the-same-commit")

    fixtures.git(repository, "tag", "-d", "release")
    fixtures.git(repository, "tag", "-a", "release/candidate", "-m", "Different tag", head)
    fixtures.git(repository, "pack-refs", "--all")
    try:
        driver.invoke("inspect_tag", repoId=repo_id, name="release")
    except RuntimeError as error:
        assert json.loads(str(error))["kind"] == "tagNotFound", error
    else:
        raise AssertionError("A descendant tag was returned for a deleted exact name")
    descendant = driver.invoke("inspect_tag", repoId=repo_id, name="release/candidate")
    assert descendant["oid"] == head and descendant["message"] == "Different tag", descendant
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert ((repository / "fixture.txt").read_bytes(), (repository / ".git/index").read_bytes()) == before
    report["scenarios"].append("native-tag-preview-does-not-substitute-a-packed-descendant-tag")

    navigation_repository = fixtures.repository("tag-navigation-and-branch", commits=3)
    original_head = fixtures.git(navigation_repository, "rev-parse", "HEAD")
    target = fixtures.git(navigation_repository, "rev-parse", "HEAD~1")
    fixtures.git(navigation_repository, "tag", "-a", "release-base", "-m", "Release base", target)
    nav_repo_id = open_ui(driver, navigation_repository)
    if driver.script(
        "return document.querySelector('#reference-section-tags button.sidebar-heading')?.getAttribute('aria-expanded')"
    ) == "false":
        driver.click("#reference-section-tags button.sidebar-heading")
    tag_selector = '[aria-label="Tag release-base"]'
    driver.wait(f"return !!document.querySelector({json.dumps(tag_selector)})")
    driver.click(tag_selector)
    selected_row = f'.commit-row[data-commit-oid="{target}"].selected'
    driver.wait(f"return !!document.querySelector({json.dumps(selected_row)})")
    report["scenarios"].append("native-clicking-a-tag-navigates-to-its-peeled-commit")

    driver.context_click(tag_selector)
    driver.wait("return !!document.querySelector('.graph-action-menu [role=menu]') || !!document.querySelector('.graph-action-menu')")
    driver.click_scrolled_text(
        '[data-create-context-branch]', "Create branch here…", wait_for_ready=True,
    )
    form = ".context-create-branch-form"
    driver.wait(f"return !!document.querySelector({json.dumps(form)})")
    driver.script(
        "const field = document.querySelector('#context-branch-name'); "
        "field.value = 'owned-release-base'; field.dispatchEvent(new Event('input', {bubbles:true}));"
    )
    driver.click_visible(form + " button[type=submit]", "Create")
    driver.wait(f"return !document.querySelector({json.dumps(form)})")
    assert fixtures.git(navigation_repository, "symbolic-ref", "HEAD") == "refs/heads/owned-release-base"
    assert fixtures.git(navigation_repository, "rev-parse", "HEAD") == target
    assert fixtures.git(navigation_repository, "rev-parse", "refs/heads/owned-release-base") == target
    assert fixtures.git(navigation_repository, "rev-parse", "refs/heads/main") == original_head
    assert fixtures.git(navigation_repository, "rev-parse", "refs/tags/release-base^{}") == target
    assert not fixtures.git(navigation_repository, "status", "--porcelain=v1")
    report["scenarios"].append("native-ui-creates-and-checks-out-a-branch-at-the-tagged-commit")
    return navigation_repository, nav_repo_id
