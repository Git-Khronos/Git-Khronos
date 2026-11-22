"""Installed conflict navigation without changing merge state or working files."""
import json
import subprocess

from native_worktree_scenarios import checkout_footprint


def conflict_navigation(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('owned-conflict-navigation', commits=3)
    head = fixtures.git(repository, 'rev-parse', 'HEAD')
    for branch, contents in (('owned-side', 'side edit'), ('main', 'main edit')):
        if branch == 'owned-side':
            fixtures.git(repository, 'checkout', '-qb', branch, head)
        else:
            fixtures.git(repository, 'checkout', '-q', branch)
        (repository / 'fixture.txt').write_text(contents + '\n')
        fixtures.git(repository, 'add', 'fixture.txt')
        fixtures.git(repository, 'commit', '-qm', contents)
    merge = subprocess.run(['git', '-C', str(repository), 'merge', '--no-commit', 'owned-side'],
                           capture_output=True, env=fixtures.env, timeout=15)
    assert merge.returncode == 1, (merge.stdout, merge.stderr)
    assert fixtures.git(repository, 'diff', '--name-only', '--diff-filter=U') == 'fixture.txt'
    before = checkout_footprint(fixtures, repository)
    merge_head = (repository / '.git/MERGE_HEAD').read_bytes()
    repo_id = open_ui(driver, repository)
    row = f'[data-commit-oid="{before["head"]}"] .commit-main'
    driver.wait(f'return !!document.querySelector({json.dumps(row)})')
    driver.click_visible(row)
    driver.wait("return document.querySelector('#repository-commit-panel')?.getAttribute('aria-label') === 'Commit inspector'")
    driver.click_scrolled_text('.conflict-navigation button', 'Show conflicted files', wait_for_ready=True)
    driver.wait("""return document.activeElement?.textContent.trim() === 'Conflicted Files (1)'
        && document.activeElement?.getAttribute('aria-expanded') === 'true'
        && !!document.querySelector('[title="Open Merge Tool for fixture.txt"]')""")
    assert checkout_footprint(fixtures, repository) == before
    assert (repository / '.git/MERGE_HEAD').read_bytes() == merge_head
    report['scenarios'].append('native-show-conflicted-files-opens-and-focuses-the-list-without-changing-merge-state')
    return repository, repo_id
