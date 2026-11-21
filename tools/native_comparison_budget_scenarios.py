"""Check a bounded comparison through the installed desktop and real Git."""
import json

from native_worktree_scenarios import checkout_footprint


def working_directory_comparison_budget(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('working-directory-comparison', commits=3)
    attributes = repository / '.gitattributes'
    attributes.write_text('a-large.txt diff\n')
    fixtures.git(repository, 'add', '--', attributes.name)
    fixtures.git(repository, 'commit', '-m', 'Set comparison text attribute')
    base = fixtures.git(repository, 'rev-parse', 'HEAD')
    tracked = repository / 'fixture.txt'
    tracked.write_text(tracked.read_text() + 'owned tracked change\n')
    large = repository / 'a-large.txt'
    with large.open('wb') as stream:
        stream.truncate(17 * 1024 * 1024)
    small = repository / 'z-small.txt'
    small.write_text('owned small first\nowned small second\n')
    files = (attributes.name, tracked.name, large.name, small.name)
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, repository, files)

    driver.context_click('.commit-row[data-commit-oid="' + base + '"]')
    driver.click_visible('.graph-action-menu [role="menuitem"]', 'Compare with working directory')
    panel = '.comparison-files'
    large_button = panel + ' [aria-label="Open diff for a-large.txt"]'
    small_button = panel + ' [aria-label="Open diff for z-small.txt"]'
    display = driver.wait(f"""const panel = document.querySelector({json.dumps(panel)});
      const recap = panel?.querySelector('.file-change-summary');
      const large = document.querySelector({json.dumps(large_button)});
      const small = document.querySelector({json.dumps(small_button)});
      if (!recap?.getClientRects().length || !large?.getClientRects().length || !small?.getClientRects().length) return null;
      return {{ label: recap.getAttribute('aria-label'), summary: recap.textContent.trim(),
        large: large.textContent.trim(), largeSelectable: !large.disabled,
        small: small.textContent.trim() }};""")
    assert checkout_footprint(fixtures, repository, files) == before
    report['workingDirectoryComparisonBudget'] = display
    assert display['label'] == '3 additions and 0 deletions; 1 binary or uncounted file excluded; partial totals', display
    assert '(partial)' in display['summary'] and 'not counted' in display['large'] and display['largeSelectable'], display
    assert '+2−0' in display['small'], display

    driver.click_visible(small_button)
    driver.wait("""const viewer = document.querySelector('[aria-label="Diff viewer"]');
      return viewer?.getClientRects().length && viewer.textContent.includes('owned small second');""")
    assert checkout_footprint(fixtures, repository, files) == before
    report['scenarios'].append('native-working-directory-comparison-reports-partial-line-counts-without-hiding-files')
    return repository, repo_id
