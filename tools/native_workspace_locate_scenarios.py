"""Drive real owned folder choosers and independently verify moved checkouts."""
import json

from native_folder_picker import respond_to_owned_picker
from native_worktree_scenarios import checkout_footprint


def locate_workspace_paths(driver, fixtures, report, batch):
    active = fixtures.repository('workspace-locate-active', commits=2)
    first = fixtures.repository('workspace-locate-first', commits=2)
    next_path = fixtures.repository('workspace-locate-next', commits=2)
    last = fixtures.repository('workspace-locate-last', commits=2)
    old_paths = [active, first, next_path, last]
    files = ('fixture.txt', 'working note.txt')
    for repository in old_paths:
        (repository / 'fixture.txt').write_text(f'An owned staged edit for {repository.name}.\n')
        fixtures.git(repository, 'add', '--', 'fixture.txt')
        (repository / files[1]).write_text('Untracked and unchanged.\n')
    before = [checkout_footprint(fixtures, repository, files) for repository in old_paths]
    actual = [active]
    for old in old_paths[1:]:
        # The real chooser selects the sole visible row in the private home.
        destination_root = fixtures.root / 'home' if old == first else fixtures.root
        destination = destination_root / (old.name + ' moved checkout')
        old.rename(destination)
        actual.append(destination)
    saved = [str(path) for path in old_paths]
    primary = {'id': 'owned-locate', 'name': 'Owned relocation', 'repositoryPaths': saved, 'activeRepositoryPath': str(active)}
    other = {'id': 'other-locate', 'name': 'Other saved layouts', 'repositoryPaths': [str(first)], 'activeRepositoryPath': str(first)}
    driver.wait('return !!document.querySelector("gc-root")', 60)
    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify(arguments[0]));
      localStorage.setItem('git-khronos.active-workspace.v1', arguments[0][0].id);
    """, [primary, other])
    driver.reload()

    def wait_active(path):
        driver.wait('return document.querySelector(".status-repository-path")?.textContent.trim() === ' + json.dumps(str(path)), 60)

    def memberships():
        return driver.script("""
          return Object.fromEntries(JSON.parse(localStorage.getItem('git-khronos.workspaces.v1'))
            .map(workspace => [workspace.id, workspace.repositoryPaths]));
        """)

    wait_active(active)
    driver.wait('return document.querySelector(".error-toast")?.textContent.includes("Could not restore 3 saved repositories")', 60)
    assert memberships() == {primary['id']: saved, other['id']: [str(first)]}
    driver.click_visible('.workspace-toggle')
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    overview = 'gc-workspace-center [aria-label="Workspace center"]'
    saved_region = overview + ' [aria-label="Saved repositories not open"]'
    evidence = report['workspacePathLocation'] = {'pickerInputs': [], 'before': memberships()}
    if batch:
        driver.click_scrolled_text(saved_region + ' button', 'Select all saved paths', wait_for_ready=True)
        driver.click_scrolled_text(saved_region + ' button', 'Locate selected saved paths (3)…', wait_for_ready=True)
        first_title = f'Locate the new folder for {first} (1 of 3)'
    else:
        choose = saved_region + ' button[aria-label=' + json.dumps(f'Locate and open {first}') + ']'
        driver.click_scrolled_text(choose, 'Locate and open…', wait_for_ready=True)
        first_title = f'Locate the new folder for {first.name}'
    evidence['pickerInputs'].append(respond_to_owned_picker(
        driver.owned_display, driver.owned_session_application_pid, first_title, fixtures.root, actual[1]))
    wait_active(actual[1])

    if batch:
        evidence['pickerInputs'].append(respond_to_owned_picker(
            driver.owned_display, driver.owned_session_application_pid,
            f'Locate the new folder for {next_path} (2 of 3)', fixtures.root))
        driver.wait('return document.querySelector(' + json.dumps(overview + ' [aria-label="Repository action results"]')
                    + ')?.textContent.includes("Stopped before choosing a folder for this path.")')
        driver.wait('return document.querySelector(' + json.dumps(saved_region + ' [role=status]')
                    + ')?.textContent.includes("Located 1 of 3 selected repositories.")')
    else:
        driver.wait('return document.querySelector(' + json.dumps(saved_region + ' [role=status]')
                    + ')?.textContent.includes("Replaced the saved path with")')

    expected = {primary['id']: [str(active), str(actual[1]), str(next_path), str(last)], other['id']: [str(first)]}
    assert memberships() == expected
    driver.reload()
    wait_active(actual[1])
    driver.wait('return document.querySelectorAll(".repo-tab-main[role=tab]").length === 2', 60)
    evidence['afterReload'] = memberships()
    assert evidence['afterReload'] == expected
    assert [checkout_footprint(fixtures, repository, files) for repository in actual] == before
    evidence['checkoutsUnchanged'] = True
    report['scenarios'].append('native-workspace-bulk-locate-stops-on-native-picker-cancel-and-preserves-saved-slots' if batch
                               else 'native-workspace-locate-replaces-one-path-using-owned-native-folder-picker')
    return actual[1]
