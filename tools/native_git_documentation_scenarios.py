"""Drive packaged Git help through its real Linux launcher without opening a browser."""
import shlex
import time

from native_worktree_scenarios import checkout_footprint


def documentation_environment(fixtures):
    capture = fixtures.root / 'documentation-browser-arguments'
    binary_dir = fixtures.root / 'documentation-bin'
    binary_dir.mkdir()
    opener = binary_dir / 'xdg-open'
    opener.write_text(
        '#!/bin/sh\n'
        f'printf \'%s\\0\' "$@" >> {shlex.quote(str(capture))}\n'
    )
    opener.chmod(0o700)
    return {'PATH': str(binary_dir) + ':' + fixtures.env['PATH']}


def git_documentation(driver, fixtures, repository, report):
    capture = fixtures.root / 'documentation-browser-arguments'
    before = checkout_footprint(fixtures, repository)
    driver.click_visible('[aria-label="Preferences"]')
    driver.click_visible('#preferences-tab-git')
    opener = '#preference-remote-updates .preference-help-action'
    driver.click_scrolled_text(opener, 'Learn about fetch and pruning…', wait_for_ready=True)
    dialog = 'gk-git-documentation-dialog [role=dialog]'
    driver.wait("""return document.activeElement.matches(
                      'gk-git-documentation-dialog details[open] > summary'
                   ) && document.activeElement.textContent.trim() ===
                      'Fetch and prune remote-tracking branches'""")
    assert not capture.exists(), 'Showing documentation unexpectedly invoked the browser'
    driver.key('\ue004')  # Tab from the topic to its first manual link.
    assert driver.script('return document.activeElement.matches(arguments[0]) && '
                         'document.activeElement.textContent.trim().startsWith("Official manual: Fetch and prune")',
                         dialog + ' details[open] .manuals button:first-child')
    driver.key('\ue007')  # Enter
    expected = b'https://git-scm.com/docs/git-fetch\0'
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and (not capture.exists() or not capture.read_bytes()):
        time.sleep(.05)
    assert capture.read_bytes() == expected
    driver.wait('return !!document.querySelector("gk-git-documentation-dialog [data-docs-close]:enabled")', 5)
    driver.key('\ue00c')  # Escape
    driver.wait('return !document.querySelector("gk-git-documentation-dialog [role=dialog]") '
                '&& document.activeElement.matches("#preference-remote-updates .preference-help-action")')
    assert capture.read_bytes() == expected
    assert checkout_footprint(fixtures, repository) == before
    report['gitDocumentation'] = {'url': expected[:-1].decode(), 'launches': 1, 'checkoutUnchanged': True}
    report['scenarios'].append('native-contextual-git-help-keyboard-launches-exact-manual-and-restores-focus')
