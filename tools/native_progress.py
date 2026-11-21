"""Record completed native scenarios while an installed run is still active."""
import json
import sys
import time


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
        self.printed = self.started
        self.can_record = True
        self._publish('running')

    def append(self, name):
        super().append(name)
        self._publish('running')

    def extend(self, names):
        super().extend(names)
        self._publish('running')

    def finish(self, passed):
        self._publish('passed' if passed else 'failed')

    def _publish(self, state):
        now = self.clock()
        progress = {
            'suite': self.suite,
            'state': state,
            'completedScenarios': len(self),
            'lastCompletedScenario': self[-1] if self else None,
            'elapsedSeconds': round(now - self.started, 1),
        }
        if self.can_record:
            temporary = self.path.with_suffix('.tmp')
            try:
                temporary.write_text(json.dumps(progress, indent=2) + '\n')
                temporary.replace(self.path)
            except OSError as error:
                self.can_record = False
                print(f'Native acceptance progress file unavailable: {error}', file=self.stream, flush=True)
        if state == 'running' and self and now - self.printed >= self.interval:
            self.printed = now
            print(f'Native acceptance: {self.suite}: {len(self)} completed in {progress["elapsedSeconds"]}s; '
                  f'last: {self[-1]}', file=self.stream, flush=True)
