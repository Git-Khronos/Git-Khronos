"""Verify a real unmerged Git index through the installed file-search palette."""
import json

from native_setup_keyboard_scenarios import _chord


def tracked_file_search_during_merge(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('tracked-file-search-conflict', commits=2)
    conflict = repository / 'scoped-search-conflict.txt'
    neighbour = repository / 'scoped-search-neighbour.txt'
    ignored_for_search = repository / 'scoped-search-untracked.txt'
    conflict.write_text('common line\n')
    neighbour.write_text('unrelated tracked contents\n')
    fixtures.git(repository, 'add', '--', conflict.name, neighbour.name)
    fixtures.git(repository, 'commit', '-qm', 'Record search fixture')
    fixtures.git(repository, 'checkout', '-qb', 'search-side')
    conflict.write_text('side change\n')
    fixtures.git(repository, 'commit', '-qam', 'Side changes the searched path')
    fixtures.git(repository, 'checkout', '-q', 'main')
    conflict.write_text('main change\n')
    fixtures.git(repository, 'commit', '-qam', 'Main changes the searched path')
    try:
        fixtures.git(repository, 'merge', '--no-edit', 'search-side')
    except RuntimeError:
        pass  # Prove this was a real merge conflict with the Git index below.
    else:
        raise AssertionError('The search fixture unexpectedly merged cleanly')
    ignored_for_search.write_text('untracked search fixture\n')
    assert len(fixtures.git(repository, 'ls-files', '--unmerged', '--', conflict.name).splitlines()) == 3
    repo_id = open_ui(driver, repository)

    def footprint():
        return {
            'indexEntries': fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z'),
            'refs': fixtures.git(repository, 'show-ref'),
            'mergeHead': (repository / '.git/MERGE_HEAD').read_bytes(),
            'files': [path.read_bytes() for path in (conflict, neighbour, ignored_for_search)],
        }
    before = footprint()
    paths = [conflict.name, neighbour.name]
    result = driver.invoke('search_tracked_files', repoId=repo_id, query='scoped-search-', limit=2)
    assert result == {'paths': paths, 'truncated': False}, result
    report['scenarios'].append('native-tracked-file-search-uses-distinct-unmerged-paths-before-the-result-limit')

    _chord(driver, 'h', shift=True)
    driver.wait("""const field = document.querySelector('gk-command-palette input[aria-label="Search tracked files"]');
      return !!field && document.activeElement === field;""")
    driver.script("""const field = document.activeElement;
      field.value = 'scoped-search-'; field.dispatchEvent(new Event('input', { bubbles: true }));""")
    driver.wait("""return [...document.querySelectorAll('gk-command-palette [role=option] strong')]
      .some(node => node.textContent.includes('scoped-search-neighbour.txt'));""")
    options = driver.script("""return [...document.querySelectorAll('gk-command-palette [role=option] strong')]
      .map(node => node.textContent.trim());""")
    assert sorted(options) == sorted([
        *(prefix + path for prefix in ('File History: ', 'Blame: ') for path in paths),
        'File history for exact path: scoped-search-',
    ]), options
    driver.key('\ue00c')
    driver.wait("return !document.querySelector('gk-command-palette')")
    assert footprint() == before, 'Reading tracked-file results changed an active merge or its files'
    report['trackedFileSearchPaths'] = paths
    report['scenarios'].append('native-tracked-file-palette-keeps-one-history-and-blame-per-path-without-changing-merge-state')
    return repository, repo_id

def deleted_file_history_from_exact_path(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('history-of-deleted-path', commits=2)
    fixtures.git(repository, 'config', 'user.name', 'GC_HISTORY')
    oldest = repository / 'GC_HISTORY'
    path = 'archived [1].txt'
    oldest.write_text('last committed contents before deletion\n')
    fixtures.git(repository, 'add', '--', oldest.name)
    fixtures.git(repository, 'commit', '-qm', 'GC_HISTORY')
    fixtures.git(repository, 'mv', '--', oldest.name, path)
    fixtures.git(repository, 'commit', '-qm', 'Rename historical file')
    rename_tip = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'tag', 'history-start', rename_tip)
    fixtures.git(repository, 'branch', 'history/branch', rename_tip)
    fixtures.git(repository, 'rm', '--', path)
    fixtures.git(repository, 'commit', '-qm', 'Delete historical file')
    tip = fixtures.git(repository, 'rev-parse', 'HEAD')
    index = (repository / '.git/index').read_bytes()
    repo_id = open_ui(driver, repository)

    _chord(driver, 'h', shift=True)
    driver.wait("""const field = document.querySelector('gk-command-palette input[aria-label="Search tracked files"]');
      return !!field && document.activeElement === field;""")
    driver.script("""const field = document.activeElement;
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));""", path)
    driver.click_scrolled_text('gk-command-palette [role=option] strong', 'File history for exact path: ' + path, wait_for_ready=True)
    driver.wait("""return [...document.querySelectorAll('.file-insight-panel .history-entry small')]
      .some(node => node.textContent.includes('Deleted'));""")
    subjects = driver.script("return [...document.querySelectorAll('.file-insight-panel .history-entry button')].map(node => node.textContent.trim())")
    assert subjects == ['Delete historical file', 'Rename historical file', 'GC_HISTORY'], subjects
    driver.click('gk-file-history .history-start summary')
    driver.script("const field=document.querySelector('gk-file-history .history-start input'); if(!field) throw Error('Missing history starting point field'); field.value='history-start'; field.dispatchEvent(new Event('input',{bubbles:true}));")
    driver.click_scrolled_text('gk-file-history .history-start button', 'Search from revision', wait_for_ready=True)
    driver.wait("return document.querySelector('gk-file-history .history-start summary')?.textContent.includes('history-start') && [...document.querySelectorAll('gk-file-history .history-entry button')].map(button=>button.textContent.trim()).join('|') === 'Rename historical file|GC_HISTORY'")
    for starting_point in ('history/branch', rename_tip):
        driver.script("const field=document.querySelector('gk-file-history .history-start input'); field.value=arguments[0]; field.dispatchEvent(new Event('input',{bubbles:true}));", starting_point)
        driver.click_scrolled_text('gk-file-history .history-start button', 'Search from revision', wait_for_ready=True)
        driver.wait(f"return document.querySelector('gk-file-history .history-start summary')?.textContent.includes({json.dumps(starting_point)}) && [...document.querySelectorAll('gk-file-history .history-entry button')].map(button=>button.textContent.trim()).join('|') === 'Rename historical file|GC_HISTORY'")
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
    assert (repository / '.git/index').read_bytes() == index
    driver.click_scrolled_text('gk-file-history .history-start button', 'Use diff revision', wait_for_ready=True)
    driver.wait("return [...document.querySelectorAll('gk-file-history .history-entry button')].map(button=>button.textContent.trim())[0] === 'Delete historical file'")
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
    assert (repository / '.git/index').read_bytes() == index
    report['scenarios'].append('native-file-history-selects-tag-branch-and-commit-start-points-and-restores-diff-revision')

    driver.click_scrolled_text('.file-insight-panel .history-entry button', 'Delete historical file', wait_for_ready=True)
    driver.wait("return document.querySelector('.diff-primary-view')?.textContent.includes('last committed contents before deletion')")
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
    assert (repository / '.git/index').read_bytes() == index
    assert not (repository / path).exists()
    report['scenarios'].append('native-file-history-opens-a-deleted-literal-path-and-its-removal-diff')
    return repository, repo_id
