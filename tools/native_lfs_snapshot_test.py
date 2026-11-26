"""Safety checks for the isolated installed LFS timeout scenario."""
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

from native_lfs_snapshot_scenarios import (
    ATTR_FINISHED, ATTR_REPOSITORY, ATTR_STARTED, REPOSITORY, STARTED,
    VERSION_HOLD, VERSION_REPOSITORY, VERSION_STARTED, lfs_snapshot_timeout_environment,
)


class LfsSnapshotFixtureTests(unittest.TestCase):
    def test_only_the_owned_repository_listing_is_stalled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            real_bin = root / 'real-bin'
            real_bin.mkdir()
            executable = real_bin / 'git-lfs'
            executable.write_text('#!/bin/sh\nprintf "delegated %s\\n" "$1"\n')
            executable.chmod(0o700)
            git = real_bin / 'git'
            git.write_text('#!/bin/sh\nprintf "delegated %s\\n" "$3"\n')
            git.chmod(0o700)
            sleep = real_bin / 'sleep'
            sleep.write_text('#!/bin/sh\ntest "$1" = 12\n')
            sleep.chmod(0o700)
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
            git_shim = shim.with_name('git')
            target = root / ATTR_REPOSITORY
            for checkout, pattern in ((other, 'filter=lfs'), (target, 'other-pattern')):
                subprocess.run([str(git_shim), '-C', str(checkout), 'grep', '-I', '-q', '-e', pattern],
                               env=application_env, capture_output=True, text=True, timeout=3, check=True)
                self.assertFalse((root / ATTR_STARTED).exists())
            subprocess.run([str(git_shim), '-C', str(target), 'grep', '-I', '-q', '-e', 'filter=lfs'],
                           env=application_env, capture_output=True, text=True, timeout=3, check=True)
            self.assertTrue((root / ATTR_STARTED).read_text().strip().isdigit())
            self.assertTrue((root / ATTR_FINISHED).exists())
            version_checkout = root / VERSION_REPOSITORY
            version_checkout.mkdir()
            subprocess.run([str(shim), 'version'], cwd=version_checkout, env=application_env,
                           capture_output=True, text=True, timeout=3, check=True)
            self.assertFalse((root / VERSION_STARTED).exists())
            (root / VERSION_HOLD).touch()
            subprocess.run([str(shim), 'version'], cwd=version_checkout, env=application_env,
                           capture_output=True, text=True, timeout=3, check=True)
            self.assertTrue((root / VERSION_STARTED).read_text().strip().isdigit())
            self.assertEqual(fixtures.env, {'PATH': str(real_bin)})
