import { expect, test, type Page } from '@playwright/test';

// Owned IPC fixtures exercise renderer boundaries. Real HTTPS, journal and
// packaged acceptance are separate gates; no provider project is created here.
const connectionId = 'a'.repeat(32), recordId = 'b'.repeat(32), token = 'c'.repeat(32);
const catalogue = (page: Page) => page.getByRole('region', { name: 'GitLab project catalogue', exact: true });
const creation = (page: Page) => page.getByRole('region', { name: 'Create a GitLab fork', exact: true });
const records = (page: Page) => page.getByRole('region', { name: 'Saved GitLab fork outcomes', exact: true });
const calls = (page: Page, command: string) => page.evaluate(command => (window as any).__creation.calls.filter((c: any) => c.command === command), command);
async function open(page: Page) {
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Repository management', exact: true });
  await dialog.getByRole('tab', { name: 'Clone', exact: true }).click();
  await dialog.getByRole('button', { name: 'Browse GitLab projects', exact: true }).click();
  await expect(catalogue(page).getByRole('button', { name: 'Refresh GitLab connections', exact: true })).toBeEnabled();
}
async function selectAccount(page: Page) { await catalogue(page).getByRole('combobox', { name: 'Connected account', exact: true }).selectOption(connectionId); }
async function create(page: Page) {
  await open(page); await selectAccount(page);
  await catalogue(page).getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await catalogue(page).getByRole('button', { name: 'Browse forks of team/upstream', exact: true }).click();
  await page.getByRole('button', { name: 'Review a new GitLab fork', exact: true }).click();
  await expect(creation(page)).toBeVisible();
}
async function prepare(page: Page) {
  await create(page);
  await creation(page).getByRole('button', { name: 'Load destination namespaces', exact: true }).click();
  await creation(page).getByRole('combobox', { name: 'Destination namespace', exact: true }).selectOption('30');
  await creation(page).getByRole('button', { name: 'Prepare fork review', exact: true }).click();
  await expect(creation(page).getByRole('region', { name: 'Prepared fork request', exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(({ connectionId, recordId, token }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root')), git = app.git;
    git.systemInfo.update((value: any) => ({ ...value, appVersion: 'owned fork creation fixture' }));
    const account = { origin: 'https://gitlab.example.test', id: '9007199254740993', login: 'owned-user' };
    const source = { id: '10', name: 'Owned source', fullPath: 'team/upstream', url: account.origin + '/team/upstream', description: null, defaultBranch: 'main', archived: false, visibility: 'private' };
    const namespace = { id: '30', name: 'Owned group', fullPath: 'owned/nested', kind: 'group' };
    const connection = { connectionId, account, canCreateFork: true, expiresAtMillis: String(Date.now() + 1800000) };
    const record = { id: recordId, revision: '1', createdAtMillis: '1', updatedAtMillis: '1', origin: account.origin, accountId: account.id, accountLogin: account.login,
      sourceId: source.id, sourceFullPath: source.fullPath, sourceEmpty: false, namespaceId: namespace.id, namespaceFullPath: namespace.fullPath, namespaceKind: namespace.kind,
      projectPath: 'upstream', projectName: null, targetFullPath: 'owned/nested/upstream', phase: 'awaitingConfirmation', projectId: null, projectEmpty: null, httpStatus: null, importState: 'unknown', lastFailure: 'connection' };
    const fixture: any = { app, git, account, source, namespace, connection, connections: [connection], calls: [], hold: '', fail: '', mismatch: false,
      persisted: true, phase: 'acceptedAwaitingInspection', record, entry: { id: recordId, record, pending: false, retired: false, operationActive: false }, repositories: structuredClone(git.repositories()) };
    (window as any).__creation = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args: structuredClone(args) });
      if (fixture.fail === command) throw { kind: 'gitlabOwnedFailure', message: 'Owned operation failed.' };
      let value: any;
      if (command === 'gitlab_connections') value = fixture.connections;
      else if (command === 'load_gitlab_projects') value = { account, query: args.request.query, entries: [source], mayHaveMore: false, nextPage: null, warnings: [] };
      else if (command === 'load_gitlab_forks') value = { account, source, entries: [], page: 1, nextPage: null };
      else if (command === 'load_gitlab_namespaces') value = { account: { login: account.login, id: account.id, origin: account.origin }, entries: [namespace], page: args.request.query.page, nextPage: null };
      else if (command === 'prepare_gitlab_fork') value = { token, preview: { account, source, sourceEmpty: false, namespace,
        projectPath: args.request.selection.projectPath, projectName: args.request.selection.projectName, targetFullPath: fixture.mismatch ? 'other/path' : namespace.fullPath + '/' + args.request.selection.projectPath } };
      else if (command === 'discard_gitlab_fork') value = true;
      else if (command === 'execute_gitlab_fork') value = { recordId, phase: fixture.phase, revision: '1', httpStatus: 202 };
      else if (command === 'list_gitlab_fork_records') value = { entries: [fixture.entry], issues: [] };
      else if (command === 'reconcile_gitlab_fork_record') value = { persisted: fixture.persisted, observation: { ...record, revision: '2', phase: 'metadataVerified', importState: 'finished', projectId: '50' } };
      else if (command === 'retire_gitlab_fork_record') value = true;
      else if (command === 'disconnect_gitlab_account') { fixture.connections = []; value = true; }
      else if (command === 'cancel_git_operation') value = true;
      else if (['refresh_repository', 'refresh_repository_metadata', 'refresh_repository_status'].includes(command)) {
        const repository = fixture.repositories.find((r: any) => r.id === args.repoId); value = command === 'refresh_repository_status' ? repository.status : repository;
      } else throw Error('Unexpected owned creation fixture command ' + command);
      const captured = structuredClone(value);
      if (fixture.hold === command) return new Promise(resolve => { fixture.release = () => resolve(captured); });
      return captured;
    } };
  }, { connectionId, recordId, token });
});

test('review is read-only and submit sends only a one-use native token', async ({ page }) => {
  await prepare(page);
  expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
  await creation(page).getByRole('button', { name: 'Submit reviewed fork request', exact: true }).click();
  await expect(creation(page).getByRole('region', { name: 'Fork submission outcome', exact: true })).toContainText('Accepted; inspect import status');
  const submissions = await calls(page, 'execute_gitlab_fork'); expect(submissions).toHaveLength(1);
  expect(Object.keys(submissions[0].args.request).sort()).toEqual(['context', 'operationId', 'token']);
  expect(submissions[0].args.request.token).toBe(token);
  await expect(creation(page).getByRole('button', { name: 'Submit reviewed fork request', exact: true })).toHaveCount(0);
  expect(await calls(page, 'execute_gitlab_clone')).toEqual([]);
});
test('editing a reviewed destination discards authority and requires another review', async ({ page }) => {
  await prepare(page); await creation(page).getByLabel('Project path', { exact: true }).fill('changed');
  await expect(creation(page).getByRole('region', { name: 'Prepared fork request', exact: true })).toHaveCount(0);
  expect(await calls(page, 'discard_gitlab_fork')).toHaveLength(1); expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
test('mismatched native preview is discarded without submission', async ({ page }) => {
  await page.evaluate(() => { (window as any).__creation.mismatch = true; });
  await create(page); await creation(page).getByRole('button', { name: 'Load destination namespaces', exact: true }).click();
  await creation(page).getByRole('combobox', { name: 'Destination namespace', exact: true }).selectOption('30');
  await creation(page).getByRole('button', { name: 'Prepare fork review', exact: true }).click();
  await expect(creation(page).getByRole('alert')).toContainText('changed its account');
  expect(await calls(page, 'discard_gitlab_fork')).toHaveLength(1); expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
test('changed namespace query requires an explicit reload', async ({ page }) => {
  await prepare(page); await creation(page).getByLabel('Namespace search', { exact: true }).fill('other');
  await expect(creation(page).getByRole('button', { name: 'Prepare fork review', exact: true })).toBeDisabled();
  expect(await calls(page, 'load_gitlab_namespaces')).toHaveLength(1); expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
test('cancelled submission wait retains its eventual saved outcome without retrying', async ({ page }) => {
  await prepare(page); await page.evaluate(() => { (window as any).__creation.hold = 'execute_gitlab_fork'; });
  await creation(page).getByRole('button', { name: 'Submit reviewed fork request', exact: true }).click();
  await creation(page).getByRole('button', { name: 'Stop waiting', exact: true }).click();
  await page.evaluate(() => (window as any).__creation.release());
  await expect(creation(page).getByRole('region', { name: 'Fork submission outcome', exact: true })).toContainText(recordId);
  expect(await calls(page, 'execute_gitlab_fork')).toHaveLength(1);
});
test('ambiguous submission error offers inspection and no automatic replay', async ({ page }) => {
  await prepare(page); await page.evaluate(() => { (window as any).__creation.fail = 'execute_gitlab_fork'; });
  await creation(page).getByRole('button', { name: 'Submit reviewed fork request', exact: true }).click();
  await expect(creation(page).getByRole('button', { name: 'Inspect saved fork outcomes', exact: true })).toBeEnabled();
  await creation(page).getByRole('button', { name: 'Inspect saved fork outcomes', exact: true }).click();
  await expect(records(page).getByRole('list')).toContainText(recordId);
  expect(await calls(page, 'execute_gitlab_fork')).toHaveLength(1);
});
test('saved outcomes are readable offline after reopening without provider writes', async ({ page }) => {
  await page.evaluate(() => { (window as any).__creation.connections = []; }); await open(page);
  await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  await expect(records(page).getByRole('list')).toContainText('Submission unconfirmed');
  await expect(records(page).getByRole('button', { name: 'Inspect saved outcome owned/nested/upstream', exact: true })).toBeDisabled();
  expect(await calls(page, 'reconcile_gitlab_fork_record')).toEqual([]); expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
test('read-only matching account can inspect with the stored revision', async ({ page }) => {
  await page.evaluate(() => { (window as any).__creation.connection.canCreateFork = false; }); await open(page); await selectAccount(page);
  await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  await records(page).getByRole('button', { name: 'Inspect saved outcome owned/nested/upstream', exact: true }).click();
  await expect(records(page).getByRole('region', { name: 'Latest fork outcome inspection', exact: true })).toContainText('This inspection was saved.');
  expect((await calls(page, 'reconcile_gitlab_fork_record'))[0].args.request).toMatchObject({ connectionId, recordId, expectedRevision: '1' });
  expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
test('unpersisted observation leaves the stored revision intact and requires reload', async ({ page }) => {
  await page.evaluate(() => { (window as any).__creation.persisted = false; }); await open(page); await selectAccount(page);
  await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  await records(page).getByRole('button', { name: 'Inspect saved outcome owned/nested/upstream', exact: true }).click();
  await expect(records(page).getByRole('region', { name: 'Latest fork outcome inspection', exact: true })).toContainText('not saved');
  await expect(records(page).getByRole('list')).toContainText('Submission unconfirmed');
  await expect(records(page).getByRole('button', { name: 'Inspect saved outcome owned/nested/upstream', exact: true })).toBeDisabled();
});
test('local archive requires acknowledgement and never deletes a provider project', async ({ page }) => {
  await open(page); await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  const archive = records(page).getByRole('button', { name: 'Archive local outcome owned/nested/upstream', exact: true });
  await expect(archive).toBeDisabled();
  await records(page).getByRole('checkbox').check(); await archive.click();
  await expect(records(page).getByRole('list')).toContainText('Archived locally');
  expect((await calls(page, 'retire_gitlab_fork_record'))[0].args.request).toMatchObject({ recordId, expectedRevision: '1', acknowledgeUnconfirmed: true });
  expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
test('a read-only connection cannot enter creation or request a native review', async ({ page }) => {
  await page.evaluate(() => { (window as any).__creation.connection.canCreateFork = false; });
  await open(page); await selectAccount(page);
  await catalogue(page).getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await catalogue(page).getByRole('button', { name: 'Browse forks of team/upstream', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review a new GitLab fork', exact: true })).toBeDisabled();
  expect(await calls(page, 'prepare_gitlab_fork')).toEqual([]); expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
test('disconnecting during submission closes the view and leaves recovery available', async ({ page }) => {
  await prepare(page); await page.evaluate(() => { (window as any).__creation.hold = 'execute_gitlab_fork'; });
  await creation(page).getByRole('button', { name: 'Submit reviewed fork request', exact: true }).click();
  await catalogue(page).getByRole('button', { name: 'Disconnect owned-user', exact: true }).click();
  await page.evaluate(() => (window as any).__creation.release());
  await expect(creation(page)).toHaveCount(0);
  await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  await expect(records(page).getByRole('list')).toContainText(recordId);
  expect(await calls(page, 'cancel_git_operation')).toHaveLength(1); expect(await calls(page, 'execute_gitlab_fork')).toHaveLength(1);
});
test('an account with a different stable ID cannot inspect an existing record', async ({ page }) => {
  await page.evaluate(() => { (window as any).__creation.connection.account = { ...(window as any).__creation.account, id: '77' }; });
  await open(page); await selectAccount(page);
  await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  await expect(records(page).getByRole('button', { name: 'Inspect saved outcome owned/nested/upstream', exact: true })).toBeDisabled();
  expect(await calls(page, 'reconcile_gitlab_fork_record')).toEqual([]);
});
test('incomplete pending storage entries do not expose inspect or archive actions', async ({ page }) => {
  await page.evaluate(() => { const fixture = (window as any).__creation; fixture.entry.record = null; fixture.entry.pending = true; });
  await open(page); await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  await expect(records(page).getByRole('list')).toContainText('Incomplete outcome record');
  await expect(records(page).getByRole('button', { name: /^Inspect saved outcome / })).toHaveCount(0);
  await expect(records(page).getByRole('button', { name: /^Archive local outcome / })).toHaveCount(0);
});
test('failed disconnect remains visible in recovery and preserves the account', async ({ page }) => {
  await open(page); await selectAccount(page);
  await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  await expect(records(page).getByRole('list')).toContainText(recordId);
  await page.evaluate(() => { (window as any).__creation.fail = 'disconnect_gitlab_account'; });
  await catalogue(page).getByRole('button', { name: 'Disconnect owned-user', exact: true }).click();
  await expect(catalogue(page).getByRole('alert')).toHaveText('Owned operation failed.');
  await expect(catalogue(page).getByRole('button', { name: 'Disconnect owned-user', exact: true })).toBeEnabled();
  await expect(records(page)).toContainText('Inspection account: owned-user');
  expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
test('disconnecting a held recovery read cancels it and ignores its late observation', async ({ page }) => {
  await open(page); await selectAccount(page);
  await catalogue(page).getByRole('button', { name: 'Open saved fork outcomes', exact: true }).click();
  await page.evaluate(() => { (window as any).__creation.hold = 'reconcile_gitlab_fork_record'; });
  await records(page).getByRole('button', { name: 'Inspect saved outcome owned/nested/upstream', exact: true }).click();
  await expect.poll(() => calls(page, 'reconcile_gitlab_fork_record')).toHaveLength(1);
  await catalogue(page).getByRole('button', { name: 'Disconnect owned-user', exact: true }).click();
  await page.evaluate(() => (window as any).__creation.release());
  await expect(records(page).getByRole('region', { name: 'Latest fork outcome inspection', exact: true })).toHaveCount(0);
  await expect(records(page).getByRole('button', { name: 'Inspect saved outcome owned/nested/upstream', exact: true })).toBeDisabled();
  await expect(catalogue(page)).toContainText('Disconnected this app');
  expect(await calls(page, 'cancel_git_operation')).toHaveLength(1);
  expect(await calls(page, 'execute_gitlab_fork')).toEqual([]);
});
for (const width of [320, 780]) {
  test(`creation review and outcome recovery remain readable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 700 }); await prepare(page);
    expect(await creation(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`fork-create-${width}.png`) });
    await creation(page).getByRole('button', { name: 'Submit reviewed fork request', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`fork-create-actions-${width}.png`) });
    await creation(page).getByRole('button', { name: 'Submit reviewed fork request', exact: true }).click();
    await creation(page).getByRole('button', { name: 'Inspect saved fork outcomes', exact: true }).click();
    await expect(records(page).getByRole('list')).toContainText(recordId);
    expect(await records(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await records(page).getByRole('heading', { name: 'owned/nested/upstream', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`fork-records-${width}.png`) });
    await records(page).getByRole('button', { name: 'Archive local outcome owned/nested/upstream', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`fork-record-actions-${width}.png`) });
  });
}
