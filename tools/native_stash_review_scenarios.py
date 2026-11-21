"""Packaged stash review workflows with independent owned-file and Git oracles."""
import hashlib
import json

from native_setup_keyboard_scenarios import _chord
from native_worktree_scenarios import checkout_footprint


def stash_selection_scope(driver, fixtures, report):
    """The scoped stash must match the eligible paths visible at confirmation."""
    from native_acceptance import open_ui

    repository = fixtures.repository('stash-selection-scope', commits=2)
    staged_file = repository / 'fixture.txt'
    dirty_file = repository / 'dirty.txt'
    untracked_file = repository / 'new note.txt'
    original = staged_file.read_bytes()
    dirty_file.write_bytes(b'Committed neighbour\n')
    fixtures.git(repository, 'add', '--', dirty_file.name)
    fixtures.git(repository, 'commit', '-qm', 'Record neighbour')
    staged = b'Only this staged change should be saved\n'
    staged_file.write_bytes(staged)
    fixtures.git(repository, 'add', '--', staged_file.name)
    dirty_file.write_bytes(b'Preserve the unstaged neighbour\n')
    untracked_file.write_bytes(b'Preserve the untracked neighbour\n')
    repo_id = open_ui(driver, repository)
    files = (staged_file.name, dirty_file.name, untracked_file.name)
    before = checkout_footprint(fixtures, repository, files)
    before_index = fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z')
    evidence = report['stashSelectionScope'] = {}
    try:
        driver.invoke('stash_selected', repoId=repo_id, options={
            'mode': 'staged-only', 'includeUntracked': False,
            'paths': [staged_file.name, dirty_file.name], 'message': 'Refuse mixed scope',
        })
    except RuntimeError as error:
        detail = json.loads(str(error))
        assert detail['kind'] == 'staleStashSelection' and dirty_file.name in detail['message'], detail
        evidence['nativeRefusal'] = detail['kind']
    else:
        evidence['unexpectedStash'] = fixtures.git(repository, 'stash', 'list', '--format=%H')
        raise AssertionError('A request with an ineligible path was partially applied')
    after = checkout_footprint(fixtures, repository, files)
    assert {key: value for key, value in before.items() if key != 'indexSha256'} == {
        key: value for key, value in after.items() if key != 'indexSha256'}
    assert fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z') == before_index
    assert not fixtures.git(repository, 'stash', 'list')
    report['scenarios'].append('native-stash-refuses-mixed-mode-selection-without-changing-index-stash-or-files')

    driver.click_visible('[aria-label="Stash options"]')
    driver.click_visible('#stash-options-menu button[role=menuitem]',
                         'Stash with options…Choose which changes and files to save')
    modal = 'gc-stash-options-dialog [role=dialog]'
    driver.click_scrolled_text(modal + ' summary', 'Choose specific files', wait_for_ready=True)
    driver.click_scrolled_text(modal + ' label.check', 'Save only selected files', wait_for_ready=True)
    driver.click_scrolled_text(modal + ' button', 'Select all eligible files', wait_for_ready=True)
    driver.wait(f"return document.querySelector({json.dumps(modal)})?.textContent.includes('3 of 3 eligible files selected')")
    driver.script("""const input = document.querySelector(arguments[0]);
      if (!input || input.disabled) throw Error('Stash mode input unavailable');
      input.value = 'staged-only'; input.dispatchEvent(new Event('change', { bubbles: true }));
    """, modal + ' select[name=stashMode]')
    driver.wait(f"return document.querySelector({json.dumps(modal)})?.textContent.includes('1 of 1 eligible files selected')")
    driver.click_visible(modal + ' footer .primary', 'Create stash')
    driver.wait(f"return !document.querySelector({json.dumps(modal)})")
    stashes = fixtures.git(repository, 'stash', 'list', '--format=%H').splitlines()
    assert len(stashes) == 1 and fixtures.git(repository, 'show', stashes[0] + ':fixture.txt') == staged.decode().strip()
    assert fixtures.git(repository, 'diff', '--name-only', stashes[0] + '^1', stashes[0]) == staged_file.name
    assert staged_file.read_bytes() == original
    assert dirty_file.read_bytes() == b'Preserve the unstaged neighbour\n'
    assert untracked_file.read_bytes() == b'Preserve the untracked neighbour\n'
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == before['head']
    assert not fixtures.git(repository, 'diff', '--cached', '--name-only')
    evidence['savedPaths'] = [staged_file.name]
    report['scenarios'].append('native-stash-mode-change-saves-only-currently-eligible-selected-paths')
    return repository, repo_id


def stash_review_workflows(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('stash-review-workflows', commits=2)
    file = repository / 'fixture.txt'
    note = repository / 'untracked-note.txt'
    original = file.read_bytes()
    staged = b'Owned staged stash contents.\n'
    working = b'Owned staged and unstaged stash contents.\n'
    untracked = b'Owned untracked stash contents.\n'
    file.write_bytes(staged)
    fixtures.git(repository, 'add', 'fixture.txt')
    index_tree = fixtures.git(repository, 'write-tree')
    file.write_bytes(working)
    note.write_bytes(untracked)
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    config = (repository / '.git/config').read_bytes()
    marker = repository / '.git/stash-review-commit-attempted'
    hook = repository / '.git/hooks/pre-commit'
    hook.write_text('#!/bin/sh\nprintf attempted > "$(git rev-parse --git-path stash-review-commit-attempted)"\nexit 1\n')
    hook.chmod(0o700)
    modal = 'gc-stash-options-dialog [role=dialog]'
    draft = 'Stash reviews must not commit this draft'
    evidence = []

    def boot():
        open_ui(driver, repository)
        driver.wait("return !!document.querySelector('#commit-summary')")
        driver.script('''const field = document.querySelector('#commit-summary');
          field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', draft)

    def ready():
        driver.wait('return !!document.querySelector(' + json.dumps(modal) + ')')
        assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', modal)

    def confirm(label):
        driver.click_visible(modal + ' footer .primary', label)
        driver.wait('return !document.querySelector(' + json.dumps(modal) + ')')

    def safe(action, branch):
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == head
        assert fixtures.git(repository, 'branch', '--show-current') == branch
        assert (repository / '.git/config').read_bytes() == config
        assert not marker.exists(), 'Stash dialog attempted a normal commit'
        evidence.append({'action': action, 'head': head, 'branch': branch,
                         'indexTree': fixtures.git(repository, 'write-tree'),
                         'stashOids': fixtures.git(repository, 'stash', 'list', '--format=%H').splitlines(),
                         'commitAttempted': marker.exists()})
        report['scenarios'].append('native-reviewed-stash-' + action + '-retains-exact-saved-state-and-source')

    def reset_owned_fixture():
        # A test-only reset between independent restoration cases, never a UI retry.
        assert repository.resolve().is_relative_to(fixtures.root.resolve())
        fixtures.git(repository, 'reset', '--hard', 'HEAD')
        if note.exists():
            assert note.read_bytes() == untracked
            note.unlink()

    boot()
    before = checkout_footprint(fixtures, repository, ('fixture.txt', 'untracked-note.txt'))
    driver.click_visible('[aria-label="Stash options"]')
    driver.script("""window.__ownedStashToolbarClicks = [];
      document.querySelector('#stash-options-menu').addEventListener('click', event => {
        window.__ownedStashToolbarClicks.push({ trusted: event.isTrusted, target: event.target.tagName });
      }, { capture: true });""")
    driver.click_visible('#stash-options-menu button[role=menuitem]', 'Stash with options…Choose which changes and files to save')
    report['stashToolbarClick'] = driver.script('return window.__ownedStashToolbarClicks')
    ready()
    driver.click_visible(modal + ' input[name=stashMessage]')
    driver.script('''const field = document.querySelector('[name=stashMessage]');
      field.value = 'Owned reviewed save'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    _chord(driver, '\ue007')
    _chord(driver, '\ue007', shift=True)
    _chord(driver, 'p')
    driver.request('POST', driver.path('execute/async'), {'script': '''
      const done = arguments[arguments.length - 1];
      requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
    ''', 'args': []})
    assert driver.script('return !!document.querySelector(arguments[0])', modal)
    assert not driver.script('return !!document.querySelector("gc-command-palette")')
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'untracked-note.txt')) == before
    confirm('Create stash')
    stash = fixtures.git(repository, 'rev-parse', 'refs/stash')
    assert fixtures.git(repository, 'rev-parse', stash + '^1') == head
    assert fixtures.git(repository, 'show', stash + '^2:fixture.txt') == staged.decode().strip()
    assert fixtures.git(repository, 'show', stash + ':fixture.txt') == working.decode().strip()
    assert fixtures.git(repository, 'show', stash + '^3:untracked-note.txt') == untracked.decode().strip()
    assert fixtures.git(repository, 'status', '--porcelain=v1') == ''
    assert file.read_bytes() == original and not note.exists()
    safe('save', 'main')

    driver.context_click('.commit-row.stash-row')
    driver.click_scrolled_text('.stash-context-menu button', 'Apply with staged-state options…', wait_for_ready=True)
    ready()
    confirm('Apply and keep stash')
    assert fixtures.git(repository, 'write-tree') == index_tree
    assert file.read_bytes() == working and note.read_bytes() == untracked
    assert fixtures.git(repository, 'rev-parse', 'refs/stash') == stash
    driver.click_visible('.wip-nav')
    driver.wait("return !!document.querySelector('#commit-summary')")
    assert driver.script('return document.querySelector(\'#commit-summary\').value') == draft
    safe('apply-index', 'main')

    reset_owned_fixture()
    boot()
    driver.click_visible('.commit-row.stash-row')
    driver.click_visible('.commit-panel .commit-file-list [aria-label="Open diff for fixture.txt"]')
    driver.click_scrolled_text('.commit-panel button', 'Apply selected stashed file…', wait_for_ready=True)
    ready()
    index_before_file = hashlib.sha256((repository / '.git/index').read_bytes()).hexdigest()
    confirm('Apply file and keep stash')
    assert file.read_bytes() == working and not note.exists()
    assert hashlib.sha256((repository / '.git/index').read_bytes()).hexdigest() == index_before_file
    assert fixtures.git(repository, 'rev-parse', 'refs/stash') == stash
    safe('apply-file', 'main')

    reset_owned_fixture()
    boot()
    driver.context_click('.commit-row.stash-row')
    driver.click_scrolled_text('.stash-context-menu button', 'Create branch from stash…', wait_for_ready=True)
    ready()
    driver.script('''const field = document.querySelector('[name=stashBranchName]');
      field.value = 'owned-stash-recovery'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    confirm('Create branch and restore')
    assert fixtures.git(repository, 'write-tree') == index_tree
    assert file.read_bytes() == working and note.read_bytes() == untracked
    assert fixtures.git(repository, 'rev-parse', 'refs/stash') == stash
    safe('branch', 'owned-stash-recovery')

    driver.context_click('[aria-label="Local branch main"]')
    driver.click_scrolled_text('.graph-action-menu button', 'Stash changes and checkout…', wait_for_ready=True)
    ready()
    confirm('Stash and checkout')
    assert fixtures.git(repository, 'status', '--porcelain=v1') == ''
    assert file.read_bytes() == original and not note.exists()
    stashes = fixtures.git(repository, 'stash', 'list', '--format=%H').splitlines()
    assert len(stashes) == 2 and stashes[1] == stash
    assert fixtures.git(repository, 'show', stashes[0] + '^2:fixture.txt') == staged.decode().strip()
    assert fixtures.git(repository, 'show', stashes[0] + ':fixture.txt') == working.decode().strip()
    assert fixtures.git(repository, 'show', stashes[0] + '^3:untracked-note.txt') == untracked.decode().strip()
    safe('switch', 'main')
    report['stashReviewWorkflows'] = {'source': str(repository), 'networkRemoteUsed': False,
        'originalHead': head, 'originalIndexTree': index_tree, 'reviewedStash': stash, 'actions': evidence}

    inline = fixtures.repository('inline-stash-keyboard', commits=2)
    inline_file = inline / 'fixture.txt'
    inline_note = inline / 'untracked-note.txt'
    inline_base = inline_file.read_bytes()
    inline_staged = b'Owned inline staged contents.\n'
    inline_working = b'Owned inline staged and unstaged contents.\n'
    inline_untracked = b'Owned inline untracked contents.\n'
    inline_file.write_bytes(inline_staged)
    fixtures.git(inline, 'add', 'fixture.txt')
    inline_index_tree = fixtures.git(inline, 'write-tree')
    inline_file.write_bytes(inline_working)
    inline_note.write_bytes(inline_untracked)
    working_oid = fixtures.git(inline, 'hash-object', '--stdin', input=inline_working)
    untracked_oid = fixtures.git(inline, 'hash-object', '--stdin', input=inline_untracked)
    inline_marker = inline / '.git/inline-stash-commit-attempted'
    inline_hook = inline / '.git/hooks/pre-commit'
    inline_hook.write_text('#!/bin/sh\nprintf attempted > "$(git rev-parse --git-path inline-stash-commit-attempted)"\nexit 1\n')
    inline_hook.chmod(0o700)
    open_ui(driver, inline)
    driver.wait("return !!document.querySelector('#commit-summary')")
    driver.script('''const field = document.querySelector('#commit-summary');
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', draft)
    driver.click_visible('input[aria-label="Stash message"]')
    inline_message = 'Owned inline keyboard save'
    driver.script('''const field = document.querySelector('input[aria-label="Stash message"]');
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', inline_message)
    inline_before = checkout_footprint(fixtures, inline, ('fixture.txt', 'untracked-note.txt'))
    _chord(driver, '\ue007')
    _chord(driver, '\ue007', shift=True)
    driver.request('POST', driver.path('execute/async'), {'script': '''
      const done = arguments[arguments.length - 1];
      requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
    ''', 'args': []})
    assert checkout_footprint(fixtures, inline, ('fixture.txt', 'untracked-note.txt')) == inline_before
    assert not inline_marker.exists()
    assert driver.script("return document.querySelector('#commit-summary').value") == draft
    report['scenarios'].append('native-inline-stash-modifier-enter-preserves-dirty-state-and-commit-draft')

    # The same focused control must retain its explicit plain-Enter action.
    driver.key('\ue007')
    driver.wait('return document.querySelector(".activity-status")?.textContent.includes(' + json.dumps('Stash “' + inline_message + '” created') + ')')
    inline_stash = fixtures.git(inline, 'rev-parse', 'refs/stash')
    assert fixtures.git(inline, 'rev-parse', inline_stash + '^1') == inline_before['head']
    assert fixtures.git(inline, 'rev-parse', inline_stash + '^2^{tree}') == inline_index_tree
    assert fixtures.git(inline, 'rev-parse', inline_stash + ':fixture.txt') == working_oid
    assert fixtures.git(inline, 'rev-parse', inline_stash + '^3:untracked-note.txt') == untracked_oid
    assert inline_message in fixtures.git(inline, 'log', '-1', '--format=%s', 'refs/stash')
    assert fixtures.git(inline, 'rev-parse', 'HEAD') == inline_before['head']
    assert fixtures.git(inline, 'branch', '--show-current') == inline_before['branch']
    assert fixtures.git(inline, 'status', '--porcelain=v1') == ''
    assert hashlib.sha256((inline / '.git/config').read_bytes()).hexdigest() == inline_before['configSha256']
    assert inline_file.read_bytes() == inline_base and not inline_note.exists()
    assert not inline_marker.exists()
    assert driver.script("return document.querySelector('#commit-summary').value") == draft
    report['scenarios'].append('native-inline-stash-plain-enter-saves-exact-index-working-and-untracked-objects-once')
    report['inlineStashKeyboard'] = {'source': str(inline), 'before': inline_before,
        'savedStash': inline_stash, 'savedIndexTree': inline_index_tree,
        'savedWorkingBlob': working_oid, 'savedUntrackedBlob': untracked_oid,
        'commitAttempted': inline_marker.exists()}
