"""Verify the read-only previous local branch lookup and exact checkout handoff."""
from native_worktree_scenarios import checkout_footprint


def previous_branch(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('previous-branch-checkout', commits=2)
    main = fixtures.git(repository, 'rev-parse', 'HEAD')
    fixtures.git(repository, 'tag', 'main')
    fixtures.git(repository, 'switch', '-qc', 'topic')
    (repository / 'topic.txt').write_text('A file only in the topic.\n')
    fixtures.git(repository, 'add', '--', 'topic.txt')
    fixtures.git(repository, 'commit', '-qm', 'Topic change')
    topic = fixtures.git(repository, 'rev-parse', 'HEAD')
    (repository / 'keep.txt').write_text('Untracked working data.\n')
    repo_id = open_ui(driver, repository)

    def choose_previous(ref):
        driver.click_navigation('button[aria-label="Branch options"]')
        driver.click_scrolled_text('#branch-options-menu button strong', 'Find previous local branch…', wait_for_ready=True)
        driver.wait("""
          const field = document.querySelector('.command-palette input[aria-label="Search branches"]');
          return field?.value === """ + repr(ref) + """ && document.activeElement === field
            && document.querySelector('.command-palette button[role=option]')?.getClientRects().length > 0;
        """)

    path_set = ('fixture.txt', 'keep.txt')
    before = checkout_footprint(fixtures, repository, path_set)
    choose_previous('refs/heads/main')
    assert checkout_footprint(fixtures, repository, path_set) == before
    driver.key('\ue007')
    driver.wait("""return !!document.querySelector('button[aria-label^="Switch branch, current main,"]')""")
    assert fixtures.git(repository, 'symbolic-ref', 'HEAD') == 'refs/heads/main'
    assert fixtures.git(repository, 'rev-parse', 'HEAD') == main
    assert (repository / 'keep.txt').read_text() == 'Untracked working data.\n'
    assert not (repository / 'topic.txt').exists()
    report['scenarios'].append('native-previous-local-branch-read-is-read-only-until-exact-branch-selection')

    # The topic is now the previous branch in this worktree but belongs to a
    # second checkout. Existing navigation review must still own the decision.
    linked = fixtures.root / 'previous-branch-owner'
    fixtures.git(repository, 'worktree', 'add', '--quiet', str(linked), 'topic')
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, path_set)
    choose_previous('refs/heads/topic')
    driver.key('\ue007')
    driver.wait("""return document.querySelector('h2#checkout-worktree-title')?.textContent
        .includes('Branch is open in another checkout')""")
    driver.key('\ue00c')
    driver.wait("""return !document.querySelector('h2#checkout-worktree-title')""")
    assert checkout_footprint(fixtures, repository, path_set) == before
    assert fixtures.git(linked, 'rev-parse', 'HEAD') == topic
    report['scenarios'].append('native-previous-local-branch-reuses-occupied-checkout-review-without-switching')
    return repository, repo_id
