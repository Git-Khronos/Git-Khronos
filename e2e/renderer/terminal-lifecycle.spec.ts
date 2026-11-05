import { expect, test, type Page } from '@playwright/test';
import type { Terminal } from '@xterm/xterm';
import { readFileSync } from 'node:fs';

interface TerminalPanelHarness {
  tabs(): Array<{ id: string; terminal: Terminal }>;
}

type TerminalTestWindow = typeof window & {
  ng: { getComponent(element: Element): unknown };
  terminalStyleViolations: Array<{ directive: string; sample: string; target: string | null }>;
  terminalWrites: Array<{ id: string; data: string }>;
  terminalResizes: Array<{ id: string; rows: number; cols: number }>;
  terminalCloseRequests: string[];
  failedTerminalDisposeCalls: number;
};

const TERMINAL_TEST_NONCE = 'dGVybWluYWwtdGVzdA==';

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
    state.terminalResizes = [];
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
        if (command === 'resize_terminal') {
          state.terminalResizes.push({ id: args.sessionId, rows: args.rows, cols: args.cols });
          return Promise.resolve(null);
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

async function useNoncedDesktopStyles(page: Page): Promise<void> {
  const config: { app: { security: { csp: string } } } =
    JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
  const directives: string[] = config.app.security.csp.split(';').map((directive: string) => directive.trim());
  const styleSource = directives.find((directive) => directive.startsWith('style-src '));
  const styleAttributes = directives.find((directive) => directive.startsWith('style-src-attr '));
  if (!styleSource || !styleAttributes) throw new Error('Desktop style CSP directives are missing');
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    if (!original.includes('<head>')) throw new Error('Renderer head not found');
    const html = original.replace('<head>', `<head><style nonce="${TERMINAL_TEST_NONCE}"></style>`);
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy': `${styleSource} 'nonce-${TERMINAL_TEST_NONCE}' 'report-sample'; ${styleAttributes}`,
      },
      body: html,
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'OffscreenCanvas', { value: undefined, configurable: true });
    const state = window as TerminalTestWindow;
    state.terminalStyleViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.violatedDirective.startsWith('style-src')) {
        state.terminalStyleViolations.push({
          directive: event.violatedDirective,
          sample: event.sample,
          target: event.target instanceof Element ? event.target.outerHTML.slice(0, 150) : null,
        });
      }
    });
  });
}

test('renders terminal fonts and ANSI colors under a nonced style policy', async ({ page }) => {
  await useNoncedDesktopStyles(page);
  await pendingTerminalInput(page);
  const panel = page.locator('gc-terminal-panel');
  await panel.evaluate((element) => new Promise<void>((resolve) => {
    const component: unknown = (window as TerminalTestWindow).ng.getComponent(element);
    const terminal = (component as TerminalPanelHarness).tabs()[0].terminal;
    terminal.write('normal \x1b[31mred\x1b[0m \x1b[38;2;52;178;128mtruecolor\x1b[0m \x1b[48;2;40;60;80mbackground\x1b[0m\r\n', resolve);
  }));
  const screen = panel.locator('[data-terminal-id="input-1"] .xterm-screen');
  const rows = screen.locator('.xterm-rows');
  await expect(rows).toHaveCSS('font-size', '13px');
  await expect(rows).toHaveCSS('white-space', 'pre');
  await expect(rows).toHaveCSS('color', 'rgb(216, 215, 226)');
  expect(await rows.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('monospace');
  await expect(screen.locator('.xterm-fg-1')).toHaveCSS('color', 'rgb(239, 113, 134)');
  await expect(screen.getByText('truecolor', { exact: true })).toHaveCSS('color', 'rgb(52, 178, 128)');
  await expect(screen.getByText('background', { exact: true })).toHaveCSS('background-color', 'rgb(40, 60, 80)');
  await expect.poll(() => screen.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(100);
  const originalColumns = await panel.evaluate((element) => {
    const component: unknown = (window as TerminalTestWindow).ng.getComponent(element);
    return (component as TerminalPanelHarness).tabs()[0].terminal.cols;
  });
  expect(originalColumns).toBeGreaterThan(80);

  await screen.locator('.xterm-helper-textarea').focus();
  await panel.evaluate((element) => {
    const component: unknown = (window as TerminalTestWindow).ng.getComponent(element);
    const terminal = (component as TerminalPanelHarness).tabs()[0].terminal;
    terminal.options.cursorBlink = false;
    terminal.select(0, 0, 6);
  });
  await expect(screen.locator('.xterm-cursor')).toHaveCSS('background-color', 'rgb(99, 219, 181)');
  const selection = screen.locator('.xterm-selection div').first();
  await expect(selection).toBeVisible();
  expect(await selection.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.keyboard.insertText('git status');
  await expect.poll(() => page.evaluate(() => (window as TerminalTestWindow).terminalWrites))
    .toEqual([{ id: 'input-1', data: 'git status' }]);

  const originalRows = await panel.evaluate((element) => {
    const component: unknown = (window as TerminalTestWindow).ng.getComponent(element);
    return (component as TerminalPanelHarness).tabs()[0].terminal.rows;
  });
  await panel.getByRole('separator', { name: 'Resize terminal' }).press('End');
  await expect.poll(() => panel.evaluate((element) => {
    const component: unknown = (window as TerminalTestWindow).ng.getComponent(element);
    return (component as TerminalPanelHarness).tabs()[0].terminal.rows;
  })).toBeGreaterThan(originalRows);
  await expect.poll(() => page.evaluate((minimumRows) =>
    (window as TerminalTestWindow).terminalResizes.some((size) => size.id === 'input-1' && size.rows > minimumRows),
    originalRows)).toBe(true);

  await page.evaluate(() => {
    const root = document.querySelector('gc-root');
    if (!root) throw new Error('Application root not found');
    const component: unknown = (window as TerminalTestWindow).ng.getComponent(root);
    const app = component as {
      setTerminalPreference(name: string, value: string | number): void;
      setAppTheme(theme: string): void;
    };
    app.setTerminalPreference('font-size', 16);
    app.setTerminalPreference('font-family', 'Consolas, monospace');
    app.setAppTheme('midnight');
  });
  await expect(rows).toHaveCSS('font-size', '16px');
  await expect(rows).toHaveCSS('font-family', 'Consolas, monospace');
  await expect(rows).toHaveCSS('color', 'rgb(220, 230, 242)');
  await expect(screen.locator('.xterm-fg-1')).toHaveCSS('color', 'rgb(255, 120, 144)');
  await expect.poll(() => panel.evaluate((element) => {
    const component: unknown = (window as TerminalTestWindow).ng.getComponent(element);
    return (component as TerminalPanelHarness).tabs()[0].terminal.cols;
  })).toBeLessThan(originalColumns);

  await panel.getByRole('button', { name: 'New terminal tab' }).click();
  await expect(panel.getByRole('tab', { name: 'bash 2', exact: true })).toHaveAttribute('aria-selected', 'true');
  const secondScreen = panel.locator('[data-terminal-id="input-2"] .xterm-screen');
  await panel.evaluate((element) => new Promise<void>((resolve) => {
    const component: unknown = (window as TerminalTestWindow).ng.getComponent(element);
    (component as TerminalPanelHarness).tabs()[1].terminal.write('\x1b[34mblue\x1b[0m', resolve);
  }));
  await expect(secondScreen.locator('.xterm-rows')).toHaveCSS('font-size', '16px');
  await expect(secondScreen.locator('.xterm-fg-4')).toHaveCSS('color', 'rgb(134, 160, 255)');
  await panel.getByRole('tab', { name: 'bash 1', exact: true }).click();
  await expect(rows).toBeVisible();
  await expect(rows).toHaveCSS('font-size', '16px');

  const styles = await panel.locator('.xterm-screen style').evaluateAll((elements) =>
    elements.map((element) => {
      const style = element as HTMLStyleElement;
      return { nonce: style.nonce, loaded: !!style.sheet };
    }));
  expect(styles.length).toBeGreaterThanOrEqual(4);
  expect(styles.every(({ nonce, loaded }) => nonce === TERMINAL_TEST_NONCE && loaded)).toBe(true);
  expect(await page.evaluate(() => (window as TerminalTestWindow).terminalStyleViolations)).toEqual([]);

  const unnoncedStyleLoaded = await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = ':root { --untrusted-style-probe: allowed }';
    document.head.append(style);
    const loaded = !!style.sheet;
    style.remove();
    return loaded;
  });
  expect(unnoncedStyleLoaded).toBe(false);
});

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

test('cleans up a detached terminal after a nonced startup failure', async ({ page }) => {
  await useNoncedDesktopStyles(page);
  await pendingTerminalInput(page);
  const panel = page.locator('gc-terminal-panel');
  await failNextTerminalStartup(page, 'open');
  await panel.getByRole('button', { name: 'New terminal tab' }).click();
  await expect(panel.getByRole('status')).toContainText('Terminal open failed');
  await expect.poll(() => page.evaluate(() => (window as TerminalTestWindow).terminalCloseRequests)).toEqual(['input-2']);
  await expect.poll(() => page.evaluate(() => (window as TerminalTestWindow).failedTerminalDisposeCalls)).toBe(1);
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  const screen = panel.locator('[data-terminal-id="input-3"] .xterm-screen');
  await expect(screen.locator('.xterm-rows')).toHaveCSS('font-size', '13px');
  expect(await screen.locator('style').evaluateAll((elements, nonce) =>
    elements.length >= 2 && elements.every((element) => (element as HTMLStyleElement).nonce === nonce),
    TERMINAL_TEST_NONCE)).toBe(true);
  expect(await page.evaluate(() => (window as TerminalTestWindow).terminalStyleViolations)).toEqual([]);
});

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

test('starts an agent only on explicit action and keeps its owned lifecycle separate from the shell', async ({ page }) => {
  await pendingTerminalInput(page);
  await page.evaluate(() => {
    const state = window as any;
    const original = state.__TAURI_INTERNALS__.invoke;
    state.agentCalls = [];
    state.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command === 'open_agent_terminal') { state.agentCalls.push(args); return Promise.resolve({ id: 'owned-agent', label: args.program, cwd: '/fixture/worktree' }); }
      return original(command, args);
    };
  });
  const panel = page.locator('gc-terminal-panel');
  await panel.getByRole('button', { name: 'New agent session', exact: true }).click();
  const launcher = panel.getByLabel('Start agent session', { exact: true });
  await expect(launcher).toContainText('normal permissions');
  expect(await page.evaluate(() => (window as any).agentCalls)).toEqual([]);
  await launcher.getByLabel('Agent program', { exact: true }).selectOption('claude');
  await launcher.getByRole('button', { name: 'Start agent', exact: true }).click();
  await expect(panel.getByRole('tab', { name: 'claude 2 running', exact: true })).toBeVisible();
  await expect(panel.getByRole('tab')).toHaveCount(2);
  const calls = await page.evaluate(() => (window as any).agentCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ program: 'claude', rows: 24, cols: 80 });
  expect(Object.keys(calls[0]).sort()).toEqual(['cols', 'program', 'repoId', 'rows']);
  await panel.getByRole('button', { name: 'Close claude 2', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).terminalCloseRequests)).toEqual(['owned-agent']);
  await expect(panel.getByRole('tab', { name: 'bash 1', exact: true })).toBeVisible();
});

test('agent launcher supports Escape and retries the selected agent after a launch failure', async ({ page }) => {
  await pendingTerminalInput(page);
  await page.evaluate(() => {
    const state = window as any, invoke = state.__TAURI_INTERNALS__.invoke;
    state.agentAttempts = [];
    state.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command === 'open_agent_terminal') {
        state.agentAttempts.push(args.program);
        if (state.agentAttempts.length === 1) return Promise.reject({ message: 'Owned missing program' });
        return Promise.resolve({ id: 'retry-agent', label: args.program, cwd: '/fixture' });
      }
      return invoke(command, args);
    };
  });
  const panel = page.locator('gc-terminal-panel');
  const opener = panel.getByRole('button', { name: 'New agent session', exact: true });
  await opener.click();
  await expect(panel.getByLabel('Agent program', { exact: true })).toBeFocused();
  await panel.getByLabel('Agent program', { exact: true }).press('Escape');
  await expect(opener).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Start agent', exact: true })).toHaveCount(0);
  await opener.click();
  await panel.getByLabel('Agent program', { exact: true }).selectOption('opencode');
  await panel.getByRole('button', { name: 'Start agent', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Owned missing program');
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(panel.getByRole('tab', { name: 'opencode 2 running', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).agentAttempts)).toEqual(['opencode', 'opencode']);
});
