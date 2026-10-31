import { expect, test, type Page } from '@playwright/test';

const FILES_PER_LIST = 1_200;
const ROW_HEIGHT = 31;

function filePath(section: 'unstaged' | 'staged', index: number): string {
  const group = String(Math.floor(index / 100)).padStart(2, '0');
  return `${section}/group-${group}/${section === 'unstaged' ? 'u' : 's'}-${String(index).padStart(4, '0')}.ts`;
}

async function loadLargeWorkingTree(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate((count) => {
    interface Entry {
      path: string;
      indexStatus: string;
      worktreeStatus: string;
      conflicted: boolean;
    }
    interface Repository {
      id: string;
      status: { entries: Entry[]; [key: string]: unknown };
      [key: string]: unknown;
    }
    interface Harness {
      git: {
        repository(): Repository;
        repositories: { update(fn: (repositories: Repository[]) => Repository[]): void };
      };
    }
    const root = document.querySelector('gc-root');
    if (!root) throw new Error('Application root not found');
    const debug = (window as Window & { ng?: { getComponent(element: Element): Harness } }).ng;
    if (!debug) throw new Error('Angular debug API unavailable');
    const app = debug.getComponent(root);
    const repository = app.git.repository();
    const entries = (['unstaged', 'staged'] as const).flatMap((section) =>
      Array.from({ length: count }, (_, index): Entry => ({
        path: `${section}/group-${String(Math.floor(index / 100)).padStart(2, '0')}/${section === 'unstaged' ? 'u' : 's'}-${String(index).padStart(4, '0')}.ts`,
        indexStatus: section === 'unstaged' ? ' ' : 'M',
        worktreeStatus: section === 'unstaged' ? 'M' : ' ',
        conflicted: false,
      })),
    );
    app.git.repositories.update((repositories) => repositories.map((candidate) =>
      candidate.id === repository.id
        ? { ...candidate, status: { ...candidate.status, entries, entryCount: entries.length, staged: count, unstaged: count, untracked: 0, conflicted: 0, entriesTruncated: false } }
        : candidate));
  }, FILES_PER_LIST);
  await expect(page.getByRole('button', { name: `Unstaged Files (${FILES_PER_LIST})` })).toBeVisible();
}

test('bounds both working-tree lists while preserving scrolling and filtering', async ({ page }) => {
  test.setTimeout(60_000);
  await loadLargeWorkingTree(page);
  const unstaged = page.locator('#unstaged-files-list');
  const staged = page.locator('#staged-files-list');

  expect(await unstaged.locator('.file-row').count()).toBeLessThan(30);
  expect(await staged.locator('.file-row').count()).toBeLessThan(30);
  expect(await unstaged.evaluate((list) => list.scrollHeight)).toBe(FILES_PER_LIST * ROW_HEIGHT);
  expect(await staged.evaluate((list) => list.scrollHeight)).toBe(FILES_PER_LIST * ROW_HEIGHT);
  expect(await unstaged.getByRole('button', { name: `Stage ${filePath('unstaged', 0)}` })
    .evaluate((button) => button.checkVisibility({ contentVisibilityAuto: true }))).toBe(true);

  await unstaged.evaluate((list, top) => { list.scrollTop = top; }, 500 * ROW_HEIGHT);
  await expect(unstaged.getByRole('button', { name: `Stage ${filePath('unstaged', 500)}` })).toBeVisible();
  expect(await unstaged.getByRole('button', { name: `Stage ${filePath('unstaged', 500)}` })
    .evaluate((button) => button.checkVisibility({ contentVisibilityAuto: true }))).toBe(true);
  await staged.evaluate((list, top) => { list.scrollTop = top; }, 800 * ROW_HEIGHT);
  await expect(staged.getByRole('button', { name: `Unstage ${filePath('staged', 800)}` })).toBeVisible();
  await expect(unstaged.getByRole('button', { name: `Stage ${filePath('unstaged', 500)}` })).toBeVisible();
  const resizer = page.getByRole('separator', { name: 'Resize Staged Files section' });
  await resizer.focus();
  await resizer.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '420');
  await expect.poll(() => staged.locator('.file-row').count()).toBeGreaterThan(20);
  expect(await staged.locator('.file-row').count()).toBeLessThan(30);
  expect(await staged.evaluate((list) => list.scrollHeight)).toBe(FILES_PER_LIST * ROW_HEIGHT);

  await staged.evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await expect(staged.getByRole('button', { name: `Unstage ${filePath('staged', FILES_PER_LIST - 1)}` })).toBeVisible();
  await page.getByRole('button', { name: `Staged Files (${FILES_PER_LIST})`, exact: true }).click();
  await page.getByRole('button', { name: `Staged Files (${FILES_PER_LIST})`, exact: true }).click();
  await expect(staged.getByRole('button', { name: `Unstage ${filePath('staged', 0)}` })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Filter changed files' }).fill('u-0002.ts');
  await expect(unstaged.getByRole('button', { name: `Stage ${filePath('unstaged', 2)}` })).toBeVisible();
  await expect(staged).toContainText('No matching staged files');
});

test('stages and unstages the correct file after scrolling', async ({ page }) => {
  test.setTimeout(60_000);
  await loadLargeWorkingTree(page);
  await page.evaluate(() => {
    interface Status { entries: Array<{ path: string; indexStatus: string; worktreeStatus: string }> }
    interface Harness { git: { repository(): { status: Status } } }
    const root = document.querySelector('gc-root');
    if (!root) throw new Error('Application root not found');
    const debug = (window as Window & { ng?: { getComponent(element: Element): Harness } }).ng;
    if (!debug) throw new Error('Angular debug API unavailable');
    const app = debug.getComponent(root);
    const testWindow = window as Window & {
      __TAURI_INTERNALS__?: { invoke(command: string, args: { path?: string }): Promise<Status> };
      __workingTreeCalls?: Array<{ command: string; path?: string }>;
    };
    const calls: Array<{ command: string; path?: string }> = [];
    testWindow.__workingTreeCalls = calls;
    testWindow.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        calls.push({ command, path: args.path });
        if (command === 'stage_path' || command === 'unstage_path' || command === 'refresh_repository_status') {
          return app.git.repository().status;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
  });
  const path = filePath('unstaged', 500);
  const unstaged = page.locator('#unstaged-files-list');
  const staged = page.locator('#staged-files-list');
  await unstaged.evaluate((list, top) => { list.scrollTop = top; }, 500 * ROW_HEIGHT);
  await unstaged.getByRole('button', { name: `Stage ${path}` }).click();
  await page.getByRole('searchbox', { name: 'Filter changed files' }).fill('u-0500.ts');
  await expect(staged.getByRole('button', { name: `Unstage ${path}` })).toBeVisible();
  await staged.getByRole('button', { name: `Unstage ${path}` }).click();
  await expect(unstaged.getByRole('button', { name: `Stage ${path}` })).toBeVisible();
  const calls = await page.evaluate(() => {
    const recorded = (window as Window & {
      __workingTreeCalls?: Array<{ command: string; path?: string }>;
    }).__workingTreeCalls;
    if (!recorded) throw new Error('Working-tree calls were not recorded');
    return recorded.filter((call) => call.command !== 'refresh_repository_status');
  });
  expect(calls).toEqual([{ command: 'stage_path', path }, { command: 'unstage_path', path }]);
});

test('keeps the working-tree viewport covered during large scroll jumps', async ({ page }) => {
  test.setTimeout(60_000);
  await loadLargeWorkingTree(page);
  for (const selector of ['#unstaged-files-list', '#staged-files-list']) {
    const gaps = await page.locator(selector).evaluate(async (list) => {
      const gaps: number[] = [];
      for (const target of [0, 15_500, 31_000, 3_100, 25_575, 0, 36_900]) {
        list.scrollTop = target;
        await new Promise<void>((resolve) => requestAnimationFrame(() => queueMicrotask(resolve)));
        const viewport = list.getBoundingClientRect();
        const rows = [...list.querySelectorAll<HTMLElement>('.file-row')]
          .map((row) => row.getBoundingClientRect())
          .filter((row) => row.bottom > viewport.top && row.top < viewport.bottom);
        if (!rows.length || rows[0].top > viewport.top + 1 || rows.at(-1)!.bottom < viewport.bottom - 1) {
          gaps.push(target);
        }
      }
      return gaps;
    });
    expect(gaps, selector).toEqual([]);
  }
});

test('keeps rows painted during rapid mouse-wheel scrolling', async ({ page }) => {
  test.setTimeout(60_000);
  await loadLargeWorkingTree(page);
  for (const selector of ['#unstaged-files-list', '#staged-files-list']) {
    const list = page.locator(selector);
    await list.hover();
    await list.evaluate((element) => {
      const state = { running: true, gaps: [] as number[] };
      (window as Window & { __workingTreeScrollProbe?: typeof state }).__workingTreeScrollProbe = state;
      const sample = () => {
        if (!state.running) return;
        const viewport = element.getBoundingClientRect();
        const rows = [...element.querySelectorAll<HTMLElement>('.file-row')]
          .map((row) => row.getBoundingClientRect())
          .filter((row) => row.bottom > viewport.top && row.top < viewport.bottom);
        if (!rows.length || rows[0].top > viewport.top + 1 || rows.at(-1)!.bottom < viewport.bottom - 1) {
          state.gaps.push(element.scrollTop);
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    for (const delta of [1_500, 2_400, 6_000, -1_700, -4_500]) {
      const before = await list.evaluate((element) => element.scrollTop);
      await page.mouse.wheel(0, delta);
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).not.toBe(before);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }
    const gaps = await page.evaluate(() => {
      const state = (window as Window & { __workingTreeScrollProbe?: { running: boolean; gaps: number[] } }).__workingTreeScrollProbe;
      if (!state) throw new Error('Working-tree scroll probe was not started');
      state.running = false;
      return state.gaps;
    });
    expect(gaps, selector).toEqual([]);
  }
});

test('keeps keyboard navigation working beyond the initially rendered rows', async ({ page }) => {
  test.setTimeout(60_000);
  await loadLargeWorkingTree(page);
  const unstaged = page.locator('#unstaged-files-list');
  const first = unstaged.getByRole('button', { name: `Stage ${filePath('unstaged', 0)}` });
  await first.focus();
  for (let index = 0; index < 36; index += 1) await page.keyboard.press('Tab');
  const later = unstaged.getByRole('button', { name: `Stage ${filePath('unstaged', 12)}` });
  await expect(later).toBeFocused();
  expect(await unstaged.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  for (let index = 0; index < 36; index += 1) await page.keyboard.press('Shift+Tab');
  await expect(first).toBeFocused();
});

test('exposes keyboard-scrollable regions for all loaded files', async ({ page }) => {
  test.setTimeout(60_000);
  await loadLargeWorkingTree(page);
  for (const section of ['unstaged', 'staged'] as const) {
    const label = section === 'unstaged' ? 'Unstaged files' : 'Staged files';
    const action = section === 'unstaged' ? 'Stage' : 'Unstage';
    const region = page.getByRole('region', { name: label, exact: true });
    await expect(region).toHaveAttribute('aria-describedby', 'working-tree-file-navigation-help');
    await region.focus();
    await expect(region).toHaveCSS('outline-style', 'solid');
    await region.press('PageDown');
    await expect.poll(() => region.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
    await region.press('End');
    await expect(region.getByRole('button', { name: `${action} ${filePath(section, FILES_PER_LIST - 1)}` })).toBeVisible();
    await region.press('Home');
    await expect(region.getByRole('button', { name: `${action} ${filePath(section, 0)}` })).toBeVisible();
  }
});

test('virtualizes tree rows and preserves directory expand and collapse', async ({ page }) => {
  test.setTimeout(60_000);
  await loadLargeWorkingTree(page);
  await page.getByRole('group', { name: 'File list layout' }).getByRole('button', { name: 'Tree' }).click();
  const unstaged = page.locator('#unstaged-files-list');
  const directory = unstaged.getByRole('button', { name: 'group-00', exact: true });
  await expect(directory).toHaveAttribute('aria-expanded', 'true');
  expect(await directory.evaluate((element) => element.getBoundingClientRect().height)).toBe(ROW_HEIGHT);
  expect(await unstaged.locator('.file-row, .file-tree-directory').count()).toBeLessThan(30);
  const expandedHeight = await unstaged.evaluate((list) => list.scrollHeight);
  await directory.click();
  await expect(directory).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => unstaged.evaluate((list) => list.scrollHeight)).toBe(expandedHeight - 100 * ROW_HEIGHT);
  await directory.click();
  await expect(directory).toHaveAttribute('aria-expanded', 'true');
  await unstaged.evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await expect(unstaged.getByRole('button', { name: `Stage ${filePath('unstaged', FILES_PER_LIST - 1)}` })).toBeVisible();
});
