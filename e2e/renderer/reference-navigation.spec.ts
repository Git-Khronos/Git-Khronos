import { expect, test, type Page } from '@playwright/test';

const archivedOid = '9'.repeat(40);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(oid => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const repo = git.repository();
    const archived = { ...repo.commits[0], oid, subject: 'Archived release beyond the graph', decorations: [] };
    git.repositories.set([{ ...repo, historyTruncated: true, tags: ['archive-one', 'archive-two'].map(name => ({
      fullName: 'refs/tags/' + name, name, oid,
    })) }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'owned reference fixture' }));
    const state: any = { app, git, archived, calls: [] };
    (window as any).__referenceNavigation = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      switch (command) {
        case 'inspect_history_commit':
          return state.hold ? new Promise(resolve => { state.finishSummary = () => resolve(archived); }) : Promise.resolve(archived);
        case 'inspect_commit':
          return Promise.resolve({ oid: args.oid, message: archived.subject, files: [], filesTruncated: false, signature: { status: 'unsigned' } });
        case 'search_tracked_files': return Promise.resolve({ paths: [], truncated: false });
        case 'refresh_repository_status': return Promise.resolve(git.repository().status);
        case 'working_tree_change_summary': return Promise.resolve({ staged: null, unstaged: null });
        default: return Promise.reject({ message: 'Unexpected command in reference navigation: ' + command });
      }
    } };
  }, archivedOid);
});

async function searchTags(page: Page) {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands', exact: true }).fill('view tag archive');
}

test('tag aliases remain separate and open an exact commit outside loaded history', async ({ page }) => {
  await searchTags(page);
  await expect(page.getByRole('option', { name: /^View tag archive-one/ })).toBeVisible();
  await page.getByRole('option', { name: /^View tag archive-two/ }).click();
  await expect(page.locator('.commit-panel')).toContainText('Archived release beyond the graph');
  expect(await page.evaluate(() => {
    const { app, calls } = (window as any).__referenceNavigation;
    return { oid: app.selectedCommit(), reads: calls.filter((call: any) =>
      ['inspect_history_commit', 'inspect_commit', 'load_more_commits'].includes(call.command)) };
  })).toEqual({ oid: archivedOid, reads: [
    { command: 'inspect_history_commit', args: { repoId: expect.any(String), oid: archivedOid } },
    { command: 'inspect_commit', args: { repoId: expect.any(String), oid: archivedOid } },
  ] });
});

test('late tag lookup cannot replace a newer working-directory selection', async ({ page }) => {
  await page.evaluate(() => { (window as any).__referenceNavigation.hold = true; });
  await searchTags(page);
  await page.getByRole('option', { name: /^View tag archive-one/ }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__referenceNavigation.finishSummary)).toBe('function');
  await page.locator('.wip-nav').click();
  await page.evaluate(() => (window as any).__referenceNavigation.finishSummary());
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  expect(await page.evaluate(() => {
    const { app, calls } = (window as any).__referenceNavigation;
    return { oid: app.selectedCommit(), details: calls.some((call: any) => call.command === 'inspect_commit') };
  })).toEqual({ oid: null, details: false });
});

test('a captured tag result does not follow a moved reference', async ({ page }) => {
  await searchTags(page);
  await expect(page.getByRole('option', { name: /^View tag archive-one/ })).toBeVisible();
  expect(await page.evaluate(async () => {
    const { app, git, calls } = (window as any).__referenceNavigation;
    const palette = (window as any).ng.getComponent(document.querySelector('gk-command-palette'));
    const row = palette.commandActions().find((action: any) => action.label === 'View tag archive-one');
    const repo = git.repository();
    git.repositories.set([{ ...repo, tags: [{ ...repo.tags[0], oid: '8'.repeat(40) }, repo.tags[1]] }]);
    await app.runCommand(row);
    return calls.some((call: any) => call.command === 'inspect_history_commit' || call.command === 'inspect_commit');
  })).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
});
