"""Drive workspace batch controls through real Git operations on owned repositories."""
import json
from pathlib import Path
import shlex
import shutil
import time

from native_worktree_scenarios import checkout_footprint


FIRST = 'workspace-batch-first'
SECOND = 'workspace-batch-second'
PULL_FIRST = 'workspace-pull-first'
PULL_SECOND = 'workspace-pull-second'


def workspace_fetch_environment(fixtures):
    """Hold only the first fixture operation; Git oracles retain their own PATH."""
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
  operation=fetch
  prefix=
  case "${{2:-}}" in
    {shlex.quote(str(fixtures.root / FIRST))}) target=first ;;
    {shlex.quote(str(fixtures.root / SECOND))}) target=second ;;
    {shlex.quote(str(fixtures.root / PULL_FIRST))}) target=first; operation=pull; prefix=pull- ;;
    {shlex.quote(str(fixtures.root / PULL_SECOND))}) target=second; operation=pull; prefix=pull- ;;
  esac
  if [ -n "$target" ]; then
    for arg do
      if [ "$arg" = "$operation" ]; then
        printf '%s\\n' "$target" >> "$gate/${{prefix}}dispatches"
        if [ "$target" = first ]; then
          tries=0
          while [ ! -f "$gate/${{prefix}}release" ] && [ "$tries" -lt 600 ]; do
            sleep .05
            tries=$((tries + 1))
          done
          [ -f "$gate/${{prefix}}release" ] || {{ echo 'Owned batch gate was not released' >&2; exit 1; }}
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

    driver.wait('return !!document.querySelector("gk-root")', 60)
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
    overview = 'gk-workspace-center [aria-label="Workspace center"]'
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
    workspace_batch_pull_strategy(driver, fixtures, report)
    workspace_batch_pull_checkout(driver, fixtures, report)
    return first


def workspace_batch_pull_strategy(driver, fixtures, report):
    upstream = fixtures.repository('workspace-policy-upstream', commits=2)
    first, second = (fixtures.root / name for name in ('workspace-policy-linear', 'workspace-policy-diverged'))
    for checkout in (first, second):
        fixtures.git(fixtures.root, 'clone', '-q', '--no-local', str(upstream), str(checkout))
        fixtures.git(checkout, 'config', 'user.name', 'Native Fixture')
        fixtures.git(checkout, 'config', 'user.email', 'native@example.test')
    common = fixtures.git(upstream, 'rev-parse', 'HEAD')
    author = ('-c', 'user.name=Native Fixture', '-c', 'user.email=native@example.test')
    for checkout, file, content in (
        (second, 'local.txt', 'Local commit\n'),
        (upstream, 'incoming.txt', 'Incoming commit\n'),
    ):
        (checkout / file).write_text(content)
        fixtures.git(checkout, 'add', '--', file)
        fixtures.git(checkout, *author, 'commit', '-qm', content.strip())
    local = fixtures.git(second, 'rev-parse', 'HEAD')
    incoming = fixtures.git(upstream, 'rev-parse', 'HEAD')
    upstream_refs = fixtures.git(upstream, 'show-ref')
    assert fixtures.git(second, 'rev-parse', 'refs/remotes/origin/main') == common
    assert local != incoming and local != common and incoming != common

    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.open-repositories.v1', JSON.stringify(arguments[0]));
      localStorage.setItem('git-khronos.active-repository.v1', arguments[0][0]);
      localStorage.setItem('git-khronos.remote.auto-fetch-minutes', '0');
    """, [str(first), str(second)])
    driver.reload()
    driver.wait('return document.querySelectorAll(".repo-tab-main[role=tab]").length === 2', 60)
    driver.click_visible('button[aria-label="Pull options"]')
    driver.click_visible('.pull-menu [role="menuitemradio"][aria-label="Make Fast-forward only the default pull strategy"]')
    driver.wait('return localStorage.getItem("git-khronos.pull.strategy") === "ff-only"')
    driver.click_visible('button[aria-label="Pull options"]')
    driver.click_visible('.workspace-toggle')
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    overview = 'gk-workspace-center [aria-label="Workspace center"]'
    result = overview + ' [aria-label="Repository action results"]'
    for checkout in (first, second):
        driver.click_visible(overview + ' article[aria-label=' + json.dumps(checkout.name) + '] input[type=checkbox]')
    driver.click_scrolled_text(overview + ' button', 'Pull selected (2)', wait_for_ready=True)
    driver.wait(
        'const text = document.querySelector(' + json.dumps(result) + ')?.textContent ?? ""; '
        'return text.includes(' + json.dumps(f'{second.name} — error:') + ') || '
        'text.includes(' + json.dumps(f'{second.name} — success') + ');')
    linear = fixtures.git(first, 'rev-parse', 'HEAD')
    actual = fixtures.git(second, 'rev-parse', 'HEAD')
    tracking = fixtures.git(second, 'rev-parse', 'refs/remotes/origin/main')
    report['workspaceBatchPullStrategy'] = {
        'strategy': 'ff-only', 'linearHead': linear, 'originalDivergentHead': local, 'divergentHead': actual,
        'divergentHeadParents': fixtures.git(second, 'show', '-s', '--format=%P', 'HEAD').split(),
        'expectedIncoming': incoming, 'trackingRef': tracking,
    }
    assert linear == incoming
    assert actual == local, f'Fast-forward-only batch changed divergent HEAD: expected {local}, got {actual}'
    assert tracking == incoming
    assert fixtures.git(second, 'symbolic-ref', 'HEAD') == 'refs/heads/main'
    assert not fixtures.git(second, 'status', '--porcelain')
    assert not (second / 'incoming.txt').exists()
    assert (second / 'local.txt').read_text() == 'Local commit\n'
    assert fixtures.git(upstream, 'show-ref') == upstream_refs
    driver.wait('return document.querySelector(' + json.dumps(result) + ')?.textContent.includes('
                + json.dumps(f'{second.name} — error: Pull stopped because the histories cannot fast-forward.') + ')')
    report['scenarios'].append('native-workspace-pull-honors-fast-forward-only-on-diverged-repository')


def workspace_batch_pull_checkout(driver, fixtures, report):
    upstream = fixtures.repository('workspace-pull-upstream', commits=2)
    first, second = (fixtures.root / name for name in (PULL_FIRST, PULL_SECOND))
    for checkout in (first, second):
        fixtures.git(fixtures.root, 'clone', '-q', '--no-local', str(upstream), str(checkout))
    original = fixtures.git(second, 'rev-parse', 'HEAD')
    fixtures.git(upstream, '-c', 'user.name=Native Fixture', '-c', 'user.email=native@example.test',
                 'commit', '--allow-empty', '-qm', 'Incoming workspace change')
    incoming = fixtures.git(upstream, 'rev-parse', 'HEAD')
    upstream_refs = fixtures.git(upstream, 'show-ref')
    gate = fixtures.root / 'workspace-fetch-gate'
    dispatch_log = gate / 'pull-dispatches'

    def dispatches():
        return dispatch_log.read_text().splitlines() if dispatch_log.is_file() else []

    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.open-repositories.v1', JSON.stringify(arguments[0]));
      localStorage.setItem('git-khronos.active-repository.v1', arguments[0][0]);
      localStorage.setItem('git-khronos.remote.auto-fetch-minutes', '0');
    """, [str(first), str(second)])
    driver.reload()
    driver.wait('return document.querySelectorAll(".repo-tab-main[role=tab]").length === 2', 60)
    driver.click_visible('.workspace-toggle')
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    overview = 'gk-workspace-center [aria-label="Workspace center"]'
    result = overview + ' [aria-label="Repository action results"]'

    def checkbox(repository):
        return overview + ' article[aria-label=' + json.dumps(repository.name) + '] input[type=checkbox]'

    def outcome(text):
        driver.wait('return document.querySelector(' + json.dumps(result) + ')?.textContent.includes('
                    + json.dumps(text) + ')')

    for checkout in (first, second):
        driver.click_visible(checkbox(checkout))
    driver.click_scrolled_text(overview + ' button', 'Pull selected (2)', wait_for_ready=True)
    try:
        deadline = time.monotonic() + 10
        while not dispatches() and time.monotonic() < deadline:
            time.sleep(.05)
        assert dispatches() == ['first'], dispatches()
        outcome(f'{PULL_SECOND} — pending')
        fixtures.git(second, 'switch', '-c', 'external-checkout', '--track', 'origin/main')
        assert fixtures.git(second, 'rev-parse', 'HEAD') == original
        before = checkout_footprint(fixtures, second, ('fixture.txt',))
        assert not (second / '.git/FETCH_HEAD').exists()
    finally:
        (gate / 'pull-release').touch()

    outcome(f'{PULL_FIRST} — success')
    driver.wait(
        'const text = document.querySelector(' + json.dumps(result) + ')?.textContent ?? ""; '
        'return text.includes(' + json.dumps(f'{PULL_SECOND} — error:') + ') || '
        'text.includes(' + json.dumps(f'{PULL_SECOND} — success') + ');')
    assert dispatches() == ['first'], f'Unexpected pull dispatched to the replacement checkout: {dispatches()}'
    outcome(f'{PULL_SECOND} — error: The checked-out branch or commit changed before Pull could start.')
    assert fixtures.git(first, 'rev-parse', 'HEAD') == incoming
    assert checkout_footprint(fixtures, second, ('fixture.txt',)) == before
    assert not (second / '.git/FETCH_HEAD').exists()

    driver.click_visible(checkbox(first))
    driver.click_scrolled_text(overview + ' button', 'Pull selected (1)', wait_for_ready=True)
    outcome(f'{PULL_SECOND} — success')
    assert dispatches() == ['first', 'second']
    assert fixtures.git(second, 'symbolic-ref', 'HEAD') == 'refs/heads/external-checkout'
    assert fixtures.git(second, 'rev-parse', 'HEAD') == incoming
    assert fixtures.git(second, 'rev-parse', 'refs/heads/main') == original
    assert fixtures.git(upstream, 'show-ref') == upstream_refs
    report['workspaceBatchPullCheckout'] = {
        'originalOid': original, 'upstreamOid': incoming, 'dispatches': dispatches(),
        'fetchedBeforeExplicitRetry': False,
    }
    report['scenarios'].append('native-workspace-pull-refuses-same-tip-external-checkout-before-fetch')
