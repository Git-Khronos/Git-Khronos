"""Verify reviewed feature rebases through the installed Branch workflows UI."""
import json
import time

from native_worktree_scenarios import checkout_footprint


def feature_rebase_on_configured_development(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('feature-rebase-owned', commits=2)
    production = fixtures.git(repository, 'rev-parse', 'HEAD')
    topic, development = 'feature/owned', 'integration'
    fixtures.git(repository, 'branch', topic)
    fixtures.git(repository, 'switch', '-c', development)

    def commit_file(path, contents, message):
        (repository / path).write_text(contents)
        fixtures.git(repository, 'add', '--', path)
        fixtures.git(repository, 'commit', '-qm', message)
        return fixtures.git(repository, 'rev-parse', 'HEAD')

    target = commit_file('development.txt', 'owned development\n', 'Owned development change')
    fixtures.git(repository, 'switch', topic)
    sibling = commit_file('first.txt', 'owned feature first\n', 'Owned feature step one')
    fixtures.git(repository, 'branch', 'sibling', sibling)
    source = commit_file('second.txt', 'owned feature second\n', 'Owned feature step two')
    fixtures.git(repository, 'config', '--local', 'rebase.updateRefs', 'true')
    fixtures.git(repository, 'config', '--local', 'gitkhronos.branchWorkflow', json.dumps({
        'version': 1, 'production': 'main', 'development': development,
        'featurePrefix': 'feature/', 'releasePrefix': 'release/', 'hotfixPrefix': 'hotfix/', 'tagPrefix': '',
    }))
    config = (repository / '.git/config').read_bytes()
    before = checkout_footprint(fixtures, repository, ('fixture.txt', 'first.txt', 'second.txt'))
    repo_id = open_ui(driver, repository)
    workflow = 'gc-branch-workflow-dialog'
    integration = 'gc-integrate-branch-dialog'

    def button(owner, name):
        driver.click_scrolled_text(owner + ' button', name, wait_for_ready=True)

    def ready():
        driver.wait('return [...document.querySelectorAll("gc-branch-workflow-dialog button")].some(button => '
                    'button.textContent.trim() === "Reload workflow state" && !button.disabled)')

    def enter_finish():
        driver.click_visible('.workspace-toggle')
        driver.click_scrolled_text('.workspace-menu-actions [role=menuitem]', 'Branch workflows', wait_for_ready=True)
        ready()
        button(workflow, 'Finish ' + topic)
        button(workflow, 'Review finish')
        ready()

    def review_rebase():
        button(workflow, f'Review feature rebase onto {development}…')
        driver.wait('return document.querySelector("gc-integrate-branch-dialog [role=dialog] h2")?.textContent.trim() '
                    '=== "Review feature rebase"')
        driver.wait('return [...document.querySelectorAll("gc-integrate-branch-dialog button")].some(button => '
                    'button.textContent.trim() === ' + json.dumps(f'Rebase {topic} onto {development}')
                    + ' && !button.disabled)')
        assert not driver.script('return !!document.querySelector("gc-branch-workflow-dialog, #integrate-source")')

    enter_finish()
    review_rebase()
    button(integration, 'Cancel')
    driver.wait('return !document.querySelector("gc-integrate-branch-dialog")')
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'first.txt', 'second.txt')) == before

    enter_finish()
    review_rebase()
    assert checkout_footprint(fixtures, repository, ('fixture.txt', 'first.txt', 'second.txt')) == before
    button(integration, f'Rebase {topic} onto {development}')
    deadline = time.monotonic() + 12
    rebased = source
    while rebased == source and time.monotonic() < deadline:
        rebased = fixtures.git(repository, 'rev-parse', 'refs/heads/' + topic)
        if rebased == source:
            time.sleep(.05)
    assert rebased != source, 'The reviewed feature branch did not advance'
    assert fixtures.git(repository, 'symbolic-ref', '--short', 'HEAD') == topic
    assert fixtures.git(repository, 'rev-parse', 'HEAD^^') == target
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/' + development) == target
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/main') == production
    assert fixtures.git(repository, 'rev-parse', 'refs/heads/sibling') == sibling
    assert fixtures.git(repository, 'status', '--porcelain') == ''
    assert (repository / 'first.txt').read_text() == 'owned feature first\n'
    assert (repository / 'second.txt').read_text() == 'owned feature second\n'
    assert (repository / 'development.txt').read_text() == 'owned development\n'
    assert (repository / '.git/config').read_bytes() == config

    enter_finish()
    driver.wait('return document.querySelector("gc-branch-workflow-dialog .review")?.textContent.includes('
                + json.dumps(rebased) + ')')
    report['featureRebase'] = {'oldTip': source, 'rebasedTip': rebased, 'developmentTip': target,
                               'siblingTip': sibling, 'repositoryConfigUnchanged': True,
                               'freshFinishReviewContainsRebasedTip': True}
    report['scenarios'].append('native-feature-rebase-uses-configured-development-without-moving-sibling-refs')
    return repository, repo_id
