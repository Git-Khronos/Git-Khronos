import hashlib
import io
import json
import os
import select
import shlex
import shutil
import signal
import stat
import subprocess
import sys
from contextlib import ExitStack, redirect_stderr
from http.client import RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import time
import unittest
from io import BytesIO
from threading import Event, Thread
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, call, patch
from urllib.error import HTTPError, URLError

from native_acceptance import (
    Driver, Fixtures, checkpoint_fixture, checkpoint_refs, default_debian_archive, expected_debian_package, linux_distribution, main, run,
    start_abstract_xvfb, start_private_dbus, stop_owned_process_group, terminal_csp_rendering, verified_installed_executable,
    verified_installed_file, menu_tab_focus, probe_git_toolchain, probe_lfs_count_toolchain, seed_commit_draft,
    wait_webdriver_ready, webdriver_ports, probe_signed_tag_toolchain, probe_signed_commit_toolchain,
)


class AbstractDisplayTests(unittest.TestCase):
    def test_requires_xauth_before_starting_any_server(self):
        with patch('native_acceptance.shutil.which', return_value=None), patch('native_acceptance.subprocess.Popen') as launch:
            with self.assertRaisesRegex(RuntimeError, 'requires xauth'):
                start_abstract_xvfb(MagicMock(), [], None, Path('/tmp/.X11-unix'))
            launch.assert_not_called()

    def test_honors_display_readiness_and_keeps_cookie_out_of_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixtures = SimpleNamespace(root=root, env={})
            server = MagicMock()
            server.stdout = BytesIO(b'100\n')
            server.poll.return_value = None
            children = []
            with patch('native_acceptance.shutil.which', return_value='/usr/bin/xauth'), \
                    patch('native_acceptance.Path.exists', return_value=False), \
                    patch('native_acceptance.select.select', return_value=([server.stdout], [], [])), \
                    patch('native_acceptance.secrets.token_hex', return_value='a' * 32), \
                    patch('native_acceptance.subprocess.run') as auth, \
                    patch('native_acceptance.subprocess.Popen', return_value=server) as launch:
                number, owned, authority = start_abstract_xvfb(fixtures, children, None, root)
            self.assertEqual((number, owned, children), ('100', server, [server]))
            self.assertEqual(stat.S_IMODE(Path(authority).stat().st_mode), 0o600)
            self.assertNotIn('a' * 32, auth.call_args.args[0])
            self.assertIn('a' * 32, auth.call_args.kwargs['input'])
            self.assertEqual(launch.call_args.args[0][-6:], ['-nolisten', 'tcp', '-nolisten', 'unix', '-auth', authority])
            self.assertTrue(launch.call_args.kwargs['start_new_session'])

    def test_reaps_failed_child_after_readiness_eof_and_tries_next_display(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixtures = SimpleNamespace(root=root, env={})
            collision = MagicMock(stdout=BytesIO(b''))
            collision.poll.return_value = None
            collision.wait.return_value = 1
            server = MagicMock(stdout=BytesIO(b'101\n'))
            server.poll.return_value = None
            children = []
            with patch('native_acceptance.shutil.which', return_value='/usr/bin/xauth'), \
                    patch('native_acceptance.Path.exists', return_value=False), \
                    patch('native_acceptance.select.select', return_value=([True], [], [])), \
                    patch('native_acceptance.subprocess.run'), \
                    patch('native_acceptance.subprocess.Popen', side_effect=[collision, server]) as launch:
                number, owned, _ = start_abstract_xvfb(fixtures, children, None, root)
            collision.wait.assert_called_once_with(timeout=1)
            self.assertEqual((number, owned, children), ('101', server, [collision, server]))
            self.assertEqual([args.args[0][1] for args in launch.call_args_list], [':100', ':101'])


class InstalledSuiteBatchTests(unittest.TestCase):
    def run_batch(self, suites, *, have_package=True, separate_output=False, python_override=None,
                  ci_summary=None, checksum=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / 'owned fixture.deb'
            if have_package:
                package.touch()
            log = root / 'calls'
            python = root / ('python fixture' if python_override == 'valid' else 'python3')
            python.write_text(
                '#!/bin/sh\n'
                'if [ "$2" = --describe-runner ]; then\n'
                '  shift 2\n'
                '  while [ "$#" -gt 0 ]; do\n'
                '    test "$1" = --suite || exit 99\n'
                '    case "$2" in smoke|broken|gitlab|interrupted|incoming-links) ;;\n'
                '      *) printf "unknown suite: %s\\n" "$2" >&2; exit 2;; esac\n'
                '    shift 2\n'
                '  done\n'
                '  exit 0\n'
                'fi\n'
                'test "${1##*/}" = native_acceptance.py && test "$2" = --suite && '
                'test "$4" = --headless && test "$5" = --installed && test "$6" = --package && '
                'test "$7" = "$OWNED_PACKAGE" || exit 99\n'
                'suite="$3"; shift 7\n'
                'if [ "${1:-}" = --inherited-git-environment ]; then suite="$suite:inherited"; shift; fi\n'
                'if [ -n "$OWNED_CHECKSUM" ]; then\n'
                '  test "$1" = --expect-package-sha256 && test "$2" = "$OWNED_CHECKSUM" || exit 99\n'
                '  shift 2\n'
                'fi\n'
                'if [ -n "$GIT_KHRONOS_NATIVE_OUTPUT" ]; then\n'
                '  test "$#" = 2 && test "$1" = --output && test "$2" = "$GIT_KHRONOS_NATIVE_OUTPUT" || exit 99\n'
                'else\n'
                '  test "$#" = 0 || exit 99\n'
                'fi\n'
                'printf "%s\\n" "$suite" >> "$OWNED_CALLS"\n'
                'case "$suite" in broken*) exit 7;; interrupted*) exit 130;; esac\n'
                'exit 0\n'
            )
            python.chmod(0o700)
            runner = Path(__file__).with_name('run-native-suites.sh')
            result = subprocess.run(
                ['bash', str(runner), *([] if checksum is None else ['--expect-package-sha256', checksum]),
                 str(package), *suites],
                env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                     'OWNED_PACKAGE': str(package), 'OWNED_CALLS': str(log), 'OWNED_CHECKSUM': (checksum or '').lower(),
                     'GITHUB_STEP_SUMMARY': str(ci_summary) if ci_summary is not None else '',
                     'GIT_KHRONOS_NATIVE_OUTPUT': str(root / 'separate results') if separate_output else '',
                     'GIT_KHRONOS_ACCEPTANCE_PYTHON': {'valid': str(python),
                          'missing': str(root / 'missing python'), 'relative': 'python3.11'}.get(python_override, '')},
                capture_output=True, text=True, timeout=10,
            )
            return result, log.read_text().splitlines() if log.exists() else []

    def test_step_summary_reports_results_without_changing_exit_status_or_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / 'summary'
            summary.write_text('Earlier step output\n')
            result, calls = self.run_batch(['smoke', 'broken:inherited', 'gitlab'], ci_summary=summary)
            self.assertEqual((result.returncode, calls), (1, ['smoke', 'broken:inherited', 'gitlab']))
            self.assertIn(
                'Earlier step output\n### Installed native acceptance: 2/3 passed\n\n'
                '| Suite | Result |\n| --- | --- |\n'
                '| `smoke` | Passed |\n| `broken:inherited` | Failed (exit 7) |\n| `gitlab` | Passed |\n',
                summary.read_text(),
            )
            summary.unlink()
            result, calls = self.run_batch(['interrupted', 'gitlab'], ci_summary=summary)
            self.assertEqual((result.returncode, calls), (130, ['interrupted']))
            self.assertIn('Interrupted (exit 130)', summary.read_text())
            self.assertNotIn('gitlab', summary.read_text())
            result, _ = self.run_batch(['smoke'], ci_summary=Path(directory))
            self.assertEqual(result.returncode, 0)
            self.assertIn('Could not write the installed native acceptance step summary.', result.stderr)

    def test_ordinary_failure_keeps_later_suite_evidence_but_fails_the_batch(self):
        result, calls = self.run_batch(['smoke', 'broken', 'gitlab'])
        self.assertEqual(result.returncode, 1, result)
        self.assertEqual(calls, ['smoke', 'broken', 'gitlab'])
        self.assertIn('Installed native suite passed: gitlab', result.stdout)
        self.assertIn('Installed native suite summary: 2/3 passed.', result.stdout)
        self.assertIn('Failed installed native suites (suite:exit): broken:7', result.stderr)

    def test_rerun_hint_preserves_package_quoting_and_exact_failed_lanes(self):
        result, calls = self.run_batch(['smoke', 'broken:inherited', 'gitlab', 'broken'])
        self.assertEqual(result.returncode, 1, result)
        self.assertEqual(calls, ['smoke', 'broken:inherited', 'gitlab', 'broken'])
        command = result.stderr.splitlines()[-1].strip()
        shell, runner, archive, *lanes = shlex.split(command)
        self.assertEqual(shell, 'bash')
        self.assertEqual(Path(runner).name, 'run-native-suites.sh')
        self.assertEqual(Path(archive).name, 'owned fixture.deb')
        self.assertEqual(lanes, ['broken:inherited', 'broken'])

    def test_reviewed_checksum_is_forwarded_and_kept_in_failed_suite_hint(self):
        result, calls = self.run_batch(['smoke', 'broken:inherited'], checksum='A' * 64)
        self.assertEqual((result.returncode, calls), (1, ['smoke', 'broken:inherited']))
        command = shlex.split(result.stderr.splitlines()[-1].strip())
        self.assertEqual(command[2:4], ['--expect-package-sha256', 'a' * 64])
        self.assertEqual(command[-1], 'broken:inherited')
        invalid, calls = self.run_batch(['smoke'], checksum='not-a-sha')
        self.assertEqual((invalid.returncode, calls), (2, []))

    def test_interrupted_harness_does_not_start_the_next_suite(self):
        result, calls = self.run_batch(['interrupted', 'gitlab'])
        self.assertEqual(result.returncode, 130, result)
        self.assertEqual(calls, ['interrupted'])
        self.assertNotIn('Installed native suite summary:', result.stdout)
        self.assertNotIn('Rerun only failed suites', result.stderr)

    def test_all_suites_can_pass(self):
        result, calls = self.run_batch(['smoke', 'gitlab'])
        self.assertEqual(result.returncode, 0, result)
        self.assertEqual(calls, ['smoke', 'gitlab'])
        self.assertIn('Installed native suite summary: 2/2 passed.', result.stdout)

    def test_batch_honors_versioned_python_override_and_refuses_bad_paths_before_dispatch(self):
        result, calls = self.run_batch(['smoke', 'gitlab'], python_override='valid')
        self.assertEqual(result.returncode, 0, result)
        self.assertEqual(calls, ['smoke', 'gitlab'])
        for override, code in [('missing', 127), ('relative', 2)]:
            with self.subTest(override=override):
                result, calls = self.run_batch(['smoke', 'gitlab'], python_override=override)
                self.assertEqual(result.returncode, code, result)
                self.assertEqual(calls, [])
                self.assertIn('GIT_KHRONOS_ACCEPTANCE_PYTHON', result.stderr)
    def test_read_only_source_can_use_a_separate_output_directory(self):
        result, calls = self.run_batch(['smoke', 'gitlab'], separate_output=True)
        self.assertEqual(result.returncode, 0, result)
        self.assertEqual(calls, ['smoke', 'gitlab'])

    def test_particular_lane_can_use_inherited_git_without_affecting_its_siblings(self):
        result, calls = self.run_batch(['smoke', 'incoming-links:inherited', 'incoming-links'], separate_output=True)
        self.assertEqual(result.returncode, 0, result)
        self.assertEqual(calls, ['smoke', 'incoming-links:inherited', 'incoming-links'])
        self.assertIn('Installed native suite passed: incoming-links:inherited', result.stdout)

    def test_batch_help_does_not_require_an_archive_or_python(self):
        runner = Path(__file__).with_name('run-native-suites.sh')
        result = subprocess.run(
            ['bash', str(runner), '--help'],
            env={**os.environ, 'GIT_KHRONOS_ACCEPTANCE_PYTHON': '/nonexistent/owned/python'},
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result)
        self.assertIn('already installed package', result.stdout)
        self.assertIn('GIT_KHRONOS_NATIVE_OUTPUT', result.stdout)
        self.assertEqual(result.stderr, '')

    def test_bad_batch_never_runs_a_partial_plan(self):
        for suites in ([], ['smoke', 'smoke'], ['smoke', '--installed'],
                       ['smoke', 'smoke:inherited', 'smoke:inherited'], ['smoke:invalid']):
            with self.subTest(suites=suites):
                result, calls = self.run_batch(suites)
                self.assertEqual(result.returncode, 2, result)
                self.assertEqual(calls, [])
        result, calls = self.run_batch(['smoke'], have_package=False)
        self.assertEqual(result.returncode, 2, result)
        self.assertEqual(calls, [])

    def test_unknown_suite_at_the_end_does_not_start_earlier_lanes(self):
        result, calls = self.run_batch(['smoke', 'gitlab', 'unknown-owned-suite:inherited'])
        self.assertEqual(result.returncode, 2, result)
        self.assertEqual(calls, [])
        self.assertIn('unknown-owned-suite', result.stderr)


class CommitDraftReadinessTests(unittest.TestCase):
    def test_draft_is_seeded_once_after_the_active_checkout_form_is_ready(self):
        driver = MagicMock()
        repository = Path('/owned/checkout "with spaces"')
        seed_commit_draft(driver, repository, 'Owned draft')
        self.assertEqual([entry[0] for entry in driver.mock_calls], ['wait', 'script'])
        predicate = driver.wait.call_args.args[0]
        self.assertIn(json.dumps(str(repository)), predicate)
        self.assertIn('.commit-form #commit-summary', predicate)
        self.assertIn("!field.closest('[inert]')", predicate)
        self.assertEqual(driver.script.call_args.args[1:], ('Owned draft',))

    def test_readiness_timeout_never_attempts_to_seed_a_draft(self):
        driver = MagicMock()
        driver.wait.side_effect = TimeoutError('No editable form')
        with self.assertRaisesRegex(TimeoutError, 'No editable form'):
            seed_commit_draft(driver, Path('/owned/pending'), 'Owned draft')
        driver.script.assert_not_called()


class DialogCaptureReadinessTests(unittest.TestCase):
    def test_capture_scrolls_once_and_polls_read_only_layout_predicates(self):
        driver = MagicMock()
        selector = 'gk-owned-dialog [aria-label="Owned"]'
        text = 'row with "quotes"'
        Driver.wait_for_dialog_capture(driver, selector, text, edge='end', require_action=True)
        self.assertEqual([entry[0] for entry in driver.mock_calls], ['script', 'wait'])
        self.assertEqual(driver.script.call_args.args[1:], (selector, text, 'end'))
        predicate = driver.wait.call_args.args[0]
        self.assertIn(json.dumps([selector, text, True]), predicate)
        self.assertIn('dialog.scrollWidth', predicate)
        self.assertIn('bounds.bottom <= frame.bottom', predicate)
        self.assertNotIn('scrollIntoView', predicate)
        self.assertNotIn('Promise', predicate)
        self.assertEqual(driver.wait.call_args.kwargs, {'timeout': 10})


class LinuxDistributionTests(unittest.TestCase):
    @patch("native_acceptance.platform.freedesktop_os_release")
    def test_uses_userspace_not_kernel_and_handles_missing_fields(self, release):
        release.return_value = {"ID": "debian", "VERSION_ID": "12", "PRETTY_NAME": "Debian GNU/Linux 12"}
        self.assertEqual(linux_distribution(), {"id": "debian", "versionId": "12"})
        release.return_value = {"ID": "arch"}
        self.assertEqual(linux_distribution(), {"id": "arch", "versionId": None})
        release.return_value = {}
        self.assertIsNone(linux_distribution())
        release.side_effect = OSError("no release file")
        self.assertIsNone(linux_distribution())


class GitToolchainPreflightTests(unittest.TestCase):
    def test_lfs_count_preflight_checks_capability_not_version(self):
        repo = Path('/owned/lfs-probe')
        fixtures = MagicMock()
        fixtures.repository.return_value = repo
        fixtures.git.side_effect = ['git-lfs/test', '{"files":null}']
        report = {"scenarios": []}
        probe_lfs_count_toolchain(fixtures, report)
        self.assertTrue(report["lfsCountToolchainPreflight"]["passed"])
        self.assertEqual(fixtures.git.call_args_list, [call(repo, "lfs", "version"), call(repo, "lfs", "ls-files", "--json")])
        self.assertEqual(report["scenarios"], [])
        fixtures.git.side_effect = ['git-lfs/test', RuntimeError("unknown flag: --json")]
        with self.assertRaisesRegex(RuntimeError, "ls-files --json"):
            probe_lfs_count_toolchain(fixtures, report)
        self.assertFalse(report["lfsCountToolchainPreflight"]["passed"])
        self.assertIn("unknown flag", report["lfsCountToolchainPreflight"]["diagnostic"])

    def test_preflight_uses_a_healthy_owned_git_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            report = {"scenarios": []}
            probe_git_toolchain(fixtures, report)
            probe = report["gitToolchainPreflight"]
            self.assertTrue(probe["passed"])
            self.assertTrue(Path(probe["executable"]).is_file())
            self.assertTrue(probe["version"].startswith("git version"))
            self.assertTrue(Path(probe["execPath"]).is_absolute())
            self.assertEqual(report["scenarios"], [])

    def test_preflight_keeps_failed_helper_diagnostics_without_using_inherited_git_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            bindir = Path(directory) / "git-wrapper"
            bindir.mkdir()
            wrapper = bindir / "git"
            real_git = shutil.which("git")
            wrapper.write_text("#!/bin/sh\n"
                               "if [ \"$1\" = '-C' ] && [ \"$5\" = 'fsck' ]; then "
                               "echo 'fixture Git helper is incompatible' >&2; exit 8; fi\n"
                               f"exec {shlex.quote(real_git)} \"$@\"\n")
            wrapper.chmod(0o700)
            with patch.dict(os.environ, {"PATH": str(bindir) + os.pathsep + os.environ["PATH"],
                                         "GIT_EXEC_PATH": str(bindir / "wrong-helpers")}):
                fixtures = Fixtures(directory)
                report = {}
                with self.assertRaisesRegex(RuntimeError, "Git and its helpers"):
                    probe_git_toolchain(fixtures, report)
            probe = report["gitToolchainPreflight"]
            self.assertFalse(probe["passed"])
            self.assertEqual(Path(probe["executable"]), wrapper)
            self.assertNotIn("GIT_EXEC_PATH", fixtures.env)
            self.assertNotIn("wrong-helpers", probe["execPath"])
            self.assertIn("fixture Git helper is incompatible", probe["diagnostic"])


class SignedTagToolchainPreflightTests(unittest.TestCase):
    def test_preflight_records_required_signing_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            report = {}
            with patch("native_acceptance.shutil.which", side_effect=lambda name, **_: {
                "gpg": "/fixture/bin/gpg", "ssh-keygen": "/fixture/bin/ssh-keygen",
                "gpgsm": "/fixture/bin/gpgsm", "openssl": "/fixture/bin/openssl",
            }[name]):
                probe_signed_tag_toolchain(fixtures, report)
            self.assertEqual(report["signedTagTools"], {
                "gpg": "/fixture/bin/gpg", "ssh-keygen": "/fixture/bin/ssh-keygen",
                "gpgsm": "/fixture/bin/gpgsm", "openssl": "/fixture/bin/openssl",
            })

    def test_preflight_names_missing_tools_before_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            report = {}
            with patch("native_acceptance.shutil.which", side_effect=lambda name, **_: {
                "gpg": "/fixture/bin/gpg", "ssh-keygen": "/fixture/bin/ssh-keygen",
                "gpgsm": None, "openssl": "/fixture/bin/openssl",
            }[name]):
                with self.assertRaisesRegex(RuntimeError, "gpgsm"):
                    probe_signed_tag_toolchain(fixtures, report)
            self.assertEqual(report["signedTagTools"], {
                "gpg": "/fixture/bin/gpg", "ssh-keygen": "/fixture/bin/ssh-keygen",
                "gpgsm": None, "openssl": "/fixture/bin/openssl",
            })


class SignedCommitToolchainPreflightTests(unittest.TestCase):
    def test_preflight_requires_the_openpgp_ssh_and_x509_tools_used_by_the_ui_scenario(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            report = {}
            available = {tool: f"/fixture/bin/{tool}" for tool in ("gpg", "ssh-keygen", "gpgsm", "openssl")}
            with patch("native_acceptance.shutil.which", side_effect=lambda name, **_: available[name]):
                probe_signed_commit_toolchain(fixtures, report)
            self.assertEqual(report["signedCommitTools"], available)

    def test_preflight_reports_missing_openpgp_tool_before_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            report = {}
            with patch("native_acceptance.shutil.which", return_value=None):
                with self.assertRaisesRegex(RuntimeError, "gpg"):
                    probe_signed_commit_toolchain(fixtures, report)
            self.assertEqual(report["signedCommitTools"], {
                "gpg": None, "ssh-keygen": None, "gpgsm": None, "openssl": None,
            })


class PackageIdentityTests(unittest.TestCase):
    def test_installed_desktop_entry_must_be_the_packaged_regular_file(self):
        with tempfile.TemporaryDirectory() as directory:
            packaged, installed = (Path(directory) / name for name in ("packaged.desktop", "installed.desktop"))
            contents = b"[Desktop Entry]\nExec=git-khronos %U\nStartupWMClass=git-khronos\n"
            packaged.write_bytes(contents)
            installed.write_bytes(contents)
            self.assertEqual(verified_installed_file(packaged, installed, "desktop entry"),
                             hashlib.sha256(contents).hexdigest())
            installed.write_bytes(contents.replace(b" %U", b""))
            with self.assertRaisesRegex(RuntimeError, "installed desktop entry differs"):
                verified_installed_file(packaged, installed, "desktop entry")
            installed.unlink()
            with self.assertRaises(FileNotFoundError):
                verified_installed_file(packaged, installed, "desktop entry")
            installed.symlink_to(packaged)
            with self.assertRaises(OSError):
                verified_installed_file(packaged, installed, "desktop entry")
            installed.unlink()
            os.mkfifo(installed)
            with self.assertRaisesRegex(RuntimeError, "desktop entry must be a regular file"):
                verified_installed_file(packaged, installed, "desktop entry")

    def test_installed_acceptance_requires_the_exact_packaged_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            packaged, installed = (Path(directory) / name for name in ("packaged", "installed"))
            packaged.write_bytes(b"owned package executable")
            installed.write_bytes(packaged.read_bytes())
            self.assertEqual(verified_installed_executable(packaged, installed), installed)
            installed.write_bytes(b"another executable")
            with self.assertRaisesRegex(RuntimeError, "differs from the reviewed Debian package"):
                verified_installed_executable(packaged, installed)
            installed.unlink()
            with self.assertRaises(FileNotFoundError):
                verified_installed_executable(packaged, installed)

    def test_package_name_follows_tauri_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "apps/desktop/src-tauri/tauri.conf.json"
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({"version": "2.3.4"}))
            with patch("native_acceptance.ROOT", root):
                self.assertEqual(expected_debian_package(), ("2.3.4", "Git-Khronos_2.3.4_amd64.deb"))

    def test_runner_description_needs_no_package_or_webdriver(self):
        with patch("sys.argv", ["native_acceptance.py", "--describe-runner"]), \
                patch("native_acceptance.expected_debian_package",
                      return_value=("2.3.4", "Git-Khronos_2.3.4_amd64.deb")) as package, \
                patch("native_acceptance.Driver") as driver, patch("builtins.print") as output:
            self.assertIsNone(main())
        package.assert_called_once_with()
        driver.assert_not_called()
        description = json.loads(output.call_args.args[0])
        self.assertIn("branch-workflow-recovery", description["suites"])
        self.assertEqual(description["forcedInheritedGitEnvironment"], ["environment"])
        self.assertEqual(description["expectedPackageName"], "Git-Khronos_2.3.4_amd64.deb")

    def test_file_tools_delegation_cannot_weaken_other_runner_modes(self):
        for arguments in (
            ["--suite", "smoke", "--headless"],
            ["--suite", "full"],
            ["--suite", "full", "--headless", "--installed"],
            ["--suite", "full", "--headless", "--inherited-git-environment"],
            ["--suite", "full", "--headless", "--describe-runner"],
        ):
            with self.subTest(arguments=arguments), \
                    patch("sys.argv", ["native_acceptance.py", "--delegate-file-tools", *arguments]), \
                    patch("native_acceptance.expected_debian_package") as package, \
                    redirect_stderr(io.StringIO()) as stderr, self.assertRaises(SystemExit) as failure:
                main()
            self.assertEqual(failure.exception.code, 2)
            self.assertIn("requires --suite full --headless on an extracted package", stderr.getvalue())
            package.assert_not_called()

    def test_optimized_python_cannot_announce_or_run_native_acceptance(self):
        script = Path(__file__).with_name("native_acceptance.py")
        with tempfile.TemporaryDirectory() as directory:
            reports = Path(directory) / "unexpected-evidence"
            env = os.environ.copy()
            env.pop("PYTHONOPTIMIZE", None)
            for options, extra, args in (
                (["-O"], {}, ["--describe-runner"]),
                ([], {"PYTHONOPTIMIZE": "1"}, ["--output", str(reports)]),
            ):
                with self.subTest(options=options, extra=extra):
                    result = subprocess.run([sys.executable, *options, str(script), *args],
                                            env={**env, **extra}, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("Native acceptance requires Python assertions", result.stderr)
                    self.assertEqual(result.stdout, "")
                    self.assertFalse(reports.exists())

    def test_default_archive_uses_the_same_cargo_target_as_packaging(self):
        name = "Git-Khronos_2.3.4_amd64.deb"
        suffix = Path("release/bundle/deb") / name
        for env, target in (
            ({}, Path("/owned workspace/target")),
            ({"CARGO_TARGET_DIR": ""}, Path("/owned workspace/target")),
            ({"CARGO_TARGET_DIR": "build artifacts"}, Path("/owned caller/build artifacts")),
            ({"CARGO_TARGET_DIR": "/owned output"}, Path("/owned output")),
        ):
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True), \
                    patch("native_acceptance.ROOT", Path("/owned workspace")), \
                    patch("native_acceptance.Path.cwd", return_value=Path("/owned caller")):
                self.assertEqual(default_debian_archive(name), target / suffix)

    def test_unusable_output_reports_how_to_fix_evidence_preflight(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "not-a-directory"
            output.touch()
            args = SimpleNamespace(package=root / expected_debian_package()[1], output=output,
                                   suite="smoke", describe_runner=False, headless=False,
                                   inherited_git_environment=False, installed=False)
            with patch("native_acceptance.argparse.ArgumentParser.parse_args", return_value=args), \
                    patch("native_acceptance.Driver") as driver, patch("builtins.print") as printed:
                self.assertEqual(main(), 1)
            driver.assert_not_called()
            self.assertIn("Use --output with a directory writable and traversable", printed.call_args.args[0])

    def test_package_with_wrong_version_is_rejected_before_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            version, filename = expected_debian_package()
            package = root / filename
            package.write_bytes(b"package fixture")
            args = SimpleNamespace(package=package, output=root / "evidence", suite="smoke", describe_runner=False,
                                   headless=False, inherited_git_environment=False, installed=False)
            with patch("native_acceptance.argparse.ArgumentParser.parse_args", return_value=args), \
                    patch("native_acceptance.shutil.which", return_value="/fixture/tool"), \
                    patch("native_acceptance.run", side_effect=lambda *command: {
                        "Package": "git-khronos", "Architecture": "amd64", "Version": "0.0.0",
                    }.get(command[-1], "fixture")), \
                    patch("native_acceptance.Driver") as driver, patch("builtins.print"):
                self.assertEqual(main(), 1)
            driver.assert_not_called()
            report = json.loads(next((root / "evidence").glob("*/report.json")).read_text())
            self.assertFalse(report["passed"])
            self.assertIn(f"('0.0.0', '{version}')", report["failure"])
            self.assertEqual(report["failurePhase"], "package-preflight")

    def test_wrong_reviewed_checksum_is_reported_without_extraction_or_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            version, filename = expected_debian_package()
            package = root / filename
            package.write_bytes(b"package fixture")
            args = SimpleNamespace(package=package, output=root / "evidence", suite="smoke",
                                   describe_runner=False, headless=False, inherited_git_environment=False,
                                   installed=False, expect_package_sha256="A" * 64)
            with patch("native_acceptance.argparse.ArgumentParser.parse_args", return_value=args), \
                    patch("native_acceptance.shutil.which", return_value="/fixture/tool"), \
                    patch("native_acceptance.run", side_effect=lambda *command: {
                        "Package": "git-khronos", "Architecture": "amd64", "Version": version,
                    }.get(command[-1], "fixture")) as run, \
                    patch("native_acceptance.Driver") as driver, patch("builtins.print"):
                self.assertEqual(main(), 1)
            driver.assert_not_called()
            self.assertFalse(any(item.args[:2] == ("dpkg-deb", "-x") for item in run.call_args_list))
            report = json.loads(next(args.output.glob("*/report.json")).read_text())
            self.assertFalse(report["passed"])
            self.assertEqual(report["failurePhase"], "package-preflight")
            self.assertEqual(report["expectedPackageSha256"], "a" * 64)
            self.assertEqual(report["packageSha256"], hashlib.sha256(b"package fixture").hexdigest())

    def test_full_suite_requires_git_lfs_before_starting_webdriver(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / expected_debian_package()[1]
            package.touch()
            args = SimpleNamespace(package=package, output=root / "evidence", suite="full",
                                   describe_runner=False, headless=True,
                                   inherited_git_environment=False, installed=False)
            def tool_path(name):
                return None if name == "git-lfs" else "/fixture/tool"

            with patch("native_acceptance.argparse.ArgumentParser.parse_args", return_value=args), \
                    patch("native_acceptance.shutil.which", side_effect=tool_path), \
                    patch("native_acceptance.Driver") as driver, patch("builtins.print"):
                self.assertEqual(main(), 1)
            driver.assert_not_called()
            report = json.loads(next((root / "evidence").glob("*/report.json")).read_text())
            self.assertFalse(report["passed"])
            self.assertIn("Missing git-lfs", report["failure"])
            self.assertEqual(report["failurePhase"], "package-preflight")

    def test_invalid_package_path_is_reported_before_runtime_tool_discovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            filename = expected_debian_package()[1]
            missing = root / "missing" / filename
            not_file = root / filename
            not_file.mkdir()
            for archive, expected in (
                (missing, "Debian package not found:"),
                (not_file, "needs a regular Debian package file:"),
            ):
                with self.subTest(archive=archive):
                    args = SimpleNamespace(package=archive, output=root / archive.parent.name,
                                           suite="smoke", describe_runner=False, headless=True,
                                           inherited_git_environment=False, installed=False)
                    with patch("native_acceptance.argparse.ArgumentParser.parse_args", return_value=args), \
                            patch("native_acceptance.shutil.which") as which, \
                            patch("native_acceptance.Driver") as driver, patch("builtins.print"):
                        self.assertEqual(main(), 1)
                    which.assert_not_called()
                    driver.assert_not_called()
                    report = json.loads(next(args.output.glob("*/report.json")).read_text())
                    self.assertEqual(report["failurePhase"], "package-preflight")
                    self.assertIn(expected, report["failure"])


class ReadOnlyWebDriverPollTests(unittest.TestCase):
    def test_ui_wait_refuses_a_late_positive_loopback_reply(self):
        seen = Event()
        released = Event()

        class LateReply(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                if self.path == '/session/owned/execute/sync':
                    seen.set()
                released.wait(.45)
                try:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"value": true}')
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *_):
                pass

        with ThreadingHTTPServer(('127.0.0.1', 0), LateReply) as server:
            server.daemon_threads = False
            thread = Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
            thread.start()
            try:
                driver = Driver(f'http://127.0.0.1:{server.server_port}')
                driver.session = 'owned'
                with self.assertRaisesRegex(TimeoutError, 'UI condition did not become true') as raised:
                    driver.wait('return true', timeout=.2)
                self.assertTrue(seen.is_set(), 'The wait must actually dispatch its predicate')
                self.assertIsInstance(raised.exception.__cause__, TimeoutError)
            finally:
                released.set()
                server.shutdown()
                thread.join()

    def test_wait_polls_quickly_then_returns_to_the_regular_cadence(self):
        driver = Driver(1)
        with patch.object(driver, 'script', side_effect=[False] * 5 + [True]), \
                patch('native_acceptance.time.sleep') as sleep:
            self.assertTrue(driver.wait('return true'))
        self.assertEqual(sleep.call_args_list, [call(.025), call(.025), call(.05), call(.1), call(.1)])

    def test_result_parse_refusal_can_repoll_the_predicate_but_not_direct_scripts(self):
        error = RuntimeError(json.dumps({'value': {
            'error': 'unknown error', 'message': 'Could not parse script result', 'stacktrace': '',
        }}))
        driver = Driver(1)
        expression = 'return !!document.querySelector("#repository-tab-clone")'
        with patch.object(driver, 'script', side_effect=[error, True]) as read, patch('native_acceptance.time.sleep') as sleep:
            self.assertTrue(driver.wait(expression))
            self.assertEqual(read.call_args_list, [call(expression, timeout=ANY)] * 2)
            self.assertTrue(all(0 < request.kwargs['timeout'] <= 30 for request in read.call_args_list))
            sleep.assert_called_once_with(.1)
        with patch.object(driver, 'request', side_effect=error) as request:
            with self.assertRaises(RuntimeError):
                driver.script('document.querySelector("button").click()')
            self.assertEqual(request.call_count, 1)

    def test_other_webdriver_errors_are_not_repolled(self):
        driver = Driver(1)
        for payload in [
            {'value': {'error': 'javascript error', 'message': 'Could not parse script result'}},
            {'value': {'error': 'unknown error', 'message': 'Session terminated'}},
            {'message': 'Could not parse script result'},
            'Could not parse script result',
        ]:
            with self.subTest(payload=payload):
                error = RuntimeError(json.dumps(payload))
                with patch.object(driver, 'script', side_effect=error) as read:
                    with self.assertRaises(RuntimeError) as raised:
                        driver.wait('return true')
                    self.assertIs(raised.exception, error)
                    self.assertEqual(read.call_count, 1)

    def test_persistent_parse_refusal_expires_with_the_original_diagnostic(self):
        driver = Driver(1)
        error = RuntimeError(json.dumps({'error': 'unknown error', 'message': 'Could not parse script result'}))
        with patch.object(driver, 'script', side_effect=error), patch('native_acceptance.time.sleep'), \
                patch('native_acceptance.time.monotonic', side_effect=[0, 0.1, 0.2, 0.3, 1.0]):
            with self.assertRaisesRegex(TimeoutError, '2 script results') as raised:
                driver.wait('return true', timeout=1)
        self.assertIs(raised.exception.__cause__, error)


class MainMenuReadinessTests(unittest.TestCase):
    def test_loading_menu_does_not_qualify_the_actual_content_or_send_its_tab(self):
        driver = MagicMock()
        driver.script.return_value = True
        driver.wait.side_effect = [True, True, TimeoutError('Only the loading escape was rendered')]
        report = {'scenarios': []}
        with self.assertRaisesRegex(TimeoutError, 'loading escape'):
            menu_tab_focus(driver, report)
        self.assertIn('gk-main-menu-content', driver.wait.call_args.args[0])
        self.assertIn('Manage Repositories', driver.wait.call_args.args[0])
        self.assertEqual(driver.key.call_count, 3)  # Workspace baseline/dismissal, then main-menu baseline only.
        self.assertNotIn('mainMenuLayout', report)
        self.assertEqual(report['scenarios'], [])


class TerminalCspTests(unittest.TestCase):
    def setUp(self):
        self.probe = {
            "font": "Consolas, monospace", "fontSize": "13px",
            "foreground": "rgb(216, 215, 226)", "ansi": "rgb(239, 113, 134)",
            "rgb": "rgb(52, 178, 128)", "background": "rgb(40, 60, 80)",
            "width": 800, "height": 200, "styles": 2, "protectedStyles": True,
        }

    def driver(self, probe, blocked=0, unnonced_loaded=False):
        driver = MagicMock()
        driver.wait.side_effect = [True, probe, True]
        driver.script.side_effect = ["fixture-session", {"blocked": blocked}, unnonced_loaded]
        return driver

    def test_terminal_csp_scenario_uses_one_owned_shell_and_records_success(self):
        driver = self.driver(self.probe)
        report = {"scenarios": [], "artifactsDirectory": "/native-fixture"}
        terminal_csp_rendering(driver, report)
        driver.invoke.assert_called_once()
        self.assertEqual(driver.invoke.call_args.args, ("write_terminal",))
        self.assertEqual(driver.invoke.call_args.kwargs["sessionId"], "fixture-session")
        command = bytes(driver.invoke.call_args.kwargs["data"])
        self.assertIn(b"CSP_ANSI", command)
        self.assertIn(b"CSP_RGB", command)
        self.assertIn(b"CSP_BG", command)
        self.assertEqual(driver.click.call_args_list, [
            call('[title="Open repository terminal (Alt+T or Ctrl+`)"]'),
            call('gk-terminal-panel [title="Close terminal tab"]'),
        ])
        driver.screenshot.assert_called_once_with(Path("/native-fixture/terminal-csp.png"))
        self.assertEqual(report["terminalRender"], self.probe)
        self.assertEqual(report["scenarios"], ["native-terminal-csp-font-and-colors"])

    def test_terminal_csp_scenario_rejects_missing_visuals_or_weakened_style_policy(self):
        invalid = (
            {"font": "sans-serif"}, {"fontSize": "16px"},
            {"foreground": "rgb(0, 0, 0)"}, {"ansi": "rgb(0, 0, 0)"},
            {"rgb": "rgb(0, 0, 0)"}, {"background": "rgb(0, 0, 0)"},
            {"width": 0}, {"height": 0}, {"styles": 1}, {"protectedStyles": False},
        )
        for change in invalid:
            with self.subTest(change=change):
                driver = self.driver(self.probe | change)
                report = {"scenarios": []}
                with self.assertRaises(AssertionError):
                    terminal_csp_rendering(driver, report)
                self.assertEqual(report["scenarios"], [])
        for blocked, unnonced_loaded in ((1, False), (0, True)):
            with self.subTest(blocked=blocked, unnonced_loaded=unnonced_loaded):
                driver = self.driver(self.probe, blocked, unnonced_loaded)
                report = {"scenarios": []}
                with self.assertRaises(AssertionError):
                    terminal_csp_rendering(driver, report)
                self.assertEqual(report["scenarios"], [])


class FixtureTests(unittest.TestCase):
    def test_checkpoint_fixture_preserves_only_live_refs_and_repository_state(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            repository = fixtures.repository(commits=2)
            head = fixtures.git(repository, "rev-parse", "HEAD")
            index = (repository / ".git/index").read_bytes()
            content = (repository / "fixture.txt").read_bytes()
            checkpoint = checkpoint_fixture(fixtures, repository)
            names, oids = checkpoint["names"], checkpoint["oids"]
            live = ("reviewed", "sibling", "moved", "external-packed", "external-loose")
            self.assertEqual(checkpoint_refs(fixtures, repository),
                             {names[key]: oids[key] for key in live})
            packed = (repository / ".git/packed-refs").read_text()
            for key in ("reviewed", "sibling", "moved", "external-packed"):
                self.assertIn(f"{oids[key]} {names[key]}\n", packed)
                self.assertFalse((repository / ".git" / names[key]).exists())
            self.assertTrue((repository / ".git" / names["external-loose"]).is_file())
            self.assertNotIn(names["deleted-packed"], packed)
            self.assertFalse((repository / ".git" / names["deleted-loose"]).exists())
            reachable = set(fixtures.git(repository, "log", "--all", "--format=%H").splitlines())
            for key in ("reviewed", "moved", "external-packed", "external-loose"):
                self.assertIn(oids[key], reachable)
            for key in ("deleted-packed", "deleted-loose", "replacement"):
                self.assertNotIn(oids[key], reachable)
                fixtures.git(repository, "cat-file", "-e", f"{oids[key]}^{{commit}}")
            self.assertEqual(fixtures.git(repository, "rev-parse", "HEAD"), head)
            self.assertEqual((repository / ".git/index").read_bytes(), index)
            self.assertEqual((repository / "fixture.txt").read_bytes(), content)
            self.assertFalse(fixtures.git(repository, "status", "--porcelain"))

    def test_private_session_buses_are_distinct_and_cannot_activate_host_services(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_root, second_root = root / 'first', root / 'second'
            first_root.mkdir(); second_root.mkdir()
            children = []
            with patch.dict(os.environ, {'DBUS_SESSION_BUS_ADDRESS': 'unix:abstract=unowned-fixture-bus',
                                         'DBUS_STARTER_ADDRESS': 'unix:abstract=unowned-fixture-starter'}):
                first, second = Fixtures(first_root), Fixtures(second_root)
                self.assertNotIn('DBUS_SESSION_BUS_ADDRESS', first.env)
                self.assertNotIn('DBUS_STARTER_ADDRESS', first.env)
                try:
                    with (root / 'bus.log').open('w') as log:
                        one = start_private_dbus(first, children, log)
                        two = start_private_dbus(second, children, log)
                    self.assertNotEqual(one['pid'], two['pid'])
                    self.assertNotEqual(first.env['DBUS_SESSION_BUS_ADDRESS'], second.env['DBUS_SESSION_BUS_ADDRESS'])
                    identities = []
                    for fixture in (first, second):
                        driver = Driver('http://127.0.0.1:1', session_bus_address=fixture.env['DBUS_SESSION_BUS_ADDRESS'])
                        driver.wait_single_instance_release()
                        command = ['dbus-send', '--bus=' + fixture.env['DBUS_SESSION_BUS_ADDRESS'],
                                   '--print-reply', '--type=method_call', '--dest=org.freedesktop.DBus',
                                   '/org/freedesktop/DBus']
                        identity = subprocess.run(command + ['org.freedesktop.DBus.GetId'], env=fixture.env,
                                                  capture_output=True, check=True, timeout=5)
                        identities.append(identity.stdout.decode().split('string "', 1)[1].split('"', 1)[0])
                        denied = subprocess.run(command + ['org.freedesktop.DBus.StartServiceByName',
                                                'string:org.freedesktop.portal.Desktop', 'uint32:0'],
                                                env=fixture.env, capture_output=True, timeout=5)
                        self.assertNotEqual(denied.returncode, 0)
                        self.assertIn(b'ServiceUnknown', denied.stderr)
                    self.assertNotEqual(identities[0], identities[1])
                    self.assertEqual(os.environ['DBUS_SESSION_BUS_ADDRESS'], 'unix:abstract=unowned-fixture-bus')
                finally:
                    for process in reversed(children):
                        stop_owned_process_group(process)
                        process.stdout.close()

    def test_restart_bus_barrier_waits_for_release_without_relaunch_or_mutation(self):
        driver = Driver('http://127.0.0.1:1')
        with patch.object(driver, 'single_instance_bus_call', side_effect=[
                'method return\n boolean true', 'method return\n boolean true',
                'method return\n boolean false']) as read, patch('native_acceptance.time.sleep') as sleep:
            driver.wait_single_instance_release()
        self.assertEqual(read.call_args_list, [call('NameHasOwner')] * 3)
        self.assertEqual(sleep.call_count, 2)

    def test_restart_bus_barrier_refuses_timeout_or_malformed_reply(self):
        driver = Driver('http://127.0.0.1:1')
        with patch.object(driver, 'single_instance_bus_call', return_value='boolean true'), \
                patch('native_acceptance.time.monotonic', side_effect=[0, 10]):
            with self.assertRaisesRegex(TimeoutError, 'relaunch refused'):
                driver.wait_single_instance_release()
        with patch.object(driver, 'single_instance_bus_call', return_value='unexpected'):
            with self.assertRaisesRegex(RuntimeError, 'Unexpected'):
                driver.wait_single_instance_release()
        with patch('native_acceptance.run') as command:
            with self.assertRaisesRegex(RuntimeError, 'owned private'):
                driver.single_instance_bus_call('NameHasOwner')
            command.assert_not_called()

    def test_restart_checks_bus_owner_and_release_before_its_single_launch(self):
        executable = Path('/owned/git-khronos')
        for release_error in (None, TimeoutError('bus still owned')):
            with self.subTest(release_error=release_error):
                driver = Driver('http://127.0.0.1:1', session_bus_address='unix:abstract=git-khronos-test-owned')
                driver.session = 'owned'; driver.executable = executable
                events = []
                def release():
                    events.append('released')
                    if release_error:
                        raise release_error
                with patch.object(Path, 'glob', side_effect=AssertionError('restart must not scan executable PIDs')), \
                        patch.object(Path, 'read_text', return_value='123 (owned) Z 0'), \
                        patch.object(driver, 'owned_session_application_pid', side_effect=[123, 456]), \
                        patch.object(driver, 'single_instance_bus_call', return_value='boolean true'), \
                        patch.object(driver, 'close', side_effect=lambda: events.append('closed')), \
                        patch.object(driver, 'wait_single_instance_release', side_effect=release), \
                        patch.object(driver, 'start', side_effect=lambda path: events.append(('started', path))) as start:
                    if release_error:
                        with self.assertRaisesRegex(TimeoutError, 'bus still owned'):
                            driver.restart_application()
                        start.assert_not_called()
                        self.assertEqual(events, ['closed', 'released'])
                    else:
                        self.assertEqual(driver.restart_application(), dict(oldPid=123, newPid=456))
                        start.assert_called_once_with(executable)
                        self.assertEqual(events, ['closed', 'released', ('started', executable)])

    def test_restart_refuses_another_single_instance_owner_without_closing_or_launching(self):
        executable = Path('/owned/git-khronos')
        driver = Driver('http://127.0.0.1:1', session_bus_address='unix:abstract=git-khronos-test-owned')
        driver.session = 'owned'; driver.executable = executable
        with patch.object(driver, 'owned_session_application_pid', side_effect=RuntimeError('not the reviewed application')), \
                patch.object(driver, 'close') as close, patch.object(driver, 'start') as start:
            with self.assertRaisesRegex(RuntimeError, 'not the reviewed'):
                driver.restart_application()
            close.assert_not_called()
            start.assert_not_called()

    def test_restart_refuses_a_session_without_a_private_bus(self):
        driver = Driver('http://127.0.0.1:1')
        driver.session = 'owned'; driver.executable = Path('/owned/git-khronos')
        with patch.object(driver, 'close') as close:
            with self.assertRaisesRegex(RuntimeError, 'private bus'):
                driver.restart_application()
            close.assert_not_called()

    def test_owned_hosting_cli_is_read_only_and_preserves_the_inherited_path(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            original_path = fixtures.env.get("PATH")
            additions = fixtures.hosting_environment("/owned/inherited/bin")
            self.assertEqual(fixtures.env.get("PATH"), original_path)
            self.assertTrue(additions["PATH"].endswith(os.pathsep + "/owned/inherited/bin"))
            command = [str(Path(directory) / "hosting-bin/gh"), "api", "--hostname", "github.com", "--method", "GET", "-H", "Accept: application/vnd.github+json"]
            environment = fixtures.env | additions
            output = subprocess.run(command + ["repos/owned-fixture/native-repo/pulls?state=closed&page=2"], env=environment, capture_output=True, check=True)
            data = json.loads(output.stdout)
            self.assertEqual((data[0]["number"], data[0]["state"]), (2, "closed"))
            for endpoint in ("repos/foreign/repository/pulls", "https://api.github.com/repos/foreign/repository/pulls"):
                refused = subprocess.run(command + [endpoint], env=environment, capture_output=True)
                self.assertNotEqual(refused.returncode, 0)
            command[5] = "POST"
            refused = subprocess.run(command + ["repos/owned-fixture/native-repo/pulls"], env=environment, capture_output=True)
            self.assertNotEqual(refused.returncode, 0)


    def test_owned_hosting_writes_require_opt_in_and_never_forward_foreign_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            environment = fixtures.env | fixtures.hosting_environment()
            config_path = fixtures.hosting_gate / "config.json"
            config = json.loads(config_path.read_text()) | {"allowWrites": True, "actor": "owned-config-account"}
            config_path.write_text(json.dumps(config))
            executable = str(Path(directory) / "hosting-bin/gh")
            environment["GH_TOKEN"] = "owned-token-pinned-account"
            def request(method, endpoint, payload=None):
                command = [executable, "api", "--hostname", "github.com", "--method", method,
                           "-H", "Accept: application/vnd.github+json", endpoint]
                if payload is not None:
                    command += ["--input", "-"]
                return subprocess.run(command, env=environment, input=None if payload is None else json.dumps(payload).encode(), capture_output=True)
            user = request("GET", "user")
            self.assertEqual(json.loads(user.stdout)["login"], "pinned-account")
            payload = {"head": "owned-fixture:feature", "head_repo": "native-repo", "base": "main",
                       "title": "Owned title", "body": "Owned body", "draft": True}
            created = request("POST", "repos/owned-fixture/native-repo/pulls", payload)
            self.assertEqual(created.returncode, 0, created.stderr)
            self.assertEqual(json.loads(created.stdout)["user"]["login"], "pinned-account")
            state_path = fixtures.hosting_gate / "write-state.json"
            before = state_path.read_bytes()
            for method, endpoint in [("POST", "repos/foreign/repository/pulls"),
                                     ("POST", "https://api.github.com/repos/owned-fixture/native-repo/pulls"),
                                     ("DELETE", "repos/owned-fixture/native-repo/pulls/1"),
                                     ("PUT", "repos/owned-fixture/native-repo/issues/1")]:
                refused = request(method, endpoint, payload)
                self.assertNotEqual(refused.returncode, 0)
                self.assertEqual(state_path.read_bytes(), before)
            config["uncertainAfterWrite"] = True
            config_path.write_text(json.dumps(config))
            unknown = request("POST", "repos/owned-fixture/native-repo/pulls/1/reviews",
                              {"commit_id": config["oid"], "event": "COMMENT", "body": "Applied despite lost reply"})
            self.assertNotEqual(unknown.returncode, 0)
            self.assertEqual(len(json.loads(state_path.read_text())["reviews"]), 1)
            config.pop("uncertainAfterWrite")
            config["denyBeforeWrite"] = True
            config_path.write_text(json.dumps(config))
            before = state_path.read_bytes()
            denied = request("POST", "repos/owned-fixture/native-repo/pulls/1/reviews",
                             {"commit_id": config["oid"], "event": "COMMENT", "body": "Denied before application"})
            self.assertNotEqual(denied.returncode, 0)
            self.assertEqual(state_path.read_bytes(), before)
            self.assertNotIn("owned-token-", (fixtures.hosting_gate / "requests.jsonl").read_text())

    @unittest.skipUnless(hasattr(os, "getpgrp"), "requires Unix process groups")
    def test_group_shutdown_never_signals_the_test_runners_group(self):
        with patch("native_acceptance.os.killpg") as sent:
            with self.assertRaisesRegex(RuntimeError, "unowned process group"):
                stop_owned_process_group(SimpleNamespace(pid=os.getpgrp()))
        sent.assert_not_called()

    @unittest.skipUnless(Path("/proc").is_dir() and hasattr(os, "killpg"), "requires Linux process groups")
    def test_owned_group_shutdown_stops_writers_even_after_parent_exit(self):
        for exit_parent in (False, True):
            with self.subTest(exit_parent=exit_parent), tempfile.TemporaryDirectory() as directory:
                ready = Path(directory) / "ready"
                written = Path(directory) / "written"
                child_script = (
                    "import os, signal, sys, time\n"
                    "from pathlib import Path\n"
                    "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                    "Path(sys.argv[1]).write_text(str(os.getpid()))\n"
                    "while True:\n"
                    "    with open(sys.argv[2], 'ab') as output: output.write(b'x')\n"
                    "    time.sleep(0.01)\n"
                )
                parent_script = (
                    "import subprocess, sys, time\n"
                    f"subprocess.Popen([sys.executable, '-c', {child_script!r}, sys.argv[1], sys.argv[2]], "
                    "stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
                    + ("" if exit_parent else "time.sleep(30)\n")
                )
                process = subprocess.Popen(
                    [sys.executable, "-c", parent_script, str(ready), str(written)],
                    start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                try:
                    deadline = time.monotonic() + 5
                    while (not ready.exists() or not ready.read_text().strip() or not written.exists()) and time.monotonic() < deadline:
                        time.sleep(0.01)
                    child = int(ready.read_text())
                    self.assertEqual(os.getpgid(child), process.pid)
                    if exit_parent:
                        process.wait(timeout=5)
                    stop_owned_process_group(process, timeout=0.1)
                    try:
                        state = Path(f"/proc/{child}/stat").read_text().rsplit(")", 1)[1].split()[0]
                    except FileNotFoundError:
                        state = None
                    self.assertIn(state, (None, "Z", "X"), "Owned descendant can still recreate fixture files")
                    size = written.stat().st_size
                    time.sleep(0.03)
                    self.assertEqual(written.stat().st_size, size)
                finally:
                    # Signal only the group exclusively created by this fixture.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=5)

    @unittest.skipUnless(hasattr(os, "killpg"), "requires Unix process groups")
    def test_failed_metadata_gate_can_leave_only_an_owned_inherited_stdout_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            repository = fixtures.repository("failed-metadata", commits=1)
            environment = fixtures.env | fixtures.history_environment()
            gate = fixtures.history_gate
            (gate / "target").write_text(str(repository))
            (gate / "mode").write_text("--get-regexp")
            (gate / "failure").write_text("2")
            (gate / "inherit-stdout").touch()
            command = str(fixtures.root / "history-git-bin/git")
            with subprocess.Popen([command, "-C", str(repository), "config", "--get-regexp", "owned"],
                                  env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  start_new_session=True) as process:
                try:
                    self.assertEqual(process.wait(timeout=5), 2)
                    self.assertTrue((gate / "inherited-pid").read_text().strip().isdigit())
                    self.assertEqual(select.select([process.stdout], [], [], 0)[0], [])
                finally:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.communicate(timeout=5)

    def test_history_gate_delays_only_selected_follow_reads_and_preserves_the_git_oracle(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            repository = fixtures.repository("selected", commits=1)
            other = fixtures.repository("other", commits=1)
            oracle_path = fixtures.env.get("PATH")
            environment = fixtures.env | fixtures.history_environment()
            gate = fixtures.history_gate
            (gate / "target").write_text(str(repository))
            hold = gate / "hold"
            hold.touch()
            command = str(fixtures.root / "history-git-bin/git")
            try:
                for path, args in ((other, ["log", "--follow", "--format=%H", "--", "fixture.txt"]),
                                   (repository, ["rev-parse", "HEAD"])):
                    result = subprocess.run([command, "-C", str(path), *args], env=environment,
                                            capture_output=True, timeout=5)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertFalse((gate / "started").exists())
                with subprocess.Popen([command, "-C", str(repository), "log", "--follow", "--format=%H", "--", "fixture.txt"],
                                      env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
                    try:
                        deadline = time.monotonic() + 5
                        while not (gate / "started").exists() and time.monotonic() < deadline:
                            time.sleep(0.01)
                        self.assertEqual((gate / "started").read_text(), f"{process.pid}\n")
                        self.assertIsNone(process.poll())
                    finally:
                        hold.unlink(missing_ok=True)
                    stdout, stderr = process.communicate(timeout=5)
                    self.assertEqual(process.returncode, 0, stderr)
                    self.assertEqual(stdout.decode().strip(), fixtures.git(repository, "rev-parse", "HEAD"))
                self.assertEqual(fixtures.env.get("PATH"), oracle_path)
            finally:
                hold.unlink(missing_ok=True)

    def test_session_creation_uses_tauri_and_existing_session_commands_use_native_endpoint(self):
        driver = Driver("http://127.0.0.1:1", "http://127.0.0.1:2")
        def response(value):
            result = MagicMock()
            result.__enter__.return_value = BytesIO(json.dumps({"value": value}).encode())
            return result
        with patch("native_acceptance.urlopen", side_effect=[
            response({"sessionId": "owned"}), response(None), response(None),
        ]) as request:
            driver.start(Path("/owned/application"))
            driver.close()
        self.assertEqual([call.args[0].full_url for call in request.call_args_list], [
            "http://127.0.0.1:1/session",
            "http://127.0.0.1:2/session/owned/timeouts",
            "http://127.0.0.1:2/session/owned",
        ])

    def test_native_mutation_reply_loss_neither_replays_nor_falls_back_to_proxy(self):
        driver = Driver("http://127.0.0.1:1", "http://127.0.0.1:2")
        with patch("native_acceptance.urlopen", side_effect=RemoteDisconnected("reply lost")) as request:
            with self.assertRaises(RemoteDisconnected):
                driver.request("POST", "/session/owned/element/button/click", {})
        request.assert_called_once()
        self.assertEqual(request.call_args.args[0].full_url, "http://127.0.0.1:2/session/owned/element/button/click")

    def test_visible_click_waits_for_one_visible_element_and_clicks_once(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "visible-button"}
        with patch.object(driver, "wait", return_value=element) as wait, patch.object(driver, "request") as request:
            driver.click_visible(".file-name-button")
            self.assertIn("getClientRects", wait.call_args.args[0])
            self.assertIn("getBoundingClientRect", wait.call_args.args[0])
            self.assertIn("elementFromPoint", wait.call_args.args[0])
            self.assertIn("element.matches(':disabled')", wait.call_args.args[0])
            self.assertIn("matches.length === 1", wait.call_args.args[0])
            request.assert_called_once_with("POST", "/session/owned/element/visible-button/click", {})

    def test_visible_text_click_waits_for_positioning_and_never_replays(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "delete-button"}
        text = "Delete checkpoint reference…"
        with patch.object(driver, "script", side_effect=[None, element]) as script, \
             patch.object(driver, "request") as request, patch("native_acceptance.time.sleep"):
            driver.click_visible(".context-menu button.danger-item", text)
        self.assertEqual(script.call_count, 2)
        predicate = script.call_args.args[0]
        self.assertIn("getComputedStyle(element).visibility !== 'visible'", predicate)
        self.assertIn(f"const expectedText = {json.dumps(text)}", predicate)
        self.assertIn("element.textContent.trim() !== expectedText", predicate)
        self.assertIn("element.contains(document.elementFromPoint", predicate)
        request.assert_called_once_with("POST", "/session/owned/element/delete-button/click", {})

    def test_http_failure_response_is_closed_and_preserves_diagnostics(self):
        driver = Driver("http://127.0.0.1:1")
        body = BytesIO(b'element not interactable')
        error = HTTPError("http://127.0.0.1:1/click", 400, "Bad Request", None, body)
        with patch("native_acceptance.urlopen", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, "element not interactable"):
                driver.request("POST", "/session/owned/element/button/click", {})
        self.assertTrue(body.closed)

    def test_text_click_requires_a_unique_match_and_uses_native_element_click(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "button"}
        with patch.object(driver, "script", return_value=[element]) as script, patch.object(driver, "request") as request:
            driver.click_text("button", "Discard captured changes")
            self.assertEqual(script.call_args.args[1:], ("button", "Discard captured changes"))
            request.assert_called_once_with("POST", "/session/owned/element/button/click", {})
        for matches in ([], [element, element]):
            with self.subTest(matches=matches), patch.object(driver, "script", return_value=matches), patch.object(driver, "request") as request:
                with self.assertRaises(ValueError):
                    driver.click_text("button", "Discard captured changes")
                request.assert_not_called()

    def test_scrolled_text_click_waits_for_paint_and_dispatches_one_native_click(self):
        driver = Driver("http://127.0.0.1:1"); driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "recovery-button"}
        geometry = {"before": {"hitTarget": False}, "after": {"hitTarget": True}, "interactable": True}
        with patch.object(driver, "script", return_value=[element]), patch.object(driver, "request", side_effect=[geometry, None]) as request:
            self.assertEqual(driver.click_scrolled_text("button", "Load recovered text into editor"), geometry)
        self.assertEqual(request.call_count, 2)
        scroll, click = request.call_args_list
        self.assertEqual(scroll.args[:2], ("POST", "/session/owned/execute/async"))
        self.assertEqual(scroll.args[2]["args"], [element])
        self.assertIn("scrollIntoView", scroll.args[2]["script"])
        self.assertIn("elementFromPoint", scroll.args[2]["script"])
        self.assertNotIn(".click(", scroll.args[2]["script"])
        self.assertNotIn("dispatchEvent", scroll.args[2]["script"])
        self.assertEqual(click.args, ("POST", "/session/owned/element/recovery-button/click", {}))

    def test_scrolled_text_click_refuses_ambiguous_or_missing_controls_without_dispatch(self):
        driver = Driver("http://127.0.0.1:1"); driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "recovery-button"}
        for matches in ([], [element, element]):
            with self.subTest(matches=matches), patch.object(driver, "script", return_value=matches), patch.object(driver, "request") as request:
                with self.assertRaises(ValueError): driver.click_scrolled_text("button", "Load recovered text into editor")
                request.assert_not_called()

    def test_navigation_readiness_captures_the_first_ready_element_before_one_click(self):
        driver = Driver('http://127.0.0.1:1'); driver.session = 'owned'
        element = {'element-6066-11e4-a52e-4f735466cecf': 'ready-navigation'}
        with patch.object(driver, 'script', side_effect=[[], [], [element]]) as script, \
                patch.object(driver, 'wait', wraps=driver.wait) as wait, \
                patch.object(driver, 'request', side_effect=[{'interactable': True}, None]) as request, \
                patch('native_acceptance.time.sleep'):
            driver.click_scrolled_text('button', 'Open discarded-change recovery…', wait_for_ready=True)
        self.assertEqual(script.call_count, 3)
        wait.assert_called_once()
        self.assertEqual(wait.call_args.kwargs, {})  # No longer deadline than the replaced presence wait.
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args.args, ('POST', '/session/owned/element/ready-navigation/click', {}))

    def test_scrolled_click_accepts_an_icon_control_with_no_text_filter(self):
        driver = Driver('http://127.0.0.1:1'); driver.session = 'owned'
        selector = 'button[aria-label="Discard all unstaged changes"]'
        element = {'element-6066-11e4-a52e-4f735466cecf': 'discard'}
        with patch.object(driver, 'wait', return_value=[element]) as wait, \
                patch.object(driver, 'request', side_effect=[{'interactable': True}, None]) as request:
            driver.click_scrolled_text(selector, wait_for_ready=True)
        self.assertIn('text === null', wait.call_args.args[0])
        self.assertTrue(wait.call_args.args[0].endswith(', null);'))
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args.args, ('POST', '/session/owned/element/discard/click', {}))

    def test_navigation_readiness_still_refuses_ambiguity_and_times_out_without_a_click(self):
        driver = Driver('http://127.0.0.1:1'); driver.session = 'owned'
        element = {'element-6066-11e4-a52e-4f735466cecf': 'ambiguous'}
        with patch.object(driver, 'script', return_value=[element, element]), patch.object(driver, 'request') as request:
            with self.assertRaises(ValueError):
                driver.click_scrolled_text('button', 'Owned navigation', wait_for_ready=True)
            request.assert_not_called()
        with patch.object(driver, 'script', return_value=[]), patch.object(driver, 'request') as request, \
                patch('native_acceptance.time.monotonic', side_effect=[0, 0, 31]), patch('native_acceptance.time.sleep'):
            with self.assertRaises(TimeoutError):
                driver.click_scrolled_text('button', 'Owned navigation', wait_for_ready=True)
            request.assert_not_called()

    def test_navigation_readiness_does_not_replay_a_lost_click_reply(self):
        driver = Driver('http://127.0.0.1:1'); driver.session = 'owned'
        element = {'element-6066-11e4-a52e-4f735466cecf': 'owned-navigation'}
        with patch.object(driver, 'script', return_value=[element]) as script, \
                patch.object(driver, 'request', side_effect=[{'interactable': True}, RemoteDisconnected('Lost reply')]) as request:
            with self.assertRaises(RemoteDisconnected):
                driver.click_scrolled_text('button', 'Owned navigation', wait_for_ready=True)
        self.assertEqual(script.call_count, 1)
        self.assertEqual(request.call_count, 2)

    def test_scrolled_text_click_refuses_a_clipped_or_obscured_target_without_clicking(self):
        driver = Driver("http://127.0.0.1:1"); driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "recovery-button"}
        with patch.object(driver, "script", return_value=[element]), patch.object(driver, "request", return_value={"interactable": False}) as request:
            with self.assertRaisesRegex(RuntimeError, "not interactable after ordinary scrolling"):
                driver.click_scrolled_text("button", "Load recovered text into editor")
        request.assert_called_once()
        self.assertEqual(request.call_args.args[1], "/session/owned/execute/async")

    def test_scrolled_text_click_never_replays_a_lost_scroll_or_action_reply(self):
        element = {"element-6066-11e4-a52e-4f735466cecf": "recovery-button"}
        geometry = {"interactable": True}
        for replies, expected in [([RemoteDisconnected("scroll reply lost")], 1),
                                  ([geometry, RemoteDisconnected("click reply lost")], 2)]:
            driver = Driver("http://127.0.0.1:1"); driver.session = "owned"
            with self.subTest(expected=expected), patch.object(driver, "script", return_value=[element]), patch.object(driver, "request", side_effect=replies) as request:
                with self.assertRaises(RemoteDisconnected): driver.click_scrolled_text("button", "Load recovered text into editor")
            self.assertEqual(request.call_count, expected)
            self.assertEqual(sum(call.args[1].endswith("/click") for call in request.call_args_list), expected - 1)

    def test_key_press_releases_the_same_native_key_without_replay(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        with patch.object(driver, "request") as request:
            driver.key("\ue036")
        request.assert_called_once_with("POST", "/session/owned/actions", {"actions": [{
            "type": "key", "id": "native-keyboard", "actions": [
                {"type": "keyDown", "value": "\ue036"}, {"type": "keyUp", "value": "\ue036"},
            ],
        }]})

    def test_pointer_press_and_release_use_the_same_native_input_source(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "outside-button"}
        with patch.object(driver, "request", side_effect=[element, None, None]) as request:
            driver.pointer_down(".outside")
            driver.pointer_up()
        lookup, press, release = request.call_args_list
        self.assertEqual(lookup.args, ("POST", "/session/owned/element", {"using": "css selector", "value": ".outside"}))
        self.assertEqual(press.args[:2], ("POST", "/session/owned/actions"))
        self.assertEqual(release.args[:2], ("POST", "/session/owned/actions"))
        down = press.args[2]["actions"][0]
        up = release.args[2]["actions"][0]
        self.assertEqual(down["id"], up["id"])
        self.assertEqual(down["actions"], [
            {"type": "pointerMove", "origin": element, "x": 0, "y": 0, "duration": 0},
            {"type": "pointerDown", "button": 0},
        ])
        self.assertEqual(up["actions"], [{"type": "pointerUp", "button": 0}])

    def test_start_keeps_incoming_links_as_separate_literal_arguments(self):
        driver = Driver("http://127.0.0.1:1")
        arguments = ['git-khronos://repository?v=1&remote=ssh%3A%2F%2Fowned%40example.test%2Fa',
                     'git-khronos:invalid $(literal)']
        with patch.object(driver, "request", side_effect=[{"sessionId": "owned"}, None]) as request:
            driver.start(Path("/fixture/git-khronos"), args=arguments)
        options = request.call_args_list[0].args[2]["capabilities"]["alwaysMatch"]["tauri:options"]
        self.assertEqual(options["args"], arguments)

    def test_start_does_not_repeat_session_creation_after_a_lost_response(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", side_effect=RemoteDisconnected("reply lost")) as request:
            with self.assertRaises(RemoteDisconnected):
                driver.start(Path("/fixture/git-khronos"))
        self.assertEqual(request.call_count, 1)

    def test_start_retries_only_connections_refused_before_session_creation(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", side_effect=[
            URLError(ConnectionRefusedError("driver not listening yet")),
            {"sessionId": "owned"}, None,
        ]) as request, patch("native_acceptance.time.sleep"):
            driver.start(Path("/fixture/git-khronos"))
        self.assertEqual(driver.session, "owned")
        self.assertEqual(request.call_count, 3)
        self.assertEqual(request.call_args_list[0], request.call_args_list[1])
        self.assertEqual(request.call_args.args[1], "/session/owned/timeouts")

    def test_start_does_not_repeat_session_creation_after_connection_reset(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", side_effect=URLError(ConnectionResetError("ambiguous"))) as request:
            with self.assertRaises(URLError):
                driver.start(Path("/fixture/git-khronos"))
        self.assertEqual(request.call_count, 1)

    def test_failure_evidence_and_driver_shutdown_precede_fixture_cleanup(self):
        self._assert_failed_startup_cleanup(shutdown_fails=False)

    def test_unverified_shutdown_preserves_fixture_and_reports_failure(self):
        self._assert_failed_startup_cleanup(shutdown_fails=True)

    def _assert_failed_startup_cleanup(self, shutdown_fails):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            version, filename = expected_debian_package()
            package = root / filename
            package.write_bytes(b"package fixture")
            fixture = root / "fixture"
            executable = fixture / "package/usr/bin/git-khronos"
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b"executable fixture")
            cleaned = False

            def cleanup(*_args):
                nonlocal cleaned
                cleaned = True

            scratch = MagicMock()
            scratch.name = str(fixture)
            scratch.__enter__.return_value = str(fixture)
            scratch.__exit__.side_effect = cleanup
            scratch.cleanup.side_effect = cleanup
            observed = []

            def stop(_process):
                observed.append(("stop", cleaned))
                if shutdown_fails:
                    raise TimeoutError("owned writer did not stop")

            driver = MagicMock()
            driver.session = "owned"
            driver.native_pointer_deliveries = []
            driver.start.side_effect = RuntimeError("fixture startup failure")
            driver.screenshot.side_effect = lambda _path: observed.append(("screenshot", cleaned))
            driver.close.side_effect = lambda: observed.append(("close", cleaned))
            process = MagicMock()
            process.poll.return_value = 0
            bus = MagicMock()
            bus.stdout = None
            def private_bus(_fixtures, children, _log):
                children.append(bus)
                return {'pid': 123, 'private': True, 'hostServiceActivation': False}
            def package_command(*command):
                if command[0] == "dpkg-deb":
                    staged = Path(command[2])
                    self.assertNotEqual(staged, package)
                    self.assertEqual(staged.read_bytes(), b"package fixture")
                    if command[-1] == "Package":
                        replacement = root / "replacement"
                        replacement.write_bytes(b"concurrent package build")
                        replacement.replace(package)
                return {"Package": "git-khronos", "Architecture": "amd64", "Version": version}.get(command[-1], "fixture")
            args = SimpleNamespace(package=package, output=root / "evidence", suite="smoke", describe_runner=False,
                                   headless=False, inherited_git_environment=False, installed=False)
            with ExitStack() as mocks:
                for target, value in {
                    "native_acceptance.argparse.ArgumentParser.parse_args": args,
                    "native_acceptance.tempfile.TemporaryDirectory": scratch,
                    "native_acceptance.Fixtures": SimpleNamespace(root=fixture, env={}),
                    "native_acceptance.Driver": driver,
                    "native_acceptance.subprocess.Popen": process,
                    "native_acceptance.shutil.which": "/fixture/tool",
                    "native_acceptance.webdriver_ports": (12345, 12346),
                    "native_acceptance.wait_webdriver_ready": None,
                    "native_acceptance.platform.platform": "fixture-platform",
                }.items():
                    mocks.enter_context(patch(target, return_value=value))
                mocks.enter_context(patch("native_acceptance.run", side_effect=package_command))
                mocks.enter_context(patch("native_acceptance.start_private_dbus", side_effect=private_bus))
                mocks.enter_context(patch("builtins.print"))
                shutdown = mocks.enter_context(patch("native_acceptance.stop_owned_process_group",
                                                    side_effect=stop))
                self.assertEqual(main(), 1)
            self.assertEqual(observed, [("screenshot", False), ("close", False), ("stop", False), ("stop", False)])
            self.assertEqual(shutdown.call_args_list, [call(process), call(bus)])
            evidence = json.loads(next((root / "evidence").glob("*/report.json")).read_text())
            self.assertFalse(evidence["passed"])
            self.assertEqual(evidence["package"], str(package))
            self.assertEqual(evidence["packageSha256"], hashlib.sha256(b"package fixture").hexdigest())
            self.assertEqual(package.read_bytes(), b"concurrent package build")
            if shutdown_fails:
                scratch.cleanup.assert_not_called()
                scratch._finalizer.detach.assert_called_once()
                self.assertFalse(cleaned)
                self.assertEqual(evidence["retainedFixture"], str(fixture))
                self.assertIn("owned writer did not stop", evidence["processShutdownFailures"][0])
                self.assertTrue(executable.is_file())
            else:
                scratch.cleanup.assert_called_once()
                scratch._finalizer.detach.assert_not_called()
                self.assertTrue(cleaned)

    def test_reload_waits_for_a_new_document_without_repeating_navigation(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        with patch.object(driver, "script", side_effect=[123, False, True]) as script, \
                patch.object(driver, "request") as request, patch("native_acceptance.time.sleep"):
            driver.reload()
        request.assert_called_once_with("POST", "/session/owned/refresh", {})
        self.assertEqual(script.call_count, 3)
        self.assertIn("performance.timeOrigin !== 123", script.call_args.args[0])

    def test_read_only_wait_tolerates_document_replacement_disconnects(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "script", side_effect=[RemoteDisconnected("reloading"), True]) as script, \
                patch("native_acceptance.time.sleep"):
            self.assertTrue(driver.wait("return document.readyState === 'complete'"))
        self.assertEqual(script.call_count, 2)

    def test_terminal_startup_does_not_inherit_personal_home_or_shell_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "fixture"
            root.mkdir()
            with patch.dict(os.environ, {"HOME": str(Path(directory) / "personal"),
                                         "SHELL": "/personal/shell", "ENV": "/personal/rc",
                                         "BASH_ENV": "/personal/bashrc"}):
                fixtures = Fixtures(root)
            self.assertTrue(Path(fixtures.env["HOME"]).is_relative_to(root))
            self.assertTrue(Path(fixtures.env["HOME"]).is_dir())
            self.assertEqual(fixtures.env["SHELL"], "/bin/sh")
            self.assertNotIn("ENV", fixtures.env)
            self.assertNotIn("BASH_ENV", fixtures.env)

    def test_terminal_launcher_records_the_same_pid_and_preserves_the_disposable_home(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "fixture with spaces"
            root.mkdir()
            fixtures = Fixtures(root)
            environment = {**fixtures.env, **fixtures.terminal_environment()}
            process = subprocess.Popen([environment["SHELL"], "-c", 'printf "%s" "$HOME"'],
                                       env=environment, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                output, error = process.communicate(timeout=5)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            self.assertEqual(process.returncode, 0, error)
            self.assertEqual(output.decode(), fixtures.env["HOME"])
            self.assertEqual(fixtures.terminal_pids.read_text(), f"{process.pid}\n")
            self.assertEqual(Path(environment["SHELL"]).stat().st_mode & 0o777, 0o700)

    def test_read_only_element_lookup_retries_a_transient_driver_disconnect(self):
        driver = Driver("http://127.0.0.1:1")
        with patch("native_acceptance.urlopen", side_effect=[RemoteDisconnected("refreshing"), MagicMock()]) as request, \
                patch("native_acceptance.json.load", return_value={"value": {"element": "owned"}}), \
                patch("native_acceptance.time.sleep"):
            self.assertEqual(driver.request("POST", "/session/owned/element", {"value": ".wip-nav"}), {"element": "owned"})
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[0].kwargs["timeout"], 90)
        self.assertLessEqual(request.call_args_list[1].kwargs["timeout"], 2)

    def test_proxy_and_native_driver_are_assigned_different_ports(self):
        proxy, native = webdriver_ports()
        self.assertNotEqual(proxy, native)

    def test_discovery_does_not_send_status_requests_through_the_capability_proxy(self):
        driver = Driver("http://127.0.0.1:12345", "http://127.0.0.1:12346")
        with patch("native_acceptance.urlopen", return_value=MagicMock()) as request, \
                patch("native_acceptance.json.load", return_value={"value": {"ready": True}}):
            driver.request("GET", "/status", timeout=1)
            driver.request("POST", "/session", {})
        self.assertEqual([args.args[0].full_url for args in request.call_args_list],
                         ["http://127.0.0.1:12346/status", "http://127.0.0.1:12345/session"])
        self.assertEqual(request.call_args_list[0].kwargs["timeout"], 1)

    def test_native_ready_requires_a_listening_proxy_and_an_affirmative_response(self):
        driver = MagicMock()
        driver.request.side_effect = [{"ready": False}, {"ready": True}]
        process = MagicMock()
        process.poll.return_value = None
        with patch("native_acceptance.socket.create_connection") as connect, patch("native_acceptance.time.sleep"):
            wait_webdriver_ready(driver, process, 12345)
        self.assertEqual(connect.call_count, 2)
        self.assertEqual(driver.request.call_args_list, [call("GET", "/status", timeout=1)] * 2)

    def test_mutating_driver_requests_are_never_retried(self):
        driver = Driver("http://127.0.0.1:1")
        for path in ("/session/owned/element/button/click", "/session/owned/execute/async", "/session/owned/refresh"):
            with self.subTest(path=path), patch("native_acceptance.urlopen", side_effect=RemoteDisconnected("lost reply")) as request:
                with self.assertRaises(RemoteDisconnected):
                    driver.request("POST", path, {})
                self.assertEqual(request.call_count, 1)

    def test_read_only_retries_stop_at_the_deadline(self):
        driver = Driver("http://127.0.0.1:1")
        with patch("native_acceptance.urlopen", side_effect=RemoteDisconnected("unavailable")) as request, \
                patch("native_acceptance.time.monotonic", side_effect=[0, 0, 3]), \
                patch("native_acceptance.time.sleep"):
            with self.assertRaises(RemoteDisconnected):
                driver.request("GET", "/status")
        self.assertEqual(request.call_count, 2)

    def test_subprocess_failures_retain_bounded_diagnostics(self):
        with self.assertRaisesRegex(RuntimeError, "fixture failure"):
            run("sh", "-c", "printf 'fixture failure' >&2; exit 7")

    def test_repositories_are_deterministic_and_host_configuration_is_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            first = fixtures.repository("first", 12)
            second = fixtures.repository("second", 12)
            self.assertEqual(fixtures.git(first, "rev-parse", "HEAD"), fixtures.git(second, "rev-parse", "HEAD"))
            self.assertEqual(fixtures.git(first, "rev-list", "--count", "HEAD"), "12")
            self.assertEqual(fixtures.git(first, "status", "--porcelain"), "")
            self.assertEqual(fixtures.env["GIT_CONFIG_NOSYSTEM"], "1")
            self.assertTrue(Path(fixtures.env["GIT_CONFIG_GLOBAL"]).is_relative_to(directory))
            self.assertEqual(fixtures.git(first, "config", "user.email"), "native@example.test")

    def test_native_failures_remain_failures(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", return_value={"ok": False, "error": {"kind": "operationCancelled"}}):
            with self.assertRaisesRegex(RuntimeError, "operationCancelled"):
                driver.invoke("fetch_repository", repoId="owned")

    def test_void_native_results_are_allowed(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", return_value={"ok": True, "value": None}):
            self.assertIsNone(driver.invoke("close_terminal", sessionId="owned"))

    def test_session_start_stops_retrying_when_the_driver_never_listens(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", side_effect=URLError(ConnectionRefusedError("not listening"))) as request, \
                patch("native_acceptance.time.monotonic", side_effect=[0, 6]):
            with self.assertRaises(URLError):
                driver.start(Path("/owned/application"))
        self.assertIsNone(driver.session)
        request.assert_called_once()


if __name__ == "__main__":
    unittest.main()
