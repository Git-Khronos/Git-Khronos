"""Exercise Linux update authorization target selection without registering an agent."""
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import Mock, patch

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


class AgentRegistrationTests(unittest.TestCase):
    def exercise(self, ready, statuses, start="4567"):
        child = Mock()
        child.poll.side_effect = statuses
        child.wait.return_value = 0
        output, errors = StringIO(), StringIO()
        run_agent = agent["run_agent"]
        with (
            patch.dict(run_agent.__globals__, {"process_start": Mock(return_value=start)}),
            patch("subprocess.Popen", return_value=child) as spawn,
            patch("select.select", return_value=([1] if ready else [], [], [])),
            redirect_stdout(output),
            redirect_stderr(errors),
        ):
            status = run_agent("123,4567")
        command = spawn.call_args.args[0]
        self.assertEqual(command[1:-1], ["--process", "123,4567", "--notify-fd"])
        self.assertEqual(spawn.call_args.kwargs["pass_fds"], (int(command[-1]),))
        return status, output.getvalue(), errors.getvalue(), child

    def test_prompts_for_retry_only_after_registration(self):
        status, message, error, child = self.exercise(True, [None, 0])
        self.assertEqual(status, 0)
        self.assertIn("retry Install verified update", message)
        self.assertFalse(error)
        child.terminate.assert_not_called()

    def test_reports_registration_failure_without_prompting_for_retry(self):
        status, message, error, child = self.exercise(True, [1, 1])
        self.assertEqual(status, 1)
        self.assertFalse(message)
        self.assertIn("did not stay running", error)
        child.terminate.assert_not_called()

    def test_exits_if_agent_is_attached_to_a_stale_app_process(self):
        status, message, error, child = self.exercise(True, [None, None], start=None)
        self.assertFalse(message)
        self.assertEqual(status, 1)
        self.assertIn("exited or restarted", error)
        child.terminate.assert_called_once()

    def test_cleans_up_only_the_agent_it_started_after_timeout(self):
        status, message, error, child = self.exercise(False, [None])
        self.assertEqual(status, 1)
        self.assertFalse(message)
        self.assertIn("did not register in time", error)
        child.terminate.assert_called_once()
        child.wait.assert_called_once_with(timeout=2)


if __name__ == "__main__":
    unittest.main()
