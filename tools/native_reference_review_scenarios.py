"""Explicit reference actions through the packaged UI; owned local bare remote only."""
import json

from native_setup_keyboard_scenarios import _chord
from native_worktree_scenarios import checkout_footprint


def reference_review_workflows(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('reference-review-workflows', commits=2)
    remote = fixtures.root / 'owned-reference-review-remote.git'
    remote.mkdir()
    fixtures.git(remote, 'init', '--bare')
    fixtures.git(repository, 'remote', 'add', 'origin', str(remote))
    fixtures.git(repository, 'push', 'origin', 'HEAD:refs/heads/owned-reference-topic')
    fixtures.git(repository, 'tag', '-a', 'owned-reference-tag', '-m', 'Owned annotation retained across rename')
    tag_object = fixtures.git(repository, 'rev-parse', 'refs/tags/owned-reference-tag')
    (repository / 'fixture.txt').write_text('Reference reviews must preserve staged contents.\n')
    fixtures.git(repository, 'add', 'fixture.txt')
    (repository / 'untracked-note.txt').write_text('Reference reviews must preserve untracked contents.\n')
    marker = repository / '.git/reference-review-commit-attempted'
    hook = repository / '.git/hooks/pre-commit'
    hook.write_text('#!/bin/sh\nprintf attempted > "$(git rev-parse --git-path reference-review-commit-attempted)"\nexit 1\n')
    hook.chmod(0o700)
    open_ui(driver, repository)
    draft = 'Reference dialogs must not commit this staged draft'
    driver.script('''const field = document.querySelector('[aria-label="Commit summary"]');
      field.value = arguments[0]; field.dispatchEvent(new Event('input', { bubbles: true }));''', draft)
    driver.click_visible('#reference-section-tags .sidebar-heading')
    modal = 'gc-reference-action-dialog [role=alertdialog]'
    before = checkout_footprint(fixtures, repository, ('fixture.txt', 'untracked-note.txt'))
    evidence = []

    def preserved(action):
        after = checkout_footprint(fixtures, repository, ('fixture.txt', 'untracked-note.txt'))
        for key in ('head', 'branch', 'status', 'indexSha256', 'configSha256', 'files'):
            assert after[key] == before[key], 'Reference action changed unrelated data: ' + action + ': ' + key
        assert not marker.exists(), 'Reference dialog attempted a real commit'
        assert driver.script('return document.querySelector(\'[aria-label="Commit summary"]\').value') == draft
        assert fixtures.git(repository, 'remote', 'get-url', '--push', 'origin') == str(remote)
        assert fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads') == heads
        evidence.append({'action': action, 'checkout': after, 'commitAttempted': marker.exists()})
        report['scenarios'].append('native-reviewed-' + action + '-preserves-dirty-checkout-and-writes-only-owned-refs')

    def review(kind, name, action):
        driver.context_click('[aria-label="' + kind + ' ' + name + '"]')
        driver.click_scrolled_text('.graph-action-menu button', action, wait_for_ready=True)
        driver.wait('return !!document.querySelector(' + json.dumps(modal) + ')')
        assert str(repository) in driver.script('return document.querySelector(arguments[0]).textContent', modal)

    def confirm(label):
        driver.click_visible(modal + ' footer button:not(:disabled)', label)
        driver.wait('return !document.querySelector(' + json.dumps(modal) + ')')

    def has_ref(path, ref):
        return ref in fixtures.git(path, 'for-each-ref', '--format=%(refname)').splitlines()

    heads = fixtures.git(repository, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads')
    review('Tag', 'owned-reference-tag', 'Push this tag…')
    confirm('Push tag')
    assert fixtures.git(remote, 'rev-parse', 'refs/tags/owned-reference-tag') == tag_object
    preserved('push-tag')

    review('Tag', 'owned-reference-tag', 'Rename tag…')
    driver.wait("return document.activeElement?.id === 'reference-new-name'")
    driver.script('''const field = document.querySelector('#reference-new-name');
      field.value = 'owned-reference-renamed'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
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
    driver.click_visible(modal + ' input[name=referenceRenameRemote]')
    driver.click_visible(modal + ' button', 'Check remote tag')
    driver.wait('return document.querySelector(' + json.dumps(modal) + ')?.textContent.includes(' + json.dumps('Expected remote object: ' + tag_object) + ')')
    confirm('Rename tag here and on remote')
    for path in (repository, remote):
        assert not has_ref(path, 'refs/tags/owned-reference-tag')
        assert fixtures.git(path, 'rev-parse', 'refs/tags/owned-reference-renamed') == tag_object
    preserved('rename-tag')

    review('Tag', 'owned-reference-renamed', 'Delete tag on remote…')
    driver.click_visible(modal + ' button', 'Check remote tag')
    driver.wait('return document.querySelector(' + json.dumps(modal) + ')?.textContent.includes(' + json.dumps('Expected remote object: ' + tag_object) + ')')
    confirm('Delete remote reference')
    assert not has_ref(remote, 'refs/tags/owned-reference-renamed')
    assert fixtures.git(repository, 'rev-parse', 'refs/tags/owned-reference-renamed') == tag_object
    preserved('delete-remote-tag')

    review('Tag', 'owned-reference-renamed', 'Delete tag locally…')
    confirm('Delete local tag')
    assert not has_ref(repository, 'refs/tags/owned-reference-renamed')
    recovered_objects = fixtures.git(repository, 'for-each-ref', '--format=%(objectname)', 'refs/git-khronos/recovery').splitlines()
    assert tag_object in recovered_objects, 'Local tag deletion must retain the exact annotated object in native recovery refs'
    preserved('delete-tag')

    review('Remote branch', 'origin/owned-reference-topic', 'Rename branch on remote…')
    driver.script('''const field = document.querySelector('#reference-new-name');
      field.value = 'owned-reference-topic-renamed'; field.dispatchEvent(new Event('input', { bubbles: true }));''')
    confirm('Rename remote branch')
    assert not has_ref(remote, 'refs/heads/owned-reference-topic')
    assert fixtures.git(remote, 'rev-parse', 'refs/heads/owned-reference-topic-renamed') == before['head']
    preserved('rename-remote-branch')

    review('Remote branch', 'origin/owned-reference-topic-renamed', 'Delete branch on remote…')
    confirm('Delete remote reference')
    assert not has_ref(remote, 'refs/heads/owned-reference-topic-renamed')
    preserved('delete-remote-branch')
    report['referenceReviewWorkflows'] = {'source': str(repository), 'localBareRemote': str(remote),
        'networkRemoteUsed': False, 'originalTagObject': tag_object, 'before': before, 'actions': evidence}
