import { expect, test } from '@playwright/test';

for (const family of ['Arial', 'DejaVu Sans', 'Liberation Sans']) {
  test(`keeps repository context, author initials and status controls legible with ${family}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await page.addStyleTag({ content: `:root { --font-ui: "${family}", sans-serif; }` });
    for (const width of [1440, 820, 700, 500, 420, 360]) {
      await page.setViewportSize({ width, height: 800 });
      const zoom = page.getByLabel('Interface zoom controls', { exact: true });
      await expect.poll(async () => {
        const zoomBox = await zoom.boundingBox();
        const version = page.locator('.status-version');
        if (!await version.isVisible()) return true;
        const box = await version.boundingBox();
        return !!box && !!zoomBox && box.x + box.width <= zoomBox.x - 8;
      }).toBe(true);
      if (width === 700) {
        const remote = page.locator('.remote-nav-button strong');
        expect(await remote.evaluate(element => element.scrollWidth <= element.clientWidth), `${family}: remote name must fit`).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const description = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .commit-description');
    expect(await description.evaluate(element => {
      const copy = element.parentElement!;
      return element.clientWidth >= Math.floor(copy.clientWidth * .18 - parseFloat(getComputedStyle(copy).columnGap));
    })).toBe(true);
    expect(await page.locator('.commit-row[data-commit-oid] .author-node').evaluateAll(nodes => nodes.every(node => {
      const probe = node.cloneNode(true) as HTMLElement;
      probe.textContent = 'WW'; probe.style.visibility = 'hidden'; node.parentElement!.append(probe);
      const fits = probe.scrollWidth <= probe.clientWidth; probe.remove(); return fits;
    }))).toBe(true);
  });
}
