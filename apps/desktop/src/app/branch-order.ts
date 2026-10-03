export interface BranchOrderItem {
  readonly name: string;
  readonly current: boolean;
}

export function orderBranchesCurrentFirst<T extends BranchOrderItem>(branches: readonly T[]): T[] {
  return [...branches].sort((left, right) =>
    Number(right.current) - Number(left.current)
      || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
      || left.name.localeCompare(right.name));
}
