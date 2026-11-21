import io
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from native_progress import ScenarioProgress


class ScenarioProgressTest(unittest.TestCase):
    def test_snapshots_keep_completed_evidence_separate_from_final_report(self):
        clock = [10.0]
        log = io.StringIO()
        with TemporaryDirectory() as directory:
            root = Path(directory)
            scenarios = ScenarioProgress(root, 'environment', clock=lambda: clock[0], stream=log)
            status = lambda: json.loads((root / 'progress.json').read_text())
            self.assertEqual(status(), {'suite': 'environment', 'state': 'running', 'processId': os.getpid(),
                                        'phase': 'package-preflight', 'phaseStartedAtSeconds': 0.0, 'failurePhase': None,
                                        'completedScenarios': 0, 'lastCompletedScenario': None, 'elapsedSeconds': 0.0})
            clock[0] = 41.0
            scenarios.append('first')
            clock[0] = 50.0
            scenarios.extend(['second', 'third'])
            self.assertEqual(status()['state'], 'running')
            self.assertEqual(status()['completedScenarios'], 3)
            self.assertEqual(status()['lastCompletedScenario'], 'third')
            self.assertEqual(json.loads(json.dumps(scenarios)), ['first', 'second', 'third'])
            self.assertEqual(len(log.getvalue().splitlines()), 1)
            self.assertFalse((root / 'report.json').exists())

            clock[0] = 52.5
            scenarios.finish(False)
            self.assertEqual((status()['state'], status()['elapsedSeconds']), ('failed', 42.5))
            self.assertEqual(sorted(path.name for path in root.iterdir()), ['progress.json'])

    def test_phases_never_inflate_completed_coverage_and_failure_survives_cleanup(self):
        clock = [10.0]
        with TemporaryDirectory() as directory:
            root = Path(directory)
            progress = ScenarioProgress(root, 'environment', clock=lambda: clock[0], stream=io.StringIO())
            progress.append('smoke-passed')
            clock[0] = 55.2
            progress.enter_phase('full-toolkit')
            snapshot = json.loads((root / 'progress.json').read_text())
            self.assertEqual(snapshot['phase'], 'full-toolkit')
            self.assertEqual(snapshot['phaseStartedAtSeconds'], 45.2)
            self.assertEqual(snapshot['lastCompletedScenario'], 'smoke-passed')
            self.assertEqual(snapshot['completedScenarios'], 1)
            progress.note_failure()
            clock[0] = 56.0
            progress.enter_phase('cleanup')
            progress.note_failure()
            progress.finish(False)
            snapshot = json.loads((root / 'progress.json').read_text())
            self.assertEqual((snapshot['state'], snapshot['phase']), ('failed', 'cleanup'))
            self.assertEqual(snapshot['failurePhase'], 'full-toolkit')
            self.assertEqual(progress, ['smoke-passed'])

    def test_unavailable_progress_file_does_not_change_scenario_evidence(self):
        log = io.StringIO()
        with TemporaryDirectory() as directory:
            scenarios = ScenarioProgress(Path(directory) / 'absent', 'smoke', stream=log)
            scenarios.append('test-is-still-recorded')
            scenarios.finish(True)
            self.assertEqual(scenarios, ['test-is-still-recorded'])
            self.assertEqual(log.getvalue().count('progress file unavailable'), 1)
