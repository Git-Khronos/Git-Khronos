"""Safety checks for the isolated installed LFS timeout scenario."""
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

from native_lfs_snapshot_scenarios import REPOSITORY, STARTED, lfs_snapshot_timeout_environment


class LfsSnapshotFixtureTests(unittest.TestCase):
    def test_only_the_owned_repository_listing_is_stalled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            real_bin = root / 'real-bin'
            real_bin.mkdir()
            executable = real_bin / 'git-lfs'
            executable.write_text('#!/bin/sh\nprintf "delegated %s\\n" "$1"\n')
            executable.chmod(0o700)
            owned = root / REPOSITORY
            owned.mkdir()
            other = root / 'other checkout'
            other.mkdir()
            fixtures = SimpleNamespace(root=root, env={'PATH': str(real_bin)})
            application_env = lfs_snapshot_timeout_environment(fixtures)
            shim = Path(application_env['PATH'].split(':', 1)[0]) / 'git-lfs'
            for cwd, command in ((other, 'ls-files'), (owned, 'version')):
                result = subprocess.run([str(shim), command], cwd=cwd, env=application_env,
                                        capture_output=True, text=True, timeout=3, check=True)
                self.assertEqual(result.stdout.strip(), f'delegated {command}')
            self.assertFalse((root / STARTED).exists())
            self.assertEqual(fixtures.env, {'PATH': str(real_bin)})
