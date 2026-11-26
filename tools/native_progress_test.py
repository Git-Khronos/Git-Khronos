import io
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from native_progress import ScenarioProgress, write_native_receipt


class ScenarioProgressTest(unittest.TestCase):
    def test_full_toolkit_enters_first_phase_before_initial_integrity_read(self):
        from native_scenarios import full_toolkit

        observed = []

        class Driver:
            def invoke(self, command, **kwargs):
                observed.append(command)
                raise RuntimeError('owned failure before first result')

        with self.assertRaisesRegex(RuntimeError, 'owned failure'):
            full_toolkit(Driver(), None, None, 'repo', {}, observed.append)
        self.assertEqual(observed, ['toolkit-integrity-and-file-tools', 'inspect_repository_integrity'])

    def test_report_discovery_cannot_see_partial_final_json(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / 'report.json'
            payload = {'passed': True, 'scenarios': ['done']}
            replace = os.replace

            def observe_before_publish(temporary, target):
                temporary, target = Path(temporary), Path(target)
                self.assertEqual(target, report)
                self.assertEqual(temporary.parent, root)
                self.assertFalse(report.exists())
                self.assertEqual(json.loads(temporary.read_text()), payload)
                replace(temporary, target)

            with patch('native_progress.os.replace', side_effect=observe_before_publish):
                write_native_receipt(report, payload)
            self.assertEqual(json.loads(report.read_text()), payload)
            self.assertEqual(list(root.iterdir()), [report])

    def test_failed_final_publication_preserves_known_receipt_and_removes_temp_file(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / 'report.json'
            write_native_receipt(report, {'passed': False})
            with patch('native_progress.os.replace', side_effect=OSError('fixture refused atomic publication')):
                with self.assertRaisesRegex(OSError, 'fixture refused'):
                    write_native_receipt(report, {'passed': True})
            self.assertEqual(json.loads(report.read_text()), {'passed': False})
            self.assertEqual(list(root.iterdir()), [report])

    def test_snapshots_keep_completed_evidence_separate_from_final_report(self):
        clock = [10.0]
        log = io.StringIO()
        with TemporaryDirectory() as directory:
            root = Path(directory)
            scenarios = ScenarioProgress(root, 'environment', clock=lambda: clock[0], stream=log)
            status = lambda: json.loads((root / 'progress.json').read_text())
            self.assertEqual(status(), {'suite': 'environment', 'state': 'running', 'processId': os.getpid(),
                                        'phase': 'package-preflight', 'phaseStartedAtSeconds': 0.0, 'completedPhases': [],
                                        'failurePhase': None,
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
            self.assertEqual(scenarios.report_timing(), {
                'elapsedSeconds': 42.5,
                'phases': [{'phase': 'package-preflight', 'durationSeconds': 42.5, 'scenariosCompleted': 3}],
            })
            self.assertEqual(status()['state'], 'running')
            scenarios.finish(False)
            self.assertEqual((status()['state'], status()['elapsedSeconds']), ('failed', 42.5))
            self.assertEqual(sorted(path.name for path in root.iterdir()), ['progress.json'])

    def test_phases_never_inflate_completed_coverage_and_failure_survives_cleanup(self):
        clock = [10.0]
        log = io.StringIO()
        with TemporaryDirectory() as directory:
            root = Path(directory)
            progress = ScenarioProgress(root, 'environment', clock=lambda: clock[0], stream=log)
            progress.append('smoke-passed')
            clock[0] = 55.2
            progress.enter_phase('full-toolkit')
            snapshot = json.loads((root / 'progress.json').read_text())
            self.assertEqual(snapshot['phase'], 'full-toolkit')
            self.assertEqual(snapshot['phaseStartedAtSeconds'], 45.2)
            self.assertEqual(snapshot['lastCompletedScenario'], 'smoke-passed')
            self.assertEqual(snapshot['completedScenarios'], 1)
            self.assertEqual(snapshot['completedPhases'], [
                {'phase': 'package-preflight', 'durationSeconds': 45.2, 'scenariosCompleted': 1},
            ])
            progress.append('toolkit-passed-before-failure')
            progress.note_failure()
            clock[0] = 56.0
            progress.enter_phase('cleanup')
            progress.note_failure()
            progress.finish(False)
            snapshot = json.loads((root / 'progress.json').read_text())
            self.assertEqual((snapshot['state'], snapshot['phase']), ('failed', 'cleanup'))
            self.assertEqual(snapshot['failurePhase'], 'full-toolkit')
            self.assertEqual(snapshot['completedPhases'][1:], [
                {'phase': 'full-toolkit', 'durationSeconds': 0.8, 'scenariosCompleted': 1},
                {'phase': 'cleanup', 'durationSeconds': 0.0, 'scenariosCompleted': 0},
            ])
            self.assertEqual(progress, ['smoke-passed', 'toolkit-passed-before-failure'])
            self.assertIn('environment failed; 2 scenarios in 46.0s; failed in full-toolkit; '
                          'slowest phases: package-preflight 45.2s, full-toolkit 0.8s, cleanup 0.0s',
                          log.getvalue())

    def test_unavailable_progress_file_does_not_change_scenario_evidence(self):
        log = io.StringIO()
        with TemporaryDirectory() as directory:
            scenarios = ScenarioProgress(Path(directory) / 'absent', 'smoke', stream=log)
            scenarios.append('test-is-still-recorded')
            scenarios.finish(True)
            self.assertEqual(scenarios, ['test-is-still-recorded'])
            self.assertEqual(log.getvalue().count('progress file unavailable'), 1)
