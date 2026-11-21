"""Installed snapshot coverage for an owned, stalled optional Git LFS helper."""
from pathlib import Path
import shlex
import shutil
import time


REPOSITORY = 'lfs-snapshot-timeout'
STARTED = 'lfs-snapshot-listing-started'
FINISHED = 'lfs-snapshot-listing-finished'


def lfs_snapshot_timeout_environment(fixtures):
    path = fixtures.env['PATH']
    real = shutil.which('git-lfs', path=path)
    if not real:
        raise RuntimeError('The LFS snapshot timeout scenario requires Git LFS on PATH')
    real = str(Path(real).resolve(strict=True))
    bin_dir = fixtures.root / 'owned-slow-lfs-bin'
    bin_dir.mkdir()
    helper = bin_dir / 'git-lfs'
    quote = shlex.quote
    helper.write_text('#!/bin/sh\n'
                      'if [ "$PWD" = ' + quote(str(fixtures.root / REPOSITORY)) + ' ]'
                      ' && [ "$1" = ls-files ]; then\n'
                      '  printf "%s\\n" "$$" > ' + quote(str(fixtures.root / STARTED)) + '\n'
                      '  sleep 20\n'
                      '  : > ' + quote(str(fixtures.root / FINISHED)) + '\n'
                      '  printf \'{"files":null}\\n\'\n'
                      '  exit 0\n'
                      'fi\n'
                      'exec ' + quote(real) + ' "$@"\n')
    helper.chmod(0o700)
    # The real oracle's PATH is never changed.
    return {'PATH': str(bin_dir) + ':' + path}


def lfs_snapshot_timeout(driver, fixtures, report):
    from native_worktree_scenarios import checkout_footprint

    repository = fixtures.repository(REPOSITORY, commits=1)
    fixtures.git(repository, 'config', 'filter.lfs.process', 'git-lfs filter-process')
    before = checkout_footprint(fixtures, repository)
    started = time.monotonic()
    snapshot = driver.invoke('open_repository', path=str(repository))
    seconds = time.monotonic() - started
    info = snapshot['lfs']
    helper_pid = int((fixtures.root / STARTED).read_text().strip())
    assert seconds < 10, f'Optional LFS checkout listing delayed repository opening for {seconds:.2f}s'
    assert info['enabled'] and info['available'], info
    assert info['trackedFiles'] is None and info['pointerFiles'] is None, info
    assert not (fixtures.root / FINISHED).exists(), 'The blocked listing was allowed to finish'
    try:
        state = (Path('/proc') / str(helper_pid) / 'stat').read_text().rsplit(')', 1)[1].split()[0]
    except FileNotFoundError:
        state = None
    assert state in (None, 'Z', 'X'), f'Owned LFS listing helper still running: {state}'
    assert checkout_footprint(fixtures, repository) == before
    report['lfsSnapshotTimeout'] = {'elapsedSeconds': round(seconds, 3), 'available': True,
                                    'countsKnown': False, 'helperExited': True, 'unchanged': True}
    report['scenarios'].append('native-lfs-stalled-listing-does-not-block-opening-or-invent-counts')
