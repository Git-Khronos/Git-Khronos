import { expect, test, type Page } from '@playwright/test';

async function interceptLayout(page: Page, component: RegExp, selector: string, fail = false) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  let delivered = 0;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    if (!component.test(source)) {
      await route.fulfill({ response, body: source });
      return;
    }
    requests++;
    await held;
    if (fail) await route.abort();
    else await route.fulfill({ response, body: source });
    delivered++;
  });
  const installed = () => page.evaluate(selector => Array.from(document.styleSheets).some(sheet => {
    try { return Array.from(sheet.cssRules).some(rule => rule.cssText.includes(selector)); }
    catch { return false; }
  }), selector);
  return { release, requests: () => requests, delivered: () => delivered, installed };
}

for (const outcome of ['loaded', 'failed', 'closed'] as const) {
  test(`repository setup's lazy module is keyboard-safe when ${outcome}`, async ({ page }) => {
    const layout = await interceptLayout(page, /class\s+_?RepositorySetupDialogComponent\b/, '.worktree-dialog-fields', outcome === 'failed');
    try {
      await page.goto('/');
      const opener = page.getByRole('button', { name: 'Create worktree', exact: true });
      await expect(opener).toBeVisible();
      expect(layout.requests()).toBe(0);
      expect(await layout.installed()).toBe(false);
      await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const actions: string[] = (window as any).__setupActions = [];
        app.git.stageAll = async () => { actions.push('stage'); return null; };
        app.git.commit = async () => { actions.push('commit'); return false; };
        app.submitWorktree = () => actions.push('create');
      });
      await opener.click();
      await expect.poll(layout.requests).toBe(1);
      const loading = page.getByRole('dialog', { name: 'Loading repository setup' });
      const cancel = loading.getByRole('button', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Control+Shift+Enter');
      await expect(loading).toBeVisible();
      if (outcome === 'closed') await page.keyboard.press('Escape');
      layout.release();
      await expect.poll(layout.delivered).toBe(1);
      if (outcome === 'loaded') {
        const dialog = page.getByRole('dialog', { name: 'Create Worktree', exact: true });
        await expect(dialog.getByLabel('Branch name')).toBeFocused();
        await expect(dialog.locator('.worktree-dialog-fields')).toHaveCSS('display', 'grid');
        expect(await layout.installed()).toBe(true);
        const viewport = page.viewportSize()!;
        await page.setViewportSize({ width: 450, height: 720 });
        await expect.poll(() => dialog.locator('.worktree-dialog-fields').evaluate(el =>
          getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
        await page.setViewportSize(viewport);
        await page.keyboard.press('Escape');
      } else if (outcome === 'failed') {
        const error = page.getByRole('dialog', { name: 'Repository setup unavailable' });
        await expect(error.getByRole('alert')).toContainText('No changes were made');
        await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
      }
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(await page.evaluate(() => (window as any).__setupActions)).toEqual([]);
    } finally { layout.release(); }
  });
}

for (const outcome of ['ready', 'failed'] as const) {
  test(`preferences styles stay off the startup path when the dialog chunk is ${outcome}`, async ({ page }) => {
    const layout = await interceptLayout(page, /class\s+_?PreferencesDialogComponent\b/, '.preferences-sidebar', outcome === 'failed');
    try {
      await page.setViewportSize({ width: 460, height: 720 });
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      expect(layout.requests()).toBe(0);
      expect(await layout.installed()).toBe(false);
      const opener = page.getByRole('button', { name: 'Preferences', exact: true });
      await opener.click();
      await expect.poll(layout.requests).toBe(1);
      const loading = page.getByRole('dialog', { name: 'Loading preferences', exact: true });
      await expect(loading).toHaveCSS('position', 'fixed');
      expect(await layout.installed()).toBe(false);
      layout.release();
      if (outcome === 'ready') {
        const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
        const categories = preferences.getByRole('tablist', { name: 'Preference categories' });
        await expect(categories).toHaveCSS('display', 'grid');
        await expect(preferences.getByRole('button', { name: 'Close preferences' })).toBeFocused();
        expect(await layout.installed()).toBe(true);
      } else {
        const unavailable = page.getByRole('dialog', { name: 'Preferences unavailable', exact: true });
        await expect(unavailable).toHaveCSS('position', 'fixed');
        expect(await layout.installed()).toBe(false);
        await unavailable.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(opener).toHaveAttribute('aria-expanded', 'false');
      }
    } finally { layout.release(); }
  });
}

for (const overlay of [
  { label: 'repository manager', component: /class\s+_?RepositoryDialogComponent\b/, selector: '.repository-manager-body',
    opener: 'New repository tab', role: 'dialog', name: 'Repository management', content: '[role=tablist]', css: ['display', 'flex'] },
  { label: 'activity drawer', component: /class\s+_?ActivityLogDrawerComponent\b/, selector: '.activity-lines',
    opener: 'Activity notifications', role: 'region', name: 'Activity logs', content: '[role=tabpanel]', css: ['overflow-y', 'auto'] },
] as const) {
  test(`${overlay.label} loads its layout only after opening`, async ({ page }) => {
    const layout = await interceptLayout(page, overlay.component, overlay.selector);
    try {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      expect(layout.requests()).toBe(0);
      expect(await layout.installed()).toBe(false);
      await page.getByRole('button', { name: overlay.opener, exact: true }).click();
      await expect.poll(layout.requests).toBe(1);
      expect(await layout.installed()).toBe(false);
      layout.release();
      const panel = page.getByRole(overlay.role, { name: overlay.name, exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.locator(overlay.content)).toHaveCSS(overlay.css[0], overlay.css[1]);
      expect(await layout.installed()).toBe(true);
    } finally { layout.release(); }
  });
}

for (const outcome of ['loaded', 'failed'] as const) {
  test(`repository management blocks ambient Git shortcuts while its module is ${outcome}`, async ({ page }) => {
    const layout = await interceptLayout(page, /class\s+_?RepositoryDialogComponent\b/, '.repository-manager-body', outcome === 'failed');
    try {
      await page.goto('/');
      const summary = page.getByLabel('Commit summary', { exact: true });
      await summary.fill('Do not commit while managing repositories');
      await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        (window as any).__ambientRepositoryWrites = [];
        app.git.stageAll = async () => { (window as any).__ambientRepositoryWrites.push('stage'); return null; };
        app.git.commit = async () => { (window as any).__ambientRepositoryWrites.push('commit'); return false; };
      });
      const opener = page.getByRole('button', { name: 'New repository tab', exact: true });
      await opener.click();
      await expect.poll(layout.requests).toBe(1);
      const loading = page.getByRole('dialog', { name: 'Loading repository management', exact: true });
      const cancel = loading.getByRole('button', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Control+Shift+Enter');
      await expect(loading).toBeVisible();
      layout.release();
      if (outcome === 'loaded') {
        const dialog = page.getByRole('dialog', { name: 'Repository management', exact: true });
        await expect(dialog.getByRole('tab', { name: 'Browse', exact: true })).toBeFocused();
        await page.keyboard.press('Control+Shift+Enter');
        await expect(dialog).toBeVisible();
      } else {
        const error = page.getByRole('dialog', { name: 'Repository management unavailable', exact: true });
        await expect(error.getByRole('alert')).toContainText('could not load');
        await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
        await page.keyboard.press('Control+Enter');
        await expect(error).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(summary).toHaveValue('Do not commit while managing repositories');
      expect(await page.evaluate(() => (window as any).__ambientRepositoryWrites)).toEqual([]);
    } finally { layout.release(); }
  });
}

for (const outcome of ['opened', 'unavailable'] as const) {
  test(`branch drop keeps its layout off the startup path and can be ${outcome}`, async ({ page }) => {
    const layout = await interceptLayout(page, /class\s+_?BranchDropMenuComponent\b/, '.branch-drop-advice', outcome === 'unavailable');
    try {
      await page.goto('/');
      const source = page.getByRole('button', { name: 'Local branch release', exact: true });
      const target = page.getByRole('button', { name: /Local branch main, current/ });
      await expect(source).toBeVisible();
      expect(layout.requests()).toBe(0);
      expect(await layout.installed()).toBe(false);
      await source.dragTo(target);
      await expect.poll(layout.requests).toBe(1);
      const menu = page.getByRole('menu', { name: 'Branch drop actions' });
      await expect(menu).toHaveCount(0);
      expect(await layout.installed()).toBe(false);
      layout.release();
      if (outcome === 'opened') {
        await expect(menu.getByRole('menuitem', { name: /Fast-forward main/ })).toBeFocused();
        await expect(menu).toHaveCSS('position', 'fixed');
        expect(await layout.installed()).toBe(true);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
      } else {
        const error = page.getByRole('status').filter({ hasText: 'Branch actions could not be loaded' });
        await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
        expect(await layout.installed()).toBe(false);
        await error.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(error).toHaveCount(0);
      }
      await expect(target).toBeFocused();
    } finally { layout.release(); }
  });
}

for (const outcome of ['loaded', 'failed'] as const) {
  test(`Recovery History loads its layout on demand and owns keyboard input while ${outcome}`, async ({ page }) => {
    const layout = await interceptLayout(page, /class\s+_?RecoveryHistoryDialogComponent\b/, '.recovery-list', outcome === 'failed');
    try {
      await page.goto('/');
      const draft = page.getByLabel('Commit summary', { exact: true });
      await draft.fill('Keep my draft while checking recovery');
      await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        (window as any).__recoveryAmbientWrites = [];
        app.git.stageAll = async () => { (window as any).__recoveryAmbientWrites.push('stage'); };
        app.git.commit = async () => { (window as any).__recoveryAmbientWrites.push('commit'); };
      });
      const opener = page.getByRole('button', { name: 'Main menu', exact: true });
      expect(layout.requests()).toBe(0);
      expect(await layout.installed()).toBe(false);
      await opener.click();
      await page.getByRole('menuitem', { name: /Recovery History/ }).click();
      await expect.poll(layout.requests).toBe(1);
      const loader = page.getByRole('dialog', { name: 'Opening Recovery History', exact: true });
      const cancel = loader.getByRole('button', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Control+Shift+Enter');
      await expect(loader).toBeVisible();
      expect(await layout.installed()).toBe(false);
      layout.release();
      if (outcome === 'loaded') {
        const dialog = page.getByRole('dialog', { name: 'Recovery history', exact: true });
        await expect(dialog.getByRole('searchbox')).toBeFocused();
        await expect(dialog.locator('.recovery-list')).toHaveCSS('overflow-y', 'auto');
        expect(await layout.installed()).toBe(true);
        await page.keyboard.press('Control+Shift+Enter');
        await expect(dialog).toBeVisible();
      } else {
        const error = page.getByRole('dialog', { name: 'Recovery History unavailable', exact: true });
        await expect(error.getByRole('alert')).toContainText('Saved changes are unchanged');
        await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
        expect(await layout.installed()).toBe(false);
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(draft).toHaveValue('Keep my draft while checking recovery');
      expect(await page.evaluate(() => (window as any).__recoveryAmbientWrites)).toEqual([]);
    } finally { layout.release(); }
  });
}
