"""Verify guarded root and nested file discard and recovery in the packaged app."""
import json
import re

from native_worktree_scenarios import checkout_footprint


def discard_root_subset(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-discard-subset', commits=2)
    root = repository / 'fixture.txt'
    nested = repository / 'nested' / 'untracked.txt'
    kept_nested = repository / 'nested' / 'tracked.txt'
    kept = repository / 'kept root.txt'
    nested.parent.mkdir()
    kept_nested.write_bytes(b'Committed nested content\n')
    fixtures.git(repository, 'add', '--', 'nested/tracked.txt')
    fixtures.git(repository, 'commit', '-qm', 'Track nested file')
    kept_nested.write_bytes(b'Preserve this unselected nested tracked edit\n')
    staged = b'Independently staged lines\n'
    root.write_bytes(staged)
    fixtures.git(repository, 'add', '--', root.name)
    working = b'Selected working root edit\n'
    root.write_bytes(working)
    nested.symlink_to('tracked.txt')
    kept.write_bytes(b'Preserve this unselected root file\n')
    files = (root.name, 'nested/untracked.txt', kept.name, 'nested/tracked.txt')
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
    driver.wait("""return ['fixture.txt', 'nested/untracked.txt', 'kept root.txt'].every(path =>
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
      return !!dialog?.textContent.includes('nested/untracked.txt')
        && dialog.querySelector('.confirm-action')?.disabled === true""")
    assert_unmodified('originalReview')

    def choose():
        driver.click_visible(dialog + ' [data-choose-root-files]')
        driver.wait(f"return document.activeElement?.matches({select_root!r}) && !document.activeElement.checked")
        driver.wait("""return !!document.querySelector(
          '.blocked-discard-choice input[aria-label="Select nested/tracked.txt for fresh discard review"]:not(:checked)')""")
        driver.click_scrolled_text(chooser + ' label', 'fixture.txt', wait_for_ready=True)
        driver.wait(f"return document.querySelector({select_root!r})?.checked === true")

    choose()
    driver.click_scrolled_text(dialog + ' button', 'Back to blocked review', wait_for_ready=True)
    driver.wait("return document.activeElement?.matches('[data-choose-root-files]:not(:disabled)')")
    assert_unmodified('returnedReview')
    assert not driver.invoke('load_discard_recoveries', repoId=repository_id)
    report['scenarios'].append('native-ui-blocked-discard-returns-to-read-only-review-and-clears-selection')

    choose()
    search = chooser + ' input[type="search"]'
    driver.wait(f"return !!document.querySelector({search!r})")

    def filter_paths(value):
        driver.script("""const field = document.querySelector(arguments[0]);
          field.value = arguments[1]; field.dispatchEvent(new Event('input', {bubbles: true}));""", search, value)

    driver.click_scrolled_text(chooser + ' button', 'Clear selection', wait_for_ready=True)
    filter_paths('fixture.txt')
    driver.click_scrolled_text(chooser + ' button', 'Select shown files', wait_for_ready=True)
    driver.wait(f"return document.querySelector({select_root!r})?.checked === true")
    filter_paths('KEPT ROOT')
    driver.wait(f"""const chooser = document.querySelector({chooser!r});
      return !document.querySelector({select_root!r})
        && chooser?.querySelector('[role="status"]')?.textContent.includes('1 selected outside the filter.')
        && !!chooser.querySelector('input[aria-label="Select kept root.txt for fresh discard review"]:not(:checked)');""")
    assert_unmodified('filteredSelection')
    driver.click_scrolled_text(dialog + ' button', 'Preview selected files', wait_for_ready=True)
    driver.wait(f"""const dialog = document.querySelector({dialog!r});
      return !!dialog && dialog.querySelector('.confirm-action:not(:disabled)')?.textContent.trim() === 'Discard captured changes'
        && [...dialog.querySelectorAll('.discard-preview-paths li')].map(row => row.textContent).join(',') === 'fixture.txt'""")
    assert_unmodified('selectedReview')
    report['scenarios'].append('native-discard-path-filter-keeps-explicit-selection-without-changing-files')
    driver.wait(f"""return document.querySelector({dialog!r})?.contains(document.activeElement)
      && document.activeElement.textContent.trim() === 'Cancel'""")
    driver.key('\ue004', modifiers=('\ue008',))  # Shift+Tab
    driver.wait(f"return document.activeElement?.matches({confirm!r})", timeout=5)
    driver.key('\ue004')  # Tab
    driver.wait(f"""return document.querySelector({dialog!r})?.contains(document.activeElement)
      && document.activeElement.textContent.trim() === 'Cancel'""")
    assert_unmodified('keyboardReview')
    assert not driver.invoke('load_discard_recoveries', repoId=repository_id)
    report['scenarios'].append('native-discard-review-wraps-shift-tab-without-applying-the-preview')
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

    driver.click_visible('[aria-label="Working directory options"]')
    driver.click_scrolled_text('[aria-label="Working directory options"] [role="menuitem"] strong',
                               'Select files for discard', wait_for_ready=True)
    selected_path = 'nested/tracked.txt'
    selected_checkbox = 'input[aria-label="Select nested/tracked.txt for discard"]'
    selected_button = '.discard-actions button'
    link_before = nested.lstat()
    link_target = nested.readlink()
    selected_review_ready = f"""const review = document.querySelector({dialog!r});
      const rows = review?.querySelectorAll('.discard-preview-paths li');
      return rows?.length === 1 && rows[0].textContent.trim() === {json.dumps(selected_path)}
        && !!review.querySelector('.confirm-action:not(:disabled)')"""
    driver.click_visible(selected_checkbox)
    driver.click_scrolled_text(selected_button, 'Discard selected…', wait_for_ready=True)
    driver.wait(selected_review_ready)
    assert_unmodified('directSelectionReview')
    driver.click_scrolled_text(dialog + ' button', 'Cancel', wait_for_ready=True)
    driver.wait(f"""return !document.querySelector({dialog!r})
      && document.activeElement?.matches({selected_button!r})
      && document.activeElement.textContent.trim() === 'Discard selected…'
      && document.querySelector({selected_checkbox!r})?.checked === true""")
    driver.click_scrolled_text(selected_button, 'Discard selected…', wait_for_ready=True)
    driver.wait(selected_review_ready)
    driver.click_scrolled_text(confirm, 'Discard captured changes', wait_for_ready=True)
    driver.wait(f"""return !document.querySelector({dialog!r}) && !!document.querySelector({undo!r})
      && !document.querySelector({selected_checkbox!r})""")
    after_selected = evidence['afterDirectSelection'] = checkout_footprint(fixtures, repository, files)
    assert kept_nested.read_bytes() == b'Committed nested content\n'
    assert {key: after_selected[key] for key in stable} == {key: before[key] for key in stable}
    assert_index_preserved('directSelectionDiscarded', after_selected)
    assert after_selected['status'].splitlines() == [
        line for line in before['status'].splitlines() if line != ' M nested/tracked.txt'
    ], after_selected['status']
    # The footprint hashes a symlink's target; check the link itself
    # separately because this discard changes its target's contents.
    unchanged_regular_files = (root.name, kept.name)
    assert {name: after_selected['files'][name] for name in unchanged_regular_files} == {
        name: before['files'][name] for name in unchanged_regular_files
    }
    link_after = nested.lstat()
    assert nested.readlink() == link_target
    assert (link_after.st_dev, link_after.st_ino) == (link_before.st_dev, link_before.st_ino)
    direct_captures = driver.invoke('load_discard_recoveries', repoId=repository_id)
    assert sorted(capture['paths'] for capture in direct_captures) == [[root.name], [selected_path]], direct_captures
    driver.click_visible(undo)
    driver.wait("""return !!document.querySelector('.toolbar .tool-button[title^="Redo Discard Unstaged Changes ("]:not(:disabled)')""")
    assert_unmodified('directSelectionRestored')
    report['scenarios'].append('native-ui-direct-selection-discards-only-reviewed-path-and-undo-restores-bytes')

    tracked_repo = fixtures.repository('owned-nested-discard', commits=2)
    tracked_path = 'API/clients/café notes.txt'
    tracked_file = tracked_repo / tracked_path
    lockfile_path = 'API/clients/ng-cti-client/package-lock.json'
    lockfile = tracked_repo / lockfile_path
    lock_bytes = lambda version: json.dumps({'version': version, 'padding': 'x' * 129_950}).encode() + b'\n'
    tracked_file.parent.mkdir(parents=True)
    lockfile.parent.mkdir(parents=True)
    tracked_file.write_bytes(b'committed\n')
    lockfile.write_bytes(lock_bytes('committed'))
    fixtures.git(tracked_repo, 'add', '--', tracked_path, lockfile_path)
    fixtures.git(tracked_repo, 'commit', '-qm', 'Track nested file')
    tracked_file.write_bytes(b'staged\n')
    lockfile.write_bytes(lock_bytes('staged'))
    fixtures.git(tracked_repo, 'add', '--', tracked_path, lockfile_path)
    tracked_file.write_bytes(b'unstaged\n')
    lockfile.write_bytes(lock_bytes('unstaged'))
    index_before = fixtures.git(tracked_repo, '--no-optional-locks', 'ls-files', '--stage', '-z')
    head_before = fixtures.git(tracked_repo, 'rev-parse', 'HEAD')
    tracked_repo_id = open_ui(driver, tracked_repo)
    driver.click_visible('.wip-nav')
    driver.click_visible('[aria-label="Working directory options"]')
    driver.click_scrolled_text('[aria-label="Working directory options"] [role="menuitem"] strong',
                               'Discard all unstaged…', wait_for_ready=True)
    paths = json.dumps(sorted([tracked_path, lockfile_path]))
    driver.wait(f"""return JSON.stringify([...document.querySelectorAll(
      '[role=alertdialog] .discard-preview-paths li')].map(row => row.textContent.trim()).sort()) === JSON.stringify({paths})""")
    assert tracked_file.read_bytes() == b'unstaged\n'
    assert lockfile.read_bytes() == lock_bytes('unstaged')
    driver.click_scrolled_text(confirm, 'Discard captured changes', wait_for_ready=True)
    driver.wait(f"return !!document.querySelector({undo!r})")
    assert tracked_file.read_bytes() == b'staged\n'
    assert lockfile.read_bytes() == lock_bytes('staged')
    assert fixtures.git(tracked_repo, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    driver.click_visible(undo)
    driver.wait("""return !!document.querySelector('.toolbar .tool-button[title^="Redo Discard Unstaged Changes ("]:not(:disabled)')""")
    assert tracked_file.read_bytes() == b'unstaged\n'
    assert lockfile.read_bytes() == lock_bytes('unstaged')
    assert fixtures.git(tracked_repo, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    assert fixtures.git(tracked_repo, 'rev-parse', 'HEAD') == head_before
    report['scenarios'].append('native-ui-nested-tracked-discard-restores-index-and-undo-restores-working-bytes')

    driver.click_visible('[aria-label=' + json.dumps('Discard changes in ' + tracked_path, ensure_ascii=False) + ']')
    driver.wait(f"return !!document.querySelector({confirm!r} + ':not(:disabled)')")
    assert tracked_file.read_bytes() == b'unstaged\n'
    driver.click_scrolled_text(confirm, 'Discard changes', wait_for_ready=True)
    undo_single = '.toolbar .tool-button[title^="Undo Discard Changes ("]:not(:disabled)'
    driver.wait(f"return !document.querySelector({dialog!r}) && !!document.querySelector({undo_single!r})")
    assert tracked_file.read_bytes() == b'staged\n'
    driver.click_visible(undo_single)
    driver.wait("""return !!document.querySelector('.toolbar .tool-button[title^="Redo Discard Changes ("]:not(:disabled)')""")
    assert tracked_file.read_bytes() == b'unstaged\n'
    assert fixtures.git(tracked_repo, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    assert fixtures.git(tracked_repo, 'rev-parse', 'HEAD') == head_before
    report['scenarios'].append('native-ui-single-nested-file-discard-and-undo-preserve-index-and-head')

    driver.click_visible('[aria-label=' + json.dumps('Discard changes in ' + lockfile_path) + ']')
    driver.wait(f"return !!document.querySelector({confirm!r} + ':not(:disabled)')")
    assert lockfile.read_bytes() == lock_bytes('unstaged')
    driver.click_scrolled_text(confirm, 'Discard changes', wait_for_ready=True)
    driver.wait(f"return !document.querySelector({dialog!r}) && !!document.querySelector({undo_single!r})")
    assert lockfile.read_bytes() == lock_bytes('staged')
    assert tracked_file.read_bytes() == b'unstaged\n'
    driver.click_visible(undo_single)
    driver.wait("""return !!document.querySelector('.toolbar .tool-button[title^="Redo Discard Changes ("]:not(:disabled)')""")
    assert lockfile.read_bytes() == lock_bytes('unstaged')
    assert fixtures.git(tracked_repo, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    assert fixtures.git(tracked_repo, 'rev-parse', 'HEAD') == head_before
    report['scenarios'].append('native-ui-nested-lockfile-discard-preserves-index-and-sibling-edit')
    return tracked_repo, tracked_repo_id


def discard_nested_deletion(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-discard-nested-deletion', commits=2)
    path = 'API/clients/package-lock.json'
    file = repository / path
    file.parent.mkdir(parents=True)
    file.write_bytes(b'{"version":"committed"}\n')
    fixtures.git(repository, 'add', '--', path)
    fixtures.git(repository, 'commit', '-qm', 'Track nested lockfile')
    staged = b'{"version":"staged"}\n'
    file.write_bytes(staged)
    fixtures.git(repository, 'add', '--', path)
    file.unlink()
    new_path = 'API/clients/untracked.json'
    new_file = repository / new_path
    content = b'{"generated":true}\n'
    new_file.write_bytes(content)
    index_before = fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z')
    head_before = fixtures.git(repository, 'rev-parse', 'HEAD')
    repo_id = open_ui(driver, repository)
    driver.click_visible('.wip-nav')

    dialog = '[role="alertdialog"]'
    confirm = dialog + ' .confirm-action'
    undo = '.toolbar .tool-button[title^="Undo Discard Changes ("]:not(:disabled)'
    redo = '.toolbar .tool-button[title^="Redo Discard Changes ("]:not(:disabled)'
    driver.click_visible(f'[aria-label="Discard changes in {path}"]')
    driver.wait(f"return !!document.querySelector({confirm!r} + ':not(:disabled)')")
    assert not file.exists()
    driver.click_scrolled_text(confirm, 'Discard changes', wait_for_ready=True)
    driver.wait(f"return !document.querySelector({dialog!r}) && !!document.querySelector({undo!r})")
    assert file.read_bytes() == staged
    driver.click_visible(undo)
    driver.wait(f"return !!document.querySelector({redo!r})")
    assert not file.exists()
    driver.click_visible(redo)
    driver.wait(f"return !!document.querySelector({undo!r})")
    assert file.read_bytes() == staged
    assert fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == head_before
    report['scenarios'].append('native-ui-nested-deletion-discards-undoes-and-redoes-without-changing-index')

    filter_input = 'input[aria-label="Filter changed files"]'
    palette_input = 'gk-command-palette input[aria-label="Search commands"]'
    discard_state = checkout_footprint(fixtures, repository, (path, new_path))
    driver.click_visible(filter_input)
    driver.key('x')
    driver.wait(f"return document.querySelector({filter_input!r})?.value === 'x'")
    driver.key('p', modifiers=('\ue009',))
    driver.wait(f"return document.activeElement?.matches({palette_input!r})")
    driver.script("""const field = document.activeElement;
      field.value = 'discard all unstaged'; field.dispatchEvent(new Event('input', {bubbles: true}));""")
    driver.click_scrolled_text('gk-command-palette [role=option] strong',
                               'Discard All Unstaged Changes…', wait_for_ready=True)
    driver.wait("return [...document.querySelectorAll('[role=alertdialog] .discard-preview-paths li')].some(row => row.textContent.trim() === " + json.dumps(new_path) + ")")
    driver.click_scrolled_text(dialog + ' button', 'Cancel', wait_for_ready=True)
    driver.wait(f"return !document.querySelector({dialog!r}) && document.activeElement?.matches({filter_input!r})")
    assert checkout_footprint(fixtures, repository, (path, new_path)) == discard_state
    driver.key('a', modifiers=('\ue009',))
    driver.key('\ue003')  # Backspace
    driver.wait(f"return document.querySelector({filter_input!r})?.value === ''")
    report['scenarios'].append('native-palette-previews-all-unstaged-and-cancels-without-checkout-changes')

    driver.click_visible('[aria-label="Discard all unstaged changes"]')
    driver.wait("return [...document.querySelectorAll('[role=alertdialog] .discard-preview-paths li')].some(row => row.textContent.trim() === " + json.dumps(new_path) + ")")
    assert new_file.read_bytes() == content
    driver.click_scrolled_text(confirm, 'Discard captured changes', wait_for_ready=True)
    undo_bulk = '.toolbar .tool-button[title^="Undo Discard Unstaged Changes ("]:not(:disabled)'
    redo_bulk = '.toolbar .tool-button[title^="Redo Discard Unstaged Changes ("]:not(:disabled)'
    driver.wait(f"return !!document.querySelector({undo_bulk!r})")
    assert not new_file.exists()
    driver.wait("""return document.querySelector('[aria-label="Discard all unstaged changes"]')?.disabled === true
      && !!document.querySelector('[aria-label="Unstage API/clients/package-lock.json"]')""")
    driver.wait("""return document.activeElement?.matches('.unstaged-section .file-section-toggle')""")
    driver.click_visible(filter_input)
    driver.key('x')
    driver.wait(f"return document.querySelector({filter_input!r})?.value === 'x'")
    # Whether the platform performs text Undo is WebKit's decision. Observe
    # the real keyboard event after the app's handler has finished.
    driver.script("""
      window.addEventListener('keydown', function observeUndo(event) {
        if (!event.ctrlKey || event.key.toLowerCase() !== 'z') return;
        window.removeEventListener('keydown', observeUndo, true);
        setTimeout(() => {
          window.__textUndoObservation = { cancelled: event.defaultPrevented };
        });
      }, true);
    """)
    driver.key('z', modifiers=('\ue009',))
    outcome = driver.wait("return window.__textUndoObservation")
    assert outcome == {'cancelled': False}, 'The app consumed the text Undo shortcut'
    assert driver.script(f"return !!document.querySelector({undo_bulk!r}) && !document.querySelector({redo_bulk!r})")
    assert not new_file.exists(), 'Text Undo must not restore the discarded repository file'
    assert fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == head_before
    report['scenarios'].append('native-text-undo-does-not-restore-discarded-repository-file')
    driver.click_visible(undo_bulk)
    driver.wait(f"return !!document.querySelector({redo_bulk!r})")
    assert new_file.read_bytes() == content
    assert fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == head_before
    report['scenarios'].append('native-ui-trash-discards-nested-untracked-file-and-undo-restores-it')
    return repository, repo_id


def discard_single_stale_review(driver, fixtures, report):
    """An external edit after review opens must not be discarded by that review."""
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-discard-stale-review', commits=2)
    path = 'fixture.txt'
    file = repository / path
    staged = file.read_bytes()
    file.write_bytes(b'reviewed edit\n')
    index_before = fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z')
    head_before = fixtures.git(repository, 'rev-parse', 'HEAD')
    repo_id = open_ui(driver, repository)
    driver.click_visible('.wip-nav')
    discard = f'[aria-label="Discard changes in {path}"]'
    driver.click_visible(discard)
    confirm = '[role="alertdialog"] .confirm-action'
    driver.wait(f"return !!document.querySelector({confirm!r} + ':not(:disabled)')")
    newer = b'edit made after confirmation opened\n'
    file.write_bytes(newer)
    driver.click_scrolled_text(confirm, 'Discard changes', wait_for_ready=True)
    outcome = driver.wait("""return document.querySelector('.error-toast[role="alert"]')
      ?.textContent.includes('Files or the index changed after the discard preview.') ? 'stale'
      : document.querySelector('.toolbar .tool-button[title^="Undo Discard Changes ("]:not(:disabled)')
        ? 'discarded' : null""")
    assert file.read_bytes() == newer, 'the newer edit was discarded without a fresh review'
    assert outcome == 'stale', outcome
    assert fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == head_before
    assert not driver.invoke('load_discard_recoveries', repoId=repo_id)
    report['scenarios'].append('native-ui-single-discard-refuses-newer-working-edit-without-capture')

    driver.click_visible('.error-toast [aria-label="Dismiss error"]')
    driver.click_visible(discard)
    driver.click_scrolled_text(confirm, 'Discard changes', wait_for_ready=True)
    undo = '.toolbar .tool-button[title^="Undo Discard Changes ("]:not(:disabled)'
    redo = '.toolbar .tool-button[title^="Redo Discard Changes ("]:not(:disabled)'
    driver.wait(f"return !!document.querySelector({undo!r})")
    assert file.read_bytes() == staged
    driver.click_visible(undo)
    driver.wait(f"return !!document.querySelector({redo!r})")
    assert file.read_bytes() == newer, 'Undo must restore the edit accepted in the fresh review'
    assert fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z') == index_before
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == head_before
    report['scenarios'].append('native-ui-fresh-single-discard-after-stale-review-can-undo-newer-edit')
    return discard_refused_keyboard_focus(driver, fixtures, report)


def discard_refused_keyboard_focus(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-keyboard-discard-refusal', commits=2)
    tracked = 'nested/tracked.txt'
    path = 'nested/untracked.txt'
    file = repository / path
    file.parent.mkdir()
    (repository / tracked).write_bytes(b'Keep the ordinary tracked directory visible.\n')
    fixtures.git(repository, 'add', '--', tracked)
    fixtures.git(repository, 'commit', '-qm', 'Track a neighboring file')
    file.symlink_to('tracked.txt')
    before = checkout_footprint(fixtures, repository, (tracked, path))
    repo_id = open_ui(driver, repository)
    driver.click_visible('.wip-nav')
    opener = f'[aria-label="View changes in {path}"]'
    driver.wait(f"return !!document.querySelector({opener!r})?.getClientRects().length")
    driver.script("document.querySelector(arguments[0]).focus()", opener)
    driver.request('POST', driver.path('actions'), {'actions': [{
        'type': 'key', 'id': 'native-keyboard', 'actions': [
            {'type': 'keyDown', 'value': '\ue008'},
            {'type': 'keyDown', 'value': '\ue03a'},
            {'type': 'keyUp', 'value': '\ue03a'},
            {'type': 'keyUp', 'value': '\ue008'},
        ],
    }]})
    driver.wait("""return [...document.querySelectorAll('.file-context-menu [role="menuitem"]')]
      .some(element => element.textContent.trim() === 'Discard changes…')""")
    driver.script("""[...document.querySelectorAll('.file-context-menu [role="menuitem"]')]
      .find(element => element.textContent.trim() === 'Discard changes…').focus()""")
    driver.key('\ue007')
    driver.wait("""return document.querySelector('.error-toast[role="alert"]')
      ?.textContent.includes('nested/untracked.txt')""")
    driver.wait(f"return document.activeElement?.matches({opener!r})")
    assert not driver.script("return !!document.querySelector('[role=alertdialog]')")
    after = checkout_footprint(fixtures, repository, (tracked, path))
    assert after == before, (before, after)
    assert not driver.invoke('load_discard_recoveries', repoId=repo_id)
    report['scenarios'].append('native-ui-refused-keyboard-discard-returns-focus-and-keeps-files')
    return repository, repo_id


def discard_large_untracked_batch(driver, fixtures, report):
    """Exercise the actual app with the four CTI file sizes, not the user's data."""
    from hashlib import file_digest
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-large-discard', commits=2)
    sizes = {
        '_data_/mitre-attack/enterprise-attack.json': 55_277_605,
        '_data_/mitre-attack/ics-attack.json': 5_291_092,
        '_data_/mitre-attack/mobile-attack.json': 6_144_331,
        '_data_/kev/known_exploited_vulnerabilities.json': 1_871_127,
    }
    block = b'    1234567890, 1234567890, 1234567890, 1234567890\n' * 1024
    for path, length in sizes.items():
        (repository / path).parent.mkdir(parents=True, exist_ok=True)
        with (repository / path).open('wb') as output:
            blocks, remainder = divmod(length, len(block))
            for _ in range(blocks):
                output.write(block)
            output.write(block[:remainder])

    def digest(path):
        with (repository / path).open('rb') as stream:
            return file_digest(stream, 'sha256').hexdigest()

    staged_path = '_data_/staged-only.json'
    (repository / staged_path).write_bytes(b'{"staged":true}\n')
    fixtures.git(repository, 'add', '--', staged_path)
    staged_digest = digest(staged_path)
    before = {path: digest(path) for path in sizes}
    index = fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z')
    head = fixtures.git(repository, 'rev-parse', 'HEAD')

    def assert_staged_unchanged():
        assert digest(staged_path) == staged_digest
        assert fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z') == index
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == head

    repo_id = open_ui(driver, repository)
    driver.click_visible('.wip-nav')
    discard = '[aria-label="Discard all unstaged changes"]'
    # Observe the real activation without replaying a potentially delivered click.
    driver.script("""
      window.__largeDiscardClick = false;
      document.addEventListener('click', event => {
        if (event.isTrusted && event.target.closest(arguments[0])) window.__largeDiscardClick = true;
      }, { capture: true, once: true });
    """, discard)
    driver.click_scrolled_text(discard, wait_for_ready=True)
    assert driver.script("return window.__largeDiscardClick"), 'the bulk discard button did not receive the trusted click'
    dialog = '[role="alertdialog"]'
    confirm = dialog + ' .confirm-action'
    undo = '.toolbar .tool-button[title^="Undo Discard Unstaged Changes ("]:not(:disabled)'
    expected = json.dumps(sorted(sizes))
    outcome = driver.wait(f"""const error = document.querySelector('.error-toast[role="alert"]')?.textContent.trim();
      if (error) return {{error}};
      return JSON.stringify([...document.querySelectorAll(
      {str(dialog + ' .discard-preview-paths li')!r})].map(row => row.textContent.trim()).sort())
      === JSON.stringify({expected}) ? {{ready: true}} : null""", 120)
    assert outcome == {'ready': True}, f'large discard preview refused: {outcome}'
    assert {path: digest(path) for path in sizes} == before
    driver.click_scrolled_text(confirm, 'Discard captured changes', wait_for_ready=True)
    driver.wait(f"return !!document.querySelector({undo!r})", 120)
    assert all(not (repository / path).exists() for path in sizes)
    assert_staged_unchanged()
    driver.click_visible(undo)
    driver.wait("""return !!document.querySelector('.toolbar .tool-button[title^="Redo Discard Unstaged Changes ("]:not(:disabled)')""", 120)
    assert {path: digest(path) for path in sizes} == before
    assert_staged_unchanged()
    report['largeDiscardBytes'] = sum(sizes.values())
    report['largeDiscardPaths'] = sizes
    report['scenarios'].append('native-ui-discards-and-recovers-four-large-nested-untracked-files')

    redo = '.toolbar .tool-button[title^="Redo Discard Unstaged Changes ("]:not(:disabled)'
    driver.click_visible(redo)
    driver.wait(f"return !!document.querySelector({undo!r})", 120)
    assert all(not (repository / path).exists() for path in sizes)
    assert_staged_unchanged()
    driver.restart_application()
    repo_id = open_ui(driver, repository)
    captures = driver.invoke('load_discard_recoveries', repoId=repo_id)
    assert len(captures) == 1, captures
    capture = captures[0]
    assert sorted(capture['paths']) == sorted(sizes) and not capture['restored'], capture
    assert not capture['pathsError'] and capture['contentSha256'], capture
    driver.invoke('apply_saved_discard', repoId=repo_id, id=capture['id'], reverse=False,
                  expectedSha256=capture['contentSha256'])
    assert {path: digest(path) for path in sizes} == before
    assert_staged_unchanged()
    report['scenarios'].append('native-large-discard-capture-survives-restart-and-recovers-exact-bytes')
    report['scenarios'].append('native-cti-data-paths-and-sizes-recover-unchanged-after-restart')
    report['scenarios'].append('native-cti-sized-bulk-discard-skips-and-preserves-staged-only-file')
    # Reuse the same owned files with a tracked file and untracked siblings.
    # The committed version differs only at byte 0. Tracking the largest
    # fixture instead requires two 55 MB snapshots and exceeds the capture cap.
    tracked = '_data_/mitre-attack/mobile-attack.json'
    with (repository / tracked).open('r+b') as file:
        original_byte = file.read(1)
        file.seek(0)
        file.write(b'#')
    index_digest = digest(tracked)
    fixtures.git(repository, 'add', '--', tracked)
    fixtures.git(repository, 'commit', '-qm', 'Track one fixture', '--only', '--', tracked)
    with (repository / tracked).open('r+b') as file:
        file.write(original_byte)
    index = fixtures.git(repository, '--no-optional-locks', 'ls-files', '--stage', '-z')
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    driver.restart_application()
    repo_id = open_ui(driver, repository)
    driver.click_visible('.wip-nav')
    driver.click_scrolled_text(discard, wait_for_ready=True)
    outcome = driver.wait(f"""const error = document.querySelector('.error-toast[role="alert"]')?.textContent.trim();
      if (error) return {{error}};
      return JSON.stringify([...document.querySelectorAll(
      {str(dialog + ' .discard-preview-paths li')!r})].map(row => row.textContent.trim()).sort())
      === JSON.stringify({expected}) ? {{ready: true}} : null""", 120)
    assert outcome == {'ready': True}, f'mixed large discard preview refused: {outcome}'
    assert {path: digest(path) for path in sizes} == before
    driver.click_scrolled_text(confirm, 'Discard captured changes', wait_for_ready=True)
    driver.wait(f"return !!document.querySelector({undo!r})", 120)
    assert digest(tracked) == index_digest
    assert all(not (repository / path).exists() for path in sizes if path != tracked)
    assert_staged_unchanged()
    driver.click_visible(undo)
    driver.wait(f"return !!document.querySelector({redo!r})", 120)
    assert {path: digest(path) for path in sizes} == before
    assert_staged_unchanged()
    report['scenarios'].append('native-cti-sized-bulk-discard-restores-index-version-of-tracked-file-and-undo-recovers-edit')
    return repository, repo_id


def discard_file_size_limit(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-discard-file-limit', commits=2)
    nested = 'data/oversized.json'
    file = repository / nested
    file.parent.mkdir()
    (repository / 'data/keep.txt').write_bytes(b'Tracked neighboring file\n')
    fixtures.git(repository, 'add', '--', 'data/keep.txt')
    fixtures.git(repository, 'commit', '-qm', 'Track the neighboring file')
    with file.open('wb') as stream:
        stream.truncate(64 * 1024 * 1024 + 1)
    second = 'data/also-oversized.json'
    with (repository / second).open('wb') as stream:
        stream.truncate(64 * 1024 * 1024 + 1)
    (repository / 'fixture.txt').write_bytes(b'Keep this staged edit\n')
    fixtures.git(repository, 'add', '--', 'fixture.txt')
    files = (nested, second, 'fixture.txt', 'data/keep.txt')
    before = checkout_footprint(fixtures, repository, files)
    repo_id = open_ui(driver, repository)
    driver.click_visible('.wip-nav')
    driver.click_visible(f'[aria-label="Discard changes in {nested}"]')
    driver.wait("""return document.querySelector('.error-toast[role="alert"]')
      ?.textContent.includes('64 MiB per-file limit for discard recovery')""")
    assert not driver.script("return !!document.querySelector('[role=alertdialog]')")
    assert checkout_footprint(fixtures, repository, files) == before
    assert not driver.invoke('load_discard_recoveries', repoId=repo_id)
    report['scenarios'].append('native-oversized-nested-file-gets-size-specific-refusal-without-mutation')
    dialog = '[role="alertdialog"]'
    driver.click_visible('[aria-label="Discard all unstaged changes"]')
    blocked_review = f"""const review = document.querySelector({dialog!r});
      if (review?.querySelector('.confirm-action')?.disabled !== true) return false;
      const rows = [...review.querySelectorAll('.discard-preview-paths li')].map(row => row.textContent);
      return review.textContent.includes('0 eligible · 2 blocked')
        && {json.dumps([nested, second])}.every(path => rows.some(row =>
          row.includes(path) && row.includes('Too large to save for recovery')));"""
    driver.wait(blocked_review)
    driver.click_scrolled_text(dialog + ' button', 'Recheck eligibility', wait_for_ready=True)
    driver.wait(f"""const review = document.querySelector({dialog!r});
      return review?.querySelector('.blocked-discard-choice')?.textContent.includes('No files are currently eligible')
        && review.querySelector('.confirm-action')?.disabled === true;""")
    driver.click_scrolled_text(dialog + ' button', 'Cancel', wait_for_ready=True)
    driver.wait(f"return !document.querySelector({dialog!r})")
    assert checkout_footprint(fixtures, repository, files) == before
    assert not driver.invoke('load_discard_recoveries', repoId=repo_id)
    report['scenarios'].append('native-oversized-nested-bulk-reviews-and-rechecks-all-blocked-paths-without-mutation')

    origin = 'input[aria-label="Filter changed files"]'
    search = 'gk-command-palette input[aria-label="Search commands"]'
    driver.click_visible(origin)
    driver.key('p', modifiers=('\ue009',))
    driver.wait(f"return document.activeElement?.matches({search!r})")
    driver.script("""const field = document.activeElement;
      field.value = 'discard all unstaged'; field.dispatchEvent(new Event('input', {bubbles: true}));""")
    driver.click_scrolled_text('gk-command-palette [role=option] strong',
                               'Discard All Unstaged Changes…', wait_for_ready=True)
    driver.wait(blocked_review)
    driver.click_scrolled_text(dialog + ' button', 'Cancel', wait_for_ready=True)
    driver.wait(f"""return document.activeElement?.matches({origin!r})
      && !document.querySelector({dialog!r})""")
    assert checkout_footprint(fixtures, repository, files) == before
    assert not driver.invoke('load_discard_recoveries', repoId=repo_id)
    report['scenarios'].append('native-palette-restores-opener-after-canceling-an-all-blocked-discard-review')
    (repository / 'fixture.txt').write_bytes(b'Eligible unstaged content\n')
    mixed_before = checkout_footprint(fixtures, repository, files)
    driver.wait("return !!document.querySelector('[aria-label=\"Stage fixture.txt\"]')")
    driver.click_visible('[aria-label="Discard all unstaged changes"]')
    driver.wait(f"""const review = document.querySelector({dialog!r});
      if (review?.querySelector('.confirm-action')?.disabled !== true) return false;
      const rows = [...review.querySelectorAll('.discard-preview-paths li')].map(row => row.textContent);
      return {json.dumps([nested, second])}.every(path => rows.some(row =>
        row.includes(path) && row.includes('Too large to save for recovery')))
        && rows.some(row => row.trim() === 'fixture.txt');""")
    driver.click_scrolled_text(dialog + ' button', 'Cancel', wait_for_ready=True)
    assert checkout_footprint(fixtures, repository, files) == mixed_before
    assert not driver.invoke('load_discard_recoveries', repoId=repo_id)
    report['scenarios'].append('native-mixed-discard-labels-oversized-paths-and-leaves-all-files-unchanged')
    return repository, repo_id


def discard_row_during_stage(driver, fixtures, report):
    """A real held stage explains why another file's discard cannot start."""
    import threading
    import time
    from native_acceptance import open_ui

    repository = fixtures.repository('discard-row-busy', commits=2)
    selected = repository / 'keep-edit.txt'
    selected.write_bytes(b'Committed baseline\n')
    fixtures.git(repository, 'add', '--', selected.name)
    fixtures.git(repository, 'commit', '-qm', 'Add second tracked file')
    selected.write_bytes(b'Unstaged data to preserve\n')
    (repository / 'fixture.txt').write_bytes(b'File to stage\n')
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, ('fixture.txt', selected.name))
    stage = '[aria-label="Stage fixture.txt"]'
    trash = '[aria-label="Discard changes in keep-edit.txt"]'
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    (gate / 'mode').write_text('add')
    hold, started = gate / 'hold', gate / 'started'
    hold.touch()
    timeout = threading.Event()

    def release():
        timeout.set()
        hold.unlink(missing_ok=True)

    watchdog = threading.Timer(20, release)
    watchdog.start()
    try:
        driver.click_visible(stage)
        deadline = time.monotonic() + 12
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert started.exists() and not timeout.is_set(), 'The owned git add was not observed'
        driver.wait("""return document.querySelector('[aria-label="Discard changes in keep-edit.txt"]')
          ?.getAttribute('aria-disabled') === 'true'""", 5)
        description = driver.script("return document.querySelector(arguments[0]).title", trash)
        assert 'Wait for the current Git operation' in description
        driver.script("document.querySelector(arguments[0]).focus()", trash)
        driver.key('\ue007')
        assert driver.script("return document.activeElement === document.querySelector(arguments[0])", trash)
        assert not driver.script("return !!document.querySelector('[role=alertdialog]')")
        assert not timeout.is_set() and checkout_footprint(fixtures, repository, ('fixture.txt', selected.name)) == before
    finally:
        watchdog.cancel()
        watchdog.join()
        hold.unlink(missing_ok=True)

    driver.wait("""return document.querySelector('[aria-label="Unstage fixture.txt"]')
      && !document.querySelector('[aria-label="Discard changes in keep-edit.txt"]')?.hasAttribute('aria-disabled')""")
    assert fixtures.git(repository, 'diff', '--cached', '--name-only') == 'fixture.txt'
    assert selected.read_bytes() == b'Unstaged data to preserve\n'
    driver.click_visible(trash)
    driver.wait("""return document.querySelector('[role=alertdialog]')?.textContent.includes('keep-edit.txt')""")
    driver.click_visible('[role=alertdialog] button', 'Cancel')
    driver.wait("return !document.querySelector('[role=alertdialog]')")
    assert selected.read_bytes() == b'Unstaged data to preserve\n'
    report['scenarios'].append('native-file-discard-explains-a-busy-stage-and-allows-a-fresh-review-without-discarding')
    return repository, repo_id
