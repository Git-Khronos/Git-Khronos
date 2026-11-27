import { statfsSync } from 'node:fs';

const GiB = 1024n ** 3n;

// This is a start-of-run floor, not a quota on artifacts written later.
export function requireRendererSnapshotSpace(directory, readStats = statfsSync) {
  const { bsize, bavail } = readStats(directory, { bigint: true });
  const available = bsize * bavail;
  if (available < 2n * GiB) {
    const mib = available / (1024n ** 2n);
    throw new Error(`Renderer snapshot needs at least 2 GiB free on the evidence filesystem; ${mib} MiB available. Use another run directory or reclaim disposable caches.`);
  }
}
