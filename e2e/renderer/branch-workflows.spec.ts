import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.getByRole('button', { name: /^Workspace: / }).click();
  await page.getByRole('menuitem', { name: 'Branch workflows', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Branch workflows', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reload workflow state', exact: true })).toBeEnabled();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.branch-item').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root')); const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const base = git.repository();
    const settings = { version: 1, production: 'main', development: 'develop', featurePrefix: 'feature/', releasePrefix: 'release/', hotfixPrefix: 'hotfix/', tagPrefix: 'v' };
    const topics = ['feature/owned', 'release/1.0', 'hotfix/1.1'].map((branch, i) => ({ branch, kind: branch.split('/')[0], suffix: branch.split('/')[1], oid: String(i + 3).repeat(40), worktree: null }));
    const branches = [{ name: 'main', oid: '1'.repeat(40) }, { name: 'develop', oid: '2'.repeat(40) }, ...topics].map(b => ({ ...b, name: (b as any).name ?? (b as any).branch, fullName: 'refs/heads/' + ((b as any).name ?? (b as any).branch), remote: false, current: (b as any).name === 'main', upstream: (b as any).branch === 'feature/owned' ? 'origin/feature/owned' : null, tracking: null }));
    const repo = { ...base, path: '/owned/workflows', bare: false, headOid: '1'.repeat(40), branches, status: { ...base.status, branch: 'main', staged: 0, unstaged: 0, untracked: 0, conflicted: 0, mergeInProgress: false, rebaseInProgress: false, historyOperation: null } };
    git.repositories.update((items: any[]) => items.map(r => r.id === repo.id ? repo : r)); app.commitMessage.set('Retained workflow draft');
    const fixture = { repo, settings, topics, calls: [] as any[], plans: {} as Record<string, any>, next: 0, hold: '', finish: null as (() => void) | null, fail: '', phase: 'complete',
      view: { state: { settings, productionOid: '1'.repeat(40), developmentOid: '2'.repeat(40), topics, finishPending: false }, finish: null as any } };
    (window as any).__workflow = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args: structuredClone(args) });
      if (command === fixture.fail) throw { kind: 'branchWorkflowRefused', message: 'Owned workflow refusal', hint: 'Repository preserved.' };
      let result: any;
      if (command === 'load_branch_workflow') result = structuredClone(fixture.view);
      else if (command === 'prepare_branch_workflow') {
        const request = args.request; let plan: any;
        if (request.action === 'setup') plan = { ...request, previous: fixture.view.state.settings, branches: [{ branch: request.settings.production, expectedOid: fixture.repo.headOid, createAt: null }, { branch: request.settings.development, expectedOid: null, createAt: request.initialOid }] };
        else if (request.action === 'start') {
          const key = request.kind + 'Prefix'; const baseBranch = request.kind === 'hotfix' ? fixture.settings.production : fixture.settings.development;
          plan = { settings: fixture.settings, ...request, branch: (fixture.settings as any)[key] + request.suffix, baseBranch, baseOid: fixture.repo.branches.find(b => b.name === baseBranch)!.oid, previousHeadOid: fixture.repo.headOid, previousHeadReference: 'refs/heads/main' };
        } else {
          const topic = fixture.topics.find(t => t.branch === request.branch)!;
          plan = { settings: fixture.settings, kind: topic.kind, branch: topic.branch, sourceOid: topic.oid, targets: (topic.kind === 'feature' ? ['develop'] : ['main', 'develop']).map(branch => ({ branch, oid: fixture.repo.branches.find(b => b.name === branch)!.oid, message: request.options.mergeMessage ?? `Integrate ${topic.branch} into ${branch}` })),
            tag: request.options.tag ? { name: fixture.settings.tagPrefix + topic.suffix, message: request.options.tag.message, sign: request.options.tag.sign ?? false } : null, deleteTopic: request.options.deleteTopic, mergePolicy: request.options.mergePolicy, previousHead: { oid: fixture.repo.headOid, reference: 'refs/heads/main' }, executionConfiguration: 'a'.repeat(40) };
        }
        const token = `owned-preview-${++fixture.next}`; result = { token, plan: { action: request.action, plan } }; fixture.plans[token] = structuredClone(result.plan);
      } else if (command === 'discard_branch_workflow_plan') { delete fixture.plans[args.token]; result = true; }
      else if (command === 'execute_branch_workflow') {
        const selected = fixture.plans[args.token]; if (!selected) throw { message: 'Preview already consumed' }; delete fixture.plans[args.token];
        const plan = selected.plan;
        if (selected.action === 'setup') { fixture.view.state.settings = plan.settings; fixture.view.state.developmentOid = plan.initialOid; result = null; }
        else if (selected.action === 'start') { fixture.view.state.topics = [...fixture.view.state.topics, { branch: plan.branch, kind: plan.kind, suffix: plan.suffix, oid: plan.baseOid, worktree: fixture.repo.path }]; result = null; }
        else {
          result = { version: 1, id: 'a'.repeat(32), revision: 0, ownerWorktree: fixture.repo.path, plan, phase: fixture.phase, completedTargets: fixture.phase === 'conflicted' ? [plan.targets[0].oid] : plan.targets.map((t: any) => t.oid), tagOid: plan.tag && fixture.phase === 'complete' ? 'c'.repeat(40) : null,
            recovery: plan.targets.map((t: any, i: number) => ({ id: 'owned-' + i, label: 'Original ' + t.branch, headOid: t.oid, headReference: 'refs/git-khronos/recovery/owned-' + i, snapshotOid: null, snapshotReference: null, restored: false })), checkoutBefore: null, retryRequired: fixture.phase === 'tagging', notice: fixture.phase === 'conflicted' ? 'Resolve and stage this target merge.' : fixture.phase === 'tagging' ? 'Signing failed; integrations are retained.' : null };
          fixture.view.finish = result; fixture.view.state.finishPending = true;
        }
      } else if (command === 'control_branch_workflow_finish') {
        if (args.id !== fixture.view.finish.id || args.revision !== fixture.view.finish.revision) throw { message: 'Stale saved workflow revision' };
        if (args.control.action === 'acknowledge') { fixture.view.finish = null; fixture.view.state.finishPending = false; result = null; }
        else { fixture.view.finish = { ...fixture.view.finish, revision: fixture.view.finish.revision + 1, phase: args.control.action === 'abort' ? 'aborted' : 'complete', notice: 'Previously completed integrations are retained.' }; result = fixture.view.finish; }
      } else if (command === 'cancel_git_operation') result = true;
      else if (command === 'refresh_repository' || command === 'refresh_repository_metadata') result = fixture.repo;
      else if (command === 'refresh_repository_status') result = fixture.repo.status;
      else throw Error(`Unexpected ${command}`);
      if (fixture.hold === command) return new Promise(resolve => { fixture.finish = () => resolve(result); });
      return structuredClone(result);
    } };
  });
});

test('configuration is reviewed before application and retains the commit draft', async ({ page }) => {
  await page.evaluate(() => { (window as any).__workflow.view.state.settings = null; });
  const dialog = await open(page);
  await expect(dialog.getByLabel('Production branch', { exact: true })).toHaveValue('main');
  await dialog.getByLabel('Development branch', { exact: true }).fill('integration');
  await dialog.getByRole('button', { name: 'Review configuration', exact: true }).click();
  await expect(dialog.getByLabel('Review branch workflow')).toContainText('integration — Create branch');
  expect(await page.evaluate(() => (window as any).__workflow.calls.filter((c: any) => c.command === 'execute_branch_workflow'))).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Apply reviewed workflow', exact: true }).click();
  await expect(dialog).toContainText('Workflow configuration saved');
  const execute = await page.evaluate(() => (window as any).__workflow.calls.find((c: any) => c.command === 'execute_branch_workflow'));
  expect(Object.keys(execute.args).sort()).toEqual(['operationId', 'repoId', 'token']);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Retained workflow draft');
});

for (const kind of ['feature', 'release', 'hotfix'] as const) test(`${kind} creation reviews its base and uses a one-use preview`, async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('combobox', { name: 'Topic type', exact: true }).selectOption(kind);
  await dialog.getByLabel('Topic name', { exact: true }).fill('new-owned');
  await dialog.getByRole('button', { name: 'Review topic creation', exact: true }).click();
  const review = dialog.getByLabel('Review branch workflow');
  await expect(review).toContainText(`Create and check out ${kind}/new-owned from ${kind === 'hotfix' ? 'main' : 'develop'}`);
  await dialog.getByRole('button', { name: 'Apply reviewed workflow', exact: true }).click();
  await expect(dialog.getByRole('button', { name: `Finish ${kind}/new-owned`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__workflow.calls.filter((c: any) => c.command === 'execute_branch_workflow'))).toHaveLength(1);
});

test('editing a form or moving a ref invalidates its native preview', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByLabel('Topic name', { exact: true }).fill('owned-new');
  await dialog.getByRole('button', { name: 'Review topic creation', exact: true }).click();
  await expect(dialog.getByLabel('Review branch workflow')).toBeVisible();
  await dialog.getByLabel('Topic name', { exact: true }).fill('changed');
  await expect(dialog.getByLabel('Review branch workflow')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Review topic creation', exact: true }).click();
  await page.evaluate(() => { const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git; git.repositories.update((items: any[]) => items.map(r => ({ ...r, branches: r.branches.map((b: any) => b.name === 'develop' ? { ...b, oid: 'f'.repeat(40) } : b) }))); });
  await expect(dialog).toContainText('Repository references changed');
  await expect(dialog.getByLabel('Review branch workflow')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__workflow.calls.filter((c: any) => c.command === 'discard_branch_workflow_plan'))).toHaveLength(2);
});

async function finishRelease(page: Page, phase = 'complete') {
  await page.evaluate(phase => { (window as any).__workflow.phase = phase; }, phase);
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Finish release/1.0', exact: true }).click();
  await dialog.getByLabel('Tag annotation', { exact: true }).fill('Owned release\nSecond line');
  await dialog.getByRole('combobox', { name: 'Tag signing', exact: true }).selectOption('signed');
  await dialog.getByLabel('Merge message (optional)', { exact: true }).fill('Owned integration');
  await dialog.getByRole('checkbox', { name: 'Delete the local topic after every required stage succeeds', exact: true }).check();
  await dialog.getByRole('button', { name: 'Review finish', exact: true }).click();
  return dialog;
}

test('release review shows ordered targets, signing choice and explicit cleanup before applying', async ({ page }) => {
  const dialog = await finishRelease(page);
  const review = dialog.getByLabel('Review branch workflow');
  await expect(review).toContainText('v1.0'); await expect(review).toContainText('Signing requested');
  await expect(review).toContainText('Second line'); await expect(review.locator('ol > li')).toHaveText([/main/, /develop/]);
  await dialog.getByRole('button', { name: 'Apply reviewed workflow', exact: true }).click();
  await expect(dialog).toContainText('Workflow complete');
  await expect(dialog.getByRole('list', { name: 'Workflow stages' })).toContainText('Created');
  const request = await page.evaluate(() => (window as any).__workflow.calls.find((c: any) => c.command === 'prepare_branch_workflow').args.request);
  expect(request.options).toEqual({ mergePolicy: 'mergeCommit', mergeMessage: 'Owned integration', deleteTopic: true, tag: { message: 'Owned release\nSecond line', sign: true } });
});

test('feature selection clears hidden release tag choices and forces deferred topic cleanup', async ({ page }) => {
  const dialog = await finishRelease(page);
  await dialog.getByRole('button', { name: 'Finish feature/owned', exact: true }).click();
  await expect(dialog.getByLabel('Tag annotation', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'Delete the local topic after every required stage succeeds', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Delete the local topic after every required stage succeeds', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Review finish', exact: true }).click();
  const request = await page.evaluate(() => (window as any).__workflow.calls.filter((c: any) => c.command === 'prepare_branch_workflow').at(-1).args.request);
  expect(request.options.tag).toBeNull(); expect(request.options.deleteTopic).toBe(true);
});

test('second-target conflict retains the first integration and requires a reviewed stop', async ({ page }) => {
  const dialog = await finishRelease(page, 'conflicted');
  await dialog.getByRole('button', { name: 'Apply reviewed workflow', exact: true }).click();
  await expect(dialog).toContainText('Workflow paused for conflicts');
  const stages = dialog.getByRole('list', { name: 'Workflow stages' });
  await expect(stages).toContainText('main — Integrated'); await expect(stages).toContainText('develop — Merge needs resolution');
  await dialog.getByRole('button', { name: 'Review stop', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__workflow.calls.filter((c: any) => c.command === 'control_branch_workflow_finish'))).toHaveLength(0);
  await expect(dialog.getByLabel('Review workflow control')).toContainText('Completed integrations and tags remain applied');
  await dialog.getByRole('button', { name: 'Stop workflow', exact: true }).click();
  await expect(dialog).toContainText('Workflow stopped');
  const control = await page.evaluate(() => (window as any).__workflow.calls.find((c: any) => c.command === 'control_branch_workflow_finish').args);
  expect(control).toMatchObject({ id: 'a'.repeat(32), revision: 0, control: { action: 'abort' } });
  await expect(stages).toContainText('main — Integrated');
});

test('unconfirmed signing exposes explicit retry and completed outcomes need acknowledgement', async ({ page }) => {
  const dialog = await finishRelease(page, 'tagging');
  await dialog.getByRole('button', { name: 'Apply reviewed workflow', exact: true }).click();
  await expect(dialog).toContainText('Signing failed; integrations are retained');
  await expect(dialog.getByRole('button', { name: 'Retry unconfirmed stage', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Review explicit retry', exact: true }).click();
  await dialog.getByRole('button', { name: 'Retry unconfirmed stage', exact: true }).click();
  await expect(dialog).toContainText('Workflow complete');
  await dialog.getByRole('button', { name: 'Review acknowledgement', exact: true }).click();
  await dialog.getByRole('button', { name: 'Acknowledge outcome', exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'Local workflow topics' })).toBeVisible();
  const controls = await page.evaluate(() => (window as any).__workflow.calls.filter((c: any) => c.command === 'control_branch_workflow_finish').map((c: any) => c.args));
  expect(controls[0]).toMatchObject({ revision: 0, control: { action: 'continue', retry: true } });
  expect(controls[1]).toMatchObject({ revision: 1, control: { action: 'acknowledge' } });
});

test('canceled preparation discards a late successful preview without applying it', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => { (window as any).__workflow.hold = 'prepare_branch_workflow'; });
  await dialog.getByLabel('Topic name', { exact: true }).fill('cancel-owned');
  await dialog.getByRole('button', { name: 'Review topic creation', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).__workflow; f.hold = ''; f.finish(); });
  await expect(dialog.getByRole('button', { name: 'Reload workflow state', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('Review branch workflow')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__workflow.calls);
  expect(calls.some((c: any) => c.command === 'discard_branch_workflow_plan')).toBe(true);
  expect(calls.some((c: any) => c.command === 'execute_branch_workflow')).toBe(false);
  expect(calls.some((c: any) => c.command === 'refresh_repository')).toBe(false);
});

test('repository switch closes the workflow and prevents late previews from crossing repositories', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => { (window as any).__workflow.hold = 'prepare_branch_workflow'; });
  await dialog.getByLabel('Topic name', { exact: true }).fill('switch-owned');
  await dialog.getByRole('button', { name: 'Review topic creation', exact: true }).click();
  await page.evaluate(() => { const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git; const other = { ...git.repository(), id: 'other-workflow', path: '/owned/other-workflow' }; git.repositories.update((items: any[]) => [...items, other]); git.activeRepositoryId.set(other.id); });
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { (window as any).__workflow.finish(); });
  await expect.poll(() => page.evaluate(() => (window as any).__workflow.calls.some((c: any) => c.command === 'discard_branch_workflow_plan'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__workflow.calls.some((c: any) => c.command === 'execute_branch_workflow'))).toBe(false);
});

for (const theme of ['khronos', 'midnight']) test(`${theme} compact dialog contains keyboard focus and fits the viewport`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await page.evaluate(theme => { const app = (window as any).ng.getComponent(document.querySelector('gc-root')); app.setAppTheme(theme); }, theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const dialog = await open(page);
  const close = dialog.getByRole('button', { name: 'Close', exact: true }); await close.focus(); await close.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Reload workflow state', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  const fits = await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && element.scrollWidth <= element.clientWidth; });
  expect(fits).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('branch-workflow-' + theme + '.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Workspace: / })).toBeFocused();
});


test('controls remain unavailable while an applied workflow refreshes its repository', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByLabel('Topic name', { exact: true }).fill('refresh-owned');
  await dialog.getByRole('button', { name: 'Review topic creation', exact: true }).click();
  await page.evaluate(() => { (window as any).__workflow.hold = 'refresh_repository'; });
  await dialog.getByRole('button', { name: 'Apply reviewed workflow', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workflow.calls.some((c: any) => c.command === 'refresh_repository'))).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Topics', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Topic name', { exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Reload workflow state', exact: true })).toBeDisabled();
  await page.evaluate(() => { const f = (window as any).__workflow; f.hold = ''; f.finish(); });
  await expect(dialog.getByRole('button', { name: 'Finish feature/refresh-owned', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reload workflow state', exact: true })).toBeEnabled();
});

test('an already-running graph refresh is reported as pending while fresh workflow state remains available', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => { const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git; git.refreshRepositoryInBackground = async () => false; });
  await dialog.getByLabel('Topic name', { exact: true }).fill('pending-refresh');
  await dialog.getByRole('button', { name: 'Review topic creation', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply reviewed workflow', exact: true }).click();
  await expect(dialog).toContainText('Repository graph refresh is pending');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Finish feature/pending-refresh', exact: true })).toBeVisible();
});
