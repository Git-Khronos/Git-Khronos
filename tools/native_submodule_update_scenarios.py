"""Exercise scoped remote updates without any transport outside owned Git fixtures."""
import json


def update_one_submodule(driver, fixtures, report):
    from native_acceptance import open_ui

    source = fixtures.repository('owned-update-source', commits=2)
    parent = fixtures.repository('owned-update-parent', commits=2)
    selected = 'modules/chosen'
    sibling = 'modules/unchosen'
    for path in (selected, sibling):
        fixtures.git(parent, 'submodule', 'add', '--', str(source), path)
    fixtures.git(parent, 'commit', '-qm', 'Record two submodules')

    chosen_checkout = parent / selected
    sibling_checkout = parent / sibling
    selected_file = chosen_checkout / 'fixture.txt'
    original_contents = selected_file.read_bytes()
    sibling_file = sibling_checkout / 'fixture.txt'
    sibling_file.write_bytes(b'Keep this unrelated submodule edit\n')
    tracked_remote = 'refs/remotes/origin/main'

    def read_git(path, *args):
        return fixtures.git(path, '--no-optional-locks', *args)

    def child_state(checkout):
        return {
            'head': read_git(checkout, 'rev-parse', 'HEAD'),
            'remote': read_git(checkout, 'rev-parse', tracked_remote),
            'index': read_git(checkout, 'ls-files', '--stage', '-z'),
            'files': (checkout / 'fixture.txt').read_text(),
        }

    def parent_state():
        return {
            'head': read_git(parent, 'rev-parse', 'HEAD'),
            'refs': read_git(parent, 'show-ref'),
            'index': read_git(parent, 'ls-files', '--stage', '-z'),
            'config': read_git(parent, 'config', '--local', '--null', '--list'),
            'declaration': (parent / '.gitmodules').read_text(),
        }

    before = parent_state()
    chosen_before = child_state(chosen_checkout)
    sibling_before = child_state(sibling_checkout)
    updated_contents = b'New owned upstream contents\n'
    (source / 'fixture.txt').write_bytes(updated_contents)
    fixtures.git(source, 'add', '--', 'fixture.txt')
    fixtures.git(source, 'commit', '-qm', 'Advance selected upstream')
    upstream = read_git(source, 'rev-parse', 'HEAD')
    assert upstream != chosen_before['remote']
    evidence = report['submoduleRemoteUpdate'] = {'selectedPath': selected, 'unselectedPath': sibling,
                                                   'oldRemoteOid': chosen_before['remote'], 'upstreamOid': upstream}

    repository_id = open_ui(driver, parent)
    heading = '#reference-section-submodules .heading-toggle'
    driver.wait(f"return !!document.querySelector({heading!r})")
    if driver.script(f"return document.querySelector({heading!r}).getAttribute('aria-expanded') === 'false'"):
        driver.click_visible(heading)
    actions = '.submodule-actions[aria-label="Submodule actions for modules/chosen"]'
    dialog = 'gk-submodule-state-review [role="dialog"]'
    group = dialog + ' [aria-label="Update modules/chosen"]'

    def open_review():
        driver.click_visible(actions)
        driver.click_scrolled_text('.submodule-menu [role=menuitem]', 'Update from remote…', wait_for_ready=True)
        cancel = group + ' [data-single-submodule-cancel]'
        driver.wait(f"return document.activeElement?.matches({json.dumps(cancel)})")

    def close_review():
        driver.click_scrolled_text(dialog + ' footer button', 'Close', wait_for_ready=True)
        driver.wait(f"return !document.querySelector({json.dumps(dialog)})")

    def unchanged(expected):
        assert parent_state() == before
        assert child_state(chosen_checkout) == expected
        assert child_state(sibling_checkout) == sibling_before

    open_review()
    # The dirty sibling blocks bulk updates but not this reviewed path.
    driver.wait(f"""const button = document.querySelector({json.dumps(dialog + ' [data-update-all-open]')});
      const reason = document.getElementById(button?.getAttribute('aria-describedby'));
      return button?.disabled && !!reason?.getClientRects().length
        && reason.textContent.includes('Save or remove local changes inside submodules.');""")
    unchanged(chosen_before)
    close_review()
    unchanged(chosen_before)
    report['scenarios'].append('native-submodule-remote-update-open-and-cancel-do-not-fetch')

    open_review()
    selected_file.write_bytes(b'Preserve this edit made after opening the review\n')
    now_dirty = child_state(chosen_checkout)
    driver.click_scrolled_text(group + ' button', 'Update from remote', wait_for_ready=True)
    driver.wait(f"""return [...document.querySelectorAll({json.dumps(dialog + ' [role=alert]')})]
      .some(node => node.textContent.includes('conflict-free and clean before updating'))""", 60)
    unchanged(now_dirty)
    evidence['remoteOidAfterDirtyRefusal'] = now_dirty['remote']
    report['scenarios'].append('native-submodule-remote-update-refuses-late-dirty-edit-before-fetch')
    close_review()

    selected_file.write_bytes(original_contents)
    open_review()
    unchanged(chosen_before)
    driver.click_scrolled_text(group + ' button', 'Update from remote', wait_for_ready=True)
    driver.wait("""return document.querySelector('[data-submodule-sync]')?.textContent
      .includes('Updated modules/chosen from its remote.')""", 60)
    chosen_after = child_state(chosen_checkout)
    assert chosen_after['head'] == chosen_after['remote'] == upstream, chosen_after
    assert selected_file.read_bytes() == updated_contents
    assert parent_state() == before and child_state(sibling_checkout) == sibling_before
    evidence['remoteOidAfterSuccess'] = chosen_after['remote']
    report['scenarios'].append('native-submodule-remote-update-moves-only-selected-checkout-and-preserves-parent-index')

    # The selected checkout advanced but the parent still records its old
    # commit. Both exact values must be visible and searchable without a write.
    driver.click_scrolled_text(dialog + ' label', 'Show full commit IDs', wait_for_ready=True)
    selected_card = dialog + ' [aria-label="Submodule modules/chosen"]'
    sibling_card = dialog + ' [aria-label="Submodule modules/unchosen"]'
    driver.wait(f"""const ids = [...document.querySelectorAll({json.dumps(selected_card + ' .metadata code')})];
      return ids[0]?.textContent === {json.dumps(chosen_before['head'])}
        && ids[1]?.textContent === {json.dumps(chosen_after['head'])};""")
    driver.script("""const search = document.querySelector(arguments[0]);
      search.value = arguments[1];
      search.dispatchEvent(new Event('input', {bubbles: true}));""", dialog + ' input[type="search"]', upstream.upper())
    driver.wait(f"""return !!document.querySelector({json.dumps(selected_card)})
      && !document.querySelector({json.dumps(sibling_card)});""")
    unchanged(chosen_after)
    report['scenarios'].append('native-submodule-review-shows-and-filters-exact-recorded-and-checked-out-commits')
    return parent, repository_id
