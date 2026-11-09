"""Original fork acceptance through packaged controls, owned TLS and private records."""
import json
from pathlib import Path
import re
import uuid


def gitlab_reviewed_forks(driver, fixtures, repository, report):
    gate, origin = fixtures.gitlab_gate, fixtures.gitlab_origin
    token = 'owned-api-fixture-token'
    namespace = {'id': 9007199254740993, 'name': 'Owned reader', 'path': 'owned-reader',
                 'full_path': 'owned-reader', 'kind': 'user'}
    source_path = 'team/subgroup/owned-project'
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

    def button(text, scope='gc-gitlab-projects'):
        selector = scope + ' button'
        driver.wait('return [...document.querySelectorAll(' + json.dumps(selector) + ')].some(e => e.getClientRects().length && !e.matches(":disabled") && e.textContent.trim() === ' + json.dumps(text) + ')')
        driver.click_scrolled_text(selector, text)

    def fill(selector, value, event='input'):
        driver.wait('return !!document.querySelector(' + json.dumps(selector) + ') && !document.querySelector(' + json.dumps(selector) + ').matches(":disabled")')
        driver.script("const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event(arguments[2],{bubbles:true}));", selector, value, event)

    def catalogue():
        driver.wait("return !!document.querySelector('[aria-label=\"New repository tab\"]')?.getClientRects().length || [...document.querySelectorAll('gc-welcome-launcher button')].some(e=>e.getClientRects().length && e.querySelector('strong')?.textContent.trim()==='Clone repository')")
        if driver.script("return !!document.querySelector('[aria-label=\"New repository tab\"]')?.getClientRects().length"):
            driver.click('[aria-label="New repository tab"]')
        else:
            element = driver.script("return [...document.querySelectorAll('gc-welcome-launcher button')].find(e=>e.getClientRects().length && e.querySelector('strong')?.textContent.trim()==='Clone repository')")
            identifier = element['element-6066-11e4-a52e-4f735466cecf']
            driver.request('POST', driver.path('element/' + identifier + '/click'), {})
        driver.wait("return !!document.querySelector('#repository-tab-clone')?.getClientRects().length")
        driver.click_text('gc-repository-dialog [role=tab]', 'Clone')
        button('Browse GitLab projects', 'gc-repository-dialog')
        driver.wait("return !!document.querySelector('#gitlab-origin') && !document.querySelector('#gitlab-origin').matches(':disabled')")

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
        driver.wait("return !!document.querySelector('gc-gitlab-forks')")

    def review(target):
        button('Review a new GitLab fork')
        button('Load destination namespaces', 'gc-gitlab-fork-create')
        fill('#fork-namespace', str(namespace['id']), 'change')
        fill('#fork-project-path', target)
        before_post = len(posts())
        button('Prepare fork review', 'gc-gitlab-fork-create')
        driver.wait("return !!document.querySelector('gc-gitlab-fork-create [aria-label=\"Prepared fork request\"]')")
        assert len(posts()) == before_post, 'Preparing dispatched a provider write'

    def capture(label, selector, text=None):
        for width, height, suffix in [(1440, 900, 'normal'), (780, 560, 'compact')]:
            driver.request('POST', driver.path('window/rect'), {'width': width, 'height': height})
            for edge in ['start', 'end']:
                driver.script("const e=[...document.querySelectorAll(arguments[0])].find(e=>!arguments[1] || e.textContent.includes(arguments[1]));if(!e)throw Error('Owned capture target absent');e.scrollIntoView({block:arguments[2]});", selector, text, edge)
                driver.script("return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
                assert driver.script("const e=[...document.querySelectorAll(arguments[0])].find(e=>!arguments[1] || e.textContent.includes(arguments[1]));const d=e?.closest('[role=dialog]');if(!e||!d)return false;const r=d.getBoundingClientRect();return d.scrollWidth<=d.clientWidth+1 && r.left>=0 && r.right<=innerWidth+1", selector, text)
                if edge == 'end':
                    assert driver.script("const e=[...document.querySelectorAll(arguments[0])].find(e=>!arguments[1] || e.textContent.includes(arguments[1]));const d=e.closest('[role=dialog]');const button=e.querySelector('button:last-of-type');const r=button?.getBoundingClientRect();const frame=d.getBoundingClientRect();return !!r && r.top>=frame.top && r.bottom<=frame.bottom+1", selector, text), 'Owned capture action is outside its dialog'
                driver.screenshot(Path(report['artifactsDirectory']) / (label + '-' + suffix + '-' + edge + '.png'))
        driver.request('POST', driver.path('window/rect'), {'width': 1440, 'height': 900})

    def saved(target):
        button('Inspect saved fork outcomes', 'gc-gitlab-fork-create')
        driver.wait("return !!document.querySelector('gc-gitlab-fork-records ul')?.textContent.includes(" + json.dumps('owned-reader/' + target) + ")")
        return row(target)

    def return_projects():
        button('Return from outcomes to GitLab projects', 'gc-gitlab-fork-records')

    def submit():
        count = len(posts())
        button('Submit reviewed fork request', 'gc-gitlab-fork-create')
        driver.wait("return !!document.querySelector('gc-gitlab-fork-create [aria-label=\"Fork submission outcome\"]')")
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
        catalogue()
        read = connect(False)
        browse()
        assert driver.script("return [...document.querySelectorAll('gc-gitlab-forks button')].find(e=>e.textContent.trim()==='Review a new GitLab fork').matches(':disabled')")
        assert not posts()
        report['scenarios'].append('native-gitlab-fork-read-connection-cannot-enter-creation-or-send-post')
        button('Return from forks to GitLab projects')
        button('Disconnect owned-reader')
        driver.wait("return document.querySelector('#gitlab-account')?.value === ''")
        connection = connect(True)
        assert connection['connectionId'] != read['connectionId']
        browse()
        review('reviewed-project')
        capture('gitlab-fork-native-review', 'gc-gitlab-fork-create [aria-label="Prepared fork request"]')
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
        button('Inspect saved outcome owned-reader/reviewed-project', 'gc-gitlab-fork-records')
        driver.wait("return document.querySelector('gc-gitlab-fork-records [aria-label=\"Latest fork outcome inspection\"]')?.textContent.includes('Project metadata verified')")
        assert row('reviewed-project')['record']['projectId'] == '202' and len(posts()) == count
        capture('gitlab-fork-native-recovery', 'gc-gitlab-fork-records li', 'owned-reader/reviewed-project')
        report['scenarios'].append('native-gitlab-fork-fresh-real-https-reconciliation-binds-id-with-no-extra-post-or-git-handoff')

        (gate / 'read-status.json').write_text(json.dumps({'/api/v4/projects/202': 404}))
        begin = len(requests())
        button('Inspect saved outcome owned-reader/reviewed-project', 'gc-gitlab-fork-records')
        driver.wait("return document.querySelector('gc-gitlab-fork-records [aria-label=\"Latest fork outcome inspection\"]')?.textContent.includes('Import or inspection pending')")
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
        capture('gitlab-fork-native-uncertain', 'gc-gitlab-fork-records li', 'owned-reader/lost-reply-project')
        driver.restart_application()
        driver.wait("return !!document.querySelector('gc-root')")
        assert driver.invoke('gitlab_connections') == [] and len(posts()) == count
        assert row('lost-reply-project')['record']['phase'] == 'awaitingConfirmation'
        catalogue()
        button('Open saved fork outcomes')
        driver.wait("return !!document.querySelector('gc-gitlab-fork-records ul')?.textContent.includes('lost-reply-project')")
        assert len(posts()) == count
        report['scenarios'].append('native-gitlab-fork-lost-reply-private-outcome-survives-real-process-restart-without-credential-or-post-replay')

        return_projects()
        (gate / 'fork-mode').unlink()
        read = connect(False)
        button('Open saved fork outcomes')
        button('Inspect saved outcome owned-reader/reviewed-project', 'gc-gitlab-fork-records')
        driver.wait("return document.querySelector('gc-gitlab-fork-records [aria-label=\"Latest fork outcome inspection\"]')?.textContent.includes('Project metadata verified')")
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
