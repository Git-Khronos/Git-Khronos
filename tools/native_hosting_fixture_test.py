"""Verify the offline provider model before trusting packaged acceptance."""
import json
import subprocess
import tempfile
import unittest

from native_acceptance import Fixtures


class ForkFixtureTests(unittest.TestCase):
    def test_fork_opt_in_payload_identity_pending_objects_and_uncertain_write(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            environment = fixtures.env | fixtures.hosting_environment()
            gate = fixtures.hosting_gate
            config_path = gate / "config.json"
            config = json.loads(config_path.read_text())
            command = [str(fixtures.root / "hosting-bin/gh"), "api", "--hostname", "github.com", "--method"]

            def request(method, endpoint, payload=None):
                args = command + [method, "-H", "Accept: application/vnd.github+json", endpoint]
                if payload is not None:
                    args += ["--input", "-"]
                return subprocess.run(args, env=environment, capture_output=True,
                                      input=None if payload is None else json.dumps(payload).encode())

            endpoint = "repos/owned-fixture/native-repo/forks"
            body = {"name": "owned-fork", "default_branch_only": True}
            self.assertNotEqual(request("POST", endpoint, body).returncode, 0)
            self.assertFalse((gate / "write-state.json").exists())
            config.update(allowForks=True, forkPending=True)
            config_path.write_text(json.dumps(config))
            self.assertEqual(json.loads(request("GET", "users/owned-author").stdout)["id"], 501)
            for foreign in ("repos/foreign/repo/forks", "https://api.github.com/" + endpoint):
                self.assertNotEqual(request("POST", foreign, body).returncode, 0)
            self.assertNotEqual(request("POST", endpoint, body | {"organization": "foreign"}).returncode, 0)
            self.assertFalse((gate / "write-state.json").exists())
            self.assertEqual(request("POST", endpoint, body).returncode, 0)
            self.assertNotEqual(request("GET", "repos/owned-author/owned-fork").returncode, 0)
            config.update(forkPending=False, forkObjectsPending=True)
            config_path.write_text(json.dumps(config))
            fork = json.loads(request("GET", "repos/owned-author/owned-fork").stdout)
            self.assertEqual(fork["id"], 9007199254740995)
            self.assertEqual(fork["source"]["id"], 9007199254740993)
            ref = "repos/owned-author/owned-fork/git/ref/heads/main"
            self.assertNotEqual(request("GET", ref).returncode, 0)
            config.update(forkObjectsPending=False, uncertainAfterWrite=True)
            config_path.write_text(json.dumps(config))
            self.assertEqual(json.loads(request("GET", ref).stdout)["object"]["sha"], config["oid"])
            self.assertNotEqual(request("POST", endpoint, body).returncode, 0)
            self.assertEqual(json.loads((gate / "write-state.json").read_text())["forks"], [body, body])


if __name__ == "__main__":
    unittest.main()
