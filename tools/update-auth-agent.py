#!/usr/bin/env python3
"""Run an OS-owned terminal authentication agent for the installed Linux app."""
import argparse
import os
from pathlib import Path
import select
import subprocess
import sys


APP = Path("/usr/bin/git-khronos")
AGENT = Path("/usr/bin/pkttyagent")


def process_start(process):
    """Read the kernel start-time token for this process."""
    try:
        # comm is parenthesized and can contain whitespace and parentheses.
        prefix, sep, fields = (process / "stat").read_text().rpartition(") ")
        fields = fields.split()
        if not sep or prefix.partition(" (")[0] != process.name or fields[0] in {"X", "Z"}:
            return None
        start = fields[19]  # /proc/PID/stat field 22, relative to field 3.
        if start.isascii() and start.isdigit() and int(start) > 0:
            return start
    except (OSError, IndexError, ValueError):
        pass
    return None


def app_identity(process, executable, uid):
    """Bind the agent to a process identity, not a recyclable numeric PID."""
    start = process_start(process)
    if start is None:
        return None
    try:
        if process.stat().st_uid != uid or not (process / "exe").samefile(executable):
            return None
    except OSError:
        return None
    if process_start(process) == start:
        return f"{process.name},{start}"
    return None


def run_agent(identity):
    """Wait for polkit registration before suggesting a retry."""
    pid, _ = identity.split(",", 1)
    process = Path("/proc") / pid
    reader, writer = os.pipe()
    child = None
    try:
        child = subprocess.Popen(
            [AGENT, "--fallback", "--process", identity, "--notify-fd", str(writer)],
            pass_fds=(writer,),
        )
        os.close(writer)
        writer = None
        if not select.select([reader], [], [], 10)[0]:
            print("The system authentication agent did not register in time.", file=sys.stderr)
            return 1
        if os.read(reader, 1) or child.poll() is not None:
            print("The system authentication agent did not stay running.", file=sys.stderr)
            return 1
        print("Keep this terminal open, then retry Install verified update in Git Khronos. "
              "Enter credentials only at the system prompt. Stop the agent with Ctrl+C when finished.",
              flush=True)
        while True:
            if app_identity(process, APP, os.getuid()) != identity:
                print("Git Khronos exited or restarted. Run this task again for the new app process.",
                      file=sys.stderr)
                return 1
            try:
                return child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                continue
    except KeyboardInterrupt:
        return 130
    finally:
        os.close(reader)
        if writer is not None:
            os.close(writer)
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Identify the app without registering an agent")
    parser.add_argument("--pid", type=int, help="Choose the installed app process if several are running")
    args = parser.parse_args()
    if args.pid is not None and args.pid < 1:
        parser.error("--pid must identify a positive process ID")
    if os.getuid() == 0 or os.geteuid() != os.getuid():
        parser.error("Run this task as the same unprivileged user as Git Khronos, without sudo.")
    if not args.check and not sys.stdin.isatty():
        parser.error("Run this task from an interactive terminal.")
    if not AGENT.is_file() or not os.access(AGENT, os.X_OK):
        parser.error("The system pkttyagent executable is unavailable.")
    if not APP.is_file():
        parser.error("The installed Git Khronos executable is unavailable.")
    proc = Path("/proc")
    candidates = (proc / str(args.pid),) if args.pid is not None else (
        p for p in proc.iterdir() if p.name.isascii() and p.name.isdigit()
    )
    identities = sorted(identity for p in candidates
                        if (identity := app_identity(p, APP, os.getuid())))
    if not identities:
        parser.error("No running process matches the installed Git Khronos executable for this user.")
    if len(identities) != 1:
        parser.error("Several matching processes are running. Select one with --pid: "
                     + ", ".join(identity.split(",", 1)[0] for identity in identities))
    identity = identities[0]
    print(f"Installed Git Khronos process: {identity.split(',', 1)[0]}", flush=True)
    if args.check:
        print("System pkttyagent is available. No agent was started; authorization was not requested.")
        return
    try:
        return run_agent(identity)
    except OSError as error:
        parser.exit(1, f"Could not start the system authentication agent: {error}\n")


if __name__ == "__main__":
    sys.exit(main())
