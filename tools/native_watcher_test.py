import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from native_watcher_scenarios import external_checkout_and_untracked, watcher_status_environment


class ExternalCheckoutObservationTest(unittest.TestCase):
    def exercise(self, root, report, *, times_out):
        native_calls = []

        def git(repository, *args):
            self.assertEqual(repository, root)
            if args[:2] == ('symbolic-ref', '--short'):
                return 'native-status-probe'
            if args == ('--no-optional-locks', 'status', '--short', '--branch'):
                return '## native-status-probe\n?? native-untracked.txt'
            return ''

        def wait(script):
            if times_out and 'current native-status-probe,' in script:
                raise TimeoutError('branch not rendered')

        def invoke(command, **args):
            native_calls.append((command, args))
            return {'branch': 'native-status-probe', 'untracked': 1, 'entries': ['unused']}

        driver = SimpleNamespace(wait=wait, invoke=invoke, script=lambda _script: {
            'hidden': False, 'branch': 'Switch branch, current main', 'untracked': False,
        })
        fixtures = SimpleNamespace(git=git)
        with patch.dict(os.environ, {'GIT_KHRONOS_NATIVE_TRACE_WATCHER': '0'}):
            if times_out:
                with self.assertRaisesRegex(TimeoutError, 'branch not rendered'):
                    external_checkout_and_untracked(driver, fixtures, root, 'repo-1', report)
            else:
                external_checkout_and_untracked(driver, fixtures, root, 'repo-1', report)
        return native_calls

    def test_timeout_captures_native_and_rendered_state_without_rescuing_the_test(self):
        with TemporaryDirectory() as directory:
            report = {'scenarios': []}
            calls = self.exercise(Path(directory), report, times_out=True)
        self.assertEqual(calls, [('refresh_repository_status', {'repoId': 'repo-1'})])
        self.assertEqual(report['scenarios'], [])
        self.assertEqual(report['externalCheckoutTimeout']['native'], {
            'branch': 'native-status-probe', 'untracked': 1,
        })
        self.assertEqual(report['externalCheckoutTimeout']['rendered']['branch'], 'Switch branch, current main')
        self.assertIn('?? native-untracked.txt', report['externalCheckoutTimeout']['git'])

    def test_success_requires_the_real_renderer_and_does_not_refresh_through_ipc(self):
        with TemporaryDirectory() as directory:
            report = {'scenarios': []}
            calls = self.exercise(Path(directory), report, times_out=False)
        self.assertFalse(calls)
        self.assertEqual(report['scenarios'], ['native-external-checkout-and-untracked-discovery'])
        self.assertNotIn('externalCheckoutTimeout', report)


class WatcherStatusFixtureTest(unittest.TestCase):
    def test_opt_in_trace_records_timestamps_and_modes_only_for_owned_git_status(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            suite_bin = root / 'suite-bin'
            suite_bin.mkdir()
            real = suite_bin / 'git'
            real.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            real.chmod(0o700)
            fixture = SimpleNamespace(root=root, env=os.environ | {'PATH': '/usr/bin:/bin'})
            suite_path = str(suite_bin) + ':' + fixture.env['PATH']
            with patch.dict(os.environ, {'GIT_KHRONOS_NATIVE_TRACE_WATCHER': '1'}):
                environment = fixture.env | watcher_status_environment(fixture, suite_path)
            self.assertTrue(environment['PATH'].endswith(':' + suite_path))
            for checkout, command in [('another', 'status'), ('repository', 'log'), ('repository', 'status')]:
                args = ['-C', str(root / checkout), command, '--porcelain=v1', '--untracked-files=normal']
                result = subprocess.check_output(['git', *args], env=environment, text=True, timeout=3)
                self.assertEqual(result.splitlines(), args)
            trace = root / 'owned-watcher-status' / 'status-trace'
            self.assertRegex(trace.read_text(), r'^\d+ normal\n$')

    def test_app_wrapper_claims_only_one_porcelain_status_read_for_owned_checkout(self):
        with TemporaryDirectory(prefix='owned watcher ') as directory:
            root = Path(directory)
            bindir = root / 'real-bin'
            bindir.mkdir()
            git = bindir / 'git'
            git.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            git.chmod(0o700)
            fixture = SimpleNamespace(root=root, env=os.environ | {'PATH': str(bindir) + ':/usr/bin:/bin'})
            app = fixture.env | watcher_status_environment(fixture)
            gate = root / 'owned-watcher-status'
            command = ['git', '-C', str(root / 'repository'), 'status', '--porcelain=v1']
            (gate / 'armed').touch()
            (gate / 'released').touch()

            def execute(args, env):
                return subprocess.check_output(args, env=env, text=True, timeout=1).splitlines()

            self.assertEqual(execute(command, fixture.env), command[1:])
            self.assertEqual(execute(command[:2] + [str(root / 'other')] + command[3:], app)[-2:], command[-2:])
            self.assertEqual(execute(command[:3] + ['log', '--porcelain=v1'], app)[-2:], ['log', '--porcelain=v1'])
            self.assertFalse((gate / 'claimed').exists())
            self.assertEqual(execute(command, app), command[1:])
            claim = gate / 'claimed'
            self.assertTrue(claim.is_dir())
            stamp = claim.stat().st_ino
            self.assertEqual(execute(command, app), command[1:])
            self.assertEqual(claim.stat().st_ino, stamp)
