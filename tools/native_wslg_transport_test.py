"""CLI checks using private fixture logs; no WSL host is required."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("check-wslg-transport.py")
ERROR = 'rdp_allocate_shared_memory: Failed to open "/private/id" with error: Input/output error\n'
COPY = "RDP backend: use_gfxredir = 0\n"
ENABLED = "RDP backend: use_gfxredir = 1\n"


class WslgTransportTest(unittest.TestCase):
    def diagnostic(self, contents):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "weston.log"
            if contents is not None:
                log.write_text(contents, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(SCRIPT), "--log", str(log)],
                text=True,
                capture_output=True,
                check=False,
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
