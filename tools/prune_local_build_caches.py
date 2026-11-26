#!/usr/bin/env python3
"""Prune regenerable caches in old local Jammy qualification runs only."""
import argparse
import fcntl
import os
from pathlib import Path
import re
import shutil
import stat
import time

CACHE_PATHS = (
    "cargo/registry", "home/.cache/pnpm", "home/.local/share/pnpm/store",
    "home/.npm/_cacache", "source/node_modules", "source/.angular/cache",
    "source/.nx/cache", "source/target/debug",
    *(f"source/target/release/{part}" for part in
      ("deps", "build", "incremental", ".fingerprint", "examples")),
)


def owned_directory(path):
    return (path.is_dir() and path.resolve() == path
            and path.stat().st_uid == os.getuid() and not path.is_mount())


def prune(root, days, apply):
    cutoff = time.time() - days * 86400
    mounts = [Path(re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), line.split()[4]))
              for line in Path("/proc/self/mountinfo").read_text().splitlines()]
    review = root / "target/local-review"
    builders = review / "updater/jammy-builder"
    runs = []
    if owned_directory(review):
        runs.extend(review.glob("jammy-*"))
    if owned_directory(builders):
        runs.extend(builders.iterdir())
    failed = False
    count = 0
    for run in sorted(runs):
        work = run / "work"
        source = work / "source"
        if not owned_directory(source) or not (source / "Cargo.toml").is_file():
            continue
        target = source / "target"
        lock = target / ".git-khronos-linux-package.lock"
        # The packaging wrapper uses this same lock. Skip incomplete or
        # unfamiliar layouts rather than guessing what is disposable.
        if not owned_directory(target) or not (target / "CACHEDIR.TAG").is_file():
            continue
        try:
            if not stat.S_ISREG(lock.lstat().st_mode):
                continue
            fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            continue
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                continue
            if max(run.stat().st_mtime, source.stat().st_mtime, lock.stat().st_mtime) > cutoff:
                continue
            for name in CACHE_PATHS:
                path = work / name
                if (not owned_directory(path) or path.stat().st_mtime > cutoff
                        or any(mount.is_relative_to(path) for mount in mounts)):
                    continue
                try:
                    if apply:
                        shutil.rmtree(path)
                    print(("Removed " if apply else "Would remove ") + str(path.relative_to(root)))
                    count += 1
                except OSError as error:
                    print(f"Could not remove {path.relative_to(root)}: {error.strerror}")
                    failed = True
        finally:
            os.close(fd)
    print(f"{count} cache directories {'removed' if apply else 'eligible (dry run)'}; release bundles and evidence are excluded.")
    return int(failed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="remove caches instead of listing them")
    parser.add_argument("--older-days", type=int, default=7)
    args = parser.parse_args()
    if args.older_days < 1:
        parser.error("--older-days must be at least 1")
    raise SystemExit(prune(Path(__file__).resolve().parent.parent, args.older_days, args.apply))
