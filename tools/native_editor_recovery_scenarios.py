"""Owned production-package recovery acceptance, without application test hooks."""
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import stat

from native_acceptance import open_ui
from native_window_close import owned_application_pid


def kill_owned_recovery_process(executable, fixture_root, data_home, expected_sha256):
    """Bind SIGKILL to one pidfd after executable/profile/identity verification."""
    executable = Path(executable).resolve(strict=True)
    root = Path(fixture_root).resolve(strict=True)
    data_home = Path(data_home).resolve(strict=True)
    if not executable.is_relative_to(root / 'package') or not data_home.is_relative_to(root):
        raise RuntimeError('Crash acceptance requires an extracted fixture executable and private profile')
    pid = owned_application_pid(executable)
    descriptor = os.pidfd_open(pid)
    try:
        proc = Path('/proc') / str(pid)
        before = proc.joinpath('stat').read_text().rsplit(')', 1)[1].split()
        if proc.stat().st_uid != os.geteuid() or proc.joinpath('exe').readlink() != executable:
            raise RuntimeError('Owned recovery process identity changed')
        environment = proc.joinpath('environ').read_bytes().split(b'\0')
        if ('XDG_DATA_HOME=' + str(data_home)).encode() not in environment:
            raise RuntimeError('Owned recovery process profile does not match')
        with proc.joinpath('exe').open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        if digest != expected_sha256:
            raise RuntimeError('Owned recovery executable hash does not match')
        after = proc.joinpath('stat').read_text().rsplit(')', 1)[1].split()
        if before[19] != after[19] or after[0] in ('Z', 'X'):
            raise RuntimeError('Owned recovery process changed before crash dispatch')
        signal.pidfd_send_signal(descriptor, signal.SIGKILL)
        if not select.select([descriptor], [], [], 10)[0]:
            raise RuntimeError('Owned recovery process did not exit after crash dispatch')
        return {'pid': pid, 'startTimeTicks': before[19], 'executableSha256': digest,
                'signal': 'SIGKILL', 'pidfdExitConfirmed': True}
    finally:
        os.close(descriptor)


def editor_draft_recovery(driver, fixtures, original_repository, report):
    repository = fixtures.repository('editor-crash-recovery', commits=2)
    path = 'recovery [owned].txt'
    file = repository / path
    baseline = b'\xef\xbb\xbfbaseline\r\n'
    working = b'\xef\xbb\xbfworking before crash\r\n'
    draft = 'retained after crash é\n<img src="https://unrequested.invalid/never">\n'
    file.write_bytes(baseline)
    fixtures.git(repository, 'add', '--all')
    fixtures.git(repository, 'commit', '-qm', 'Owned crash recovery baseline')
    file.write_bytes(working)
    index = (repository / '.git/index').read_bytes()
    config = (repository / '.git/config').read_bytes()
    refs = fixtures.git(repository, 'show-ref')

    def metadata_unchanged():
        assert (repository / '.git/index').read_bytes() == index
        assert (repository / '.git/config').read_bytes() == config
        assert fixtures.git(repository, 'show-ref') == refs

    def button(selector, text):
        driver.wait('return [...document.querySelectorAll(' + json.dumps(selector)
                    + ')].some(b=>b.textContent.trim()===' + json.dumps(text) + '&&!b.disabled)')
        driver.click_text(selector, text)

    def recovery_panel():
        driver.click('[aria-label="Main menu"]')
        driver.click_text('[role=menuitem] strong', 'Editor draft recovery')
        driver.wait("return !!document.querySelector('gc-editor-draft-recovery [role=dialog]')")

    open_ui(driver, repository)
    driver.click('.wip-nav')
    selector = '[aria-label=' + json.dumps('View changes in ' + path) + ']'
    element = driver.wait('return document.querySelector(' + json.dumps(selector) + ')')
    driver.script("arguments[0].scrollIntoView({block:'nearest'})", element)
    driver.request('POST', driver.path('actions'), {'actions': [{
        'type': 'pointer', 'id': 'owned-recovery-editor-menu', 'parameters': {'pointerType': 'mouse'},
        'actions': [{'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0, 'duration': 0},
                    {'type': 'pointerDown', 'button': 2}, {'type': 'pointerUp', 'button': 2}],
    }]})
    driver.click_text('[role=menuitem]', 'Preview file content')
    button('gc-file-content-dialog button', 'Edit working copy')
    driver.wait("return !!document.querySelector('#working-editor-text')&&!document.querySelector('#working-editor-text').readOnly")
    driver.script("const input=document.querySelector('#working-editor-text');input.value=arguments[0];input.dispatchEvent(new Event('input',{bubbles:true}));", draft)
    driver.wait("return [...document.querySelectorAll('gc-working-file-editor [role=status]')].some(p=>p.textContent.includes('Local recovery copy saved.'))")
    inventory = driver.invoke('inspect_editor_drafts')
    entries = [entry for entry in inventory['entries'] if (entry.get('draft') or {}).get('repositoryPath') == str(repository)]
    assert not inventory['incomplete'] and len(entries) == 1, inventory
    source = entries[0]
    reference = {key: source[key] for key in ('id', 'kind', 'reviewToken')}
    record = driver.invoke('load_editor_draft_entry', **reference)
    assert record['text'] == draft
    assert record['gitContext'] == {
        'workingReference': fixtures.git(repository, 'symbolic-ref', 'HEAD'),
        'headOid': fixtures.git(repository, 'rev-parse', 'HEAD'),
    }, record['gitContext']
    assert record['encoding'] == 'utf8'
    assert record['baselineSha256'] == hashlib.sha256(b'working before crash\n').hexdigest()
    assert source['kind'] == 'committed'
    cache_directory = Path(fixtures.env['XDG_DATA_HOME']) / 'org.gitkhronos.desktop/editor-drafts-v1'
    cache_file = cache_directory / (source['id'] + '.json')
    directory_stat = cache_directory.lstat()
    file_stat = cache_file.lstat()
    assert stat.S_ISDIR(directory_stat.st_mode) and stat.S_IMODE(directory_stat.st_mode) == 0o700
    assert stat.S_ISREG(file_stat.st_mode) and stat.S_IMODE(file_stat.st_mode) == 0o600
    assert directory_stat.st_uid == file_stat.st_uid == os.geteuid()
    assert file_stat.st_nlink == 1
    cache_bytes = cache_file.read_bytes()
    assert json.loads(cache_bytes)['text'] == draft
    report['editorRecoveryCache'] = {'sha256': hashlib.sha256(cache_bytes).hexdigest(),
                                    'directoryMode': '0700', 'fileMode': '0600', 'ownerVerified': True}
    assert file.read_bytes() == working
    metadata_unchanged()
    driver.screenshot(Path(report['artifactsDirectory']) / 'recovery-before-crash.png')
    crash = kill_owned_recovery_process(driver.executable, fixtures.root,
                                       fixtures.env['XDG_DATA_HOME'], report['executableSha256'])
    report['editorRecoveryCrash'] = crash
    # The old app is conclusively dead. Session deletion is sent once; no file
    # operation or user decision is replayed when creating the replacement.
    driver.close()
    driver.start(driver.executable)
    replacement = owned_application_pid(driver.executable)
    assert replacement != crash['pid']
    crash['replacementPid'] = replacement
    open_ui(driver, repository)
    assert file.read_bytes() == working
    assert cache_file.read_bytes() == cache_bytes
    metadata_unchanged()
    recovery_panel()
    driver.wait('return [...document.querySelectorAll("gc-editor-draft-recovery nav button")].some(b=>b.textContent.includes(' + json.dumps(path) + '))')
    entry = driver.script('return [...document.querySelectorAll("gc-editor-draft-recovery nav button")].find(b=>b.textContent.includes(arguments[0]))', path)
    identifier = entry['element-6066-11e4-a52e-4f735466cecf']
    driver.request('POST', driver.path('element/' + identifier + '/click'), {})
    driver.wait('return document.querySelector("#retained-editor-text")?.value===' + json.dumps(draft))
    assert driver.script("return document.querySelectorAll('gc-editor-draft-recovery img,gc-editor-draft-recovery iframe').length") == 0
    button('gc-editor-draft-recovery button', 'Review working file')
    driver.wait("return document.querySelector('#working-editor-text')?.value==='working before crash\\n'")
    button('gc-working-file-editor button', 'Load recovered text into editor')
    driver.wait('return document.querySelector("#working-editor-text")?.value===' + json.dumps(draft))
    assert file.read_bytes() == working
    assert cache_file.read_bytes() == cache_bytes
    metadata_unchanged()
    driver.screenshot(Path(report['artifactsDirectory']) / 'recovery-reviewed-before-save.png')
    button('gc-working-file-editor button', 'Save file')
    driver.wait("return [...document.querySelectorAll('gc-working-file-editor [role=status]')].some(p=>p.textContent.trim()==='File saved.')")
    assert file.read_bytes() == b'\xef\xbb\xbf' + draft.replace('\n', '\r\n').encode()
    metadata_unchanged()
    driver.wait('return !document.querySelector("gc-working-file-editor [role=alert]")')
    remaining = driver.invoke('inspect_editor_drafts')
    assert not remaining['incomplete'] and not any(entry['id'] == source['id'] for entry in remaining['entries']), remaining
    assert not cache_file.exists()
    report['scenarios'].extend([
        'native-recovery-ui-snapshot-ack-before-owned-pidfd-crash-and-private-profile-relaunch',
        'native-recovery-explicit-inert-review-load-without-disk-index-ref-config-mutation',
        'native-recovery-explicit-save-preserves-bom-crlf-and-index-cleans-reviewed-source',
    ])
    button('gc-working-file-editor button', 'Back to preview')
    driver.key('\ue00c')
    open_ui(driver, original_repository)
