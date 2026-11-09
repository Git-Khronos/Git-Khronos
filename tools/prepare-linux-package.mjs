#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { prepareRustNotices } from './prepare-rust-notices.mjs';
import { prepareFrontendNotices } from './prepare-frontend-notices.mjs';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(toolsDirectory);
const sourceDirectory = join(repositoryRoot, 'packaging', 'debian');
const outputDirectory = join(repositoryRoot, 'target', 'package-assets');

// Compute the entire catalog before replacing any generated asset. Missing or
// changed upstream terms must fail bundling, never retain an earlier catalog.
const rustNotices = prepareRustNotices({ repositoryRoot, target: process.env.TAURI_ENV_TARGET_TRIPLE });
const frontendNotices = prepareFrontendNotices(join(repositoryRoot, 'dist/apps/desktop/3rdpartylicenses.txt'), { repositoryRoot });
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'rust-dependency-notices.json.gz'), rustNotices);
await writeFile(join(outputDirectory, 'frontend-dependency-notices.txt.gz'), frontendNotices);

for (const [sourceName, outputName] of [
  ['changelog', 'changelog.gz'],
  ['git-khronos.1', 'git-khronos.1.gz'],
]) {
  const contents = await readFile(join(sourceDirectory, sourceName));
  await writeFile(join(outputDirectory, outputName), gzipSync(contents, { level: 9 }));
}
