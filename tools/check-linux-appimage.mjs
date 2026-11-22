#!/usr/bin/env node
import { constants } from 'node:fs';
import { readdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = resolve(process.argv[2] ?? '');

export async function checkAppImage(bundleDirectory) {
  const bundlePath = resolve(bundleDirectory);
  const entries = await readdir(bundlePath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.AppImage'))
    .map((entry) => join(bundlePath, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one regular .AppImage artifact in ${bundlePath}; found ${candidates.length}.`);
  }

  const artifact = candidates[0];
  const file = await open(artifact, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size === 0 || (metadata.mode & 0o111) === 0) {
      throw new Error('The AppImage must be a non-empty regular executable file.');
    }
    const magic = Buffer.alloc(4);
    const { bytesRead } = await file.read(magic, 0, magic.length, 0);
    if (bytesRead !== magic.length || !magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      throw new Error('The .AppImage artifact does not have an ELF runtime header.');
    }
  } finally {
    await file.close();
  }
  return artifact;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  (process.argv[2] ? checkAppImage(directory) : Promise.reject(new Error('Usage: check-linux-appimage.mjs <bundle-directory>')))
    .then((artifact) => console.log(artifact))
    .catch((error) => { console.error(`Git Khronos: ${error.message}`); process.exitCode = 1; });
}
