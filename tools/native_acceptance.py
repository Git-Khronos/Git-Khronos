#!/usr/bin/env python3
"""Exercise an extracted production .deb with W3C WebDriver; no app test hooks.

Requires tauri-driver, WebKitWebDriver, and (with --headless) Xvfb. Tests own
all repositories/storage under TemporaryDirectory; never install the package.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import select
import signal
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from http.client import RemoteDisconnected
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent


def stop_owned_process_group(process, timeout=10):
    """Stop a Popen started with start_new_session, including surviving writers."""
    group = process.pid
    if group <= 1 or group == os.getpgrp():
        raise RuntimeError("Refusing to signal an unowned process group")
    try:
        if os.getpgid(group) != group:
            raise RuntimeError("Acceptance child does not own its process group")
    except ProcessLookupError:
        # The leader may already be reaped while its descendants keep writing.
        pass

    def running():
        for stat in Path("/proc").glob("[0-9]*/stat"):
            try:
                fields = stat.read_text().rsplit(")", 1)[1].split()
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
            if int(fields[2]) == group and fields[0] not in ("Z", "X"):
                return True
        return False

    for sent in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(group, sent)
        except ProcessLookupError:
            break
        deadline = time.monotonic() + timeout
        while running() and time.monotonic() < deadline:
            time.sleep(0.01)
        if not running():
            break
    else:
        raise TimeoutError("Owned acceptance descendants did not stop; fixtures must be retained")
    process.wait(timeout=timeout)


def run(*args, env=None, input=None):
    result = subprocess.run(args, env=env, input=input, capture_output=True, timeout=120)
    if result.returncode:
        details = result.stderr.decode(errors="replace").strip()[-4_000:]
        raise RuntimeError(f"{args[0]} exited {result.returncode}: {details}")
    return result.stdout.decode().strip()


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Driver:
    def __init__(self, address, native_address=None):
        self.address = address
        self.native_address = native_address
        self.session = None

    def request(self, method, path, payload=None):
        # Tauri translates session creation capabilities. Once created, use the
        # same native session directly, without the intermediary's HTTP pool.
        # Never fall back or replay a mutation if either endpoint loses a reply.
        address = self.native_address if self.native_address and path.startswith("/session/") else self.address
        request = Request(address + path, method=method,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json"})
        # Element lookup is POST in WebDriver, but is read-only. Never retry
        # clicks, navigation, or script execution after an ambiguous reply.
        read_only = method == "GET" or (method == "POST" and path.endswith(("/element", "/elements")))
        deadline = time.monotonic() + 2
        request_timeout = 90
        while True:
            try:
                with urlopen(request, timeout=request_timeout) as response:
                    value = json.load(response)["value"]
                break
            except HTTPError as error:
                with error:
                    detail = error.read().decode()
                raise RuntimeError(detail) from error
            except (RemoteDisconnected, URLError, ConnectionError):
                remaining = deadline - time.monotonic()
                if not read_only or remaining <= 0:
                    raise
                delay = min(0.1, remaining)
                time.sleep(delay)
                request_timeout = max(0.001, remaining - delay)
        if isinstance(value, dict) and isinstance(value.get("error"), str):
            raise RuntimeError(json.dumps(value))
        return value

    def start(self, executable):
        payload = {"capabilities": {"alwaysMatch": {
            "tauri:options": {"application": str(executable)}, "pageLoadStrategy": "normal"
        }}}
        deadline = time.monotonic() + 5
        while True:
            try:
                value = self.request("POST", "/session", payload)
                break
            except URLError as error:
                # Only a refused connection proves session creation never ran.
                # A lost response may already have launched an application;
                # retrying it would create an unowned second session.
                if not isinstance(error.reason, ConnectionRefusedError) or time.monotonic() >= deadline:
                    raise
                time.sleep(0.2)
        self.session = value["sessionId"]
        self.request("POST", self.path("timeouts"), {"script": 60000, "pageLoad": 60000, "implicit": 0})

    def path(self, suffix):
        return f"/session/{self.session}/{suffix}"

    def script(self, script, *args):
        return self.request("POST", self.path("execute/sync"), {"script": script, "args": args})

    def invoke(self, command, **args):
        result = self.request("POST", self.path("execute/async"), {"script": """
          const done = arguments[arguments.length - 1];
          window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])
            .then(value => done({ok: true, value}), error => done({ok: false, error}));
        """, "args": [command, args]})
        if not result["ok"]:
            raise RuntimeError(json.dumps(result["error"]))
        return result.get("value")

    def wait(self, script, timeout=30):
        """Poll a read-only predicate, including during document replacement."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                value = self.script(script)
            except (RemoteDisconnected, URLError, ConnectionError):
                time.sleep(0.1)
                continue
            if value:
                return value
            time.sleep(0.1)
        raise TimeoutError(f"UI condition did not become true: {script}")

    def reload(self):
        origin = self.script("return performance.timeOrigin")
        self.request("POST", self.path("refresh"), {})
        # A successful selector query can still belong to the outgoing page.
        # Wait for a fresh document before inspecting restored application state.
        self.wait(f"return performance.timeOrigin !== {json.dumps(origin)} && document.readyState === 'complete'", 60)

    def click(self, selector):
        element = self.request("POST", self.path("element"), {"using": "css selector", "value": selector})
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        self.request("POST", self.path(f"element/{identifier}/click"), {})

    def click_text(self, selector, text):
        elements = self.script("return [...document.querySelectorAll(arguments[0])].filter(element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible' && element.textContent.trim() === arguments[1]);", selector, text)
        if len(elements) != 1:
            raise ValueError(f"Expected one {selector!r} with text {text!r}, found {len(elements)}")
        identifier = elements[0]["element-6066-11e4-a52e-4f735466cecf"]
        self.request("POST", self.path(f"element/{identifier}/click"), {})

    def click_visible(self, selector):
        element = self.wait(f"""return (() => {{
          const matches = [...document.querySelectorAll({json.dumps(selector)})]
            .filter(element => {{
              if (!element.getClientRects().length || getComputedStyle(element).visibility !== 'visible'
                || element.matches(':disabled') || element.closest('[inert]')) return false;
              const rect = element.getBoundingClientRect();
              const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
              const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
              if (right <= left || bottom <= top) return false;
              return element.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
            }});
          return matches.length === 1 ? matches[0] : null;
        }})()""")
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        self.request("POST", self.path(f"element/{identifier}/click"), {})

    def pointer_down(self, selector):
        element = self.request("POST", self.path("element"), {"using": "css selector", "value": selector})
        self.request("POST", self.path("actions"), {"actions": [{
            "type": "pointer", "id": "native-mouse", "parameters": {"pointerType": "mouse"},
            "actions": [{"type": "pointerMove", "origin": element, "x": 0, "y": 0, "duration": 0},
                        {"type": "pointerDown", "button": 0}],
        }]})

    def pointer_up(self):
        self.request("POST", self.path("actions"), {"actions": [{
            "type": "pointer", "id": "native-mouse", "parameters": {"pointerType": "mouse"},
            "actions": [{"type": "pointerUp", "button": 0}],
        }]})

    def key(self, value):
        self.request("POST", self.path("actions"), {"actions": [{
            "type": "key", "id": "native-keyboard",
            "actions": [{"type": "keyDown", "value": value}, {"type": "keyUp", "value": value}],
        }]})

    def screenshot(self, path):
        path.write_bytes(base64.b64decode(self.request("GET", self.path("screenshot"))))

    def close(self):
        if self.session:
            self.request("DELETE", f"/session/{self.session}")


class Fixtures:
    def __init__(self, directory):
        self.root = Path(directory)
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith("GIT_") and key not in ("SSH_AUTH_SOCK", "SSH_AGENT_PID", "ENV", "BASH_ENV")}
        home = self.root / "home"
        home.mkdir(mode=0o700)
        self.env.update(HOME=str(home), SHELL="/bin/sh")
        config = self.root / "gitconfig"
        config.write_text('[user]\nname = Native Fixture\nemail = native@example.test\n'
                          '[init]\ndefaultBranch = main\n[commit]\ngpgsign = false\n'
                          '[credential]\nhelper =\n[protocol "file"]\nallow = always\n')
        self.env.update(GIT_CONFIG_GLOBAL=str(config), GIT_CONFIG_NOSYSTEM="1",
                        GIT_TERMINAL_PROMPT="0", GIT_AUTHOR_DATE="2026-01-01T00:00:00Z",
                        GIT_COMMITTER_DATE="2026-01-01T00:00:00Z", GIT_LFS_SKIP_SMUDGE="1")
        for key in ("XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "GNUPGHOME"):
            location = self.root / key.lower()
            location.mkdir(mode=0o700)
            self.env[key] = str(location)

    def hosting_environment(self, inherited_path=None):
        directory = self.root / "hosting-bin"
        directory.mkdir(mode=0o700)
        self.hosting_gate = self.root / "hosting-gate"
        self.hosting_gate.mkdir(mode=0o700)
        (self.hosting_gate / "config.json").write_text(json.dumps({
            "repository": "owned-fixture/native-repo", "oid": "a" * 40,
        }))
        wrapper = directory / "gh"
        wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(sys.executable) + " "
                           + shlex.quote(str(ROOT / "tools/native_hosting_fixture.py")) + ' "$@"\n')
        wrapper.chmod(0o700)
        return {"PATH": str(directory) + os.pathsep + (inherited_path or self.env.get("PATH", os.defpath)),
                "KHRONOS_NATIVE_HOSTING_GATE": str(self.hosting_gate)}

    def terminal_environment(self):
        self.terminal_pids = self.root / "terminal-pids"
        launcher = self.root / "terminal-shell"
        launcher.write_text("#!/bin/sh\n"
                            "printf '%s\\n' \"$$\" >> \"$GIT_KHRONOS_ACCEPTANCE_TERMINAL_PIDS\" || exit 1\n"
                            "exec /bin/sh \"$@\"\n")
        launcher.chmod(0o700)
        return {"SHELL": str(launcher),
                "GIT_KHRONOS_ACCEPTANCE_TERMINAL_PIDS": str(self.terminal_pids)}

    def history_environment(self):
        # The app alone receives this shim; independent Git oracles keep self.env.
        directory = self.root / "history-git-bin"
        directory.mkdir(mode=0o700)
        self.history_gate = self.root / "history-gate"
        self.history_gate.mkdir(mode=0o700)
        real_git = shutil.which("git", path=self.env.get("PATH"))
        if real_git is None:
            raise RuntimeError("Git is required for native history acceptance")
        wrapper = directory / "git"
        wrapper.write_text("#!/bin/sh\n"
                           'gate="$GIT_KHRONOS_ACCEPTANCE_HISTORY_GATE"\n'
                           'mode=--follow\n'
                           'if [ -f "$gate/mode" ]; then mode=$(cat "$gate/mode"); fi\n'
                           'if [ "$1" = "-C" ] && [ -f "$gate/target" ] && [ "$2" = "$(cat "$gate/target")" ]; then\n'
                           '  for argument in "$@"; do\n'
                           '    if [ "$argument" = "$mode" ]; then\n'
                           '      printf \'%s\\n\' "$$" > "$gate/started"\n'
                           '      while [ -f "$gate/hold" ]; do sleep 0.02; done\n'
                           '      if [ -f "$gate/failure" ]; then\n'
                           '        if [ -f "$gate/inherit-stdout" ]; then\n'
                           '          sleep 30 &\n'
                           '          printf \'%s\\n\' "$!" > "$gate/inherited-pid"\n'
                           '        fi\n'
                           '        exit "$(cat "$gate/failure")"\n'
                           '      fi\n'
                           '      break\n'
                           '    fi\n'
                           '  done\n'
                           'fi\n'
                           f'exec {shlex.quote(real_git)} "$@"\n')
        wrapper.chmod(0o700)
        return {"PATH": str(directory) + os.pathsep + self.env.get("PATH", os.defpath),
                "GIT_KHRONOS_ACCEPTANCE_HISTORY_GATE": str(self.history_gate)}

    def git(self, repository, *args, input=None):
        return run("git", "-C", str(repository), *args, env=self.env, input=input)

    def repository(self, name="repository", commits=12):
        repository = self.root / name
        repository.mkdir()
        self.git(repository, "init", "-q", "-b", "main")
        # Fast-import makes even 100k histories deterministic and inexpensive.
        data = []
        for index in range(commits):
            message = f"Native commit {index:06d}"
            content = f"fixture {index}\n"
            data.append(f"commit refs/heads/main\nmark :{index + 1}\n"
                        f"committer Native Fixture <native@example.test> 1767225600 +0000\n"
                        f"data {len(message)}\n{message}\n"
                        + (f"from :{index}\n" if index else "")
                        + f"M 100644 inline fixture.txt\ndata {len(content)}\n{content}\n")
        self.git(repository, "fast-import", "--quiet", input="".join(data).encode())
        self.git(repository, "reset", "--hard", "-q", "HEAD")
        return repository


RENDER_PROBE = """return (() => {
  const list = document.querySelector('.commit-list');
  const rows = [...document.querySelectorAll('.commit-row[data-commit-oid]')];
  const box = list?.getBoundingClientRect();
  return { workspace: getComputedStyle(document.querySelector('.workspace')).display,
    rows: rows.length, ids: rows.map(row => row.dataset.commitOid),
    absolute: rows.every(row => getComputedStyle(row).position === 'absolute'),
    bounded: !!box && box.height > 0 && box.bottom <= innerHeight + 1,
    blocked: [...document.querySelectorAll('style')].filter(style => !style.sheet).length,
    missingNonce: [...document.querySelectorAll('style')].filter(style => !style.nonce).length };
})()"""


def open_ui(driver, repository):
    # Bootstrap via existing persisted tabs, then exercise the real renderer.
    # No Angular debug API, injected component state, or production test endpoint.
    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.open-repositories.v1', JSON.stringify([arguments[0]]));
      localStorage.setItem('git-khronos.active-repository.v1', arguments[0]);
    """, str(repository))
    driver.reload()
    driver.wait("return document.querySelectorAll('.commit-row[data-commit-oid]').length > 0", 60)
    return driver.invoke("open_repository", path=str(repository))["id"]


def menu_tab_focus(driver, report):
    for toggle, menu in ((".workspace-toggle", ".workspace-menu"), (".app-menu", ".app-menu-popover")):
        driver.script("document.querySelector(arguments[0]).focus()", toggle)
        driver.key("\ue004")
        assert driver.script("return document.activeElement !== document.body"), "No native Tab destination after menu opener"
        driver.script("document.activeElement.setAttribute('data-native-menu-tab-target', '')")
        try:
            driver.click(toggle)
            driver.wait(f"return document.querySelector({json.dumps(menu)})?.contains(document.activeElement)")
            driver.key("\ue004")
            driver.wait(f"return !document.querySelector({json.dumps(menu)})", 2)
            assert driver.script("return document.activeElement?.hasAttribute('data-native-menu-tab-target')"), \
                f"Tab from {menu} did not resume the normal focus order"
        finally:
            driver.script("document.querySelectorAll('[data-native-menu-tab-target]').forEach(element => element.removeAttribute('data-native-menu-tab-target'))")
    report["scenarios"].append("native-menu-tab-dismissal-preserves-sequential-focus")


def smoke(driver, fixtures, report):
    repository = fixtures.repository()
    repo_id = open_ui(driver, repository)
    probe = driver.script(RENDER_PROBE)
    assert probe["workspace"] == "grid" and probe["absolute"] and probe["bounded"], probe
    assert 0 < probe["rows"] < 100 and not probe["blocked"] and not probe["missingNonce"], probe
    driver.click('.commit-row[data-commit-oid]')
    driver.wait("return !!document.querySelector('.commit-row.selected')")
    driver.click('[aria-label="Preferences"]')
    driver.wait("return !!document.querySelector('gc-preferences-dialog [role=dialog]')")
    assert not driver.script(RENDER_PROBE)["blocked"], "Lazy styles blocked by CSP"
    driver.reload()
    driver.wait("return !!document.querySelector('.commit-row[data-commit-oid]')")
    snapshot = driver.invoke("refresh_repository", repoId=repo_id)
    assert snapshot["path"] == str(repository) and len(snapshot["commits"]) == 12
    report["render"] = probe
    report["scenarios"].extend(["production-csp", "graph-layout", "commit-selection", "lazy-preferences", "restart-tab-restore", "native-snapshot"])
    driver.click('.workspace-toggle')
    driver.wait("return !!document.querySelector('.workspace-menu')")
    driver.pointer_down('[aria-label="Hide Left Panel"]')
    try:
        # Keep the mouse held: dismissal cannot rely on the later click event.
        driver.wait("return !document.querySelector('.workspace-menu')", 2)
    finally:
        driver.pointer_up()
    driver.wait('return !!document.querySelector(\'[aria-label="Show Left Panel"]\')')
    driver.click('[aria-label="Show Left Panel"]')
    report["scenarios"].append("native-workspace-outside-pointer-dismissal")
    menu_tab_focus(driver, report)
    # Exercise asynchronous filesystem discovery through the real UI, without
    # manually refreshing it or replacing renderer state with IPC results.
    driver.click('.wip-nav')
    untracked = repository / "native-untracked.txt"
    untracked.write_text("discovered by the native status refresh\n")
    driver.wait('return !!document.querySelector(\'[aria-label="Stage native-untracked.txt"]\')')
    driver.wait('return !!document.querySelector(\'[aria-label="Stage all changes"]:not(:disabled)\')')
    untracked.unlink()
    driver.wait('return !document.querySelector(\'[aria-label="Stage native-untracked.txt"]\')')
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].append("native-untracked-file-discovery-and-removal")
    # Branch changes outside the app must not discard untracked discovery while
    # the renderer reconciles the new HEAD's metadata.
    fixtures.git(repository, "checkout", "-q", "-b", "native-status-probe")
    untracked.write_text("untracked after an external checkout\n")
    driver.wait('return !!document.querySelector(\'[aria-label^="Switch branch, current native-status-probe"]\')')
    driver.wait('return !!document.querySelector(\'[aria-label="Stage native-untracked.txt"]\')')
    driver.wait('return !!document.querySelector(\'[aria-label="Stage all changes"]:not(:disabled)\')')
    untracked.unlink()
    fixtures.git(repository, "checkout", "-q", "main")
    fixtures.git(repository, "branch", "-D", "native-status-probe")
    driver.wait('return !!document.querySelector(\'[aria-label^="Switch branch, current main"]\')')
    driver.wait('return !document.querySelector(\'[aria-label="Stage native-untracked.txt"]\')')
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].append("native-external-checkout-and-untracked-discovery")
    return repository, repo_id


def performance(driver, fixtures, report):
    report["performance"] = []
    for count in (20_000, 100_000):
        repository = fixtures.repository(f"history-{count}", count)
        for index in range(64):
            fixtures.git(repository, "branch", f"fixture-{index:02d}", f"HEAD~{index}")
        for index in range(36):
            fixtures.git(repository, "worktree", "add", "--detach", "-q", str(fixtures.root / f"linked-{count}-{index}"), f"HEAD~{index}")
        start = time.monotonic()
        repo_id = open_ui(driver, repository)
        loaded_ms = (time.monotonic() - start) * 1000
        driver.script("window.__nativeHeartbeat = {last: performance.now(), max: 0}; window.__nativeTimer = setInterval(() => { const h = window.__nativeHeartbeat; const now = performance.now(); h.max = Math.max(h.max, now - h.last); h.last = now; }, 50);")
        probes = []
        for offset in (400, 1600, 3200, 0, 2000, 0):
            driver.script("document.querySelector('.commit-list').scrollTop = arguments[0]", offset)
            time.sleep(0.15)
            probe = driver.script(RENDER_PROBE)
            assert 0 < probe["rows"] < 100 and probe["absolute"] and probe["bounded"], probe
            assert len(set(probe["ids"])) == probe["rows"], probe
            probes.append(probe)
        driver.invoke("load_more_commits", repoId=repo_id)
        maximum = driver.script("clearInterval(window.__nativeTimer); return window.__nativeHeartbeat.max")
        assert maximum < 2000, f"UI heartbeat stalled {maximum}ms"
        report["performance"].append({"commits": count, "branches": 64, "linkedWorktrees": 36,
                                      "openMs": loaded_ms, "maxHeartbeatGapMs": maximum,
                                      "maxRenderedRows": max(probe["rows"] for probe in probes)})
    report["scenarios"].append("large-history-responsiveness")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=ROOT / "target/release/bundle/deb/Git-Khronos_0.1.0_amd64.deb")
    parser.add_argument("--suite", choices=("smoke", "full", "environment", "performance"), default="smoke")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "test-results/native")
    args = parser.parse_args()
    output = args.output.resolve() / f"{args.suite}-{time.time_ns()}"
    output.mkdir(parents=True)
    report = {"suite": args.suite, "scenarios": [], "passed": False,
              "platform": platform.platform(), "git": run("git", "--version"), "artifactsDirectory": str(output)}
    children = []
    driver = None
    temporary_directory = None
    try:
        for name in ("tauri-driver", "WebKitWebDriver", "dpkg-deb") + (("Xvfb",) if args.headless else ()):
            if not shutil.which(name):
                raise RuntimeError(f"Missing {name}. See docs/linux-acceptance.md; no tests were skipped.")
        package = args.package.resolve(strict=True)
        assert package.name == "Git-Khronos_0.1.0_amd64.deb", package.name
        assert run("dpkg-deb", "-f", str(package), "Package") == "git-khronos"
        assert run("dpkg-deb", "-f", str(package), "Architecture") == "amd64"
        report["package"] = str(package)
        with package.open("rb") as package_data:
            report["packageSha256"] = hashlib.file_digest(package_data, "sha256").hexdigest()
        temporary_directory = tempfile.TemporaryDirectory(prefix="git-khronos-native-")
        fixtures = Fixtures(temporary_directory.name)
        outside = None
        if args.suite == "environment":
            outside = fixtures.repository("inherited-environment-outside", 1)
            (outside / ".gitattributes").write_text("* -diff\n")
            fixtures.git(outside, "add", ".gitattributes")
            fixtures.git(outside, "commit", "-qm", "Conflicting outside attributes")
            (outside / "fixture.txt").write_bytes(b"unselected outside contents\n")
            outside_index = (outside / ".git/index").read_bytes()
            outside_head = fixtures.git(outside, "rev-parse", "HEAD")
        extracted = fixtures.root / "package"
        run("dpkg-deb", "-x", str(package), str(extracted))
        executable = extracted / "usr/bin/git-khronos"
        with executable.open("rb") as executable_data:
            report["executableSha256"] = hashlib.file_digest(executable_data, "sha256").hexdigest()
        fixtures.env["TAURI_WEBVIEW_AUTOMATION"] = "true"
        with (output / "driver.log").open("w") as log:
            if args.headless:
                display = subprocess.Popen(["Xvfb", "-displayfd", "1", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
                                           env=fixtures.env, stdout=subprocess.PIPE, stderr=log, start_new_session=True)
                children.append(display)
                if not select.select([display.stdout], [], [], 15)[0]:
                    raise TimeoutError("Xvfb did not allocate a display")
                number = display.stdout.readline().decode().strip()
                if not number.isdecimal():
                    raise RuntimeError("Xvfb failed; see driver.log")
                fixtures.env["DISPLAY"] = ":" + number
                fixtures.env["GDK_BACKEND"] = "x11"
            listen_port = port()
            native_port = port()
            application_env = fixtures.env.copy()
            if args.suite in ("full", "environment"):
                application_env.update(fixtures.terminal_environment())
                application_env.update(fixtures.history_environment())
                application_env.update(fixtures.hosting_environment(application_env.get("PATH")))
            if outside is not None:
                application_env.update({
                    "GIT_DIR": str(outside / ".git"),
                    "GIT_COMMON_DIR": str(outside / ".git"),
                    "GIT_WORK_TREE": str(outside),
                    "GIT_INDEX_FILE": str(outside / ".git/index"),
                    "GIT_LITERAL_PATHSPECS": "1", "GIT_GLOB_PATHSPECS": "1",
                    "GIT_NOGLOB_PATHSPECS": "1", "GIT_ICASE_PATHSPECS": "1",
                })
            process = subprocess.Popen(["tauri-driver", "--port", str(listen_port), "--native-port", str(native_port)],
                                       env=application_env, stdout=log, stderr=log, start_new_session=True)
            children.append(process)
            driver = Driver(f"http://127.0.0.1:{listen_port}", f"http://127.0.0.1:{native_port}")
            report["webdriverTransport"] = "tauri-session-creation-native-session-control"
            deadline = time.monotonic() + 20
            while True:
                try:
                    driver.request("GET", "/status")
                    break
                except (URLError, OSError):
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError("tauri-driver failed to start; see driver.log")
                    time.sleep(0.1)
            driver.start(executable)
            repository, repo_id = smoke(driver, fixtures, report)
            if args.suite in ("full", "environment"):
                from native_scenarios import full_toolkit
                full_toolkit(driver, fixtures, repository, repo_id, report)
            if outside is not None:
                assert (outside / ".git/index").read_bytes() == outside_index
                assert fixtures.git(outside, "rev-parse", "HEAD") == outside_head
                assert (outside / "fixture.txt").read_bytes() == b"unselected outside contents\n"
                report["scenarios"].append("native-inherited-git-environment-cannot-redirect-repositories-or-paths")
            if args.suite == "performance":
                performance(driver, fixtures, report)
            driver.screenshot(output / "desktop.png")
            report["passed"] = True
    except Exception:
        report["failure"] = traceback.format_exc()
        if driver and driver.session:
            try:
                driver.screenshot(output / "failure.png")
            except Exception:
                pass
    finally:
        if driver:
            try:
                driver.close()
            except Exception:
                pass
        shutdown_failed = False
        for process in reversed(children):
            try:
                stop_owned_process_group(process)
            except Exception:
                shutdown_failed = True
                report["passed"] = False
                report.setdefault("processShutdownFailures", []).append(traceback.format_exc())
            if process.stdout is not None:
                process.stdout.close()
        if temporary_directory is not None and shutdown_failed:
            # TemporaryDirectory has no public cancel-cleanup operation. Detach
            # its finalizer so a failed shutdown cannot race implicit deletion.
            temporary_directory._finalizer.detach()
            report["retainedFixture"] = temporary_directory.name
        elif temporary_directory is not None:
            try:
                temporary_directory.cleanup()
            except Exception:
                report["passed"] = False
                report["cleanupFailure"] = traceback.format_exc()
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    print(f"Evidence: {output}", flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
