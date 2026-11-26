"""Verify a real unmerged Git index through the installed file-search palette."""
import json

from native_setup_keyboard_scenarios import _chord


def copy_file_paths_from_native_menus(driver, fixtures, report):
    from native_acceptance import open_ui
    from native_worktree_scenarios import checkout_footprint

    repository = fixtures.repository('file-menu-copy', commits=2)
    historical = 'café [1].txt'
    working = 'work café [2].txt'
    (repository / historical).write_bytes(b'Historical data\n')
    fixtures.git(repository, 'add', '--', historical)
    fixtures.git(repository, 'commit', '-qm', 'Track a literal historical path')
    (repository / working).write_bytes(b'Untracked data\n')
    files = (historical, working)
    footprint = checkout_footprint(fixtures, repository, files)
    repo_id = open_ui(driver, repository)

    def copy_from_menu(opener, path):
        driver.context_click(opener)
        driver.click_scrolled_text('gk-file-action-menu [role=menuitem]', 'Copy file path', wait_for_ready=True)
        driver.wait("return document.querySelector('[data-git-operation-status]')?.textContent.includes("
                    + json.dumps('Copied file path: ' + path) + ")")
        assert checkout_footprint(fixtures, repository, files) == footprint

    driver.click_visible('.wip-nav')
    copy_from_menu('[aria-label=' + json.dumps('View changes in ' + working, ensure_ascii=False) + ']', working)
    report['scenarios'].append('native-working-file-menu-copies-literal-path-without-git-mutation')
    driver.click_visible('.commit-row[data-commit-oid=' + json.dumps(footprint['head']) + ']')
    copy_from_menu('.commit-panel .commit-file', historical)
    report['scenarios'].append('native-commit-file-menu-copies-literal-path-without-git-mutation')
    return repository, repo_id


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
    deletion_subject = 'DeleteHistoricalFile' * 30
    fixtures.git(repository, 'commit', '-qm', deletion_subject)
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
    subjects = driver.script("return [...document.querySelectorAll('.file-insight-panel .history-entry > div > button')].map(node => node.textContent.trim())")
    assert subjects == [deletion_subject, 'Rename historical file', 'GC_HISTORY'], subjects
    try:
        driver.request('POST', driver.path('window/rect'), {'width': 820, 'height': 720})
        compact = driver.wait("""if (innerWidth < 780 || innerWidth > 900) return null;
          const row = document.querySelector('gk-file-history .history-entry');
          const subject = row?.querySelector('.history-subject');
          const path = row?.querySelector('.copy-history-path');
          const commit = row?.querySelector('.copy-history-commit');
          if (![subject, path, commit].every(node => node?.getClientRects().length)) return null;
          const [titleBox, pathBox, commitBox] = [subject, path, commit].map(node => node.getBoundingClientRect());
          const style = getComputedStyle(subject);
          return subject.title === subject.textContent.trim() && style.textOverflow === 'ellipsis'
            && style.overflowX === 'hidden' && subject.scrollWidth > subject.clientWidth
            && titleBox.right <= pathBox.left && pathBox.right <= commitBox.left
            && commitBox.right <= innerWidth ? {innerWidth} : null;""")
        report['compactFileHistory'] = compact
        report['scenarios'].append('native-file-history-long-subject-keeps-copy-actions-visible')
    finally:
        driver.request('POST', driver.path('window/rect'), {'width': 1440, 'height': 900})
    driver.wait('return innerWidth >= 1300')
    copy_commit = '.file-insight-panel .history-entry:first-child .copy-history-commit'
    driver.click_scrolled_text(copy_commit, tip[:8], wait_for_ready=True)
    driver.wait("return document.querySelector('gk-file-history .copy-feedback')?.textContent.trim()"
                " === " + json.dumps('Copied commit ID: ' + tip))
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
    assert (repository / '.git/index').read_bytes() == index
    assert not (repository / path).exists()
    report['scenarios'].append('native-file-history-copies-full-commit-id-without-git-mutation')
    driver.click_scrolled_text('.file-insight-panel .history-entry:first-child .copy-history-path',
                               'Copy path', wait_for_ready=True)
    driver.wait("""return document.querySelector('gk-file-history .copy-feedback')?.textContent.trim()
        === 'Copied file path: ' + """ + json.dumps(path))
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
    assert (repository / '.git/index').read_bytes() == index
    assert not (repository / path).exists()
    report['scenarios'].append('native-file-history-copies-deleted-path-without-git-mutation')
    driver.click('gk-file-history .history-start summary')
    driver.script("const field=document.querySelector('gk-file-history .history-start input'); if(!field) throw Error('Missing history starting point field'); field.value='history-start'; field.dispatchEvent(new Event('input',{bubbles:true}));")
    driver.click_scrolled_text('gk-file-history .history-start button', 'Search from revision', wait_for_ready=True)
    driver.wait("return document.querySelector('gk-file-history .history-start summary')?.textContent.includes('history-start') && [...document.querySelectorAll('gk-file-history .history-entry > div > button')].map(button=>button.textContent.trim()).join('|') === 'Rename historical file|GC_HISTORY'")
    assert driver.script("return document.querySelector('gk-file-history .copy-feedback')?.textContent.trim()") == ''
    report['scenarios'].append('native-file-history-clears-copied-path-feedback-on-starting-revision-change')
    for starting_point in ('history/branch', rename_tip):
        driver.script("const field=document.querySelector('gk-file-history .history-start input'); field.value=arguments[0]; field.dispatchEvent(new Event('input',{bubbles:true}));", starting_point)
        driver.click_scrolled_text('gk-file-history .history-start button', 'Search from revision', wait_for_ready=True)
        driver.wait(f"return document.querySelector('gk-file-history .history-start summary')?.textContent.includes({json.dumps(starting_point)}) && [...document.querySelectorAll('gk-file-history .history-entry > div > button')].map(button=>button.textContent.trim()).join('|') === 'Rename historical file|GC_HISTORY'")
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
    assert (repository / '.git/index').read_bytes() == index
    driver.click_scrolled_text('gk-file-history .history-start button', 'Use diff revision', wait_for_ready=True)
    driver.wait("return document.querySelector('gk-file-history .history-entry > div > button')?.textContent.trim() === "
                + json.dumps(deletion_subject))
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
    assert (repository / '.git/index').read_bytes() == index
    report['scenarios'].append('native-file-history-selects-tag-branch-and-commit-start-points-and-restores-diff-revision')

    driver.click_scrolled_text('.file-insight-panel .history-entry > div > button', deletion_subject, wait_for_ready=True)
    driver.wait("return document.querySelector('.diff-primary-view')?.textContent.includes('last committed contents before deletion')")
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == tip
    assert (repository / '.git/index').read_bytes() == index
    assert not (repository / path).exists()
    report['scenarios'].append('native-file-history-opens-a-deleted-literal-path-and-its-removal-diff')
    return repository, repo_id
