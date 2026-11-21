"""Installed patch-export review and native file-write checks on owned fixtures."""
import json

from native_folder_picker import respond_to_owned_picker


def patch_export_scope(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('patch-export-scope', commits=2)
    first = repository / 'fixture.txt'
    second = repository / 'other.txt'
    second.write_text('Committed neighbour\n')
    fixtures.git(repository, 'add', '--', second.name)
    fixtures.git(repository, 'commit', '-qm', 'Record neighbour')
    repo_id = open_ui(driver, repository)

    panel = 'gc-patch-exchange-panel > details'
    export = panel + ' fieldset:first-of-type'
    save = export + ' > button'
    driver.click_visible('[aria-label="Preferences"]')
    driver.click_visible('#preferences-tab-git')
    driver.click_scrolled_text(panel + ' > summary', 'Patch exchange', wait_for_ready=True)

    def contains(selector, text):
        driver.wait(f'return document.querySelector({json.dumps(selector)})?.textContent.includes({json.dumps(text)})')

    contains(export, 'There are no tracked changes in this diff scope.')
    assert driver.script('return document.querySelector(arguments[0]).matches(":disabled")', save)
    report['scenarios'].append('native-patch-export-clean-scope-disables-destination-picker')

    first.write_text('Edit to be removed before export\n')
    second.write_text('Edit that remains eligible\n')
    driver.wait(f'return document.querySelector({json.dumps(save)})?.matches(":enabled")')
    driver.click_scrolled_text(export + ' > label', 'All tracked changes in this scope', wait_for_ready=True)
    contains(export, '0 of 2 listed files selected')
    driver.click_scrolled_text(export + ' .actions button', 'Select listed files', wait_for_ready=True)
    contains(export, '2 of 2 listed files selected')
    fixtures.git(repository, 'restore', '--', first.name)
    contains(export + ' [aria-label="Unavailable selected paths"]', first.name)
    assert driver.script('return document.querySelector(arguments[0]).matches(":disabled")', save)

    refused = fixtures.root / 'refused.patch'
    expected = [first.name, second.name]
    try:
        driver.invoke('export_diff_patch', repoId=repo_id, staged=False, paths=expected, destination=str(refused))
    except RuntimeError as error:
        assert 'no partial selection was exported' in str(error), str(error)
    else:
        raise AssertionError('Native export accepted a partial selection')
    assert not refused.exists()
    report['scenarios'].append('native-patch-export-missing-reviewed-path-blocks-ui-and-native-partial-write')

    driver.click_scrolled_text(export + ' .unavailable-paths button', 'Remove unavailable paths', wait_for_ready=True)
    contains(export, '1 of 1 listed files selected')
    driver.click_scrolled_text(save, 'Save diff patch…', wait_for_ready=True)
    picker = respond_to_owned_picker(
        driver.owned_display, driver.owned_session_application_pid,
        'Save a new diff patch outside the repository', fixtures.root,
    )
    # GTK Escape may also close Preferences; cancellation still belongs in the activity receipt.
    contains('[data-git-operation-status]', 'Patch export cancelled')
    assert not driver.script('return !!document.querySelector(".error-toast")')
    destination = fixtures.root / 'selected.patch'
    before = fixtures.git(repository, 'status', '--porcelain=v1')
    assert before == 'M other.txt', before  # The fixture helper strips leading whitespace.
    size = driver.invoke('export_diff_patch', repoId=repo_id, staged=False, paths=[second.name], destination=str(destination))
    assert destination.stat().st_size == size
    assert fixtures.git(repository, 'apply', '--numstat', str(destination)) == '1\t1\tother.txt'
    assert fixtures.git(repository, 'status', '--porcelain=v1') == before
    report['patchExportScope'] = {'picker': picker, 'exportedPaths': [second.name], 'bytes': size}
    report['scenarios'].append('native-patch-export-recovered-selection-opens-real-picker-and-native-export-writes-only-selected-diff')
    return repository, repo_id
