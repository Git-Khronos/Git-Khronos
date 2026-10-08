import { expect, test } from '@playwright/test';

for (const mode of ['load', 'cancel', 'failure'] as const) {
  test(`deferred rebase ${mode} keeps a focused escape and never changes history while loading`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let finished!: () => void;
    const chunkFinished = new Promise<void>(resolve => { finished = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      const editor = text.includes('Fixup keeps the preceding message') && text.includes('data-rebase-close');
      if (!editor) {
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
    await page.goto('/?interactive-rebase');
    const loading = page.getByRole('dialog', {
      name: mode === 'failure' ? 'Rebase editor unavailable' : 'Loading interactive rebase', exact: true,
    });
    const close = loading.getByRole('button', { name: mode === 'failure' ? 'Close' : 'Cancel', exact: true });
    await expect(close).toBeFocused({ timeout: 15000 });
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    const before = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      (window as any).__rebaseLoadCalls = [];
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string) => {
          (window as any).__rebaseLoadCalls.push(command);
          return Promise.reject(new Error(`Unexpected command while loading: ${command}`));
        },
      };
      return app.git.repository().commits[0].oid;
    });
    if (mode === 'load') {
      release();
      const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
      await expect(dialog.getByRole('button', { name: 'Close interactive rebase' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Close interactive rebase' })).toBeFocused();
      await expect(dialog.locator('textarea')).toHaveValue('Clarify graph column preferences\n\nKeep widths and order per repository.');
      await page.keyboard.press('Escape');
    } else {
      if (mode === 'failure') await expect(loading.getByRole('alert')).toContainText('No command was run');
      await page.keyboard.press('Escape');
      release();
    }
    await chunkFinished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toHaveCount(0);
    await expect(loading).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__rebaseLoadCalls)).toEqual([]);
    expect(await page.evaluate(() => (window as any).ng
      .getComponent(document.querySelector('gc-root')).git.repository().commits[0].oid)).toBe(before);
  });
}
