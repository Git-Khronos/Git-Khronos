"""Observe watcher convergence and hold an owned status read across a ref change."""
from contextlib import contextmanager
import os
from pathlib import Path
import shlex
import shutil
import time


@contextmanager
def observe_untracked_refresh(driver, fixtures, report, enabled=False):
    """Record event and Git-read timing without emitting events or refreshing the app."""
    if not enabled:
        yield lambda _phase: None
        return
    attached = driver.request('POST', driver.path('execute/async'), {'script': """
      const done = arguments[arguments.length - 1];
      const bridge = window.__TAURI_INTERNALS__;
      const sample = [];
      const add = type => {
        if (sample.length < 300) sample.push({type, ms: Date.now()});
      };
      const event = 'repository-changed';
      bridge.invoke('plugin:event|listen', {
        event, target: {kind: 'Any'}, handler: bridge.transformCallback(() => add('repository-changed')),
      }).then(eventId => {
        window.__ownedWatcherObservation = { mark: phase => add(phase), stop: async () => {
          window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
          await bridge.invoke('plugin:event|unlisten', {event, eventId});
          return {sample, visible: !document.hidden,
            stillShown: !!document.querySelector('[aria-label="Stage native-untracked.txt"]')};
        }};
        done({attached: true});
      }, error => done({error: String(error)}));
    """, 'args': []})
    assert attached.get('attached'), f'Could not attach read-only watcher observations: {attached}'
    try:
        yield lambda phase: driver.script('window.__ownedWatcherObservation.mark(arguments[0]);', phase)
    finally:
        observation = {}
        report['untrackedRefreshObservation'] = observation
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
