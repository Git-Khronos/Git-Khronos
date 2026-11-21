export type PullStrategy = 'merge' | 'ff-only' | 'rebase';

export const PULL_STRATEGY_LABEL: Readonly<Record<PullStrategy, string>> = {
  merge: 'Fast-forward if possible',
  'ff-only': 'Fast-forward only',
  rebase: 'Rebase',
};
