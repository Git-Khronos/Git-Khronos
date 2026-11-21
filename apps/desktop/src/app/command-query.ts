export const COMMAND_QUICK_ACTION_LIMIT = 6;

export function matchesCommandQuery(query: string, ...values: string[]): boolean {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const searchable = values.join(' ').toLocaleLowerCase();
  return tokens.every((token) => searchable.includes(token));
}
