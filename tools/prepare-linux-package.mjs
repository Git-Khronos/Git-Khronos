#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(toolsDirectory);
const sourceDirectory = join(repositoryRoot, 'packaging', 'debian');
const outputDirectory = join(repositoryRoot, 'target', 'package-assets');

await mkdir(outputDirectory, { recursive: true });

for (const [sourceName, outputName] of [
  ['changelog', 'changelog.gz'],
  ['git-khronos-desktop.1', 'git-khronos-desktop.1.gz'],
]) {
  const contents = await readFile(join(sourceDirectory, sourceName));
  await writeFile(join(outputDirectory, outputName), gzipSync(contents, { level: 9 }));
}
