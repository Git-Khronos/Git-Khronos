import { expect, test, type Page } from '@playwright/test';

const TOKEN = 'owned-renderer-gitlab-token';
const FIRST = '00000000000000000000000000000001';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Repository management', exact: true });
const catalogue = (page: Page) => dialog(page).getByRole('region', { name: 'GitLab project catalogue', exact: true });
const calls = (page: Page, command: string) => page.evaluate(command => (window as any).__gitlab.calls.filter((call: any) => call.command === command), command);

async function open(page: Page) {
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  await dialog(page).getByRole('tab', { name: 'Clone', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Browse GitLab projects', exact: true }).click();
  await expect(catalogue(page)).toBeVisible();
  await expect(catalogue(page).getByRole('button', { name: 'Refresh GitLab connections', exact: true })).toBeEnabled();
  return catalogue(page);
}
async function connect(page: Page) {
  const panel = await open(page);
  await panel.getByLabel('HTTPS instance', { exact: true }).fill('https://gitlab.example.test');
  await panel.getByLabel('Personal access token', { exact: true }).fill(TOKEN);
  await panel.getByRole('button', { name: 'Connect to GitLab', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue(FIRST);
  return panel;
}
async function loaded(page: Page) {
  const panel = await connect(page);
  await panel.getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'GitLab projects', exact: true })).toContainText('team/subgroup/owned');
  return panel;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    app.commitMessage.set('Owned retained GitLab commit draft');
    const repositories = structuredClone(app.git.repositories());
    const fixture = { calls: [] as any[], connections: [] as any[], next: 0, hold: '',
      release: null as (() => void) | null, fail: '', lostDisconnectReply: false, wrongAccount: false, wrongCapability: false };
    (window as any).__gitlab = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      // This protocol fixture contains synthetic data only, never real credentials.
      fixture.calls.push({ command, args: structuredClone(args) });
      if (fixture.fail === command) throw { kind: 'gitlabOwnedRefusal', message: 'Owned GitLab request refused.' };
      let result: any;
      if (command === 'refresh_repository_status') {
        const repository = repositories.find((candidate: any) => candidate.id === args.repoId);
        if (!repository) throw Error('Unexpected repository in owned status refresh');
        result = repository.status;
      } else if (command === 'gitlab_connections') result = fixture.connections;
      else if (command === 'connect_gitlab_account' || command === 'connect_gitlab_fork_account') {
        result = { connectionId: (++fixture.next).toString(16).padStart(32, '0'),
          account: { origin: new URL(args.request.origin).origin, id: '9007199254740993', login: 'owned-reader' },
          canCreateFork: command === 'connect_gitlab_fork_account' && !fixture.wrongCapability, expiresAtMillis: String(Date.now() + 30 * 60 * 1000) };
        fixture.connections.push(structuredClone(result));
      } else if (command === 'load_gitlab_projects') {
        const selected = fixture.connections.find(connection => connection.connectionId === args.request.connectionId);
        if (!selected) throw { kind: 'gitlabConnectionExpired', message: 'Owned connection is unavailable.' };
        const query = args.request.query;
        result = { account: fixture.wrongAccount ? { ...selected.account, login: 'another-reader' } : selected.account,
          query, entries: query.page === 1 ? [{ id: '9007199254740995', name: 'Owned project', fullPath: 'team/subgroup/owned',
            url: selected.account.origin + '/team/subgroup/owned', description: 'Owned <img src="https://unrequested.invalid/image.png"> metadata',
            defaultBranch: 'main', visibility: 'private', archived: false }] : [],
          mayHaveMore: query.page === 1, nextPage: query.page === 1 ? 2 : null, warnings: [] };
      } else if (command === 'disconnect_gitlab_account') {
        const found = fixture.connections.some(connection => connection.connectionId === args.connectionId);
        fixture.connections = fixture.connections.filter(connection => connection.connectionId !== args.connectionId);
        if (fixture.lostDisconnectReply) throw { kind: 'gitlabOwnedReplyLost', message: 'Owned disconnect reply unavailable.' };
        result = found;
      } else if (command === 'cancel_git_operation') result = true;
      else throw Error(`Unexpected GitLab fixture command ${command}`);
      const captured = structuredClone(result);
      if (fixture.hold === command) return new Promise(resolve => { fixture.release = () => resolve(captured); });
      return captured;
    } };
  });
});

test('GitLab connect clears its token, loads only explicitly, and keeps reads separate from Git mutations', async ({ page }) => {
  const panel = await connect(page);
  await expect(panel.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  expect(await calls(page, 'load_gitlab_projects')).toHaveLength(0);
  await panel.getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'GitLab projects' })).toContainText('team/subgroup/owned');
  const read = (await calls(page, 'load_gitlab_projects'))[0].args.request;
  expect(read).toMatchObject({ connectionId: FIRST, query: { page: 1, scope: 'membership', search: '', includeArchived: false,
    expectedAccount: { origin: 'https://gitlab.example.test', id: '9007199254740993', login: 'owned-reader' } } });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(TOKEN);
  expect(await page.evaluate(() => document.body.textContent)).not.toContain(TOKEN);
  const commands = await page.evaluate(() => (window as any).__gitlab.calls.map((call: any) => call.command));
  expect(commands.filter((command: string) => !['gitlab_connections', 'connect_gitlab_account',
    'load_gitlab_projects', 'refresh_repository_status'].includes(command))).toEqual([]);
});

test('changing the selected instance clears a previously entered token and Enter never submits the manual clone form', async ({ page }) => {
  const panel = await open(page);
  await panel.getByLabel('Personal access token', { exact: true }).fill(TOKEN);
  await panel.getByRole('button', { name: 'Show token', exact: true }).click();
  await expect(panel.getByLabel('Personal access token', { exact: true })).toHaveAttribute('type', 'text');
  await panel.getByLabel('HTTPS instance', { exact: true }).fill('https://gitlab.example.test');
  await expect(panel.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  await expect(panel.getByLabel('Personal access token', { exact: true })).toHaveAttribute('type', 'password');
  await panel.getByLabel('Personal access token', { exact: true }).fill(TOKEN);
  await panel.getByLabel('Personal access token', { exact: true }).press('Enter');
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue(FIRST);
  expect(await calls(page, 'connect_gitlab_account')).toHaveLength(1);
  expect(await calls(page, 'clone_repository')).toHaveLength(0);
});

test('connection failure retains the instance and focuses original feedback without retaining the token', async ({ page }) => {
  const panel = await open(page);
  await page.evaluate(() => { (window as any).__gitlab.fail = 'connect_gitlab_account'; });
  await panel.getByLabel('HTTPS instance', { exact: true }).fill('https://gitlab.example.test');
  await panel.getByLabel('Personal access token', { exact: true }).fill(TOKEN);
  await panel.getByRole('button', { name: 'Connect to GitLab', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Owned GitLab request refused.');
  await expect(panel.getByRole('alert')).toBeFocused();
  await expect(panel.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  await expect(panel.getByLabel('HTTPS instance', { exact: true })).toHaveValue('https://gitlab.example.test');
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue('');
});

test('literal query filters and explicit pagination retain the selected native account identity', async ({ page }) => {
  const panel = await connect(page);
  await panel.getByRole('combobox', { name: 'Access', exact: true }).selectOption('accessible');
  await panel.getByRole('searchbox', { name: 'Project search', exact: true }).fill('café & old/feature');
  await panel.getByRole('checkbox', { name: 'Include archived projects', exact: true }).check();
  await panel.getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Next GitLab page', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Next GitLab page', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'GitLab projects' })).toContainText('No projects were returned');
  const queries = (await calls(page, 'load_gitlab_projects')).map((call: any) => call.args.request.query);
  expect(queries.map((query: any) => query.page)).toEqual([1, 2]);
  expect(queries.every((query: any) => query.search === 'café & old/feature' && query.scope === 'accessible'
    && query.includeArchived && query.expectedAccount.id === '9007199254740993')).toBe(true);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('failed reload preserves previous rows and the submitted query rather than claiming an empty page', async ({ page }) => {
  const panel = await loaded(page);
  await panel.getByRole('searchbox', { name: 'Project search', exact: true }).fill('retained query');
  await page.evaluate(() => { (window as any).__gitlab.fail = 'load_gitlab_projects'; });
  await panel.getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Owned GitLab request refused');
  await expect(panel.getByRole('list', { name: 'GitLab projects' })).toContainText('team/subgroup/owned');
  await expect(panel.getByText('Earlier project results are shown.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('searchbox', { name: 'Project search', exact: true })).toHaveValue('retained query');
});

test('a cancelled late connection is retired exactly once before it can become the selected account', async ({ page }) => {
  const panel = await open(page);
  await page.evaluate(() => { (window as any).__gitlab.hold = 'connect_gitlab_account'; });
  await panel.getByLabel('Personal access token', { exact: true }).fill(TOKEN);
  await panel.getByRole('button', { name: 'Connect to GitLab', exact: true }).click();
  await expect(panel.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  await panel.getByRole('button', { name: 'Cancel GitLab request', exact: true }).click();
  await page.evaluate(() => (window as any).__gitlab.release());
  await expect.poll(async () => (await calls(page, 'disconnect_gitlab_account')).length).toBe(1);
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => (window as any).__gitlab.connections)).toHaveLength(0);
});

test('closing during connect clears only its late connection and preserves another account', async ({ page }) => {
  await page.evaluate(other => { (window as any).__gitlab.connections = [{ connectionId: other,
    account: { origin: 'https://another.example.test', id: '71', login: 'other-owned-reader' }, canCreateFork: false, expiresAtMillis: String(Date.now() + 60_000) }]; }, OTHER);
  const panel = await open(page);
  await page.evaluate(() => { (window as any).__gitlab.hold = 'connect_gitlab_account'; });
  await panel.getByLabel('Personal access token', { exact: true }).fill(TOKEN);
  await panel.getByRole('button', { name: 'Connect to GitLab', exact: true }).click();
  await expect.poll(async () => (await calls(page, 'connect_gitlab_account')).length).toBe(1);
  await dialog(page).getByRole('button', { name: 'Close repository management', exact: true }).click();
  await page.evaluate(() => (window as any).__gitlab.release());
  await expect.poll(async () => (await calls(page, 'disconnect_gitlab_account')).length).toBe(1);
  expect((await calls(page, 'disconnect_gitlab_account'))[0].args.connectionId).toBe(FIRST);
  expect(await page.evaluate(() => (window as any).__gitlab.connections.map((connection: any) => connection.connectionId))).toEqual([OTHER]);
});

test('disconnect remains available during a read and its late rows cannot revive the retired account', async ({ page }) => {
  const panel = await connect(page);
  await page.evaluate(() => { (window as any).__gitlab.hold = 'load_gitlab_projects'; });
  await panel.getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Disconnect owned-reader', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Disconnect owned-reader', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue('');
  await page.evaluate(() => (window as any).__gitlab.release());
  await expect(panel.getByRole('list', { name: 'GitLab projects' })).toHaveCount(0);
  expect(await calls(page, 'disconnect_gitlab_account')).toHaveLength(1);
});

test('lost disconnect acknowledgement is resolved by metadata absence without replaying disconnect', async ({ page }) => {
  const panel = await connect(page);
  await page.evaluate(() => { (window as any).__gitlab.lostDisconnectReply = true; });
  await panel.getByRole('button', { name: 'Disconnect owned-reader', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue('');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(await calls(page, 'disconnect_gitlab_account')).toHaveLength(1);
  expect((await calls(page, 'gitlab_connections')).length).toBeGreaterThanOrEqual(2);
});

test('unconfirmed disconnect preserves the selected context and prior rows for explicit review', async ({ page }) => {
  const panel = await loaded(page);
  await page.evaluate(() => { (window as any).__gitlab.fail = 'disconnect_gitlab_account'; });
  await panel.getByRole('button', { name: 'Disconnect owned-reader', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Owned GitLab request refused');
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue(FIRST);
  await expect(panel.getByRole('list', { name: 'GitLab projects' })).toContainText('team/subgroup/owned');
});

test('a foreign account reply is refused while keeping the earlier account result', async ({ page }) => {
  const panel = await loaded(page);
  await page.evaluate(() => { (window as any).__gitlab.wrongAccount = true; });
  await panel.getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('returned account or project query changed');
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue(FIRST);
  await expect(panel.getByRole('list', { name: 'GitLab projects' })).toContainText('team/subgroup/owned');
});

test('project metadata stays inert and browsing preserves manual clone and commit drafts', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => { if (request.url().includes('unrequested.invalid')) requests.push(request.url()); });
  const panel = await loaded(page);
  await expect(panel.getByRole('list', { name: 'GitLab projects' })).toContainText('<img');
  await expect(panel.locator('img')).toHaveCount(0); expect(requests).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Return to repository URL', exact: true }).click();
  await dialog(page).getByRole('textbox', { name: 'Repository URL', exact: true }).fill('https://owned.example.test/team/manual.git');
  await dialog(page).getByRole('button', { name: 'Browse GitLab projects', exact: true }).click();
  await expect(catalogue(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Return to repository URL', exact: true }).click();
  await expect(dialog(page).getByRole('textbox', { name: 'Repository URL', exact: true })).toHaveValue('https://owned.example.test/team/manual.git');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).commitMessage())).toBe('Owned retained GitLab commit draft');
});

test('an unavailable connection inventory is distinct from a successful empty inventory and supports explicit retry', async ({ page }) => {
  await page.evaluate(() => { (window as any).__gitlab.fail = 'gitlab_connections'; });
  const panel = await open(page);
  await expect(panel.getByRole('alert')).toContainText('Owned GitLab request refused');
  await expect(panel.getByText('No active GitLab connections are listed.', { exact: false })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__gitlab.fail = ''; });
  await panel.getByRole('button', { name: 'Refresh GitLab connections', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByText('No active GitLab connections are listed.', { exact: false })).toBeVisible();
  expect(await calls(page, 'gitlab_connections')).toHaveLength(2);
});

test('an oversized multibyte search explains its disabled action without sending a provider read', async ({ page }) => {
  const panel = await connect(page);
  await panel.getByRole('searchbox', { name: 'Project search', exact: true }).fill('é'.repeat(129));
  await expect(panel.getByRole('searchbox', { name: 'Project search', exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(panel.getByText('Use a shorter, single-line project search.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Load GitLab projects', exact: true })).toBeDisabled();
  expect(await calls(page, 'load_gitlab_projects')).toHaveLength(0);
  await panel.getByRole('searchbox', { name: 'Project search', exact: true }).fill('café');
  await expect(panel.getByRole('button', { name: 'Load GitLab projects', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'GitLab projects' })).toContainText('team/subgroup/owned');
  expect(await calls(page, 'load_gitlab_projects')).toHaveLength(1);
});

for (const theme of ['chronos', 'midnight']) test(`${theme} GitLab browsing contains keyboard focus and fits a compact window`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 560 });
  await page.evaluate(theme => (window as any).ng.getComponent(document.querySelector('gc-root')).setAppTheme(theme), theme);
  const panel = await loaded(page);
  await panel.getByRole('button', { name: 'Next GitLab page', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog(page).getByRole('button', { name: 'Close repository management', exact: true })).toBeFocused();
  expect(await dialog(page).evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && element.scrollWidth <= element.clientWidth; })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gitlab-projects-' + theme + '.png') });
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
});


test('canceling a delayed GitLab panel keeps the manual form and starts no connection read', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let intercepted!: () => void;
  const requested = new Promise<void>(resolve => { intercepted = resolve; });
  let delivered!: () => void;
  const finished = new Promise<void>(resolve => { delivered = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    const panel = text.includes('GitLab project catalogue') && text.includes('Personal access token');
    if (panel) { intercepted(); await held; }
    await route.fulfill({ response, body: text });
    if (panel) delivered();
  });
  try {
    await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
    await dialog(page).getByRole('tab', { name: 'Clone', exact: true }).click();
    await dialog(page).getByLabel('Repository URL', { exact: true }).fill('https://owned.example/manual.git');
    await dialog(page).getByRole('button', { name: 'Browse GitLab projects', exact: true }).click();
    await requested;
    const loader = dialog(page).getByRole('region', { name: 'Opening GitLab projects', exact: true });
    await expect(loader).toBeVisible();
    await loader.getByRole('button', { name: 'Cancel opening GitLab projects', exact: true }).click();
    await expect(dialog(page).getByLabel('Repository URL', { exact: true })).toHaveValue('https://owned.example/manual.git');
    release(); await finished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(catalogue(page)).toHaveCount(0);
    expect(await calls(page, 'gitlab_connections')).toHaveLength(0);
    expect(await calls(page, 'connect_gitlab_account')).toHaveLength(0);
  } finally { release(); }
});

test('a failed GitLab panel chunk preserves drafts and offers the working manual URL fallback', async ({ page }) => {
  let refused = false;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (!refused && text.includes('GitLab project catalogue') && text.includes('Personal access token')) {
      refused = true; await route.abort();
    } else await route.fulfill({ response, body: text });
  });
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  await dialog(page).getByRole('tab', { name: 'Clone', exact: true }).click();
  await dialog(page).getByLabel('Repository URL', { exact: true }).fill('https://owned.example/retained.git');
  await dialog(page).getByRole('button', { name: 'Browse GitLab projects', exact: true }).click();
  const error = dialog(page).getByRole('region', { name: 'GitLab projects unavailable', exact: true });
  await expect(error.getByRole('alert')).toBeVisible();
  expect(refused).toBe(true);
  expect(await calls(page, 'gitlab_connections')).toHaveLength(0);
  expect(await calls(page, 'connect_gitlab_account')).toHaveLength(0);
  await expect(error.getByRole('alert')).toContainText('save your work and restart the application');
  await error.getByRole('button', { name: 'Return to repository URL', exact: true }).click();
  await expect(dialog(page).getByLabel('Repository URL', { exact: true })).toHaveValue('https://owned.example/retained.git');
  await expect(dialog(page).getByLabel('Repository URL', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).commitMessage())).toBe('Owned retained GitLab commit draft');
  expect(await calls(page, 'gitlab_connections')).toHaveLength(0);
  expect(await calls(page, 'connect_gitlab_account')).toHaveLength(0);
  expect(await calls(page, 'clone_repository')).toHaveLength(0);
});


test('disconnecting a GitLab account stays available during an unrelated Git operation', async ({ page }) => {
  const panel = await connect(page);
  await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.operationBusy.set(true));
  try {
    await expect(panel.getByRole('button', { name: 'Connect to GitLab', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Load GitLab projects', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Disconnect owned-reader', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Disconnect owned-reader', exact: true }).click();
    await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue('');
    expect((await calls(page, 'disconnect_gitlab_account')).map((call: any) => call.args.connectionId)).toEqual([FIRST]);
    expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(true);
    expect(await calls(page, 'load_gitlab_projects')).toHaveLength(0);
    expect(await calls(page, 'cancel_git_operation')).toHaveLength(0);
  } finally {
    await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.operationBusy.set(false));
  }
});


test('fork submission capability needs a new explicitly opted-in connection and starts no provider mutation', async ({ page }) => {
  const panel = await connect(page);
  const permission = panel.getByRole('checkbox', { name: 'Enable reviewed fork requests for this new connection', exact: true });
  await expect(permission).not.toBeChecked();
  await permission.check();
  await panel.getByLabel('Personal access token', { exact: true }).fill(TOKEN);
  await panel.getByRole('button', { name: 'Connect to GitLab', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue('00000000000000000000000000000002');
  expect(await calls(page, 'connect_gitlab_account')).toHaveLength(1);
  expect(await calls(page, 'connect_gitlab_fork_account')).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__gitlab.connections.map((entry: any) => entry.canCreateFork))).toEqual([false, true]);
  expect(await calls(page, 'prepare_gitlab_fork')).toHaveLength(0);
  expect(await calls(page, 'execute_gitlab_fork')).toHaveLength(0);
  await expect(panel.getByLabel('Personal access token', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(TOKEN);
});

test('a mismatched fork capability is retired without preparing or submitting any fork', async ({ page }) => {
  const panel = await open(page);
  await page.evaluate(() => { (window as any).__gitlab.wrongCapability = true; });
  await panel.getByLabel('HTTPS instance', { exact: true }).fill('https://gitlab.example.test');
  await panel.getByRole('checkbox', { name: 'Enable reviewed fork requests for this new connection', exact: true }).check();
  await panel.getByLabel('Personal access token', { exact: true }).fill(TOKEN);
  await panel.getByRole('button', { name: 'Connect to GitLab', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('The connection capability did not match this request');
  expect(await calls(page, 'disconnect_gitlab_account')).toHaveLength(1);
  expect(await calls(page, 'prepare_gitlab_fork')).toHaveLength(0);
  expect(await calls(page, 'execute_gitlab_fork')).toHaveLength(0);
  await expect(panel.getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue('');
});
