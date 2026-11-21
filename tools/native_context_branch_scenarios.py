"""Create-and-switch at a reviewed graph tip; owned dirty Git fixture only."""
import json

from native_worktree_scenarios import checkout_footprint


def context_branch_workflow(driver, fixtures, report):
    from native_acceptance import open_ui, seed_commit_draft
    from native_setup_keyboard_scenarios import _chord

    repository = fixtures.repository('context-branch-review', commits=3)
    fixtures.git(repository, 'branch', 'owned-create-base')
    (repository / 'fixture.txt').write_text('Owned staged context-create data.\n')
    fixtures.git(repository, 'add', 'fixture.txt')
    (repository / 'unstaged-note.txt').write_text('Owned untracked context-create data.\n')
    marker = repository / '.git/context-create-commit-attempted'
    hook = repository / '.git/hooks/pre-commit'
    hook.write_text('#!/bin/sh\nprintf attempted > "$(git rev-parse --git-path context-create-commit-attempted)"\nexit 1\n')
    hook.chmod(0o700)
    target = fixtures.git(repository, 'rev-parse', 'refs/heads/owned-create-base')
    open_ui(driver, repository)
    draft = 'Owned commit draft must survive context branch creation'
    seed_commit_draft(driver, repository, draft)
    driver.wait("return !!document.querySelector('.commit-form button[type=submit]:not(:disabled)')")
    before = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
    driver.context_click('[aria-label="Local branch owned-create-base"]')
    driver.click_scrolled_text('[data-create-context-branch]', 'Create branch here…', wait_for_ready=True)
    form = '.context-create-branch-form'
    driver.wait('return !!document.querySelector(' + json.dumps(form) + ')')
    assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', form)
    driver.wait("return document.activeElement?.id === 'context-branch-name'")
    driver.script('''const field = document.querySelector('#context-branch-name');
      field.value = 'owned-context-created'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    observed = []
    report['contextBranchCreation'] = {'repository': str(repository), 'targetOid': target,
        'before': before, 'shortcuts': observed}
    for label, key, shift in (('Control+Enter', '\ue007', False),
                              ('Control+Shift+Enter', '\ue007', True), ('Control+p', 'p', False)):
        _chord(driver, key, shift=shift)
        driver.request('POST', driver.path('execute/async'), {'script': '''
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
        ''', 'args': []})
        state = {'chord': label, 'checkout': checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt')),
                 'formOpen': driver.script('return !!document.querySelector(arguments[0])', form),
                 'paletteOpen': driver.script('return !!document.querySelector("gc-command-palette")'),
                 'draft': driver.script("return document.querySelector('#commit-summary').value"),
                 'commitAttempted': marker.exists()}
        observed.append(state)
        assert state['formOpen'] and not state['paletteOpen'], label + ' escaped the context creator'
        assert state['checkout'] == before, label + ' changed the owned checkout'
        assert state['draft'] == draft and not state['commitAttempted']
    report['scenarios'].append('native-context-branch-creator-isolates-shortcuts-and-preserves-dirty-data-and-commit-draft')

    driver.click_scrolled_text(form + ' button[type=submit]', 'Create', wait_for_ready=True)
    driver.wait('return !document.querySelector(' + json.dumps(form) + ')')
    after = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
    assert after['head'] == target and after['branch'] == 'owned-context-created'
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/owned-context-created') == target
    assert sorted(after['references'].splitlines()) == sorted(before['references'].splitlines()
        + [target + ' refs/heads/owned-context-created'])
    for key in ('head', 'status', 'indexSha256', 'configSha256', 'files'):
        assert after[key] == before[key], 'Explicit context creation changed unrelated checkout data: ' + key
    assert driver.script("return document.querySelector('#commit-summary').value") == draft
    assert not marker.exists()
    report['contextBranchCreation'].update({'after': after, 'commitAttempted': marker.exists()})
    report['scenarios'].append('native-context-branch-creation-switches-to-exact-reviewed-tip-without-commit-or-dirty-data-loss')
