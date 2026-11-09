"""The loopback server exposes only one literal read-only Git command."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from native_gitlab_ssh_fixture import accepted_upload, serve_upload, sshd_helper_config, VIRTUAL_REPOSITORY


class GitLabSshFixtureTests(unittest.TestCase):
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
