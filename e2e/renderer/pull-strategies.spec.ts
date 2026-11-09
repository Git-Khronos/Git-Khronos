import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__pullCalls = [];
    (window as any).__pullSnapshot = git.repository();
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        (window as any).__pullCalls.push({ command, args });
        if (command === 'refresh_repository_status') {
          return Promise.resolve((window as any).__pullSnapshot.status);
        }
        if (command === 'refresh_repository') return Promise.resolve((window as any).__pullSnapshot);
        if (command === 'pull_repository') {
          if ((window as any).__pullFailure) return Promise.reject((window as any).__pullFailure);
          return Promise.resolve((window as any).__pullSnapshot);
        }
        if (['abort_merge', 'abort_rebase'].includes(command)) {
          const snapshot = (window as any).__pullSnapshot;
          (window as any).__pullSnapshot = {
            ...snapshot,
            status: { ...snapshot.status, mergeInProgress: false, rebaseInProgress: false, conflicted: 0 },
          };
          return Promise.resolve((window as any).__pullSnapshot);
        }
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

for (const [strategy, label] of [
  ['merge', 'Fast-forward if possible'],
  ['ff-only', 'Fast-forward only'],
  ['rebase', 'Rebase'],
] as const) {
  test(`one-off ${strategy} pull sends the selected strategy without changing the saved default`, async ({ page }) => {
    await page.getByRole('button', { name: 'Pull options' }).click();
    const menu = page.locator('.pull-menu');
    await menu.getByRole('menuitemradio', { name: 'Make Rebase the default pull strategy' }).click();
    await menu.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click();
    await expect(menu).toHaveCount(0);
    await expect(page.getByText('Pull complete', { exact: true })).toBeVisible();
    const calls = await page.evaluate(() => (window as any).__pullCalls
      .filter((call: any) => call.command === 'pull_repository'));
    expect(calls).toEqual([expect.objectContaining({ args: expect.objectContaining({
      strategy, remote: 'origin', branch: 'main', operationId: expect.any(String),
    }) })]);
    await page.getByRole('button', { name: 'Pull options' }).click();
    await expect(page.locator('.pull-menu').getByRole('menuitemradio', {
      name: 'Rebase is the default pull strategy',
    })).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('git-khronos.pull.strategy'))).toBe('rebase');
  });
}

test('fast-forward refusal refreshes divergent counts without automatic merge or rebase', async ({ page }) => {
  await page.evaluate(() => {
    const snapshot = (window as any).__pullSnapshot;
    (window as any).__pullSnapshot = {
      ...snapshot, status: { ...snapshot.status, ahead: 1, behind: 1 },
      branches: snapshot.branches.map((branch: any) => branch.current
        ? { ...branch, tracking: 'ahead 1, behind 1' } : branch),
    };
    (window as any).__pullFailure = {
      kind: 'gitFailure', message: 'Pull stopped because the histories cannot fast-forward.',
      hint: 'Fetch may have updated remote-tracking references. Inspect the divergent commits.',
    };
  });
  await page.getByRole('button', { name: 'Pull options' }).click();
  await page.locator('.pull-menu').getByRole('menuitem', { name: /^Fast-forward only/ }).click();
  await expect(page.locator('.error-toast')).toContainText('cannot fast-forward');
  await expect(page.locator('.error-toast')).toContainText('remote-tracking references');
  await expect(page.getByRole('button', { name: '1 commit ahead of origin/main, push now' })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 commit behind origin/main, pull now', exact: true })).toBeVisible();
  await expect(page.getByText('Pull complete', { exact: true })).toHaveCount(0);
  await expect(page.locator('.merge-progress, .rebase-progress')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__pullCalls);
  expect(calls.filter((call: any) => call.command === 'pull_repository')).toHaveLength(1);
  expect(calls.some((call: any) => call.command === 'refresh_repository')).toBe(true);
});

for (const strategy of ['merge', 'rebase'] as const) {
  test(`conflicted ${strategy} pull exposes the correct continuation and explicit abort`, async ({ page }) => {
    if (strategy === 'rebase') await page.setViewportSize({ width: 820, height: 720 });
    await page.evaluate(mode => {
      const snapshot = (window as any).__pullSnapshot;
      (window as any).__pullSnapshot = {
        ...snapshot, status: {
          ...snapshot.status, conflicted: 1,
          mergeInProgress: mode === 'merge', rebaseInProgress: mode === 'rebase',
        },
      };
      (window as any).__pullFailure = {
        kind: 'gitFailure', message: 'Pull stopped while integrating local and remote changes.',
        hint: 'Inspect conflicts and the active merge or rebase. Resolve and continue, or abort.',
      };
    }, strategy);
    await page.getByRole('button', { name: 'Pull options' }).click();
    await page.locator('.pull-menu').getByRole('menuitem', {
      name: strategy === 'merge' ? /^Fast-forward if possible/ : /^Rebase/,
    }).click();
    await expect(page.locator('.error-toast')).toContainText('integrating local and remote changes');
    const progress = page.getByRole('status', { name: `Git ${strategy} in progress` });
    await expect(progress).toContainText('1 conflicted file');
    await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await expect(progress.getByRole('button', { name: 'Abort', exact: true })).toBeEnabled();
    await progress.getByRole('button', { name: 'Abort', exact: true }).click();
    await expect(progress).toHaveCount(0);
    const calls = await page.evaluate(() => (window as any).__pullCalls);
    expect(calls.filter((call: any) => call.command === 'pull_repository')).toHaveLength(1);
    const abort = calls.find((call: any) => call.command === (strategy === 'merge' ? 'abort_merge' : 'abort_rebase'));
    expect(abort).toBeDefined();
  });
}

test('missing upstream reports the gone state without selecting a replacement remote', async ({ page }) => {
  await page.evaluate(() => {
    const snapshot = (window as any).__pullSnapshot;
    (window as any).__pullSnapshot = {
      ...snapshot,
      branches: snapshot.branches.map((branch: any) => branch.current
        ? { ...branch, tracking: 'gone' } : branch),
      status: { ...snapshot.status, ahead: 0, behind: 0 },
    };
    (window as any).__pullFailure = {
      kind: 'gitFailure', message: 'Pull could not find its upstream branch.',
      hint: 'Check the selected remote and branch. No replacement branch is selected automatically.',
    };
  });
  await page.getByRole('button', { name: 'Pull options' }).click();
  await page.locator('.pull-menu').getByRole('menuitem', { name: /^Fast-forward only/ }).click();
  await expect(page.locator('.error-toast')).toContainText('upstream branch');
  await expect(page.locator('.status-sync.missing')).toHaveText('Upstream missing');
  await expect(page.locator('.error-toast')).toContainText('No replacement branch');
  const calls = await page.evaluate(() => (window as any).__pullCalls);
  expect(calls.filter((call: any) => call.command === 'pull_repository')).toEqual([
    expect.objectContaining({ args: expect.objectContaining({ remote: 'origin', branch: 'main', strategy: 'ff-only' }) }),
  ]);
  expect(calls.every((call: any) => ['pull_repository', 'refresh_repository', 'refresh_repository_status'].includes(call.command))).toBe(true);
});

test('local-change refusal preserves the commit draft and retries only on an explicit pull', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Commit summary' }).fill('Preserve local work');
  await page.evaluate(() => {
    (window as any).__pullFailure = {
      kind: 'gitFailure', message: 'Pull stopped to protect local changes.',
      hint: 'Review staged, unstaged and untracked files. Commit or explicitly stash the changes before retrying.',
    };
  });
  await page.getByRole('button', { name: 'Pull options' }).click();
  await page.locator('.pull-menu').getByRole('menuitem', { name: /^Rebase/ }).click();
  await expect(page.locator('.error-toast')).toContainText('protect local changes');
  await expect(page.getByRole('textbox', { name: 'Commit summary' })).toHaveValue('Preserve local work');
  expect(await page.evaluate(() => (window as any).__pullCalls
    .filter((call: any) => !['refresh_repository', 'refresh_repository_status'].includes(call.command))))
    .toEqual([expect.objectContaining({ command: 'pull_repository', args: expect.objectContaining({ strategy: 'rebase' }) })]);
  await page.evaluate(() => { (window as any).__pullFailure = null; });
  await page.getByRole('button', { name: 'Pull options' }).click();
  await page.locator('.pull-menu').getByRole('menuitem', { name: /^Rebase/ }).click();
  await expect(page.getByText('Pull complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Commit summary' })).toHaveValue('Preserve local work');
  expect(await page.evaluate(() => (window as any).__pullCalls
    .filter((call: any) => call.command === 'pull_repository'))).toHaveLength(2);
});
