"""Verify that a real repository read cannot take over a replacement manager."""
import json
import time

from native_repository_navigation import open_repository_dialog
from native_worktree_scenarios import checkout_footprint


def repository_open_scope(driver, fixtures, report):
    from native_acceptance import seed_commit_draft

    original = fixtures.repository('browse-original', commits=2)
    candidate = fixtures.repository('browse-target', commits=3)
    (original / 'fixture.txt').write_text('Owned staged text for the original checkout.\n')
    fixtures.git(original, 'add', 'fixture.txt')
    draft = 'Keep this draft on the original checkout'
    paths = [original, candidate]
    gate = fixtures.history_gate
    held = gate / 'hold'
    started = gate / 'started'
    (gate / 'target').write_text(str(candidate))
    (gate / 'mode').write_text('--show-toplevel')

    def wait_path(path):
        driver.wait('return document.querySelector(".status-repository-path")?.textContent.trim() === '
                    + json.dumps(str(path)), 60)

    def workspace():
        return driver.script("""const id = localStorage.getItem('git-khronos.active-workspace.v1');
          const workspace = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')).find(row => row.id === id);
          return {saved: workspace.repositoryPaths, active: workspace.activeRepositoryPath,
            recent: JSON.parse(localStorage.getItem('git-khronos.recent-repositories.v1'))};""")

    def tab_count():
        return driver.script('return document.querySelectorAll(".repo-tab-main[role=tab]").length')

    def draft_value():
        return driver.script('return document.querySelector(".commit-form #commit-summary")?.value ?? null')

    def select_candidate():
        name = json.dumps(f'Open {candidate.name} at {candidate}')
        driver.click_visible(f'gc-repository-dialog .manager-recents button[aria-label={name}]')

    driver.wait('return !!document.querySelector("gc-root")')
    driver.script("""localStorage.clear();
      localStorage.setItem('git-khronos.open-repositories.v1', JSON.stringify([arguments[0]]));
      localStorage.setItem('git-khronos.active-repository.v1', arguments[0]);
      localStorage.setItem('git-khronos.recent-repositories.v1', JSON.stringify([arguments[1]]));""",
                  str(original), str(candidate))
    driver.reload()
    wait_path(original)
    seed_commit_draft(driver, original, draft)
    before = [checkout_footprint(fixtures, repo) for repo in paths]
    old_workspace = workspace()
    assert old_workspace == {'saved': [str(original)], 'active': str(original), 'recent': [str(candidate)]}
    assert tab_count() == 1 and draft_value() == draft
    open_repository_dialog(driver)
    held.touch()
    try:
        select_candidate()
        deadline = time.monotonic() + 15
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert started.exists(), 'Open Repository never reached its native Git read'
        # The marker precedes the real rev-parse and proves the request was
        # dispatched while the original Browse form was still live.
        pending_pid = int(started.read_text())
        driver.wait('return !!document.querySelector(".app-shell.is-busy")')
        driver.click_visible('gc-repository-dialog [aria-label="Close repository management"]')
        driver.wait('return !document.querySelector("gc-repository-dialog")')
        open_repository_dialog(driver)
        driver.wait('return !!document.querySelector("gc-repository-dialog .repository-manager-body")')
        assert held.exists() and int(started.read_text()) == pending_pid
    finally:
        held.unlink(missing_ok=True)

    driver.wait('return !!document.querySelector(".app-shell:not(.is-busy)")')
    settled = workspace()
    assert settled == old_workspace, settled
    wait_path(original)
    assert tab_count() == 1 and draft_value() == draft
    assert driver.script('return !!document.querySelector("gc-repository-dialog .repository-manager-body")')
    assert [checkout_footprint(fixtures, repo) for repo in paths] == before
    report['scenarios'].append('native-retired-repository-read-preserves-active-tab-draft-and-saved-membership')

    select_candidate()
    wait_path(candidate)
    driver.wait('return !document.querySelector("gc-repository-dialog") && '
                'document.querySelectorAll(".repo-tab-main[role=tab]").length === 2')
    final_workspace = workspace()
    assert final_workspace == {'saved': [str(original), str(candidate)], 'active': str(candidate),
                               'recent': [str(candidate)]}, final_workspace
    assert [checkout_footprint(fixtures, repo) for repo in paths] == before
    report['repositoryOpenScope'] = {'heldReadPid': pending_pid, 'afterRetirement': settled,
                                     'freshOpen': final_workspace, 'checkoutsUnchanged': True}
    report['scenarios'].append('native-current-repository-selection-still-opens-the-chosen-checkout')
    return candidate, driver.invoke('open_repository', path=str(candidate))['id']
