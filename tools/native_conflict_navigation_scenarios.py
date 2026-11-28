"""Installed conflict navigation and reviewed conflict resolution."""
import json
import subprocess

from native_worktree_scenarios import checkout_footprint


def conflict_navigation(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-conflict-navigation', commits=3)
    for path in ('output.txt', 'current.txt', 'deleted.txt'):
        (repository / path).write_text(f'base {path}\n')
    rename_base = 'root\nalpha\nbeta\ngamma\ndelta\nepsilon\n'
    (repository / 'rename-source.txt').write_text(rename_base)
    (repository / 'binary.dat').write_bytes(b'\0base binary\n')
    fixtures.git(repository, 'add', 'output.txt', 'current.txt', 'deleted.txt', 'binary.dat', 'rename-source.txt')
    fixtures.git(repository, 'commit', '-qm', 'Add conflict-resolution fixtures')
    submodule_source = fixtures.repository('owned-conflict-submodule-source', commits=1)
    submodule_base = fixtures.git(submodule_source, 'rev-parse', 'HEAD')
    fixtures.git(submodule_source, 'checkout', '-qb', 'submodule-side', submodule_base)
    (submodule_source / 'fixture.txt').write_text('side submodule commit\n')
    fixtures.git(submodule_source, 'add', 'fixture.txt')
    fixtures.git(submodule_source, 'commit', '-qm', 'Side submodule commit')
    submodule_side = fixtures.git(submodule_source, 'rev-parse', 'HEAD')
    fixtures.git(submodule_source, 'checkout', '-q', 'main')
    (submodule_source / 'fixture.txt').write_text('main submodule commit\n')
    fixtures.git(submodule_source, 'add', 'fixture.txt')
    fixtures.git(submodule_source, 'commit', '-qm', 'Main submodule commit')
    submodule_main = fixtures.git(submodule_source, 'rev-parse', 'HEAD')
    fixtures.git(repository, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q',
                  str(submodule_source), 'vendor/module')
    submodule_path = repository / 'vendor/module'
    fixtures.git(submodule_path, 'checkout', submodule_base)
    fixtures.git(repository, 'add', 'vendor/module')
    fixtures.git(repository, 'commit', '-qm', 'Add submodule conflict fixture')
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    for branch, contents in (('owned-side', 'side edit'), ('main', 'main edit')):
        if branch == 'owned-side':
            fixtures.git(repository, 'checkout', '-qb', branch, head)
        else:
            fixtures.git(repository, 'checkout', '-q', branch)
        for path in ('fixture.txt', 'output.txt', 'current.txt'):
            (repository / path).write_text(f'{contents} {path}\n')
        if branch == 'owned-side':
            fixtures.git(repository, 'mv', 'rename-source.txt', 'renamed-side.txt')
            (repository / 'renamed-side.txt').write_text('root\nSIDE\nbeta\ngamma\ndelta\nepsilon\n')
        else:
            (repository / 'rename-source.txt').write_text('root\nMAIN\nbeta\ngamma\ndelta\nepsilon\n')
        if branch == 'owned-side':
            (repository / 'deleted.txt').unlink()
            fixtures.git(submodule_path, 'checkout', submodule_side)
        else:
            (repository / 'deleted.txt').write_text('main modified deleted.txt\n')
            fixtures.git(submodule_path, 'checkout', submodule_base)
            fixtures.git(submodule_path, 'checkout', submodule_main)
        (repository / 'binary.dat').write_bytes(b'\0' + contents.encode() + b' binary\n')
        fixtures.git(repository, 'add', '-A')
        fixtures.git(repository, 'commit', '-qm', contents)
    merge = subprocess.run(['git', '-C', str(repository), 'merge', '--no-commit', 'owned-side'],
                           capture_output=True, env=fixtures.env, timeout=15)
    assert merge.returncode == 1, (merge.stdout, merge.stderr)
    assert set(fixtures.git(repository, 'diff', '--name-only', '--diff-filter=U').splitlines()) == {
        'binary.dat', 'current.txt', 'deleted.txt', 'fixture.txt', 'output.txt',
        'renamed-side.txt', 'vendor/module'}
    before = checkout_footprint(fixtures, repository)
    merge_head = (repository / '.git/MERGE_HEAD').read_bytes()
    repo_id = open_ui(driver, repository)
    row = f'[data-commit-oid="{before["head"]}"] .commit-main'
    driver.wait(f'return !!document.querySelector({json.dumps(row)})')
    driver.click_visible(row)
    driver.wait("return document.querySelector('#repository-commit-panel')?.getAttribute('aria-label') === 'Commit inspector'")
    driver.click_scrolled_text('.conflict-navigation button', 'Show conflicted files', wait_for_ready=True)
    driver.wait("""return document.activeElement?.textContent.trim() === 'Conflicted Files (7)'
        && document.activeElement?.getAttribute('aria-expanded') === 'true'
        && !!document.querySelector('[title="Open Merge Tool for fixture.txt"]')
        && !!document.querySelector('[title="Open Merge Tool for output.txt"]')
        && !!document.querySelector('[title="Open Merge Tool for current.txt"]')
        && !!document.querySelector('[title="Open Merge Tool for deleted.txt"]')
        && !!document.querySelector('[title="Open Merge Tool for binary.dat"]')
        && !!document.querySelector('[title="Open Merge Tool for renamed-side.txt"]')
        && !!document.querySelector('[title="Open Merge Tool for vendor/module"]')""")
    assert checkout_footprint(fixtures, repository) == before
    assert (repository / '.git/MERGE_HEAD').read_bytes() == merge_head
    report['scenarios'].append('native-show-conflicted-files-opens-and-focuses-the-list-without-changing-merge-state')

    # Exercise the packaged resolution UI, not only the native command. Choosing
    # Incoming must stage exactly that side and preserve the in-progress merge.
    driver.click_scrolled_text('[title="Open Merge Tool for fixture.txt"]', 'fixture.txt', wait_for_ready=True)
    driver.wait("return document.querySelector('[aria-label=\"Merge conflict editor\"]')?.textContent.includes('side edit')")
    driver.click_scrolled_text('gk-conflict-editor footer button', 'Take Incoming', wait_for_ready=True)
    driver.wait("return !document.querySelector('[aria-label=\"Merge conflict editor\"]')")
    assert (repository / 'fixture.txt').read_text() == 'side edit fixture.txt\n'
    assert set(fixtures.git(repository, 'diff', '--name-only', '--diff-filter=U').splitlines()) == {
        'binary.dat', 'current.txt', 'deleted.txt', 'output.txt', 'renamed-side.txt', 'vendor/module'}
    assert fixtures.git(repository, 'show', ':fixture.txt') == 'side edit fixture.txt'
    report['scenarios'].append('native-merge-tool-takes-incoming-and-stages-exact-resolution')

    driver.click_scrolled_text('[title="Open Merge Tool for renamed-side.txt"]', 'renamed-side.txt', wait_for_ready=True)
    driver.wait("return document.querySelector('[aria-label=\"Merge conflict editor\"]')?.textContent.includes('SIDE')")
    driver.click_scrolled_text('gk-conflict-editor footer button', 'Take Incoming', wait_for_ready=True)
    driver.wait("return !document.querySelector('[aria-label=\"Merge conflict editor\"]')")
    assert not (repository / 'rename-source.txt').exists()
    expected_renamed = 'root\nSIDE\nbeta\ngamma\ndelta\nepsilon\n'
    assert (repository / 'renamed-side.txt').read_text() == expected_renamed
    assert fixtures.git(repository, 'show', ':renamed-side.txt') == expected_renamed.rstrip()
    report['scenarios'].append('native-merge-tool-resolves-rename-modify-conflict-at-destination-path')

    driver.click_scrolled_text('[title="Open Merge Tool for current.txt"]', 'current.txt', wait_for_ready=True)
    driver.wait("return document.querySelector('[aria-label=\"Merge conflict editor\"]')?.textContent.includes('main edit current.txt')")
    driver.click_scrolled_text('gk-conflict-editor footer button', 'Take Current', wait_for_ready=True)
    driver.wait("return !document.querySelector('[aria-label=\"Merge conflict editor\"]')")
    assert (repository / 'current.txt').read_text() == 'main edit current.txt\n'
    assert fixtures.git(repository, 'show', ':current.txt') == 'main edit current.txt'
    report['scenarios'].append('native-merge-tool-takes-current-and-stages-exact-resolution')

    driver.click_scrolled_text('[title="Open Merge Tool for output.txt"]', 'output.txt', wait_for_ready=True)
    driver.wait("return document.querySelector('gk-conflict-editor textarea[aria-label=\"Resolved output for output.txt\"]')?.value.includes('side edit output.txt')")
    driver.script("const textarea=document.querySelector('gk-conflict-editor textarea[aria-label=\"Resolved output for output.txt\"]'); if(!textarea || textarea.readOnly) throw Error('Conflict output is not editable'); textarea.value='manually reconciled output\\n'; textarea.dispatchEvent(new Event('input',{bubbles:true}));")
    driver.click_scrolled_text('gk-conflict-editor footer button', 'Save Output & Mark Resolved', wait_for_ready=True)
    driver.wait("return !document.querySelector('[aria-label=\"Merge conflict editor\"]')")
    assert (repository / 'output.txt').read_text() == 'manually reconciled output\n'
    assert fixtures.git(repository, 'show', ':output.txt') == 'manually reconciled output'
    report['scenarios'].append('native-merge-tool-saves-edited-output-and-stages-resolution')

    driver.click_scrolled_text('[title="Open Merge Tool for vendor/module"]', 'vendor/module', wait_for_ready=True)
    driver.wait("return document.querySelector('[aria-label=\"Merge conflict editor\"]')?.textContent.includes('Submodule commit conflict')")
    submodule_head_before = fixtures.git(submodule_path, 'rev-parse', 'HEAD')
    submodule_status_before = fixtures.git(submodule_path, 'status', '--porcelain=v1')
    driver.click_scrolled_text('gk-conflict-editor footer button', 'Keep Incoming Commit', wait_for_ready=True)
    driver.wait("return !document.querySelector('[aria-label=\"Merge conflict editor\"]')")
    submodule_index = fixtures.git(repository, 'ls-files', '--stage', '--', 'vendor/module')
    assert submodule_index.startswith(f'160000 {submodule_side} 0\tvendor/module')
    assert fixtures.git(submodule_path, 'rev-parse', 'HEAD') == submodule_head_before == submodule_main
    assert fixtures.git(submodule_path, 'status', '--porcelain=v1') == submodule_status_before
    report['scenarios'].append('native-merge-tool-selects-submodule-gitlink-without-touching-submodule-worktree')

    driver.click_scrolled_text('[title="Open Merge Tool for deleted.txt"]', 'deleted.txt', wait_for_ready=True)
    driver.wait("return document.querySelector('[aria-label=\"Merge conflict editor\"]')?.textContent.includes('Accept incoming deletion')")
    driver.click_scrolled_text('gk-conflict-editor footer button', 'Accept incoming deletion', wait_for_ready=True)
    driver.wait("return !document.querySelector('[aria-label=\"Merge conflict editor\"]')")
    assert not (repository / 'deleted.txt').exists()
    assert fixtures.git(repository, 'ls-files', '--stage', '--', 'deleted.txt') == ''
    report['scenarios'].append('native-merge-tool-accepts-deleted-side-and-stages-removal')

    driver.click_scrolled_text('[title="Open Merge Tool for binary.dat"]', 'binary.dat', wait_for_ready=True)
    driver.wait("return document.querySelector('[aria-label=\"Merge conflict editor\"]')?.textContent.includes('Binary file conflict')")
    driver.click_scrolled_text('gk-conflict-editor footer button', 'Take Incoming', wait_for_ready=True)
    driver.wait("return !document.querySelector('[aria-label=\"Merge conflict editor\"]')")
    expected_binary = b'\0side edit binary\n'
    assert (repository / 'binary.dat').read_bytes() == expected_binary
    staged_binary = subprocess.run(['git', '-C', str(repository), 'show', ':binary.dat'],
                                   capture_output=True, env=fixtures.env, check=True, timeout=10).stdout
    assert staged_binary == expected_binary
    assert fixtures.git(repository, 'diff', '--name-only', '--diff-filter=U') == ''
    assert (repository / '.git/MERGE_HEAD').read_bytes() == merge_head
    report['scenarios'].append('native-merge-tool-resolves-binary-and-delete-modify-conflicts')

    resolved_tree = fixtures.git(repository, 'write-tree')
    driver.click_scrolled_text('.merge-progress button.continue', 'Continue', wait_for_ready=True)
    driver.wait("return !document.querySelector('.merge-progress') && "
                "document.querySelector('.activity-status')?.textContent.includes('Merge complete')")
    assert not (repository / '.git/MERGE_HEAD').exists()
    assert fixtures.git(repository, 'symbolic-ref', 'HEAD') == 'refs/heads/main'
    parents = fixtures.git(repository, 'show', '-s', '--format=%P', 'HEAD').split()
    assert parents == [before['head'], merge_head.decode('ascii').strip()], parents
    assert fixtures.git(repository, 'rev-parse', 'HEAD^{tree}') == resolved_tree
    assert fixtures.git(repository, 'rev-parse', 'owned-side') == parents[1]
    assert fixtures.git(submodule_path, 'rev-parse', 'HEAD') == submodule_head_before
    assert fixtures.git(submodule_path, 'status', '--porcelain=v1') == submodule_status_before
    report['scenarios'].append('native-continue-merge-commits-exact-resolved-tree-with-both-parents')
    return repository, repo_id
