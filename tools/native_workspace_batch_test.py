import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from native_workspace_batch_scenarios import FIRST, SECOND, workspace_fetch_environment


class WorkspaceBatchFixtureTest(unittest.TestCase):
    def test_gate_records_only_fetches_for_the_two_owned_checkouts(self):
        with TemporaryDirectory(prefix='owned workspace batch ') as directory:
            root = Path(directory)
            git = root / 'git'
            git.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            git.chmod(0o700)
            fixtures = SimpleNamespace(root=root, env=os.environ | {'PATH': str(root) + ':/usr/bin:/bin'})
            environment = fixtures.env | workspace_fetch_environment(fixtures)
            gate = root / 'workspace-fetch-gate'
            (gate / 'release').touch()
            for checkout, command in [(FIRST, 'status'), ('another-checkout', 'fetch'), (FIRST, 'fetch'), (SECOND, 'fetch')]:
                args = ['-C', str(root / checkout), '-c', 'fetch.parallel=1', command]
                output = subprocess.check_output(['git', *args], env=environment, text=True, timeout=2)
                self.assertEqual(output.splitlines(), args)
            self.assertEqual((gate / 'dispatches').read_text().splitlines(), ['first', 'second'])
            self.assertFalse(fixtures.env['PATH'].startswith(str(gate)))
