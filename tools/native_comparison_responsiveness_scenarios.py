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
    fixtures.git(repository, 'branch', 'owned-baseline', base)
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
    comparison = held_git_command(driver, gate, 'compare_branches', '--count',
                                  {'repoId': repo_id, 'target': 'owned-baseline', 'source': 'main'}, records)
    assert comparison['targetOid'] == base and comparison['sourceOid'] == target, comparison
    assert comparison['mergeBase'] == base and comparison['incomingCount'] == 1, comparison
    assert comparison['outgoingCount'] == 0 and [row['oid'] for row in comparison['incoming']] == [target]
    assert checkout_footprint(fixtures, repository) == before
    report['scenarios'].append('native-branch-comparison-keeps-native-status-responsive-and-preserves-checkout')
    report['scenarios'].append('native-git-comparisons-do-not-block-unrelated-native-status-and-preserve-worktree')
    return repository, repo_id


def checkout_responsiveness(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('checkout-responsiveness', commits=3)
    tip = fixtures.git(repository, 'rev-parse', 'HEAD')
    base = fixtures.git(repository, 'rev-parse', 'HEAD^')
    fixtures.git(repository, 'branch', 'owned-topic', base)
    remote = fixtures.repository('checkout-tracking-source', commits=1)
    fixtures.git(repository, 'remote', 'add', 'origin', str(remote))
    fixtures.git(repository, 'update-ref', 'refs/remotes/origin/owned-tracking', tip)
    note = repository / 'owned-note.txt'
    note.write_bytes(b'Keep these unrelated local bytes.\n')
    repo_id = open_ui(driver, repository)
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    records = report['checkoutResponsiveness'] = []
    steps = [
        ('checkout_branch', {'name': 'owned-topic'}, 'owned-topic', base),
        ('checkout_remote_branch', {'name': 'origin/owned-tracking'}, 'owned-tracking', tip),
        ('checkout_commit', {'oid': base, 'expectedHeadOid': tip, 'expectedBranch': 'owned-tracking'}, None, base),
    ]
    for command, args, branch, oid in steps:
        result = held_git_command(driver, gate, command, '--no-overwrite-ignore', {'repoId': repo_id, **args}, records)
        assert result['status']['branch'] == branch and result['headOid'] == oid, result['status']
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == oid
        assert (repository / 'fixture.txt').read_text().rstrip() == fixtures.git(repository, 'show', oid + ':fixture.txt')
        assert note.read_bytes() == b'Keep these unrelated local bytes.\n'
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/main') == tip
    assert fixtures.git(repository, 'rev-parse', 'owned-tracking@{upstream}') == tip
    report['scenarios'].append('native-local-remote-and-detached-checkouts-keep-native-status-responsive')
    return repository, repo_id


def history_control_responsiveness(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('history-control-responsiveness', commits=3)
    tip = fixtures.git(repository, 'rev-parse', 'HEAD')
    base = fixtures.git(repository, 'rev-parse', 'HEAD^')
    repo_id = open_ui(driver, repository)
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    records = report['historyControlResponsiveness'] = []

    def held(command, mode, **args):
        return held_git_command(driver, gate, command, mode, {'repoId': repo_id, **args}, records)

    def pause_at_tip():
        review = dict(source='main', target='main', selectionOids=[tip], root=False)
        plan = held('prepare_interactive_rebase', '--max-count=501', **review)
        assert plan['base'] == base and [commit['oid'] for commit in plan['commits']] == [tip], plan
        result = held('execute_interactive_rebase', '-i', **review, ontoOid=None, reviewedTips=plan['tips'],
                      steps=[dict(oid=tip, action='edit', message=None)])
        assert result['status']['rebaseInProgress'] and result['status']['rebaseEditStopped']

    for command, mode in [('continue_rebase', '--continue'), ('abort_rebase', '--abort')]:
        pause_at_tip()
        result = held(command, mode)
        assert not result['status']['rebaseInProgress'] and result['status']['branch'] == 'main'
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
        assert fixtures.git(repository, 'status', '--porcelain=v1') == ''
    report['scenarios'].append('native-interactive-review-replay-continue-and-abort-leave-status-responsive')

    fixtures.git(repository, 'switch', '-c', 'owned-merge')
    (repository / 'merge-file.txt').write_text('Owned merge input\n')
    fixtures.git(repository, 'add', '--', 'merge-file.txt')
    fixtures.git(repository, 'commit', '-qm', 'Owned merge input')
    side = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'switch', 'main')
    for command, mode in [('abort_merge', '--abort'), ('continue_merge', '--continue')]:
        fixtures.git(repository, 'merge', '--no-ff', '--no-commit', 'owned-merge')
        result = held(command, mode)
        assert not result['status']['mergeInProgress'] and result['status']['branch'] == 'main'
        if command == 'abort_merge':
            assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
            assert not (repository / 'merge-file.txt').exists()
        else:
            assert fixtures.git(repository, 'show', '-s', '--format=%P', 'HEAD').split() == [tip, side]
            assert (repository / 'merge-file.txt').read_text() == 'Owned merge input\n'
        assert fixtures.git(repository, 'status', '--porcelain=v1') == ''
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/owned-merge') == side
    report['scenarios'].append('native-merge-continue-and-abort-leave-status-responsive-and-preserve-reviewed-history')
    return repository, repo_id


def local_mutation_responsiveness(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('local-mutation-responsiveness', commits=2)
    repo_id = open_ui(driver, repository)
    tip = fixtures.git(repository, 'rev-parse', 'HEAD')
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    records = report['localMutationResponsiveness'] = []

    def held(command, mode, **args):
        return held_git_command(driver, gate, command, mode, {'repoId': repo_id, **args}, records)

    tracked, note = repository / 'fixture.txt', repository / 'owned-note.txt'
    tracked_bytes = b'Owned stash tracked bytes\n'
    note_bytes = b'Owned stash untracked bytes\n'
    tracked.write_bytes(tracked_bytes)
    note.write_bytes(note_bytes)
    saved = held('stash_changes', '--include-untracked', message='Owned responsive stash')
    oid = fixtures.git(repository, 'rev-parse', 'refs/stash')
    assert saved['headOid'] == tip and not note.exists()
    assert fixtures.git(repository, 'status', '--porcelain=v1') == ''
    applied = held('apply_stash', 'apply', reference='stash@{0}', expectedOid=oid)
    assert applied['headOid'] == tip and fixtures.git(repository, 'rev-parse', 'refs/stash') == oid
    assert tracked.read_bytes() == tracked_bytes and note.read_bytes() == note_bytes
    fixtures.git(repository, 'restore', '--', 'fixture.txt')
    note.unlink()
    popped = held('pop_stash', 'apply', expectedOid=oid)
    assert popped['headOid'] == tip and not popped['stashes']
    assert tracked.read_bytes() == tracked_bytes and note.read_bytes() == note_bytes
    report['scenarios'].append('native-stash-save-apply-and-pop-keep-status-responsive-and-restore-owned-bytes')

    fixtures.git(repository, 'restore', '--', 'fixture.txt')
    note.unlink()
    fixtures.git(repository, 'switch', '-c', 'owned-pick')
    picked_file = repository / 'picked.txt'
    picked_file.write_bytes(b'Owned cherry-picked bytes\n')
    fixtures.git(repository, 'add', '--', 'picked.txt')
    fixtures.git(repository, 'commit', '-qm', 'Add owned cherry-pick input')
    source = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'switch', 'main')
    # Ensure the selected commit needs a replay, not a fast-forward.
    (repository / 'main.txt').write_bytes(b'Preserve the main-only history\n')
    fixtures.git(repository, 'add', '--', 'main.txt')
    fixtures.git(repository, 'commit', '-qm', 'Add owned main-only input')
    before = fixtures.git(repository, 'rev-parse', 'HEAD')
    picked = held('cherry_pick_commits', 'cherry-pick', oids=[source], noCommit=False)
    picked_oid = picked['headOid']
    assert picked_oid not in (before, source) and picked_file.read_bytes() == b'Owned cherry-picked bytes\n'
    assert fixtures.git(repository, 'rev-parse', 'HEAD^') == before
    reverted = held('revert_commit', 'revert', oid=picked_oid, noCommit=False)
    assert reverted['headOid'] != picked_oid and not picked_file.exists()
    assert fixtures.git(repository, 'rev-parse', 'HEAD^{tree}') == fixtures.git(repository, 'rev-parse', before + '^{tree}')
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/owned-pick') == source
    assert fixtures.git(repository, 'status', '--porcelain=v1') == ''
    report['scenarios'].append('native-cherry-pick-and-revert-keep-status-responsive-and-preserve-exact-history')
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

    tracked = repository / 'fixture.txt'
    tracked.write_text('Keep this independently staged change\n')
    fixtures.git(repository, 'add', '--', tracked.name)
    tracked.write_text('Keep this unstaged change too\n')
    fixtures.git(repository, 'branch', 'untouched-sibling')
    current = checkout_footprint(fixtures, repository, files)
    index_entries = fixtures.git(repository, 'ls-files', '--stage', '-z')
    trees = fixtures.git(repository, 'log', '--first-parent', '--format=%T')

    def assert_preserved():
        latest = checkout_footprint(fixtures, repository, files)
        assert all(latest[key] == current[key] for key in ('branch', 'status', 'configSha256', 'files'))
        assert fixtures.git(repository, 'ls-files', '--stage', '-z') == index_entries
        assert fixtures.git(repository, 'log', '--first-parent', '--format=%T') == trees
        assert fixtures.git(repository, 'rev-parse', 'refs/heads/untouched-sibling') == current['head']
        return latest

    subject = 'Owned message-only amendment'
    result = held_git_command(driver, gate, 'update_head_message', '--only', {
        'repoId': repo_id, 'checkout': {'headOid': current['head'], 'branch': current['branch']},
        'message': subject, 'skipHooks': False,
    }, records)
    amended = assert_preserved()
    assert amended['head'] == result['headOid'] != current['head']
    assert fixtures.git(repository, 'show', '-s', '--format=%s', 'HEAD') == subject
    report['scenarios'].append('native-message-only-amend-keeps-status-responsive-and-preserves-index')

    target = fixtures.git(repository, 'rev-parse', 'HEAD^')
    author = {'name': 'Owned Rewrite Author', 'email': 'rewrite@example.test'}
    result = held_git_command(driver, gate, 'edit_commit', 'commit-tree', {
        'repoId': repo_id, 'checkout': {'headOid': amended['head'], 'branch': amended['branch']},
        'targetOid': target, 'message': 'Owned ancestor edit', 'author': author, 'skipHooks': False,
    }, records)
    rewritten = assert_preserved()
    assert rewritten['head'] == result['headOid'] != amended['head']
    assert fixtures.git(repository, 'rev-parse', 'HEAD^') != target
    assert fixtures.git(repository, 'show', '-s', '--format=%s %an <%ae>', 'HEAD^') == (
        'Owned ancestor edit Owned Rewrite Author <rewrite@example.test>'
    )
    assert fixtures.git(repository, 'show', '-s', '--format=%s', 'HEAD') == subject
    report['scenarios'].append('native-ancestor-edit-keeps-status-responsive-and-preserves-trees-and-staging')
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
    assert fixtures.git(repository, 'ls-files', '--others', '--exclude-standard') == '.gitignore'
    paths = {entry['path'] for entry in result['status']['entries']}
    # Fast snapshots may defer the untracked scan. The separate Git oracle
    # above proves the ignored paths disappear from complete status.
    assert 'fixture.txt' in paths and not paths.intersection({'first.log', 'sibling.log'}), paths

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
