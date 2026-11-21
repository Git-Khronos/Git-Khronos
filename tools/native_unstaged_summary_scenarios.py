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
    recap = '.unstaged-section gc-working-tree-summary .summary'

    def counts(additions, deletions):
        label = f'{additions} additions and {deletions} deletions in unstaged files; 1 binary or uncounted files excluded'
        driver.wait('return document.querySelector(' + json.dumps(recap) + ')?.getAttribute("aria-label") === ' + json.dumps(label))
        assert 'partial' not in driver.script('return document.querySelector(arguments[0]).textContent', recap)
        return driver.script('return document.querySelector(arguments[0]).textContent', recap)

    def staged_counts(additions, deletions):
        label = f'{additions} additions and {deletions} deletions in staged files'
        selector = '.staged-section gc-working-tree-summary .summary'
        driver.wait('return document.querySelector(' + json.dumps(selector) + ')?.getAttribute("aria-label") === ' + json.dumps(label))
        return driver.script('return document.querySelector(arguments[0]).textContent', selector)

    initial = counts(4, 3)
    initial_staged = staged_counts(1, 1)
    assert checkout_footprint(fixtures, repository, files) == before
    report['unstagedLineSummary'] = {'source': str(repository), 'before': before, 'initialRecap': initial, 'initialStagedRecap': initial_staged}
    report['scenarios'].append('native-unstaged-summary-counts-index-relative-lines-untracked-text-and-binary-exclusion-without-writes')
    driver.click_visible('[aria-label="Stage fixture.txt"]')
    after_stage = counts(2, 2)
    after_staged = staged_counts(2, 1)
    assert fixtures.git(repository, 'show', ':fixture.txt') == 'unstaged\nretained\nextra'
    after = checkout_footprint(fixtures, repository, files)
    for key in ('head', 'branch', 'references', 'configSha256', 'files'):
        assert after[key] == before[key], 'Staging changed unrelated summary fixture data: ' + key
    report['unstagedLineSummary'].update({'afterStageRecap': after_stage, 'afterStagedRecap': after_staged, 'after': after})
    report['scenarios'].append('native-unstaged-summary-recounts-after-staging-without-including-staged-lines')
    report['scenarios'].append('native-staged-summary-counts-the-index-against-head-before-and-after-staging')
