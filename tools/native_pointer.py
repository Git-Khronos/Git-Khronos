"""Right-button input restricted to the acceptance harness's private Xvfb."""
import ctypes as c
import ctypes.util
import os
import re
from contextlib import contextmanager

from native_window_close import _WindowAttributes, _visible_regular_window, owned_application_pid


class _X11Pointer:
    def __init__(self, display_name):
        x11_name = ctypes.util.find_library('X11')
        xtest_name = ctypes.util.find_library('Xtst')
        if not x11_name or not xtest_name:
            raise RuntimeError('libX11 and libXtst are required for native pointer acceptance')
        self.x = c.CDLL(x11_name)
        self.xtest = c.CDLL(xtest_name)
        x, xtest = self.x, self.xtest
        display, window = c.c_void_p, c.c_ulong
        x.XOpenDisplay.argtypes = [c.c_char_p]; x.XOpenDisplay.restype = display
        x.XCloseDisplay.argtypes = [display]
        x.XDefaultScreen.argtypes = [display]; x.XDefaultScreen.restype = c.c_int
        x.XDisplayWidth.argtypes = [display, c.c_int]; x.XDisplayWidth.restype = c.c_int
        x.XDisplayHeight.argtypes = [display, c.c_int]; x.XDisplayHeight.restype = c.c_int
        x.XDefaultRootWindow.argtypes = [display]; x.XDefaultRootWindow.restype = window
        x.XInternAtom.argtypes = [display, c.c_char_p, c.c_int]; x.XInternAtom.restype = c.c_ulong
        x.XGetWindowAttributes.argtypes = [display, window, c.POINTER(_WindowAttributes)]
        x.XGetWindowProperty.argtypes = [display, window, c.c_ulong, c.c_long, c.c_long,
                                        c.c_int, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_int),
                                        c.POINTER(c.c_ulong), c.POINTER(c.c_ulong), c.POINTER(c.c_void_p)]
        x.XQueryPointer.argtypes = [display, window, c.POINTER(window), c.POINTER(window),
                                    c.POINTER(c.c_int), c.POINTER(c.c_int), c.POINTER(c.c_int),
                                    c.POINTER(c.c_int), c.POINTER(c.c_uint)]
        x.XFree.argtypes = [c.c_void_p]
        x.XSync.argtypes = [display, c.c_int]
        x.XSetErrorHandler.argtypes = [c.c_void_p]; x.XSetErrorHandler.restype = c.c_void_p
        xtest.XTestQueryExtension.argtypes = [display] + [c.POINTER(c.c_int)] * 4
        xtest.XTestFakeMotionEvent.argtypes = [display, c.c_int, c.c_int, c.c_int, c.c_ulong]
        xtest.XTestFakeButtonEvent.argtypes = [display, c.c_uint, c.c_int, c.c_ulong]

        self.errors = []
        error_handler_type = c.CFUNCTYPE(c.c_int, display, c.c_void_p)

        @error_handler_type
        def error_handler(_display, _error):
            self.errors.append(True)
            return 0

        self.error_handler = error_handler
        self.old_handler = x.XSetErrorHandler(c.cast(error_handler, c.c_void_p))
        self.display = x.XOpenDisplay(display_name.encode())
        if not self.display:
            x.XSetErrorHandler(self.old_handler)
            raise RuntimeError('The owned Xvfb display is unavailable')
        try:
            event = c.c_int(); error = c.c_int(); major = c.c_int(); minor = c.c_int()
            if not xtest.XTestQueryExtension(self.display, c.byref(event), c.byref(error),
                                             c.byref(major), c.byref(minor)):
                raise RuntimeError('The owned Xvfb display does not provide XTEST')
            self.screen = x.XDefaultScreen(self.display)
            self.root = x.XDefaultRootWindow(self.display)
            self.sync()
        except Exception:
            self.close()
            raise

    def sync(self):
        self.x.XSync(self.display, 0)
        if self.errors:
            count = len(self.errors)
            self.errors.clear()
            raise RuntimeError(f'The owned Xvfb display rejected {count} pointer request(s)')

    def close(self):
        try:
            self.x.XCloseDisplay(self.display)
        finally:
            self.x.XSetErrorHandler(self.old_handler)

    def position(self):
        root = c.c_ulong(); child = c.c_ulong(); root_x = c.c_int(); root_y = c.c_int()
        window_x = c.c_int(); window_y = c.c_int(); mask = c.c_uint()
        if not self.x.XQueryPointer(self.display, self.root, c.byref(root), c.byref(child),
                                    c.byref(root_x), c.byref(root_y), c.byref(window_x),
                                    c.byref(window_y), c.byref(mask)):
            raise RuntimeError('Could not inspect the owned Xvfb pointer')
        self.sync()
        if mask.value & 0x1f00:
            raise RuntimeError('Refusing to move the owned pointer while a button is held')
        return root_x.value, root_y.value, child.value

    def move(self, x, y):
        self.position()
        if (not isinstance(x, int) or not isinstance(y, int)
            or x < 0 or y < 0 or x >= self.x.XDisplayWidth(self.display, self.screen)
            or y >= self.x.XDisplayHeight(self.display, self.screen)):
            raise RuntimeError('The requested pointer location is outside the owned Xvfb screen')
        if not self.xtest.XTestFakeMotionEvent(self.display, self.screen, x, y, 0):
            raise RuntimeError('The owned Xvfb pointer could not be moved')
        self.sync()

    def require_owned_window(self, x, y, pid):
        actual_x, actual_y, target = self.position()
        if (actual_x, actual_y) != (x, y) or not target:
            raise RuntimeError('The owned pointer did not reach an application window')
        attributes = _WindowAttributes()
        atom = self.x.XInternAtom(self.display, b'_NET_WM_PID', 0)
        actual = c.c_ulong(); format = c.c_int(); count = c.c_ulong()
        remaining = c.c_ulong(); data = c.c_void_p()
        have_attributes = self.x.XGetWindowAttributes(self.display, target, c.byref(attributes))
        status = self.x.XGetWindowProperty(self.display, target, atom, 0, 1, 0, 6,
                                           c.byref(actual), c.byref(format), c.byref(count),
                                           c.byref(remaining), c.byref(data))
        try:
            owner = (c.cast(data, c.POINTER(c.c_ulong))[0]
                     if data.value and status == 0 and actual.value == 6 and format.value == 32
                     and count.value == 1 and remaining.value == 0 else None)
        finally:
            if data.value:
                self.x.XFree(data)
        self.sync()
        if not have_attributes or not _visible_regular_window(attributes) or owner != pid:
            raise RuntimeError('The pointer is not over the owned visible application window')
        return target

    def button(self, pressed):
        if not self.xtest.XTestFakeButtonEvent(self.display, 3, int(pressed), 0):
            raise RuntimeError('The owned Xvfb right-button event could not be sent')
        self.sync()


@contextmanager
def owned_right_press(owned_display, executable, x, y):
    """Press once on the owned app and always release, even after an uncertain press."""
    if not owned_display:
        raise RuntimeError('Native pointer input requires an owned private Xvfb display')
    display_name, server = owned_display
    if (not re.fullmatch(r':\d+', display_name) or not server
        or not isinstance(server.args, (list, tuple)) or tuple(server.args[:2]) != ('Xvfb', '-displayfd')
        or server.pid <= 1 or server.poll() is not None
        or os.getpgid(server.pid) != server.pid):
        raise RuntimeError('Refusing pointer input without the live, owned Xvfb process')
    pid = owned_application_pid(executable)
    pointer = _X11Pointer(display_name)
    try:
        pointer.move(x, y)
        target = pointer.require_owned_window(x, y, pid)
        if server.poll() is not None or owned_application_pid(executable) != pid:
            raise RuntimeError('The owned display or application changed before pointer input')
        try:
            pointer.button(True)
            yield {'pid': pid, 'windowId': target, 'x': x, 'y': y}
        finally:
            pointer.button(False)
    finally:
        pointer.close()
