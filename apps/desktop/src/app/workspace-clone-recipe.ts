const RECIPE_FORMAT = 'git-khronos.clone-recipe';
const RECIPE_VERSION = 1;
export const MAX_CLONES = 20;
export const MAX_RECIPE_TEXT = 40_960;
export type CloneTarget = { source: string; folder: string };

export function suggestedCloneFolder(source: string): string {
  const path = /^[a-z][\w+.-]*:\/\//i.test(source)
    ? source.replace(/^[a-z][\w+.-]*:\/\/[^/]*(\/|$)/i, '').split(/[?#]/, 1)[0]
    : source.replace(/^[^/\\:]+:(?![/\\])/, '');
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1)?.replace(/\.git$/i, '') ?? '';
}

export function validCloneFolder(folder: string): boolean {
  return !!folder && folder === folder.trim() && folder !== '.' && folder !== '..' && folder.length <= 255
    && !/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(folder) && !folder.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(folder);
}

export const cloneFolderKey = (folder: string): string => folder.normalize('NFC').toLowerCase();

/** A recipe is shareable data, not a generic Git transport or filesystem path. */
export function portableCloneSource(source: string): boolean {
  if (source.length > 1_600 || !/^[!-~]+$/.test(source) || /[\\?#]|%(?:[01][0-9a-f]|7f|5c)/i.test(source)) return false;
  const scheme = /^(https|ssh):\/\/([^/%]+)\//i.exec(source);
  if (!scheme) {
    // Git's explicit SSH shorthand (no local drive or ambiguous bare hostname).
    return /^\w[\w.-]*@[a-z0-9][a-z0-9.-]*:(?!:).+$/i.test(source);
  }
  try {
    const url = new URL(source);
    if (!url.hostname || url.pathname === '/' || url.password) return false;
    const userinfo = scheme[2].includes('@') ? scheme[2].slice(0, scheme[2].lastIndexOf('@')) : null;
    if (url.protocol === 'https:') return userinfo === null;
    return url.protocol === 'ssh:' && (userinfo === null || /^\w[\w.-]*$/.test(userinfo));
  } catch { return false; }
}

type RecipeRead = { targets: CloneTarget[] } | { error: string };

function exactFields<Key extends string>(value: unknown, names: readonly Key[]): value is Record<Key, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

export function readCloneRecipe(text: string): RecipeRead {
  if (text.length > MAX_RECIPE_TEXT) return { error: 'The clone recipe is too large.' };
  let recipe: unknown;
  try { recipe = JSON.parse(text); }
  catch { return { error: 'The clone recipe is not valid JSON.' }; }
  if (!exactFields(recipe, ['format', 'version', 'repositories']) || recipe.format !== RECIPE_FORMAT || recipe.version !== RECIPE_VERSION) {
    return { error: 'This is not a supported Git Khronos clone recipe.' };
  }
  const entries = recipe.repositories;
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_CLONES) {
    return { error: `A clone recipe needs between 1 and ${MAX_CLONES} repositories.` };
  }
  const names = new Set<string>();
  const targets: CloneTarget[] = [];
  for (const [index, row] of entries.entries()) {
    if (!exactFields(row, ['source', 'folder']) || typeof row.source !== 'string' || typeof row.folder !== 'string'
      || !portableCloneSource(row.source) || !validCloneFolder(row.folder)) {
      return { error: `Recipe repository ${index + 1} needs a shareable HTTPS or SSH URL and a single folder name.` };
    }
    const key = cloneFolderKey(row.folder);
    if (names.has(key)) return { error: 'Each recipe repository needs a different folder name.' };
    names.add(key);
    targets.push({ source: row.source, folder: row.folder });
  }
  return { targets };
}

export function createCloneRecipe(sources: readonly string[]): string {
  if (!sources.length || sources.length > MAX_CLONES || !sources.every(portableCloneSource)) return '';
  const names = new Set<string>();
  const repositories = sources.map(source => {
    const suggested = suggestedCloneFolder(source);
    const stem = validCloneFolder(suggested) ? suggested : 'repository';
    let folder = stem;
    for (let i = 2; names.has(cloneFolderKey(folder)); i++) {
      const suffix = `-${i}`;
      folder = stem.slice(0, 255 - suffix.length) + suffix;
    }
    names.add(cloneFolderKey(folder));
    return { source, folder };
  });
  const text = JSON.stringify({ format: RECIPE_FORMAT, version: RECIPE_VERSION, repositories }, null, 2);
  return text.length <= MAX_RECIPE_TEXT ? text : '';
}
