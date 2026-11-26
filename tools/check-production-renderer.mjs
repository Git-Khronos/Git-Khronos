import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// These URL keys belong only to development UI scenarios. The normal browser
// sample repository is separate; released native assets must not seed these
// fabricated inspections or selections from their document query string.
const previewQueries = ['ghost-branch', 'multi-commit-menu', 'commit-file-menu'];
const legacyAppSelector = /\bgc-(?:root|app)\b/;

export function checkProductionRenderer(directory) {
  const index = join(directory, 'index.html');
  if (!existsSync(index)) {
    throw new Error('Build the production renderer first: index.html is missing.');
  }
  const document = readFileSync(index, 'utf8');
  if (legacyAppSelector.test(document) || !/<gk-root(?:\s[^>]*)?>/i.test(document)) {
    throw new Error('Production index.html must mount the application at <gk-root>.');
  }
  const pending = [directory];
  const files = [];
  const styles = [];
  while (pending.length) {
    const parent = pending.pop();
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
      else if (entry.isFile() && entry.name.endsWith('.css')) styles.push(path);
    }
  }
  if (!files.length) throw new Error('No production renderer JavaScript assets were found.');
  for (const path of files) {
    const contents = readFileSync(path, 'utf8');
    const leaked = previewQueries.filter(query => contents.includes(query));
    if (leaked.length) {
      throw new Error(`Development preview initialization remains in ${relative(directory, path)}: ${leaked.join(', ')}`);
    }
    if (legacyAppSelector.test(contents)) {
      throw new Error(`A legacy application selector remains in ${relative(directory, path)}; use the gk prefix.`);
    }
  }
  for (const path of styles) {
    if (legacyAppSelector.test(readFileSync(path, 'utf8'))) {
      throw new Error(`A legacy application selector remains in ${relative(directory, path)}; use the gk prefix.`);
    }
  }
  return { files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directory = process.argv[2] ?? fileURLToPath(new URL('../dist/apps/desktop/browser/', import.meta.url));
    const report = checkProductionRenderer(directory);
    console.log(`Verified the production mount, stylesheets, and ${report.files} JavaScript assets: no legacy app selectors or development preview initialization.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
