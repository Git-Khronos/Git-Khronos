"""Open or cancel one named GTK folder picker on the private acceptance display."""
import ctypes as c
import time
from pathlib import Path

from native_pointer import _X11Pointer, require_owned_xvfb
from native_window_close import _WindowAttributes, _visible_regular_window


class _PickerKeyboard(_X11Pointer):
    def __init__(self, display_name):
        super().__init__(display_name)
        x, display, window = self.x, c.c_void_p, c.c_ulong
        x.XQueryTree.argtypes = [display, window, c.POINTER(window), c.POINTER(window),
                                c.POINTER(c.POINTER(window)), c.POINTER(c.c_uint)]
        x.XGetInputFocus.argtypes = [display, c.POINTER(window), c.POINTER(c.c_int)]
        x.XSetInputFocus.argtypes = [display, window, c.c_int, c.c_ulong]
        x.XStringToKeysym.argtypes = [c.c_char_p]
        x.XStringToKeysym.restype = c.c_ulong
        x.XKeysymToKeycode.argtypes = [display, c.c_ulong]
        x.XKeysymToKeycode.restype = c.c_ubyte
        x.XkbKeycodeToKeysym.argtypes = [display, c.c_ubyte, c.c_int, c.c_int]
        x.XkbKeycodeToKeysym.restype = c.c_ulong
        self.xtest.XTestFakeKeyEvent.argtypes = [display, c.c_uint, c.c_int, c.c_ulong]

    def _tree(self, target):
        root = c.c_ulong(); parent = c.c_ulong(); count = c.c_uint(); children = c.POINTER(c.c_ulong)()
        status = self.x.XQueryTree(self.display, target, c.byref(root), c.byref(parent), c.byref(children), c.byref(count))
        try:
            if not status or count.value > 128:
                raise RuntimeError('Invalid owned Xvfb window tree')
            return parent.value, children[:count.value] if children else []
        finally:
            if children:
                self.x.XFree(children)

    def _property(self, target, name, value_type, length, bits):
        atom = self.x.XInternAtom(self.display, name, 0)
        actual = c.c_ulong(); fmt = c.c_int(); count = c.c_ulong(); remaining = c.c_ulong(); data = c.c_void_p()
        status = self.x.XGetWindowProperty(self.display, target, atom, 0, length, 0, value_type,
                                           c.byref(actual), c.byref(fmt), c.byref(count), c.byref(remaining), c.byref(data))
        try:
            if (status or not data.value or actual.value != value_type or fmt.value != bits or remaining.value
                or not 0 < count.value <= length * (4 if bits == 8 else 1)):
                return None
            if bits == 8:
                return c.string_at(data, count.value)
            return c.cast(data, c.POINTER(c.c_ulong))[0] if count.value == 1 else None
        finally:
            if data.value:
                self.x.XFree(data)

    def picker(self, title, pid):
        utf8 = self.x.XInternAtom(self.display, b'UTF8_STRING', 0)
        matches = []
        for target in self._tree(self.root)[1]:
            attributes = _WindowAttributes()
            if (self._property(target, b'_NET_WM_PID', 6, 1, 32) == pid
                and self._property(target, b'_NET_WM_NAME', utf8, 256, 8) == title.encode()
                and self.x.XGetWindowAttributes(self.display, target, c.byref(attributes))
                and _visible_regular_window(attributes)):
                matches.append(target)
        self.sync()
        if len(matches) > 1:
            raise RuntimeError('More than one named picker belongs to the owned application')
        return matches[0] if matches else None

    def require_focus(self, target):
        focus = c.c_ulong(); revert = c.c_int()
        self.x.XGetInputFocus(self.display, c.byref(focus), c.byref(revert))
        current = focus.value
        for _ in range(16):
            if current == target:
                self.sync()
                return
            if current in (0, 1, self.root):
                break
            current = self._tree(current)[0]
        raise RuntimeError('The keyboard focus is not within the owned folder picker')

    def focus_picker(self, target):
        self.x.XSetInputFocus(self.display, target, 2, 0)  # RevertToParent, CurrentTime
        self.sync()
        self.require_focus(target)

    def _code(self, name):
        keysym = self.x.XStringToKeysym(name.encode('ascii'))
        keycode = self.x.XKeysymToKeycode(self.display, keysym)
        if not keysym or not keycode or self.x.XkbKeycodeToKeysym(self.display, keycode, 0, 0) != keysym:
            raise RuntimeError(f'Unexpected fixture keyboard mapping for {name}')
        return keycode

    def key(self, target, name, modifier=None):
        self.require_focus(target)
        key = self._code(name)
        keys = [self._code(modifier)] if modifier else []
        keys.append(key)
        pressed = []
        try:
            for code in keys:
                pressed.append(code)
                if not self.xtest.XTestFakeKeyEvent(self.display, code, 1, 0):
                    raise RuntimeError('Could not send owned picker key press')
        finally:
            released = [self.xtest.XTestFakeKeyEvent(self.display, code, 0, 0) for code in reversed(pressed)]
            self.sync()
            if not all(released):
                raise RuntimeError('Could not release owned picker keys')


def _require_only_visible_folder(fixture_root, folder, from_initial_location):
    directory = Path(fixture_root).resolve(strict=True) / ('nearby' if from_initial_location else 'home')
    if (directory.is_symlink() or not directory.is_dir() or folder.parent != directory
        or folder.is_symlink() or not folder.is_dir()
        or [entry for entry in directory.iterdir() if not entry.name.startswith('.')] != [folder]):
        raise RuntimeError('Expected the requested folder to be the only visible entry in the owned fixture directory')


def respond_to_owned_picker(owned_display, resolve_owner, title, fixture_root, folder=None, *, from_initial_location=False):
    display, server = require_owned_xvfb(owned_display, 'picker')
    if folder is not None:
        folder = Path(folder)
        _require_only_visible_folder(fixture_root, folder, from_initial_location)
    pid = resolve_owner()
    keyboard = _PickerKeyboard(display)
    try:
        deadline = time.monotonic() + 8
        while True:
            if server.poll() is not None:
                raise RuntimeError('Owned picker display exited')
            target = keyboard.picker(title, pid)
            if target:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f'Could not observe the owned folder picker: {title}')
            time.sleep(.05)
        if resolve_owner() != pid or keyboard.picker(title, pid) != target:
            raise RuntimeError('Owned folder picker changed before input')
        keyboard.focus_picker(target)
        time.sleep(.2)  # X map/focus can precede GTK widget realization.
        if server.poll() is not None or resolve_owner() != pid or keyboard.picker(title, pid) != target:
            raise RuntimeError('Owned folder picker changed while waiting for GTK')
        if folder is None:
            keyboard.key(target, 'Escape')
        else:
            # Select the file list's only visible row, without location autocomplete.
            # The initial-location test deliberately never navigates to another directory.
            if not from_initial_location:
                keyboard.key(target, 'Home', 'Alt_L')
            time.sleep(.3)  # GTK enumerates locations asynchronously.
            keyboard.key(target, 'Home')
            time.sleep(.2)
            _require_only_visible_folder(fixture_root, folder, from_initial_location)
            if server.poll() is not None or resolve_owner() != pid or keyboard.picker(title, pid) != target:
                raise RuntimeError('Owned folder picker changed before confirmation')
            keyboard.key(target, 'o', 'Alt_L')  # The English GTK Open mnemonic.
        return {'pid': pid, 'windowId': target, 'submitKeySent': folder is not None}
    finally:
        keyboard.close()
