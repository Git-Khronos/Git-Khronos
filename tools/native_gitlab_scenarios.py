"""GitLab catalogue acceptance using packaged IPC and owned HTTPS only."""
import hashlib
import json
import re
import select
import subprocess
import sys
import time
import uuid


def start_gitlab_fixture(fixtures, children, log, report):
    from native_acceptance import ROOT

    gate = fixtures.root / "gitlab-https"
    gate.mkdir(mode=0o700)
    (gate / "mode").write_text("normal")
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "crates/git-core/src/gitlab_https_fixture.py"), str(gate)],
        env=fixtures.env, stdout=subprocess.PIPE, stderr=log, start_new_session=True,
    )
    children.append(process)
    if not select.select([process.stdout], [], [], 15)[0]:
        raise TimeoutError("Owned GitLab HTTPS fixture did not become ready")
    ready = json.loads(process.stdout.readline())
    origin = ready["origin"]
    if not re.fullmatch(r"https://localhost:[0-9]+", origin):
        raise RuntimeError("Unexpected owned HTTPS fixture origin")
    empty_ca_directory = gate / "empty-ca-directory"
    empty_ca_directory.mkdir(mode=0o700)
    fixtures.gitlab_gate, fixtures.gitlab_origin = gate, origin
    report["gitlabFixture"] = {"origin": origin, "credential": "synthetic-only",
                               "trust": "private-process-SSL_CERT_FILE",
                               "certificateSha256": hashlib.sha256((gate / "certificate.pem").read_bytes()).hexdigest()}
    # Native TLS verifies this certificate normally. Only the owned application
    # process inherits the private trust store; host trust is never changed.
    from native_gitlab_ssh_fixture import start_gitlab_ssh
    # The packaged GitLab suite requires SSH; HTTPS fixture units remain isolated.
    ssh_environment = start_gitlab_ssh(fixtures, gate, children, report) if report.get("suite") == "gitlab" else {}
    return {"SSL_CERT_FILE": str(gate / "certificate.pem"),
            "SSL_CERT_DIR": str(empty_ca_directory), **ssh_environment}


def gitlab_catalogue(driver, fixtures, repository, report):
    gate, origin = fixtures.gitlab_gate, fixtures.gitlab_origin
    token = "owned-api-fixture-token"
    records = gate / "requests.jsonl"

    def requests():
        return [json.loads(line) for line in records.read_text().splitlines()] if records.exists() else []

    def mode(value):
        (gate / "mode").write_text(value)

    def button(text):
        driver.wait("return [...document.querySelectorAll('button')].some(b => b.getClientRects().length && !b.disabled && b.textContent.trim() === " + json.dumps(text) + ")")
        driver.click_text("button", text)

    def fill(selector, value):
        driver.script("""const input = document.querySelector(arguments[0]);
          if (!input || input.disabled) throw Error('Owned input unavailable');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, arguments[1]);
          input.dispatchEvent(new Event('input', {bubbles:true}));""", selector, value)

    def refused(command, **args):
        try:
            driver.invoke(command, **args)
        except RuntimeError as error:
            assert token not in str(error), error
            return str(error)
        raise AssertionError("Owned refusal unexpectedly succeeded: " + command)

    def connect_native():
        return driver.invoke("connect_gitlab_account", request={
            "origin": origin, "token": token, "operationId": str(uuid.uuid4())})

    def load_native(connection):
        return driver.invoke("load_gitlab_projects", request={
            "connectionId": connection["connectionId"], "operationId": str(uuid.uuid4()),
            "query": {"scope": "membership", "search": "", "page": 1,
                      "includeArchived": False, "expectedAccount": connection["account"]}})

    refs = fixtures.git(repository, "show-ref")
    index = (repository / ".git/index").read_bytes()
    config = (repository / ".git/config").read_bytes()
    status = fixtures.git(repository, "status", "--porcelain=v1")
    assert driver.invoke("gitlab_connections") == []
    assert requests() == []
    driver.click('[aria-label="New repository tab"]')
    driver.wait("return !!document.querySelector('#repository-tab-clone')?.getClientRects().length")
    driver.click_text('gc-repository-dialog [role=tab]', 'Clone')
    button("Browse GitLab projects")
    driver.wait("return !!document.querySelector('#gitlab-origin') && !document.querySelector('#gitlab-origin').disabled")
    assert requests() == []
    fill("#gitlab-origin", origin)
    fill("#gitlab-token", token)
    button("Connect to GitLab")
    driver.wait("return !!document.querySelector('#gitlab-account')?.value")
    connections = driver.invoke("gitlab_connections")
    assert len(connections) == 1, connections
    connection = connections[0]
    assert re.fullmatch(r"[a-f0-9]{32}", connection["connectionId"])
    assert connection["account"] == {"origin": origin, "id": "41", "login": "owned-reader"}
    assert token not in json.dumps(connections)
    assert driver.script("return document.querySelector('#gitlab-token').value") == ""
    assert token not in driver.script("return document.body.textContent")
    assert len(requests()) == 1 and requests()[0]["credentialMatched"]
    report["scenarios"].append("native-gitlab-explicit-connect-verified-private-tls-native-account-and-cleared-token")

    button("Load GitLab projects")
    driver.wait("return document.querySelector('gc-gitlab-projects ul')?.textContent.includes('team/subgroup/owned-project')")
    assert len(requests()) == 4, requests()
    assert all(record["credentialMatched"] and not record["destination"] for record in requests())
    assert "owned-not-exported-marker" not in driver.script("return document.body.textContent")
    driver.screenshot(report_path(report, "gitlab-catalogue.png"))
    report["scenarios"].append("native-gitlab-project-page-real-ipc-three-verified-reads-and-inert-allowlisted-metadata")

    before = len(requests())
    refused("connect_gitlab_account", request={"origin": "http://localhost", "token": token,
                                              "operationId": str(uuid.uuid4())})
    assert len(requests()) == before
    mode("redirect-302")
    refused("connect_gitlab_account", request={"origin": origin, "token": token,
                                              "operationId": str(uuid.uuid4())})
    assert len(requests()) == before + 1
    assert not any(record["destination"] for record in requests())
    assert driver.invoke("gitlab_connections") == connections
    report["scenarios"].append("native-gitlab-invalid-origin-and-redirect-refused-without-destination-requests-or-account-replacement")

    mode("stalled")
    before = len(requests())
    button("Load GitLab projects")
    driver.wait("return [...document.querySelectorAll('gc-gitlab-projects button')].some(b => b.textContent.trim() === 'Cancel GitLab request' && !b.disabled)")
    deadline = time.monotonic() + 5
    while len(requests()) == before:
        if time.monotonic() >= deadline:
            raise TimeoutError("Owned stalled GitLab request was not observed")
        time.sleep(.02)
    button("Cancel GitLab request")
    driver.wait("return [...document.querySelectorAll('gc-gitlab-projects button')].some(b => b.textContent.trim() === 'Load GitLab projects' && !b.disabled)")
    assert len(requests()) == before + 1
    assert driver.script("return document.querySelector('gc-gitlab-projects ul').textContent.includes('team/subgroup/owned-project')")
    report["scenarios"].append("native-gitlab-stalled-https-cancellation-retains-previous-results-and-stops-later-provider-reads")

    mode("normal")
    before = len(requests())
    button("Disconnect owned-reader")
    driver.wait("return document.querySelector('#gitlab-account')?.value === ''")
    assert driver.invoke("gitlab_connections") == []
    try:
        load_native(connection)
    except RuntimeError as error:
        assert token not in str(error)
    else:
        raise AssertionError("Disconnected connection unexpectedly authorized a read")
    assert len(requests()) == before
    report["scenarios"].append("native-gitlab-disconnect-and-retired-id-refusal-perform-no-provider-requests")

    connect_native()
    assert len(driver.invoke("gitlab_connections")) == 1
    before = len(requests())
    driver.restart_application()
    driver.wait("return !!document.querySelector('gc-root')")
    assert driver.invoke("gitlab_connections") == []
    assert len(requests()) == before
    report["scenarios"].append("native-gitlab-application-restart-restores-no-credential-and-replays-no-provider-request")
    assert fixtures.git(repository, "show-ref") == refs
    assert (repository / ".git/index").read_bytes() == index
    assert (repository / ".git/config").read_bytes() == config
    assert fixtures.git(repository, "status", "--porcelain=v1") == status
    report["gitlabRequests"] = requests()
    report["scenarios"].append("native-gitlab-catalogue-preserves-independent-git-refs-index-config-and-working-tree")

    from native_gitlab_clone_scenarios import gitlab_reviewed_clones
    gitlab_reviewed_clones(driver, fixtures, repository, report)

    from native_gitlab_fork_scenarios import gitlab_reviewed_forks
    gitlab_reviewed_forks(driver, fixtures, repository, report)


def report_path(report, name):
    from pathlib import Path
    return Path(report["artifactsDirectory"]) / name
