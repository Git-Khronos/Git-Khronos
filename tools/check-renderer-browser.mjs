import { accessSync, constants } from 'node:fs';
import { chromium, webkit } from '@playwright/test';

const [name, ...extra] = process.argv.slice(2);
const browserType = { chromium, webkit };
const labels = { chromium: 'Chromium', webkit: 'WebKit' };

async function check() {
  if (!Object.hasOwn(browserType, name) || extra.length) {
    console.error('Usage: node tools/check-renderer-browser.mjs chromium|webkit');
    return 2;
  }

  // WebKit uses its advertised launcher. Chromium can also use a separate
  // headless-shell-only installation, so validate it with the actual launch.
  if (name === 'webkit') {
    const executable = webkit.executablePath();
    try {
      accessSync(executable, constants.X_OK);
    } catch {
      console.error('Playwright WebKit is not installed or executable at the configured browser path.');
      console.error(`Expected: ${executable}`);
      console.error('Run pnpm exec playwright install webkit with the same PLAYWRIGHT_BROWSERS_PATH, then retry.');
      return 1;
    }
  }

  try {
    const browser = await browserType[name].launch({ headless: true, timeout: 10_000 });
    await browser.close();
    return 0;
  } catch (error) {
    console.error(name === 'webkit'
      ? 'Playwright WebKit is installed but could not start. Check its platform dependencies.'
      : `Playwright ${labels[name]} could not start. Check its browser installation and platform dependencies.`);
    console.error(error.message);
    return 1;
  }
}

process.exitCode = await check();
