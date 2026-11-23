"""Exercise explicit single-path initialization using only owned Git repositories."""
import json


def initialize_one_submodule(driver, fixtures, report):
    from native_acceptance import open_ui

    nested = fixtures.repository('owned-nested-source', commits=2)
    source = fixtures.repository('owned-module-source', commits=2)
    parent = fixtures.repository('owned-module-parent', commits=2)
    chosen = 'modules/chosen'
    sibling = 'modules/unchosen'
    inner = 'vendor/nested'
    fixtures.git(source, 'submodule', 'add', '--', str(nested), inner)
    fixtures.git(source, 'commit', '-qm', 'Record the nested submodule')
    for path in (chosen, sibling):
        fixtures.git(parent, 'submodule', 'add', '--', str(source), path)
    fixtures.git(parent, 'commit', '-qm', 'Record two submodules')
    fixtures.git(parent, 'submodule', 'deinit', '--', chosen, sibling)

    def git(path, *args):
        return fixtures.git(path, '--no-optional-locks', *args)

    def local_config():
        return dict(record.split('\n', 1) for record in git(parent, 'config', '--local', '--null', '--list').split('\0')
                    if record)

    def parent_state():
        return {
            'HEAD': git(parent, 'rev-parse', 'HEAD'),
            'index': git(parent, 'ls-files', '--stage', '-z'),
            'refs': git(parent, 'show-ref'),
            'declaration': (parent / '.gitmodules').read_text(),
            'status': git(parent, 'status', '--porcelain'),
        }

    before = parent_state()
    config = local_config()
    evidence = report['submoduleInitialization'] = {'selectedPath': chosen, 'unselectedPath': sibling}
    repository_id = open_ui(driver, parent)
    heading = '#reference-section-submodules .heading-toggle'
    driver.wait(f"return !!document.querySelector({heading!r})")
    if driver.script(f"return document.querySelector({heading!r}).getAttribute('aria-expanded') === 'false'"):
        driver.click_visible(heading)
    name = f'Submodule {chosen}, {source}'
    row = '.submodule-main[aria-label=' + json.dumps(name) + ']'
    dialog = 'gk-submodule-state-review [role="dialog"]'
    group = dialog + ' [aria-label="Initialize modules/chosen"]'

    driver.click_visible(row)
    try:
        driver.wait(f"return document.activeElement?.matches({json.dumps(group + ' [data-initialize-one-cancel]')})", 12)
    finally:
        evidence['selectedInitializedBeforeConsent'] = (parent / chosen / '.git').exists()
    assert evidence['selectedInitializedBeforeConsent'] is False
    assert not (parent / sibling / '.git').exists()
    assert parent_state() == before and local_config() == config

    driver.click_scrolled_text(dialog + ' footer button', 'Close', wait_for_ready=True)
    driver.wait(f"return !document.querySelector({json.dumps(dialog)}) && document.activeElement?.matches({json.dumps(row)})")
    assert not (parent / chosen / '.git').exists()
    assert parent_state() == before and local_config() == config
    report['scenarios'].append('native-submodule-initialize-opener-and-cancel-do-not-touch-repository')

    driver.click_visible(row)
    driver.click_scrolled_text(group + ' button', 'Initialize submodule', wait_for_ready=True)
    driver.wait("""return document.querySelector('[data-submodule-sync]')?.textContent
      .includes('Initialized modules/chosen at its recorded commit.')""", 60)
    assert (parent / chosen / '.git').exists() and (parent / chosen / inner / '.git').exists()
    assert not (parent / sibling / '.git').exists()
    assert git(parent / chosen, 'rev-parse', 'HEAD') == git(source, 'rev-parse', 'HEAD')
    assert git(parent / chosen / inner, 'rev-parse', 'HEAD') == git(nested, 'rev-parse', 'HEAD')
    after_config = local_config()
    prefix = 'submodule.' + chosen + '.'
    assert {key: value for key, value in after_config.items() if not key.startswith(prefix)} == config
    assert after_config[prefix + 'url'] == str(source)
    assert parent_state() == before
    evidence.update(nestedInitialized=True, siblingLeftUninitialized=True, parentGitStatePreserved=True)
    report['scenarios'].append('native-submodule-confirm-initializes-only-selected-path-including-nested')
    return parent, repository_id
