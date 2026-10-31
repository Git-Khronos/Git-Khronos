import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, select = true) {
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Repository management', exact: true });
  await dialog.getByRole('tab', { name: 'Clone', exact: true }).click();
  await dialog.getByRole('button', { name: 'Browse repositories on GitHub', exact: true }).click();
  if (select) {
    await dialog.getByRole('button', { name: 'Load repositories', exact: true }).click();
    await dialog.getByRole('button', { name: 'Select team/owned', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Selected hosted repository', exact: true })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Manage forks and saved requests', exact: true }).click();
  return { dialog, forks: dialog.getByRole('region', { name: 'Forks and saved requests', exact: true }) };
}
async function reviewed(page: Page) {
  const view = await open(page);
  await view.forks.getByRole('button', { name: 'Review fork creation', exact: true }).click();
  await expect(view.forks.getByRole('region', { name: 'Review fork creation', exact: true })).toBeFocused();
  return view;
}
async function submitted(page: Page) {
  const view = await reviewed(page);
  await view.forks.getByRole('button', { name: 'Submit reviewed fork request', exact: true }).click();
  await expect(view.forks.getByRole('region', { name: 'Saved fork outcome', exact: true })).toBeFocused();
  return view;
}
async function calls(page: Page, command: string) { return page.evaluate(command => (window as any).__forkFixture.calls.filter((c: any) => c.command === command), command); }

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.branch-item').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root')); const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const account = { host: 'github.com', id: '9007199254740993', login: 'owned-user' };
    const repository = { id: '9007199254740995', ownerId: '11', owner: 'team', name: 'owned', fullName: 'team/owned', url: 'https://github.com/team/owned', cloneHttps: 'https://github.com/team/owned.git', cloneSsh: 'git@github.com:team/owned.git', description: null, defaultBranch: 'main', private: true, archived: false, disabled: false, fork: false, parent: null, source: null, canPull: true, canPush: false, forkingAllowed: true };
    const identity = { id: repository.id, fullName: repository.fullName };
    const fork = { ...repository, id: '9007199254740997', ownerId: account.id, owner: account.login, name: 'forked', fullName: 'owned-user/forked', url: 'https://github.com/owned-user/forked', cloneHttps: 'https://github.com/owned-user/forked.git', cloneSsh: 'git@github.com:owned-user/forked.git', fork: true, parent: identity, source: identity, canPush: true };
    const fixture = { account, repository, fork, calls: [] as any[], cache: {} as Record<string, any>, records: {} as Record<string, any>, next: 0, hold: '', release: null as (() => void) | null, initialPhase: 'acceptedPending', stages: ['metadataAvailable', 'ready'], mismatch: false, staleAck: false };
    (window as any).__forkFixture = fixture;
    const base = git.repository();
    function status(intent: any, phase: string) {
      const fullName = `${intent.destination.login}/${intent.name}`;
      return { id: (++fixture.next).toString(16).padStart(32, '0'), intent, phase, serverReplyReceived: phase !== 'awaitingConfirmation', observedRepositoryId: phase === 'ready' ? fork.id : null, repository: phase === 'ready' || phase === 'metadataAvailable' ? { id: fork.id, fullName, ownerId: intent.destination.id, cloneHttps: `https://github.com/${fullName}.git`, cloneSsh: `git@github.com:${fullName}.git`, defaultBranch: 'main' } : null, headOid: phase === 'ready' ? 'a'.repeat(40) : null, notice: phase === 'awaitingConfirmation' ? 'The provider outcome is unconfirmed. Check its saved status.' : 'The provider accepted the request; verify identity and Git objects before use.' };
    }
    function take(args: any, purpose: string) { const cached = fixture.cache[args.token]; if (!cached || cached.contextId !== args.contextId || cached.purpose !== purpose) throw { message: 'The owned review expired or changed purpose.' }; delete fixture.cache[args.token]; return cached; }
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args: structuredClone(args) }); let result: any;
      if (command === 'load_hosted_repositories') result = { account, query: args.query, entries: [repository], mayHaveMore: false, nextPage: null };
      else if (command === 'inspect_hosted_repository') result = { account, repository };
      else if (command === 'load_hosted_forks') result = { account: fixture.mismatch ? { ...account, id: '8' } : account, source: identity, network: identity, query: args.query, entries: args.query.page === 1 ? [fork] : [], mayHaveMore: args.query.page === 1, nextPage: args.query.page === 1 ? 2 : null };
      else if (command === 'inspect_hosted_fork') {
        const selection = args.selection; const [owner, name] = selection.forkFullName.split('/');
        result = { account, source: identity, network: identity, repository: { ...fork, id: fixture.mismatch ? '8' : selection.forkRepositoryId, ownerId: selection.forkOwnerId, owner, name, fullName: selection.forkFullName, url: `https://github.com/${selection.forkFullName}`, cloneHttps: `https://github.com/${selection.forkFullName}.git`, cloneSsh: `git@github.com:${selection.forkFullName}.git` } };
      } else if (command === 'prepare_hosted_fork') {
        const r = args.request; const token = `fork-${++fixture.next}`;
        const intent = { account, source: identity, network: identity, destination: { id: r.destinationOwner === account.login ? account.id : '21', login: r.destinationOwner, kind: r.destinationOwner === account.login ? 'personal' : 'organization' }, name: r.name, defaultBranchOnly: r.defaultBranchOnly, forkingAllowed: true };
        fixture.cache[token] = { contextId: args.contextId, purpose: 'create', intent: structuredClone(intent) }; result = { token, plan: { id: 'b'.repeat(32), intent } };
      } else if (command === 'execute_hosted_fork') {
        const cached = take(args, 'create'); result = status(cached.intent, fixture.initialPhase); fixture.records[result.id] = structuredClone(result);
      } else if (command === 'list_hosted_fork_requests') result = Object.values(fixture.records);
      else if (command === 'load_hosted_fork_request') result = fixture.records[args.id];
      else if (command === 'reconcile_hosted_fork') {
        const old = fixture.records[args.id]; result = { ...status(old.intent, fixture.stages.shift() ?? 'ready'), id: old.id }; fixture.records[old.id] = structuredClone(result);
      } else if (command === 'prepare_hosted_fork_acknowledgement') {
        const token = `ack-${++fixture.next}`; const record = structuredClone(fixture.records[args.id]); fixture.cache[token] = { contextId: args.contextId, purpose: 'ack', record }; result = { token, status: record, unresolved: record.phase !== 'ready' };
      } else if (command === 'execute_hosted_fork_acknowledgement') {
        const cached = take(args, 'ack'); if (fixture.staleAck) throw { message: 'The saved request changed. Review the latest outcome.' }; result = cached.record; delete fixture.records[result.id];
      } else if (command === 'discard_hosted_fork_review') { delete fixture.cache[args.token]; result = true; }
      else if (command === 'cancel_git_operation') result = true;
      else if (command === 'refresh_repository' || command === 'refresh_repository_metadata') result = base;
      else if (command === 'refresh_repository_status') result = base.status;
      else if (command === 'load_more_commits') result = { commits: [], hasMoreCommits: false };
      else throw Error(`Unexpected fork workflow command ${command}`);
      if (fixture.hold === command) return new Promise(resolve => { fixture.release = () => resolve(structuredClone(result)); });
      return structuredClone(result);
    } };
  });
});

test('fork pages are explicit, account bound and empty pages do not prove absence', async ({ page }) => {
  const { forks } = await open(page);
  expect(await calls(page, 'load_hosted_forks')).toHaveLength(0);
  await forks.getByRole('button', { name: 'Find existing forks', exact: true }).click();
  await expect(forks.getByRole('list', { name: 'Fork candidates' })).toContainText('owned-user/forked');
  await forks.getByRole('button', { name: 'Next fork page', exact: true }).click();
  await expect(forks.getByRole('list', { name: 'Fork candidates' })).toContainText('does not establish that no fork exists');
  const requests = await calls(page, 'load_hosted_forks');
  expect(requests.map((r: any) => r.args.query)).toEqual([1, 2].map(number => ({ sourceFullName: 'team/owned', sourceRepositoryId: '9007199254740995', accountId: '9007199254740993', page: number })));
});

test('existing fork inspection hands off to an independent clone review without cloning', async ({ page }) => {
  const { dialog, forks } = await open(page);
  await forks.getByRole('button', { name: 'Find existing forks', exact: true }).click();
  await forks.getByRole('button', { name: 'Inspect owned-user/forked', exact: true }).click();
  await expect(forks.getByRole('region', { name: 'Verified fork for cloning', exact: true })).toBeFocused();
  await forks.getByRole('button', { name: 'Use this fork for cloning', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Selected hosted repository', exact: true })).toContainText('owned-user/forked');
  await expect(dialog.getByRole('combobox', { name: 'Clone transport', exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Folder name', { exact: true })).toHaveValue('forked');
  expect(await calls(page, 'execute_hosted_clone')).toHaveLength(0); expect(await calls(page, 'execute_hosted_fork')).toHaveLength(0);
});

test('personal fork creation uses a server-held review and accepts no client-authored plan', async ({ page }) => {
  const { forks } = await reviewed(page);
  await expect(forks.getByRole('region', { name: 'Review fork creation', exact: true })).toContainText('owned-user/owned');
  expect(await calls(page, 'execute_hosted_fork')).toHaveLength(0);
  await page.evaluate(() => { const component = (window as any).ng.getComponent(document.querySelector('gc-hosted-forks')); component.preview().plan.intent.destination.login = 'forged-owner'; });
  await forks.getByRole('button', { name: 'Submit reviewed fork request', exact: true }).click();
  await expect(forks.getByRole('region', { name: 'Saved fork outcome', exact: true })).toContainText('owned-user/owned');
  const execution = await calls(page, 'execute_hosted_fork'); expect(execution).toHaveLength(1); expect(Object.keys(execution[0].args).sort()).toEqual(['contextId', 'operationId', 'token']);
  expect(await calls(page, 'clone_repository')).toHaveLength(0);
});

test('organization destination and all-branch scope remain explicit through review', async ({ page }) => {
  const { forks } = await open(page);
  await forks.getByRole('checkbox', { name: 'Use an organization destination', exact: true }).check();
  await forks.getByLabel('Destination organization', { exact: true }).fill('owned-org');
  await forks.getByLabel('Fork repository name', { exact: true }).fill('reviewed-fork');
  await forks.getByRole('checkbox', { name: 'Copy only the default branch', exact: true }).uncheck();
  await forks.getByRole('button', { name: 'Review fork creation', exact: true }).click();
  const review = forks.getByRole('region', { name: 'Review fork creation', exact: true });
  await expect(review).toContainText('owned-org/reviewed-fork'); await expect(review).toContainText('All branches');
  const request = (await calls(page, 'prepare_hosted_fork'))[0].args.request;
  expect(request).toMatchObject({ destinationOwner: 'owned-org', name: 'reviewed-fork', defaultBranchOnly: false });
});

test('editing a fork option discards its review and Enter cannot dispatch a manual clone', async ({ page }) => {
  const { forks } = await reviewed(page);
  await forks.getByLabel('Fork repository name', { exact: true }).fill('changed-fork');
  await forks.getByLabel('Fork repository name', { exact: true }).press('Enter');
  await expect(forks.getByRole('region', { name: 'Review fork creation', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await calls(page, 'discard_hosted_fork_review')).length).toBe(1);
  expect(await calls(page, 'execute_hosted_fork')).toHaveLength(0); expect(await calls(page, 'clone_repository')).toHaveLength(0);
});

test('accepted creation remains pending until metadata and Git objects are verified by reads', async ({ page }) => {
  const { forks } = await submitted(page); const outcome = forks.getByRole('region', { name: 'Saved fork outcome', exact: true });
  await expect(outcome).toContainText('Accepted; verification pending');
  await expect(forks.getByRole('button', { name: 'Inspect fork for cloning', exact: true })).toHaveCount(0);
  await outcome.getByRole('button', { name: 'Check fork status', exact: true }).click(); await expect(outcome).toContainText('Git objects pending');
  await outcome.getByRole('button', { name: 'Check fork status', exact: true }).click(); await expect(outcome).toContainText('Fork verified and ready for use');
  await expect(outcome.getByRole('button', { name: 'Inspect fork for cloning', exact: true })).toBeVisible();
  expect(await calls(page, 'execute_hosted_fork')).toHaveLength(1); expect(await calls(page, 'reconcile_hosted_fork')).toHaveLength(2);
});

test('an unconfirmed request survives closing and reopening without another submission', async ({ page }) => {
  await page.evaluate(() => { (window as any).__forkFixture.initialPhase = 'awaitingConfirmation'; });
  const { dialog, forks } = await submitted(page);
  await expect(forks.getByRole('region', { name: 'Saved fork outcome', exact: true })).toContainText('not evidence that no fork was created');
  await dialog.getByRole('button', { name: 'Close repository management', exact: true }).click();
  const reopened = await open(page, false); await reopened.forks.getByRole('button', { name: 'Load saved fork requests', exact: true }).click();
  await expect(reopened.forks.getByRole('list', { name: 'Saved fork requests', exact: true })).toContainText('Awaiting provider confirmation');
  await reopened.forks.getByRole('button', { name: 'Inspect saved owned-user/owned', exact: true }).click();
  await expect(reopened.forks.getByRole('region', { name: 'Saved fork outcome', exact: true })).toBeVisible();
  expect(await calls(page, 'execute_hosted_fork')).toHaveLength(1);
});

test('unresolved retirement needs acknowledgement and sends only the server review token', async ({ page }) => {
  const { forks } = await submitted(page);
  await forks.getByRole('button', { name: 'Review archiving this outcome', exact: true }).click();
  const review = forks.getByRole('region', { name: 'Review fork outcome archive', exact: true }); await expect(review).toBeFocused();
  await expect(review).toContainText('does not cancel the provider request');
  await expect(review.getByRole('button', { name: 'Archive reviewed outcome', exact: true })).toBeDisabled();
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: 'Archive reviewed outcome', exact: true }).click();
  await expect(forks.getByRole('list', { name: 'Saved fork requests', exact: true })).toContainText('No active saved');
  const apply = await calls(page, 'execute_hosted_fork_acknowledgement'); expect(Object.keys(apply[0].args).sort()).toEqual(['contextId', 'operationId', 'token']); expect(await calls(page, 'execute_hosted_fork')).toHaveLength(1);
});

test('stale acknowledgement refusal is focused and keeps the saved outcome for fresh review', async ({ page }) => {
  const { forks } = await submitted(page); await forks.getByRole('button', { name: 'Review archiving this outcome', exact: true }).click();
  await forks.getByRole('region', { name: 'Review fork outcome archive', exact: true }).getByRole('checkbox').check();
  await page.evaluate(() => { (window as any).__forkFixture.staleAck = true; });
  await forks.getByRole('button', { name: 'Archive reviewed outcome', exact: true }).click();
  await expect(forks.getByRole('alert')).toBeFocused(); await expect(forks.getByRole('alert')).toContainText('saved request changed');
  await expect(forks.getByRole('region', { name: 'Saved fork outcome', exact: true })).toBeVisible();
  await forks.getByRole('button', { name: 'Review archiving this outcome', exact: true }).click();
  await expect(forks.getByRole('region', { name: 'Review fork outcome archive', exact: true }).getByRole('checkbox')).not.toBeChecked();
});

test('canceled late preparation is discarded without exposing a usable review', async ({ page }) => {
  const { forks } = await open(page); await page.evaluate(() => { (window as any).__forkFixture.hold = 'prepare_hosted_fork'; });
  await forks.getByRole('button', { name: 'Review fork creation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__forkFixture.release)).toBe(true);
  await forks.getByRole('button', { name: 'Cancel fork request', exact: true }).click();
  await page.evaluate(() => { (window as any).__forkFixture.release(); });
  await expect.poll(async () => (await calls(page, 'discard_hosted_fork_review')).length).toBe(1);
  await expect(forks.getByRole('region', { name: 'Review fork creation', exact: true })).toHaveCount(0); expect(await calls(page, 'execute_hosted_fork')).toHaveLength(0);
});

test('confirmed submission after a cancel request still displays the saved provider outcome', async ({ page }) => {
  const { forks } = await reviewed(page); await page.evaluate(() => { (window as any).__forkFixture.hold = 'execute_hosted_fork'; });
  await forks.getByRole('button', { name: 'Submit reviewed fork request', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__forkFixture.release)).toBe(true);
  await forks.getByRole('button', { name: 'Cancel fork request', exact: true }).click(); await page.evaluate(() => { (window as any).__forkFixture.release(); });
  await expect(forks.getByRole('region', { name: 'Saved fork outcome', exact: true })).toContainText('Accepted; verification pending'); expect(await calls(page, 'execute_hosted_fork')).toHaveLength(1);
});

test('a mismatched inspection cannot hand an unverified fork to clone controls', async ({ page }) => {
  const { forks } = await open(page); await forks.getByRole('button', { name: 'Find existing forks', exact: true }).click();
  await page.evaluate(() => { (window as any).__forkFixture.mismatch = true; });
  await forks.getByRole('button', { name: 'Inspect owned-user/forked', exact: true }).click();
  await expect(forks.getByRole('alert')).toContainText('identity changed'); await expect(forks.getByRole('button', { name: 'Use this fork for cloning', exact: true })).toHaveCount(0);
});

for (const theme of ['chronos', 'midnight']) test(`${theme} fork review wraps in a compact keyboard-contained dialog`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await page.evaluate(theme => (window as any).ng.getComponent(document.querySelector('gc-root')).setAppTheme(theme), theme);
  const { dialog, forks } = await reviewed(page);
  await expect(forks.getByRole('region', { name: 'Review fork creation', exact: true })).toContainText('owned-user/owned');
  expect(await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth; })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`fork-review-${theme}.png`) });
  await dialog.locator('button:enabled, input:enabled, select:enabled').last().focus(); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close repository management', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});


test('rapid fork panel close and reopen retains a usable fresh review context', async ({ page }) => {
  const { dialog, forks } = await open(page);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Close fork controls')!;
    button.click(); button.click();
  });
  await expect(dialog.getByRole('button', { name: 'Close fork controls', exact: true })).toBeVisible();
  await forks.getByRole('button', { name: 'Review fork creation', exact: true }).click();
  await expect(forks.getByRole('region', { name: 'Review fork creation', exact: true })).toBeVisible();
});

test('rapid manual and hosted mode toggles restore a live catalogue context', async ({ page }) => {
  const { dialog } = await open(page, false);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Enter a repository URL instead')!;
    button.click(); button.click();
  });
  await dialog.getByRole('button', { name: 'Load repositories', exact: true }).click();
  await expect(dialog.locator('[data-hosted-account]')).toContainText('owned-user');
});

test('rapid repository tab transitions restore a live hosted context', async ({ page }) => {
  const { dialog } = await open(page, false);
  await page.evaluate(() => {
    (document.querySelector('#repository-tab-manager') as HTMLButtonElement).click();
    (document.querySelector('#repository-tab-clone') as HTMLButtonElement).click();
  });
  await dialog.getByRole('button', { name: 'Load repositories', exact: true }).click();
  await expect(dialog.locator('[data-hosted-account]')).toContainText('owned-user');
});
