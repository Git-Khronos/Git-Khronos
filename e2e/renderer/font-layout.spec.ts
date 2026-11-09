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
        if (!zoomBox) return false;
        for (const selector of ['.status-branch', '.status-sync', '.status-changes', '.activity-status', '.status-version']) {
          for (const item of await page.locator(selector).all()) {
            if (!await item.isVisible()) continue;
            const box = await item.boundingBox();
            if (!box || box.x + box.width > zoomBox.x - 8) return false;
          }
        }
        return true;
      }).toBe(true);
      if (width === 700) {
        const remote = page.locator('.remote-nav-button strong');
        expect(await remote.evaluate(element => element.scrollWidth <= element.clientWidth), `${family}: remote name must fit`).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const subject = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .subject');
    expect(await subject.evaluate(element => element.scrollWidth <= element.clientWidth), `${family}: sample subject must remain readable`).toBe(true);
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
