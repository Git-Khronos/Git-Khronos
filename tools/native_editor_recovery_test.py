"""Crash acceptance may signal only its verified executable and private profile."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

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

    def start(self, executable=None, data_home=None, bus_address=None):
        env = {'XDG_DATA_HOME': str(data_home or self.home)}
        if bus_address is not None:
            env['DBUS_SESSION_BUS_ADDRESS'] = bus_address
        child = subprocess.Popen([str(executable or self.executable), '60'],
                                 env=env)
        def finish():
            if child.poll() is None:
                child.kill()
            child.wait(timeout=10)
        self.addCleanup(finish)
        # The pidfd test should start once the owned child's procfs metadata
        # is visible. Keep the production identity check fail-closed; this
        # readiness poll uses the precise PID just returned by Popen.
        deadline = time.monotonic() + 3
        expected = {f'{name}={value}'.encode() for name, value in env.items()}
        environ = Path(f'/proc/{child.pid}/environ')
        while child.poll() is None and time.monotonic() < deadline:
            if expected.issubset(environ.read_bytes().split(b'\0')):
                return child
            time.sleep(0.01)
        self.fail(f'Sleep fixture {child.pid} did not expose its private profile')

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

    def installed_fixture(self):
        installed = self.root / 'installed-sleep'
        packaged = self.root / 'package/usr/bin/git-khronos'
        packaged.parent.mkdir(parents=True)
        shutil.copy2(self.executable, installed)
        shutil.copy2(self.executable, packaged)
        bus = 'unix:abstract=git-khronos-test-owned-crash'
        driver = Mock(executable=installed, session='owned-session', session_bus_address=bus)
        return installed, bus, driver

    def test_installed_crash_only_signals_private_bus_owner_with_same_binary(self):
        installed, bus, driver = self.installed_fixture()
        sentinel = self.start(installed, bus_address='unix:abstract=unrelated-process')
        child = self.start(installed, bus_address=bus)
        driver.single_instance_bus_call.return_value = f'uint32 {child.pid}'
        with patch('native_editor_recovery_scenarios._INSTALLED_APP', installed):
            result = kill_owned_recovery_process(installed, self.root, self.home, self.digest,
                                                 installed_driver=driver)
        self.assertEqual(result['ownership'], 'installed-private-bus')
        self.assertEqual(result['pid'], child.pid)
        self.assertEqual(child.wait(timeout=10), -9)
        self.assertIsNone(sentinel.poll())

    def test_installed_crash_refuses_wrong_bus_even_with_matching_binary_and_profile(self):
        installed, _, driver = self.installed_fixture()
        child = self.start(installed, bus_address='unix:abstract=unrelated-process')
        driver.single_instance_bus_call.return_value = f'uint32 {child.pid}'
        with patch('native_editor_recovery_scenarios._INSTALLED_APP', installed):
            with self.assertRaisesRegex(RuntimeError, 'session bus does not match'):
                kill_owned_recovery_process(installed, self.root, self.home, self.digest,
                                            installed_driver=driver)
        self.assertIsNone(child.poll())

    def test_installed_crash_refuses_a_bus_owner_change(self):
        installed, bus, driver = self.installed_fixture()
        child = self.start(installed, bus_address=bus)
        sentinel = self.start(installed, bus_address=bus)
        driver.single_instance_bus_call.side_effect = [f'uint32 {child.pid}', f'uint32 {sentinel.pid}']
        with patch('native_editor_recovery_scenarios._INSTALLED_APP', installed):
            with self.assertRaisesRegex(RuntimeError, 'bus owner changed'):
                kill_owned_recovery_process(installed, self.root, self.home, self.digest,
                                            installed_driver=driver)
        self.assertIsNone(child.poll())
        self.assertIsNone(sentinel.poll())


if __name__ == '__main__':
    unittest.main()
