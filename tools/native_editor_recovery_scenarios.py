"""Owned production-package recovery acceptance, without application test hooks."""
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import stat

from native_acceptance import open_ui, verified_installed_executable
from native_window_close import owned_application_pid


_INSTALLED_APP = Path('/usr/bin/git-khronos')


def private_recovery_owner_pid(driver):
    address = driver.session_bus_address
    if not driver.session or not address or not address.startswith('unix:abstract=git-khronos-test-'):
        raise RuntimeError('Installed crash acceptance requires the owned WebDriver session and private bus')
    reply = driver.single_instance_bus_call('GetConnectionUnixProcessID').splitlines()
    kind, _, value = (reply[-1].strip() if reply else '').partition(' ')
    if kind != 'uint32' or not value.isdecimal() or int(value) <= 1:
        raise RuntimeError('Private recovery bus did not identify an application process')
    return int(value)


def kill_owned_recovery_process(executable, fixture_root, data_home, expected_sha256, *, installed_driver=None):
    """Bind SIGKILL to one pidfd after executable/profile/identity verification."""
    executable = Path(executable).resolve(strict=True)
    root = Path(fixture_root).resolve(strict=True)
    data_home = Path(data_home).resolve(strict=True)
    profile = data_home.stat()
    if (data_home == root or not data_home.is_relative_to(root) or not stat.S_ISDIR(profile.st_mode)
            or profile.st_uid != os.geteuid() or stat.S_IMODE(profile.st_mode) & 0o077):
        raise RuntimeError('Crash acceptance requires a private fixture profile')
    if installed_driver is not None:
        if executable != _INSTALLED_APP or installed_driver.executable != executable:
            raise RuntimeError('Installed crash acceptance requires the reviewed system executable')
        verified_installed_executable(root / 'package/usr/bin/git-khronos', _INSTALLED_APP)
        pid = private_recovery_owner_pid(installed_driver)
    else:
        if not executable.is_relative_to(root / 'package'):
            raise RuntimeError('Crash acceptance requires an extracted fixture executable without an installed session')
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
        if installed_driver is not None:
            address = installed_driver.session_bus_address
            if ('DBUS_SESSION_BUS_ADDRESS=' + address).encode() not in environment:
                raise RuntimeError('Owned recovery process session bus does not match')
        with proc.joinpath('exe').open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        if digest != expected_sha256:
            raise RuntimeError('Owned recovery executable hash does not match')
        after = proc.joinpath('stat').read_text().rsplit(')', 1)[1].split()
        if before[19] != after[19] or after[0] in ('Z', 'X'):
            raise RuntimeError('Owned recovery process changed before crash dispatch')
        if installed_driver is not None and private_recovery_owner_pid(installed_driver) != pid:
            raise RuntimeError('Private recovery bus owner changed before crash dispatch')
        signal.pidfd_send_signal(descriptor, signal.SIGKILL)
        if not select.select([descriptor], [], [], 10)[0]:
            raise RuntimeError('Owned recovery process did not exit after crash dispatch')
        return {'pid': pid, 'startTimeTicks': before[19], 'executableSha256': digest,
                'signal': 'SIGKILL', 'pidfdExitConfirmed': True,
                'ownership': 'installed-private-bus' if installed_driver else 'extracted-fixture'}
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
        geometry = driver.click_scrolled_text(selector, text)
        report.setdefault('editorRecoveryClicks', []).append({'text': text, **geometry})

    def recovery_panel():
        driver.click('[aria-label="Main menu"]')
        driver.click_visible('.app-menu-popover [role=menuitem] strong', 'Editor draft recovery')
        driver.wait("return !!document.querySelector('gc-editor-draft-recovery [role=dialog]')")

    open_ui(driver, repository)
    driver.click('.wip-nav')
    selector = '[aria-label=' + json.dumps('View changes in ' + path) + ']'
    driver.context_click(selector)
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
    installed_driver = driver if report.get('installedExecutable') else None
    crash = kill_owned_recovery_process(driver.executable, fixtures.root,
                                       fixtures.env['XDG_DATA_HOME'], report['executableSha256'],
                                       installed_driver=installed_driver)
    report['editorRecoveryCrash'] = crash
    # The old app is conclusively dead. Session deletion is sent once; no file
    # operation or user decision is replayed when creating the replacement.
    driver.close()
    driver.wait_single_instance_release()
    driver.start(driver.executable)
    replacement = private_recovery_owner_pid(driver) if installed_driver else owned_application_pid(driver.executable)
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
