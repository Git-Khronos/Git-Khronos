import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from native_watcher_scenarios import watcher_status_environment


class WatcherStatusFixtureTest(unittest.TestCase):
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
