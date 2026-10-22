export const FAVORITE_REPOSITORIES_KEY = 'git-khronos.favorite-repositories.v1';

export function toggleFavoriteRepository(
  favorites: readonly string[],
  path: string,
  limit = 50,
): string[] {
  if (favorites.includes(path)) return favorites.filter((favorite) => favorite !== path);
  return [path, ...favorites.filter((favorite) => favorite !== path)].slice(0, Math.max(0, limit));
}
