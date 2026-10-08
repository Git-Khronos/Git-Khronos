# Git Chronos roadmap

Git Chronos is built in vertical slices. A milestone is complete only when its
workflows run in the packaged desktop application—not merely in a browser mock.

## Foundation and repository vertical slice — in progress

- [x] Nx, Angular, Tauri, and Rust workspace
- [x] Original design system and application icon
- [x] System Git detection and minimum-version guidance (Git 2.39 baseline; the
  native suite is qualified against Git 2.39, 2.43 and current releases)
- [x] Open and refresh local repositories
- [x] Recent repositories, working-tree summary, branches, and recent commits
- [x] Stage all, unstage all, commit, branch creation/switching
- [x] Fetch, pull, and push through configured Git credentials
- [x] Configurable background fetch and remote-reference refresh
- [x] Explicit one/all-remotes branch fetch with opt-in tracking-branch pruning
  (custom/tag refspec isolation and cancellation are qualified with real Git
  fixtures and renderer journeys; packaged qualification remains pending)
- [x] Per-repository operation serialization and redacted errors
- [x] Real-repository parser and mutation tests
- [x] File and commit diffs
- [x] Filesystem-driven automatic refresh
- [x] Non-blocking, bounded large-repository loading and progressive tab restore
- [x] Clone and initialize workflows (shallow/single-branch; cancelled clones disclose partial destinations;
  recursive submodule clone remains)
- [x] Shallow-history deepening or completion from one selected remote
- [x] Unborn/detached HEAD qualification; explained refusal of bare, `.git`-folder, unsupported-format and foreign-owner repositories
- [ ] Read-only browsing of bare repositories
- [x] Repository-scoped sparse checkout with preferences and toolbar actions
  (modified/unmerged paths and populated submodules left outside a selection,
  and changes Stage all cannot stage there, are named; nothing is deleted)
- [ ] Generated Rust-to-TypeScript IPC bindings

## Linux daily-driver beta — in progress

- [x] File, hunk, and line staging with safe discard recovery
  (new-file line selection and native displayed-diff guards are qualified with
  actual index/worktree fixtures and renderer journeys; packaged acceptance
  remains part of the professional Git roadmap)
- [x] Commit amendment, tags, remotes, and stash workflows
- [x] Visible operation progress and durable activity logs
- [x] Safe cancellation for long-running Git operations
- [ ] In-app askpass bridge that delegates persistence to Git credential helpers
  (implemented with native/renderer and loopback HTTPS smart-Git tests; live SSH
  and packaged acceptance
  remain—see [authentication support](docs/authentication.md))
- [x] Searchable, virtualized commit graph with real topology
- [ ] AppImage and Debian packages with checksums, SBOM, and signed updates
- [ ] English accessibility review and externalized UI strings

## Full power suite

- [x] Complete binary-capable tracked diff export and separately checked patch
  import with explicit working-file/index/both targets
  (literal selected paths, new-file-only exports, exact source/state recheck,
  clean/hidden-index/operation guards, 4 MiB/2000-path bounds and deferred review;
  symlink/submodule/extended-rename inputs require local Git)
- [x] Offline bundle branch export, complete prerequisite/tip review and explicit
  object import into a new recovery reference without moving existing refs/files
- [x] Commit mail-patch export/import with Git am recovery
  (consecutive HEAD series with configuration-isolated format-patch, exact
  review, protected original tip, Continue/Skip/Abort; 16 MiB/500-patch bounds)
- [x] Merge lifecycle with three-way conflict resolution, continue, and abort
- [x] Interactive rebase, cherry-pick, revert, and reset
- [x] Explicit interactive fixup with retained-predecessor validation and
  original-source-tip recovery
  (exact retained messages/combined trees, refusal before side effects,
  recovery-reference failure and conflict/abort; broader autosquash variants
  and packaged acceptance remain)
- [x] Bounded reflog recovery with safe branch preservation
- [x] Complete bounded interactive-rebase preparation with lossless message
  parsing and active-operation/occupied-worktree refusal before setup
  (500-commit and 2 MiB plan limits; no partial replay or silent text replacement)
- [x] Deferred rebase editor with keyboard-contained loading/failure escapes,
  preserved drafts/actions and cancellation-safe late imports
- [x] Reviewed selected-commit/consecutive-range editing on the current local
  branch, with all later descendants through HEAD and the unchanged parent base
  (remote-tracking reachability versus unknown publication, originally empty
  Reword, complete stale-plan/ref/hidden-index guards; explicit destination
  replay and merge preservation use separate reviews)
- [x] Guided splitting at a clean Edit stop with reviewed mixed reset, protected
  original history and bounded worktree-local restart journal
  (explicit parts, no parent amendment/Skip/implicit Continue commit, exact
  combined-tree completion and preserve-files Abort obstruction guidance)
- [x] Explicit whole-history editing including the actual root on the current
  local branch, with complete bounded linear review and protected original tip
  (shallow/merge/all-drop refusal, root Reword/Edit/Continue/Abort and unrelated
  ref isolation; optional captured Replay destination via `--root --onto`)
- [x] Explicit selected-suffix replay onto a captured destination commit
  (original boundary/full descendant review, immutable full-ID disclosure,
  unrelated-ref isolation and conflict/empty/Edit controls; merge-preserving
  replay remains separate)
- [x] Separately reviewed merge-preserving rebase with Git-owned generated
  topology, explicit no-rebase-cousins semantics and immutable tip preflight
  (two-parent merges, native conflict/reload/Continue/Abort, original manual
  resolution disclosure; octopus/root/row editing remain unsupported)
- [x] Explicit interactive Edit stops with amend/continue/abort, truthful pause
  status and support-file retention across multiple stops
  (staged/unstaged Continue refusal, later reword/fixup and hook-retry fixtures;
  broader packaged/platform acceptance remains)
- [x] Explicit autosquash preview with exact subjects/unique commit IDs, stable
  grouping, Reset and atomic ambiguous/unmatched/manual-action refusal
  (partial subject matching and amend! message replacement remain unsupported)
- [x] Non-drag rebase ordering with row move controls, Alt+Up/Down, retained
  focus/drafts/actions, position announcements and explicit invalid-order refusal
- [x] Explicit mainline-parent review for single-merge cherry-pick and revert
  (both parent choices, exact trees/ancestry/messages, preflight refusal,
  original-destination recovery and conflict/abort)
- [x] Ordered multi-commit revert with newest-first review, exact nontraversing
  input order, complete preflight and protected original tip
  (native conflict/Continue/Skip/Abort and retained hook-failure sequencer;
  merge mainline remains individually reviewed, no-commit revert unsupported)
- [x] Explicit no-commit cherry-pick with unchanged HEAD, staged reviewed order,
  worktree-local restart recovery, no-commit Continue, guarded Abort and
  preserve-files manual finish
  (1-500 rows, explicit merge mainline, complete clean-state/hidden-index
  preflight, uncertain-step refusal and empty effects without hidden commits)
- [x] Deferred shared cherry-pick/revert/reset review with typed root-owned state,
  keyboard-safe loading/failure/cancel and repository-switch invalidation
- [x] Guided bisect with good, bad, skip, and reset controls
- [x] Worktrees, submodules, and explicit commit signing through configured Git keys
- [x] Reviewed linked-worktree move preserving dirty files and branch occupancy
  (native fixtures and renderer journeys; packaged acceptance remains)
- [x] Verified registration repair after external linked-worktree directory moves
  (scoped link checks and explicit unsupported cases; packaged acceptance remains)
- [x] Commit signature verification in the inspector
- [x] Effective repository signing configuration diagnostics
- [x] Explicit per-draft sign-off and unchanged-tree commit permission
  (Git-owned committer trailers, preserved hooks/signing and late-completion
  repository guards; broader commit policy and packaged acceptance remain)
- [x] Per-commit author/committer overrides without persistent configuration edits
  (strict scoped identities, amend/sign-off behavior, hook observation and
  per-repository drafts; packaged acceptance remains)
- [x] Real SSH commit signing, trust/revocation and precise hook opt-out acceptance
  (stored-but-unverifiable signatures never appear unsigned; ephemeral fixture
  keys, preserved policy/staged contents and explicit retry; interactive and
  packaged signing acceptance remain)
- [x] Isolated real OpenPGP signing and effective signer diagnostics
  (trusted/unknown/missing-key/tampered results, preserved policy and explicit
  correction/retry; ordered legacy/format aliases and strict bounded settings;
  interactive/hardware keys and packaged acceptance remain)
- [x] Isolated offline X.509 signing through the configured Git signer
  (generated certificate, tampering/distrust/missing-key refusal and retry;
  fixture-only offline CRL scope, no production verification-policy changes;
  online revocation/CA chains, interactive and packaged acceptance remain)
- [x] Real signed-tag acceptance across SSH, OpenPGP and offline X.509
  (SSH trust/revocation/tampering, existing-tag protection and raw signed-object
  recovery; unavailable-key refusal, retained annotation and explicit retry;
  verification follows configured Git policy, not automatic identity trust;
  platform/interactive/packaged and online certificate acceptance remain)
- [x] Explicit pull strategies with local divergence and refusal acceptance
  (menu choices override rebase/fast-forward defaults only for that pull;
  real-Git merge parents, replay, fast-forward, conflicts/abort, dirty-work
  protection and missing/gone upstreams; occupied worktree protections;
  live transport and packaged-platform acceptance remain)
- [x] Bounded configured-template loading with Git-owned comment preparation,
  visible failure/repair feedback and confirmed draft replacement
  (preserves policy and repository boundaries; packaged acceptance remains)
- [x] Advisory non-destructive recovery hints for recognized Git lock,
  disk/quota/permission, corrupt index/object and storage I/O failures
  (original diagnostics retained; no automatic repair or write retry;
  explicit inspection is available below; broader maintenance acceptance remains)
- [x] Explicit cancellable object/connectivity inspection using Git fsck
  (bounded stdout/stderr, incomplete-report distinction, no repair/downloads,
  conservative promisor refusal; broader maintenance and packaged acceptance remain)
- [x] Integrity-guarded non-pruning metadata maintenance
  (explicit commit-graph/pack-refs tasks, reviewed preferences action and shared
  command-palette scope; no GC, pruning, expiry, prefetch or scheduling changes;
  not cancellable, broader maintenance and packaged acceptance remain)
- [x] Confirmed force push with remote-update lease protection
- [x] On-demand signer executable and key-selection diagnostics
- [x] Searchable Git command hints with contextual help and official manual links
  (original explanations and scope/safety guidance; native browser-opening and
  packaged accessibility acceptance remain)
- [x] Read-only worktree registration and explicit-expiry prune dry-run review
  (bounded complete registration parsing)
- [x] Recoverable single-registration removal for missing, unlocked worktrees
  (protected HEAD/per-worktree refs, copied administrative metadata, rechecked
  scope, no global prune; packaged acceptance remains)
- [x] Read-only submodule state review
  (gitlink/declaration/initialization/checkout/staged/dirty/conflict/URL state;
  recursive update and safe deinit remain)
- [x] Reviewed single-submodule URL sync with verified configuration scope
  (previous URLs reported for manual restoration)
- [x] Reviewed recorded-commit checkout for one submodule
  (no fetch, optional nested mode for initialized submodules, each previous
  commit protected by a recovery reference)
- [x] Safe single-submodule deinit (no force, repository data kept, removed
  local settings reported)
- [x] Staged submodule removal from the project (gitlink and declaration only,
  repository data and local settings kept)
- [ ] Expanded Git LFS diagnostics
  (tracking-rule listing, reviewed root untrack and working/index effective
  attributes, bounded local-object diagnostics and reviewed single-file cache
  fetch with local-transfer retry/cancellation, SHA-256-verified single-pointer
  hydration and reviewed file lock/unlock/force-unlock against a local lock
  server are qualified; live HTTPS/SSH LFS transfer and hosted-lock acceptance,
  safe prune and packaged acceptance remain)
- [x] Persistent continue/skip/abort flows for rebase, merge, cherry-pick, and revert
- [ ] Operation previews and temporary recovery references
  (durable discard and reset checkpoints, explicit recovery cleanup and native
  stale-preview checks are qualified; broader destructive operations remain)

## Stable multiplatform release

- Signed Windows installers
- Notarized Intel and Apple Silicon macOS packages
- Linux AppImage, Debian, and RPM packages
- Community translations, security review, performance qualification, and
  packaged acceptance on every supported operating system

Provider-specific GitHub, GitLab, and Forgejo review interfaces are post-v1.
Standard local, HTTPS, and SSH remotes remain part of the core product.
