import { expect, test } from '@playwright/test';

test('bounds syntax work for long and dense diff and blame lines without losing text', async ({ page }) => {
  test.setTimeout(60_000);
  const dense = `${'a+'.repeat(512)}value`;
  const long = `const ${'x'.repeat(2_048)}`;
  await page.goto('/?compare-commits&diff-viewer=hunk&file-insight=blame');
  await expect(page.locator('.blame-line').first()).toBeVisible();

  await page.evaluate(({ dense, long }) => {
    const root = document.querySelector('gc-root');
    if (!root) throw new Error('Application root not found');
    const app = (window as Window & {
      ng: {
        getComponent(element: Element): {
          git: {
            comparisonFileDiff: {
              (): { path: string; patch: string } | null;
              set(value: { path: string; patch: string }): void;
            };
            fileBlame: {
              (): { text: string }[] | null;
              set(value: { text: string }[]): void;
            };
          };
        };
      };
    }).ng.getComponent(root);
    const diff = app.git.comparisonFileDiff();
    const blame = app.git.fileBlame();
    if (!diff || !blame || blame.length < 2) throw new Error('Expected the diff and blame fixtures');
    app.git.comparisonFileDiff.set({
      ...diff,
      path: 'dense.ts',
      patch: [
        '--- a/dense.ts',
        '+++ b/dense.ts',
        '@@ -1,4 +1,4 @@',
        `-${dense}old`,
        `+${dense}new`,
        '-const count = 1;',
        '+const count = 2;',
        `-${long}old`,
        `+${long}new`,
        ' const keep = 3;',
      ].join('\n'),
    });
    app.git.fileBlame.set([{ ...blame[0], text: dense }, { ...blame[1], text: long }]);
  }, { dense, long });

  const deletion = page.locator('.focus-diff-line.deletion').first().locator('.focus-diff-code code');
  const addition = page.locator('.focus-diff-line.addition').first().locator('.focus-diff-code code');
  const blame = page.locator('.blame-source').first();
  await expect(deletion).toHaveText(`-${dense}old`);
  await expect(addition).toHaveText(`+${dense}new`);
  await expect(blame).toHaveText(dense);

  await expect(deletion.locator('span')).toHaveCount(2);
  await expect(addition.locator('span')).toHaveCount(2);
  await expect(blame.locator('span')).toHaveCount(1);
  await expect(deletion.locator('.word-change')).toHaveText(`${dense}old`);
  await expect(addition.locator('.word-change')).toHaveText(`${dense}new`);

  const ordinaryDeletion = page.locator('.focus-diff-line.deletion').nth(1);
  await expect(ordinaryDeletion.locator('.syntax-keyword')).toContainText('const');
  await expect(ordinaryDeletion.locator('.word-change')).toContainText('1');

  const longDeletion = page.locator('.focus-diff-line.deletion').nth(2).locator('.focus-diff-code code');
  const longBlame = page.locator('.blame-source').nth(1);
  await expect(longDeletion).toHaveText(`-${long}old`);
  await expect(longDeletion.locator('.syntax-keyword')).toHaveCount(0);
  await expect(longDeletion.locator('.word-change')).toHaveText(`${'x'.repeat(2_048)}old`);
  await expect(longBlame).toHaveText(long);
  await expect(longBlame.locator('.syntax-keyword')).toHaveCount(0);

  await page.getByRole('group', { name: 'Diff layout' }).getByRole('button', { name: 'Split' }).click();
  const splitDeletion = page.locator('.split-side.deletion code').first();
  const splitAddition = page.locator('.split-side.addition code').first();
  await expect(splitDeletion).toHaveText(`-${dense}old`);
  await expect(splitAddition).toHaveText(`+${dense}new`);
  await expect(splitDeletion.locator('span')).toHaveCount(2);
  await expect(splitAddition.locator('span')).toHaveCount(2);
});
