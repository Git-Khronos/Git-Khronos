import contextlib
import fcntl
import io
import os
from pathlib import Path
import tempfile
import time
import unittest

from prune_local_build_caches import prune


class PruneTest(unittest.TestCase):
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
            with lock.open("rb") as handle, contextlib.redirect_stdout(io.StringIO()):
                fcntl.flock(handle, fcntl.LOCK_EX)
                self.assertEqual(prune(root, 7, True), 0)
                self.assertTrue(cache.exists())
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(prune(root, 7, True), 0)
            self.assertFalse(cache.exists())
            self.assertEqual(artifact.read_text(), "retained")
            self.assertTrue(outside.is_dir())
