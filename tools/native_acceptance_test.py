import json
import os
import select
import signal
import subprocess
import sys
from contextlib import ExitStack
from http.client import RemoteDisconnected
from pathlib import Path
import tempfile
import time
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch
from urllib.error import HTTPError, URLError

from native_acceptance import Driver, Fixtures, main, run, start_private_dbus, stop_owned_process_group


class FixtureTests(unittest.TestCase):
    def test_private_session_buses_are_distinct_and_cannot_activate_host_services(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_root, second_root = root / 'first', root / 'second'
            first_root.mkdir(); second_root.mkdir()
            children = []
            with patch.dict(os.environ, {'DBUS_SESSION_BUS_ADDRESS': 'unix:abstract=unowned-fixture-bus',
                                         'DBUS_STARTER_ADDRESS': 'unix:abstract=unowned-fixture-starter'}):
                first, second = Fixtures(first_root), Fixtures(second_root)
                self.assertNotIn('DBUS_SESSION_BUS_ADDRESS', first.env)
                self.assertNotIn('DBUS_STARTER_ADDRESS', first.env)
                try:
                    with (root / 'bus.log').open('w') as log:
                        one = start_private_dbus(first, children, log)
                        two = start_private_dbus(second, children, log)
                    self.assertNotEqual(one['pid'], two['pid'])
                    self.assertNotEqual(first.env['DBUS_SESSION_BUS_ADDRESS'], second.env['DBUS_SESSION_BUS_ADDRESS'])
                    identities = []
                    for fixture in (first, second):
                        command = ['dbus-send', '--bus=' + fixture.env['DBUS_SESSION_BUS_ADDRESS'],
                                   '--print-reply', '--type=method_call', '--dest=org.freedesktop.DBus',
                                   '/org/freedesktop/DBus']
                        identity = subprocess.run(command + ['org.freedesktop.DBus.GetId'], env=fixture.env,
                                                  capture_output=True, check=True, timeout=5)
                        identities.append(identity.stdout.decode().split('string "', 1)[1].split('"', 1)[0])
                        denied = subprocess.run(command + ['org.freedesktop.DBus.StartServiceByName',
                                                'string:org.freedesktop.portal.Desktop', 'uint32:0'],
                                                env=fixture.env, capture_output=True, timeout=5)
                        self.assertNotEqual(denied.returncode, 0)
                        self.assertIn(b'ServiceUnknown', denied.stderr)
                    self.assertNotEqual(identities[0], identities[1])
                    self.assertEqual(os.environ['DBUS_SESSION_BUS_ADDRESS'], 'unix:abstract=unowned-fixture-bus')
                finally:
                    for process in reversed(children):
                        stop_owned_process_group(process)
                        process.stdout.close()

    def test_owned_hosting_cli_is_read_only_and_preserves_the_inherited_path(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            original_path = fixtures.env.get("PATH")
            additions = fixtures.hosting_environment("/owned/inherited/bin")
            self.assertEqual(fixtures.env.get("PATH"), original_path)
            self.assertTrue(additions["PATH"].endswith(os.pathsep + "/owned/inherited/bin"))
            command = [str(Path(directory) / "hosting-bin/gh"), "api", "--hostname", "github.com", "--method", "GET", "-H", "Accept: application/vnd.github+json"]
            environment = fixtures.env | additions
            output = subprocess.run(command + ["repos/owned-fixture/native-repo/pulls?state=closed&page=2"], env=environment, capture_output=True, check=True)
            data = json.loads(output.stdout)
            self.assertEqual((data[0]["number"], data[0]["state"]), (2, "closed"))
            for endpoint in ("repos/foreign/repository/pulls", "https://api.github.com/repos/foreign/repository/pulls"):
                refused = subprocess.run(command + [endpoint], env=environment, capture_output=True)
                self.assertNotEqual(refused.returncode, 0)
            command[5] = "POST"
            refused = subprocess.run(command + ["repos/owned-fixture/native-repo/pulls"], env=environment, capture_output=True)
            self.assertNotEqual(refused.returncode, 0)


    def test_owned_hosting_writes_require_opt_in_and_never_forward_foreign_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            environment = fixtures.env | fixtures.hosting_environment()
            config_path = fixtures.hosting_gate / "config.json"
            config = json.loads(config_path.read_text()) | {"allowWrites": True, "actor": "owned-config-account"}
            config_path.write_text(json.dumps(config))
            executable = str(Path(directory) / "hosting-bin/gh")
            environment["GH_TOKEN"] = "owned-token-pinned-account"
            def request(method, endpoint, payload=None):
                command = [executable, "api", "--hostname", "github.com", "--method", method,
                           "-H", "Accept: application/vnd.github+json", endpoint]
                if payload is not None:
                    command += ["--input", "-"]
                return subprocess.run(command, env=environment, input=None if payload is None else json.dumps(payload).encode(), capture_output=True)
            user = request("GET", "user")
            self.assertEqual(json.loads(user.stdout)["login"], "pinned-account")
            payload = {"head": "owned-fixture:feature", "head_repo": "native-repo", "base": "main",
                       "title": "Owned title", "body": "Owned body", "draft": True}
            created = request("POST", "repos/owned-fixture/native-repo/pulls", payload)
            self.assertEqual(created.returncode, 0, created.stderr)
            self.assertEqual(json.loads(created.stdout)["user"]["login"], "pinned-account")
            state_path = fixtures.hosting_gate / "write-state.json"
            before = state_path.read_bytes()
            for method, endpoint in [("POST", "repos/foreign/repository/pulls"),
                                     ("POST", "https://api.github.com/repos/owned-fixture/native-repo/pulls"),
                                     ("DELETE", "repos/owned-fixture/native-repo/pulls/1"),
                                     ("PUT", "repos/owned-fixture/native-repo/issues/1")]:
                refused = request(method, endpoint, payload)
                self.assertNotEqual(refused.returncode, 0)
                self.assertEqual(state_path.read_bytes(), before)
            config["uncertainAfterWrite"] = True
            config_path.write_text(json.dumps(config))
            unknown = request("POST", "repos/owned-fixture/native-repo/pulls/1/reviews",
                              {"commit_id": config["oid"], "event": "COMMENT", "body": "Applied despite lost reply"})
            self.assertNotEqual(unknown.returncode, 0)
            self.assertEqual(len(json.loads(state_path.read_text())["reviews"]), 1)
            config.pop("uncertainAfterWrite")
            config["denyBeforeWrite"] = True
            config_path.write_text(json.dumps(config))
            before = state_path.read_bytes()
            denied = request("POST", "repos/owned-fixture/native-repo/pulls/1/reviews",
                             {"commit_id": config["oid"], "event": "COMMENT", "body": "Denied before application"})
            self.assertNotEqual(denied.returncode, 0)
            self.assertEqual(state_path.read_bytes(), before)
            self.assertNotIn("owned-token-", (fixtures.hosting_gate / "requests.jsonl").read_text())

    @unittest.skipUnless(hasattr(os, "getpgrp"), "requires Unix process groups")
    def test_group_shutdown_never_signals_the_test_runners_group(self):
        with patch("native_acceptance.os.killpg") as sent:
            with self.assertRaisesRegex(RuntimeError, "unowned process group"):
                stop_owned_process_group(SimpleNamespace(pid=os.getpgrp()))
        sent.assert_not_called()

    @unittest.skipUnless(Path("/proc").is_dir() and hasattr(os, "killpg"), "requires Linux process groups")
    def test_owned_group_shutdown_stops_writers_even_after_parent_exit(self):
        for exit_parent in (False, True):
            with self.subTest(exit_parent=exit_parent), tempfile.TemporaryDirectory() as directory:
                ready = Path(directory) / "ready"
                written = Path(directory) / "written"
                child_script = (
                    "import os, signal, sys, time\n"
                    "from pathlib import Path\n"
                    "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                    "Path(sys.argv[1]).write_text(str(os.getpid()))\n"
                    "while True:\n"
                    "    with open(sys.argv[2], 'ab') as output: output.write(b'x')\n"
                    "    time.sleep(0.01)\n"
                )
                parent_script = (
                    "import subprocess, sys, time\n"
                    f"subprocess.Popen([sys.executable, '-c', {child_script!r}, sys.argv[1], sys.argv[2]], "
                    "stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
                    + ("" if exit_parent else "time.sleep(30)\n")
                )
                process = subprocess.Popen(
                    [sys.executable, "-c", parent_script, str(ready), str(written)],
                    start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                try:
                    deadline = time.monotonic() + 5
                    while (not ready.exists() or not ready.read_text().strip() or not written.exists()) and time.monotonic() < deadline:
                        time.sleep(0.01)
                    child = int(ready.read_text())
                    self.assertEqual(os.getpgid(child), process.pid)
                    if exit_parent:
                        process.wait(timeout=5)
                    stop_owned_process_group(process, timeout=0.1)
                    try:
                        state = Path(f"/proc/{child}/stat").read_text().rsplit(")", 1)[1].split()[0]
                    except FileNotFoundError:
                        state = None
                    self.assertIn(state, (None, "Z", "X"), "Owned descendant can still recreate fixture files")
                    size = written.stat().st_size
                    time.sleep(0.03)
                    self.assertEqual(written.stat().st_size, size)
                finally:
                    # Signal only the group exclusively created by this fixture.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=5)

    @unittest.skipUnless(hasattr(os, "killpg"), "requires Unix process groups")
    def test_failed_metadata_gate_can_leave_only_an_owned_inherited_stdout_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            repository = fixtures.repository("failed-metadata", commits=1)
            environment = fixtures.env | fixtures.history_environment()
            gate = fixtures.history_gate
            (gate / "target").write_text(str(repository))
            (gate / "mode").write_text("--get-regexp")
            (gate / "failure").write_text("2")
            (gate / "inherit-stdout").touch()
            command = str(fixtures.root / "history-git-bin/git")
            with subprocess.Popen([command, "-C", str(repository), "config", "--get-regexp", "owned"],
                                  env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  start_new_session=True) as process:
                try:
                    self.assertEqual(process.wait(timeout=5), 2)
                    self.assertTrue((gate / "inherited-pid").read_text().strip().isdigit())
                    self.assertEqual(select.select([process.stdout], [], [], 0)[0], [])
                finally:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.communicate(timeout=5)

    def test_history_gate_delays_only_selected_follow_reads_and_preserves_the_git_oracle(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            repository = fixtures.repository("selected", commits=1)
            other = fixtures.repository("other", commits=1)
            oracle_path = fixtures.env.get("PATH")
            environment = fixtures.env | fixtures.history_environment()
            gate = fixtures.history_gate
            (gate / "target").write_text(str(repository))
            hold = gate / "hold"
            hold.touch()
            command = str(fixtures.root / "history-git-bin/git")
            try:
                for path, args in ((other, ["log", "--follow", "--format=%H", "--", "fixture.txt"]),
                                   (repository, ["rev-parse", "HEAD"])):
                    result = subprocess.run([command, "-C", str(path), *args], env=environment,
                                            capture_output=True, timeout=5)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertFalse((gate / "started").exists())
                with subprocess.Popen([command, "-C", str(repository), "log", "--follow", "--format=%H", "--", "fixture.txt"],
                                      env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
                    try:
                        deadline = time.monotonic() + 5
                        while not (gate / "started").exists() and time.monotonic() < deadline:
                            time.sleep(0.01)
                        self.assertTrue((gate / "started").exists())
                        self.assertIsNone(process.poll())
                    finally:
                        hold.unlink(missing_ok=True)
                    stdout, stderr = process.communicate(timeout=5)
                    self.assertEqual(process.returncode, 0, stderr)
                    self.assertEqual(stdout.decode().strip(), fixtures.git(repository, "rev-parse", "HEAD"))
                self.assertEqual(fixtures.env.get("PATH"), oracle_path)
            finally:
                hold.unlink(missing_ok=True)

    def test_session_creation_uses_tauri_and_existing_session_commands_use_native_endpoint(self):
        driver = Driver("http://127.0.0.1:1", "http://127.0.0.1:2")
        def response(value):
            result = MagicMock()
            result.__enter__.return_value = BytesIO(json.dumps({"value": value}).encode())
            return result
        with patch("native_acceptance.urlopen", side_effect=[
            response({"sessionId": "owned"}), response(None), response(None),
        ]) as request:
            driver.start(Path("/owned/application"))
            driver.close()
        self.assertEqual([call.args[0].full_url for call in request.call_args_list], [
            "http://127.0.0.1:1/session",
            "http://127.0.0.1:2/session/owned/timeouts",
            "http://127.0.0.1:2/session/owned",
        ])

    def test_native_mutation_reply_loss_neither_replays_nor_falls_back_to_proxy(self):
        driver = Driver("http://127.0.0.1:1", "http://127.0.0.1:2")
        with patch("native_acceptance.urlopen", side_effect=RemoteDisconnected("reply lost")) as request:
            with self.assertRaises(RemoteDisconnected):
                driver.request("POST", "/session/owned/element/button/click", {})
        request.assert_called_once()
        self.assertEqual(request.call_args.args[0].full_url, "http://127.0.0.1:2/session/owned/element/button/click")

    def test_visible_click_waits_for_one_visible_element_and_clicks_once(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "visible-button"}
        with patch.object(driver, "wait", return_value=element) as wait, patch.object(driver, "request") as request:
            driver.click_visible(".file-name-button")
            self.assertIn("getClientRects", wait.call_args.args[0])
            self.assertIn("getBoundingClientRect", wait.call_args.args[0])
            self.assertIn("elementFromPoint", wait.call_args.args[0])
            self.assertIn("element.matches(':disabled')", wait.call_args.args[0])
            self.assertIn("matches.length === 1", wait.call_args.args[0])
            request.assert_called_once_with("POST", "/session/owned/element/visible-button/click", {})

    def test_http_failure_response_is_closed_and_preserves_diagnostics(self):
        driver = Driver("http://127.0.0.1:1")
        body = BytesIO(b'element not interactable')
        error = HTTPError("http://127.0.0.1:1/click", 400, "Bad Request", None, body)
        with patch("native_acceptance.urlopen", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, "element not interactable"):
                driver.request("POST", "/session/owned/element/button/click", {})
        self.assertTrue(body.closed)

    def test_text_click_requires_a_unique_match_and_uses_native_element_click(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "button"}
        with patch.object(driver, "script", return_value=[element]) as script, patch.object(driver, "request") as request:
            driver.click_text("button", "Discard captured changes")
            self.assertEqual(script.call_args.args[1:], ("button", "Discard captured changes"))
            request.assert_called_once_with("POST", "/session/owned/element/button/click", {})
        for matches in ([], [element, element]):
            with self.subTest(matches=matches), patch.object(driver, "script", return_value=matches), patch.object(driver, "request") as request:
                with self.assertRaises(ValueError):
                    driver.click_text("button", "Discard captured changes")
                request.assert_not_called()

    def test_key_press_releases_the_same_native_key_without_replay(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        with patch.object(driver, "request") as request:
            driver.key("\ue036")
        request.assert_called_once_with("POST", "/session/owned/actions", {"actions": [{
            "type": "key", "id": "native-keyboard", "actions": [
                {"type": "keyDown", "value": "\ue036"}, {"type": "keyUp", "value": "\ue036"},
            ],
        }]})

    def test_pointer_press_and_release_use_the_same_native_input_source(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        element = {"element-6066-11e4-a52e-4f735466cecf": "outside-button"}
        with patch.object(driver, "request", side_effect=[element, None, None]) as request:
            driver.pointer_down(".outside")
            driver.pointer_up()
        lookup, press, release = request.call_args_list
        self.assertEqual(lookup.args, ("POST", "/session/owned/element", {"using": "css selector", "value": ".outside"}))
        self.assertEqual(press.args[:2], ("POST", "/session/owned/actions"))
        self.assertEqual(release.args[:2], ("POST", "/session/owned/actions"))
        down = press.args[2]["actions"][0]
        up = release.args[2]["actions"][0]
        self.assertEqual(down["id"], up["id"])
        self.assertEqual(down["actions"], [
            {"type": "pointerMove", "origin": element, "x": 0, "y": 0, "duration": 0},
            {"type": "pointerDown", "button": 0},
        ])
        self.assertEqual(up["actions"], [{"type": "pointerUp", "button": 0}])

    def test_start_keeps_incoming_links_as_separate_literal_arguments(self):
        driver = Driver("http://127.0.0.1:1")
        arguments = ['git-khronos://repository?v=1&remote=ssh%3A%2F%2Fowned%40example.test%2Fa',
                     'git-khronos:invalid $(literal)']
        with patch.object(driver, "request", side_effect=[{"sessionId": "owned"}, None]) as request:
            driver.start(Path("/fixture/git-khronos"), args=arguments)
        options = request.call_args_list[0].args[2]["capabilities"]["alwaysMatch"]["tauri:options"]
        self.assertEqual(options["args"], arguments)

    def test_start_does_not_repeat_session_creation_after_a_lost_response(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", side_effect=RemoteDisconnected("reply lost")) as request:
            with self.assertRaises(RemoteDisconnected):
                driver.start(Path("/fixture/git-khronos"))
        self.assertEqual(request.call_count, 1)

    def test_start_retries_only_connections_refused_before_session_creation(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", side_effect=[
            URLError(ConnectionRefusedError("driver not listening yet")),
            {"sessionId": "owned"}, None,
        ]) as request, patch("native_acceptance.time.sleep"):
            driver.start(Path("/fixture/git-khronos"))
        self.assertEqual(driver.session, "owned")
        self.assertEqual(request.call_count, 3)
        self.assertEqual(request.call_args_list[0], request.call_args_list[1])
        self.assertEqual(request.call_args.args[1], "/session/owned/timeouts")

    def test_start_does_not_repeat_session_creation_after_connection_reset(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", side_effect=URLError(ConnectionResetError("ambiguous"))) as request:
            with self.assertRaises(URLError):
                driver.start(Path("/fixture/git-khronos"))
        self.assertEqual(request.call_count, 1)

    def test_failure_evidence_and_driver_shutdown_precede_fixture_cleanup(self):
        self._assert_failed_startup_cleanup(shutdown_fails=False)

    def test_unverified_shutdown_preserves_fixture_and_reports_failure(self):
        self._assert_failed_startup_cleanup(shutdown_fails=True)

    def _assert_failed_startup_cleanup(self, shutdown_fails):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "Git-Khronos_0.1.0_amd64.deb"
            package.write_bytes(b"package fixture")
            fixture = root / "fixture"
            executable = fixture / "package/usr/bin/git-khronos"
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b"executable fixture")
            cleaned = False

            def cleanup(*_args):
                nonlocal cleaned
                cleaned = True

            scratch = MagicMock()
            scratch.name = str(fixture)
            scratch.__enter__.return_value = str(fixture)
            scratch.__exit__.side_effect = cleanup
            scratch.cleanup.side_effect = cleanup
            observed = []

            def stop(_process):
                observed.append(("stop", cleaned))
                if shutdown_fails:
                    raise TimeoutError("owned writer did not stop")

            driver = MagicMock()
            driver.session = "owned"
            driver.start.side_effect = RuntimeError("fixture startup failure")
            driver.screenshot.side_effect = lambda _path: observed.append(("screenshot", cleaned))
            driver.close.side_effect = lambda: observed.append(("close", cleaned))
            process = MagicMock()
            process.poll.return_value = 0
            bus = MagicMock()
            bus.stdout = None
            def private_bus(_fixtures, children, _log):
                children.append(bus)
                return {'pid': 123, 'private': True, 'hostServiceActivation': False}
            args = SimpleNamespace(package=package, output=root / "evidence", suite="smoke", headless=False)
            with ExitStack() as mocks:
                for target, value in {
                    "native_acceptance.argparse.ArgumentParser.parse_args": args,
                    "native_acceptance.tempfile.TemporaryDirectory": scratch,
                    "native_acceptance.Fixtures": SimpleNamespace(root=fixture, env={}),
                    "native_acceptance.Driver": driver,
                    "native_acceptance.subprocess.Popen": process,
                    "native_acceptance.shutil.which": "/fixture/tool",
                    "native_acceptance.port": 12345,
                    "native_acceptance.platform.platform": "fixture-platform",
                }.items():
                    mocks.enter_context(patch(target, return_value=value))
                mocks.enter_context(patch("native_acceptance.run", side_effect=lambda *command: {
                    "Package": "git-khronos", "Architecture": "amd64",
                }.get(command[-1], "fixture")))
                mocks.enter_context(patch("native_acceptance.start_private_dbus", side_effect=private_bus))
                mocks.enter_context(patch("builtins.print"))
                shutdown = mocks.enter_context(patch("native_acceptance.stop_owned_process_group",
                                                    side_effect=stop))
                self.assertEqual(main(), 1)
            self.assertEqual(observed, [("screenshot", False), ("close", False), ("stop", False), ("stop", False)])
            self.assertEqual(shutdown.call_args_list, [call(process), call(bus)])
            evidence = json.loads(next((root / "evidence").glob("*/report.json")).read_text())
            self.assertFalse(evidence["passed"])
            if shutdown_fails:
                scratch.cleanup.assert_not_called()
                scratch._finalizer.detach.assert_called_once()
                self.assertFalse(cleaned)
                self.assertEqual(evidence["retainedFixture"], str(fixture))
                self.assertIn("owned writer did not stop", evidence["processShutdownFailures"][0])
                self.assertTrue(executable.is_file())
            else:
                scratch.cleanup.assert_called_once()
                scratch._finalizer.detach.assert_not_called()
                self.assertTrue(cleaned)

    def test_reload_waits_for_a_new_document_without_repeating_navigation(self):
        driver = Driver("http://127.0.0.1:1")
        driver.session = "owned"
        with patch.object(driver, "script", side_effect=[123, False, True]) as script, \
                patch.object(driver, "request") as request, patch("native_acceptance.time.sleep"):
            driver.reload()
        request.assert_called_once_with("POST", "/session/owned/refresh", {})
        self.assertEqual(script.call_count, 3)
        self.assertIn("performance.timeOrigin !== 123", script.call_args.args[0])

    def test_read_only_wait_tolerates_document_replacement_disconnects(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "script", side_effect=[RemoteDisconnected("reloading"), True]) as script, \
                patch("native_acceptance.time.sleep"):
            self.assertTrue(driver.wait("return document.readyState === 'complete'"))
        self.assertEqual(script.call_count, 2)

    def test_terminal_startup_does_not_inherit_personal_home_or_shell_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "fixture"
            root.mkdir()
            with patch.dict(os.environ, {"HOME": str(Path(directory) / "personal"),
                                         "SHELL": "/personal/shell", "ENV": "/personal/rc",
                                         "BASH_ENV": "/personal/bashrc"}):
                fixtures = Fixtures(root)
            self.assertTrue(Path(fixtures.env["HOME"]).is_relative_to(root))
            self.assertTrue(Path(fixtures.env["HOME"]).is_dir())
            self.assertEqual(fixtures.env["SHELL"], "/bin/sh")
            self.assertNotIn("ENV", fixtures.env)
            self.assertNotIn("BASH_ENV", fixtures.env)

    def test_terminal_launcher_records_the_same_pid_and_preserves_the_disposable_home(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "fixture with spaces"
            root.mkdir()
            fixtures = Fixtures(root)
            environment = {**fixtures.env, **fixtures.terminal_environment()}
            process = subprocess.Popen([environment["SHELL"], "-c", 'printf "%s" "$HOME"'],
                                       env=environment, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                output, error = process.communicate(timeout=5)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            self.assertEqual(process.returncode, 0, error)
            self.assertEqual(output.decode(), fixtures.env["HOME"])
            self.assertEqual(fixtures.terminal_pids.read_text(), f"{process.pid}\n")
            self.assertEqual(Path(environment["SHELL"]).stat().st_mode & 0o777, 0o700)

    def test_read_only_element_lookup_retries_a_transient_driver_disconnect(self):
        driver = Driver("http://127.0.0.1:1")
        with patch("native_acceptance.urlopen", side_effect=[RemoteDisconnected("refreshing"), MagicMock()]) as request, \
                patch("native_acceptance.json.load", return_value={"value": {"element": "owned"}}), \
                patch("native_acceptance.time.sleep"):
            self.assertEqual(driver.request("POST", "/session/owned/element", {"value": ".wip-nav"}), {"element": "owned"})
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[0].kwargs["timeout"], 90)
        self.assertLessEqual(request.call_args_list[1].kwargs["timeout"], 2)

    def test_mutating_driver_requests_are_never_retried(self):
        driver = Driver("http://127.0.0.1:1")
        for path in ("/session/owned/element/button/click", "/session/owned/execute/async", "/session/owned/refresh"):
            with self.subTest(path=path), patch("native_acceptance.urlopen", side_effect=RemoteDisconnected("lost reply")) as request:
                with self.assertRaises(RemoteDisconnected):
                    driver.request("POST", path, {})
                self.assertEqual(request.call_count, 1)

    def test_read_only_retries_stop_at_the_deadline(self):
        driver = Driver("http://127.0.0.1:1")
        with patch("native_acceptance.urlopen", side_effect=RemoteDisconnected("unavailable")) as request, \
                patch("native_acceptance.time.monotonic", side_effect=[0, 0, 3]), \
                patch("native_acceptance.time.sleep"):
            with self.assertRaises(RemoteDisconnected):
                driver.request("GET", "/status")
        self.assertEqual(request.call_count, 2)

    def test_subprocess_failures_retain_bounded_diagnostics(self):
        with self.assertRaisesRegex(RuntimeError, "fixture failure"):
            run("sh", "-c", "printf 'fixture failure' >&2; exit 7")

    def test_repositories_are_deterministic_and_host_configuration_is_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = Fixtures(directory)
            first = fixtures.repository("first", 12)
            second = fixtures.repository("second", 12)
            self.assertEqual(fixtures.git(first, "rev-parse", "HEAD"), fixtures.git(second, "rev-parse", "HEAD"))
            self.assertEqual(fixtures.git(first, "rev-list", "--count", "HEAD"), "12")
            self.assertEqual(fixtures.git(first, "status", "--porcelain"), "")
            self.assertEqual(fixtures.env["GIT_CONFIG_NOSYSTEM"], "1")
            self.assertTrue(Path(fixtures.env["GIT_CONFIG_GLOBAL"]).is_relative_to(directory))
            self.assertEqual(fixtures.git(first, "config", "user.email"), "native@example.test")

    def test_native_failures_remain_failures(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", return_value={"ok": False, "error": {"kind": "operationCancelled"}}):
            with self.assertRaisesRegex(RuntimeError, "operationCancelled"):
                driver.invoke("fetch_repository", repoId="owned")

    def test_void_native_results_are_allowed(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", return_value={"ok": True, "value": None}):
            self.assertIsNone(driver.invoke("close_terminal", sessionId="owned"))

    def test_session_start_stops_retrying_when_the_driver_never_listens(self):
        driver = Driver("http://127.0.0.1:1")
        with patch.object(driver, "request", side_effect=URLError(ConnectionRefusedError("not listening"))) as request, \
                patch("native_acceptance.time.monotonic", side_effect=[0, 6]):
            with self.assertRaises(URLError):
                driver.start(Path("/owned/application"))
        self.assertIsNone(driver.session)
        request.assert_called_once()


if __name__ == "__main__":
    unittest.main()
