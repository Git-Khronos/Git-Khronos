"""Hold real Git commands while checking an unrelated native command."""
import threading
import time

from native_worktree_scenarios import checkout_footprint


def held_git_command(driver, gate, command, mode, args, records):
    hold = gate / 'hold'
    started = gate / 'started'
    (gate / 'mode').write_text(mode)
    started.unlink(missing_ok=True)
    hold.touch()
    released = threading.Event()

    def release_on_timeout():
        released.set()
        hold.unlink(missing_ok=True)

    # Prevent a synchronous/native main-loop regression from stranding
    # WebDriver. A timeout release can never satisfy the assertion.
    watchdog = threading.Timer(12, release_on_timeout)
    watchdog.start()
    try:
        driver.script("""window.__ownedHeldGit = {pending: true};
            window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(
                result => window.__ownedHeldGit = {result},
                error => window.__ownedHeldGit = {error});""",
                      command, args)
        deadline = time.monotonic() + 8
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert started.exists() and started.read_text().strip().isdigit(), command
        status = driver.invoke('application_update_status')
        pending = driver.script('return window.__ownedHeldGit.pending === true')
        records.append({'command': command, 'nativeStatusSettled': bool(status.get('runningVersion')),
                        'commandPending': pending, 'watchdogReleased': released.is_set()})
        assert status.get('runningVersion') and pending and hold.exists() and not released.is_set(), records[-1]
    finally:
        watchdog.cancel()
        watchdog.join()
        hold.unlink(missing_ok=True)

    outcome = driver.wait('return window.__ownedHeldGit?.pending ? null : window.__ownedHeldGit')
    assert 'result' in outcome, outcome
    return outcome['result']


def comparison_responsiveness(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('comparison-responsiveness', commits=3)
    target = fixtures.git(repository, 'rev-parse', 'HEAD')
    base = fixtures.git(repository, 'rev-parse', 'HEAD^')
    (repository / 'fixture.txt').write_text('owned working comparison line\n')
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository)
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    commands = [
        ('compare_commits', '--name-status', {'targetOid': target}),
        ('compare_commit_with_working_tree', '--name-status', {}),
        ('compare_commit_file', '--unified=3', {'targetOid': target, 'path': 'fixture.txt'}),
        ('compare_commit_file_with_working_tree', '--unified=3', {'path': 'fixture.txt'}),
    ]
    records = report['comparisonResponsiveness'] = []
    for command, mode, extra in commands:
        result = held_git_command(driver, gate, command, mode, {'repoId': repo_id, 'baseOid': base, **extra}, records)
        if 'path' in extra:
            assert result['path'] == 'fixture.txt'
            expected = '+fixture 2' if 'targetOid' in extra else '+owned working comparison line'
            assert expected in result['patch']
        else:
            assert result['baseOid'] == base and len(result['files']) == 1
            assert result['files'][0]['path'] == 'fixture.txt'
        assert checkout_footprint(fixtures, repository) == before
    report['scenarios'].append('native-git-comparisons-do-not-block-unrelated-native-status-and-preserve-worktree')
    return repository, repo_id


def stash_responsiveness(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('stash-responsiveness', commits=3)
    (repository / 'fixture.txt').write_text('saved tracked draft\n')
    (repository / 'saved-note.txt').write_text('saved untracked note\n')
    fixtures.git(repository, 'stash', 'push', '--include-untracked', '-m', 'Owned slow stash')
    oid = fixtures.git(repository, 'rev-parse', 'refs/stash')
    (repository / 'fixture.txt').write_text('current tracked draft\n')
    (repository / 'working-note.txt').write_text('current untracked note\n')
    repo_id = open_ui(driver, repository)
    files = ('fixture.txt', 'working-note.txt')
    before = checkout_footprint(fixtures, repository, files)
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    records = report['stashResponsiveness'] = []
    request = {'repoId': repo_id, 'oid': oid}

    details = held_git_command(driver, gate, 'inspect_stash', '--name-status', request, records)
    assert details['oid'] == oid and 'Owned slow stash' in details['message']
    assert {file['path'] for file in details['files']} == {'fixture.txt', 'saved-note.txt'}
    assert checkout_footprint(fixtures, repository, files) == before
    diff = held_git_command(driver, gate, 'inspect_stash_file', '--unified=3',
                            {**request, 'path': 'saved-note.txt'}, records)
    assert diff['oid'] == oid and diff['path'] == 'saved-note.txt'
    assert '+saved untracked note' in diff['patch'] and 'current untracked note' not in diff['patch']
    assert checkout_footprint(fixtures, repository, files) == before
    assert not (repository / 'saved-note.txt').exists(), 'A preview restored the saved file'
    report['scenarios'].append('native-stash-preview-does-not-block-unrelated-native-status-or-apply-saved-data')
    return repository, repo_id


def commit_responsiveness(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('commit-responsiveness', commits=3)
    (repository / 'fixture.txt').write_text('owned staged commit content\n')
    fixtures.git(repository, 'add', '--', 'fixture.txt')
    (repository / 'fixture.txt').write_text('owned unstaged working edit\n')
    (repository / 'note.txt').write_text('owned untracked draft\n')
    repo_id = open_ui(driver, repository)
    files = ('fixture.txt', 'note.txt')
    before = checkout_footprint(fixtures, repository, files)
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    records = report['commitResponsiveness'] = []
    previous = before['head']
    for amend, message in [(False, 'Owned staged commit'), (True, 'Owned amended commit')]:
        result = held_git_command(driver, gate, 'commit_changes', 'commit', {
            'repoId': repo_id, 'message': message, 'amend': amend, 'skipHooks': False, 'sign': False,
        }, records)
        actual = checkout_footprint(fixtures, repository, files)
        assert actual['head'] != previous and result['headOid'] == actual['head'], result
        assert fixtures.git(repository, 'show', '-s', '--format=%s', 'HEAD') == message
        assert fixtures.git(repository, 'rev-parse', 'HEAD^') == before['head']
        assert fixtures.git(repository, 'show', 'HEAD:fixture.txt') == 'owned staged commit content'
        assert fixtures.git(repository, 'diff', '--cached', '--name-only') == ''
        assert fixtures.git(repository, 'diff', '--name-only') == 'fixture.txt'
        assert fixtures.git(repository, 'ls-files', '--others', '--exclude-standard') == 'note.txt'
        assert all(actual[key] == before[key] for key in ('branch', 'configSha256', 'files'))
        previous = actual['head']
    report['scenarios'].append('native-commit-and-amend-do-not-block-unrelated-native-status-or-include-unstaged-data')
    return repository, repo_id


def ignore_responsiveness(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('ignore-responsiveness', commits=3)
    (repository / 'fixture.txt').write_text('owned unstaged edit\n')
    (repository / 'first.log').write_text('owned selected untracked file\n')
    (repository / 'sibling.log').write_text('owned untracked sibling\n')
    files = ('fixture.txt', 'first.log', 'sibling.log')
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, files)
    staged_before = fixtures.git(repository, 'ls-files', '--stage')
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    records = report['ignoreResponsiveness'] = []

    result = held_git_command(driver, gate, 'ignore_path', 'check-ignore', {
        'repoId': repo_id, 'path': 'first.log', 'patternKind': 'extension', 'stopTracking': False,
    }, records)
    assert (repository / '.gitignore').read_bytes() == b'*.log\n'
    assert fixtures.git(repository, 'ls-files', '--stage') == staged_before
    paths = {entry['path'] for entry in result['status']['entries']}
    assert paths == {'.gitignore', 'fixture.txt'}, paths

    result = held_git_command(driver, gate, 'ignore_path', 'check-ignore', {
        'repoId': repo_id, 'path': 'fixture.txt', 'patternKind': 'file', 'stopTracking': True,
    }, records)
    assert (repository / '.gitignore').read_bytes() == b'*.log\n/fixture.txt\n'
    assert fixtures.git(repository, 'diff', '--cached', '--name-status', '--no-renames') == 'D\tfixture.txt'
    selected = next(entry for entry in result['status']['entries'] if entry['path'] == 'fixture.txt')
    assert selected['indexStatus'] == 'D', selected
    actual = checkout_footprint(fixtures, repository, files)
    assert all(actual[key] == before[key] for key in ('head', 'branch', 'references', 'configSha256', 'files'))
    report['scenarios'].append('native-ignore-leaves-updater-status-responsive-and-untracks-only-a-reviewed-file')
    return repository, repo_id
