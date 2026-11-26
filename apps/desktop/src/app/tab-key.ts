/** WebKitGTK can report Shift+Tab as Unidentified while preserving its physical key. */
export function isTabKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>): boolean {
  return event.key === 'Tab' || (event.key === 'Unidentified' && event.code === 'Tab' && event.shiftKey);
}
