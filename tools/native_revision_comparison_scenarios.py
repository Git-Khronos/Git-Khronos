"""Verify direct and merge-base revision comparison in the installed renderer."""
import json

from native_worktree_scenarios import checkout_footprint


def revision_comparison(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('revision-comparison', commits=2)
    common = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'tag', '-a', 'shared-base', '-m', 'Shared comparison point')
    fixtures.git(repository, 'switch', '-c', 'topic')
    (repository / 'topic-only.txt').write_text('Topic change.\n')
    fixtures.git(repository, 'add', 'topic-only.txt')
    fixtures.git(repository, 'commit', '-qm', 'Topic change')
    target = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'switch', 'main')
    (repository / 'main-only.txt').write_text('Main change.\n')
    fixtures.git(repository, 'add', 'main-only.txt')
    fixtures.git(repository, 'commit', '-qm', 'Main change')
    main = fixtures.git(repository, 'rev-parse', 'HEAD')
    files = ('fixture.txt', 'main-only.txt')
    before = checkout_footprint(fixtures, repository, files)
    repo_id = open_ui(driver, repository)

    driver.click_visible('[aria-label="Command palette"]')
    driver.wait("""return !!document.querySelector('[role=combobox][aria-label="Search commands"]')""")
    driver.script("""
      const field = document.querySelector('[role=combobox][aria-label="Search commands"]');
      field.value = 'compare revisions';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    """)
    driver.click_scrolled_text('[role=option] strong', 'Compare revisions…', wait_for_ready=True)
    dialog = '#repository-history-dialog'
    driver.wait("""return document.querySelector('#repository-history-dialog[open] h2')?.textContent.trim()
        === 'Compare repository revisions' && document.activeElement?.matches('input[name=base]')""")
    driver.wait("""return !!document.querySelector('#revision-compare-target-ref option[value="refs/heads/topic"]')""")

    def choose(selector, value):
        driver.script("""
          const field = document.querySelector(arguments[0]);
          field.value = arguments[1]; field.dispatchEvent(new Event('change', { bubbles: true }));
        """, selector, value)

    choose('#revision-compare-base-ref', 'refs/heads/main')
    choose('#revision-compare-target-ref', 'refs/heads/topic')
    choose(dialog + ' select[name=mode]', 'mergeBase')
    driver.click_scrolled_text(dialog + ' button[type=submit]', 'Compare revisions', wait_for_ready=True)
    driver.wait("""return document.querySelector('.comparison-summary')?.textContent.includes('Merge base → target comparison')
        && document.querySelector('.comparison-summary')?.textContent.includes('refs/heads/topic')""")
    driver.wait("""return document.querySelector('.comparison-summary')?.textContent.includes("""
                + json.dumps(common[:8]) + ') && document.querySelector(".comparison-summary")?.textContent.includes('
                + json.dumps(target[:8]) + ')')
    driver.wait("""return [...document.querySelectorAll('.file-name-button')]
        .some(node => node.textContent.includes('topic-only.txt'))""")
    assert not driver.script("""return [...document.querySelectorAll('.file-name-button')]
        .some(node => node.textContent.includes('main-only.txt'));""")
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-revision-picker-compares-merge-base-through-the-command-palette-without-checkout')

    common_args = {'repoId': repo_id, 'target': 'refs/heads/topic', 'mode': 'direct'}
    direct = driver.invoke('compare_history_revisions', **common_args, base='refs/heads/main')
    assert (direct['baseOid'], direct['targetOid']) == (main, target)
    assert {file['path'] for file in direct['files']} == {'main-only.txt', 'topic-only.txt'}
    tagged = driver.invoke('compare_history_revisions', **common_args, base='refs/tags/shared-base')
    assert (tagged['baseOid'], tagged['targetOid']) == (common, target)
    assert [file['path'] for file in tagged['files']] == ['topic-only.txt']
    assert checkout_footprint(fixtures, repository, files) == before
    report['revisionComparison'] = {'base': common, 'main': main, 'target': target}
    report['scenarios'].append('native-direct-revision-comparison-peels-annotated-tags-and-compares-exact-tips')
    return repository, repo_id
