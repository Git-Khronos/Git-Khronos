"""Packaged stash review workflows with independent owned-file and Git oracles."""
import hashlib
import json

from native_setup_keyboard_scenarios import _chord
from native_worktree_scenarios import checkout_footprint


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
