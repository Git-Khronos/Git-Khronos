import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.getByRole('button', { name: /^Workspace: / }).click();
  await page.getByRole('menuitem', { name: 'Reviews and checks', exact: true }).click();
  return page.getByRole('dialog', { name: 'Workspace center', exact: true });
}
async function inspect(page: Page) {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Inspect #12', exact: true }).click();
  return dialog;
}
async function create(page: Page) {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Create pull request', exact: true }).click();
  const form = dialog.getByRole('region', { name: 'Hosted submission', exact: true });
  await form.getByRole('combobox', { name: 'Source remote', exact: true }).selectOption('fork');
  await form.getByLabel('Local source branch', { exact: true }).fill('feature/owned');
  await form.getByLabel('Destination branch', { exact: true }).fill('main');
  await form.getByLabel('Pull request title', { exact: true }).fill('Original $(literal) title');
  await form.getByLabel('Description', { exact: true }).fill('<script>Original text</script>\nSecond line');
  return { dialog, form };
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.repositories.update((items: any[]) => items.map(repo => ({ ...repo, remotes: [
      { name: 'origin', fetchUrl: 'https://github.com/team/repo.git', pushUrl: 'https://github.com/team/repo.git' },
      { name: 'fork', fetchUrl: 'git@github.com:person/fork.git', pushUrl: 'git@github.com:person/fork.git' },
    ] })));
    const fixture = { calls: [] as any[], plans: {} as Record<string, any>, actor: 'owned-author', head: 'a'.repeat(40),
      next: 1, applied: 0, uncertain: false, holdPrepare: false, holdSubmit: false, cancelAck: true,
      finishPrepare: null as (() => void) | null, finishSubmit: null as (() => void) | null };
    (window as any).__writes = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'load_hosting_page') return { repository: 'team/repo', page: 1, nextPage: null, mayHaveMore: false,
        entries: [{ number: '12', title: 'Owned request', state: 'open', author: 'another-author', url: 'https://github.com/team/repo/pull/12', branch: 'feature', commitOid: fixture.head, body: 'Original change' }] };
      if (command === 'load_hosted_review') return { headOid: fixture.head, headBranch: 'feature', baseBranch: 'main',
        query: { filesPage: 1, reviewsPage: 1, checksPage: 1, statusesPage: 1 },
        sections: { files: true, reviews: true, checks: true, statuses: true }, warnings: [], files: [], reviews: [], currentReviews: [], checks: [],
        legacyState: 'pending', legacyStatuses: [], filesMayHaveMore: false, reviewsMayHaveMore: false, checksMayHaveMore: false, statusesMayHaveMore: false };
      if (command === 'prepare_hosted_write') {
        if (args.request.expectedHeadOid && args.request.expectedHeadOid !== fixture.head) throw { kind: 'hostingWriteRefused', message: 'The pull request changed. Reload hosted records.', hint: null };
        const preview = { token: `owned-${fixture.next++}`, plan: { repository: 'team/repo', actor: fixture.actor, actorId: '501',
          sourceRepository: args.request.kind === 'createPull' ? 'person/fork' : null, headOid: fixture.head, baseOid: 'b'.repeat(40),
          baseBranch: args.request.baseBranch ?? 'main', request: structuredClone(args.request) } };
        fixture.plans[preview.token] = structuredClone(preview);
        if (fixture.holdPrepare) return new Promise(resolve => fixture.finishPrepare = () => resolve(preview));
        return preview;
      }
      if (command === 'discard_hosted_write_plan') { const present = !!fixture.plans[args.token]; delete fixture.plans[args.token]; return present; }
      if (command === 'execute_hosted_write') {
        const preview = fixture.plans[args.token]; delete fixture.plans[args.token];
        if (!preview) throw { kind: 'staleHostedWritePlan', message: 'That preview was already used.', hint: null };
        if (preview.plan.actor !== fixture.actor || preview.plan.headOid !== fixture.head) throw { kind: 'hostingWriteRefused', message: 'The account or head changed. Reload hosted records.', hint: null };
        fixture.applied++;
        const result = { repository: 'team/repo', number: 12, url: 'https://github.com/team/repo/pull/12', actor: fixture.actor,
          commitOid: preview.plan.request.kind === 'merge' ? 'c'.repeat(40) : fixture.head, notice: null };
        const error = { kind: 'hostingWriteUncertain', message: 'The write could not be confirmed. It may already have been applied.', hint: 'Inspect the provider before preparing another submission.' };
        if (fixture.holdSubmit) return new Promise((resolve, reject) => fixture.finishSubmit = () => fixture.uncertain ? reject(error) : resolve(result));
        if (fixture.uncertain) throw error;
        return result;
      }
      if (command === 'cancel_git_operation') return fixture.cancelAck;
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return git.repository();
      if (command === 'refresh_repository_status') return git.repository().status;
      return null;
    } };
  });
});

test('fork draft creation previews the account and exact text before a single immutable submission', async ({ page }) => {
  const { form } = await create(page);
  expect(await page.evaluate(() => (window as any).__writes.calls.filter((call: any) => call.command.includes('hosted_write')))).toHaveLength(0);
  await form.getByLabel('Pull request title', { exact: true }).press('Enter');
  await expect(form.locator('[data-write-preview]')).toBeFocused();
  await expect(form).toContainText('owned-author');
  await expect(form).toContainText('person/fork');
  await expect(form).toContainText('feature/owned');
  await expect(form).toContainText('a'.repeat(40));
  await expect(form).toContainText('<script>Original text</script>');
  expect(await page.evaluate(() => (window as any).__writes.applied)).toBe(0);
  const request = await page.evaluate(() => (window as any).__writes.calls.find((call: any) => call.command === 'prepare_hosted_write').args.request);
  expect(request).toEqual({ kind: 'createPull', headRemote: 'fork', headBranch: 'feature/owned', baseBranch: 'main', title: 'Original $(literal) title', body: '<script>Original text</script>\nSecond line', draft: true });
  await form.getByRole('button', { name: 'Create draft pull request', exact: true }).click({ clickCount: 2 });
  await expect(form.locator('[data-write-receipt]')).toBeFocused();
  await expect(form).toContainText('Provider confirmed');
  expect(await page.evaluate(() => (window as any).__writes.applied)).toBe(1);
  const execution = await page.evaluate(() => (window as any).__writes.calls.find((call: any) => call.command === 'execute_hosted_write').args);
  expect(Object.keys(execution).sort()).toEqual(['operationId', 'repoId', 'token']);
  expect(execution.token).toBe('owned-1');
});

for (const [event, label] of [['approve', 'Submit approval'], ['requestChanges', 'Submit change request'], ['comment', 'Submit review comment']] as const) {
  test(`submits an explicit ${event} review for the captured commit`, async ({ page }) => {
    const dialog = await inspect(page);
    await dialog.getByRole('button', { name: 'Review pull request', exact: true }).click();
    const form = dialog.getByRole('region', { name: 'Hosted submission', exact: true });
    await form.getByRole('combobox', { name: 'Review action', exact: true }).selectOption(event);
    if (event !== 'approve') await form.getByLabel('Review text', { exact: true }).fill('Original review text');
    await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
    const request = await page.evaluate(() => (window as any).__writes.calls.find((call: any) => call.command === 'prepare_hosted_write').args.request);
    expect(request).toMatchObject({ kind: 'review', event, number: 12, expectedHeadOid: 'a'.repeat(40) });
    await form.getByRole('button', { name: `${label} for #12`, exact: true }).click();
    await expect(form).toContainText('Provider confirmed');
    await expect(dialog.getByRole('region', { name: 'Pull request inspection', exact: true })).toHaveCount(0);
  });
}
for (const [method, label] of [['merge', 'Merge pull request'], ['squash', 'Squash and merge'], ['rebase', 'Rebase and merge']] as const) {
  test(`prepares ${method} with head preconditions and retains only applicable merge text`, async ({ page }) => {
    const dialog = await inspect(page);
    await dialog.getByRole('button', { name: 'Merge pull request', exact: true }).click();
    const form = dialog.getByRole('region', { name: 'Hosted submission', exact: true });
    await form.getByLabel('Optional commit title', { exact: true }).fill('Owned merge title');
    await form.getByLabel('Description', { exact: true }).fill('Owned merge body');
    await form.getByRole('combobox', { name: 'Merge method', exact: true }).selectOption(method);
    await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
    const request = await page.evaluate(() => (window as any).__writes.calls.find((call: any) => call.command === 'prepare_hosted_write').args.request);
    expect(request).toEqual({ kind: 'merge', method, number: 12, expectedHeadOid: 'a'.repeat(40), title: method === 'rebase' ? '' : 'Owned merge title', body: method === 'rebase' ? '' : 'Owned merge body' });
    if (method === 'rebase') await expect(form).not.toContainText('Owned merge body');
    await form.getByRole('button', { name: `${label} #12`, exact: true }).click();
    await expect(form).toContainText('c'.repeat(40));
  });
}

test('editing discards the earlier token and requires a newly reviewed preview', async ({ page }) => {
  const { form } = await create(page);
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await form.getByRole('button', { name: 'Edit request', exact: true }).click();
  await form.getByLabel('Pull request title', { exact: true }).fill('Revised original title');
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await expect(form).toContainText('Revised original title');
  await form.getByRole('button', { name: 'Create draft pull request', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__writes.calls);
  expect(calls.find((call: any) => call.command === 'discard_hosted_write_plan').args.token).toBe('owned-1');
  expect(calls.find((call: any) => call.command === 'execute_hosted_write').args.token).toBe('owned-2');
});

test('a changed account refuses the old preview and preserves editable text', async ({ page }) => {
  const { form } = await create(page);
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await page.evaluate(() => (window as any).__writes.actor = 'changed-account');
  await form.getByRole('button', { name: 'Create draft pull request', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('account or head changed');
  await expect(form.getByLabel('Pull request title', { exact: true })).toHaveValue('Original $(literal) title');
  expect(await page.evaluate(() => (window as any).__writes.applied)).toBe(0);
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await expect(form).toContainText('changed-account');
});

test('an applied write with a lost reply remains unconfirmed and cannot replay its token', async ({ page }) => {
  const { dialog, form } = await create(page);
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await page.evaluate(() => (window as any).__writes.uncertain = true);
  await form.getByRole('button', { name: 'Create draft pull request', exact: true }).click();
  await expect(form).toContainText('may already have been applied');
  await expect(form.getByRole('button', { name: 'Create draft pull request', exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Prepare submission preview', exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Inspect result on GitHub', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__writes.applied)).toBe(1);
  await expect(dialog).not.toContainText('Provider confirmed the submission');
});

test('cancelled preparation discards a late preview without submitting it', async ({ page }) => {
  const { form } = await create(page);
  await page.evaluate(() => (window as any).__writes.holdPrepare = true);
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await form.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
  await page.evaluate(() => (window as any).__writes.finishPrepare());
  await expect(form.getByRole('alert')).toContainText('cancelled');
  await expect(form.locator('[data-write-preview]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__writes.applied)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).__writes.calls.filter((call: any) => call.command === 'discard_hosted_write_plan').length)).toBe(1);
});

test('stopping a submitted write preserves an unknown outcome when its reply is lost', async ({ page }) => {
  const { form } = await create(page);
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await page.evaluate(() => Object.assign((window as any).__writes, { holdSubmit: true, uncertain: true, cancelAck: false }));
  await form.getByRole('button', { name: 'Create draft pull request', exact: true }).click();
  await form.getByRole('button', { name: 'Stop waiting for submission', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('not yet acknowledged');
  await page.evaluate(() => (window as any).__writes.finishSubmit());
  await expect(form).toContainText('may already have been applied');
  await expect(form).not.toContainText('Provider confirmed');
  expect(await page.evaluate(() => (window as any).__writes.applied)).toBe(1);
});

test('closing while a write completes preserves its definite confirmation in activity history', async ({ page }) => {
  const { dialog, form } = await create(page);
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await page.evaluate(() => (window as any).__writes.holdSubmit = true);
  await form.getByRole('button', { name: 'Create draft pull request', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => (window as any).__writes.finishSubmit());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activityLogs().some((entry: any) => entry.status === 'success' && entry.description.includes('GitHub submission confirmed')))).toBe(true);
  expect(await page.evaluate(() => (window as any).__writes.applied)).toBe(1);
});

test('compact submission fields and the reviewed action remain keyboard accessible without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 780 });
  const { form } = await create(page);
  await form.getByRole('button', { name: 'Prepare submission preview', exact: true }).click();
  await expect(form.locator('[data-write-preview]')).toBeFocused();
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await form.getByRole('button', { name: 'Create draft pull request', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(form).toContainText('Provider confirmed');
});
