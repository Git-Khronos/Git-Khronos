import { expect, test, type Page } from '@playwright/test';

// Renderer protocol fixtures; real HTTP/Git and packaged provider acceptance
// remain separate gates, and these tests never submit a provider write.

const connectionId = 'a'.repeat(32);
const catalogue = (page: Page) => page.getByRole('region', { name: 'GitLab project catalogue', exact: true });
const forks = (page: Page) => page.getByRole('region', { name: 'GitLab forks of selected project', exact: true });
const details = (page: Page) => forks(page).getByRole('region', { name: 'Inspected GitLab fork relationship', exact: true });
const calls = (page: Page, command: string) => page.evaluate(command => (window as any).__forks.calls.filter((c: any) => c.command === command), command);
async function open(page: Page) {
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Repository management', exact: true });
  await dialog.getByRole('tab', { name: 'Clone', exact: true }).click();
  await dialog.getByRole('button', { name: 'Browse GitLab projects', exact: true }).click();
  await expect(catalogue(page).getByRole('button', { name: 'Refresh GitLab connections', exact: true })).toBeEnabled();
  await catalogue(page).getByRole('combobox', { name: 'Connected account', exact: true }).selectOption(connectionId);
  await catalogue(page).getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await catalogue(page).getByRole('button', { name: 'Browse forks of team/upstream', exact: true }).click();
  await expect(forks(page)).toBeVisible();
}
async function inspect(page: Page) {
  await open(page);
  await forks(page).getByRole('button', { name: 'Inspect fork group/nested/owned-fork', exact: true }).click();
  await expect(details(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(connectionId => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root')), git = app.git;
    git.systemInfo.update((value: any) => ({ ...value, appVersion: 'owned fork renderer fixture' }));
    app.commitMessage.set('Retained fork navigation draft');
    const account = { origin: 'https://gitlab.example.test:8443', id: '9007199254740993', login: 'owned-reader' };
    const source = { id: '10', name: 'Owned source', fullPath: 'team/upstream', url: account.origin + '/team/upstream',
      description: null, defaultBranch: 'main', archived: false, visibility: 'private' };
    const project = { ...source, id: '9007199254740995', name: 'Owned fork', fullPath: 'group/nested/owned-fork',
      url: account.origin + '/group/nested/owned-fork', description: '<img src="https://unrequested.invalid/image"> literal metadata' };
    const connection = { connectionId, account, canCreateFork: false, expiresAtMillis: String(Date.now() + 1800000) };
    const fixture: any = { app, git, source, project, account, connection, connections: [connection], calls: [], hold: '', fail: '', mismatch: '',
      state: 'finished', next: 0, plans: {}, repositories: structuredClone(git.repositories()) };
    (window as any).__forks = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args: structuredClone(args) });
      if (fixture.fail === command) throw { kind: 'gitlabOwnedRefusal', message: 'Owned fork read refused.' };
      let value: any;
      if (command === 'gitlab_connections') value = fixture.connections;
      else if (command === 'load_gitlab_projects') value = { account, query: args.request.query, entries: [source], mayHaveMore: false, nextPage: null, warnings: [] };
      else if (command === 'load_gitlab_forks') value = { account: fixture.mismatch === 'pageAccount' ? { ...account, login: 'other' } : account,
        source, page: args.request.query.page, entries: args.request.query.page === 1 ? [project] : [], nextPage: args.request.query.page === 1 ? 2 : null };
      else if (command === 'inspect_gitlab_fork') value = { account, source,
        project: fixture.mismatch === 'fork' ? { ...project, id: 'changed' } : project,
        namespace: { id: '9007199254740997', name: 'Owned group', fullPath: 'group/nested', kind: 'group' }, importState: fixture.state,
        cloneHttps: 'https://git.example.test:9443/group/nested/owned-fork.git', cloneSsh: 'ssh://git@ssh.example.test:2222/group/nested/owned-fork.git' };
      else if (command === 'inspect_gitlab_project') value = { account, project,
        cloneHttps: 'https://git.example.test:9443/group/nested/owned-fork.git', cloneSsh: 'ssh://git@ssh.example.test:2222/group/nested/owned-fork.git' };
      else if (command === 'prepare_gitlab_clone') {
        const request = args.request.request, token = (++fixture.next).toString(16).padStart(32, '0');
        value = { token, plan: { account, project, ...request, url: request.transport === 'https' ? 'https://git.example.test:9443/group/nested/owned-fork.git' : 'ssh://git@ssh.example.test:2222/group/nested/owned-fork.git', destination: request.parentPath + '/' + request.folder } };
        fixture.plans[token] = { contextId: args.request.contextId };
      } else if (command === 'discard_gitlab_clone_plan') { delete fixture.plans[args.token]; value = true; }
      else if (command === 'disconnect_gitlab_account') { fixture.connections = []; value = true; }
      else if (command === 'cancel_git_operation') value = true;
      else if (['refresh_repository', 'refresh_repository_metadata', 'refresh_repository_status'].includes(command)) {
        const repository = fixture.repositories.find((r: any) => r.id === args.repoId);
        value = command === 'refresh_repository_status' ? repository.status : repository;
      } else throw Error(`Unexpected owned fork fixture command ${command}`);
      const captured = structuredClone(value);
      if (fixture.hold === command) return new Promise(resolve => { fixture.release = () => resolve(captured); });
      return captured;
    } };
  }, connectionId);
});

test('opens only selected-source fork reads and requires inspection before cloning', async ({ page }) => {
  await open(page);
  await expect(forks(page).getByRole('list', { name: 'Accessible GitLab fork candidates' })).toContainText('group/nested/owned-fork');
  expect((await calls(page, 'load_gitlab_forks'))[0].args.request).toMatchObject({ connectionId, query: { sourceProjectId: '10', sourceFullPath: 'team/upstream', page: 1, search: '' } });
  expect(await calls(page, 'inspect_gitlab_fork')).toEqual([]);
  await expect(forks(page).getByRole('button', { name: 'Review cloning this project', exact: true })).toHaveCount(0);
  expect(await calls(page, 'execute_gitlab_clone')).toEqual([]);
});

test('inspects stable wide fork IDs, inert metadata, separate Git hosts and account-bound clone options', async ({ page }) => {
  await inspect(page);
  await expect(details(page)).toBeFocused();
  await expect(details(page)).toContainText('9007199254740995');
  await expect(details(page)).toContainText('9007199254740997');
  await expect(forks(page).locator('img, script, iframe')).toHaveCount(0);
  const request = (await calls(page, 'inspect_gitlab_fork'))[0].args.request;
  expect(request.selection).toEqual({ sourceProjectId: '10', sourceFullPath: 'team/upstream', forkProjectId: '9007199254740995', forkFullPath: 'group/nested/owned-fork' });
  await details(page).getByRole('button', { name: 'Review cloning this project', exact: true }).click();
  const clone = forks(page).getByRole('region', { name: 'Clone selected GitLab project', exact: true });
  await expect(clone.getByRole('group', { name: 'GitLab clone options', exact: true })).toBeVisible();
  expect((await calls(page, 'inspect_gitlab_project'))[0].args.request).toMatchObject({ connectionId, projectId: '9007199254740995' });
  await clone.getByLabel('Destination directory', { exact: true }).fill('/owned/fork-clones');
  await clone.getByRole('button', { name: 'Review GitLab clone', exact: true }).click();
  await expect(clone.getByRole('region', { name: 'Review GitLab clone', exact: true })).toContainText('https://git.example.test:9443/group/nested/owned-fork.git');
  expect(await calls(page, 'execute_gitlab_clone')).toEqual([]);
});

test('changed fork search retains candidates and disables inspection until explicit reload', async ({ page }) => {
  await open(page);
  await forks(page).getByLabel('Fork search', { exact: true }).fill('literal & namespace=other');
  await expect(forks(page).getByRole('button', { name: 'Inspect fork group/nested/owned-fork', exact: true })).toBeDisabled();
  expect(await calls(page, 'load_gitlab_forks')).toHaveLength(1);
  await forks(page).getByRole('button', { name: 'Reload accessible GitLab forks', exact: true }).click();
  expect((await calls(page, 'load_gitlab_forks'))[1].args.request.query.search).toBe('literal & namespace=other');
  await expect(forks(page).getByRole('button', { name: 'Inspect fork group/nested/owned-fork', exact: true })).toBeEnabled();
});

test('failed page reads retain earlier candidates without making them actionable', async ({ page }) => {
  await open(page); await expect(forks(page).getByRole('button', { name: 'Next fork page', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).__forks.fail = 'load_gitlab_forks'; });
  await forks(page).getByRole('button', { name: 'Next fork page', exact: true }).click();
  await expect(forks(page).getByRole('alert')).toHaveText('Owned fork read refused.');
  await expect(forks(page).getByRole('list', { name: 'Accessible GitLab fork candidates' })).toContainText('group/nested/owned-fork');
  await expect(forks(page).getByRole('button', { name: 'Inspect fork group/nested/owned-fork', exact: true })).toBeDisabled();
});

for (const mismatch of ['pageAccount', 'fork']) {
  test(`rejects ${mismatch} response mismatch without creating clone authority`, async ({ page }) => {
    await page.evaluate(mismatch => { (window as any).__forks.mismatch = mismatch; }, mismatch);
    await open(page);
    if (mismatch === 'fork') await forks(page).getByRole('button', { name: 'Inspect fork group/nested/owned-fork', exact: true }).click();
    await expect(forks(page).getByRole('alert')).toBeVisible();
    await expect(forks(page).getByRole('button', { name: 'Review cloning this project', exact: true })).toHaveCount(0);
    expect(await calls(page, 'prepare_gitlab_clone')).toEqual([]);
  });
}

test('closing a held fork inspection cancels its request and ignores the late data', async ({ page }) => {
  await open(page); await page.evaluate(() => { (window as any).__forks.hold = 'inspect_gitlab_fork'; });
  await forks(page).getByRole('button', { name: 'Inspect fork group/nested/owned-fork', exact: true }).click();
  await expect.poll(() => calls(page, 'inspect_gitlab_fork')).toHaveLength(1);
  await page.getByRole('dialog', { name: 'Repository management', exact: true }).getByRole('button', { name: 'Close repository management', exact: true }).click();
  await page.evaluate(() => (window as any).__forks.release());
  await expect(forks(page)).toHaveCount(0);
  expect(await calls(page, 'cancel_git_operation')).toHaveLength(1);
  expect(await calls(page, 'prepare_gitlab_clone')).toEqual([]);
});

for (const state of ['none', 'scheduled', 'started', 'failed', 'unknown']) {
  test(`displays ${state} import metadata without reporting a completed Git clone`, async ({ page }) => {
    await page.evaluate(state => { (window as any).__forks.state = state; }, state); await inspect(page);
    await expect(details(page)).toContainText('Import metadata does not confirm Git connectivity');
    expect(await calls(page, 'execute_gitlab_clone')).toEqual([]);
  });
}

for (const width of [320, 780]) {
  test(`keeps inspected fork metadata and clone navigation within ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 700 }); await inspect(page);
    expect(await details(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`gitlab-fork-${width}.png`) });
    await forks(page).getByRole('button', { name: 'Return from forks to GitLab projects', exact: true }).click();
    await expect(catalogue(page).getByRole('button', { name: 'Browse forks of team/upstream', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__forks.app.commitMessage())).toBe('Retained fork navigation draft');
  });
}

test('a changed account view retires the old clone review without retargeting its token', async ({ page }) => {
  await inspect(page);
  await details(page).getByRole('button', { name: 'Review cloning this project', exact: true }).click();
  const clone = forks(page).getByRole('region', { name: 'Clone selected GitLab project', exact: true });
  await expect(clone.getByRole('group', { name: 'GitLab clone options', exact: true })).toBeVisible();
  await clone.getByLabel('Destination directory', { exact: true }).fill('/owned/fork-clones');
  await clone.getByRole('button', { name: 'Review GitLab clone', exact: true }).click();
  await expect(clone.getByRole('region', { name: 'Review GitLab clone', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const browser = (window as any).ng.getComponent(document.querySelector('gc-gitlab-projects'));
    browser.forkTarget.update((value: any) => ({ ...value, connection: { ...value.connection, account: { ...value.connection.account, login: 'changed-reader' } } }));
  });
  await expect(clone).toHaveCount(0);
  await expect.poll(() => calls(page, 'discard_gitlab_clone_plan')).toHaveLength(1);
  expect(await page.evaluate(() => Object.keys((window as any).__forks.plans))).toEqual([]);
  expect(await calls(page, 'execute_gitlab_clone')).toEqual([]);
  await expect(forks(page)).toContainText('The selected account or source changed. Reload forks.');
});
