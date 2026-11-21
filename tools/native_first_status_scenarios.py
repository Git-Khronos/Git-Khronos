"""Observe a packaged checkout while Git's first complete file scan is held."""
import json
from pathlib import Path
import shlex
import shutil
import time

from native_worktree_scenarios import checkout_footprint


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

    counts = {
        '.unstaged-section gc-working-tree-summary .summary': {
            'label': '3 additions and 1 deletion in unstaged files', 'added': '+3', 'removed': '−1',
        },
        '.staged-section gc-working-tree-summary .summary': {
            'label': '1 addition and 0 deletions in staged files', 'added': '+1', 'removed': '−0',
        },
    }
    report['firstWorkingTreeRecaps'] = driver.wait(f"""
      if (document.querySelector('.wip-nav small')?.textContent.trim() !== '3 changed files'
        || document.querySelector('[aria-label="Working directory status"]')) return null;
      const actual = Object.entries({json.dumps(counts)}).map(([selector, expected]) => {{
        const recap = document.querySelector(selector);
        const label = recap?.getAttribute('aria-label');
        const added = recap?.querySelector('span')?.textContent.trim();
        const removed = recap?.querySelector('i')?.textContent.trim();
        return recap?.getClientRects().length && recap.getAttribute('role') === 'img'
          && label === expected.label && added === expected.added && removed === expected.removed
          ? {{label, added, removed}} : null;
      }});
      return actual.every(Boolean) ? actual : null;
    """)
    assert checkout_footprint(fixtures, repo, files) == before
    driver.screenshot(Path(report['artifactsDirectory']) / 'first-status-loaded.png')
    report['scenarios'].append('native-first-file-scan-publishes-real-staged-and-unstaged-recaps-without-writes')
    return repo, repo_id
