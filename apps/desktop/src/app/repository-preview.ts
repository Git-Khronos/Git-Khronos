import type { RepositorySnapshot, CommitDetails, CommitComparison, CommitFile, CommitFileDiff, WorkingTreeFileDiff } from '@git-khronos/contracts';

export function createRepositoryPreview(): RepositorySnapshot {
  const commits = [
    { oid: 'f19b263a8af31408d5f665caf7a5508e108c0fd1', parents: ['83e6d15fb82672899688b93f59251dfc669888a3'], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-10-03T09:42:00Z', subject: 'Polish repository activity drawer', description: 'Make operation history easier to scan and diagnose.', decorations: ['HEAD -> main'] },
    { oid: '83e6d15fb82672899688b93f59251dfc669888a3', parents: ['160acd10ef9e0c202cd3985aa41ee45d971bbb11', '7c17b9d37d6a36dc9477e611109136f86477041a'], authorName: 'Leo Martin', authorEmail: 'leo@example.test', authoredAt: '2026-10-02T15:28:00Z', subject: 'Merge feature/partial-staging', description: 'Bring selective staging into the main workflow.', decorations: ['origin/main', 'upstream/main'] },
    { oid: '160acd10ef9e0c202cd3985aa41ee45d971bbb11', parents: ['ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2'], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-10-02T12:11:00Z', subject: 'Add hunk-level staging actions', description: 'Stage, unstage, and discard individual diff hunks.', decorations: ['tag: v0.1.0'] },
    { oid: '7c17b9d37d6a36dc9477e611109136f86477041a', parents: ['ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2'], authorName: 'Sam Rivera', authorEmail: 'sam@example.test', authoredAt: '2026-10-02T10:03:00Z', subject: 'Refine graph lane rendering', description: 'Keep first-parent histories straight through commit nodes.', decorations: ['feature/partial-staging'] },
    { oid: 'ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2', parents: ['14adfbb0c1685f62cba66f031306a510e3f501a2'], authorName: 'Alex Kim', authorEmail: 'alex@example.test', authoredAt: '2026-10-01T17:45:00Z', subject: 'Persist graph column preferences', description: 'Restore widths, ordering, and visibility per repository.', decorations: ['heads/release', 'remotes/origin/release', 'refs/remotes/upstream/release'] },
    { oid: '14adfbb0c1685f62cba66f031306a510e3f501a2', parents: [], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-09-29T08:17:00Z', subject: 'Initialize Git Khronos desktop', description: 'Create the Angular, Nx, Rust, and Tauri workspace.', decorations: [] },
  ];
  const headOid = commits[0].oid;
  const mergeOid = commits[1].oid;
  const tagOid = commits[2].oid;
  const featureOid = commits[3].oid;
  const releaseOid = commits[4].oid;
  const stashOid = 'b894e72d924a593884fad954e31fa5cc6f4b0bd9';
  commits.unshift({ oid: stashOid, parents: [headOid], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-10-03T10:05:00Z', subject: 'WIP on graph polish', description: '', decorations: ['refs/stash'] });
  return {
    id: 'browser-preview',
    showCheckpoints: false,
    name: 'git-khronos',
    path: '/home/maya/projects/git-khronos',
    identity: { name: 'Maya Chen', email: 'maya@example.test' },
    headOid,
    status: {
      branch: 'main', ahead: 1, behind: 0, staged: 1, unstaged: 2, untracked: 1, conflicted: 0, operations: null, mergeInProgress: false, historyOperation: null, historyNoCommit: false, rebaseInProgress: false, rebaseEditStopped: false, rebaseSplit: null, mailPatchInProgress: false, bisectInProgress: false, entryCount: 4, entriesTruncated: false,
      entries: [
        { path: 'apps/desktop/src/app/app.component.ts', indexStatus: 'M', worktreeStatus: ' ', conflicted: false },
        { path: 'apps/desktop/src/app/app.component.html', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
        { path: 'apps/desktop/src/app/app.component.scss', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
        { path: 'docs/interface-notes.md', indexStatus: '?', worktreeStatus: '?', conflicted: false },
      ],
    },
    signing: { enabled: false, format: 'openpgp', key: null },
    remotes: [
      { name: 'origin', fetchUrl: 'git@github.com:example/git-khronos.git', pushUrl: 'git@github.com:example/git-khronos.git' },
      { name: 'upstream', fetchUrl: 'https://github.com/example/git-khronos.git', pushUrl: 'https://github.com/example/git-khronos.git' },
    ],
    branches: [
      { fullName: 'refs/heads/feature/partial-staging', name: 'feature/partial-staging', oid: featureOid, current: false, remote: false, upstream: null, tracking: null },
      { fullName: 'refs/heads/main', name: 'main', oid: headOid, current: true, remote: false, upstream: 'origin/main', tracking: 'ahead 1' },
      { fullName: 'refs/heads/release', name: 'release', oid: releaseOid, current: false, remote: false, upstream: 'origin/release', tracking: null },
      { fullName: 'refs/remotes/origin/main', name: 'origin/main', oid: mergeOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/origin/release', name: 'origin/release', oid: releaseOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/upstream/main', name: 'upstream/main', oid: mergeOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/upstream/release', name: 'upstream/release', oid: releaseOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/origin/docs', name: 'origin/docs', oid: tagOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/upstream/docs', name: 'upstream/docs', oid: featureOid, current: false, remote: true, upstream: null, tracking: null },
    ],
    stashes: [{ reference: 'stash@{0}', oid: stashOid, message: 'WIP on graph polish' }],
    tags: [{ fullName: 'refs/tags/v0.1.0', name: 'v0.1.0', oid: tagOid }],
    worktrees: [
      { path: '/home/maya/projects/git-khronos', oid: headOid, branch: 'main', current: true, locked: false, prunable: false, statusLoaded: true, changes: 4, ahead: 1, behind: 0 },
      { path: '/home/maya/projects/git-khronos-partial-staging', oid: featureOid, branch: 'feature/partial-staging', current: false, locked: false, prunable: false, statusLoaded: true, changes: 2, ahead: 0, behind: 0 },
    ],
    submodules: [
      { name: 'vendor/lane-engine', path: 'vendor/lane-engine', absolutePath: '/home/maya/projects/git-khronos/vendor/lane-engine', url: 'https://github.com/example/lane-engine.git', oid: commits[4].oid, headOid: commits[4].oid, initialized: true, outOfSync: false },
      { name: 'plugins/diff-driver', path: 'plugins/diff-driver', absolutePath: '/home/maya/projects/git-khronos/plugins/diff-driver', url: 'git@github.com:example/diff-driver.git', oid: commits[5].oid, headOid: null, initialized: false, outOfSync: false },
    ],
    lfs: { enabled: false, available: false, version: null, trackedFiles: null, pointerFiles: null },
    sparseCheckout: { enabled: false, coneMode: true, sparseIndex: false, paths: [] },
    commitTemplate: null,
    commitTemplateError: null,
    bare: false,
    commits,
    historyTruncated: false,
  };
}

export function createPreviewCommitDetails(repository: RepositorySnapshot, oid: string | null): CommitDetails {
  const commit = repository.commits.find((candidate) => candidate.oid === oid) ?? repository.commits[0];
  const files = commit.subject.includes('graph')
    ? [
        { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 42, deletions: 11 },
        { status: 'M', path: 'apps/desktop/src/app/app.component.html', previousPath: null, additions: 18, deletions: 6 },
        { status: 'M', path: 'apps/desktop/src/app/app.component.scss', previousPath: null, additions: 27, deletions: 4 },
      ]
    : commit.subject.includes('staging')
      ? [
          { status: 'M', path: 'crates/git-core/src/lib.rs', previousPath: null, additions: 31, deletions: 9 },
          { status: 'M', path: 'apps/desktop/src/app/git-khronos.service.ts', previousPath: null, additions: 22, deletions: 7 },
          { status: 'A', path: 'apps/desktop/src/app/virtual-list.spec.ts', previousPath: null, additions: 38, deletions: 0 },
        ]
      : [
          { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 24, deletions: 8 },
          { status: 'M', path: 'apps/desktop/src/app/app.component.html', previousPath: null, additions: 16, deletions: 5 },
          { status: 'A', path: 'docs/interface-notes.md', previousPath: null, additions: 12, deletions: 0 },
        ];
  return {
    oid: commit.oid,
    message: `${commit.subject}\n\n${commit.description}`.trim(),
    signature: commit.oid === repository.headOid
      ? {
          status: 'valid',
          signer: `${commit.authorName} <${commit.authorEmail}>`,
          key: 'A1B2C3D4E5F60718',
          fingerprint: '9F3A54D2A1B2C3D4E5F6071829384756ABCDEF01',
          trust: 'ultimate',
        }
      : { status: 'unsigned', signer: null, key: null, fingerprint: null, trust: null },
    files,
    filesTruncated: false,
  };
}

export function createPreviewCommitComparison(baseOid: string, targetOid: string): CommitComparison {
  return {
    baseOid,
    targetOid,
    workingTree: false,
    files: [
      { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 19, deletions: 7 },
      { status: 'A', path: 'apps/desktop/src/app/compare-panel.scss', previousPath: null, additions: 34, deletions: 0 },
    ],
  };
}

export function createPreviewWorkingTreeComparison(baseOid: string): CommitComparison {
  return {
    baseOid,
    targetOid: baseOid,
    workingTree: true,
    files: [
      { status: 'M', path: 'apps/desktop/src/app/app.component.html', previousPath: null, additions: 16, deletions: 5 },
      { status: 'M', path: 'apps/desktop/src/app/app.component.scss', previousPath: null, additions: 8, deletions: 3 },
      { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 19, deletions: 7 },
      { status: 'A', path: 'docs/interface-notes.md', previousPath: null, additions: 12, deletions: 0 },
    ],
  };
}

export function createPreviewCommitFileDiff(oid: string, file: CommitFile): CommitFileDiff {
  return {
    oid,
    path: file.path,
    patch: createPreviewPatch(file.path),
    truncated: false,
  };
}

export function createPreviewWorkingTreeDiff(path: string, staged: boolean): WorkingTreeFileDiff {
  return {
    path,
    staged,
    patch: createPreviewPatch(path),
    truncated: false,
  };
}

function createPreviewPatch(path: string): string {
  const body = path.endsWith('.html')
    ? [' <section class="history-panel">', '-  <div class="commit-list">', '+  <div class="commit-list" aria-label="Commit history">', ' </section>']
    : path.endsWith('.scss')
      ? [' .commit-row {', '-  min-height: 38px;', '+  min-height: 40px;', '+  content-visibility: auto;', ' }']
      : path.endsWith('.md')
        ? [' # Interface notes', '', '+Keep repository context visible while inspecting file changes.']
        : [' export class AppComponent {', '-  readonly selectedCommit = signal<string | null>(null);', '+  readonly selectedCommits = signal<string[]>([]);', '+  readonly selectedCommit = computed(() => this.selectedCommits().at(-1) ?? null);', ' }'];
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,4 +1,5 @@',
    ...body,
  ].join('\n');
}
