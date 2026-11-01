"""Ordinary desktop clone controls with real pinned loopback SSH transport."""
import json
from pathlib import Path


def gitlab_ssh_clone(driver, fixtures, original_repository, report, connection,
                     head, expected_file, source, button, fill, open_ui, profile):
    gate = fixtures.gitlab_gate
    url = fixtures.gitlab_ssh_url
    config = Path(fixtures.env["GIT_CONFIG_GLOBAL"])
    previous = config.read_bytes()
    journal = fixtures.gitlab_ssh_journal
    assert not journal.exists(), "No SSH Git operation is allowed before explicit clone"
    https_records = (gate / "git-requests.jsonl").read_bytes()
    config.write_bytes(profile + b'[protocol "ssh"]\nallow = always\n')
    (gate / "project-overrides.json").write_text(json.dumps({"ssh_url_to_repo": url}))
    try:
        open_ui(driver, original_repository)
        driver.click('[aria-label="New repository tab"]')
        driver.wait("return !!document.querySelector('#repository-tab-clone')?.getClientRects().length")
        driver.click_text('gc-repository-dialog [role=tab]', 'Clone')
        button("Browse GitLab projects")
        driver.wait("return !!document.querySelector('#gitlab-account') && !document.querySelector('#gitlab-account').matches(':disabled') && [...document.querySelector('#gitlab-account').options].some(option => option.value === " + json.dumps(connection["connectionId"]) + ")")
        driver.script("""const select=document.querySelector('#gitlab-account');
          select.value=arguments[0];select.dispatchEvent(new Event('change',{bubbles:true}));""", connection["connectionId"])
        button("Load GitLab projects")
        button("Inspect and clone team/subgroup/owned-project")
        driver.wait("return !!document.querySelector('#gitlab-clone-parent')")
        driver.script("""const select=document.querySelector('#gitlab-clone-transport');
          select.value='ssh';select.dispatchEvent(new Event('change',{bubbles:true}));""")
        fill("#gitlab-clone-parent", str(fixtures.root))
        fill("#gitlab-clone-folder", "gitlab-native-real-ssh")
        fill("#gitlab-clone-branch", "topic/reviewed")
        driver.click("gc-gitlab-clone label.check input")
        driver.wait("return !!document.querySelector('#gitlab-clone-depth')")
        fill("#gitlab-clone-depth", "1")
        button("Review GitLab clone", "gc-gitlab-clone button")
        driver.wait("return !!document.querySelector('gc-gitlab-clone [aria-label=\"Review GitLab clone\"]')")
        checkout = fixtures.root / "gitlab-native-real-ssh"
        assert not checkout.exists() and not journal.exists()
        review = driver.script("return document.querySelector('gc-gitlab-clone [aria-label=\"Review GitLab clone\"]').textContent")
        assert url in review and str(checkout) in review and "Depth 1" in review
        assert "owned-api-fixture-token" not in review
        driver.screenshot(Path(report["artifactsDirectory"]) / "gitlab-clone-native-ssh-review.png")
        button("Clone reviewed GitLab project", "gc-gitlab-clone button")
        driver.wait("return !document.querySelector('gc-repository-dialog')", 60)
        assert fixtures.git(checkout, "rev-parse", "HEAD") == head
        assert fixtures.git(checkout, "symbolic-ref", "--short", "HEAD") == "topic/reviewed"
        assert fixtures.git(checkout, "rev-parse", "--is-shallow-repository") == "true"
        assert fixtures.git(checkout, "rev-list", "--count", "HEAD") == "1"
        assert fixtures.git(checkout, "config", "--get", "remote.origin.url") == url
        assert fixtures.git(checkout, "status", "--porcelain") == ""
        assert (checkout / "fixture.txt").read_bytes() == expected_file
        assert "owned-api-fixture-token" not in (checkout / ".git/config").read_text()
        uploads = [json.loads(line) for line in journal.read_text().splitlines()]
        assert uploads == [{"uploadPack": True}], uploads
        assert (gate / "git-requests.jsonl").read_bytes() == https_records
        report["gitlabSshUploads"] = uploads
        driver.screenshot(Path(report["artifactsDirectory"]) / "gitlab-clone-native-ssh-completed.png")
        fixtures.git(checkout, "remote", "set-url", "origin", source.as_uri())
        report["scenarios"].append("native-ui-gitlab-real-pinned-ssh-reviewed-url-literal-branch-shallow-clone-with-no-api-credential-or-https-git-request")
    finally:
        config.write_bytes(previous)
        (gate / "project-overrides.json").unlink(missing_ok=True)
