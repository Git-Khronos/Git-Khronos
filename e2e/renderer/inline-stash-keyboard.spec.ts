import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Stash message', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const state: any = { app, git, repository, calls: [] };
    (window as any).__inlineStash = state;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'stash_changes') {
        if (state.fail) return Promise.reject({ kind: 'gitFailure', message: 'Owned inline stash refusal' });
        if (state.hold) return new Promise(resolve => { state.finish = () => resolve(repository); });
      }
      if (command === 'refresh_repository' && state.holdRefresh) return new Promise(resolve => { state.finishRefresh = () => resolve(repository); });
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.resolve(repository);
    } };
    state.change = (kind: string) => {
      if (kind === 'repository') {
        const other = { ...repository, id: 'inline-stash-B', path: '/owned/inline-stash-B' };
        git.repositories.update((items: any[]) => [...items, other]); git.activeRepositoryId.set(other.id);
      } else git.repositories.update((items: any[]) => items.map(item => item.id === repository.id ? { ...item, path: '/owned/inline-stash-replacement' } : item));
    };
  });
  await page.getByRole('textbox', { name: 'Stash message', exact: true }).fill('Owned inline draft');
});

for (const key of ['Control+Enter', 'Control+Shift+Enter', 'Meta+Enter', 'Shift+Enter', 'Alt+Enter']) {
  test(`${key} in the inline stash field cannot dispatch Git`, async ({ page }) => {
    await page.getByRole('textbox', { name: 'Stash message', exact: true }).press(key);
    expect(await page.evaluate(() => (window as any).__inlineStash.calls.filter((call: any) => call.command === 'stash_changes' || call.command === 'commit_changes'))).toEqual([]);
    await expect(page.getByRole('textbox', { name: 'Stash message', exact: true })).toHaveValue('Owned inline draft');
  });
}

for (const kind of ['repeat', 'composition']) {
  test(`${kind} Enter does not consume the inline stash draft`, async ({ page }) => {
    await page.getByRole('textbox', { name: 'Stash message', exact: true }).evaluate((field, kind) => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true,
        repeat: kind === 'repeat', isComposing: kind === 'composition' }));
    }, kind);
    expect(await page.evaluate(() => (window as any).__inlineStash.calls.filter((call: any) => call.command === 'stash_changes'))).toEqual([]);
  });
}

test('plain Enter stashes once with its exact message and clears only the consumed draft', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Stash message', exact: true }).press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__inlineStash.git.busy())).toBe(false);
  const calls = await page.evaluate(() => (window as any).__inlineStash.calls.filter((call: any) => call.command === 'stash_changes'));
  expect(calls).toHaveLength(1);
  expect(calls[0].args.message).toBe('Owned inline draft');
  await expect(page.getByRole('textbox', { name: 'Stash message', exact: true })).toHaveValue('');
});

for (const change of ['repository', 'path']) {
  test(`an outgoing inline Enter rejects a pre-effect ${change} change`, async ({ page }) => {
    await page.evaluate(change => {
      const field = document.querySelector<HTMLInputElement>('[aria-label="Stash message"]')!;
      (window as any).__inlineStash.change(change);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }, change);
    expect(await page.evaluate(() => (window as any).__inlineStash.calls.filter((call: any) => call.command === 'stash_changes'))).toEqual([]);
  });
}

for (const change of ['none', 'repository', 'path', 'same-text-edit']) {
  test(`late inline stash cannot clear a newer draft after ${change}`, async ({ page }) => {
    await page.evaluate(() => { (window as any).__inlineStash.hold = true; });
    await page.getByRole('textbox', { name: 'Stash message', exact: true }).press('Enter');
    await expect.poll(() => page.evaluate(() => typeof (window as any).__inlineStash.finish)).toBe('function');
    if (change === 'repository' || change === 'path') await page.evaluate(change => (window as any).__inlineStash.change(change), change);
    await page.getByRole('textbox', { name: 'Stash message', exact: true }).fill('Newer inline draft');
    if (change === 'same-text-edit') await page.getByRole('textbox', { name: 'Stash message', exact: true }).fill('Owned inline draft');
    await page.evaluate(() => (window as any).__inlineStash.finish());
    await expect.poll(() => page.evaluate(() => (window as any).__inlineStash.git.busy())).toBe(false);
    await expect(page.getByRole('textbox', { name: 'Stash message', exact: true })).toHaveValue(change === 'same-text-edit' ? 'Owned inline draft' : 'Newer inline draft');
  });
}

test('a refused inline stash retains its draft even if the global error is dismissed', async ({ page }) => {
  await page.evaluate(() => { const s = (window as any).__inlineStash; s.fail = true; s.holdRefresh = true; });
  await page.getByRole('textbox', { name: 'Stash message', exact: true }).press('Enter');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__inlineStash.finishRefresh)).toBe('function');
  await page.evaluate(() => { const s = (window as any).__inlineStash; s.git.dismissError(); s.finishRefresh(); });
  await expect.poll(() => page.evaluate(() => (window as any).__inlineStash.git.busy())).toBe(false);
  await expect(page.getByRole('textbox', { name: 'Stash message', exact: true })).toHaveValue('Owned inline draft');
});
