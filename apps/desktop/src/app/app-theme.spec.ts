import { describe, expect, it } from 'vitest';
import { APP_THEME_OPTIONS, appThemeNavigationValue, normalizeAppTheme } from './app-theme';

describe('application theme preference', () => {
  it('accepts every exposed theme', () => {
    for (const option of APP_THEME_OPTIONS) expect(normalizeAppTheme(option.value)).toBe(option.value);
  });

  it('falls back to the project default for stale or invalid values', () => {
    expect(normalizeAppTheme(null)).toBe('khronos');
    expect(normalizeAppTheme('light')).toBe('khronos');
    expect(normalizeAppTheme('chronos')).toBe('khronos');
  });

  it('navigates the theme radio group in every desktop direction', () => {
    expect(appThemeNavigationValue('khronos', 'ArrowRight')).toBe('midnight');
    expect(appThemeNavigationValue('khronos', 'ArrowDown')).toBe('midnight');
    expect(appThemeNavigationValue('khronos', 'ArrowLeft')).toBe('midnight');
    expect(appThemeNavigationValue('midnight', 'ArrowUp')).toBe('khronos');
    expect(appThemeNavigationValue('midnight', 'Home')).toBe('khronos');
    expect(appThemeNavigationValue('khronos', 'End')).toBe('midnight');
  });
});
