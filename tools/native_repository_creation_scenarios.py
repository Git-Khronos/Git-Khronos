"""Packaged repository creation ownership with a real, held Git HTTPS transfer."""
import json
import time
from pathlib import Path

from native_folder_picker import respond_to_owned_picker
from native_gitlab_git_fixture import prepare_git_https
from native_repository_navigation import open_repository_dialog
from native_worktree_scenarios import checkout_footprint


def repository_creation_scope(driver, fixtures, report):
    from native_acceptance import open_ui

    original = fixtures.repository('original-checkout', commits=2)
    source = fixtures.repository('owned-remote-source', commits=3)
    driver.wait('return !!document.querySelector("gk-root")')
    repo_id = open_ui(driver, original)
    before = [checkout_footprint(fixtures, repository) for repository in (original, source)]
    parent = fixtures.root / 'home' / 'clone destination'
    parent.mkdir()
    destination = parent / 'late-clone'
    gate = fixtures.gitlab_gate
    marker = gate / 'git-started.json'
    hold = gate / 'git-hold'
    remote = fixtures.gitlab_origin + '/team/subgroup/owned-project.git'
    git_config = Path(fixtures.env['GIT_CONFIG_GLOBAL'])
    initial_config = git_config.read_bytes()
    git_config.write_bytes(initial_config + prepare_git_https(fixtures, gate, source))

    def wait_active(path):
        driver.wait('return document.querySelector(".status-repository-path")?.textContent.trim() === '
                    + json.dumps(str(path)))

    def fill(name, value):
        driver.script("""const input = document.querySelector('gk-repository-dialog input[name=' + arguments[0] + ']');
          if (!input || input.readOnly || input.matches(':disabled')) throw Error('Owned clone field unavailable');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, arguments[1]);
          input.dispatchEvent(new Event('input', {bubbles: true}));""", name, value)

    def persisted():
        return driver.script("""const id = localStorage.getItem('git-khronos.active-workspace.v1');
          const workspace = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')).find(w => w.id === id);
          return {active: workspace.activeRepositoryPath, saved: workspace.repositoryPaths,
                  recent: JSON.parse(localStorage.getItem('git-khronos.recent-repositories.v1'))};""")

    def git_requests():
        return [json.loads(line) for line in (gate / 'git-requests.jsonl').read_text().splitlines()]

    try:
        open_repository_dialog(driver)
        driver.wait('return !!document.querySelector("#repository-tab-clone")?.getClientRects().length')
        driver.click_navigation('gk-repository-dialog [role=tab]', 'Clone')
        form = 'gk-repository-dialog form[aria-labelledby="repository-tab-clone"]'
        driver.wait('return !!document.querySelector("gk-repository-dialog input[name=cloneRemote]")')
        fill('cloneRemote', remote)
        fill('cloneFolder', destination.name)
        driver.click_scrolled_text(form + ' .path-picker button', 'Browse', wait_for_ready=True)
        picker = respond_to_owned_picker(driver.owned_display, driver.owned_session_application_pid,
                                        'Choose where to clone the repository', fixtures.root, parent)
        driver.wait('return document.querySelector("gk-repository-dialog input[name=cloneParent]")?.value === '
                    + json.dumps(str(parent)))
        assert not destination.exists()

        hold.touch()
        try:
            # Submit once. A directory's appearance alone does not prove that Git
            # is still transferring; the server publishes its partial-pack marker.
            driver.click_scrolled_text(form + ' button[type=submit]', 'Clone repository', wait_for_ready=True)
            deadline = time.monotonic() + 15
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(.05)
            assert marker.exists(), 'Owned HTTPS transfer never reached the pack hold'
            transfer = json.loads(marker.read_text())
            assert 0 <= transfer['packMagicOffset'] < transfer['sentPrefixBytes'] - 4 < transfer['responseBytes']
            driver.click_visible('gk-repository-dialog [aria-label="Close repository management"]')
            driver.wait('return !document.querySelector("gk-repository-dialog")')
            wait_active(original)
            assert not (destination / 'fixture.txt').exists(), 'Clone finished before the dialog was retired'
            open_repository_dialog(driver)
            driver.wait('return !!document.querySelector("gk-repository-dialog .repository-manager-body")')
            assert not (destination / 'fixture.txt').exists(), 'Transfer escaped the hold before the new manager was ready'
        finally:
            hold.unlink(missing_ok=True)

        # Wait for the UI to acknowledge success as well as the real disk result.
        recent_key = 'git-khronos.recent-repositories.v1'
        driver.wait(f'return JSON.parse(localStorage.getItem({json.dumps(recent_key)}))'
                    f'?.includes({json.dumps(str(destination))})', 30)
        assert fixtures.git(destination, 'rev-parse', 'HEAD') == before[1]['head']
        assert (destination / 'fixture.txt').read_bytes() == (source / 'fixture.txt').read_bytes()
        assert fixtures.git(destination, 'status', '--porcelain=v1') == ''
        assert fixtures.git(destination, 'config', '--get', 'remote.origin.url') == remote
        retired = persisted()
        assert retired['active'] == str(original), retired
        assert retired['saved'] == [str(original), str(destination)], retired
        assert retired['recent'].count(str(destination)) == 1, retired
        wait_active(original)
        assert driver.script('return document.querySelectorAll(".repo-tab-main[role=tab]").length') == 1
        report['scenarios'].append('native-late-clone-result-is-persisted-without-taking-over-the-active-repository')

        clone_requests = git_requests()
        assert sum(request['method'] == 'GET' and request['path'].partition('?')[0].endswith('/info/refs')
                   and request['gitCredentialMatched'] for request in clone_requests) == 1, clone_requests
        assert all(not request['apiCredentialPresent'] for request in clone_requests), clone_requests
        label = f'Open {destination.name} at {destination}'
        # Use the normal Recent row in the replacement manager. This opens the
        # existing path, not a second execution of the clone.
        driver.wait('return [...document.querySelectorAll("gk-repository-dialog .manager-recents button")]'
                    '.some(button => button.getAttribute("aria-label") === ' + json.dumps(label) + ')')
        driver.click_visible('gk-repository-dialog .manager-recents button[aria-label=' + json.dumps(label) + ']')
        wait_active(destination)
        driver.wait('return !document.querySelector("gk-repository-dialog") '
                    '&& document.querySelectorAll(".repo-tab-main[role=tab]").length === 2')
        assert git_requests() == clone_requests, 'Opening a completed repository started another Git transport'
        assert [checkout_footprint(fixtures, repository) for repository in (original, source)] == before
        report['repositoryCreationScope'] = {
            'picker': picker, 'transfer': transfer, 'persistedAfterRetirement': retired,
            'gitRequests': clone_requests, 'sourceAndOriginalUnchanged': True,
        }
        report['scenarios'].append('native-late-clone-can-be-opened-from-recents-without-replaying-git')
        return original, repo_id
    finally:
        hold.unlink(missing_ok=True)
        git_config.write_bytes(initial_config)
