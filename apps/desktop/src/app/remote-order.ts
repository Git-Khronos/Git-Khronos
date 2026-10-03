export function buildRemoteNameOrder(
  configuredRemoteNames: readonly string[],
  upstream: string | null,
): ReadonlyMap<string, number> {
  const separator = upstream?.indexOf('/') ?? -1;
  const trackedRemote = upstream && separator > 0 ? upstream.slice(0, separator) : null;
  const ordered = [trackedRemote, 'origin', ...configuredRemoteNames]
    .filter((name): name is string => !!name)
    .filter((name, index, names) => names.indexOf(name) === index);
  return new Map(ordered.map((name, index) => [name, index]));
}

export function compareRemoteNames(
  left: string,
  right: string,
  order: ReadonlyMap<string, number>,
): number {
  return (order.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}
