import { expect, type Locator, type Page } from '@playwright/test';

// Under load the shell can paint before the lazy preview repository is
// available. Give only this startup gate room; the action assertions still
// use their original timeouts and fail normally.
export async function openPreviewRepository(page: Page, repositoryControl: Locator): Promise<void> {
  await page.goto('/');
  await expect(repositoryControl, 'Browser preview repository should finish loading')
    .toBeVisible({ timeout: 15_000 });
}
