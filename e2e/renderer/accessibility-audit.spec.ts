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

async function auditTextContrast(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type Color = [number, number, number, number];
    const parseColor = (value: string): Color => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      if (value.startsWith('color(srgb')) {
        return [(channels[0] ?? 0) * 255, (channels[1] ?? 0) * 255,
          (channels[2] ?? 0) * 255, channels[3] ?? 1];
      }
      return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1];
    };
    const composite = (front: Color, back: Color): Color => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return alpha === 0 ? [0, 0, 0, 0] : [
        (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
        (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
        (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
        alpha,
      ];
    };
    const renderedBackground = (element: Element): Color => {
      const layers: Color[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) {
        layers.push(parseColor(getComputedStyle(current).backgroundColor));
      }
      const canvas = parseColor(getComputedStyle(document.body).backgroundColor);
      return layers.reduceRight((result, layer) => composite(layer, result), canvas);
    };
    const luminance = (color: Color): number => {
      const channels = color.slice(0, 3).map(channel => {
        const normalized = channel / 255;
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
      });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const contrastRatio = (foreground: Color, background: Color): number => {
      const renderedForeground = composite(foreground, background);
      const values = [luminance(renderedForeground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + .05) / (values[1] + .05);
    };

    return [...document.querySelectorAll<HTMLElement>('body *')].flatMap(element => {
      const directText = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ');
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const inactive = element.closest('[disabled], [aria-disabled="true"], [aria-hidden="true"], [inert]');
      if (!directText || inactive || bounds.width === 0 || bounds.height === 0
        || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const fontSize = Number.parseFloat(style.fontSize);
      const threshold = fontSize >= 24 || (fontSize >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      const ratio = contrastRatio(parseColor(style.color), renderedBackground(element));
      if (ratio + .01 >= threshold) return [];
      const selector = `${element.tagName.toLowerCase()}${[...element.classList]
        .map(name => `.${name}`).join('')}`;
      return [`${selector} "${directText.slice(0, 60)}" has ${ratio.toFixed(2)}:1 contrast; expected ${threshold}:1`];
    });
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

for (const theme of ['khronos', 'midnight'] as const) {
  for (const state of states) {
    test(`has a structurally accessible ${theme} interface for ${state}`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('git-khronos.ui.theme', selectedTheme);
      }, theme);
      await page.goto(state);
      await page.locator('body').getByRole('main').or(page.locator('app-root')).first().waitFor();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await audit(page)).toEqual([]);
      expect(await auditTextContrast(page)).toEqual([]);
    });
  }
}

for (const theme of ['khronos', 'midnight'] as const) {
  test(`keeps open ${theme} menus and dialogs accessible`, async ({ page }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem('git-khronos.ui.theme', selectedTheme);
    }, theme);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: 'Main menu' }).click();
    await expect(page.getByRole('menu', { name: 'Git Khronos menu' })).toBeVisible();
    expect(await audit(page)).toEqual([]);
    expect(await auditTextContrast(page)).toEqual([]);
    await page.keyboard.press('Escape');
    const opener = page.getByTitle('Command palette (Ctrl+P)');
    await opener.focus();
    await page.keyboard.press('Control+P');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    expect(await audit(page)).toEqual([]);
    expect(await auditTextContrast(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
    expect(await audit(page)).toEqual([]);
    expect(await auditTextContrast(page)).toEqual([]);
    await page.keyboard.press('Escape');
    const menuControls = [
      { label: 'Fetch options', control: page.getByTitle('Fetch options') },
      { label: 'Pull options', control: page.getByTitle('Pull options') },
      { label: 'Push options', control: page.getByTitle('Push options') },
      { label: 'Branch options', control: page.getByTitle('Branch options') },
      { label: 'Remote selector', control: page.getByRole('button', { name: /Select remote, current origin/ }) },
      { label: 'Branch selector', control: page.getByRole('button', { name: /Switch branch, current main/ }) },
      { label: 'Graph columns', control: page.getByRole('button', { name: 'Configure graph columns' }) },
    ];
    for (const { label, control } of menuControls) {
      await control.click();
      expect(await audit(page), label).toEqual([]);
      expect(await auditTextContrast(page), label).toEqual([]);
      await page.keyboard.press('Escape');
    }
  });
}
