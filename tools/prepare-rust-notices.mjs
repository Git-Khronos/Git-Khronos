import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { collectRustNotices } from './collect-rust-notices.mjs';

/** Create a reproducible notice payload; do not infer an exact linked-artifact SBOM. */
export function prepareRustNotices({ repositoryRoot, target, run = execFileSync }) {
  if (typeof target !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(target)) {
    throw new Error('Rust notice preparation requires the explicit Tauri target triple');
  }
  let metadata;
  try {
    metadata = JSON.parse(run('cargo', [
      'metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', target,
    ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  } catch {
    throw new Error('Cannot read locked offline Cargo metadata for package notices');
  }
  const catalog = collectRustNotices(metadata, {
    rootPackage: 'git-khronos-desktop', target,
    reviewedNotices: JSON.parse(readFileSync(join(repositoryRoot, 'packaging/licenses/reviewed-rust-notices.json'), 'utf8')),
    noticeRoot: join(repositoryRoot, 'packaging/licenses'),
  });
  return gzipSync(`${JSON.stringify(catalog, null, 2)}\n`, { level: 9 });
}
