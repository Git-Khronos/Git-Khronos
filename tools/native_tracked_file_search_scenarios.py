"""Verify a real unmerged Git index through the installed file-search palette."""
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
    driver.wait("""const field = document.querySelector('gc-command-palette input[aria-label="Search tracked files"]');
      return !!field && document.activeElement === field;""")
    driver.script("""const field = document.activeElement;
      field.value = 'scoped-search-'; field.dispatchEvent(new Event('input', { bubbles: true }));""")
    driver.wait("""return [...document.querySelectorAll('gc-command-palette [role=option] strong')]
      .some(node => node.textContent.includes('scoped-search-neighbour.txt'));""")
    options = driver.script("""return [...document.querySelectorAll('gc-command-palette [role=option] strong')]
      .map(node => node.textContent.trim());""")
    assert sorted(options) == sorted(prefix + path for prefix in ('File History: ', 'Blame: ') for path in paths), options
    driver.key('\ue00c')
    driver.wait("return !document.querySelector('gc-command-palette')")
    assert footprint() == before, 'Reading tracked-file results changed an active merge or its files'
    report['trackedFileSearchPaths'] = paths
    report['scenarios'].append('native-tracked-file-palette-keeps-one-history-and-blame-per-path-without-changing-merge-state')
    return repository, repo_id
