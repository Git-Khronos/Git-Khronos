import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('searches shortcut actions and keys without losing the full reference', async ({ page }) => {
  await page.keyboard.press('Control+/');
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  const search = dialog.getByRole('searchbox', { name: 'Search keyboard shortcuts' });

  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await expect(dialog.getByRole('status')).toHaveText('50 shortcuts');
  await expect(dialog.locator('dt')).toHaveCount(50);
  const sectionNavigation = dialog.getByRole('navigation', { name: 'Shortcut sections' });
  await expect(sectionNavigation).toContainText('Jump to');
  await expect(sectionNavigation.getByRole('button')).toHaveCount(4);

  await sectionNavigation.getByRole('button', { name: 'Navigation' }).click();
  await expect(sectionNavigation.getByRole('button', { name: 'Navigation' })).toHaveAttribute('aria-current', 'location');
  await expect(dialog.getByRole('heading', { name: 'Repository' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Tabs and view' })).toBeVisible();

  await dialog.locator('.shortcut-groups').evaluate((groups) => {
    groups.scrollTop = groups.scrollHeight;
  });
  await expect(sectionNavigation.getByRole('button', { name: 'Tabs and view' })).toHaveAttribute('aria-current', 'location');

  await search.fill('terminal');
  await expect(dialog.getByRole('status')).toHaveText('4 shortcuts');
  await expect(dialog.locator('dt')).toHaveCount(4);
  const repositoryTerminal = dialog.locator('dl > div').filter({ hasText: 'Repository terminal' });
  await expect(repositoryTerminal.locator('kbd')).toHaveText(['Alt', 'T', 'Ctrl', '`']);
  await expect(dialog.getByRole('button', { name: 'Tabs and view' })).toHaveAttribute('aria-current', 'location');
  await expect(dialog.getByRole('button', { name: 'Repository' })).toHaveCount(0);

  await search.fill('shortcut reference');
  const reference = dialog.locator('dl > div').filter({ hasText: 'Shortcut reference' });
  await expect(reference.locator('kbd')).toHaveText(['Ctrl', '/']);

  await search.fill('repository tab');
  const nextRepository = dialog.locator('dl > div').filter({ hasText: 'Next repository tab' });
  const previousRepository = dialog.locator('dl > div').filter({ hasText: 'Previous repository tab' });
  await expect(nextRepository.locator('kbd')).toHaveText(['Ctrl', 'Tab']);
  await expect(previousRepository.locator('kbd')).toHaveText(['Ctrl', 'Shift', 'Tab']);

  await dialog.getByRole('button', { name: 'Clear shortcut search' }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(dialog.getByRole('status')).toHaveText('50 shortcuts');
});

test('recovers from no matches and restores focus when closed', async ({ page }) => {
  const opener = page.getByRole('button', { name: /Switch branch, current main/ });
  await opener.focus();
  await page.keyboard.press('Control+/');

  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  const search = dialog.getByRole('searchbox', { name: 'Search keyboard shortcuts' });
  await search.fill('no-such-shortcut-value');
  await expect(dialog.getByText('No matching shortcuts')).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('0 shortcuts');

  await dialog.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toBeFocused();
  await expect(dialog.locator('dt')).toHaveCount(50);

  await search.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('keeps keyboard focus inside the shortcut dialog', async ({ page }) => {
  await page.keyboard.press('Control+/');
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  const search = dialog.getByRole('searchbox', { name: 'Search keyboard shortcuts' });
  const close = dialog.getByRole('button', { name: 'Close keyboard shortcuts' });

  await search.press('Shift+Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Tabs and view' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
});

test('cycles visible workspace regions forward and backward with F6', async ({ page }) => {
  const toolbar = page.locator('.toolbar.workspace-focus-region');
  const references = page.locator('#repository-reference-panel');
  const history = page.locator('.history-panel.workspace-focus-region');
  const inspector = page.locator('#repository-commit-panel');

  await page.keyboard.press('F6');
  await expect(toolbar).toBeFocused();
  await page.keyboard.press('F6');
  await expect(references).toBeFocused();
  await page.keyboard.press('F6');
  await expect(history).toBeFocused();
  await page.keyboard.press('F6');
  await expect(inspector).toBeFocused();
  await page.keyboard.press('F6');
  await expect(toolbar).toBeFocused();
  await page.keyboard.press('Shift+F6');
  await expect(inspector).toBeFocused();
});

test('skips collapsed regions and targets the central diff surface', async ({ page }) => {
  await page.setViewportSize({ width: 1050, height: 760 });
  const toolbar = page.locator('.toolbar.workspace-focus-region');
  const history = page.locator('.history-panel.workspace-focus-region');
  const inspector = page.locator('#repository-commit-panel');

  await toolbar.focus();
  await page.keyboard.press('F6');
  await expect(history).toBeFocused();
  await page.keyboard.press('F6');
  await expect(inspector).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByText('Persist graph column preferences', { exact: true }).click();
  await inspector.locator('.commit-file').first().click();
  const diff = page.getByRole('region', { name: 'File changes' });
  await expect(diff).toBeVisible();

  await page.locator('#repository-reference-panel').focus();
  await page.keyboard.press('F6');
  await expect(diff).toBeFocused();
});

test('includes the visible terminal and announces the active inspector context', async ({ page }) => {
  const inspector = page.locator('#repository-commit-panel');
  await expect(inspector).toHaveAttribute('aria-label', 'Working directory inspector');

  await page.getByText('Polish repository activity drawer', { exact: true }).click();
  await expect(inspector).toHaveAttribute('aria-label', 'Commit inspector');

  await page.keyboard.press('Alt+T');
  const terminal = page.locator('.terminal-panel:not(.inactive)');
  await expect(terminal).toBeVisible();
  await expect(terminal).toHaveAttribute('aria-label', 'Repository terminals for git-khronos');

  await inspector.focus();
  await page.keyboard.press('F6');
  await expect(terminal).toBeFocused();
  await page.keyboard.press('F6');
  await expect(page.locator('.toolbar.workspace-focus-region')).toBeFocused();

  await terminal.evaluate((panel) => {
    const host = document.createElement('div');
    host.className = 'terminal-host active';
    host.append(document.createElement('textarea'));
    panel.append(host);
  });
  const terminalInput = terminal.locator('.terminal-host.active textarea');
  await inspector.focus();
  await page.keyboard.press('F6');
  await expect(terminalInput).toBeFocused();
  await page.keyboard.press('F6');
  await expect(page.locator('.toolbar.workspace-focus-region')).toBeFocused();
});

test('toggles the repository terminal with both advertised shortcuts', async ({ page }) => {
  const terminal = page.getByLabel('Repository terminals for git-khronos');
  const toggle = page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)');

  await expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Alt+T Control+` Meta+`');
  await page.keyboard.press('Control+Backquote');
  await expect(terminal).toBeVisible();
  await expect(page.getByTitle('Hide repository terminal (Alt+T or Ctrl+`)')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Control+Backquote');
  await expect(terminal).toBeHidden();
  await page.keyboard.press('Alt+T');
  await expect(terminal).toBeVisible();
});

test('text field Home and End shortcuts edit the field without selecting graph commits', async ({page}) => {
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.selectedCommit.set(app.git.repository().headOid);
  });
  const before = await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).selectedCommit());
  const search = page.getByPlaceholder('Filter references');
  await search.fill('main');
  await search.press('Control+Home');
  expect(await search.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(0);
  await search.press('Control+End');
  expect(await search.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(4);
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).selectedCommit())).toBe(before);
});
