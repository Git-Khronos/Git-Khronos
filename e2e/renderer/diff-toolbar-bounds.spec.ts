import { expect, test, type Page } from '@playwright/test';

async function assertToolbar(page: Page) {
  const toolbar = page.locator('.diff-workspace-toolbar');
  await expect(toolbar).toBeVisible();
  const pane = await toolbar.boundingBox();
  expect(pane).not.toBeNull();
  const controls = await toolbar.locator('button:visible').evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') ?? element.textContent, x, y, width, height,
      reachable: element.contains(document.elementFromPoint(x + width / 2, y + height / 2)) };
  }));
  for (let index = 0; index < controls.length; index++) {
    const control = controls[index];
    expect(control.x, control.label ?? '').toBeGreaterThanOrEqual(pane!.x - 1);
    expect(control.x + control.width, control.label ?? '').toBeLessThanOrEqual(pane!.x + pane!.width + 1);
    expect(control.y, control.label ?? '').toBeGreaterThanOrEqual(pane!.y - 1);
    expect(control.y + control.height, control.label ?? '').toBeLessThanOrEqual(pane!.y + pane!.height + 1);
    expect(control.reachable, `${control.label} is clipped or covered`).toBe(true);
    for (const other of controls.slice(index + 1)) {
      const overlapX = Math.min(control.x + control.width, other.x + other.width) - Math.max(control.x, other.x);
      const overlapY = Math.min(control.y + control.height, other.y + other.height) - Math.max(control.y, other.y);
      expect(overlapX > 1 && overlapY > 1, `${control.label} overlaps ${other.label}`).toBe(false);
    }
  }
  const back = await toolbar.locator('.diff-back').boundingBox();
  const identity = await toolbar.locator('.diff-file-identity').boundingBox();
  expect(back).not.toBeNull(); expect(identity).not.toBeNull();
  expect(back!.x + back!.width).toBeLessThanOrEqual(identity!.x + 1);
}

for (const width of [320, 360, 700, 780, 1051, 1440, 1550, 1600, 1920]) {
  test(`keeps diff toolbar controls inside their center pane at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?compare-commits&diff-viewer=split');
    await assertToolbar(page);
    await page.getByRole('group', { name: 'Diff layout', exact: true }).getByRole('button', { name: 'Split', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.diff.view-mode'))).toBe('split');
    if (width === 780 || width === 1550) await page.screenshot({ path: test.info().outputPath(`diff-toolbar-${width}.png`) });
  });
}

for (const width of [320, 700, 780, 1440, 1550, 1920]) {
  test(`keeps selected-line controls reachable after resizing to ${width}px`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await page.getByTitle('View changes in apps/desktop/src/app/app.component.html', { exact: true }).click();
    const diff = page.getByLabel('Diff viewer', { exact: true });
    const selector = diff.getByRole('button', { name: /Select added line/ });
    await selector.focus(); await selector.press('Enter');
    const actions = diff.getByRole('group', { name: 'Selected line actions', exact: true });
    await expect(actions).toContainText('2 selected');
    await page.setViewportSize({ width, height: 900 });
    await assertToolbar(page);
    await expect(actions.getByRole('button', { name: 'Stage', exact: true })).toBeEnabled();
    await expect(actions.getByRole('button', { name: 'Discard', exact: true })).toBeEnabled();
    await actions.getByRole('button', { name: 'Clear selected lines', exact: true }).click();
    await expect(actions).toBeHidden();
    await assertToolbar(page);
  });
}
