import { describe, expect, it } from 'vitest';
import { APP_THEME_OPTIONS, appThemeNavigationValue, normalizeAppTheme } from './app-theme';

describe('application theme preference', () => {
  it('accepts every exposed theme', () => {
    for (const option of APP_THEME_OPTIONS) expect(normalizeAppTheme(option.value)).toBe(option.value);
  });

  it('falls back to the project default for stale or invalid values', () => {
    expect(normalizeAppTheme(null)).toBe('chronos');
    expect(normalizeAppTheme('light')).toBe('chronos');
  });

  it('navigates the theme radio group in every desktop direction', () => {
    expect(appThemeNavigationValue('chronos', 'ArrowRight')).toBe('midnight');
    expect(appThemeNavigationValue('chronos', 'ArrowDown')).toBe('midnight');
    expect(appThemeNavigationValue('chronos', 'ArrowLeft')).toBe('midnight');
    expect(appThemeNavigationValue('midnight', 'ArrowUp')).toBe('chronos');
    expect(appThemeNavigationValue('midnight', 'Home')).toBe('chronos');
    expect(appThemeNavigationValue('chronos', 'End')).toBe('midnight');
  });
});
