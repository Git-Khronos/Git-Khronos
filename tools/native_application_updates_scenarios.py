"""Packaged updater trust and offline preference boundaries, without installation."""
import json
import os
import re
from native_worktree_scenarios import checkout_footprint


def public_update_expectations(environ, expect_trust):
    baseline = environ.get('GIT_KHRONOS_NATIVE_CHECK_PUBLIC_BASELINE') == '1'
    expected = environ.get('GIT_KHRONOS_NATIVE_EXPECT_PUBLIC_UPDATE')
    if (baseline or expected is not None) and not expect_trust:
        raise RuntimeError('Live public update checks require GIT_KHRONOS_NATIVE_EXPECT_UPDATE_TRUST=1.')
    if baseline and expected is not None:
        raise RuntimeError('Choose either the public baseline check or an expected newer release, not both.')
    if expected is not None and not re.fullmatch(r'(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){2}', expected):
        raise RuntimeError('GIT_KHRONOS_NATIVE_EXPECT_PUBLIC_UPDATE requires a stable x.y.z version.')
    return baseline, expected


def application_updates_workflow(driver, fixtures, report):
    from native_acceptance import open_ui

    expect_trust = os.environ.get('GIT_KHRONOS_NATIVE_EXPECT_UPDATE_TRUST') == '1'
    check_public_baseline, expected_public_update = public_update_expectations(os.environ, expect_trust)

    repository = fixtures.repository('application-updates-review', commits=2)
    (repository / 'fixture.txt').write_text('Owned updater staged data.\n')
    fixtures.git(repository, 'add', 'fixture.txt')
    (repository / 'update-note.txt').write_text('Owned updater untracked data.\n')
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt'))
    driver.click('[aria-label="Main menu"]')
    driver.click_visible('.app-menu-popover [role=menuitem] strong', 'Updates')
    modal = 'gk-application-updates-dialog [role=dialog]'
    def verify_palette_entry():
        origin = 'input[aria-label="Filter changed files"]'
        search = 'gk-command-palette input[aria-label="Search commands"]'
        driver.click_visible(origin)
        before_status = driver.invoke('application_update_status')
        driver.key('p', modifiers=('\ue009',))
        driver.wait(f"return document.activeElement?.matches({search!r})")
        driver.script("""const field = document.activeElement;
          field.value = 'check for updates'; field.dispatchEvent(new Event('input', {bubbles: true}));""")
        driver.click_scrolled_text('gk-command-palette [role=option] strong',
                                   'Application Updates', wait_for_ready=True)
        driver.wait(f"return document.querySelector({modal!r})?.textContent.includes('Running version')")
        assert driver.invoke('application_update_status') == before_status
        driver.key('\ue00c')  # Escape
        driver.wait(f"return !document.querySelector({modal!r}) && document.activeElement?.matches({origin!r})")
        assert checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt')) == before
        report['scenarios'].append('native-updates-palette-opens-without-checking-or-changing-consent')

    driver.wait('return document.querySelector(' + json.dumps(modal) + ')?.textContent.includes("Running version")')
    expected_build_id = os.environ.get('GIT_KHRONOS_NATIVE_EXPECT_BUILD_INPUT_ID')
    build_id = driver.invoke('application_update_status').get('buildInputId')
    if expected_build_id is not None:
        assert build_id == expected_build_id, (build_id, expected_build_id)
    if build_id is not None:
        assert isinstance(build_id, str) and re.fullmatch(r'[0-9a-f]{12}', build_id), build_id
    driver.wait(f"""const dialog = document.querySelector({json.dumps(modal)});
      if (!dialog) return false;
      const label = [...dialog.querySelectorAll('dt')]
        .find(term => term.textContent.trim() === 'Running build ID');
      const buildId = {json.dumps(build_id)};
      return buildId === null ? !label
        : label?.nextElementSibling?.querySelector('code')?.textContent.trim() === buildId;""")
    if expected_build_id is not None:
        report['scenarios'].append('native-updates-running-build-id-matches-package-inputs')
    shadows = driver.script("""const root = document.documentElement;
      const dialog = document.querySelector(arguments[0]);
      const previous = root.getAttribute('data-theme');
      try {
        return ['khronos', 'midnight'].map(theme => {
          root.setAttribute('data-theme', theme);
          return getComputedStyle(dialog).boxShadow;
        });
      } finally {
        if (previous === null) root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', previous);
      }""", modal)
    assert len(shadows) == 2 and all(shadow and shadow != 'none' for shadow in shadows), shadows
    report['applicationUpdateThemeShadows'] = shadows
    report['scenarios'].append('native-updates-dialog-has-theme-shadow-without-changing-preferences')
    # A disabled or removed focused action can leave focus on the body. Lose
    # focus deliberately without a network request; navigate with real keys.
    def clear_dialog_focus():
        assert driver.script("""const dialog = document.querySelector(arguments[0]);
          if (!dialog?.contains(document.activeElement)) return false;
          document.activeElement.blur();
          return !dialog.contains(document.activeElement);""", modal)

    driver.wait(f"return document.querySelector({modal!r})?.contains(document.activeElement)")
    clear_dialog_focus()
    driver.key('\ue004')  # Tab
    driver.wait(f"return document.querySelector({modal!r})?.contains(document.activeElement) && document.activeElement.textContent.trim() === 'Close'")
    clear_dialog_focus()
    driver.script("""const probe = window.__updaterTabProbe = {keys: [], stop: new AbortController()};
      document.addEventListener('keydown', event => { if (probe.keys.length < 4)
        probe.keys.push({key: event.key, code: event.code, keyCode: event.keyCode, shift: event.shiftKey}); },
        {capture: true, signal: probe.stop.signal});""")
    try:
        driver.key('\ue004', modifiers=('\ue008',))  # Shift+Tab
        driver.wait(f"return document.querySelector({modal!r})?.contains(document.activeElement) && document.activeElement.textContent.trim() === 'Refresh status'",
                    timeout=5)
    finally:
        report['applicationUpdateKeyboard'] = driver.script("""const probe = window.__updaterTabProbe;
          probe.stop.abort(); delete window.__updaterTabProbe;
          return {keys: probe.keys, active: document.activeElement?.matches('button')
            ? document.activeElement.textContent.trim() : document.activeElement?.tagName};""")
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt')) == before
    report['scenarios'].append('native-updates-tab-recovers-to-first-or-last-action-without-changing-git')
    state = driver.script(r'''const dialog = document.querySelector(arguments[0]);
      const automatic = dialog.querySelector('input[type=checkbox]');
      const helpId = automatic.getAttribute('aria-describedby');
      const help = helpId && document.getElementById(helpId);
      const check = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check for updates');
      const browse = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Browse official releases (opens browser)');
      return {text: dialog.textContent, automatic: automatic.checked,
        consentHelp: help && dialog.contains(help) ? help.textContent.trim().replace(/\s+/g, ' ') : '',
        automaticDisabled: automatic.disabled, checkDisabled: check.disabled,
        browseEnabled: !!browse && !browse.disabled && browse.getAttribute('aria-disabled') !== 'true',
        installButtons: [...dialog.querySelectorAll('button')].filter(b => b.textContent.includes('Install verified')).length};''', modal)
    consent_help = state['consentHelp']
    for fragment in (
        'Off by default.',
        'downloads and verifies packages from the trusted publisher',
        'when no Git operation, terminal session or editor is active',
        'does not stop an installer that has already started',
    ):
        assert fragment in consent_help, consent_help
    manual_help = ('This build cannot check for or install updates in the app. '
                   'Use Browse official releases to find a package and install it manually.')
    assert state['browseEnabled'], state
    report['scenarios'].append('native-updates-automatic-setting-describes-download-and-install-consent')
    if expect_trust:
        assert manual_help not in consent_help, consent_help
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
        if check_public_baseline:
            # Explicit opt-in only: exercise the official feed without
            # enabling the scheduler, downloading or installing a package.
            driver.click_visible(modal + ' button', 'Check for updates')
            driver.wait(f"""return document.querySelector({json.dumps(modal + ' .feedback')})
              ?.textContent.includes('No newer release is available.')""", timeout=45)
            checked = driver.invoke('application_update_status')
            assert checked['runningVersion'] == status['runningVersion'] and not checked['automatic'], checked
            assert checked['offerId'] is None and not checked['canDownload'] and not checked['canInstall'], checked
            assert checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt')) == before
            report['applicationUpdates']['publicBaselineStatus'] = checked
            report['scenarios'].append('native-current-stable-release-checks-public-feed-without-offer-or-install')
        elif expected_public_update is not None:
            running = status['runningVersion']
            assert re.fullmatch(r'[0-9]+(?:\.[0-9]+){2}', running), running
            assert tuple(map(int, expected_public_update.split('.'))) > tuple(map(int, running.split('.'))), (
                'Expected public update must be newer than the running release', expected_public_update, running)
            driver.click_visible(modal + ' button', 'Check for updates')
            driver.wait(f"""const dialog = document.querySelector({json.dumps(modal)});
              const check = [...(dialog?.querySelectorAll('button') ?? [])]
                .find(button => button.textContent.trim() === 'Check for updates');
              const feedback = dialog?.querySelector('.feedback')?.textContent.trim();
              return !!check && !check.disabled && !!feedback && feedback !== {json.dumps(status['message'])};""",
                        timeout=45)
            offered = driver.invoke('application_update_status')
            assert offered['phase'] == 'available' and offered['offeredVersion'] == expected_public_update, offered
            assert offered['runningVersion'] == running and offered['offerId'] and offered['canDownload'], offered
            assert not offered['automatic'] and not offered['verified'] and not offered['canInstall'], offered
            assert offered['downloadedBytes'] == 0, offered
            driver.wait(f"""const dialog = document.querySelector({json.dumps(modal)});
              const version = [...dialog.querySelectorAll('dt')].find(field => field.textContent.trim() === 'Available version');
              const buttons = [...dialog.querySelectorAll('button')];
              return version?.nextElementSibling?.textContent.trim() === {json.dumps(expected_public_update)}
                && buttons.some(b => b.textContent.trim() === 'Download and verify' && !b.disabled)
                && buttons.some(b => b.textContent.trim() === 'Install verified update' && b.disabled);""", timeout=5)
            assert checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt')) == before
            report['applicationUpdates']['publicOfferStatus'] = offered
            report['scenarios'].append('native-older-release-offers-exact-public-update-without-download-or-install')
        driver.click_visible(modal + ' button', 'Close')
        driver.wait('return !document.querySelector(' + json.dumps(modal) + ')')
        driver.wait('return document.activeElement?.getAttribute("aria-label") === "Main menu"')
        assert checkout_footprint(fixtures, repository, ('fixture.txt', 'update-note.txt')) == before
        report['scenarios'].append('native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer')
        verify_palette_entry()
        return repository, repo_id

    assert state['automatic'] is False and state['automaticDisabled']
    assert state['checkDisabled'] and state['installButtons'] == 0
    assert consent_help.startswith(manual_help), consent_help
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
    verify_palette_entry()
    return repository, repo_id


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


def application_update_release_link(driver, fixtures, report):
    from native_acceptance import open_ui
    from native_desktop_launcher_fixture import desktop_launcher_paths

    assert driver.owned_display, 'The clipboard probe requires an owned headless display'
    repository = fixtures.repository('application-updates-release-link', commits=2)
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository)
    status_before = driver.invoke('application_update_status')
    capture, refusal = desktop_launcher_paths(fixtures)
    refusal.touch()
    modal = 'gk-application-updates-dialog [role=dialog]'
    expected_url = 'https://github.com/Git-Khronos/Git-Khronos/releases'
    browse = modal + ' footer button'
    driver.click_visible('[aria-label="Main menu"]')
    driver.click_visible('.app-menu-popover [role=menuitem] strong', 'Updates')
    driver.click_scrolled_text(browse, 'Browse official releases (opens browser)', wait_for_ready=True)
    driver.wait(f'return document.querySelector({modal!r})?.querySelector(".release-error")'
                '?.textContent.includes("Could not open the browser")', 8)
    expected_launch = expected_url.encode() + b'\0'
    assert capture.read_bytes() == expected_launch
    driver.script(f"""[...document.querySelectorAll({browse!r})]
      .find(button => button.textContent.includes('Browse official releases')).focus()""")
    driver.key('\ue004')  # Refresh status.
    driver.key('\ue004')  # Read-only official release page address.
    driver.wait(f"""const dialog = document.querySelector({modal!r});
      const input = dialog?.querySelector('.release-address input');
      return input && input === document.activeElement && input.readOnly
        && input.value === {expected_url!r} && input.selectionStart === 0 && input.selectionEnd === input.value.length;""", 8)

    # A disposable Xvfb clipboard and a test-owned text input confirm actual
    # keyboard copy/paste, without opening a browser or reading host clipboard.
    driver.key('c', modifiers=('\ue009',))
    driver.script("""const probe = document.createElement('input');
      probe.id = 'owned-release-clipboard-probe';
      document.querySelector(arguments[0]).append(probe);
      probe.focus();""", modal)
    driver.key('v', modifiers=('\ue009',))
    driver.wait(f'return document.querySelector("#owned-release-clipboard-probe")?.value === {expected_url!r}', 8)
    driver.script('document.getElementById("owned-release-clipboard-probe").remove()')
    refusal.unlink()
    driver.click_scrolled_text(browse, 'Browse official releases (opens browser)', wait_for_ready=True)
    driver.wait(f"""const button = [...document.querySelectorAll({browse!r})]
      .find(button => button.textContent.includes('Browse official releases'));
      return button && !button.hasAttribute('aria-disabled') && !document.querySelector({modal!r} + ' .release-error');""")
    assert capture.read_bytes() == expected_launch * 2
    assert driver.invoke('application_update_status') == status_before
    assert checkout_footprint(fixtures, repository) == before
    report['releaseLink'] = {'url': expected_url, 'keyboardCopied': True, 'checkoutUnchanged': True}
    report['scenarios'].append('native-updates-launcher-refusal-keeps-official-link-keyboard-copyable')
    return repository, repo_id
