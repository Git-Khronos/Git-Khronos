// An isolated qualification checkout retains packages and evidence, not cache copies.
import { existsSync, realpathSync, rmSync, statfsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GiB = 1024n ** 3n;
const minimumCargoFreeSpace = 12n * GiB;
const minimumCheckoutFreeSpace = 2n * GiB;

export function requireLinuxPackageSpace(directory, targetDirectory, readStats = statfsSync, temporaryDirectory = process.env.TMPDIR) {
  // Hosted CI images have their own disk allocation policy. This safeguard
  // applies to developer builds and to locally launched archive builders.
  if (process.env.CI === 'true' || process.env.CI === '1') return;
  const check = (output, minimum, label) => {
    let path = resolve(directory, output);
    while (!existsSync(path)) path = dirname(path);
    const { bsize, bavail } = readStats(path, { bigint: true });
    const available = bsize * bavail;
    if (available < minimum) {
      throw new Error(`Only ${available / GiB} GiB free for the Linux package build (${label}: ${path}); need at least ${minimum / GiB} GiB. Use task clean:debug or task clean:archives first.`);
    }
  };
  check(targetDirectory || 'target', minimumCargoFreeSpace, 'Cargo output');
  // An external target directory doesn't relocate renderer/package assets.
  check('.', minimumCheckoutFreeSpace, 'checkout');
  if (targetDirectory) check('target', minimumCheckoutFreeSpace, 'package staging');
  check(temporaryDirectory || 'target/package-tmp', minimumCheckoutFreeSpace, 'package temporary files');
}

export function pruneIsolatedLinuxPackageCache(directory, targetDirectory) {
  const root = resolve(directory);
  const isolated = root === '/work/source' || /\/target\/local-review\/.+\/work\/source$/.test(root);
  // An explicit Cargo target may be a shared cache, even for an isolated run.
  if (!isolated || targetDirectory) return 0;
  const disposable = [
    ...['deps', 'build', 'incremental', '.fingerprint', 'examples'].map(name => join('target/release', name)),
    join('target/package-tmp', 'node-compile-cache'),
  ];
  let pruned = 0;
  for (const name of disposable) {
    const path = join(root, name);
    try {
      if (realpathSync(path) !== path) continue;
      rmSync(path, { recursive: true, force: true });
      pruned++;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return pruned;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === '--preflight') {
      requireLinuxPackageSpace(process.cwd(), process.env.CARGO_TARGET_DIR);
    } else {
      const count = pruneIsolatedLinuxPackageCache(process.cwd(), process.env.CARGO_TARGET_DIR);
      if (count) console.log(`Removed ${count} regenerable Rust or Node cache directories from the isolated package build.`);
    }
  } catch (error) {
    console.error(`Linux package storage: ${error.message}`);
    process.exitCode = 1;
  }
}
