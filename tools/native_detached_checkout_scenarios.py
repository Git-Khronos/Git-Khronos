"""Exercise reviewed detached HEAD with packaged controls and independent Git oracles."""
import json
import subprocess

from native_acceptance import open_ui
from native_worktree_scenarios import checkout_footprint


def guarded_checkout_targets(driver, fixtures, report):
    repository = fixtures.repository('guarded-checkout-targets', commits=2)
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'remote', 'add', 'origin', str(fixtures.root / 'unused-checkout-remote'))
    fixtures.git(repository, 'config', 'checkout.guess', 'true')
    fixtures.git(repository, 'branch', 'selected')
    fixtures.git(repository, 'update-ref', 'refs/remotes/origin/selected', head)
    fixtures.git(repository, 'switch', '-c', 'tracks-settings')
    settings = repository / 'settings.local'
    settings.write_text('Tracked settings on the target branch.\n')
    fixtures.git(repository, 'add', 'settings.local')
    fixtures.git(repository, 'commit', '-qm', 'Track settings on the target branch')
    target = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'switch', 'main')
    fixtures.git(repository, 'commit', '--allow-empty', '-qm', 'Diverge the receiving branch')
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    (repository / '.git/info/exclude').write_text('/settings.local\n')
    settings.write_text('Ignored local settings must survive checkout.\n')
    assert fixtures.git(repository, 'check-ignore', 'settings.local') == 'settings.local'
    repo_id = open_ui(driver, repository)
    fixtures.git(repository, 'branch', '-D', 'selected')
    files = ('fixture.txt', 'settings.local')
    before = checkout_footprint(fixtures, repository, files)

    def refused(command, kind, **payload):
        try:
            driver.invoke(command, repoId=repo_id, **payload)
        except RuntimeError as refusal:
            error = json.loads(str(refusal))
            assert error['kind'] == kind, error
        else:
            raise AssertionError(f'{command} changed the reviewed checkout unexpectedly')
        assert checkout_footprint(fixtures, repository, files) == before

    refused('checkout_branch', 'localBranchNotFound', name='selected', review=None)
    report['scenarios'].append('native-stale-local-checkout-does-not-recreate-remote-tracking-branch')
    refused('checkout_branch', 'gitFailure', name='tracks-settings', review=None)
    refused('checkout_commit', 'gitFailure', oid=target, expectedHeadOid=head, expectedBranch='main')
    report['scenarios'].append('native-branch-and-detached-checkout-preserve-an-ignored-local-file')
    review = {
        'receivingBranch': 'main', 'receivingOid': head,
        'sourceBranch': 'tracks-settings', 'sourceOid': target,
    }
    refused('integrate_branch', 'mergeLocalPathObstruction', name='tracks-settings', strategy='merge', review=review)
    report['scenarios'].append('native-reviewed-merge-refuses-to-overwrite-an-ignored-local-file')
    refused('integrate_branch', 'rebaseLocalPathObstruction', name='tracks-settings', strategy='rebase', review=review)
    assert not (repository / '.git/rebase-merge').exists()
    assert not (repository / '.git/rebase-apply').exists()
    report['scenarios'].append('native-reviewed-rebase-refuses-an-ignored-file-at-the-new-base')
    # External movement to a merged tip does not authorize even a safe delete.
    fixtures.git(repository, 'branch', 'delete-review', 'HEAD^')
    previous_tip = fixtures.git(repository, 'rev-parse', 'refs/heads/delete-review')
    fixtures.git(repository, 'branch', '-f', 'delete-review', 'HEAD')
    before = checkout_footprint(fixtures, repository, files)
    for force in (False, True):
        refused('delete_branch', 'branchDeleteReviewChanged', name='delete-review',
                force=force, expectedOid=previous_tip)
    report['scenarios'].append('native-local-branch-delete-refuses-a-moved-tip')


def context_rebase_preserves_sibling(driver, fixtures, report):
    repository = fixtures.repository('context-rebase-scope', commits=2)
    fixtures.git(repository, 'config', 'rebase.updateRefs', 'true')
    fixtures.git(repository, 'switch', '-c', 'owned-upstream')
    (repository / 'upstream-note.txt').write_text('Owned upstream change.\n')
    fixtures.git(repository, 'add', '--', 'upstream-note.txt')
    fixtures.git(repository, 'commit', '-qm', 'Advance owned upstream independently')
    upstream = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'switch', 'main')
    for name in ('first-local.txt', 'second-local.txt'):
        (repository / name).write_text('Owned local data in ' + name + '.\n')
        fixtures.git(repository, 'add', '--', name)
        fixtures.git(repository, 'commit', '-qm', 'Add ' + name)
    fixtures.git(repository, 'branch', 'owned-sibling', 'HEAD^')
    sibling = fixtures.git(repository, 'rev-parse', 'refs/heads/owned-sibling')
    old_head = fixtures.git(repository, 'rev-parse', 'HEAD')
    (repository / '.git/info/exclude').write_text('/settings.local\n')
    settings = repository / 'settings.local'
    settings.write_text('Unrelated ignored content must survive rebase.\n')
    open_ui(driver, repository)
    branch = '#reference-section-local [aria-label="Local branch owned-upstream"]'
    dialog = '[role=alertdialog][aria-labelledby=branch-confirmation-title]'
    driver.wait(f'return !!document.querySelector({json.dumps(branch)})?.getClientRects().length')
    driver.context_click(branch)
    driver.click_scrolled_text('.context-menu button', 'Rebase main onto owned-upstream…', wait_for_ready=True)
    driver.wait(f'return !!document.querySelector({json.dumps(dialog)})?.getClientRects().length')
    assert 'rebasing main onto owned-upstream' in driver.script(
        'return document.querySelector(arguments[0]).textContent', dialog)
    driver.click_scrolled_text(dialog + ' button', 'Rebase', wait_for_ready=True)
    driver.wait(f'return !document.querySelector({json.dumps(dialog)})')
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    assert head != old_head and fixtures.git(repository, 'rev-parse', 'HEAD^^') == upstream
    assert fixtures.git(repository, 'symbolic-ref', 'HEAD') == 'refs/heads/main'
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/owned-upstream') == upstream
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/owned-sibling') == sibling, (
        'The context rebase rewrote a sibling branch that the user did not review')
    assert fixtures.git(repository, 'config', 'rebase.updateRefs') == 'true'
    assert fixtures.git(repository, 'status', '--porcelain') == ''
    assert settings.read_text() == 'Unrelated ignored content must survive rebase.\n'
    report['scenarios'].append('native-context-rebase-preserves-unreviewed-sibling-branches')


def abort_apply_rebase_preserves_ignored_settings(driver, fixtures, report):
    repository = fixtures.repository('owned-apply-rebase-stop', commits=2)
    settings = repository / 'settings.local'
    settings.write_text('Tracked settings on the original branch.\n')
    fixtures.git(repository, 'add', '--', settings.name)
    fixtures.git(repository, 'commit', '-qm', 'Add tracked settings')
    fixtures.git(repository, 'switch', '-qc', 'upstream')
    fixtures.git(repository, 'rm', '--', settings.name)
    (repository / 'fixture.txt').write_text('Upstream version.\n')
    fixtures.git(repository, 'commit', '-qam', 'Change upstream text')
    fixtures.git(repository, 'switch', 'main')
    (repository / 'fixture.txt').write_text('Topic version.\n')
    fixtures.git(repository, 'commit', '-qam', 'Change topic text')
    original = fixtures.git(repository, 'rev-parse', 'HEAD')
    from_stash = repository / 'stashed.local'
    from_stash.write_text('Staged before starting Rebase.\n')
    fixtures.git(repository, 'add', '--', from_stash.name)
    stopped = subprocess.run(
        ['git', '-C', str(repository), 'rebase', '--apply', '--autostash', 'upstream'],
        env=fixtures.env, capture_output=True, timeout=20,
    )
    assert stopped.returncode != 0 and (repository / '.git/rebase-apply/rebasing').is_file(), stopped.stderr
    autostash = repository / '.git/rebase-apply/autostash'
    stash_before = autostash.read_bytes()
    assert not settings.exists() and not from_stash.exists()
    (repository / '.git/info/exclude').write_text('/settings.local\n/stashed.local\n/saved-stash\n')
    settings.write_text('Only copy of ignored local settings.\n')
    from_stash.write_text('Only copy of text created during Rebase.\n')
    assert fixtures.git(repository, 'check-ignore', '--', from_stash.name) == from_stash.name
    open_ui(driver, repository)
    driver.wait('return !!document.querySelector(\'.rebase-progress[aria-label="Git rebase in progress"]\')')

    def refuse(blocked, files):
        before = checkout_footprint(fixtures, repository, files)
        driver.click_scrolled_text('.rebase-progress button', 'Abort', wait_for_ready=True)
        expected = f"Abort Rebase could overwrite ignored local contents at '{blocked.name}'"
        driver.wait("return document.querySelector('.error-toast')?.textContent.includes(" + json.dumps(expected) + ")")
        assert checkout_footprint(fixtures, repository, files) == before
        assert (repository / '.git/rebase-apply/rebasing').is_file()
        assert autostash.read_bytes() == stash_before

    refuse(settings, ('fixture.txt', settings.name, from_stash.name))
    saved = repository / 'saved-settings'
    settings.rename(saved)
    refuse(from_stash, ('fixture.txt', saved.name, from_stash.name))
    saved_stash = repository / 'saved-stash'
    from_stash.rename(saved_stash)
    driver.click_scrolled_text('.rebase-progress button', 'Abort', wait_for_ready=True)
    driver.wait("return !document.querySelector('.rebase-progress') && document.querySelector('.activity-status')?.textContent.includes('Rebase aborted')")
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == original
    assert fixtures.git(repository, 'symbolic-ref', 'HEAD') == 'refs/heads/main'
    assert settings.read_text() == 'Tracked settings on the original branch.\n'
    assert saved.read_text() == 'Only copy of ignored local settings.\n'
    assert not autostash.exists()
    assert from_stash.read_text() == 'Staged before starting Rebase.\n'
    assert saved_stash.read_text() == 'Only copy of text created during Rebase.\n'
    report['scenarios'].append('native-abort-apply-rebase-preserves-ignored-file-and-allows-safe-retry')
    report['scenarios'].append('native-abort-apply-rebase-preserves-ignored-autostash-file')


def recovery_reset_preserves_ignored_files(driver, fixtures, report):
    for mode in ('rebase-merge', 'rebase-apply', 'merge-abort'):
        repository = fixtures.repository(f'owned-recovery-reset-{mode}', commits=2)
        work_file = repository / 'fixture.txt'
        saved_copy = repository / 'saved-fixture.txt'
        staged = repository / 'staged.local'
        fixtures.git(repository, 'switch', '-qc', 'upstream')
        work_file.write_text('Upstream contents.\n')
        fixtures.git(repository, 'commit', '-qam', 'Change upstream text')
        upstream = fixtures.git(repository, 'rev-parse', 'HEAD')
        fixtures.git(repository, 'switch', 'main')
        work_file.write_text('Current branch contents.\n')
        fixtures.git(repository, 'commit', '-qam', 'Change local text')
        original = fixtures.git(repository, 'rev-parse', 'HEAD')
        merge = mode == 'merge-abort'
        if merge:
            staged.write_text('Staged before starting Merge.\n')
            fixtures.git(repository, 'add', '--', staged.name)
            command = ['merge', '--autostash', '--no-edit', 'upstream']
            marker = repository / '.git/MERGE_HEAD'
            progress, action, message = '.merge-progress', 'Abort', 'Abort Merge'
        else:
            command = ['rebase', '--' + mode.removeprefix('rebase-'), 'upstream']
            marker = repository / '.git' / mode / 'orig-head'
            progress, action, message = '.rebase-progress', 'Skip', 'Skip Rebase Commit'
        stopped = subprocess.run(
            ['git', '-C', str(repository), *command], env=fixtures.env,
            capture_output=True, timeout=20,
        )
        assert stopped.returncode != 0 and marker.is_file(), stopped.stderr
        owner = marker.read_bytes()
        assert fixtures.git(repository, 'ls-files', '-u', '--', work_file.name)
        fixtures.git(repository, 'rm', '-f', '--', work_file.name)
        (repository / '.git/info/exclude').write_text(
            f'/{work_file.name}\n/{saved_copy.name}\n/{staged.name}\n/staged.saved\n'
        )
        work_file.write_text('Only copy of ignored local text.\n')
        assert fixtures.git(repository, 'check-ignore', '--', work_file.name) == work_file.name
        if merge:
            stash = repository / '.git/MERGE_AUTOSTASH'
            stash_oid = stash.read_bytes()
            assert not staged.exists()
            staged.write_text('Only copy of later ignored text.\n')
            assert fixtures.git(repository, 'check-ignore', '--', staged.name) == staged.name
        open_ui(driver, repository)
        driver.wait(f'return !!document.querySelector({json.dumps(progress)})')

        def refuse(blocked, files):
            before = checkout_footprint(fixtures, repository, files)
            driver.click_scrolled_text(progress + ' button', action, wait_for_ready=True)
            expected = f"{message} could overwrite ignored local contents at '{blocked.name}'"
            driver.wait(
                "return document.querySelector('.error-toast')?.textContent.includes("
                + json.dumps(expected) + ") || null"
            )
            assert checkout_footprint(fixtures, repository, files) == before
            assert marker.read_bytes() == owner
            if merge:
                assert stash.read_bytes() == stash_oid

        refuse(work_file, (work_file.name, staged.name) if merge else (work_file.name,))
        work_file.rename(saved_copy)
        if merge:
            refuse(staged, (saved_copy.name, staged.name))
            saved_stash_copy = repository / 'staged.saved'
            staged.rename(saved_stash_copy)
        driver.click_scrolled_text(progress + ' button', action, wait_for_ready=True)
        done = 'Merge aborted' if merge else 'Rebase complete'
        driver.wait(
            f"return !document.querySelector({json.dumps(progress)}) && "
            f"document.querySelector('.activity-status')?.textContent.includes({json.dumps(done)})"
        )
        assert not marker.exists()
        assert fixtures.git(repository, 'symbolic-ref', 'HEAD') == 'refs/heads/main'
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == (original if merge else upstream)
        assert work_file.read_text() == ('Current branch contents.\n' if merge else 'Upstream contents.\n')
        assert saved_copy.read_text() == 'Only copy of ignored local text.\n'
        if merge:
            assert not stash.exists()
            assert staged.read_text() == 'Staged before starting Merge.\n'
            assert saved_stash_copy.read_text() == 'Only copy of later ignored text.\n'
            scenario = 'native-merge-abort-preserves-ignored-reset-and-autostash-files'
        else:
            scenario = f'native-skip-{mode}-preserves-ignored-reset-file'
        report['scenarios'].append(scenario)


def mail_recovery_preserves_ignored_files(driver, fixtures, report):
    for action in ('skip', 'abort'):
        repository = fixtures.repository(f'owned-mail-recovery-{action}', commits=2)
        path = repository / 'fixture.txt'
        fixtures.git(repository, 'switch', '-qc', 'mail-source')
        path.write_text('Mailed change.\n')
        fixtures.git(repository, 'commit', '-qam', 'Owned mail patch')
        series = fixtures.root / f'owned-{action}.mbox'
        series.write_text(fixtures.git(repository, 'format-patch', '-1', '--stdout') + '\n')
        fixtures.git(repository, 'switch', 'main')
        path.write_text('Existing receiver change.\n')
        fixtures.git(repository, 'commit', '-qam', 'Change the recipient')
        receiver = fixtures.git(repository, 'rev-parse', 'HEAD')
        stopped = subprocess.run(
            ['git', '-C', str(repository), 'am', '--3way', '--', str(series)],
            env=fixtures.env, capture_output=True, timeout=20,
        )
        marker = repository / '.git/rebase-apply/applying'
        assert stopped.returncode != 0 and marker.is_file(), stopped.stderr
        assert fixtures.git(repository, 'ls-files', '-u', '--', path.name)
        fixtures.git(repository, 'rm', '-f', '--', path.name)
        saved = repository / 'saved-local'
        (repository / '.git/info/exclude').write_text(f'/{path.name}\n/{saved.name}\n')
        original = b'The only ignored copy.\n'
        path.write_bytes(original)
        repo_id = open_ui(driver, repository)
        before = checkout_footprint(fixtures, repository, (path.name,))
        kind = f'mailPatch{action.title()}LocalPathObstruction'
        try:
            driver.invoke('control_mail_patch', repoId=repo_id, action=action)
        except RuntimeError as refusal:
            error = json.loads(str(refusal))
            assert error['kind'] == kind and path.name in error['message'], error
        else:
            raise AssertionError(f'Mail-patch {action} accepted an ignored-file collision')
        assert marker.is_file()
        assert checkout_footprint(fixtures, repository, (path.name,)) == before
        assert path.read_bytes() == original
        path.rename(saved)
        result = driver.invoke('control_mail_patch', repoId=repo_id, action=action)
        assert not result['stopped'] and not marker.exists(), result
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == receiver
        assert path.read_text() == 'Existing receiver change.\n'
        assert saved.read_bytes() == original
        report['scenarios'].append(f'native-mail-patch-{action}-preserves-ignored-reset-file')


def bisect_reset_preserves_ignored_files(driver, fixtures, report):
    repository = fixtures.repository('owned-bisect-reset', commits=6)
    good = fixtures.git(repository, 'rev-parse', 'HEAD~5')
    settings = repository / 'settings.local'
    settings.write_text('Tracked settings on the original branch.\n')
    fixtures.git(repository, 'add', '--', settings.name)
    fixtures.git(repository, 'commit', '-qm', 'Track settings after the test revisions')
    original = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'tag', 'main', good)
    fixtures.git(repository, 'bisect', 'start', original, good)
    assert fixtures.git(repository, 'rev-parse', 'HEAD') != original
    assert not settings.exists()
    marker = repository / '.git/BISECT_START'
    start = marker.read_bytes()
    saved = repository / 'saved-settings'
    (repository / '.git/info/exclude').write_text(f'/{settings.name}\n/{saved.name}\n')
    settings.write_text('Only copy of local test settings.\n')
    open_ui(driver, repository)
    driver.wait("return !!document.querySelector('.bisect-progress')")
    before = checkout_footprint(fixtures, repository, ('fixture.txt', settings.name))
    driver.click_scrolled_text('.bisect-progress button', 'Reset', wait_for_ready=True)
    driver.wait("return document.querySelector('.error-toast')?.textContent.includes('Reset Bisect could overwrite ignored local contents')")
    assert checkout_footprint(fixtures, repository, ('fixture.txt', settings.name)) == before
    assert marker.read_bytes() == start
    settings.rename(saved)
    driver.click_scrolled_text('.bisect-progress button', 'Reset', wait_for_ready=True)
    driver.wait("return !document.querySelector('.bisect-progress') && document.querySelector('.activity-status')?.textContent.includes('Bisect reset')")
    assert not marker.exists()
    assert fixtures.git(repository, 'symbolic-ref', 'HEAD') == 'refs/heads/main'
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == original
    assert settings.read_text() == 'Tracked settings on the original branch.\n'
    assert saved.read_text() == 'Only copy of local test settings.\n'
    report['scenarios'].append('native-bisect-reset-preserves-ignored-file-and-allows-safe-retry')


def bisect_start_rejects_a_stale_checkout(driver, fixtures, report):
    repository = fixtures.repository('owned-bisect-start-review', commits=6)
    repo_id = open_ui(driver, repository)
    bad = fixtures.git(repository, 'rev-parse', 'HEAD')
    good = fixtures.git(repository, 'rev-parse', 'HEAD~5')
    review = {'badOid': bad, 'goodOid': good, 'branch': 'main'}
    fixtures.git(repository, 'switch', '-qc', 'same-tip')
    before = checkout_footprint(fixtures, repository)
    marker = repository / '.git/BISECT_START'
    try:
        driver.invoke('start_bisect', repoId=repo_id, review=review)
    except RuntimeError as error:
        details = json.loads(str(error))
        assert details['kind'] == 'staleBisectStart', details
    else:
        raise AssertionError('A stale bisect review moved the other checkout')
    assert not marker.exists() and not fixtures.git(repository, 'for-each-ref', 'refs/bisect')
    assert checkout_footprint(fixtures, repository) == before
    driver.invoke('start_bisect', repoId=repo_id, review={**review, 'branch': 'same-tip'})
    assert marker.is_file() and fixtures.git(repository, 'rev-parse', 'HEAD') != bad
    driver.invoke('reset_bisect', repoId=repo_id)
    assert not marker.exists() and fixtures.git(repository, 'rev-parse', 'HEAD') == bad
    assert fixtures.git(repository, 'symbolic-ref', 'HEAD') == 'refs/heads/same-tip'
    report['scenarios'].append('native-bisect-start-refuses-a-stale-branch-at-the-same-tip')


def bisect_can_start_without_switching_dirty_checkout(driver, fixtures, report):
    repository = fixtures.repository('owned-bisect-keep-checkout', commits=7)
    bad = fixtures.git(repository, 'rev-parse', 'HEAD')
    good = fixtures.git(repository, 'rev-parse', 'HEAD~6')
    (repository / 'staged.txt').write_text('Keep this exact index content.\n')
    fixtures.git(repository, 'add', '--', 'staged.txt')
    (repository / 'fixture.txt').write_text('Keep my uncommitted work.\n')
    (repository / 'untracked.txt').write_text('Keep this untracked file.\n')
    files = ('fixture.txt', 'staged.txt', 'untracked.txt')
    before = checkout_footprint(fixtures, repository, files)
    repo_id = open_ui(driver, repository)
    driver.wait("return document.querySelector('.commit-row[data-commit-oid=" + json.dumps(good) + "]') !== null")
    driver.context_click(f'.commit-row[data-commit-oid="{good}"]')
    driver.click_scrolled_text('[role="menuitem"]', 'Start bisect from here…', wait_for_ready=True)
    dialog = '[role="alertdialog"][aria-labelledby="bisect-dialog-title"]'
    driver.wait("return document.querySelector(" + json.dumps(dialog + ' .confirm-action') + ")?.disabled")
    driver.click_visible(dialog + ' input[type="checkbox"]')
    driver.click_scrolled_text(dialog + ' button', 'Start Bisect', wait_for_ready=True)
    banner = '[aria-label="Git bisect in progress"]'
    driver.wait("return document.querySelector(" + json.dumps(banner + ' small') + ")?.textContent.includes('Checkout unchanged.')")
    candidate = driver.invoke('refresh_repository_status', repoId=repo_id)['bisectCandidate']
    assert candidate['noCheckout'] and candidate['oid'] != bad
    driver.click_scrolled_text(banner + ' button', 'View candidate', wait_for_ready=True)
    driver.wait("return document.querySelector('.commit-row.selected')?.dataset.commitOid === " + json.dumps(candidate['oid']))
    driver.click_scrolled_text(banner + ' button', 'Good', wait_for_ready=True)
    driver.wait("return document.querySelector(" + json.dumps(banner + ' small') + ")?.title !== " + json.dumps(candidate['oid'])
                + " && document.querySelector('.activity-status')?.textContent.includes('Commit marked good')")
    after = checkout_footprint(fixtures, repository, files)
    assert all(after[key] == before[key] for key in before if key != 'references')
    driver.click_scrolled_text(banner + ' button', 'Reset', wait_for_ready=True)
    driver.wait("return !document.querySelector('.bisect-progress')")
    assert not (repository / '.git/BISECT_START').exists()
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-bisect-start-keeps-dirty-checkout-unchanged-through-vote-and-reset')


def bisect_vote_binds_the_test_candidate(driver, fixtures, report):
    repository = fixtures.repository('owned-bisect-vote-review', commits=12)
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    good = fixtures.git(repository, 'rev-parse', 'HEAD~11')
    fixtures.git(repository, 'bisect', 'start', '--no-checkout', head, good)
    repo_id = open_ui(driver, repository)
    first = driver.invoke('refresh_repository_status', repoId=repo_id)['bisectCandidate']
    assert first['noCheckout'] and first['oid'] != head
    assert first['oid'] == fixtures.git(repository, 'rev-parse', 'BISECT_HEAD')
    driver.wait(
        "return !!document.querySelector('.bisect-progress small')?.textContent.includes('Checkout unchanged')"
        " && document.querySelector('.bisect-progress small').title === " + json.dumps(first['oid'])
    )
    fixtures.git(repository, 'bisect', 'good', first['oid'])
    before = checkout_footprint(fixtures, repository)
    log = repository / '.git/BISECT_LOG'
    state = log.read_bytes()
    try:
        driver.invoke('mark_bisect', repoId=repo_id, verdict='bad', candidate=first)
    except RuntimeError as error:
        detail = json.loads(str(error))
        assert detail['kind'] == 'staleBisectCandidate', detail
    else:
        raise AssertionError('Git Khronos classified an obsolete candidate')
    assert log.read_bytes() == state and checkout_footprint(fixtures, repository) == before
    current = driver.invoke('refresh_repository_status', repoId=repo_id)['bisectCandidate']
    assert current['noCheckout'] and current['oid'] != first['oid']
    driver.invoke('mark_bisect', repoId=repo_id, verdict='good', candidate=current)
    assert fixtures.git(repository, 'rev-parse', 'refs/bisect/good-' + current['oid']) == current['oid']
    after = checkout_footprint(fixtures, repository)
    assert all(after[key] == before[key] for key in ('head', 'branch', 'status', 'indexSha256', 'files'))
    driver.invoke('reset_bisect', repoId=repo_id)
    assert not (repository / '.git/BISECT_START').exists()
    report['scenarios'].append('native-bisect-vote-rejects-an-obsolete-no-checkout-candidate')


def bisect_can_vote_using_native_terms(driver, fixtures, report):
    repository = fixtures.repository('owned-bisect-terms', commits=7)
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    good = fixtures.git(repository, 'rev-parse', 'HEAD~6')
    fixtures.git(repository, 'bisect', 'start', '--no-checkout', '--term-old=fast', '--term-new=slow', head, good)
    repo_id = open_ui(driver, repository)
    status = driver.invoke('refresh_repository_status', repoId=repo_id)
    candidate = status['bisectCandidate']
    assert candidate['terms'] == {'old': 'fast', 'new': 'slow'} and candidate['noCheckout'], candidate
    banner = '[aria-label="Git bisect in progress"]'
    driver.wait("return document.querySelector(" + json.dumps(banner + ' .bad') + ")?.textContent.trim() === 'slow'")
    driver.click_scrolled_text(banner + ' button', 'fast', wait_for_ready=True)
    driver.wait("return document.querySelector('.activity-status')?.textContent.includes('Commit marked fast')")
    assert fixtures.git(repository, 'rev-parse', 'refs/bisect/fast-' + candidate['oid']) == candidate['oid']
    current = driver.invoke('refresh_repository_status', repoId=repo_id)['bisectCandidate']
    assert current['oid'] != candidate['oid'] and current['terms'] == candidate['terms']
    driver.click_scrolled_text(banner + ' button', 'slow', wait_for_ready=True)
    driver.wait("return document.querySelector('.activity-status')?.textContent.includes('Commit marked slow')")
    assert fixtures.git(repository, 'rev-parse', 'refs/bisect/slow') == current['oid']
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == head
    driver.invoke('reset_bisect', repoId=repo_id)
    report['scenarios'].append('native-bisect-votes-use-the-current-old-and-new-terms')


def bisect_reports_the_first_bad_commit(driver, fixtures, report):
    repository = fixtures.repository('owned-bisect-result', commits=2)
    bad = fixtures.git(repository, 'rev-parse', 'HEAD')
    good = fixtures.git(repository, 'rev-parse', 'HEAD~1')
    fixtures.git(repository, 'switch', '--detach', good)
    fixtures.git(repository, 'bisect', 'start', '--no-checkout', bad, good)
    repo_id = open_ui(driver, repository)
    status = driver.invoke('refresh_repository_status', repoId=repo_id)
    assert status['bisectResult'] == {'kind': 'found', 'oid': bad, 'term': 'bad'} and not status.get('bisectCandidate')
    selector = '[aria-label="Git bisect result found"]'
    assert driver.wait("return document.querySelector(" + json.dumps(selector) + ")?.querySelector('small')?.title") == bad
    actions = driver.script("return [...document.querySelectorAll(" + json.dumps(selector + ' button') +
                            ")].map(button => button.textContent.trim())")
    assert actions == ['View result', 'Reset'], actions
    before = checkout_footprint(fixtures, repository)
    log = repository / '.git/BISECT_LOG'
    state = log.read_bytes()
    try:
        driver.invoke('mark_bisect', repoId=repo_id, verdict='good', candidate={'oid': bad, 'noCheckout': True})
    except RuntimeError as error:
        assert json.loads(str(error))['kind'] == 'bisectResultAlreadyFound'
    else:
        raise AssertionError('The native command accepted another vote after declaring the result')
    assert checkout_footprint(fixtures, repository) == before and log.read_bytes() == state
    driver.click_scrolled_text(selector + ' button', 'Reset', wait_for_ready=True)
    driver.wait("return !document.querySelector('.bisect-progress')")
    assert not (repository / '.git/BISECT_START').exists()
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == good
    report['scenarios'].append('native-bisect-result-reports-first-bad-and-prevents-extra-votes')


def bisect_reports_inconclusive_candidates(driver, fixtures, report):
    repository = fixtures.repository('owned-bisect-inconclusive', commits=5)
    bad = fixtures.git(repository, 'rev-parse', 'HEAD')
    good = fixtures.git(repository, 'rev-parse', 'HEAD~4')
    expected = set(fixtures.git(repository, 'rev-list', f'{good}..{bad}').splitlines())
    before = checkout_footprint(fixtures, repository)
    fixtures.git(repository, 'bisect', 'start', '--no-checkout', bad, good)
    repo_id = open_ui(driver, repository)
    for _ in range(3):
        candidate = driver.invoke('refresh_repository_status', repoId=repo_id)['bisectCandidate']
        assert candidate['noCheckout']
        driver.invoke('mark_bisect', repoId=repo_id, verdict='skip', candidate=candidate)
        assert fixtures.git(repository, 'rev-parse', 'refs/bisect/skip-' + candidate['oid']) == candidate['oid']
    status = driver.invoke('refresh_repository_status', repoId=repo_id)
    result = status['bisectResult']
    assert result['kind'] == 'ambiguous' and result['term'] == 'bad', status
    assert set(result['possibleOids']) == expected and not status.get('bisectCandidate')
    selector = '[aria-label="Git bisect result inconclusive"]'
    driver.wait("return !!document.querySelector(" + json.dumps(selector) + ")")
    options = driver.script("return [...document.querySelectorAll(" + json.dumps(selector + ' option') +
                            ")].map(option => option.value)")
    assert options == result['possibleOids']
    actions = driver.script("return [...document.querySelectorAll(" + json.dumps(selector + ' button') +
                            ")].map(button => button.textContent.trim())")
    assert actions == ['View commit', 'Reset'], actions
    selected = next(oid for oid in options if oid != bad)
    driver.script("document.querySelector(arguments[0]).value = arguments[1]", selector + ' select', selected)
    driver.click_scrolled_text(selector + ' button', 'View commit', wait_for_ready=True)
    driver.wait("return document.querySelector('.commit-row.selected')?.dataset.commitOid === " + json.dumps(selected))
    log = repository / '.git/BISECT_LOG'
    state = log.read_bytes()
    stopped = checkout_footprint(fixtures, repository)
    assert all(stopped[key] == before[key] for key in before if key != 'references')
    try:
        driver.invoke('mark_bisect', repoId=repo_id, verdict='good', candidate=candidate)
    except RuntimeError as error:
        assert json.loads(str(error))['kind'] == 'bisectResultAmbiguous'
    else:
        raise AssertionError('The native command accepted a vote for an inconclusive search')
    assert checkout_footprint(fixtures, repository) == stopped and log.read_bytes() == state
    driver.click_scrolled_text(selector + ' button', 'Reset', wait_for_ready=True)
    driver.wait("return !document.querySelector('.bisect-progress')")
    assert not (repository / '.git/BISECT_START').exists()
    assert checkout_footprint(fixtures, repository) == before
    report['scenarios'].append('native-bisect-inconclusive-keeps-possible-results-and-refuses-extra-votes')


def replay_recovery_preserves_ignored_files(driver, fixtures, report):
    for operation, action in [('revert', 'skip'), ('cherry-pick', 'abort')]:
        multi = operation == 'cherry-pick'
        repository = fixtures.repository(f'owned-{operation}-{action}', commits=2)
        conflict = repository / 'fixture.txt'
        local = repository / 'original.local' if multi else conflict
        tracked_text = 'Pre-sequence file.\n' if multi else 'Receiver text.\n'
        if multi:
            local.write_text(tracked_text)
            fixtures.git(repository, 'add', '--', local.name)
            fixtures.git(repository, 'commit', '-qm', 'Track the pre-sequence file')
        fixtures.git(repository, 'switch', '-qc', 'source')
        commits = []
        if multi:
            fixtures.git(repository, 'rm', '--', local.name)
            fixtures.git(repository, 'commit', '-qm', 'Remove the original file')
            commits.append(fixtures.git(repository, 'rev-parse', 'HEAD'))
        conflict.write_text('Source text.\n')
        fixtures.git(repository, 'commit', '-qam', 'Create a conflicting replay')
        commits.append(fixtures.git(repository, 'rev-parse', 'HEAD'))
        fixtures.git(repository, 'switch', 'main')
        conflict.write_text('Receiver text.\n')
        fixtures.git(repository, 'commit', '-qam', 'Prepare the receiving branch')
        original = fixtures.git(repository, 'rev-parse', 'HEAD')
        stopped = subprocess.run(
            ['git', '-C', str(repository), operation, '--no-edit', *commits],
            env=fixtures.env, capture_output=True, timeout=20,
        )
        assert stopped.returncode != 0 and fixtures.git(repository, 'ls-files', '-u'), stopped.stderr
        if multi:
            assert (repository / '.git/sequencer/head').read_text().strip() == original
            assert not local.exists()
        else:
            fixtures.git(repository, 'rm', '-f', '--', local.name)
        saved = repository / 'saved-local'
        (repository / '.git/info/exclude').write_text(f'/{local.name}\n/{saved.name}\n')
        local.write_text('Only ignored copy.\n')
        open_ui(driver, repository)
        progress = '.history-operation-progress'
        driver.wait(f'return !!document.querySelector({json.dumps(progress)})')
        files = (conflict.name, local.name) if multi else (local.name,)
        before = checkout_footprint(fixtures, repository, files)
        driver.click_scrolled_text(progress + ' button', action.title(), wait_for_ready=True)
        expected = ('Abort Replay' if multi else 'Skip Replay Step') + ' could overwrite ignored local contents'
        driver.wait('return document.querySelector(\'.error-toast\')?.textContent.includes(' + json.dumps(expected) + ')')
        assert checkout_footprint(fixtures, repository, files) == before
        local.rename(saved)
        driver.click_scrolled_text(progress + ' button', action.title(), wait_for_ready=True)
        driver.wait(f'return !document.querySelector({json.dumps(progress)})')
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == original
        assert local.read_text() == tracked_text
        assert saved.read_text() == 'Only ignored copy.\n'
        report['scenarios'].append(f'native-{operation}-{action}-preserves-ignored-reset-file')


def reviewed_detached_checkout(driver, fixtures, report):
    guarded_checkout_targets(driver, fixtures, report)
    context_rebase_preserves_sibling(driver, fixtures, report)
    abort_apply_rebase_preserves_ignored_settings(driver, fixtures, report)
    recovery_reset_preserves_ignored_files(driver, fixtures, report)
    mail_recovery_preserves_ignored_files(driver, fixtures, report)
    bisect_reset_preserves_ignored_files(driver, fixtures, report)
    bisect_start_rejects_a_stale_checkout(driver, fixtures, report)
    bisect_can_start_without_switching_dirty_checkout(driver, fixtures, report)
    bisect_vote_binds_the_test_candidate(driver, fixtures, report)
    bisect_can_vote_using_native_terms(driver, fixtures, report)
    bisect_reports_the_first_bad_commit(driver, fixtures, report)
    bisect_reports_inconclusive_candidates(driver, fixtures, report)
    replay_recovery_preserves_ignored_files(driver, fixtures, report)
    repository = fixtures.repository('detached-checkout-review', commits=3)
    target = fixtures.git(repository, 'rev-parse', 'HEAD^^')
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'branch', 'parallel')
    # Git's --short symbolic-ref is ambiguous when a tag shares the name.
    fixtures.git(repository, 'tag', 'main')
    fixtures.git(repository, 'tag', 'parallel')
    staged = repository / 'staged-note.txt'
    staged.write_text('Owned staged contents.\n')
    fixtures.git(repository, 'add', '--', staged.name)
    staged.write_text('Owned staged and working contents.\n')
    untracked = repository / 'untracked-note.txt'
    untracked.write_text('Owned untracked contents.\n')
    files = ('fixture.txt', staged.name, untracked.name)
    index_blob = fixtures.git(repository, 'rev-parse', ':' + staged.name)
    dialog = 'gc-history-review-dialog [role=alertdialog]'
    detached = '.statusbar button[aria-label^="View detached HEAD commit"]'

    def open_review(branch):
        row = f'.commit-row[data-commit-oid="{target}"]'
        branch_row = f'#reference-section-local [aria-label^="Local branch {branch}, current"]'
        # Startup paints history before the dirty checkout's WIP row can be
        # inserted above it. Resolve the right-click target after that shift.
        driver.wait(f"""
          const target = document.querySelector({json.dumps(row)});
          const wip = document.querySelector('.commit-row.wip-row:not(.linked-worktree)');
          return !!document.querySelector({json.dumps(branch_row)})
            && !!target?.getClientRects().length && !!wip?.getClientRects().length
            && target.getBoundingClientRect().top >= wip.getBoundingClientRect().bottom;
        """)
        driver.context_click(row)
        driver.click_scrolled_text('.context-menu button', 'Checkout this commit', wait_for_ready=True)
        state = driver.wait(f"""
          if (document.querySelector({json.dumps(dialog)})) return 'review';
          if (document.querySelector({json.dumps(detached)})) return 'detached';
          return null;
        """)
        assert state == 'review', 'Selecting the graph action detached HEAD without review'
        driver.wait(f'return document.activeElement?.matches({json.dumps(dialog + " [data-history-dialog-cancel]")})')
        return driver.script('return document.querySelector(arguments[0]).textContent', dialog)

    driver.wait('return !!document.querySelector("gc-root")')
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, files)
    review = open_review('main')
    assert str(repository) in review and target[:8] in review and 'detached HEAD' in review
    assert 'Current branch: main' in review and 'Current branch: heads/main' not in review, review
    assert checkout_footprint(fixtures, repository, files) == before
    driver.click_visible(dialog + ' [data-history-dialog-cancel]', 'Cancel')
    driver.wait(f'return !document.querySelector({json.dumps(dialog)})')
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-detached-checkout-review-cancel-preserves-branch-index-and-working-files')

    # Exercise the native boundary independently of how soon a watcher would
    # invalidate the renderer's old "main" review.
    fixtures.git(repository, 'switch', 'parallel')
    parallel = checkout_footprint(fixtures, repository, files)
    assert parallel['head'] == head and parallel['references'] == before['references']
    try:
        driver.invoke('checkout_commit', repoId=repo_id, oid=target, expectedHeadOid=head, expectedBranch='main')
    except RuntimeError as refusal:
        error = json.loads(str(refusal))
        assert error['kind'] == 'staleCheckout', error
    else:
        raise AssertionError('The native command accepted a review for another branch at the same tip')
    assert checkout_footprint(fixtures, repository, files) == parallel
    report['scenarios'].append('native-detached-checkout-refuses-a-stale-branch-at-the-same-tip')

    repo_id = open_ui(driver, repository)
    review = open_review('parallel')
    assert 'Current branch: parallel' in review and 'Current branch: heads/parallel' not in review, review
    driver.click_visible(dialog + ' .confirm-action', 'Check out detached HEAD')
    driver.wait(f'return !document.querySelector({json.dumps(dialog)}) && !!document.querySelector({json.dumps(detached)})')
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == target
    assert fixtures.git(repository, 'show-ref') == before['references']
    assert fixtures.git(repository, 'rev-parse', ':' + staged.name) == index_blob
    assert fixtures.git(repository, '--no-optional-locks', 'status', '--porcelain=v1') == parallel['status']
    assert staged.read_text() == 'Owned staged and working contents.\n'
    assert untracked.read_text() == 'Owned untracked contents.\n'
    assert (repository / 'fixture.txt').read_text().rstrip('\n') == fixtures.git(repository, 'show', target + ':fixture.txt')
    report['reviewedDetachedCheckout'] = {'before': before, 'afterExternalSwitch': parallel,
                                          'detachedHead': target, 'branchAndTagRefsPreserved': True,
                                          'stagedBlob': index_blob, 'dirtyFilesPreserved': True}
    report['scenarios'].append('native-confirmed-detached-checkout-keeps-refs-and-non-overlapping-local-edits')
    return repository, repo_id
