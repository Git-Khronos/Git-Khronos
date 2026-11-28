"""Read the WSLg compositor log without changing the running session."""

import argparse
import os
from pathlib import Path
import re
import stat


LOG_TAIL_BYTES = 1024 * 1024


def transport_status(lines):
    """Classify the last reported RDP graphics redirection mode."""
    last_error = None
    status = "unknown"
    for index, line in enumerate(lines):
        if "rdp_allocate_shared_memory: Failed to open " in line and "Input/output error" in line:
            last_error = index
        if "RDP backend: use_gfxredir = " in line:
            mode = line.split("RDP backend: use_gfxredir = ", 1)[1].strip()
            if mode == "0":
                status = "shared-memory-error" if last_error is not None and index - last_error <= 8 else "copy-mode"
            elif mode == "1":
                status = "gfxredir"
            else:
                status = "unknown"
            last_error = None
    return status


def display_endpoints(environment):
    """Describe local socket presence, without connecting to the compositor."""
    wayland = environment.get("WAYLAND_DISPLAY")
    runtime = environment.get("XDG_RUNTIME_DIR")
    if not wayland:
        wayland_status = "WAYLAND_DISPLAY is unset"
    elif not Path(wayland).is_absolute() and not (runtime and Path(runtime).is_absolute()):
        wayland_status = "no absolute XDG_RUNTIME_DIR for the relative socket name"
    else:
        socket = Path(wayland) if Path(wayland).is_absolute() else Path(runtime) / wayland
        wayland_status = socket_presence(socket)

    display = environment.get("DISPLAY")
    if not display:
        x11_status = "DISPLAY is unset"
    elif match := re.fullmatch(r"(?:unix)?:([0-9]{1,6})(?:\.[0-9]{1,6})?", display):
        x11_status = socket_presence(Path("/tmp/.X11-unix") / f"X{match.group(1)}")
    else:
        x11_status = "not a local Unix display; not probed"
    return wayland_status, x11_status


def socket_presence(path):
    try:
        return "local socket present" if path.is_socket() else "local socket missing"
    except (OSError, ValueError):
        return "local socket could not be inspected"


def read_transport_status(path):
    """Inspect one bounded window of a regular log without waiting on a pipe."""
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as log:
        info = os.fstat(log.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("Expected a regular WSLg log file.")
        start = max(0, info.st_size - LOG_TAIL_BYTES)
        # Use the last byte before the window to distinguish a complete first
        # line from the suffix of a line split at the read boundary.
        log.seek(max(0, start - 1))
        if start:
            previous = log.read(1)
        data = log.read(info.st_size - start)
    if start and previous != b"\n":
        data = data.partition(b"\n")[2]
    # Weston might be appending a line. Only use complete observations.
    data = data.rpartition(b"\n")[0]
    return transport_status(data.decode("utf-8", errors="replace").split("\n"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, default=Path("/mnt/wslg/weston.log"), help="WSLg Weston log path")
    parser.add_argument("--endpoints", action="store_true", help="Check whether this shell can see the local display sockets")
    args = parser.parse_args()
    if args.endpoints:
        wayland, x11 = display_endpoints(os.environ)
        print(f"Wayland: {wayland}.")
        print(f"X11: {x11}.")
        print("Socket presence does not establish display access or prove that a window renders.")
    try:
        status = read_transport_status(args.log)
    except ValueError as error:
        parser.exit(2, f"{error}\n")
    except OSError as error:
        parser.exit(2, f"Cannot read the WSLg log: {error.strerror}. Run this from the affected WSL distribution.\n")
    messages = {
        "shared-memory-error": (
            "WSLg reported a shared-memory I/O error followed by a switch to copy mode. "
            "If the app is still invisible, save work in all WSL distributions, then run "
            "'wsl --shutdown' from Windows PowerShell and relaunch."
        ),
        "copy-mode": "WSLg reported copy mode, but the known shared-memory error was not found beside that entry.",
        "gfxredir": "WSLg last reported graphics redirection enabled. This does not test whether a window is visible.",
        "unknown": "No recent WSLg graphics redirection mode was found. This does not rule out a display issue.",
    }
    print(messages[status])


if __name__ == "__main__":
    main()
