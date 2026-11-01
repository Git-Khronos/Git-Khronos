"""ICCCM close requests to one verified owned Linux application window.

Protocol/ABI references are recorded in docs/provenance/sources.md. This helper
sends WM_DELETE_WINDOW; it never destroys a window or kills a process.
"""
import ctypes as c
import ctypes.util
from pathlib import Path


def owned_application_pid(executable):
    executable = Path(executable).resolve()
    found = []
    for entry in Path('/proc').glob('[0-9]*/exe'):
        try:
            if entry.readlink() == executable:
                found.append(int(entry.parent.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    if len(found) != 1:
        raise RuntimeError('Expected exactly one process for the owned extracted executable')
    return found[0]


def process_running(pid):
    try:
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[0] not in ('Z', 'X')
    except (FileNotFoundError, ProcessLookupError):
        return False


class _ClientData(c.Union):
    _fields_ = [('bytes', c.c_char * 20), ('shorts', c.c_short * 10), ('longs', c.c_long * 5)]


class _ClientMessage(c.Structure):
    _fields_ = [('type', c.c_int), ('serial', c.c_ulong), ('send_event', c.c_int),
                ('display', c.c_void_p), ('window', c.c_ulong), ('message_type', c.c_ulong),
                ('format', c.c_int), ('data', _ClientData)]


class _Event(c.Union):
    _fields_ = [('client', _ClientMessage), ('padding', c.c_long * 24)]


class _WindowAttributes(c.Structure):
    # Public Xlib ABI; field order is required for XGetWindowAttributes.
    _fields_ = [(name, c.c_int) for name in ('x', 'y', 'width', 'height', 'border_width', 'depth')] + [
        ('visual', c.c_void_p), ('root', c.c_ulong), ('window_class', c.c_int),
        ('bit_gravity', c.c_int), ('win_gravity', c.c_int), ('backing_store', c.c_int),
        ('backing_planes', c.c_ulong), ('backing_pixel', c.c_ulong), ('save_under', c.c_int),
        ('colormap', c.c_ulong), ('map_installed', c.c_int), ('map_state', c.c_int),
        ('all_event_masks', c.c_long), ('your_event_mask', c.c_long),
        ('do_not_propagate_mask', c.c_long), ('override_redirect', c.c_int), ('screen', c.c_void_p)]


def _visible_regular_window(attributes):
    return (attributes.map_state == 2 and attributes.window_class == 1
            and not attributes.override_redirect and attributes.width > 0 and attributes.height > 0)


def request_owned_window_close(display_name, executable):
    """Use the standard window-manager request, after PID/executable binding."""
    pid = owned_application_pid(executable)
    library = ctypes.util.find_library('X11')
    if not library:
        raise RuntimeError('libX11 is required for the owned window-close acceptance helper')
    x = c.CDLL(library)
    window = c.c_ulong
    x.XOpenDisplay.argtypes = [c.c_char_p]; x.XOpenDisplay.restype = c.c_void_p
    x.XCloseDisplay.argtypes = [c.c_void_p]
    x.XDefaultRootWindow.argtypes = [c.c_void_p]; x.XDefaultRootWindow.restype = window
    x.XInternAtom.argtypes = [c.c_void_p, c.c_char_p, c.c_int]; x.XInternAtom.restype = c.c_ulong
    x.XFree.argtypes = [c.c_void_p]
    x.XQueryTree.argtypes = [c.c_void_p, window, c.POINTER(window), c.POINTER(window),
                            c.POINTER(c.POINTER(window)), c.POINTER(c.c_uint)]
    x.XGetWindowProperty.argtypes = [c.c_void_p, window, c.c_ulong, c.c_long, c.c_long,
                                    c.c_int, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_int),
                                    c.POINTER(c.c_ulong), c.POINTER(c.c_ulong), c.POINTER(c.c_void_p)]
    x.XSendEvent.argtypes = [c.c_void_p, window, c.c_int, c.c_long, c.POINTER(_Event)]
    x.XSync.argtypes = [c.c_void_p, c.c_int]
    x.XGetWindowAttributes.argtypes = [c.c_void_p, window, c.POINTER(_WindowAttributes)]
    error_handler_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)
    x.XSetErrorHandler.argtypes = [c.c_void_p]; x.XSetErrorHandler.restype = c.c_void_p
    # Windows can disappear between a tree query and a property read. Keep the
    # Xlib error callback alive through synchronization and connection closure.
    errors = []
    @error_handler_type
    def handle_error(_display, _error):
        errors.append(True)
        return 0
    old_handler = x.XSetErrorHandler(c.cast(handle_error, c.c_void_p))
    display = x.XOpenDisplay(display_name.encode())
    if not display:
        x.XSetErrorHandler(old_handler)
        raise RuntimeError('The fixture X display is unavailable')
    try:
        pid_atom = x.XInternAtom(display, b'_NET_WM_PID', 0)
        protocols_atom = x.XInternAtom(display, b'WM_PROTOCOLS', 0)
        delete_atom = x.XInternAtom(display, b'WM_DELETE_WINDOW', 0)

        def property_values(target, atom, expected_type, maximum):
            actual = c.c_ulong(); format = c.c_int(); count = c.c_ulong(); remaining = c.c_ulong(); data = c.c_void_p()
            status = x.XGetWindowProperty(display, target, atom, 0, maximum, 0, expected_type,
                                         c.byref(actual), c.byref(format), c.byref(count), c.byref(remaining), c.byref(data))
            try:
                if status or actual.value != expected_type or format.value != 32 or count.value > maximum or remaining.value:
                    return []
                return list(c.cast(data, c.POINTER(c.c_ulong))[:count.value]) if data.value else []
            finally:
                if data.value: x.XFree(data)

        queue = [x.XDefaultRootWindow(display)]; visited = set(); matches = []; observed = []
        while queue:
            target = queue.pop()
            if target in visited: continue
            visited.add(target)
            if len(visited) > 1024:
                raise RuntimeError('The fixture X window tree exceeds the acceptance limit')
            pids = property_values(target, pid_atom, 6, 1)
            if pids:
                protocols = property_values(target, protocols_atom, 4, 64)
                attributes = _WindowAttributes()
                have_attributes = x.XGetWindowAttributes(display, target, c.byref(attributes))
                observed.append({'windowId': target, 'pids': pids, 'protocols': protocols,
                                 'mapState': attributes.map_state, 'overrideRedirect': attributes.override_redirect})
                if pids == [pid] and delete_atom in protocols and have_attributes and _visible_regular_window(attributes):
                    matches.append(target)
            root = window(); parent = window(); children = c.POINTER(window)(); count = c.c_uint()
            if x.XQueryTree(display, target, c.byref(root), c.byref(parent), c.byref(children), c.byref(count)):
                try:
                    if count.value > 1024: raise RuntimeError('The fixture X child list exceeds the acceptance limit')
                    queue.extend(children[:count.value])
                finally:
                    if children: x.XFree(children)
        x.XSync(display, 0)
        if errors or len(matches) != 1:
            raise RuntimeError('Could not bind exactly one close-capable X window to the owned process: ' + repr({'ownedPid': pid, 'errors': len(errors), 'matches': matches, 'visited': len(visited), 'deleteAtom': delete_atom, 'observed': observed[:16]}))
        if owned_application_pid(executable) != pid:
            raise RuntimeError('The owned application process changed before the close request')
        target = matches[0]
        attributes = _WindowAttributes()
        if (not x.XGetWindowAttributes(display, target, c.byref(attributes))
            or not _visible_regular_window(attributes)
            or property_values(target, pid_atom, 6, 1) != [pid]
            or delete_atom not in property_values(target, protocols_atom, 4, 64)):
            raise RuntimeError('The owned visible window changed before the close request')
        x.XSync(display, 0)
        if errors: raise RuntimeError('The owned visible window could not be revalidated')
        event = _Event()
        event.client.type = 33  # X11 ClientMessage
        event.client.send_event = 1; event.client.display = display
        event.client.window = target; event.client.message_type = protocols_atom
        event.client.format = 32; event.client.data.longs[0] = delete_atom
        event.client.data.longs[1] = 0  # CurrentTime
        if not x.XSendEvent(display, target, 0, 0, c.byref(event)):
            raise RuntimeError('The owned X window close request was not sent')
        x.XSync(display, 0)
        if errors: raise RuntimeError('The fixture X server rejected the owned close request')
        return {'pid': pid, 'windowId': target, 'protocol': 'ICCCM WM_DELETE_WINDOW'}
    finally:
        x.XCloseDisplay(display)
        x.XSetErrorHandler(old_handler)
