import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const root = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = root.git;
    const stash = { reference: 'stash@{0}', oid: 'a'.repeat(40), message: 'Owned saved changes' };
    const repository = { ...git.repository(), stashes: [stash] };
    git.repositories.set([repository]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const state: any = { root, git, stash, repository, calls: [], attempts: 0, failures: 1 };
    (window as any).__stashDelete = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: unknown) => {
      state.calls.push({ command, args });
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      if (command === 'drop_stash') {
        state.attempts++;
        return state.attempts <= state.failures
          ? Promise.reject({ kind: 'gitFailure', message: 'Owned delete refused', hint: 'Repair the owned lock and retry.' })
          : Promise.resolve({ ...repository, stashes: [] });
      }
      return Promise.resolve(repository);
    } };
    const opener = document.createElement('button');
    opener.textContent = 'Owned stash delete opener';
    opener.onclick = () => root.requestStashDelete(stash);
    document.body.append(opener);
  });
  await page.getByRole('button', { name: 'Owned stash delete opener', exact: true }).click();
  return page.getByRole('alertdialog', { name: 'Delete stash', exact: true });
}

test('failed stash deletion retains details, inline recovery, and an explicit retry', async ({ page }) => {
  const dialog = await prepare(page);
  await dialog.getByRole('button', { name: 'Delete Stash', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Owned saved changes');
  await expect(dialog.getByRole('alert')).toContainText('Owned delete refused');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await dialog.getByRole('button', { name: 'Retry Delete', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Owned stash delete opener', exact: true })).toBeFocused();
  const calls = await page.evaluate(() => (window as any).__stashDelete.calls.filter((call: any) => call.command === 'drop_stash'));
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call.args.expectedOid).toBe('a'.repeat(40));
});

test('stash confirmation traps keyboard focus and restores it on Escape', async ({ page }) => {
  const dialog = await prepare(page);
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Delete Stash', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Owned stash delete opener', exact: true })).toBeFocused();
});

test('a repeated refusal returns focus to its inline error again', async ({ page }) => {
  const dialog = await prepare(page);
  await page.evaluate(() => { (window as any).__stashDelete.failures = 2; });
  await dialog.getByRole('button', { name: 'Delete Stash', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeFocused();
  await dialog.getByRole('button', { name: 'Retry Delete', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Retry Delete', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__stashDelete.attempts)).toBe(2);
});

test('confirmation cannot retarget another repository or a shifted stash ordinal', async ({ page }) => {
  const dialog = await prepare(page);
  await page.evaluate(() => {
    const { git, repository, stash } = (window as any).__stashDelete;
    git.repositories.set([{ ...repository, stashes: [{ ...stash, oid: 'b'.repeat(40) }, { ...stash, reference: 'stash@{1}' }] }]);
  });
  await expect(dialog.getByRole('button', { name: 'Delete Stash', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('stash list changed');
  await page.evaluate(() => {
    const { git, repository } = (window as any).__stashDelete;
    git.repositories.set([repository, { ...repository, id: 'other-repository', path: '/owned/other' }]);
    git.activeRepositoryId.set('other-repository');
  });
  await expect(dialog.getByRole('button', { name: 'Delete Stash', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__stashDelete.attempts)).toBe(0);
});

test('pending deletion cannot be repeated or dismissed and late success does not change another repository', async ({ page }) => {
  const dialog = await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).__stashDelete;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string) => {
      if (command === 'refresh_repository_status') return Promise.resolve(state.repository.status);
      if (command === 'drop_stash') {
        state.attempts++;
        return new Promise(resolve => { state.resolve = resolve; });
      }
      return Promise.resolve(state.repository);
    };
  });
  await dialog.getByRole('button', { name: 'Delete Stash', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Deleting…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await page.evaluate(() => {
    const state = (window as any).__stashDelete;
    state.root.requestStashDelete(state.stash);
    state.git.repositories.set([state.repository, { ...state.repository, id: 'other-repository' }]);
    state.git.activeRepositoryId.set('other-repository');
    state.root.selectedCommit.set('owned-other-selection');
    state.resolve({ ...state.repository, stashes: [] });
  });
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => {
    const state = (window as any).__stashDelete;
    return [state.attempts, state.git.activeRepositoryId(), state.root.selectedCommit()];
  })).toEqual([1, 'other-repository', 'owned-other-selection']);
});

test('long labels remain readable in a narrow reduced-motion viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).__stashDelete;
    const request = state.root.pendingStashDelete();
    state.root.pendingStashDelete.set({ ...request, stash: { ...request.stash, message: 'Owned-long-label-'.repeat(100) } });
  });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/renderer/stash-delete-narrow.png' });
});
