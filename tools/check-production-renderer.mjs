import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// These URL keys belong only to development UI scenarios. The normal browser
// sample repository is separate; released native assets must not seed these
// fabricated inspections or selections from their document query string.
const previewQueries = ['ghost-branch', 'multi-commit-menu', 'commit-file-menu'];

export function checkProductionRenderer(directory) {
  if (!existsSync(join(directory, 'index.html'))) {
    throw new Error('Build the production renderer first: index.html is missing.');
  }
  const pending = [directory];
  const files = [];
  while (pending.length) {
    const parent = pending.pop();
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
    }
  }
  if (!files.length) throw new Error('No production renderer JavaScript assets were found.');
  for (const path of files) {
    const contents = readFileSync(path, 'utf8');
    const leaked = previewQueries.filter(query => contents.includes(query));
    if (leaked.length) {
      throw new Error(`Development preview initialization remains in ${relative(directory, path)}: ${leaked.join(', ')}`);
    }
  }
  return { files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directory = process.argv[2] ?? fileURLToPath(new URL('../dist/apps/desktop/browser/', import.meta.url));
    const report = checkProductionRenderer(directory);
    console.log(`Verified ${report.files} production JavaScript assets: development preview initialization is absent.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
