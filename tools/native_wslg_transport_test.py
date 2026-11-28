"""CLI checks using private fixture logs; no WSL host is required."""

import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("check-wslg-transport.py")
ERROR = 'rdp_allocate_shared_memory: Failed to open "/private/id" with error: Input/output error\n'
COPY = "RDP backend: use_gfxredir = 0\n"
ENABLED = "RDP backend: use_gfxredir = 1\n"


class WslgTransportTest(unittest.TestCase):
    def diagnostic(self, contents, *options, environment=None):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "weston.log"
            if contents is not None:
                log.write_text(contents, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(SCRIPT), "--log", str(log), *options],
                text=True,
                capture_output=True,
                check=False,
                timeout=5,
                env=environment,
            )

    def test_matching_transport_failure_suggests_recovery_without_dumping_log(self):
        result = self.diagnostic(ERROR + COPY)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("wsl --shutdown", result.stdout)
        self.assertNotIn("/private/id", result.stdout)

    def test_copy_mode_or_graphics_warning_alone_does_not_suggest_restart(self):
        for log in (COPY, "libEGL warning: DRI3 error\n", ERROR + "other\n" * 10 + COPY):
            with self.subTest(log=log):
                result = self.diagnostic(log)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("wsl --shutdown", result.stdout)

    def test_later_graphics_redirection_supersedes_prior_failure(self):
        result = self.diagnostic(ERROR + COPY + ENABLED)
        self.assertIn("last reported graphics redirection enabled", result.stdout)
        self.assertNotIn("wsl --shutdown", result.stdout)

    def test_missing_log_is_not_reported_as_a_diagnosis(self):
        result = self.diagnostic(None)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Cannot read", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_only_complete_lines_in_the_bounded_tail_are_used(self):
        result = self.diagnostic(ERROR + COPY + "x" * 1024 * 1024 + ENABLED)
        self.assertIn("No recent WSLg graphics redirection mode", result.stdout)
        self.assertNotIn("wsl --shutdown", result.stdout)
        result = self.diagnostic(ERROR + COPY + "x" * 1024 * 1024 + "\n" + ENABLED)
        self.assertIn("last reported graphics redirection enabled", result.stdout)
        result = self.diagnostic(COPY + ENABLED.rstrip("\n"))
        self.assertIn("reported copy mode", result.stdout)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "requires POSIX FIFOs")
    def test_refuses_pipe_without_waiting_for_a_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "weston.log"
            os.mkfifo(log)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--log", str(log)],
                text=True, capture_output=True, timeout=5, check=False,
            )
        self.assertEqual(result.returncode, 2)
        self.assertIn("Expected a regular WSLg log file", result.stderr)

    def test_endpoint_check_distinguishes_a_socket_from_a_file_without_showing_paths(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as endpoint:
            path = Path(directory) / "private-display"
            endpoint.bind(str(path))
            environment = dict(os.environ, XDG_RUNTIME_DIR=directory, WAYLAND_DISPLAY=path.name, DISPLAY="remote:0")
            present = self.diagnostic(ENABLED, "--endpoints", environment=environment)
            self.assertEqual(present.returncode, 0, present.stderr)
            self.assertIn("Wayland: local socket present", present.stdout)
            self.assertIn("X11: not a local Unix display", present.stdout)
            self.assertNotIn(directory, present.stdout)
            path.unlink()
            path.touch()
            missing = self.diagnostic(ENABLED, "--endpoints", environment=environment)
            self.assertIn("Wayland: local socket missing", missing.stdout)
            self.assertIn("does not establish display access", missing.stdout)
