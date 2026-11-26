"""GitLab catalogue acceptance using packaged IPC and owned HTTPS only."""
import hashlib
import json
import re
import select
import socket
import ssl
import subprocess
import sys
import time
import uuid

from native_repository_navigation import open_gitlab_catalogue


def _owned_tls_handshake(gate, port, timeout):
    context = ssl.create_default_context(cafile=str(gate / "certificate.pem"))
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as sock:
        with context.wrap_socket(sock, server_hostname="127.0.0.1"):
            pass  # No HTTP request, API credential, or certificate override.


def _diagnose_owned_tls(gate, port):
    """Separate a fixture outage from a packaged-client refusal without replaying HTTP."""
    try:
        _owned_tls_handshake(gate, port, timeout=2)
    except ssl.SSLCertVerificationError:
        return "certificate-verification-failed"
    except ssl.SSLError:
        return "tls-negotiation-failed"
    except TimeoutError:
        return "timed-out"
    except ConnectionRefusedError:
        return "listener-refused"
    except OSError:
        return "fixture-io-failed"
    return "negotiated"


def _prove_owned_tls(gate, port):
    _owned_tls_handshake(gate, port, timeout=5)
    record_path = gate / "tls-observations.jsonl"
    deadline = time.monotonic() + 3
    expected = [{"destination": False, "outcome": "negotiated", "reason": None}]
    while time.monotonic() < deadline:
        if record_path.exists():
            entries = [json.loads(line) for line in record_path.read_text().splitlines()]
            if entries:
                if entries != expected:
                    raise RuntimeError("Unexpected initial TLS fixture observations")
                return len(entries)
        time.sleep(0.01)
    raise TimeoutError("The owned GitLab listener did not record its prelaunch TLS handshake")


def _owned_accept_count(gate):
    ledger = gate / "tcp-accepts"
    if not ledger.is_file():
        return None  # Older fixture snapshots have no TCP observation.
    return ledger.stat().st_size


def start_gitlab_fixture(fixtures, children, log, report):
    from native_acceptance import ROOT

    gate = fixtures.root / "gitlab-https"
    gate.mkdir(mode=0o700)
    (gate / "mode").write_text("normal")
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "crates/git-core/src/gitlab_https_fixture.py"), str(gate), "--ipv4-origin"],
        env=fixtures.env, stdout=subprocess.PIPE, stderr=log, start_new_session=True,
    )
    children.append(process)
    if not select.select([process.stdout], [], [], 15)[0]:
        raise TimeoutError("Owned GitLab HTTPS fixture did not become ready")
    ready = json.loads(process.stdout.readline())
    origin = ready["origin"]
    owned = re.fullmatch(r"https://127\.0\.0\.1:([1-9][0-9]{0,4})", origin)
    if not owned or int(owned.group(1)) > 65535:
        raise RuntimeError("Unexpected owned HTTPS fixture origin")
    # The server binds IPv4 only. Use that exact IP SAN and prove readiness
    # independently of localhost resolution and of the installed app.
    fixtures.gitlab_preflight_tls_count = _prove_owned_tls(gate, int(owned.group(1)))
    empty_ca_directory = gate / "empty-ca-directory"
    empty_ca_directory.mkdir(mode=0o700)
    fixtures.gitlab_gate, fixtures.gitlab_origin = gate, origin
    report["gitlabFixture"] = {"origin": origin, "credential": "synthetic-only",
                               "trust": "private-process-SSL_CERT_FILE",
                               "verifiedLocalTlsBeforeLaunch": True,
                               "certificateSha256": hashlib.sha256((gate / "certificate.pem").read_bytes()).hexdigest()}
    # Native TLS verifies this certificate normally. Only the owned application
    # process inherits the private trust store; host trust is never changed.
    from native_gitlab_ssh_fixture import start_gitlab_ssh
    # The packaged GitLab suite requires SSH; HTTPS fixture units remain isolated.
    ssh_environment = (start_gitlab_ssh(fixtures, gate, children, report)
                       if report.get("suite") in ("gitlab", "gitlab-connect-after-smoke") else {})
    return {"SSL_CERT_FILE": str(gate / "certificate.pem"),
            "SSL_CERT_DIR": str(empty_ca_directory), **ssh_environment}


def gitlab_catalogue(driver, fixtures, repository, report, *, connect_only=False, refused_origin=None):
    gate, origin = fixtures.gitlab_gate, refused_origin or fixtures.gitlab_origin
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

    def assert_git_preserved():
        assert fixtures.git(repository, "show-ref") == refs
        assert (repository / ".git/index").read_bytes() == index
        assert (repository / ".git/config").read_bytes() == config
        assert fixtures.git(repository, "status", "--porcelain=v1") == status

    assert driver.invoke("gitlab_connections") == []
    assert requests() == []
    open_gitlab_catalogue(driver)
    assert requests() == []
    fill("#gitlab-origin", origin)
    fill("#gitlab-token", token)
    accept_before_click = _owned_accept_count(gate)
    driver.click_scrolled_text("gk-gitlab-projects button", "Connect to GitLab", wait_for_ready=True)
    # Do not turn a completed refusal into a generic wait timeout or replay
    # the connection. Report only the category and credential-safe counters.
    observation = driver.wait("""
        const catalogue = document.querySelector('gk-gitlab-projects');
        if (!catalogue || catalogue.querySelector('section')?.getAttribute('aria-busy') === 'true') return null;
        if (catalogue.querySelector('#gitlab-account')?.value) return {outcome: 'connected'};
        const alert = catalogue.querySelector('[role=alert]')?.textContent.trim();
        if (!alert) return null;
        if (alert.includes('verified HTTPS read')) {
          const stages = [
            ['HTTPS client could not be initialized', 'client-setup'],
            ['TCP connection was refused', 'tcp-refused'],
            ['host or network was unreachable', 'network-unreachable'],
            ['operating system denied the connection', 'network-denied'],
            ['verified connection could not be established', 'connect-unclassified'],
            ['request or response was interrupted', 'interrupted'],
          ];
          return {outcome: 'https-connection-refused',
            stage: stages.find(([text]) => alert.includes(text))?.[1] ?? null};
        }
        if (alert.includes('timed out')) return {outcome: 'timeout'};
        if (alert.includes('did not accept the selected credential')) return {outcome: 'credential-refused'};
        return {outcome: 'other-app-refusal'};
    """)
    connect_result = observation["outcome"]
    observed = requests()
    tls_records = gate / "tls-observations.jsonl"
    preflight_count = fixtures.gitlab_preflight_tls_count
    accept_after_click = _owned_accept_count(gate)
    report["gitlabInitialConnect"] = {
        "outcome": connect_result,
        "fixtureTcpAccepts": accept_after_click - accept_before_click
        if accept_before_click is not None and accept_after_click is not None else None,
        "fixtureApiRequests": len(observed),
        "matchingFixtureCredentials": sum(request["credentialMatched"] for request in observed),
        "fixtureTls": [json.loads(line) for line in tls_records.read_text().splitlines()[preflight_count:preflight_count + 16]]
        if tls_records.exists() else [],
    }
    if connect_result != "connected":
        report["gitlabInitialConnect"]["appFailureStage"] = observation.get("stage")
        report["gitlabInitialConnect"]["fixtureTlsAfterRefusal"] = _diagnose_owned_tls(
            gate, int(origin.rsplit(":", 1)[1]))
    if refused_origin is not None:
        result = report["gitlabInitialConnect"]
        assert connect_result == "https-connection-refused" and result["appFailureStage"] == "tcp-refused", result
        assert result["fixtureTlsAfterRefusal"] == "listener-refused" and not observed, result
        assert result["fixtureTcpAccepts"] == 0 and result["fixtureTls"] == [], result
        assert driver.invoke("gitlab_connections") == []
        assert driver.script("return document.querySelector('#gitlab-token').value") == ""
        assert token not in driver.script("return document.body.textContent")
        assert_git_preserved()
        report["scenarios"].append("native-gitlab-tcp-refusal-explains-failure-clears-token-and-sends-no-http")
        return
    assert connect_result == "connected", (
        "Installed app refused the initial owned GitLab connection", report["gitlabInitialConnect"])
    connections = driver.invoke("gitlab_connections")
    assert len(connections) == 1, connections
    connection = connections[0]
    assert re.fullmatch(r"[a-f0-9]{32}", connection["connectionId"])
    assert connection["account"] == {"origin": origin, "id": "41", "login": "owned-reader"}
    assert token not in json.dumps(connections)
    assert driver.script("return document.querySelector('#gitlab-token').value") == ""
    assert token not in driver.script("return document.body.textContent")
    assert len(observed) == 1 and observed[0]["credentialMatched"]
    report["scenarios"].append("native-gitlab-explicit-connect-verified-private-tls-native-account-and-cleared-token")

    if connect_only:
        assert_git_preserved()
        return

    button("Load GitLab projects")
    driver.wait("return document.querySelector('gk-gitlab-projects ul')?.textContent.includes('team/subgroup/owned-project')")
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
    driver.wait("return [...document.querySelectorAll('gk-gitlab-projects button')].some(b => b.textContent.trim() === 'Cancel GitLab request' && !b.disabled)")
    deadline = time.monotonic() + 5
    while len(requests()) == before:
        if time.monotonic() >= deadline:
            raise TimeoutError("Owned stalled GitLab request was not observed")
        time.sleep(.02)
    button("Cancel GitLab request")
    driver.wait("return [...document.querySelectorAll('gk-gitlab-projects button')].some(b => b.textContent.trim() === 'Load GitLab projects' && !b.disabled)")
    assert len(requests()) == before + 1
    assert driver.script("return document.querySelector('gk-gitlab-projects ul').textContent.includes('team/subgroup/owned-project')")
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
    driver.wait("return !!document.querySelector('gk-root')")
    assert driver.invoke("gitlab_connections") == []
    assert len(requests()) == before
    report["scenarios"].append("native-gitlab-application-restart-restores-no-credential-and-replays-no-provider-request")
    assert_git_preserved()
    report["gitlabRequests"] = requests()
    report["scenarios"].append("native-gitlab-catalogue-preserves-independent-git-refs-index-config-and-working-tree")

    from native_gitlab_clone_scenarios import gitlab_reviewed_clones
    gitlab_reviewed_clones(driver, fixtures, repository, report)

    from native_gitlab_fork_scenarios import gitlab_reviewed_forks
    gitlab_reviewed_forks(driver, fixtures, repository, report)


def report_path(report, name):
    from pathlib import Path
    return Path(report["artifactsDirectory"]) / name
