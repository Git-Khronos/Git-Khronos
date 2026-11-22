import { describe, expect, it } from 'vitest';
import { createCloneRecipe, MAX_CLONES, MAX_RECIPE_TEXT, portableCloneSource, readCloneRecipe } from './workspace-clone-recipe';

const https = 'https://git.example.test/team/library.git';
const ssh = 'ssh://git@internal.example.test:2222/mirror/Library.git';
const shorthand = 'git@git.example.test:other/tools.git';
const text = (repositories: unknown[], extra?: object) =>
  JSON.stringify({ format: 'git-khronos.clone-recipe', version: 1, repositories, ...extra });

describe('portable clone recipes', () => {
  it('round trips exact sources with consistent non-colliding destination names', () => {
    expect(readCloneRecipe(createCloneRecipe([https, ssh, shorthand]))).toEqual({ targets: [
      { source: https, folder: 'library' }, { source: ssh, folder: 'Library-2' }, { source: shorthand, folder: 'tools' },
    ] });
  });

  it.each([
    '/home/user/repo', 'C:\\Users\\me\\repo', 'file:///tmp/repo', 'git://git.example.test/repo',
    'https://token@git.example.test/repo', 'https://git.example.test/repo?token=secret',
    'https://git.example.test/repo#secret', 'http://git.example.test/repo', 'ssh://git:@git.example.test/repo',
    'ssh://git:password@git.example.test/repo', 'ssh://%67it@git.example.test/repo', 'https:///git.example.test/repo',
    'ext::git helper', 'https://git.example.test\\evil/repo', '-git@git.example.test:repo', 'https://git.example.test/',
    'https://git.example.test/line%0abreak',
  ])('rejects a nonportable or credential-bearing source: %s', source => {
    expect(portableCloneSource(source)).toBe(false);
    expect(createCloneRecipe([source])).toBe('');
    expect(readCloneRecipe(text([{ source, folder: 'repo' }]))).toHaveProperty('error');
  });

  it('rejects an unsupported version, unknown fields and unbounded input without loading a partial recipe', () => {
    const row = { source: https, folder: 'library' };
    expect(readCloneRecipe(text([row], { version: 2 }))).toHaveProperty('error');
    expect(readCloneRecipe(text([{ ...row, pushUrl: ssh }]))).toHaveProperty('error');
    expect(readCloneRecipe(text([row], { path: '/home/user/workspace' }))).toHaveProperty('error');
    expect(readCloneRecipe(text(Array.from({ length: MAX_CLONES + 1 }, () => row)))).toHaveProperty('error');
    expect(readCloneRecipe(' '.repeat(MAX_RECIPE_TEXT + 1))).toHaveProperty('error');
    expect(readCloneRecipe(text([]))).toHaveProperty('error');
  });

  it.each(['../escape', 'nested/child', 'C:relative', 'AUX', '...','safe.', ' safe ', 'line\nfeed', 'file\u202Etxt'])('rejects an unsafe folder: %s', folder => {
    expect(readCloneRecipe(text([{ source: https, folder }]))).toHaveProperty('error');
  });

  it('rejects case and Unicode-normalization collisions on import', () => {
    expect(readCloneRecipe(text([{ source: https, folder: 'Library' }, { source: ssh, folder: 'library' }]))).toHaveProperty('error');
    expect(readCloneRecipe(text([{ source: https, folder: 'café' }, { source: ssh, folder: 'cafe\u0301' }]))).toHaveProperty('error');
  });
});
