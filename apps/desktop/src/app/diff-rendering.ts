export const MAX_DETAILED_DIFF_CHARACTERS = 64_000;
export const MAX_DETAILED_DIFF_LINES = 1_500;

/**
 * Detailed word and syntax decoration is useful for ordinary source files, but
 * it multiplies the amount of work and DOM created for generated or minified
 * patches. Large previews remain readable as plain diff text.
 */
export function shouldDecorateDiff(patchLength: number, lineCount: number): boolean {
  return Number.isFinite(patchLength)
    && Number.isFinite(lineCount)
    && patchLength <= MAX_DETAILED_DIFF_CHARACTERS
    && lineCount <= MAX_DETAILED_DIFF_LINES;
}
