import { expect, test, type Page } from '@playwright/test';
import type { Signal, WritableSignal } from '@angular/core';
import type { Branch, RepositorySnapshot } from '@git-chronos/contracts';

interface TestApp {
  git: {
    repository: () => RepositorySnapshot;
    busy: Signal<boolean>;
    error: WritableSignal<string | null>;
    activeRepositoryId: WritableSignal<string | null>;
    repositories: WritableSignal<RepositorySnapshot[]>;
    selectedWorkingTreeFile: WritableSignal<string | null>;
    checkout: (name: string) => Promise<unknown>;
    checkoutRemote: (name: string) => Promise<void>;
    checkoutCommit: (oid: string) => Promise<unknown>;
    createBranch: (name: string) => Promise<unknown>;
    createBranchAt: (name: string, oid: string) => Promise<unknown>;
    undo: () => Promise<void>;
  };
}

declare global {
  interface Window {
    ng: { getComponent: (element: Element | null) => TestApp };
    __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, string>) => Promise<unknown> };
    __branchCalls: Array<{ command: string; name: string; oid?: string }>;
    __otherCalls: string[];
    __completeBranchMutation: () => void;
    __completeBranchRecovery: () => void;
    __failNextBranchMutation: () => void;
  }
}

async function installBackend(page: Page, options: { fail?: boolean; hold?: boolean; holdRecovery?: boolean } = {}): Promise<void> {
  await page.evaluate(({ fail, hold, holdRecovery }) => {
    const host = window;
    const app = host.ng.getComponent(document.querySelector('gc-root'));
    let snapshot = structuredClone(app.git.repository());
    let shouldFail = fail;
    host.__branchCalls = [];
    host.__otherCalls = [];
    host.__failNextBranchMutation = () => { shouldFail = true; };
    host.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === 'refresh_repository_status') return snapshot.status;
        if (command === 'refresh_repository') {
          if (holdRecovery) await new Promise<void>((resolve) => { host.__completeBranchRecovery = resolve; });
          return snapshot;
        }
        if (!['checkout_branch', 'checkout_remote_branch', 'checkout_commit', 'create_branch', 'create_branch_at', 'create_branch_reference'].includes(command)) {
          host.__otherCalls.push(command);
          throw new Error(`Unexpected command: ${command}`);
        }
        host.__branchCalls.push({
          command,
          name: args['name'] ?? '',
          ...(args['oid'] ? { oid: args['oid'] } : {}),
        });
        if (hold) await new Promise<void>((resolve) => { host.__completeBranchMutation = resolve; });
        if (shouldFail) {
          shouldFail = false;
          throw new Error('Branch name is invalid. Choose a different name.');
        }
        if (command === 'checkout_commit') return snapshot;
        const name = args['name'];
        const branch = snapshot.branches.find((candidate) => candidate.name === name);
        const referenceOnly = command === 'create_branch_reference';
        const oid = command === 'create_branch_at' || referenceOnly ? args['oid'] : branch?.oid ?? snapshot.headOid!;
        const branches = referenceOnly
          ? [...snapshot.branches]
          : snapshot.branches.map((candidate) => ({ ...candidate, current: candidate.name === name }));
        if (!branch) branches.push({ ...snapshot.branches.find((candidate) => candidate.current)!, name, fullName: `refs/heads/${name}`, oid, current: !referenceOnly, remote: false } satisfies Branch);
        snapshot = referenceOnly
          ? { ...snapshot, branches }
          : { ...snapshot, branches, headOid: oid, status: { ...snapshot.status, branch: name } };
        return snapshot;
      },
    };
  }, options);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
});

test('keeps an empty branch draft editable and restores focus on Escape', async ({ page }) => {
  const newBranch = page.getByRole('button', { name: 'New branch', exact: true });
  await page.getByRole('button', { name: 'Local 3', exact: true }).click();
  await newBranch.click();
  const name = page.getByRole('textbox', { name: 'New branch name' });
  await expect(name).toBeFocused();
  await name.fill('');
  await expect(name).toBeVisible();
  await expect(name).toBeFocused();
  await expect(page.locator('.branch-create-form').getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  await name.fill('feature/editable');
  await name.press('Escape');
  await expect(name).toHaveCount(0);
  await expect(newBranch).toBeFocused();
});

test('returns focus to branch creation after opening it with a shortcut from the workspace', async ({ page }) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+b');
  const name = page.getByRole('textbox', { name: 'New branch name' });
  await expect(name).toBeFocused();
  await name.press('Escape');
  await expect(page.getByRole('button', { name: 'Create branch', exact: true }).first()).toBeFocused();
});

test('returns to branch options after cancelling branch creation opened there', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Branch options' });
  await toggle.click();
  await page.getByRole('menu', { name: 'Branch options' }).getByRole('menuitem', { name: /Create branch/ }).click();
  await page.getByRole('textbox', { name: 'New branch name' }).press('Escape');
  await expect(toggle).toBeFocused();
});

test('reveals branch creation when another reference section is maximized and retains drafts', async ({ page }) => {
  const create = page.getByRole('button', { name: 'Create branch', exact: true }).first();
  await create.click();
  const name = page.getByRole('textbox', { name: 'New branch name' });
  await name.fill('feature/keep-my-draft');
  await page.locator('#reference-section-remote .sidebar-heading').dblclick();
  await expect(page.locator('#reference-section-remote')).toHaveClass(/maximized/);
  await create.click();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('feature/keep-my-draft');
  await expect(page.locator('#reference-section-remote')).not.toHaveClass(/maximized/);
});

test('keeps creation reachable with a long filtered list and a short section', async ({ page }) => {
  await page.getByRole('separator', { name: 'Resize Local section' }).press('Home');
  await page.getByRole('searchbox', { name: 'Filter references' }).fill('no-matching-branch');
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const name = page.getByRole('textbox', { name: 'New branch name' });
  await expect(name).toBeFocused();
  await expect(page.locator('.branch-create-form').getByRole('button', { name: 'Create', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 700, height: 600 });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  await expect(name).toBeFocused();
  await expect(name).toBeInViewport();
});

test('restores a short Local section after the branch creator temporarily expands it', async ({ page }) => {
  const splitter = page.getByRole('separator', { name: 'Resize Local section' });
  await splitter.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '70');
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const name = page.getByRole('textbox', { name: 'New branch name' });
  await expect(name).toBeInViewport();
  await expect(splitter).toHaveAttribute('aria-valuenow', '150');
  await splitter.click();
  await name.press('Escape');
  await expect(splitter).toHaveAttribute('aria-valuenow', '70');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.sidebar.section.local.height'))).toBe('70');
});

test('keeps an explicit Local section resize made while the branch creator is open', async ({ page }) => {
  const splitter = page.getByRole('separator', { name: 'Resize Local section' });
  await splitter.press('Home');
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  await splitter.press('ArrowDown');
  await expect(splitter).toHaveAttribute('aria-valuenow', '160');
  await page.getByRole('textbox', { name: 'New branch name' }).press('Escape');
  await expect(splitter).toHaveAttribute('aria-valuenow', '160');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.sidebar.section.local.height'))).toBe('160');
});

test('keeps a pointer resize and automatic reset made while the branch creator is open', async ({ page }) => {
  const splitter = page.getByRole('separator', { name: 'Resize Local section' });
  const create = page.getByRole('button', { name: 'Create branch', exact: true }).first();
  await splitter.press('Home');
  await create.click();
  const box = (await splitter.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 25);
  await page.mouse.up();
  await page.getByRole('textbox', { name: 'New branch name' }).press('Escape');
  await expect(splitter).toHaveAttribute('aria-valuenow', '175');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.sidebar.section.local.height'))).toBe('175');

  await splitter.press('Home');
  await create.click();
  await splitter.dblclick();
  await page.getByRole('textbox', { name: 'New branch name' }).press('Escape');
  await expect(page.locator('#reference-section-local')).not.toHaveClass(/resized/);
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.sidebar.section.local.height'))).toBeNull();
});

test('restores the Local section preference when changing repositories with the creator open', async ({ page }) => {
  const splitter = page.getByRole('separator', { name: 'Resize Local section' });
  await splitter.press('Home');
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  await expect(splitter).toHaveAttribute('aria-valuenow', '150');
  await page.evaluate(() => {
    const git = window.ng.getComponent(document.querySelector('gc-root')).git;
    const first = git.repository();
    git.repositories.set([...git.repositories(), { ...structuredClone(first), id: 'other-repository' }]);
    git.activeRepositoryId.set('other-repository');
  });
  await expect(page.getByRole('textbox', { name: 'New branch name' })).toHaveCount(0);
  await expect(splitter).toHaveAttribute('aria-valuenow', '70');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.sidebar.section.local.height'))).toBe('70');
});

test('preserves branch names on failure, explains errors inline and supports retry', async ({ page }) => {
  await installBackend(page, { fail: true });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const form = page.locator('.branch-create-form');
  const name = form.getByRole('textbox', { name: 'New branch name' });
  await name.fill('feature/retry');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Branch name is invalid');
  await expect(name).toHaveValue('feature/retry');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Switch branch, current feature/retry' })).toBeVisible();
});

for (const fail of [false, true]) {
  test(`does not steal focus after branch creation ${fail ? 'fails' : 'succeeds'}`, async ({ page }) => {
    await installBackend(page, { hold: true, fail });
    await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
    const form = page.locator('.branch-create-form');
    await form.getByRole('textbox').fill('feature/focus');
    await form.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
    const search = page.getByRole('searchbox', { name: 'Search loaded commits by message, SHA, or author' });
    await search.focus();
    await page.evaluate(() => window.__completeBranchMutation());
    if (fail) await expect(form.getByRole('alert')).toBeVisible();
    else await expect(form).toHaveCount(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(search).toBeFocused();
  });
}

test('preserves branch errors and blocks retries while a failed operation refreshes the repository', async ({ page }) => {
  await installBackend(page, { fail: true, holdRecovery: true });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const form = page.locator('.branch-create-form');
  const name = form.getByRole('textbox', { name: 'New branch name' });
  await name.fill('feature/refresh-retry');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchRecovery)).toBe('function');
  await expect(name).toBeDisabled();
  await expect(page.getByRole('button', { name: /Switch branch, current/ })).toBeDisabled();
  await page.evaluate(() => {
    const git = window.ng.getComponent(document.querySelector('gc-root')).git;
    git.error.set(null);
    void git.checkout('main');
    void git.createBranch('duplicate');
    window.__completeBranchRecovery();
  });
  await expect(form.getByRole('alert')).toContainText('Branch name is invalid');
  await expect(name).toHaveValue('feature/refresh-retry');
  await expect(name).toBeFocused();
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([
    { command: 'create_branch', name: 'feature/refresh-retry' },
  ]);
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(form).toHaveCount(0);
});

test('keeps context branch creation editable after failure and retries at the chosen commit', async ({ page }) => {
  await installBackend(page, { fail: true, holdRecovery: true });
  const oid = 'f19b263a8af31408d5f665caf7a5508e108c0fd1';
  await page.locator(`[data-commit-oid="${oid}"]`).click({ button: 'right' });
  const menu = page.locator('.context-menu');
  await menu.locator('[data-create-context-branch]').click();
  const name = menu.getByRole('textbox', { name: 'Create branch here' });
  await name.fill('feature/from-commit');
  await menu.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchRecovery)).toBe('function');
  await expect(menu).toBeVisible();
  await expect(name).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Checkout this commit' })).toBeDisabled();
  await page.evaluate(() => {
    window.ng.getComponent(document.querySelector('gc-root')).git.error.set(null);
    window.__completeBranchRecovery();
  });
  await expect(menu.getByRole('alert')).toContainText('Branch name is invalid');
  await expect(name).toHaveValue('feature/from-commit');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();
  await menu.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([
    { command: 'create_branch_at', name: 'feature/from-commit', oid },
    { command: 'create_branch_at', name: 'feature/from-commit', oid },
  ]);
  await expect(page.getByRole('button', { name: 'Switch branch, current feature/from-commit' })).toBeVisible();
});

for (const fail of [false, true]) {
  test(`does not steal focus after context branch creation ${fail ? 'fails' : 'succeeds'}`, async ({ page }) => {
    await installBackend(page, { hold: true, fail });
    await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await menu.locator('[data-create-context-branch]').click();
    await menu.getByRole('textbox', { name: 'Create branch here' }).fill('feature/context-focus');
    await menu.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
    const search = page.getByRole('searchbox', { name: 'Search loaded commits by message, SHA, or author' });
    await search.focus();
    await page.evaluate(() => window.__completeBranchMutation());
    if (fail) await expect(menu.getByRole('alert')).toBeVisible();
    else await expect(menu).toHaveCount(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(search).toBeFocused();
  });
}

test('blocks competing branch operations while a branch mutation is running', async ({ page }) => {
  await installBackend(page, { hold: true });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const form = page.locator('.branch-create-form');
  await form.getByRole('textbox', { name: 'New branch name' }).fill('feature/once');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(form.getByRole('textbox')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Switch branch, current/ })).toBeDisabled();
  await page.evaluate(() => {
    const host = window;
    const git = host.ng.getComponent(document.querySelector('gc-root')).git;
    void git.checkout('main');
    void git.checkoutRemote('origin/docs');
    void git.createBranch('duplicate');
    void git.createBranchAt('duplicate-at', git.repository().headOid!);
  });
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([{ command: 'create_branch', name: 'feature/once' }]);
  await page.evaluate(() => window.__completeBranchMutation());
  await expect(form).toHaveCount(0);
});

test('keeps branch reference navigation and context menus available during a mutation', async ({ page }) => {
  await installBackend(page, { hold: true });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const form = page.locator('.branch-create-form');
  await form.getByRole('textbox').fill('feature/in-progress');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');

  const local = page.locator('#reference-section-local .branch-item:not(.current)').first();
  await expect(local).toBeEnabled();
  await local.click();
  await expect(local).toHaveClass(/tip-selected/);
  await local.click({ button: 'right' });
  const menu = page.locator('.context-menu');
  await expect(menu.getByRole('menuitem', { name: /^Merge / })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: /^Copy / })).toBeEnabled();
  await page.keyboard.press('Escape');

  const remote = page.locator('.remote-branch-item').first();
  await expect(remote).toBeEnabled();
  await remote.click();
  await expect(remote).toHaveClass(/tip-selected/);
  await remote.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Create local tracking branch' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: /Copy/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  await remote.dblclick();
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([
    { command: 'create_branch', name: 'feature/in-progress' },
  ]);

  const stack = page.locator('[data-commit-oid="ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2"] .commit-ref-stack');
  await stack.locator('.reference-stack-trigger').click();
  const graphLocal = stack.locator('.grouped-reference-location.local').first();
  await expect(graphLocal).toBeEnabled();
  await expect(stack.locator('.grouped-reference-location.remote').first()).toBeEnabled();
  await graphLocal.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /^Merge / })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: /^Copy / })).toBeEnabled();
  await page.evaluate(() => window.__completeBranchMutation());
  await expect(form).toHaveCount(0);
});

test('keeps recovery busy and blocks undo and detached checkout until the branch error refresh finishes', async ({ page }) => {
  await installBackend(page, { holdRecovery: true });
  await page.evaluate(async () => {
    await window.ng.getComponent(document.querySelector('gc-root')).git.checkout('feature/partial-staging');
    window.__failNextBranchMutation();
  });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const form = page.locator('.branch-create-form');
  await form.getByRole('textbox').fill('feature/failed-recovery');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchRecovery)).toBe('function');
  await expect(page.getByRole('button', { name: 'Stage all changes' })).toBeDisabled();
  await page.evaluate(() => {
    window.ng.getComponent(document.querySelector('gc-root')).git.selectedWorkingTreeFile.set('unstaged:fixture.txt');
  });
  await page.keyboard.press('s');
  await page.evaluate(() => {
    window.ng.getComponent(document.querySelector('gc-root')).git.selectedWorkingTreeFile.set('staged:fixture.txt');
  });
  await page.keyboard.press('u');
  await page.keyboard.press('Control+Shift+S');
  await page.keyboard.press('Control+Shift+U');
  await page.keyboard.press('Control+Shift+Enter');
  await page.keyboard.press('Control+L');
  expect(await page.evaluate(() => window.__otherCalls)).toEqual([]);
  await page.evaluate(async () => {
    const git = window.ng.getComponent(document.querySelector('gc-root')).git;
    await Promise.all([git.undo(), git.checkoutCommit(git.repository().headOid!)]);
  });
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([
    { command: 'checkout_branch', name: 'feature/partial-staging' },
    { command: 'create_branch', name: 'feature/failed-recovery' },
  ]);
  await page.evaluate(() => window.__completeBranchRecovery());
  await expect(form.getByRole('alert')).toContainText('Branch name is invalid');
});

test('preserves checkout undo and redo for the repository where checkout started', async ({ page }) => {
  await installBackend(page, { hold: true });
  const firstRepositoryId = await page.evaluate(() => {
    const git = window.ng.getComponent(document.querySelector('gc-root')).git;
    const first = git.repository();
    git.repositories.set([...git.repositories(), {
      ...structuredClone(first), id: 'other-repository', name: 'Other repository',
      status: { ...first.status, branch: 'other-branch' },
    }]);
    void git.checkout('feature/partial-staging');
    return first.id;
  });
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
  await page.evaluate(() => {
    window.ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId.set('other-repository');
  });
  await expect(page.getByRole('button', { name: 'Switch branch, current other-branch' })).toBeVisible();
  await page.evaluate(() => {
    window.ng.getComponent(document.querySelector('gc-root')).git.selectedWorkingTreeFile.set('unstaged:other-repository.txt');
    window.__completeBranchMutation();
  });
  await expect.poll(() => page.evaluate(() => window.ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  expect(await page.evaluate(() =>
    window.ng.getComponent(document.querySelector('gc-root')).git.selectedWorkingTreeFile())).toBe('unstaged:other-repository.txt');
  await page.evaluate((id) => window.ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId.set(id), firstRepositoryId);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('title', /Undo Checkout feature\/partial-staging/);
});

test('undoes and redoes a successful branch checkout', async ({ page }) => {
  await installBackend(page);
  await page.evaluate(async () => {
    await window.ng.getComponent(document.querySelector('gc-root')).git.checkout('feature/partial-staging');
  });
  await expect(page.getByRole('button', { name: 'Switch branch, current feature/partial-staging' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch branch, current main' })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch branch, current feature/partial-staging' })).toBeVisible();
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([
    { command: 'checkout_branch', name: 'feature/partial-staging' },
    { command: 'checkout_branch', name: 'main' },
    { command: 'checkout_branch', name: 'feature/partial-staging' },
  ]);
});

test('preserves another repository selection when branch failure recovery finishes', async ({ page }) => {
  await installBackend(page, { fail: true, holdRecovery: true });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const form = page.locator('.branch-create-form');
  await form.getByRole('textbox').fill('feature/failed-in-other-tab');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchRecovery)).toBe('function');
  await page.evaluate(() => {
    const git = window.ng.getComponent(document.querySelector('gc-root')).git;
    const first = git.repository();
    git.repositories.set([...git.repositories(), {
      ...structuredClone(first), id: 'other-repository', name: 'Other repository',
      status: { ...first.status, branch: 'other-branch' },
    }]);
    git.activeRepositoryId.set('other-repository');
  });
  await expect(page.getByRole('button', { name: 'Switch branch, current other-branch' })).toBeVisible();
  await page.evaluate(() => {
    window.ng.getComponent(document.querySelector('gc-root')).git.selectedWorkingTreeFile.set('unstaged:other-repository.txt');
    window.__completeBranchRecovery();
  });
  await expect.poll(() => page.evaluate(() => window.ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  expect(await page.evaluate(() =>
    window.ng.getComponent(document.querySelector('gc-root')).git.selectedWorkingTreeFile())).toBe('unstaged:other-repository.txt');
});

for (const fail of [false, true]) {
  test(`does not let a ${fail ? 'failed' : 'successful'} context creation alter a newer menu`, async ({ page }) => {
    await installBackend(page, { hold: true, fail });
    const first = page.locator('.commit-row[data-commit-oid]').nth(1);
    const second = page.locator('.commit-row[data-commit-oid]').nth(2);
    await first.click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await menu.locator('[data-create-context-branch]').click();
    await menu.getByRole('textbox', { name: 'Create branch here' }).fill('feature/older-menu');
    await menu.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
    const previousHeading = await menu.locator('.context-heading strong').textContent();
    await second.click({ button: 'right', position: { x: 12, y: 10 } });
    await expect(menu.locator('.context-heading strong')).not.toHaveText(previousHeading!);
    const heading = await menu.locator('.context-heading strong').textContent();
    await page.evaluate(() => window.__completeBranchMutation());
    await expect(menu.getByRole('textbox', { name: 'Create branch here' })).toHaveCount(0);
    await menu.locator('[data-create-context-branch]').click();
    await expect(menu.getByRole('textbox', { name: 'Create branch here' })).toBeEnabled();
    await expect(menu.locator('.context-heading strong')).toHaveText(heading!);
    await expect(menu.getByRole('alert')).toHaveCount(0);
    await menu.getByRole('textbox', { name: 'Create branch here' }).fill('feature/newer-menu');
    await expect(menu.getByRole('textbox', { name: 'Create branch here' })).toHaveValue('feature/newer-menu');
  });
}

test('does not cherry-pick when switching to the requested target branch fails', async ({ page }) => {
  await installBackend(page, { fail: true, holdRecovery: true });
  const commit = page.locator('.commit-row[data-commit-oid]').filter({ hasText: 'Add hunk-level staging actions' });
  const dragHandle = commit.getByRole('button', { name: /Commit actions for Add hunk-level staging actions/ });
  const target = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  await commit.hover();
  await dragHandle.dragTo(target);
  const confirmation = page.getByRole('alertdialog');
  await confirmation.getByRole('button', { name: 'Cherry-pick onto feature/partial-staging' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchRecovery)).toBe('function');
  await page.evaluate(async () => {
    window.ng.getComponent(document.querySelector('gc-root')).git.error.set(null);
    window.__completeBranchRecovery();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([
    { command: 'checkout_branch', name: 'feature/partial-staging' },
  ]);
  expect(await page.evaluate(() => window.__otherCalls)).not.toContain('cherry_pick_commits');
});

test('does not integrate branches when switching to the target branch fails', async ({ page }) => {
  await installBackend(page, { fail: true, holdRecovery: true });
  const source = page.getByRole('button', { name: /Local branch main, current/ });
  const target = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  await source.dragTo(target);
  const menu = page.getByRole('menu', { name: 'Branch drop actions' });
  await menu.getByRole('menuitem', { name: /Merge main into feature\/partial-staging/ }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchRecovery)).toBe('function');
  await page.evaluate(async () => {
    window.ng.getComponent(document.querySelector('gc-root')).git.error.set(null);
    window.__completeBranchRecovery();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([
    { command: 'checkout_branch', name: 'feature/partial-staging' },
  ]);
  expect(await page.evaluate(() => window.__otherCalls)).not.toContain('integrate_branch');
});

test('does not cherry-pick into a different repository after switching tabs during checkout', async ({ page }) => {
  await installBackend(page, { hold: true });
  await page.evaluate(() => {
    const git = window.ng.getComponent(document.querySelector('gc-root')).git;
    const first = git.repository();
    git.repositories.set([...git.repositories(), {
      ...structuredClone(first), id: 'other-repository', name: 'Other repository',
      status: { ...first.status, branch: 'other-branch' },
    }]);
  });
  const commit = page.locator('.commit-row[data-commit-oid]').filter({ hasText: 'Add hunk-level staging actions' });
  const dragHandle = commit.getByRole('button', { name: /Commit actions for Add hunk-level staging actions/ });
  const target = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  await commit.hover();
  await dragHandle.dragTo(target);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cherry-pick onto feature/partial-staging' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
  await page.evaluate(() => {
    window.ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId.set('other-repository');
    window.__completeBranchMutation();
  });
  await expect.poll(() => page.evaluate(() => window.ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  expect(await page.evaluate(() => window.__otherCalls)).not.toContain('cherry_pick_commits');
});

test('creates a recovery branch without changing the current branch', async ({ page }) => {
  await installBackend(page);
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitem', { name: /Recovery History/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  const entry = dialog.locator('.recovery-entry').nth(1);
  const oid = await entry.locator('code').getAttribute('title');
  await entry.getByRole('button', { name: 'Create branch' }).click();
  const form = entry.locator('.recovery-branch-form');
  await form.getByLabel('New branch name').fill('recovery/keep-current');
  await form.getByRole('button', { name: /Create at/ }).click();
  await expect(form).toHaveCount(0);
  await expect(entry.getByRole('button', { name: 'Create branch' })).toBeFocused();
  expect(await page.evaluate(() => window.__branchCalls)).toEqual([
    { command: 'create_branch_reference', name: 'recovery/keep-current', oid },
  ]);
  await expect(page.getByRole('button', { name: 'Switch branch, current main' })).toBeVisible();
});

for (const fail of [false, true]) {
  test(`does not steal focus after recovery branch creation ${fail ? 'fails' : 'succeeds'}`, async ({ page }) => {
    await installBackend(page, { hold: true, fail });
    await page.getByRole('button', { name: 'Main menu' }).click();
    await page.getByRole('menuitem', { name: /Recovery History/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Recovery history' });
    const entry = dialog.locator('.recovery-entry').nth(1);
    await entry.getByRole('button', { name: 'Create branch' }).click();
    const form = entry.locator('.recovery-branch-form');
    await form.getByLabel('New branch name').fill('recovery/focus');
    await form.getByRole('button', { name: /Create at/ }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
    const search = dialog.getByRole('searchbox', { name: 'Search recovery history' });
    await search.focus();
    await page.evaluate(() => window.__completeBranchMutation());
    if (fail) await expect(form.getByRole('alert')).toBeVisible();
    else await expect(form).toHaveCount(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(search).toBeFocused();
  });
}

test('keeps a failed recovery branch draft with its original error for retry', async ({ page }) => {
  await installBackend(page, { fail: true, holdRecovery: true });
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitem', { name: /Recovery History/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  const entry = dialog.locator('.recovery-entry').nth(1);
  await entry.getByRole('button', { name: 'Create branch' }).click();
  const form = entry.locator('.recovery-branch-form');
  const name = form.getByLabel('New branch name');
  await name.fill('recovery/retry');
  await form.getByRole('button', { name: /Create at/ }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchRecovery)).toBe('function');
  await page.evaluate(() => {
    window.ng.getComponent(document.querySelector('gc-root')).git.error.set(null);
    window.__completeBranchRecovery();
  });
  await expect(form.getByRole('alert')).toContainText('Branch name is invalid');
  await expect(name).toHaveValue('recovery/retry');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();
  await form.getByRole('button', { name: /Create at/ }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Switch branch, current main' })).toBeVisible();
});

test('keeps non-mutating tag navigation available during branch recovery', async ({ page }) => {
  await installBackend(page, { fail: true, holdRecovery: true });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  const form = page.locator('.branch-create-form');
  await form.getByRole('textbox').fill('feature/tag-navigation');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchRecovery)).toBe('function');
  await page.locator('#reference-section-tags .sidebar-heading').click();
  await page.locator('#reference-section-tags .tag-item').first().click({ button: 'right' });
  const menu = page.locator('.context-menu');
  await expect(menu.getByRole('menuitem', { name: 'View tagged commit' })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'View tagged commit' }).click();
  await expect(menu).toHaveCount(0);
  await page.evaluate(() => window.__completeBranchRecovery());
  await expect(form.getByRole('alert')).toContainText('Branch name is invalid');
});

test('keeps the branch picker open for search editing and restores focus after checkout', async ({ page }) => {
  await installBackend(page);
  const toggle = page.getByRole('button', { name: /Switch branch, current/ });
  await toggle.click();
  const picker = page.getByRole('dialog', { name: 'Switch branch', exact: true });
  const search = picker.getByRole('searchbox');
  await search.fill('feature/partial');
  await search.press('Home');
  await expect(search).toBeFocused();
  await search.press('End');
  await expect(search).toBeFocused();
  await picker.locator('.toolbar-nav-section').click();
  await expect(picker).toBeVisible();
  await search.focus();
  await search.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(picker).toBeVisible();
  await search.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAccessibleName(/^Switch branch, current feature\/partial-staging,/);
});

test('returns focus after selecting the current branch from branch options', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Branch options' });
  await toggle.click();
  await page.getByRole('menu', { name: 'Branch options' }).getByRole('menuitem', { name: /main Current branch/ }).click();
  await expect(toggle).toBeFocused();
});

for (const fail of [false, true]) {
  test(`returns focus after branch options checkout ${fail ? 'fails' : 'succeeds'}`, async ({ page }) => {
    await installBackend(page, { hold: true, fail });
    const toggle = page.getByRole('button', { name: 'Branch options' });
    await toggle.click();
    await page.getByRole('menu', { name: 'Branch options' }).getByRole('menuitem', { name: /feature\/partial-staging/ }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
    await page.evaluate(() => window.__completeBranchMutation());
    await expect(toggle).toBeFocused();
  });

  test(`returns focus after context branch checkout ${fail ? 'fails' : 'succeeds'}`, async ({ page }) => {
    await installBackend(page, { hold: true, fail });
    const branch = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
    await branch.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('menuitem', { name: 'Checkout branch' }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
    await page.evaluate(() => window.__completeBranchMutation());
    await expect(branch).toBeFocused();
  });
}

test('does not steal focus after a branch options checkout when the user has moved elsewhere', async ({ page }) => {
  await installBackend(page, { hold: true });
  await page.getByRole('button', { name: 'Branch options' }).click();
  await page.getByRole('menu', { name: 'Branch options' }).getByRole('menuitem', { name: /feature\/partial-staging/ }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
  const search = page.getByRole('searchbox', { name: 'Search loaded commits by message, SHA, or author' });
  await search.focus();
  await page.evaluate(() => window.__completeBranchMutation());
  await expect.poll(() => page.evaluate(() => window.ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(search).toBeFocused();
});

test('does not steal focus after a context checkout when the user has moved elsewhere', async ({ page }) => {
  await installBackend(page, { hold: true });
  await page.getByRole('button', { name: 'Local branch feature/partial-staging' }).click({ button: 'right' });
  await page.locator('.context-menu').getByRole('menuitem', { name: 'Checkout branch' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
  const search = page.getByRole('searchbox', { name: 'Search loaded commits by message, SHA, or author' });
  await search.focus();
  await page.evaluate(() => window.__completeBranchMutation());
  await expect.poll(() => page.evaluate(() => window.ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(search).toBeFocused();
});

test('does not steal focus after checkout when the user has moved elsewhere', async ({ page }) => {
  await installBackend(page, { hold: true });
  await page.getByRole('button', { name: /Switch branch, current/ }).click();
  const picker = page.getByRole('dialog', { name: 'Switch branch', exact: true });
  await picker.getByRole('button', { name: /feature\/partial-staging/ }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__completeBranchMutation)).toBe('function');
  const search = page.getByRole('searchbox', { name: 'Search loaded commits by message, SHA, or author' });
  await search.focus();
  await page.evaluate(() => window.__completeBranchMutation());
  await expect.poll(() => page.evaluate(() => window.ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(search).toBeFocused();
});

test('resizes panels at the rendered edge and preserves room for history at compact desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  const sidebar = page.locator('#repository-reference-panel');
  const details = page.locator('#repository-commit-panel');
  const left = page.getByRole('separator', { name: 'Resize left panel', exact: true });
  const right = page.getByRole('separator', { name: 'Resize commit panel', exact: true });
  for (const splitter of [left, right]) {
    await splitter.press('End');
    const panel = splitter === left ? sidebar : details;
    await expect.poll(async () =>
      Math.round((await panel.boundingBox())!.width) - Number(await splitter.getAttribute('aria-valuenow')),
    ).toBe(0);
  }
  const [leftBox, rightBox, workspaceBox, splitterBox] = await Promise.all([
    sidebar.boundingBox(), details.boundingBox(), page.locator('.workspace').boundingBox(), left.boundingBox(),
  ]);
  expect(rightBox!.x - leftBox!.x - leftBox!.width).toBeGreaterThanOrEqual(420);
  expect(rightBox!.x + rightBox!.width).toBeLessThanOrEqual(workspaceBox!.x + workspaceBox!.width);
  expect(splitterBox!.x + splitterBox!.width / 2).toBeCloseTo(leftBox!.x + leftBox!.width, 0);
  await sidebar.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(left).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = Number(await left.getAttribute('aria-valuenow'));
  const edge = (await left.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 30, edge.y + edge.height / 2);
  await page.mouse.up();
  await expect(left).toHaveAttribute('aria-valuenow', String(before - 30));
});

test('keeps the diff viewer and full splitter hit areas aligned with resized panels', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto('/?compare-commits&diff-viewer=split');
  const sidebar = page.locator('#repository-reference-panel');
  const details = page.locator('#repository-commit-panel');
  const diff = page.getByLabel('Diff viewer');
  const left = page.getByRole('separator', { name: 'Resize left panel', exact: true });
  const right = page.getByRole('separator', { name: 'Resize commit panel', exact: true });
  await expect(diff).toBeVisible();

  const expectAligned = async () => {
    await expect.poll(async () => {
      const [sidebarBox, detailsBox, diffBox] = await Promise.all([
        sidebar.boundingBox(), details.boundingBox(), diff.boundingBox(),
      ]);
      return !!sidebarBox && !!detailsBox && !!diffBox
        && Math.abs(diffBox.x - sidebarBox.x - sidebarBox.width) < 1
        && Math.abs(diffBox.x + diffBox.width - detailsBox.x) < 1;
    }).toBe(true);
  };
  await expectAligned();

  for (const [splitter, delta] of [[left, 24], [right, -20]] as const) {
    const box = (await splitter.boundingBox())!;
    expect(await splitter.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [1, bounds.width - 1].every((offset) =>
        document.elementFromPoint(bounds.x + offset, bounds.y + bounds.height / 2) === element);
    })).toBe(true);
    const width = Number(await splitter.getAttribute('aria-valuenow'));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2);
    await page.mouse.up();
    await expect(splitter).toHaveAttribute('aria-valuenow', String(width + Math.abs(delta)));
    await expectAligned();
  }
  for (const width of [1440, 1051]) {
    await page.setViewportSize({ width, height: 720 });
    await expectAligned();
  }
});

for (const scrollbar of ['overlay', 'reserved'] as const) {
  test(`keeps graph markers and the commit-panel splitter independently clickable with ${scrollbar} scrollbars`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addStyleTag({
      content: scrollbar === 'overlay'
        ? '.commit-list { scrollbar-width: none !important; } .commit-list::-webkit-scrollbar { display: none !important; }'
        : '.commit-list { scrollbar-width: thin !important; scrollbar-gutter: stable !important; }',
    });
    const list = page.locator('.commit-list');
    const gutter = () => list.evaluate((element) => element.offsetWidth - element.clientWidth);
    if (scrollbar === 'overlay') await expect.poll(gutter).toBe(0);
    else await expect.poll(gutter).toBeGreaterThan(0);
    await expect.poll(() => page.locator('.commit-list-shell').evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).getPropertyValue('--graph-scrollbar-gutter')))).toBe(await gutter());

    await page.getByLabel('Search loaded commits by message, SHA, or author').fill('lane rendering');
    const marker = page.getByRole('button', { name: 'Search · Refine graph lane rendering' });
    const splitter = page.getByRole('separator', { name: 'Resize commit panel', exact: true });
    await expect(marker).toBeVisible();
    await list.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => list.evaluate((element) =>
      element.scrollWidth - element.clientWidth - element.scrollLeft)).toBeLessThanOrEqual(1);
    const overlaps = await page.locator('.graph-scroll-markers').evaluate((rail) => {
      const actions = [...document.querySelectorAll<HTMLElement>('.commit-row .row-menu')]
        .map((action) => action.getBoundingClientRect());
      return [...rail.querySelectorAll<HTMLElement>('.graph-scroll-marker')].flatMap((element) => {
        const box = element.getBoundingClientRect();
        return actions.some((action) => box.left < action.right && action.left < box.right
          && box.top < action.bottom && action.top < box.bottom) ? [element.getAttribute('aria-label')] : [];
      });
    });
    expect(overlaps).toEqual([]);
    const markerBox = (await marker.boundingBox())!;
    const splitterBox = (await splitter.boundingBox())!;
    expect(markerBox.width).toBeGreaterThanOrEqual(24);
    expect(markerBox.height).toBeGreaterThanOrEqual(24);
    expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(splitterBox.x);
    expect(await marker.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return [1, box.width / 2, box.width - 1].every((offset) =>
        element.contains(document.elementFromPoint(box.x + offset, box.y + box.height / 2)));
    })).toBe(true);
    expect(await splitter.evaluate((element, y) => {
      const box = element.getBoundingClientRect();
      return [1, box.width - 1].every((offset) => document.elementFromPoint(box.x + offset, y) === element);
    }, markerBox.y + markerBox.height / 2)).toBe(true);
    await marker.click({ position: { x: 1, y: markerBox.height / 2 } });
    await expect(page.locator('.commit-row.selected')).toContainText('Refine graph lane rendering');
    await page.locator('.commit-row[data-commit-oid]').filter({ hasNotText: 'Refine graph lane rendering' }).first().click();
    await marker.click({ position: { x: markerBox.width - 1, y: markerBox.height / 2 } });
    await expect(page.locator('.commit-row.selected')).toContainText('Refine graph lane rendering');

    await page.locator('.commit-row[data-commit-oid]').filter({ hasNotText: 'Refine graph lane rendering' }).first().click();
    await page.getByRole('button', { name: 'Hide Commit Panel' }).click();
    await expect(splitter).toHaveCount(0);
    const expandedMarkerBox = (await marker.boundingBox())!;
    const historyBox = (await page.getByRole('region', { name: 'Commit history' }).boundingBox())!;
    expect(expandedMarkerBox.x + expandedMarkerBox.width).toBeLessThanOrEqual(historyBox.x + historyBox.width);
    await marker.click({ position: { x: expandedMarkerBox.width - 1, y: expandedMarkerBox.height / 2 } });
    await expect(page.locator('.commit-row.selected')).toContainText('Refine graph lane rendering');
  });
}

test('remembers only the resized panel and restores compact automatic widths', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  const left = page.getByRole('separator', { name: 'Resize left panel', exact: true });
  const right = page.getByRole('separator', { name: 'Resize commit panel', exact: true });
  await expect(left).toHaveAttribute('aria-valuenow', '205');
  await expect(right).toHaveAttribute('aria-valuenow', '310');
  await left.click();
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.panel.sidebar.width'))).toBeNull();
  const edge = (await left.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 10, edge.y + edge.height / 2);
  await page.mouse.up();
  await expect(left).toHaveAttribute('aria-valuenow', '215');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.panel.details.width'))).toBeNull();
  await page.reload();
  await expect(left).toHaveAttribute('aria-valuenow', '215');
  await expect(right).toHaveAttribute('aria-valuenow', '310');
  await left.dblclick();
  await expect(left).toHaveAttribute('aria-valuenow', '205');
  await page.reload();
  await expect(left).toHaveAttribute('aria-valuenow', '205');
  await expect(right).toHaveAttribute('aria-valuenow', '310');
});

test('preserves a saved wide panel after clicking its clamped splitter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  const left = page.getByRole('separator', { name: 'Resize left panel', exact: true });
  await left.press('End');
  await expect(left).toHaveAttribute('aria-valuenow', '420');
  await page.setViewportSize({ width: 1080, height: 720 });
  await expect(left).toHaveAttribute('aria-valuenow', '350');
  await left.click();
  await left.press('End');
  await left.press('ArrowRight');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.panel.sidebar.width'))).toBe('420');
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 720 });
  await expect(left).toHaveAttribute('aria-valuenow', '420');
});

test('preserves a saved wide inspector after a no-op keyboard resize at the viewport limit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  const right = page.getByRole('separator', { name: 'Resize commit panel', exact: true });
  await right.press('End');
  await expect(right).toHaveAttribute('aria-valuenow', '560');
  await page.setViewportSize({ width: 1080, height: 720 });
  await expect(right).toHaveAttribute('aria-valuenow', '490');
  await right.press('End');
  await right.press('ArrowLeft');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.panel.details.width'))).toBe('560');
  await page.setViewportSize({ width: 1440, height: 720 });
  await expect(right).toHaveAttribute('aria-valuenow', '560');
});

test('does not close a new branch draft after a repository switch ends a resize', async ({ page }) => {
  const name = page.getByRole('textbox', { name: 'New branch name' });
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  await name.fill('before-repository-switch');
  const splitter = page.getByRole('separator', { name: 'Resize left panel', exact: true });
  await splitter.dispatchEvent('pointerdown', { pointerId: 20, isPrimary: true, button: 0, clientX: 250 });
  await page.locator('body').dispatchEvent('pointermove', { pointerId: 20, clientX: 275 });
  await page.evaluate(() => {
    const git = window.ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    git.repositories.update((repositories) => [
      ...repositories,
      { ...repository, id: 'other-preview', path: `${repository.path}-other` },
    ]);
    git.activeRepositoryId.set('other-preview');
  });
  await expect(name).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.cursor)).toBe('');
  await page.getByRole('button', { name: 'Create branch', exact: true }).first().click();
  await name.fill('after-repository-switch');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(name).toHaveValue('after-repository-switch');
});

test('gives reference splitters a full unobscured hit area and prevents resize sticking', async ({ page }) => {
  const splitter = page.getByRole('separator', { name: 'Resize Local section', exact: true });
  const box = (await splitter.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(12);
  expect(await splitter.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return [1, box.height - 1].every((offset) => document.elementFromPoint(box.x + box.width / 2, box.y + offset) === element);
  })).toBe(true);
  await splitter.focus();
  const before = Number(await splitter.getAttribute('aria-valuenow'));
  await splitter.dispatchEvent('pointerdown', { pointerId: 10, isPrimary: true, button: 0, clientY: box.y });
  await page.locator('body').dispatchEvent('pointermove', { pointerId: 11, clientY: box.y + 90 });
  await expect(splitter).toHaveAttribute('aria-valuenow', String(before));
  await page.locator('body').dispatchEvent('pointermove', { pointerId: 10, clientY: box.y + 30 });
  await expect(splitter).toHaveAttribute('aria-valuenow', String(before + 30));
  await page.locator('body').dispatchEvent('pointercancel', { pointerId: 10 });
  await page.locator('body').dispatchEvent('pointermove', { pointerId: 10, clientY: box.y + 90 });
  await expect(splitter).toHaveAttribute('aria-valuenow', String(before + 30));
  await expect.poll(() => page.evaluate(() => document.documentElement.style.userSelect)).toBe('');
  await splitter.dispatchEvent('pointerdown', { pointerId: 12, isPrimary: true, button: 2, clientY: box.y });
  await page.locator('body').dispatchEvent('pointermove', { pointerId: 12, clientY: box.y + 90 });
  await expect(splitter).toHaveAttribute('aria-valuenow', String(before + 30));
});

test('ends panel, graph, working-tree and terminal gestures when the window loses focus', async ({ page }) => {
  for (const name of ['Resize left panel', 'Resize Branch and Tag column', 'Resize Unstaged Files section', 'Resize terminal']) {
    if (name.includes('Unstaged')) await page.locator('.wip-nav').click();
    if (name.includes('terminal')) await page.locator('.toolbar-terminal-direct').click();
    const splitter = page.getByRole('separator', { name, exact: true });
    const before = await splitter.getAttribute('aria-valuenow');
    await splitter.dispatchEvent('pointerdown', { pointerId: 15, isPrimary: true, button: 0, clientX: 100, clientY: 100 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.locator('body').dispatchEvent('pointermove', { pointerId: 15, clientX: 200, clientY: 200 });
    await expect(splitter).toHaveAttribute('aria-valuenow', before!);
    await expect.poll(() => page.evaluate(() => document.documentElement.style.cursor)).toBe('');
  }
});
