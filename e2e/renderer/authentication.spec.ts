import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('gc-authentication')).toBeAttached();
  await page.evaluate(() => {
    (window as any).__authAnswers = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: unknown) => {
        if (command === 'answer_authentication') {
          (window as any).__authAnswers.push(args);
          return;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    const component = (window as any).ng.getComponent(document.querySelector('gc-authentication'));
    component.receive({ requestId: 'auth-1', operationId: 'operation-1', repositoryId: null, secret: false });
  });
});

test('asks for credentials, masks secrets, clears answers, and supports retry', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Git authentication' });
  await expect(dialog).toBeVisible();
  const username = page.getByLabel('Username', { exact: true });
  await expect(username).toBeFocused();
  await username.fill('fixture-user');
  await username.press('Enter');
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() => {
    const component = (window as any).ng.getComponent(document.querySelector('gc-authentication'));
    component.receive({ requestId: 'auth-2', operationId: 'operation-1', repositoryId: null, secret: true });
  });
  const secret = page.getByLabel('Password or key passphrase', { exact: true });
  await expect(secret).toHaveAttribute('type', 'password');
  await expect(secret).toHaveValue('');
  await secret.fill('fixture-secret');
  await secret.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(secret).toBeFocused();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__authAnswers)).toEqual([
    { requestId: 'auth-1', answer: 'fixture-user' },
    { requestId: 'auth-2', answer: 'fixture-secret' },
  ]);
  await page.evaluate(() => {
    const component = (window as any).ng.getComponent(document.querySelector('gc-authentication'));
    component.receive({ requestId: 'auth-3', operationId: 'operation-1', repositoryId: null, secret: true });
  });
  await expect(secret).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__authAnswers.at(-1)))
    .toEqual({ requestId: 'auth-3', answer: null });
});

test('dismissal clears secrets and queued repository prompts remain separate', async ({ page }) => {
  await page.evaluate(() => {
    const component = (window as any).ng.getComponent(document.querySelector('gc-authentication'));
    component.receive({ requestId: 'auth-2', operationId: 'operation-2', repositoryId: 'other', secret: true });
    component.dismiss('auth-1');
  });
  const secret = page.getByLabel('Password or key passphrase', { exact: true });
  await secret.fill('must-not-persist');
  await page.evaluate(() => {
    const component = (window as any).ng.getComponent(document.querySelector('gc-authentication'));
    component.dismiss('auth-2');
    component.receive({ requestId: 'auth-3', operationId: 'operation-3', repositoryId: null, secret: true });
  });
  await expect(secret).toHaveValue('');
  await expect(secret).toBeFocused();
  await page.getByRole('button', { name: 'Cancel operation' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('shows bounded submission feedback and actionable errors without retaining an answer', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__TAURI_INTERNALS__.invoke = () => new Promise((_, reject) => {
      (window as any).__authAnswerReject = reject;
    });
  });
  await page.getByLabel('Username', { exact: true }).fill('fixture-user');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue('');
  await page.evaluate(() => (window as any).__authAnswerReject(new Error('expired')));
  await expect(page.getByRole('alert')).toContainText('Cancel and retry');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue('');
});
