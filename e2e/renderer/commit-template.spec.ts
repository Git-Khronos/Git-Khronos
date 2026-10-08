import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, template: string | null, unavailable = false): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(({ template, unavailable }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.repositories.update((items: any[]) => items.map(item => ({ ...item,
      commitTemplate: template,
      commitTemplateError: unavailable ? { kind: 'commitTemplateUnavailable',
        message: 'Could not open the configured commit template.', hint: 'Check the file, then refresh. No message or Git configuration was changed.' } : null,
      status: { ...item.status, staged: 1 } })));
    app.commitMessage.set('');
    app.commitDescription.set('');
    app.coAuthors.set([]);
    app.applyCommitTemplate();
    const fixture = { calls: [] as any[], nextTemplate: 'Repaired summary\n\nRepaired body\n',
      hold: false, finish: null as any, holdRefresh: false, finishRefresh: null as any };
    (window as any).__commitTemplate = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'refresh_repository') {
        const snapshot = { ...git.repository(), commitTemplate: fixture.nextTemplate, commitTemplateError: null };
        return fixture.holdRefresh ? new Promise(resolve => { fixture.finishRefresh = () => resolve(snapshot); }) : Promise.resolve(snapshot);
      }
      if (command === 'commit_changes') {
        const snapshot = { ...git.repository(), headOid: 'e'.repeat(40),
          status: { ...git.repository().status, staged: 0 } };
        return fixture.hold ? new Promise(resolve => { fixture.finish = () => resolve(snapshot); }) : Promise.resolve(snapshot);
      }
      if (command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  }, { template, unavailable });
}

test('template reload requires confirmation, preserves literal headings and leaves commit policy unchanged', async ({ page }) => {
  await setup(page, '# Literal heading\n\nTemplate body\n\nCo-authored-by: Template Partner <partner@example.test>\n');
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('# Literal heading');
  await expect(page.getByLabel('Commit description', { exact: true })).toHaveValue('Template body');
  await expect(page.locator('.coauthor-chips')).toContainText('Template Partner');
  await page.getByLabel('Commit summary', { exact: true }).fill('Entered summary');
  await page.getByLabel('Commit description', { exact: true }).fill('Entered body');
  await page.locator('.commit-policy summary').click();
  await page.getByLabel('Add Signed-off-by trailer', { exact: true }).check();
  const reload = page.getByRole('button', { name: 'Reload template', exact: true });
  await reload.click();
  await expect(page.getByRole('group', { name: 'Replace draft with template', exact: true })).toBeVisible();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Entered summary');
  await page.keyboard.press('Escape');
  await expect(reload).toBeFocused();
  await expect(page.getByLabel('Commit description', { exact: true })).toHaveValue('Entered body');
  await reload.click();
  await page.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await expect(reload).toBeFocused();
  await reload.click();
  await page.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('# Literal heading');
  await expect(page.getByLabel('Commit description', { exact: true })).toHaveValue('Template body');
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).toBeChecked();
  await expect(page.locator('.coauthor-chips')).toContainText('Template Partner');
  expect(await page.evaluate(() => (window as any).__commitTemplate.calls.filter((call: any) =>
    call.command !== 'refresh_repository_status' && call.command !== 'refresh_repository_metadata'))).toEqual([]);
});

test('unreadable template remains visible and refresh repair preserves the entered draft until confirmed reload', async ({ page }) => {
  await setup(page, null, true);
  await page.getByLabel('Commit summary', { exact: true }).fill('Keep my draft');
  const banner = page.locator('gc-commit-template-banner');
  await expect(banner.getByRole('alert')).toContainText('Could not open');
  await expect(banner.getByRole('alert')).toContainText('No message or Git configuration was changed');
  await banner.getByRole('button', { name: 'Refresh template status', exact: true }).click();
  await expect(banner.getByRole('alert')).toHaveCount(0);
  await expect(banner.getByRole('button', { name: 'Reload template', exact: true })).toBeFocused();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Keep my draft');
  await banner.getByRole('button', { name: 'Reload template', exact: true }).click();
  await banner.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Repaired summary');
  await expect(page.getByLabel('Commit description', { exact: true })).toHaveValue('Repaired body');
  const help = banner.getByRole('button', { name: 'Learn about commit templates…', exact: true });
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Git command reference', exact: true }).locator('details[open]')).toContainText('Commit');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  expect(await page.evaluate(() => (window as any).__commitTemplate.calls.map((call: any) => call.command)
    .filter((command: string) => command !== 'refresh_repository_status' && command !== 'refresh_repository_metadata'))).toEqual(['refresh_repository']);
});

test('template confirmation does not carry into another repository and reload is disabled while committing', async ({ page }) => {
  await setup(page, 'Original template\n');
  await page.getByRole('button', { name: 'Reload template', exact: true }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(),
      id: 'other-template', path: '/other-template', name: 'other-template', commitTemplate: 'Other template\n' }]);
  });
  await page.locator('[data-repository-tab-id="other-template"]').click();
  await expect(page.getByRole('group', { name: 'Replace draft with template', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Other template');
  await page.getByLabel('Commit summary', { exact: true }).fill('Pending draft');
  await page.evaluate(() => { (window as any).__commitTemplate.hold = true; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.getByRole('button', { name: 'Reload template', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Learn about commit templates…', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__commitTemplate.finish(); });
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Other template');
});

test('pending template repair disables retry and never steals focus from a draft edited while waiting', async ({ page }) => {
  await setup(page, null, true);
  await page.evaluate(() => { (window as any).__commitTemplate.holdRefresh = true; });
  const retry = page.getByRole('button', { name: 'Refresh template status', exact: true });
  await retry.click();
  await expect(retry).toBeDisabled();
  const summary = page.getByLabel('Commit summary', { exact: true });
  await summary.fill('Edited while awaiting template status');
  await page.evaluate(() => { (window as any).__commitTemplate.finishRefresh(); });
  await expect(page.locator('gc-commit-template-banner').getByRole('alert')).toHaveCount(0);
  await expect(summary).toBeFocused();
  await expect(summary).toHaveValue('Edited while awaiting template status');
});

test('empty configured template is disclosed and clearing the draft still requires explicit confirmation', async ({ page }) => {
  await setup(page, '');
  await page.setViewportSize({ width: 820, height: 720 });
  await page.getByLabel('Commit summary', { exact: true }).fill('Keep until confirmed');
  await expect(page.locator('gc-commit-template-banner')).toContainText('empty after removing guidance');
  expect(await page.locator('gc-commit-template-banner').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Reload template', exact: true }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Keep until confirmed');
  await page.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
  await expect(page.locator('.commit-form button[type=submit]')).toBeDisabled();
});

test('template chunk failure leaves a usable draft and explicit feedback without executing Git', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Commit template unavailable') && text.includes('Replace draft')) await route.abort();
    else await route.fulfill({ response, body: text });
  });
  await setup(page, 'Configured template\n');
  await page.getByLabel('Commit summary', { exact: true }).fill('Draft survives import failure');
  await expect(page.locator('.commit-form [role=alert]')).toContainText('draft is unchanged');
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Draft survives import failure');
  await expect(page.locator('.commit-form button[type=submit]')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__commitTemplate.calls.filter((call: any) =>
    call.command !== 'refresh_repository_status' && call.command !== 'refresh_repository_metadata'))).toEqual([]);
});
