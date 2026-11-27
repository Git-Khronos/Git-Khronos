"""Read the WSLg compositor log without changing the running session."""

import argparse
from pathlib import Path


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, default=Path("/mnt/wslg/weston.log"), help="WSLg Weston log path")
    args = parser.parse_args()
    try:
        with args.log.open(encoding="utf-8", errors="replace") as log:
            status = transport_status(log)
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
        "unknown": "No recognized WSLg graphics redirection mode was found. This does not rule out a display issue.",
    }
    print(messages[status])


if __name__ == "__main__":
    main()
