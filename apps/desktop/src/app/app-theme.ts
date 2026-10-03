export type AppTheme = 'chronos' | 'midnight';
export type AppThemeNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export const APP_THEME_OPTIONS: ReadonlyArray<{ value: AppTheme; label: string }> = [
  { value: 'chronos', label: 'Chronos Dark' },
  { value: 'midnight', label: 'Midnight Contrast' },
];

export function normalizeAppTheme(value: unknown): AppTheme {
  return value === 'midnight' ? 'midnight' : 'chronos';
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
