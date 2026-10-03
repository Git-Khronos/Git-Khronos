export interface SystemInfo {
  appVersion: string;
  gitVersion: string | null;
  gitSupported: boolean;
  minimumGitVersion: string;
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
  rebaseInProgress: boolean;
  bisectInProgress: boolean;
  entryCount: number;
  entriesTruncated: boolean;
  entries: WorkingTreeEntry[];
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
}

export interface InteractiveRebaseStep {
  oid: string;
  action: 'pick' | 'reword' | 'squash' | 'drop';
  message: string | null;
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

export interface FileBlameLine {
  lineNumber: number;
  oid: string;
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  summary: string;
  text: string;
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

export interface ConflictDetails {
  path: string;
  ancestor: string | null;
  current: string | null;
  incoming: string | null;
  output: string | null;
  binary: boolean;
  truncated: boolean;
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
  commits: CommitSummary[];
  historyTruncated: boolean;
}

export interface LfsInfo {
  enabled: boolean;
  available: boolean;
  version: string | null;
  trackedFiles: number | null;
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
