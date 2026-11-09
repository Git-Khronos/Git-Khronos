import { expect, test, type Locator, type Page } from '@playwright/test';

async function showSubmodules(page: Page): Promise<void> {
  if (await page.locator('#reference-section-submodules').isVisible()) return;
  await page.locator('#reference-section-local .sidebar-heading').click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: 'Submodules', exact: true }).click();
}

const surfaces: Array<{
  name: string;
  prepare?: (page: Page) => Promise<void>;
  trigger: (page: Page) => Locator;
  menu: (page: Page) => Locator;
}> = [
  { name: 'repository tab', trigger: (page) => page.locator('.repo-tab.active .repo-tab-main'), menu: (page) => page.locator('.tab-context-menu') },
  { name: 'reference heading', trigger: (page) => page.locator('#reference-section-local .heading-toggle'), menu: (page) => page.getByRole('menu', { name: 'Left Panel panes' }) },
  { name: 'worktree', trigger: (page) => page.locator('.worktree-list-item').nth(1).locator('.worktree-list-main'), menu: (page) => page.locator('.worktree-card-menu.list-menu') },
  { name: 'submodule', prepare: showSubmodules, trigger: (page) => page.locator('.submodule-main').first(), menu: (page) => page.locator('.submodule-menu') },
  { name: 'remote group', trigger: (page) => page.getByRole('button', { name: 'Collapse remote origin' }), menu: (page) => page.getByRole('menu', { name: 'Remote origin graph actions' }) },
  { name: 'local branch', trigger: (page) => page.locator('#reference-section-local .branch-item').nth(1), menu: (page) => page.locator('.context-menu') },
  { name: 'aligned remote branch', trigger: (page) => page.locator('.aligned-remote-location').first(), menu: (page) => page.locator('.context-menu') },
  { name: 'remote-only branch', trigger: (page) => page.locator('.remote-branch-item').first(), menu: (page) => page.locator('.context-menu') },
  { name: 'tag', prepare: async (page) => { await page.locator('#reference-section-tags .sidebar-heading').click(); }, trigger: (page) => page.locator('#reference-section-tags .tag-item').first(), menu: (page) => page.locator('.context-menu') },
  { name: 'stash', prepare: async (page) => { await page.locator('#reference-section-stashes .sidebar-heading').click(); }, trigger: (page) => page.locator('#reference-section-stashes .stash-item').first(), menu: (page) => page.getByRole('menu', { name: 'Stash actions' }) },
  { name: 'commit row', trigger: (page) => page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]'), menu: (page) => page.locator('.context-menu') },
  { name: 'unstaged file', trigger: (page) => page.locator('#unstaged-files-list .file-name-button').first(), menu: (page) => page.locator('.file-context-menu') },
  { name: 'staged file', trigger: (page) => page.locator('#staged-files-list .file-name-button').first(), menu: (page) => page.locator('.file-context-menu') },
  {
    name: 'historical file',
    prepare: async (page) => { await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click(); },
    trigger: (page) => page.locator('.commit-panel .commit-file').first(),
    menu: (page) => page.locator('.commit-file-context-menu'),
  },
  {
    name: 'comparison file',
    prepare: async (page) => {
      await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Compare with working directory', exact: true }).click();
    },
    trigger: (page) => page.locator('.comparison-files .commit-file').first(),
    menu: (page) => page.locator('.commit-file-context-menu'),
  },
];

for (const name of ['unstaged file', 'staged file', 'historical file', 'comparison file']) {
  const pathSurface = surfaces.find((surface) => surface.name === name)!;
  const treeTrigger = (page: Page) => pathSurface.trigger(page)
    .and(page.locator('.tree-file .file-name-button, .tree-commit-file'));
  surfaces.push({
    ...pathSurface,
    name: `${name} in Tree view`,
    trigger: treeTrigger,
    prepare: async (page) => {
      await pathSurface.prepare?.(page);
      await page.locator('.commit-panel [data-file-view-mode="tree"]').click();
      await expect(treeTrigger(page)).toBeVisible();
    },
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
});

for (const surface of surfaces) {
  test(`dismisses right-click ${surface.name} on outside pointer press, including disabled controls`, async ({ page }) => {
    await surface.prepare?.(page);
    for (const outside of ['disabled control', 'empty space', 'outside right-click'] as const) {
      if (outside === 'disabled control') {
        // Open away from the toolbar so the disabled target is not under a tall menu.
        const viewport = page.viewportSize()!;
        await surface.trigger(page).evaluate((element, viewport) =>
          element.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, button: 2, clientX: viewport.width - 1, clientY: viewport.height - 1,
          })), viewport);
      } else {
        await surface.trigger(page).click({ button: 'right' });
      }
      const menu = surface.menu(page);
      await expect(menu).toBeVisible();
      if (surface.name === 'repository tab' && outside !== 'disabled control') {
        await surface.trigger(page).evaluate((element) =>
          element.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, button: 2, clientX: 800, clientY: 400,
          })));
        await expect.poll(async () => (await menu.boundingBox())!.x).toBeGreaterThan(600);
      }
      const target = outside === 'disabled control'
        ? page.getByRole('button', { name: 'Undo', exact: true })
        : page.locator('.statusbar');
      if (outside === 'disabled control') await expect(target).toBeDisabled();
      const bounds = (await target.boundingBox())!;
      await page.mouse.move(
        bounds.x + (outside === 'disabled control' ? bounds.width / 2 : 5),
        bounds.y + bounds.height / 2,
      );
      const button = outside === 'outside right-click' ? 'right' : 'left';
      await page.mouse.down({ button });
      try {
        await expect(menu).toHaveCount(0);
      } finally {
        await page.mouse.up({ button });
      }
    }
  });

  test(`right-click ${surface.name} supports fitted actions, keyboard navigation and dismissal`, async ({ page }) => {
    await surface.prepare?.(page);
    const trigger = surface.trigger(page);
    await trigger.click({ button: 'right' });
    const menu = surface.menu(page);
    await expect(menu).toBeVisible();
    const items = menu.locator('[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)');
    await expect(items.first()).toBeFocused();
    await items.first().press('End');
    await expect(items.last()).toBeFocused();
    await items.last().press('Home');
    await expect(items.first()).toBeFocused();
    expect(await items.first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    await items.first().press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    const viewport = page.viewportSize()!;
    await trigger.evaluate((element, viewport) => element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, clientX: viewport.width - 1, clientY: viewport.height - 1,
    })), viewport);
    await expect(menu).toBeVisible();
    await expect.poll(async () => {
      const bounds = await menu.boundingBox();
      return !!bounds && bounds.x >= 8 && bounds.y >= 8
        && bounds.x + bounds.width <= viewport.width - 7
        && bounds.y + bounds.height <= viewport.height - 7;
    }).toBe(true);
    await page.locator('.brand-mark.mini').first().click();
    await expect(menu).toHaveCount(0);
  });
}

test('replaces the previous menu when right-clicking a different kind of target', async ({ page }) => {
  await page.locator('#unstaged-files-list .file-name-button').first().click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('#reference-section-local .branch-item').nth(1).click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.file-context-menu')).toHaveCount(0);
  await page.locator('.worktree-list-main').nth(1).click({ button: 'right' });
  await expect(page.locator('.worktree-card-menu.list-menu')).toBeVisible();
  await expect(page.locator('.context-menu')).toHaveCount(0);
  await page.locator('.repo-tab.active .repo-tab-main').click({ button: 'right' });
  await expect(page.locator('.tab-context-menu')).toBeVisible();
  await expect(page.locator('.worktree-card-menu.list-menu')).toHaveCount(0);
  await page.locator('.graph-columns').click({ button: 'right' });
  await expect(page.getByRole('dialog', { name: 'Graph settings' })).toBeVisible();
  await expect(page.locator('.tab-context-menu')).toHaveCount(0);
});

test('replaces an action menu when opening grouped reference triggers', async ({ page }) => {
  const oid = '83e6d15fb82672899688b93f59251dfc669888a3';
  await page.locator(`[data-commit-oid="${oid}"]`).click();
  const triggers = [
    page.locator('.commit-detail-ref-stack .detail-reference-stack-trigger'),
    page.locator(`[data-commit-oid="${oid}"] .reference-stack-trigger`),
  ];
  for (const trigger of triggers) {
    for (const method of ['pointer', 'keyboard'] as const) {
      await page.locator('#reference-section-local .branch-item').nth(1).evaluate((element) =>
        element.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, button: 2, clientX: 8, clientY: 8,
        })));
      await expect(page.locator('.context-menu')).toBeVisible();
      if (method === 'pointer') await trigger.click({ button: 'right' });
      else {
        await trigger.focus();
        await trigger.press('Shift+F10');
      }
      await expect(page.locator('.context-menu')).toHaveCount(0);
      await expect(page.locator('[role="menuitem"]:focus')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }
  }
});

test('dismisses actions outside isolated toolbar controls without breaking menu toggles', async ({ page }) => {
  const worktreeToggle = page.locator('.worktree-list-actions').nth(1);
  const worktreeMenu = page.locator('.worktree-card-menu.list-menu');
  await worktreeToggle.click();
  await expect(worktreeMenu).toBeVisible();
  await worktreeToggle.click();
  await expect(worktreeMenu).toHaveCount(0);
  const viewport = page.viewportSize()!;
  await page.locator('#reference-section-local .branch-item').nth(1).evaluate((element, viewport) =>
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, clientX: viewport.width - 1, clientY: viewport.height - 1,
    })), viewport);
  await page.getByRole('button', { name: /Switch branch, current/ }).click();
  await expect(page.locator('.context-menu')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Switch branch', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const settingsToggle = page.getByRole('button', { name: 'Configure graph columns', exact: true });
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  await settingsToggle.click();
  await expect(settings).toBeVisible();
  await settingsToggle.click();
  await expect(settings).toHaveCount(0);
});

test('keeps sidebar menus above the panel splitter', async ({ page }) => {
  await page.locator('.worktree-list-main').nth(1).click({ button: 'right' });
  const item = page.locator('.worktree-card-menu.list-menu [role="menuitem"]:not(:disabled)').first();
  await expect(item).toBeFocused();
  const splitter = (await page.getByRole('separator', { name: 'Resize left panel' }).boundingBox())!;
  const itemBox = (await item.boundingBox())!;
  const x = splitter.x + splitter.width / 2;
  expect(x).toBeGreaterThan(itemBox.x);
  expect(x).toBeLessThan(itemBox.x + itemBox.width);
  expect(await item.evaluate((element, pointX) => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(pointX, bounds.y + bounds.height / 2));
  }, x)).toBe(true);
});

test('keeps sidebar action menus usable over an open diff in a compact window', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await page.goto('/?compare-commits&diff-viewer=split');
  await expect(page.getByLabel('Diff viewer')).toBeVisible();
  await page.getByRole('button', { name: 'Open left panel' }).click();
  for (const kind of ['worktree', 'submodule'] as const) {
    if (kind === 'submodule') await showSubmodules(page);
    const trigger = kind === 'worktree'
      ? page.locator('.worktree-list-main').nth(1)
      : page.locator('.submodule-main').first();
    const menu = kind === 'worktree'
      ? page.locator('.worktree-card-menu.list-menu')
      : page.locator('.submodule-menu');
    await trigger.click({ button: 'right' });
    const item = menu.locator('[role="menuitem"]:not(:disabled)').first();
    await expect(item).toBeFocused();
    expect(await item.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(
        bounds.x + bounds.width / 2, bounds.y + bounds.height / 2,
      ));
    })).toBe(true);
    await item.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test('keeps right-click form editing keys in the branch and repository name fields', async ({ page }) => {
  await page.locator('#reference-section-local .branch-item').nth(1).click({ button: 'right' });
  const branchField = page.locator('.context-menu input').first();
  await branchField.fill('feature/edit-with-home-and-end');
  await branchField.press('Home');
  await expect(branchField).toBeFocused();
  await branchField.press('End');
  await expect(branchField).toBeFocused();
  await branchField.press('Escape');
  await page.locator('.repo-tab.active .repo-tab-main').click({ button: 'right' });
  await page.locator('.tab-context-menu [data-repository-alias-action]').click();
  const alias = page.locator('.tab-context-menu input');
  await alias.fill('My repository');
  await alias.press('Home');
  await expect(alias).toBeFocused();
  await alias.press('End');
  await expect(alias).toBeFocused();
});

test('fits graph settings at the invocation point in a compact window', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 600 });
  const closeInspector = page.getByRole('button', { name: 'Close commit panel' });
  await expect(closeInspector).toBeFocused();
  await closeInspector.click();
  await page.locator('.graph-columns').evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: 699, clientY: 599,
  })));
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  await expect(settings).toBeFocused();
  await expect.poll(async () => {
    const box = await settings.boundingBox();
    return !!box && box.x + box.width <= 692 && box.y + box.height <= 592;
  }).toBe(true);
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
});

test('dismisses contextual graph settings on an outside press without dismissing inside controls', async ({ page }) => {
  await page.locator('.graph-columns').click({ button: 'right' });
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  await expect(settings).toBeVisible();
  await settings.getByLabel('Date / Time', { exact: true }).click();
  await expect(settings).toBeVisible();
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeDisabled();
  const bounds = (await undo.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  try {
    await expect(settings).toHaveCount(0);
  } finally {
    await page.mouse.up();
  }
});
