"""Real publishing, pinned force-push and LFS cleanup using owned local fixtures."""
import hashlib
import json
import os
import time

from native_worktree_scenarios import checkout_footprint


def _preserved(before, after, config=True):
    keys = ['head', 'branch', 'status', 'indexSha256', 'files']
    if config:
        keys.append('configSha256')
    for key in keys:
        assert before[key] == after[key], 'Remote review changed unrelated checkout data: ' + key


def remote_review_workflows(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('remote-review-workflows', commits=2)
    remote = fixtures.root / 'owned-review-remote.git'
    remote.mkdir()
    fixtures.git(remote, 'init', '--bare')
    fixtures.git(repository, 'remote', 'add', 'origin', str(remote))
    assert fixtures.git(repository, 'remote', 'get-url', '--push', 'origin') == str(remote)
    (repository / 'fixture.txt').write_text('Staged remote-review contents must stay local.\n')
    fixtures.git(repository, 'add', 'fixture.txt')
    (repository / 'untracked-note.txt').write_text('Untracked remote-review contents.\n')
    marker = repository / '.git/remote-review-commit-attempted'
    hook = repository / '.git/hooks/pre-commit'
    hook.write_text('#!/bin/sh\nprintf attempted > "$(git rev-parse --git-path remote-review-commit-attempted)"\nexit 1\n')
    hook.chmod(0o700)
    files = ('fixture.txt', 'untracked-note.txt')
    snapshot = lambda: checkout_footprint(fixtures, repository, files)
    open_ui(driver, repository)
    original = snapshot()
    driver.click_visible('[aria-label="Publish main to origin"]')
    publish = 'gc-repository-confirmations [aria-label="Publish main"]'
    driver.wait('return !!document.querySelector(' + json.dumps(publish) + ')')
    assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', publish)
    driver.click_visible(publish + ' .confirm-action', 'Publish Branch')
    driver.wait("return document.querySelector('.activity-status')?.textContent.includes('Published main to origin')")
    assert fixtures.git(remote, 'rev-parse', 'refs/heads/main') == original['head']
    assert fixtures.git(repository, 'config', 'branch.main.remote') == 'origin'
    assert fixtures.git(repository, 'config', 'branch.main.merge') == 'refs/heads/main'
    published = snapshot()
    _preserved(original, published, config=False)  # Setting the upstream is intentional.
    assert not marker.exists()
    report['scenarios'].append('native-publish-review-writes-only-owned-local-remote-and-sets-upstream')

    # Change only HEAD's commit identity, keeping its tree and dirty index/files.
    tree = fixtures.git(repository, 'rev-parse', 'HEAD^{tree}')
    child = fixtures.git(repository, 'commit-tree', tree, '-p', original['head'], '-m', 'Owned reviewed local commit')
    fixtures.git(repository, 'update-ref', 'refs/heads/main', child)
    open_ui(driver, repository)
    before_force = snapshot()
    force = 'gc-repository-confirmations [aria-labelledby="force-push-title"]'

    def open_force(expected_remote, expected_local=child):
        driver.click_visible('[aria-label="Push options"]')
        driver.click_visible('.push-menu button:not(:disabled) strong', 'Force Push with Lease…')
        driver.wait('return !!document.querySelector(' + json.dumps(force) + ')')
        text = driver.script('return document.querySelector(arguments[0]).textContent', force)
        assert str(repository) in text and expected_remote[:12] in text and expected_local[:12] in text, text
        driver.wait('return !!document.querySelector(' + json.dumps(force + ' .force-push-destinations') + ')')

    open_force(original['head'])
    remote_tree = fixtures.git(remote, 'rev-parse', 'refs/heads/main^{tree}')
    remote_child = fixtures.git(remote, 'commit-tree', remote_tree, '-p', original['head'], '-m', 'Owned concurrent remote commit')
    fixtures.git(remote, 'update-ref', 'refs/heads/main', remote_child)
    driver.click_visible(force + ' .confirm-action', 'Force Push with Lease')
    driver.wait("return !!document.querySelector('.error-toast')?.getClientRects().length")
    assert fixtures.git(remote, 'rev-parse', 'refs/heads/main') == remote_child, 'A stale reviewed lease overwrote a newer remote commit'
    _preserved(before_force, snapshot())
    assert not marker.exists()
    report['scenarios'].append('native-force-review-pinned-lease-refuses-owned-remote-update-after-review')

    # A new explicit review after an owned fetch can intentionally replace it.
    fixtures.git(repository, 'fetch', 'origin')
    open_ui(driver, repository)
    open_force(remote_child)
    before_fresh = snapshot()
    driver.click_visible(force + ' .confirm-action', 'Force Push with Lease')
    driver.wait("return document.querySelector('.activity-status')?.textContent.includes('Force push with lease complete')")
    assert fixtures.git(remote, 'rev-parse', 'refs/heads/main') == child
    _preserved(before_fresh, snapshot())
    assert not marker.exists()
    report['scenarios'].append('native-fresh-force-review-pushes-reviewed-head-to-owned-local-remote')

    # An OID lease alone also matches a fork at the same base. Rebind only the
    # owned fixture's push URL after review and require refusal before any push.
    rebound = fixtures.root / 'owned-rebound-review-remote.git'
    fixtures.git(fixtures.root, 'clone', '--bare', str(remote), str(rebound))
    assert fixtures.git(rebound, 'rev-parse', 'refs/heads/main') == child
    rebound_head = fixtures.git(repository, 'commit-tree', tree, '-p', child, '-m', 'Owned rebound destination review')
    fixtures.git(repository, 'update-ref', 'refs/heads/main', rebound_head)
    open_ui(driver, repository)
    open_force(child, rebound_head)
    fixtures.git(repository, 'remote', 'set-url', '--push', 'origin', str(rebound))
    assert fixtures.git(repository, 'remote', 'get-url', '--push', 'origin') == str(rebound)
    before_rebound = snapshot()
    driver.click_visible(force + ' .confirm-action', 'Force Push with Lease')
    driver.wait("return document.querySelector('.error-toast')?.textContent.includes('push destinations changed')")
    assert fixtures.git(remote, 'rev-parse', 'refs/heads/main') == child
    assert fixtures.git(rebound, 'rev-parse', 'refs/heads/main') == child
    _preserved(before_rebound, snapshot())
    report['scenarios'].append('native-force-review-refuses-rebound-owned-push-url-before-either-remote-is-written')

    open_ui(driver, repository)
    open_force(child, rebound_head)
    assert str(rebound) in driver.script('return document.querySelector(arguments[0]).textContent', force)
    driver.click_visible(force + ' .confirm-action', 'Force Push with Lease')
    driver.wait("return document.querySelector('.activity-status')?.textContent.includes('Force push with lease complete')")
    assert fixtures.git(rebound, 'rev-parse', 'refs/heads/main') == rebound_head
    assert fixtures.git(remote, 'rev-parse', 'refs/heads/main') == child
    _preserved(before_rebound, snapshot())
    assert not marker.exists()
    report['scenarios'].append('native-fresh-force-review-writes-only-explicitly-reviewed-rebound-local-destination')
    fixtures.git(repository, 'config', '--unset', 'remote.origin.pushurl')

    # The actual toolbar only exposes LFS actions for initialized repositories.
    # Initialize this owned fixture before taking the preservation snapshot;
    # creating an object directory alone does not enable Git LFS.
    fixtures.git(repository, 'lfs', 'install', '--local')
    payload = b'Owned unreferenced LFS review cache contents.\n'
    oid = hashlib.sha256(payload).hexdigest()
    cache = repository / '.git/lfs/objects' / oid[:2] / oid[2:4] / oid
    cache.parent.mkdir(parents=True)
    cache.write_bytes(payload)
    old = time.time() - 7200
    os.utime(cache, (old, old))
    open_ui(driver, repository)
    before_lfs = snapshot()
    driver.click_visible('[aria-label="Git LFS options"]')
    driver.click_visible('.lfs-menu button:not(:disabled) strong', 'Clean LFS storage')
    lfs = 'gc-lfs-prune-dialog [aria-labelledby="prune-lfs-title"]'
    driver.wait('return !!document.querySelector(' + json.dumps(lfs + ' [title="sha256:' + oid + '"]') + ')')
    assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', lfs)
    driver.click_visible(lfs + ' .confirm-action', 'Remove 1 Object')
    driver.wait("return document.querySelector('.activity-status')?.textContent.includes('Reviewed unreferenced LFS objects removed')")
    assert not cache.exists()
    after_lfs = snapshot()
    _preserved(before_lfs, after_lfs)
    assert before_lfs['references'] == after_lfs['references']
    assert not marker.exists()
    report['scenarios'].append('native-lfs-review-removes-only-owned-unreferenced-cache-object')
    report['remoteReviewWorkflows'] = {
        'source': str(repository), 'localBareRemote': str(remote), 'networkRemoteUsed': False,
        'original': original, 'published': published, 'reviewedHead': child,
        'rejectedRemoteHead': remote_child, 'finalRemoteHead': fixtures.git(remote, 'rev-parse', 'refs/heads/main'),
        'reboundLocalBareRemote': str(rebound), 'finalReboundHead': fixtures.git(rebound, 'rev-parse', 'refs/heads/main'),
        'beforeLfs': before_lfs, 'afterLfs': after_lfs, 'removedLfsOid': oid, 'commitAttempted': marker.exists(),
    }

    from native_reference_review_scenarios import reference_review_workflows
    reference_review_workflows(driver, fixtures, report)
