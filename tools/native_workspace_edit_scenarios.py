"""Exercise workspace editing and saved checkout membership without writing Git data."""
import json

from native_worktree_scenarios import checkout_footprint


def saved_checkout_status(driver, fixtures, report):
    """Read a recovered saved path without opening it; keep a missing path's error local."""
    active = fixtures.repository('saved-status-active', commits=2)
    saved = fixtures.repository('saved-status-dirty', commits=2)
    gone = fixtures.root / 'saved-status-unavailable'
    parked = fixtures.root / 'saved-status-parked'
    files = ('fixture.txt', 'untracked.txt')
    fixtures.git(saved, 'switch', '-c', 'saved-status-branch')
    (saved / files[0]).write_text('Staged fixture change.\n')
    fixtures.git(saved, 'add', '--', files[0])
    (saved / files[0]).write_text('Additional working tree change.\n')
    (saved / files[1]).write_text('Untracked fixture change.\n')
    before = checkout_footprint(fixtures, saved, files)
    saved.rename(parked)
    workspace = {'id': 'owned-saved-status', 'name': 'Owned saved status',
                 'repositoryPaths': [str(path) for path in (active, saved, gone)],
                 'activeRepositoryPath': str(active)}
    driver.wait("return !!document.querySelector('gk-root')")
    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify([arguments[0]]));
      localStorage.setItem('git-khronos.active-workspace.v1', arguments[0].id);
    """, workspace)
    driver.reload()
    driver.wait('return document.querySelector(".status-repository-path")?.textContent.trim() === '
                + json.dumps(str(active)), 60)
    driver.wait('return document.querySelector(".error-toast")?.textContent.includes("Could not restore 2 saved repositories")', 60)
    parked.rename(saved)
    assert checkout_footprint(fixtures, saved, files) == before
    index = (saved / '.git/index').read_bytes()

    def layout():
        return driver.script("""
          return {
            workspaces: localStorage.getItem('git-khronos.workspaces.v1'),
            active: document.querySelector('.status-repository-path')?.textContent.trim(),
            tabs: [...document.querySelectorAll('.repo-tab-main[role=tab]')]
              .map(node => node.querySelector('.repo-tab-full-label').textContent.trim())
          };
        """)

    original = layout()
    assert original['active'] == str(active) and original['tabs'] == [active.name], original
    driver.click_visible('.workspace-toggle')
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    region = 'gk-workspace-center [aria-label="Saved repositories not open"]'

    def row(path):
        return region + ' li:has(input[aria-label=' + json.dumps('Select saved path ' + str(path)) + '])'

    driver.click_scrolled_text(region + ' button', 'Check saved status (2)', wait_for_ready=True)
    driver.wait('return !!document.querySelector(' + json.dumps(region + ' [role=status]')
                + ')?.textContent.includes("2 of 2 saved paths checked.")', 40)
    summary = driver.script('return document.querySelector(arguments[0])?.textContent', row(saved))
    error = driver.script('return document.querySelector(arguments[0])?.textContent', row(gone) + ' [role=alert]')
    assert 'saved-status-branch' in summary and '1 staged · 1 unstaged · 1 untracked entry · 0 conflicts' in summary, summary
    assert 'Status unavailable:' in error, error
    assert layout() == original
    assert (saved / '.git/index').read_bytes() == index
    assert checkout_footprint(fixtures, saved, files) == before
    report['savedCheckoutStatus'] = {'summary': summary, 'missingPathError': error, 'layoutUnchanged': True}
    report['scenarios'].append('native-saved-status-reports-dirty-and-missing-paths-without-opening-tabs-or-writing-git')
    return active


def reopen_workspace_tab(driver, fixtures, report):
    """Keep close history in its workspace and restore the previous saved slot."""
    first, middle, last = [
        fixtures.repository('workspace-reopen-' + name, commits=2) for name in ('first', 'middle', 'last')
    ]
    offline = fixtures.root / 'workspace-reopen-unavailable'
    snapshots = [checkout_footprint(fixtures, repository) for repository in (first, middle, last)]
    primary = {'id': 'owned-reopen-origin', 'name': 'Owned reopen origin',
               'repositoryPaths': [str(path) for path in (first, offline, middle, last)],
               'activeRepositoryPath': str(first)}
    other = {'id': 'owned-reopen-other', 'name': 'Owned reopen other',
             'repositoryPaths': [str(middle)], 'activeRepositoryPath': str(middle)}
    driver.wait("return !!document.querySelector('gk-root')")
    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify(arguments[0]));
      localStorage.setItem('git-khronos.active-workspace.v1', arguments[0][0].id);
    """, [primary, other])
    driver.reload()

    def memberships():
        return driver.script("""return Object.fromEntries(JSON.parse(localStorage.getItem('git-khronos.workspaces.v1'))
            .map(item => [item.id, item.repositoryPaths]));""")

    def wait_tabs(paths):
        names = [path.name for path in paths]
        driver.wait("""return JSON.stringify([...document.querySelectorAll('.repo-tab-main[role=tab]')]
          .map(node => node.querySelector('.repo-tab-full-label').textContent.trim())) === """
                    + json.dumps(json.dumps(names, separators=(',', ':'))), 60)

    def switch(workspace, paths):
        driver.click_visible('.workspace-toggle')
        item = '.workspace-list [role=menuitemradio][aria-label^=' + json.dumps(workspace['name'] + ',') + ']'
        driver.click_visible(item)
        driver.wait("return document.querySelector('.workspace-toggle')?.getAttribute('aria-label') === "
                    + json.dumps('Workspace: ' + workspace['name']))
        wait_tabs(paths)

    def show_reopen(expected_enabled):
        driver.click_visible('[aria-label="Main menu"]')
        # Wait for the deferred menu's workspace-specific binding, not just
        # for a newly attached button whose initial disabled property is false.
        return driver.wait("""const item = [...document.querySelectorAll('.app-menu-popover gk-main-menu-content [role=menuitem]')]
          .find(node => node.querySelector('strong')?.textContent.trim() === 'Reopen Closed Repository');
          return item && (item.disabled ? 'disabled' : 'enabled') === """
                           + json.dumps('enabled' if expected_enabled else 'disabled')
                           + """ ? (item.disabled ? 'disabled' : 'enabled') : null;""")

    wait_tabs([first, middle, last])
    assert memberships() == {primary['id']: primary['repositoryPaths'], other['id']: other['repositoryPaths']}
    driver.click_visible('.repo-tab-main[role=tab][aria-label^=' + json.dumps(middle.name) + ']')
    driver.click_visible('[aria-label=' + json.dumps('Close ' + middle.name) + ']')
    wait_tabs([first, last])
    assert memberships()[primary['id']] == [str(first), str(offline), str(last)]
    switch(other, [middle])
    evidence = report['workspaceReopen'] = {'otherWorkspaceAction': show_reopen(False)}
    assert evidence['otherWorkspaceAction'] == 'disabled', evidence
    driver.key('\ue00c')
    driver.wait("return !document.querySelector('.app-menu-popover')")
    report['scenarios'].append('native-ui-reopen-closed-tab-does-not-leak-across-workspaces')

    switch(primary, [first, last])
    assert show_reopen(True) == 'enabled'
    driver.click_scrolled_text('.app-menu-popover [role=menuitem] strong', 'Reopen Closed Repository', wait_for_ready=True)
    wait_tabs([first, middle, last])
    driver.wait("return document.querySelector('.status-repository-path')?.textContent.trim() === " + json.dumps(str(middle)))
    evidence['savedPathsAfterReopen'] = memberships()
    assert evidence['savedPathsAfterReopen'] == {primary['id']: primary['repositoryPaths'], other['id']: other['repositoryPaths']}
    assert [checkout_footprint(fixtures, repository) for repository in (first, middle, last)] == snapshots
    report['scenarios'].append('native-ui-reopen-closed-tab-restores-saved-slot-without-changing-git')
    return middle


def workspace_edit_workflow(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('workspace-dialogs-layout-only', commits=2)
    (repository / 'fixture.txt').write_text('An owned staged edit.\n')
    fixtures.git(repository, 'add', 'fixture.txt')
    (repository / 'note.txt').write_text('An owned untracked edit.\n')
    open_ui(driver, repository)
    files = ('fixture.txt', 'note.txt')
    before = checkout_footprint(fixtures, repository, files)
    toggle = '.workspace-toggle'
    workspace_menu = '.workspace-menu-actions [role=menuitem]'
    editor = '.workspace-dialog'
    field = editor + ' input[name="workspaceName"]'
    delete_dialog = '[aria-labelledby="delete-workspace-title"]'

    def persisted():
        return driver.script("""return {
          selected: localStorage.getItem('git-khronos.active-workspace.v1'),
          layouts: JSON.parse(localStorage.getItem('git-khronos.workspaces.v1'))
        };""")

    def pick(action):
        driver.click_visible(toggle)
        driver.click_scrolled_text(workspace_menu, action, wait_for_ready=True)

    def fill(name):
        element = driver.wait('return document.activeElement?.matches(' + json.dumps(field)
                              + ') ? document.activeElement : null')
        identifier = element['element-6066-11e4-a52e-4f735466cecf']
        driver.request('POST', driver.path(f'element/{identifier}/value'), {'text': name})

    def at_workspace(name):
        driver.wait('return document.querySelector(' + json.dumps(toggle)
                    + ')?.getAttribute("aria-label") === ' + json.dumps('Workspace: ' + name))

    def cancel(selector):
        driver.key('\ue00c')
        driver.wait('return !document.querySelector(' + json.dumps(selector) + ')')
        driver.wait('return document.activeElement?.matches(' + json.dumps(toggle) + ')')

    at_workspace('Default')
    original = persisted()
    pick('New workspace')
    driver.wait('return document.activeElement?.matches(' + json.dumps(field) + ')')
    cancel(editor)
    assert persisted() == original
    assert checkout_footprint(fixtures, repository, files) == before

    pick('New workspace')
    fill('Owned workspace')
    driver.click_visible(editor + ' footer button', 'Create Workspace')
    at_workspace('Owned workspace')
    driver.wait('return !!document.querySelector("gk-welcome-launcher")')
    created = persisted()
    assert len(created['layouts']) == 2 and created['selected'] != 'default', created
    assert next(item for item in created['layouts'] if item['id'] == 'default')['repositoryPaths'] == [str(repository)]
    assert next(item for item in created['layouts'] if item['id'] == created['selected'])['repositoryPaths'] == []

    pick('Rename current')
    driver.wait('return document.activeElement?.matches(' + json.dumps(field) + ''') &&
        document.activeElement.value === "Owned workspace" && document.activeElement.selectionStart === 0 &&
        document.activeElement.selectionEnd === document.activeElement.value.length''')
    driver.key('\ue003')
    fill('Owned renamed workspace')
    driver.click_visible(editor + ' footer button', 'Save Name')
    at_workspace('Owned renamed workspace')
    renamed = persisted()
    assert renamed['selected'] == created['selected']
    assert next(item for item in renamed['layouts'] if item['id'] == renamed['selected'])['name'] == 'Owned renamed workspace'

    pick('Delete current')
    driver.wait('return document.activeElement?.closest(' + json.dumps(delete_dialog)
                + ') && document.activeElement.textContent.trim() === "Cancel"')
    cancel(delete_dialog)
    assert persisted() == renamed

    pick('Delete current')
    driver.click_visible(delete_dialog + ' footer button', 'Delete Workspace')
    at_workspace('Default')
    driver.wait('return document.querySelector(".status-repository-path")?.textContent === ' + json.dumps(str(repository)))
    final = persisted()
    assert final['selected'] == 'default' and len(final['layouts']) == 1
    assert final['layouts'][0]['activeRepositoryPath'] == str(repository)
    assert checkout_footprint(fixtures, repository, files) == before
    report['workspaceEditor'] = {'before': original, 'created': created, 'renamed': renamed, 'final': final}
    report['scenarios'].append('native-workspace-editor-preserves-dirty-checkout-through-create-rename-cancel-and-delete')


def saved_workspace_repository_workflow(driver, fixtures, report):
    kept = fixtures.repository('workspace-kept-checkout', commits=2)
    returning = fixtures.repository('workspace-returning-checkout', commits=2)
    forgotten = fixtures.repository('workspace-forgotten-checkout', commits=2)
    repositories = [kept, returning, forgotten]
    parked = [fixtures.root / 'workspace-parked-returning', fixtures.root / 'workspace-parked-forgotten']
    files = ('fixture.txt', 'draft.txt')
    for repository in repositories:
        (repository / 'draft.txt').write_text(f'Owned dirty work in {repository.name}.\n')
    before = [checkout_footprint(fixtures, repository, files) for repository in repositories]
    returning.rename(parked[0])
    forgotten.rename(parked[1])

    saved = [str(path) for path in repositories]
    primary = {'id': 'owned-saved-paths', 'name': 'Owned saved paths',
               'repositoryPaths': saved, 'activeRepositoryPath': str(kept)}
    empty = {'id': 'owned-empty', 'name': 'Owned empty workspace',
             'repositoryPaths': [], 'activeRepositoryPath': None}
    driver.wait('return !!document.querySelector("gk-root")', 60)
    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify(arguments[0]));
      localStorage.setItem('git-khronos.active-workspace.v1', arguments[0][0].id);
    """, [primary, empty])
    driver.reload()

    toggle = '.workspace-toggle'
    overview = 'gk-workspace-center [aria-label="Workspace center"]'
    saved_region = overview + ' [aria-label="Saved repositories not open"]'

    def wait_checkout(path):
        driver.wait('return document.querySelector(".status-repository-path")?.textContent.trim() === '
                    + json.dumps(str(path)), 60)

    def wait_for_failed_restore():
        driver.wait('''return document.querySelector('.error-toast')?.textContent
                       .includes('Could not restore 2 saved repositories')''', 60)

    def switch(workspace):
        driver.click_visible(toggle)
        selector = '.workspace-list [role=menuitemradio][aria-label^=' + json.dumps(workspace['name'] + ',') + ']'
        driver.click_visible(selector)
        driver.wait('return document.querySelector(".workspace-toggle")?.getAttribute("aria-label") === '
                    + json.dumps('Workspace: ' + workspace['name']))

    def stored():
        return driver.script("""
          const layouts = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1'));
          return layouts.find(workspace => workspace.id === arguments[0]).repositoryPaths;
        """, primary['id'])

    wait_checkout(kept)
    wait_for_failed_restore()
    assert stored() == saved, 'Failed startup reads lost saved membership'
    switch(empty)
    after_switch = stored()
    assert after_switch == saved, f'Switching workspaces discarded unavailable paths: {after_switch!r}'

    switch(primary)
    wait_checkout(kept)
    wait_for_failed_restore()
    driver.click_visible(toggle)
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    driver.wait('return document.querySelector(' + json.dumps(saved_region) + ')?.textContent.includes('
                + json.dumps(str(returning)) + ')')
    remove = '[aria-label=' + json.dumps(f'Remove {forgotten} from workspace') + ']'
    driver.click_scrolled_text(saved_region + ' button' + remove, 'Remove from workspace', wait_for_ready=True)
    driver.wait('return !!document.querySelector(' + json.dumps(saved_region + ' [role="status"]') + ')')
    assert stored() == saved[:2], 'Removal changed more than one workspace path'
    assert checkout_footprint(fixtures, parked[1], files) == before[2]

    parked[0].rename(returning)
    parked[1].rename(forgotten)
    retry = '[aria-label=' + json.dumps(f'Retry opening {returning}') + ']'
    driver.click_scrolled_text(saved_region + ' button' + retry, 'Retry opening', wait_for_ready=True)
    wait_checkout(returning)
    assert stored() == saved[:2], 'Retry did not preserve saved membership'
    driver.reload()
    wait_checkout(returning)
    driver.wait('return document.querySelectorAll(".repo-tab-main[role=tab]").length === 2', 60)
    assert stored() == saved[:2], 'Reload revived a removed path or lost another checkout'
    after = [checkout_footprint(fixtures, repository, files) for repository in repositories]
    assert after == before, 'Workspace review changed Git refs, index, configuration or owned working files'
    report['savedWorkspaceRepositories'] = {'before': saved, 'afterSwitch': after_switch,
                                             'afterReload': stored(), 'checkoutUnchanged': after == before}
    report['scenarios'].append('native-saved-repository-paths-survive-workspace-switch-and-support-retry-and-removal')
    return returning


def remove_saved_workspace_paths(driver, fixtures, report):
    repositories = [fixtures.repository('workspace-removal-' + name, commits=2)
                    for name in ('active', 'first', 'retained', 'second')]
    active, first, retained, second = repositories
    files = ('fixture.txt', 'unchanged.txt')
    for repository in repositories:
        (repository / 'fixture.txt').write_text('An owned staged change.\n')
        fixtures.git(repository, 'add', '--', 'fixture.txt')
        (repository / 'unchanged.txt').write_text('An owned untracked change.\n')
    before = [checkout_footprint(fixtures, repository, files) for repository in repositories]
    locations = [active]
    for repository in repositories[1:]:
        parked = fixtures.root / (repository.name + '-parked')
        repository.rename(parked)
        locations.append(parked)
    saved = [str(repository) for repository in repositories]
    primary = {'id': 'owned-bulk-removal', 'name': 'Owned bulk removal',
               'repositoryPaths': saved, 'activeRepositoryPath': str(active)}
    other = {'id': 'other-memberships', 'name': 'Other memberships',
             'repositoryPaths': [str(first), str(second)], 'activeRepositoryPath': str(first)}
    driver.wait('return !!document.querySelector("gk-root")', 60)
    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify(arguments[0]));
      localStorage.setItem('git-khronos.active-workspace.v1', arguments[0][0].id);
    """, [primary, other])
    driver.reload()

    def stored():
        layouts = driver.script("return JSON.parse(localStorage.getItem('git-khronos.workspaces.v1'))")
        return {layout['id']: layout['repositoryPaths'] for layout in layouts}

    def wait_restored(failures):
        driver.wait('return document.querySelector(".status-repository-path")?.textContent.trim() === '
                    + json.dumps(str(active)), 60)
        driver.wait('return document.querySelector(".error-toast")?.textContent.includes('
                    + json.dumps(f'Could not restore {failures} saved repositor') + ')', 60)
        driver.wait('return document.querySelectorAll(".repo-tab-main[role=tab]").length === 1', 60)

    wait_restored(3)
    original = {layout['id']: layout['repositoryPaths'] for layout in (primary, other)}
    assert stored() == original
    driver.click_visible('.workspace-toggle')
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    overview = 'gk-workspace-center [aria-label="Workspace center"]'
    region = overview + ' [aria-label="Saved repositories not open"]'
    review = overview + ' [aria-labelledby="saved-paths-remove-title"]'
    driver.click_scrolled_text(region + ' button', 'Select all saved paths', wait_for_ready=True)
    checkbox = 'input[aria-label=' + json.dumps(f'Select saved path {retained}') + ']'
    driver.wait('return document.querySelector(' + json.dumps(region + ' ' + checkbox) + ')?.checked === true')
    # WebKitGTK may paint the checkbox at a different point than its styled
    # input box. Activate the associated, visibly laid-out native HTML label.
    driver.click_scrolled_text(region + f' label.saved-path:has(> {checkbox})', str(retained), wait_for_ready=True)
    driver.wait('return document.querySelector(' + json.dumps(region + ' ' + checkbox) + ')?.checked === false')
    wanted = [str(first), str(second)]
    open_review = 'Remove selected saved paths (2)…'
    evidence = report['workspaceSavedRemoval'] = {'before': stored()}

    def review_selection():
        driver.click_scrolled_text(region + ' button', open_review, wait_for_ready=True)
        items = driver.wait('return (() => { const items = [...document.querySelectorAll('
                            + json.dumps(review + ' li code') + ')];'
                            ' return items.length ? items.map(item => item.textContent) : null; })()')
        assert items == wanted, items
        driver.wait('return document.activeElement?.textContent.trim() === "Cancel" && '
                    '!!document.activeElement?.closest(' + json.dumps(review) + ')')

    review_selection()
    driver.key('\ue00c')  # Escape: cancel through ordinary keyboard handling.
    driver.wait('return !document.querySelector(' + json.dumps(review) + ')')
    assert stored() == original, 'Cancellation changed the saved workspace'
    review_selection()
    driver.click_scrolled_text(review + ' button', 'Remove 2 saved paths', wait_for_ready=True)
    driver.wait('return document.querySelector(' + json.dumps(region + ' [role="status"]')
                + ')?.textContent.includes("Removed 2 saved paths from this workspace")')
    expected = original | {primary['id']: [str(active), str(retained)]}
    assert stored() == expected
    driver.reload()
    wait_restored(1)
    evidence['afterReload'] = stored()
    assert evidence['afterReload'] == expected
    after = [checkout_footprint(fixtures, repository, files) for repository in locations]
    assert after == before, 'Saved path removal changed Git data or working files'
    evidence['checkoutsUnchanged'] = True
    report['scenarios'].append('native-workspace-review-removes-only-selected-saved-paths-and-persists-across-reload')
    return active
