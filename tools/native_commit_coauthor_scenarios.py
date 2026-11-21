"""Commit through the installed composer and verify co-author trailers in Git."""

import json

from native_worktree_scenarios import checkout_footprint


def commit_with_coauthors(driver, fixtures, report):
    from native_acceptance import open_ui, seed_commit_draft

    repository = fixtures.repository('commit-with-coauthors', commits=3)
    staged = repository / 'staged-note.txt'
    staged.write_text('Owned staged note.\n')
    fixtures.git(repository, 'add', '--', staged.name)
    working = repository / 'fixture.txt'
    working.write_text('Owned unstaged work.\n')
    files = (staged.name, working.name)
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, files)
    subject = 'Commit two reviewed co-authors'
    seed_commit_draft(driver, repository, subject)
    picker = '.commit-composer .coauthor-picker'
    toggle = '.commit-composer .add-coauthor'
    driver.click_visible(toggle)
    suggestion = picker + ' .coauthor-suggestions button'
    driver.wait('return document.querySelector(' + json.dumps(suggestion) + ')?.textContent.includes("native@example.test")')
    driver.click_visible(suggestion)

    def input_text(selector, value):
        field = driver.wait('const input = document.querySelector(' + json.dumps(selector)
                            + '); return input?.getClientRects().length && !input.disabled ? input : null;')
        identifier = field['element-6066-11e4-a52e-4f735466cecf']
        driver.request('POST', driver.path(f'element/{identifier}/value'), {'text': value, 'value': list(value)})

    input_text(picker + ' input[name="coAuthorName"]', 'Manual Fixture')
    input_text(picker + ' input[name="coAuthorEmail"]', 'manual@example.test')
    driver.click_visible(picker + ' .manual-coauthor button', 'Add co-author')
    driver.wait("""const chips = document.querySelector('.commit-composer .coauthor-chips');
      return chips?.textContent.includes('Native Fixture') && chips.textContent.includes('Manual Fixture');""")
    driver.click_visible(toggle)
    assert checkout_footprint(fixtures, repository, files) == before

    driver.click_visible('.commit-form button[type=submit]')
    driver.wait("""return [...document.querySelectorAll('.commit-row[data-commit-oid]')]
      .some(row => row.textContent.includes('Commit two reviewed co-authors'));""")
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    message = fixtures.git(repository, 'show', '-s', '--format=%B', 'HEAD')
    expected = [
        'Co-authored-by: Native Fixture <native@example.test>',
        'Co-authored-by: Manual Fixture <manual@example.test>',
    ]
    trailers = fixtures.git(repository, 'interpret-trailers', '--parse', input=(message + '\n').encode()).splitlines()
    assert trailers == expected, message
    assert head != before['head'] and fixtures.git(repository, 'rev-parse', 'HEAD^') == before['head']
    assert fixtures.git(repository, 'show', f'HEAD:{staged.name}') == 'Owned staged note.'
    assert fixtures.git(repository, 'show', f'HEAD:{working.name}') == 'fixture 2'
    after = checkout_footprint(fixtures, repository, files)
    assert after['branch'] == before['branch'] == 'main'
    assert after['files'] == before['files'] and after['configSha256'] == before['configSha256']
    assert fixtures.git(repository, 'diff', '--name-only') == working.name
    assert not fixtures.git(repository, 'diff', '--cached', '--name-only')
    report['commitCoauthors'] = {'head': head, 'parent': before['head'], 'trailers': trailers,
                                 'workingFilesPreserved': True}
    report['scenarios'].append('native-commit-coauthors-include-suggested-and-manual-trailers-without-staging-working-edits')
    return repository, repo_id
