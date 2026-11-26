"""Unstaged recap uses real index-relative Git counts, never commit totals."""
import json
import subprocess
import time
from native_worktree_scenarios import checkout_footprint
from native_working_tree_recaps import wait_for_line_recaps


def unstaged_summary_workflow(driver, fixtures, report):
    from native_acceptance import open_ui, seed_commit_draft

    def wait_index_entry(repository, path, expected, timeout=20):
        # Rows move optimistically before the native command updates the index.
        deadline = time.monotonic() + timeout
        while True:
            actual = fixtures.git(repository, 'ls-files', '--stage', '--', path)
            if actual == expected:
                return actual
            if time.monotonic() >= deadline:
                raise AssertionError(f'Index entry for {path}: expected {expected!r}, got {actual!r}')
            time.sleep(.05)

    repository = fixtures.repository('unstaged-summary-review', commits=2)
    (repository / 'fixture.txt').write_text('old\nretained\n')
    (repository / 'deleted.txt').write_text('gone\nline\n')
    fixtures.git(repository, 'add', '--all')
    fixtures.git(repository, 'commit', '-m', 'Owned summary baseline')
    (repository / 'fixture.txt').write_text('staged\nretained\n')
    fixtures.git(repository, 'add', 'fixture.txt')
    (repository / 'fixture.txt').write_text('unstaged\nretained\nextra\n')
    (repository / 'deleted.txt').unlink()
    (repository / 'new-note.txt').write_text('new\nno-final-newline')
    (repository / 'binary.dat').write_bytes(b'owned\0binary')
    files = ('fixture.txt', 'new-note.txt', 'binary.dat')
    before = checkout_footprint(fixtures, repository, files)
    open_ui(driver, repository)
    def recaps(unstaged, staged, uncounted=1, timeout=30):
        matched = wait_for_line_recaps(driver, unstaged, staged, uncounted=uncounted, timeout=timeout)
        return [row['text'] for row in matched]

    initial, initial_staged = recaps((4, 3), (1, 1))
    assert checkout_footprint(fixtures, repository, files) == before
    report['unstagedLineSummary'] = {'source': str(repository), 'before': before, 'initialRecap': initial, 'initialStagedRecap': initial_staged}
    report['scenarios'].append('native-unstaged-summary-counts-index-relative-lines-untracked-text-and-binary-exclusion-without-writes')

    # A live status refresh can temporarily retire the just-measured recap.
    # Sample both palettes from the same ready element within the poll.
    colors = driver.wait("""const root = document.documentElement;
      const previous = root.getAttribute('data-theme');
      const excluded = document.querySelector('.unstaged-section gk-working-tree-summary .summary em');
      if (excluded?.textContent.trim() !== '1 excluded') return null;
      const color = () => getComputedStyle(excluded).color;
      try {
        root.removeAttribute('data-theme');
        const standard = color();
        root.setAttribute('data-theme', 'midnight');
        return {standard, midnight: color()};
      } finally {
        if (previous === null) root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', previous);
      }""")
    assert colors == {'standard': 'rgb(146, 145, 165)', 'midnight': 'rgb(154, 168, 187)'}, colors
    assert checkout_footprint(fixtures, repository, files) == before
    report['unstagedLineSummary']['excludedColors'] = colors
    report['scenarios'].append('native-unstaged-excluded-label-follows-both-theme-palettes')

    try:
        driver.request('POST', driver.path('window/rect'), {'width': 820, 'height': 720})
        compact = driver.wait("""if (innerWidth < 780 || innerWidth > 900) return null;
          const title = document.querySelector('.unstaged-section .file-section-title');
          if (!title) return null;
          const elements = [title.querySelector('.summary'), title.querySelector('[aria-label="Stage all changes"]'),
            title.querySelector('[aria-label="Discard all unstaged changes"]')];
          if (!elements.every(e => e?.getClientRects().length) || !elements[0].textContent.includes('1 excluded')) return null;
          const [totals, stage, discard] = elements.map(e => e.getBoundingClientRect());
          const header = title.getBoundingClientRect();
          const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1
            && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          return [totals, stage, discard].every(box => box.left >= header.left - 1 && box.right <= header.right + 1)
            && !overlap(totals, stage) && !overlap(totals, discard) && !overlap(stage, discard)
            ? {innerWidth, totals: elements[0].textContent.trim()} : null;""")
        assert checkout_footprint(fixtures, repository, files) == before
        report['unstagedLineSummary']['compactActions'] = compact
        report['scenarios'].append('native-compact-unstaged-recap-does-not-cover-bulk-actions')
    finally:
        driver.request('POST', driver.path('window/rect'), {'width': 1440, 'height': 900})
    driver.wait('return innerWidth >= 1300')

    staged_toggle = '.staged-section .file-section-toggle'
    driver.wait(f"""return document.querySelector({staged_toggle!r})?.getAttribute('aria-controls') === 'staged-files-list'
      && document.querySelector('.unstaged-section .file-section-toggle')?.getAttribute('aria-controls') === 'unstaged-files-list'
      && !!document.getElementById('staged-files-list') && !!document.getElementById('unstaged-files-list');""")
    original_height = driver.script("return document.querySelector('#unstaged-files-list').clientHeight")
    driver.script(f"document.querySelector({staged_toggle!r}).focus()")
    driver.key('\ue007')  # Enter
    driver.wait(f"""const panel = document.querySelector('.working-tree-scroll');
      const staged = panel.querySelector('.staged-section');
      const list = panel.querySelector('#unstaged-files-list');
      const toggle = staged.querySelector('.file-section-toggle');
      const collapsed = toggle.getAttribute('aria-expanded') === 'false' && !toggle.hasAttribute('aria-controls');
      const docked = Math.abs(panel.getBoundingClientRect().bottom - staged.getBoundingClientRect().bottom) <= 1;
      const focused = document.activeElement === toggle;
      return collapsed && docked && focused && list.clientHeight > {original_height};""")
    driver.key('\ue00d')  # Space
    driver.wait(f"""return document.querySelector('#staged-files-list')?.getClientRects().length
      && document.querySelector('#unstaged-files-list')?.clientHeight === {original_height}
      && document.activeElement?.matches({staged_toggle!r})
      && document.activeElement.getAttribute('aria-controls') === 'staged-files-list'""")
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-collapsing-staged-files-docks-header-and-expands-unstaged-viewport')

    # Keep local storage intact so this exercises ordinary startup rather
    # than the harness's clean repository bootstrap.
    driver.key('\ue007')  # Collapse again before reloading.
    driver.wait(f"return document.querySelector({staged_toggle!r})?.getAttribute('aria-expanded') === 'false'")
    driver.reload()
    driver.wait(f"""const list = document.querySelector('#unstaged-files-list');
      return document.querySelector({staged_toggle!r})?.getAttribute('aria-expanded') === 'false'
        && list?.clientHeight > {original_height} && !document.querySelector('#staged-files-list');""")
    driver.click_visible(staged_toggle)
    driver.wait("return !!document.querySelector('#staged-files-list')")
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-staged-file-disclosure-persists-and-keeps-unstaged-space-after-reload')

    unstaged_toggle = '.unstaged-section .file-section-toggle'
    staged_height = driver.script("return document.querySelector('#staged-files-list').clientHeight")
    driver.click_visible(unstaged_toggle)
    driver.wait(f"""return !document.querySelector('#unstaged-files-list')
      && document.querySelector('#staged-files-list')?.clientHeight > {staged_height}
      && !document.querySelector('[aria-controls="staged-files-list"][role="separator"]');""")
    driver.click_visible(unstaged_toggle)
    driver.wait(f"""return !!document.querySelector('#unstaged-files-list')
      && document.querySelector('#staged-files-list')?.clientHeight === {staged_height};""")
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-collapsing-unstaged-files-expands-staged-viewport-without-writes')

    draft = 'Keep the owned draft while filtering'
    seed_commit_draft(driver, repository, draft)
    driver.click_visible('[aria-label="Close commit panel"]')
    search = 'gk-command-palette input[aria-label="Search commands"]'

    def palette_option(label):
        driver.click_visible('[aria-label="Command palette"]')
        driver.wait(f"return document.activeElement?.matches({search!r})")
        driver.script("""const field = document.querySelector(arguments[0]);
          field.value = arguments[1]; field.dispatchEvent(new Event('input', {bubbles: true}));""", search, label)
        driver.wait(f"""return [...document.querySelectorAll('gk-command-palette [role="option"]')]
          .some(option => option.textContent.includes({label!r}));""")
        driver.key('\ue007')

    palette_option('Filter Changed Files')
    driver.wait("""return document.activeElement?.matches('input[aria-label="Filter changed files"]')
      && !document.querySelector('gk-command-palette');""")
    assert driver.script("return document.querySelector('#commit-summary').value") == draft
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-palette-focuses-working-tree-filter-without-changing-draft-or-checkout')

    driver.click_visible(staged_toggle)
    driver.click_visible(unstaged_toggle)
    palette_option('Show Staged Files')
    driver.wait("""return document.activeElement?.id === 'staged-files-list'
      && !document.querySelector('#unstaged-files-list');""")
    driver.click_visible(staged_toggle)
    palette_option('Show Unstaged Files')
    driver.wait("""return document.activeElement?.id === 'unstaged-files-list'
      && !document.querySelector('#staged-files-list');""")
    driver.click_visible(staged_toggle)
    driver.wait("return !!document.querySelector('#staged-files-list')")
    assert driver.script("return document.querySelector('#commit-summary').value") == draft
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-palette-opens-and-focuses-only-the-requested-file-section')

    filter_field = 'input[aria-label="Filter changed files"]'

    def filter_paths(value):
        driver.script("""const field = document.querySelector(arguments[0]);
          field.value = arguments[1]; field.dispatchEvent(new Event('input', {bubbles: true}));""", filter_field, value)

    driver.click_visible(staged_toggle)
    driver.click_visible(unstaged_toggle)
    filter_paths('deleted.txt')
    driver.wait("""return document.querySelector('.unstaged-section .collapsed-file-matches')?.textContent.trim() === '1 loaded match'
      && document.querySelector('.staged-section .collapsed-file-matches')?.textContent.trim() === '0 loaded matches';""")
    driver.click_visible('button[aria-label="Clear file filter"]')
    driver.wait("return !document.querySelector('.collapsed-file-matches')")
    driver.click_visible(staged_toggle)
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-collapsed-working-tree-headers-show-loaded-filter-matches')

    driver.wait("return !document.querySelector('#unstaged-files-list')")
    driver.click_visible('[aria-label="Working directory options"]')
    driver.click_scrolled_text('.panel-options-menu [role=menuitem]',
                               'Select files for discardChoose only the unstaged files to discard',
                               wait_for_ready=True)
    driver.wait("""return document.activeElement?.id === 'unstaged-files-list'
      && !!document.querySelector('#unstaged-files-list input.discard-selection:not(:checked)');""")
    assert checkout_footprint(fixtures, repository, files) == before
    driver.click_visible(unstaged_toggle)
    driver.wait("""return !document.querySelector('#unstaged-files-list')
      && document.querySelector('.discard-actions [aria-live]')?.textContent.includes('Expand Unstaged Files to select files');""")
    driver.click_visible(unstaged_toggle)
    filter_paths('no-visible-discard-path')
    driver.wait("""return document.querySelector('.discard-actions [aria-live]')?.textContent.includes('Clear the filter to select unstaged files')
      && !document.querySelector('#unstaged-files-list input.discard-selection');""")
    filter_paths('')
    driver.wait("""return document.querySelector('.discard-actions [aria-live]')?.textContent.includes('Select files below')
      && !!document.querySelector('#unstaged-files-list input.discard-selection:not(:checked)');""")
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-discard-picker-explains-collapsed-and-filtered-out-files-without-writes')
    driver.click_scrolled_text('#unstaged-files-list input[aria-label="Select fixture.txt for discard"]',
                               '', wait_for_ready=True)
    filter_paths('no-selected-path-matches')
    driver.wait("""return document.querySelector('.discard-actions span[aria-live]')?.textContent.includes('1 hidden by the filter')
      && !document.querySelector('#unstaged-files-list input.discard-selection');""")
    driver.click_scrolled_text('.discard-actions button', 'Cancel selection', wait_for_ready=True)
    driver.wait("""return !document.querySelector('.discard-actions')
      && document.activeElement?.id === 'unstaged-files-list';""")
    driver.click_visible(filter_field)
    driver.key('\ue00c')  # Escape clears the path filter.
    driver.wait(f"return document.querySelector({filter_field!r})?.value === ''")
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-discard-picker-reopens-and-focuses-unstaged-list-without-writes')
    report['scenarios'].append('native-discard-picker-discloses-filtered-selections-and-restores-focus-on-cancel')

    # A partially staged path is present in both viewports. Selecting its
    # Tree row must inspect that side of the index, not the other row's diff.
    driver.click_visible('button[data-file-view-mode="tree"]')
    def inspect_tree_side(section, label, added, deleted):
        view = 'View staged changes in' if section == 'staged' else 'View changes in'
        button = f'#{section}-files-list .tree-file button[aria-label="{view} fixture.txt"]'
        driver.click_visible(button)
        totals = driver.wait(f'''
            const viewer = document.querySelector('.diff-workspace');
            if (!viewer?.getClientRects().length
                || !viewer.querySelector('.diff-file-identity')?.textContent.includes({json.dumps(label)})) return null;
            const added = viewer.querySelector('.diff-additions')?.textContent.trim();
            const deleted = viewer.querySelector('.diff-deletions')?.textContent.trim();
            return added && deleted ? {{added, deleted}} : null;
        ''')
        assert totals == {'added': added, 'deleted': deleted}, (section, totals)
        driver.click_visible('button[aria-label="Close diff"]')
        return totals

    staged_tree = inspect_tree_side('staged', 'Staged Changes', '+1', '−1')
    unstaged_tree = inspect_tree_side('unstaged', 'Unstaged Changes', '+2', '−1')
    assert checkout_footprint(fixtures, repository, files) == before
    report['unstagedLineSummary']['treeDiffSides'] = {'staged': staged_tree, 'unstaged': unstaged_tree}
    report['scenarios'].append('native-working-tree-same-path-selects-each-index-side-from-its-tree-row')
    driver.click_visible('button[data-file-view-mode="path"]')

    driver.click_visible('[aria-label="Stage fixture.txt"]')
    after_stage, after_staged = recaps((2, 2), (2, 1))
    assert fixtures.git(repository, 'show', ':fixture.txt') == 'unstaged\nretained\nextra'
    after = checkout_footprint(fixtures, repository, files)
    for key in ('head', 'branch', 'references', 'configSha256', 'files'):
        assert after[key] == before[key], 'Staging changed unrelated summary fixture data: ' + key
    report['unstagedLineSummary'].update({'afterStageRecap': after_stage, 'afterStagedRecap': after_staged, 'after': after})
    report['scenarios'].append('native-unstaged-summary-recounts-after-staging-without-including-staged-lines')
    report['scenarios'].append('native-staged-summary-counts-the-index-against-head-before-and-after-staging')

    renamed = fixtures.repository('unstaged-rename-summary', commits=1)
    old_name, new_name = renamed / 'before.txt', renamed / 'after.txt'
    old_name.write_text('alpha\nbeta\ngamma\ndelta\n')
    fixtures.git(renamed, 'add', '--', old_name.name)
    fixtures.git(renamed, 'commit', '-m', 'Owned rename summary baseline')
    old_name.rename(new_name)
    fixtures.git(renamed, 'add', '-N', '--', new_name.name)
    new_name.write_text('alpha\nbeta\ngamma\nchanged\n')
    exact_before = checkout_footprint(fixtures, renamed, (new_name.name,))
    repo_id = open_ui(driver, renamed)
    rename_recap, staged = recaps((1, 1), (0, 0), uncounted=0)
    assert checkout_footprint(fixtures, renamed, (new_name.name,)) == exact_before
    report['unstagedLineSummary']['editedRename'] = {'unstagedRecap': rename_recap,
                                                      'stagedRecap': staged, 'footprint': exact_before}
    report['scenarios'].append('native-unstaged-rename-does-not-inflate-lines-or-change-the-index')

    # A real external edit leaves the same porcelain rename record and index
    # bytes. The application must refresh the recap without another UI action.
    new_name.write_text('alpha\nbeta\ngamma\nchanged\nplus\n')
    expected_after_edit = checkout_footprint(fixtures, renamed, (new_name.name,))
    assert expected_after_edit['files'] != exact_before['files']
    for key in ('head', 'branch', 'references', 'status', 'indexSha256', 'configSha256'):
        assert expected_after_edit[key] == exact_before[key], 'Unexpected fixture change: ' + key
    live_recap, staged = recaps((2, 1), (0, 0), uncounted=0, timeout=35)
    assert checkout_footprint(fixtures, renamed, (new_name.name,)) == expected_after_edit
    report['unstagedLineSummary']['externalEdit'] = {'unstagedRecap': live_recap,
                                                   'stagedRecap': staged, 'footprint': expected_after_edit}
    report['scenarios'].append('native-unstaged-recap-updates-after-external-edit-with-unchanged-porcelain')

    def verify_rename_diff(button, side):
        driver.click_visible(button)
        text = driver.wait('''
            const viewer = document.querySelector('.diff-workspace');
            const from = viewer?.querySelector('.diff-rename-source');
            const footer = viewer?.querySelector('.diff-additions')?.parentElement;
            if (!viewer?.getClientRects().length || !from?.getClientRects().length || from.textContent !== 'Renamed from before.txt'
                || !viewer.querySelector('.diff-file-identity')?.textContent.includes(''' + json.dumps(side) + ''')
                || !footer?.textContent.includes('Stage or unstage the whole rename from Changes.')) return null;
            return {added: footer.querySelector('.diff-additions').textContent,
                deleted: footer.querySelector('.diff-deletions').textContent,
                partialActions: viewer.querySelectorAll('.diff-line-selector, .focus-hunk-actions button').length};
        ''')
        assert text == {'added': '+2', 'deleted': '−1', 'partialActions': 0}, text
        driver.click_visible('button[aria-label="Close diff"]')
        return text

    unstaged_diff = verify_rename_diff('[aria-label="View changes in after.txt"]', 'Unstaged Changes')
    assert checkout_footprint(fixtures, renamed, (new_name.name,)) == expected_after_edit
    driver.click_visible('[aria-label="Stage after.txt"]')
    staged_rename = recaps((0, 0), (2, 1), uncounted=0)
    indexed = checkout_footprint(fixtures, renamed, (new_name.name,))
    assert indexed['status'] == 'R  before.txt -> after.txt', indexed['status']
    staged_diff = verify_rename_diff('[aria-label="View staged changes in after.txt"]', 'Staged Changes')
    assert checkout_footprint(fixtures, renamed, (new_name.name,)) == indexed
    driver.click_visible('[aria-label="Unstage after.txt"]')
    driver.wait('return !document.querySelector(\'[aria-label="Unstage after.txt"]\')'
                ' && !!document.querySelector(\'[aria-label="Stage before.txt"]\')')
    unindexed = checkout_footprint(fixtures, renamed, (new_name.name,))
    assert unindexed['status'] == 'D before.txt\n?? after.txt', unindexed['status']
    for snapshot in (indexed, unindexed):
        for key in ('head', 'branch', 'references', 'configSha256', 'files'):
            assert snapshot[key] == expected_after_edit[key], 'Rename index action changed ' + key
    report['unstagedLineSummary']['indexRename'] = {'recaps': staged_rename,
                                                   'afterStage': indexed, 'afterUnstage': unindexed}
    report['scenarios'].append('native-worktree-rename-stages-and-unstages-both-paths-without-changing-files')
    report['unstagedLineSummary']['renameDiff'] = {'unstaged': unstaged_diff, 'staged': staged_diff}
    report['scenarios'].append('native-worktree-rename-diff-reviews-both-paths-and-shows-only-edited-lines')

    special = fixtures.repository('worktree-mode-and-binary-staging', commits=1)
    executable, binary = special / 'owned-script.sh', special / 'owned-binary.dat'
    executable.write_text('#!/bin/sh\ntrue\n')
    executable.chmod(0o644)
    binary.write_bytes(b'owned\0before')
    fixtures.git(special, 'config', 'core.filemode', 'true')
    fixtures.git(special, 'add', '--', executable.name, binary.name)
    fixtures.git(special, 'commit', '-m', 'Owned mode and binary baseline')
    executable.chmod(0o755)
    binary.write_bytes(b'owned\0after')
    paths = (executable.name, binary.name)
    original_index = fixtures.git(special, 'ls-files', '--stage', '--', *paths)
    expected_blob = fixtures.git(special, 'hash-object', '--', binary.name)
    expected_modes = {executable.name: ('100755', fixtures.git(special, 'rev-parse', f'HEAD:{executable.name}')),
                      binary.name: ('100644', expected_blob)}
    originals = {entry.split('\t')[1]: entry for entry in original_index.splitlines()}
    footprint = checkout_footprint(fixtures, special, paths)
    open_ui(driver, special)

    for path in paths:
        driver.click_visible(f'[aria-label="Stage {path}"]')
        mode, blob = expected_modes[path]
        wait_index_entry(special, path, f'{mode} {blob} 0\t{path}')
        driver.wait(f'return !!document.querySelector(\'[aria-label="Unstage {path}"]\')')
    staged_index = fixtures.git(special, 'ls-files', '--stage', '--', *paths)
    entries = {line.split('\t')[1]: line.split('\t')[0].split()
               for line in staged_index.splitlines()}
    assert entries[binary.name] == ['100644', expected_blob, '0'], entries
    assert entries[executable.name] == [
        '100755', fixtures.git(special, 'rev-parse', f'HEAD:{executable.name}'), '0',
    ], entries

    for path in paths:
        driver.click_visible(f'[aria-label="Unstage {path}"]')
        wait_index_entry(special, path, originals[path])
        driver.wait(f'return !!document.querySelector(\'[aria-label="Stage {path}"]\')')
    restored_index = fixtures.git(special, 'ls-files', '--stage', '--', *paths)
    assert restored_index == original_index, restored_index
    final = checkout_footprint(fixtures, special, paths)
    for key in ('head', 'branch', 'references', 'status', 'configSha256', 'files'):
        assert final[key] == footprint[key], 'Stage/unstage changed ' + key
    assert executable.stat().st_mode & 0o777 == 0o755
    report['unstagedLineSummary']['modeAndBinaryIndex'] = {
        'original': original_index, 'staged': staged_index, 'restored': restored_index,
    }
    report['scenarios'].append('native-stage-and-unstage-preserve-executable-mode-change-and-exact-binary-bytes')

    parent = fixtures.repository('worktree-gitlink-staging', commits=1)
    source = fixtures.repository('owned-gitlink-source', commits=2)
    path = 'owned-submodule'
    child = parent / path
    fixtures.git(parent, 'submodule', 'add', '--', str(source), path)
    newest = fixtures.git(child, 'rev-parse', 'HEAD')
    previous = fixtures.git(child, 'rev-parse', 'HEAD^')
    fixtures.git(child, 'checkout', '--detach', previous)
    fixtures.git(parent, 'add', '--', path)
    fixtures.git(parent, 'commit', '-m', 'Record previous gitlink')
    fixtures.git(child, 'checkout', '--detach', newest)
    (child / 'fixture.txt').write_text('Keep the nested worktree edit.\n')
    nested_before = checkout_footprint(fixtures, child)
    parent_before = checkout_footprint(fixtures, parent, ('.gitmodules', 'fixture.txt'))
    open_ui(driver, parent)

    driver.click_visible(f'[aria-label="Stage {path}"]')
    indexed_link = wait_index_entry(parent, path, f'160000 {newest} 0\t{path}')
    driver.wait(f'return !!document.querySelector(\'[aria-label="Unstage {path}"]\')')
    assert checkout_footprint(fixtures, child) == nested_before

    driver.click_visible(f'[aria-label="Unstage {path}"]')
    restored_link = wait_index_entry(parent, path, f'160000 {previous} 0\t{path}')
    driver.wait(f'return !!document.querySelector(\'[aria-label="Stage {path}"]\')')
    assert checkout_footprint(fixtures, child) == nested_before
    parent_after = checkout_footprint(fixtures, parent, ('.gitmodules', 'fixture.txt'))
    for key in ('head', 'branch', 'references', 'status', 'configSha256', 'files'):
        assert parent_after[key] == parent_before[key], 'Gitlink staging changed parent ' + key
    report['unstagedLineSummary']['gitlinkIndex'] = {'staged': indexed_link, 'restored': restored_link}
    report['scenarios'].append('native-stage-and-unstage-gitlink-without-changing-dirty-submodule')

    crowded = fixtures.repository('unstaged-recap-beyond-staged-budget', commits=2)
    for index in range(2001):
        (crowded / f'a-staged-{index:04}.txt').write_text('staged only\n')
    fixtures.git(crowded, 'add', '--all')
    (crowded / 'fixture.txt').write_text('changed\nsecond line\n')
    (crowded / 'z-untracked.txt').write_text('untracked\n')
    files = ('a-staged-0000.txt', 'fixture.txt', 'z-untracked.txt')
    before_budget = checkout_footprint(fixtures, crowded, files)
    open_ui(driver, crowded)
    recaps = wait_for_line_recaps(driver, (3, 1), (2000, 0), staged_partial=True, timeout=45)
    assert checkout_footprint(fixtures, crowded, files) == before_budget
    report['unstagedLineSummary']['independentBudget'] = recaps
    report['scenarios'].append('native-unstaged-recap-is-complete-when-staged-recap-hits-its-bound')
    stage_all = 'button[aria-label="Stage all changes"]'
    driver.wait(f"""return document.querySelector({stage_all!r})?.matches(':enabled')
      && !document.querySelector('#unstaged-files-list [aria-label^="Stage "]')
      && document.querySelector('.change-loader')?.textContent.includes('Unstaged changes are outside the loaded list')
      && [...document.querySelectorAll('.working-tree-scroll button')].some(e => e.textContent.includes('Show 1,000 more files'))""")
    driver.click_visible(stage_all)
    driver.wait(f"return document.querySelector({stage_all!r})?.matches(':disabled') && document.querySelector('.unstaged-section .file-section-toggle')?.textContent.includes('(0)')")
    assert fixtures.git(crowded, '--no-optional-locks', 'diff', '--name-only') == ''
    assert fixtures.git(crowded, 'ls-files', '--others', '--exclude-standard') == ''
    assert {'fixture.txt', 'z-untracked.txt'} <= set(fixtures.git(crowded, 'diff', '--cached', '--name-only').splitlines())
    after_stage = checkout_footprint(fixtures, crowded, files)
    for key in ('head', 'branch', 'references', 'configSha256', 'files'):
        assert after_stage[key] == before_budget[key], key
    report['scenarios'].append('native-stage-all-reaches-unstaged-files-beyond-initial-status-page')

    fixtures.git(crowded, 'commit', '-qm', 'Record the crowded fixture baseline')
    for index in range(1001):
        (crowded / f'a-staged-{index:04}.txt').write_text('new unstaged content\n')
    (crowded / 'z-untracked.txt').write_text('hidden staged change\n')
    fixtures.git(crowded, 'add', '--', 'z-untracked.txt')
    before_unstage = checkout_footprint(fixtures, crowded, files)
    open_ui(driver, crowded)
    driver.wait("""return document.querySelector('.staged-section .file-section-toggle')?.textContent.includes('(1)')
      && !document.querySelector('#staged-files-list [aria-label^="Unstage "]')
      && document.querySelector('.change-loader')?.textContent.includes('Staged changes are outside the loaded list')
      && [...document.querySelectorAll('.working-tree-scroll button')].some(e => e.textContent.includes('Show 1,000 more files'))""")
    # Use the real truncated status page so the test exercises virtual rows
    # and the extra footer rather than scrolling a small, fully rendered list.
    driver.click_visible(staged_toggle)
    driver.wait(f"""return document.querySelector({staged_toggle!r})?.getAttribute('aria-expanded') === 'false'
      && document.querySelector('#unstaged-files-list')?.querySelector('[aria-label="View changes in a-staged-0000.txt"]');""")
    driver.script("document.querySelector('#unstaged-files-list').focus()")
    for key, path, at_end in (('\ue010', 'a-staged-0999.txt', True), ('\ue011', 'a-staged-0000.txt', False)):
        driver.key(key)  # WebDriver End / Home
        selector = f'button[aria-label="View changes in {path}"]'
        driver.wait(f"""
          const list = document.getElementById('unstaged-files-list');
          const row = list?.querySelector({json.dumps(selector)});
          if (!row || document.activeElement !== list || list.scrollHeight <= list.clientHeight) return false;
          const edge = {str(at_end).lower()} ? list.scrollHeight - list.clientHeight : 0;
          const viewport = list.getBoundingClientRect(), box = row.getBoundingClientRect();
          return Math.abs(list.scrollTop - edge) <= 1 && box.bottom > viewport.top && box.top < viewport.bottom;
        """)
    assert checkout_footprint(fixtures, crowded, files) == before_unstage
    report['scenarios'].append('native-expanded-unstaged-list-reaches-both-keyboard-edges-without-writes')

    # Non-keyboard jumps use the list's scroll event path. Checking only
    # for mounted rows would miss an offset clamped during recycling.
    for fraction in (0.42, 0.86, 0.17, 0.69, 0, 0.99, 1):
        expected = driver.script("""
          const list = document.getElementById('unstaged-files-list');
          const offset = Math.round((list.scrollHeight - list.clientHeight) * arguments[0]);
          list.scrollTop = offset;
          return offset;
        """, fraction)
        driver.wait(f"""
          const list = document.getElementById('unstaged-files-list');
          if (!list || Math.abs(list.scrollTop - {expected}) > 1) return false;
          const viewport = list.getBoundingClientRect();
          const rows = Array.from(list.querySelectorAll('.file-row'), row => row.getBoundingClientRect())
            .filter(row => row.bottom > viewport.top && row.top < viewport.bottom);
          return !!rows.length && rows[0].top <= viewport.top + 1
            && rows[rows.length - 1].bottom >= viewport.bottom - 1;
        """)
    assert checkout_footprint(fixtures, crowded, files) == before_unstage
    report['scenarios'].append('native-expanded-unstaged-scroll-jumps-keep-offset-and-visible-rows-without-writes')
    driver.click_visible(staged_toggle)
    driver.wait("return !!document.querySelector('#staged-files-list')")

    driver.click_scrolled_text('.staged-section .file-section-title button', 'Unstage all', wait_for_ready=True)
    driver.wait("return document.querySelector('.staged-section .file-section-toggle')?.textContent.includes('(0)')")
    assert fixtures.git(crowded, 'diff', '--cached', '--name-only') == ''
    assert 'z-untracked.txt' in fixtures.git(crowded, '--no-optional-locks', 'diff', '--name-only').splitlines()
    after_unstage = checkout_footprint(fixtures, crowded, files)
    for key in ('head', 'branch', 'references', 'configSha256', 'files'):
        assert after_unstage[key] == before_unstage[key], key
    report['scenarios'].append('native-unstage-all-reaches-staged-files-beyond-initial-status-page')

    more_files = '.change-loader button'
    filter_files = 'input[aria-label="Filter changed files"]'
    driver.wait(f"""const button = document.querySelector({more_files!r});
      if (!button?.textContent.includes('Show 1,000 more files')) return false;
      button.focus();
      return document.activeElement === button;""")
    # A live WebKit process may miss paint frames; focus follows DOM removal.
    driver.script("""const observer = new AbortController(), events = [];
                    const capture = event => {
                      if (events.length === 20) return;
                      events.push({type: event.type, target: event.target?.tagName,
                        active: document.activeElement?.tagName,
                        label: document.activeElement?.getAttribute('aria-label')});
                    };
                    for (const event of ['focusin', 'focusout', 'click']) {
                      document.addEventListener(event, capture, {capture: true, signal: observer.signal});
                    }
                    window.__ownedStatusPagerProbe = {observer, events};
                    window.__ownedStatusPagerFrame = window.requestAnimationFrame;
                    window.requestAnimationFrame = () => 0;""")
    try:
        driver.key('\ue007')  # Enter
        driver.wait(f"return !document.querySelector({more_files!r}) && document.activeElement?.matches({filter_files!r})")
    except TimeoutError:
        report['statusPageFocusFailure'] = driver.script("""const active = document.activeElement;
          return {active: active?.tagName, label: active?.getAttribute('aria-label'),
            pagerPresent: !!document.querySelector(arguments[0]),
            filterPresent: !!document.querySelector(arguments[1]), documentFocused: document.hasFocus(),
            events: window.__ownedStatusPagerProbe?.events};""",
          more_files, filter_files)
        raise
    finally:
        driver.script("""window.requestAnimationFrame = window.__ownedStatusPagerFrame;
                        delete window.__ownedStatusPagerFrame;
                        window.__ownedStatusPagerProbe?.observer.abort();
                        delete window.__ownedStatusPagerProbe;""")
    assert checkout_footprint(fixtures, crowded, files) == after_unstage
    report['scenarios'].append('native-final-working-tree-page-restores-keyboard-focus-without-changing-checkout')
    return status_byte_bound_workflow(driver, fixtures, report)


def status_byte_bound_workflow(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('recap-status-byte-bound', commits=1)
    conflict = repository / 'conflicted.txt'
    conflict.write_text('base\n')
    fixtures.git(repository, 'add', '--', conflict.name)
    fixtures.git(repository, 'commit', '-qm', 'Base for owned conflict')
    fixtures.git(repository, 'switch', '-qc', 'side')
    conflict.write_text('theirs\n')
    fixtures.git(repository, 'commit', '-qam', 'Side')
    fixtures.git(repository, 'switch', '-q', 'main')
    conflict.write_text('ours\n')
    fixtures.git(repository, 'commit', '-qam', 'Main')
    result = subprocess.run(
        ['git', '-C', str(repository), 'merge', '--no-edit', 'side'],
        env=fixtures.env, capture_output=True, timeout=10,
    )
    assert result.returncode == 1 and fixtures.git(repository, 'ls-files', '--unmerged'), result.stderr
    parent = repository.joinpath(*(['a' * 250] * 6))
    parent.mkdir(parents=True)
    for index in range(3000):
        (parent / f'file-{index:04}.txt').write_text('staged only\n')
    fixtures.git(repository, 'add', '--', str(parent.relative_to(repository)))
    (repository / 'fixture.txt').write_text('changed\nsecond line\n')
    (repository / 'z-untracked.txt').write_text('untracked\n')
    status = fixtures.git(repository, '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all')
    assert len(status.encode('utf-8')) > 4 * 1024 * 1024
    files = (conflict.name, 'fixture.txt', 'z-untracked.txt')
    before = checkout_footprint(fixtures, repository, files)
    repo_id = open_ui(driver, repository)
    recaps = wait_for_line_recaps(driver, (3, 1), (2000, 0), staged_partial=True, timeout=60)
    assert checkout_footprint(fixtures, repository, files) == before
    report['unstagedLineSummary']['statusByteBound'] = {'statusBytes': len(status.encode('utf-8')), 'recaps': recaps}
    report['scenarios'].append('native-unstaged-recap-survives-status-byte-bound-without-counting-conflicts')
    return repository, repo_id
