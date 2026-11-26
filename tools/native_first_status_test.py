"""Fixtures for holding only the packaged app's complete working-tree scan."""
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from native_first_status_scenarios import CHECKOUT, GATE, first_status_environment


class FirstStatusEnvironmentTest(unittest.TestCase):
    def test_only_complete_porcelain_scan_for_owned_checkout_enters_the_gate(self):
        with TemporaryDirectory(prefix='owned first-status ') as directory:
            root = Path(directory)
            bin_dir = root / 'real'
            bin_dir.mkdir()
            git = bin_dir / 'git'
            git.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            git.chmod(0o700)
            fixture = SimpleNamespace(root=root, env=os.environ | {'PATH': str(bin_dir) + ':/usr/bin:/bin'})
            application = fixture.env | first_status_environment(fixture)
            entered = root / GATE / 'entered'

            def invoke(checkout, args, env, diagnostics=0):
                command = ['-C', str(root / checkout), *args]
                result = subprocess.run(['git', *command], env=env, text=True, timeout=2,
                                        capture_output=True, check=True)
                self.assertEqual(result.stdout.splitlines(), command)
                self.assertEqual(len(result.stderr), diagnostics)

            complete = ['status', '--porcelain=v1', '--untracked-files=normal']
            invoke(CHECKOUT, complete, fixture.env)
            invoke('other', complete, application)
            invoke(CHECKOUT, ['status', '--porcelain=v1', '--untracked-files=no'], application)
            invoke(CHECKOUT, ['status', '--short', '--untracked-files=normal'], application)
            invoke(CHECKOUT, ['show', '--porcelain=v1', '--untracked-files=normal'], application)
            self.assertFalse(entered.exists())
            (root / GATE / 'release').touch()
            for mode in ('normal', 'all'):
                invoke(CHECKOUT, ['status', '--porcelain=v1', '--untracked-files=' + mode], application, 2097152)
                self.assertTrue(entered.is_file())
                entered.unlink()


if __name__ == '__main__':
    unittest.main()
