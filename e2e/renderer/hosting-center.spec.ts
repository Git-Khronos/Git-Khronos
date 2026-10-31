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
    const fixture = { calls: [] as any[], hold: false, fail: false, finish: null as (() => void) | null };
    (window as any).__hosting = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'load_hosting_page') {
        if (fixture.fail) throw { kind: 'hostingUnavailable', message: 'GitHub data could not be loaded.', hint: 'Check gh authentication.' };
        const page = { repository: 'team/repo', mayHaveMore: true, entries: [{ number: '12', title: '<script>literal title</script>', state: 'open · draft', author: 'reviewer', url: 'https://github.com/team/repo/pull/12', branch: 'feature', commitOid: 'a'.repeat(40), body: 'Original pull description' }] };
        if (fixture.hold) return new Promise(resolve => fixture.finish = () => resolve(page));
        return page;
      }
      if (command === 'load_hosted_review') return { headOid: args.expectedHeadOid, baseBranch: 'main', headBranch: 'feature', files: [{ path: 'file.ts', state: 'modified', additions: 1, deletions: 2, patch: null }], reviews: [{ name: 'reviewer', state: 'CHANGES_REQUESTED', body: 'Test the edge case' }], checks: [{ name: 'unit', state: 'completed · failure', body: '' }], filesMayHaveMore: true, reviewsMayHaveMore: false, checksMayHaveMore: false };
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
