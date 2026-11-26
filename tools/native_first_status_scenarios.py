"""Observe a packaged checkout while Git's first complete file scan is held."""
from pathlib import Path
import shlex
import shutil
import time

from native_worktree_scenarios import checkout_footprint
from native_working_tree_recaps import wait_for_line_recaps


CHECKOUT = 'first-status-checkout'
GATE = 'first-status-gate'


def first_status_environment(fixtures):
    real_git = shutil.which('git', path=fixtures.env['PATH'])
    if real_git is None:
        raise RuntimeError('First-status acceptance requires Git')
    gate = fixtures.root / GATE
    gate.mkdir()
    bin_dir = gate / 'bin'
    bin_dir.mkdir()
    git = bin_dir / 'git'
    git.write_text(f'''#!/bin/sh
set -eu
gate={shlex.quote(str(gate))}
if [ "${{1:-}}" = -C ] && [ "${{2:-}}" = {shlex.quote(str(fixtures.root / CHECKOUT))} ]; then
  status=no porcelain=no complete=no
  for arg do
    case "$arg" in
      status) status=yes ;;
      --porcelain=v1) porcelain=yes ;;
      --untracked-files=normal|--untracked-files=all) complete=yes ;;
    esac
  done
  if [ "$status:$porcelain:$complete" = yes:yes:yes ]; then
    # A full diagnostic pipe must not block the app before it can read status.
    touch "$gate/diagnostics-started"
    head -c 2097152 /dev/zero >&2
    touch "$gate/entered"
    attempts=0
    while [ ! -f "$gate/release" ] && [ "$attempts" -lt 300 ]; do
      sleep .05
      attempts=$((attempts + 1))
    done
    [ -f "$gate/release" ] || {{ echo 'Owned first-status gate was not released' >&2; exit 1; }}
  fi
fi
exec {shlex.quote(str(Path(real_git).resolve(strict=True)))} "$@"
''')
    git.chmod(0o700)
    return {'PATH': str(bin_dir) + ':' + fixtures.env['PATH']}


def first_status(driver, fixtures, report):
    from native_acceptance import open_ui

    repo = fixtures.repository(CHECKOUT, commits=2)
    (repo / 'staged.txt').write_text('one staged line\n')
    fixtures.git(repo, 'add', '--', 'staged.txt')
    (repo / 'fixture.txt').write_text('one replacement line\n')
    (repo / 'untracked.txt').write_text('first new line\nsecond new line\n')
    files = ('fixture.txt', 'staged.txt', 'untracked.txt')
    before = checkout_footprint(fixtures, repo, files)
    gate = fixtures.root / GATE
    try:
        repo_id = open_ui(driver, repo)
        deadline = time.monotonic() + 10
        while not (gate / 'entered').is_file():
            if time.monotonic() >= deadline:
                if (gate / 'diagnostics-started').is_file():
                    raise TimeoutError('The first file scan stalled while writing owned Git diagnostics')
                raise TimeoutError('The packaged app did not start its first complete file scan')
            time.sleep(.05)
        # Sample while the native Git process is still blocked. Do not inject
        # renderer state, release the read early, or wait for a false zero to disappear.
        pending = driver.script("""return {
          path: document.querySelector('.status-repository-path')?.textContent,
          sidebar: document.querySelector('.wip-nav small')?.textContent.trim(),
          badge: !!document.querySelector('.wip-nav b'),
          inspector: document.querySelector('[aria-label="Working directory status"] [role=status]')?.textContent.trim(),
          fileLists: !!document.querySelector('#unstaged-files-list, #staged-files-list')
        };""")
        report['workingTreeStatusWhileHeld'] = pending
        driver.screenshot(Path(report['artifactsDirectory']) / 'first-status-held.png')
        assert pending == {'path': str(repo), 'sidebar': 'Loading changes…', 'badge': False,
                           'inspector': 'Loading working directory changes…', 'fileLists': False}, pending
        assert checkout_footprint(fixtures, repo, files) == before
    finally:
        (gate / 'release').touch()
    report['scenarios'].append('native-first-file-scan-shows-loading-not-clean-while-history-is-usable')

    report['firstWorkingTreeRecaps'] = [
        {key: recap[key] for key in ('label', 'added', 'removed')}
        for recap in wait_for_line_recaps(driver, (3, 1), (1, 0), changed_files=3)
    ]
    assert checkout_footprint(fixtures, repo, files) == before
    driver.screenshot(Path(report['artifactsDirectory']) / 'first-status-loaded.png')
    report['scenarios'].append('native-first-file-scan-publishes-real-staged-and-unstaged-recaps-without-writes')
    report['scenarios'].append('native-first-file-scan-drains-large-diagnostics-without-blocking-status')
    return repo, repo_id
