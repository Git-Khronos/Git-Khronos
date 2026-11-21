import { expect, test, type Page } from '@playwright/test';

async function interceptLayout(page: Page, component: RegExp, selector: string, fail = false) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
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
  });
  const installed = () => page.evaluate(selector => Array.from(document.styleSheets).some(sheet => {
    try { return Array.from(sheet.cssRules).some(rule => rule.cssText.includes(selector)); }
    catch { return false; }
  }), selector);
  return { release, requests: () => requests, installed };
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
