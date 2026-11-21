"""Hold real Git comparisons while checking an unrelated native command."""
import threading
import time

from native_worktree_scenarios import checkout_footprint


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
    hold = gate / 'hold'
    started = gate / 'started'
    commands = [
        ('compare_commits', '--name-status', {'targetOid': target}),
        ('compare_commit_with_working_tree', '--name-status', {}),
        ('compare_commit_file', '--unified=3', {'targetOid': target, 'path': 'fixture.txt'}),
        ('compare_commit_file_with_working_tree', '--unified=3', {'path': 'fixture.txt'}),
    ]
    records = report['comparisonResponsiveness'] = []
    for command, mode, extra in commands:
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
            driver.script("""window.__ownedComparison = {pending: true};
                window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(
                    result => window.__ownedComparison = {result},
                    error => window.__ownedComparison = {error});""",
                          command, {'repoId': repo_id, 'baseOid': base, **extra})
            deadline = time.monotonic() + 8
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(.05)
            assert started.exists() and started.read_text().strip().isdigit(), command
            status = driver.invoke('application_update_status')
            pending = driver.script('return window.__ownedComparison.pending === true')
            records.append({'command': command, 'nativeStatusSettled': bool(status.get('runningVersion')),
                            'comparisonPending': pending, 'watchdogReleased': released.is_set()})
            assert status.get('runningVersion') and pending and hold.exists() and not released.is_set(), records[-1]
        finally:
            watchdog.cancel()
            watchdog.join()
            hold.unlink(missing_ok=True)

        outcome = driver.wait('return window.__ownedComparison?.pending ? null : window.__ownedComparison')
        assert 'result' in outcome, outcome
        result = outcome['result']
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
