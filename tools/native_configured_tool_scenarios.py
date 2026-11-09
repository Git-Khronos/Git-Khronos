"""Owned program fixtures; normal packaged IPC and DOM flows, no app-state injection."""
import json
import sys
import time
from pathlib import Path
from native_acceptance import open_ui


def configured_tools(driver, fixtures, original_repository, report):
    repository = fixtures.repository('configured-tools-owned', commits=2)
    recorder = fixtures.root / 'owned configured recorder.py'
    records = fixtures.root / 'configured-program-records.jsonl'
    sentinel = fixtures.root / 'configured-must-not-exist'
    recorder.write_text("""import json, os, pathlib, sys
with pathlib.Path(sys.argv[1]).open('a') as output:
    output.write(json.dumps({'args': sys.argv[2:], 'cwd': os.getcwd(), 'tty': [os.isatty(0), os.isatty(1)], 'gitDir': os.getenv('GIT_DIR'), 'index': os.getenv('GIT_INDEX_FILE'), 'config': os.getenv('GIT_CONFIG_GLOBAL')}) + '\\n')
print('Owned configured session ready', flush=True)
for line in sys.stdin:
    if line.strip() == 'owned-exit': break
""")
    literal = "space 'quotes'; touch " + str(sentinel) + '; $(not-a-command)'
    profile = dict(version=1, id='owned-native-program', name='Owned configured recorder',
                   role='terminal', executable=sys.executable,
                   arguments=['-I', str(recorder), str(records), literal, '{repository}'])
    index = (repository / '.git/index').read_bytes()
    config = (repository / '.git/config').read_bytes()
    refs = fixtures.git(repository, 'show-ref')
    sessions = set()

    def observed(count):
        end = time.monotonic() + 10
        while time.monotonic() < end:
            if records.exists():
                rows = [json.loads(line) for line in records.read_text().splitlines()]
                if len(rows) >= count: return rows
            time.sleep(.02)
        raise AssertionError('The owned configured program did not record its invocation')

    def fill(selector, value):
        # Add-argument schedules an Angular render; observe the resulting enabled
        # control before issuing an input action. Do not replay that action.
        driver.wait("return (() => {const input=document.querySelector(" + json.dumps(selector)
                    + ");return !!input && !input.matches(':disabled');})()")
        driver.script("const input=document.querySelector(arguments[0]); if(!input || input.disabled) throw Error('Owned profile input unavailable'); input.value=arguments[1]; input.dispatchEvent(new Event('input',{bubbles:true}));", selector, value)

    def preferences():
        driver.click('[aria-label="Preferences"]')
        driver.wait("return !!document.querySelector('#preferences-tab-terminal')")
        driver.click('#preferences-tab-terminal')
        driver.wait("return !!document.querySelector('gc-configured-tools-panel')")

    try:
        repo_id = driver.invoke('open_repository', path=str(repository))['id']
        driver.invoke('validate_tool_profile', profile=profile)
        session = driver.invoke('open_configured_terminal', repoId=repo_id, profile=profile, rows=24, cols=80)
        sessions.add(session['id'])
        row = observed(1)[0]
        assert row['args'] == [literal, str(repository)] and row['cwd'] == str(repository), row
        assert row['tty'] == [True, True] and row['gitDir'] is None and row['index'] is None, row
        assert row['config'] == fixtures.env['GIT_CONFIG_GLOBAL'], row
        assert not sentinel.exists()
        driver.invoke('close_terminal', sessionId=session['id']); sessions.remove(session['id'])
        report['scenarios'].append('native-configured-program-real-pty-literal-argv-cwd-and-sanitized-git-context')

        for rejected in [dict(profile, role='editor'), dict(profile, role='agent'), dict(profile, version=2), dict(profile, executable='/owned/missing-program')]:
            try:
                unexpected = driver.invoke('open_configured_terminal', repoId=repo_id, profile=rejected, rows=24, cols=80)
                sessions.add(unexpected['id'])
                raise AssertionError('An invalid configured program unexpectedly started')
            except RuntimeError:
                pass
        assert len(observed(1)) == 1
        report['scenarios'].append('native-configured-program-refuses-nonterminal-role-invalid-version-and-missing-executable')

        open_ui(driver, repository)
        preferences()
        driver.click_text('gc-configured-tools-panel button', 'New program profile')
        fill('[name=toolName]', profile['name']); fill('[name=toolExecutable]', profile['executable'])
        for number, argument in enumerate(profile['arguments']):
            driver.click_text('gc-configured-tools-panel button', 'Add argument')
            fill('[aria-label=' + json.dumps('Program argument ' + str(number + 1)) + ']', argument)
        driver.click('[name=toolDefault]')
        driver.click_text('gc-configured-tools-panel button', 'Save program profile')
        driver.wait("return [...document.querySelectorAll('gc-configured-tools-panel [role=status]')].some(p=>p.textContent.includes('Profile saved.'))")
        assert len(observed(1)) == 1, 'Saving a profile started a program'
        driver.click('[aria-label="Close preferences"]')
        driver.reload()
        driver.wait("return !!document.querySelector('.commit-row')")
        preferences()
        driver.wait("return [...document.querySelectorAll('gc-configured-tools-panel .profiles button')].some(button=>button.textContent.includes('Owned configured recorder') && button.textContent.includes('default terminal'))")
        assert len(observed(1)) == 1, 'Loading preferences started a program'
        driver.click('[aria-label="Close preferences"]')
        driver.click('[title="Open repository terminal (Alt+T or Ctrl+`)"]')
        driver.wait("return [...document.querySelectorAll('gc-terminal-panel [role=tab]')].some(tab=>tab.textContent.includes('Owned configured recorder'))")
        rows = observed(2); assert len(rows) == 2 and rows[1] == rows[0], rows
        driver.screenshot(Path(report['artifactsDirectory']) / 'configured-program-default-native.png')
        driver.click('gc-terminal-panel .terminal-tab-close')
        driver.wait("return !document.querySelector('gc-terminal-panel .terminal-tab')")
        preferences()
        driver.click_text('gc-configured-tools-panel button', 'Use system shell for new terminal tabs')
        driver.click_visible('gc-configured-tools-panel .profiles button')
        driver.click_text('gc-configured-tools-panel button', 'Delete program profile')
        driver.wait("return document.querySelectorAll('gc-configured-tools-panel .profiles button').length === 0")
        driver.click('[aria-label="Close preferences"]')
        report['scenarios'].append('native-ui-configured-program-persistence-default-explicit-launch-close-and-delete')
        assert (repository / '.git/index').read_bytes() == index
        assert (repository / '.git/config').read_bytes() == config
        assert fixtures.git(repository, 'show-ref') == refs
        assert not sentinel.exists()
    finally:
        failing = sys.exc_info()[0] is not None
        if failing:
            try:
                directory = Path(report['artifactsDirectory'])
                driver.screenshot(directory / 'configured-program-failure.png')
                (directory / 'configured-program-failure.json').write_text(json.dumps(driver.script("return {preferences:document.querySelector('gc-preferences-dialog')?.innerText,terminal:document.querySelector('gc-terminal-panel')?.innerText}"), indent=2))
            except Exception as error:
                report.setdefault('configuredCaptureErrors', []).append(str(error))
        try:
            for session in sessions: driver.invoke('close_terminal', sessionId=session)
            if driver.script("return !!document.querySelector('gc-preferences-dialog')"):
                driver.click('[aria-label="Close preferences"]')
            open_ui(driver, original_repository)
        except Exception as error:
            if not failing: raise
            report.setdefault('configuredCleanupErrors', []).append(str(error))
