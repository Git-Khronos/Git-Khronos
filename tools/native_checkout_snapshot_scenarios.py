"""Hold a real snapshot's branch-list read across an external same-tip switch."""
import time

from native_worktree_scenarios import checkout_footprint


def coherent_checkout_snapshot(driver, fixtures, report):
    repository = fixtures.repository('coherent-checkout-snapshot', commits=3)
    fixtures.git(repository, 'branch', 'parallel')
    before = checkout_footprint(fixtures, repository)
    gate = fixtures.history_gate
    (gate / 'target').write_text(str(repository))
    # The first-frame native snapshot has read the status branch before it
    # dispatches for-each-ref with refs/heads and refs/remotes.
    (gate / 'mode').write_text('refs/remotes')
    hold = gate / 'hold'
    entered = gate / 'started'
    driver.wait('return !!document.querySelector("gc-root")')
    hold.touch()
    try:
        driver.script("""window.__ownedCheckoutSnapshot = { pending: true };
          window.__TAURI_INTERNALS__.invoke('open_repository', { path: arguments[0] }).then(
            snapshot => window.__ownedCheckoutSnapshot = { snapshot },
            error => window.__ownedCheckoutSnapshot = { error });""", str(repository))
        deadline = time.monotonic() + 15
        while not entered.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert entered.exists(), 'The snapshot never entered its held Git reference read'
        first_sample_pid = entered.read_text().strip()
        assert first_sample_pid.isdigit(), 'The first Git reference sample did not identify its worker'
        assert driver.script('return window.__ownedCheckoutSnapshot.pending === true')
        fixtures.git(repository, 'switch', 'parallel')
        after_switch = checkout_footprint(fixtures, repository)
        assert after_switch['branch'] == 'parallel' and after_switch['head'] == before['head']
        assert after_switch['references'] == before['references']
    finally:
        hold.unlink(missing_ok=True)
    result = driver.wait("""const result = window.__ownedCheckoutSnapshot;
        return result && !result.pending ? result : null;""")
    assert 'snapshot' in result, result
    snapshot = result['snapshot']
    registration, = (tree for tree in snapshot['worktrees'] if tree['current'])
    current_refs = [item['name'] for item in snapshot['branches'] if item['current'] and not item['remote']]
    second_sample_pid = entered.read_text().strip()
    assert second_sample_pid.isdigit(), 'The final Git reference sample did not identify its worker'
    observed = {
        'statusBranch': snapshot['status']['branch'],
        'worktreeBranch': registration['branch'],
        'currentRefs': current_refs,
        'head': snapshot['headOid'],
        'worktreeHead': registration['oid'],
        'retriedRead': first_sample_pid != second_sample_pid,
    }
    report['coherentCheckoutSnapshot'] = observed
    assert observed == {
        'statusBranch': 'parallel', 'worktreeBranch': 'parallel', 'currentRefs': ['parallel'],
        'head': before['head'], 'worktreeHead': before['head'], 'retriedRead': True,
    }, observed
    assert checkout_footprint(fixtures, repository) == after_switch
    report['scenarios'].append('native-snapshot-retries-mixed-reads-across-an-external-same-tip-checkout')
    return repository, snapshot['id']
