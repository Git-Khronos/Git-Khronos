import { expect, test, type Page } from '@playwright/test';

async function pendingTerminalInput(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    const app = state.ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.set({ appVersion: 'renderer test', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' });
    let sequence = 0;
    let callback = 100;
    state.terminalWrites = [];
    state.terminalWriteReplies = [];
    state.terminalCloseRequests = [];
    state.inputTerminal = (id: string, data: string) => {
      const panel = state.ng.getComponent(document.querySelector('gc-terminal-panel'));
      panel.tabs().find((tab: any) => tab.id === id).terminal.input(data, true);
    };
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    state.__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        if (command === 'open_terminal') return Promise.resolve({ id: `input-${++sequence}`, label: 'bash', cwd: '/fixture' });
        if (command === 'write_terminal') {
          state.terminalWrites.push({ id: args.sessionId, data: new TextDecoder().decode(new Uint8Array(args.data)) });
          return new Promise((resolve, reject) => state.terminalWriteReplies.push({ resolve, reject }));
        }
        if (command === 'close_terminal') {
          state.terminalCloseRequests.push(args.sessionId);
          if (state.holdTerminalClose) return new Promise((resolve, reject) => {
            state.finishTerminalClose = resolve;
            state.failTerminalClose = reject;
          });
          return Promise.resolve(null);
        }
        if (command === 'plugin:event|listen') return Promise.resolve(++callback);
        return Promise.resolve(null);
      },
      transformCallback: () => ++callback,
      unregisterCallback: () => undefined,
    };
  });
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  await expect(page.locator('gc-terminal-panel').getByRole('tab', { name: 'bash 1', exact: true })).toBeVisible();
}

async function failNextTerminalStartup(page: Page, stage: 'loadAddon' | 'open', disposeThrows = false): Promise<void> {
  await page.evaluate(({ stage, disposeThrows }) => {
    const state = window as any;
    const panel = state.ng.getComponent(document.querySelector('gc-terminal-panel'));
    const prototype = Object.getPrototypeOf(panel.tabs()[0].terminal);
    const original = prototype[stage];
    state.failedTerminalDisposeCalls = 0;
    prototype[stage] = function (...args: any[]) {
      prototype[stage] = original;
      const dispose = this.dispose.bind(this);
      this.dispose = () => {
        state.failedTerminalDisposeCalls += 1;
        dispose();
        if (disposeThrows) throw new Error('Renderer disposal failed');
      };
      if (stage === 'open') original.apply(this, args);
      throw new Error(`Terminal ${stage} failed`);
    };
  }, { stage, disposeThrows });
}

for (const stage of ['loadAddon', 'open'] as const) {
  test(`cleans up a native session after terminal ${stage} fails and permits an explicit retry`, async ({ page }) => {
    await pendingTerminalInput(page);
    const panel = page.locator('gc-terminal-panel');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await failNextTerminalStartup(page, stage);
    await panel.getByRole('button', { name: 'New terminal tab' }).click();
    await expect(panel.getByRole('status')).toContainText(`Terminal ${stage} failed`);
    await expect.poll(() => page.evaluate(() => (window as any).terminalCloseRequests)).toEqual(['input-2']);
    await expect.poll(() => page.evaluate(() => (window as any).failedTerminalDisposeCalls)).toBe(1);
    await expect(panel.getByRole('tab')).toHaveCount(1);
    await expect(panel.getByRole('tab', { name: 'bash 1', exact: true })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(panel.locator('[data-terminal-id="input-3"] .xterm-screen')).toBeVisible();
    await expect(panel.getByRole('tab')).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}

test('retains failed startup cleanup for retry even when renderer disposal also throws', async ({ page }) => {
  await pendingTerminalInput(page);
  const panel = page.locator('gc-terminal-panel');
  await failNextTerminalStartup(page, 'loadAddon', true);
  await page.evaluate(() => { (window as any).holdTerminalClose = true; });
  await panel.getByRole('button', { name: 'New terminal tab' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).failTerminalClose)).toBe('function');
  await page.evaluate(() => (window as any).failTerminalClose(new Error('Native cleanup was refused')));
  await expect(panel.getByRole('status')).toContainText('Terminal loadAddon failed');
  await expect(panel.getByRole('status')).toContainText('Native cleanup was refused');
  await expect(panel.getByRole('tab')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'New terminal tab' })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).failedTerminalDisposeCalls)).toBe(1);
  await page.evaluate(() => { (window as any).holdTerminalClose = false; });
  await panel.getByRole('button', { name: 'Retry closing terminal', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Terminal loadAddon failed');
  await expect(panel.getByRole('status')).not.toContainText('Native cleanup was refused');
  expect(await page.evaluate(() => (window as any).terminalCloseRequests)).toEqual(['input-2', 'input-2']);
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(panel.locator('[data-terminal-id="input-3"] .xterm-screen')).toBeVisible();
});

test('closing the repository also retries native cleanup for a failed terminal startup', async ({ page }) => {
  await pendingTerminalInput(page);
  const panel = page.locator('gc-terminal-panel');
  await failNextTerminalStartup(page, 'loadAddon');
  await page.evaluate(() => { (window as any).holdTerminalClose = true; });
  await panel.getByRole('button', { name: 'New terminal tab' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).failTerminalClose)).toBe('function');
  await page.evaluate(() => (window as any).failTerminalClose(new Error('Native cleanup was refused')));
  await expect(panel.getByRole('button', { name: 'Retry closing terminal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close git-khronos', exact: true }).click({ force: true });
  await expect(panel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).terminalCloseRequests)).toEqual(['input-2', 'input-1', 'input-2']);
});

test('serializes input per terminal without blocking another terminal tab', async ({ page }) => {
  await pendingTerminalInput(page);
  await page.evaluate(() => {
    (window as any).inputTerminal('input-1', 'first π');
    (window as any).inputTerminal('input-1', 'second');
  });
  await expect.poll(() => page.evaluate(() => (window as any).terminalWrites)).toEqual([{ id: 'input-1', data: 'first π' }]);
  await page.locator('gc-terminal-panel').getByRole('button', { name: 'New terminal tab' }).click();
  await expect(page.locator('gc-terminal-panel').getByRole('tab', { name: 'bash 2', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).inputTerminal('input-2', 'other tab'));
  await expect.poll(() => page.evaluate(() => (window as any).terminalWrites)).toEqual([
    { id: 'input-1', data: 'first π' }, { id: 'input-2', data: 'other tab' },
  ]);
  await page.evaluate(() => (window as any).terminalWriteReplies[0].resolve(null));
  await expect.poll(() => page.evaluate(() => (window as any).terminalWrites)).toEqual([
    { id: 'input-1', data: 'first π' }, { id: 'input-2', data: 'other tab' }, { id: 'input-1', data: 'second' },
  ]);
});

test('drops queued input and ignores late write errors for a closed terminal tab', async ({ page }) => {
  await pendingTerminalInput(page);
  const panel = page.locator('gc-terminal-panel');
  await panel.getByRole('button', { name: 'New terminal tab' }).click();
  await expect(panel.getByRole('tab', { name: 'bash 2', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).inputTerminal('input-1', 'pending');
    (window as any).inputTerminal('input-1', 'queued');
  });
  await expect.poll(() => page.evaluate(() => (window as any).terminalWrites.length)).toBe(1);
  await page.evaluate(() => { (window as any).holdTerminalClose = true; });
  await panel.getByRole('button', { name: 'Close bash 1', exact: true }).click({ force: true });
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishTerminalClose)).toBe('function');
  await page.evaluate(async () => {
    (window as any).terminalWriteReplies[0].reject(new Error('Closed terminal write failed'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(panel).not.toContainText('Closed terminal write failed');
  expect(await page.evaluate(() => (window as any).terminalWrites)).toEqual([{ id: 'input-1', data: 'pending' }]);
  await page.evaluate(() => (window as any).finishTerminalClose(null));
  await expect(panel.getByRole('tab')).toHaveCount(1);
});

test('does not send the queued suffix after a write failure but allows explicit new input', async ({ page }) => {
  await pendingTerminalInput(page);
  await page.evaluate(() => {
    (window as any).inputTerminal('input-1', 'pending');
    (window as any).inputTerminal('input-1', 'unsafe suffix');
  });
  await expect.poll(() => page.evaluate(() => (window as any).terminalWrites.length)).toBe(1);
  await page.evaluate(async () => {
    (window as any).terminalWriteReplies[0].reject(new Error('Terminal write failed'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(page.locator('gc-terminal-panel')).toContainText('Terminal write failed');
  expect(await page.evaluate(() => (window as any).terminalWrites.length)).toBe(1);
  await page.evaluate(() => (window as any).inputTerminal('input-1', 'explicit new input'));
  await expect.poll(() => page.evaluate(() => (window as any).terminalWrites)).toEqual([
    { id: 'input-1', data: 'pending' }, { id: 'input-1', data: 'explicit new input' },
  ]);
});

test('retains the terminal screen after a close failure and retries the intended tab', async ({ page }) => {
  await pendingTerminalInput(page);
  const panel = page.locator('gc-terminal-panel');
  await panel.locator('[data-terminal-id="input-1"] .xterm-screen').evaluate(element => element.setAttribute('data-retained-screen', 'true'));
  await panel.getByRole('button', { name: 'New terminal tab' }).click();
  await expect(panel.getByRole('tab', { name: 'bash 2', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).holdTerminalClose = true; });
  await panel.getByRole('button', { name: 'Close bash 1', exact: true }).click({ force: true });
  await expect.poll(() => page.evaluate(() => typeof (window as any).failTerminalClose)).toBe('function');
  await page.evaluate(() => (window as any).failTerminalClose(new Error('Terminal close was refused')));
  await expect(panel.getByRole('status')).toContainText('Terminal close was refused');
  await expect(panel.getByRole('tab')).toHaveCount(2);
  await expect(panel.locator('[data-retained-screen="true"]')).toHaveCount(1);
  await expect(panel.getByRole('tab', { name: 'bash 2', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => { (window as any).holdTerminalClose = false; });
  await panel.getByRole('button', { name: 'Retry closing terminal', exact: true }).click();
  await expect(panel.getByRole('tab')).toHaveCount(1);
  await expect(panel.getByRole('tab', { name: 'bash 2', exact: true })).toBeVisible();
  await expect(panel.locator('.terminal-error')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).terminalCloseRequests)).toEqual(['input-1', 'input-1']);
});

test('a refused close discards pre-close queued input without replaying it', async ({ page }) => {
  await pendingTerminalInput(page);
  const panel = page.locator('gc-terminal-panel');
  await page.evaluate(() => {
    (window as any).inputTerminal('input-1', 'pending');
    (window as any).inputTerminal('input-1', 'unsafe pre-close suffix');
    (window as any).holdTerminalClose = true;
  });
  await expect.poll(() => page.evaluate(() => (window as any).terminalWrites.length)).toBe(1);
  await panel.getByRole('button', { name: 'Close bash 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).failTerminalClose)).toBe('function');
  await page.evaluate(() => (window as any).failTerminalClose(new Error('Terminal close failed')));
  await expect(panel).toContainText('Terminal close failed');
  await page.evaluate(async () => {
    (window as any).terminalWriteReplies[0].resolve(null);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => (window as any).terminalWrites)).toEqual([{ id: 'input-1', data: 'pending' }]);
  await page.evaluate(() => (window as any).inputTerminal('input-1', 'explicit new input'));
  await expect.poll(() => page.evaluate(() => (window as any).terminalWrites)).toEqual([
    { id: 'input-1', data: 'pending' }, { id: 'input-1', data: 'explicit new input' },
  ]);
});

test('retains startup output and the exited state when a shell exits before its open reply', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    const app = state.ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.set({ appVersion: 'renderer test', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' });
    let nextId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const handlers = new Map<string, (event: unknown) => void>();
    state.sendTerminalEvent = (name: string, payload: unknown) => handlers.get(name)?.({ payload });
    state.terminalResizeCalls = 0;
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    state.__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        if (command === 'open_terminal') return new Promise(resolve => { state.finishTerminalStartup = resolve; });
        if (command === 'resize_terminal') state.terminalResizeCalls += 1;
        if (command === 'plugin:event|listen') {
          handlers.set(args.event, callbacks.get(args.handler)!);
          return Promise.resolve(++nextId);
        }
        return Promise.resolve(null);
      },
      transformCallback: (callback: (event: unknown) => void) => {
        callbacks.set(++nextId, callback);
        return nextId;
      },
      unregisterCallback: () => undefined,
    };
  });
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishTerminalStartup)).toBe('function');
  await page.evaluate(() => {
    const state = window as any;
    state.sendTerminalEvent('terminal-output', { sessionId: 'early-exit', data: [...new TextEncoder().encode('startup output\r\n')] });
    state.sendTerminalEvent('terminal-exit', { sessionId: 'early-exit' });
    state.finishTerminalStartup({ id: 'early-exit', label: 'bash', cwd: '/fixture' });
  });
  const panel = page.locator('gc-terminal-panel');
  await expect(panel.locator('.terminal-tab')).toHaveClass(/ended/);
  await expect.poll(() => panel.evaluate(element => {
    const buffer = (window as any).ng.getComponent(element).tabs()[0].terminal.buffer.active;
    return Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index).translateToString(true)).join('\n');
  })).toMatch(/startup output[\s\S]*\[Process exited\]/);
  expect(await page.evaluate(() => (window as any).terminalResizeCalls)).toBe(0);
});

test('preserves the native terminal screen when minimizing and restoring the panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    const app = state.ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.set({ appVersion: 'renderer test', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' });
    let nextId = 0;
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    state.__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'open_terminal') return Promise.resolve({ id: 'screen-session', label: 'bash', cwd: '/fixture' });
        if (command === 'plugin:event|listen') return Promise.resolve(++nextId);
        return Promise.resolve(null);
      },
      transformCallback: () => ++nextId,
      unregisterCallback: () => undefined,
    };
  });
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  const panel = page.locator('gc-terminal-panel');
  const screen = panel.locator('.xterm-screen');
  await expect(screen).toBeVisible();
  await screen.evaluate(element => element.setAttribute('data-screen-retained', 'true'));
  await panel.getByRole('button', { name: 'Minimize terminal' }).click();
  await expect(screen).toBeHidden();
  await panel.getByRole('button', { name: 'Restore terminal' }).click();
  await expect(panel.locator('.xterm-screen[data-screen-retained="true"]')).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'bash 1', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('preserves new terminal tabs and closed tabs when close responses arrive out of order', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    const app = state.ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.set({ appVersion: 'renderer test', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' });
    let nextSession = 0;
    let nextCallback = 100;
    const callbacks = new Map<number, (event: unknown) => void>();
    const closes = new Map<string, () => void>();
    state.resolveTerminalClose = (id: string) => closes.get(id)?.();
    state.pendingTerminalCloses = () => [...closes.keys()];
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    state.__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        if (command === 'open_terminal') return Promise.resolve({ id: `session-${++nextSession}`, label: 'bash', cwd: '/fixture' });
        if (command === 'close_terminal') return new Promise<void>(resolve => closes.set(args.sessionId, resolve));
        if (command === 'plugin:event|listen') {
          if (args.event === 'terminal-output') state.sendTerminalOutput = callbacks.get(args.handler);
          return Promise.resolve(++nextCallback);
        }
        if (['plugin:event|unlisten', 'resize_terminal', 'write_terminal'].includes(command)) return Promise.resolve(null);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
      transformCallback: (callback: (event: unknown) => void) => {
        const id = ++nextCallback;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: () => undefined,
    };
  });
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  const panel = page.locator('gc-terminal-panel');
  const add = panel.getByRole('button', { name: 'New terminal tab' });
  await expect(panel.getByRole('tab', { name: 'bash 1', exact: true })).toBeVisible();
  await add.click();
  await add.click();
  await expect(panel.getByRole('tab')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Close bash 1', exact: true }).click({ force: true });
  await panel.getByRole('button', { name: 'Close bash 2', exact: true }).click({ force: true });
  await expect.poll(() => page.evaluate(() => (window as any).pendingTerminalCloses().length)).toBe(2);
  await add.click();
  await expect(panel.getByRole('tab', { name: 'bash 4', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).resolveTerminalClose('session-2'));
  await expect(panel.getByRole('tab', { name: 'bash 2', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).resolveTerminalClose('session-1'));
  await expect(panel.getByRole('tab')).toHaveText(['bash 3', 'bash 4']);
  await expect(panel.getByRole('tab', { name: 'bash 4', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => (window as any).sendTerminalOutput({
    payload: { sessionId: 'another-repository-session', data: [65, 66, 67] },
  }));
  await expect.poll(() => panel.evaluate(element => (window as any).ng.getComponent(element).pendingOutput.size)).toBe(0);
});

for (const delayedListener of [1, 2]) {
  test(`unregisters a late terminal listener ${delayedListener} without starting a session after destruction`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await page.evaluate((delayed) => {
      const state = window as any;
      const app = state.ng.getComponent(document.querySelector('gc-root'));
      app.git.systemInfo.set({ appVersion: 'renderer test', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' });
      let listener = 0;
      state.terminalOpenCalls = 0;
      state.unregisteredTerminalListeners = [];
      state.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (_event: string, id: number) => state.unregisteredTerminalListeners.push(id),
      };
      state.__TAURI_INTERNALS__ = {
        invoke: (command: string) => {
          if (command === 'plugin:event|listen') {
            listener += 1;
            if (listener === delayed) return new Promise(resolve => { state.finishTerminalListener = resolve; });
            return Promise.resolve(listener);
          }
          if (command === 'open_terminal') state.terminalOpenCalls += 1;
          return Promise.resolve(null);
        },
        transformCallback: () => 100,
        unregisterCallback: () => undefined,
      };
    }, delayedListener);
    await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).finishTerminalListener)).toBe('function');
    await page.getByRole('button', { name: 'Close git-khronos', exact: true }).click({ force: true });
    await expect(page.locator('gc-terminal-panel')).toHaveCount(0);
    await page.evaluate(id => (window as any).finishTerminalListener(id), delayedListener);
    await expect.poll(() => page.evaluate(() => (window as any).unregisteredTerminalListeners)).toContain(delayedListener);
    expect(await page.evaluate(() => (window as any).terminalOpenCalls)).toBe(0);
  });
}

test('closes a late native terminal session when its repository panel was destroyed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    const app = state.ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.set({ appVersion: 'renderer test', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' });
    let nextCallback = 100;
    state.closedTerminalSessions = [];
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    state.__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        if (command === 'open_terminal') return new Promise(resolve => { state.finishOpeningTerminal = resolve; });
        if (command === 'close_terminal') state.closedTerminalSessions.push(args.sessionId);
        if (command === 'plugin:event|listen') return Promise.resolve(++nextCallback);
        return Promise.resolve(null);
      },
      transformCallback: () => ++nextCallback,
      unregisterCallback: () => undefined,
    };
  });
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishOpeningTerminal)).toBe('function');
  await page.getByRole('button', { name: 'Close git-khronos', exact: true }).click({ force: true });
  await expect(page.locator('gc-terminal-panel')).toHaveCount(0);
  await page.evaluate(() => (window as any).finishOpeningTerminal({ id: 'late-session', label: 'bash', cwd: '/fixture' }));
  await expect.poll(() => page.evaluate(() => (window as any).closedTerminalSessions)).toContain('late-session');
});
