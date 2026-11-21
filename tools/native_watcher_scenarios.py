"""Observe watcher convergence and hold an owned status read across a ref change."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shlex
import shutil
from threading import Event, Thread
import time


def observe_untracked_refresh(driver, fixtures, report, repository_id, enabled=False):
    return observe_repository_changes(driver, fixtures, report, 'untrackedRefreshObservation', enabled=enabled,
                                      repository_id=repository_id,
                                      selector='[aria-label="Stage native-untracked.txt"]')


@contextmanager
def observe_repository_changes(driver, fixtures, report, field, *, repository_id, enabled=True, selector=None):
    """Record event and Git-read timing without emitting events or refreshing the app."""
    if not enabled:
        yield lambda _phase: None
        return
    attached = driver.request('POST', driver.path('execute/async'), {'script': """
      const repositoryId = arguments[0], selector = arguments[1], done = arguments[arguments.length - 1];
      const bridge = window.__TAURI_INTERNALS__;
      const sample = [];
      const add = type => {
        if (sample.length < 300) sample.push({type, ms: Date.now()});
      };
      const event = 'repository-changed';
      bridge.invoke('plugin:event|listen', {
        event, target: {kind: 'Any'}, handler: bridge.transformCallback(({payload}) => {
          if (payload?.repositoryId === repositoryId) add('repository-changed');
        }),
      }).then(eventId => {
        window.__ownedWatcherObservation = { mark: phase => add(phase), stop: async () => {
          window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
          await bridge.invoke('plugin:event|unlisten', {event, eventId});
          return {sample, visible: !document.hidden,
            stillShown: selector !== null && !!document.querySelector(selector)};
        }};
        done({attached: true});
      }, error => done({error: String(error)}));
    """, 'args': [repository_id, selector]})
    assert attached.get('attached'), f'Could not attach read-only watcher observations: {attached}'
    try:
        yield lambda phase: driver.script('window.__ownedWatcherObservation.mark(arguments[0]);', phase)
    finally:
        observation = {}
        report[field] = observation
        try:
            observation.update(driver.request('POST', driver.path('execute/async'), {'script': """
              const done = arguments[arguments.length - 1];
              window.__ownedWatcherObservation.stop().then(done, error => done({error: String(error)}));
            """, 'args': []}))
        except Exception as error:
            observation['captureError'] = str(error)
        trace = fixtures.root / 'owned-watcher-status/status-trace'
        if trace.is_file():
            observation['statusReads'] = trace.read_text().splitlines()[-300:]


def remove_ref_during_change_burst(driver, fixtures, repository, repository_id, report, row, delete_ref):
    """Prove a same-branch graph update while native events are still arriving."""
    marker = repository / '.git' / 'owned-watcher-burst-marker'
    field = 'watcherBurstObservation'
    stopped = Event()
    errors = []

    def produce_events():
        try:
            update = 0
            while not stopped.is_set():
                marker.write_text(str(update))
                update += 1
                stopped.wait(.10)
        except OSError as error:
            errors.append(str(error))

    removed = 'return !document.querySelector(' + json.dumps(row) + ')'
    with observe_repository_changes(driver, fixtures, report, field, repository_id=repository_id, selector=row) as mark:
        worker = Thread(target=produce_events, daemon=True)
        worker.start()
        try:
            # Get past one ordinary debounce interval before changing the ref.
            time.sleep(.70)
            mark('delete-ref')
            delete_ref()
            try:
                driver.wait(removed, 4)
                during_burst = True
            except TimeoutError:
                during_burst = False
            mark('end-of-burst-observation')
        finally:
            stopped.set()
            worker.join(3)
            if not worker.is_alive():
                marker.unlink(missing_ok=True)

    observation = report[field]
    observation['graphRowRemovedDuringBurst'] = during_burst
    assert not errors and not worker.is_alive(), (errors, observation)
    times = observation.get('sample', [])
    marks = {event['type']: event['ms'] for event in times if event['type'] != 'repository-changed'}
    assert 'delete-ref' in marks and 'end-of-burst-observation' in marks, observation
    start, end = marks['delete-ref'], marks['end-of-burst-observation']
    event_times = [event['ms'] for event in times if event['type'] == 'repository-changed' and event['ms'] <= end]
    assert event_times and event_times[0] < start - 450, observation
    maximum_gap = max(later - earlier for earlier, later in zip(event_times, event_times[1:] + [end]))
    observation.update(maxEventGapMs=maximum_gap, deletionToObservationMs=end - start)
    assert maximum_gap < 450, f'Native event burst contained a quiet debounce interval: {observation}'
    driver.wait(removed)
    observation['graphRowRemovedAfterQuiet'] = True
    assert during_burst, 'Git deleted the ref, but the graph did not update until watcher events stopped'


def watcher_status_environment(fixtures):
    path = fixtures.env['PATH']
    git = shutil.which('git', path=path)
    if git is None:
        raise RuntimeError('The watcher scenario requires Git on PATH')
    gate = fixtures.root / 'owned-watcher-status'
    gate.mkdir()
    bin_dir = gate / 'bin'
    bin_dir.mkdir()
    wrapper = bin_dir / 'git'
    wrapper.write_text(f'''#!/bin/sh
set -eu
gate={shlex.quote(str(gate))}
if [ "${{GIT_KHRONOS_NATIVE_TRACE_WATCHER:-0}}" = 1 ] && [ "${{1:-}}" = -C ] && [ "${{2:-}}" = {shlex.quote(str(fixtures.root / 'repository'))} ]; then
  status=no porcelain=no mode=default
  for arg do
    if [ "$arg" = status ]; then status=yes; fi
    if [ "$status" = yes ] && [ "$arg" = --porcelain=v1 ]; then porcelain=yes; fi
    case "$arg" in
      --untracked-files=no|--untracked-files=normal|--untracked-files=all) mode="${{arg#*=}}" ;;
    esac
  done
  if [ "$porcelain" = yes ]; then printf '%s %s\\n' "$(date +%s%3N)" "$mode" >> "$gate/status-trace"; fi
fi
if [ "${{1:-}}" = -C ] && [ "${{2:-}}" = {shlex.quote(str(fixtures.root / 'repository'))} ] && [ -f "$gate/armed" ]; then
  status=no
  for arg do
    if [ "$arg" = status ]; then status=yes; fi
    if [ "$status" = yes ] && [ "$arg" = --porcelain=v1 ] && mkdir "$gate/claimed" 2>/dev/null; then
      attempts=0
      while [ ! -f "$gate/released" ] && [ "$attempts" -lt 300 ]; do
        sleep 0.05
        attempts=$((attempts + 1))
      done
      if [ ! -f "$gate/released" ]; then
        echo 'Owned status gate timed out' >&2
        exit 1
      fi
      break
    fi
  done
fi
exec {shlex.quote(str(Path(git).resolve(strict=True)))} "$@"
''')
    wrapper.chmod(0o700)
    return {'PATH': str(bin_dir) + ':' + path,
            'GIT_KHRONOS_NATIVE_TRACE_WATCHER': os.environ.get('GIT_KHRONOS_NATIVE_TRACE_WATCHER', '0')}


@contextmanager
def held_status_for_packed_ref(driver, fixtures, report):
    gate = fixtures.root / 'owned-watcher-status'
    (gate / 'armed').touch()
    try:
        # Exercise the installed renderer's focus read, not a direct native
        # status invoke (which would not occupy the renderer's refresh owner).
        deadline = time.monotonic() + 8
        while not (gate / 'claimed').is_dir():
            if time.monotonic() >= deadline:
                raise TimeoutError('The installed renderer did not start the owned status read')
            driver.script("window.dispatchEvent(new Event('focus'))")
            time.sleep(0.1)
        observation = {'statusHeld': True, 'holdAfterDeleteSeconds': None}
        report['watcherStatusRace'] = observation
        yield
        # Keep the read pending across the renderer's 450 ms debounce so
        # this is not an ordinary uncontended watcher acknowledgement.
        started = time.monotonic()
        time.sleep(1.5)
        observation['holdAfterDeleteSeconds'] = round(time.monotonic() - started, 3)
    finally:
        (gate / 'released').touch()
        (gate / 'armed').unlink()
