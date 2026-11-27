# Git Khronos roadmap

Git Khronos is built in vertical slices. A milestone is complete only when its
workflows run in the packaged desktop application—not merely in a browser mock.

## Near-term priorities

1. **Debian release first.** Keep the tested installer stable. Review the
   integration on `dev`, then qualify the tagged production-key archive
   through the [release checklist](docs/production-readiness.md#release-operator-checklist).
   The fixture-key matrix is evidence for the local archive only. Confirm
   the one-time manual upgrade path before promising public automatic updates.
   Move the hosted Jammy jobs to a supported runner before the
   [March 2027 brownouts](https://github.com/actions/runner-images/issues/14254)
   without raising the installer ABI baseline.
2. **Verify desktop launch and authentication on real user setups.** A
   Windows-pinned WSLg shortcut and assistive-technology review cover users
   that Xvfb cannot. The exact local build drew a nonblank window via
   command and desktop-entry launches on WSLg XWayland; the actual
   Windows pin was inspected but not launched. Hosted HTTPS/SSH and credential-helper checks should use
   a dedicated test repository and credentials; do not infer them from the
   local protocol fixtures.
3. **Keep high-risk Git actions recoverable.** Prioritize stale-review and
   restart evidence for destructive actions over adding more write commands.
   Broader AppImage, RPM, and other platform publication should wait until
   their own packaging, runtime, and signing gates are met.

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
  (custom/tag refspec isolation and cancellation have real Git fixtures and
  renderer journeys; owned-local-remote packaged acceptance additionally checks
  ordinary fetch/prune and shallow deepen/complete without dirty-checkout changes;
  real hosted-service and installed-platform qualification remain separate)
- [x] Per-repository operation serialization and redacted errors
- [x] Real-repository parser and mutation tests
- [x] File and commit diffs
- [x] Filesystem-driven automatic refresh
- [x] Non-blocking, bounded large-repository loading and progressive tab restore
- [x] Clone and initialize workflows (shallow/single-branch, optional recursive submodules; cancelled clones
  disclose partial destinations)
- [x] Shallow-history deepening or completion from one selected remote
- [x] Unborn/detached HEAD qualification; explained refusal of bare, `.git`-folder, unsupported-format and foreign-owner repositories
- [x] Read-only browsing of bare repositories (explicit `GIT_DIR`, working-tree actions unavailable)
- [x] Repository-scoped sparse checkout with preferences and toolbar actions
  (modified/unmerged paths and populated submodules left outside a selection,
  and changes Stage all cannot stage there, are named; nothing is deleted)
- [x] Generated Rust-to-TypeScript IPC bindings
  (one Rust registry drives runtime registration and checked-in command,
  payload and event bindings; freshness, serialization, safe-integer and
  compile-time misuse checks guard the boundary)

## Linux daily-driver beta — in progress

- [x] Automated packaged Linux acceptance
  (the production Debian package is extracted and driven through WebKitGTK;
  smoke runs on pull requests, full-toolkit acceptance runs on `dev`, and
  manual performance qualification records package hashes and retained
  evidence—see [Linux packaged acceptance](docs/linux-acceptance.md). The
  accessible native startup shell defers workspace import; the current
  production build's initial asset set is 292 kB versus 1.28 MB before the
  split; the portable test-key package
  `8ca22c68d893436cb25631d9d94c2ace07b02b1a7aff1f5acbe5b9ef5f55a926`
  passed all 52 installed release checks in one exact-archive run.
  The check set includes
  returning to the primary `dev` checkout, CTI-sized discard preserving
  staged work, expanded file-list keyboard navigation, and delayed GitLab catalogue navigation. The same archive
  passed WSLg startup and the offline updater rehearsal; the earlier
  keyboard-focus archive passed clipboard checks on all five baselines.)
- [ ] System-installed Linux desktop acceptance
  (the portable test-key artifact passed the installed matrix in isolated
  Ubuntu 22.04, 24.04, 26.04 and Debian 12, 13 containers, including both X11 launch paths and APT removal. Upgrade from public 0.1.5 and renderer
  recovery passed on all five baselines with the final local archive. The production
  publisher build, actual Windows-pinned WSLg launch, hardware keys, and
  real hosted-service validation remain)

- [x] File, hunk, and line staging with safe discard recovery
  (qualified index/worktree fixtures and packaged UI journeys cover nested
  tracked modifications and deletions on Linux x86-64, prepared single-file
  and bulk confirmation, stale-review refusal and recovery without changing
  staged content. Regular nested untracked files also have recovery-backed
  discard. Nested symbolic links, partial discard and linked worktrees
  remain unsupported.)
- [x] Commit amendment, tags, remotes, and stash workflows
  (ordinary commit and message-only amendments preserve the previous HEAD and
  tracked snapshot in Recovery History; packaged UI verifies restoring the
  amended commit's original staged state on a new branch. Intentional empty
  commits require the explicit policy, retain unstaged work, and still execute
  hooks in packaged UI acceptance)
- [x] Visible operation progress and durable activity logs
- [x] Safe cancellation for long-running Git operations
- [ ] In-app askpass bridge that delegates persistence to Git credential helpers
  (implemented with native/renderer, loopback HTTPS smart-Git and loopback OpenSSH
  fetch/push tests; the helper in a locally built `.deb` passes both transport
  suites; production servers and system-installed package acceptance remain—see
  [authentication support](docs/authentication.md))
- [x] Searchable, virtualized commit graph with real topology
- [ ] AppImage and Debian packages with checksums, SBOM, and signed updates
  (Debian and RPM bundles build locally. They declare a dependency on Git ≥ 2.39,
  recommend OpenSSH and Git LFS, and ship the license and third-party notices.
  The release workflow implements package and source CycloneDX inventories,
  SHA256SUMS, and publication gated on exact-package Linux runtime acceptance.
  Signed Debian update controls, local publisher-key builds, and manifest
  staging are implemented. Installed test-key checks cover manual checks and
  opt-in/opt-out across restart; the public signed feed and an installed
  signed-upgrade journey remain. An uncached Ubuntu 22.04 AppImage build
  task checks the ELF runtime and the embedded SquashFS payload bounds;
  the experimental archive opened a window offline and contains the audited
  library notices. Redistribution review, release checksums/SBOM/signatures
  and full packaged runtime qualification remain)
- [ ] English accessibility review and externalized UI strings
  (an automated structural audit covers names, labels, dialogs, ARIA references,
  focusability and reading order in 17 preview states and open overlays;
  assistive-technology review and string externalization remain)

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
  (packaged read-only previews now check clean fast-forward and clean merge-
  commit outcome equivalence and prove the preview itself does not move refs or
  write source files)
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
  grouping, unique subject-prefix matching, amend! message replacement, Reset and atomic
  ambiguous/unmatched/manual-action refusal
- [x] Prepare a `git commit --fixup` from staged changes against a reviewed
  single commit; bind it to the captured checkout/HEAD, then use the existing
  autosquash review to fold it in. The normal commit draft is preserved and
  fixup mode never pushes.
- [x] Non-drag rebase ordering with row move controls, Alt+Up/Down, retained
  focus/drafts/actions, position announcements and explicit invalid-order refusal
- [x] Explicit mainline-parent review for single-merge cherry-pick and revert
  (both parent choices, exact trees/ancestry/messages, preflight refusal,
  original-destination recovery and conflict/abort)
- [x] Ordered multi-commit revert with newest-first review, exact nontraversing
  input order, complete preflight and protected original tip
  (native conflict/Continue/Skip/Abort and retained hook-failure sequencer;
  merge mainline remains individually reviewed; optional no-commit mode keeps
  HEAD fixed, stages the reviewed inverse changes and supports restart-safe
  Continue/Abort/Finish-manually conflict recovery)
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
  (native fixtures, renderer journeys and owned packaged-UI acceptance preserve
  both dirty checkouts, linked index bytes, untracked and ignored files)
- [x] Verified registration repair after external linked-worktree directory moves
  (scoped link checks and explicit unsupported cases; owned packaged-UI acceptance
  verifies actual registration repair without changing either dirty checkout;
  physical directory-picker and cross-platform qualification remain separate)
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
  the packaged commit-form signing control is covered with an isolated key;
  interactive/hardware keys and packaged diagnostics remain)
- [x] Isolated offline X.509 signing through the configured Git signer
  (generated certificate, tampering/distrust/missing-key refusal and retry;
  fixture-only offline CRL scope, no production verification-policy changes;
  online revocation/CA chains, interactive and packaged acceptance remain)
- [x] Real signed-tag acceptance across SSH, OpenPGP and offline X.509
  (SSH trust/revocation/tampering, existing-tag protection and raw signed-object
  recovery; unavailable-key refusal, retained annotation and explicit retry;
  verification follows configured Git policy, not automatic identity trust;
  Linux package acceptance covers lightweight and OpenPGP-signed UI creation,
  SSH- and X.509-signed native creation, tag navigation and branching from the
  exact tag; other platforms and online certificate acceptance remain)
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
  conservative promisor refusal; packaged acceptance covers held-fsck cancellation,
  corruption reporting and mutation-free maintenance refusal; broader
  filesystem/error and platform cases remain)
- [x] Integrity-guarded non-pruning metadata maintenance
  (explicit commit-graph/pack-refs tasks, reviewed preferences action and shared
  command-palette scope; no GC, pruning, expiry, prefetch or scheduling changes;
  not cancellable; exact-package UI coverage now verifies both corruption refusal
  and successful maintenance preserving checkout, refs, index, config and an
  unreachable object; broader platform cases remain)
- [x] Confirmed force push with remote-update lease protection
- [x] On-demand signer executable and key-selection diagnostics
- [x] Searchable Git command hints with contextual help and official manual links
  (original explanations and scope/safety guidance; packaged keyboard coverage
  verifies the exact HTTPS URL passed to the Linux launcher without touching
  the checkout. Actual browser startup and assistive-technology review remain)
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
  attributes, bounded checkout counts and local-object diagnostics, and
  reviewed single-file cache fetch with local-transfer retry/cancellation,
  SHA-256-verified single-pointer
  hydration and reviewed file lock/unlock/force-unlock against a local lock
  server and reviewed removal of unreferenced cached objects are qualified.
  Current local acceptance passes 34 LFS core tests, seven authenticated
  transport tests and a packaged UI lock/unlock/dirty-refusal/force-review
  journey against a local protocol fixture. Live hosted HTTPS/SSH LFS transfer,
  hosted-lock behavior, wider client/provider and platform qualification remain)
- [x] Persistent continue/skip/abort flows for rebase, merge, cherry-pick, and revert
- [ ] Operation previews and temporary recovery references
  (durable discard, reset, branch-deletion, stash-deletion and stash-clear
  checkpoints, explicit recovery cleanup, native stale-review checks, and
  pre-operation recovery for ordinary HEAD/message amendments are qualified.
  Failed amendments retire the temporary checkpoint only when Git's failed
  command is proven to have left the captured repository state unchanged;
  uncertain or partial outcomes retain it. Remaining destructive operations
  and cross-platform release acceptance remain)

## Stable multiplatform release

- Signed Windows installers
- Notarized Intel and Apple Silicon macOS packages
- Linux AppImage, Debian, and RPM packages
- Community translations, security review, performance qualification, and
  packaged acceptance on every supported operating system

Provider-specific GitHub, GitLab, and Forgejo review interfaces are post-v1.
Standard local, HTTPS, and SSH remotes remain part of the core product.
