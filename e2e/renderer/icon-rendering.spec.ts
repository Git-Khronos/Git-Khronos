import { expect, test, type Page } from '@playwright/test';
import { ICON_SHAPES, type IconName } from '../../apps/desktop/src/app/icon-shapes';

async function verifyVisibleIcons(page: Page) {
  const icons = await page.locator('gk-icon').evaluateAll(hosts => hosts
    .filter(host => host.getClientRects().length)
    .map(host => {
      const component = (window as any).ng.getComponent(host);
      const svg = host.querySelector('svg')!;
      const bounds = svg.getBBox();
      return {
        name: component.name(), size: component.size(), strokeWidth: component.strokeWidth(),
        width: svg.getAttribute('width'), height: svg.getAttribute('height'),
        stroke: svg.getAttribute('stroke-width'), hidden: svg.getAttribute('aria-hidden'),
        paintBounds: bounds.width + bounds.height,
        geometry: [...svg.children].map(element => ({ kind: element.localName,
          ...Object.fromEntries([...element.attributes].filter(attribute => !attribute.name.startsWith('_ngcontent'))
            .map(attribute => [attribute.name, attribute.value])) })),
      };
    }));
  expect(icons.length).toBeGreaterThan(20);
  for (const icon of icons) {
    expect(icon.geometry, icon.name).toEqual(ICON_SHAPES[icon.name as IconName]);
    expect(icon.width).toBe(String(icon.size));
    expect(icon.height).toBe(String(icon.size));
    expect(icon.stroke).toBe(String(icon.strokeWidth));
    expect(icon.hidden).toBe('true');
    expect(icon.paintBounds, icon.name).toBeGreaterThan(0);
  }
}

test('data-bound SVGs preserve original geometry, size, stroke and accessible decoration', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await verifyVisibleIcons(page);
  await page.locator('#reference-section-local .heading-toggle').click();
  await verifyVisibleIcons(page);
  await page.locator('#reference-section-local .heading-toggle').click();
  await verifyVisibleIcons(page);
});
