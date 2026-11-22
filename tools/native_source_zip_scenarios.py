"""Exercise the installed commit ZIP action and independently inspect the archive."""
import json
import uuid
import zipfile

from native_folder_picker import respond_to_owned_picker
from native_worktree_scenarios import checkout_footprint


def source_zip(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository('source-zip', commits=2)
    (repository / 'fixture.txt').write_text('Committed release contents.\n')
    (repository / 'excluded.txt').write_text('Excluded by export attributes.\n')
    (repository / '.gitattributes').write_text('excluded.txt export-ignore\n')
    fixtures.git(repository, 'add', '--', 'fixture.txt', 'excluded.txt', '.gitattributes')
    fixtures.git(repository, 'commit', '-qm', 'Pinned source ZIP contents')
    pinned = fixtures.git(repository, 'rev-parse', 'HEAD')
    (repository / 'fixture.txt').write_text('Newer HEAD contents.\n')
    fixtures.git(repository, 'commit', '-qam', 'Later local commit')
    (repository / 'fixture.txt').write_text('Unstaged draft.\n')
    (repository / 'not-published.txt').write_text('Staged draft.\n')
    fixtures.git(repository, 'add', '--', 'not-published.txt')
    fixtures.git(repository, 'config', 'tar.zip.command', 'printf ignored > should-not-run')
    files = ('fixture.txt', 'not-published.txt', 'excluded.txt', '.gitattributes')
    footprint = checkout_footprint(fixtures, repository, files)
    repo_id = open_ui(driver, repository)
    selector = '.commit-row[data-commit-oid=' + json.dumps(pinned) + ']'
    driver.wait('return !!document.querySelector(' + json.dumps(selector) + ')')
    driver.script("""
      const row = document.querySelector(arguments[0]);
      const bounds = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: bounds.left + 20, clientY: bounds.top + 10}));
    """, selector)
    driver.click_scrolled_text('.commit-context-menu button', 'Save committed files as ZIP…', wait_for_ready=True)
    picker = respond_to_owned_picker(driver.owned_display, driver.owned_session_application_pid,
                                    f'Save committed files from {pinned[:12]} as ZIP', fixtures.root)
    driver.wait("""return document.querySelector('[data-git-operation-status]')?.textContent.includes('Source ZIP cancelled; no file written')""")
    assert not list(fixtures.root.glob('*.zip'))
    report['scenarios'].append('native-commit-source-zip-opens-a-pinned-save-picker-and-cancels-without-writing')

    destination = fixtures.root / 'pinned-source.zip'
    size = driver.invoke('export_commit_source_zip', repoId=repo_id, oid=pinned,
                         destination=str(destination), operationId=str(uuid.uuid4()))
    assert destination.stat().st_size == size
    prefix = f'source-{pinned[:12]}/'
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert archive.comment.decode('ascii') == pinned
        assert archive.read(prefix + 'fixture.txt') == b'Committed release contents.\n'
        assert set(archive.namelist()) == {prefix, prefix + 'fixture.txt', prefix + '.gitattributes'}
    assert not (repository / 'should-not-run').exists()
    assert checkout_footprint(fixtures, repository, files) == footprint
    report['sourceZip'] = {'selectedCommit': pinned, 'bytes': size, 'picker': picker}
    report['scenarios'].append('native-source-zip-contains-committed-files-only-and-ignores-local-archive-configuration')
    return repository, repo_id
