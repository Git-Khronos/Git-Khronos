import { expect, test } from '@playwright/test';

test('configures an enabled sparse checkout from the toolbar and command palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sparse checkout options' })).toHaveCount(0);

  await page.goto('/?sparse-preview');
  await expect(page.locator('.app-shell')).toBeVisible();
  const sparseOptions = page.getByRole('button', { name: 'Sparse checkout options' });
  await sparseOptions.click();
  await expect(page.locator('.sparse-menu')).toHaveCount(1);
  const menu = page.getByRole('menu').and(page.locator('#sparse-checkout-options-menu'));
  await expect(menu).toContainText('2 selected directories');
  await expect(menu).toContainText('sparse index');
  await page.getByRole('menuitem', { name: /Edit directories/ }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
  await expect(page.getByLabel('Sparse checkout directories')).toHaveValue('apps/desktop\ncrates/git-core');
  await expect(page.getByRole('button', { name: 'Update Directories' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close preferences' }).click();

  await sparseOptions.click();
  await page.getByRole('menuitem', { name: /Disable sparse checkout/ }).click();
  let sparseConfirmation = page.getByRole('alertdialog', { name: 'Restore the complete working tree?' });
  await expect(sparseConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sparseConfirmation).toBeHidden();
  await expect(sparseOptions).toBeFocused();

  await sparseOptions.focus();
  await page.keyboard.press('Control+P');
  await page.getByLabel('Search commands').fill('disable sparse');
  await page.getByRole('option', { name: /Disable Sparse Checkout/ }).click();
  sparseConfirmation = page.getByRole('alertdialog', { name: 'Restore the complete working tree?' });
  await expect(sparseConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(sparseConfirmation).toContainText('substantial disk space');
  await page.keyboard.press('Escape');
  await expect(sparseConfirmation).toBeHidden();
  await expect(sparseOptions).toBeFocused();
});
