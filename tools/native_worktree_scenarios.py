"""Occupied-branch navigation through the packaged UI and owned linked checkouts."""
import hashlib
import json
import subprocess
from pathlib import Path
from native_ui_conditions import wait_git_error_message


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
    symbolic = subprocess.run(
        ['git', '-C', str(repository), 'symbolic-ref', '--quiet', '--short', 'HEAD'],
        env=fixtures.env, capture_output=True, timeout=10,
    )
    if symbolic.returncode != 1:
        symbolic.check_returncode()
    return {
        'head': git('rev-parse', 'HEAD'),
        'branch': symbolic.stdout.decode().strip() if symbolic.returncode == 0 else None,
        'references': git('show-ref'),
        'status': git('status', '--porcelain=v1'),
        'indexSha256': _sha256(index),
        'configSha256': _sha256(config),
        'files': {name: _sha256(_owned_path(fixtures, repository / name)) for name in files},
    }


def worktree_recovery_before_removal(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('worktree-required-recovery', commits=2)
    linked = fixtures.root / 'owned-worktree-recovery'
    branch = 'owned-removal-branch'
    fixtures.git(repository, 'worktree', 'add', '-b', branch, str(linked))
    head = fixtures.git(linked, 'rev-parse', 'HEAD')
    # A file ref at this namespace prevents creation of the recovery child.
    fixtures.git(repository, 'update-ref', 'refs/git-khronos/recovery', head)
    repo_id = open_ui(driver, repository)
    before = checkout_footprint(fixtures, linked)
    registration = fixtures.git(repository, 'worktree', 'list', '--porcelain')
    try:
        driver.invoke('remove_worktree', repoId=repo_id, path=str(linked),
                      deleteBranch=True, force=False)
    except RuntimeError as failure:
        error = json.loads(str(failure))
    else:
        raise AssertionError('Worktree removal succeeded without saving recovery')
    assert (linked / 'fixture.txt').is_file(), 'Worktree was removed while its branch recovery was unavailable'
    assert error['kind'] == 'worktreeRecoveryUnavailable', error
    assert checkout_footprint(fixtures, linked) == before
    assert fixtures.git(repository, 'worktree', 'list', '--porcelain') == registration
    report['scenarios'].append('native-worktree-and-branch-removal-requires-recovery-before-removing-checkout')


def worktree_lock_menu(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('worktree-lock-menu', commits=2)
    linked = fixtures.root / 'owned-lock-checkout'
    fixtures.git(repository, 'worktree', 'add', '-b', 'owned-lock-branch', str(linked))
    open_ui(driver, repository)
    toggle = '#reference-section-worktrees .heading-toggle'
    driver.wait(f"return !!document.querySelector({json.dumps(toggle)})")
    if driver.script("return document.querySelector(arguments[0]).getAttribute('aria-expanded') === 'false'", toggle):
        driver.click_visible(toggle)
    opener = '[aria-label="Worktree actions for owned-lock-branch"]'
    driver.click_visible(opener)
    driver.click_navigation('button[role="menuitem"]', 'Lock this worktree…', wait_for_ready=True)
    driver.wait("return document.activeElement?.id === 'worktree-lock-reason'")
    driver.key('p', modifiers=("\ue009",))
    assert driver.script("return !document.querySelector('gk-command-palette')")
    reason = 'Keep this portable checkout'
    driver.script("""const input = document.getElementById('worktree-lock-reason');
        input.value = arguments[0]; input.dispatchEvent(new Event('input', {bubbles: true}));""", reason)
    driver.click_visible('gk-worktree-lock-dialog button[type="submit"]')
    driver.wait("return !document.querySelector('gk-worktree-lock-dialog')")
    assert f'locked {reason}' in fixtures.git(repository, 'worktree', 'list', '--porcelain')
    driver.click_visible(opener)
    driver.wait("""return [...document.querySelectorAll('button[role="menuitem"]')]
        .filter(button => ['Remove this worktree', 'Remove worktree and delete branch'].includes(button.textContent.trim()))
        .filter(button => button.disabled).length === 2;""")
    driver.click_visible('button[role="menuitem"]', 'Unlock this worktree')
    driver.wait("""return !document.querySelector('button[role="menuitem"][disabled]')
        && !document.querySelector('.worktree-list-main[aria-label*="locked:"]');""")
    assert 'locked ' not in fixtures.git(repository, 'worktree', 'list', '--porcelain')
    assert (linked / 'fixture.txt').is_file()
    report['scenarios'].append('native-worktree-lock-menu-reviews-reason-and-blocks-removal')


def worktree_prune_defaults_to_cancel(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('worktree-registration-cancel', commits=2)
    linked = fixtures.root / 'owned-prunable-checkout'
    moved = fixtures.root / 'owned-moved-checkout'
    active = fixtures.root / 'owned-active-checkout'
    fixtures.git(repository, 'worktree', 'add', '-b', 'owned-prunable-branch', str(linked))
    fixtures.git(repository, 'worktree', 'add', '-b', 'owned-active-branch', str(active))
    linked.rename(moved)
    open_ui(driver, repository)
    toggle = '#reference-section-worktrees .heading-toggle'
    if driver.script("return document.querySelector(arguments[0])?.getAttribute('aria-expanded') === 'false'", toggle):
        driver.click_visible(toggle)
    opener = '[aria-label="Worktree actions for owned-active-branch"]'
    driver.click_visible(opener)
    driver.click_navigation('button[role="menuitem"]', 'Review registrations and prune report…', wait_for_ready=True)
    modal = 'gk-worktree-registration-dialog [role="dialog"]'
    button = f'{modal} [data-prune-open]'
    driver.wait(f"return !!document.querySelector({json.dumps(button)})")
    before = checkout_footprint(fixtures, repository)
    registration = fixtures.git(repository, 'worktree', 'list', '--porcelain')
    driver.click_visible(button, 'Remove with recovery…')
    driver.wait("""return document.activeElement?.matches('gk-worktree-registration-dialog [data-prune-confirm] button')
      && document.activeElement.textContent.trim() === 'Cancel';""", timeout=5)
    driver.key('\ue007')  # Enter cancels the review, not the actual registration.
    driver.wait("""return !document.querySelector('gk-worktree-registration-dialog [data-prune-confirm]')
      && document.activeElement?.matches('gk-worktree-registration-dialog [data-prune-open]');""", timeout=5)
    assert fixtures.git(repository, 'worktree', 'list', '--porcelain') == registration
    assert checkout_footprint(fixtures, repository) == before
    assert (moved / 'fixture.txt').is_file()
    report['scenarios'].append('native-worktree-registration-removal-defaults-to-cancel-and-preserves-registration')


def occupied_branch_navigation(driver, fixtures, report):
    from native_acceptance import open_ui

    source = fixtures.repository('occupied-checkout-navigation', commits=3)
    fixtures.git(source, 'branch', '-m', 'dev')
    # Keep embedded and trailing whitespace in the registered path through
    # the production snapshot, confirmation, and native repository opening.
    owner = fixtures.root / 'occupied-owner Linéa\tfirst\nsecond '
    branch = 'owned/occupied-topic'
    fixtures.git(source, 'worktree', 'add', '-b', branch, str(owner))
    # Give the occupied branch its own visible graph pill, rather than a
    # branch-stack item sharing the source's tip.
    fixtures.git(owner, 'commit', '--allow-empty', '-m', 'Owned worktree branch tip')
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
    review = 'gk-checkout-worktree-dialog [role=dialog]'

    def open_review(from_graph=False, *, active=source, target=owner, ref=branch, from_keyboard=False):
        if from_graph:
            graph_branch = '.commit-row .branch-column button[aria-label="Graph reference ' + ref + ', local branch"]'
            element = driver.wait(f"""const button = document.querySelector({json.dumps(graph_branch)});
              // The first complete file scan inserts a WIP row above history.
              // Take the mouse target only after that row has actually painted.
              const wip = document.querySelector('gk-worktree-graph-row .wip-row:not(.linked-worktree)');
              if (document.querySelector('.wip-nav small')?.textContent.trim() !== '2 changed files'
                || !wip?.getClientRects().length) return null;
              if (!button || !button.getClientRects().length) return null;
              const r = button.getBoundingClientRect();
              return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
                ? button : null;""")
            hint = driver.script("return document.querySelector(arguments[0])?.title", graph_branch)
            assert "review the existing checkout" in hint, (
                "An occupied branch tooltip promised a checkout instead of explaining owner navigation", hint)
            # Deliver a real double click on the graph reference, not a
            # synthesized DOM event and not two separate commands to retry.
            driver.request('POST', driver.path('actions'), {'actions': [{
                'type': 'pointer', 'id': 'native-worktree-graph-mouse', 'parameters': {'pointerType': 'mouse'},
                'actions': [
                    {'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0, 'duration': 0},
                    {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0},
                    {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0},
                ],
            }]})
        elif from_keyboard:
            selector = '.branch-item[aria-label="Local branch ' + ref + '"]'
            driver.wait(f"""const button = document.querySelector({json.dumps(selector)});
              if (!button?.getClientRects().length || button.disabled) return false;
              button.focus();
              return document.activeElement === button;""")
            driver.key('\ue007', modifiers=('\ue008',))  # Shift+Enter
        else:
            driver.context_click('.branch-item[aria-label="Local branch ' + ref + '"]')
            # Checkout can be a write when a branch is free: never replay this click.
            driver.click_visible('.graph-action-menu button', 'Checkout branch')
        driver.wait('return !!document.querySelector(' + json.dumps(review) + ')')
        text = driver.script('return document.querySelector(arguments[0]).textContent', review)
        assert str(active) in text and str(target) in text and ref in text, text

    def at(path):
        driver.wait('return document.querySelector(".status-repository-path")?.textContent === ' + json.dumps(str(path)))

    open_review()
    driver.wait("""return document.activeElement?.matches('gk-checkout-worktree-dialog button')
      && document.activeElement.textContent.trim() === 'Cancel'""")
    driver.key('\ue004', modifiers=('\ue008',))  # Shift+Tab
    driver.wait("""return document.activeElement?.matches('gk-checkout-worktree-dialog button')
      && document.activeElement.textContent.trim() === 'Open existing checkout'""", timeout=5)
    driver.key('\ue004')  # Tab wraps back to the safe action.
    driver.wait("""return document.activeElement?.matches('gk-checkout-worktree-dialog button')
      && document.activeElement.textContent.trim() === 'Cancel'""")
    at(source)
    assert footprints() == before, 'Moving focus changed a checkout, index, configuration or reference'
    report['scenarios'].append('native-occupied-branch-review-wraps-shift-tab-without-navigating')
    driver.click_visible('gk-checkout-worktree-dialog button', 'Cancel')
    driver.wait('return !document.querySelector(' + json.dumps(review) + ')')
    at(source)
    after_cancel = footprints()
    assert after_cancel == before, 'Cancel changed a checkout, index, configuration or reference'
    report['scenarios'].append('native-occupied-branch-review-cancel-preserves-both-dirty-checkouts')

    open_review(from_graph=True)
    driver.screenshot(Path(report['artifactsDirectory']) / 'occupied-checkout-review.png')
    driver.wait("""const button = [...document.querySelectorAll('gk-checkout-worktree-dialog button')]
      .find(item => item.textContent.trim() === 'Open existing checkout');
      if (!button || button.disabled || !button.getClientRects().length) return false;
      button.focus();
      return document.activeElement === button;""")
    driver.script("""window.__ownedWorktreeFrame = window.requestAnimationFrame;
                    window.requestAnimationFrame = () => 0;""")
    try:
        driver.key('\ue007')  # Enter
        driver.wait('return !document.querySelector(' + json.dumps(review) + ')')
        at(owner)
        driver.wait("""return document.activeElement?.matches('.repo-tab-main[aria-selected="true"]')""", timeout=10)
    finally:
        driver.script("""window.requestAnimationFrame = window.__ownedWorktreeFrame;
                        delete window.__ownedWorktreeFrame;""")
    owner_branch = '[aria-label="View current branch ' + branch + ' tip"]'
    driver.wait('return !!document.querySelector(' + json.dumps(owner_branch) + ')')
    after_navigation = footprints()
    assert after_navigation == before, 'Opening the owner performed a checkout or changed Git data'
    report['scenarios'].append('native-occupied-branch-navigation-focuses-owner-tab-without-paint-frames')
    driver.screenshot(Path(report['artifactsDirectory']) / 'occupied-checkout-opened.png')
    report['scenarios'].append('native-occupied-branch-navigation-opens-registered-owner-without-checkout-or-data-loss')
    report['scenarios'].append('native-occupied-branch-graph-double-click-opens-registered-owner-without-detaching-head')

    # The primary checkout can own the branch too. From the linked checkout,
    # graph double-click on dev must open the already registered primary tab.
    open_review(from_graph=True, active=owner, target=source, ref='dev')
    driver.click_visible('gk-checkout-worktree-dialog button', 'Open existing checkout')
    driver.wait('return !document.querySelector(' + json.dumps(review) + ')')
    at(source)
    driver.wait("""return !!document.querySelector('[aria-label="View current branch dev tip"]')""")
    after_return = footprints()
    assert after_return == before, 'Returning to the primary checkout changed either checkout'
    report['scenarios'].append('native-occupied-dev-graph-double-click-returns-from-linked-to-primary-checkout')

    # Change real Git ownership after review. Fresh inspection must refuse the
    # old request, not silently fall back to a branch checkout in the source.
    open_ui(driver, source)
    open_review()
    fixtures.git(owner, 'checkout', '-b', 'owned/reassigned-topic')
    changed = footprints()
    driver.click_visible('gk-checkout-worktree-dialog button', 'Open existing checkout')
    driver.wait('return document.querySelector("gk-checkout-worktree-dialog [role=alert]")?.textContent.includes("Branch ownership changed")')
    at(source)
    assert driver.script('return [...document.querySelectorAll("gk-checkout-worktree-dialog button")].find(button => button.textContent.trim() === "Open existing checkout").disabled')
    after_refusal = footprints()
    assert after_refusal == changed, 'A stale owner review fell back to a Git mutation'
    driver.screenshot(Path(report['artifactsDirectory']) / 'occupied-checkout-owner-changed.png')
    driver.key('\ue00c')  # Escape dismisses the error without retrying the read.
    driver.wait('return !document.querySelector(' + json.dumps(review) + ')')
    report['scenarios'].append('native-occupied-branch-review-refuses-changed-owner-without-fallback-checkout')

    # A registered checkout can disappear while the ownership dialog is open.
    # Review the now-unavailable registration without pruning or repairing it.
    open_ui(driver, source)
    open_review(ref='owned/reassigned-topic', from_keyboard=True)
    parked_owner = owner.with_name(owner.name + '-parked')
    owner.rename(parked_owner)
    registration = 'gk-worktree-registration-dialog [role=dialog]'
    try:
        driver.click_visible(review + ' button', 'Open existing checkout')
        driver.wait("""return document.querySelector('gk-checkout-worktree-dialog [role=alert]')
          ?.textContent.includes('became unavailable during review')""")
        driver.click_visible(review + ' button', 'Review registrations…')
        driver.wait(f"""return document.querySelector({json.dumps(registration)})
          ?.textContent.includes({json.dumps(str(owner))}) && !document.querySelector({json.dumps(review)})""")
        at(source)
        assert not owner.exists(), 'Read-only registration review recreated the missing worktree'
        driver.click_visible(registration + ' button', 'Close')
        driver.wait('return !document.querySelector(' + json.dumps(registration) + ')')
    finally:
        parked_owner.rename(owner)
    assert footprints() == changed, 'Registration review modified a checkout, index, configuration or reference'
    report['scenarios'].append('native-occupied-branch-review-opens-read-only-registration-report-for-missing-owner')

    report['occupiedBranchNavigation'] = {
        'source': str(source), 'owner': str(owner), 'branch': branch,
        'before': before, 'afterCancel': after_cancel, 'afterNavigation': after_navigation,
        'afterReturnToPrimary': after_return,
        'afterOwnedOwnershipChange': changed, 'afterStaleReviewRefusal': after_refusal,
    }


def reserved_branch_guidance(driver, fixtures, report):
    from native_acceptance import open_ui

    source = fixtures.repository('reserved-branch-guidance', commits=3)
    owner = fixtures.root / 'checkout with pending rebase'
    branch = 'owned/rebase-topic'
    fixtures.git(source, 'worktree', 'add', '-b', branch, str(owner))
    for checkout, content in ((source, 'main change\n'), (owner, 'topic change\n')):
        (checkout / 'fixture.txt').write_text(content)
        fixtures.git(checkout, 'commit', '-am', content.strip())
    # Create a real stopped rebase; no mocked native response or hand-written Git state.
    rebase = subprocess.run(
        ['git', '-C', str(owner), 'rebase', 'main'], env=fixtures.env,
        capture_output=True, timeout=15,
    )
    assert rebase.returncode == 1, rebase.stderr

    def footprints():
        return {
            'source': checkout_footprint(fixtures, source),
            'owner': checkout_footprint(fixtures, owner),
            'rebaseHead': fixtures.git(owner, 'rev-parse', '--verify', 'REBASE_HEAD'),
            'conflicts': fixtures.git(owner, 'ls-files', '--unmerged'),
        }

    repo_id = open_ui(driver, source)
    before = footprints()
    assert before['source']['branch'] == 'main' and before['owner']['branch'] is None
    assert before['rebaseHead'] == fixtures.git(source, 'rev-parse', 'refs/heads/' + branch)
    assert before['conflicts']
    driver.context_click('.branch-item[aria-label="Local branch ' + branch + '"]')
    driver.click_visible('.graph-action-menu button', 'Checkout branch')
    message = wait_git_error_message(driver)
    assert branch in message and str(owner) in message, message
    driver.wait('return document.querySelector(".status-repository-path")?.textContent === ' + json.dumps(str(source)))
    assert not driver.script('return !!document.querySelector("gk-checkout-worktree-dialog [role=dialog]")')
    after = footprints()
    assert after == before, 'Refused checkout changed the source or the pending rebase'
    report['reservedBranchGuidance'] = {'before': before, 'after': after, 'message': message}
    assert all(term in message for term in ('In Worktrees', 'rebase or bisect', 'Do not force')), message
    report['scenarios'].append('native-detached-rebase-reservation-guides-checkout-without-changing-either-worktree')
    return source, repo_id
