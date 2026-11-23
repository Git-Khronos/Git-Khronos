import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, picker: 'file' | 'cancel' | 'hold' = 'file') {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  const head = await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.repository().headOid as string);
  const actions = page.getByRole('button', { name: 'Commit actions for Add hunk-level staging actions', exact: true });
  const row = page.locator('.commit-row[data-commit-oid]').filter({ has: actions });
  await expect(row).toBeVisible();
  await page.evaluate(mode => {
    const host = window as any;
    const app = host.ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    app.commitMessage.set('Leave the local draft alone');
    const fixture: { calls: { command: string; args: unknown }[]; release?: () => void } = { calls: [] };
    host.__sourceZip = fixture;
    host.__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'plugin:dialog|save') {
        if (mode === 'hold') return new Promise(resolve => fixture.release = () => resolve('/owned/commit-source.zip'));
        return Promise.resolve(mode === 'cancel' ? null : '/owned/commit-source.zip');
      }
      if (command === 'export_commit_source_zip') return Promise.resolve(1024);
      return Promise.resolve(null);
    } };
  }, picker);
  const oid = (await row.getAttribute('data-commit-oid'))!;
  await actions.click();
  const menu = page.getByRole('menu', { name: /^Actions for commit / });
  const save = menu.getByRole('menuitem', { name: 'Save committed files as ZIP…' });
  await expect(save).toBeVisible();
  return { row, oid, head, save, menu };
}

async function calls(page: Page) {
  return page.evaluate(() => (window as any).__sourceZip.calls.filter((entry: any) =>
    ['plugin:dialog|save', 'export_commit_source_zip'].includes(entry.command)));
}

test('source ZIP is pinned to the context commit, not HEAD or uncommitted files', async ({ page }) => {
  const { oid, head, save, menu } = await setup(page);
  expect(oid).not.toBe(head);
  expect(await calls(page)).toEqual([]);
  await save.click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-git-operation-status]')).toContainText('Saved source ZIP');
  const repoId = await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.activeRepositoryId());
  expect(await calls(page)).toEqual([
    { command: 'plugin:dialog|save', args: { options: expect.objectContaining({
      title: `Save committed files from ${oid.slice(0, 12)} as ZIP`, defaultPath: `source-${oid.slice(0, 12)}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    }) } },
    { command: 'export_commit_source_zip', args: {
      repoId, oid, destination: '/owned/commit-source.zip', operationId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    } },
  ]);
  expect(await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    return { draft: app.commitMessage(), head: app.git.repository().headOid };
  })).toEqual({ draft: 'Leave the local draft alone', head });
});

test('cancelling the source ZIP picker does not invoke export', async ({ page }) => {
  const { save } = await setup(page, 'cancel');
  await save.click();
  await expect(page.locator('[data-git-operation-status]')).toContainText('Source ZIP cancelled; no file written');
  expect((await calls(page)).map((entry: any) => entry.command)).toEqual(['plugin:dialog|save']);
});

test('a source ZIP picker from another checkout visit cannot write an archive', async ({ page }) => {
  const { save } = await setup(page, 'hold');
  await save.click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__sourceZip.release)).toBe('function');
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const source = git.repository();
    git.repositories.update((rows: any[]) => [...rows, { ...source, id: 'other-archive-repo', path: '/owned/other-archive' }]);
    git.activeRepositoryId.set('other-archive-repo');
    (window as any).__sourceZip.release();
  });
  await expect(page.locator('[data-git-operation-status]')).toContainText('Repository changed; no source ZIP written');
  expect((await calls(page)).map((entry: any) => entry.command)).toEqual(['plugin:dialog|save']);
});
