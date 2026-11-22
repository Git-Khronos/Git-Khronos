"""Exercise exact branch search and deliberate checkout in the packaged WebKit renderer."""
from native_worktree_scenarios import checkout_footprint


def branch_picker_exact(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('branch-picker-checkout', commits=2)
    base = fixtures.git(repository, 'rev-parse', 'HEAD')
    selected = 'release-candidate'
    names = [f'a{index:03d}/{selected}' for index in range(90)]
    update = ''.join(f'create refs/heads/{name} {base}\n' for name in [*names, selected])
    fixtures.git(repository, 'update-ref', '--stdin', input=update.encode())

    def publisher(name, text):
        source = fixtures.repository(name, commits=2)
        fixtures.git(source, 'switch', '-qc', 'docs')
        (source / 'publisher.txt').write_text(text)
        fixtures.git(source, 'add', '--', 'publisher.txt')
        fixtures.git(source, 'commit', '-qm', f'{name} docs')
        fixtures.git(repository, 'remote', 'add', name, str(source))
        fixtures.git(repository, 'fetch', '--no-tags', name)
        return source, fixtures.git(source, 'rev-parse', 'HEAD')

    origin, origin_docs = publisher('origin', 'Origin contents\n')
    upstream, upstream_docs = publisher('upstream', 'Upstream contents\n')
    assert origin_docs != upstream_docs
    publisher_refs = [fixtures.git(source, 'show-ref') for source in (origin, upstream)]
    repo_id = open_ui(driver, repository)
    selector = '#branch-picker input[type=search]'

    def open_picker():
        driver.click_navigation('button[aria-label^="Switch branch, current"]')
        driver.wait(f'return document.activeElement?.matches({selector!r})')

    def filter_branches(text):
        driver.script("""
          const input = document.querySelector(arguments[0]);
          input.value = arguments[1];
          input.dispatchEvent(new Event('input', { bubbles: true }));
        """, selector, text)

    open_picker()
    before = checkout_footprint(fixtures, repository, ('fixture.txt',))
    filter_branches('release-cand')
    driver.wait("""return document.querySelector('#branch-picker-result-count')?.textContent.includes('80 of 91')""")
    driver.key('\ue007')
    driver.wait(f'return document.activeElement?.matches({selector!r})')
    assert checkout_footprint(fixtures, repository, ('fixture.txt',)) == before
    report['scenarios'].append('native-ambiguous-capped-branch-search-does-not-check-out-on-enter')

    filter_branches(selected)
    driver.wait("""return document.querySelector('#branch-picker-result-count')?.textContent.includes('1 of 1')""")
    driver.key('\ue007')
    driver.wait("""return !document.querySelector('#branch-picker')
        && !!document.querySelector('button[aria-label^="Switch branch, current release-candidate,"]')""")
    assert fixtures.git(repository, 'symbolic-ref', '--short', 'HEAD') == selected
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == base
    report['scenarios'].append('native-exact-local-branch-search-reaches-the-branch-beyond-the-row-cap')

    open_picker()
    filter_branches('refs/remotes/upstream/docs')
    driver.wait("""return !!document.querySelector('#branch-picker button[aria-label*="from upstream/docs"]')
                      && !document.querySelector('#branch-picker button[aria-label*="from origin/docs"]')""")
    driver.key('\ue007')
    driver.wait("""return !document.querySelector('#branch-picker')
        && !!document.querySelector('button[aria-label^="Switch branch, current docs,"]')""")
    assert fixtures.git(repository, 'symbolic-ref', '--short', 'HEAD') == 'docs'
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == upstream_docs
    assert fixtures.git(repository, 'rev-parse', '@{upstream}') == upstream_docs
    assert (repository / 'publisher.txt').read_text() == 'Upstream contents\n'
    assert [fixtures.git(source, 'show-ref') for source in (origin, upstream)] == publisher_refs
    report['scenarios'].append('native-qualified-branch-picker-checks-out-the-displayed-remote-peer')
    return repository, repo_id
