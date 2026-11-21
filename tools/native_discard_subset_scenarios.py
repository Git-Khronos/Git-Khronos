"""Review and recover an explicitly selected root-file discard in the packaged app."""
import re

from native_worktree_scenarios import checkout_footprint


def discard_root_subset(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-discard-subset', commits=2)
    root = repository / 'fixture.txt'
    nested = repository / 'nested' / 'tracked.txt'
    kept = repository / 'kept root.txt'
    nested.parent.mkdir()
    nested.write_bytes(b'Committed nested fixture\n')
    fixtures.git(repository, 'add', '--', 'nested/tracked.txt')
    fixtures.git(repository, 'commit', '-qm', 'Add nested fixture')
    staged = b'Independently staged lines\n'
    root.write_bytes(staged)
    fixtures.git(repository, 'add', '--', root.name)
    working = b'Selected working root edit\n'
    root.write_bytes(working)
    nested.write_bytes(b'Preserve this blocked nested edit\n')
    kept.write_bytes(b'Preserve this unselected root file\n')
    files = (root.name, 'nested/tracked.txt', kept.name)
    before = checkout_footprint(fixtures, repository, files)
    index_entries = lambda: {
        flag: fixtures.git(repository, '--no-optional-locks', 'ls-files', flag, '-z')
        for flag in ('--stage', '-v', '-f')
    }
    index_debug = lambda: fixtures.git(repository, '--no-optional-locks', 'ls-files', '--debug')
    before_entries = index_entries()
    before_index_debug = index_debug()
    entry_flags = r'\bflags: [0-9a-f]+'
    before_flags = re.findall(entry_flags, before_index_debug)
    assert len(before_flags) == 2, before_index_debug
    evidence = report['discardRootSubset'] = {'before': before, 'originalIndexEntries': before_entries}

    def assert_index_preserved(phase, footprint):
        entries = evidence[phase + 'IndexEntries'] = index_entries()
        debug = index_debug()
        assert entries == before_entries, (before_entries, entries)
        assert re.findall(entry_flags, debug) == before_flags, debug
        if footprint['indexSha256'] != before['indexSha256']:
            evidence['indexDebugBefore'] = before_index_debug
            evidence[phase + 'IndexDebug'] = debug

    def assert_unmodified(phase):
        footprint = evidence[phase + 'Footprint'] = checkout_footprint(fixtures, repository, files)
        differences = {key: (before[key], footprint[key]) for key in before
                       if key != 'indexSha256' and before[key] != footprint[key]}
        assert not differences, differences
        assert_index_preserved(phase, footprint)
    repository_id = open_ui(driver, repository)
    driver.click_visible('.wip-nav')
    driver.wait("""return ['fixture.txt', 'nested/tracked.txt', 'kept root.txt'].every(path =>
      [...document.querySelectorAll('[aria-label^="Stage "]')].some(node =>
        node.getAttribute('aria-label') === 'Stage ' + path))""")
    driver.click_visible('[aria-label="Working directory options"]')
    driver.click_scrolled_text('[aria-label="Working directory options"] [role="menuitem"] strong',
                               'Discard all unstaged…', wait_for_ready=True)
    dialog = '[role="alertdialog"]'
    chooser = dialog + ' .blocked-discard-choice'
    select_root = chooser + ' input[aria-label="Select fixture.txt for fresh discard review"]'
    confirm = dialog + ' .confirm-action'
    driver.wait("""const dialog = document.querySelector('[role="alertdialog"]');
      return !!dialog?.textContent.includes('nested/tracked.txt')
        && dialog.querySelector('.confirm-action')?.disabled === true""")
    assert_unmodified('originalReview')

    def choose():
        driver.click_scrolled_text(dialog + ' button', 'Choose root files…', wait_for_ready=True)
        driver.wait(f"return document.activeElement?.matches({select_root!r}) && !document.activeElement.checked")
        driver.click_scrolled_text(chooser + ' label', 'fixture.txt', wait_for_ready=True)
        driver.wait(f"return document.querySelector({select_root!r})?.checked === true")

    choose()
    driver.click_scrolled_text(dialog + ' button', 'Back to blocked review', wait_for_ready=True)
    driver.wait("return document.activeElement?.matches('[data-choose-root-files]:not(:disabled)')")
    assert_unmodified('returnedReview')
    assert not driver.invoke('load_discard_recoveries', repoId=repository_id)
    report['scenarios'].append('native-ui-blocked-discard-returns-to-read-only-review-and-clears-selection')

    choose()
    driver.click_scrolled_text(dialog + ' button', 'Preview selected files', wait_for_ready=True)
    driver.wait(f"""const dialog = document.querySelector({dialog!r});
      return !!dialog && dialog.querySelector('.confirm-action:not(:disabled)')?.textContent.trim() === 'Discard captured changes'
        && [...dialog.querySelectorAll('.discard-preview-paths li')].map(row => row.textContent).join(',') === 'fixture.txt'""")
    assert_unmodified('selectedReview')
    driver.click_scrolled_text(confirm, 'Discard captured changes', wait_for_ready=True)
    undo = '.toolbar .tool-button[title^="Undo Discard Unstaged Changes ("]:not(:disabled)'
    driver.wait(f"return !document.querySelector({dialog!r}) && !!document.querySelector({undo!r})")
    assert root.read_bytes() == staged, 'The selected file must return to its index version, not HEAD'
    after = evidence['afterDiscard'] = checkout_footprint(fixtures, repository, files)
    stable = ('head', 'branch', 'references', 'configSha256')
    assert {key: after[key] for key in stable} == {key: before[key] for key in stable}
    assert 'MM fixture.txt' in before['status'].splitlines(), before['status']
    assert after['status'].splitlines() == [
        'M  fixture.txt' if line == 'MM fixture.txt' else line for line in before['status'].splitlines()
    ], after['status']
    assert_index_preserved('discarded', after)
    assert {name: after['files'][name] for name in files[1:]} == {name: before['files'][name] for name in files[1:]}
    captures = driver.invoke('load_discard_recoveries', repoId=repository_id)
    assert len(captures) == 1 and captures[0]['paths'] == [root.name] and captures[0]['contentSha256'], captures
    driver.click_visible(undo)
    driver.wait("""return !!document.querySelector('.toolbar .tool-button[title^="Redo Discard Unstaged Changes ("]:not(:disabled)')""")
    assert_unmodified('restored')
    evidence.update(capturePaths=captures[0]['paths'], stagedIndexPreserved=True,
                    unselectedFilesPreserved=True, undoRestoredGitState=True)
    report['scenarios'].append('native-ui-blocked-discard-confirms-only-reviewed-root-and-undo-restores-exact-state')
    return repository, repository_id
