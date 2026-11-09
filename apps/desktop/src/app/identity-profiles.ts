export const IDENTITY_PROFILES_KEY = 'git-khronos.identity-profiles.v1';
export interface IdentityProfile { id: string; label: string; name: string; email: string }

export function validIdentityProfile(value: unknown): value is IdentityProfile {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['id', 'label', 'name', 'email'].every(key => typeof item[key] === 'string'
    && !!(item[key] as string).trim() && (item[key] as string).length <= 320
    && !/[\x00-\x1f\x7f]/.test(item[key] as string));
}

export function parseIdentityProfiles(raw: string | null): IdentityProfile[] {
  try {
    if (!raw || raw.length > 100_000) return [];
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    const seenIds = new Set<string>();
    const seenLabels = new Set<string>();
    return items.filter(validIdentityProfile).filter(item => {
      const label = item.label.trim().toLocaleLowerCase();
      if (seenIds.has(item.id) || seenLabels.has(label)) return false;
      seenIds.add(item.id); seenLabels.add(label);
      return true;
    }).slice(0, 50).map(({ id, label, name, email }) => ({ id, label: label.trim(), name: name.trim(), email: email.trim() }));
  } catch { return []; }
}
