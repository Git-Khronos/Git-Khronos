"""Hold one real Git status read while the app receives a packed-ref event."""
from contextlib import contextmanager
from pathlib import Path
import shlex
import shutil
import time


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
    return {'PATH': str(bin_dir) + ':' + path}


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
