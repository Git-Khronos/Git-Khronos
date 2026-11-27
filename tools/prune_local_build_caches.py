#!/usr/bin/env python3
"""Prune regenerable caches in old local Jammy qualification runs only."""
import argparse
import fcntl
import hashlib
import json
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
# The old container builder provisioned pnpm and Node's compile cache under
# each run instead of sharing them. Require preserved package bytes before
# deleting these extra legacy caches, even when Cargo marked its cache.
LEGACY_CACHE_PATHS = (
    "node-tools/lib/node_modules/pnpm",
    "source/target/package-tmp/node-compile-cache",
)
DEBIAN_NAME = r"Git-Khronos_[A-Za-z0-9.+_~-]+\.deb"


def owned_directory(path):
    return (path.is_dir() and path.resolve() == path
            and path.stat().st_uid == os.getuid() and not path.is_mount())


def known_legacy_cache(path, name):
    if name != LEGACY_CACHE_PATHS[0]:
        return True
    try:
        package = path / "package.json"
        meta = package.lstat()
        if not stat.S_ISREG(meta.st_mode) or not 0 < meta.st_size <= 65536:
            return False
        record = json.loads(package.read_text())
        return record["name"] == "pnpm" and bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", record["version"]))
    except (OSError, ValueError, KeyError, TypeError, RecursionError):
        return False


def verified_debian_archive(work, cutoff):
    """Recognize older jobs whose archived build omitted Cargo's cache tag."""
    artifacts = work / "artifacts"
    if not owned_directory(artifacts):
        return False
    def matches(name, digest, size=None):
        if not re.fullmatch(DEBIAN_NAME, name) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            return False
        package = artifacts / name
        try:
            meta = package.lstat()
            if (not stat.S_ISREG(meta.st_mode) or not 0 < meta.st_size <= 128 * 1024**2
                    or meta.st_mtime > cutoff or (size is not None and size != str(meta.st_size))):
                return False
            with package.open("rb") as data:
                return hashlib.file_digest(data, "sha256").hexdigest() == digest
        except OSError:
            return False

    manifest = artifacts / "SHA256SUMS"
    try:
        meta = manifest.lstat()
        if stat.S_ISREG(meta.st_mode) and meta.st_size <= 16384 and meta.st_mtime <= cutoff:
            for line in manifest.read_text().splitlines():
                match = re.fullmatch(r"([a-f0-9]{64}) [ *](.+)", line)
                if match and matches(match[2], match[1]):
                    return True
    except (OSError, UnicodeError):
        pass

    # Older local containers left the package hash only in the build receipt.
    # Use its basename as an identifier, never follow the recorded build path.
    release = work / "source/target/release"
    if not owned_directory(release):
        return False
    receipt = release / ".git-khronos-package-build.v1.json"
    try:
        meta = receipt.lstat()
        if not stat.S_ISREG(meta.st_mode) or meta.st_size > 16384 or meta.st_mtime > cutoff:
            return False
        record = json.loads(receipt.read_text())
        checksum = record["checksum"]
        if record["version"] != 1 or not isinstance(checksum, str) or not checksum.startswith("ubuntu-jammy:"):
            return False
        package = record["outputs"]["package"]
        path, digest, size = package["path"], package["sha256"], package["bytes"]
        return all(isinstance(value, str) for value in (path, digest, size)) and matches(Path(path).name, digest, size)
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        return False


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
        if not owned_directory(target):
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
            if max(run.stat().st_mtime, lock.stat().st_mtime) > cutoff:
                continue
            archive_verified = None
            marked_cache = (target / "CACHEDIR.TAG").is_file()
            source_old = source.stat().st_mtime <= cutoff
            if not marked_cache:
                archive_verified = verified_debian_archive(work, cutoff)
                if not archive_verified:
                    continue
            for name in (*CACHE_PATHS, *LEGACY_CACHE_PATHS):
                path = work / name
                if (not owned_directory(path) or path.stat().st_mtime > cutoff
                        or any(mount.is_relative_to(path) for mount in mounts)):
                    continue
                if name in LEGACY_CACHE_PATHS:
                    if not known_legacy_cache(path, name):
                        continue
                    if archive_verified is None:
                        archive_verified = verified_debian_archive(work, cutoff)
                    if not archive_verified:
                        continue
                elif marked_cache and not source_old:
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
