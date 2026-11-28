import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from prune_local_build_caches import inventory, prune


class PruneTest(unittest.TestCase):
    def test_inventory_ranks_archives_and_keeps_unusual_names_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            review = root / "target/local-review"
            review.mkdir(parents=True)
            report = io.StringIO()
            entries = (
                (review / "small", 1024),
                (review / "bigger\nrun/cache", 3 * 1024**2),
                (review / "bigger\nrun", 4 * 1024**2),
                (review, 5 * 1024**2),
            )
            output = b"".join(f"{size}\t".encode() + os.fsencode(path) + b"\0" for path, size in entries)
            with patch("prune_local_build_caches.subprocess.run") as run, contextlib.redirect_stdout(report):
                run.return_value.stdout = output
                run.return_value.returncode = 1
                self.assertEqual(inventory(root), 1)
            command = run.call_args.args[0]
            self.assertIn("--null", command)
            self.assertEqual(command[-1], str(review))
            ranks = report.getvalue()
            self.assertLess(ranks.index("bigger\\nrun"), ranks.index("small"))
            self.assertIn("Inventory is incomplete", ranks)
            self.assertEqual(list(review.iterdir()), [])

    def test_legacy_node_caches_require_verified_package_and_recognized_pnpm(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            run = root / "target/local-review/jammy-legacy-node"
            work = run / "work"
            source = work / "source"
            cache = source / "target/package-tmp/node-compile-cache"
            pnpm = work / "node-tools/lib/node_modules/pnpm"
            cache.mkdir(parents=True)
            pnpm.mkdir(parents=True)
            (source / "target/CACHEDIR.TAG").touch()
            (source / "Cargo.toml").touch()
            lock = source / "target/.git-khronos-linux-package.lock"
            lock.touch()
            artifact = work / "artifacts/Git-Khronos_0.1.6_amd64.deb"
            artifact.parent.mkdir()
            stored = b"qualified bytes"
            artifact.write_bytes(stored)
            manifest = artifact.with_name("SHA256SUMS")
            old = time.time() - 8 * 86400
            for path in (run, lock, artifact, cache, pnpm):
                os.utime(path, (old, old))
            package_json = pnpm / "package.json"
            package_json.write_text('{"name":"unrecognized","version":"12.14.0"}')
            os.utime(pnpm, (old, old))

            def record(checksum):
                manifest.write_text(f"{checksum}  {artifact.name}\n")
                os.utime(manifest, (old, old))

            with contextlib.redirect_stdout(io.StringIO()):
                record("0" * 64)
                self.assertEqual(prune(root, 7, True), 0)
                self.assertTrue(cache.is_dir())
                self.assertTrue(pnpm.is_dir())
                record(hashlib.sha256(stored).hexdigest())
                with lock.open("rb") as handle:
                    fcntl.flock(handle, fcntl.LOCK_EX)
                    self.assertEqual(prune(root, 7, True), 0)
                    self.assertTrue(cache.is_dir())
                    self.assertTrue(pnpm.is_dir())
                self.assertEqual(prune(root, 7, True), 0)
                self.assertFalse(cache.exists())
                self.assertTrue(pnpm.is_dir())
                package_json.write_text('{"name":"pnpm","version":"12.14.0"}')
                self.assertEqual(prune(root, 7, True), 0)
                self.assertFalse(pnpm.exists())
            self.assertEqual(artifact.read_bytes(), stored)
            self.assertTrue(manifest.is_file())

    def test_old_owned_cache_is_removed_only_with_apply_and_no_build_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            run = root / "target/local-review/updater/jammy-builder/owned"
            source = run / "work/source"
            cache = source / "target/release/deps"
            cache.mkdir(parents=True)
            lock = source / "target/.git-khronos-linux-package.lock"
            lock.touch()
            (source / "target/CACHEDIR.TAG").touch()
            (source / "Cargo.toml").touch()
            artifact = source / "target/release/bundle/candidate.deb"
            artifact.parent.mkdir()
            artifact.write_text("retained")
            outside = root / "outside"
            outside.mkdir()
            (source / "node_modules").symlink_to(outside, target_is_directory=True)
            old = time.time() - 8 * 86400
            for path in (run, source, cache, lock):
                os.utime(path, (old, old))
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(prune(root, 7, False), 0)
            self.assertIn("Would remove", stdout.getvalue())
            self.assertTrue(cache.exists())
            with lock.open("rb") as handle, contextlib.redirect_stdout(io.StringIO()) as log:
                fcntl.flock(handle, fcntl.LOCK_EX)
                self.assertEqual(prune(root, 7, True, explain=True), 0)
                self.assertTrue(cache.exists())
            self.assertIn("package build lock is held", log.getvalue())
            os.utime(run, None)
            with contextlib.redirect_stdout(io.StringIO()) as log:
                self.assertEqual(prune(root, 7, True, explain=True), 0)
            self.assertIn("was updated within 7 day(s)", log.getvalue())
            self.assertTrue(cache.exists())
            os.utime(run, (old, old))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(prune(root, 7, True), 0)
            self.assertFalse(cache.exists())
            self.assertEqual(artifact.read_text(), "retained")
            self.assertTrue(outside.is_dir())

    def test_old_archive_without_cache_tag_needs_a_valid_package_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            run = root / "target/local-review/jammy-owned"
            work = run / "work"
            source = work / "source"
            cache = source / "target/release/deps"
            cache.mkdir(parents=True)
            lock = source / "target/.git-khronos-linux-package.lock"
            lock.touch()
            (source / "Cargo.toml").touch()
            artifact = work / "artifacts/Git-Khronos_0.1.6_amd64.deb"
            artifact.parent.mkdir()
            archive_bytes = b"retained package"
            artifact.write_bytes(archive_bytes)
            manifest = artifact.with_name("SHA256SUMS")
            old = time.time() - 8 * 86400
            for path in (run, cache, lock, artifact):
                os.utime(path, (old, old))
            for checksum, retain in (("0" * 64, True), (hashlib.sha256(archive_bytes).hexdigest(), False)):
                manifest.write_text(f"{checksum}  {artifact.name}\n")
                os.utime(manifest, (old, old))
                with contextlib.redirect_stdout(io.StringIO()) as log:
                    self.assertEqual(prune(root, 7, True, explain=True), 0)
                self.assertEqual(cache.exists(), retain)
                if retain:
                    self.assertIn("no cache tag or retained Debian archive with matching checksum", log.getvalue())
                self.assertEqual(artifact.read_bytes(), archive_bytes)

    def test_old_jammy_build_receipt_can_verify_a_retained_archive_without_sha256sums(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            run = root / "target/local-review/jammy-receipt"
            source = run / "work/source"
            release = source / "target/release"
            cache = release / "deps"
            cache.mkdir(parents=True)
            lock = source / "target/.git-khronos-linux-package.lock"
            lock.touch()
            (source / "Cargo.toml").touch()
            artifact = run / "work/artifacts/Git-Khronos_0.1.6_amd64.deb"
            artifact.parent.mkdir()
            data = b"retained package"
            artifact.write_bytes(data)
            receipt = release / ".git-khronos-package-build.v1.json"
            digest = hashlib.sha256(data).hexdigest()
            old = time.time() - 8 * 86400
            for path in (run, cache, lock, artifact):
                os.utime(path, (old, old))
            for checksum, sha, size, retained in (
                ("local:fixture", digest, str(len(data)), True),
                ("ubuntu-jammy:fixture", "0" * 64, str(len(data)), True),
                ("ubuntu-jammy:fixture", digest, "1", True),
                ("ubuntu-jammy:fixture", digest, str(len(data)), False),
            ):
                receipt.write_text(json.dumps({
                    "version": 1, "checksum": checksum,
                    "outputs": {"package": {"path": "/other/userspace/" + artifact.name, "bytes": size, "sha256": sha}},
                }))
                os.utime(receipt, (old, old))
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(prune(root, 7, True), 0)
                self.assertEqual(cache.exists(), retained)
                self.assertEqual(artifact.read_bytes(), data)
                self.assertTrue(receipt.is_file())
