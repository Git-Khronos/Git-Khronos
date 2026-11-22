import { expect, test, type Page } from '@playwright/test';

async function holdInspector(page: Page, fail = false) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finished!: () => void;
  const done = new Promise<void>(resolve => { finished = resolve; });
  let requests = 0;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    if (!body.includes('RevisionInspectorComponent')) {
      await route.fulfill({ response, body });
      return;
    }
    requests++;
    await gate;
    if (fail) await route.abort();
    else await route.fulfill({ response, body });
    finished();
  });
  return { release, done, requests: () => requests };
}

const first = 'Polish repository activity drawer';
const second = 'Add hunk-level staging actions';
const commit = (page: Page, subject: string) =>
  page.locator('.commit-row[data-commit-oid] .commit-main').filter({ hasText: subject }).first();

test('the revision inspector stays out of startup and uses the latest selected commit after a delayed load', async ({ page }) => {
  const held = await holdInspector(page);
  try {
    await page.goto('/');
    const panel = page.locator('#repository-commit-panel');
    await expect(panel.locator('.commit-composer')).toBeVisible();
    expect(held.requests()).toBe(0);
    await commit(page, first).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Loading revision details…' })).toBeVisible();
    await commit(page, second).click();
    await expect(panel.getByRole('button', { name: 'Close commit panel', exact: true })).toBeVisible();
    held.release();
    await expect(panel.getByRole('heading', { name: second, exact: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: first, exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Changed Files/ })).toBeVisible();
    expect(held.requests()).toBe(1);
  } finally { held.release(); }
});

test('a late revision inspector cannot change the working directory selection or steal its focus', async ({ page }) => {
  const held = await holdInspector(page);
  try {
    await page.goto('/');
    const panel = page.locator('#repository-commit-panel');
    await commit(page, first).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Loading revision details…' })).toBeVisible();
    await page.locator('.wip-nav').click();
    const draft = panel.locator('#commit-summary');
    await draft.fill('Leave my draft in place');
    held.release();
    await held.done;
    await expect(draft).toHaveValue('Leave my draft in place');
    await expect(draft).toBeFocused();
    await expect(panel.locator('gc-revision-inspector')).toHaveCount(0);
  } finally { held.release(); }
});

test('a failed revision inspector leaves the shell close control and a return to WIP available', async ({ page }) => {
  const held = await holdInspector(page, true);
  try {
    await page.goto('/');
    const panel = page.locator('#repository-commit-panel');
    await commit(page, first).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Loading revision details…' })).toBeVisible();
    held.release();
    await expect(panel.getByRole('alert')).toContainText('Revision details could not load');
    await expect(panel.getByRole('button', { name: 'Close commit panel', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Return to working directory', exact: true }).click();
    await expect(panel.locator('.commit-composer')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Close commit panel', exact: true })).toBeFocused();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  } finally { held.release(); }
});
