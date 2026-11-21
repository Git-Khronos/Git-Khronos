"""Occupied-branch navigation through the packaged UI and owned linked checkouts."""
import hashlib
import json
from pathlib import Path


def _owned_path(fixtures, path):
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(fixtures.root.resolve()):
        raise ValueError('Worktree evidence must stay inside the owned fixture')
    return resolved


def _git_path(fixtures, repository, name):
    value = Path(fixtures.git(repository, '--no-optional-locks', 'rev-parse', '--git-path', name))
    return _owned_path(fixtures, value if value.is_absolute() else repository / value)


def _sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def checkout_footprint(fixtures, repository, files=('fixture.txt',)):
    """Read each worktree's own index and shared config, not its .git pointer as a directory."""
    index = _git_path(fixtures, repository, 'index')
    config = _git_path(fixtures, repository, 'config')
    git = lambda *args: fixtures.git(repository, '--no-optional-locks', *args)
    return {
        'head': git('rev-parse', 'HEAD'),
        'branch': git('symbolic-ref', '--short', 'HEAD'),
        'references': git('show-ref'),
        'status': git('status', '--porcelain=v1'),
        'indexSha256': _sha256(index),
        'configSha256': _sha256(config),
        'files': {name: _sha256(_owned_path(fixtures, repository / name)) for name in files},
    }


def occupied_branch_navigation(driver, fixtures, report):
    from native_acceptance import open_ui

    source = fixtures.repository('occupied-checkout-navigation', commits=3)
    # Keep embedded and trailing whitespace in the registered path through
    # the production snapshot, confirmation, and native repository opening.
    owner = fixtures.root / 'occupied-owner Linéa\tfirst\nsecond '
    branch = 'owned/occupied-topic'
    fixtures.git(source, 'worktree', 'add', '-b', branch, str(owner))
    (source / 'fixture.txt').write_text('Source checkout changes must survive navigation.\n')
    (owner / 'fixture.txt').write_text('Owning checkout changes must survive navigation.\n')
    (source / 'source-note.txt').write_text('Untracked source contents.\n')
    (owner / 'owner-note.txt').write_text('Untracked owner contents.\n')
    open_ui(driver, source)

    def footprints():
        return {
            'source': checkout_footprint(fixtures, source, ('fixture.txt', 'source-note.txt')),
            'owner': checkout_footprint(fixtures, owner, ('fixture.txt', 'owner-note.txt')),
        }

    before = footprints()
    review = 'gc-checkout-worktree-dialog [role=dialog]'
    branch_button = '.branch-item[aria-label="Local branch ' + branch + '"]'

    def open_review():
        driver.context_click(branch_button)
        # Checkout can be a write when a branch is free: never replay this click.
        driver.click_visible('.graph-action-menu button', 'Checkout branch')
        driver.wait('return !!document.querySelector(' + json.dumps(review) + ')')
        text = driver.script('return document.querySelector(arguments[0]).textContent', review)
        assert str(source) in text and str(owner) in text and branch in text, text

    def at(path):
        driver.wait('return document.querySelector(".status-repository-path")?.textContent === ' + json.dumps(str(path)))

    open_review()
    driver.click_visible('gc-checkout-worktree-dialog button', 'Cancel')
    driver.wait('return !document.querySelector(' + json.dumps(review) + ')')
    at(source)
    after_cancel = footprints()
    assert after_cancel == before, 'Cancel changed a checkout, index, configuration or reference'
    report['scenarios'].append('native-occupied-branch-review-cancel-preserves-both-dirty-checkouts')

    open_review()
    driver.screenshot(Path(report['artifactsDirectory']) / 'occupied-checkout-review.png')
    driver.click_visible('gc-checkout-worktree-dialog button', 'Open existing checkout')
    driver.wait('return !document.querySelector(' + json.dumps(review) + ')')
    at(owner)
    owner_branch = '[aria-label="View current branch ' + branch + ' tip"]'
    driver.wait('return !!document.querySelector(' + json.dumps(owner_branch) + ')')
    after_navigation = footprints()
    assert after_navigation == before, 'Opening the owner performed a checkout or changed Git data'
    driver.screenshot(Path(report['artifactsDirectory']) / 'occupied-checkout-opened.png')
    report['scenarios'].append('native-occupied-branch-navigation-opens-registered-owner-without-checkout-or-data-loss')

    # Change real Git ownership after review. Fresh inspection must refuse the
    # old request, not silently fall back to a branch checkout in the source.
    open_ui(driver, source)
    open_review()
    fixtures.git(owner, 'checkout', '-b', 'owned/reassigned-topic')
    changed = footprints()
    driver.click_visible('gc-checkout-worktree-dialog button', 'Open existing checkout')
    driver.wait('return document.querySelector("gc-checkout-worktree-dialog [role=alert]")?.textContent.includes("Branch ownership changed")')
    at(source)
    assert driver.script('return [...document.querySelectorAll("gc-checkout-worktree-dialog button")].find(button => button.textContent.trim() === "Open existing checkout").disabled')
    after_refusal = footprints()
    assert after_refusal == changed, 'A stale owner review fell back to a Git mutation'
    driver.screenshot(Path(report['artifactsDirectory']) / 'occupied-checkout-owner-changed.png')
    driver.click_visible('gc-checkout-worktree-dialog button', 'Cancel')
    report['scenarios'].append('native-occupied-branch-review-refuses-changed-owner-without-fallback-checkout')
    report['occupiedBranchNavigation'] = {
        'source': str(source), 'owner': str(owner), 'branch': branch,
        'before': before, 'afterCancel': after_cancel, 'afterNavigation': after_navigation,
        'afterOwnedOwnershipChange': changed, 'afterStaleReviewRefusal': after_refusal,
    }
