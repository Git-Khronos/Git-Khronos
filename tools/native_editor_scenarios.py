"""Owned working-file editor fixtures through packaged IPC and normal WebKit UI."""
import json
import subprocess
import sys
from pathlib import Path
import uuid

from native_acceptance import open_ui


def working_file_editor(driver, fixtures, original_repository, report):
    repository = fixtures.repository('working-file-editor', commits=2)
    encode_le = lambda text: b'\xff\xfe' + text.encode('utf-16-le')
    formats = [
        ('utf8-bom.txt', None, lambda text: b'\xef\xbb\xbf' + text.encode('utf-8')),
        ('utf16-le.txt', None, encode_le),
        ('utf16-be.txt', None, lambda text: b'\xfe\xff' + text.encode('utf-16-be')),
        ('legacy.txt', 'windows1252', lambda text: text.encode('cp1252')),
    ]
    for path, _, encode in formats:
        (repository / path).write_bytes(encode('before\r\n'))
        (repository / path).chmod(0o750)
    ui_path = 'editor [owned].txt'
    (repository / ui_path).write_bytes(encode_le('baseline\r\n'))
    (repository / 'mixed.txt').write_bytes(b'a\r\nb\n')
    (repository / 'binary.txt').write_bytes(b'owned\0binary')
    (repository / 'readonly.txt').write_bytes(b'read only\n')
    (repository / 'readonly.txt').chmod(0o400)
    fixtures.git(repository, 'add', '--all')
    fixtures.git(repository, 'commit', '-qm', 'Owned editor formats and literal paths')
    initial_index = (repository / '.git/index').read_bytes()
    config = (repository / '.git/config').read_bytes()
    refs = fixtures.git(repository, 'show-ref')
    contexts = set()

    def index_bytes(path):
        return subprocess.check_output(['git', '-C', str(repository), 'show', ':' + path], env=fixtures.env)

    def call(command, **args):
        return driver.invoke(command, operationId=str(uuid.uuid4()), **args)

    def open_file(path, encoding=None):
        result = call('open_working_file_editor', repoId=repo_id, path=path, encoding=encoding)
        contexts.add(result['editorId'])
        return result

    def save(file, text, stage=False):
        return call('save_working_file_editor', editorId=file['editorId'], revision=file['revision'],
                    text=text, stage=stage)

    def close(file):
        driver.invoke('close_working_file_editor', editorId=file['editorId'])
        contexts.discard(file['editorId'])

    def refuses(command, **args):
        try:
            call(command, **args)
        except RuntimeError as error:
            return str(error)
        raise AssertionError('An invalid owned editor request unexpectedly succeeded')

    def button(text):
        driver.wait('return [...document.querySelectorAll("gc-working-file-editor button")].some(button => button.textContent.trim() === '
                    + json.dumps(text) + ' && !button.disabled)')
        driver.click_text('gc-working-file-editor button', text)

    def type_text(text):
        driver.script("const input=document.querySelector('#working-editor-text'); if(!input || input.readOnly) throw Error('Owned editor is not writable'); input.value=arguments[0]; input.dispatchEvent(new Event('input',{bubbles:true}));", text)

    try:
        repo_id = driver.invoke('open_repository', path=str(repository))['id']
        for path, encoding, encode in formats:
            opened = open_file(path, encoding)
            assert opened['text'] == 'before\n' and opened['lineEndings'] == 'crLf', opened
            saved = save(opened, 'saved é\n')
            assert saved['disk'] == 'saved' and saved['stage'] == 'notRequested', saved
            assert (repository / path).read_bytes() == encode('saved é\r\n')
            assert (repository / path).stat().st_mode & 0o777 == 0o750
            assert (repository / '.git/index').read_bytes() == initial_index
            assert 'workingFileEditorExpired' in refuses('save_working_file_editor', editorId=opened['editorId'],
                revision=opened['revision'], text='replay', stage=False)
            close(opened)
        assert (repository / '.git/config').read_bytes() == config
        assert fixtures.git(repository, 'show-ref') == refs
        report['scenarios'].append('native-editor-four-lossless-encodings-bom-crlf-mode-and-save-only-index-ref-config-preservation')

        opened = open_file('utf16-le.txt')
        staged = call('stage_saved_working_file_editor', editorId=opened['editorId'], revision=opened['revision'])
        assert staged['disk'] == 'unchanged' and staged['stage'] == 'staged', staged
        assert index_bytes('utf16-le.txt') == encode_le('saved é\r\n')
        close(opened)
        opened = open_file('utf8-bom.txt')
        saved = save(opened, 'save and stage\n', stage=True)
        assert saved['disk'] == 'saved' and saved['stage'] == 'staged', saved
        assert index_bytes('utf8-bom.txt') == b'\xef\xbb\xbfsave and stage\r\n'
        close(opened)
        report['scenarios'].append('native-editor-stage-saved-and-save-stage-use-real-index-and-rotate-revisions')

        opened = open_file('legacy.txt', 'windows1252')
        index_before = (repository / '.git/index').read_bytes()
        lock = repository / '.git/index.lock'
        lock.write_bytes(b'Owned staged-write refusal fixture\n')
        try:
            partial = save(opened, 'saved despite index refusal\n', stage=True)
            assert partial['disk'] == 'saved' and partial['stage'] == 'unconfirmed', partial
            assert partial['stageError'] is not None, partial
            assert 'workingFileEditorExpired' in refuses('save_working_file_editor', editorId=opened['editorId'],
                revision=opened['revision'], text='must not replay', stage=True)
            if partial['file'] is None:
                assert partial['warning'], partial
                assert 'workingFileEditorExpired' in refuses('save_working_file_editor', editorId=opened['editorId'],
                    revision=partial['revision'], text='invalidated context', stage=True)
            else:
                # A still-verifiable context is also a valid result; do not require
                # platform-specific invalidation merely because staging failed.
                current = partial['file']
                assert current['editorId'] == opened['editorId'] and current['revision'] == partial['revision'], partial
                assert current['path'] == 'legacy.txt' and current['text'] == 'saved despite index refusal\n', current
                assert current['encoding'] == 'windows1252' and current['bom'] is False, current
            assert (repository / 'legacy.txt').read_bytes() == b'saved despite index refusal\r\n'
            assert (repository / '.git/index').read_bytes() == index_before
            assert lock.read_bytes() == b'Owned staged-write refusal fixture\n'
        finally:
            lock.unlink()
            close(opened)
        recovered = open_file('legacy.txt', 'windows1252')
        assert recovered['text'] == 'saved despite index refusal\n', recovered
        restaged = call('stage_saved_working_file_editor', editorId=recovered['editorId'], revision=recovered['revision'])
        assert restaged['disk'] == 'unchanged' and restaged['stage'] == 'staged', restaged
        assert index_bytes('legacy.txt') == b'saved despite index refusal\r\n'
        close(recovered)
        report['scenarios'].append('native-editor-save-stage-partial-success-retains-actual-disk-index-and-owned-lock')

        opened = open_file('mixed.txt')
        assert opened['readOnlyReason'] and opened['lineEndings'] == 'mixed', opened
        assert 'workingFileMixedNewlines' in refuses('save_working_file_editor', editorId=opened['editorId'],
            revision=opened['revision'], text='normalized\n', stage=False)
        close(opened)
        readonly = open_file('readonly.txt')
        assert readonly['readOnlyReason'], readonly
        close(readonly)
        assert 'workingFileEncoding' in refuses('open_working_file_editor', repoId=repo_id, path='binary.txt', encoding=None)
        opened = open_file('utf16-be.txt')
        (repository / 'utf16-be.txt').write_bytes(b'external current bytes\n')
        assert 'workingFileEditRefused' in refuses('save_working_file_editor', editorId=opened['editorId'],
            revision=opened['revision'], text='stale write', stage=False)
        assert (repository / 'utf16-be.txt').read_bytes() == b'external current bytes\n'
        close(opened)
        report['scenarios'].append('native-editor-stale-disk-mixed-newline-readonly-and-binary-refusal-without-writes')

        # Enter the real production editor using an ordinary context menu.
        (repository / ui_path).write_bytes(encode_le('working\r\n'))
        open_ui(driver, repository)
        driver.click('.wip-nav')
        selector = '[aria-label=' + json.dumps('View changes in ' + ui_path) + ']'
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ')')
        element = driver.script("const row=document.querySelector(arguments[0]);row.scrollIntoView({block:'nearest'});return row", selector)
        driver.request('POST', driver.path('actions'), {'actions': [{
            'type': 'pointer', 'id': 'owned-editor-menu', 'parameters': {'pointerType': 'mouse'},
            'actions': [{'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0, 'duration': 0},
                        {'type': 'pointerDown', 'button': 2}, {'type': 'pointerUp', 'button': 2}],
        }]})
        driver.click_text('[role="menuitem"]', 'Preview file content')
        driver.wait("return !!document.querySelector('gc-file-content-dialog [role=dialog]')")
        driver.click_text('gc-file-content-dialog button', 'Edit working copy')
        driver.wait("return document.querySelector('#working-editor-text')?.value === 'working\\n'")
        actual_title = driver.invoke('plugin:window|title', label='main')
        assert repository.name in actual_title, actual_title
        report['editorNativeWindowTitle'] = actual_title
        type_text('saved through WebKit\n')
        button('Save file')
        driver.wait("return [...document.querySelectorAll('gc-working-file-editor [role=status]')].some(p=>p.textContent.trim()==='File saved.')")
        assert (repository / ui_path).read_bytes() == encode_le('saved through WebKit\r\n')
        assert index_bytes(ui_path) == encode_le('baseline\r\n')
        type_text('retained unsaved draft\n')
        button('Stage saved file')
        driver.wait("return [...document.querySelectorAll('gc-working-file-editor [role=status]')].some(p=>p.textContent.includes('Saved file staged.'))")
        assert index_bytes(ui_path) == encode_le('saved through WebKit\r\n')
        assert driver.script("return document.querySelector('#working-editor-text').value") == 'retained unsaved draft\n'
        driver.key('\ue00c')
        driver.wait("return !!document.querySelector('[aria-label=\"Review unsaved draft\"]')")
        button('Keep editing')
        assert driver.script("return document.querySelector('#working-editor-text').value") == 'retained unsaved draft\n'
        driver.screenshot(Path(report['artifactsDirectory']) / 'working-file-editor-saved-and-dirty.png')
        report['scenarios'].append('native-ui-editor-normal-menu-save-stage-saved-and-dirty-escape-preserve-real-utf16-bytes-index')

        # Staging can invalidate the conservative file context. The dirty draft is
        # retained until an explicit reload/discard; do not type into a readonly view.
        button('Reload disk')
        button('Discard draft')
        driver.wait("return !!document.querySelector('#working-editor-text') && !document.querySelector('#working-editor-text').readOnly")
        assert (repository / ui_path).read_bytes() == encode_le('saved through WebKit\r\n')
        markdown = '# Owned preview\n\n**bold** and *emphasis*\n\n<script>window.__ownedEditorScript=true</script>\n\n![inactive](https://unrequested.invalid/image) [inactive](javascript:alert%281%29)\n'
        type_text(markdown)
        button('Preview Markdown')
        driver.wait("return [...document.querySelectorAll('gc-markdown-preview [role=heading]')].some(h=>h.textContent.trim()==='Owned preview')")
        assert driver.script("return document.querySelector('gc-markdown-preview strong')?.textContent.trim()") == 'bold'
        assert driver.script("return document.querySelectorAll('gc-markdown-preview img, gc-markdown-preview script, gc-markdown-preview a[href], gc-markdown-preview iframe').length") == 0
        assert driver.script("return window.__ownedEditorScript === undefined")
        assert (repository / ui_path).read_bytes() == encode_le('saved through WebKit\r\n')
        assert index_bytes(ui_path) == encode_le('saved through WebKit\r\n')
        driver.screenshot(Path(report['artifactsDirectory']) / 'working-file-editor-inert-markdown.png')
        button('Edit text')
        assert driver.script("return document.querySelector('#working-editor-text').value") == markdown
        button('Back to preview')
        button('Discard draft')
        driver.wait("return !document.querySelector('gc-working-file-editor')")
        driver.key('\ue00c')
        report['scenarios'].append('native-ui-editor-real-webkit-worker-csp-inert-markdown-keeps-unsaved-draft-disk-index')
        assert (repository / '.git/config').read_bytes() == config
        assert fixtures.git(repository, 'show-ref') == refs
    finally:
        failing = sys.exc_info()[0] is not None
        if failing:
            try:
                destination = Path(report['artifactsDirectory'])
                driver.screenshot(destination / 'working-file-editor-failure.png')
                state = driver.script("return {editor:document.querySelector('gc-working-file-editor')?.innerText,editorHtml:document.querySelector('gc-working-file-editor')?.outerHTML,dialog:document.querySelector('gc-file-content-dialog')?.innerText,active:document.activeElement?.outerHTML}")
                (destination / 'working-file-editor-failure.json').write_text(json.dumps(state, indent=2))
            except Exception as error:
                report.setdefault('editorCaptureErrors', []).append(str(error))
        try:
            for identifier in contexts:
                driver.invoke('close_working_file_editor', editorId=identifier)
            if driver.script("return !!document.querySelector('gc-working-file-editor')"):
                button('Back to preview')
                if driver.script("return !!document.querySelector('[aria-label=\"Review unsaved draft\"]')"):
                    button('Discard draft')
            if driver.script("return !!document.querySelector('gc-file-content-dialog')"):
                driver.key('\ue00c')
            open_ui(driver, original_repository)
        except Exception as error:
            if not failing:
                raise
            report.setdefault('editorCleanupErrors', []).append(str(error))
