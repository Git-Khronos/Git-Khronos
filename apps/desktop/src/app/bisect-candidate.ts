import type { BisectCandidate } from '@git-khronos/contracts';

export function sameBisectCandidate(
  left: BisectCandidate | null | undefined,
  right: BisectCandidate | null | undefined,
): boolean {
  return left?.oid === right?.oid && left?.noCheckout === right?.noCheckout
    && left?.terms?.old === right?.terms?.old && left?.terms?.new === right?.terms?.new;
}
