import { expect, test, type Page } from '@playwright/test';
import { expectGraphLayout, type Column } from './graph-layout-test-helpers';

const DEFAULT_ORDER: Column[] = ['branch', 'graph', 'message', 'author', 'date'];

// Delay delivery, not browser execution or application rendering. Apply the
// same delay to either implementation's browser-read API for a fair regression.
function withDelayedBrowserReply(page: Page): Page {
  return new Proxy(page, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === 'evaluate' || property === 'waitForFunction') {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(value, target, args);
          await new Promise(resolve => setTimeout(resolve, 4000));
          return result;
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function narrowHeading(page: Page, restoreAfterMs: number | null = null) {
  return page.locator('.graph-columns > .draggable-column').first().evaluate((heading, restoreAfterMs) => {
    const previous = heading.getAttribute('style');
    for (const [property, value] of [
      ['flex', '0 0 1px'], ['width', '1px'], ['min-width', '1px'], ['max-width', '1px'],
      ['padding', '0'], ['border-width', '0'],
    ]) {
      heading.style.setProperty(property, value, 'important');
    }
    const width = heading.getBoundingClientRect().width;
    if (restoreAfterMs !== null) window.setTimeout(() => {
      if (previous === null) heading.removeAttribute('style');
      else heading.setAttribute('style', previous);
    }, restoreAfterMs);
    return width;
  }, restoreAfterMs);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  await expectGraphLayout(page, DEFAULT_ORDER, 'unmodified baseline');
});

test('accepts valid geometry when browser reply delivery exceeds the readiness deadline', async ({ page }) => {
  await expectGraphLayout(withDelayedBrowserReply(page), DEFAULT_ORDER, 'delayed valid browser reply');
});

test('waits for transient invalid geometry to recover', async ({ page }) => {
  expect(await narrowHeading(page, 1000)).toBeLessThanOrEqual(1);
  await expectGraphLayout(page, DEFAULT_ORDER, 'transient narrow heading');
});

test('rejects persistent invalid geometry at the unchanged three-second deadline', async ({ page }) => {
  expect(await narrowHeading(page)).toBeLessThanOrEqual(1);
  const error = await expectGraphLayout(page, DEFAULT_ORDER, 'persistent narrow heading')
    .then(() => null, error => error as Error & { cause?: Error });
  expect(error?.message).toContain('persistent narrow heading: layout verification failed');
  expect(error?.cause?.message).toContain('3000ms');
});
