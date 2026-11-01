"""Project-created repository links through the real packaged native boundary."""
import json
import os
import shlex
import subprocess
from pathlib import Path
import threading
import time
import uuid

from native_acceptance import open_ui


def repository_links(driver, fixtures, original_repository, report):
    first = fixtures.repository('repository-link-first', commits=3)
    second = fixtures.repository('repository-link-second', commits=2)
    remote = 'git@owned-links.example.test:team/independent.git'
    other = 'git@owned-links.example.test:other/independent.git'
    config_file = Path(fixtures.env['GIT_CONFIG_GLOBAL'])
    global_config = config_file.read_bytes()
    # These fixtures never use a network transport, even if a regression tries one.
    config_file.write_bytes(global_config + b'\n[protocol "ssh"]\nallow = never\n[protocol "https"]\nallow = never\n')
    for repository in (first, second):
        fixtures.git(repository, 'remote', 'add', 'origin', remote)
    head = fixtures.git(first, 'rev-parse', 'HEAD')
    parent = fixtures.git(first, 'rev-parse', 'HEAD^')
    fixtures.git(first, 'branch', 'topic/shared', parent)
    fixtures.git(first, 'tag', '-a', 'owned-shared', '-m', 'Owned tag', parent)
    (first / 'fixture.txt').write_text('Retain owned local link edits\n')
    states = {path: dict(config=(path / '.git/config').read_bytes(),
                        index=(path / '.git/index').read_bytes(),
                        refs=fixtures.git(path, 'show-ref'),
                        head=fixtures.git(path, 'rev-parse', 'HEAD'),
                        dirty=(path / 'fixture.txt').read_bytes()) for path in (first, second)}

    def invoke(command, **args):
        return driver.invoke(command, **args, operationId=str(uuid.uuid4()))

    def refuses(command, kind, **args):
        try:
            invoke(command, **args)
        except RuntimeError as error:
            assert kind in str(error), error
        else:
            raise AssertionError('Invalid owned repository link unexpectedly succeeded')

    def button(text):
        driver.wait('return [...document.querySelectorAll("gc-repository-link-dialog button")].some(button => button.textContent.trim() === ' + json.dumps(text) + ' && !button.disabled)')
        driver.click_text('gc-repository-link-dialog button', text)

    try:
        for target in [dict(kind='repository'), dict(kind='commit', oid=parent),
                       dict(kind='reference', reference='refs/heads/topic/shared'),
                       dict(kind='reference', reference='refs/tags/owned-shared')]:
            uri = driver.invoke('create_repository_link', remote=remote, target=target)
            assert driver.invoke('parse_repository_link', rawLink=uri) == dict(remote=remote, target=target)
            result = invoke('discover_repository_link', rawLink=uri, knownPaths=[str(first), str(second), str(first)])
            assert result['inspectedPaths'] == 2 and len(result['matches']) == 2
            assert {entry['path'] for entry in result['matches']} == {str(first.resolve()), str(second.resolve())}
            assert all(entry['matchedRemotes'] == ['origin'] for entry in result['matches'])
            selected = next(entry for entry in result['matches'] if entry['path'] == str(first.resolve()))
            assert selected['target'] == (dict(kind='repository') if target['kind'] == 'repository' else dict(kind='commit', oid=parent))
        report['scenarios'].append('native-links-repository-commit-branch-tag-roundtrips-and-deduplicated-explicit-local-copies')

        repo_uri = driver.invoke('create_repository_link', remote=remote, target=dict(kind='repository'))
        refuses('discover_repository_link', 'invalidRepositoryLink', rawLink=repo_uri + '&remote=duplicate', knownPaths=[str(first)])
        refuses('discover_repository_link', 'invalidRepositoryLinkPaths', rawLink=repo_uri, knownPaths=['relative'])
        unrelated = driver.invoke('create_repository_link', remote=other, target=dict(kind='repository'))
        assert invoke('discover_repository_link', rawLink=unrelated, knownPaths=[str(first)])['matches'] == []
        refuses('open_repository_link', 'repositoryLinkMismatch', rawLink=unrelated, path=str(first))
        branch_uri = driver.invoke('create_repository_link', remote=remote, target=dict(kind='reference', reference='refs/heads/topic/shared'))
        refuses('open_repository_link', 'repositoryLinkChanged', rawLink=branch_uri, path=str(first), expectedOid=head)
        opened = invoke('open_repository_link', rawLink=branch_uri, path=str(first), expectedOid=parent)
        repo_id = opened['repository']['id']
        assert opened['inspection']['target'] == dict(kind='commit', oid=parent)
        assert opened['repository']['headOid'] == head
        assert driver.invoke('repository_link_read_policy', repoId=repo_id) == dict(noLazyReads=True, autoFetchPaused=True)
        assert driver.invoke('sync_repository', repoId=repo_id) is None
        assert driver.invoke('repository_link_read_policies')[repo_id]['autoFetchPaused'] is True
        report['scenarios'].append('native-links-stale-target-and-identity-refusal-local-browse-without-checkout-and-paused-background-fetch')

        open_ui(driver, first)
        driver.wait("return document.querySelector('.auto-fetch-status')?.textContent.includes('Auto-fetch paused')")
        driver.reload()
        driver.wait("return document.querySelector('.auto-fetch-status')?.textContent.includes('Auto-fetch paused')")
        driver.click('.auto-fetch-status')
        driver.wait("return !document.querySelector('.auto-fetch-status')?.textContent.includes('Auto-fetch paused')")
        assert driver.invoke('repository_link_read_policy', repoId=repo_id) == dict(noLazyReads=True, autoFetchPaused=False)
        report['scenarios'].append('native-ui-links-policy-hydration-after-webview-reload-and-explicit-schedule-resumption')

        driver.click('[aria-label="Command palette"]')
        driver.wait("return !!document.querySelector('[aria-label=\"Search commands\"]')")
        driver.script("const input=document.querySelector('[aria-label=\"Search commands\"]');input.value='Open repository link';input.dispatchEvent(new Event('input',{bubbles:true}));")
        driver.wait("return [...document.querySelectorAll('[role=option]')].some(button => button.textContent.includes('Open repository link'))")
        driver.click_visible('[role=option][title^="Open repository link"]')
        driver.wait("return !!document.querySelector('gc-repository-link-dialog textarea[aria-label=\"Repository link\"]')")
        driver.script("const input=document.querySelector('gc-repository-link-dialog textarea');input.value=arguments[0];input.dispatchEvent(new Event('input',{bubbles:true}));", branch_uri)
        button('Find local copies')
        driver.wait("return !!document.querySelector('gc-repository-link-dialog article')")
        button('Open this local copy')
        driver.wait("return !document.querySelector('gc-repository-link-dialog')")
        driver.wait("return document.querySelector('.auto-fetch-status')?.textContent.includes('Auto-fetch paused')")
        assert driver.script("return document.querySelector('.commit-row.selected')?.getAttribute('data-commit-oid')") == parent
        driver.screenshot(Path(report['artifactsDirectory']) / 'repository-link-native-local-target.png')
        report['scenarios'].append('native-ui-pasted-repository-link-reviewed-local-copy-and-original-commit-context-without-checkout')

        # A FIFO include proves native cancellation interrupts a running Git process.
        fifo = fixtures.root / 'repository-link-config.fifo'
        os.mkfifo(fifo, 0o600)
        before_config = (second / '.git/config').read_bytes()
        fixtures.git(second, 'config', '--add', 'include.path', str(fifo))
        connected, release = threading.Event(), threading.Event()
        def hold_configuration():
            fd = None
            try:
                while not release.is_set():
                    try:
                        fd = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
                        break
                    except OSError:
                        time.sleep(.02)
                if fd is not None:
                    os.write(fd, b'[owned]\nvalue = link-cancellation\n')
                    connected.set()
                    release.wait(15)
            finally:
                if fd is not None:
                    os.close(fd)
        writer = threading.Thread(target=hold_configuration, daemon=True)
        writer.start()
        operation = str(uuid.uuid4())
        try:
            driver.script("""
              window.__ownedRepositoryLinkRead = {done:false};
              window.__TAURI_INTERNALS__.invoke('discover_repository_link', arguments[0]).then(
                value => { window.__ownedRepositoryLinkRead={done:true,value}; },
                error => { window.__ownedRepositoryLinkRead={done:true,error}; });
            """, dict(rawLink=repo_uri, knownPaths=[str(second)], operationId=operation))
            assert connected.wait(10), 'Owned Git reader did not open the configuration FIFO'
            assert driver.invoke('cancel_git_operation', operationId=operation)
            driver.wait('return window.__ownedRepositoryLinkRead.done', 10)
            assert driver.script('return window.__ownedRepositoryLinkRead.error?.kind') == 'operationCancelled'
            assert not release.is_set(), 'Writer must remain held until cancellation completes'
        finally:
            release.set()
            writer.join(2)
            (second / '.git/config').write_bytes(before_config)
            fifo.unlink(missing_ok=True)
        report['scenarios'].append('native-links-cancellation-interrupts-running-owned-git-before-fifo-writer-is-released')

        promised = fixtures.repository('repository-link-promised', commits=2)
        promised_remote = 'ssh://git@owned-links.example.test/team/promised.git'
        fixtures.git(promised, 'remote', 'add', 'origin', promised_remote)
        fixtures.git(promised, 'config', 'remote.origin.promisor', 'true')
        fixtures.git(promised, 'config', 'remote.origin.partialclonefilter', 'blob:none')
        fixtures.git(promised, 'config', 'protocol.ssh.allow', 'always')
        marker = fixtures.root / 'repository-link-fetch-sentinel'
        helper = fixtures.root / 'repository-link-owned-ssh'
        helper.write_text('#!/bin/sh\n: > ' + shlex.quote(str(marker)) + '\nexit 1\n')
        helper.chmod(0o700)
        fixtures.git(promised, 'config', 'core.sshCommand', shlex.quote(str(helper)))
        promised_head = fixtures.git(promised, 'rev-parse', 'HEAD')
        blob = fixtures.git(promised, 'rev-parse', 'HEAD:fixture.txt')
        object_path = promised / '.git/objects' / blob[:2] / blob[2:]
        assert object_path.is_file(), 'Owned promised object must be loose before removal'
        object_path.unlink()
        control = subprocess.run(['git', '-C', str(promised), 'cat-file', 'blob', blob],
                                 env=fixtures.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert control.returncode != 0 and marker.exists(), 'Ordinary Git must activate the owned SSH sentinel'
        marker.unlink()
        promised_state = dict(config=(promised / '.git/config').read_bytes(), index=(promised / '.git/index').read_bytes(),
                              refs=fixtures.git(promised, 'show-ref'), dirty=(promised / 'fixture.txt').read_bytes())
        promised_uri = driver.invoke('create_repository_link', remote=promised_remote, target=dict(kind='commit', oid=promised_head))
        promised_open = invoke('open_repository_link', rawLink=promised_uri, path=str(promised), expectedOid=promised_head)
        try:
            driver.invoke('inspect_commit_file', repoId=promised_open['repository']['id'], oid=promised_head, path='fixture.txt')
        except RuntimeError:
            pass  # Git cannot generate the selected patch without its missing blob.
        else:
            raise AssertionError('A missing promised patch object was treated as readable')
        assert not marker.exists() and not object_path.exists()
        assert (promised / '.git/config').read_bytes() == promised_state['config']
        assert (promised / '.git/index').read_bytes() == promised_state['index']
        assert fixtures.git(promised, 'show-ref') == promised_state['refs']
        assert (promised / 'fixture.txt').read_bytes() == promised_state['dirty']
        report['scenarios'].append('native-links-composed-snapshot-and-followup-patch-read-never-fetch-missing-promised-blob-with-positive-control')

        for path, state in states.items():
            assert (path / '.git/config').read_bytes() == state['config']
            assert (path / '.git/index').read_bytes() == state['index']
            assert fixtures.git(path, 'show-ref') == state['refs']
            assert fixtures.git(path, 'rev-parse', 'HEAD') == state['head']
            assert (path / 'fixture.txt').read_bytes() == state['dirty']
        report['scenarios'].append('native-links-preserve-exact-config-index-refs-head-and-dirty-working-bytes')
    except Exception:
        driver.screenshot(Path(report['artifactsDirectory']) / 'repository-link-native-failure.png')
        raise
    finally:
        config_file.write_bytes(global_config)
        open_ui(driver, original_repository)
