export type AppTheme = 'khronos' | 'midnight';
export type AppThemeNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export const APP_THEME_OPTIONS: ReadonlyArray<{ value: AppTheme; label: string }> = [
  { value: 'khronos', label: 'Khronos Dark' },
  { value: 'midnight', label: 'Midnight Contrast' },
];

export function normalizeAppTheme(value: unknown): AppTheme {
  // Any other value, including the legacy "chronos" id stored by earlier releases, selects the default.
  return value === 'midnight' ? 'midnight' : 'khronos';
}

export function appThemeNavigationValue(
  current: AppTheme,
  key: AppThemeNavigationKey,
): AppTheme {
  if (key === 'Home') return APP_THEME_OPTIONS[0].value;
  if (key === 'End') return APP_THEME_OPTIONS.at(-1)!.value;
  const currentIndex = Math.max(0, APP_THEME_OPTIONS.findIndex((option) => option.value === current));
  const direction = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  return APP_THEME_OPTIONS[(currentIndex + direction + APP_THEME_OPTIONS.length) % APP_THEME_OPTIONS.length].value;
}
