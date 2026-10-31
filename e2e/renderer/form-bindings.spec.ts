import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
});

test('buffers composed reference searches until the composition ends', async ({ page }) => {
  const sidebar = page.locator('.sidebar');
  const filter = sidebar.getByRole('searchbox', { name: 'Filter references' });
  await filter.fill('v0.1.0');
  await expect(sidebar.getByRole('button', { name: 'Tags 1' })).toBeVisible();

  await filter.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Reference filter is not an input');
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.value = 'upstream/main';
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      isComposing: true,
    }));
  });
  await expect(filter).toHaveValue('upstream/main');
  await expect(sidebar.getByRole('button', { name: 'Tags 1' })).toBeVisible();

  await filter.dispatchEvent('compositionend', { data: 'upstream/main' });
  await expect(sidebar.getByRole('button', { name: /Local branch main, current/ })).toBeVisible();
  await filter.press('Escape');
  await expect(filter).toHaveValue('');
  await expect(sidebar.getByRole('button', { name: 'Local 3' })).toBeVisible();
});

test('keeps commit text, options, and co-author data synchronized', async ({ page }) => {
  await page.evaluate(() => {
    const root = document.querySelector('gc-root');
    if (!root) throw new Error('Application root not found');
    const app = (window as Window & {
      ng: {
        getComponent(element: Element): {
          git: {
            commit(message: string, options: Record<string, unknown>): Promise<boolean>;
          };
        };
      };
    }).ng.getComponent(root);
    app.git.commit = async (message, options) => {
      sessionStorage.setItem('form-test-commit', JSON.stringify({ message, options }));
      return true;
    };
  });

  const summary = page.getByRole('textbox', { name: 'Commit summary' });
  const description = page.getByRole('textbox', { name: 'Commit description' });
  await summary.fill('ac');
  await summary.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Commit summary is not an input');
    element.setSelectionRange(1, 1);
  });
  await summary.press('b');
  await expect(summary).toHaveValue('abc');
  await expect.poll(() => summary.evaluate((element) =>
    element instanceof HTMLInputElement ? element.selectionStart : null,
  )).toBe(2);
  await description.fill('Detailed explanation');

  const coAuthorToggle = page.locator('.add-coauthor');
  await coAuthorToggle.click();
  const picker = page.locator('.coauthor-picker');
  await picker.locator('input[name="coAuthorName"]').fill('Morgan Lee');
  await picker.locator('input[name="coAuthorEmail"]').fill('morgan@example.test');
  await picker.getByRole('button', { name: 'Add co-author' }).click();
  await expect(page.locator('.coauthor-chips')).toContainText('Morgan Lee');
  await expect(picker.locator('input[name="coAuthorName"]')).toHaveValue('');
  await coAuthorToggle.click();

  await page.getByRole('checkbox', { name: 'Sign this commit' }).check();
  await page.getByRole('checkbox', { name: 'Skip verification hooks' }).check();
  const commit = page.locator('.commit-form').getByRole('button', { name: /Commit changes to/ });
  await expect(commit).toBeEnabled();
  await commit.click();
  await expect.poll(() => page.evaluate(() => {
    const recorded = sessionStorage.getItem('form-test-commit');
    return recorded ? JSON.parse(recorded) : null;
  })).toEqual({
    message: 'abc\n\nDetailed explanation\n\nCo-authored-by: Morgan Lee <morgan@example.test>',
    options: { amend: false, skipHooks: true, sign: true, pushAfter: false, signOff: false, allowEmpty: false, author: null, committer: null },
  });
  await expect(summary).toHaveValue('');
  await expect(description).toHaveValue('');
});

test('submits and clears the working-tree stash message', async ({ page }) => {
  await page.goto('/?stash-message=Initial');
  const stashMessage = page.getByRole('textbox', { name: 'Stash message' });
  await expect(stashMessage).toHaveValue('Initial');
  await page.evaluate(() => {
    const root = document.querySelector('gc-root');
    if (!root) throw new Error('Application root not found');
    const app = (window as Window & {
      ng: {
        getComponent(element: Element): {
          git: { stash(message: string): Promise<void> };
        };
      };
    }).ng.getComponent(root);
    app.git.stash = async (message) => {
      sessionStorage.setItem('form-test-stash', message);
    };
  });

  await stashMessage.fill('Save current work');
  await stashMessage.press('Enter');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('form-test-stash'))).toBe('Save current work');
  await expect(stashMessage).toHaveValue('');
});

test('keeps repository identity submission free of native email validation', async ({ page }) => {
  await page.getByTitle('Repository Git identity').click();
  const identity = page.locator('.identity-popover');
  await identity.getByRole('button', { name: 'Edit identity' }).click();
  await identity.getByLabel('Name').fill('Local User');
  await identity.getByLabel('Email').fill('local-identity');
  await identity.getByRole('button', { name: 'Save identity' }).click();
  await expect(identity).toContainText('local-identity');
  await expect(identity.locator('.identity-form')).toHaveCount(0);
});
