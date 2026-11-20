"""Setup dialogs must not turn keyboard input into background Git operations."""
import json

from native_worktree_scenarios import checkout_footprint


def _chord(driver, key, shift=False):
    actions = [{'type': 'keyDown', 'value': '\ue009'}]
    if shift:
        actions.append({'type': 'keyDown', 'value': '\ue008'})
    actions.extend([{'type': 'keyDown', 'value': key}, {'type': 'keyUp', 'value': key}])
    if shift:
        actions.append({'type': 'keyUp', 'value': '\ue008'})
    actions.append({'type': 'keyUp', 'value': '\ue009'})
    # A key chord can mutate Git on a regressed build. Send it once, no replay.
    driver.request('POST', driver.path('actions'), {'actions': [
        {'type': 'key', 'id': 'native-keyboard', 'actions': actions},
    ]})


def setup_keyboard_isolation(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('setup-keyboard-isolation', commits=2)
    (repository / 'fixture.txt').write_text('Reviewed staged contents.\n')
    fixtures.git(repository, 'add', 'fixture.txt')
    (repository / 'unstaged-note.txt').write_text('Must not be staged by a modal shortcut.\n')
    marker = repository / '.git/setup-shortcut-hook-ran'
    hook = repository / '.git/hooks/pre-commit'
    hook.write_text('#!/bin/sh\nprintf attempted > "$(git rev-parse --git-path setup-shortcut-hook-ran)"\nexit 1\n')
    hook.chmod(0o700)
    fixtures.git(repository, 'branch', 'owned-keyboard-branch')
    repo_id = open_ui(driver, repository)
    draft = 'Setup dialogs must not commit this draft'
    driver.script('''const field = document.querySelector('[aria-label="Commit summary"]');
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', draft)
    ready = "return !!document.querySelector('.commit-form button[type=submit]:not(:disabled)')"
    driver.wait(ready)
    before = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
    observed = {}
    report['setupKeyboardIsolation'] = {'before': before, 'after': observed}
    for kind, opener, modal, field in (
        ('worktree', '[aria-label="Create worktree"]', '.worktree-dialog', 'worktreeBranch'),
        ('submodule', '[aria-label="Add submodule"]', '.submodule-dialog', 'submoduleUrl'),
        ('remote', '[aria-label="Add remote"]', '.remote-dialog', 'remoteName'),
        ('branch-delete', '[aria-label="Local branch owned-keyboard-branch"]',
         '[aria-labelledby="branch-confirmation-title"]', None),
    ):
        if field is None:
            driver.context_click(opener)
            driver.click_scrolled_text('.graph-action-menu button', 'Delete branch…')
        else:
            driver.click_visible(opener)
        driver.wait('return !!document.querySelector(' + json.dumps(modal) + ')')
        if field is None:
            driver.script('document.querySelector(arguments[0]).focus()', modal + ' [data-branch-dialog-cancel]')
        else:
            driver.click_visible(modal + ' input[name="' + field + '"]')
        _chord(driver, '\ue007')
        _chord(driver, '\ue007', shift=True)
        _chord(driver, 'p')
        # Observe a completed rendering turn before the underlying readiness
        # predicate. This is read-only and does not substitute a mutation retry.
        driver.request('POST', driver.path('execute/async'), {'script': '''
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
        ''', 'args': []})
        driver.wait(ready)
        modal_open = driver.script('return !!document.querySelector(arguments[0])', modal)
        palette_open = driver.script('return !!document.querySelector("gc-command-palette")')
        actual_draft = driver.script('return document.querySelector(\'[aria-label="Commit summary"]\').value')
        after = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
        observed[kind] = {'checkout': after, 'commitAttempted': marker.exists(),
                          'modalOpen': modal_open, 'paletteOpen': palette_open,
                          'draftPreserved': actual_draft == draft}
        assert not marker.exists(), 'A setup shortcut attempted a real native commit'
        assert modal_open, 'A modifier submitted or dismissed the setup form'
        assert not palette_open, 'A setup shortcut opened the background palette'
        assert actual_draft == draft
        assert after == before, 'A setup shortcut changed HEAD, references, index, config or working files'
        driver.key('\ue00c')
        driver.wait('return !document.querySelector(' + json.dumps(modal) + ')')
        report['scenarios'].append('native-' + kind + '-setup-shortcuts-preserve-staged-state-and-commit-draft')

    # The scoped review must still support an explicit valid native action;
    # simply refusing every confirmation would not satisfy the requirement.
    heads_before = fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').splitlines()
    driver.context_click('[aria-label="Local branch owned-keyboard-branch"]')
    driver.click_scrolled_text('.graph-action-menu button', 'Delete branch…')
    modal = '[aria-labelledby="branch-confirmation-title"]'
    driver.wait('return !!document.querySelector(' + json.dumps(modal) + ')')
    assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', modal)
    driver.click_visible(modal + ' .confirm-action', 'Delete branch')
    driver.wait('return !document.querySelector(' + json.dumps(modal) + ')')
    heads_after = fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').splitlines()
    assert heads_after == [line for line in heads_before if not line.startswith('refs/heads/owned-keyboard-branch ')]
    after_delete = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
    for key in ('head', 'branch', 'status', 'indexSha256', 'configSha256', 'files'):
        assert after_delete[key] == before[key], 'Explicit branch deletion changed unrelated checkout data: ' + key
    assert not marker.exists()
    assert driver.script('return document.querySelector(\'[aria-label="Commit summary"]\').value') == draft
    recoveries = driver.invoke('load_operation_recoveries', repoId=repo_id)
    assert recoveries, 'Explicit branch deletion did not retain its native recovery receipt'
    report['setupKeyboardIsolation']['explicitBranchDeletion'] = {
        'headsBefore': heads_before, 'headsAfter': heads_after, 'checkout': after_delete,
        'recoveryCount': len(recoveries), 'commitAttempted': marker.exists(),
    }
    report['scenarios'].append('native-ui-confirmed-branch-delete-preserves-staged-state-and-recovery-receipt')

    fixtures.git(repository, 'branch', 'owned-palette-rename')
    open_ui(driver, repository)
    driver.script('''const field = document.querySelector('[aria-label="Commit summary"]');
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', draft)
    driver.wait(ready)
    rename_before = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
    _chord(driver, 'p')
    driver.wait("return !!document.querySelector('gc-command-palette input')")
    driver.script('''const field = document.querySelector('gc-command-palette input');
      field.value = 'Rename owned-palette-rename'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    driver.click_visible('gc-command-palette [role=option] strong', 'Rename owned-palette-rename')
    modal = 'form[aria-label="Rename branch owned-palette-rename"]'
    driver.wait('return !!document.querySelector(' + json.dumps(modal) + ')')
    assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', modal)
    driver.wait("return document.activeElement?.name === 'branchRenameName'")
    driver.script('''const field = document.querySelector('[name=branchRenameName]');
      field.value = 'owned-palette-renamed'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    _chord(driver, '\ue007')
    _chord(driver, '\ue007', shift=True)
    _chord(driver, 'p')
    driver.request('POST', driver.path('execute/async'), {'script': '''
      const done = arguments[arguments.length - 1];
      requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
    ''', 'args': []})
    assert driver.script('return !!document.querySelector(arguments[0])', modal)
    assert not driver.script('return !!document.querySelector("gc-command-palette")')
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt')) == rename_before
    assert not marker.exists()
    driver.click_visible(modal + ' .confirm-action', 'Rename Branch')
    driver.wait('return !document.querySelector(' + json.dumps(modal) + ')')
    driver.wait('return !!document.querySelector(\'[aria-label="Local branch owned-palette-renamed"]\')')
    renamed = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
    expected_refs = rename_before['references'].replace(' refs/heads/owned-palette-rename', ' refs/heads/owned-palette-renamed')
    assert sorted(renamed['references'].splitlines()) == sorted(expected_refs.splitlines())
    for key in ('head', 'branch', 'status', 'indexSha256', 'configSha256', 'files'):
        assert renamed[key] == rename_before[key], 'Palette branch rename changed unrelated data: ' + key
    assert not marker.exists()
    report['scenarios'].append('native-palette-branch-rename-isolates-shortcuts-and-preserves-dirty-state')

    driver.context_click('[aria-label="Local branch owned-palette-renamed"]')
    driver.wait("return !!document.querySelector('#context-rename-name')")
    driver.script('''const field = document.querySelector('#context-rename-name');
      field.value = 'owned-palette-rename'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    driver.click_scrolled_text('.context-branch-form button[type=submit]', 'Rename', wait_for_ready=True)
    driver.wait('return !!document.querySelector(\'[aria-label="Local branch owned-palette-rename"]\')')
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt')) == rename_before
    assert not marker.exists()
    assert driver.script('return document.querySelector(\'[aria-label="Commit summary"]\').value') == draft
    report['scenarios'].append('native-context-branch-rename-roundtrip-preserves-index-config-and-draft')

    from native_stash_review_scenarios import stash_review_workflows
    stash_review_workflows(driver, fixtures, report)
