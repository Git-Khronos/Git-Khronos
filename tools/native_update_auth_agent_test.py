"""Exercise Linux update authorization target selection without registering an agent."""
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

agent = runpy.run_path(str(Path(__file__).with_name("update-auth-agent.py")))
app_identity = agent["app_identity"]


class UpdateAuthAgentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.app = self.directory / "git-khronos"
        self.app.touch()
        self.process = self.directory / "123"
        self.process.mkdir()
        (self.process / "exe").symlink_to(self.app)
        self.write_stat()

    def write_stat(self, pid=123, state="S", start="4567"):
        fields = [state, *["0"] * 18, start, "0"]
        (self.process / "stat").write_text(f"{pid} (app ) worker) {' '.join(fields)}\n")

    def identity(self):
        return app_identity(self.process, self.app, os.getuid())

    def test_matches_executable_and_start_time_despite_process_name(self):
        self.assertEqual(self.identity(), "123,4567")

    def test_rejects_wrong_owner_or_executable(self):
        self.assertIsNone(app_identity(self.process, self.app, os.getuid() + 1))
        different = self.directory / "other"
        different.touch()
        self.assertIsNone(app_identity(self.process, different, os.getuid()))

    def test_rejects_invalid_or_exiting_process(self):
        for args in ({"state": "Z"}, {"state": "X"}, {"pid": 321}, {"start": "0"}, {"start": "?"}):
            with self.subTest(args=args):
                self.write_stat(**args)
                self.assertIsNone(self.identity())
        (self.process / "stat").unlink()
        self.assertIsNone(self.identity())

    def test_rejects_replaced_pid(self):
        with patch.dict(app_identity.__globals__, {"process_start": lambda _: next(starts)}):
            starts = iter(("4567", "4568"))
            self.assertIsNone(self.identity())


if __name__ == "__main__":
    unittest.main()
