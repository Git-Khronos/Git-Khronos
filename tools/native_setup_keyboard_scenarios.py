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
    open_ui(driver, repository)
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
    ):
        driver.click_visible(opener)
        driver.wait('return !!document.querySelector(' + json.dumps(modal) + ')')
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
