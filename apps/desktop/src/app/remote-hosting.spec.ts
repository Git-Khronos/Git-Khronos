import { describe, expect, it } from 'vitest';
import { hostedReviewRequestsForRemote, hostedReviewRequestsForRemotes } from './remote-hosting';

describe('remote hosting links', () => {
  it.each([
    'git@github.com:chronos/git-chronos.git',
    'ssh://git@github.com/chronos/git-chronos.git',
    'https://github.com/chronos/git-chronos.git',
    'git://github.com/chronos/git-chronos.git',
  ])('derives GitHub pull requests from %s', (fetchUrl) => {
    expect(hostedReviewRequestsForRemote({ name: 'origin', fetchUrl, pushUrl: fetchUrl })).toEqual({
      provider: 'GitHub',
      remoteName: 'origin',
      repositoryUrl: 'https://github.com/chronos/git-chronos',
      reviewRequestsUrl: 'https://github.com/chronos/git-chronos/pulls',
      actionLabel: 'Open pull requests',
      sectionLabel: 'Pull Requests',
    });
  });

  it.each([
    'git@gitlab.com:chronos/platform/git-chronos.git',
    'ssh://git@gitlab.com/chronos/platform/git-chronos.git',
    'https://gitlab.com/chronos/platform/git-chronos.git',
  ])('preserves nested GitLab namespaces for %s', (fetchUrl) => {
    expect(hostedReviewRequestsForRemote({ name: 'origin', fetchUrl, pushUrl: fetchUrl })).toMatchObject({
      provider: 'GitLab',
      repositoryUrl: 'https://gitlab.com/chronos/platform/git-chronos',
      reviewRequestsUrl: 'https://gitlab.com/chronos/platform/git-chronos/-/merge_requests',
      actionLabel: 'Open merge requests',
      sectionLabel: 'Merge Requests',
    });
  });

  it.each([
    'git@bitbucket.org:chronos/git-chronos.git',
    'ssh://git@bitbucket.org/chronos/git-chronos.git',
    'https://maya@bitbucket.org/chronos/git-chronos.git',
  ])('derives Bitbucket pull requests from %s', (fetchUrl) => {
    expect(hostedReviewRequestsForRemote({ name: 'origin', fetchUrl, pushUrl: fetchUrl })).toMatchObject({
      provider: 'Bitbucket',
      repositoryUrl: 'https://bitbucket.org/chronos/git-chronos',
      reviewRequestsUrl: 'https://bitbucket.org/chronos/git-chronos/pull-requests',
      actionLabel: 'Open pull requests',
      sectionLabel: 'Pull Requests',
    });
  });

  it('falls back to a supported push URL and prefers origin over other remotes', () => {
    expect(hostedReviewRequestsForRemotes([
      { name: 'upstream', fetchUrl: 'https://gitlab.com/chronos/upstream.git', pushUrl: 'https://gitlab.com/chronos/upstream.git' },
      { name: 'origin', fetchUrl: 'file:///tmp/git-chronos.git', pushUrl: 'git@github.com:chronos/fork.git' },
    ])?.reviewRequestsUrl).toBe('https://github.com/chronos/fork/pulls');
  });

  it.each([
    'https://example.com/chronos/git-chronos.git',
    'file:///tmp/git-chronos.git',
    'https://github.com/chronos',
    'https://github.com/chronos/git-chronos/issues',
    'https://github.com/chronos/git chronos.git',
    'https://bitbucket.org/chronos/group/git-chronos.git',
  ])('rejects unsupported or malformed remote %s', (fetchUrl) => {
    expect(hostedReviewRequestsForRemote({ name: 'origin', fetchUrl, pushUrl: fetchUrl })).toBeNull();
  });
});
