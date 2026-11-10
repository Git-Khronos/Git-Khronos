/** User zoom multipliers in percent. 100 always means "the automatic default". */
export const DEFAULT_ZOOM = 100;
export const ZOOM_LEVELS = [75, 80, 90, DEFAULT_ZOOM, 110, 125, 140, 150, 175, 200] as const;

/** Bounds and reference size of the automatic scale, expressed in CSS pixels. */
export const AUTO_ZOOM_REFERENCE_WIDTH = 1920;
export const AUTO_ZOOM_REFERENCE_HEIGHT = 1080;
export const AUTO_ZOOM_MIN = 100;
export const AUTO_ZOOM_MAX = 175;
const AUTO_ZOOM_STEP = 5;
const MAX_EFFECTIVE_ZOOM = 400;

export const ZOOM_PREFERENCE_KEY = 'git-khronos.ui.zoom-multiplier';
/** Earlier releases stored an absolute zoom here; it is intentionally ignored and removed. */
export const LEGACY_ZOOM_PREFERENCE_KEY = 'git-khronos.ui.zoom';

export function normalizeZoom(value: unknown): number {
  if (typeof value === 'string' && !value.trim()) return DEFAULT_ZOOM;
  const requested = Number(value);
  if (!Number.isFinite(requested)) return DEFAULT_ZOOM;
  if (requested <= ZOOM_LEVELS[0]) return ZOOM_LEVELS[0];
  if (requested >= ZOOM_LEVELS.at(-1)!) return ZOOM_LEVELS.at(-1)!;
  return ZOOM_LEVELS.reduce((closest, level) =>
    Math.abs(level - requested) < Math.abs(closest - requested) ? level : closest
  );
}

/**
 * Automatic scale (percent) for a screen of the given size in CSS pixels, i.e.
 * after any operating-system scaling that the web view already applies.
 */
export function automaticZoom(cssWidth: number, cssHeight: number): number {
  if (!(cssWidth > 0 && cssHeight > 0)) return AUTO_ZOOM_MIN;
  const scale = Math.min(cssWidth / AUTO_ZOOM_REFERENCE_WIDTH, cssHeight / AUTO_ZOOM_REFERENCE_HEIGHT) * 100;
  const snapped = Math.round(scale / AUTO_ZOOM_STEP) * AUTO_ZOOM_STEP;
  return Math.min(AUTO_ZOOM_MAX, Math.max(AUTO_ZOOM_MIN, snapped));
}

/** Zoom factor handed to the web view: automatic scale times the user multiplier. */
export function effectiveZoom(automatic: number, multiplier: number): number {
  return Math.min(MAX_EFFECTIVE_ZOOM, Math.round(automatic * multiplier / 100));
}
