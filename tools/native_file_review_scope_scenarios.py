"""Check that a real external checkout retires an installed discard review."""
import json

from native_acceptance import open_ui
from native_worktree_scenarios import checkout_footprint


def file_review_scope(driver, fixtures, report):
    repository = fixtures.repository("file-review-checkout", commits=2)
    file = repository / "fixture.txt"
    original = file.read_bytes()
    changed = b"Keep this edit until a new discard review\n"
    file.write_bytes(changed)
    fixtures.git(repository, "branch", "same-tip")
    before = checkout_footprint(fixtures, repository)
    repo_id = open_ui(driver, repository)
    dialog = '[role="alertdialog"]'
    diff = '[aria-label="Diff viewer"]'

    def open_review():
        if driver.script(f"return !!document.querySelector({json.dumps(diff)})"):
            driver.click_visible('[aria-label="Back to commit graph"]')
        driver.click_visible(".wip-nav")
        driver.click_visible('[title="View changes in fixture.txt"]')
        driver.click_visible('[data-diff-mode="inline"]')
        driver.click_visible('[aria-label="Select added line 1"]:not(:disabled)')
        driver.click_visible('[aria-label="Selected line actions"] button', "Discard")
        driver.wait(f'return !!document.querySelector({json.dumps(dialog + " .confirm-action:not(:disabled)")})')

    open_review()
    assert checkout_footprint(fixtures, repository) == before
    assert not driver.invoke("load_discard_recoveries", repoId=repo_id)
    fixtures.git(repository, "switch", "--quiet", "same-tip")
    switched = checkout_footprint(fixtures, repository)
    assert switched["branch"] == "same-tip" and switched["head"] == before["head"]
    for field in ("references", "status", "configSha256", "files"):
        assert switched[field] == before[field], field

    report["fileReviewScope"] = {"before": before, "afterExternalCheckout": switched}
    branch = '[aria-label^="Switch branch, current same-tip,"]'
    driver.wait(f'return !!document.querySelector({json.dumps(branch)})')
    review = driver.wait(f"""const review = document.querySelector({json.dumps(dialog)});
      const message = review?.querySelector('[role="alert"]')?.textContent.trim();
      const disabled = review?.querySelector('.confirm-action')?.disabled === true;
      const cancel = review?.querySelector('[data-file-dialog-cancel]');
      return disabled && cancel && !cancel.disabled && message?.includes('open a fresh file review')
        ? {{message, disabled, cancelEnabled: true}} : null;""")
    report["fileReviewScope"]["staleReview"] = review
    assert checkout_footprint(fixtures, repository) == switched
    assert not driver.invoke("load_discard_recoveries", repoId=repo_id)
    report["scenarios"].append("native-same-tip-external-checkout-disables-the-old-file-discard-review")

    driver.click_visible(f"{dialog} button", "Cancel")
    open_review()
    driver.click_visible(f"{dialog} button", "Discard selected lines")
    driver.wait(f'return !document.querySelector({json.dumps(dialog)}) && !document.querySelector({json.dumps(diff)});')
    assert file.read_bytes() == original
    after = checkout_footprint(fixtures, repository)
    for field in ("branch", "head", "references", "configSha256", "indexSha256"):
        assert after[field] == switched[field], field
    assert not after["status"]
    captures = driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert len(captures) == 1, captures
    report["fileReviewScope"]["afterFreshDiscard"] = after
    report["scenarios"].append("native-fresh-file-review-discards-only-the-newly-reviewed-edit")
    return repository, repo_id
