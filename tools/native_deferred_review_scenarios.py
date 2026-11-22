"""Fetch/depth and worktree move/repair through UI; owned Git fixtures only."""
import json

from native_worktree_scenarios import checkout_footprint


def deferred_review_workflows(driver, fixtures, report):
    from native_acceptance import open_ui

    fetch_modal = 'gc-fetch-options-dialog [role=dialog]'
    evidence = []

    def fetch_ready():
        driver.wait('return document.querySelector(\'button[aria-label="Fetch all remotes"]\')?.disabled === false')

    def open_fetch(repository):
        fetch_ready()
        visible = driver.script('''const field = document.querySelector('[aria-label="Fetch options"]');
          return !!field?.getClientRects().length && getComputedStyle(field).visibility === 'visible';''')
        driver.click_visible('[aria-label="Fetch options"]' if visible else '[aria-label="More repository actions"]')
        driver.click_scrolled_text('[role=menu] button[role=menuitem]',
                                  'Fetch branches with options…Choose remotes, pruning, and history depth', wait_for_ready=True)
        driver.wait('return !!document.querySelector(' + json.dumps(fetch_modal) + ')')
        assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', fetch_modal)

    def choose(selector):
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ')')
        driver.script('document.querySelector(arguments[0]).scrollIntoView({ block: "center", inline: "nearest" })', selector)
        driver.click_visible(selector)

    def confirm_fetch(label):
        driver.click_scrolled_text(fetch_modal + ' button[type=submit]', label, wait_for_ready=True)
        driver.wait('return !document.querySelector(' + json.dumps(fetch_modal) + ')')

    def preserved(before, after):
        for key in ('head', 'branch', 'status', 'indexSha256', 'configSha256', 'files'):
            assert after[key] == before[key], 'Explicit fetch changed unrelated checkout data: ' + key

    source = fixtures.repository('deferred-fetch-review', commits=3)
    remote = fixtures.root / 'deferred-fetch-remote.git'
    fixtures.git(fixtures.root, 'clone', '--bare', str(source), str(remote))
    fixtures.git(source, 'remote', 'add', 'origin', str(remote))
    fixtures.git(source, 'tag', 'owned-local-sentinel')
    base = fixtures.git(source, 'rev-parse', 'HEAD')
    tree = fixtures.git(source, 'rev-parse', 'HEAD^{tree}')
    remote_head = fixtures.git(remote, 'commit-tree', tree, '-p', base, '-m', 'Owned fetch-only remote commit')
    (source / 'fixture.txt').write_text('Owned staged fetch-review contents.\n')
    fixtures.git(source, 'add', 'fixture.txt')
    (source / 'untracked-note.txt').write_text('Owned untracked fetch-review contents.\n')
    open_ui(driver, source)
    fetch_ready()
    # Publish the new owned remote state only after startup/background readiness.
    fixtures.git(remote, 'update-ref', 'refs/heads/main', remote_head)
    fixtures.git(remote, 'tag', 'owned-remote-sentinel', base)
    fixtures.git(source, 'update-ref', 'refs/remotes/origin/obsolete', base)
    before = checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt'))
    local_refs = fixtures.git(source, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags')
    old_tracking = fixtures.git(source, 'for-each-ref', '--format=%(objectname)', 'refs/remotes/origin/main')
    assert old_tracking != remote_head
    branch = 'release/only'
    fixtures.git(remote, 'update-ref', 'refs/heads/' + branch, remote_head)
    remote_refs = fixtures.git(remote, 'show-ref')
    open_fetch(source)
    driver.script('''const scope = document.querySelector('#fetch-branch-scope');
      scope.value = 'one'; scope.dispatchEvent(new Event('change', { bubbles: true }));''')
    driver.wait("return !!document.querySelector('#fetch-branch-name')")
    driver.script('''const name = document.querySelector('#fetch-branch-name');
      name.value = arguments[0]; name.dispatchEvent(new Event('input', { bubbles: true }));''', branch)
    confirm_fetch('Fetch this branch')
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/' + branch) == remote_head
    assert fixtures.git(source, 'for-each-ref', '--format=%(objectname)', 'refs/remotes/origin/main') == old_tracking
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/obsolete') == base
    assert fixtures.git(source, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags') == local_refs
    assert fixtures.git(remote, 'show-ref') == remote_refs
    preserved(before, checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt')))
    report['scenarios'].append('native-reviewed-fetch-creates-only-the-explicit-remote-tracking-branch')

    open_fetch(source)
    confirm_fetch('Fetch branches')
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/main') == remote_head
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/obsolete') == base
    after_fetch = checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt'))
    preserved(before, after_fetch)
    assert fixtures.git(source, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags') == local_refs
    assert fixtures.git(remote, 'show-ref') == remote_refs
    report['scenarios'].append('native-reviewed-fetch-downloads-owned-branch-without-tags-or-local-checkout-changes')

    open_fetch(source)
    choose(fetch_modal + ' input[name=pruneRemoteBranches]')
    confirm_fetch('Fetch branches')
    assert 'refs/remotes/origin/obsolete' not in fixtures.git(source, 'for-each-ref', '--format=%(refname)').splitlines()
    after_prune = checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt'))
    preserved(before, after_prune)
    assert fixtures.git(source, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags') == local_refs
    assert fixtures.git(remote, 'show-ref') == remote_refs
    report['scenarios'].append('native-reviewed-prune-removes-only-stale-tracking-ref-and-preserves-local-tags')
    evidence.append({'source': str(source), 'localBareRemote': str(remote), 'before': before,
                     'afterFetch': after_fetch, 'afterPrune': after_prune, 'remoteHead': remote_head})

    # Ordinary Fetch and background sync must not inherit destructive pruning.
    # Keep the earlier explicit prune proof above on the same dirty checkout.
    fixtures.git(source, 'config', 'fetch.prune', 'true')
    fixtures.git(source, 'config', 'remote.origin.pruneTags', 'true')
    repo_id = open_ui(driver, source)
    fetch_ready()
    fixtures.git(source, 'update-ref', 'refs/remotes/origin/obsolete', base)
    before_ordinary = checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt'))
    quick_head = fixtures.git(remote, 'commit-tree', tree, '-p', remote_head, '-m', 'Owned ordinary Fetch')
    fixtures.git(remote, 'update-ref', 'refs/heads/main', quick_head)

    driver.click_visible('button[aria-label="Fetch all remotes"]')
    driver.wait("return document.querySelector('.activity-status')?.textContent.includes('Fetch complete')")
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/main') == quick_head
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/obsolete') == base
    assert fixtures.git(source, 'rev-parse', 'refs/tags/owned-local-sentinel') == base
    fetch_head = source / '.git/FETCH_HEAD'
    foreground_fetch_head = fetch_head.read_bytes()
    assert quick_head.encode() in foreground_fetch_head
    report['scenarios'].append('native-ordinary-fetch-keeps-stale-tracking-refs-and-local-tags')

    background_head = fixtures.git(remote, 'commit-tree', tree, '-p', quick_head, '-m', 'Owned background Fetch')
    fixtures.git(remote, 'update-ref', 'refs/heads/main', background_head)
    assert driver.invoke('sync_repository', repoId=repo_id) is not None
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/main') == background_head
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/obsolete') == base
    assert fixtures.git(source, 'rev-parse', 'refs/tags/owned-local-sentinel') == base
    assert fetch_head.read_bytes() == foreground_fetch_head
    after_background = checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt'))
    preserved(before_ordinary, after_background)
    report['scenarios'].append('native-background-fetch-preserves-foreground-fetch-head-and-stale-refs')
    evidence.append({'source': str(source), 'localBareRemote': str(remote), 'before': before_ordinary,
                     'afterBackground': after_background, 'ordinaryFetchHead': quick_head,
                     'backgroundTrackingHead': background_head, 'foregroundFetchHeadPreserved': True})

    # Fetching the same owned ref through a custom destination must not move
    # a branch merely because it is not currently checked out.
    fixtures.git(source, 'branch', 'unselected', base)
    mapping = '+refs/heads/main:refs/heads/unselected'
    fixtures.git(source, 'config', '--add', 'remote.origin.fetch', mapping)
    scoped_head = fixtures.git(remote, 'commit-tree', tree, '-p', background_head, '-m', 'Owned scoped Fetch')
    fixtures.git(remote, 'update-ref', 'refs/heads/main', scoped_head)
    before_unsafe = checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt'))
    for command, args in (
        ('fetch_repository', {'remote': 'origin', 'operationId': 'owned-fetch-unsafe-named'}),
        ('fetch_repository', {'remote': None, 'operationId': 'owned-fetch-unsafe-all'}),
        ('sync_repository', {}),
    ):
        try:
            driver.invoke(command, repoId=repo_id, **args)
        except RuntimeError as refusal:
            assert json.loads(str(refusal))['kind'] == 'fetchUpdatesLocalBranch', str(refusal)
        else:
            raise AssertionError(f'{command} accepted a fetch mapping into an unselected local branch')
        assert checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt')) == before_unsafe
        assert fetch_head.read_bytes() == foreground_fetch_head

    open_fetch(source)
    confirm_fetch('Fetch branches')
    assert fixtures.git(source, 'rev-parse', 'refs/remotes/origin/main') == scoped_head
    assert fixtures.git(source, 'rev-parse', 'refs/heads/unselected') == base
    preserved(before_unsafe, checkout_footprint(fixtures, source, ('fixture.txt', 'untracked-note.txt')))
    fixtures.git(source, 'config', '--fixed-value', '--unset-all', 'remote.origin.fetch', mapping)
    report['scenarios'].append('native-ordinary-and-background-fetch-refuse-local-branch-refspecs')
    remote_refs = fixtures.git(remote, 'show-ref')  # The shallow fixtures below use this updated source.

    shallow = fixtures.root / 'deferred-shallow-review'
    fixtures.git(fixtures.root, 'clone', '--depth=1', remote.resolve().as_uri(), str(shallow))
    (shallow / 'fixture.txt').write_text('Owned staged shallow-review contents.\n')
    fixtures.git(shallow, 'add', 'fixture.txt')
    (shallow / 'untracked-note.txt').write_text('Owned untracked shallow-review contents.\n')
    open_ui(driver, shallow)
    fetch_ready()
    assert fixtures.git(shallow, 'rev-parse', '--is-shallow-repository') == 'true'
    assert fixtures.git(shallow, 'rev-list', '--count', 'HEAD') == '1'
    shallow_before = checkout_footprint(fixtures, shallow, ('fixture.txt', 'untracked-note.txt'))
    shallow_refs = fixtures.git(shallow, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags')
    open_fetch(shallow)
    choose(fetch_modal + ' input[name=fetchHistory][value=deepen]')
    driver.wait('return document.querySelector(' + json.dumps(fetch_modal + ' input[name=deepenCommits]') + ')?.disabled === false')
    driver.script('''const field = document.querySelector('input[name=deepenCommits]');
      field.value = '1'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    confirm_fetch('Fetch and extend history')
    assert fixtures.git(shallow, 'rev-list', '--count', 'HEAD') == '2'
    assert fixtures.git(shallow, 'rev-parse', '--is-shallow-repository') == 'true'
    after_deepen = checkout_footprint(fixtures, shallow, ('fixture.txt', 'untracked-note.txt'))
    preserved(shallow_before, after_deepen)
    assert fixtures.git(shallow, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags') == shallow_refs
    assert fixtures.git(remote, 'show-ref') == remote_refs
    report['scenarios'].append('native-reviewed-deepen-downloads-exact-requested-history-without-changing-dirty-state')

    open_fetch(shallow)
    choose(fetch_modal + ' input[name=fetchHistory][value=complete]')
    confirm_fetch('Fetch and extend history')
    assert fixtures.git(shallow, 'rev-parse', '--is-shallow-repository') == 'false'
    assert fixtures.git(shallow, 'rev-list', 'HEAD') == fixtures.git(remote, 'rev-list', 'refs/heads/main')
    after_complete = checkout_footprint(fixtures, shallow, ('fixture.txt', 'untracked-note.txt'))
    preserved(shallow_before, after_complete)
    assert fixtures.git(shallow, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags') == shallow_refs
    assert fixtures.git(remote, 'show-ref') == remote_refs
    report['scenarios'].append('native-reviewed-complete-history-matches-owned-remote-and-preserves-local-files-and-tags')
    evidence.append({'source': str(shallow), 'before': shallow_before, 'afterDeepen': after_deepen,
                     'afterComplete': after_complete, 'completeCommitCount': fixtures.git(shallow, 'rev-list', '--count', 'HEAD')})
    report['deferredFetchReviews'] = {'networkRemoteUsed': False, 'cases': evidence}

    main = fixtures.repository('deferred-worktree-review', commits=2)
    linked = fixtures.root / 'deferred-linked-before'
    moved = fixtures.root / 'deferred-linked-moved'
    actual = fixtures.root / 'deferred-linked-actual'
    fixtures.git(main, 'worktree', 'add', '-b', 'owned-reviewed-topic', str(linked))
    (main / 'fixture.txt').write_text('Owned staged source checkout contents.\n')
    fixtures.git(main, 'add', 'fixture.txt')
    (main / 'source-note.txt').write_text('Owned untracked source checkout contents.\n')
    (linked / 'fixture.txt').write_text('Owned staged linked checkout contents.\n')
    fixtures.git(linked, 'add', 'fixture.txt')
    (linked / 'fixture.txt').write_text('Owned staged and unstaged linked checkout contents.\n')
    (linked / 'untracked-note.txt').write_text('Owned untracked linked checkout contents.\n')
    exclude = main / '.git/info/exclude'
    exclude.write_text(exclude.read_text() + '\nowned-ignored.txt\n')
    (linked / 'owned-ignored.txt').write_bytes(b'Owned ignored data must move with its checkout.\n')
    before_source = checkout_footprint(fixtures, main, ('fixture.txt', 'source-note.txt'))
    linked_files = ('fixture.txt', 'untracked-note.txt', 'owned-ignored.txt')
    before_linked = checkout_footprint(fixtures, linked, linked_files)
    open_ui(driver, main)
    worktree_modal = 'gc-worktree-move-dialog [role=dialog]'

    def open_worktree(action):
        driver.click_visible('[aria-label="Worktree actions for owned-reviewed-topic"]')
        driver.click_scrolled_text('.worktree-card-menu [role=menuitem]', action, wait_for_ready=True)
        driver.wait('return !!document.querySelector(' + json.dumps(worktree_modal) + ')')
        assert str(main) in driver.script('return document.querySelector(arguments[0]).textContent', worktree_modal)

    open_worktree('Move linked worktree…')
    driver.script('''const parent = document.querySelector('#move-parent');
      parent.value = arguments[0]; parent.dispatchEvent(new Event('input', { bubbles: true }));
      const folder = document.querySelector('#move-folder'); folder.value = arguments[1];
      folder.dispatchEvent(new Event('input', { bubbles: true }));''', str(fixtures.root), moved.name)
    driver.click_scrolled_text(worktree_modal + ' button[type=submit]', 'Move worktree', wait_for_ready=True)
    driver.wait('return !document.querySelector(' + json.dumps(worktree_modal) + ')')
    assert not linked.exists() and moved.is_dir()
    after_move = checkout_footprint(fixtures, moved, linked_files)
    assert after_move == before_linked
    assert checkout_footprint(fixtures, main, ('fixture.txt', 'source-note.txt')) == before_source
    report['scenarios'].append('native-reviewed-worktree-move-preserves-both-dirty-checkouts-index-and-ignored-data')

    # An intentional external rename creates the missing-registration repair case.
    moved.rename(actual)
    open_ui(driver, main)
    open_worktree('Repair after external move…')
    driver.script('''const field = document.querySelector('#repair-directory');
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', str(actual))
    driver.click_scrolled_text(worktree_modal + ' button[type=submit]', 'Repair registration', wait_for_ready=True)
    driver.wait('return !document.querySelector(' + json.dumps(worktree_modal) + ')')
    after_repair = checkout_footprint(fixtures, actual, linked_files)
    assert after_repair == before_linked
    assert checkout_footprint(fixtures, main, ('fixture.txt', 'source-note.txt')) == before_source
    registrations = fixtures.git(main, 'worktree', 'list', '--porcelain')
    assert 'worktree ' + str(actual) in registrations and 'worktree ' + str(moved) + '\n' not in registrations
    assert not linked.exists() and not moved.exists()
    report['scenarios'].append('native-reviewed-worktree-repair-updates-only-owned-registration-and-preserves-dirty-data')
    report['deferredWorktreeReviews'] = {'source': str(main), 'originalLinked': str(linked), 'moved': str(moved),
        'actualRepaired': str(actual), 'beforeSource': before_source, 'beforeLinked': before_linked,
        'afterMove': after_move, 'afterRepair': after_repair, 'networkRemoteUsed': False}
