"""Exercise reviewed detached HEAD with packaged controls and independent Git oracles."""
import json

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


def reviewed_detached_checkout(driver, fixtures, report):
    guarded_checkout_targets(driver, fixtures, report)
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
