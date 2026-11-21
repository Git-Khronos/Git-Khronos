import { expect, test } from '@playwright/test';

const failures = {
  bare: { kind: 'bareRepositoryUnsupported',
    message: 'This folder belongs to a bare repository but is not its top-level folder. Git reported: fatal: this operation must be run in a work tree',
    hint: 'Open the bare repository folder itself (often named project.git) to browse it read-only. Nothing was changed.' },
  format: { kind: 'unsupportedRepositoryFormat',
    message: 'This repository uses a format that the installed Git does not support. Git reported: fatal: unknown repository extension found: khronosunknownfeature',
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
  const pull = page.getByRole('button', { name: /^Pull from/ });
  await expect(pull).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__calls.filter((call: string) => /stage|commit|stash|discard|checkout/.test(call)))).toEqual([]);
});

for (const scan of ['clean', 'failed then dirty'] as const) {
  test(`a newly opened checkout stays unknown until the first working-tree scan is ${scan}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#unstaged-files-list')).toBeVisible();
    const fixture = await page.evaluate(async (scan) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const git = app.git;
      const current = git.repository();
      app.setAutoFetchInterval(0);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      const path = '/owned/first-status';
      const clean = { ...current.status, staged: 0, unstaged: 0, untracked: 0, conflicted: 0,
        entryCount: 0, entries: [], entriesTruncated: false };
      const snapshot = { ...current, id: 'first-status', name: 'first-status', path,
        status: { ...clean, filesUnscanned: true } };
      const dirty = { ...clean, unstaged: 1, untracked: 1, entryCount: 2, entries: [
        { path: 'modified.txt', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
        { path: 'new.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false },
      ] };
      const trackedSnapshot = scan === 'clean' ? snapshot : { ...snapshot,
        status: { ...snapshot.status, unstaged: 1, entryCount: 1, entries: dirty.entries.slice(0, 1) } };
      const calls = { metadata: 0, status: [] as Array<(value: 'fail' | 'clean' | 'dirty') => void> };
      (window as any).__firstStatus = calls;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        if (command === 'open_repository') return Promise.resolve(snapshot);
        if (command === 'refresh_repository' && args.repoId === snapshot.id) {
          calls.metadata++;
          return Promise.resolve(trackedSnapshot);
        }
        if (command === 'refresh_repository_status' && args.repoId === snapshot.id) {
          // A focus refresh may run before the deferred initial scan. It is
          // not the first scan owned by the deferred loading/retry flow.
          if (!calls.metadata) return Promise.reject(new Error('Owned early focus read'));
          return new Promise((resolve, reject) => calls.status.push(value => value === 'fail'
            ? reject(new Error('Owned first status failure')) : resolve(value === 'clean' ? clean : dirty)));
        }
        return Promise.reject(new Error(`Unexpected ${command}`));
      } };
      await app.openRepositoryPath(path);
      return path;
    }, scan);
    await expect(page.locator('.status-repository-path')).toHaveText(fixture);
    const sidebar = page.getByRole('button', { name: /Working Directory/ });
    const panel = page.getByRole('region', { name: 'Working directory status' });
    await expect(sidebar).toContainText('Loading changes');
    await expect(panel.getByRole('status')).toHaveText('Loading working directory changes…');
    await expect(page.getByText('No unstaged files', { exact: true })).toHaveCount(0);
    await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
    const reply = (value: 'fail' | 'clean' | 'dirty') =>
      page.evaluate(value => (window as any).__firstStatus.status.shift()(value), value);
    const awaitRead = () => expect.poll(() =>
      page.evaluate(() => (window as any).__firstStatus.status.length)).toBeGreaterThan(0);
    await awaitRead();
    await expect(panel.getByRole('status')).toBeVisible();
    await expect(sidebar).toContainText('Loading changes');
    if (scan === 'failed then dirty') {
      await reply('fail');
      await expect(panel.getByRole('alert')).toHaveText('Could not load working directory changes.');
      await expect(sidebar).toContainText('Changes unavailable');
      await panel.getByRole('button', { name: 'Retry' }).click();
      await expect(panel.getByRole('status')).toBeVisible();
      await awaitRead();
      await reply('dirty');
      await expect(sidebar).toContainText('2 changed files');
      await expect(page.getByRole('button', { name: 'View changes in modified.txt' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'View changes in new.txt' })).toBeVisible();
    } else {
      await reply('clean');
      await expect(sidebar).toContainText('0 changed files');
      await expect(page.getByText('No unstaged files', { exact: true })).toBeVisible();
    }
    await expect(panel).toHaveCount(0);
  });
}
