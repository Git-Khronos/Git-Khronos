"""Exercise workspace editing and saved checkout membership without writing Git data."""
import json

from native_worktree_scenarios import checkout_footprint


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
    driver.wait('return !!document.querySelector("gc-welcome-launcher")')
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
    driver.wait('return !!document.querySelector("gc-root")', 60)
    driver.script("""
      localStorage.clear();
      localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify(arguments[0]));
      localStorage.setItem('git-khronos.active-workspace.v1', arguments[0][0].id);
    """, [primary, empty])
    driver.reload()

    toggle = '.workspace-toggle'
    overview = 'gc-workspace-center [aria-label="Workspace center"]'
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
