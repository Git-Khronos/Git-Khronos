export type PullStrategy = 'merge' | 'ff-only' | 'rebase';

export const PULL_STRATEGY_LABEL: Readonly<Record<PullStrategy, string>> = {
  merge: 'Fast-forward if possible',
  'ff-only': 'Fast-forward only',
  rebase: 'Rebase',
};

export const PULL_STRATEGY_CHOICES = [
  { id: 'merge', description: 'Merge when fast-forward is not possible' },
  { id: 'ff-only', description: 'Stop if a merge would be required' },
  { id: 'rebase', description: 'Replay local commits on the upstream branch' },
] satisfies ReadonlyArray<{ id: PullStrategy; description: string }>;
