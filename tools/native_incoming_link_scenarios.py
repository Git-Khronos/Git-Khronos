"""Own-scheme startup and singleton delivery through the exact packaged executable."""
import json
import shlex
from pathlib import Path
import subprocess
import time

from native_acceptance import open_ui


def incoming_repository_links(driver, fixtures, original_repository, report):
    git_config = Path(fixtures.env['GIT_CONFIG_GLOBAL'])
    original_git_config = git_config.read_bytes()
    git_config.write_bytes(original_git_config + b'\n[protocol \"ssh\"]\nallow = never\n[protocol \"https\"]\nallow = never\n')
    repository = fixtures.repository('incoming-link-owned', commits=3)
    remote = 'ssh://owned@incoming.example.test/team/independent.git'
    fixtures.git(repository, 'remote', 'add', 'origin', remote)
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    parent = fixtures.git(repository, 'rev-parse', 'HEAD^')
    (repository / 'fixture.txt').write_text('Owned incoming-link draft\n')
    before = dict(config=(repository / '.git/config').read_bytes(),
                  index=(repository / '.git/index').read_bytes(),
                  refs=fixtures.git(repository, 'show-ref'),
                  dirty=(repository / 'fixture.txt').read_bytes())
    uri = driver.invoke('create_repository_link', remote=remote, target=dict(kind='commit', oid=parent))
    other = driver.invoke('create_repository_link', remote=remote, target=dict(kind='commit', oid=head))

    def snapshot():
        return driver.invoke('incoming_repository_links')

    def pids():
        found = []
        for link in Path('/proc').glob('[0-9]*/exe'):
            try:
                if link.readlink() == driver.executable:
                    found.append(int(link.parent.name))
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                pass
        return sorted(found)

    def deliver(*arguments):
        original = pids()
        assert len(original) == 1, original
        child = subprocess.Popen([str(driver.executable), *arguments], env=fixtures.env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 start_new_session=True)
        try:
            stdout, stderr = child.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate()
            raise AssertionError('Secondary link delivery did not terminate')
        assert child.returncode == 0, (child.returncode, stderr.decode(errors='replace')[-2000:])
        assert pids() == original, 'Singleton delivery replaced or duplicated the primary process'
        report.setdefault('incomingLinkDeliveries', []).append(dict(primaryPid=original[0], secondaryPid=child.pid,
                                                                   exitCode=child.returncode, arguments=len(arguments)))

    def wait_count(count):
        driver.wait('return document.querySelector(".incoming-link-inbox b")?.textContent.trim() === ' + json.dumps(str(count)))

    def click(text):
        driver.click_text('gc-repository-link-dialog button', text)

    try:
        open_ui(driver, repository)
        repo_id = driver.invoke('open_repository', path=str(repository))['id']
        tabs = driver.script("return localStorage.getItem('git-khronos.open-repositories.v1')")
        assert snapshot() == dict(requests=[], overflowed=False)
        deliver(uri, uri)
        wait_count(1)
        first = snapshot()['requests'][0]
        assert first['payload']['uri'] == uri
        assert driver.invoke('repository_link_read_policy', repoId=repo_id) == dict(noLazyReads=True, autoFetchPaused=True)
        assert driver.invoke('sync_repository', repoId=repo_id) is None
        driver.click('[aria-label="Incoming repository links"]')
        driver.wait('return !!document.querySelector("gc-incoming-links-dialog")')
        click('Review local context…')
        driver.wait('return !!document.querySelector(' + json.dumps('textarea[aria-label="Repository link"]') + ')')
        deliver(other)
        wait_count(2)
        assert driver.script('return document.querySelector(' + json.dumps('textarea[aria-label="Repository link"]') + ').value') == uri
        assert driver.script("return localStorage.getItem('git-khronos.open-repositories.v1')") == tabs
        driver.click('[aria-label="Close repository link"]')
        driver.wait('return !!document.querySelector("gc-incoming-links-dialog")')
        assert snapshot()['requests'][0] == first
        report['scenarios'].append('native-incoming-warm-singleton-literal-argv-dedup-no-retarget-no-navigation-and-temporary-fetch-pause')

        driver.reload()
        wait_count(2)
        assert snapshot()['requests'][0] == first
        driver.invoke('acknowledge_incoming_repository_link', requestId=first['id'])
        remaining = snapshot()['requests']
        assert len(remaining) == 1 and remaining[0]['payload']['uri'] == other
        try:
            driver.invoke('acknowledge_incoming_repository_link', requestId=first['id'])
        except RuntimeError as error:
            assert 'staleIncomingRepositoryLink' in str(error)
        else:
            raise AssertionError('Stale incoming acknowledgement unexpectedly succeeded')
        driver.invoke('acknowledge_incoming_repository_link', requestId=remaining[0]['id'])
        assert snapshot() == dict(requests=[], overflowed=False)
        assert driver.invoke('repository_link_read_policy', repoId=repo_id) == dict(noLazyReads=False, autoFetchPaused=False)
        report['scenarios'].append('native-incoming-webview-reload-retains-inbox-exact-acknowledgement-and-stale-ack-refusal')

        # Register only inside this fixture's private XDG roots. The packaged
        # entry is checked before rebasing its executable to the extracted path.
        desktop = fixtures.root / 'package/usr/share/applications/git-khronos.desktop'
        entry = desktop.read_text()
        assert '\nExec=git-khronos %U\n' in entry
        assert '\nMimeType=x-scheme-handler/git-khronos;\n' in entry
        applications = Path(fixtures.env['XDG_DATA_HOME']) / 'applications'
        applications.mkdir(exist_ok=True)
        # Our fixture paths contain no reserved desktop Exec characters. Keep
        # quoting explicit nevertheless; never interpret a URI through a shell.
        binary = str(driver.executable)
        assert not any(character in binary for character in '\\"`$%\n')
        handler = applications / 'owned-incoming.desktop'
        handler.write_text(entry.replace('Exec=git-khronos %U', 'Exec="' + binary + '" %U'))
        mimeapps = Path(fixtures.env['XDG_CONFIG_HOME']) / 'mimeapps.list'
        previous_mimeapps = mimeapps.read_bytes() if mimeapps.exists() else None
        mimeapps.write_text('[Default Applications]\nx-scheme-handler/git-khronos=owned-incoming.desktop;\n')
        association_env = dict(fixtures.env, XDG_DATA_DIRS=str(applications.parent),
                               XDG_CONFIG_DIRS=fixtures.env['XDG_CONFIG_HOME'],
                               GIO_USE_VFS='local', GIO_USE_VOLUME_MONITOR='unix')
        original_pids = pids()
        try:
            subprocess.run(['desktop-file-validate', str(handler)], env=association_env,
                           capture_output=True, check=True, timeout=10)
            subprocess.run(['update-desktop-database', str(applications)], env=association_env,
                           capture_output=True, check=True, timeout=10)
            association = subprocess.run(['gio', 'mime', 'x-scheme-handler/git-khronos'],
                                         env=association_env, capture_output=True, check=True, timeout=10)
            assert 'owned-incoming.desktop' in association.stdout.decode()
            subprocess.run(['gio', 'open', uri], env=association_env,
                           capture_output=True, check=True, timeout=15)
            wait_count(1)
            deadline = time.monotonic() + 5
            while pids() != original_pids and time.monotonic() < deadline:
                time.sleep(.02)
            assert pids() == original_pids
            queued = snapshot()['requests']
            assert len(queued) == 1 and queued[0]['payload']['uri'] == uri
            driver.invoke('acknowledge_incoming_repository_link', requestId=queued[0]['id'])
            report['scenarios'].append('native-incoming-linux-gio-scheme-association-from-packaged-entry-in-private-xdg-to-existing-process')
        finally:
            handler.unlink(missing_ok=True)
            if previous_mimeapps is None:
                mimeapps.unlink(missing_ok=True)
            else:
                mimeapps.write_bytes(previous_mimeapps)

        # Normal startup arguments, before saved-tab restoration; a new process,
        # rather than a WebView reload, must receive this request.
        promised = fixtures.repository('incoming-startup-promisor', commits=2)
        fixtures.git(promised, 'remote', 'add', 'origin', remote)
        fixtures.git(promised, 'config', 'remote.origin.promisor', 'true')
        fixtures.git(promised, 'config', 'remote.origin.partialclonefilter', 'blob:none')
        fixtures.git(promised, 'config', 'protocol.ssh.allow', 'always')
        sentinel = fixtures.root / 'incoming-startup-fetch-sentinel'
        helper = fixtures.root / 'incoming-startup-owned-ssh'
        helper.write_text('#!/bin/sh\n: > ' + shlex.quote(str(sentinel)) + '\nexit 1\n')
        helper.chmod(0o700)
        fixtures.git(promised, 'config', 'core.sshCommand', shlex.quote(str(helper)))
        promised_head = fixtures.git(promised, 'rev-parse', 'HEAD')
        blob = fixtures.git(promised, 'rev-parse', 'HEAD:fixture.txt')
        missing_object = promised / '.git/objects' / blob[:2] / blob[2:]
        assert missing_object.is_file()
        missing_object.unlink()
        (promised / 'fixture.txt').write_text('Owned cold-start promisor draft\n')
        control = subprocess.run(['git', '-C', str(promised), 'cat-file', 'blob', blob],
                                 env=fixtures.env, capture_output=True, timeout=15)
        assert control.returncode != 0 and sentinel.exists()
        sentinel.unlink()
        seeded_workspace = driver.script("""
          const paths = arguments[0];
          const stored = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1'));
          const layouts = Array.isArray(stored) ? stored : [];
          const active = localStorage.getItem('git-khronos.active-workspace.v1');
          let layout = layouts.find(value => value.id === active) ?? layouts[0];
          if (!layout) { layout = { id: 'owned-cold-incoming', name: 'Owned cold-start fixture' }; layouts.push(layout); }
          layout.repositoryPaths = paths;
          layout.activeRepositoryPath = paths[0];
          localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify(layouts));
          localStorage.setItem('git-khronos.active-workspace.v1', layout.id);
          localStorage.setItem('git-khronos.open-repositories.v1', JSON.stringify(paths));
          localStorage.setItem('git-khronos.active-repository.v1', paths[0]);
          return { id: layout.id, paths };
        """, [str(repository), str(promised)])
        report['incomingLinkSavedWorkspace'] = seeded_workspace
        tabs = driver.script("return localStorage.getItem('git-khronos.open-repositories.v1')")
        restart = driver.restart_application(args=[uri, uri, '--owned-unrelated-argument'])
        report.setdefault('applicationRestarts', []).append(restart | dict(incomingLink=True))
        wait_count(1)
        report['incomingLinkStorageAfterRestart'] = driver.script("return { tabs: localStorage.getItem('git-khronos.open-repositories.v1'), layouts: localStorage.getItem('git-khronos.workspaces.v1'), active: localStorage.getItem('git-khronos.active-workspace.v1') }")
        driver.wait("return document.querySelectorAll('.commit-row[data-commit-oid]').length > 0", 60)
        assert driver.script("return localStorage.getItem('git-khronos.open-repositories.v1')") == tabs
        assert snapshot()['requests'][0]['payload']['uri'] == uri
        driver.wait('return !document.querySelector(".incoming-link-inbox")?.disabled', 60)
        assert driver.script("return localStorage.getItem('git-khronos.open-repositories.v1')") == tabs
        assert not sentinel.exists(), 'Cold saved-tab restoration activated lazy fetching'
        promised_id = driver.invoke('open_repository', path=str(promised))['id']
        driver.wait('return !!document.querySelector(' + json.dumps('[data-repository-tab-id="' + promised_id + '"]') + ')')
        try:
            driver.invoke('inspect_commit_file', repoId=promised_id, oid=promised_head, path='fixture.txt')
        except RuntimeError:
            pass
        else:
            raise AssertionError('Cold-restored missing promised patch was treated as readable')
        assert not sentinel.exists() and not missing_object.exists()
        assert (promised / 'fixture.txt').read_text() == 'Owned cold-start promisor draft\n'
        report['scenarios'].append('native-incoming-cold-saved-promisor-restoration-and-patch-read-never-fetch-with-independent-positive-control')
        repo_id = driver.invoke('open_repository', path=str(repository))['id']
        assert driver.invoke('sync_repository', repoId=repo_id) is None
        driver.invoke('acknowledge_incoming_repository_link', requestId=snapshot()['requests'][0]['id'])
        report['scenarios'].append('native-incoming-cold-application-process-startup-deduplicates-link-before-saved-tabs-and-preserves-tabs')

        secret = 'owned-invalid-credential-never-publish'
        deliver('git-khronos://repository?v=1&remote=https://user:' + secret + '@example.test/owned.git',
                'git-khronos:' + 'x' * 9000)
        wait_count(1)
        state = snapshot()
        assert len(state['requests']) == 1 and state['requests'][0]['payload']['kind'] == 'rejected'
        assert secret not in json.dumps(state) and len(json.dumps(state)) < 1000
        driver.invoke('acknowledge_incoming_repository_link', requestId=state['requests'][0]['id'])
        links = [driver.invoke('create_repository_link', remote=remote,
                               target=dict(kind='reference', reference=f'refs/heads/incoming-{index}')) for index in range(10)]
        deliver(*links)
        wait_count(8)
        state = snapshot()
        assert state['overflowed'] is True and len(state['requests']) == 8
        assert [row['payload']['uri'] for row in state['requests']] == links[:8]
        for row in state['requests']:
            driver.invoke('acknowledge_incoming_repository_link', requestId=row['id'])
        assert snapshot() == dict(requests=[], overflowed=True)
        assert driver.invoke('sync_repository', repoId=repo_id) is None
        driver.invoke('dismiss_incoming_repository_link_overflow')
        assert snapshot() == dict(requests=[], overflowed=False)
        assert driver.invoke('repository_link_read_policy', repoId=repo_id) == dict(noLazyReads=False, autoFetchPaused=False)
        assert before == dict(config=(repository / '.git/config').read_bytes(),
                              index=(repository / '.git/index').read_bytes(),
                              refs=fixtures.git(repository, 'show-ref'),
                              dirty=(repository / 'fixture.txt').read_bytes())
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == head
        report['scenarios'].append('native-incoming-redacted-malformed-oversize-bounded-fifo-overflow-and-owned-git-state-preservation')
    finally:
        try:
            for row in snapshot()['requests']:
                driver.invoke('acknowledge_incoming_repository_link', requestId=row['id'])
            driver.invoke('dismiss_incoming_repository_link_overflow')
            open_ui(driver, original_repository)
        finally:
            git_config.write_bytes(original_git_config)
