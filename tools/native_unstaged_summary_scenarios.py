"""Unstaged recap uses real index-relative Git counts, never commit totals."""
import json
from native_worktree_scenarios import checkout_footprint
from native_working_tree_recaps import wait_for_line_recaps


def unstaged_summary_workflow(driver, fixtures, report):
    from native_acceptance import open_ui

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
    return renamed, repo_id
