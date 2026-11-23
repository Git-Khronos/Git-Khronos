/**
 * Identify the emitted chunk for a component's dynamic import. The workspace
 * itself is now loaded lazily too, so matching an export name in any chunk can
 * accidentally hold the application bootstrap instead of the feature chunk.
 */
export function lazyChunkForExport(body: string, exportName: string): string | null {
  const escapedName = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importPattern = new RegExp(
    'import\\(\\s*[`"]([^`"]+)[`"]\\s*\\)\\s*\\.then\\(\\s*(?:\\(\\s*\\w+\\s*\\)|\\w+)\\s*=>\\s*\\w+\\.' + escapedName + '\\s*\\)',
  );
  const match = body.match(importPattern);
  return match?.[1].split('/').pop() ?? null;
}

export function requestIsChunk(requestUrl: string, chunk: string | null): boolean {
  return chunk !== null && new URL(requestUrl).pathname.endsWith(`/${chunk}`);
}
