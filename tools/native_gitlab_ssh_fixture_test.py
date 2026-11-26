"""The loopback server exposes only one literal read-only Git command."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from native_gitlab_ssh_scenarios import wait_for_ssh_clone_outcome
from native_gitlab_ssh_fixture import accepted_upload, resolve_sshd, serve_upload, sshd_helper_config, VIRTUAL_REPOSITORY


class GitLabSshFixtureTests(unittest.TestCase):
    def test_requires_absolute_executable_server_and_explains_https_only_alternative(self):
        with tempfile.TemporaryDirectory() as directory:
            server = Path(directory) / "sshd"
            with patch.dict(os.environ, {"GIT_KHRONOS_SSHD": str(server)}):
                with self.assertRaisesRegex(RuntimeError, "openssh-server.*gitlab-fork-ui"):
                    resolve_sshd()
                server.touch()
                server.chmod(0o600)
                with self.assertRaisesRegex(RuntimeError, "executable OpenSSH server"):
                    resolve_sshd()
                server.chmod(0o700)
                self.assertEqual(resolve_sshd(), server)
            with patch.dict(os.environ, {"GIT_KHRONOS_SSHD": "relative/sshd"}):
                with self.assertRaisesRegex(RuntimeError, "absolute path"):
                    resolve_sshd()

    def test_selects_both_helpers_from_an_extracted_server_prefix(self):
        with tempfile.TemporaryDirectory(prefix="sshd fixture ") as directory:
            prefix = Path(directory) / "usr"
            helpers = prefix / "lib/openssh"
            helpers.mkdir(parents=True)
            session = helpers / "sshd-session"
            auth = helpers / "sshd-auth"
            self.assertEqual(sshd_helper_config(prefix / "sbin/sshd"), "")
            session.touch()
            self.assertEqual(sshd_helper_config(prefix / "sbin/sshd"), "")
            auth.touch()
            self.assertEqual(
                sshd_helper_config(prefix / "sbin/sshd"),
                f'SshdSessionPath "{session}"\nSshdAuthPath "{auth}"\n',
            )

    def test_native_clone_wait_accepts_close_and_observes_without_replay(self):
        driver = Mock()
        driver.wait.return_value = {"kind": "closed"}
        wait_for_ssh_clone_outcome(driver, Path("unused-journal.jsonl"))
        self.assertEqual(len(driver.method_calls), 1)
        self.assertIn("gk-gitlab-clone [role=", driver.wait.call_args.args[0])

    def test_native_clone_refusal_reports_terminal_feedback_without_dumping_fixture_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / "uploads.jsonl"
            log = journal.parent / "server.log"
            log.write_bytes(b"Private fixture noise\nUser unavailable not allowed because account is locked\n")
            driver = Mock()
            driver.wait.return_value = {"kind": "error", "message": "Git transport failed"}
            with self.assertRaisesRegex(AssertionError, "Git transport failed.*locked login") as caught:
                wait_for_ssh_clone_outcome(driver, journal)
            self.assertNotIn("Private fixture noise", str(caught.exception))
            self.assertEqual(len(driver.method_calls), 1)
            self.assertFalse(journal.exists())

    def test_native_clone_failure_distinguishes_transport_from_unreached_owned_command(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / "uploads.jsonl"
            log = journal.parent / "server.log"
            driver = Mock()
            driver.wait.return_value = {"kind": "error", "message": "Git transport failed"}
            for record, diagnostic in (
                (b"Connection closed before authentication", "No accepted key or owned Git operation"),
                (b"error while loading shared libraries: private-fixture.so", "could not load its shared libraries"),
                (b"Accepted publickey with private fixture details", "accepted a key.*did not reach its journal"),
            ):
                with self.subTest(diagnostic=diagnostic):
                    log.write_bytes(record)
                    with self.assertRaisesRegex(AssertionError, diagnostic) as caught:
                        wait_for_ssh_clone_outcome(driver, journal)
                    self.assertNotIn(record.decode(), str(caught.exception))
                    self.assertFalse(journal.exists())

    def test_accepts_only_the_literal_owned_upload(self):
        self.assertTrue(accepted_upload("git-upload-pack '" + VIRTUAL_REPOSITORY + "'"))
        self.assertTrue(accepted_upload("git-upload-pack " + VIRTUAL_REPOSITORY))

    def test_refuses_write_commands_and_shell_syntax(self):
        for command in ["", "git-receive-pack " + VIRTUAL_REPOSITORY,
                        "git-upload-pack /other.git", "git-upload-pack --strict " + VIRTUAL_REPOSITORY,
                        "git-upload-pack '" + VIRTUAL_REPOSITORY + "'; echo injected",
                        "git-upload-pack $(echo " + VIRTUAL_REPOSITORY + ")", "git-upload-pack '"]:
            with self.subTest(command=command):
                self.assertFalse(accepted_upload(command))

    def test_refusal_records_only_boolean_and_never_launches(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / "journal"
            with patch.dict(os.environ, SSH_ORIGINAL_COMMAND="secret-input"), patch("subprocess.call") as call:
                self.assertEqual(serve_upload("owned.git", journal, "/usr/bin/git"), 126)
                call.assert_not_called()
            self.assertEqual(journal.read_text(), '{"uploadPack": false}\n')

    def test_upload_uses_fixture_repository_and_arg_vector(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / "journal"
            with patch.dict(os.environ, SSH_ORIGINAL_COMMAND="git-upload-pack '" + VIRTUAL_REPOSITORY + "'"), patch("subprocess.call", return_value=0) as call:
                self.assertEqual(serve_upload("owned space.git", journal, "/usr/bin/git"), 0)
                self.assertEqual(call.call_count, 1)
                self.assertEqual(call.call_args.args[0], ["/usr/bin/git", "-c", "safe.bareRepository=all", "upload-pack", "owned space.git"])
                environment = call.call_args.kwargs["env"]
                self.assertEqual(environment["GIT_CONFIG_GLOBAL"], "/dev/null")
                self.assertEqual(environment["GIT_CONFIG_NOSYSTEM"], "1")
                self.assertNotIn("SSH_AUTH_SOCK", environment)
            self.assertEqual(journal.read_text(), '{"uploadPack": true}\n')

    def test_preflight_reports_incomplete_prefix_or_unloadable_helper(self):
        from native_gitlab_ssh_fixture import preflight_sshd

        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory) / "usr"
            sshd = prefix / "sbin/sshd"
            session = prefix / "lib/openssh/sshd-session"
            auth = session.with_name("sshd-auth")
            for binary in (sshd, session):
                binary.parent.mkdir(parents=True, exist_ok=True)
                binary.touch(mode=0o700)
            env = {"LD_LIBRARY_PATH": "/owned/test-libraries"}
            with patch.dict(os.environ, {"GIT_KHRONOS_SSHD": str(sshd)}):
                with patch("subprocess.run", return_value=Mock(returncode=0)) as run:
                    with self.assertRaisesRegex(RuntimeError, "sshd-auth.*missing"):
                        preflight_sshd(env)
                    auth.touch(mode=0o700)
                    # Older helpers may not implement -V, but the loader may still work.
                    run.return_value = Mock(returncode=1, stderr=b"unknown option -- V")
                    preflight_sshd(env)
                    self.assertEqual(run.call_args.args[0], [str(auth), "-V"])
                    self.assertEqual(run.call_args.kwargs["env"], env | {"LC_ALL": "C"})
                    run.side_effect = [
                        Mock(returncode=0),
                        Mock(returncode=127, stderr=b"error while loading shared libraries: libwrap.so.0"),
                    ]
                    with self.assertRaisesRegex(RuntimeError, "sshd-session.*shared libraries"):
                        preflight_sshd(env)
