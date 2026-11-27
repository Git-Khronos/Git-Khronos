"""Verify repository folder launcher results without opening a host file manager."""
import os

from native_desktop_launcher_fixture import desktop_launcher_paths
from native_worktree_scenarios import checkout_footprint


def file_manager_launch(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('owned repository with spaces', commits=2)
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository)
    capture, refusal = desktop_launcher_paths(fixtures)
    expected = os.fsencode(repository) + b'\0'

    def open_folder():
        driver.click_visible('[aria-label="Main menu"]')
        driver.click_scrolled_text('.app-menu-popover [role=menuitem] strong',
                                   'Open in File Manager', wait_for_ready=True)

    refusal.touch()
    open_folder()
    driver.wait('return document.querySelector(".error-toast")?.textContent.includes('
                '"The repository folder could not be opened")', 8)
    assert capture.read_bytes() == expected
    refusal.unlink()
    open_folder()
    driver.wait('return !document.querySelector(".error-toast") && '
                'document.querySelector("[data-git-operation-status]")?.textContent.includes('
                '"File manager launch requested")', 8)
    assert capture.read_bytes() == expected * 2
    assert checkout_footprint(fixtures, repository) == before
    report['fileManagerLaunch'] = {'exactPathArgument': True, 'retrySucceeded': True, 'checkoutUnchanged': True}
    report['scenarios'].append('native-file-manager-reports-refusal-and-retries-exact-repository-folder')
    return repository, repo_id
