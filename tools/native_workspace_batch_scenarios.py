"""Drive workspace batch controls through real Git fetches from an owned repository."""
import json
from pathlib import Path
import shlex
import shutil
import time

from native_worktree_scenarios import checkout_footprint


FIRST = 'workspace-batch-first'
SECOND = 'workspace-batch-second'


def workspace_fetch_environment(fixtures):
    """Gate only the app's first fixture fetch; Git oracles retain their own PATH."""
    real_git = shutil.which('git', path=fixtures.env['PATH'])
    if real_git is None:
        raise RuntimeError('Workspace batch acceptance requires Git')
    gate = fixtures.root / 'workspace-fetch-gate'
    gate.mkdir()
    binary_dir = gate / 'bin'
    binary_dir.mkdir()
    wrapper = binary_dir / 'git'
    wrapper.write_text(f'''#!/bin/sh
set -eu
gate={shlex.quote(str(gate))}
if [ "${{1:-}}" = -C ]; then
  target=
  case "${{2:-}}" in
    {shlex.quote(str(fixtures.root / FIRST))}) target=first ;;
    {shlex.quote(str(fixtures.root / SECOND))}) target=second ;;
  esac
  if [ -n "$target" ]; then
    for arg do
      if [ "$arg" = fetch ]; then
        printf '%s\\n' "$target" >> "$gate/dispatches"
        if [ "$target" = first ]; then
          tries=0
          while [ ! -f "$gate/release" ] && [ "$tries" -lt 300 ]; do
            sleep .05
            tries=$((tries + 1))
          done
          [ -f "$gate/release" ] || {{ echo 'Owned fetch gate was not released' >&2; exit 1; }}
        fi
        break
      fi
    done
  fi
fi
exec {shlex.quote(str(Path(real_git).resolve(strict=True)))} "$@"
''')
    wrapper.chmod(0o700)
    return {'PATH': str(binary_dir) + ':' + fixtures.env['PATH']}


def workspace_batch_stop(driver, fixtures, report):
    first = fixtures.repository(FIRST, commits=2)
    second = fixtures.repository(SECOND, commits=2)
    upstream = fixtures.repository('workspace-batch-upstream', commits=3)
    gate = fixtures.root / 'workspace-fetch-gate'
    files = ('fixture.txt', 'untracked.txt')
    for repository in (first, second):
        fixtures.git(repository, 'remote', 'add', 'origin', str(upstream))
        (repository / 'fixture.txt').write_text(f'Owned working edit in {repository.name}\n')
        (repository / 'untracked.txt').write_text(f'Owned untracked content in {repository.name}\n')
    before = [checkout_footprint(fixtures, repository, files) for repository in (first, second)]
    upstream_refs = fixtures.git(upstream, 'show-ref')
    expected = fixtures.git(upstream, 'rev-parse', 'refs/heads/main')
    tracking_ref = 'refs/remotes/origin/main'

    def tracking_refs(repository):
        return fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes')

    def dispatches():
        path = gate / 'dispatches'
        return path.read_text().splitlines() if path.is_file() else []

    def assert_git_state(expected_fetched):
        for repository, previous in zip((first, second), before, strict=True):
            current = checkout_footprint(fixtures, repository, files)
            refs = current.pop('references')
            assert current == {key: value for key, value in previous.items() if key != 'references'}
            if repository in expected_fetched:
                assert tracking_refs(repository) == f'{tracking_ref} {expected}'
                assert sorted(refs.splitlines()) == sorted([*previous['references'].splitlines(), f'{expected} {tracking_ref}'])
            else:
                assert not tracking_refs(repository), 'A skipped checkout unexpectedly fetched a remote ref'
                assert refs == previous['references']
        assert fixtures.git(upstream, 'show-ref') == upstream_refs

    driver.wait('return !!document.querySelector("gc-root")', 60)
    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.open-repositories.v1', JSON.stringify(arguments[0]));
      localStorage.setItem('git-khronos.active-repository.v1', arguments[0][0]);
      localStorage.setItem('git-khronos.remote.auto-fetch-minutes', '0');
    """, [str(first), str(second)])
    driver.reload()
    driver.wait('return document.querySelectorAll(".repo-tab-main[role=tab]").length === 2', 60)
    assert not dispatches()
    assert_git_state(set())
    driver.click_visible('.workspace-toggle')
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    overview = 'gc-workspace-center [aria-label="Workspace center"]'
    result = overview + ' [aria-label="Repository action results"]'

    def checkbox(repository):
        return overview + ' article[aria-label=' + json.dumps(repository.name) + '] input[type=checkbox]'

    def expect_outcome(text):
        driver.wait('return document.querySelector(' + json.dumps(result) + ')?.textContent.includes('
                    + json.dumps(text) + ')')

    driver.click_visible(checkbox(first))
    driver.click_visible(checkbox(second))
    driver.click_scrolled_text(overview + ' button', 'Fetch selected (2)', wait_for_ready=True)
    evidence = report['workspaceBatchStop'] = {}
    try:
        deadline = time.monotonic() + 8
        while not dispatches() and time.monotonic() < deadline:
            time.sleep(.05)
        evidence['beforeStop'] = dispatches()
        assert evidence['beforeStop'] == ['first'], evidence
        try:
            driver.wait('return [...document.querySelectorAll(' + json.dumps(result + ' button') + ')]'
                        '.some(button => button.textContent.trim() === "Stop after current repository")', 3)
        except TimeoutError as error:
            raise AssertionError('The installed workspace did not offer to stop the queued fetch') from error
        expect_outcome(f'{FIRST} — running')
        driver.click_scrolled_text(result + ' button', 'Stop after current repository', wait_for_ready=True)
        expect_outcome(f'{SECOND} — cancelled: Stopped before this repository was started.')
        expect_outcome(f'{FIRST} — running')
        assert_git_state(set())
    finally:
        (gate / 'release').touch()

    expect_outcome(f'{FIRST} — success')
    evidence['afterStop'] = dispatches()
    assert evidence['afterStop'] == ['first'], evidence
    assert_git_state({first})
    driver.click_visible(checkbox(first))
    driver.click_scrolled_text(overview + ' button', 'Fetch selected (1)', wait_for_ready=True)
    expect_outcome(f'{SECOND} — success')
    evidence['afterExplicitFetch'] = dispatches()
    assert evidence['afterExplicitFetch'] == ['first', 'second'], evidence
    assert_git_state({first, second})
    evidence['onlyRemoteTrackingRefsChanged'] = True
    report['scenarios'].append('native-workspace-batch-stop-completes-active-fetch-and-never-dispatches-queued-fetch')
    return first
