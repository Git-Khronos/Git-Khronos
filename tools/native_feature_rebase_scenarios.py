"""Verify reviewed feature rebases through the installed Branch workflows UI."""
import json
import threading
import time

from native_worktree_scenarios import checkout_footprint


def feature_rebase_on_configured_development(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('feature-rebase-owned', commits=2)
    production = fixtures.git(repository, 'rev-parse', 'HEAD')
    topic, development = 'feature/owned', 'integration'
    fixtures.git(repository, 'branch', topic)
    fixtures.git(repository, 'switch', '-c', development)

    def commit_file(path, contents, message):
        (repository / path).write_text(contents)
        fixtures.git(repository, 'add', '--', path)
        fixtures.git(repository, 'commit', '-qm', message)
        return fixtures.git(repository, 'rev-parse', 'HEAD')

    target = commit_file('development.txt', 'owned development\n', 'Owned development change')
    fixtures.git(repository, 'switch', topic)
    sibling = commit_file('first.txt', 'owned feature first\n', 'Owned feature step one')
    fixtures.git(repository, 'branch', 'sibling', sibling)
    source = commit_file('second.txt', 'owned feature second\n', 'Owned feature step two')
    fixtures.git(repository, 'config', '--local', 'rebase.updateRefs', 'true')
    fixtures.git(repository, 'config', '--local', 'gitkhronos.branchWorkflow', json.dumps({
        'version': 1, 'production': 'main', 'development': development,
        'featurePrefix': 'feature/', 'releasePrefix': 'release/', 'hotfixPrefix': 'hotfix/', 'tagPrefix': '',
    }))
    config = (repository / '.git/config').read_bytes()
    before = checkout_footprint(fixtures, repository, ('fixture.txt', 'first.txt', 'second.txt'))
    repo_id = open_ui(driver, repository)
    workflow = 'gk-branch-workflow-dialog'
    integration = 'gk-integrate-branch-dialog'

    def button(owner, name):
        driver.click_scrolled_text(owner + ' button', name, wait_for_ready=True)

    def ready():
        driver.wait('return [...document.querySelectorAll("gk-branch-workflow-dialog button")].some(button => '
                    'button.textContent.trim() === "Reload workflow state" && !button.disabled)')

    def enter_finish():
        driver.click_visible('.workspace-toggle')
        driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Branch workflows', wait_for_ready=True)
        ready()
        button(workflow, 'Finish ' + topic)
        button(workflow, 'Review finish')
        ready()

    def review_rebase():
        button(workflow, f'Review feature rebase onto {development}…')
        driver.wait('return document.querySelector("gk-integrate-branch-dialog [role=dialog] h2")?.textContent.trim() '
                    '=== "Review feature rebase"')
        driver.wait('return [...document.querySelectorAll("gk-integrate-branch-dialog button")].some(button => '
                    'button.textContent.trim() === ' + json.dumps(f'Rebase {topic} onto {development}')
                    + ' && !button.disabled)')
        assert not driver.script('return !!document.querySelector("gk-branch-workflow-dialog, #integrate-source")')

    enter_finish()
    review_rebase()
    button(integration, 'Cancel')
    driver.wait('return !document.querySelector("gk-integrate-branch-dialog")')
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'first.txt', 'second.txt')) == before

    enter_finish()
    review_rebase()
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'first.txt', 'second.txt')) == before
    button(integration, f'Rebase {topic} onto {development}')
    deadline = time.monotonic() + 12
    rebased = source
    while rebased == source and time.monotonic() < deadline:
        rebased = fixtures.git(repository, 'rev-parse', 'refs/heads/' + topic)
        if rebased == source:
            time.sleep(.05)
    assert rebased != source, 'The reviewed feature branch did not advance'
    assert fixtures.git(repository, 'symbolic-ref', '--short', 'HEAD') == topic
    assert fixtures.git(repository, 'rev-parse', 'HEAD^^') == target
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/' + development) == target
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/main') == production
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/sibling') == sibling
    assert fixtures.git(repository, 'status', '--porcelain') == ''
    assert (repository / 'first.txt').read_text() == 'owned feature first\n'
    assert (repository / 'second.txt').read_text() == 'owned feature second\n'
    assert (repository / 'development.txt').read_text() == 'owned development\n'
    assert (repository / '.git/config').read_bytes() == config

    enter_finish()
    driver.wait('return document.querySelector("gk-branch-workflow-dialog .review")?.textContent.includes('
                + json.dumps(rebased) + ')')
    report['featureRebase'] = {'oldTip': source, 'rebasedTip': rebased, 'developmentTip': target,
                               'siblingTip': sibling, 'repositoryConfigUnchanged': True,
                               'freshFinishReviewContainsRebasedTip': True}
    report['scenarios'].append('native-feature-rebase-uses-configured-development-without-moving-sibling-refs')
    return repository, repo_id


def merge_preserving_rebase_review(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('merge-rebase-review-owned', commits=2)
    base = fixtures.git(repository, 'rev-parse', 'HEAD')

    def commit(name):
        (repository / name).write_text(name + '\n')
        fixtures.git(repository, 'add', '--', name)
        fixtures.git(repository, 'commit', '-qm', 'Add ' + name)
        return fixtures.git(repository, 'rev-parse', 'HEAD')

    fixtures.git(repository, 'switch', '-c', 'owned-destination')
    destination = commit('destination.txt')
    fixtures.git(repository, 'switch', 'main')
    topic_base = commit('topic.txt')
    fixtures.git(repository, 'switch', '-c', 'owned-side')
    second_parent = commit('side.txt')
    fixtures.git(repository, 'switch', 'main')
    first_parent = commit('main-only.txt')
    fixtures.git(repository, 'merge', '--no-ff', '-m', 'Join owned side', 'owned-side')
    source = fixtures.git(repository, 'rev-parse', 'HEAD')

    paths = ('fixture.txt', 'topic.txt', 'side.txt', 'main-only.txt')
    before = checkout_footprint(fixtures, repository, paths)
    refs = fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)')
    repo_id = open_ui(driver, repository)
    plan = driver.invoke('prepare_merge_rebase', repoId=repo_id, source='main', target='owned-destination')
    assert plan['request'] == {
        'source': 'main', 'target': 'owned-destination',
        'sourceOid': source, 'targetOid': destination, 'base': base,
    }, plan
    assert {row['oid'] for row in plan['commits']} == {topic_base, first_parent, second_parent, source}, plan
    assert next(row for row in plan['commits'] if row['oid'] == source)['parents'] == [first_parent, second_parent]
    branch = '#reference-section-local [aria-label="Local branch owned-destination"]'
    dialog = '[role=dialog][aria-labelledby=merge-rebase-title]'
    pending = '[role=dialog][aria-label="Preparing merge-preserving rebase"]'
    gate = fixtures.history_gate
    hold, started = gate / 'hold', gate / 'started'
    (gate / 'target').write_text(str(repository))

    def request_review():
        driver.wait(f'return !!document.querySelector({json.dumps(branch)})?.getClientRects().length')
        driver.context_click(branch)
        driver.click_scrolled_text('.context-menu [role=menuitem]', 'Rebase preserving merges…', wait_for_ready=True)

    def open_review():
        request_review()
        driver.wait("""return [...document.querySelectorAll('[role=dialog]')].some(dialog =>
            dialog.querySelector('[aria-label="Reviewed merge-preserving topology"]')?.textContent.includes('Join owned side'))""")

    def cancel():
        driver.click_scrolled_text(dialog + ' button', 'Cancel', wait_for_ready=True)
        driver.wait(f'return !document.querySelector({json.dumps(dialog)})')

    (gate / 'mode').write_text('--max-count=501')
    hold.touch()
    watchdog = threading.Timer(12, lambda: hold.unlink(missing_ok=True))
    watchdog.start()
    try:
        request_review()
        close = driver.wait(f"""return document.querySelector({json.dumps(pending)} + ' button') ===
            document.activeElement && document.activeElement?.textContent.trim() === 'Close review'""", timeout=7)
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert close and started.exists() and hold.exists(), 'The native review was not held behind the pending dialog'
        driver.key('\uE00C')
        driver.wait(f'return !document.querySelector({json.dumps(pending)})')
        driver.wait(f'return document.activeElement?.matches({json.dumps(branch)})')
        assert hold.exists(), 'The pending dialog did not dismiss while the native review was running'
    finally:
        watchdog.cancel()
        watchdog.join()
        hold.unlink(missing_ok=True)
    driver.wait("return !document.querySelector('.activity-status.running')")
    assert not driver.script('return !!document.querySelector(arguments[0])', dialog)
    assert checkout_footprint(fixtures, repository, paths) == before
    report['scenarios'].append('native-slow-merge-rebase-review-dismisses-before-git-finishes-without-writes')

    open_review()
    cancel()
    assert checkout_footprint(fixtures, repository, paths) == before
    assert fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)') == refs
    report['scenarios'].append('native-merge-preserving-review-shows-exact-parents-and-cancel-leaves-checkout-unchanged')

    open_review()
    destination_tree = fixtures.git(repository, 'rev-parse', destination + '^{tree}')
    advanced = fixtures.git(repository, 'commit-tree', destination_tree, '-p', destination, '-m', 'Advance reviewed destination')
    fixtures.git(repository, 'update-ref', 'refs/heads/owned-destination', advanced, destination)
    advanced_refs = fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)')
    advanced_footprint = checkout_footprint(fixtures, repository, paths)
    driver.click_scrolled_text(dialog + ' button', 'Start merge-preserving rebase', wait_for_ready=True)
    driver.wait("""return document.querySelector('#merge-rebase-title')?.closest('[role=dialog]')
        ?.querySelector('[role=alert]')?.textContent.includes('changed after review')""")
    assert checkout_footprint(fixtures, repository, paths) == advanced_footprint
    assert fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)') == advanced_refs
    cancel()
    report['scenarios'].append('native-merge-preserving-rebase-refuses-stale-destination-before-writing')

    open_review()
    (gate / 'mode').write_text('--rebase-merges=no-rebase-cousins')
    started.unlink(missing_ok=True)
    hold.touch()
    # Release on failure as well, so a synchronous regression cannot strand Git.
    watchdog = threading.Timer(12, lambda: hold.unlink(missing_ok=True))
    watchdog.start()
    try:
        driver.click_scrolled_text(dialog + ' button', 'Start merge-preserving rebase', wait_for_ready=True)
        deadline = time.monotonic() + 8
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert started.exists(), 'Git did not reach the rebase gate'
        status = driver.invoke('application_update_status')
        assert status.get('runningVersion') and hold.exists(), 'Native status waited for the held rebase'
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == source
    finally:
        watchdog.cancel()
        watchdog.join()
        hold.unlink(missing_ok=True)
    driver.wait(f'return !document.querySelector({json.dumps(dialog)})')
    rebased, *parents = fixtures.git(repository, 'rev-list', '--parents', '-n', '1', 'HEAD').split()
    assert rebased != source and len(parents) == 2, (rebased, parents)
    for parent in parents:
        assert fixtures.git(repository, 'merge-base', parent, advanced) == advanced
    for ref, oid in [('owned-destination', advanced), ('owned-side', second_parent)]:
        assert fixtures.git(repository, 'rev-parse', 'refs/heads/' + ref) == oid
    assert fixtures.git(repository, 'symbolic-ref', '--short', 'HEAD') == 'main'
    assert fixtures.git(repository, 'status', '--porcelain=v1') == ''
    assert fixtures.git(repository, 'for-each-ref', '--format=%(objectname)', 'refs/git-khronos/recovery').split() == [source]
    assert set(fixtures.git(repository, 'ls-tree', '-r', '--name-only', 'HEAD').splitlines()) == {
        *paths, 'destination.txt',
    }
    report['scenarios'].append('native-merge-preserving-rebase-keeps-topology-sibling-refs-and-protects-original-tip')
    report['scenarios'].append('native-merge-preserving-rebase-leaves-native-status-responsive')
    return repository, repo_id
