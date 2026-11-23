import { expect, test, type Page } from '@playwright/test';

async function holdActions(page: Page, fail = false): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    if (source.includes('class GraphActionMenuComponent') || source.includes('GraphActionMenuComponent = class')) {
      await held;
      if (fail) await route.abort();
      else await route.fulfill({ response, body: source });
    } else await route.fulfill({ response, body: source });
  });
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  return release;
}

for (const fail of [false, true]) {
  test(`graph action ${fail ? 'failure' : 'loading'} has a focused escape and cannot dispatch Git`, async ({ page }) => {
    const release = await holdActions(page, fail);
    const opener = page.getByRole('button', { name: 'Branch actions for main', exact: true });
    await opener.focus();
    await opener.press('Enter');
    const menu = page.getByRole('menu', { name: 'Actions for branch main', exact: true });
    await expect(menu.getByRole('status')).toHaveText('Loading actions…');
    await expect(menu.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
    // Record native traffic only after opening; the loader must never dispatch writes.
    await page.evaluate(() => {
      (window as any).__graphActionCalls = [];
      (window as any).__TAURI_INTERNALS__ = { invoke: (...args: any[]) => {
        (window as any).__graphActionCalls.push(args);
        return Promise.reject(new Error('No native operation expected'));
      } };
    });
    if (fail) {
      release();
      await expect(menu.getByRole('alert')).toContainText('Actions could not load');
      await expect(menu.getByRole('menuitem', { name: 'Close', exact: true })).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(opener).toBeFocused();
    release();
    await expect(page.locator('gk-graph-action-menu')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__graphActionCalls)).toEqual([]);
  });
}

test('late graph actions refit the viewport, preserve styling and transfer keyboard focus', async ({ page }) => {
  const release = await holdActions(page);
  const opener = page.getByRole('button', { name: 'Branch actions for main', exact: true });
  await opener.focus();
  await opener.press('Enter');
  const menu = page.getByRole('menu', { name: 'Actions for branch main', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
  release();
  await expect(menu.getByRole('menuitem', { name: 'Copy branch name', exact: true })).toBeFocused();
  await expect(menu.locator('.context-heading')).toHaveCSS('position', 'sticky');
  await expect(menu.getByRole('menuitem', { name: 'Create tag here…' })).toHaveCSS('display', 'grid');
  await expect.poll(async () => {
    const bounds = (await menu.boundingBox())!;
    return bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= 1433 && bounds.y + bounds.height <= 893;
  }).toBe(true);
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Create tag here…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('late graph action code renders only the replacement target', async ({ page }) => {
  const release = await holdActions(page);
  const opener = page.getByRole('button', { name: 'Branch actions for main', exact: true });
  await opener.focus();
  await opener.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Loading actions…' })).toBeVisible();
  // A request can be replaced while its code is still in flight.
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    app.actionOverlays.open({ kind: 'context', value: {
      kind: 'tag', repositoryId: app.git.activeRepositoryId(), oid: app.git.repository().tags[0].oid,
      oids: [app.git.repository().tags[0].oid], label: 'replacement-tag', x: 900, y: 800,
    } });
  });
  release();
  const menu = page.getByRole('menu', { name: 'Actions for tag replacement-tag', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'View tagged commit' })).toBeVisible();
  await expect(menu.locator('.context-heading strong')).toHaveText('replacement-tag');
  await expect(page.getByRole('menu', { name: 'Actions for branch main', exact: true })).toHaveCount(0);
});

test('late graph action code cannot resurrect a retired repository menu', async ({ page }) => {
  const release = await holdActions(page);
  const opener = page.getByRole('button', { name: 'Branch actions for main', exact: true });
  await opener.focus();
  await opener.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repository = app.git.repository();
    const other = { ...repository, id: 'retired-menu-repository', path: '/workspace/retired-menu-repository' };
    app.git.repositories.update((repositories: any[]) => [...repositories, other]);
    app.git.activeRepositoryId.set(other.id);
  });
  await expect(page.locator('.graph-action-menu')).toHaveCount(0);
  release();
  await expect(page.locator('gk-graph-action-menu')).toHaveCount(0);
});
