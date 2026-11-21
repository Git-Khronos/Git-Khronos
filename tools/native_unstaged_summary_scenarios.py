"""Unstaged recap uses real index-relative Git counts, never commit totals."""
import json
from native_worktree_scenarios import checkout_footprint


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
    def recaps(unstaged, staged, uncounted=1):
        # A live status refresh can temporarily replace either recap with the
        # loading state. Match and capture both elements in the same DOM read.
        expected = [
            ('.unstaged-section gc-working-tree-summary .summary',
             f'{unstaged[0]} additions and {unstaged[1]} deletions in unstaged files'
             + (f'; {uncounted} binary or uncounted files excluded' if uncounted else '')),
            ('.staged-section gc-working-tree-summary .summary',
             f'{staged[0]} additions and {staged[1]} deletions in staged files'),
        ]
        texts = driver.wait('''
            const rows = ''' + json.dumps(expected) + ''';
            const texts = [];
            for (const [selector, label] of rows) {
                const row = document.querySelector(selector);
                if (!row?.getClientRects().length || row.getAttribute("aria-label") !== label) return null;
                texts.push(row.textContent);
            }
            return texts;
        ''')
        for text, (additions, deletions) in zip(texts, (unstaged, staged), strict=True):
            assert f'+{additions}' in text and f'−{deletions}' in text and 'partial' not in text, text
        return texts

    initial, initial_staged = recaps((4, 3), (1, 1))
    assert checkout_footprint(fixtures, repository, files) == before
    report['unstagedLineSummary'] = {'source': str(repository), 'before': before, 'initialRecap': initial, 'initialStagedRecap': initial_staged}
    report['scenarios'].append('native-unstaged-summary-counts-index-relative-lines-untracked-text-and-binary-exclusion-without-writes')
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
    open_ui(driver, renamed)
    rename_recap, staged = recaps((1, 1), (0, 0), uncounted=0)
    assert checkout_footprint(fixtures, renamed, (new_name.name,)) == exact_before
    report['unstagedLineSummary']['editedRename'] = {'unstagedRecap': rename_recap,
                                                      'stagedRecap': staged, 'footprint': exact_before}
    report['scenarios'].append('native-unstaged-rename-does-not-inflate-lines-or-change-the-index')
