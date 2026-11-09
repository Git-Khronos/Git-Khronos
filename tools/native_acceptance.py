#!/usr/bin/env python3
"""Exercise an extracted production .deb with W3C WebDriver; no app test hooks.

Requires tauri-driver, WebKitWebDriver, and (with --headless) Xvfb and libXtst.
Tests own all repositories/storage under TemporaryDirectory; never install the package.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
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
import uuid
from xml.sax.saxutils import quoteattr
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


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


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

    def click_scrolled_text(self, selector, text):
        """Scroll normally, verify the painted hit target, then click exactly once."""
        elements = self.script("return [...document.querySelectorAll(arguments[0])].filter(element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible' && !element.matches(':disabled') && !element.closest('[inert]') && element.textContent.trim() === arguments[1]);", selector, text)
        if len(elements) != 1:
            raise ValueError(f"Expected one enabled {selector!r} with text {text!r}, found {len(elements)}")
        element = elements[0]
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
          requestAnimationFrame(()=>requestAnimationFrame(()=>{
            const before=bounds();element.scrollIntoView({block:'center',inline:'nearest'});
            requestAnimationFrame(()=>requestAnimationFrame(()=>{
              const after=bounds();done({before,after,interactable:after.hitTarget});
            }));
          }));
        """, "args": [element]})
        if not isinstance(geometry, dict) or geometry.get("interactable") is not True:
            raise RuntimeError("The control is not interactable after ordinary scrolling: " + json.dumps(geometry))
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        # A failed/lost click reply is an uncertain action, never a reason to replay.
        self.request("POST", self.path(f"element/{identifier}/click"), {})
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
                with owned_right_press(self.owned_display, self.executable, geometry['x'], geometry['y']) as delivery:
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
            self.session = None

    def restart_application(self, args=None):
        """Close and relaunch only this fixture's exact packaged executable."""
        if not self.session or self.executable is None or not Path('/proc').is_dir():
            raise RuntimeError("Application restart requires an active owned Linux session")
        executable = self.executable

        def application_pid():
            found = []
            for link in Path('/proc').glob('[0-9]*/exe'):
                try:
                    if link.readlink() == executable:
                        found.append(int(link.parent.name))
                except (FileNotFoundError, ProcessLookupError, PermissionError):
                    continue
            if len(found) > 1:
                raise RuntimeError("Multiple processes match the owned application executable")
            return found[0] if found else None

        old_pid = application_pid()
        if old_pid is None:
            raise RuntimeError("The owned application process could not be identified")
        if self.session_bus_address:
            owner = self.single_instance_bus_call('GetConnectionUnixProcessID').splitlines()[-1].strip()
            if owner != 'uint32 ' + str(old_pid):
                raise RuntimeError('The single-instance bus name does not belong to the owned application')
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
        if self.session_bus_address:
            # Process exit and bus name release are separate observable events.
            # Never launch a second session while the old owner is still visible.
            self.wait_single_instance_release()
        if args is None:
            self.start(executable)
        else:
            self.start(executable, args=args)
        deadline = time.monotonic() + 10
        while True:
            new_pid = application_pid()
            if new_pid is not None:
                break
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


def checkpoint_lifecycle(driver, fixtures, repository, checkpoint, report):
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

    for key in ("external-loose", "external-packed"):
        fixtures.git(repository, "update-ref", "-d", names[key], oids[key])
        expected.pop(names[key])
        driver.wait(f"return !document.querySelector({json.dumps(row(key))})")
        assert checkpoint_refs(fixtures, repository) == expected

    driver.click(pill("moved"))
    driver.click_visible(".context-menu[role=menu] button.danger-item", "Delete checkpoint reference…")
    driver.wait("return !!document.querySelector('.checkpoint-confirmation-dialog .confirm-action:not(:disabled)')")
    confirmation = driver.script("return document.querySelector('.checkpoint-confirmation-dialog').textContent")
    assert names["moved"] in confirmation and oids["moved"][:7] in confirmation
    fixtures.git(repository, "update-ref", names["moved"], oids["replacement"], oids["moved"])
    expected[names["moved"]] = oids["replacement"]
    driver.wait("return !!document.querySelector('.checkpoint-confirmation-dialog .confirm-action:not(:disabled)')")
    driver.click_text(".checkpoint-confirmation-dialog button", "Delete checkpoint reference")
    driver.wait("""return document.querySelector('gc-error-toast [role=alert]')
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
            driver.wait(f"return document.querySelector({json.dumps(menu)})?.contains(document.activeElement)")
            driver.key("\ue004")
            driver.wait(f"return !document.querySelector({json.dumps(menu)})", 2)
            assert driver.script("return document.activeElement?.hasAttribute('data-native-menu-tab-target')"), \
                f"Tab from {menu} did not resume the normal focus order"
        finally:
            driver.script("document.querySelectorAll('[data-native-menu-tab-target]').forEach(element => element.removeAttribute('data-native-menu-tab-target'))")
    report["scenarios"].append("native-menu-tab-dismissal-preserves-sequential-focus")


def terminal_csp_rendering(driver, report):
    driver.click('[title="Open repository terminal (Alt+T or Ctrl+`)"]')
    driver.wait("return !!document.querySelector('gc-terminal-panel .xterm-screen')")
    session_id = driver.script("return document.querySelector('gc-terminal-panel .terminal-host').dataset.terminalId")
    command = (r"printf '\033[31mCSP_ANSI\033[0m \033[38;2;52;178;128mCSP_RGB\033[0m "
               r"\033[48;2;40;60;80mCSP_BG\033[0m\n'" + "\n")
    driver.invoke("write_terminal", sessionId=session_id, data=list(command.encode()))
    probe = driver.wait("""return (() => {
      const screen = document.querySelector('gc-terminal-panel .xterm-screen');
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
    driver.click('gc-terminal-panel [title="Close terminal tab"]')
    driver.wait("return !document.querySelector('gc-terminal-panel')")
    report["terminalRender"] = probe
    report["scenarios"].append("native-terminal-csp-font-and-colors")


def repository_file_discard_recovery(driver, fixtures, repository, repo_id, report):
    """Use only the packaged UI to delete and recover an owned untracked file."""
    file = repository / "native-recovery-file.bin"
    contents = b"owned native recovery\x00\xff\n"
    before_index = (repository / ".git/index").read_bytes()
    before_head = fixtures.git(repository, "rev-parse", "HEAD")
    file.write_bytes(contents)
    driver.wait('return !!document.querySelector(\'[aria-label="Stage native-recovery-file.bin"]\')')

    driver.click(".workspace-toggle")
    driver.click_text(".workspace-menu-actions [role=menuitem]", "Repository files")
    driver.wait("""return [...document.querySelectorAll('gc-workspace-center .file-entry')]
      .some(row => row.querySelector('code')?.textContent === 'native-recovery-file.bin')""")
    driver.click_text("gc-workspace-center .file-entry button", "Delete with recovery")
    driver.wait("return !!document.querySelector('gc-workspace-center [role=alertdialog]')")
    assert "Recovery History" in driver.script(
        "return document.querySelector('gc-workspace-center [role=alertdialog]').textContent"
    )
    driver.click_text("gc-workspace-center [role=alertdialog] button", "Delete file")
    driver.wait("""return document.querySelector('gc-workspace-center [role=status]')
      ?.textContent.includes('Deleted native-recovery-file.bin and saved it to Recovery History')""")
    assert not file.exists()
    driver.click_text("gc-workspace-center header button", "Close")

    driver.click('[aria-label="Main menu"]')
    driver.wait("""return [...document.querySelectorAll('.app-menu-popover [role=menuitem] strong')]
      .some(element => element.textContent.trim() === 'Recovery History')""")
    driver.click_text(".app-menu-popover [role=menuitem] strong", "Recovery History")
    driver.wait("""return !!document.querySelector(
      '.recovery-dialog .operation-captures[aria-label="Discarded changes"] button:not(:disabled)')""")
    driver.click_text(".recovery-dialog button", "Open discarded-change recovery…")
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
    assert not driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert file.read_bytes() == contents
    file.unlink()
    driver.click('[aria-label="Close recovery history"]')
    driver.wait('return !document.querySelector(\'[aria-label="Stage native-recovery-file.bin"]\')')
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].extend([
        "native-ui-repository-file-delete-and-recovery-history-roundtrip",
        "native-ui-changed-capture-refuses-reviewed-apply-and-removal",
        "native-ui-replaced-recovered-capture-blocks-discard-again",
    ])


def smoke(driver, fixtures, report):
    repository = fixtures.repository()
    checkpoints = checkpoint_fixture(fixtures, repository)
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
    repository_file_discard_recovery(driver, fixtures, repository, repo_id, report)
    checkpoint_lifecycle(driver, fixtures, repository, checkpoints, report)
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
    parser.add_argument("--suite", choices=("smoke", "full", "environment", "performance", "recovery", "gitlab", "file-tools"), default="smoke")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--inherited-git-environment", action="store_true",
                        help="Point inherited Git context variables at an owned outside repository for any suite")
    parser.add_argument("--output", type=Path, default=ROOT / "test-results/native")
    args = parser.parse_args()
    output = args.output.resolve() / f"{args.suite}-{time.time_ns()}"
    output.mkdir(parents=True)
    report = {"suite": args.suite, "scenarios": [], "passed": False,
              "inheritedGitEnvironment": args.suite == "environment" or args.inherited_git_environment,
              "platform": platform.platform(), "git": run("git", "--version"), "artifactsDirectory": str(output)}
    children = []
    driver = None
    temporary_directory = None
    try:
        for name in ("tauri-driver", "WebKitWebDriver", "dpkg-deb", "dbus-daemon", "dbus-send") + (("Xvfb",) if args.headless else ()) + (("readelf",) if args.suite == "gitlab" else ()):
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
        if args.suite == "environment" or args.inherited_git_environment:
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
        if args.suite == "gitlab":
            dependencies = run("dpkg-deb", "-f", str(package), "Depends")
            names = {alternative.strip().split()[0] for clause in dependencies.split(",")
                     for alternative in clause.split("|") if alternative.strip()}
            assert names & {"libssl3", "libssl3t64"}, dependencies
            dynamic = run("readelf", "-d", str(executable), env=fixtures.env | {"LC_ALL": "C"})
            needed = [line.split("Shared library: [", 1)[1].split("]", 1)[0]
                      for line in dynamic.splitlines() if "Shared library: [" in line]
            assert {"libssl.so.3", "libcrypto.so.3"} <= set(needed), needed
            report["nativeTlsPackage"] = {"depends": dependencies, "neededLibraries": needed}
        fixtures.env["TAURI_WEBVIEW_AUTOMATION"] = "true"
        with (output / "driver.log").open("w") as log:
            report["sessionBus"] = start_private_dbus(fixtures, children, log)
            owned_display = None
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
                owned_display = (fixtures.env["DISPLAY"], display)
            listen_port = port()
            native_port = port()
            application_env = fixtures.env.copy()
            if args.suite in ("full", "environment"):
                application_env.update(fixtures.terminal_environment())
                application_env.update(fixtures.history_environment())
                application_env.update(fixtures.hosting_environment(application_env.get("PATH")))
            if args.suite == "gitlab":
                from native_gitlab_scenarios import start_gitlab_fixture
                application_env.update(start_gitlab_fixture(fixtures, children, log, report))
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
            driver = Driver(f"http://127.0.0.1:{listen_port}", f"http://127.0.0.1:{native_port}",
                            session_bus_address=fixtures.env.get('DBUS_SESSION_BUS_ADDRESS'),
                            owned_display=owned_display)
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
            if args.suite == "gitlab":
                from native_gitlab_scenarios import gitlab_catalogue
                gitlab_catalogue(driver, fixtures, repository, report)
            if args.suite == "file-tools":
                from native_file_tool_scenarios import file_tools
                file_tools(driver, fixtures, repository, report)
            if args.suite == "recovery":
                from native_editor_recovery_scenarios import editor_draft_recovery
                editor_draft_recovery(driver, fixtures, repository, report)
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
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    print(f"Evidence: {output}", flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
