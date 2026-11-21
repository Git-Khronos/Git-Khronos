import { expect, test, type Page } from '@playwright/test';

function workspaceEditorChunk(contents: string): boolean {
  return contents.includes('Start with a separate set of repository tabs')
    && contents.includes('Delete Workspace');
}

async function requestNewWorkspace(page: Page) {
  const opener = page.getByRole('button', { name: 'Workspace: Default', exact: true });
  await opener.click();
  await page.getByRole('menuitem', { name: 'New workspace', exact: true }).click();
  return opener;
}

test('a delayed workspace editor can be cancelled before any workspace changes', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let chunkRequested = false;
  let finished!: () => void;
  const chunkFinished = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const contents = await response.text();
    const editor = workspaceEditorChunk(contents);
    if (editor) {
      chunkRequested = true;
      await gate;
    }
    await route.fulfill({ response, body: contents });
    if (editor) finished();
  });
  try {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    expect(chunkRequested).toBe(false);
    const before = await page.evaluate(() => localStorage.getItem('git-khronos.workspaces.v1'));
    const opener = await requestNewWorkspace(page);
    const loading = page.getByRole('dialog', { name: 'Loading workspace editor' });
    await expect(loading.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect.poll(() => chunkRequested).toBe(true);
    await page.keyboard.press('Escape');
    await expect(loading).toHaveCount(0);
    await expect(opener).toBeFocused();
    release();
    await chunkFinished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.getByRole('dialog', { name: 'New Workspace' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('git-khronos.workspaces.v1'))).toBe(before);

    await requestNewWorkspace(page);
    const editor = page.getByRole('dialog', { name: 'New Workspace' });
    await expect(editor.getByLabel('Workspace name')).toBeFocused();
  } finally {
    release();
  }
});

test('an editor load failure leaves workspace data unchanged and has a keyboard close route', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const contents = await response.text();
    if (workspaceEditorChunk(contents)) await route.abort();
    else await route.fulfill({ response, body: contents });
  });
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('git-khronos.workspaces.v1'));
  const opener = await requestNewWorkspace(page);
  const unavailable = page.getByRole('dialog', { name: 'Workspace editor unavailable' });
  await expect(unavailable.getByRole('alert')).toContainText('No changes were made');
  await expect(unavailable.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(unavailable).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.workspaces.v1'))).toBe(before);
});
