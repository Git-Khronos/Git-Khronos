"""Independent Git assertions for packaged worktree-navigation evidence."""
from pathlib import Path
import tempfile
import unittest

from native_acceptance import Fixtures
from native_worktree_scenarios import checkout_footprint


class WorktreeFootprintTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='git-khronos-footprint-')
        self.addCleanup(self.directory.cleanup)
        self.fixtures = Fixtures(self.directory.name)
        self.source = self.fixtures.repository('source', commits=2)
        self.owner = self.fixtures.root / 'owner'
        self.fixtures.git(self.source, 'worktree', 'add', '-b', 'owned-topic', str(self.owner))

    def test_linked_checkout_evidence_reads_its_own_index_and_shared_references(self):
        source = checkout_footprint(self.fixtures, self.source)
        owner = checkout_footprint(self.fixtures, self.owner)
        self.assertEqual(source['branch'], 'main')
        self.assertEqual(owner['branch'], 'owned-topic')
        self.assertEqual(source['head'], owner['head'])
        self.assertEqual(source['references'], owner['references'])
        self.assertEqual(source['configSha256'], owner['configSha256'])
        self.assertEqual(checkout_footprint(self.fixtures, self.source), source)
        self.assertEqual(checkout_footprint(self.fixtures, self.owner), owner)

    def test_owner_staging_and_working_changes_cannot_hide_behind_the_source_index(self):
        source = checkout_footprint(self.fixtures, self.source)
        owner = checkout_footprint(self.fixtures, self.owner)
        (self.owner / 'fixture.txt').write_text('Owner-only staged contents.\n')
        self.fixtures.git(self.owner, 'add', 'fixture.txt')
        changed = checkout_footprint(self.fixtures, self.owner)
        self.assertNotEqual(owner['indexSha256'], changed['indexSha256'])
        self.assertNotEqual(owner['files'], changed['files'])
        self.assertEqual(checkout_footprint(self.fixtures, self.source), source)

    def test_an_external_index_override_is_refused_before_reading_evidence(self):
        with tempfile.TemporaryDirectory(prefix='git-khronos-outside-footprint-') as outside:
            path = Path(outside) / 'outside-index'
            path.write_bytes(b'Owned outside data must not be read as evidence.\n')
            self.fixtures.env['GIT_INDEX_FILE'] = str(path)
            with self.assertRaisesRegex(ValueError, 'inside the owned fixture'):
                checkout_footprint(self.fixtures, self.source)


if __name__ == '__main__':
    unittest.main()
