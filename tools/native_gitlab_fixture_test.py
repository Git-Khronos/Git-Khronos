"""Qualify the owned TLS fixture before trusting packaged GitLab acceptance."""
import json
from pathlib import Path
import ssl
import tempfile
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

from native_acceptance import Fixtures, stop_owned_process_group
from native_gitlab_scenarios import start_gitlab_fixture


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
                        {"destination": False, "path": "/api/v4/user", "credentialMatched": True},
                        {"destination": False, "path": "/api/v4/user", "credentialMatched": True},
                    ])
            finally:
                for child in reversed(children):
                    stop_owned_process_group(child)
                    child.stdout.close()


if __name__ == "__main__":
    unittest.main()
