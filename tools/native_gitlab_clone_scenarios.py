"""Packaged GitLab clone IPC/UI against owned TLS and disposable Git sources."""
import json
from pathlib import Path
import time
import uuid


def gitlab_reviewed_clones(driver, fixtures, original_repository, report):
    from native_scenarios import open_ui

    gate, origin = fixtures.gitlab_gate, fixtures.gitlab_origin
    token = "owned-api-fixture-token"
    records = gate / "requests.jsonl"
    source = fixtures.repository("gitlab-clone-source", commits=3)
    fixtures.git(source, "branch", "topic/reviewed")
    head = fixtures.git(source, "rev-parse", "HEAD")
    source_before = {"refs": fixtures.git(source, "show-ref"),
                     "index": (source / ".git/index").read_bytes(),
                     "config": (source / ".git/config").read_bytes(),
                     "file": (source / "fixture.txt").read_bytes(),
                     "status": fixtures.git(source, "status", "--porcelain")}
    https = origin + "/team/subgroup/owned-project.git"
    ssh = "ssh://git@ssh.example.test:2222/team/subgroup/owned-project.git"
    global_config = Path(fixtures.env["GIT_CONFIG_GLOBAL"])
    original_global = global_config.read_bytes()
    context = "native-gitlab-clone-" + uuid.uuid4().hex

    def requests():
        return [json.loads(line) for line in records.read_text().splitlines()]

    def button(text, selector="button"):
        driver.wait("return [...document.querySelectorAll(" + json.dumps(selector) + ")].some(b => b.getClientRects().length && !b.matches(':disabled') && b.textContent.trim() === " + json.dumps(text) + ")")
        driver.click_text(selector, text)

    def fill(selector, value):
        driver.script("""const input=document.querySelector(arguments[0]);
          if (!input || input.matches(':disabled')) throw Error('Owned clone input unavailable');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[1]);
          input.dispatchEvent(new Event('input',{bubbles:true}));""", selector, value)

    def refuses(command, needle, **args):
        try:
            driver.invoke(command, **args)
        except RuntimeError as error:
            assert needle.lower() in str(error).lower(), error
            assert token not in str(error), error
            return
        raise AssertionError("Owned GitLab clone refusal unexpectedly succeeded")

    def prepare(connection, folder, transport="https", branch=None, depth=None):
        return driver.invoke("prepare_gitlab_clone", request={
            "connectionId": connection["connectionId"], "contextId": context,
            "operationId": str(uuid.uuid4()), "request": {
                "projectId": "101", "fullPath": "team/subgroup/owned-project", "transport": transport,
                "parentPath": str(fixtures.root), "folder": folder, "branch": branch, "depth": depth,
                "recurseSubmodules": False}})

    def execution(preview, selected_context=context):
        return {"contextId": selected_context, "token": preview["token"], "operationId": str(uuid.uuid4())}

    def cancel_stalled(command, request):
        before = len(requests())
        (gate / "mode").write_text("stalled")
        try:
            driver.script("""window.__ownedGitLabCloneRead={done:false};
              window.__TAURI_INTERNALS__.invoke(arguments[0],{request:arguments[1]}).then(
                value=>{window.__ownedGitLabCloneRead={done:true,value}},
                error=>{window.__ownedGitLabCloneRead={done:true,error}});""", command, request)
            deadline = time.monotonic() + 5
            while len(requests()) == before and time.monotonic() < deadline:
                time.sleep(.02)
            assert len(requests()) == before + 1, "Owned stalled clone API read did not begin"
            assert driver.invoke("cancel_git_operation", operationId=request["operationId"])
            driver.wait("return window.__ownedGitLabCloneRead.done", 10)
            result = driver.script("return window.__ownedGitLabCloneRead")
            assert result["error"]["kind"] == "operationCancelled", result
            assert token not in json.dumps(result)
            assert len(requests()) == before + 1
        finally:
            (gate / "mode").write_text("normal")

    try:
        # A missed rewrite must fail, never attempt an external Git transport.
        # API TLS remains real and independent of these Git configuration rules.
        global_config.write_bytes(original_global + (
            '[protocol "https"]\nallow = never\n[protocol "ssh"]\nallow = never\n'
            f'[url "{source.as_uri()}"]\ninsteadOf = {https}\ninsteadOf = {ssh}\n').encode())
        connection = driver.invoke("connect_gitlab_account", request={"origin": origin, "token": token,
                                   "operationId": str(uuid.uuid4())})
        before = len(requests())
        inspected = driver.invoke("inspect_gitlab_project", request={
            "connectionId": connection["connectionId"], "projectId": "101", "operationId": str(uuid.uuid4())})
        assert inspected["account"] == connection["account"]
        assert inspected["project"]["fullPath"] == "team/subgroup/owned-project"
        assert inspected["project"]["defaultBranch"] is None
        assert inspected["cloneHttps"] == https and inspected["cloneSsh"] == ssh
        assert [r["path"] for r in requests()[before:]] == ["/api/v4/user", "/api/v4/projects/101", "/api/v4/user"]
        assert token not in json.dumps(inspected)
        report["scenarios"].append("native-gitlab-clone-inspection-real-tls-account-project-account-and-separate-git-authorities")

        preview = prepare(connection, "gitlab-native-ssh", "ssh", "topic/reviewed", 1)
        assert not (fixtures.root / "gitlab-native-ssh").exists()
        before = len(requests())
        refuses("execute_gitlab_clone", "unknown field", request={**execution(preview), "plan": {"url": "https://other.example.test/project.git"}})
        refuses("execute_gitlab_clone", "gitlabClonePreview", request=execution(preview, "other-context"))
        assert len(requests()) == before
        # Replacing the response object cannot replace the server-held plan.
        preview["plan"]["url"] = "https://other.example.test/project.git"
        snapshot = driver.invoke("execute_gitlab_clone", request=execution(preview))
        checkout = Path(snapshot["path"])
        assert checkout == fixtures.root / "gitlab-native-ssh"
        assert fixtures.git(checkout, "rev-parse", "HEAD") == head
        assert fixtures.git(checkout, "symbolic-ref", "--short", "HEAD") == "topic/reviewed"
        assert fixtures.git(checkout, "rev-parse", "--is-shallow-repository") == "true"
        assert fixtures.git(checkout, "rev-list", "--count", "HEAD") == "1"
        assert fixtures.git(checkout, "config", "--get", "remote.origin.url") == ssh
        assert (checkout / "fixture.txt").read_bytes() == source_before["file"]
        assert token not in (checkout / ".git/config").read_text()
        before = len(requests())
        refuses("execute_gitlab_clone", "gitlabClonePreview", request=execution(preview))
        assert len(requests()) == before
        fixtures.git(checkout, "remote", "set-url", "origin", source.as_uri())
        report["scenarios"].append("native-gitlab-clone-native-plan-forgery-context-and-replay-refusal-with-real-ssh-url-shallow-literal-branch")

        preview = prepare(connection, "gitlab-native-changed-url")
        (gate / "project-overrides.json").write_text(json.dumps({
            "http_url_to_repo": "https://changed.example.test/team/subgroup/owned-project.git"}))
        refuses("execute_gitlab_clone", "gitlabCloneRefused", request=execution(preview))
        assert not (fixtures.root / "gitlab-native-changed-url").exists()
        refuses("execute_gitlab_clone", "gitlabClonePreview", request=execution(preview))
        (gate / "project-overrides.json").unlink()
        report["scenarios"].append("native-gitlab-clone-selected-url-revalidated-before-git-and-refused-preview-consumed")

        preview = prepare(connection, "gitlab-native-changed-account")
        (gate / "user.json").write_text(json.dumps({"id": 42, "username": "changed-reader"}))
        before = len(requests())
        refuses("execute_gitlab_clone", "gitlabCloneRefused", request=execution(preview))
        assert len(requests()) == before + 1
        assert not (fixtures.root / "gitlab-native-changed-account").exists()
        (gate / "user.json").unlink()
        report["scenarios"].append("native-gitlab-clone-immutable-account-revalidated-before-project-or-git-reads")

        preview = prepare(connection, "gitlab-native-occupied")
        occupied = fixtures.root / "gitlab-native-occupied"
        occupied.mkdir(); (occupied / "retain").write_bytes(b"owned existing bytes")
        before = len(requests())
        refuses("execute_gitlab_clone", "destination", request=execution(preview))
        assert len(requests()) == before
        assert (occupied / "retain").read_bytes() == b"owned existing bytes"
        refuses("execute_gitlab_clone", "gitlabClonePreview", request=execution(preview))
        report["scenarios"].append("native-gitlab-clone-occupied-destination-preserved-without-provider-io-or-replay")

        cancellation_request = {
            "connectionId": connection["connectionId"], "contextId": context,
            "operationId": str(uuid.uuid4()), "request": {
                "projectId": "101", "fullPath": "team/subgroup/owned-project", "transport": "https",
                "parentPath": str(fixtures.root), "folder": "gitlab-native-cancelled-preview",
                "branch": None, "depth": None, "recurseSubmodules": False}}
        cancel_stalled("prepare_gitlab_clone", cancellation_request)
        assert not (fixtures.root / "gitlab-native-cancelled-preview").exists()
        report["scenarios"].append("native-gitlab-clone-preparation-cancellation-stops-real-https-before-later-reads-or-destination-creation")

        preview = prepare(connection, "gitlab-native-cancelled-execution")
        cancel_stalled("execute_gitlab_clone", execution(preview))
        assert not (fixtures.root / "gitlab-native-cancelled-execution").exists()
        refuses("execute_gitlab_clone", "gitlabClonePreview", request=execution(preview))
        report["scenarios"].append("native-gitlab-clone-execution-cancellation-consumes-preview-and-stops-real-api-revalidation-before-git")

        # Switch HTTPS from the earlier explicit local rewrite to a real owned
        # Git HTTP backend. Keep SSH blocked except for its owned file rewrite.
        from native_gitlab_git_fixture import prepare_git_https
        https_profile = prepare_git_https(fixtures, gate, source)
        global_config.write_bytes(original_global + https_profile + (
            f'[url "{source.as_uri()}"]\ninsteadOf = {ssh}\n').encode())
        preview = prepare(connection, "gitlab-native-real-https", "https", "topic/reviewed", 1)
        snapshot = driver.invoke("execute_gitlab_clone", request=execution(preview))
        checkout = Path(snapshot["path"])
        assert fixtures.git(checkout, "rev-parse", "HEAD") == head
        assert fixtures.git(checkout, "symbolic-ref", "--short", "HEAD") == "topic/reviewed"
        assert fixtures.git(checkout, "rev-parse", "--is-shallow-repository") == "true"
        assert fixtures.git(checkout, "config", "--get", "remote.origin.url") == https
        assert (checkout / "fixture.txt").read_bytes() == source_before["file"]
        assert token not in (checkout / ".git/config").read_text()
        git_records = [json.loads(line) for line in (gate / "git-requests.jsonl").read_text().splitlines()]
        assert any(record["gitCredentialMatched"] for record in git_records)
        assert not any(record["apiCredentialPresent"] for record in git_records)
        fixtures.git(checkout, "remote", "set-url", "origin", source.as_uri())
        report["scenarios"].append("native-gitlab-clone-real-verified-https-git-shallow-branch-with-independent-git-credential-and-no-api-header")

        # Drive the same operation through ordinary desktop controls, not Angular
        # state or a renderer-supplied plan. Native IPC and Git remain installed.
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
        fill("#gitlab-clone-parent", str(fixtures.root))
        fill("#gitlab-clone-folder", "gitlab-native-ui")
        controls = driver.script("""return [...document.querySelectorAll('gc-gitlab-clone label.check')].map(label=>{
          const bounds=label.getBoundingClientRect(), control=label.querySelector('input').getBoundingClientRect();
          return {width:control.width,height:control.height,inset:control.left-bounds.left};});""")
        assert len(controls) == 2
        assert all(14 <= item["width"] <= 20 and 14 <= item["height"] <= 20 and 0 <= item["inset"] < 4 for item in controls), controls
        report["gitlabCloneCheckboxBounds"] = controls
        button("Review GitLab clone", "gc-gitlab-clone button")
        driver.wait("return !!document.querySelector('gc-gitlab-clone [aria-label=\"Review GitLab clone\"]')")
        assert not (fixtures.root / "gitlab-native-ui").exists()
        review_text = driver.script("return document.querySelector('gc-gitlab-clone [aria-label=\"Review GitLab clone\"]').textContent")
        assert origin in review_text and https in review_text and token not in review_text
        driver.screenshot(Path(report["artifactsDirectory"]) / "gitlab-clone-native-review.png")
        button("Clone reviewed GitLab project", "gc-gitlab-clone button")
        driver.wait("return !document.querySelector('gc-repository-dialog')", 60)
        checkout = fixtures.root / "gitlab-native-ui"
        assert fixtures.git(checkout, "rev-parse", "HEAD") == head
        assert fixtures.git(checkout, "rev-parse", "--is-shallow-repository") == "false"
        assert fixtures.git(checkout, "config", "--get", "remote.origin.url") == https
        assert fixtures.git(checkout, "status", "--porcelain") == ""
        assert (checkout / "fixture.txt").read_bytes() == source_before["file"]
        assert token not in (checkout / ".git/config").read_text()
        driver.screenshot(Path(report["artifactsDirectory"]) / "gitlab-clone-native-completed.png")
        fixtures.git(checkout, "remote", "set-url", "origin", source.as_uri())
        report["scenarios"].append("native-ui-gitlab-fresh-selection-reviewed-https-url-clone-opens-exact-git-history-without-api-credential")

        from native_gitlab_ssh_scenarios import gitlab_ssh_clone
        gitlab_ssh_clone(driver, fixtures, original_repository, report, connection,
                         head, source_before["file"], source, button, fill, open_ui,
                         original_global + https_profile)

        open_ui(driver, original_repository)
        preview = prepare(connection, "gitlab-native-mid-pack")
        transfer_request = execution(preview)
        marker = gate / "git-started.json"
        marker.unlink(missing_ok=True)
        (gate / "git-hold").touch()
        try:
            driver.script("""window.__ownedGitLabTransfer={done:false};
              window.__TAURI_INTERNALS__.invoke('execute_gitlab_clone',{request:arguments[0]}).then(
                value=>{window.__ownedGitLabTransfer={done:true,value}},
                error=>{window.__ownedGitLabTransfer={done:true,error}});""", transfer_request)
            deadline = time.monotonic() + 10
            while not marker.exists() and time.monotonic() < deadline:
                result = driver.script("return window.__ownedGitLabTransfer")
                assert not result["done"], result
                time.sleep(.02)
            transfer = json.loads(marker.read_text())
            assert 0 <= transfer["packMagicOffset"] < transfer["sentPrefixBytes"] - 4 < transfer["responseBytes"]
            before = len(requests())
            assert driver.invoke("disconnect_gitlab_account", connectionId=connection["connectionId"])
            assert driver.invoke("gitlab_connections") == []
            deadline = time.monotonic() + .2
            while time.monotonic() < deadline:
                assert not driver.script("return window.__ownedGitLabTransfer.done"), "API disconnect cancelled the separate Git transfer"
                time.sleep(.02)
            assert len(requests()) == before
            assert driver.invoke("cancel_git_operation", operationId=transfer_request["operationId"])
            driver.wait("return window.__ownedGitLabTransfer.done", 10)
            result = driver.script("return window.__ownedGitLabTransfer")
            assert result["error"]["kind"] == "operationCancelled", result
            assert token not in json.dumps(result) and "owned-git-credential" not in json.dumps(result)
            partial = fixtures.root / "gitlab-native-mid-pack"
            transfer["destinationExistsAfterCancel"] = partial.exists()
            if partial.exists():
                assert str(partial) in result["error"].get("hint", ""), result
            report["gitlabGitTransfer"] = transfer
        finally:
            (gate / "git-hold").unlink(missing_ok=True)
        refuses("execute_gitlab_clone", "gitlabClonePreview", request=execution(preview))
        report["scenarios"].append("native-gitlab-clone-api-disconnect-after-real-pack-handoff-keeps-git-transfer-live-until-explicit-cancel-and-refuses-replay")

        connection = driver.invoke("connect_gitlab_account", request={"origin": origin, "token": token,
                                   "operationId": str(uuid.uuid4())})
        preview = prepare(connection, "gitlab-native-after-restart")
        before = len(requests())
        driver.restart_application()
        driver.wait("return !!document.querySelector('gc-root')")
        refuses("execute_gitlab_clone", "gitlabClonePreview", request=execution(preview))
        assert not (fixtures.root / "gitlab-native-after-restart").exists()
        assert driver.invoke("gitlab_connections") == []
        assert len(requests()) == before
        report["scenarios"].append("native-gitlab-clone-process-restart-retires-preview-and-credential-without-provider-replay")

        assert fixtures.git(source, "show-ref") == source_before["refs"]
        assert (source / ".git/index").read_bytes() == source_before["index"]
        assert (source / ".git/config").read_bytes() == source_before["config"]
        assert (source / "fixture.txt").read_bytes() == source_before["file"]
        assert fixtures.git(source, "status", "--porcelain") == source_before["status"]
        observed = requests()
        assert all(record["credentialMatched"] and not record["destination"] for record in observed)
        assert token not in records.read_text()
        git_records = [json.loads(line) for line in (gate / "git-requests.jsonl").read_text().splitlines()]
        assert any(record["gitCredentialMatched"] for record in git_records)
        assert not any(record["apiCredentialPresent"] for record in git_records)
        raw_git_records = (gate / "git-requests.jsonl").read_text()
        assert token not in raw_git_records and "owned-git-credential" not in raw_git_records
        report["gitlabGitRequests"] = git_records
        report["gitlabRequests"] = observed
        report["scenarios"].append("native-gitlab-clone-preserves-source-git-state-and-keeps-synthetic-api-credential-out-of-git-config-and-logs")
    finally:
        (gate / "git-hold").unlink(missing_ok=True)
        global_config.write_bytes(original_global)
        (gate / "project-overrides.json").unlink(missing_ok=True)
        (gate / "user.json").unlink(missing_ok=True)
        (gate / "mode").write_text("normal")
