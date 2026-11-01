import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Share the source-library aliases used by Angular. Contracts is an Nx source
// library rather than a separately published/linked package.
const config = JSON.parse(readFileSync(new URL('./tsconfig.base.json', import.meta.url), 'utf8'));
const alias = Object.fromEntries(
  Object.entries(config.compilerOptions.paths as Record<string, string[]>).map(([name, paths]) => {
    if (name.includes('*') || paths.length !== 1) throw new Error(`Unsupported test alias: ${name}`);
    return [name, fileURLToPath(new URL(paths[0], import.meta.url))];
  }),
);

export default defineConfig({
  resolve: { alias },
  test: { maxWorkers: 2, exclude: [...configDefaults.exclude, '**/target/**'] },
});
