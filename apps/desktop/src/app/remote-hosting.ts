import type { Remote } from '@git-khronos/contracts';

export type HostingProvider = 'GitHub' | 'GitLab' | 'Bitbucket';

export interface HostedReviewRequests {
  provider: HostingProvider;
  remoteName: string;
  repositoryUrl: string;
  reviewRequestsUrl: string;
  actionLabel: 'Open pull requests' | 'Open merge requests';
  sectionLabel: 'Pull Requests' | 'Merge Requests';
}

interface RemoteLocation {
  host: string;
  segments: string[];
}

const PATH_SEGMENT = /^[a-z0-9._-]+$/i;

function remoteLocation(remoteUrl: string): RemoteLocation | null {
  const value = remoteUrl.trim();
  if (!value) return null;

  const scpStyle = value.includes('://')
    ? null
    : value.match(/^(?:[^@\s]+@)?([^:/\s]+):([^\s]+)$/);
  let host: string;
  let path: string;
  if (scpStyle) {
    host = scpStyle[1];
    path = scpStyle[2];
  } else {
    try {
      const url = new URL(value);
      if (!['https:', 'ssh:', 'git:'].includes(url.protocol)) return null;
      host = url.hostname;
      path = url.pathname;
    } catch {
      return null;
    }
  }

  const segments = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/');
  if (segments.length < 2 || segments.some((segment) => !PATH_SEGMENT.test(segment))) return null;
  return { host: host.toLocaleLowerCase(), segments };
}

export function hostedReviewRequestsForRemote(remote: Remote): HostedReviewRequests | null {
  const location = remoteLocation(remote.fetchUrl) ?? remoteLocation(remote.pushUrl);
  if (!location) return null;

  const path = location.segments.join('/');
  const repositoryUrl = `https://${location.host}/${path}`;
  if (location.host === 'github.com' && location.segments.length === 2) {
    return {
      provider: 'GitHub',
      remoteName: remote.name,
      repositoryUrl,
      reviewRequestsUrl: `${repositoryUrl}/pulls`,
      actionLabel: 'Open pull requests',
      sectionLabel: 'Pull Requests',
    };
  }
  if (location.host === 'gitlab.com') {
    return {
      provider: 'GitLab',
      remoteName: remote.name,
      repositoryUrl,
      reviewRequestsUrl: `${repositoryUrl}/-/merge_requests`,
      actionLabel: 'Open merge requests',
      sectionLabel: 'Merge Requests',
    };
  }
  if (location.host === 'bitbucket.org' && location.segments.length === 2) {
    return {
      provider: 'Bitbucket',
      remoteName: remote.name,
      repositoryUrl,
      reviewRequestsUrl: `${repositoryUrl}/pull-requests`,
      actionLabel: 'Open pull requests',
      sectionLabel: 'Pull Requests',
    };
  }
  return null;
}

export function hostedReviewRequestsForRemotes(remotes: readonly Remote[]): HostedReviewRequests | null {
  const origin = remotes.find((remote) => remote.name === 'origin');
  const ordered = origin ? [origin, ...remotes.filter((remote) => remote !== origin)] : remotes;
  for (const remote of ordered) {
    const destination = hostedReviewRequestsForRemote(remote);
    if (destination) return destination;
  }
  return null;
}
