export interface SearchHighlightSegment {
  readonly text: string;
  readonly matched: boolean;
}

export function highlightSearchText(value: string, query: string): SearchHighlightSegment[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!value || !normalizedQuery) return value ? [{ text: value, matched: false }] : [];

  const normalizedValue = value.toLocaleLowerCase();
  const segments: SearchHighlightSegment[] = [];
  let cursor = 0;
  let match = normalizedValue.indexOf(normalizedQuery);
  while (match >= 0) {
    if (match > cursor) segments.push({ text: value.slice(cursor, match), matched: false });
    const end = match + normalizedQuery.length;
    segments.push({ text: value.slice(match, end), matched: true });
    cursor = end;
    match = normalizedValue.indexOf(normalizedQuery, cursor);
  }
  if (!segments.length) return [{ text: value, matched: false }];
  if (cursor < value.length) segments.push({ text: value.slice(cursor), matched: false });
  return segments;
}
