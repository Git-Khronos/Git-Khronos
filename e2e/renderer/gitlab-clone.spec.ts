import { expect, test, type Page } from '@playwright/test';

const FIRST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const API_TOKEN = 'owned-renderer-api-credential';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Repository management', exact: true });
const panel = (page: Page) => dialog(page).getByRole('region', { name: 'GitLab project catalogue', exact: true });
const clone = (page: Page) => panel(page).getByRole('region', { name: 'Clone selected GitLab project', exact: true });
const review = (page: Page) => clone(page).getByRole('region', { name: 'Review GitLab clone', exact: true });
const calls = (page: Page, command: string) => page.evaluate(command => (window as any).__gitlabClone.calls.filter((call: any) => call.command === command), command);

async function loaded(page: Page) {
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  await dialog(page).getByRole('tab', { name: 'Clone', exact: true }).click();
  await dialog(page).getByLabel('Repository URL', { exact: true }).fill('https://owned.example.test/manual.git');
  await dialog(page).getByRole('button', { name: 'Browse GitLab projects', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Refresh GitLab connections', exact: true })).toBeEnabled();
  await panel(page).getByLabel('HTTPS instance', { exact: true }).fill('https://gitlab.example.test:8443');
  await panel(page).getByLabel('Personal access token', { exact: true }).fill(API_TOKEN);
  await panel(page).getByRole('button', { name: 'Connect to GitLab', exact: true }).click();
  await expect(panel(page).getByRole('combobox', { name: 'Connected account', exact: true })).toHaveValue(FIRST);
  await panel(page).getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Inspect and clone team/subgroup/owned', exact: true })).toBeEnabled();
}
async function selected(page: Page) {
  await loaded(page);
  await panel(page).getByRole('button', { name: 'Inspect and clone team/subgroup/owned', exact: true }).click();
  await expect(clone(page).getByRole('group', { name: 'GitLab clone options', exact: true })).toBeVisible();
  await clone(page).getByRole('button', { name: 'Choose GitLab clone directory', exact: true }).click();
  await expect(clone(page).getByLabel('Destination directory', { exact: true })).toHaveValue('/owned/clones');
  const checkboxes = await clone(page).locator('label.check').evaluateAll(labels => labels.map(label => {
    const control = label.querySelector('input')!.getBoundingClientRect(), bounds = label.getBoundingClientRect();
    return { width: control.width, height: control.height, inset: control.left - bounds.left };
  }));
  expect(checkboxes).toHaveLength(2);
  for (const control of checkboxes) {
    expect(control.width).toBeGreaterThanOrEqual(14); expect(control.width).toBeLessThanOrEqual(20);
    expect(control.height).toBeGreaterThanOrEqual(14); expect(control.height).toBeLessThanOrEqual(20);
    expect(control.inset).toBeGreaterThanOrEqual(0); expect(control.inset).toBeLessThan(4);
  }
}
async function reviewed(page: Page) {
  await selected(page);
  await clone(page).getByRole('button', { name: 'Review GitLab clone', exact: true }).click();
  await expect(review(page)).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(first => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root')), git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.chooseDirectory = async () => '/owned/clones';
    app.commitMessage.set('Owned retained clone commit draft');
    const base = structuredClone(git.repository()), repositories = structuredClone(git.repositories());
    const account = { origin: 'https://gitlab.example.test:8443', id: '9007199254740993', login: 'owned-reader' };
    const project = { id: '9007199254740995', name: 'Owned project', fullPath: 'team/subgroup/owned',
      url: account.origin + '/team/subgroup/owned', defaultBranch: null, description: null, archived: true, visibility: 'private' };
    const snapshot = { ...base, id: 'owned-gitlab-clone', name: 'Owned GitLab clone', path: '/owned/clones/owned',
      commits: [], branches: [], headOid: null, status: { ...base.status, branch: 'main', staged: 0, unstaged: 0,
        untracked: 0, conflicted: 0, entries: [], mergeInProgress: false, rebaseInProgress: false, historyOperation: null } };
    const fixture = { account, project, snapshot, repositories, connections: [] as any[], calls: [] as any[],
      plans: {} as Record<string, any>, next: 0, hold: '', release: null as (() => void) | null,
      releaseFailure: false, fail: '', mismatch: '', wrongPlan: false, lostExecutionReply: false,
      https: 'https://git.example.test:9443/team/subgroup/owned.git', ssh: 'ssh://git@ssh.example.test:2222/team/subgroup/owned.git' };
    (window as any).__gitlabClone = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args: structuredClone(args) });
      if (fixture.fail === command) throw { kind: 'gitlabOwnedRefusal', message: 'Owned GitLab clone step refused.' };
      let result: any;
      if (command === 'gitlab_connections') result = fixture.connections;
      else if (command === 'connect_gitlab_account') {
        result = { connectionId: first, account: fixture.account, canCreateFork: false, expiresAtMillis: String(Date.now() + 30 * 60 * 1000) };
        fixture.connections = [structuredClone(result)];
      } else if (command === 'load_gitlab_projects') result = { account: fixture.account, query: args.request.query,
        entries: [fixture.project], mayHaveMore: false, nextPage: null, warnings: [] };
      else if (command === 'inspect_gitlab_project') {
        result = { account: fixture.mismatch === 'account' ? { ...fixture.account, login: 'changed' } : fixture.account,
          project: { ...fixture.project, ...(fixture.mismatch === 'id' ? { id: 'changed' } : {}),
            ...(fixture.mismatch === 'path' ? { fullPath: 'team/moved/owned' } : {}) }, cloneHttps: fixture.https || null, cloneSsh: fixture.ssh || null };
      } else if (command === 'prepare_gitlab_clone') {
        const request = args.request.request, token = (++fixture.next).toString(16).padStart(32, '0');
        const plan = { account: fixture.account, project: fixture.project, transport: request.transport,
          url: request.transport === 'https' ? fixture.https : fixture.ssh, parentPath: request.parentPath, folder: request.folder,
          destination: request.parentPath + '/' + request.folder, branch: request.branch, depth: request.depth, recurseSubmodules: request.recurseSubmodules };
        fixture.plans[token] = { contextId: args.request.contextId, plan: structuredClone(plan) };
        result = { token, plan: fixture.wrongPlan ? { ...plan, url: 'https://unreviewed.example.test/project.git' } : plan };
      } else if (command === 'discard_gitlab_clone_plan') {
        const cached = fixture.plans[args.token];
        result = !!cached && cached.contextId === args.contextId;
        if (result) delete fixture.plans[args.token];
      } else if (command === 'execute_gitlab_clone') {
        const request = args.request, cached = fixture.plans[request.token];
        if (!cached || cached.contextId !== request.contextId) throw { kind: 'gitlabClonePreview', message: 'Owned preview expired or consumed.' };
        delete fixture.plans[request.token];
        if (fixture.lostExecutionReply) throw { kind: 'gitlabOwnedReplyLost', message: 'Owned clone result was not confirmed.' };
        result = fixture.snapshot;
      } else if (command === 'disconnect_gitlab_account') {
        result = fixture.connections.some(connection => connection.connectionId === args.connectionId);
        fixture.connections = fixture.connections.filter(connection => connection.connectionId !== args.connectionId);
      } else if (command === 'cancel_git_operation') result = true;
      else if (command === 'refresh_repository' || command === 'refresh_repository_metadata' || command === 'refresh_repository_status') {
        const repository = args.repoId === snapshot.id ? snapshot : repositories.find((candidate: any) => candidate.id === args.repoId);
        if (!repository) throw Error('Unexpected repository refresh in owned clone fixture');
        result = command === 'refresh_repository_status' ? repository.status : repository;
      } else if (command === 'load_more_commits') result = { commits: [], hasMoreCommits: false };
      else throw Error(`Unexpected GitLab clone fixture command ${command}`);
      const captured = structuredClone(result);
      if (fixture.hold === command) return new Promise((resolve, reject) => { fixture.release = () => fixture.releaseFailure
        ? reject({ kind: 'operationCancelled', message: 'Owned clone cancelled with partial data.' }) : resolve(captured); });
      return captured;
    } };
  }, FIRST);
});

test('selected GitLab clone reviews separate authorities and executes only its native token once', async ({ page }) => {
  await reviewed(page);
  await expect(review(page)).toContainText('https://gitlab.example.test:8443');
  await expect(review(page)).toContainText('https://git.example.test:9443/team/subgroup/owned.git');
  await expect(review(page)).toContainText('/owned/clones/owned');
  expect((await calls(page, 'inspect_gitlab_project'))[0].args.request).toMatchObject({ connectionId: FIRST, projectId: '9007199254740995' });
  expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(0);
  expect(await calls(page, 'clone_repository')).toHaveLength(0);
  await clone(page).getByRole('button', { name: 'Clone reviewed GitLab project', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const executed = await calls(page, 'execute_gitlab_clone'); expect(executed).toHaveLength(1);
  expect(Object.keys(executed[0].args)).toEqual(['request']);
  expect(Object.keys(executed[0].args.request).sort()).toEqual(['contextId', 'operationId', 'token']);
  expect(executed[0].args.request.contextId).toBe((await calls(page, 'prepare_gitlab_clone'))[0].args.request.contextId);
  expect(await page.evaluate(() => JSON.stringify((window as any).__gitlabClone.calls.filter((c: any) => c.command !== 'connect_gitlab_account')))).not.toContain(API_TOKEN);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(API_TOKEN);
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().id)).toBe('owned-gitlab-clone');
});

test('SSH, literal branch, depth and recursive submodule options are explicitly reviewed', async ({ page }) => {
  await selected(page);
  await clone(page).getByRole('combobox', { name: 'Git transport', exact: true }).selectOption('ssh');
  await clone(page).getByLabel('Branch (optional)', { exact: true }).fill('topic/literal');
  await clone(page).getByRole('checkbox', { name: 'Limit history depth', exact: true }).check();
  await clone(page).getByLabel('History depth', { exact: true }).fill('3');
  await clone(page).getByRole('checkbox', { name: 'Initialize nested submodules', exact: true }).check();
  await clone(page).getByRole('button', { name: 'Review GitLab clone', exact: true }).click();
  await expect(review(page)).toContainText('ssh://git@ssh.example.test:2222/team/subgroup/owned.git');
  await expect(review(page)).toContainText('topic/literal · Depth 3');
  expect((await calls(page, 'prepare_gitlab_clone'))[0].args.request.request).toMatchObject({ projectId: '9007199254740995',
    fullPath: 'team/subgroup/owned', transport: 'ssh', branch: 'topic/literal', depth: 3, recurseSubmodules: true });
});

test('option changes discard the review and Enter never submits a manual or reviewed clone', async ({ page }) => {
  await reviewed(page);
  await clone(page).getByLabel('New folder', { exact: true }).fill('another folder');
  await expect(review(page)).toHaveCount(0);
  await clone(page).getByLabel('New folder', { exact: true }).press('Enter');
  const discard = await calls(page, 'discard_gitlab_clone_plan'); expect(discard).toHaveLength(1);
  expect(discard[0].args.contextId).toBe((await calls(page, 'prepare_gitlab_clone'))[0].args.request.contextId);
  expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(0); expect(await calls(page, 'clone_repository')).toHaveLength(0);
  await clone(page).getByRole('button', { name: 'Return to GitLab projects', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Return to repository URL', exact: true }).click();
  await expect(dialog(page).getByLabel('Repository URL', { exact: true })).toHaveValue('https://owned.example.test/manual.git');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).commitMessage())).toBe('Owned retained clone commit draft');
});

test('cancelled preparation discards a late preview without replaying the read', async ({ page }) => {
  await selected(page); await page.evaluate(() => { (window as any).__gitlabClone.hold = 'prepare_gitlab_clone'; });
  await clone(page).getByRole('button', { name: 'Review GitLab clone', exact: true }).click();
  await clone(page).getByRole('button', { name: 'Cancel GitLab clone request', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).__gitlabClone; f.hold = ''; f.release(); });
  await expect(clone(page)).toContainText('Late reviews will be discarded'); await expect(review(page)).toHaveCount(0);
  await expect.poll(async () => (await calls(page, 'discard_gitlab_clone_plan')).length).toBe(1);
  expect(await calls(page, 'prepare_gitlab_clone')).toHaveLength(1); expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(0);
});

test('closing during preparation retires its late review without reviving the panel', async ({ page }) => {
  await selected(page); await page.evaluate(() => { (window as any).__gitlabClone.hold = 'prepare_gitlab_clone'; });
  await clone(page).getByRole('button', { name: 'Review GitLab clone', exact: true }).click();
  await expect.poll(async () => (await calls(page, 'prepare_gitlab_clone')).length).toBe(1);
  await dialog(page).getByRole('button', { name: 'Close repository management', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).__gitlabClone; f.hold = ''; f.release(); });
  await expect.poll(async () => (await calls(page, 'discard_gitlab_clone_plan')).length).toBe(1);
  await expect(dialog(page)).toHaveCount(0); expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(0);
});

for (const mismatch of ['account', 'id', 'path']) test(`a changed ${mismatch} refuses selection and focuses feedback`, async ({ page }) => {
  await loaded(page); await page.evaluate(mismatch => { (window as any).__gitlabClone.mismatch = mismatch; }, mismatch);
  await panel(page).getByRole('button', { name: 'Inspect and clone team/subgroup/owned', exact: true }).click();
  await expect(clone(page).getByRole('alert')).toContainText('selected account or project changed');
  await expect(clone(page).getByRole('alert')).toBeFocused();
  await expect(clone(page).getByRole('group', { name: 'GitLab clone options', exact: true })).toHaveCount(0);
  expect(await calls(page, 'prepare_gitlab_clone')).toHaveLength(0); expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(0);
});

test('earlier rows cannot start cloning after query changes or failed reloads', async ({ page }) => {
  await loaded(page); const button = panel(page).getByRole('button', { name: 'Inspect and clone team/subgroup/owned', exact: true });
  await panel(page).getByRole('searchbox', { name: 'Project search', exact: true }).fill('new query');
  await expect(button).toBeDisabled();
  await page.evaluate(() => { (window as any).__gitlabClone.fail = 'load_gitlab_projects'; });
  await panel(page).getByRole('button', { name: 'Load GitLab projects', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toBeVisible(); await expect(button).toBeDisabled();
  expect(await calls(page, 'inspect_gitlab_project')).toHaveLength(0);
});

test('unavailable HTTPS still permits a verified SSH choice for an empty or archived project', async ({ page }) => {
  await page.evaluate(() => { (window as any).__gitlabClone.https = ''; });
  await selected(page);
  await expect(clone(page).getByRole('combobox', { name: 'Git transport', exact: true })).toHaveValue('ssh');
  await clone(page).getByRole('button', { name: 'Review GitLab clone', exact: true }).click();
  await expect(review(page)).toContainText('ssh://git@ssh.example.test:2222/team/subgroup/owned.git');
  expect((await calls(page, 'prepare_gitlab_clone'))[0].args.request.request.branch).toBeNull();
});

test('a changed clone preview is discarded instead of offering an unreviewed address', async ({ page }) => {
  await selected(page); await page.evaluate(() => { (window as any).__gitlabClone.wrongPlan = true; });
  await clone(page).getByRole('button', { name: 'Review GitLab clone', exact: true }).click();
  await expect(clone(page).getByRole('alert')).toContainText('no longer matches'); await expect(review(page)).toHaveCount(0);
  await expect.poll(async () => (await calls(page, 'discard_gitlab_clone_plan')).length).toBe(1);
  expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(0);
});

test('an unknown execution outcome consumes the review and requires destination inspection', async ({ page }) => {
  await reviewed(page); await page.evaluate(() => { (window as any).__gitlabClone.lostExecutionReply = true; });
  await clone(page).getByRole('button', { name: 'Clone reviewed GitLab project', exact: true }).click();
  await expect(clone(page).getByRole('alert')).toContainText('Inspect /owned/clones/owned'); await expect(review(page)).toHaveCount(0);
  await expect(clone(page).getByRole('button', { name: 'Clone reviewed GitLab project', exact: true })).toHaveCount(0);
  await clone(page).getByLabel('New folder', { exact: true }).press('Enter');
  expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(1);
  expect(await page.evaluate(() => Object.keys((window as any).__gitlabClone.plans))).toEqual([]);
});

test('disconnect after Git handoff does not cancel the already accepted clone', async ({ page }) => {
  await reviewed(page); await page.evaluate(() => { (window as any).__gitlabClone.hold = 'execute_gitlab_clone'; });
  await clone(page).getByRole('button', { name: 'Clone reviewed GitLab project', exact: true }).click();
  await expect.poll(async () => (await calls(page, 'execute_gitlab_clone')).length).toBe(1);
  await panel(page).getByRole('button', { name: 'Disconnect owned-reader', exact: true }).click();
  await expect(clone(page).getByRole('button', { name: 'Cancel GitLab clone request', exact: true })).toBeEnabled();
  expect(await calls(page, 'cancel_git_operation')).toHaveLength(0);
  await page.evaluate(() => { const f = (window as any).__gitlabClone; f.hold = ''; f.release(); });
  await expect(dialog(page)).toHaveCount(0); expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(1);
});

test('clone cancellation addresses only its operation and never restores an execution token', async ({ page }) => {
  await reviewed(page); await page.evaluate(() => { (window as any).__gitlabClone.hold = 'execute_gitlab_clone'; });
  await clone(page).getByRole('button', { name: 'Clone reviewed GitLab project', exact: true }).click();
  await clone(page).getByRole('button', { name: 'Cancel GitLab clone request', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).__gitlabClone; f.hold = ''; f.releaseFailure = true; f.release(); });
  await expect(clone(page).getByRole('alert')).toContainText('partial data'); await expect(review(page)).toHaveCount(0);
  const cancel = await calls(page, 'cancel_git_operation'); expect(cancel).toHaveLength(1);
  expect(cancel[0].args.operationId).toBe((await calls(page, 'execute_gitlab_clone'))[0].args.request.operationId);
  expect(await calls(page, 'execute_gitlab_clone')).toHaveLength(1);
});

for (const theme of ['khronos', 'midnight']) test(`${theme} GitLab clone review fits a compact keyboard workflow`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 560 });
  await page.evaluate(theme => (window as any).ng.getComponent(document.querySelector('gc-root')).setAppTheme(theme), theme);
  await reviewed(page);
  await review(page).getByRole('button', { name: 'Discard GitLab clone review', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog(page).getByRole('button', { name: 'Close repository management', exact: true })).toBeFocused();
  expect(await dialog(page).evaluate(element => { const b = element.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight && element.scrollWidth <= element.clientWidth; })).toBe(true);
  await review(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('gitlab-clone-' + theme + '.png') });
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
});
