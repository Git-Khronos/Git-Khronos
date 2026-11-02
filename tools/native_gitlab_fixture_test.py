"""Qualify the owned TLS fixture before trusting packaged GitLab acceptance."""
import json
from pathlib import Path
import ssl
import subprocess
import time
import tempfile
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

from native_acceptance import Fixtures, stop_owned_process_group
from native_gitlab_scenarios import start_gitlab_fixture
from native_gitlab_git_fixture import prepare_git_https


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class GitLabFixtureTests(unittest.TestCase):
    def test_private_trust_verified_origin_redacted_log_and_owned_redirect(self):
        children = []
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            try:
                with (Path(directory) / "fixture.log").open("w") as log:
                    environment = start_gitlab_fixture(fixtures, children, log, {})
                    self.assertEqual(set(environment), {"SSL_CERT_FILE", "SSL_CERT_DIR"})
                    self.assertTrue(Path(environment["SSL_CERT_FILE"]).is_relative_to(directory))
                    self.assertEqual(list(Path(environment["SSL_CERT_DIR"]).iterdir()), [])
                    url = fixtures.gitlab_origin + "/api/v4/user"
                    untrusted = build_opener(ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()))
                    with self.assertRaises(URLError):
                        untrusted.open(url, timeout=5)
                    gate = fixtures.gitlab_gate
                    self.assertFalse((gate / "requests.jsonl").exists())
                    trusted = build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(
                        context=ssl.create_default_context(cafile=environment["SSL_CERT_FILE"])))
                    request = Request(url, headers={"PRIVATE-TOKEN": "owned-api-fixture-token"})
                    with trusted.open(request, timeout=5) as response:
                        self.assertEqual(json.load(response), {"id": 41, "username": "owned-reader"})
                    (gate / "mode").write_text("redirect-302")
                    with self.assertRaises(HTTPError) as failure:
                        trusted.open(request, timeout=5)
                    self.assertEqual(failure.exception.code, 302)
                    failure.exception.close()
                    raw = (gate / "requests.jsonl").read_text()
                    self.assertNotIn("owned-api-fixture-token", raw)
                    self.assertEqual([json.loads(line) for line in raw.splitlines()], [
                        {"destination": False, "path": "/api/v4/user", "method": "GET", "credentialMatched": True},
                        {"destination": False, "path": "/api/v4/user", "method": "GET", "credentialMatched": True},
                    ])
                    (gate / "mode").write_text("normal")
                    project_url = fixtures.gitlab_origin + "/api/v4/projects/101"
                    def read(url):
                        with trusted.open(Request(url, headers={"PRIVATE-TOKEN": "owned-api-fixture-token"}), timeout=5) as response:
                            return json.load(response)
                    project = read(project_url)
                    self.assertEqual(project["id"], 101)
                    self.assertEqual(project["path_with_namespace"], "team/subgroup/owned-project")
                    self.assertIsNone(project["default_branch"])
                    self.assertEqual(project["http_url_to_repo"], fixtures.gitlab_origin + "/team/subgroup/owned-project.git")
                    self.assertEqual(project["ssh_url_to_repo"], "ssh://git@ssh.example.test:2222/team/subgroup/owned-project.git")
                    (gate / "project-overrides.json").write_text(json.dumps({"http_url_to_repo": "https://changed.example.test/team/subgroup/owned-project.git"}))
                    self.assertEqual(read(project_url)["http_url_to_repo"], "https://changed.example.test/team/subgroup/owned-project.git")
                    (gate / "user.json").write_text(json.dumps({"id": 42, "username": "changed-reader"}))
                    self.assertEqual(read(url), {"id": 42, "username": "changed-reader"})
                    self.assertNotIn("owned-api-fixture-token", (gate / "requests.jsonl").read_text())
            finally:
                for child in reversed(children):
                    stop_owned_process_group(child)
                    child.stdout.close()

    def test_real_git_https_private_trust_separate_credentials_and_partial_pack_gate(self):
        children = []
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            try:
                with (Path(directory) / "git-fixture.log").open("w") as log:
                    start_gitlab_fixture(fixtures, children, log, {})
                    gate = fixtures.gitlab_gate
                    source = fixtures.repository("source", commits=3)
                    profile = prepare_git_https(fixtures, gate, source)
                    remote = fixtures.gitlab_origin + "/team/subgroup/owned-project.git"
                    untrusted = subprocess.run(["git", "clone", remote, str(fixtures.root / "untrusted")],
                                               env=fixtures.env, capture_output=True, timeout=15)
                    self.assertNotEqual(untrusted.returncode, 0)
                    self.assertIn(b"certificate", untrusted.stderr.lower())
                    self.assertFalse((gate / "git-requests.jsonl").exists())
                    config = Path(fixtures.env["GIT_CONFIG_GLOBAL"])
                    config.write_bytes(config.read_bytes() + profile)
                    fixtures.git(fixtures.root, "clone", remote, str(fixtures.root / "trusted"))
                    self.assertEqual(fixtures.git(fixtures.root / "trusted", "rev-parse", "HEAD"), fixtures.git(source, "rev-parse", "HEAD"))
                    self.assertEqual((fixtures.root / "trusted/fixture.txt").read_bytes(), (source / "fixture.txt").read_bytes())
                    records = [json.loads(line) for line in (gate / "git-requests.jsonl").read_text().splitlines()]
                    self.assertTrue(any(record["gitCredentialMatched"] for record in records))
                    self.assertFalse(any(record["apiCredentialPresent"] for record in records))
                    self.assertFalse((gate / "requests.jsonl").exists(), "Git must not call the API fixture routes")
                    for marker in ("owned-api-fixture-token", "owned-git-credential"):
                        self.assertNotIn(marker, (gate / "git-requests.jsonl").read_text())
                    (gate / "git-hold").touch()
                    stalled = subprocess.Popen(["git", "clone", remote, str(fixtures.root / "stalled")],
                                               env=fixtures.env, stdout=log, stderr=log, start_new_session=True)
                    children.append(stalled)
                    deadline = time.monotonic() + 10
                    while not (gate / "git-started.json").exists() and time.monotonic() < deadline:
                        self.assertIsNone(stalled.poll())
                        time.sleep(.02)
                    transfer = json.loads((gate / "git-started.json").read_text())
                    self.assertGreaterEqual(transfer["packMagicOffset"], 0)
                    self.assertGreater(transfer["sentPrefixBytes"], transfer["packMagicOffset"] + 4)
                    self.assertLess(transfer["sentPrefixBytes"], transfer["responseBytes"])
                    self.assertIsNone(stalled.poll())
                    stop_owned_process_group(stalled)
            finally:
                if hasattr(fixtures, "gitlab_gate"):
                    (fixtures.gitlab_gate / "git-hold").unlink(missing_ok=True)
                for child in reversed(children):
                    stop_owned_process_group(child)
                    if child.stdout:
                        child.stdout.close()


if __name__ == "__main__":
    unittest.main()
