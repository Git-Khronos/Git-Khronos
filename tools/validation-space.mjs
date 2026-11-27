import { statfsSync } from 'node:fs';

const GiB = 1024n ** 3n;

const availableBytes = (directory, readStats) => {
  const { bsize, bavail } = readStats(directory, { bigint: true });
  return bsize * bavail;
};

export function requireRendererSnapshotSpace(directory, readStats = statfsSync) {
  const available = availableBytes(directory, readStats);
  if (available < 2n * GiB) {
    const mib = available / (1024n ** 2n);
    throw new Error(`Renderer snapshot needs at least 2 GiB free on the evidence filesystem; ${mib} MiB available. Use another run directory or reclaim disposable caches.`);
  }
}

export function requireRendererRunSpace(directory, readStats = statfsSync) {
  const available = availableBytes(directory, readStats);
  if (available < GiB) {
    const mib = available / (1024n ** 2n);
    throw new Error(`Stopping renderer validation: less than 1 GiB free on the evidence filesystem (${mib} MiB available). Logs and exported artifacts are retained.`);
  }
}
