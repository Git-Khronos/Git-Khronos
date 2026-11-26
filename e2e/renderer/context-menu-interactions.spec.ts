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

test('reference actions copy an exact namespace without changing the checkout', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__copiedReference = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { (window as any).__copiedReference = text; },
    } });
  });
  const checkout = () => page.evaluate(() => {
    const repo = (window as any).ng.getComponent(document.querySelector('gk-app')).git.repository();
    return { head: repo.headOid, branch: repo.status?.branch };
  });
  const before = await checkout();
  for (const [surfaceName, labelPrefix, refNamespace] of [
    ['local branch', 'Local branch ', 'heads'],
    ['remote-only branch', 'Remote branch ', 'remotes'],
    ['tag', 'Tag ', 'tags'],
  ]) {
    const surface = surfaces.find(({ name }) => name === surfaceName)!;
    await surface.prepare?.(page);
    const target = surface.trigger(page);
    const label = (await target.getAttribute('aria-label'))!;
    expect(label.startsWith(labelPrefix)).toBe(true);
    await target.click({ button: 'right' });
    const menu = surface.menu(page);
    await menu.getByRole('menuitem', { name: 'Copy full ref', exact: true }).click();
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__copiedReference))
      .toBe(`refs/${refNamespace}/${label.slice(labelPrefix.length)}`);
  }
  expect(await checkout()).toEqual(before);
});

test('a refused reference clipboard write explains the failure', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => { throw new Error('Clipboard refused'); } },
  }));
  await page.locator('#reference-section-local .branch-item').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy full ref', exact: true }).click();
  await expect(page.locator('.error-toast')).toContainText('Could not copy the Git ref');
});

test('a late ref-copy failure leaves a newer context menu open', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => new Promise<void>((_resolve, reject) => {
        (window as any).__rejectRefCopy = () => reject(new Error('Clipboard refused after navigation'));
      }),
    } });
  });
  const localBranches = page.locator('#reference-section-local .branch-item');
  const menu = page.locator('.context-menu');
  await localBranches.first().click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Copy full ref', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__rejectRefCopy)).toBe('function');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await localBranches.nth(1).click({ button: 'right' });
  const newer = await menu.locator('.context-heading strong').innerText();
  await page.evaluate(async () => {
    (window as any).__rejectRefCopy();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(menu.locator('.context-heading strong')).toHaveText(newer);
  await expect(page.locator('.error-toast').filter({hasText: 'Could not copy the Git ref'})).toHaveCount(0);
});

test('keyboard ref copy returns focus to the branch that opened the menu', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => {} },
  }));
  const opener = page.locator('#reference-section-local .branch-item').first();
  await opener.press('Shift+F10');
  const copy = page.getByRole('menuitem', { name: 'Copy full ref', exact: true });
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect(copy).toHaveCount(0);
  await expect(opener).toBeFocused();
});

for (const outcome of ['cancel', 'fail', 'load', 'switch'] as const) {
  test(`sidebar item actions load on demand and preserve keyboard ownership on ${outcome}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    let delivered = false;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      if (!source.includes('SidebarItemActionsComponent') || !source.includes('Repair after external move')) {
        await route.fulfill({ response, body: source });
        return;
      }
      requests++;
      await gate;
      if (outcome === 'fail') await route.abort();
      else await route.fulfill({ response, body: source });
      delivered = true;
    });
    try {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      expect(requests).toBe(0);
      if (outcome === 'switch') await showSubmodules(page);
      const trigger = outcome === 'switch' ? page.locator('.submodule-actions').first()
        : page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true });
      await trigger.press('Enter');
      const menu = page.getByRole('menu', { name: outcome === 'switch' ? 'Submodule actions' : 'Worktree actions', exact: true });
      await expect.poll(() => requests).toBe(1);
      await expect(menu.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
      await expect(menu.getByRole('menuitem', { name: 'Remove this worktree', exact: true })).toHaveCount(0);
      if (outcome === 'switch') {
        // A different checkout can contain a submodule with the same
        // relative path. Its presence must not revive the original menu.
        await page.evaluate(() => {
          const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
          const repo = git.repository();
          git.repositories.update((items: any[]) => [...items, { ...repo, id: 'sidebar-other', path: '/owned/other-sidebar' }]);
          git.activateRepository('sidebar-other');
        });
        release();
        await expect.poll(() => delivered).toBe(true);
        await expect(menu).toHaveCount(0);
      } else if (outcome === 'cancel') {
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        release();
        await expect.poll(() => delivered).toBe(true);
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();
      } else {
        release();
        if (outcome === 'fail') {
          await expect(menu.getByRole('alert')).toContainText('Sidebar actions could not load');
          await expect(menu.getByRole('menuitem', { name: 'Close', exact: true })).toBeFocused();
        } else {
          const first = menu.getByRole('menuitem', { name: 'Open worktree in a new tab', exact: true });
          await expect(first).toBeFocused();
          await expect(first).toHaveCSS('display', 'grid');
        }
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
      if (outcome !== 'fail') {
        await showSubmodules(page);
        await page.locator('.submodule-actions').first().click();
        await expect(page.getByRole('menu', { name: 'Submodule actions', exact: true })
          .getByRole('menuitem', { name: 'Copy remote URL', exact: true })).toBeVisible();
        expect(requests).toBe(1);
      }
    } finally { release(); }
  });
}

for (const result of ['held', 'failed'] as const) {
  test(`stash action menu remains dismissible while its optional module is ${result}`, async ({ page }) => {
    let release!: () => void;
    let requests = 0;
    let delivered = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      if (source.includes('StashActionMenuComponent') && source.includes('Pop Stash')) {
        requests++;
        await gate;
        if (result === 'failed') await route.abort();
        else await route.fulfill({ response, body: source });
        delivered = true;
      } else await route.fulfill({ response, body: source });
    });
    await page.locator('#reference-section-stashes .sidebar-heading').click();
    const trigger = page.locator('#reference-section-stashes .stash-item').first();
    const menu = page.getByRole('menu', { name: 'Stash actions', exact: true });
    try {
      expect(requests).toBe(0);
      await trigger.press('Shift+F10');
      await expect.poll(() => requests).toBe(1);
      const cancel = menu.getByRole('menuitem', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await expect(menu.getByRole('menuitem', { name: 'Apply Stash', exact: true })).toHaveCount(0);
      if (result === 'failed') {
        release();
        await expect(menu.getByRole('alert')).toContainText('No stash action was run');
        await expect(menu.getByRole('menuitem', { name: 'Close', exact: true })).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      release();
      await expect.poll(() => delivered).toBe(true);
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      if (result === 'held') {
        await trigger.press('Shift+F10');
        const apply = menu.getByRole('menuitem', { name: 'Apply Stash', exact: true });
        await expect(apply).toBeFocused();
        await expect(apply).toHaveCSS('display', 'grid');
        expect(requests).toBe(1);
      }
    } finally { release(); }
  });
}

for (const result of ['held', 'failed'] as const) {
  test(`repository tab menu owns keyboard dismissal when the action module is ${result}`, async ({ page }) => {
    let release!: () => void;
    let requests = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      if (!source.includes('RepositoryTabMenuContentComponent') || !source.includes('Edit display name')) {
        await route.fulfill({ response, body: source });
        return;
      }
      requests++;
      await gate;
      if (result === 'failed') await route.abort();
      else await route.fulfill({ response, body: source });
    });
    const tab = page.locator('.repo-tab.active .repo-tab-main');
    const menu = page.getByRole('menu', { name: /^Repository actions for / });
    try {
      expect(requests).toBe(0);
      await tab.press('Shift+F10');
      await expect.poll(() => requests).toBe(1);
      const cancel = menu.getByRole('menuitem', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
      await expect(menu.getByRole('menuitem', { name: 'Close repository', exact: true })).toHaveCount(0);
      if (result === 'failed') {
        release();
        await expect(menu.getByRole('alert')).toContainText('No action was run');
        await expect(menu.getByRole('menuitem', { name: 'Close', exact: true })).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(tab).toBeFocused();
      release();
      if (result === 'held') {
        await tab.press('Shift+F10');
        await expect(menu.getByRole('menuitem', { name: 'Close repository', exact: true })).toBeVisible();
        await expect.poll(() => requests).toBe(1);
      }
    } finally { release(); }
  });
}

test('a retired tab menu cannot close the active repository when reopened in the same turn', async ({ page }) => {
  const tab = page.locator('.repo-tab.active .repo-tab-main');
  await tab.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: /^Repository actions for / });
  const close = menu.getByRole('menuitem', { name: 'Close repository', exact: true });
  await expect(close).toBeVisible();
  await close.evaluate(element => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    app.openRepositoryTabMenu(new MouseEvent('contextmenu', { clientX: 450, clientY: 100 }), app.git.activeRepositoryId());
    (element as HTMLButtonElement).click();
  });
  await expect(tab).toBeVisible();
  await expect(menu).toBeVisible();
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

test('a cold file menu can be cancelled and reopened before its actions load', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/chunk-[^/?]+\.js(?:\?.*)?$/, async (route) => {
    await held;
    await route.continue();
  });
  const trigger = page.locator('#unstaged-files-list .file-name-button').first();
  const menu = page.locator('.file-context-menu');
  try {
    await trigger.click({ button: 'right' });
    const cancel = menu.getByRole('menuitem', { name: 'Cancel', exact: true });
    await expect(menu.getByRole('status')).toHaveText('Loading file actions…');
    await expect(cancel).toBeFocused();
    await cancel.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click({ button: 'right' });
    await expect(cancel).toBeFocused();
    release();
    const changes = menu.getByRole('menuitem', { name: 'View changes', exact: true });
    await expect(changes).toBeFocused();
    await changes.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    release();
  }
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
