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
    from native_acceptance import open_ui, seed_commit_draft

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
    ready = "return !!document.querySelector('.commit-form button[type=submit]:not(:disabled)')"
    seed_commit_draft(driver, repository, draft)
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
            driver.click_scrolled_text('.graph-action-menu button', 'Delete branch…', wait_for_ready=True)
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
        palette_open = driver.script('return !!document.querySelector("gk-command-palette")')
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

    worktree_opener = '[aria-label="Create worktree"]'
    references_launcher = 'button[aria-label="Open left panel"]'
    driver.click_visible(worktree_opener)
    driver.wait("return document.activeElement?.name === 'worktreeBranch'")
    # Keep the resize inside the native window's minimum; this still hides
    # the sidebar that owns the opener. Do not activate controls via script.
    try:
        driver.request('POST', driver.path('window/rect'), {'width': 900, 'height': 720})
        driver.wait('return !!document.querySelector(' + json.dumps(references_launcher) + ')?.getClientRects().length')
        driver.request('POST', driver.path('execute/async'), {'script': '''
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => setTimeout(() => done(true)));
        ''', 'args': []})
        focus_retained = driver.script("return document.activeElement?.name === 'worktreeBranch'")
        assert focus_retained, 'Resizing moved focus outside the worktree form'
        driver.key('\ue00c')
        driver.wait("return !document.querySelector('.worktree-dialog')")
        driver.wait('return document.activeElement === document.querySelector(' + json.dumps(references_launcher) + ')')
        resized = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
        assert resized == before, 'Resizing and dismissing worktree setup changed the checkout'
        assert driver.script('return document.querySelector(\'[aria-label="Commit summary"]\').value') == draft
        assert not marker.exists()
        report['setupKeyboardIsolation']['resizedWorktree'] = {
            'innerWidth': driver.script('return window.innerWidth'),
            'focusRetained': focus_retained, 'returnedToReferencesLauncher': True, 'checkout': resized,
        }
        report['scenarios'].append('native-worktree-setup-resize-preserves-focus-and-returns-to-references-launcher')
    finally:
        driver.request('POST', driver.path('window/rect'), {'width': 1440, 'height': 900})
    driver.wait('return !!document.querySelector(' + json.dumps(worktree_opener) + ')?.getClientRects().length')

    # The scoped review must still support an explicit valid native action;
    # simply refusing every confirmation would not satisfy the requirement.
    heads_before = fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').splitlines()
    driver.context_click('[aria-label="Local branch owned-keyboard-branch"]')
    driver.click_scrolled_text('.graph-action-menu button', 'Delete branch…', wait_for_ready=True)
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
    seed_commit_draft(driver, repository, draft)
    driver.wait(ready)
    rename_before = checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt'))
    _chord(driver, 'p')
    driver.wait("return !!document.querySelector('gk-command-palette input')")
    driver.script('''const field = document.querySelector('gk-command-palette input');
      field.value = 'Rename owned-palette-rename'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    driver.click_visible('gk-command-palette [role=option] strong', 'Rename owned-palette-rename')
    modal = 'form[aria-label="Rename branch owned-palette-rename"]'
    driver.wait('return !!document.querySelector(' + json.dumps(modal) + ')')
    assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', modal)
    driver.wait("return document.activeElement?.name === 'branchRenameName'")
    driver.script('''const field = document.querySelector('[name=branchRenameName]');
      field.value = 'owned-palette-renamed'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    # Passive event evidence distinguishes a dropped modifier/focus move from
    # browser-default submission. Never replay a chord after a failed assertion.
    driver.script('''window.__ownedRenameKeyEvents = [];
      window.__ownedRenameKeyObserver = event => {
        if (window.__ownedRenameKeyEvents.length >= 80) return;
        const target = event.target;
        const item = { type: event.type, key: event.key || null,
          ctrl: !!event.ctrlKey, shift: !!event.shiftKey, meta: !!event.metaKey,
          alt: !!event.altKey, name: target?.name || null, id: target?.id || null,
          tag: target?.tagName || null, event };
        window.__ownedRenameKeyEvents.push(item);
      };
      for (const type of ['keydown', 'keyup', 'focusin', 'submit'])
        document.addEventListener(type, window.__ownedRenameKeyObserver, true);''')
    rename_chords = []
    report['setupKeyboardIsolation']['paletteRenameShortcuts'] = rename_chords
    try:
        for label, key, shift in (('Control+Enter', '\ue007', False),
                                  ('Control+Shift+Enter', '\ue007', True),
                                  ('Control+p', 'p', False)):
            _chord(driver, key, shift=shift)
            driver.request('POST', driver.path('execute/async'), {'script': '''
              const done = arguments[arguments.length - 1];
              requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
            ''', 'args': []})
            observation = driver.script('''return {
              modalOpen: !!document.querySelector(arguments[0]),
              paletteOpen: !!document.querySelector('gk-command-palette'),
              activeName: document.activeElement?.name || null,
              events: window.__ownedRenameKeyEvents.splice(0).map(({ event, ...item }) =>
                ({ ...item, defaultPrevented: event.defaultPrevented })),
            }''', modal)
            observation.update({'chord': label,
                'checkout': checkout_footprint(fixtures, repository, ('fixture.txt', 'unstaged-note.txt')),
                'commitAttempted': marker.exists()})
            rename_chords.append(observation)
            assert observation['modalOpen'], label + ' submitted or dismissed the rename review'
            assert not observation['paletteOpen'], label + ' opened a background palette'
            assert observation['checkout'] == rename_before, label + ' changed owned Git data'
            assert not observation['commitAttempted'], label + ' attempted a native commit'
            if key == '\ue007':
                enter_events = [event for event in observation['events']
                                if event['type'] == 'keydown' and event['key'] == 'Enter']
                assert enter_events, label + ' did not deliver an observed Enter keydown'
                assert all(event['defaultPrevented'] for event in enter_events), \
                    label + ' left browser-default form submission enabled'
    finally:
        driver.script('''for (const type of ['keydown', 'keyup', 'focusin', 'submit'])
          document.removeEventListener(type, window.__ownedRenameKeyObserver, true);
          delete window.__ownedRenameKeyObserver; delete window.__ownedRenameKeyEvents;''')
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

    from native_deferred_review_scenarios import deferred_review_workflows
    deferred_review_workflows(driver, fixtures, report)

    from native_context_branch_scenarios import context_branch_workflow
    context_branch_workflow(driver, fixtures, report)

    from native_unstaged_summary_scenarios import unstaged_summary_workflow
    unstaged_summary_workflow(driver, fixtures, report)

    from native_application_updates_scenarios import application_updates_workflow
    application_updates_workflow(driver, fixtures, report)

    from native_workspace_edit_scenarios import workspace_edit_workflow
    workspace_edit_workflow(driver, fixtures, report)
