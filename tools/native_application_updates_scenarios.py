"""Packaged updater entry point and missing-trust refusal, without installation."""
import json
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
    modal = 'gc-application-updates-dialog [role=dialog]'
    driver.wait('return document.querySelector(' + json.dumps(modal) + ')?.textContent.includes("signing key")')
    state = driver.script('''const dialog = document.querySelector(arguments[0]);
      const automatic = dialog.querySelector('input[type=checkbox]');
      const check = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check for updates');
      return {text: dialog.textContent, automatic: automatic.checked,
        automaticDisabled: automatic.disabled, checkDisabled: check.disabled,
        installButtons: [...dialog.querySelectorAll('button')].filter(b => b.textContent.includes('Install verified')).length};''', modal)
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
