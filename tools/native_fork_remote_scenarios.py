"""Fork attachment acceptance against real packaged IPC and owned Git state."""
import json
from pathlib import Path
import time
import uuid

from native_acceptance import open_ui


def hosted_fork_remote_attachment(driver, fixtures, original_repository, report):
    repository = fixtures.repository("hosted-fork-local-attachment", commits=3)
    fixtures.git(repository, "remote", "add", "origin", "https://github.com/owned-fixture/native-repo.git")
    fixtures.git(repository, "config", "remote.origin.pushurl", "git@github.com:owned-fixture/native-repo.git")
    fixtures.git(repository, "config", "branch.main.remote", "origin")
    fixtures.git(repository, "config", "branch.main.merge", "refs/heads/main")
    fixtures.git(repository, "config", "owned.privateToken", "owned-private-attachment-config")
    # Any accidental Git transport must fail rather than contact an external host.
    fixtures.git(repository, "config", "protocol.https.allow", "never")
    fixtures.git(repository, "config", "protocol.ssh.allow", "never")
    (repository / "fixture.txt").write_text("owned dirty attachment bytes\n")
    gate = fixtures.hosting_gate
    config_path, state_path = gate / "config.json", gate / "write-state.json"
    original_config = config_path.read_bytes()
    original_state = state_path.read_bytes() if state_path.exists() else None
    config = dict(repository="owned-fixture/native-repo", oid=fixtures.git(repository, "rev-parse", "HEAD"),
                  actor="owned-author", allowForks=True, allowDiscovery=True, forkName="owned-fork")
    context = "owned-native-local-fork-remote"
    selection = dict(sourceFullName=config["repository"], sourceRepositoryId="9007199254740993",
                     accountId="501", forkFullName="owned-author/owned-fork",
                     forkRepositoryId="9007199254740995", forkOwnerId="501")
    request = dict(sourceRemote="origin", remoteName="reviewed-fork", transport="ssh", selection=selection)
    local_config = repository / ".git/config"
    request_log = gate / "requests.jsonl"
    request_start = len(request_log.read_text().splitlines()) if request_log.exists() else 0

    def call(command, **args):
        return driver.invoke(command, repoId=repo_id, contextId=context, operationId=str(uuid.uuid4()), **args)

    def prepare(name="reviewed-fork", transport="ssh"):
        return call("prepare_hosted_fork_remote", request=request | dict(remoteName=name, transport=transport))

    def apply(review, **binding):
        return driver.invoke("execute_hosted_fork_remote", repoId=binding.get("repoId", repo_id),
                             contextId=binding.get("contextId", context), token=review["token"],
                             operationId=str(uuid.uuid4()))

    def refuse(review, kind, **binding):
        try:
            apply(review, **binding)
        except RuntimeError as error:
            assert kind in str(error), error
        else:
            raise AssertionError("Owned attachment precondition unexpectedly succeeded")

    def button(text, selector="gc-hosted-forks button"):
        driver.wait(f"return [...document.querySelectorAll({json.dumps(selector)})].some(button => button.textContent.trim() === {json.dumps(text)} && !button.matches(':disabled'))")
        driver.click_text(selector, text)

    def unchanged():
        assert fixtures.git(repository, "show-ref") == refs
        assert (repository / ".git/index").read_bytes() == index
        assert (repository / "fixture.txt").read_bytes() == dirty
        assert fixtures.git(repository, "config", "--get", "remote.origin.url") == "https://github.com/owned-fixture/native-repo.git"
        assert fixtures.git(repository, "config", "--get", "remote.origin.pushurl") == "git@github.com:owned-fixture/native-repo.git"
        assert fixtures.git(repository, "config", "--get", "branch.main.remote") == "origin"
        assert fixtures.git(repository, "config", "--get", "branch.main.merge") == "refs/heads/main"

    try:
        config_path.write_text(json.dumps(config))
        # Model an already existing fork; attachment must never create one.
        state_path.write_text(json.dumps({"forks": [{"name": "owned-fork", "default_branch_only": True}]}))
        repo_id = open_ui(driver, repository)
        other = fixtures.repository("hosted-fork-other-session", commits=1)
        other_id = driver.invoke("open_repository", path=str(other))["id"]
        refs = fixtures.git(repository, "show-ref")
        index = (repository / ".git/index").read_bytes()
        dirty = (repository / "fixture.txt").read_bytes()
        before = local_config.read_bytes()
        preview = prepare()
        assert local_config.read_bytes() == before
        assert preview["plan"]["repositoryPath"] == str(repository)
        assert preview["plan"]["existingRemoteNames"] == ["origin"]
        serialized = json.dumps(preview)
        assert "owned-private-attachment-config" not in serialized
        assert all(key not in preview["plan"] for key in ["snapshot", "request", "created"])
        refuse(preview, "staleHostedForkRemotePlan", repoId=other_id)
        refuse(preview, "staleHostedForkRemotePlan", contextId="other-owned-context")
        preview["plan"]["remoteName"] = "forged-name"
        preview["plan"]["url"] = "https://unowned.example.test/forged.git"
        receipt = apply(preview)
        assert receipt["remoteName"] == "reviewed-fork"
        assert receipt["url"] == "git@github.com:owned-author/owned-fork.git"
        assert local_config.read_bytes().startswith(before)
        assert fixtures.git(repository, "remote", "get-url", "reviewed-fork") == receipt["url"]
        assert fixtures.git(repository, "config", "--get", "remote.reviewed-fork.fetch") == "+refs/heads/*:refs/remotes/reviewed-fork/*"
        saved = local_config.read_bytes()
        refuse(preview, "staleHostedForkRemotePlan")
        assert local_config.read_bytes() == saved
        unchanged()
        report["scenarios"].append("native-local-fork-remote-server-plan-session-context-single-use-private-config-and-exact-git-preservation")

        preview = prepare("stale-local")
        fixtures.git(repository, "config", "owned.changed", "retain-external-edit")
        saved = local_config.read_bytes()
        refuse(preview, "hostedForkRemoteRefused")
        refuse(preview, "staleHostedForkRemotePlan")
        assert local_config.read_bytes() == saved
        preview = prepare("locked-local")
        lock = repository / ".git/config.lock"
        lock.write_text("owned foreign lock\n")
        try:
            refuse(preview, "hostedForkRemoteRefused")
            assert lock.read_text() == "owned foreign lock\n"
            assert local_config.read_bytes() == saved
        finally:
            lock.unlink()
        preview = prepare("changed-account")
        config["actor"] = "owned-other-account"; config_path.write_text(json.dumps(config))
        refuse(preview, "hostingDiscoveryRequest")
        refuse(preview, "staleHostedForkRemotePlan")
        assert local_config.read_bytes() == saved
        config["actor"] = "owned-author"; config_path.write_text(json.dumps(config))
        unchanged()
        report["scenarios"].append("native-local-fork-remote-stale-config-foreign-lock-account-change-refuse-without-replay")

        hold, started = gate / "hold", gate / "started"
        started.unlink(missing_ok=True); hold.touch()
        operation = str(uuid.uuid4())
        try:
            driver.script("""
              window.__ownedForkRemoteRead = {done:false};
              window.__TAURI_INTERNALS__.invoke('prepare_hosted_fork_remote', arguments[0]).then(
                value => {window.__ownedForkRemoteRead = {done:true,value}},
                error => {window.__ownedForkRemoteRead = {done:true,error}});
            """, dict(repoId=repo_id, contextId=context, operationId=operation,
                      request=request | dict(remoteName="cancelled-review")))
            deadline = time.monotonic() + 10
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            assert started.exists(), "Owned attachment read did not reach its held provider process"
            child = int(started.read_text())
            assert driver.invoke("cancel_git_operation", operationId=operation)
            driver.wait("return window.__ownedForkRemoteRead.done", 10)
            assert driver.script("return window.__ownedForkRemoteRead.error.kind") == "operationCancelled"
            stat = Path('/proc') / str(child) / 'stat'
            assert not stat.exists() or stat.read_text().rsplit(') ', 1)[1].startswith('Z')
            assert local_config.read_bytes() == saved
            unchanged()
        finally:
            hold.unlink(missing_ok=True)
            driver.script("delete window.__ownedForkRemoteRead")
        report['scenarios'].append('native-local-fork-remote-preparation-cancel-reaps-owned-provider-without-config-publication')

        # Exercise the actual independent desktop form, including its displayed
        # source selection and separate confirmation. No renderer IPC stubs.
        open_ui(driver, repository)
        driver.click('[aria-label="New repository tab"]')
        driver.wait("return !!document.querySelector('#repository-tab-clone')?.getClientRects().length")
        driver.click_text('gc-repository-dialog [role=tab]', 'Clone')
        button('Browse repositories on GitHub', 'gc-repository-dialog button')
        button('Load repositories', 'gc-hosted-repository-browser button')
        button('Select owned-fixture/native-repo', 'gc-hosted-repository-browser button')
        button('Manage forks and saved requests', 'gc-hosted-repository-browser button')
        button('Find existing forks')
        button('Inspect owned-author/owned-fork')
        button('Attach fork to local repository')
        driver.wait("return document.querySelector('#fork-source-remote')?.value === 'origin'")
        saved = local_config.read_bytes()
        button('Review local remote', 'gc-hosted-fork-remote button')
        driver.wait("return !!document.querySelector('gc-hosted-fork-remote [aria-label=\"Review local fork remote\"]')")
        assert local_config.read_bytes() == saved
        assert driver.script("return document.querySelector('gc-hosted-fork-remote [aria-label=\"Review local fork remote\"]').textContent").find(str(repository)) >= 0
        driver.screenshot(Path(report['artifactsDirectory']) / 'local-fork-remote-native-review.png')
        button('Add reviewed remote', 'gc-hosted-fork-remote button')
        driver.wait("return document.querySelector('gc-hosted-fork-remote [aria-label=\"Confirmed local remote\"]')?.textContent.includes('fork was added')")
        assert fixtures.git(repository, "remote", "get-url", "fork") == "https://github.com/owned-author/owned-fork.git"
        assert local_config.read_bytes().startswith(saved)
        unchanged()
        rows = [json.loads(line) for line in request_log.read_text().splitlines()[request_start:]]
        assert rows and all(row['method'] == 'GET' for row in rows)
        assert len(json.loads(state_path.read_text())['forks']) == 1
        driver.screenshot(Path(report['artifactsDirectory']) / 'local-fork-remote-native-confirmed.png')
        report['scenarios'].append('native-ui-local-fork-remote-separate-review-displayed-source-confirmation-and-provider-read-only')
    except Exception:
        driver.screenshot(Path(report['artifactsDirectory']) / 'local-fork-remote-native-failure.png')
        raise
    finally:
        config_path.write_bytes(original_config)
        if original_state is None:
            state_path.unlink(missing_ok=True)
        else:
            state_path.write_bytes(original_state)
        open_ui(driver, original_repository)
