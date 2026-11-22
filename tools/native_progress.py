"""Record completed native scenarios while an installed run is still active."""
import json
import os
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
import time


def write_native_receipt(path, receipt):
    """Publish complete JSON atomically inside the owned evidence directory."""
    contents = json.dumps(receipt, indent=2) + '\n'
    output = NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                prefix=f'.{path.name}-', suffix='.tmp', delete=False)
    temporary = Path(output.name)
    try:
        with output:
            output.write(contents)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class ScenarioProgress(list):
    """A normal report list with a separate, atomically replaced status file."""

    def __init__(self, output, suite, *, clock=time.monotonic, stream=None, interval=30):
        super().__init__()
        self.path = output / 'progress.json'
        self.suite = suite
        self.clock = clock
        self.stream = sys.stderr if stream is None else stream
        self.interval = interval
        self.started = self.clock()
        self.phase = 'package-preflight'
        self.phase_started = self.started
        self.failure_phase = None
        self.printed = self.started
        self.can_record = True
        self._publish('running')

    def append(self, name):
        super().append(name)
        self._publish('running')

    def extend(self, names):
        super().extend(names)
        self._publish('running')

    def enter_phase(self, name):
        self.phase = name
        self.phase_started = self.clock()
        self._publish('running')

    def note_failure(self):
        if self.failure_phase is None:
            self.failure_phase = self.phase
            self._publish('running')

    def finish(self, passed):
        self._publish('passed' if passed else 'failed')

    def _publish(self, state):
        now = self.clock()
        progress = {
            'suite': self.suite,
            'state': state,
            'processId': os.getpid(),
            'phase': self.phase,
            'phaseStartedAtSeconds': round(self.phase_started - self.started, 1),
            'failurePhase': self.failure_phase,
            'completedScenarios': len(self),
            'lastCompletedScenario': self[-1] if self else None,
            'elapsedSeconds': round(now - self.started, 1),
        }
        if self.can_record:
            try:
                write_native_receipt(self.path, progress)
            except OSError as error:
                self.can_record = False
                print(f'Native acceptance progress file unavailable: {error}', file=self.stream, flush=True)
        if state == 'running' and self and now - self.printed >= self.interval:
            self.printed = now
            print(f'Native acceptance: {self.suite}: {len(self)} completed in {progress["elapsedSeconds"]}s; '
                  f'phase: {self.phase}; last: {self[-1]}', file=self.stream, flush=True)
