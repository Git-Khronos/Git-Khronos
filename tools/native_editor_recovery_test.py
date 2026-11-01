"""Crash acceptance may signal only its verified executable and private profile."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from native_editor_recovery_scenarios import kill_owned_recovery_process


class OwnedRecoveryCrashTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='owned-recovery-kill-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.home = self.root / 'private-data'
        self.home.mkdir(mode=0o700)
        package = self.root / 'package'
        package.mkdir()
        self.executable = package / 'owned-sleep'
        shutil.copy2(shutil.which('sleep'), self.executable)
        self.digest = hashlib.sha256(self.executable.read_bytes()).hexdigest()

    def start(self, executable=None, data_home=None):
        child = subprocess.Popen([str(executable or self.executable), '60'],
                                 env={**os.environ, 'XDG_DATA_HOME': str(data_home or self.home)})
        def finish():
            if child.poll() is None:
                child.kill()
            child.wait(timeout=10)
        self.addCleanup(finish)
        return child

    def test_exact_pidfd_exit_leaves_other_fixture_process_running(self):
        sentinel_path = self.root / 'package/sentinel-sleep'
        shutil.copy2(self.executable, sentinel_path)
        sentinel = self.start(sentinel_path)
        child = self.start()
        result = kill_owned_recovery_process(self.executable, self.root, self.home, self.digest)
        self.assertEqual(result['pid'], child.pid)
        self.assertTrue(result['pidfdExitConfirmed'])
        self.assertEqual(child.wait(timeout=10), -9)
        self.assertIsNone(sentinel.poll())

    def test_different_profile_refuses_without_signalling(self):
        other = self.root / 'other-profile'
        other.mkdir()
        child = self.start(data_home=other)
        with self.assertRaisesRegex(RuntimeError, 'profile does not match'):
            kill_owned_recovery_process(self.executable, self.root, self.home, self.digest)
        self.assertIsNone(child.poll())

    def test_different_hash_refuses_without_signalling(self):
        child = self.start()
        with self.assertRaisesRegex(RuntimeError, 'hash does not match'):
            kill_owned_recovery_process(self.executable, self.root, self.home, '0' * 64)
        self.assertIsNone(child.poll())

    def test_ambiguous_process_identity_refuses_without_signalling(self):
        first = self.start()
        second = self.start()
        with self.assertRaisesRegex(RuntimeError, 'exactly one process'):
            kill_owned_recovery_process(self.executable, self.root, self.home, self.digest)
        self.assertIsNone(first.poll())
        self.assertIsNone(second.poll())

    def test_executable_outside_extracted_fixture_refuses(self):
        with self.assertRaisesRegex(RuntimeError, 'extracted fixture executable'):
            kill_owned_recovery_process(shutil.which('sleep'), self.root, self.home, self.digest)


if __name__ == '__main__':
    unittest.main()
