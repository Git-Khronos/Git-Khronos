import { describe, expect, it } from 'vitest';
import { parseIdentityProfiles, validIdentityProfile } from './identity-profiles';
const profile = { id: 'work', label: 'Work', name: 'A User', email: 'a@example.test' };
describe('saved commit identities', () => {
  it('loads only bounded, distinct plain identity fields', () => {
    expect(parseIdentityProfiles(JSON.stringify([profile, { ...profile, id: 'duplicate' }, { ...profile, id: 'bad', name: 'a\nuser' }, { ...profile, id: 'home', label: ' Home ', token: 'discard' }])))
      .toEqual([profile, { ...profile, id: 'home', label: 'Home' }]);
    expect(parseIdentityProfiles(JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ ...profile, id: `${i}`, label: `${i}` }))))).toHaveLength(50);
  });
  it('tolerates corrupted storage and rejects controls, blank or oversized fields', () => {
    for (const raw of [null, '{', '{}', 'null', ' '.repeat(100_001)]) expect(parseIdentityProfiles(raw)).toEqual([]);
    for (const name of ['', ' ', 'a\ruser', '\0', 'x'.repeat(321)]) expect(validIdentityProfile({ ...profile, name })).toBe(false);
  });
});
