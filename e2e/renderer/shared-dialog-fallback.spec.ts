import { expect, test, type Page } from '@playwright/test';

const flows = [
  {
    component: 'WorkspaceCenterComponent', host: 'gk-workspace-center',
    loading: 'Loading workspace center', unavailable: 'Workspace center unavailable', ready: 'Workspace center',
    async open(page: Page) {
      const opener = page.getByRole('button', { name: 'Workspace: Default', exact: true });
      await opener.click();
      await page.getByRole('menuitem', { name: 'Repository overview', exact: true }).click();
      return opener;
    },
  },
  {
    component: 'IntegrateBranchDialogComponent', host: 'gk-integrate-branch-dialog',
    loading: 'Loading merge and rebase options', unavailable: 'Merge and rebase options unavailable', ready: 'Bring changes into main',
    async open(page: Page) {
      const opener = page.getByRole('button', { name: 'Local branch release', exact: true });
      await opener.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Merge or rebase into main…', exact: true }).click();
      return opener;
    },
  },
];

for (const flow of flows) {
  for (const outcome of ['ready', 'failed', 'dismissed'] as const) {
    test(`${flow.component} fallback remains keyboard-safe when the chunk is ${outcome}`, async ({ page }) => {
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let requests = 0;
      let delivered = 0;
      const component = new RegExp(`class\\s+_?${flow.component}\\b`);
      await page.route('**/chunk-*.js', async route => {
        const response = await route.fetch();
        const source = await response.text();
        if (!component.test(source)) {
          await route.fulfill({ response, body: source });
          return;
        }
        requests++;
        await held;
        if (outcome === 'failed') await route.abort();
        else await route.fulfill({ response, body: source });
        delivered++;
      });

      try {
        await page.goto('/');
        await expect(page.locator('.commit-row').first()).toBeVisible();
        expect(requests).toBe(0);
        await page.evaluate(() => {
          const host = window as any;
          const app = host.ng.getComponent(document.querySelector('gk-app'));
          const actions: string[] = host.__fallbackActions = [];
          app.git.stageAll = async () => { actions.push('stage'); };
          app.git.commit = async () => { actions.push('commit'); };
          app.handleIntegrationChoice = () => { actions.push('integrate'); };
        });
        const opener = await flow.open(page);
        await expect.poll(() => requests).toBe(1);
        const fallback = page.getByRole('dialog', { name: flow.loading, exact: true });
        const close = fallback.getByRole('button', { name: 'Close', exact: true });
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Control+Shift+Enter');
        await expect(fallback).toBeVisible();
        if (outcome === 'dismissed') {
          await page.keyboard.press('Escape');
          await expect(fallback).toHaveCount(0);
          await expect(opener).toBeFocused();
        }

        release();
        await expect.poll(() => delivered).toBe(1);
        if (outcome === 'ready') {
          const dialog = page.getByRole('dialog', { name: flow.ready, exact: true });
          await expect(dialog).toBeVisible();
          await expect(fallback).toHaveCount(0);
        } else if (outcome === 'failed') {
          const error = page.getByRole('dialog', { name: flow.unavailable, exact: true });
          await expect(error.getByRole('alert')).toBeVisible();
          await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
          await page.keyboard.press('Escape');
          await expect(error).toHaveCount(0);
          await expect(opener).toBeFocused();
          await expect(page.locator(flow.host)).toHaveCount(0);
          await flow.open(page);
          await expect(error.getByRole('alert')).toContainText('restart Git Khronos');
          expect(requests).toBe(1);
          await page.keyboard.press('Escape');
          await expect(error).toHaveCount(0);
        } else {
          await page.waitForLoadState('networkidle');
          await expect(page.locator(flow.host)).toHaveCount(0);
          await expect(opener).toBeFocused();
        }
        expect(await page.evaluate(() => (window as any).__fallbackActions)).toEqual([]);
      } finally {
        release();
        await page.unrouteAll({ behavior: 'wait' });
      }
    });
  }
}
