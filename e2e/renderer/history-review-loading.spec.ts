import { expect, test } from '@playwright/test';

for (const mode of ['load', 'cancel', 'failure', 'switch'] as const) {
  test(`deferred history review ${mode} preserves a focused escape, captured state and history`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let finished!: () => void;
    const chunkFinished = new Promise<void>(resolve => { finished = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      if (!text.includes('history-confirmation-title') || !text.includes('data-history-dialog-cancel')) {
        await route.fulfill({ response, body: text });
        return;
      }
      if (mode === 'failure') await route.abort();
      else {
        await gate;
        await route.fulfill({ response, body: text });
      }
      finished();
    });
    await page.goto('/');
    await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
    const before = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repository = app.git.repository();
      const commit = repository.commits.find((commit: any) => commit.parents.length === 1);
      (window as any).__historyLoadCalls = [];
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string) => {
          (window as any).__historyLoadCalls.push(command);
          return Promise.reject(new Error(`Unexpected command while reviewing history: ${command}`));
        },
      };
      app.commitMessage.set('Draft retained through lazy history review');
      app.openHistoryConfirmation({ kind: 'cherry-pick', oid: commit.oid, oids: [commit.oid], label: commit.subject });
      return { id: repository.id, head: repository.headOid, oid: commit.oid };
    });
    const loading = page.getByRole('dialog', {
      name: mode === 'failure' ? 'History review unavailable' : 'Loading history review', exact: true,
    });
    const close = loading.getByRole('button', { name: mode === 'failure' ? 'Close' : 'Cancel', exact: true });
    await expect(close).toBeFocused({ timeout: 15000 });
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      app.historyNoCommit.set(true);
    });
    if (mode === 'load') {
      release();
      const dialog = page.getByRole('alertdialog');
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await expect(dialog.getByRole('checkbox', { name: 'Apply changes without creating commits' })).toBeChecked();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('checkbox')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.locator('.confirm-action')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('checkbox')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
      expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).pendingHistoryAction().oid))
        .toBe(before.oid);
      await page.keyboard.press('Escape');
    } else if (mode === 'switch') {
      await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const original = app.git.repository();
        app.git.repositories.update((items: any[]) => [...items, { ...original, id: 'history-loading-other', name: 'Other repository' }]);
        app.git.activeRepositoryId.set('history-loading-other');
      });
      await expect(loading).toHaveCount(0);
      await page.evaluate(id => {
        (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId.set(id);
      }, before.id);
      release();
    } else {
      if (mode === 'failure') await expect(loading.getByRole('alert')).toContainText('No history changes were made');
      await page.keyboard.press('Escape');
      release();
    }
    await chunkFinished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(loading).toHaveCount(0);
    const result = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      return { head: app.git.repository().headOid, draft: app.commitMessage(), calls: (window as any).__historyLoadCalls };
    });
    expect(result.head).toBe(before.head);
    expect(result.draft).toBe('Draft retained through lazy history review');
    expect(result.calls).toEqual([]);
  });
}
