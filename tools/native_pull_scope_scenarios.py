"""Exercise the exact native Pull scope using independent owned Git oracles."""
import json
import subprocess

from native_worktree_scenarios import checkout_footprint


def _write_commit(fixtures, repo, name, content):
    (repo / name).write_text(content)
    fixtures.git(repo, 'add', '--', name)
    fixtures.git(repo, 'commit', '-qm', f'Update {name}')
    return fixtures.git(repo, 'rev-parse', 'HEAD')


def _local_clone(fixtures, source, name):
    checkout = fixtures.root / name
    fixtures.git(fixtures.root, 'clone', '-q', '--no-local', str(source), str(checkout))
    return checkout


def _toolbar_pull(driver):
    driver.click_visible('button[aria-label="Pull from origin/main"]')
    driver.wait('return document.body.textContent.includes("Pull complete")')


def _toolbar_pull_refuses_local_fetch_mapping(driver, fixtures, publisher, report):
    from native_acceptance import open_ui

    checkout = _local_clone(fixtures, publisher, 'pull-local-refspec-receiver')
    head = fixtures.git(checkout, 'rev-parse', 'HEAD')
    fixtures.git(checkout, 'branch', 'unselected', head)
    mapping = '+refs/heads/main:refs/heads/unselected'
    fixtures.git(checkout, 'config', '--add', 'remote.origin.fetch', mapping)
    incoming = _write_commit(fixtures, publisher, 'refspec.txt', 'New owned upstream content\n')
    open_ui(driver, checkout)
    # The incoming file does not exist in the receiver until Pull succeeds.
    # Hash existing checkout contents, then check the new path's absence separately.
    files = ('fixture.txt',)
    before = checkout_footprint(fixtures, checkout, files)
    fetch_head = checkout / '.git/FETCH_HEAD'
    assert not fetch_head.exists()
    driver.click_visible('button[aria-label="Pull from origin/main"]')
    driver.wait('''return document.querySelector('.error-toast')
      ?.textContent.includes("could update a local branch before Pull integrates anything")''')
    assert checkout_footprint(fixtures, checkout, files) == before
    assert not fetch_head.exists() and not (checkout / 'refspec.txt').exists()
    assert fixtures.git(checkout, 'rev-parse', 'refs/heads/unselected') == head

    fixtures.git(checkout, 'config', '--fixed-value', '--unset-all', 'remote.origin.fetch', mapping)
    _toolbar_pull(driver)
    assert fixtures.git(checkout, 'rev-parse', 'HEAD') == incoming
    assert (checkout / 'refspec.txt').read_text() == 'New owned upstream content\n'
    assert fixtures.git(checkout, 'rev-parse', 'refs/heads/unselected') == head
    report['scenarios'].append('native-pull-refuses-local-branch-fetch-mapping-before-fetch')


def _toolbar_pull_rebase_preserves_sibling(driver, fixtures, report):
    from native_acceptance import open_ui

    publisher = fixtures.repository('pull-rebase-publisher', commits=2)
    checkout = _local_clone(fixtures, publisher, 'pull-rebase-receiver')
    sibling = _write_commit(fixtures, checkout, 'first-local.txt', 'Owned first local commit\n')
    fixtures.git(checkout, 'branch', 'owned-sibling', sibling)
    old_head = _write_commit(fixtures, checkout, 'second-local.txt', 'Owned second local commit\n')
    new_upstream = _write_commit(fixtures, publisher, 'upstream.txt', 'Owned upstream commit\n')
    fixtures.git(checkout, 'config', 'rebase.updateRefs', 'true')
    before_config = (checkout / '.git/config').read_bytes()
    open_ui(driver, checkout)
    driver.click_visible('button[aria-label="Pull options"]')
    selector = '#pull-options-menu [role=menuitem]'
    text = driver.wait(f"""
        const item = [...document.querySelectorAll({json.dumps(selector)})]
          .find(row => row.querySelector('strong')?.textContent.trim() === 'Rebase');
        return item?.getClientRects().length && item.textContent.trim();
    """)
    driver.click_scrolled_text(selector, text, wait_for_ready=True)
    driver.wait('return document.body.textContent.includes("Pull complete")')
    assert fixtures.git(checkout, 'rev-parse', 'HEAD') != old_head
    assert fixtures.git(checkout, 'rev-parse', 'HEAD^^') == new_upstream
    assert fixtures.git(checkout, 'rev-parse', 'refs/remotes/origin/main') == new_upstream
    assert fixtures.git(checkout, 'rev-parse', 'refs/heads/owned-sibling') == sibling, (
        'Pull with Rebase rewrote a branch outside the receiving checkout')
    assert (checkout / '.git/config').read_bytes() == before_config
    assert fixtures.git(checkout, 'symbolic-ref', 'HEAD') == 'refs/heads/main'
    assert fixtures.git(checkout, 'status', '--porcelain') == ''
    report['scenarios'].append('native-pull-with-rebase-preserves-unreviewed-sibling-branches')
    return checkout


def pull_submodule_scope(driver, fixtures, report):
    from native_acceptance import open_ui

    child = fixtures.repository('pull-scope-child', commits=2)
    publisher = fixtures.repository('pull-scope-parent', commits=2)
    fixtures.git(publisher, 'submodule', 'add', '--', str(child), 'lib')
    fixtures.git(publisher, 'commit', '-qm', 'Add owned submodule')
    checkout = _local_clone(fixtures, publisher, 'pull-scope-checkout')
    fixtures.git(checkout, 'submodule', 'update', '--init', '--', 'lib')
    fixtures.git(checkout, 'config', 'submodule.recurse', 'true')
    fixtures.git(checkout, 'config', 'fetch.recurseSubmodules', 'on-demand')
    nested = checkout / 'lib'
    fixtures.git(nested, 'config', 'protocol.file.allow', 'always')
    before = checkout_footprint(fixtures, nested)
    parent_config = (checkout / '.git/config').read_bytes()
    new_child = _write_commit(fixtures, child, 'fixture.txt', 'Incoming child bytes\n')
    fixtures.git(publisher / 'lib', 'pull', '--ff-only', 'origin', 'main')
    fixtures.git(publisher, 'add', '--', 'lib')
    fixtures.git(publisher, 'commit', '-qm', 'Record next submodule revision')
    parent_head = fixtures.git(publisher, 'rev-parse', 'HEAD')
    source_refs = [fixtures.git(repo, 'show-ref') for repo in (publisher, child)]

    def has_new_child():
        result = subprocess.run(
            ['git', '-C', str(nested), 'cat-file', '-e', new_child + '^{commit}'],
            env=fixtures.env, capture_output=True, timeout=10,
        )
        assert result.returncode in (0, 128), result.stderr
        return result.returncode == 0

    assert not has_new_child(), 'The fixture already has the new child object'
    repo_id = open_ui(driver, checkout)
    _toolbar_pull(driver)
    after = checkout_footprint(fixtures, nested)
    fetched_nested = has_new_child()
    actual_parent = fixtures.git(checkout, 'rev-parse', 'HEAD')
    recorded = fixtures.git(checkout, 'rev-parse', ':lib')
    report['pullSubmoduleScope'] = {
        'actualParent': actual_parent, 'expectedParent': parent_head,
        'recordedSubmodule': recorded, 'expectedGitlink': new_child,
        'nestedBefore': before, 'nestedAfter': after, 'fetchedNestedObject': fetched_nested,
    }
    assert actual_parent == parent_head == fixtures.git(checkout, 'rev-parse', 'refs/remotes/origin/main')
    assert recorded == new_child == fixtures.git(checkout, 'rev-parse', 'HEAD:lib')
    assert after == before and not fetched_nested, 'Parent Pull fetched into or changed the nested checkout'
    assert (checkout / '.git/config').read_bytes() == parent_config
    assert [fixtures.git(repo, 'show-ref') for repo in (publisher, child)] == source_refs
    report['scenarios'].append('native-pull-updates-the-parent-gitlink-without-fetching-or-changing-the-submodule')

    driver.click_visible('button[aria-label="Pull options"]')
    driver.wait('''
        const scope = document.querySelector('#pull-submodule-scope');
        return scope?.getClientRects().length > 0
            && scope.textContent.includes('Pull does not update submodule checkouts')
            && document.querySelector('#pull-options-menu')?.getAttribute('aria-describedby') === scope.id;
    ''')
    report['scenarios'].append('native-pull-options-describe-separate-submodule-checkout-scope')
    return checkout, repo_id


def _pull_fast_forward_preserves_ignored_file(driver, fixtures, report):
    publisher = fixtures.repository('pull-ignored-publisher', commits=2)
    checkout = _local_clone(fixtures, publisher, 'pull-ignored-receiver')
    base = fixtures.git(checkout, 'rev-parse', 'HEAD')
    branch = 'receiver=reviewed'
    fixtures.git(checkout, 'switch', '-qc', branch)
    fixtures.git(checkout, 'config', f'branch.{branch}.mergeOptions', '--overwrite-ignore --no-commit')
    name = 'settings.local'
    (checkout / '.git/info/exclude').write_text(f'/{name}\n')
    local = checkout / name
    local.write_text('Owned ignored settings.\n')
    expected = _write_commit(fixtures, publisher, name, 'Incoming tracked settings.\n')
    repo_id = driver.invoke('open_repository', path=str(checkout))['id']
    before = checkout_footprint(fixtures, checkout, ('fixture.txt', name))
    receiver = {'headOid': base, 'branch': branch}
    for strategy in ('merge', 'ff-only', 'rebase'):
        try:
            driver.invoke('pull_repository', repoId=repo_id, strategy=strategy, remote='origin',
                          branch='main', checkout=receiver, operationId=f'owned-ignored-{strategy}')
        except RuntimeError as refusal:
            assert json.loads(str(refusal))['kind'] == 'gitFailure', str(refusal)
        else:
            raise AssertionError(f'Pull {strategy} accepted an ignored-file collision on fast-forward')
        after = checkout_footprint(fixtures, checkout, ('fixture.txt', name))
        for key in ('head', 'branch', 'status', 'indexSha256', 'configSha256', 'files'):
            assert after[key] == before[key], (strategy, key, before[key], after[key])
        assert fixtures.git(checkout, 'rev-parse', 'refs/remotes/origin/main') == expected

    saved = checkout / 'retained-settings'
    local.rename(saved)
    snapshot = driver.invoke('pull_repository', repoId=repo_id, strategy='ff-only', remote='origin',
                             branch='main', checkout=receiver, operationId='owned-ignored-retried')
    assert snapshot['headOid'] == expected
    assert local.read_text() == 'Incoming tracked settings.\n'
    assert saved.read_text() == 'Owned ignored settings.\n'
    report['scenarios'].append('native-pull-fast-forward-refuses-to-overwrite-ignored-local-data')


def workspace_pull_upstreams(driver, fixtures, report):
    publisher = fixtures.repository('pull-upstreams-publisher', commits=2)
    base = fixtures.git(publisher, 'rev-parse', 'HEAD')
    ambiguous = _local_clone(fixtures, publisher, 'pull-upstreams-ambiguous')
    ordinary = _local_clone(fixtures, publisher, 'pull-upstreams-ordinary')
    for checkout in (ambiguous, ordinary):
        fixtures.git(checkout, 'tag', '-a', 'owned-local', '-m', 'Local-only Pull tag')
        fixtures.git(checkout, 'update-ref', 'refs/remotes/origin/removed', base)
        fixtures.git(checkout, 'config', 'fetch.prune', 'true')
        fixtures.git(checkout, 'config', 'remote.origin.pruneTags', 'true')
        fixtures.git(checkout, 'config', 'branch.main.mergeOptions', '--squash')
    def retained_refs(checkout):
        return fixtures.git(checkout, 'for-each-ref', '--format=%(refname) %(objectname)',
                            'refs/tags/owned-local', 'refs/remotes/origin/removed').splitlines()
    retained = {checkout: retained_refs(checkout) for checkout in (ambiguous, ordinary)}
    assert all(len(refs) == 2 for refs in retained.values())
    fixtures.git(ambiguous, 'config', '--add', 'branch.main.merge', 'refs/heads/extra')
    main = _write_commit(fixtures, publisher, 'main.txt', 'Selected incoming branch\n')
    fixtures.git(publisher, 'switch', '-qc', 'extra', base)
    extra = _write_commit(fixtures, publisher, 'extra.txt', 'Other incoming branch\n')
    fixtures.git(publisher, 'switch', '-q', 'main')
    first_before = checkout_footprint(fixtures, ambiguous)
    ordinary_config = (ordinary / '.git/config').read_bytes()
    upstream_refs = fixtures.git(publisher, 'show-ref')
    fetch_head = ambiguous / '.git/FETCH_HEAD'
    assert not fetch_head.exists()

    driver.wait('return !!document.querySelector("gc-root")', 60)
    driver.script("""
        localStorage.clear();
        localStorage.setItem('git-khronos.open-repositories.v1', JSON.stringify(arguments[0]));
        localStorage.setItem('git-khronos.active-repository.v1', arguments[0][0]);
        localStorage.setItem('git-khronos.remote.auto-fetch-minutes', '0');
        localStorage.setItem('git-khronos.pull.strategy', 'merge');
    """, [str(ambiguous), str(ordinary)])
    driver.reload()
    driver.wait('return document.querySelectorAll(".repo-tab-main[role=tab]").length === 2', 60)
    driver.click_visible('.workspace-toggle')
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    overview = 'gc-workspace-center [aria-label="Workspace center"]'
    results = overview + ' [aria-label="Repository action results"]'
    for checkout in (ambiguous, ordinary):
        driver.click_visible(overview + ' article[aria-label=' + json.dumps(checkout.name) + '] input[type=checkbox]')
    driver.click_scrolled_text(overview + ' button', 'Pull selected (2)', wait_for_ready=True)
    summary = driver.wait(f'''
        const rows = [...(document.querySelector({json.dumps(results)})?.querySelectorAll('li') ?? [])];
        const text = rows.map(row => row.textContent.trim());
        return text.length === 2 && text.every(line => / — (?:success|error|cancelled)/.test(line)) ? text : null;
    ''')
    after = checkout_footprint(fixtures, ambiguous)
    has_fetch = fetch_head.exists()
    ordinary_head = fixtures.git(ordinary, 'rev-parse', 'HEAD')
    report['workspacePullUpstreams'] = {
        'batch': summary, 'ambiguousBefore': first_before, 'ambiguousAfter': after,
        'extraUpstream': extra, 'ordinaryHead': ordinary_head, 'expectedMain': main,
        'ambiguousFetchHeadExists': has_fetch,
    }
    assert after == first_before and not has_fetch, 'Ambiguous batch Pull fetched or integrated before refusing'
    assert ordinary_head == main and (ordinary / 'main.txt').is_file(), (
        'Configured-upstream Pull reported success without advancing the selected branch')
    assert fixtures.git(ordinary, 'status', '--porcelain') == ''
    assert (ordinary / '.git/config').read_bytes() == ordinary_config
    assert retained_refs(ordinary) == retained[ordinary], 'Configured-upstream Pull pruned local refs'
    assert not (ambiguous / 'main.txt').exists() and not (ambiguous / 'extra.txt').exists()
    assert not (ordinary / 'extra.txt').exists()
    assert any(line.startswith(ambiguous.name + ' — error: More than one upstream branch is configured.')
               and 'review the destination in Pull options' in line for line in summary), summary
    assert any(line.startswith(ordinary.name + ' — success') for line in summary), summary
    report['scenarios'].append('native-workspace-pull-skips-multiple-upstreams-before-fetch-and-continues-the-batch')

    driver.click_visible('gc-workspace-center header button', 'Close')
    _toolbar_pull(driver)
    selected = checkout_footprint(fixtures, ambiguous, ('fixture.txt', 'main.txt'))
    assert selected['head'] == main and not (ambiguous / 'extra.txt').exists(), (
        'Explicit Pull reported success without advancing only the selected branch')
    assert fixtures.git(ambiguous, 'status', '--porcelain') == ''
    assert selected['configSha256'] == first_before['configSha256']
    assert fixtures.git(publisher, 'show-ref') == upstream_refs
    assert retained_refs(ambiguous) == retained[ambiguous], 'Explicit Pull pruned local refs'
    report['workspacePullUpstreams']['retainedLocalRefs'] = {
        'configuredUpstream': retained_refs(ordinary), 'explicit': retained_refs(ambiguous),
    }
    report['workspacePullUpstreams']['explicitSelection'] = selected
    report['scenarios'].append('native-single-branch-toolbar-pull-keeps-multi-upstream-config-and-excludes-the-other-branch')
    report['scenarios'].append('native-pull-retains-local-tag-and-stale-tracking-ref-even-with-git-pruning-config')
    report['scenarios'].append('native-pull-honors-selected-strategy-over-implicit-squash')
    _toolbar_pull_refuses_local_fetch_mapping(driver, fixtures, publisher, report)
    _pull_fast_forward_preserves_ignored_file(driver, fixtures, report)
    rebase = _toolbar_pull_rebase_preserves_sibling(driver, fixtures, report)
    return rebase, driver.invoke('open_repository', path=str(rebase))['id']
