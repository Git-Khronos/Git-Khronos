import { describe, expect, it } from 'vitest';
import { hostedReviewRequestsForRemote, hostedReviewRequestsForRemotes } from './remote-hosting';

describe('remote hosting links', () => {
  it.each([
    'git@github.com:chronos/git-khronos.git',
    'ssh://git@github.com/chronos/git-khronos.git',
    'https://github.com/chronos/git-khronos.git',
    'git://github.com/chronos/git-khronos.git',
  ])('derives GitHub pull requests from %s', (fetchUrl) => {
    expect(hostedReviewRequestsForRemote({ name: 'origin', fetchUrl, pushUrl: fetchUrl })).toEqual({
      provider: 'GitHub',
      remoteName: 'origin',
      repositoryUrl: 'https://github.com/chronos/git-khronos',
      reviewRequestsUrl: 'https://github.com/chronos/git-khronos/pulls',
      actionLabel: 'Open pull requests',
      sectionLabel: 'Pull Requests',
    });
  });

  it.each([
    'git@gitlab.com:chronos/platform/git-khronos.git',
    'ssh://git@gitlab.com/chronos/platform/git-khronos.git',
    'https://gitlab.com/chronos/platform/git-khronos.git',
  ])('preserves nested GitLab namespaces for %s', (fetchUrl) => {
    expect(hostedReviewRequestsForRemote({ name: 'origin', fetchUrl, pushUrl: fetchUrl })).toMatchObject({
      provider: 'GitLab',
      repositoryUrl: 'https://gitlab.com/chronos/platform/git-khronos',
      reviewRequestsUrl: 'https://gitlab.com/chronos/platform/git-khronos/-/merge_requests',
      actionLabel: 'Open merge requests',
      sectionLabel: 'Merge Requests',
    });
  });

  it.each([
    'git@bitbucket.org:chronos/git-khronos.git',
    'ssh://git@bitbucket.org/chronos/git-khronos.git',
    'https://maya@bitbucket.org/chronos/git-khronos.git',
  ])('derives Bitbucket pull requests from %s', (fetchUrl) => {
    expect(hostedReviewRequestsForRemote({ name: 'origin', fetchUrl, pushUrl: fetchUrl })).toMatchObject({
      provider: 'Bitbucket',
      repositoryUrl: 'https://bitbucket.org/chronos/git-khronos',
      reviewRequestsUrl: 'https://bitbucket.org/chronos/git-khronos/pull-requests',
      actionLabel: 'Open pull requests',
      sectionLabel: 'Pull Requests',
    });
  });

  it('falls back to a supported push URL and prefers origin over other remotes', () => {
    expect(hostedReviewRequestsForRemotes([
      { name: 'upstream', fetchUrl: 'https://gitlab.com/chronos/upstream.git', pushUrl: 'https://gitlab.com/chronos/upstream.git' },
      { name: 'origin', fetchUrl: 'file:///tmp/git-khronos.git', pushUrl: 'git@github.com:chronos/fork.git' },
    ])?.reviewRequestsUrl).toBe('https://github.com/chronos/fork/pulls');
  });

  it.each([
    'https://example.com/chronos/git-khronos.git',
    'file:///tmp/git-khronos.git',
    'https://github.com/chronos',
    'https://github.com/chronos/git-khronos/issues',
    'https://github.com/chronos/git khronos.git',
    'https://bitbucket.org/chronos/group/git-khronos.git',
  ])('rejects unsupported or malformed remote %s', (fetchUrl) => {
    expect(hostedReviewRequestsForRemote({ name: 'origin', fetchUrl, pushUrl: fetchUrl })).toBeNull();
  });
});
