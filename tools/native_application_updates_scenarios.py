"""Packaged updater trust and offline preference boundaries, without installation."""
import json
import os
from native_worktree_scenarios import checkout_footprint


def application_updates_workflow(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('application-updates-review', commits=2)
    (repository / 'fixture.txt').write_text('Owned updater staged data.\n')
    fixtures.git(repository, 'add', 'fixture.txt')
    (repository / 'update-note.txt').write_text('Owned updater untracked data.\n')
    open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt'))
    driver.click('[aria-label="Main menu"]')
    driver.click_visible('.app-menu-popover [role=menuitem] strong', 'Updates')
    modal = 'gk-application-updates-dialog [role=dialog]'
    expect_trust = os.environ.get('GIT_KHRONOS_NATIVE_EXPECT_UPDATE_TRUST') == '1'
    driver.wait('return document.querySelector(' + json.dumps(modal) + ')?.textContent.includes("Running version")')
    state = driver.script('''const dialog = document.querySelector(arguments[0]);
      const automatic = dialog.querySelector('input[type=checkbox]');
      const check = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check for updates');
      return {text: dialog.textContent, automatic: automatic.checked,
        automaticDisabled: automatic.disabled, checkDisabled: check.disabled,
        installButtons: [...dialog.querySelectorAll('button')].filter(b => b.textContent.includes('Install verified')).length};''', modal)
    if expect_trust:
        status = driver.request('POST', driver.path('execute/async'), {'script': """
          const done = arguments[arguments.length - 1];
          window.__TAURI_INTERNALS__.invoke('application_update_status')
            .then(done, e => done({failure: String(e)}));""", 'args': []})
        assert status['configured'] is True and status['canCheck'] is True, status
        assert status['automatic'] is False and status['offerId'] is None, status
        assert not status['canDownload'] and not status['canInstall'], status
        assert not state['automatic'] and not state['automaticDisabled'] and not state['checkDisabled']
        assert state['installButtons'] == 0
        report['applicationUpdates'] = {'source': str(repository), 'configuredUi': state,
                                        'nativeStatus': status}
        driver.click_visible(modal + ' button', 'Close')
        driver.wait('return !document.querySelector(' + json.dumps(modal) + ')')
        driver.wait('return document.activeElement?.getAttribute("aria-label") === "Main menu"')
        assert checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt')) == before
        report['scenarios'].append('native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer')
        return

    assert state['automatic'] is False and state['automaticDisabled']
    assert state['checkDisabled'] and state['installButtons'] == 0
    assert 'Running version' in state['text'] and 'not configured' in state['text']
    report['applicationUpdates'] = {'source': str(repository), 'missingTrustUi': state}
    report['scenarios'].append('native-updates-menu-discloses-missing-publisher-trust-and-default-off-automatic-mode')

    # Exercise native refusal, not a replaced bridge or a renderer-only mock.
    outcomes = driver.request('POST', driver.path('execute/async'), {'script': '''
      const done = arguments[arguments.length - 1];
      Promise.all([
        window.__TAURI_INTERNALS__.invoke('check_application_update'),
        window.__TAURI_INTERNALS__.invoke('set_automatic_application_updates', {enabled: true})
      ].map(p => p.then(() => ({accepted:true}), e => ({accepted:false, message:e.message || String(e)}))))
        .then(done, e => done({error:String(e)}));''', 'args': []})
    assert isinstance(outcomes, list) and len(outcomes) == 2, outcomes
    assert all(outcome.get('accepted') is False and 'not configured' in outcome['message'] for outcome in outcomes), outcomes
    report['applicationUpdates']['nativeRefusals'] = outcomes
    driver.click_visible(modal + ' button', 'Close')
    driver.wait('return !document.querySelector(' + json.dumps(modal) + ')')
    driver.wait('return document.activeElement?.getAttribute("aria-label") === "Main menu"')
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt')) == before
    report['scenarios'].append('native-updater-refuses-manual-check-and-automatic-consent-without-trust-and-preserves-owned-git-data')


def application_update_consent(driver, fixtures, report):
    """Check manual/automatic dispatch and durable opt-in/out without an offer."""
    from native_acceptance import open_ui

    repository = fixtures.repository('installed-update-consent', commits=2)
    tracked = repository / 'fixture.txt'
    tracked.write_text('Owned staged contents during update consent.\n', encoding='utf-8')
    fixtures.git(repository, 'add', '--', tracked.name)
    note = repository / 'update-consent-note.txt'
    note.write_text('Owned untracked contents during update consent.\n', encoding='utf-8')
    files = (tracked.name, note.name)
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, files)
    dialog = 'gk-application-updates-dialog [role=dialog]'
    checkbox = dialog + ' input[type=checkbox]'
    feedback = dialog + ' .feedback'
    evidence = report['applicationUpdateConsent'] = {}

    def open_updates():
        driver.click_visible('[aria-label="Main menu"]')
        driver.click_visible('.app-menu-popover [role=menuitem] strong', 'Updates')
        driver.wait('return !!document.querySelector(' + json.dumps(checkbox) + ')')

    def observe(label, automatic):
        driver.wait(f'''const checkbox = document.querySelector({json.dumps(checkbox)});
          return checkbox?.checked === {json.dumps(automatic)} && !checkbox.disabled;''')
        state = driver.invoke('application_update_status')
        assert state['configured'] and not state['storageError'] and state['automatic'] is automatic, state
        assert state['offerId'] is None and not state['verified'] and not state['canInstall'] and not state['canDownload'], state
        assert checkout_footprint(fixtures, repository, files) == before
        evidence[label] = {key: state[key] for key in (
            'revision', 'phase', 'automatic', 'canCheck', 'canDownload', 'canInstall', 'runningVersion',
        )}
        return state

    def wait_offline():
        driver.wait('return document.querySelector(' + json.dumps(feedback)
                    + ')?.textContent.includes("The signed update source could not be reached.")', timeout=45)

    def restart(label):
        proof = driver.restart_application()
        evidence[label] = proof
        current = open_ui(driver, repository)
        open_updates()
        return current

    open_updates()
    initial = observe('default', False)
    assert initial['canCheck'], initial
    driver.click_visible(dialog + ' button', 'Check for updates')
    wait_offline()
    manual = observe('manualCheckOffline', False)
    assert manual['phase'] == 'failed' and manual['canCheck'] and manual['revision'] > initial['revision'], manual
    report['scenarios'].append('native-updater-manual-check-runs-offline-without-automatic-consent')

    driver.click_visible(checkbox)
    observe('optedIn', True)
    repo_id = restart('enabledRestart')
    observe('optInRestored', True)
    # No manual click in the new process: reaching the offline result proves
    # the scheduler honored durable consent, not just the new checkbox state.
    wait_offline()
    automatic = observe('automaticCheckOffline', True)
    assert automatic['phase'] == 'failed', automatic
    report['scenarios'].append('native-updater-opt-in-survives-process-restart-and-schedules-an-offline-check')

    driver.click_visible(checkbox)
    observe('optedOut', False)
    repo_id = restart('disabledRestart')
    # The first scheduler pass is due five seconds after process startup.
    # Observe past that window rather than treating an immediate idle read
    # as evidence that the scheduler respects the restored opt-out.
    driver.request('POST', driver.path('execute/async'), {'script': '''
      const done = arguments[arguments.length - 1];
      setTimeout(() => done(true), 6000);
    ''', 'args': []})
    disabled = observe('optOutRestored', False)
    assert disabled['canCheck'] and disabled['phase'] == 'idle', disabled
    report['scenarios'].append('native-updater-opt-out-survives-process-restart-and-keeps-manual-checks-available')
    return repository, repo_id
