import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from native_watcher_scenarios import watcher_status_environment


class WatcherStatusFixtureTest(unittest.TestCase):
    def test_opt_in_trace_records_timestamps_and_modes_only_for_owned_git_status(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            real = root / 'git'
            real.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            real.chmod(0o700)
            fixture = SimpleNamespace(root=root, env=os.environ | {'PATH': str(root) + ':/usr/bin:/bin'})
            with patch.dict(os.environ, {'GIT_KHRONOS_NATIVE_TRACE_WATCHER': '1'}):
                environment = fixture.env | watcher_status_environment(fixture)
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
