import type { RepositorySnapshot } from '@git-khronos/contracts';

export function lfsCheckoutSummary(lfs: RepositorySnapshot['lfs']): string {
  if (!lfs.available) return 'Not installed or unavailable';
  const version = lfs.version || 'Available';
  if (lfs.trackedFiles === null || lfs.pointerFiles === null) return `${version} · File counts unavailable`;
  return `${version} · ${lfs.trackedFiles} tracked ${lfs.trackedFiles === 1 ? 'file' : 'files'} · ${lfs.pointerFiles} not materialized`;
}
