"""Sample an application window on a private, window-manager-free Xvfb display."""

import ctypes as c
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

x = c.CDLL("libX11.so.6")
XID = c.c_ulong
ptr = c.c_void_p
def bind(name, result, *args):
    f = getattr(x, name)
    f.restype = result
    f.argtypes = args
    return f

open_display = bind("XOpenDisplay", ptr, c.c_char_p)
root_window = bind("XDefaultRootWindow", XID, ptr)
query_tree = bind("XQueryTree", c.c_int, ptr, XID, c.POINTER(XID), c.POINTER(XID), c.POINTER(c.POINTER(XID)), c.POINTER(c.c_uint))
fetch_name = bind("XFetchName", c.c_int, ptr, XID, c.POINTER(c.c_char_p))
get_image = bind("XGetImage", ptr, ptr, XID, c.c_int,c.c_int,c.c_uint,c.c_uint,c.c_ulong,c.c_int)
get_pixel = bind("XGetPixel", c.c_ulong, ptr, c.c_int, c.c_int)
destroy = bind("XDestroyImage", c.c_int, ptr)
free = bind("XFree", c.c_int, ptr)
class XErrorEvent(c.Structure):
    _fields_ = [('type', c.c_int), ('display', ptr), ('resourceid', XID),
                ('serial', c.c_ulong), ('error_code', c.c_ubyte),
                ('request_code', c.c_ubyte), ('minor_code', c.c_ubyte)]

handler_type = c.CFUNCTYPE(c.c_int, ptr, c.POINTER(XErrorEvent))
unexpected = []

@handler_type
def handle_xerror(_display, event):
    code = event.contents.error_code
    # A window can disappear between QueryTree and XFetchName / XGetImage.
    if code not in (3, 8, 9):
        unexpected.append(code)
    return 0

bind("XSetErrorHandler", ptr, handler_type)(handle_xerror)
display = open_display(None)
if not display:
    raise SystemExit("Could not connect to the private X11 display")
root = root_window(display)

def sampled_window():
    if unexpected:
        raise SystemExit(f"Unexpected X11 errors: {unexpected}")
    root_return, parent, children, n = XID(), XID(), c.POINTER(XID)(), c.c_uint()
    if not query_tree(display, root, c.byref(root_return), c.byref(parent), c.byref(children), c.byref(n)):
        raise SystemExit("Could not inspect the private X11 display")
    handles = list(children[:n.value]) if children else []
    if children: free(children)
    for window in handles:
        title = c.c_char_p()
        if not fetch_name(display, window, c.byref(title)) or not title.value:
            continue
        label = title.value.decode(errors="replace")
        free(title)
        if "Git Khronos" not in label:
            continue
        # Sample a central rectangle, ignoring the window manager (there is none).
        image = get_image(display, window, 240, 100, 400, 450, (1 << 64) - 1, 2)
        if not image:
            continue
        pixels = [get_pixel(image, i, j) for i in range(0, 400, 4) for j in range(0, 450, 4)]
        destroy(image)
        if unexpected:
            raise SystemExit(f"Unexpected X11 errors: {unexpected}")
        if len(set(pixels)) >= 12:
            return window, label, pixels


def painted_window():
    sample = sampled_window()
    if sample is not None:
        _, label, pixels = sample
        return label, len(set(pixels))

def wait_for(probe, label, process=None, timeout=12):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if process is not None and process.poll() is not None:
            raise SystemExit(f"Installed command exited while waiting for {label} (status {process.returncode})")
        result = probe()
        if result:
            return result
        time.sleep(.15)
    raise SystemExit(f"Could not observe {label}")


def owned_renderer(app, retired):
    children = set()
    for task in Path(f"/proc/{app.pid}/task").glob("*/children"):
        try:
            children.update(map(int, task.read_text().split()))
        except FileNotFoundError:
            continue
    found = []
    for pid in children - retired:
        try:
            fd = os.pidfd_open(pid)
        except ProcessLookupError:
            continue
        owned = False
        try:
            name = Path(os.readlink(f"/proc/{pid}/exe")).name
            parents = Path(f"/proc/{pid}/status").read_text().splitlines()
            owned = name == "WebKitWebProcess" and ["PPid:", str(app.pid)] in [line.split() for line in parents]
            if owned:
                found.append((pid, fd))
        except FileNotFoundError:
            pass
        finally:
            if not owned:
                os.close(fd)
    if len(found) == 1:
        return found[0]
    for _, fd in found:
        os.close(fd)
    if found:
        raise SystemExit("Refusing to terminate an ambiguous WebKit child")


def exercise_renderer_input(app):
    """An old compositor frame can be nonblank before its replacement is usable."""
    window, label, closed = wait_for(sampled_window, "painted renderer to exercise", app)
    library = c.CDLL("libXtst.so.6")
    send_key = library.XTestFakeKeyEvent
    send_key.argtypes = [ptr, c.c_uint, c.c_int, c.c_ulong]
    send_key.restype = c.c_int
    focus = bind("XSetInputFocus", c.c_int, ptr, XID, c.c_int, c.c_ulong)
    flush = bind("XFlush", c.c_int, ptr)
    keycode = bind("XKeysymToKeycode", c.c_uint8, ptr, XID)
    control, p, escape = (keycode(display, sym) for sym in (0xffe3, ord("p"), 0xff1b))
    if not all((control, p, escape)):
        raise SystemExit("Private display did not map the renderer probe keys")
    focus(display, window, 2, 0)  # RevertToParent, CurrentTime.

    def chord(*keys):
        for key in keys:
            if not send_key(display, key, 1, 0):
                raise SystemExit("Could not press a private-display probe key")
        for key in reversed(keys):
            if not send_key(display, key, 0, 0):
                raise SystemExit("Could not release a private-display probe key")
        flush(display)

    def changed(left, right):
        return sum(a != b for a, b in zip(left, right)) / len(left)

    def observe_popup():
        sample = sampled_window()
        if sample and sample[0] == window and changed(closed, sample[2]) >= .2:
            return sample[2]
        # This only opens a read-only overlay. A startup frame can ignore
        # input before the Angular event handler runs. Never send Enter.
        chord(control, p)

    opened = wait_for(observe_popup, "a fresh renderer responding to Ctrl+P", app)

    def observe_close():
        sample = sampled_window()
        if sample and sample[0] == window and changed(opened, sample[2]) >= .2 and changed(closed, sample[2]) <= .05:
            return label, len(set(sample[2]))
        chord(escape)

    return wait_for(observe_close, "a fresh renderer responding to Escape", app)


def renderer_recovery():
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise SystemExit("Renderer recovery requires Linux pidfd support in Python")
    # Cwd, display, session bus and profile are private to this probe.
    with open("renderer.log", "xb") as log:
        def launch():
            return subprocess.Popen(["/usr/bin/git-khronos"], stderr=log)

        app = launch()
        try:
            exercise_renderer_input(app)
            retired = set()
            for attempt in range(4):
                pid, fd = wait_for(lambda: owned_renderer(app, retired), "owned WebKit child", app)
                retired.add(pid)
                try:
                    # The descriptor pins the identity even if the numeric PID is reused.
                    signal.pidfd_send_signal(fd, signal.SIGKILL)
                finally:
                    os.close(fd)
                if attempt < 3:
                    # A nonblank window alone cannot prove the host requested recovery.
                    wait_for(lambda: Path("renderer.log").read_text(errors="replace").count("reloading.") == attempt + 1,
                             "native reload decision", app)
                    next_pid, next_fd = wait_for(lambda: owned_renderer(app, retired), "new WebKit child", app)
                    os.close(next_fd)
                    title, colors = exercise_renderer_input(app)
                    print(f"Recovery {attempt + 1}: renderer {next_pid}, window {title!r}, {colors} colors.", flush=True)
            if app.wait(timeout=12) != 1 or "keeps stopping; closing" not in Path("renderer.log").read_text(errors="replace"):
                raise SystemExit("The fourth renderer crash did not close the app through its recovery policy")
            app = launch()
            title, colors = wait_for(painted_window, "fresh nonblank window", app)
            print(f"Fresh launch after repeated renderer crashes: {title!r}, {colors} colors.")
        finally:
            if app.poll() is None:
                app.terminate()
                try:
                    app.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    app.kill()
                    app.wait()
            print(Path("renderer.log").read_text(errors="replace"), file=sys.stderr, end="")


mode = sys.argv[1]
if mode == "renderer-recovery":
    renderer_recovery()
else:
    process = None
    if mode == "desktop":
        subprocess.run(["gio", "launch", "/usr/share/applications/git-khronos.desktop"], check=True, timeout=10)
    elif mode == "command":
        process = subprocess.Popen(["/usr/bin/git-khronos"])
    else:
        raise SystemExit("Unknown launcher fixture mode")
    label, colors = wait_for(painted_window, f"nonuniform {mode} window", process, timeout=35)
    print(f"{mode} rendered X11 window {label!r}, sampled {colors} distinct colors.")
