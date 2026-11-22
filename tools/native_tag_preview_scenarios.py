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
    return repository, repo_id
