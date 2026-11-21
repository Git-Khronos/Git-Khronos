"""Exercise the actual deferrable workspace dialogs without writing Git data."""
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
