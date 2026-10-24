import { expect, test, type Page } from '@playwright/test';

async function authenticationFixture(page: Page, options: { holdListener?: number; failListener?: number; failSnapshot?: boolean; failUnlistener?: number; queuedSnapshot?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await expect(page.locator('gc-authentication')).toBeAttached();
  await page.evaluate(options => {
    const state = window as any;
    const component = state.ng.getComponent(document.querySelector('gc-authentication'));
    const callbacks = new Map<number, (event: unknown) => void>();
    const handlers = new Map<string, (event: unknown) => void>();
    let callback = 100;
    state.authListeners = [];
    state.authUnlisteners = [];
    state.authAnswers = [];
    state.authReplies = [];
    state.authSnapshotCalls = 0;
    state.authConnectSettled = false;
    state.startAuthConnection = () => { void component.connect().then(() => { state.authConnectSettled = true; }); };
    state.destroyAuthentication = () => component.ngOnDestroy();
    state.receiveAuthentication = (id: string) => component.receive({ requestId: id, operationId: `operation-${id}`, repositoryId: null, secret: true });
    state.dismissAuthentication = (id: string) => component.dismiss(id);
    state.authComponent = component;
    state.emitAuthenticationEvent = (event: string, payload: unknown) => handlers.get(event)?.({ payload });
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    state.__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        if (command === 'plugin:event|listen') {
          state.authListeners.push(args.event);
          handlers.set(args.event, callbacks.get(args.handler)!);
          const id = state.authListeners.length;
          if (options.failListener === id) return Promise.reject(new Error('Fixture listener refused'));
          if (options.holdListener === id) return new Promise(resolve => { state.finishAuthListener = () => resolve(id); });
          return Promise.resolve(id);
        }
        if (command === 'plugin:event|unlisten') {
          state.authUnlisteners.push(args.eventId);
          return options.failUnlistener === args.eventId ? Promise.reject(new Error('Fixture teardown unavailable')) : Promise.resolve(null);
        }
        if (command === 'pending_authentication') {
          state.authSnapshotCalls += 1;
          return options.failSnapshot ? Promise.reject(new Error('Fixture snapshot unavailable')) : Promise.resolve(options.queuedSnapshot
            ? [{ requestId: 'preexisting', operationId: 'fixture-preexisting-operation', repositoryId: null, secret: true }] : []);
        }
        if (command === 'answer_authentication') {
          state.authAnswers.push(args);
          return new Promise((resolve, reject) => state.authReplies.push({ resolve, reject }));
        }
        return Promise.resolve(null);
      },
      transformCallback: (handler: (event: unknown) => void) => { callbacks.set(++callback, handler); return callback; },
      unregisterCallback: (id: number) => callbacks.delete(id),
    };
  }, options);
}

test('releases the first authentication listener if the second registration fails', async ({ page }) => {
  await authenticationFixture(page, { failListener: 2 });
  await page.evaluate(() => (window as any).startAuthConnection());
  await expect.poll(() => page.evaluate(() => (window as any).authConnectSettled)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).authUnlisteners)).toEqual([1]);
  expect(await page.evaluate(() => (window as any).authSnapshotCalls)).toBe(0);
});

test('loads a request that was already pending before authentication listeners connected', async ({ page }) => {
  await authenticationFixture(page, { queuedSnapshot: true });
  await page.evaluate(() => (window as any).startAuthConnection());
  await expect(page.getByRole('dialog', { name: 'Git authentication' })).toBeVisible();
  await expect(page.getByLabel('Password or key passphrase', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => (window as any).authComponent.prompt().requestId)).toBe('preexisting');
  await page.evaluate(() => (window as any).emitAuthenticationEvent('git-authentication-dismissed', 'preexisting'));
  await expect(page.getByRole('dialog', { name: 'Git authentication' })).not.toBeVisible();
});

test('announces a failed authentication module load without blocking the rest of the application', async ({ page }) => {
  let intercepted = false;
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'script') { await route.continue(); return; }
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('authentication-title') && body.includes('authentication-value')) {
      intercepted = true;
      await route.abort();
    } else {
      await route.fulfill({ response });
    }
  });
  await page.goto('/');
  const alert = page.locator('.authentication-load-error');
  await expect(alert).toContainText('Authentication interface could not load');
  expect(intercepted).toBe(true);
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await alert.getByRole('button', { name: 'Dismiss authentication loading error' }).click();
  await expect(alert).toHaveCount(0);
});

for (const held of [1, 2]) {
  test(`owns authentication listener ${held} across destruction while registration is pending`, async ({ page }) => {
    await authenticationFixture(page, { holdListener: held });
    await page.evaluate(() => (window as any).startAuthConnection());
    await expect.poll(() => page.evaluate(() => typeof (window as any).finishAuthListener)).toBe('function');
    await page.evaluate(() => (window as any).destroyAuthentication());
    if (held === 2) await expect.poll(() => page.evaluate(() => (window as any).authUnlisteners)).toEqual([1]);
    await page.evaluate(() => (window as any).finishAuthListener());
    await expect.poll(() => page.evaluate(() => (window as any).authConnectSettled)).toBe(true);
    expect(await page.evaluate(() => (window as any).authListeners.length)).toBe(held);
    await expect.poll(() => page.evaluate(() => (window as any).authUnlisteners)).toEqual(held === 1 ? [1] : [1, 2]);
    expect(await page.evaluate(() => (window as any).authSnapshotCalls)).toBe(0);
  });
}

test('keeps successfully registered authentication listeners if only the pending snapshot fails', async ({ page }) => {
  await authenticationFixture(page, { failSnapshot: true });
  await page.evaluate(() => (window as any).startAuthConnection());
  await expect.poll(() => page.evaluate(() => (window as any).authConnectSettled)).toBe(true);
  expect(await page.evaluate(() => (window as any).authUnlisteners)).toEqual([]);
  await page.evaluate(() => (window as any).emitAuthenticationEvent('git-authentication-prompt', {
    requestId: 'event-after-snapshot-failure', operationId: 'fixture-operation', repositoryId: null, secret: true,
  }));
  await expect(page.getByRole('dialog', { name: 'Git authentication' })).toBeVisible();
  await page.evaluate(() => (window as any).emitAuthenticationEvent('git-authentication-dismissed', 'event-after-snapshot-failure'));
  await expect(page.getByRole('dialog', { name: 'Git authentication' })).not.toBeVisible();
  await page.evaluate(() => (window as any).destroyAuthentication());
  await expect.poll(() => page.evaluate(() => (window as any).authUnlisteners)).toEqual([1, 2]);
});

test('a rejected authentication unlisten does not skip other listeners or leak an unhandled rejection', async ({ page }) => {
  await authenticationFixture(page, { failUnlistener: 1 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => (window as any).startAuthConnection());
  await expect.poll(() => page.evaluate(() => (window as any).authConnectSettled)).toBe(true);
  await page.evaluate(async () => {
    (window as any).destroyAuthentication();
    await new Promise(resolve => setTimeout(resolve, 0));
    (window as any).destroyAuthentication();
  });
  expect(await page.evaluate(() => (window as any).authUnlisteners)).toEqual([1, 2]);
  expect(errors).toEqual([]);
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`an old authentication reply cannot clear a newer pending submission after ${outcome}`, async ({ page }) => {
    await authenticationFixture(page);
    await page.evaluate(() => {
      (window as any).receiveAuthentication('old');
      (window as any).receiveAuthentication('new');
    });
    const secret = page.getByLabel('Password or key passphrase', { exact: true });
    await secret.fill('fixture-old-answer');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).authAnswers.length)).toBe(1);
    await page.evaluate(() => (window as any).dismissAuthentication('old'));
    await expect(secret).toBeEnabled();
    await expect(secret).toHaveValue('');
    await secret.fill('fixture-new-answer');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).authAnswers.length)).toBe(2);
    await page.evaluate(outcome => (window as any).authReplies[0][outcome](outcome === 'reject' ? new Error('Old reply expired') : null), outcome);
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.evaluate(() => (window as any).authComponent.answer('fixture-duplicate-answer'));
    expect(await page.evaluate(() => (window as any).authAnswers)).toEqual([
      { requestId: 'old', answer: 'fixture-old-answer' }, { requestId: 'new', answer: 'fixture-new-answer' },
    ]);
    await page.evaluate(() => (window as any).authReplies[1].resolve(null));
    await expect(page.getByRole('dialog', { name: 'Git authentication' })).not.toBeVisible();
  });
}

test('ignores a late answer failure after authentication component destruction', async ({ page }) => {
  await authenticationFixture(page);
  await page.evaluate(() => (window as any).receiveAuthentication('destroyed'));
  await page.getByLabel('Password or key passphrase', { exact: true }).fill('fixture-answer');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.evaluate(async () => {
    const state = window as any;
    state.destroyAuthentication();
    state.authReplies[0].reject(new Error('Late fixture failure'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => ({ error: (window as any).authComponent.error(), sending: (window as any).authComponent.sending() })))
    .toEqual({ error: null, sending: false });
});

test('a failed cancellation dismisses the prompt and reports that cancellation was not confirmed', async ({ page }) => {
  await authenticationFixture(page);
  await page.evaluate(() => (window as any).receiveAuthentication('expired'));
  await page.getByLabel('Password or key passphrase', { exact: true }).fill('fixture-not-submitted');
  await page.getByRole('button', { name: 'Cancel operation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).authAnswers)).toEqual([{ requestId: 'expired', answer: null }]);
  await page.evaluate(() => (window as any).authReplies[0].reject(new Error('Fixture cancellation unavailable')));
  await expect(page.getByRole('dialog', { name: 'Git authentication' })).not.toBeVisible();
  await expect(page.locator('.error-toast')).toContainText('could not confirm cancellation');
  expect(await page.evaluate(() => (window as any).authComponent.value())).toBe('');
});
