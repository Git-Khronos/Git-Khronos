import { expect, test, type Page } from '@playwright/test';
import type { Signal, WritableSignal } from '@angular/core';
import type { RepositorySnapshot, RepositoryStatus } from '@git-khronos/contracts';

interface CharacterizationApp {
  git: {
    repository: Signal<RepositorySnapshot>;
    repositories: WritableSignal<RepositorySnapshot[]>;
  };
  commandQuery: WritableSignal<string>;
  commandActions: Signal<Array<{ id: string; enabled: boolean }>>;
}

async function setStatus(page: Page, status: Partial<RepositoryStatus>): Promise<void> {
  await page.evaluate(status => {
    const app = (window as unknown as {
      ng: { getComponent(element: Element | null): CharacterizationApp };
    }).ng.getComponent(document.querySelector('gc-root'));
    const repository = app.git.repository();
    app.git.repositories.update(items => items.map(item => item.id !== repository.id ? item : {
      ...item,
      status: { ...item.status, mergeInProgress: false, rebaseInProgress: false,
        rebaseEditStopped: false, rebaseSplit: null, historyOperation: null,
        historyNoCommit: false, mailPatchInProgress: false, bisectInProgress: false,
        staged: 0, unstaged: 0, untracked: 0, conflicted: 0, entryCount: 0, entries: [],
        ...status },
    }));
  }, status);
}

async function operationCommands(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() => {
    const app = (window as unknown as {
      ng: { getComponent(element: Element | null): CharacterizationApp };
    }).ng.getComponent(document.querySelector('gc-root'));
    app.commandQuery.set('');
    return Object.fromEntries(app.commandActions()
      .filter(action => /^(merge-|history-operation-|bisect-)/.test(action.id))
      .map(action => [action.id, action.enabled]));
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
});

for (const name of ['Fetch options', 'Pull options', 'Push options', 'Branch options', 'Stash options']) {
  test(`${name} closes its toolbar sibling and restores its own opener on Escape`, async ({ page }) => {
    const previousName = name === 'Fetch options' ? 'Branch options' : 'Fetch options';
    await page.getByRole('button', { name: previousName, exact: true }).click();
    await expect(page.getByRole('menu', { name: previousName, exact: true })).toBeVisible();
    const opener = page.getByRole('button', { name, exact: true });
    await opener.click();
    const menu = page.getByRole('menu', { name, exact: true });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menu', { name: previousName, exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test(`${name} dismisses on outside press and window blur without restoring stale focus`, async ({ page }) => {
    const opener = page.getByRole('button', { name, exact: true });
    const menu = page.getByRole('menu', { name, exact: true });
    await opener.click();
    await page.locator('.statusbar').click({ position: { x: 5, y: 5 } });
    await expect(menu).toHaveCount(0);
    await opener.click();
    await expect(menu).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(menu).toHaveCount(0);
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
  });
}

test('merge and bisect remain independently visible and actionable', async ({ page }) => {
  await setStatus(page, { mergeInProgress: true, bisectInProgress: true, conflicted: 1 });
  const merge = page.getByRole('status', { name: 'Git merge in progress', exact: true });
  await expect(merge).toBeVisible();
  await expect(merge.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(merge.getByRole('button', { name: 'Abort', exact: true })).toBeEnabled();
  await expect(page.getByRole('status', { name: 'Git bisect in progress', exact: true })).toBeVisible();
  expect(await operationCommands(page)).toMatchObject({
    'merge-continue': false, 'merge-abort': true, 'bisect-good': true,
    'bisect-bad': true, 'bisect-skip': true, 'bisect-reset': true,
  });
  await setStatus(page, { mergeInProgress: true, bisectInProgress: true });
  await expect(merge.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  expect(await operationCommands(page)).toMatchObject({ 'merge-continue': true, 'bisect-good': true });
});

for (const operation of ['cherry-pick', 'revert']) {
  for (const noCommit of [false, true]) {
    test(`${operation} ${noCommit ? 'no-commit' : 'ordinary'} recovery preserves banner and palette guards`, async ({ page }) => {
      await setStatus(page, { historyOperation: operation, historyNoCommit: noCommit,
        bisectInProgress: true, unstaged: 1 });
      const progress = page.getByRole('status', { name: `Git ${operation} in progress`, exact: true });
      await expect(progress).toBeVisible();
      await expect(page.getByRole('status', { name: 'Git bisect in progress', exact: true })).toBeVisible();
      if (noCommit) {
        await expect(progress).toContainText('NO COMMIT');
        await expect(progress.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
        await expect(progress.getByRole('button', { name: 'Finish manually', exact: true })).toBeEnabled();
        await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
      } else {
        await expect(progress.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();
        await expect(progress.getByRole('button', { name: 'Finish manually', exact: true })).toHaveCount(0);
        await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
      }
      const commands = await operationCommands(page);
      expect(commands).toMatchObject({ 'history-operation-continue': !noCommit,
        'history-operation-skip': !noCommit, 'history-operation-abort': true, 'bisect-reset': true });
      expect(commands['history-operation-quit']).toBe(noCommit ? true : undefined);
      await setStatus(page, { historyOperation: operation, historyNoCommit: noCommit, conflicted: 1 });
      await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
      expect(await operationCommands(page)).toMatchObject({ 'history-operation-continue': false });
    });
  }
}

test('rebase edit stop and bisect remain orthogonal; blur retains operation banners', async ({ page }) => {
  await setStatus(page, { rebaseInProgress: true, rebaseEditStopped: true, bisectInProgress: true });
  const progress = page.getByRole('status', { name: 'Git rebase in progress', exact: true });
  await expect(progress).toContainText('REBASE PAUSED FOR EDIT');
  await expect(progress.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
  await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(progress).toBeVisible();
  await expect(page.getByRole('status', { name: 'Git bisect in progress', exact: true })).toBeVisible();
  expect(await operationCommands(page)).toMatchObject({ 'bisect-good': true, 'bisect-reset': true });
  await setStatus(page, { rebaseInProgress: true, rebaseEditStopped: true, staged: 1 });
  await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
});

test('externally supplied operation markers are not silently hidden by another marker', async ({ page }) => {
  await setStatus(page, { mergeInProgress: true, rebaseInProgress: true,
    historyOperation: 'cherry-pick', mailPatchInProgress: true, bisectInProgress: true });
  for (const operation of ['merge', 'rebase', 'cherry-pick', 'bisect']) {
    await expect(page.getByRole('status', { name: `Git ${operation} in progress`, exact: true })).toBeVisible();
  }
  expect(await operationCommands(page)).toMatchObject({
    'merge-continue': true, 'history-operation-continue': true, 'bisect-reset': true,
  });
});

test('typed native observations drive the same concurrent banners and palette guards', async ({ page }) => {
  await setStatus(page, { operations: [
    { kind: 'merge' }, { kind: 'revert', noCommit: true },
    { kind: 'rebase', editStopped: true, split: null }, { kind: 'mailPatch' },
  ], bisectInProgress: true, conflicted: 1 });
  for (const operation of ['merge', 'rebase', 'revert', 'bisect']) {
    await expect(page.getByRole('status', { name: `Git ${operation} in progress`, exact: true })).toBeVisible();
  }
  const replay = page.getByRole('status', { name: 'Git revert in progress', exact: true });
  await expect(replay).toContainText('NO COMMIT');
  await expect(replay.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
  expect(await operationCommands(page)).toMatchObject({
    'merge-continue': false, 'merge-abort': true, 'history-operation-continue': false,
    'history-operation-quit': true, 'bisect-reset': true,
  });
});
