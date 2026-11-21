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


def workspace_pull_upstreams(driver, fixtures, report):
    publisher = fixtures.repository('pull-upstreams-publisher', commits=2)
    base = fixtures.git(publisher, 'rev-parse', 'HEAD')
    ambiguous = _local_clone(fixtures, publisher, 'pull-upstreams-ambiguous')
    ordinary = _local_clone(fixtures, publisher, 'pull-upstreams-ordinary')
    fixtures.git(ambiguous, 'config', '--add', 'branch.main.merge', 'refs/heads/extra')
    main = _write_commit(fixtures, publisher, 'main.txt', 'Selected incoming branch\n')
    fixtures.git(publisher, 'switch', '-qc', 'extra', base)
    extra = _write_commit(fixtures, publisher, 'extra.txt', 'Other incoming branch\n')
    fixtures.git(publisher, 'switch', '-q', 'main')
    first_before = checkout_footprint(fixtures, ambiguous)
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
    assert ordinary_head == main and (ordinary / 'main.txt').is_file()
    assert not (ambiguous / 'main.txt').exists() and not (ambiguous / 'extra.txt').exists()
    assert not (ordinary / 'extra.txt').exists()
    assert any(line.startswith(ambiguous.name + ' — error: More than one upstream branch is configured.')
               and 'review the destination in Pull options' in line for line in summary), summary
    assert any(line.startswith(ordinary.name + ' — success') for line in summary), summary
    report['scenarios'].append('native-workspace-pull-skips-multiple-upstreams-before-fetch-and-continues-the-batch')

    driver.click_visible('gc-workspace-center header button', 'Close')
    _toolbar_pull(driver)
    selected = checkout_footprint(fixtures, ambiguous, ('fixture.txt', 'main.txt'))
    assert selected['head'] == main and not (ambiguous / 'extra.txt').exists()
    assert selected['configSha256'] == first_before['configSha256']
    assert fixtures.git(publisher, 'show-ref') == upstream_refs
    report['workspacePullUpstreams']['explicitSelection'] = selected
    report['scenarios'].append('native-single-branch-toolbar-pull-keeps-multi-upstream-config-and-excludes-the-other-branch')
    return ambiguous, driver.invoke('open_repository', path=str(ambiguous))['id']
