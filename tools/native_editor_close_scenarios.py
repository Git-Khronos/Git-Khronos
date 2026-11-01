"""Actual owned Linux window-close requests and disk/index oracles."""
import json
import sys
import time
from pathlib import Path
from native_acceptance import open_ui
from native_window_close import owned_application_pid, process_running, request_owned_window_close


def approve_editor_window_close(driver, text, pid, report):
    # Observe one visible enabled control, then dispatch exactly one real click.
    element = driver.wait("return (() => {const buttons=[...document.querySelectorAll('gc-working-file-editor button')]"
                          + ".filter(button=>button.textContent.trim()===" + json.dumps(text)
                          + " && !button.matches(':disabled') && button.getClientRects().length);return buttons.length===1 ? buttons[0] : null;})()")
    identifier = element['element-6066-11e4-a52e-4f735466cecf']
    try:
        driver.request('POST', driver.path('element/' + identifier + '/click'), {})
    except RuntimeError as error:
        try: detail = json.loads(str(error))
        except (ValueError, TypeError): raise error
        value = detail.get('value', {}) if isinstance(detail, dict) else {}
        if not isinstance(value, dict) or value.get('error') != 'unknown error' or value.get('message') != 'Session terminated without a reply':
            raise
        deadline = time.monotonic() + 10
        while process_running(pid) and time.monotonic() < deadline: time.sleep(.02)
        if process_running(pid):
            raise RuntimeError('The approved close lost its reply but the owned application is still running') from error
        report.setdefault('editorWindowCloseTerminatedReplies', []).append({
            'pid': pid, 'action': text, 'ownedProcessExited': True, 'clickReplayed': False})


def editor_window_close(driver, fixtures, original_repository, report):
    repository = fixtures.repository('editor-window-close-owned', commits=2)
    path = 'close guarded [owned].txt'; file = repository / path
    file.write_bytes(b'committed baseline\n')
    fixtures.git(repository, 'add', '--', path)
    fixtures.git(repository, 'commit', '-qm', 'Owned close-guard baseline')
    file.write_bytes(b'working before close\n')
    index = (repository / '.git/index').read_bytes()
    config = (repository / '.git/config').read_bytes()
    refs = fixtures.git(repository, 'show-ref')
    executable = driver.executable

    def button(text):
        driver.wait('return [...document.querySelectorAll("gc-working-file-editor button")].some(button => button.textContent.trim() === '
                    + json.dumps(text) + ' && !button.disabled)')
        driver.click_text('gc-working-file-editor button', text)

    def edit():
        open_ui(driver, repository)
        driver.click('.wip-nav')
        selector = '[aria-label=' + json.dumps('View changes in ' + path) + ']'
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ')')
        element = driver.script("const row=document.querySelector(arguments[0]);row.scrollIntoView({block:'nearest'});return row", selector)
        driver.request('POST', driver.path('actions'), {'actions': [{
            'type': 'pointer', 'id': 'owned-window-editor-menu', 'parameters': {'pointerType': 'mouse'},
            'actions': [{'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0, 'duration': 0},
                        {'type': 'pointerDown', 'button': 2}, {'type': 'pointerUp', 'button': 2}],
        }]})
        driver.click_text('[role="menuitem"]', 'Preview file content')
        driver.wait("return [...document.querySelectorAll('gc-file-content-dialog button')].some(button=>button.textContent.trim()==='Edit working copy' && !button.disabled)")
        driver.click_text('gc-file-content-dialog button', 'Edit working copy')
        driver.wait("return !!document.querySelector('#working-editor-text') && !document.querySelector('#working-editor-text').readOnly")

    def text(value):
        driver.script("const input=document.querySelector('#working-editor-text');if(!input || input.readOnly) throw Error('Owned close editor unavailable');input.value=arguments[0];input.dispatchEvent(new Event('input',{bubbles:true}));", value)

    def request():
        delivery = request_owned_window_close(fixtures.env['DISPLAY'], executable)
        report.setdefault('editorWindowCloseDeliveries', []).append(delivery)
        driver.wait("return document.querySelector('[aria-label=\"Review unsaved draft\"]')?.textContent.includes('closing the window')")
        assert process_running(delivery['pid']), 'The window closed before the draft decision'
        return delivery['pid']

    def unchanged_metadata():
        assert (repository / '.git/index').read_bytes() == index
        assert (repository / '.git/config').read_bytes() == config
        assert fixtures.git(repository, 'show-ref') == refs

    def relaunch_after_close(pid):
        end = time.monotonic() + 10
        while process_running(pid) and time.monotonic() < end: time.sleep(.02)
        assert not process_running(pid), 'Approved window close did not stop the owned application'
        driver.close()
        driver.start(executable)
        driver.wait("return !!document.querySelector('.commit-row')", 60)
        replacement = owned_application_pid(executable)
        assert replacement != pid
        report.setdefault('editorWindowCloseRestarts', []).append({'oldPid': pid, 'newPid': replacement})

    try:
        edit(); text('saved before window close\n')
        pid = request()
        button('Keep editing')
        assert driver.script("return document.querySelector('#working-editor-text').value") == 'saved before window close\n'
        assert file.read_bytes() == b'working before close\n'
        unchanged_metadata()
        assert owned_application_pid(executable) == pid
        driver.screenshot(Path(report['artifactsDirectory']) / 'editor-window-close-kept-draft.png')
        report['scenarios'].append('native-ui-editor-icccm-window-close-keeps-dirty-draft-and-original-disk-index')

        pid = request()
        approve_editor_window_close(driver, 'Save draft', pid, report)
        relaunch_after_close(pid)
        assert file.read_bytes() == b'saved before window close\n'
        unchanged_metadata()
        report['scenarios'].append('native-ui-editor-icccm-save-before-window-close-writes-disk-without-staging-and-relaunches')

        edit(); text('explicitly discarded window draft\n')
        pid = request()
        approve_editor_window_close(driver, 'Discard draft', pid, report)
        relaunch_after_close(pid)
        assert file.read_bytes() == b'saved before window close\n'
        unchanged_metadata()
        report['scenarios'].append('native-ui-editor-icccm-discard-before-window-close-preserves-saved-disk-index-and-relaunches')
    finally:
        failing = sys.exc_info()[0] is not None
        if failing:
            try:
                directory = Path(report['artifactsDirectory'])
                driver.screenshot(directory / 'editor-window-close-failure.png')
                (directory / 'editor-window-close-failure.json').write_text(json.dumps(driver.script("return {editor:document.querySelector('gc-working-file-editor')?.innerText,preview:document.querySelector('gc-file-content-dialog')?.innerText}"), indent=2))
            except Exception as error:
                report.setdefault('windowCloseCaptureErrors', []).append(str(error))
        try:
            open_ui(driver, original_repository)
        except Exception as error:
            if not failing: raise
            report.setdefault('windowCloseCleanupErrors', []).append(str(error))
