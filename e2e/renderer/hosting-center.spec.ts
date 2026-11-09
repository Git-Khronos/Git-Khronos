import { expect, test, type Page } from '@playwright/test';
async function open(page: Page) {
  await page.getByRole('button', { name: /^Workspace: / }).click();
  await page.getByRole('menuitem', { name: 'Reviews and checks', exact: true }).click();
  return page.getByRole('dialog', { name: 'Workspace center', exact: true });
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.repositories.update((items: any[]) => items.map(repo => ({ ...repo, remotes: [{ name: 'origin', fetchUrl: 'git@github.com:team/repo.git', pushUrl: 'git@github.com:fork/repo.git' }] })));
    const fixture = { calls: [] as any[], hold: false, fail: false, partial: false, emptyIssuesFirst: false, finish: null as (() => void) | null };
    (window as any).__hosting = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'load_hosting_page') {
        if (fixture.fail) throw { kind: 'hostingUnavailable', message: 'GitHub data could not be loaded.', hint: 'Check gh authentication.' };
        const index = args.query?.page ?? 1;
        const page = { repository: 'team/repo', page: index, nextPage: index < 3 ? index + 1 : null, mayHaveMore: index < 3, entries: fixture.emptyIssuesFirst && args.section === 'issues' && index === 1 ? [] : [{ number: String(11 + index), title: '<script>literal title</script>', state: `${args.query?.state ?? 'open'} · draft`, author: 'reviewer', url: `https://github.com/team/repo/pull/${11 + index}`, branch: 'feature', commitOid: 'a'.repeat(40), body: 'Original pull description' }] };
        if (fixture.hold) return new Promise(resolve => fixture.finish = () => resolve(page));
        return page;
      }
      if (command === 'load_hosted_review') {
        const query = args.query ?? { filesPage: 1, reviewsPage: 1, checksPage: 1, statusesPage: 1 };
        return { headOid: args.expectedHeadOid, baseBranch: 'main', headBranch: 'feature', query,
          sections: { files: true, reviews: true, checks: !fixture.partial, statuses: !fixture.partial },
          warnings: fixture.partial ? ['Check runs could not be loaded.', 'Commit status contexts could not be loaded.'] : [],
          files: [{ path: query.filesPage === 1 ? 'file.ts' : 'file-page-2.ts', state: 'modified', additions: 1, deletions: 2, patch: null }],
          reviews: [{ name: 'reviewer', state: 'CHANGES_REQUESTED', body: 'Test the edge case' }],
          currentReviews: [{ name: 'reviewer', state: 'APPROVED', commitOid: 'b'.repeat(40), submittedAt: '2026-10-31T00:00:00Z' }],
          checks: fixture.partial ? [] : [{ name: 'unit', state: 'completed · failure', body: '' }],
          legacyStatuses: fixture.partial ? [] : [{ name: 'external-ci', state: 'failure', body: 'Owned failed status' }], legacyState: fixture.partial ? null : 'failure',
          filesMayHaveMore: query.filesPage < 2, reviewsMayHaveMore: query.reviewsPage < 2, checksMayHaveMore: query.checksPage < 2, statusesMayHaveMore: query.statusesPage < 2 };
      }
      if (command === 'cancel_git_operation') return true;
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return git.repository();
      if (command === 'refresh_repository_status') return git.repository().status;
      return null;
    } };
  });
});

test('only explicit loads contact GitHub and inspections bind to the captured PR head', async ({ page }) => {
  const dialog = await open(page);
  expect(await page.evaluate(() => (window as any).__hosting.calls.filter((call: any) => call.command.startsWith('load_host')))).toHaveLength(0);
  await expect(dialog).toContainText('current account');
  await expect(dialog.getByLabel('GitHub remote', { exact: true })).toHaveValue('origin');
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await expect(dialog).toContainText('<script>literal title</script>');
  await expect(dialog).toContainText('More records may exist');
  await dialog.getByRole('button', { name: 'Inspect #12', exact: true }).click();
  const inspection = dialog.getByRole('region', { name: 'Pull request inspection', exact: true });
  await expect(inspection).toContainText('CHANGES_REQUESTED');
  await expect(inspection).toContainText('completed · failure');
  await expect(inspection).toContainText('a'.repeat(40));
  await inspection.getByText('file.ts · modified', { exact: false }).click();
  await expect(inspection).toContainText('No textual patch supplied');
  await expect(inspection).toContainText('More files may exist');
  const call = await page.evaluate(() => (window as any).__hosting.calls.find((call: any) => call.command === 'load_hosted_review'));
  expect(call.args).toMatchObject({ remote: 'origin', pullNumber: 12, expectedHeadOid: 'a'.repeat(40) });
  await dialog.getByLabel('Hosted section', { exact: true }).selectOption('workflows');
  await expect(inspection).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Inspect #12', exact: true })).toHaveCount(0);
});

test('reports provider failures without substituting empty success', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => (window as any).__hosting.fail = true);
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('GitHub data could not be loaded');
  await expect(dialog).not.toContainText('records loaded');
});

test('cancellation and closing reject late successful hosted responses', async ({ page }) => {
  let dialog = await open(page);
  await page.evaluate(() => (window as any).__hosting.hold = true);
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel hosted request', exact: true }).click();
  await page.evaluate(() => (window as any).__hosting.finish());
  await expect(dialog.getByRole('alert')).toContainText('cancelled');
  await expect(dialog).not.toContainText('records loaded');
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => (window as any).__hosting.finish());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  dialog = await open(page);
  await expect(dialog).not.toContainText('records loaded');
});

test('a changed fetch destination immediately hides earlier hosted state', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await expect(dialog).toContainText('records loaded');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => items.map(repo => ({ ...repo, remotes: [{ ...repo.remotes[0], fetchUrl: 'https://github.com/other/project.git' }] })));
  });
  await expect(dialog).not.toContainText('records loaded');
});

test('pages lists and scopes open, closed and all queries without loading on selection changes', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await expect(dialog.getByRole('navigation', { name: 'hosted records pages', exact: true })).toContainText('Page 1');
  await expect(dialog.getByRole('button', { name: 'Previous hosted records page', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Next hosted records page', exact: true }).click();
  await expect(dialog.getByRole('navigation', { name: 'hosted records pages', exact: true })).toContainText('Page 2');
  await expect(dialog.getByRole('button', { name: 'Inspect #13', exact: true })).toBeVisible();
  await expect(dialog.locator('[data-hosted-page-status]')).toBeFocused();
  await dialog.getByRole('button', { name: 'Previous hosted records page', exact: true }).click();
  await expect(dialog.getByRole('navigation', { name: 'hosted records pages', exact: true })).toContainText('Page 1');
  await dialog.getByLabel('Record state', { exact: true }).selectOption('closed');
  await expect(dialog).not.toContainText('records loaded');
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await expect(dialog).toContainText('closed · draft');
  const calls = await page.evaluate(() => (window as any).__hosting.calls.filter((call: any) => call.command === 'load_hosting_page'));
  expect(calls.map((call: any) => call.args.query)).toEqual([{ page: 1, state: 'open' }, { page: 2, state: 'open' }, { page: 1, state: 'open' }, { page: 1, state: 'closed' }]);
  await dialog.getByLabel('Record state', { exact: true }).selectOption('all');
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await expect(dialog).toContainText('all · draft');
});

test('an empty issues page still permits advancing past pull-request records', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => (window as any).__hosting.emptyIssuesFirst = true);
  await dialog.getByLabel('Hosted section', { exact: true }).selectOption('issues');
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await expect(dialog).toContainText('No records on this API page');
  await dialog.getByRole('button', { name: 'Next hosted records page', exact: true }).click();
  await expect(dialog).toContainText('1 records loaded');
  await expect(dialog.getByRole('navigation', { name: 'hosted records pages', exact: true })).toContainText('Page 2');
});

test('binds detail pages to the captured head and distinguishes historical decisions and legacy failures', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Inspect #12', exact: true }).click();
  const inspection = dialog.getByRole('region', { name: 'Pull request inspection', exact: true });
  await expect(inspection.getByRole('list', { name: 'Latest submitted review decisions', exact: true })).toContainText('APPROVED');
  await expect(inspection).toContainText('Review on another commit');
  await expect(inspection).toContainText('Provider combined commit-status state: failure');
  await expect(inspection).toContainText('external-ci · failure');
  for (const [name, field] of [['changed files', 'filesPage'], ['review history', 'reviewsPage'], ['check runs', 'checksPage'], ['status contexts', 'statusesPage']] as const) {
    await inspection.getByRole('button', { name: `Next ${name} page`, exact: true }).click();
    await expect(inspection.getByRole('navigation', { name: `${name} pages`, exact: true })).toContainText('Page 2');
    const call = await page.evaluate(() => (window as any).__hosting.calls.filter((call: any) => call.command === 'load_hosted_review').at(-1));
    await expect(inspection.getByRole('button', { name: `Next ${name} page`, exact: true })).toBeDisabled();
    expect(call.args.query[field]).toBe(2);
    expect(call.args.expectedHeadOid).toBe('a'.repeat(40));
  }
  await expect(inspection).toContainText('file-page-2.ts');
});

test('unavailable checks remain explicit while accessible files and review history stay usable', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => (window as any).__hosting.partial = true);
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Inspect #12', exact: true }).click();
  const inspection = dialog.getByRole('region', { name: 'Pull request inspection', exact: true });
  await expect(inspection.getByRole('alert').first()).toContainText('could not be loaded');
  await expect(inspection).toContainText('file.ts');
  await expect(inspection).toContainText('CHANGES_REQUESTED');
  await expect(inspection).not.toContainText('No check runs returned');
  await expect(inspection).not.toContainText('Provider combined commit-status state');
});

test('cancelling a subsequent list page discards its late reply and never restores the old page as fresh', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Load from GitHub', exact: true }).click();
  await page.evaluate(() => (window as any).__hosting.hold = true);
  await dialog.getByRole('button', { name: 'Next hosted records page', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel hosted request', exact: true }).click();
  await page.evaluate(() => (window as any).__hosting.finish());
  await expect(dialog.getByRole('alert')).toContainText('cancelled');
  await expect(dialog).not.toContainText('records loaded');
  await expect(dialog.getByRole('button', { name: 'Inspect #13', exact: true })).toHaveCount(0);
});
