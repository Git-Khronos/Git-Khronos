"""Owned file-program fixtures through the packaged UI and public IPC boundary."""
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path
from native_acceptance import open_ui


def file_tools(driver, fixtures, original_repository, report):
    repository = fixtures.repository('external-file-tools-owned', commits=2)
    path = 'external [owned].txt'
    target = repository / path
    target.write_bytes(b'base\n')
    fixtures.git(repository, 'add', '--', path)
    fixtures.git(repository, 'commit', '-qm', 'Owned external tool baseline')
    main = fixtures.git(repository, 'branch', '--show-current').strip()
    fixtures.git(repository, 'checkout', '-qb', 'owned-incoming')
    target.write_bytes(b'incoming\n')
    fixtures.git(repository, 'commit', '-qam', 'Owned incoming side')
    fixtures.git(repository, 'checkout', main)
    target.write_bytes(b'current\n')
    fixtures.git(repository, 'commit', '-qam', 'Owned current side')
    config = (repository / '.git/config').read_bytes()
    refs = fixtures.git(repository, 'show-ref')
    recorder = fixtures.root / 'owned file program.py'
    records = fixtures.root / 'owned-file-program-records.jsonl'
    sentinel = fixtures.root / 'file-program-must-not-exist'
    literal = "space 'quotes'; touch " + str(sentinel) + '; $(not-a-command)'
    merged = b'owned resolved\x00bytes\xff\n'
    recorder.write_text('''import json, os, pathlib, sys
role, records, literal, *paths = sys.argv[1:]
row = {'role':role,'literal':literal,'paths':paths,'cwd':os.getcwd(),
       'gitDir':os.getenv('GIT_DIR'),'index':os.getenv('GIT_INDEX_FILE'),
       'askpass':os.getenv('GIT_ASKPASS'),'config':os.getenv('GIT_CONFIG_GLOBAL'),
       'bytes':[pathlib.Path(p).read_bytes().hex() for p in paths]}
if role == 'merge': pathlib.Path(paths[-1]).write_bytes(b'owned resolved\\x00bytes\\xff\\n')
if role == 'editor': pathlib.Path(paths[0]).write_bytes(b'owned editor saved\\n')
with pathlib.Path(records).open('a') as out: out.write(json.dumps(row)+'\\n')
''')
    sessions = set()

    def rows(count):
        end = time.monotonic() + 10
        while time.monotonic() < end:
            if records.exists():
                result = [json.loads(line) for line in records.read_text().splitlines()]
                if len(result) >= count:
                    assert len(result) == count, result
                    return result
            time.sleep(.02)
        raise AssertionError('Owned file program invocation not observed')

    def fill(selector, value, event='input'):
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ') && !document.querySelector(' + json.dumps(selector) + ').disabled')
        driver.script("const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event(arguments[2],{bubbles:true}));", selector, value, event)

    def button(text, scope='gc-file-tools-dialog'):
        driver.wait('return [...document.querySelectorAll(' + json.dumps(scope + ' button') + ')].some(e=>e.textContent.trim()===' + json.dumps(text) + ' && !e.disabled)')
        driver.click_scrolled_text(scope + ' button', text)

    def create_profile(role, arguments):
        driver.click('[aria-label="Preferences"]')
        driver.wait("return !!document.querySelector('#preferences-tab-terminal')")
        driver.click('#preferences-tab-terminal')
        button('New program profile', 'gc-configured-tools-panel')
        fill('[name=toolName]', 'Owned file ' + role)
        fill('[name=toolRole]', role, 'change')
        fill('[name=toolExecutable]', sys.executable)
        for number, argument in enumerate(['-I', str(recorder), role, str(records), literal, *arguments]):
            button('Add argument', 'gc-configured-tools-panel')
            fill('[aria-label=' + json.dumps('Program argument ' + str(number + 1)) + ']', argument)
        driver.click('[name=toolDefault]')
        button('Save program profile', 'gc-configured-tools-panel')
        driver.wait("return [...document.querySelectorAll('gc-configured-tools-panel [role=status]')].some(e=>e.textContent.includes('Profile saved.'))")
        driver.click('[aria-label="Close preferences"]')

    def preview():
        driver.click('.wip-nav')
        selector = '[aria-label=' + json.dumps('View changes in ' + path) + ']'
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ')')
        element = driver.script("const e=document.querySelector(arguments[0]);e.scrollIntoView({block:'center'});return e", selector)
        driver.request('POST', driver.path('actions'), {'actions': [{ 'type': 'pointer', 'id': 'owned-file-tool-menu',
            'parameters': {'pointerType': 'mouse'}, 'actions': [
                {'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0, 'duration': 0},
                {'type': 'pointerDown', 'button': 2}, {'type': 'pointerUp', 'button': 2}]}]})
        driver.click_text('[role=menuitem]', 'Preview file content')
        driver.wait("return !!document.querySelector('gc-file-content-dialog')")

    def capture_review(label, selector):
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ')')
        for width, height, name in [(1440, 900, 'normal'), (780, 560, 'compact')]:
            driver.request('POST', driver.path('window/rect'), {'width': width, 'height': height})
            driver.script("const e=document.querySelector(arguments[0]);if(!e)throw Error('Owned review disappeared');e.scrollIntoView({block:'start'});", selector)
            driver.script("return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
            assert driver.script("const e=document.querySelector(arguments[0]);const d=e.closest('[role=dialog]');return !!e && !!d && d.scrollWidth <= d.clientWidth+1 && d.getBoundingClientRect().left >= 0 && d.getBoundingClientRect().right <= innerWidth+1", selector)
            driver.screenshot(Path(report['artifactsDirectory']) / (label + '-' + name + '.png'))
        driver.request('POST', driver.path('window/rect'), {'width': 1440, 'height': 900})

    def launch(count):
        button('Review external program launch')
        driver.wait("return !!document.querySelector('gc-file-tools-dialog [aria-label=\"Review external program launch\"]')")
        assert driver.script("return [...document.querySelectorAll('gc-file-tools-dialog .arguments li')].map(e=>e.textContent.trim())")[4] == json.dumps(literal, ensure_ascii=False)
        assert not records.exists() if count == 1 else len(rows(count - 1)) == count - 1
        capture_review('file-tool-review-' + str(count), 'gc-file-tools-dialog [aria-label="Review external program launch"]')
        button('Start reviewed program')
        driver.wait("return [...document.querySelectorAll('gc-file-tools-dialog .sessions button')].some(e=>e.textContent.includes('Owned command exited'))")
        current = driver.invoke('list_file_tool_sessions')
        sessions.update(item['id'] for item in current)
        return rows(count)[-1]

    def cleanup():
        button('Review tool-session cleanup')
        driver.wait("return !!document.querySelector('gc-file-tools-dialog [aria-label=\"Review private tool-file cleanup\"]')")
        checkbox = 'gc-file-tools-dialog [aria-label="Review private tool-file cleanup"] input[type=checkbox]'
        driver.click(checkbox)
        button('Remove reviewed private copies and retire session')
        driver.wait("return [...document.querySelectorAll('gc-file-tools-dialog [role=status]')].some(e=>e.textContent.includes('Tool session retired.'))")
        sessions.clear()
        driver.click('[aria-label="Close external file tools"]')

    def assert_environment(row):
        assert row['literal'] == literal and row['cwd'] == str(repository), row
        assert row['gitDir'] is None and row['index'] is None and row['askpass'] is None, row
        assert row['config'] == fixtures.env['GIT_CONFIG_GLOBAL'], row
        assert not sentinel.exists()

    try:
        open_ui(driver, repository)
        for role, arguments in [('editor', ['{file}']), ('diff', ['{before}', '{after}']),
                                ('merge', ['{base}', '{before}', '{after}', '{merged}'])]:
            create_profile(role, arguments)
        assert not records.exists(), 'Saving profiles executed a command'
        target.write_bytes(b'working\n')
        # Ordinary context-menu preview and reviewed native comparison.
        driver.reload(); driver.wait("return !!document.querySelector('.commit-row')")
        preview()
        before_index = (repository / '.git/index').read_bytes()
        button('Compare with external program', 'gc-file-content-dialog')
        row = launch(1); assert_environment(row)
        assert row['bytes'] == [b'current\n'.hex(), b'working\n'.hex()], row
        assert target.read_bytes() == b'working\n' and (repository / '.git/index').read_bytes() == before_index
        assert all(not Path(p).is_relative_to(repository) for p in row['paths'])
        cleanup()
        report['scenarios'].append('native-ui-file-diff-exact-index-working-private-bytes-literal-argv-sanitized-context')

        button('Review external editor for working file', 'gc-file-content-dialog')
        row = launch(2); assert_environment(row)
        assert row['paths'] == [str(target)] and row['bytes'] == [b'working\n'.hex()], row
        assert target.read_bytes() == b'owned editor saved\n' and (repository / '.git/index').read_bytes() == before_index
        cleanup()
        button('Close', 'gc-file-content-dialog')
        report['scenarios'].append('native-ui-file-editor-saved-working-file-changes-without-index-change')

        target.write_bytes(b'current\n')
        merge = subprocess.run(['git', '-C', str(repository), 'merge', '--no-edit', 'owned-incoming'], env=fixtures.env, capture_output=True)
        assert merge.returncode == 1 and fixtures.git(repository, 'ls-files', '-u'), merge.stderr
        # Reload through the normal persisted repository tab; preserve saved profiles.
        driver.reload(); driver.wait("return !!document.querySelector('.commit-row')")
        driver.click('.wip-nav')
        driver.wait('return !!document.querySelector(' + json.dumps('[title="Open Merge Tool for ' + path + '"]') + ')')
        driver.click('[title="Open Merge Tool for ' + path + '"]')
        button('Review external merge program', '.merge-tool')
        conflict_bytes = target.read_bytes(); before_index = (repository / '.git/index').read_bytes()
        row = launch(3); assert_environment(row)
        assert row['bytes'][:3] == [b'base\n'.hex(), b'current\n'.hex(), b'incoming\n'.hex()], row
        assert target.read_bytes() == conflict_bytes and (repository / '.git/index').read_bytes() == before_index
        button('Inspect current merge output')
        driver.wait("return !!document.querySelector('gc-file-tools-dialog [aria-label=\"Review merge output\"]')")
        assert driver.script("return document.querySelector('gc-file-tools-dialog [aria-label=\"Review merge output\"]').textContent").find('Binary output') >= 0
        capture_review('file-tool-binary-result', 'gc-file-tools-dialog [aria-label="Review merge output"]')
        driver.click('gc-file-tools-dialog [aria-label="Review merge output"] input[type=checkbox]')
        button('Save reviewed merge output')
        driver.wait("return [...document.querySelectorAll('gc-file-tools-dialog [role=status]')].some(e=>e.textContent.includes('Reviewed output saved.'))")
        assert target.read_bytes() == merged and (repository / '.git/index').read_bytes() == before_index
        report['scenarios'].append('native-ui-file-merge-stage-roles-binary-output-review-save-without-staging')
        button('Review saved result for staging')
        capture_review('file-tool-stage-review', 'gc-file-tools-dialog [aria-label="Review tool-result staging"]')
        button('Stage reviewed saved result')
        driver.wait("return [...document.querySelectorAll('gc-file-tools-dialog [role=status]')].some(e=>e.textContent.trim()==='Saved result staged.')")
        assert not fixtures.git(repository, 'ls-files', '-u')
        assert subprocess.check_output(['git', '-C', str(repository), 'show', ':' + path], env=fixtures.env) == merged
        assert (repository / '.git/config').read_bytes() == config and fixtures.git(repository, 'show-ref') == refs
        cleanup()
        report['scenarios'].append('native-ui-file-merge-separate-reviewed-real-index-staging-and-private-cleanup')
        assert not driver.invoke('list_file_tool_sessions')
    finally:
        failing = sys.exc_info()[0] is not None
        if failing:
            try:
                directory = Path(report['artifactsDirectory'])
                driver.screenshot(directory / 'file-tools-failure.png')
                (directory / 'file-tools-failure.json').write_text(json.dumps(driver.script("return {tools:document.querySelector('gc-file-tools-dialog')?.innerText,preferences:document.querySelector('gc-preferences-dialog')?.innerText,body:document.body.innerText.slice(-12000)}"), indent=2))
            except Exception as error:
                report.setdefault('fileToolCaptureErrors', []).append(str(error))
        # A fixture failure preserves file copies for inspection. Never infer
        # GUI completion, replay a launch/write, or kill a process by saved PID.
        try:
            for identifier in sessions:
                driver.invoke('stop_file_tool_command', sessionId=identifier)
            open_ui(driver, original_repository)
        except Exception as error:
            if not failing: raise
            report.setdefault('fileToolCleanupErrors', []).append(str(error))
