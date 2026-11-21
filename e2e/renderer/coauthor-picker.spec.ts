import { expect, test } from '@playwright/test';

test('cancels the deferred co-author picker without losing or changing a commit draft', async ({ page }) => {
  let requested = false;
  let served = false;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('manual-coauthor-field') && body.includes('Other contributor')) {
      requested = true;
      await held;
      await route.fulfill({ response, body });
      served = true;
    } else {
      await route.fulfill({ response, body });
    }
  });

  try {
    await page.goto('/');
    const composer = page.locator('.commit-composer');
    const draft = composer.locator('#commit-summary');
    const toggle = composer.locator('.add-coauthor');
    await draft.fill('Preserve my local draft');
    expect(requested).toBe(false);
    await toggle.click();
    await expect(composer.getByRole('status').filter({ hasText: 'Loading co-author picker' })).toBeVisible();
    await expect.poll(() => requested).toBe(true);
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    release();
    await expect.poll(() => served).toBe(true);
    await expect(composer.locator('.coauthor-picker')).toHaveCount(0);
    await expect(draft).toHaveValue('Preserve my local draft');
    await expect(composer.getByLabel('Commit co-authors')).toHaveCount(0);

    await toggle.click();
    const picker = composer.locator('.coauthor-picker');
    await picker.getByLabel('Name', { exact: true }).fill('Owned Author');
    await picker.getByLabel('Email', { exact: true }).fill('owned@example.test');
    await picker.getByRole('button', { name: 'Add co-author' }).click();
    await expect(composer.getByLabel('Commit co-authors')).toContainText('Owned Author');
    await expect(draft).toHaveValue('Preserve my local draft');
  } finally {
    release();
  }
});

test('a failed co-author chunk keeps the draft and returns focus to the toggle', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('manual-coauthor-field') && body.includes('Other contributor')) return route.abort();
    await route.fulfill({ response, body });
  });
  await page.goto('/');
  const composer = page.locator('.commit-composer');
  const draft = composer.locator('#commit-summary');
  const toggle = composer.locator('.add-coauthor');
  await draft.fill('No silent draft changes');
  await toggle.click();
  const picker = composer.locator('.coauthor-picker');
  await expect(picker.getByRole('alert')).toContainText('The commit draft is unchanged');
  await picker.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(draft).toHaveValue('No silent draft changes');
});
