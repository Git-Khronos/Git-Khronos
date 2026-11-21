import { expect, test } from '@playwright/test';

const head = 'f19b263a8af31408d5f665caf7a5508e108c0fd1';
const older = '160acd10ef9e0c202cd3985aa41ee45d971bbb11';

for (const scenario of ['load', 'cancel', 'retire', 'keep focus', 'error'] as const) {
  test(`deferred commit editor handles ${scenario} without stealing focus or reopening old reviews`, async ({ page }) => {
    let release!: () => void;
    let loaded!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const settled = new Promise<void>(resolve => { loaded = resolve; });
    let requests = 0;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      if (!text.includes('gc-commit-edit-form') || !text.includes('Save Commit')) {
        await route.fulfill({ response, body: text });
        return;
      }
      requests++;
      if (scenario === 'error') await route.abort();
      else {
        await gate;
        await route.fulfill({ response, body: text });
      }
      loaded();
    });

    try {
      await page.goto('/');
      const inspector = page.getByRole('region', { name: 'Commit summary' });
      await page.locator(`.commit-row[data-commit-oid="${head}"]`).click();
      const trigger = inspector.getByRole('button', { name: /Edit commit/ });
      await expect(trigger).toBeVisible();
      expect(requests).toBe(0);
      await trigger.click();
      const fallback = inspector.getByRole('button', { name: 'Cancel', exact: true });
      const form = inspector.getByRole('form', { name: 'Edit commit' });
      await expect(fallback).toBeFocused();
      await expect(form).toHaveCount(0);

      if (scenario === 'error') {
        await expect(inspector.getByRole('alert')).toContainText('couldn’t load');
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
      } else if (scenario === 'cancel') {
        await fallback.click();
        await expect(trigger).toBeFocused();
        release();
      } else if (scenario === 'retire') {
        await page.locator(`.commit-row[data-commit-oid="${older}"]`).click();
        await expect(fallback).toHaveCount(0);
        release();
      } else {
        const other = page.getByRole('button', { name: 'Main menu', exact: true });
        if (scenario === 'keep focus') await other.focus();
        release();
        const summary = form.getByLabel('Summary');
        await expect(summary).toBeVisible();
        if (scenario === 'keep focus') await expect(other).toBeFocused();
        else {
          await expect(summary).toBeFocused();
          expect(await summary.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd]))
            .toEqual([0, (await summary.inputValue()).length]);
        }
        await form.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(trigger).toBeFocused();
      }
      await settled;
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await expect(form).toHaveCount(0);
      expect(requests).toBe(1);
    } finally {
      release();
    }
  });
}
