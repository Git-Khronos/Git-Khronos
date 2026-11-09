import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkProductionRenderer } from '../../../../tools/check-production-renderer.mjs';

const directories: string[] = [];
function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'git-khronos-production-renderer-'));
  directories.push(directory);
  writeFileSync(join(directory, 'index.html'), '<script type="module" src="main.js"></script>');
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('production renderer preview exclusion', () => {
  it('isolates development builds and their cached assets from release output', () => {
    const project = JSON.parse(readFileSync(new URL('../../project.json', import.meta.url), 'utf8'));
    const workspace = JSON.parse(readFileSync(new URL('../../../../angular.json', import.meta.url), 'utf8'));
    const build = project.targets.build;
    expect(build.outputs).toEqual(['{options.output-path}']);
    expect(build.options['output-path']).toBe('dist/apps/desktop');
    expect(build.configurations.development['output-path']).toBe('dist/development/desktop');
    expect(workspace.projects.desktop.architect.build.configurations.development.outputPath)
      .toBe('dist/development/desktop');
    expect(build.options.commands[1].command).toContain('{args.output-path}/browser');
  });

  it('keeps development checks outside the production asset directory', () => {
    const project = JSON.parse(readFileSync(new URL('../../project.json', import.meta.url), 'utf8'));
    const command = project.targets.check.options.commands.find((entry: string) => entry.startsWith('ng build '));
    expect(command).toContain('--configuration development');
    expect(command).toContain('--output-path=dist/checks/desktop');
    const workspace = JSON.parse(readFileSync(new URL('../../../../angular.json', import.meta.url), 'utf8'));
    expect(workspace.projects.desktop.architect.build.options.outputPath).not.toBe('dist/checks/desktop');
  });

  it('defines literal URL fixture flags separately for development and production', () => {
    const workspace = JSON.parse(readFileSync(new URL('../../../../angular.json', import.meta.url), 'utf8'));
    const configurations = workspace.projects.desktop.architect.build.configurations;
    expect(configurations.development.define.GIT_KHRONOS_BROWSER_PREVIEW_FIXTURES).toBe('true');
    expect(configurations.production.define.GIT_KHRONOS_BROWSER_PREVIEW_FIXTURES).toBe('false');
  });

  it('accepts real runtime chunks and normal browser sample data', () => {
    const directory = fixture();
    writeFileSync(join(directory, 'main.js'), 'export const browserSampleAuthor = "Maya Chen";');
    mkdirSync(join(directory, 'chunks'));
    writeFileSync(join(directory, 'chunks', 'dialog.js'), 'export const dialog = true;');
    expect(checkProductionRenderer(directory)).toEqual({ files: 2 });
  });

  for (const query of ['ghost-branch', 'multi-commit-menu', 'commit-file-menu']) {
    it(`rejects preview initializer ${query} in a deferred runtime chunk`, () => {
      const directory = fixture();
      writeFileSync(join(directory, 'main.js'), 'export const application = true;');
      mkdirSync(join(directory, 'chunks'));
      writeFileSync(join(directory, 'chunks', 'preview.js'), `export const query = ${JSON.stringify(query)};`);
      expect(() => checkProductionRenderer(directory)).toThrow(query);
    });
  }

  it('refuses an empty output directory rather than reporting absence as a pass', () => {
    const directory = fixture();
    expect(() => checkProductionRenderer(directory)).toThrow('No production renderer JavaScript');
    rmSync(join(directory, 'index.html'));
    expect(() => checkProductionRenderer(directory)).toThrow('index.html is missing');
  });
});
