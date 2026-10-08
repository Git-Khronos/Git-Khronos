export interface SystemInfo {
  appVersion: string;
  gitVersion: string | null;
  gitSupported: boolean;
  minimumGitVersion: string;
}

export interface CommitPolicy {
  signOff: boolean;
  allowEmpty: boolean;
  author?: CommitIdentity | null;
  committer?: CommitIdentity | null;
}

export interface CommitIdentity {
  name: string;
  email: string;
}

export interface WorkingTreeEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  conflicted: boolean;
}

export interface RepositoryStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  mergeInProgress: boolean;
  historyOperation: 'cherry-pick' | 'revert' | null;
  historyNoCommit: boolean;
  rebaseInProgress: boolean;
  rebaseEditStopped: boolean;
  rebaseSplit?: { preparing: boolean; partCount: number; treeMatches: boolean } | null;
  mailPatchInProgress?: boolean;
  bisectInProgress: boolean;
  entryCount: number;
  entriesTruncated: boolean;
  entries: WorkingTreeEntry[];
}

export interface DiscardPreview {
  token: string;
  paths: string[];
  skippedPaths: string[];
  untracked: number;
}

export interface DiscardRecovery {
  id: string;
  restored: boolean;
}

export type ResetMode = 'soft' | 'mixed' | 'hard';

export interface ResetPreview {
  token: string;
  headOid: string;
  targetOid: string;
  mode: ResetMode;
  paths: string[];
}

export interface OperationRecovery {
  id: string;
  label: string;
  headOid: string;
  snapshotOid: string | null;
  headReference: string;
  snapshotReference: string | null;
  restored: boolean;
}

export interface InteractiveRebaseCommit {
  oid: string;
  authorName: string;
  authorEmail: string;
  subject: string;
  message: string;
}

export interface InteractiveRebasePlan {
  source: string;
  target: string;
  base: string;
  commits: InteractiveRebaseCommit[];
  remoteReachableOids?: string[];
}

export interface InteractiveRebaseStep {
  oid: string;
  action: 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';
  message: string | null;
}

export interface MergeRebaseRequest {
  source: string;
  target: string;
  sourceOid: string;
  targetOid: string;
  base: string;
}

export interface MergeRebasePlan {
  request: MergeRebaseRequest;
  commits: (InteractiveRebaseCommit & { parents: string[] })[];
  remoteReachableOids: string[];
}

export type PatchTarget = 'worktree' | 'index' | 'both';

export interface PatchRequest {
  file: string;
  target: PatchTarget;
  patch: number[];
  headOid: string;
  headRef: string;
  indexState: number[];
}

export interface PatchReview {
  request: PatchRequest;
  files: { path: string; added: number | null; deleted: number | null }[];
  summary: string;
}

export interface BundleTip {
  reference: string;
  oid: string;
}

export interface BundleRequest {
  file: string;
  fingerprint: string;
  bytes: number;
  tips: BundleTip[];
}

export interface BundleReview {
  request: BundleRequest;
  verification: string;
}

export interface MailPatchRequest {
  oids: string[];
  bytes: number;
  fingerprint: string;
}

export interface MailPatchReview {
  request: MailPatchRequest;
  commits: { oid: string; authorName: string; authorEmail: string; subject: string; root: boolean; empty: boolean }[];
}

export interface MailPatchImportRequest {
  file: string;
  bytes: number;
  fingerprint: string;
  headOid: string;
  branch: string;
  count: number;
}

export interface MailPatchImportReview {
  request: MailPatchImportRequest;
  patches: { authorName: string; authorEmail: string; subject: string; empty: boolean }[];
}

export type MailPatchAction = 'continue' | 'skip' | 'abort';

export interface MailPatchProgress {
  stopped: boolean;
  current: number | null;
  total: number | null;
  message: string;
  recoveryRef: string | null;
}

export interface Branch {
  fullName: string;
  name: string;
  oid: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  tracking: string | null;
}

export interface StashEntry {
  reference: string;
  oid: string;
  message: string;
}

export interface StashOptions {
  mode: 'all' | 'keep-index' | 'staged-only';
  includeUntracked: boolean;
  paths: string[] | null;
  message: string;
}

export interface Tag {
  fullName: string;
  name: string;
  oid: string;
}

export interface TagDetails {
  name: string;
  oid: string;
  annotated: boolean;
  message: string | null;
  taggerName: string | null;
  taggerEmail: string | null;
  taggedAt: string | null;
}

export interface Worktree {
  path: string;
  oid: string;
  branch: string | null;
  current: boolean;
  locked: boolean;
  prunable: boolean;
  statusLoaded: boolean;
  changes: number;
  ahead: number;
  behind: number;
}

export interface WorktreeMove {
  path: string;
  parentPath: string;
  folder: string;
  expectedOid: string;
  expectedBranch: string | null;
}

export interface WorktreeRepair {
  path: string;
  actualPath: string;
  expectedOid: string;
  expectedBranch: string | null;
}

export interface WorktreeRegistration {
  path: string;
  oid: string | null;
  branch: string | null;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  pruneReason: string | null;
}

export interface WorktreeRegistrationReview {
  registrations: WorktreeRegistration[];
  pruneReport: string;
}

export interface Submodule {
  name: string;
  path: string;
  absolutePath: string;
  url: string;
  oid: string | null;
  headOid: string | null;
  initialized: boolean;
  outOfSync: boolean;
}

export interface CommitSummary {
  oid: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  description: string;
  decorations: string[];
}

export interface CommitHistoryPage {
  commits: CommitSummary[];
  historyTruncated: boolean;
}

export interface CommitFile {
  status: string;
  path: string;
  previousPath: string | null;
  additions: number | null;
  deletions: number | null;
}

export interface CommitDetails {
  oid: string;
  message: string;
  signature: CommitSignature;
  files: CommitFile[];
  filesTruncated: boolean;
}

export type CommitSignatureStatus =
  | 'valid'
  | 'valid-unknown'
  | 'invalid'
  | 'expired-signature'
  | 'expired-key'
  | 'revoked-key'
  | 'unverifiable'
  | 'unsigned';

export interface CommitSignature {
  status: CommitSignatureStatus;
  signer: string | null;
  key: string | null;
  fingerprint: string | null;
  trust: string | null;
}

export interface CommitComparison {
  baseOid: string;
  targetOid: string;
  workingTree: boolean;
  files: CommitFile[];
  comparisonMode?: 'direct' | 'mergeBase';
}

export interface CommitFileDiff {
  oid: string;
  path: string;
  patch: string;
  truncated: boolean;
}

export interface WorkingTreeFileDiff {
  path: string;
  staged: boolean;
  patch: string;
  truncated: boolean;
}

export interface FileHistoryEntry {
  oid: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
}

export interface HistoryQuery {
  message: string;
  author: string;
  oid: string;
  since: string;
  until: string;
  path: string;
  scope: string;
}

export interface HistoryCursor {
  query: HistoryQuery;
  revisions: string[];
  offset: number;
}

export interface HistorySearchPage {
  entries: FileHistoryEntry[];
  cursor: HistoryCursor | null;
  complete: boolean;
  scanned: number;
}

export interface HistoricalFileEntry extends FileHistoryEntry {
  path: string;
  previousPath: string | null;
}

export interface FileHistoryCursor {
  revision: string;
  requestedRevision?: string;
  path: string;
  historicalPath: string;
  offset: number;
}

export interface FileHistoryPage {
  entries: HistoricalFileEntry[];
  cursor: FileHistoryCursor | null;
  complete: boolean;
}

export interface BlameNavigation {
  oid: string;
  path: string;
  parents: string[];
  parentPath: string | null;
}

export interface FileBlameLine {
  lineNumber: number;
  oid: string;
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  summary: string;
  text: string;
  path?: string | null;
}

export interface TrackedFileSearch {
  paths: string[];
  truncated: boolean;
}

export interface ReflogEntry {
  oid: string;
  selector: string;
  subject: string;
  authorName: string;
  authorEmail: string;
}

export interface ReflogPage {
  entries: ReflogEntry[];
  truncated: boolean;
}

export interface FetchOptions {
  remote: string | null;
  prune: boolean;
}

export interface ConflictDetails {
  path: string;
  ancestor: string | null;
  current: string | null;
  incoming: string | null;
  output: string | null;
  binary: boolean;
  truncated: boolean;
  state: string;
  editable: boolean;
  currentExists: boolean;
  incomingExists: boolean;
  submodule: boolean;
}

export interface RepositorySnapshot {
  id: string;
  name: string;
  path: string;
  identity: GitIdentity;
  signing: SigningInfo;
  headOid: string | null;
  status: RepositoryStatus;
  remotes: Remote[];
  branches: Branch[];
  stashes: StashEntry[];
  tags: Tag[];
  worktrees: Worktree[];
  submodules: Submodule[];
  lfs: LfsInfo;
  sparseCheckout: SparseCheckoutInfo;
  commitTemplate: string | null;
  commitTemplateError?: AppError | null;
  commits: CommitSummary[];
  historyTruncated: boolean;
}

export interface LfsInfo {
  enabled: boolean;
  available: boolean;
  version: string | null;
  trackedFiles: number | null;
}

export interface LfsTrackingPattern {
  pattern: string;
  source: string;
  lockable: boolean;
  tracked: boolean;
}

export interface LfsTrackingRules {
  patterns: LfsTrackingPattern[];
  state: string;
  rootAttributes: string | null;
}

export interface LfsFileAttributes {
  path: string;
  attributes: { name: string; working: string; index: string }[];
}

export interface LfsObjects {
  files: {
    name: string;
    size: number;
    checkout: boolean;
    downloaded: boolean;
    oidType: string;
    oid: string;
    version: string;
    workingState: 'missing' | 'symlink' | 'nonFile' | 'pointer' | 'pointerLike' | 'contentSizeMatches' | 'sizeMismatch';
  }[];
}

export interface LfsFetchPreview {
  file: string;
  remote: string;
  head: string;
  oid: string;
  size: number;
  settings: string;
}

export interface LfsCheckoutPreview {
  file: string;
  oid: string;
  size: number;
  state: string;
}

export interface SparseCheckoutInfo {
  enabled: boolean;
  coneMode: boolean;
  sparseIndex: boolean;
  paths: string[];
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export interface SigningInfo {
  enabled: boolean;
  format: string;
  key: string | null;
}

export interface SigningDiagnostic {
  available: boolean;
  program: string;
  format: string;
  keyConfigured: boolean;
  message: string;
}

export interface AppError {
  kind: string;
  message: string;
  hint: string | null;
}

export interface IntegrityReport {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}
