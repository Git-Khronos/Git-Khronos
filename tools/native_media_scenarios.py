"""Owned image fixtures through actual packaged IPC and native WebKit controls."""
import base64
import json
from pathlib import Path
import uuid

from native_acceptance import open_ui


def file_media_comparisons(driver, fixtures, original_repository, report):
    source = Path(__file__).resolve().parents[1] / 'crates/git-core/tests/fixtures/media'
    repository = fixtures.repository('selected-file-media', commits=2)
    formats = [
        ('png', 'tiles.png', 'image/png', 3, 2),
        ('jpeg', 'rotated.jpg', 'image/jpeg', 2, 3),
        ('gif', 'tiles.gif', 'image/gif', 3, 2),
        ('webp', 'tiles.webp', 'image/webp', 3, 2),
        ('bmp', 'tiles.bmp', 'image/bmp', 3, 2),
        ('ico', 'tiles.ico', 'image/x-icon', 16, 16),
    ]
    before_bytes, after_bytes = {}, {}
    for name, file, _, _, _ in formats:
        path = 'image-' + name
        before_bytes[path] = (source / ('tiles.jpg' if name == 'png' else 'tiles.png')).read_bytes()
        after_bytes[path] = (source / file).read_bytes()
        (repository / path).write_bytes(before_bytes[path])
    fixtures.git(repository, 'add', '--all')
    fixtures.git(repository, 'commit', '-qm', 'Owned before-image fixtures')
    base = fixtures.git(repository, 'rev-parse', 'HEAD')
    for path, data in after_bytes.items():
        (repository / path).write_bytes(data)
    dirty = dict(after_bytes)
    dirty['pointer-image'] = ('version https://git-lfs.github.com/spec/v1\noid sha256:'
                              + 'ab' * 32 + '\nsize 18446744073709551615\n').encode()
    dirty['svg-image'] = b'<svg xmlns="http://www.w3.org/2000/svg"><script>throw 1</script></svg>'
    dirty['binary-image'] = b'owned\0binary'
    dirty['malformed-image'] = (source / 'tiles.png').read_bytes()[:24]
    for path, data in dirty.items():
        (repository / path).write_bytes(data)
    index = (repository / '.git/index').read_bytes()
    config = (repository / '.git/config').read_bytes()
    refs = fixtures.git(repository, 'show-ref')

    def call(path, context=None, repository_id=None):
        return driver.invoke('inspect_file_media', repoId=repository_id or repo_id,
                             operationId=str(uuid.uuid4()), request=dict(
                                 context=context or dict(kind='workingTree', staged=False),
                                 path=path, previousPath=None))

    def click_file(selector):
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ')')
        driver.script("""
          const candidates = [...document.querySelectorAll(arguments[0])]
            .filter(element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible');
          if (candidates.length !== 1) throw Error('Expected one visible owned media row');
          candidates[0].scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'auto'});
        """, selector)
        driver.click_visible(selector)

    def payload(side):
        assert side['state'] == 'raster', side
        return base64.b64decode(side['dataUrl'].split(',', 1)[1], validate=True)

    try:
        repo_id = driver.invoke('open_repository', path=str(repository))['id']
        for name, _, mime, _, _ in formats:
            path = 'image-' + name
            pair = call(path)
            assert payload(pair['before']) == before_bytes[path]
            assert payload(pair['after']) == after_bytes[path]
            assert pair['after']['raster']['mime'] == mime
            assert pair['after']['size'] == str(len(after_bytes[path]))
            immutable = call(path, dict(kind='commit', oid=base))
            assert payload(immutable['after']) == before_bytes[path]
            against_working = call(path, dict(kind='revisionWorktree', baseOid=base))
            assert payload(against_working['before']) == before_bytes[path]
            assert payload(against_working['after']) == after_bytes[path]
        report['scenarios'].append('native-media-six-formats-exact-commit-index-working-and-revision-working-bytes')

        pointer = call('pointer-image')['after']
        assert pointer['state'] == 'lfsPointer' and pointer['dataUrl'] is None
        assert pointer['lfs'] == dict(sha256='ab' * 32, size='18446744073709551615')
        assert call('svg-image')['after']['state'] == 'text'
        assert call('binary-image')['after']['state'] == 'binary'
        for bad_id, bad_path in [('expired-owned-media-session', 'image-png'), (repo_id, '../outside')]:
            try:
                call(bad_path, repository_id=bad_id)
                raise AssertionError('Invalid media selection reached file presentation')
            except RuntimeError as error:
                assert ('unknownRepository' if bad_id != repo_id else 'fileContentRefused') in str(error), error
        report['scenarios'].append('native-media-lfs-large-size-svg-binary-and-session-path-boundaries')

        open_ui(driver, repository)
        driver.click('.wip-nav')
        for name, _, mime, width, height in formats:
            path = 'image-' + name
            selector = '[aria-label=' + json.dumps('View changes in ' + path) + ']'
            click_file(selector)
            driver.click_text('.diff-insight-toggle button', 'Content')
            driver.wait('''return (() => {
              const article = document.querySelector('gc-file-media article[aria-label="After content"]');
              const image = article?.querySelector('img');
              return image?.complete && image.naturalWidth === ''' + str(width) + ''' && image.naturalHeight === ''' + str(height) + ''';
            })()''')
            assert driver.script("return document.querySelector('gc-file-media').textContent.includes(arguments[0])", mime)
            assert not driver.script("return !!document.querySelector('gc-file-media [role=alert]')")
            driver.click_text('gc-file-media button', 'Actual size')
            driver.click_text('gc-file-media button', 'After only')
            assert driver.script("return document.querySelectorAll('gc-file-media article').length") == 1
            driver.screenshot(Path(report['artifactsDirectory']) / ('media-native-' + name + '.png'))
            driver.click('[aria-label="Close diff"]')
            report['scenarios'].append('native-ui-media-' + name + '-decode-fit-actual-size-and-single-side')

        selector = '[aria-label="View changes in malformed-image"]'
        click_file(selector)
        driver.click_text('.diff-insight-toggle button', 'Content')
        driver.wait("return document.querySelector('gc-file-media')?.textContent.includes('Image decoding failed')")
        assert driver.script("return document.querySelectorAll('gc-file-media img').length") == 0
        driver.screenshot(Path(report['artifactsDirectory']) / 'media-native-decode-failure.png')
        driver.click('[aria-label="Close diff"]')
        report['scenarios'].append('native-ui-media-valid-header-truncated-body-reports-actual-webkit-decode-failure')

        assert (repository / '.git/index').read_bytes() == index
        assert (repository / '.git/config').read_bytes() == config
        assert fixtures.git(repository, 'show-ref') == refs
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == base
        for path, data in dirty.items():
            assert (repository / path).read_bytes() == data
    except Exception:
        try:
            destination = Path(report['artifactsDirectory'])
            driver.screenshot(destination / 'media-native-failure.png')
            state = driver.script("""return {
              text: document.body.innerText.slice(0, 30000),
              rows: [...document.querySelectorAll('.file-name-button')].map(element => ({
                label: element.getAttribute('aria-label'), title: element.title,
                rect: element.getBoundingClientRect().toJSON(),
                parent: {scrollTop: element.parentElement.parentElement.scrollTop,
                  height: element.parentElement.parentElement.clientHeight}
              }))
            }""")
            (destination / 'media-native-failure.json').write_text(json.dumps(state, indent=2))
        except Exception as capture_error:
            (Path(report['artifactsDirectory']) / 'media-capture-error.txt').write_text(str(capture_error))
        raise
    finally:
        open_ui(driver, original_repository)
