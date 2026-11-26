#!/usr/bin/env python3
"""Exercise an extracted production .deb with W3C WebDriver; no app test hooks.

Requires tauri-driver, WebKitWebDriver, and (with --headless) Xvfb and libXtst.
Tests own all repositories/storage under TemporaryDirectory; never install the package.
"""
import argparse
import base64
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import select
import secrets
import signal
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import traceback
import uuid
from native_progress import ScenarioProgress, write_native_receipt
from xml.sax.saxutils import quoteattr
from http.client import RemoteDisconnected
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from native_webdriver_errors import script_result_unavailable, stale_element_refusal


ROOT = Path(__file__).resolve().parent.parent


def linux_distribution():
    """Identify userspace separately from the shared host/container kernel."""
    try:
        release = platform.freedesktop_os_release()
    except OSError:
        return None
    identifier = release.get("ID")
    return {"id": identifier, "versionId": release.get("VERSION_ID")} if identifier else None


def expected_debian_package():
    version = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text())["version"]
    if not isinstance(version, str) or not version:
        raise ValueError("The Tauri package version must be a nonempty string")
    return version, f"Git-Khronos_{version}_amd64.deb"


def default_debian_archive(filename):
    # Match the package manager helper: relative Cargo targets are relative
    # to the caller, while the default target follows the workspace.
    configured = os.environ.get("CARGO_TARGET_DIR")
    target = Path.cwd() / configured if configured else ROOT / "target"
    return target / "release/bundle/deb" / filename


def verified_installed_file(packaged, installed, label):
    def digest(path):
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise RuntimeError(f"The {label} must be a regular file: {path}")
            return hashlib.file_digest(stream, "sha256").hexdigest()

    expected = digest(packaged)
    if expected != digest(installed):
        raise RuntimeError(f"The installed {label} differs from the reviewed Debian package")
    return expected


def verified_installed_executable(packaged, installed):
    verified_installed_file(packaged, installed, "executable")
    return installed


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


def start_abstract_xvfb(fixtures, children, log, socket_directory):
    """Start on a private, authenticated high display without filesystem X11 sockets."""
    # WSLg owns the filesystem socket directory. Allocate a
    # high display using only Linux's abstract local socket;
    # never compete with the workstation's low displays.
    if not shutil.which("xauth"):
        raise RuntimeError("Headless Xvfb on a read-only X11 socket mount requires xauth")
    authority = fixtures.root / "xvfb-authority"
    display = None
    for candidate in range(100, 200):
        if Path(f"/tmp/.X{candidate}-lock").exists() or (socket_directory / f"X{candidate}").exists():
            continue
        authority.unlink(missing_ok=True)
        authority.touch(mode=0o600)
        cookie = secrets.token_hex(16)
        subprocess.run(["xauth", "-q", "-f", str(authority)],
                       input=f"add :{candidate} MIT-MAGIC-COOKIE-1 {cookie}\n",
                       text=True, env=fixtures.env, stdout=log, stderr=log,
                       timeout=5, check=True)
        attempt = subprocess.Popen(
            ["Xvfb", f":{candidate}", "-displayfd", "1", "-noreset", "-screen", "0",
             "1920x1080x24", "-nolisten", "tcp", "-nolisten", "unix", "-auth", str(authority)],
            env=fixtures.env, stdout=subprocess.PIPE, stderr=log, start_new_session=True,
        )
        children.append(attempt)
        if not select.select([attempt.stdout], [], [], 15)[0]:
            raise TimeoutError("Xvfb did not allocate a private abstract display")
        number = attempt.stdout.readline().decode().strip()
        if number == str(candidate) and attempt.poll() is None:
            display = attempt
            break
        if attempt.poll() is None:
            raise RuntimeError("Xvfb reported an unexpected private display")
    if display is None:
        raise RuntimeError("Xvfb could not allocate a private abstract display; see driver.log")
    return str(candidate), display, str(authority)


def start_private_dbus(fixtures, children, log):
    """Own one Unix-only bus with no host service-activation directories."""
    address = 'unix:abstract=git-khronos-test-' + uuid.uuid4().hex
    user = quoteattr(pwd.getpwuid(os.getuid()).pw_name)
    config = fixtures.root / 'private-session-bus.conf'
    config.write_text('<busconfig><type>session</type><listen>' + address
                      + '</listen><auth>EXTERNAL</auth><policy context="default">'
                      + '<allow user=' + user + '/><allow own="*"/>'
                      + '<allow send_destination="*"/><allow receive_sender="*"/>'
                      + '</policy></busconfig>')
    process = subprocess.Popen(['dbus-daemon', '--config-file=' + str(config), '--nofork',
                                '--print-address=1', '--nosyslog'], env=fixtures.env,
                               stdout=subprocess.PIPE, stderr=log, start_new_session=True)
    children.append(process)
    if not select.select([process.stdout], [], [], 15)[0]:
        raise TimeoutError('Private session bus did not become ready')
    published = process.stdout.readline().decode().strip()
    if not published.startswith(address + ',') or process.poll() is not None:
        raise RuntimeError('Private session bus failed; see driver.log')
    fixtures.env.update(DBUS_SESSION_BUS_ADDRESS=published, NO_AT_BRIDGE='1',
                        GTK_A11Y='none', GSETTINGS_BACKEND='memory')
    return {'pid': process.pid, 'private': True, 'hostServiceActivation': False}


def run(*args, env=None, input=None):
    result = subprocess.run(args, env=env, input=input, capture_output=True, timeout=120)
    if result.returncode:
        details = result.stderr.decode(errors="replace").strip()[-4_000:]
        raise RuntimeError(f"{args[0]} exited {result.returncode}: {details}")
    return result.stdout.decode().strip()


def probe_git_toolchain(fixtures, report):
    """Fail before WebDriver if the fixture's Git and its helpers cannot run fsck together."""
    env = fixtures.env | {"LC_ALL": "C", "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_LAZY_FETCH": "1"}
    probe = {
        "passed": False,
        "executable": shutil.which("git", path=env.get("PATH", os.defpath)),
    }
    report["gitToolchainPreflight"] = probe
    try:
        probe["version"] = run("git", "--version", env=env)
        probe["execPath"] = run("git", "--exec-path", env=env)
        repository = fixtures.repository("git-toolchain-preflight", commits=1)
        run("git", "-C", str(repository), "-c", "core.commitGraph=false", "fsck", "--full",
            "--no-progress", env=env)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        probe["diagnostic"] = str(error)
        raise RuntimeError("The fixture Git toolchain failed before WebDriver. Check that Git and its helpers "
                           "come from the same installation; see gitToolchainPreflight.") from error
    probe["passed"] = True


def probe_signing_toolchain(fixtures, report, required, report_key):
    """Fail early with actionable diagnostics when real signing tools are absent."""
    available = {
        name: shutil.which(name, path=fixtures.env.get("PATH", os.defpath))
        for name in required
    }
    missing = [name for name, path in available.items() if path is None]
    report[report_key] = available
    if missing:
        raise RuntimeError(
            "signing acceptance requires these executables in PATH: " + ", ".join(missing)
        )


def probe_lfs_count_toolchain(fixtures, report):
    """Require the actual JSON capability, rather than assuming a version."""
    repository = fixtures.repository("lfs-count-toolchain-preflight", commits=1)
    probe = {"passed": False}
    report["lfsCountToolchainPreflight"] = probe
    try:
        probe["version"] = fixtures.git(repository, "lfs", "version")
        data = json.loads(fixtures.git(repository, "lfs", "ls-files", "--json"))
        if not isinstance(data, dict) or "files" not in data or (
            data["files"] is not None and not isinstance(data["files"], list)
        ):
            raise ValueError("Unexpected Git LFS JSON inventory.")
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        probe["diagnostic"] = str(error)
        raise RuntimeError("These scenarios require Git LFS with 'ls-files --json' on PATH. "
                           "Use a JSON-capable Git LFS build; see docs/linux-acceptance.md.") from error
    probe["passed"] = True


def probe_signed_tag_toolchain(fixtures, report):
    probe_signing_toolchain(fixtures, report, ("gpg", "ssh-keygen", "gpgsm", "openssl"),
                            "signedTagTools")


def probe_signed_commit_toolchain(fixtures, report):
    probe_signing_toolchain(fixtures, report, ("gpg",), "signedCommitTools")


def webdriver_ports():
    # Reserve both until assigned so the proxy and WebKit cannot be given the
    # same ephemeral port by two sequential bind/close calls.
    with socket.socket() as proxy, socket.socket() as native:
        proxy.bind(("127.0.0.1", 0))
        native.bind(("127.0.0.1", 0))
        return proxy.getsockname()[1], native.getsockname()[1]


def wait_webdriver_ready(driver, process, listen_port, *, timeout=20):
    deadline = time.monotonic() + timeout
    while process.poll() is None and time.monotonic() < deadline:
        try:
            # Check that the capability proxy is listening without giving its
            # native HTTP pool a warm-up request before the one session POST.
            with socket.create_connection(("127.0.0.1", listen_port), timeout=.5):
                pass
            status = driver.request("GET", "/status", timeout=1)
            if isinstance(status, dict) and status.get("ready") is True:
                return
        except (URLError, OSError):
            pass
        time.sleep(.1)
    raise RuntimeError("WebDriver did not become ready; see driver.log")


class Driver:
    def __init__(self, address, native_address=None, session_bus_address=None, owned_display=None):
        self.address = address
        self.native_address = native_address
        self.session = None
        self.executable = None
        self.session_bus_address = session_bus_address
        self.owned_display = owned_display
        self.native_pointer_deliveries = []

    def single_instance_bus_call(self, method):
        """Read only the application name on this fixture's private session bus."""
        if not self.session_bus_address or not self.session_bus_address.startswith('unix:abstract=git-khronos-test-'):
            raise RuntimeError('Restart bus inspection requires the owned private session bus')
        identifier = json.loads((ROOT / 'apps/desktop/src-tauri/tauri.conf.json').read_text())['identifier']
        return run('dbus-send', '--bus=' + self.session_bus_address, '--print-reply',
                   '--reply-timeout=1000', '--type=method_call', '--dest=org.freedesktop.DBus',
                   '/org/freedesktop/DBus', 'org.freedesktop.DBus.' + method,
                   'string:' + identifier + '.SingleInstance')

    def owned_session_application_pid(self):
        """Resolve the active app on this fixture's bus, not every process sharing its executable."""
        if not self.session or self.executable is None or not self.session_bus_address:
            raise RuntimeError('Native application ownership requires an owned WebDriver session and executable')
        reply = self.single_instance_bus_call('GetConnectionUnixProcessID').splitlines()
        kind, _, value = (reply[-1].strip() if reply else '').partition(' ')
        if (kind != 'uint32' or not value.isascii() or not value.isdecimal()
                or len(value) > 10 or not 1 < int(value) <= 0xffffffff):
            raise RuntimeError('The private session bus did not identify an application process')
        pid = int(value)
        proc = Path('/proc') / str(pid)
        expected_bus = ('DBUS_SESSION_BUS_ADDRESS=' + self.session_bus_address).encode()
        try:
            if (proc.stat().st_uid == os.geteuid() and (proc / 'exe').readlink() == self.executable
                    and expected_bus in (proc / 'environ').read_bytes().split(b'\0')):
                return pid
        except OSError as error:
            raise RuntimeError('Could not verify the private session application process') from error
        raise RuntimeError('The private session owner is not the reviewed application')

    def wait_single_instance_release(self, timeout=10):
        deadline = time.monotonic() + timeout
        while True:
            reply = self.single_instance_bus_call('NameHasOwner').splitlines()
            value = reply[-1].strip() if reply else ''
            if value == 'boolean false':
                return
            if value != 'boolean true':
                raise RuntimeError('Unexpected single-instance bus ownership reply')
            if time.monotonic() >= deadline:
                raise TimeoutError('Closed application still owns its single-instance bus name; relaunch refused')
            time.sleep(.02)

    def request(self, method, path, payload=None, *, timeout=90):
        # Tauri translates session creation capabilities. Once created, use the
        # same native session directly, without the intermediary's HTTP pool.
        # Never fall back or replay a mutation if either endpoint loses a reply.
        native_request = (method == "GET" and path == "/status") or path.startswith("/session/")
        address = self.native_address if self.native_address and native_request else self.address
        request = Request(address + path, method=method,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json"})
        # Element lookup is POST in WebDriver, but is read-only. Never retry
        # clicks, navigation, or script execution after an ambiguous reply.
        read_only = method == "GET" or (method == "POST" and path.endswith(("/element", "/elements")))
        deadline = time.monotonic() + min(2, timeout)
        request_timeout = timeout
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

    def start(self, executable, args=None):
        payload = {"capabilities": {"alwaysMatch": {
            "tauri:options": {"application": str(executable)}, "pageLoadStrategy": "normal"
        }}}
        if args is not None:
            payload["capabilities"]["alwaysMatch"]["tauri:options"]["args"] = list(args)
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
        self.executable = Path(executable).resolve()
        self.request("POST", self.path("timeouts"), {"script": 60000, "pageLoad": 60000, "implicit": 0})

    def path(self, suffix):
        return f"/session/{self.session}/{suffix}"

    def script(self, script, *args, timeout=90):
        return self.request("POST", self.path("execute/sync"), {"script": script, "args": args},
                            timeout=timeout)

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
        unavailable = 0
        last_refusal = None
        quick_polls = iter((0.025, 0.025, 0.05))
        while (remaining := end - time.monotonic()) > 0:
            value = None
            try:
                # A stalled HTTP read must not receive the usual script
                # timeout, or it can outlive the entire readiness budget.
                value = self.script(script, timeout=min(90, remaining))
            except (RemoteDisconnected, URLError, ConnectionError, TimeoutError) as error:
                last_refusal = error
            except RuntimeError as error:
                if not script_result_unavailable(error):
                    raise
                # WebKitGTK can briefly fail to serialize the result. Only the
                # read-only predicate is retried, never script() or a click.
                unavailable += 1
                last_refusal = error
            remaining = end - time.monotonic()
            if remaining <= 0:
                break
            if value:
                return value
            # Normal UI changes often settle within one paint. Probe quickly
            # at first, but keep the existing cadence for slow work or errors.
            delay = next(quick_polls, 0.1) if last_refusal is None else 0.1
            time.sleep(min(delay, remaining))
        note = f" (WebKit could not parse {unavailable} script results)" if unavailable else ""
        raise TimeoutError(f"UI condition did not become true{note}: {script}") from last_refusal

    def wait_for_dialog_capture(self, selector, text=None, *, edge="start", require_action=False):
        self.script("""
            const target = [...document.querySelectorAll(arguments[0])]
                .find(node => !arguments[1] || node.textContent.includes(arguments[1]));
            if (!target) throw Error('Owned dialog capture target absent');
            target.scrollIntoView({block: arguments[2]});
            return true;
        """, selector, text, edge)
        # Older native WebDriver sessions can fail to serialize a Promise
        # returned by execute/sync. Poll the actual screenshot preconditions
        # using read-only, primitives-only script results instead.
        self.wait("""
            const [selector, text, requireAction] = """ + json.dumps([selector, text, require_action]) + """;
            const target = [...document.querySelectorAll(selector)]
                .find(node => !text || node.textContent.includes(text));
            const dialog = target?.closest('[role=dialog]');
            if (!target?.getClientRects().length || !dialog?.getClientRects().length) return false;
            const frame = dialog.getBoundingClientRect();
            if (dialog.scrollWidth > dialog.clientWidth + 1 || frame.left < 0 || frame.right > innerWidth + 1) {
                return false;
            }
            if (!requireAction) return true;
            const action = target.querySelector('button:last-of-type');
            const bounds = action?.getBoundingClientRect();
            return !!action?.getClientRects().length && bounds.top >= frame.top && bounds.bottom <= frame.bottom + 1;
        """, timeout=10)

    def reload(self):
        origin = self.script("return performance.timeOrigin")
        self.request("POST", self.path("refresh"), {})
        # A successful selector query can still belong to the outgoing page.
        # Wait for a fresh document before inspecting restored application state.
        self.wait(f"return performance.timeOrigin !== {json.dumps(origin)} && document.readyState === 'complete'", 60)

    def click(self, selector):
        element = self.request("POST", self.path("element"), {"using": "css selector", "value": selector})
        self._click_element(element)

    @staticmethod
    def _navigation_request_budget(deadline):
        if deadline is None:
            return {}
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Navigation deadline expired before WebDriver dispatch")
        return {"timeout": min(90, remaining)}

    def _click_element(self, element, *, deadline=None):
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        self.request("POST", self.path(f"element/{identifier}/click"), {},
                     **self._navigation_request_budget(deadline))

    def click_navigation(self, selector, text=None, *, scroll=False, wait_for_ready=False, timeout=3):
        """Reacquire navigation controls only after an explicit stale refusal.

        Ordinary click helpers and all write/review/submit callers keep their
        no-replay behavior. A caller may wait for the first control after a
        view transition. Only a stale refusal permits retrying a click.
        """
        deadline = time.monotonic() + timeout
        # A transition may already have left a disabled copy in the DOM
        # before the first lookup. Apply the same eligibility rule on both
        # sides of an explicit stale refusal.
        eligible = f':is({selector}):not(:disabled, [aria-disabled="true"], [inert], [inert] *)'
        def ready_control(remaining, description):
            elements = self.wait(f"""return [...document.querySelectorAll({json.dumps(eligible)})]
              .filter(element => element.getClientRects().length
                && getComputedStyle(element).visibility === 'visible'
                && ({json.dumps(text)} === null || element.textContent.trim() === {json.dumps(text)}));""",
                                 timeout=remaining)
            if len(elements) != 1:
                raise ValueError(f"Expected one {description} navigation control for {selector!r}, found {len(elements)}")
            return elements[0]

        replacement = ready_control(timeout, "ready") if wait_for_ready else None
        while True:
            try:
                if replacement is not None:
                    # Only the explicit readiness path promises an end-to-end
                    # budget; older callers still use the standard click timeout.
                    budget = {"deadline": deadline} if wait_for_ready else {}
                    click = self._click_scrolled_element if scroll else self._click_element
                    return click(replacement, **budget)
                if text is None:
                    return self.click(eligible)
                if scroll:
                    return self.click_scrolled_text(eligible, text)
                return self.click_text(eligible, text)
            except RuntimeError as error:
                remaining = deadline - time.monotonic()
                if not stale_element_refusal(error) or remaining <= 0:
                    raise
                replacement = ready_control(remaining, "replacement")

    def click_text(self, selector, text):
        elements = self.script("return [...document.querySelectorAll(arguments[0])].filter(element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible' && element.textContent.trim() === arguments[1]);", selector, text)
        if len(elements) != 1:
            raise ValueError(f"Expected one {selector!r} with text {text!r}, found {len(elements)}")
        self._click_element(elements[0])

    def click_scrolled_text(self, selector, text, *, wait_for_ready=False):
        """Scroll normally, verify the painted hit target, then click exactly once."""
        lookup = """(selector, text) => [...document.querySelectorAll(selector)].filter(element =>
          element.getClientRects().length && getComputedStyle(element).visibility === 'visible'
          && !element.matches(':disabled') && !element.closest('[inert]') && element.textContent.trim() === text)"""
        if wait_for_ready:
            # Capture the ready element in the same read-only poll. A separate
            # DOM-presence wait can finish before the control is actually laid out.
            elements = self.wait(f"return ({lookup})({json.dumps(selector)}, {json.dumps(text)});")
        else:
            elements = self.script(f"return ({lookup})(arguments[0], arguments[1]);", selector, text)
        if len(elements) != 1:
            raise ValueError(f"Expected one enabled {selector!r} with text {text!r}, found {len(elements)}")
        return self._click_scrolled_element(elements[0])

    def _click_scrolled_element(self, element, *, deadline=None):
        geometry = self.request("POST", self.path("execute/async"), {"script": """
          const element=arguments[0], done=arguments[arguments.length-1];
          const bounds=()=>{
            const r=element.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
            const hit=document.elementFromPoint(x,y);
            return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,
              hitTarget:element.isConnected && r.width>0 && r.height>0 && x>=0 && y>=0
                && x<innerWidth && y<innerHeight && !element.matches(':disabled')
                && !element.closest('[inert]') && getComputedStyle(element).visibility==='visible'
                && !!hit && element.contains(hit)};
          };
          // A compositor can stop ticking frames on a live headless page.
          // The fallback checks the same hit target; it never dispatches a click.
          const afterPaint=(callback)=>{
            let finished=false;
            const finish=()=>{
              if(finished) return;
              finished=true;
              clearTimeout(fallback);
              callback();
            };
            const fallback=setTimeout(finish,500);
            requestAnimationFrame(()=>requestAnimationFrame(finish));
          };
          afterPaint(()=>{
            const before=bounds();element.scrollIntoView({block:'center',inline:'nearest'});
            afterPaint(()=>{
              const after=bounds();done({before,after,interactable:after.hitTarget});
            });
          });
        """, "args": [element]}, **self._navigation_request_budget(deadline))
        if not isinstance(geometry, dict) or geometry.get("interactable") is not True:
            raise RuntimeError("The control is not interactable after ordinary scrolling: " + json.dumps(geometry))
        # A failed/lost click reply is an uncertain action, never a reason to replay.
        self._click_element(element, deadline=deadline)
        return geometry

    def click_visible(self, selector, text=None):
        element = self.wait(f"""return (() => {{
          const expectedText = {json.dumps(text)};
          const matches = [...document.querySelectorAll({json.dumps(selector)})]
            .filter(element => {{
              if (!element.getClientRects().length || getComputedStyle(element).visibility !== 'visible'
                || element.matches(':disabled') || element.closest('[inert]')
                || (expectedText !== null && element.textContent.trim() !== expectedText)) return false;
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

    def context_click(self, selector):
        """Perform one real right click and verify its trusted press and release."""
        element = self.wait(f"""return (() => {{
          const matches = [...document.querySelectorAll({json.dumps(selector)})]
            .filter(element => element.getClientRects().length
              && getComputedStyle(element).visibility === 'visible'
              && !element.matches(':disabled') && !element.closest('[inert]'));
          return matches.length === 1 ? matches[0] : null;
        }})()""")
        geometry = self.request("POST", self.path("execute/async"), {"script": """
          const element=arguments[0], done=arguments[arguments.length-1];
          element.scrollIntoView({block:'center',inline:'nearest'});
          requestAnimationFrame(()=>requestAnimationFrame(()=>{
            const r=element.getBoundingClientRect();
            const left=Math.max(0,r.left), right=Math.min(innerWidth,r.right);
            const top=Math.max(0,r.top), bottom=Math.min(innerHeight,r.bottom);
            const x=(left+right)/2, y=(top+bottom)/2;
            const hit=document.elementFromPoint(x,y);
            const interactable=element.isConnected && right>left && bottom>top
              && !element.matches(':disabled') && !element.closest('[inert]')
              && getComputedStyle(element).visibility==='visible' && !!hit && element.contains(hit);
            const scale=window.devicePixelRatio;
            done({interactable, x:Math.round((window.screenX+x)*scale),
              y:Math.round((window.screenY+y)*scale), scale});
          }));
        """, "args": [element]})
        if not isinstance(geometry, dict) or geometry.get('interactable') is not True:
            raise RuntimeError('The context-menu target is not interactable: ' + json.dumps(geometry))
        self.script("""
          if (window.__nativeContextCheck) throw Error('A native context-click is already in progress');
          const target=arguments[0], state={context:false,release:false};
          state.onContext=event=>{
            if (event.isTrusted && event.button===2 && target.contains(event.target)) state.context=true;
          };
          state.onRelease=event=>{
            if (event.isTrusted && event.button===2 && !(event.buttons&2)) state.release=true;
          };
          window.__nativeContextCheck=state;
          document.addEventListener('contextmenu',state.onContext,true);
          document.addEventListener('mouseup',state.onRelease,true);
        """, element)
        try:
            if self.owned_display:
                from native_pointer import owned_right_press
                with owned_right_press(self.owned_display, self.owned_session_application_pid,
                                       geometry['x'], geometry['y']) as delivery:
                    self.wait('return window.__nativeContextCheck?.context', 5)
                self.wait('return window.__nativeContextCheck?.release', 5)
                self.native_pointer_deliveries.append(delivery)
            else:
                self.request('POST', self.path('actions'), {'actions': [{
                    'type': 'pointer', 'id': 'native-context-mouse', 'parameters': {'pointerType': 'mouse'},
                    'actions': [{'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0, 'duration': 0},
                                {'type': 'pointerDown', 'button': 2}, {'type': 'pointerUp', 'button': 2}],
                }]})
                self.wait('return window.__nativeContextCheck?.context && window.__nativeContextCheck?.release', 5)
        finally:
            self.script("""
              const state=window.__nativeContextCheck;
              if (state) {
                document.removeEventListener('contextmenu',state.onContext,true);
                document.removeEventListener('mouseup',state.onRelease,true);
                delete window.__nativeContextCheck;
              }
            """)

    def key(self, value, *, modifiers=()):
        presses = [{"type": "keyDown", "value": modifier} for modifier in modifiers]
        releases = [{"type": "keyUp", "value": modifier} for modifier in reversed(modifiers)]
        # A chord can mutate Git; dispatch it once with no replay.
        self.request("POST", self.path("actions"), {"actions": [{
            "type": "key", "id": "native-keyboard",
            "actions": [*presses, {"type": "keyDown", "value": value}, {"type": "keyUp", "value": value}, *releases],
        }]})

    def screenshot(self, path):
        path.write_bytes(base64.b64decode(self.request("GET", self.path("screenshot"))))

    def close(self):
        if self.session:
            self.request("DELETE", f"/session/{self.session}")
            self.session = None

    def restart_application(self, args=None):
        """Close and relaunch only this fixture's exact packaged executable."""
        if not self.session or self.executable is None or not self.session_bus_address:
            raise RuntimeError("Application restart requires an active owned Linux session and private bus")
        executable = self.executable
        old_pid = self.owned_session_application_pid()
        self.close()
        deadline = time.monotonic() + 10
        while True:
            try:
                running = Path(f'/proc/{old_pid}/stat').read_text().rsplit(')', 1)[1].split()[0] not in ('Z', 'X')
            except (FileNotFoundError, ProcessLookupError):
                running = False
            if not running:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("Session closure did not stop the owned application process")
            time.sleep(.02)
        # Process exit and bus name release are separate observable events.
        self.wait_single_instance_release()
        if args is None:
            self.start(executable)
        else:
            self.start(executable, args=args)
        deadline = time.monotonic() + 10
        while True:
            reply = self.single_instance_bus_call('NameHasOwner').splitlines()
            value = reply[-1].strip() if reply else ''
            if value == 'boolean true':
                new_pid = self.owned_session_application_pid()
                break
            if value != 'boolean false':
                raise RuntimeError('Unexpected single-instance bus ownership reply')
            if time.monotonic() >= deadline:
                raise RuntimeError("The restarted owned application process did not appear")
            time.sleep(.02)
        if new_pid == old_pid:
            raise RuntimeError("Application restart did not create a different process")
        return {"oldPid": old_pid, "newPid": new_pid}


class Fixtures:
    def __init__(self, directory):
        self.root = Path(directory)
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("GIT_", "DBUS_")) and key not in ("SSH_AUTH_SOCK", "SSH_AGENT_PID", "ENV", "BASH_ENV")}
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
                           '      marker="$gate/started.$$"\n'
                           '      printf \'%s\\n\' "$$" > "$marker" && mv -f -- "$marker" "$gate/started" || exit 126\n'
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

    def repository(self, name="repository", commits=12, *, ref_format=None):
        repository = self.root / name
        repository.mkdir()
        options = [f"--ref-format={ref_format}"] if ref_format else []
        self.git(repository, "init", "-q", "-b", "main", *options)
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


def seed_commit_draft(driver, repository, draft):
    """Wait for the editable form; history can paint before the first file scan."""
    driver.wait("""const field = document.querySelector('.commit-form #commit-summary');
      return document.querySelector('.status-repository-path')?.textContent.trim() === """ + json.dumps(str(repository)) + """
        && field?.getClientRects().length > 0 && !field.disabled && !field.readOnly
        && !field.closest('[inert]');""")
    driver.script('''const field = document.querySelector('.commit-form #commit-summary');
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', draft)


def checkpoint_fixture(fixtures, repository):
    head = fixtures.git(repository, "rev-parse", "HEAD")
    tree = fixtures.git(repository, "rev-parse", "HEAD^{tree}")
    names = {
        key: f"refs/copilot/checkpoints/native/{key}/checkpoint"
        for key in ("reviewed", "sibling", "moved", "external-packed", "external-loose",
                    "deleted-packed", "deleted-loose")
    }
    oids = {
        key: fixtures.git(repository, "commit-tree", tree, "-p", head,
                          input=f"Native checkpoint {key}\n".encode())
        for key in names if key != "sibling"
    }
    oids["sibling"] = head
    oids["replacement"] = fixtures.git(repository, "commit-tree", tree, "-p", head,
                                       input=b"Native checkpoint replacement\n")
    for key in ("reviewed", "sibling", "moved", "external-packed", "deleted-packed"):
        fixtures.git(repository, "update-ref", names[key], oids[key])
    fixtures.git(repository, "pack-refs", "--all", "--prune")
    packed = (repository / ".git/packed-refs").read_text()
    for key in ("reviewed", "sibling", "moved", "external-packed", "deleted-packed"):
        assert f"{oids[key]} {names[key]}\n" in packed
        assert not (repository / ".git" / names[key]).exists()
    fixtures.git(repository, "update-ref", "-d", names["deleted-packed"], oids["deleted-packed"])
    for key in ("external-loose", "deleted-loose"):
        fixtures.git(repository, "update-ref", names[key], oids[key])
        assert (repository / ".git" / names[key]).is_file()
    fixtures.git(repository, "update-ref", "-d", names["deleted-loose"], oids["deleted-loose"])
    return {"names": names, "oids": oids, "head": head}


def checkpoint_refs(fixtures, repository):
    output = fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)",
                          "refs/copilot/checkpoints/")
    return dict(line.split(" ", 1) for line in output.splitlines())


def checkpoint_lifecycle(driver, fixtures, repository, repo_id, checkpoint, report, *, hold_packed_status=False):
    names, oids = checkpoint["names"], checkpoint["oids"]
    expected = {names[key]: oids[key] for key in
                ("reviewed", "sibling", "moved", "external-packed", "external-loose")}
    before_index = (repository / ".git/index").read_bytes()
    before_worktree = (repository / "fixture.txt").read_bytes()
    assert checkpoint_refs(fixtures, repository) == expected

    driver.click('[aria-label="Configure graph columns"]')
    checkbox = '#graph-column-settings label[title="Include Copilot checkpoint references and their history"] input'
    driver.wait(f"return !!document.querySelector({json.dumps(checkbox)}) && !document.querySelector({json.dumps(checkbox)}).disabled")
    assert not driver.script("return document.querySelector(arguments[0]).checked", checkbox)
    driver.click(checkbox)
    driver.wait(f"return document.querySelector({json.dumps(checkbox)})?.checked && !document.querySelector({json.dumps(checkbox)}).disabled")
    driver.click('[aria-label="Close graph settings"]')

    def row(key):
        return f'.commit-row[data-commit-oid="{oids[key]}"]'

    def pill(key):
        return row(key) + f' [aria-label="Copilot checkpoint {names[key]}"]'

    for key in ("reviewed", "moved", "external-packed", "external-loose"):
        driver.wait(f"return !!document.querySelector({json.dumps(pill(key))})")
    for key in ("deleted-packed", "deleted-loose"):
        assert not driver.script("return !!document.querySelector(arguments[0])", row(key))
        assert not driver.script("return !!document.querySelector(arguments[0])",
                                 f'[aria-label="Copilot checkpoint {names[key]}"]')

    report["checkpointExternalDeletes"] = []
    for key in ("external-loose", "external-packed"):
        packed_race = hold_packed_status and key == "external-packed"
        burst_race = hold_packed_status and key == "external-loose"
        context = nullcontext()
        if packed_race:
            from native_watcher_scenarios import held_status_for_packed_ref
            context = held_status_for_packed_ref(driver, fixtures, report)
        observation = {"storage": key.removeprefix("external-"), "oid": oids[key],
                       "gitRefDeleted": False, "graphRowRemoved": False}
        report["checkpointExternalDeletes"].append(observation)

        def delete_ref():
            fixtures.git(repository, "update-ref", "-d", names[key], oids[key])
            expected.pop(names[key])
            assert checkpoint_refs(fixtures, repository) == expected
            observation["gitRefDeleted"] = True

        if burst_race:
            from native_watcher_scenarios import remove_ref_during_change_burst
            remove_ref_during_change_burst(driver, fixtures, repository, repo_id, report, row(key), delete_ref)
            report["scenarios"].append("native-loose-ref-refresh-converges-during-continuous-watcher-events")
        else:
            with context:
                delete_ref()
        driver.wait(f"return !document.querySelector({json.dumps(row(key))})")
        observation["graphRowRemoved"] = True
        if packed_race:
            report["scenarios"].append("native-packed-ref-refresh-replays-read-after-held-status")

    driver.click(pill("moved"))
    driver.click_visible(".context-menu[role=menu] button.danger-item", "Delete checkpoint reference…")
    driver.wait("return !!document.querySelector('.checkpoint-confirmation-dialog .confirm-action:not(:disabled)')")
    confirmation = driver.script("return document.querySelector('.checkpoint-confirmation-dialog').textContent")
    assert names["moved"] in confirmation and oids["moved"][:7] in confirmation
    fixtures.git(repository, "update-ref", names["moved"], oids["replacement"], oids["moved"])
    expected[names["moved"]] = oids["replacement"]
    driver.wait("return !!document.querySelector('.checkpoint-confirmation-dialog .confirm-action:not(:disabled)')")
    driver.click_text(".checkpoint-confirmation-dialog button", "Delete checkpoint reference")
    driver.wait("""return document.querySelector('gk-error-toast [role=alert]')
      ?.textContent.includes('checkpoint has moved or no longer exists')""")
    assert checkpoint_refs(fixtures, repository) == expected
    driver.wait(f"return !!document.querySelector({json.dumps(row('replacement'))})")
    driver.wait(f"return !document.querySelector({json.dumps(row('moved'))})")
    driver.click('[aria-label="Dismiss error"]')

    driver.click(pill("reviewed"))
    driver.click_visible(".context-menu[role=menu] button.danger-item", "Delete checkpoint reference…")
    driver.wait("return !!document.querySelector('.checkpoint-confirmation-dialog[role=alertdialog]')")
    confirmation = driver.script("return document.querySelector('.checkpoint-confirmation-dialog').textContent")
    assert names["reviewed"] in confirmation and oids["reviewed"][:7] in confirmation
    driver.click_text(".checkpoint-confirmation-dialog button", "Cancel")
    assert checkpoint_refs(fixtures, repository) == expected

    driver.click(pill("reviewed"))
    driver.click_visible(".context-menu[role=menu] button.danger-item", "Delete checkpoint reference…")
    driver.wait("return !!document.querySelector('.checkpoint-confirmation-dialog .confirm-action:not(:disabled)')")
    driver.click_text(".checkpoint-confirmation-dialog button", "Delete checkpoint reference")
    driver.wait(f"return !document.querySelector({json.dumps(row('reviewed'))})")
    expected.pop(names["reviewed"])
    assert checkpoint_refs(fixtures, repository) == expected
    assert fixtures.git(repository, "rev-parse", "HEAD") == checkpoint["head"]
    assert (repository / ".git/index").read_bytes() == before_index
    assert (repository / "fixture.txt").read_bytes() == before_worktree
    assert not fixtures.git(repository, "status", "--porcelain")
    for oid in oids.values():
        fixtures.git(repository, "cat-file", "-e", f"{oid}^{{commit}}")
    for key, oid in (("sibling", oids["sibling"]), ("moved", oids["replacement"])):
        fixtures.git(repository, "update-ref", "-d", names[key], oid)
    assert not checkpoint_refs(fixtures, repository)
    driver.click('[aria-label="Configure graph columns"]')
    driver.wait(f"return !!document.querySelector({json.dumps(checkbox)}) && !document.querySelector({json.dumps(checkbox)}).disabled")
    driver.click(checkbox)
    driver.wait(f"return !document.querySelector({json.dumps(checkbox)})?.checked && !document.querySelector({json.dumps(checkbox)}).disabled")
    driver.click('[aria-label="Close graph settings"]')
    driver.wait("return document.querySelectorAll('.commit-row[data-commit-oid]').length === 12")
    report["scenarios"].extend([
        "native-checkpoint-history-excludes-deleted-packed-and-loose-refs",
        "native-external-checkpoint-deletion-refreshes-packed-and-loose-history",
        "native-ui-moved-checkpoint-refuses-stale-deletion",
        "native-ui-reviewed-checkpoint-deletion-preserves-sibling-and-repository",
    ])


def menu_tab_focus(driver, report):
    for toggle, menu in ((".workspace-toggle", ".workspace-menu"), (".app-menu", ".app-menu-popover")):
        driver.script("document.querySelector(arguments[0]).focus()", toggle)
        driver.key("\ue004")
        assert driver.script("return document.activeElement !== document.body"), "No native Tab destination after menu opener"
        driver.script("document.activeElement.setAttribute('data-native-menu-tab-target', '')")
        try:
            driver.click(toggle)
            if menu == ".app-menu-popover":
                # Loading/error escapes are also menuitems. Qualify the actual
                # deferred content, not merely focus inside its placeholder.
                driver.wait("""return [...document.querySelectorAll('.app-menu-popover gk-main-menu-content [role=menuitem]')]
                  .some(element => element.textContent.includes('Manage Repositories') && element === document.activeElement)""")
                layout = driver.script("""const menu = document.querySelector('.app-menu-popover');
                  const content = menu.querySelector('gk-main-menu-content');
                  const bounds = menu.getBoundingClientRect();
                  return {headerHeight: content.querySelector('header').getBoundingClientRect().height,
                    scrollHeight: content.querySelector('.app-menu-scroll').clientHeight,
                    top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight};""")
                assert layout['headerHeight'] > 0 and layout['scrollHeight'] > 0, layout
                assert 0 <= layout['top'] < layout['bottom'] <= layout['viewportHeight'], layout
                report['mainMenuLayout'] = layout
            driver.wait(f"return document.querySelector({json.dumps(menu)})?.contains(document.activeElement)")
            driver.key("\ue004")
            driver.wait(f"return !document.querySelector({json.dumps(menu)})", 2)
            assert driver.script("return document.activeElement?.hasAttribute('data-native-menu-tab-target')"), \
                f"Tab from {menu} did not resume the normal focus order"
        finally:
            driver.script("document.querySelectorAll('[data-native-menu-tab-target]').forEach(element => element.removeAttribute('data-native-menu-tab-target'))")
    report["scenarios"].append("native-menu-tab-dismissal-preserves-sequential-focus")


def toolbar_menu_focus_gap(driver, report):
    toggle = '[aria-label="Pull options"]'
    menu = '#pull-options-menu'
    driver.wait(f"""const button = document.querySelector({json.dumps(toggle)});
        return button && !button.disabled && button.getClientRects().length;""")
    for modifiers in ((), ("\ue008",)):
        driver.script("document.querySelector(arguments[0]).focus()", toggle)
        driver.key("\ue004", modifiers=modifiers)
        driver.script("document.activeElement.setAttribute('data-native-toolbar-tab-target', '')")
        try:
            driver.click_visible(toggle)
            driver.wait("""return document.querySelector('#pull-options-menu[gkToolbarOptions]')
                ?.contains(document.activeElement);""")
            # Model a focused fallback being removed just before the next key.
            driver.script("document.activeElement.blur()")
            assert driver.script("return document.activeElement === document.body")
            driver.key("\ue004", modifiers=modifiers)
            driver.wait("return !document.querySelector('#pull-options-menu')", 5)
            assert driver.script("return document.activeElement.hasAttribute('data-native-toolbar-tab-target')")
        finally:
            driver.script("""document.querySelectorAll('[data-native-toolbar-tab-target]')
                .forEach(element => element.removeAttribute('data-native-toolbar-tab-target'));""")
    report["scenarios"].append("native-toolbar-menu-tab-returns-to-toolbar-after-focus-gap")


def terminal_csp_rendering(driver, report):
    driver.click('[title="Open repository terminal (Alt+T or Ctrl+`)"]')
    driver.wait("return !!document.querySelector('gk-terminal-panel .xterm-screen')")
    session_id = driver.script("return document.querySelector('gk-terminal-panel .terminal-host').dataset.terminalId")
    command = (r"printf '\033[31mCSP_ANSI\033[0m \033[38;2;52;178;128mCSP_RGB\033[0m "
               r"\033[48;2;40;60;80mCSP_BG\033[0m\n'" + "\n")
    driver.invoke("write_terminal", sessionId=session_id, data=list(command.encode()))
    probe = driver.wait("""return (() => {
      const screen = document.querySelector('gk-terminal-panel .xterm-screen');
      const rows = screen?.querySelector('.xterm-rows');
      const spans = [...(rows?.querySelectorAll('span') || [])];
      const ansi = spans.find(span => span.classList.contains('xterm-fg-1') && span.textContent === 'CSP_ANSI');
      const rgb = spans.find(span => span.textContent === 'CSP_RGB');
      const background = spans.find(span => span.textContent === 'CSP_BG');
      if (!screen || !rows || !ansi || !rgb || !background) return null;
      const styles = [...screen.querySelectorAll('style')];
      return {
        font: getComputedStyle(rows).fontFamily,
        fontSize: getComputedStyle(rows).fontSize,
        foreground: getComputedStyle(rows).color,
        ansi: getComputedStyle(ansi).color,
        rgb: getComputedStyle(rgb).color,
        background: getComputedStyle(background).backgroundColor,
        width: screen.getBoundingClientRect().width,
        height: screen.getBoundingClientRect().height,
        styles: styles.length,
        protectedStyles: styles.every(style => !!style.nonce && !!style.sheet)
      };
    })()""")
    assert probe["fontSize"] == "13px" and "monospace" in probe["font"].lower(), probe
    assert probe["foreground"] == "rgb(216, 215, 226)" and probe["ansi"] == "rgb(239, 113, 134)", probe
    assert probe["rgb"] == "rgb(52, 178, 128)" and probe["background"] == "rgb(40, 60, 80)", probe
    assert probe["width"] > 100 and probe["height"] > 0 and probe["styles"] >= 2 and probe["protectedStyles"], probe
    assert not driver.script(RENDER_PROBE)["blocked"], "Terminal styles blocked by CSP"
    unnonced_loaded = driver.script("""
      const style = document.createElement('style');
      style.textContent = ':root { --untrusted-style-probe: allowed }';
      document.head.append(style);
      const loaded = !!style.sheet;
      style.remove();
      return loaded;
    """)
    assert not unnonced_loaded, "Unnonced style element was allowed by CSP"
    driver.screenshot(Path(report["artifactsDirectory"]) / "terminal-csp.png")
    driver.click('gk-terminal-panel [title="Close terminal tab"]')
    driver.wait("return !document.querySelector('gk-terminal-panel')")
    report["terminalRender"] = probe
    report["scenarios"].append("native-terminal-csp-font-and-colors")


def repository_file_discard_recovery(driver, fixtures, repository, repo_id, report):
    """Use only the packaged UI to delete and recover an owned untracked file."""
    file = repository / "native-recovery-file.bin"
    nested = repository / "native-recovery-nested" / "notes.bin"
    contents = b"owned native recovery\x00\xff\n"
    before_index = (repository / ".git/index").read_bytes()
    before_head = fixtures.git(repository, "rev-parse", "HEAD")
    file.write_bytes(contents)
    nested.parent.mkdir()
    nested.write_bytes(contents)
    driver.wait('return !!document.querySelector(\'[aria-label="Stage native-recovery-file.bin"]\')')

    driver.click(".workspace-toggle")
    driver.click_scrolled_text(".workspace-menu-actions [role=menuitem]", "Repository files", wait_for_ready=True)
    driver.wait("""const paths = [...document.querySelectorAll('gk-workspace-center .file-entry code')]
      .map(code => code.textContent);
      return paths.includes('native-recovery-file.bin') && paths.includes('native-recovery-nested/notes.bin');""")
    assert driver.invoke("system_info")["repositoryFileCreationAvailable"] is False
    assert driver.script("""const workspace = document.querySelector('gk-workspace-center');
      return !workspace.querySelector('.file-tools form')
        && workspace.textContent.includes('Create files in your file manager or editor, then refresh this list.');""")
    assert driver.script("""const row = [...document.querySelectorAll('gk-workspace-center .file-entry')]
      .find(row => row.querySelector('code')?.textContent === 'native-recovery-nested/notes.bin');
      return row?.textContent.includes('Untracked · deletion unavailable')
        && row.querySelector('button')?.textContent.trim() === 'Open'
        && row.querySelectorAll('button').length === 1;""")
    driver.click_text("gk-workspace-center .file-entry button", "Delete with recovery")
    driver.wait("return !!document.querySelector('gk-workspace-center [role=alertdialog]')")
    assert "Recovery History" in driver.script(
        "return document.querySelector('gk-workspace-center [role=alertdialog]').textContent"
    )
    driver.click_text("gk-workspace-center [role=alertdialog] button", "Delete file")
    # The deleted entry is removed by an asynchronous listing refresh. On
    # slower WebKit builds, success text can be present before the modal's
    # contents and focus have settled. Wait for the refreshed list and the
    # dismissal target, not just early acknowledgement of the write.
    driver.wait("""const workspace = document.querySelector('gk-workspace-center');
      return !!workspace && !workspace.querySelector('[role=alertdialog]')
        && [...workspace.querySelectorAll('[role=status]')].some(element =>
          element.textContent.includes('Deleted native-recovery-file.bin and saved it to Recovery History'))
        && ![...workspace.querySelectorAll('.file-entry code')].some(element =>
          element.textContent.trim() === 'native-recovery-file.bin')
        && [...workspace.querySelectorAll('.file-tools button')].some(button =>
          !button.disabled && button.textContent.trim() === 'Refresh files');""")
    assert not file.exists()
    driver.click_visible("gk-workspace-center header button", "Close")
    driver.wait("return !document.querySelector('gk-workspace-center')")

    driver.click_visible('[aria-label="Main menu"]')
    driver.click_visible(".app-menu-popover [role=menuitem] strong", "Recovery History")
    driver.click_scrolled_text('.recovery-dialog .operation-captures[aria-label="Discarded changes"] button',
                               'Open discarded-change recovery…', wait_for_ready=True)
    driver.wait("""return document.querySelector('.saved-discards-dialog [aria-label="Files in this capture"]')
      ?.textContent.includes('native-recovery-file.bin')""")
    driver.wait("return document.activeElement?.matches('[data-saved-discards-close]')")
    records = driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert len(records) == 1 and records[0]["contentSha256"]
    capture = repository / ".git/git-khronos-recovery" / (records[0]["id"] + ".patch")
    original_capture = capture.read_bytes()
    driver.click_text(".saved-discards-dialog button", "Recover…")
    driver.wait("""return document.querySelector('[role=alertdialog]')?.textContent
      .includes('native-recovery-file.bin')""")
    driver.wait("return document.activeElement?.matches('[data-file-dialog-cancel]')")
    driver.wait("return !!document.querySelector('[role=alertdialog] .confirm-action:not(:disabled)')")
    capture.write_bytes(b"externally changed recovery capture")
    driver.click_text('[role=alertdialog] button', "Recover changes")
    driver.wait("""return document.querySelector('.recovery-dialog [role=alert]')
      ?.textContent.includes('changed after it was reviewed')""")
    assert not file.exists()
    assert capture.read_bytes() == b"externally changed recovery capture"
    assert (repository / ".git/index").read_bytes() == before_index
    capture.write_bytes(original_capture)
    driver.click_text(".recovery-dialog button", "Open discarded-change recovery…")
    driver.wait("""return document.querySelector('.saved-discards-dialog [aria-label="Files in this capture"]')
      ?.textContent.includes('native-recovery-file.bin')""")
    driver.click_text(".saved-discards-dialog button", "Recover…")
    driver.wait("return !!document.querySelector('[role=alertdialog] .confirm-action:not(:disabled)')")
    driver.click_text('[role=alertdialog] button', "Recover changes")
    driver.wait("""return !document.querySelector('[role=alertdialog]')
      && document.activeElement?.textContent.trim() === 'Open discarded-change recovery…'""")
    assert file.read_bytes() == contents
    assert (repository / ".git/index").read_bytes() == before_index
    assert fixtures.git(repository, "rev-parse", "HEAD") == before_head

    capture.write_bytes(b"externally changed recovery capture")
    driver.click_text(".recovery-dialog button", "Open discarded-change recovery…")
    driver.wait("""return document.querySelector('.saved-discards-dialog .saved-discard-item')
      ?.textContent.includes('recovery state cannot be matched')""")
    driver.wait("""return [...document.querySelectorAll('.saved-discards-dialog button')]
      .some(button => button.textContent.trim() === 'Discard again…' && button.disabled)""")
    changed = driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert changed[0]["stateBlocked"] and changed[0]["stateWarning"]
    assert file.read_bytes() == contents
    assert capture.read_bytes() == b"externally changed recovery capture"
    capture.write_bytes(original_capture)
    driver.click("[data-saved-discards-close]")

    driver.click_text(".recovery-dialog button", "Open discarded-change recovery…")
    driver.wait("return !!document.querySelector('.saved-discards-dialog')")
    driver.click_text(".saved-discards-dialog button", "Remove capture…")
    driver.wait("return !!document.querySelector('[role=alertdialog] .confirm-action:not(:disabled)')")
    capture.write_bytes(b"externally changed recovery capture")
    driver.click_text('[role=alertdialog] button', "Remove capture")
    driver.wait("""return document.querySelector('.recovery-dialog [role=alert]')
      ?.textContent.includes('changed after it was reviewed')""")
    assert capture.read_bytes() == b"externally changed recovery capture"
    assert file.read_bytes() == contents
    capture.write_bytes(original_capture)
    driver.click_text(".recovery-dialog button", "Open discarded-change recovery…")
    driver.wait("return !!document.querySelector('.saved-discards-dialog')")
    driver.click_text(".saved-discards-dialog button", "Remove capture…")
    driver.wait("return !!document.querySelector('[role=alertdialog] .confirm-action:not(:disabled)')")
    driver.click_text('[role=alertdialog] button', "Remove capture")
    driver.wait("return !document.querySelector('[role=alertdialog]')")
    # The confirmation can close while the native removal is still pending.
    deadline = time.monotonic() + 15
    while capture.exists() and time.monotonic() < deadline:
        time.sleep(.05)
    assert not capture.exists(), "The reviewed discard capture was not removed"
    assert not driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert file.read_bytes() == contents
    assert nested.read_bytes() == contents
    nested.unlink()
    nested.parent.rmdir()
    file.unlink()
    driver.click('[aria-label="Close recovery history"]')
    driver.wait('return !document.querySelector(\'[aria-label="Stage native-recovery-file.bin"]\')')
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].extend([
        "native-ui-repository-file-delete-and-recovery-history-roundtrip",
        "native-ui-changed-capture-refuses-reviewed-apply-and-removal",
        "native-ui-replaced-recovered-capture-blocks-discard-again",
    ])


def smoke(driver, fixtures, report, *, hold_packed_status=False):
    repository = fixtures.repository()
    checkpoints = checkpoint_fixture(fixtures, repository)
    repo_id = open_ui(driver, repository)
    probe = driver.script(RENDER_PROBE)
    assert probe["workspace"] == "grid" and probe["absolute"] and probe["bounded"], probe
    assert 0 < probe["rows"] < 100 and not probe["blocked"] and not probe["missingNonce"], probe
    driver.click('.commit-row[data-commit-oid]')
    driver.wait("return !!document.querySelector('.commit-row.selected')")
    driver.click('[aria-label="Preferences"]')
    driver.wait("return !!document.querySelector('gk-preferences-dialog [role=dialog]')")
    assert not driver.script(RENDER_PROBE)["blocked"], "Lazy styles blocked by CSP"
    driver.reload()
    driver.wait("return !!document.querySelector('.commit-row[data-commit-oid]')")
    snapshot = driver.invoke("refresh_repository", repoId=repo_id)
    assert snapshot["path"] == str(repository) and len(snapshot["commits"]) == 12
    report["render"] = probe
    report["scenarios"].extend(["production-csp", "graph-layout", "commit-selection", "lazy-preferences", "restart-tab-restore", "native-snapshot"])
    terminal_csp_rendering(driver, report)
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
    toolbar_menu_focus_gap(driver, report)
    # Exercise asynchronous filesystem discovery through the real UI, without
    # manually refreshing it or replacing renderer state with IPC results.
    driver.click('.wip-nav')
    untracked = repository / "native-untracked.txt"
    from native_watcher_scenarios import external_checkout_and_untracked, observe_untracked_refresh
    trace_watcher = os.environ.get("GIT_KHRONOS_NATIVE_TRACE_WATCHER") == "1"
    with observe_untracked_refresh(driver, fixtures, report, repo_id, trace_watcher) as mark:
        mark('create')
        untracked.write_text("discovered by the native status refresh\n")
        driver.wait('return !!document.querySelector(\'[aria-label="Stage native-untracked.txt"]\')')
        driver.wait('return !!document.querySelector(\'[aria-label="Stage all changes"]:not(:disabled)\')')
        mark('unlink')
        untracked.unlink()
        assert not fixtures.git(repository, "--no-optional-locks", "status", "--porcelain")
        driver.wait('return !document.querySelector(\'[aria-label="Stage native-untracked.txt"]\')')
        mark('observed-removal')
    report["scenarios"].append("native-untracked-file-discovery-and-removal")
    external_checkout_and_untracked(driver, fixtures, repository, repo_id, report)
    repository_file_discard_recovery(driver, fixtures, repository, repo_id, report)
    checkpoint_lifecycle(driver, fixtures, repository, repo_id, checkpoints, report,
                         hold_packed_status=hold_packed_status)
    return repository, repo_id


def performance(driver, fixtures, report):
    from native_worktree_scenarios import checkout_footprint
    from native_working_tree_recaps import wait_for_line_recaps

    report["performance"] = []
    for count in (20_000, 100_000):
        repository = fixtures.repository(f"history-{count}", count)
        for index in range(64):
            fixtures.git(repository, "branch", f"fixture-{index:02d}", f"HEAD~{index}")
        for index in range(36):
            fixtures.git(repository, "worktree", "add", "--detach", "-q", str(fixtures.root / f"linked-{count}-{index}"), f"HEAD~{index}")
        dirty_files = ("fixture.txt", "perf-staged.txt")
        (repository / "perf-staged.txt").write_text("staged change\n")
        fixtures.git(repository, "add", "--", "perf-staged.txt")
        (repository / "fixture.txt").write_text("replacement line\nsecond line\n")
        before = checkout_footprint(fixtures, repository, dirty_files)
        start = time.monotonic()
        repo_id = open_ui(driver, repository)
        loaded_ms = (time.monotonic() - start) * 1000
        wait_for_line_recaps(driver, (2, 1), (1, 0), changed_files=2)
        status_ready_ms = (time.monotonic() - start) * 1000
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
        assert checkout_footprint(fixtures, repository, dirty_files) == before
        report["performance"].append({"commits": count, "branches": 64, "linkedWorktrees": 36,
                                      "openMs": loaded_ms, "workingTreeReadyMs": status_ready_ms,
                                      "maxHeartbeatGapMs": maximum,
                                      "maxRenderedRows": max(probe["rows"] for probe in probes)})
    report["scenarios"].append("large-history-responsiveness")
    report["scenarios"].append("large-history-working-tree-recaps-ready-without-writes")


def main():
    if not __debug__:
        print("Native acceptance requires Python assertions. Remove -O and unset PYTHONOPTIMIZE.",
              file=sys.stderr)
        return 2
    suites = (
        "smoke", "full", "environment", "performance", "recovery", "integrity-ui", "gitlab", "gitlab-connect", "gitlab-connect-after-smoke",
        "gitlab-connect-refused", "gitlab-fork-ui", "file-tools", "configured-tools",
        "worktrees", "setup-keyboard", "remote-reviews", "transport-error-guidance", "incoming-links", "application-updates", "application-update-consent",
        "lfs-counts", "lfs-snapshot-timeout", "watcher-refresh", "file-media", "workspace-restore", "editor-close", "working-file-editor",
        "workspace-batch", "workspace-clone", "workspace-clone-recipe", "workspace-saved-removal", "workspace-saved-status", "workspace-locate", "workspace-bulk-locate",
        "workspace-pull-upstreams", "pull-submodule-scope", "merge-preview", "reference-hover", "reference-copy",
        "workspace-locate-nearby", "workspace-reopen", "feature-rebase", "merge-rebase-review", "discard-subset", "discard-busy", "discard-deletion", "discard-stale-review", "discard-large", "discard-limit", "submodule-initialize", "submodule-update",
        "stash-review", "stash-selection", "stash-clear", "autosquash-amend", "signed-tag", "signed-commit", "empty-commit", "lfs-lock-actions", "patch-export", "bundle-incremental-export", "commit-source-zip", "tracked-file-search", "diff-line-selection", "diff-rendering",
        "watcher-checkout", "watcher-reftable", "watcher-shallow-history", "commit-rewrite", "file-review-scope", "first-status", "repository-creation-scope",
        "repository-open-scope", "detached-checkout", "bisect-voting", "working-tree-recaps", "checkout-snapshot", "checkout-responsiveness", "worktree-reservation",
        "comparison-line-budget", "commit-coauthors", "branch-workflow-ui", "branch-workflow-recovery", "hosted-fork-ui", "hosted-fork-remote", "comparison-responsiveness", "stash-responsiveness", "file-history", "file-menu-copy",
        "commit-responsiveness", "history-control-responsiveness", "local-mutation-responsiveness", "ignore-responsiveness", "conflict-navigation", "revision-comparison", "comparison-patch", "branch-picker-exact", "previous-branch", "tag-preview", "history-depth",
    )
    forced_inherited = ("environment",)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--suite", choices=suites, default="smoke")
    parser.add_argument("--describe-runner", action="store_true",
                        help="Print the local distribution and suite capabilities as JSON without running a test")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--installed", action="store_true",
                        help="Verify the installed executable and desktop entry before running the app (CI only)")
    parser.add_argument("--inherited-git-environment", action="store_true",
                        help="Point inherited Git context variables at an owned outside repository for any suite")
    parser.add_argument("--output", type=Path, default=ROOT / "test-results/native")
    args = parser.parse_args()
    version, expected_package_name = expected_debian_package()
    if args.describe_runner:
        print(json.dumps({"distribution": linux_distribution(), "suites": suites,
                          "forcedInheritedGitEnvironment": forced_inherited,
                          "expectedPackageName": expected_package_name}))
        return
    if args.package is None:
        args.package = default_debian_archive(expected_package_name)
    workspace_picker_suite = args.suite in ("workspace-locate", "workspace-bulk-locate", "workspace-locate-nearby")
    owned_picker_suite = workspace_picker_suite or args.suite in (
        "repository-creation-scope", "workspace-clone", "workspace-clone-recipe", "bundle-incremental-export", "commit-source-zip",
    )
    if owned_picker_suite and not args.headless:
        parser.error(f"{args.suite} requires --headless (private Xvfb)")
    if args.suite == "patch-export" and not args.headless:
        parser.error("patch-export requires --headless (private Xvfb)")
    if args.suite == "integrity-ui" and not args.headless:
        parser.error("integrity-ui requires --headless (private Xvfb)")
    if args.suite == "merge-preview" and not args.headless:
        parser.error("merge-preview requires --headless (private Xvfb)")
    if args.suite == "autosquash-amend" and not args.headless:
        parser.error("autosquash-amend requires --headless (private Xvfb)")
    if args.suite == "signed-tag" and not args.headless:
        parser.error("signed-tag requires --headless (private Xvfb)")
    if args.suite == "signed-commit" and not args.headless:
        parser.error("signed-commit requires --headless (private Xvfb)")
    if args.suite == "empty-commit" and not args.headless:
        parser.error("empty-commit requires --headless (private Xvfb)")
    if args.suite in ("file-history", "file-menu-copy") and not args.headless:
        parser.error(f"{args.suite} requires --headless (private Xvfb)")
    if args.suite == "lfs-lock-actions" and not args.headless:
        parser.error("lfs-lock-actions requires --headless (private Xvfb)")
    if args.suite == "application-update-consent" and not (
        args.headless and args.installed and {name for _, name in socket.if_nameindex()} == {"lo"}
    ):
        parser.error("application-update-consent requires --headless --installed in a disposable loopback-only network namespace")
    try:
        output = args.output.resolve() / f"{args.suite}-{time.time_ns()}"
        output.mkdir(parents=True)
    except (OSError, RuntimeError) as exc:
        print(f"Cannot create native acceptance evidence under {args.output}: {exc}. "
              "Use --output with a directory writable and traversable by the runner user.",
              file=sys.stderr, flush=True)
        return 1
    progress = ScenarioProgress(output, args.suite)
    inherited_git_environment = args.suite in forced_inherited or args.inherited_git_environment
    report = {"suite": args.suite, "scenarios": progress, "passed": False,
              "inheritedGitEnvironment": inherited_git_environment,
              "platform": platform.platform(), "linuxDistribution": linux_distribution(),
              "artifactsDirectory": str(output)}
    print(f"Native acceptance: starting {args.suite}. Evidence: {output}", file=sys.stderr, flush=True)
    children = []
    driver = None
    temporary_directory = None
    original_xauthority = os.environ.get("XAUTHORITY")
    private_xauthority_set = False
    try:
        try:
            package = args.package.resolve(strict=True)
        except FileNotFoundError:
            raise RuntimeError(
                f"Debian package not found: {args.package}. "
                "Run pnpm nx run desktop:package-deb or pass --package with an existing archive."
            ) from None
        if not package.is_file():
            raise RuntimeError(f"Native acceptance needs a regular Debian package file: {package}")
        if package.name != expected_package_name:
            raise RuntimeError(f"Native acceptance needs the original archive name {expected_package_name}, got {package.name}.")
        required_tools = ("git", "tauri-driver", "WebKitWebDriver", "dpkg-deb", "dbus-daemon", "dbus-send")
        if args.headless:
            required_tools += ("Xvfb",)
        if args.suite in ("gitlab", "gitlab-fork-ui"):
            required_tools += ("readelf",)
        if args.suite in ("full", "environment", "lfs-counts", "lfs-snapshot-timeout"):
            required_tools += ("git-lfs",)
        for name in required_tools:
            if not shutil.which(name):
                raise RuntimeError(f"Missing {name}. See docs/linux-acceptance.md; no tests were skipped.")
        report["git"] = run("git", "--version")
        temporary_directory = tempfile.TemporaryDirectory(prefix="git-khronos-native-")
        # A subsequent package build can replace the original path while this
        # run is starting. Inspect, hash and extract one private archive.
        staged_package = Path(temporary_directory.name) / expected_package_name
        with os.fdopen(os.open(package, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise RuntimeError(f"Native acceptance needs a regular Debian package file: {package}")
            with staged_package.open("xb") as staged:
                shutil.copyfileobj(source, staged)
        assert run("dpkg-deb", "-f", str(staged_package), "Package") == "git-khronos"
        assert run("dpkg-deb", "-f", str(staged_package), "Architecture") == "amd64"
        actual_version = run("dpkg-deb", "-f", str(staged_package), "Version")
        assert actual_version == version, (actual_version, version)
        report["package"] = str(package)
        with staged_package.open("rb") as package_data:
            report["packageSha256"] = hashlib.file_digest(package_data, "sha256").hexdigest()
        fixtures = Fixtures(temporary_directory.name)
        outside = None
        if inherited_git_environment:
            outside = fixtures.repository("inherited-environment-outside", 1)
            fixtures.git(outside, "config", "user.name", "Unselected outside identity")
            fixtures.git(outside, "config", "user.email", "outside@example.test")
            (outside / ".gitattributes").write_text("* -diff\n")
            fixtures.git(outside, "add", ".gitattributes")
            fixtures.git(outside, "commit", "-qm", "Conflicting outside attributes")
            (outside / "fixture.txt").write_bytes(b"unselected outside contents\n")
            outside_index = (outside / ".git/index").read_bytes()
            outside_head = fixtures.git(outside, "rev-parse", "HEAD")
            outside_config = (outside / ".git/config").read_bytes()
        extracted = fixtures.root / "package"
        run("dpkg-deb", "-x", str(staged_package), str(extracted))
        staged_package.unlink()
        executable = extracted / "usr/bin/git-khronos"
        with executable.open("rb") as executable_data:
            report["executableSha256"] = hashlib.file_digest(executable_data, "sha256").hexdigest()
        if args.installed:
            executable = verified_installed_executable(executable, Path("/usr/bin/git-khronos"))
            desktop_entry = "usr/share/applications/git-khronos.desktop"
            installed_launcher = Path("/") / desktop_entry
            report["installedDesktopEntry"] = {
                "path": str(installed_launcher),
                "sha256": verified_installed_file(extracted / desktop_entry, installed_launcher, "desktop entry"),
            }
        report["executable"] = str(executable)
        report["installedExecutable"] = args.installed
        if args.suite in ("full", "environment"):
            probe_git_toolchain(fixtures, report)
        if args.suite == "signed-tag":
            probe_signed_tag_toolchain(fixtures, report)
        if args.suite == "signed-commit":
            probe_signed_commit_toolchain(fixtures, report)
        if args.suite in ("gitlab", "gitlab-fork-ui"):
            dependencies = run("dpkg-deb", "-f", str(package), "Depends")
            names = {alternative.strip().split()[0] for clause in dependencies.split(",")
                     for alternative in clause.split("|") if alternative.strip()}
            assert names & {"libssl3", "libssl3t64"}, dependencies
            dynamic = run("readelf", "-d", str(executable), env=fixtures.env | {"LC_ALL": "C"})
            needed = [line.split("Shared library: [", 1)[1].split("]", 1)[0]
                      for line in dynamic.splitlines() if "Shared library: [" in line]
            assert {"libssl.so.3", "libcrypto.so.3"} <= set(needed), needed
            report["nativeTlsPackage"] = {"depends": dependencies, "neededLibraries": needed}
        if args.suite == "gitlab":
            from native_gitlab_ssh_fixture import resolve_sshd
            resolve_sshd()
        if args.suite in ("full", "environment", "lfs-counts"):
            probe_lfs_count_toolchain(fixtures, report)
        progress.enter_phase("native-session-start")
        fixtures.env["TAURI_WEBVIEW_AUTOMATION"] = "true"
        with (output / "driver.log").open("w") as log:
            report["sessionBus"] = start_private_dbus(fixtures, children, log)
            owned_display = None
            if args.headless:
                # Keep the private display alive between owned app processes;
                # otherwise the last client disconnect can race GTK restart.
                socket_directory = Path("/tmp/.X11-unix")
                abstract_only = socket_directory.is_dir() and bool(os.statvfs(socket_directory).f_flag & os.ST_RDONLY)
                if abstract_only:
                    number, display, authority = start_abstract_xvfb(fixtures, children, log, socket_directory)
                    fixtures.env["XAUTHORITY"] = authority
                    # In-process Xlib is used by the owned picker and pointer
                    # probes. Restore the caller's value during cleanup.
                    os.environ["XAUTHORITY"] = authority
                    private_xauthority_set = True
                else:
                    display = subprocess.Popen(["Xvfb", "-displayfd", "1", "-noreset", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
                                               env=fixtures.env, stdout=subprocess.PIPE, stderr=log, start_new_session=True)
                    children.append(display)
                    if not select.select([display.stdout], [], [], 15)[0]:
                        raise TimeoutError("Xvfb did not allocate a display")
                    number = display.stdout.readline().decode().strip()
                    if not number.isdecimal():
                        # Some WSL/container hosts have a pre-existing X0 socket
                        # and a non-sticky /tmp/.X11-unix directory. In that
                        # configuration Xvfb -displayfd can exit without trying
                        # other displays, even though an explicit free display
                        # works. Fall back to an unused high display, without
                        # touching shared X11 sockets or lock files.
                        display = None
                        for candidate in range(90, 190):
                            if Path(f"/tmp/.X{candidate}-lock").exists() or Path(f"/tmp/.X11-unix/X{candidate}").exists():
                                continue
                            attempt = subprocess.Popen(
                                ["Xvfb", f":{candidate}", "-noreset", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
                                env=fixtures.env, stdout=subprocess.DEVNULL, stderr=log,
                                start_new_session=True,
                            )
                            time.sleep(0.15)
                            if attempt.poll() is None:
                                display = attempt
                                number = str(candidate)
                                children.append(display)
                                break
                            attempt.wait()
                        if display is None:
                            raise RuntimeError("Xvfb failed; see driver.log")
                fixtures.env["DISPLAY"] = ":" + number
                fixtures.env["GDK_BACKEND"] = "x11"
                owned_display = (fixtures.env["DISPLAY"], display)
            listen_port, native_port = webdriver_ports()
            application_env = fixtures.env.copy()
            if args.suite == "integrity-ui":
                from native_integrity_scenarios import integrity_cancellation_environment
                application_env.update(integrity_cancellation_environment(fixtures))
            if owned_picker_suite:
                application_env.update(LC_ALL="C.UTF-8", LANGUAGE="en")
            if args.suite == "lfs-snapshot-timeout":
                from native_lfs_snapshot_scenarios import lfs_snapshot_timeout_environment
                application_env.update(lfs_snapshot_timeout_environment(fixtures))
            if args.suite == "workspace-batch":
                from native_workspace_batch_scenarios import workspace_fetch_environment
                application_env.update(workspace_fetch_environment(fixtures))
            if args.suite == "first-status":
                from native_first_status_scenarios import first_status_environment
                application_env.update(first_status_environment(fixtures))
            if args.suite in ("full", "environment"):
                application_env.update(fixtures.terminal_environment())
                application_env.update(fixtures.history_environment())
            if args.suite in ("full", "environment", "hosted-fork-ui", "hosted-fork-remote"):
                application_env.update(fixtures.hosting_environment(application_env.get("PATH")))
            if args.suite in ("repository-open-scope", "checkout-snapshot", "checkout-responsiveness", "comparison-responsiveness", "merge-rebase-review",
                              "stash-responsiveness", "commit-responsiveness", "history-control-responsiveness",
                              "local-mutation-responsiveness", "ignore-responsiveness", "discard-busy"):
                application_env.update(fixtures.history_environment())
            if args.suite == "file-history":
                application_env.update(fixtures.history_environment())
            if args.suite in ("gitlab", "gitlab-connect", "gitlab-connect-after-smoke", "gitlab-connect-refused",
                              "gitlab-fork-ui", "repository-creation-scope"):
                from native_gitlab_scenarios import start_gitlab_fixture
                application_env.update(start_gitlab_fixture(fixtures, children, log, report))
            if args.suite == "watcher-refresh" or os.environ.get("GIT_KHRONOS_NATIVE_TRACE_WATCHER") == "1":
                from native_watcher_scenarios import watcher_status_environment
                application_env.update(watcher_status_environment(fixtures, application_env["PATH"]))
            if outside is not None:
                application_env.update({
                    "GIT_DIR": str(outside / ".git"),
                    "GIT_COMMON_DIR": str(outside / ".git"),
                    "GIT_WORK_TREE": str(outside),
                    "GIT_INDEX_FILE": str(outside / ".git/index"),
                    "GIT_CONFIG": str(outside / ".git/config"),
                    "GIT_LITERAL_PATHSPECS": "1", "GIT_GLOB_PATHSPECS": "1",
                    "GIT_NOGLOB_PATHSPECS": "1", "GIT_ICASE_PATHSPECS": "1",
                })
            process = subprocess.Popen(["tauri-driver", "--port", str(listen_port), "--native-port", str(native_port)],
                                       env=application_env, stdout=log, stderr=log, start_new_session=True)
            children.append(process)
            driver = Driver(f"http://127.0.0.1:{listen_port}", f"http://127.0.0.1:{native_port}",
                            session_bus_address=fixtures.env.get('DBUS_SESSION_BUS_ADDRESS'),
                            owned_display=owned_display)
            report["webdriverTransport"] = "tauri-session-creation-native-session-control"
            wait_webdriver_ready(driver, process, listen_port)
            driver.start(executable)
            progress.enter_phase("primary-scenarios")
            if args.suite == "workspace-restore":
                from native_workspace_edit_scenarios import saved_workspace_repository_workflow
                repository = saved_workspace_repository_workflow(driver, fixtures, report)
                repo_id = driver.invoke("open_repository", path=str(repository))["id"]
            elif args.suite == "workspace-saved-removal":
                from native_workspace_edit_scenarios import remove_saved_workspace_paths
                repository = remove_saved_workspace_paths(driver, fixtures, report)
                repo_id = driver.invoke("open_repository", path=str(repository))["id"]
            elif args.suite == "workspace-saved-status":
                from native_workspace_edit_scenarios import saved_checkout_status
                repository = saved_checkout_status(driver, fixtures, report)
                repo_id = driver.invoke("open_repository", path=str(repository))["id"]
            elif args.suite == "workspace-reopen":
                from native_workspace_edit_scenarios import reopen_workspace_tab
                repository = reopen_workspace_tab(driver, fixtures, report)
                repo_id = driver.invoke("open_repository", path=str(repository))["id"]
            elif workspace_picker_suite:
                from native_workspace_locate_scenarios import locate_workspace_paths
                repository = locate_workspace_paths(
                    driver, fixtures, report, args.suite == "workspace-bulk-locate",
                    start_nearby=args.suite == "workspace-locate-nearby",
                )
                repo_id = driver.invoke("open_repository", path=str(repository))["id"]
            elif args.suite == "working-file-editor":
                progress.enter_phase("working-file-editor")
                from native_editor_scenarios import working_file_editor
                repository = fixtures.repository()
                repo_id = open_ui(driver, repository)
                working_file_editor(driver, fixtures, repository, report)
            elif args.suite == "editor-close":
                from native_editor_close_scenarios import editor_window_close
                repository = fixtures.repository()
                repo_id = open_ui(driver, repository)
                editor_window_close(driver, fixtures, repository, report)
            elif args.suite == "workspace-batch":
                from native_workspace_batch_scenarios import workspace_batch_stop
                repository = workspace_batch_stop(driver, fixtures, report)
                repo_id = driver.invoke("open_repository", path=str(repository))["id"]
            elif args.suite == "workspace-clone":
                from native_workspace_clone_scenarios import workspace_clone
                repository, repo_id = workspace_clone(driver, fixtures, report)
            elif args.suite == "workspace-clone-recipe":
                from native_workspace_clone_scenarios import workspace_clone_recipe
                repository, repo_id = workspace_clone_recipe(driver, fixtures, report)
            elif args.suite in ("workspace-pull-upstreams", "pull-submodule-scope"):
                from native_pull_scope_scenarios import pull_submodule_scope, workspace_pull_upstreams
                scenario = pull_submodule_scope if args.suite == "pull-submodule-scope" else workspace_pull_upstreams
                repository, repo_id = scenario(driver, fixtures, report)
            elif args.suite == "branch-workflow-ui":
                from native_scenarios import branch_workflow_desktop
                repository = fixtures.repository()
                repo_id = open_ui(driver, repository)
                branch_workflow_desktop(driver, fixtures, repository, report)
            elif args.suite == "branch-workflow-recovery":
                from native_scenarios import branch_workflow_restart_and_abort
                repository = fixtures.repository()
                repo_id = open_ui(driver, repository)
                branch_workflow_restart_and_abort(driver, fixtures, repository, report)
            elif args.suite == "hosted-fork-ui":
                from native_scenarios import hosted_fork_requests
                repository = fixtures.repository()
                repo_id = open_ui(driver, repository)
                hosted_fork_requests(driver, fixtures, repository, report)
            elif args.suite == "hosted-fork-remote":
                from native_fork_remote_scenarios import hosted_fork_remote_attachment
                repository = fixtures.repository()
                repo_id = open_ui(driver, repository)
                hosted_fork_remote_attachment(driver, fixtures, repository, report)
            elif args.suite == "feature-rebase":
                from native_feature_rebase_scenarios import feature_rebase_on_configured_development
                repository, repo_id = feature_rebase_on_configured_development(driver, fixtures, report)
            elif args.suite == "merge-rebase-review":
                from native_feature_rebase_scenarios import merge_preserving_rebase_review
                repository, repo_id = merge_preserving_rebase_review(driver, fixtures, report)
            elif args.suite == "discard-busy":
                from native_discard_subset_scenarios import discard_row_during_stage
                repository, repo_id = discard_row_during_stage(driver, fixtures, report)
            elif args.suite == "discard-subset":
                from native_discard_subset_scenarios import discard_root_subset
                repository, repo_id = discard_root_subset(driver, fixtures, report)
            elif args.suite == "discard-deletion":
                from native_discard_subset_scenarios import discard_nested_deletion
                repository, repo_id = discard_nested_deletion(driver, fixtures, report)
            elif args.suite == "discard-stale-review":
                from native_discard_subset_scenarios import discard_single_stale_review
                repository, repo_id = discard_single_stale_review(driver, fixtures, report)
            elif args.suite == "discard-large":
                from native_discard_subset_scenarios import discard_large_untracked_batch
                repository, repo_id = discard_large_untracked_batch(driver, fixtures, report)
            elif args.suite == "discard-limit":
                from native_discard_subset_scenarios import discard_file_size_limit
                repository, repo_id = discard_file_size_limit(driver, fixtures, report)
            elif args.suite == "submodule-initialize":
                from native_submodule_initialize_scenarios import initialize_one_submodule
                repository, repo_id = initialize_one_submodule(driver, fixtures, report)
            elif args.suite == "submodule-update":
                from native_submodule_update_scenarios import update_one_submodule
                repository, repo_id = update_one_submodule(driver, fixtures, report)
            elif args.suite == "stash-review":
                from native_stash_review_scenarios import stash_review_workflows
                repository, repo_id = stash_review_workflows(driver, fixtures, report)
            elif args.suite == "stash-selection":
                from native_stash_review_scenarios import (
                    stash_apply_collision_scope, stash_selection_pagination, stash_selection_scope, stash_untracked_whole_checkout,
                )
                stash_untracked_whole_checkout(driver, fixtures, report)
                stash_selection_pagination(driver, fixtures, report)
                stash_selection_scope(driver, fixtures, report)
                stash_apply_collision_scope(driver, fixtures, report)
                repository, repo_id = stash_apply_collision_scope(
                    driver, fixtures, report, saved_as_tracked=True,
                )
            elif args.suite == "stash-clear":
                from native_scenarios import clear_stash_stack_preserves_every_object
                repository, repo_id = clear_stash_stack_preserves_every_object(driver, fixtures, report)
            elif args.suite == "autosquash-amend":
                from native_scenarios import (
                    amended_commit_recovery_history, autosquash_amend_message,
                    prepare_fixup_from_staged,
                )
                repository, repo_id = autosquash_amend_message(driver, fixtures, report)
                repository, repo_id = prepare_fixup_from_staged(driver, fixtures, report)
                repository, repo_id = amended_commit_recovery_history(driver, fixtures, report)
            elif args.suite == "signed-tag":
                from native_signed_tag_scenarios import signed_tag_creation
                repository, repo_id = signed_tag_creation(driver, fixtures, report)
            elif args.suite == "signed-commit":
                from native_commit_signing_scenarios import signed_commit_creation
                repository, repo_id = signed_commit_creation(driver, fixtures, report)
            elif args.suite == "empty-commit":
                from native_empty_commit_scenarios import empty_commit_policy
                repository, repo_id = empty_commit_policy(driver, fixtures, report)
            elif args.suite == "lfs-lock-actions":
                from native_lfs_lock_ui_scenarios import lfs_lock_dialog_actions
                repository, repo_id = lfs_lock_dialog_actions(driver, fixtures, report)
            elif args.suite == "file-history":
                from native_scenarios import (
                    blame_parent_follows_rename, blame_read_acceptance, bounded_file_history_reads, commit_preview_output,
                    file_history_tracks_renames,
                )
                from native_tracked_file_search_scenarios import (
                    deleted_file_history_from_exact_path, tracked_file_search_during_merge,
                )
                progress.enter_phase("commit-preview-output")
                repository, repo_id = commit_preview_output(driver, fixtures, report)
                progress.enter_phase("file-history-renames")
                file_history_tracks_renames(driver, fixtures, report)
                progress.enter_phase("blame-parent-rename")
                blame_parent_follows_rename(driver, fixtures, report)
                bounded_file_history_reads(driver, fixtures, report, enter_phase=progress.enter_phase)
                blame_read_acceptance(driver, fixtures, report, enter_phase=progress.enter_phase)
                progress.enter_phase("tracked-file-search-during-merge")
                tracked_file_search_during_merge(driver, fixtures, report)
                progress.enter_phase("deleted-file-history")
                repository, repo_id = deleted_file_history_from_exact_path(driver, fixtures, report)
            elif args.suite == "patch-export":
                from native_patch_export_scenarios import patch_export_scope
                repository, repo_id = patch_export_scope(driver, fixtures, report)
            elif args.suite == "bundle-incremental-export":
                from native_incremental_bundle_scenarios import incremental_bundle_export
                repository, repo_id = incremental_bundle_export(driver, fixtures, report)
            elif args.suite == "commit-source-zip":
                from native_source_zip_scenarios import source_zip
                repository, repo_id = source_zip(driver, fixtures, report)
            elif args.suite in ("revision-comparison", "comparison-patch"):
                from native_revision_comparison_scenarios import revision_comparison
                repository, repo_id = revision_comparison(
                    driver, fixtures, report, export_patch=args.suite == "comparison-patch",
                )
            elif args.suite == "branch-picker-exact":
                from native_branch_picker_scenarios import branch_picker_exact
                repository, repo_id = branch_picker_exact(driver, fixtures, report)
            elif args.suite == "previous-branch":
                from native_previous_branch_scenarios import previous_branch
                repository, repo_id = previous_branch(driver, fixtures, report)
            elif args.suite == "tag-preview":
                from native_tag_preview_scenarios import tag_preview
                repository, repo_id = tag_preview(driver, fixtures, report)
            elif args.suite == "history-depth":
                from native_deferred_review_scenarios import deferred_review_workflows
                repository, repo_id = deferred_review_workflows(driver, fixtures, report, history_only=True)
            elif args.suite == "file-menu-copy":
                from native_tracked_file_search_scenarios import copy_file_paths_from_native_menus
                repository, repo_id = copy_file_paths_from_native_menus(driver, fixtures, report)
            elif args.suite == "tracked-file-search":
                from native_tracked_file_search_scenarios import deleted_file_history_from_exact_path, tracked_file_search_during_merge
                tracked_file_search_during_merge(driver, fixtures, report)
                repository, repo_id = deleted_file_history_from_exact_path(driver, fixtures, report)
            elif args.suite == "diff-line-selection":
                from native_diff_line_selection_scenarios import diff_line_selection
                repository, repo_id = diff_line_selection(driver, fixtures, report)
            elif args.suite == "commit-rewrite":
                from native_commit_rewrite_scenarios import reviewed_commit_rewrite
                repository, repo_id = reviewed_commit_rewrite(driver, fixtures, report)
            elif args.suite == "file-review-scope":
                from native_file_review_scope_scenarios import file_review_scope
                repository, repo_id = file_review_scope(driver, fixtures, report)
            elif args.suite == "first-status":
                from native_first_status_scenarios import first_status
                repository, repo_id = first_status(driver, fixtures, report)
            elif args.suite == "repository-creation-scope":
                from native_repository_creation_scenarios import repository_creation_scope
                repository, repo_id = repository_creation_scope(driver, fixtures, report)
            elif args.suite == "repository-open-scope":
                from native_repository_open_scenarios import repository_open_scope
                repository, repo_id = repository_open_scope(driver, fixtures, report)
            elif args.suite == "working-tree-recaps":
                from native_unstaged_summary_scenarios import unstaged_summary_workflow
                repository, repo_id = unstaged_summary_workflow(driver, fixtures, report)
            elif args.suite == "detached-checkout":
                from native_detached_checkout_scenarios import reviewed_detached_checkout
                repository, repo_id = reviewed_detached_checkout(driver, fixtures, report)
            elif args.suite == "bisect-voting":
                from native_detached_checkout_scenarios import bisect_voting_and_results
                repository, repo_id = bisect_voting_and_results(driver, fixtures, report)
            elif args.suite == "diff-rendering":
                from native_diff_line_selection_scenarios import wrapped_diff_rendering
                repository, repo_id = wrapped_diff_rendering(driver, fixtures, report)
            elif args.suite == "application-update-consent":
                from native_application_updates_scenarios import application_update_consent
                repository, repo_id = application_update_consent(driver, fixtures, report)
            elif args.suite == "checkout-snapshot":
                from native_checkout_snapshot_scenarios import coherent_checkout_snapshot
                repository, repo_id = coherent_checkout_snapshot(driver, fixtures, report)
            elif args.suite == "checkout-responsiveness":
                from native_comparison_responsiveness_scenarios import checkout_responsiveness
                repository, repo_id = checkout_responsiveness(driver, fixtures, report)
            elif args.suite == "worktree-reservation":
                from native_worktree_scenarios import reserved_branch_guidance
                repository, repo_id = reserved_branch_guidance(driver, fixtures, report)
            elif args.suite == "comparison-line-budget":
                from native_comparison_budget_scenarios import working_directory_comparison_budget
                repository, repo_id = working_directory_comparison_budget(driver, fixtures, report)
            elif args.suite == "commit-coauthors":
                from native_commit_coauthor_scenarios import commit_with_coauthors
                repository, repo_id = commit_with_coauthors(driver, fixtures, report)
            elif args.suite == "comparison-responsiveness":
                from native_comparison_responsiveness_scenarios import comparison_responsiveness
                repository, repo_id = comparison_responsiveness(driver, fixtures, report)
            elif args.suite == "stash-responsiveness":
                from native_comparison_responsiveness_scenarios import stash_responsiveness
                repository, repo_id = stash_responsiveness(driver, fixtures, report)
            elif args.suite == "commit-responsiveness":
                from native_comparison_responsiveness_scenarios import commit_responsiveness
                repository, repo_id = commit_responsiveness(driver, fixtures, report)
            elif args.suite == "history-control-responsiveness":
                from native_comparison_responsiveness_scenarios import history_control_responsiveness
                repository, repo_id = history_control_responsiveness(driver, fixtures, report)
            elif args.suite == "local-mutation-responsiveness":
                from native_comparison_responsiveness_scenarios import local_mutation_responsiveness
                repository, repo_id = local_mutation_responsiveness(driver, fixtures, report)
            elif args.suite == "ignore-responsiveness":
                from native_comparison_responsiveness_scenarios import ignore_responsiveness
                repository, repo_id = ignore_responsiveness(driver, fixtures, report)
            elif args.suite == "watcher-checkout":
                from native_watcher_scenarios import watcher_checkout
                repository, repo_id = watcher_checkout(driver, fixtures, report)
            elif args.suite == "watcher-reftable":
                from native_watcher_scenarios import watcher_reftable
                repository, repo_id = watcher_reftable(driver, fixtures, report)
            elif args.suite == "watcher-shallow-history":
                from native_watcher_scenarios import watcher_shallow_history
                repository, repo_id = watcher_shallow_history(driver, fixtures, report)
            elif args.suite == "conflict-navigation":
                from native_conflict_navigation_scenarios import conflict_navigation
                repository, repo_id = conflict_navigation(driver, fixtures, report)
            elif args.suite == "reference-copy":
                from native_scenarios import copy_reference_namespaces
                progress.enter_phase("reference-copy")
                repository, repo_id = copy_reference_namespaces(driver, fixtures, report)
            elif args.suite == "reference-hover":
                from native_scenarios import reference_hover_stability
                repository = fixtures.repository("reference-hover-home", commits=1)
                reference_hover_stability(driver, fixtures, repository, report)
                repo_id = driver.invoke("open_repository", path=str(repository))["id"]
            elif args.suite == "configured-tools":
                repository = fixtures.repository("configured-tools-home")
                repo_id = open_ui(driver, repository)
            elif args.suite == "gitlab-fork-ui":
                repository = fixtures.repository("gitlab-fork-ui")
                repo_id = open_ui(driver, repository)
            elif args.suite == "gitlab-connect":
                from native_gitlab_scenarios import gitlab_catalogue
                repository = fixtures.repository("gitlab-connect")
                repo_id = open_ui(driver, repository)
                progress.enter_phase("gitlab-connect")
                gitlab_catalogue(driver, fixtures, repository, report, connect_only=True)
            elif args.suite == "gitlab-connect-refused":
                from native_gitlab_scenarios import gitlab_catalogue
                repository = fixtures.repository("gitlab-connect-refused")
                repo_id = open_ui(driver, repository)
                progress.enter_phase("gitlab-connect-refused")
                # Hold a reserved loopback port without a listener. There is
                # no server to receive an HTTP request or any credential.
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reserved:
                    reserved.bind(("127.0.0.1", 0))
                    origin = f"https://127.0.0.1:{reserved.getsockname()[1]}"
                    gitlab_catalogue(driver, fixtures, repository, report, refused_origin=origin)
            else:
                repository, repo_id = smoke(driver, fixtures, report, hold_packed_status=args.suite == "watcher-refresh")
            if outside is not None:
                view = driver.invoke("refresh_repository", repoId=repo_id)
                for field in ("name", "email"):
                    expected = fixtures.git(repository, "config", "user." + field)
                    assert expected != fixtures.git(outside, "config", "user." + field)
                    assert view["identity"][field] == expected, (field, view["identity"], expected)
                report["scenarios"].append("native-inherited-config-file-cannot-shadow-selected-identity")
            if args.suite in ("gitlab", "gitlab-connect-after-smoke"):
                progress.enter_phase("gitlab-catalogue")
                from native_gitlab_scenarios import gitlab_catalogue
                gitlab_catalogue(driver, fixtures, repository, report,
                                  connect_only=args.suite == "gitlab-connect-after-smoke")
                if args.suite == "gitlab":
                    from native_gitlab_fork_scenarios import prove_stale_navigation_replacement
                    prove_stale_navigation_replacement(driver, report)
            if args.suite == "gitlab-fork-ui":
                progress.enter_phase("gitlab-fork-ui")
                from native_gitlab_fork_scenarios import gitlab_reviewed_forks, prove_stale_navigation_replacement
                prove_stale_navigation_replacement(driver, report)
                gitlab_reviewed_forks(driver, fixtures, repository, report)
            if args.suite == "integrity-ui":
                progress.enter_phase("integrity-ui")
                from native_integrity_scenarios import (
                    cancelled_integrity_ui,
                    damaged_integrity_ui,
                    healthy_integrity_maintenance_ui,
                )
                damaged_integrity_ui(driver, fixtures, report)
                healthy_integrity_maintenance_ui(driver, fixtures, report)
                cancelled_integrity_ui(driver, fixtures, report)
            if args.suite == "file-tools":
                from native_file_tool_scenarios import file_tools
                file_tools(driver, fixtures, repository, report, enter_phase=progress.enter_phase)
            if args.suite == "configured-tools":
                from native_configured_tool_scenarios import configured_tools
                progress.enter_phase("configured-tools")
                configured_tools(driver, fixtures, repository, report)
            if args.suite == "merge-preview":
                from native_scenarios import committed_merge_preview
                committed_merge_preview(driver, fixtures, repository, report)
            if args.suite == "file-media":
                from native_media_scenarios import file_media_comparisons
                file_media_comparisons(driver, fixtures, repository, report)
            if args.suite == "lfs-counts":
                from native_scenarios import lfs_checkout_counts
                lfs_checkout_counts(driver, fixtures, report, review_preferences=True)
            if args.suite == "lfs-snapshot-timeout":
                from native_lfs_snapshot_scenarios import lfs_snapshot_timeout
                lfs_snapshot_timeout(driver, fixtures, report)
            if args.suite == "recovery":
                from native_editor_recovery_scenarios import editor_draft_recovery
                editor_draft_recovery(driver, fixtures, repository, report)
            if args.suite in ("full", "environment"):
                from native_scenarios import full_toolkit
                progress.enter_phase("full-toolkit")
                print("Native acceptance: smoke passed; exercising the full toolkit.", file=sys.stderr, flush=True)
                full_toolkit(driver, fixtures, repository, repo_id, report, progress.enter_phase)
                print("Native acceptance: toolkit passed; exercising review and setup workflows.", file=sys.stderr, flush=True)
            if args.suite == "incoming-links":
                progress.enter_phase("incoming-links")
                from native_incoming_link_scenarios import incoming_repository_links
                incoming_repository_links(driver, fixtures, repository, report)
            if args.suite == "application-updates":
                progress.enter_phase("application-updates")
                from native_application_updates_scenarios import application_updates_workflow
                application_updates_workflow(driver, fixtures, report)
            if args.suite in ("full", "environment", "worktrees"):
                progress.enter_phase("occupied-worktree-navigation")
                from native_worktree_scenarios import occupied_branch_navigation, worktree_recovery_before_removal
                worktree_recovery_before_removal(driver, fixtures, report)
                occupied_branch_navigation(driver, fixtures, report)
            if args.suite in ("full", "environment", "setup-keyboard"):
                progress.enter_phase("setup-keyboard")
                from native_setup_keyboard_scenarios import setup_keyboard_isolation
                setup_keyboard_isolation(driver, fixtures, report)
            if args.suite in ("full", "environment", "setup-keyboard"):
                progress.enter_phase("saved-workspace-recovery")
                from native_workspace_edit_scenarios import saved_workspace_repository_workflow
                saved_workspace_repository_workflow(driver, fixtures, report)
            if args.suite in ("full", "environment", "remote-reviews"):
                progress.enter_phase("remote-reviews")
                from native_remote_review_scenarios import remote_review_workflows
                remote_review_workflows(driver, fixtures, report)
            if args.suite == "transport-error-guidance":
                progress.enter_phase("transport-error-guidance")
                from native_scenarios import authenticated_push_rejection, local_remote_quoted_targets, local_remote_tls_words
                baseline = fixtures.repository("transport-guidance-baseline", commits=2)
                open_ui(driver, baseline)
                local_remote_quoted_targets(driver, fixtures, baseline, report)
                local_remote_tls_words(driver, fixtures, baseline, report)
                authenticated_push_rejection(driver, fixtures, baseline, report)
            progress.enter_phase("final-evidence")
            if outside is not None:
                assert (outside / ".git/index").read_bytes() == outside_index
                assert fixtures.git(outside, "rev-parse", "HEAD") == outside_head
                assert (outside / "fixture.txt").read_bytes() == b"unselected outside contents\n"
                assert (outside / ".git/config").read_bytes() == outside_config
                report["scenarios"].append("native-inherited-git-environment-cannot-redirect-repositories-or-paths")
            if args.suite == "performance":
                progress.enter_phase("performance")
                performance(driver, fixtures, report)
                progress.enter_phase("final-evidence")
            driver.screenshot(output / "desktop.png")
            report["passed"] = True
    except Exception:
        progress.note_failure()
        report["failure"] = traceback.format_exc()
        if driver and driver.session:
            try:
                driver.screenshot(output / "failure.png")
            except Exception:
                pass
    finally:
        if private_xauthority_set:
            if original_xauthority is None:
                os.environ.pop("XAUTHORITY", None)
            else:
                os.environ["XAUTHORITY"] = original_xauthority
        progress.enter_phase("cleanup")
        if driver:
            if driver.native_pointer_deliveries:
                report['nativePointerDeliveries'] = driver.native_pointer_deliveries
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
        if not report["passed"]:
            progress.note_failure()
            report["failurePhase"] = progress.failure_phase
        report["timing"] = progress.report_timing()
        write_native_receipt(output / "report.json", report)
        progress.finish(report["passed"])
    print(json.dumps(report, indent=2), flush=True)
    print(f"Evidence: {output}", flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
