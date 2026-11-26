"""Original fork acceptance through packaged controls, owned TLS and private records."""
import json
from pathlib import Path
import re
from unittest.mock import patch
import uuid
from native_repository_navigation import open_gitlab_catalogue


_SOURCE_PATH = 'team/subgroup/owned-project'
_LOCAL_FORK_TRANSITIONS = frozenset({
    ('gk-repository-dialog button', 'Browse GitLab projects'),
    ('gk-gitlab-projects button', 'Return from forks to GitLab projects'),
    ('gk-gitlab-fork-records button', 'Return from outcomes to GitLab projects'),
    ('gk-gitlab-projects button', 'Open saved fork outcomes'),
    ('gk-gitlab-fork-create button', 'Inspect saved fork outcomes'),
    ('gk-gitlab-projects button', 'Browse forks of ' + _SOURCE_PATH),
    ('gk-gitlab-projects button', 'Review a new GitLab fork'),
})


def click_fork_button(driver, selector, text):
    """Capture readiness and the target together; only local transitions may replay."""
    if (selector, text) in _LOCAL_FORK_TRANSITIONS:
        # A local control may follow an asynchronous catalogue read. Only
        # its safe click is eligible for stale recovery, never the read.
        return driver.click_navigation(selector, text, scroll=True, wait_for_ready=True, timeout=30)
    return driver.click_scrolled_text(selector, text, wait_for_ready=True)


def prove_stale_navigation_replacement(driver, report):
    """Use real WebDriver stale handling on an inert, harness-owned control."""
    selector = '#owned-stale-navigation-probe button'
    text = 'Owned navigation probe'
    old = driver.script("""const probe = document.createElement('div');
      probe.id = 'owned-stale-navigation-probe';
      probe.style.cssText = 'position:fixed;top:16px;left:16px;z-index:2147483647';
      const button = document.createElement('button');
      button.textContent = arguments[0];
      probe.append(button);
      document.body.append(probe);
      return button;""", text)
    try:
        driver.script("""const old = arguments[0], next = old.cloneNode(true);
          const probe = old.parentElement;
          probe.dataset.clicks = '0';
          probe.dataset.disabledClicks = '0';
          const disabled = old.cloneNode(true);
          disabled.setAttribute('aria-disabled', 'true');
          disabled.addEventListener('click', () => ++probe.dataset.disabledClicks);
          next.addEventListener('click', () => ++probe.dataset.clicks);
          old.replaceWith(disabled, next);""", old)
        # Pin the first dispatch to the detached element. The resulting stale
        # response comes from WebDriver, not a simulated exception.
        with patch.object(driver, 'click_text', side_effect=lambda *_: driver._click_element(old)) as first:
            driver.click_navigation(selector, text)
        assert first.call_count == 1
        assert driver.script("""const data = document.querySelector('#owned-stale-navigation-probe').dataset;
          return [data.clicks, data.disabledClicks];""") == ['1', '0']
        # The next distinct navigation starts with both buttons present.
        # Its initial lookup, too, must ignore the disabled duplicate.
        driver.click_navigation(selector, text)
        assert driver.script("""const data = document.querySelector('#owned-stale-navigation-probe').dataset;
          return [data.clicks, data.disabledClicks];""") == ['2', '0']
        # Model the Clone tab transition: the first real DOM poll sees two
        # disabled controls, then the intended button becomes available.
        execute = driver.script
        execute("document.querySelector(arguments[0] + ':last-child').disabled = true", selector)
        readiness_polls = []

        def reveal_after_first_poll(*args, **kwargs):
            result = execute(*args, **kwargs)
            readiness_polls.append(len(result))
            if len(readiness_polls) == 1:
                assert result == [], "The first poll unexpectedly found a ready control"
                execute("document.querySelector(arguments[0] + ':last-child').disabled = false", selector)
            return result

        # Model a live WebKit page whose compositor is not delivering frames.
        execute("""const probe = document.querySelector('#owned-stale-navigation-probe');
          probe.originalAnimationFrame = window.requestAnimationFrame;
          window.requestAnimationFrame = () => 0;""")
        try:
            with patch.object(driver, 'script', side_effect=reveal_after_first_poll):
                driver.click_navigation(selector, text, scroll=True, wait_for_ready=True)
        finally:
            execute("""window.requestAnimationFrame =
                document.querySelector('#owned-stale-navigation-probe').originalAnimationFrame;""")
        assert readiness_polls == [0, 1], readiness_polls
        assert execute("""const data = document.querySelector('#owned-stale-navigation-probe').dataset;
          return [data.clicks, data.disabledClicks];""") == ['3', '0']
    finally:
        driver.script("document.querySelector('#owned-stale-navigation-probe')?.remove()")
    report['scenarios'].append('native-webdriver-explicit-stale-refusal-clicks-only-the-owned-replacement')
    report['scenarios'].append('native-webdriver-initial-navigation-ignores-disabled-duplicate')
    report['scenarios'].append('native-webdriver-waits-for-delayed-navigation-and-clicks-once')
    report['scenarios'].append('native-webdriver-navigation-without-paint-frames-clicks-once')


def gitlab_reviewed_forks(driver, fixtures, repository, report):
    gate, origin = fixtures.gitlab_gate, fixtures.gitlab_origin
    token = 'owned-api-fixture-token'
    namespace = {'id': 9007199254740993, 'name': 'Owned reader', 'path': 'owned-reader',
                 'full_path': 'owned-reader', 'kind': 'user'}
    source_path = _SOURCE_PATH
    before = {'refs': fixtures.git(repository, 'show-ref'),
              'index': (repository / '.git/index').read_bytes(),
              'config': (repository / '.git/config').read_bytes(),
              'status': fixtures.git(repository, 'status', '--porcelain=v1')}

    def requests():
        file = gate / 'requests.jsonl'
        return [json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []

    def posts():
        return [entry for entry in requests() if entry.get('method') == 'POST']

    def local():
        return driver.invoke('list_gitlab_fork_records', request={'operationId': str(uuid.uuid4())})

    def row(target):
        matches = [entry for entry in local()['entries'] if (entry.get('record') or {}).get('targetFullPath') == 'owned-reader/' + target]
        assert len(matches) == 1, matches
        return matches[0]

    def button(text, scope='gk-gitlab-projects'):
        click_fork_button(driver, scope + ' button', text)

    def fill(selector, value, event='input'):
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ') && !document.querySelector(' + json.dumps(selector) + ').matches(":disabled")')
        driver.script("const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event(arguments[2],{bubbles:true}));", selector, value, event)

    def connect(write):
        fill('#gitlab-origin', origin)
        fill('#gitlab-token', token)
        checked = driver.script("return document.querySelector('#gitlab-fork-requests').checked")
        if checked != write:
            driver.click('#gitlab-fork-requests')
        button('Connect to GitLab')
        driver.wait("return !!document.querySelector('#gitlab-account')?.value")
        selected = driver.script("return document.querySelector('#gitlab-account').value")
        connection = next(item for item in driver.invoke('gitlab_connections') if item['connectionId'] == selected)
        assert connection['canCreateFork'] is write and connection['account'] == {'origin': origin, 'id': '41', 'login': 'owned-reader'}
        assert driver.script("return document.querySelector('#gitlab-token').value") == ''
        return connection

    def browse():
        button('Load GitLab projects')
        button('Browse forks of ' + source_path)
        driver.wait("return !!document.querySelector('gk-gitlab-forks')")

    def review(target):
        button('Review a new GitLab fork')
        button('Load destination namespaces', 'gk-gitlab-fork-create')
        fill('#fork-namespace', str(namespace['id']), 'change')
        fill('#fork-project-path', target)
        before_post = len(posts())
        button('Prepare fork review', 'gk-gitlab-fork-create')
        driver.wait("return !!document.querySelector('gk-gitlab-fork-create [aria-label=\"Prepared fork request\"]')")
        assert len(posts()) == before_post, 'Preparing dispatched a provider write'

    def capture(label, selector, text=None):
        for width, height, suffix in [(1440, 900, 'normal'), (780, 560, 'compact')]:
            driver.request('POST', driver.path('window/rect'), {'width': width, 'height': height})
            for edge in ['start', 'end']:
                driver.wait_for_dialog_capture(selector, text, edge=edge, require_action=edge == 'end')
                driver.screenshot(Path(report['artifactsDirectory']) / (label + '-' + suffix + '-' + edge + '.png'))
        driver.request('POST', driver.path('window/rect'), {'width': 1440, 'height': 900})

    def saved(target):
        button('Inspect saved fork outcomes', 'gk-gitlab-fork-create')
        driver.wait("return !!document.querySelector('gk-gitlab-fork-records ul')?.textContent.includes(" + json.dumps('owned-reader/' + target) + ")")
        return row(target)

    def return_projects():
        button('Return from outcomes to GitLab projects', 'gk-gitlab-fork-records')

    def submit():
        count = len(posts())
        button('Submit reviewed fork request', 'gk-gitlab-fork-create')
        driver.wait("return !!document.querySelector('gk-gitlab-fork-create [aria-label=\"Fork submission outcome\"]')")
        assert len(posts()) == count + 1, posts()
        observation = posts()[-1]
        assert observation['path'] == '/api/v4/projects/101/fork'
        assert observation['credentialMatched'] and not observation['destination'] and not observation['gitCredentialPresent']
        evidence = observation['nativeJournalBeforePost']
        assert len(evidence) == 1 and evidence[0]['phase'] == 'awaitingConfirmation' and evidence[0]['bodyMatched'] and evidence[0]['ownerOnly'], evidence
        assert observation['body']['namespace_id'] == namespace['id']
        assert set(observation['body']) == {'namespace_id', 'path'}
        return observation

    owned = ['fork-resources.json', 'project-overrides.json', 'fork-mode', 'native-journal-root', 'read-status.json']
    assert all(not (gate / name).exists() for name in owned), 'Earlier owned fixture configuration was not cleared'
    try:
        assert not driver.invoke('gitlab_connections')
        assert local() == {'entries': [], 'issues': []}
        roots = list(Path(fixtures.env['XDG_DATA_HOME']).glob('*/gitlab-forks-v1'))
        assert len(roots) == 1
        journal = roots[0]
        assert journal.resolve().is_relative_to(fixtures.root.resolve())
        (gate / 'native-journal-root').write_text(str(journal))
        resources = {'/api/v4/namespaces?per_page=20&page=1': [namespace],
                     '/api/v4/namespaces/' + str(namespace['id']): namespace,
                     '/api/v4/projects/101/forks?per_page=20&page=1&order_by=id&sort=asc': []}
        (gate / 'fork-resources.json').write_text(json.dumps(resources))
        (gate / 'project-overrides.json').write_text(json.dumps({'empty_repo': False, 'default_branch': 'main'}))
        open_gitlab_catalogue(driver)
        read = connect(False)
        browse()
        assert driver.script("return [...document.querySelectorAll('gk-gitlab-forks button')].find(e=>e.textContent.trim()==='Review a new GitLab fork').matches(':disabled')")
        assert not posts()
        report['scenarios'].append('native-gitlab-fork-read-connection-cannot-enter-creation-or-send-post')
        button('Return from forks to GitLab projects')
        button('Disconnect owned-reader')
        driver.wait("return document.querySelector('#gitlab-account')?.value === ''")
        connection = connect(True)
        assert connection['connectionId'] != read['connectionId']
        browse()
        review('reviewed-project')
        capture('gitlab-fork-native-review', 'gk-gitlab-fork-create [aria-label="Prepared fork request"]')
        posted = submit()
        entry = saved('reviewed-project')
        assert posted['nativeJournalBeforePost'][0]['id'] == entry['id']
        assert entry['record']['phase'] == 'awaitingConfirmation' and entry['record']['httpStatus'] == 201 and entry['record']['projectId'] is None
        report['scenarios'].append('native-gitlab-fork-new-purpose-connection-native-review-and-one-real-post-after-durable-journal')

        project = {'id': 202, 'name': 'Owned fork', 'path_with_namespace': 'owned-reader/reviewed-project',
                   'web_url': origin + '/owned-reader/reviewed-project', 'description': None,
                   'default_branch': 'main', 'visibility': 'private', 'archived': False,
                   'namespace': namespace, 'forked_from_project': {'id': 101, 'path_with_namespace': source_path},
                   'import_status': 'finished', 'empty_repo': False}
        resources.update({'/api/v4/projects/owned-reader%2Freviewed-project': project, '/api/v4/projects/202': project})
        (gate / 'fork-resources.json').write_text(json.dumps(resources))
        count = len(posts())
        button('Inspect saved outcome owned-reader/reviewed-project', 'gk-gitlab-fork-records')
        driver.wait("return document.querySelector('gk-gitlab-fork-records [aria-label=\"Latest fork outcome inspection\"]')?.textContent.includes('Project metadata verified')")
        assert row('reviewed-project')['record']['projectId'] == '202' and len(posts()) == count
        capture('gitlab-fork-native-recovery', 'gk-gitlab-fork-records li', 'owned-reader/reviewed-project')
        report['scenarios'].append('native-gitlab-fork-fresh-real-https-reconciliation-binds-id-with-no-extra-post-or-git-handoff')

        (gate / 'read-status.json').write_text(json.dumps({'/api/v4/projects/202': 404}))
        begin = len(requests())
        button('Inspect saved outcome owned-reader/reviewed-project', 'gk-gitlab-fork-records')
        driver.wait("return document.querySelector('gk-gitlab-fork-records [aria-label=\"Latest fork outcome inspection\"]')?.textContent.includes('Import or inspection pending')")
        current = row('reviewed-project')['record']
        assert current['projectId'] == '202' and current['phase'] == 'acceptedPending'
        assert all(item['path'] != '/api/v4/projects/owned-reader%2Freviewed-project' for item in requests()[begin:])
        assert len(posts()) == count
        (gate / 'read-status.json').unlink()
        report['scenarios'].append('native-gitlab-fork-known-id-404-revokes-readiness-with-no-old-path-fallback')

        return_projects(); browse(); review('lost-reply-project')
        (gate / 'fork-mode').write_text('disconnect')
        posted = submit()
        entry = saved('lost-reply-project')
        assert posted['nativeJournalBeforePost'][0]['id'] == entry['id']
        assert entry['record']['phase'] == 'awaitingConfirmation'
        count = len(posts())
        capture('gitlab-fork-native-uncertain', 'gk-gitlab-fork-records li', 'owned-reader/lost-reply-project')
        driver.restart_application()
        driver.wait("return !!document.querySelector('gk-root')")
        assert driver.invoke('gitlab_connections') == [] and len(posts()) == count
        assert row('lost-reply-project')['record']['phase'] == 'awaitingConfirmation'
        open_gitlab_catalogue(driver)
        button('Open saved fork outcomes')
        driver.wait("return !!document.querySelector('gk-gitlab-fork-records ul')?.textContent.includes('lost-reply-project')")
        assert len(posts()) == count
        report['scenarios'].append('native-gitlab-fork-lost-reply-private-outcome-survives-real-process-restart-without-credential-or-post-replay')

        return_projects()
        (gate / 'fork-mode').unlink()
        read = connect(False)
        button('Open saved fork outcomes')
        button('Inspect saved outcome owned-reader/reviewed-project', 'gk-gitlab-fork-records')
        driver.wait("return document.querySelector('gk-gitlab-fork-records [aria-label=\"Latest fork outcome inspection\"]')?.textContent.includes('Project metadata verified')")
        assert len(posts()) == count
        rows = local()['entries']
        lost = next(item for item in rows if item['id'] == entry['id'])
        assert not lost['retired']
        # Native schema and durable local retirement are also exercised directly;
        # the ordinary checkbox/button UI is covered by the renderer suite.
        assert driver.invoke('retire_gitlab_fork_record', request={'recordId': entry['id'], 'expectedRevision': lost['record']['revision'],
                             'acknowledgeUnconfirmed': True, 'operationId': str(uuid.uuid4())})
        assert row('lost-reply-project')['retired'] and len(posts()) == count
        report['scenarios'].append('native-gitlab-fork-recovery-readonly-account-inspects-and-local-retirement-sends-no-provider-write')

        for file in journal.glob('*/*.json'):
            assert token not in file.read_text() and 'owned-upstream-diagnostic' not in file.read_text()
        assert re.fullmatch('[a-f0-9]{32}', entry['id'])
        assert fixtures.git(repository, 'show-ref') == before['refs']
        assert (repository / '.git/index').read_bytes() == before['index']
        assert (repository / '.git/config').read_bytes() == before['config']
        assert fixtures.git(repository, 'status', '--porcelain=v1') == before['status']
        assert len(posts()) == 2 and not any(item.get('destination') for item in requests())
        report['gitlabForkRequests'] = posts()
        report['gitlabForkJournal'] = [{'id': item['id'], 'phase': item['record']['phase'], 'retired': item['retired']} for item in local()['entries']]
        report['scenarios'].append('native-gitlab-fork-records-contain-no-api-secrets-and-leave-git-refs-index-config-and-worktree-unchanged')
    finally:
        for name in owned:
            (gate / name).unlink(missing_ok=True)
        (gate / 'mode').write_text('normal')
