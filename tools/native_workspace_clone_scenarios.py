"""Verify reviewed workspace clone dispatch against owned Git sources and folders."""
import json

from native_folder_picker import respond_to_owned_picker
from native_worktree_scenarios import checkout_footprint


def workspace_clone(driver, fixtures, report):
    from native_acceptance import open_ui

    active = fixtures.repository('batch-clone-active', commits=2)
    sources = [fixtures.repository('batch-source-' + name, commits=2)
               for name in ('first', 'blocked', 'last')]
    # The owned GTK picker uses Alt+Home and requires exactly one visible row.
    destination = fixtures.root / 'home' / 'batch-clones'
    destination.mkdir()
    blocked = destination / sources[1].name
    blocked.mkdir()
    marker = blocked / 'marker.txt'
    marker.write_text('Existing folder must not be overwritten.\n')
    source_footprints = [checkout_footprint(fixtures, source) for source in sources]
    repo_id = open_ui(driver, active)
    driver.click_visible('.workspace-toggle')
    driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Repository overview', wait_for_ready=True)
    batch = 'gc-workspace-clone'
    driver.click_scrolled_text(batch + ' button', 'Clone multiple repositories', wait_for_ready=True)
    driver.wait('return !!document.querySelector("#workspace-clone-sources")')
    driver.script("""
      const field = document.getElementById('workspace-clone-sources');
      field.value = arguments[0];
      field.dispatchEvent(new Event('input', { bubbles: true }));
    """, '\n'.join(map(str, sources)))
    driver.click_scrolled_text(batch + ' button', 'Choose destination…', wait_for_ready=True)
    picker = respond_to_owned_picker(driver.owned_display, driver.owned_session_application_pid,
                                     'Choose a destination for the workspace clones', fixtures.root, destination)
    driver.click_scrolled_text(batch + ' button', 'Review clones', wait_for_ready=True)
    driver.wait('return document.querySelector("gc-workspace-clone section")?.textContent.includes('
                + json.dumps(str(destination)) + ')')
    assert list(destination.iterdir()) == [blocked]
    driver.click_scrolled_text(batch + ' button', 'Clone 3 repositories', wait_for_ready=True)
    driver.wait('return document.querySelector("gc-workspace-clone [role=status]")?.textContent.trim() === '
                + json.dumps('Cloned 2 of 3 repositories.'), 70)
    results = driver.script("""return [...document.querySelectorAll('gc-workspace-clone [aria-label="Clone results"] li')]
        .map(row => row.textContent.trim());""")
    assert len(results) == 3 and 'The clone destination already exists.' in results[1], results
    copies = [destination / sources[index].name for index in (0, 2)]
    for source, copy in zip((sources[0], sources[2]), copies):
        assert fixtures.git(copy, 'rev-parse', 'HEAD') == fixtures.git(source, 'rev-parse', 'HEAD')
        assert fixtures.git(copy, 'remote', 'get-url', 'origin') == str(source)
    assert marker.read_text() == 'Existing folder must not be overwritten.\n'
    assert list(blocked.iterdir()) == [marker]
    assert [checkout_footprint(fixtures, source) for source in sources] == source_footprints
    driver.wait('return document.querySelector(".status-repository-path")?.textContent.trim() === '
                + json.dumps(str(active)))
    tabs = driver.script("""return [...document.querySelectorAll('.repo-tab-main[role=tab]')]
        .map(node => node.querySelector('.repo-tab-full-label').textContent.trim());""")
    assert tabs == [active.name, *[copy.name for copy in copies]], tabs
    paths = driver.script("""const workspace = localStorage.getItem('git-khronos.active-workspace.v1') ?? 'default';
        return JSON.parse(localStorage.getItem('git-khronos.workspaces.v1'))
          .find(item => item.id === workspace).repositoryPaths;""")
    assert paths == [str(active), *map(str, copies)], paths
    report['workspaceClone'] = {'results': results, 'tabs': tabs, 'picker': picker}
    report['scenarios'].append('native-workspace-clone-reviews-destinations-continues-after-collision-and-preserves-active-tab')
    return active, repo_id
