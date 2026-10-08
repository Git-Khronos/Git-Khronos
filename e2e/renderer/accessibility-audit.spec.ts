import { expect, test, type Page } from '@playwright/test';

// Dependency-free structural accessibility audit of the rendered workspace in
// representative preview states. It complements focused keyboard tests.
async function audit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const visible = (element: Element) => {
      const box = (element as HTMLElement).getBoundingClientRect?.();
      const style = getComputedStyle(element);
      return !!box && box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && !element.closest('[aria-hidden="true"], [inert]');
    };
    const describe = (element: Element) => {
      const html = element.outerHTML.replace(/\s+/g, ' ');
      return html.length > 140 ? `${html.slice(0, 140)}…` : html;
    };
    const referenced = (element: Element, attribute: string) => (element.getAttribute(attribute) ?? '')
      .split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
    const name = (element: Element): string => (
      referenced(element, 'aria-labelledby')
      || element.getAttribute('aria-label')?.trim()
      || (element instanceof HTMLInputElement && element.labels?.length ? [...element.labels].map(label => label.textContent?.trim()).join(' ') : '')
      || ((element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && element.labels?.length ? [...element.labels].map(label => label.textContent?.trim()).join(' ') : '')
      || (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? '' : element.textContent?.trim())
      || element.getAttribute('title')?.trim()
      || ''
    );

    const ids = new Map<string, number>();
    for (const element of document.querySelectorAll('[id]')) ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    for (const [id, count] of ids) if (count > 1) problems.push(`duplicate id "${id}" (${count})`);

    for (const element of document.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls], [aria-activedescendant]')) {
      for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-activedescendant']) {
        for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) problems.push(`${attribute} references missing #${id}: ${describe(element)}`);
        }
      }
    }

    const interactive = 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="option"], [role="switch"], [role="link"], [role="treeitem"]';
    for (const element of document.querySelectorAll(interactive)) {
      if (visible(element) && !name(element)) problems.push(`unnamed control: ${describe(element)}`);
    }

    for (const element of document.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="checkbox"], [role="radio"]')) {
      if (visible(element) && !name(element)) problems.push(`unlabelled form control: ${describe(element)}`);
    }

    for (const element of document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog')) {
      if (visible(element) && !name(element)) problems.push(`unlabelled dialog: ${describe(element)}`);
    }

    for (const element of document.querySelectorAll('[role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="treeitem"], [role="switch"]')) {
      const native = element.matches('button, a[href], input, select, textarea');
      const managed = element.closest('[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="tablist"]');
      if (visible(element) && !native && !managed && !element.hasAttribute('tabindex')) problems.push(`custom control is not focusable: ${describe(element)}`);
    }

    for (const element of document.querySelectorAll('[tabindex]')) {
      if (Number(element.getAttribute('tabindex')) > 0) problems.push(`positive tabindex breaks reading order: ${describe(element)}`);
    }

    for (const image of document.querySelectorAll('img')) {
      if (visible(image) && !image.hasAttribute('alt') && !image.getAttribute('aria-label')) problems.push(`image without text alternative: ${describe(image)}`);
    }
    for (const graphic of document.querySelectorAll('svg')) {
      const decorative = graphic.closest('[aria-hidden="true"]') || graphic.getAttribute('role') === 'presentation' || graphic.getAttribute('focusable') === 'false';
      const labelled = graphic.getAttribute('aria-label') || graphic.getAttribute('aria-labelledby') || graphic.querySelector('title');
      const insideNamed = graphic.parentElement?.closest(interactive);
      if (visible(graphic) && graphic.getAttribute('role') === 'img' && !labelled) problems.push(`graphic role without name: ${describe(graphic)}`);
      if (visible(graphic) && !decorative && !labelled && !insideNamed && graphic.getAttribute('role') !== 'img' && graphic.getBoundingClientRect().width < 40) {
        problems.push(`standalone icon is neither hidden nor named: ${describe(graphic)}`);
      }
    }
    return [...new Set(problems)];
  });
}

const states = [
  '/',
  '/?welcome-preview',
  '/?worktree-tabs',
  '/?compare-commits&diff-viewer=split',
  '/?unmerged-branch-preview',
  '/?sparse-preview',
  '/?worktree-dialog',
  '/?untracked-directory-preview',
  '/?unpublished-branch',
  '/?submodules',
  '/?signing-preview',
  '/?merge-preview',
  '/?lfs-preview',
  '/?interactive-rebase',
  '/?history-preview=cherry-pick',
  '/?clean-preview',
];

for (const state of states) {
  test(`has a structurally accessible interface for ${state}`, async ({ page }) => {
    await page.goto(state);
    await page.locator('body').getByRole('main').or(page.locator('app-root')).first().waitFor();
    await page.waitForLoadState('networkidle');
    expect(await audit(page)).toEqual([]);
  });
}

test('keeps open menus and dialogs structurally accessible', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const opener = page.getByTitle('Command palette (Ctrl+P)');
  await opener.focus();
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');
  for (const title of ['Pull options', 'Push options', 'Branch options', 'Configure graph columns']) {
    await page.getByTitle(title).click();
    expect(await audit(page), title).toEqual([]);
    await page.keyboard.press('Escape');
  }
});
