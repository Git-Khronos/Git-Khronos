import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { calls: [] as any[], fail: false, hold: false, finish: null as any, reject: null as any,
      report: { passed: true, exitCode: 0, stdout: '', stderr: '', truncated: false } };
    (window as any).__integrity = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'inspect_repository_integrity') {
        if (fixture.fail) return Promise.reject({ kind: 'integrityScopeUnsupported', message: 'Partial clones require a separate integrity workflow.', hint: 'No promised objects were fetched.' });
        if (fixture.hold) return new Promise((resolve, reject) => { fixture.finish = () => resolve(fixture.report); fixture.reject = reject; });
        return Promise.resolve(fixture.report);
      }
      if (command === 'perform_repository_maintenance') {
        if (fixture.hold) return new Promise((resolve, reject) => { fixture.finish = () => resolve(undefined); fixture.reject = reject; });
        if (fixture.fail) return Promise.reject({ kind: 'maintenanceIntegrityFailed', message: 'Maintenance was not started because integrity failed.', hint: 'No maintenance task, pruning or repair was requested.' });
        return Promise.resolve();
      }
      if (command === 'cancel_git_operation') {
        fixture.reject({ kind: 'operationCancelled', message: 'Integrity inspection was cancelled.', hint: 'No complete result is available.' });
        return Promise.resolve(true);
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await expect(page.locator('gc-integrity-panel')).toBeVisible();
}

test('inspection is explicit, distinguishes complete findings and truncated results, and never runs maintenance', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-integrity-panel');
  expect(await page.evaluate(() => (window as any).__integrity.calls.some((call: any) => call.command === 'inspect_repository_integrity'))).toBe(false);
  await panel.getByRole('button', { name: 'Inspect integrity', exact: true }).click();
  await expect(panel).toContainText('without reported integrity errors');
  await expect(panel).toContainText('No output reported');
  await page.evaluate(() => { (window as any).__integrity.report = { passed: false, exitCode: 2, stdout: 'missing blob abc', stderr: 'error: object file is empty', truncated: false }; });
  await panel.getByRole('button', { name: 'Inspect integrity', exact: true }).click();
  await expect(panel).toContainText('findings or a check failure');
  await expect(panel.getByLabel('Integrity standard output')).toContainText('missing blob');
  await expect(panel.getByLabel('Integrity diagnostic output')).toContainText('is empty');
  await page.evaluate(() => { (window as any).__integrity.report = { passed: false, exitCode: 0, stdout: 'partial output', stderr: '', truncated: true }; });
  await panel.getByRole('button', { name: 'Inspect integrity', exact: true }).click();
  await expect(panel).toContainText('Incomplete report');
  await expect(panel).not.toContainText('without reported integrity errors');
  const commands = await page.evaluate(() => (window as any).__integrity.calls.map((call: any) => call.command));
  expect(commands.filter((command: string) => command === 'inspect_repository_integrity')).toHaveLength(3);
  expect(commands.every((command: string) => ['inspect_repository_integrity', 'refresh_repository_status', 'refresh_repository_metadata'].includes(command))).toBe(true);
});

test('pending inspection shares busy state, cancellation and explicit retry without claiming success', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-integrity-panel');
  await page.evaluate(() => { (window as any).__integrity.hold = true; });
  await panel.getByRole('button', { name: 'Inspect integrity', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Inspecting');
  await expect(panel.getByRole('button', { name: 'Learn about integrity and maintenance…' })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(true);
  await panel.getByRole('button', { name: 'Cancel inspection', exact: true }).click();
  await expect(panel).not.toContainText('without reported integrity errors');
  await expect(panel.getByRole('button', { name: 'Inspect integrity', exact: true })).toBeEnabled();
  await expect(panel.getByRole('alert')).toContainText('cancel');
  await page.evaluate(() => { (window as any).__integrity.hold = false; (window as any).__integrity.fail = true; });
  await panel.getByRole('button', { name: 'Inspect integrity', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Partial clones');
  await expect(panel.getByRole('alert')).toContainText('No promised objects were fetched');
  await page.evaluate(() => { (window as any).__integrity.fail = false; });
  await panel.getByRole('button', { name: 'Inspect integrity', exact: true }).click();
  await expect(panel).toContainText('without reported integrity errors');
});

test('inspection report never appears in another repository and contextual help restores the opener', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-integrity-panel');
  await page.evaluate(() => { (window as any).__integrity.hold = true; });
  await panel.getByRole('button', { name: 'Inspect integrity', exact: true }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other-integrity', path: '/other-integrity', name: 'other-integrity' }]);
    git.activeRepositoryId.set('other-integrity');
  });
  await page.evaluate(() => { (window as any).__integrity.finish(); });
  await expect(panel).not.toContainText('without reported integrity errors');
  const help = panel.getByRole('button', { name: 'Learn about integrity and maintenance…', exact: true });
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Git command reference', exact: true })).toContainText('Inspect integrity');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
});

test('integrity import failure is explicit and preferences remain usable without starting a check', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Inspect integrity') && text.includes('inspect_repository_integrity')) await route.abort();
    else await route.fulfill({ response, body: text });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /^Git/ }).click();
  await expect(preferences.getByRole('alert')).toContainText('Repository tools unavailable');
  await expect(preferences.getByRole('button', { name: 'Git command reference…', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(preferences).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeFocused();
});

test('long integrity diagnostics fit compact preferences and cannot obscure keyboard-focused controls', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 820, height: 720 });
  const panel = page.locator('gc-integrity-panel');
  await page.evaluate(() => { (window as any).__integrity.report = {
    passed: false, exitCode: 2, stdout: 'missing blob ' + 'a'.repeat(2000),
    stderr: 'inspect the object store', truncated: false,
  }; });
  const inspect = panel.getByRole('button', { name: 'Inspect integrity', exact: true });
  await inspect.click();
  await expect(panel.getByLabel('Integrity standard output')).toContainText('missing blob');
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await inspect.focus();
  await expect(inspect).toBeFocused();
  const help = panel.getByRole('button', { name: 'Learn about integrity and maintenance…', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Git command reference', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
});

test('non-pruning maintenance requires review, retains refusal feedback and succeeds only on explicit retry', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-integrity-panel');
  await panel.locator('summary').click();
  await expect(panel).toContainText('No garbage collection, object pruning');
  await panel.getByRole('button', { name: 'Review maintenance', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__integrity.calls.some((call: any) => call.command === 'perform_repository_maintenance'))).toBe(false);
  await panel.getByRole('button', { name: 'Cancel maintenance', exact: true }).click();
  await panel.getByRole('button', { name: 'Review maintenance', exact: true }).click();
  await page.evaluate(() => { (window as any).__integrity.fail = true; });
  await panel.getByRole('button', { name: 'Run maintenance', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('No maintenance task');
  await page.evaluate(() => { (window as any).__integrity.fail = false; });
  await panel.getByRole('button', { name: 'Review maintenance', exact: true }).click();
  await panel.getByRole('button', { name: 'Run maintenance', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Repository maintenance complete/ })).toBeVisible();
  const commands = await page.evaluate(() => (window as any).__integrity.calls.map((call: any) => call.command));
  expect(commands.filter((command: string) => command === 'perform_repository_maintenance')).toHaveLength(2);
  expect(commands).not.toContain('lfs_prune');
});

test('maintenance prevents duplicate operations and invalidates review and late feedback across repositories', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-integrity-panel');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'Review maintenance', exact: true }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other-maintenance', path: '/other-maintenance', name: 'other-maintenance' }]);
    git.activeRepositoryId.set('other-maintenance');
  });
  await expect(panel.getByRole('button', { name: 'Run maintenance', exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__integrity.hold = true; });
  await panel.getByRole('button', { name: 'Review maintenance', exact: true }).click();
  await panel.getByRole('button', { name: 'Run maintenance', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Checking integrity');
  await expect(panel.getByRole('button', { name: 'Review maintenance', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Inspect integrity', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Learn about integrity and maintenance…' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Cancel inspection', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.activeRepositoryId.set(git.repositories()[0].id);
    (window as any).__integrity.reject({ kind: 'gitFailure', message: 'Old repository maintenance failed.', hint: 'Inspect partial effects.' });
  });
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Review maintenance', exact: true })).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).__integrity.calls.filter((call: any) => call.command === 'perform_repository_maintenance'));
  expect(calls).toHaveLength(1);
  expect(calls[0].args.repoId).toBe('other-maintenance');
});
