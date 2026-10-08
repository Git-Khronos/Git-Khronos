import { expect, test } from '@playwright/test';

const failures = {
  bare: { kind: 'bareRepositoryUnsupported',
    message: 'This folder belongs to a bare repository but is not its top-level folder. Git reported: fatal: this operation must be run in a work tree',
    hint: 'Open the bare repository folder itself (often named project.git) to browse it read-only. Nothing was changed.' },
  format: { kind: 'unsupportedRepositoryFormat',
    message: 'This repository uses a format that the installed Git does not support. Git reported: fatal: unknown repository extension found: chronosunknownfeature',
    hint: 'Update Git, or use the tool that created the repository. Nothing was changed.' },
};

for (const [name, failure] of Object.entries(failures)) {
  test(`opening ${name} repository data explains the refusal and keeps the current tab`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#unstaged-files-list')).toBeVisible();
    const before = await page.evaluate((failure) => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      (window as any).__openCalls = [];
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        (window as any).__openCalls.push({ command, args });
        return command === 'open_repository' ? Promise.reject(failure) : Promise.reject(new Error(`Unexpected ${command}`));
      } };
      return { id: git.activeRepositoryId(), count: git.repositories().length };
    }, failure);
    await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.openRepository('/srv/shared.git/refs'));
    const alert = page.getByRole('alert').filter({ hasText: failure.hint });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Git reported:');
    const after = await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      return { id: git.activeRepositoryId(), count: git.repositories().length, calls: (window as any).__openCalls.map((call: any) => call.command) };
    });
    expect(after).toEqual({ ...before, calls: ['open_repository'] });
  });
}

test('opening a bare repository browses history read-only', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const current = git.repository();
    const snapshot = {
      ...current, id: 'bare-shared', name: 'shared.git', path: '/srv/shared.git', bare: true,
      stashes: [], submodules: [], worktrees: [{ path: '/srv/shared.git', oid: current.headOid, branch: 'main', current: true, locked: false, prunable: false, statusLoaded: true, changes: 0, ahead: 0, behind: 0 }],
      status: { ...current.status, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, entryCount: 0, entries: [], entriesTruncated: false },
    };
    (window as any).__calls = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      (window as any).__calls.push(command);
      return command === 'open_repository' ? Promise.resolve(snapshot) : new Promise(() => undefined);
    } };
    git.openRepository('/srv/shared.git');
  });
  const badge = page.getByRole('note').filter({ hasText: 'Bare repository' });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('Read-only · no working tree');
  await expect(page.getByRole('button', { name: /Working Directory/ })).toHaveCount(0);
  const card = page.getByRole('region', { name: 'Bare repository' });
  await expect(card).toContainText('no working tree');
  await expect(card).toContainText('/srv/shared.git');
  await expect(page.locator('#unstaged-files-list')).toHaveCount(0);
  await expect(page.locator('.wip-row')).toHaveCount(0);
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const pull = page.locator('.toolbar-actions .split-main').first();
  await expect(pull).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__calls.filter((call: string) => /stage|commit|stash|discard|checkout/.test(call)))).toEqual([]);
});
