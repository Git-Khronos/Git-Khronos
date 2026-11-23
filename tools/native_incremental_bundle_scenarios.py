"""Exercise incremental bundle review through installed WebKit and verify the Git artifact."""
import json

from native_folder_picker import respond_to_owned_picker
from native_worktree_scenarios import checkout_footprint


def incremental_bundle_export(driver, fixtures, report):
    from native_acceptance import open_ui

    source = fixtures.repository('incremental-bundle-source', commits=2)
    base = fixtures.git(source, 'rev-parse', 'HEAD')
    receiver = fixtures.root / 'incremental-receiver'
    fixtures.git(fixtures.root, 'clone', '--no-hardlinks', '--', str(source), str(receiver))
    fixtures.git(receiver, 'config', 'user.name', 'Bundle Fixture')
    fixtures.git(receiver, 'config', 'user.email', 'bundle@example.test')
    (source / 'offline payload.bin').write_bytes(b'\x00\xff\x01\x02')
    fixtures.git(source, 'add', '--', 'offline payload.bin')
    fixtures.git(source, 'commit', '-qm', 'Offline update')
    tip = fixtures.git(source, 'rev-parse', 'HEAD')
    source_before = checkout_footprint(fixtures, source, ('fixture.txt', 'offline payload.bin'))
    receiver_before = checkout_footprint(fixtures, receiver)
    repo_id = open_ui(driver, source)

    panel = 'gk-bundle-exchange-panel'
    driver.click_visible('[aria-label="Preferences"]')
    driver.click_visible('#preferences-tab-git')
    driver.click_scrolled_text(panel + ' summary', 'Offline Git bundles', wait_for_ready=True)
    driver.wait('return !!document.getElementById("bundle-export-branch")?.querySelector(\'option[value="main"]\')')
    driver.script("""
      const select = document.getElementById('bundle-export-branch');
      select.value = 'main'; select.dispatchEvent(new Event('change', { bubbles: true }));
    """)
    driver.click_scrolled_text(panel + ' fieldset label', 'Export incrementally from a commit the recipient already has',
                               wait_for_ready=True)
    driver.wait('return !!document.getElementById("bundle-export-base")')
    driver.script("""
      const input = document.getElementById('bundle-export-base');
      input.value = arguments[0]; input.dispatchEvent(new Event('input', { bubbles: true }));
    """, base)
    driver.click_scrolled_text(panel + ' button', 'Review incremental range', wait_for_ready=True)
    driver.wait("""
      const review = document.querySelector('[aria-label="Incremental bundle export review"]');
      return review === document.activeElement && review?.textContent.includes('1 commit to export')
        && review.textContent.includes(arguments[0]) && review.textContent.includes(arguments[1]);
    """.replace('arguments[0]', json.dumps(base)).replace('arguments[1]', json.dumps(tip)))
    assert not list(fixtures.root.glob('*.bundle'))
    driver.click_scrolled_text(panel + ' button', 'Save incremental bundle…', wait_for_ready=True)
    picker = respond_to_owned_picker(driver.owned_display, driver.owned_session_application_pid,
                                     'Save a new incremental bundle outside the repository', fixtures.root)
    driver.wait("""return document.querySelector('[data-git-operation-status]')?.textContent.includes('Bundle export cancelled')""")
    assert not list(fixtures.root.glob('*.bundle'))
    report['scenarios'].append('native-incremental-bundle-review-pins-base-and-tip-and-cancelling-picker-writes-nothing')

    args = {'repoId': repo_id, 'branch': 'main', 'expectedOid': tip, 'baseOid': base}
    exact = driver.invoke('review_git_bundle_export_range', **args)
    assert exact == {'branch': 'main', 'tipOid': tip, 'baseOid': base, 'commitCount': 1}
    bundle = fixtures.root / 'incremental.bundle'
    written = driver.invoke('export_git_bundle', **args, destination=str(bundle))
    assert bundle.stat().st_size == written
    assert ('-' + base + ' ').encode() in bundle.read_bytes().split(b'\n\n', 1)[0]
    assert fixtures.git(receiver, 'bundle', 'list-heads', str(bundle)) == tip + ' refs/heads/main'
    empty = fixtures.root / 'incremental-empty'
    empty.mkdir()
    fixtures.git(empty, 'init', '-b', 'main')
    empty_id = driver.invoke('open_repository', path=str(empty))['id']
    try:
        driver.invoke('review_git_bundle', repoId=empty_id, file=str(bundle))
    except RuntimeError as error:
        assert 'prerequisite' in str(error).lower(), str(error)
    else:
        raise AssertionError('Bundle review accepted a recipient without the prerequisite')

    receiver_id = driver.invoke('open_repository', path=str(receiver))['id']
    verified = driver.invoke('review_git_bundle', repoId=receiver_id, file=str(bundle))
    captured_tip, = verified['request']['tips']
    recovered = driver.invoke('import_git_bundle', repoId=receiver_id, request=verified['request'], tip=captured_tip)
    assert fixtures.git(receiver, 'rev-parse', recovered) == tip
    assert fixtures.git(receiver, 'rev-parse', recovered + '^') == base
    assert fixtures.git(receiver, 'rev-parse', recovered + ':offline payload.bin') == fixtures.git(
        source, 'rev-parse', tip + ':offline payload.bin',
    )
    assert fixtures.git(receiver, 'rev-parse', 'HEAD') == base
    assert not (receiver / 'offline payload.bin').exists()
    receiver_after = checkout_footprint(fixtures, receiver)
    assert set(receiver_after['references'].splitlines()) == {
        *receiver_before['references'].splitlines(), f'{tip} {recovered}',
    }
    assert {**receiver_after, 'references': receiver_before['references']} == receiver_before
    assert checkout_footprint(fixtures, source, ('fixture.txt', 'offline payload.bin')) == source_before
    report['incrementalBundle'] = {'base': base, 'tip': tip, 'bytes': written, 'picker': picker}
    report['scenarios'].append('native-incremental-bundle-requires-the-base-and-imports-only-the-new-recovery-tip')
    return source, repo_id
