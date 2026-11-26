"""Installed snapshot coverage for an owned, stalled optional Git LFS helper."""
import json
from pathlib import Path
import shlex
import shutil
import time
import uuid


REPOSITORY = 'lfs-snapshot-timeout'
STARTED = 'lfs-snapshot-listing-started'
FINISHED = 'lfs-snapshot-listing-finished'
ATTR_REPOSITORY = 'lfs-snapshot-attributes-timeout'
ATTR_STARTED = 'lfs-snapshot-attributes-started'
ATTR_FINISHED = 'lfs-snapshot-attributes-finished'
VERSION_REPOSITORY = 'lfs-version-preflight-timeout'
VERSION_HOLD = 'lfs-version-preflight-hold'
VERSION_STARTED = 'lfs-version-preflight-started'
PULL_STARTED = 'lfs-pull-transfer-started'


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
                      'if [ "$PWD" = ' + quote(str(fixtures.root / VERSION_REPOSITORY)) + ' ]'
                      ' && [ "$1" = version ] && [ -f ' + quote(str(fixtures.root / VERSION_HOLD)) + ' ]; then\n'
                      '  printf "%s\\n" "$$" > ' + quote(str(fixtures.root / VERSION_STARTED)) + '\n'
                      '  sleep 12\n'
                      'fi\n'
                      'if [ "$PWD" = ' + quote(str(fixtures.root / ATTR_REPOSITORY)) + ' ]'
                      ' && [ "$1" = pull ]; then\n'
                      '  : > ' + quote(str(fixtures.root / PULL_STARTED)) + '\n'
                      '  exit 98\n'
                      'fi\n'
                      'exec ' + quote(real) + ' "$@"\n')
    helper.chmod(0o700)
    git = shutil.which('git', path=path)
    if not git:
        raise RuntimeError('The LFS snapshot timeout scenario requires Git on PATH')
    git_wrapper = bin_dir / 'git'
    git_wrapper.write_text('#!/bin/sh\n'
                           'if [ "$1" = -C ] && [ "$2" = ' + quote(str(fixtures.root / ATTR_REPOSITORY)) + ' ]'
                           ' && [ "$3" = grep ] && [ "$7" = filter=lfs ]; then\n'
                           '  printf "%s\\n" "$$" > ' + quote(str(fixtures.root / ATTR_STARTED)) + '\n'
                           '  sleep 12\n'
                           '  : > ' + quote(str(fixtures.root / ATTR_FINISHED)) + '\n'
                           'fi\n'
                           'exec ' + quote(git) + ' "$@"\n')
    git_wrapper.chmod(0o700)
    # The real oracle's PATH is never changed.
    return {'PATH': str(bin_dir) + ':' + path}


def lfs_snapshot_timeout(driver, fixtures, report):
    from native_acceptance import open_ui
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

    open_ui(driver, repository)
    driver.wait("""const pull = document.querySelector('[aria-label="Pull Git LFS objects"]');
      return pull && !pull.disabled && pull.getAttribute('aria-description') === 'LFS file counts unavailable'
        && pull.querySelector('.lfs-count-unknown')?.textContent.trim() === '?'
        && !pull.querySelector('.lfs-pointer-count');
    """)
    driver.click_visible('[aria-label="Git LFS options"]')
    driver.wait("""const menu = document.querySelector('#lfs-options-menu');
      return menu?.querySelector('.lfs-menu-status')?.textContent.includes('File counts unavailable')
        && [...menu.querySelectorAll('button[role=menuitem]')].some(button =>
          button.textContent.includes('Pull LFS objects') && !button.disabled);
    """)
    driver.key('\ue00c')
    driver.click_visible('[aria-label="Preferences"]')
    driver.click_visible('#preferences-tab-git')
    driver.wait("""return document.querySelector('#preference-lfs')
      ?.textContent.includes('File counts unavailable');""")
    driver.click_visible('[aria-label="Close preferences"]')
    assert checkout_footprint(fixtures, repository) == before
    report['scenarios'].append('native-lfs-toolbar-distinguishes-unknown-count-and-keeps-pull-available')

    repository = fixtures.repository(ATTR_REPOSITORY, commits=1)
    before = checkout_footprint(fixtures, repository)
    started = time.monotonic()
    snapshot = driver.invoke('open_repository', path=str(repository))
    seconds = time.monotonic() - started
    assert (fixtures.root / ATTR_STARTED).exists(), 'The owned LFS attribute scan did not reach the delay'
    assert seconds < 9 and not (fixtures.root / ATTR_FINISHED).exists(), (
        f'Optional LFS attribute detection held repository opening for {seconds:.2f}s')
    info = snapshot['lfs']
    assert info['trackedFiles'] is None and info['pointerFiles'] is None, info
    attribute_pid = int((fixtures.root / ATTR_STARTED).read_text())
    try:
        state = (Path('/proc') / str(attribute_pid) / 'stat').read_text().rsplit(')', 1)[1].split()[0]
    except FileNotFoundError:
        state = None
    assert state in (None, 'Z', 'X'), f'Owned LFS attribute scanner still running: {state}'
    assert checkout_footprint(fixtures, repository) == before
    report['lfsAttributeSnapshotTimeout'] = {'elapsedSeconds': round(seconds, 3), 'countsKnown': False,
                                            'helperExited': True, 'unchanged': True}
    report['scenarios'].append('native-lfs-stalled-attribute-discovery-shares-snapshot-deadline')

    (fixtures.root / ATTR_STARTED).unlink()
    started = time.monotonic()
    try:
        driver.invoke('lfs_pull', repoId=snapshot['id'], operationId=str(uuid.uuid4()))
    except RuntimeError as error:
        detail = json.loads(str(error))
        assert detail['kind'] == 'gitInspectionTimeout', detail
        assert 'checking whether this repository uses LFS' in detail['message'], detail
        assert 'No transfer or cleanup started' in detail['hint'], detail
    else:
        raise AssertionError('LFS Pull passed a stalled eligibility preflight')
    seconds = time.monotonic() - started
    assert (fixtures.root / ATTR_STARTED).exists()
    assert seconds < 9 and not (fixtures.root / PULL_STARTED).exists(), seconds
    assert not (fixtures.root / ATTR_FINISHED).exists()
    assert checkout_footprint(fixtures, repository) == before
    report['lfsPullPreflightTimeout'] = {'elapsedSeconds': round(seconds, 3), 'transferStarted': False, 'unchanged': True}
    report['scenarios'].append('native-lfs-pull-refuses-stalled-eligibility-before-any-transfer')

    marker = fixtures.root / ATTR_STARTED
    marker.unlink()
    operation = str(uuid.uuid4())
    driver.script("""window.__ownedLfsPreflight = {done: false};
      window.__TAURI_INTERNALS__.invoke('lfs_pull', {repoId: arguments[0], operationId: arguments[1]}).then(
        value => { window.__ownedLfsPreflight = {done: true, value}; },
        error => { window.__ownedLfsPreflight = {done: true, error}; });""", snapshot['id'], operation)
    deadline = time.monotonic() + 1.5
    while not marker.exists() and time.monotonic() < deadline:
        time.sleep(.01)
    assert marker.exists(), 'The owned LFS Pull did not enter its eligibility preflight'
    assert driver.invoke('cancel_git_operation', operationId=operation)
    driver.wait('return window.__ownedLfsPreflight.done')
    assert driver.script('return window.__ownedLfsPreflight.error?.kind') == 'operationCancelled'
    assert not (fixtures.root / PULL_STARTED).exists() and not (fixtures.root / ATTR_FINISHED).exists()
    pid = int(marker.read_text())
    try:
        state = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()[0]
    except FileNotFoundError:
        state = None
    assert state in (None, 'Z', 'X'), f'Cancelled LFS attribute scanner still running: {state}'
    assert checkout_footprint(fixtures, repository) == before
    report['scenarios'].append('native-lfs-pull-cancels-active-eligibility-before-any-transfer')

    repository = fixtures.repository(VERSION_REPOSITORY, commits=1)
    repo_id = driver.invoke('open_repository', path=str(repository))['id']
    before = checkout_footprint(fixtures, repository)
    hold = fixtures.root / VERSION_HOLD
    hold.touch()
    started = time.monotonic()
    try:
        driver.invoke('lfs_objects', repoId=repo_id)
    except RuntimeError as error:
        detail = json.loads(str(error))
        assert detail['kind'] == 'gitInspectionTimeout', detail
        assert 'version check' in detail['message'] and 'git lfs version' in detail['hint'], detail
    else:
        raise AssertionError('A stalled LFS availability check did not report a timeout')
    finally:
        hold.unlink()
    seconds = time.monotonic() - started
    pid = int((fixtures.root / VERSION_STARTED).read_text())
    try:
        state = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()[0]
    except FileNotFoundError:
        state = None
    assert seconds < 9 and state in (None, 'Z', 'X'), (seconds, state)
    assert checkout_footprint(fixtures, repository) == before
    report['lfsVersionPreflightTimeout'] = {'elapsedSeconds': round(seconds, 3), 'helperExited': True, 'unchanged': True}
    report['scenarios'].append('native-lfs-object-review-times-out-stalled-version-preflight-without-writes')
