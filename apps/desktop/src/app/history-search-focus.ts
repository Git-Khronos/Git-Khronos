/** The wide toolbar's launcher can become hidden in the compact layout. */
export function restoreHistorySearchFocus(
  surface: HTMLElement | null | undefined,
  opener: HTMLElement | null,
  ...fallbacks: (HTMLElement | null | undefined)[]
): void {
  const active = document.activeElement;
  if (active && active.isConnected && active !== document.body && active !== document.documentElement
    && active !== opener && !surface?.contains(active)) return;
  for (const control of [opener, ...fallbacks]) {
    if (!control?.isConnected || control === document.body || control === document.documentElement
      || control.matches(':disabled') || control.closest('[inert]')
      || !control.getClientRects().length || getComputedStyle(control).visibility !== 'visible') continue;
    control.focus({ preventScroll: true });
    if (document.activeElement === control) return;
  }
}
