export function savedDiscardLabel(id: string): string {
  const nanos = Number(id.split('-')[0]);
  return Number.isFinite(nanos) ? new Date(nanos / 1_000_000).toLocaleString() : id;
}

export function displayRecoveryPath(path: string): string {
  return /[\u0000-\u001f\u007f]/.test(path)
    ? JSON.stringify(path).replace(/\u007f/g, '\\u007f')
    : path;
}
