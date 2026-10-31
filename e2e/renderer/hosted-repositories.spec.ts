import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Repository management', exact: true });
  await dialog.getByRole('tab', { name: 'Clone', exact: true }).click();
  await dialog.getByRole('button', { name: 'Browse repositories on GitHub', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'GitHub repository catalogue' })).toBeVisible();
  return dialog;
}
async function selected(page: Page) {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Load repositories', exact: true }).click();
  await expect(dialog.locator('[data-hosted-account]')).toContainText('owned-user');
  await dialog.getByRole('button', { name: 'Select team/owned', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Selected hosted repository', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Choose folder', exact: true }).click();
  return dialog;
}
async function reviewed(page: Page) {
  const dialog = await selected(page);
  await dialog.getByRole('button', { name: 'Review hosted clone', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Review hosted clone', exact: true })).toBeFocused();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.branch-item').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root')); const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.chooseDirectory = async () => '/owned/clones';
    app.commitMessage.set('Owned retained commit draft');
    const account = { host: 'github.com', id: '9007199254740993', login: 'owned-user' };
    const repository = { id: '9007199254740995', ownerId: '11', owner: 'team', name: 'owned', fullName: 'team/owned', url: 'https://github.com/team/owned', cloneHttps: 'https://github.com/team/owned.git', cloneSsh: 'git@github.com:team/owned.git', description: 'Owned catalogue fixture', defaultBranch: 'main', private: true, archived: false, disabled: false, fork: false, parent: null, source: null, canPull: true, canPush: false };
    const base = git.repository();
    const snapshot = { ...base, id: 'cloned-owned', name: 'owned', path: '/owned/clones/owned', commits: [], branches: [], headOid: null, status: { ...base.status, branch: 'main', staged: 0, unstaged: 0, untracked: 0, conflicted: 0, entries: [], mergeInProgress: false, rebaseInProgress: false, historyOperation: null } };
    const fixture = { account, repository, calls: [] as any[], plans: {} as Record<string, any>, next: 0, hold: '', release: null as (() => void) | null, fail: '', mismatch: false, snapshot };
    (window as any).__hostedCatalogue = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args: structuredClone(args) });
      if (fixture.fail === command) throw { kind: 'ownedHostedRefusal', message: 'Owned request refused', hint: 'No existing destination was changed.' };
      let result: any;
      if (command === 'load_hosted_repositories') {
        if (args.query.expectedAccountId && args.query.expectedAccountId !== fixture.account.id) throw { kind: 'hostingDiscoveryRequest', message: 'The provider account changed. Reload its first repository page.' };
        result = { account: fixture.account, query: args.query, entries: args.query.page === 1 ? [fixture.repository] : [], mayHaveMore: args.query.page === 1, nextPage: args.query.page === 1 ? 2 : null };
      } else if (command === 'inspect_hosted_repository') result = { account: fixture.account, repository: { ...fixture.repository, id: fixture.mismatch ? 'replaced-id' : fixture.repository.id } };
      else if (command === 'prepare_hosted_clone') {
        const request = args.request; const token = `owned-clone-${++fixture.next}`;
        const plan = { account: fixture.account, repository: { id: fixture.repository.id, fullName: fixture.repository.fullName }, transport: request.transport, url: request.transport === 'https' ? fixture.repository.cloneHttps : fixture.repository.cloneSsh, parentPath: request.parentPath, folder: request.folder, destination: request.parentPath + '/' + request.folder, branch: request.branch, depth: request.depth, recurseSubmodules: request.recurseSubmodules };
        fixture.plans[token] = { contextId: args.contextId, plan: structuredClone(plan) }; result = { token, plan };
      } else if (command === 'discard_hosted_clone_plan') { delete fixture.plans[args.token]; result = true; }
      else if (command === 'execute_hosted_clone') {
        const cached = fixture.plans[args.token]; if (!cached || cached.contextId !== args.contextId) throw { message: 'Clone preview expired or consumed' };
        delete fixture.plans[args.token]; result = fixture.snapshot;
      } else if (command === 'cancel_git_operation') result = true;
      else if (command === 'refresh_repository' || command === 'refresh_repository_metadata') result = fixture.snapshot;
      else if (command === 'refresh_repository_status') result = fixture.snapshot.status;
      else if (command === 'load_more_commits') result = { commits: [], hasMoreCommits: false };
      else throw Error(`Unexpected hosted catalogue command ${command}`);
      if (fixture.hold === command) return new Promise(resolve => { fixture.release = () => resolve(structuredClone(result)); });
      return structuredClone(result);
    } };
  });
});

test('catalogue is explicitly loaded and subsequent pages keep the verified decimal account identity', async ({ page }) => {
  const dialog = await open(page);
  expect(await page.evaluate(() => (window as any).__hostedCatalogue.calls)).toHaveLength(0);
  await dialog.getByText('Catalogue filters', { exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Visibility', exact: true }).selectOption('private');
  await dialog.getByRole('combobox', { name: 'Access', exact: true }).selectOption('owned');
  await dialog.getByRole('button', { name: 'Load repositories', exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'Hosted repositories' })).toContainText('team/owned');
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'Hosted repositories' })).toContainText('No repositories returned');
  const requests = await page.evaluate(() => (window as any).__hostedCatalogue.calls.filter((c: any) => c.command === 'load_hosted_repositories').map((c: any) => c.args.query));
  expect(requests).toEqual([{ visibility: 'private', affiliation: 'owned', sort: 'fullName', direction: 'ascending', page: 1, expectedAccountId: null }, { visibility: 'private', affiliation: 'owned', sort: 'fullName', direction: 'ascending', page: 2, expectedAccountId: '9007199254740993' }]);
});

test('an account change refuses a later page while preserving the previous account result', async ({ page }) => {
  const dialog = await selected(page);
  await page.evaluate(() => { (window as any).__hostedCatalogue.account = { host: 'github.com', id: 'other-account', login: 'other-user' }; });
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('provider account changed');
  await expect(dialog.locator('[data-hosted-account]')).toContainText('owned-user');
  await expect(dialog.getByRole('region', { name: 'Selected hosted repository', exact: true })).toHaveCount(0);
});

test('selection is freshly inspected and a clone requires a server-held review before execution', async ({ page }) => {
  const dialog = await reviewed(page);
  const review = dialog.getByRole('region', { name: 'Review hosted clone', exact: true });
  await expect(review).toContainText('/owned/clones/owned'); await expect(review).toContainText('owned-user');
  const before = await page.evaluate(() => (window as any).__hostedCatalogue.calls);
  const inspection = before.find((c: any) => c.command === 'inspect_hosted_repository');
  expect(inspection.args).toMatchObject({ fullName: 'team/owned', repositoryId: '9007199254740995', accountId: '9007199254740993' });
  expect(before.some((c: any) => c.command === 'execute_hosted_clone' || c.command === 'clone_repository')).toBe(false);
  await dialog.getByRole('button', { name: 'Clone reviewed repository', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const execute = await page.evaluate(() => (window as any).__hostedCatalogue.calls.filter((c: any) => c.command === 'execute_hosted_clone'));
  expect(execute).toHaveLength(1); expect(Object.keys(execute[0].args).sort()).toEqual(['contextId', 'operationId', 'token']);
});

test('SSH, branch, shallow depth and nested submodules are explicitly reviewed', async ({ page }) => {
  const dialog = await selected(page);
  await dialog.getByRole('combobox', { name: 'Clone transport', exact: true }).selectOption('ssh');
  await dialog.getByLabel('Branch (optional)', { exact: true }).fill('topic/owned');
  await dialog.getByRole('checkbox', { name: 'Limit history depth', exact: true }).check();
  await dialog.getByLabel('History depth', { exact: true }).fill('3');
  await dialog.getByRole('checkbox', { name: 'Include nested submodules', exact: true }).check();
  await dialog.getByRole('button', { name: 'Review hosted clone', exact: true }).click();
  const review = dialog.getByRole('region', { name: 'Review hosted clone', exact: true });
  await expect(review).toContainText('git@github.com:team/owned.git'); await expect(review).toContainText('topic/owned · Depth 3');
  const request = await page.evaluate(() => (window as any).__hostedCatalogue.calls.find((c: any) => c.command === 'prepare_hosted_clone').args.request);
  expect(request).toMatchObject({ transport: 'ssh', branch: 'topic/owned', depth: 3, recurseSubmodules: true });
  expect(request).not.toHaveProperty('url');
});

test('editing clone options discards its preview and Enter in hosted fields never submits the manual clone', async ({ page }) => {
  const dialog = await reviewed(page);
  await dialog.getByLabel('Folder name', { exact: true }).fill('other-destination');
  await expect(dialog.getByRole('region', { name: 'Review hosted clone', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Folder name', { exact: true }).press('Enter');
  const calls = await page.evaluate(() => (window as any).__hostedCatalogue.calls);
  expect(calls.some((c: any) => c.command === 'discard_hosted_clone_plan')).toBe(true);
  expect(calls.some((c: any) => c.command === 'clone_repository' || c.command === 'execute_hosted_clone')).toBe(false);
});

test('canceled preparation discards a late preview and preserves the cancelled outcome', async ({ page }) => {
  const dialog = await selected(page);
  await page.evaluate(() => { (window as any).__hostedCatalogue.hold = 'prepare_hosted_clone'; });
  await dialog.getByRole('button', { name: 'Review hosted clone', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel hosted request', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).__hostedCatalogue; f.hold = ''; f.release(); });
  await expect(dialog).toContainText('Request canceled');
  await expect(dialog.getByRole('region', { name: 'Review hosted clone', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__hostedCatalogue.calls.some((c: any) => c.command === 'discard_hosted_clone_plan'))).toBe(true);
});

test('closing the dialogue cancels a pending catalogue and never reopens it from a late response', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => { (window as any).__hostedCatalogue.hold = 'load_hosted_repositories'; });
  await dialog.getByRole('button', { name: 'Load repositories', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close repository management', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).__hostedCatalogue; f.hold = ''; f.release(); });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__hostedCatalogue.calls.some((c: any) => c.command === 'cancel_git_operation'))).toBe(true);
});

test('replaced repository identity and provider refusals remain explicit without a clone preview', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Load repositories', exact: true }).click();
  await page.evaluate(() => { (window as any).__hostedCatalogue.mismatch = true; });
  await dialog.getByRole('button', { name: 'Select team/owned', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('identity changed');
  await expect(dialog.getByRole('region', { name: 'Selected hosted repository', exact: true })).toHaveCount(0);
  await page.evaluate(() => { const f = (window as any).__hostedCatalogue; f.mismatch = false; f.fail = 'prepare_hosted_clone'; });
  await dialog.getByRole('button', { name: 'Select team/owned', exact: true }).click();
  await dialog.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review hosted clone', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('No existing destination was changed');
  await expect(dialog.getByRole('region', { name: 'Review hosted clone', exact: true })).toHaveCount(0);
});

test('a destination path can be entered directly and editing it invalidates the review', async ({ page }) => {
  const dialog = await reviewed(page);
  await dialog.getByLabel('Where to clone', { exact: true }).fill('/owned/other-clones');
  await expect(dialog.getByRole('region', { name: 'Review hosted clone', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Review hosted clone', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Review hosted clone', exact: true })).toContainText('/owned/other-clones/owned');
  expect(await page.evaluate(() => (window as any).__hostedCatalogue.calls.some((c: any) => c.command === 'execute_hosted_clone'))).toBe(false);
});

test('manual clone and commit drafts survive browsing hosted repositories', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Enter a repository URL instead', exact: true }).click();
  await dialog.getByLabel('Repository URL', { exact: true }).fill('https://owned.example.test/manual.git');
  await dialog.getByLabel('Folder name', { exact: true }).fill('manual-draft');
  await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
  await dialog.getByRole('button', { name: 'Browse repositories on GitHub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Load repositories', exact: true }).click();
  await expect(dialog.locator('[data-hosted-account]')).toContainText('owned-user');
  await dialog.getByRole('button', { name: 'Select team/owned', exact: true }).click();
  await expect(dialog.getByLabel('Where to clone', { exact: true })).toHaveValue('/owned/clones');
  await dialog.getByLabel('Where to clone', { exact: true }).fill('');
  await expect(dialog.getByLabel('Where to clone', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Review hosted clone', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Enter a repository URL instead', exact: true }).click();
  await expect(dialog.locator('input[name=cloneParent]')).toHaveValue('/owned/clones');
  await expect(dialog.getByLabel('Repository URL', { exact: true })).toHaveValue('https://owned.example.test/manual.git');
  await expect(dialog.getByLabel('Folder name', { exact: true })).toHaveValue('manual-draft');
  await dialog.getByRole('button', { name: 'Close repository management', exact: true }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Owned retained commit draft');
});

test('a confirmed clone arriving after cancellation remains a truthful completed outcome', async ({ page }) => {
  const dialog = await reviewed(page);
  await page.evaluate(() => { (window as any).__hostedCatalogue.hold = 'execute_hosted_clone'; });
  await dialog.getByRole('button', { name: 'Clone reviewed repository', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel hosted request', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).__hostedCatalogue; f.hold = ''; f.release(); });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().path)).toBe('/owned/clones/owned');
  expect(await page.evaluate(() => (window as any).__hostedCatalogue.calls.filter((c: any) => c.command === 'execute_hosted_clone'))).toHaveLength(1);
});

for (const theme of ['chronos', 'midnight']) test(`${theme} hosted catalogue stays keyboard-contained and readable in a compact window`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await page.evaluate(theme => (window as any).ng.getComponent(document.querySelector('gc-root')).setAppTheme(theme), theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const dialog = await reviewed(page);
  const discard = dialog.getByRole('button', { name: 'Discard clone preview', exact: true });
  await discard.focus(); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close repository management', exact: true })).toBeFocused();
  expect(await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth; })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('hosted-catalogue-' + theme + '.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});
