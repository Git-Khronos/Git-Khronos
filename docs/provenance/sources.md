# Informational sources

## Mail-patch exchange

Sources:

- https://git-scm.com/docs/git-format-patch
- https://git-scm.com/docs/git-am
- https://git-scm.com/docs/git-mailsplit
- https://git-scm.com/docs/git-mailinfo

Used for independently implemented configuration-isolated series export,
per-patch review, git am application options and Continue/Skip/Abort control.
Owned real-Git fixtures define safety and refusal behavior. No external source
code, assets or documentation prose copied.

## Offline Git bundle exchange

Sources:

- https://git-scm.com/docs/git-bundle
- https://git-scm.com/docs/git-fetch
- https://git-scm.com/docs/git-update-ref

Used for independently implemented complete branch export, prerequisite/header
review, advertised tips, object-only fetch scope and atomic recovery-ref creation.
Verification is not source authentication; pack objects are checked during fetch.
Owned real-Git fixtures define safety and refusal behavior. No external source
code, assets or documentation prose copied.

## Complete diff patch exchange

Sources:

- [Git apply manual: check, index/cached targets, path checks and default all-hunk behavior](https://git-scm.com/docs/git-apply)
- [Git diff manual: binary/full-index output and literal paths](https://git-scm.com/docs/git-diff)

Used to define public diff export, checked import and separate index/worktree
effects. Original owned Git fixtures verify bytes, modes, path/state refusal,
configuration isolation and linked-worktree scope. UI, bounds and review
invalidation are independently designed. No external code or manual prose
copied.

## Merge-preserving rebase

Sources:

- [Git rebase manual: rebase-merges, no-rebase-cousins and rebasing merges](https://git-scm.com/docs/git-rebase)

Used for public merge-recreation behavior, Git-owned structural instructions,
cousin ancestry and the need to reapply manual merge resolutions. Original
owned repositories verify topology, conflicts and protected refs. Review,
bounded metadata and preflight design are independent. No external source
implementation or documentation prose copied.

## Explicit replay destination

Sources:

- [Git rebase manual: onto, empty commits and operation controls](https://git-scm.com/docs/git-rebase)

Used for the distinction between the replay boundary and destination parent,
public interactive onto invocation and native interrupted replay behavior.
Original owned Git fixtures verify result trees/parents, captured destination
and preserved refs. UI scope and recovery guards are independently designed.
No external source code or manual prose copied.

## Whole-history root editing

Sources:

- [Git rebase manual: root and empty commits](https://git-scm.com/docs/git-rebase)

Used for inclusive actual-root replay, combined `--root --onto` parent
semantics, unchanged-tree commit semantics and native Edit/Continue/Abort. Complete linear-history limits, unrelated-ref
isolation, explicit review and recovery guards are independently designed.
Behavior is checked against owned real-Git repositories; no external source
code or documentation prose copied.

## Guided commit splitting

Sources:

- [Git rebase manual: splitting commits](https://git-scm.com/docs/git-rebase)
- [Git reset manual](https://git-scm.com/docs/git-reset)
- [Git repository layout](https://git-scm.com/docs/gitrepository-layout)

Used for clean Edit stops, documented mixed reset, detached commit creation and
native Continue/Abort. Original owned Git probes established that split-created
untracked files can block Abort; the interface exposes preservation/staging/move
guidance instead of forcing a reset. Independent application metadata guards
uncertain resets and complete-tree recovery without fabricating Git's state.
No external implementation or documentation prose copied.
## Selected-range history editing

Sources:

- [Git rebase manual](https://git-scm.com/docs/git-rebase)
- [Git rev-list manual](https://git-scm.com/docs/git-rev-list)

Used for inclusive starting-commit review, unchanged-parent base, all later
descendants, intentional empty commits and remote-tracking ancestry exclusion.
Original owned Git fixtures verify exact trees/messages/parents, protected old
history and no unrelated ref updates under configured automatic ref rewriting.
Remote reachability is explicitly a local recorded observation, not a remote
publication check. No external source code or documentation prose copied.
## Explicit commit policy options

Sources:

- [Git commit manual](https://git-scm.com/docs/git-commit)
- [Git hooks manual](https://git-scm.com/docs/githooks)

Used for committer sign-off trailers, unchanged-tree permission, staged-content
scope, explicit author overrides, command-scoped committer identity, amend
semantics and hook execution. The interface and disposable actual-
Git fixtures were independently written. No source code or manual prose copied.

## In-app Git learning reference and registration review

Sources:

- [Official Git manual index](https://git-scm.com/docs)
- [Git worktree manual](https://git-scm.com/docs/git-worktree)
- [Official Git LFS command manuals](https://github.com/git-lfs/git-lfs/tree/main/docs/man)

The learning catalog links command-specific manuals and provides independently
written workflow explanations, precautions and application-scope distinctions.
No documentation text, implementation or graphical assets were copied.
Registration review uses documented NUL-delimited porcelain output, lock/prune
reasons, dry-run mode and explicit `--expire=now`. Original real-Git fixtures
exercise missing and locked registrations, dirty/detached worktrees, literal
paths, unborn repositories and respect for the configured bare-repository policy.
Single-registration removal uses the manual's `worktree remove` semantics, not
global prune. Original fixtures prove that only the selected registration is
removed, with HEAD and metadata preserved, and cover refusal of main, existing,
locked, stale, unknown and relative inputs.

## Submodule state review

Sources: [git-submodule](https://git-scm.com/docs/git-submodule),
[gitmodules](https://git-scm.com/docs/gitmodules),
[git-status porcelain v2](https://git-scm.com/docs/git-status),
[git-ls-files](https://git-scm.com/docs/git-ls-files),
[git-config](https://git-scm.com/docs/git-config).

Used for gitlink modes, conflict stages, submodule status flags, declared and
registered URLs, `set-branch` remote-HEAD/same-name/specific-branch semantics,
the `sync` subcommand's scope, `update --no-fetch --checkout`, non-forced `deinit` and gitlink removal with
[git-rm](https://git-scm.com/docs/git-rm). Original fixtures; no
third-party implementation copied.

## Clone history limits and interruption

Sources: [git-clone](https://git-scm.com/docs/git-clone),
[git-rev-parse](https://git-scm.com/docs/git-rev-parse).

Used for `--depth`, `--branch`/`--single-branch`, `--recurse-submodules`
(with `submodule.active`), local-path versus `file://` transport behavior and
`--is-shallow-repository`; [git-daemon](https://git-scm.com/docs/git-daemon)
and `protocol.allow` in [git-config](https://git-scm.com/docs/git-config) for
the submodule fixture. The partial destination left
by a stopped process was observed with real Git; original fixtures, no
third-party implementation copied.

## Shallow-history deepening

Sources: [git-fetch](https://git-scm.com/docs/git-fetch) (`--deepen`,
`--unshallow`), [git-rev-parse](https://git-scm.com/docs/git-rev-parse) and
[gitrepository-layout](https://git-scm.com/docs/gitrepository-layout) (the
`shallow` file). Behavior confirmed with original real-Git fixtures; no
third-party implementation copied.

## Repository states on open

Sources: [git-rev-parse](https://git-scm.com/docs/git-rev-parse),
[git-config `safe.bareRepository` and `safe.directory`](https://git-scm.com/docs/git-config),
[gitrepository-layout](https://git-scm.com/docs/gitrepository-layout) and
[repository format extensions](https://git-scm.com/docs/gitrepository-layout#_git_repository_format_versions).
Used for bare/unborn/detached semantics, the refusal messages classified on
open and explicit `GIT_DIR` access to bare repositories
([git environment variables](https://git-scm.com/docs/git#_the_git_repository));
original fixtures and wording.

## Linked-worktree move

Source: [Git worktree manual](https://git-scm.com/docs/git-worktree).

Used for linked versus main worktrees, move restrictions, lock protection and
Git-owned registration updates and external-move repair. Real-Git fixtures also
established that targeted repair may rewrite other broken links, requiring a
preflight refusal to preserve this interface's focused scope.
The interface and behavioral fixtures were
independently implemented. No external implementation or assets copied.

## Explicit branch fetch and prune scope

Sources:

- [Git fetch manual](https://git-scm.com/docs/git-fetch)
- [Git repository layout](https://git-scm.com/docs/gitrepository-layout)

Used for explicit branch refspec destinations, empty `--refmap` isolation,
disabled tag following/tag pruning, per-remote transactions and cancellation
scope. The interface and local bare-remote behavioral fixtures are original.
No source code, assets or proprietary text copied.

## Explicit pull strategy and local refusal semantics

Sources:

- [Git pull manual](https://git-scm.com/docs/git-pull)
- [Git 2.34 pull manual](https://git-scm.com/docs/git-pull/2.34.0)
- Installed Git's public `git pull -h` command reference
- [Git branch manual](https://git-scm.com/docs/git-branch)

Used for explicit `--no-rebase`, `--rebase`, `--ff` and `--ff-only`, per-command
overrides, upstreams, occupied branches and partial fetch/integration effects.
Independent disposable local bare-remote observations establish merge-parent,
replayed-commit, conflict-abort and stale/gone-upstream contracts. Real rebase
progress may delimit an error with a carriage return, not only a newline.
UI hints and sanitized error guidance were written independently; no manual
prose or third-party implementation copied. Minimum-version execution remains
unqualified despite using its documented options.

## Interactive fixup and retained-predecessor safety

Sources:

- [Git rebase manual](https://git-scm.com/docs/git-rebase)
- [Git update-ref manual](https://git-scm.com/docs/git-update-ref)

Used for explicit fixup versus squash message behavior, preceding retained
commits, linear replay and interruption/abort. Original disposable fixtures
verify message/tree contracts, preflight refusal before side effects and a
protected original source tip. UI and validation are independently designed;
no upstream source, manual prose or proprietary interface copied.

## Complete, bounded interactive rebase metadata

Sources:

- [Git log manual](https://git-scm.com/docs/git-log)
- [Git pretty formats](https://git-scm.com/docs/pretty-formats)
- [Git worktree manual](https://git-scm.com/docs/git-worktree)

Used for bounded history traversal, structured metadata fields, message
encoding and linked-worktree occupancy. Complete-plan refusal and metadata
validation are independent application policy. Original disposable fixtures
verify actual Git output and refusal without mutation; no source or manual
prose copied.

## Intentional interactive rebase editing

Source:

- [Git rebase manual](https://git-scm.com/docs/git-rebase)

Used for the `edit` todo action, amendment, continuation and abort.
Independent fixtures qualify successful intentional stops, subsequent
reword/fixup, multiple stops, hook refusal and restoration. An observed
automatic commit of staged changes on Continue motivates the application's
explicit-amend policy; no implementation or manual prose copied.

## Reviewed autosquash preview

Source:

- [Git rebase manual](https://git-scm.com/docs/git-rebase)

Used for fixup!/squash! subject markers and combining actions. Matching and
preview policies are independently designed, with stricter unique-target and
all-Pick requirements than Git's broader matcher. Original pure, renderer and
real-Git fixtures qualify stable grouping and resulting trees/messages. No
upstream implementation or documentation prose copied.

## Conflict resolution safeguards

Sources:

- [Git checkout](https://git-scm.com/docs/git-checkout)
- [Git index inspection](https://git-scm.com/docs/git-ls-files)
- [Git object reading](https://git-scm.com/docs/git-cat-file)
- [Git object hashing](https://git-scm.com/docs/git-hash-object)

Used for explicit ours/theirs stage meanings during merge and rebase, missing
stage/deletion semantics, bounded object previews and working-content leases.
The state checks, temporary-file save, interface and actual-Git fixtures were
independently implemented. No source code, assets or proprietary wording copied.

## Selected index edits and new files

Sources:

- [Git apply](https://git-scm.com/docs/git-apply)
- [Git diff](https://git-scm.com/docs/git-diff)
- [Git configuration](https://git-scm.com/docs/git-config)
- [Git attributes](https://git-scm.com/docs/gitattributes)
- [Git environment and literal pathspecs](https://git-scm.com/docs/git)

Used for index-only patch application, recalculated hunk counts, partial
new-file unstage headers, effective file-mode policy, literal selected paths
and native expected-preview checks. Real Git fixtures qualify index contents,
unchanged working bytes, CRLF attributes and unborn repositories.
Implementation and tests are original; no external code or assets copied.

## Durable reset recovery

Sources:

- [Git reset](https://git-scm.com/docs/git-reset)
- [Git stash](https://git-scm.com/docs/git-stash)
- [Git update-ref](https://git-scm.com/docs/git-update-ref)
- [Git log](https://git-scm.com/docs/git-log)

Used for soft/mixed/hard reset scope, non-destructive `stash create` snapshots,
index-restoring apply, owned expected-object reference transactions, and excluding
internal snapshot refs from ordinary graph tips/decorations. Requirements and
tests were independently written; no external source code or proprietary UI was copied.
The same manuals and [Git branch](https://git-scm.com/docs/git-branch) define
the branch-deletion and stash-drop checkpoints (deleted-branch reflog removal,
stash entry structure and index shifting).

## Selective stash and reference lifecycle

Sources:

- [Git stash](https://git-scm.com/docs/git-stash)
- [Git tag](https://git-scm.com/docs/git-tag)
- [Git push](https://git-scm.com/docs/git-push)
- [Git update-ref](https://git-scm.com/docs/git-update-ref)
- [Git remote](https://git-scm.com/docs/git-remote)

Used for selective-path stash behavior, staged-state restoration, stash bases,
signed tag handling, exact-object reference leases and separate push URLs.
The implementation and behavioral fixtures are original; no source code copied.

## Whole-repository history investigation

Sources:

- [Git log](https://git-scm.com/docs/git-log)
- [Git revision selection](https://git-scm.com/docs/gitrevisions)
- [Git blame porcelain](https://git-scm.com/docs/git-blame)
- [Git merge-base](https://git-scm.com/docs/git-merge-base)
- [Git diff-tree](https://git-scm.com/docs/git-diff-tree)

Used for argument-array queries, pinned commit/ref ranges, NUL-delimited
metadata and rename paths, historical blame filenames, parent lookup, and
explicit direct-tree versus unique-merge-base comparisons. Implementation and
tests were written independently; no third-party code or assets were copied.

## Standard Git authentication

Sources:

- [Git credential documentation](https://git-scm.com/docs/gitcredentials)
- [Git environment documentation](https://git-scm.com/docs/git)
- [OpenSSH client manual](https://man.openbsd.org/ssh.1)
- [OpenSSH configuration manual](https://man.openbsd.org/ssh_config.5)
- [OpenSSH server configuration manual](https://man.openbsd.org/sshd_config.5)

The server manual informed only the disposable loopback `sshd` test fixture.

Used for Git askpass/helper ownership, SSH askpass behavior and strict host-key
verification. The operation bridge, protocol and interface are independent
implementations; no upstream source code or assets were copied.

## Desktop interface behavior

Sources:

- [Git log documentation](https://git-scm.com/docs/git-log)
- [Git status documentation](https://git-scm.com/docs/git-status)
- [Git branch documentation](https://git-scm.com/docs/git-branch)
- [Git tag documentation](https://git-scm.com/docs/git-tag)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WAI-ARIA Authoring Practices window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
- [WAI-ARIA Authoring Practices tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)

Used for:

- High-level toolbar, panel, graph, and status-bar behavior.
- The default Branch/Tag, Graph, and Commit Message column set plus optional metadata columns.
- App-wide UI customization for commit-graph date and time presentation.
- Visible remote-fetch recency in the repository chrome.
- Command-palette discovery for repositories, branches, tags, stashes, working-directory state, changed-file diffs, history, and blame.
- Keyboard access to commit, stash, reference, and repository-tab action menus through standard context-menu keys and directional navigation.
- Focusable repository-panel, stacked reference-section, terminal-panel, and commit-graph column splitters with exposed bounds, current values, and directional keyboard resizing.
- Roving focus, wrapped directional navigation, and explicit tab-to-panel relationships for repository terminals.
- Project-defined interface zoom presets: 100%, 110%, 125%, 140%, 150%, 175%, and 200%.
- Project-defined shortcut behavior for fullscreen mode, opening the current repository folder, and opening repositories.
- Platform-specific Command/Option and Ctrl/Alt shortcut terminology.
- The product-neutral workflow for comparing a selected commit with current working-directory changes.
- The project-defined branch-menu workflow for assigning an upstream remote branch.
- Revealing the nearest containing branch when inspecting an otherwise unlabeled commit.
- One-step undo and redo for successful local and remote-tracking branch checkouts.
- The project-defined option to reduce the commit graph column's horizontal footprint.
- Local initials or stable per-author color markers, plus icon headers for narrow graph columns.
- Scroll markers for checked-out tips, selections, working changes, and search results.
- Separate execution and default-selection controls for Git pull strategies.
- Persistent repository-tab reordering through drag-and-drop.
- Repository-tab utilities for terminal and folder access, favorites, display names, and scoped batch closing.
- Hover previews for annotated tags without eagerly loading annotation content.
- Global appearance selection that persists independently of repository state.
- Project-defined diff/editor preferences for text size, tab width, and long-line wrapping.

No source code, assets, or product-specific visual implementation were copied.

## Tracked-file discovery

Source:

- [Git `ls-files` documentation](https://git-scm.com/docs/git-ls-files)

Used for:

- Repository-wide tracked-file search with NUL-delimited path handling.
- Capped, case-insensitive pathspec queries that feed file-history and blame actions.

No source code was copied.

## Git remote management

Source:

- [Git remote documentation](https://git-scm.com/docs/git-remote)

Used for:

- Adding named remotes with fetch URLs.
- Reading effective fetch and push URLs.
- Updating a remote URL and removing a remote configuration.
- Warning that removing a remote also removes its remote-tracking branches.

No source code was copied.

## Git LFS repository actions

Sources:

- [Git LFS command documentation](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs.adoc)
- [Git LFS install documentation](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-install.adoc)
- [Git LFS track documentation](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-track.adoc)
- [Git LFS untrack documentation](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-untrack.adoc)
- [Git LFS ls-files manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-ls-files.adoc)
- [Git LFS fetch manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-fetch.adoc)
- [Git LFS configuration manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-config.adoc)
- [Git LFS checkout manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-checkout.adoc)
- [Git LFS environment manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-env.adoc)
- [Git LFS pointer manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-pointer.adoc)
- [Git LFS pointer specification](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/spec.md)
- [Git LFS ls-files command](https://github.com/git-lfs/git-lfs/blob/v3.7.1/commands/command_ls_files.go)
- [Git LFS 3.7.1 track command](https://github.com/git-lfs/git-lfs/blob/v3.7.1/commands/command_track.go)
- [Git LFS 3.7.1 untrack command](https://github.com/git-lfs/git-lfs/blob/v3.7.1/commands/command_untrack.go)
- [Git hooks path configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath)
- [Git check-attr documentation](https://git-scm.com/docs/git-check-attr)
- [Git 2.34 check-attr manual](https://github.com/git/git/blob/v2.34.0/Documentation/git-check-attr.txt)
- [Git LFS prune documentation](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-prune.adoc)
- [Git cat-file documentation](https://git-scm.com/docs/git-cat-file)
- [Git rev-parse documentation](https://git-scm.com/docs/git-rev-parse)
- [Git partial clone documentation](https://git-scm.com/docs/partial-clone)
- [Git LFS lock manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-lock.adoc)
- [Git LFS locks manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-locks.adoc)
- [Git LFS unlock manual](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/man/git-lfs-unlock.adoc)
- [Git LFS file locking API](https://github.com/git-lfs/git-lfs/blob/v3.7.1/docs/api/locking.md)

Used for:

- Showing repository-scoped LFS actions only when LFS tracking is configured.
- Initializing repository-local Git LFS filters and hooks.
- Adding ordinary or lockable tracking patterns through `.gitattributes`.
- Pulling objects required by the current checkout through the documented Git LFS CLI.
- Reviewed single-file cache fetch at pinned committed HEAD, configured remote
  selection, include/exclude override semantics, disabled recent/history
  expansion and remote autodetection/search-all fallback, and explicitly separate
  non-hydrating transfer/retry/cancellation.
- Reviewed removal of unreferenced cached objects: pointer format and size limit,
  documented local media storage layout, object-database enumeration including
  unreachable objects and alternates, and shallow/partial-clone detection.
  Implementation and local bare-remote fixtures are original.
- Independent local single-pointer hydration, narrower than CLI checkout:
  existing matching index/working pointer only, configured cache from the
  supported environment output, SHA-256/size verification of an exclusive
  temporary copy, unchanged index/ref leases, permission preservation and
  cancellation before replacement. No upstream implementation copied.
- Listing, locking, unlocking and explicitly reviewed force-unlocking LFS file
  locks, with ownership, tracked-path and changed-lock checks. The lock-server
  test fixture is original.
- Requiring explicit confirmation before pruning local LFS objects, explaining
  retention/fetch-exclude scope, shared-storage risk and lack of reflog protection.
  Original local-file fixtures exposed incomplete verbose candidate output and
  verification that did not establish remote-copy existence; no experimental
  candidate parser or deletion executor was retained.
- Listing the documented JSON pattern records without flattening their sources.
- Literal-file effective-attribute inspection with NUL-delimited Git output,
  comparing working and index views while retaining external-source precedence.
  This invokes Git without requiring LFS or reading/hydrating file contents.
- Local object diagnostics through stable ls-files JSON. Canonical MIT-licensed
  command code was an informational reference for size-only checkout/cache flags,
  index-plus-HEAD scope and zero-size omissions, not copied or adapted.
  Canonical working pointers are recognized independently from the public spec;
  extended/different pointer-like content is explicitly not classified as hydrated.
- Reviewed root-rule removal with attributes/index/HEAD state checks, without
  claiming history conversion or restoring lockable file permissions.
- Isolating implicit pattern-command hook installation in a command-local
  private directory. Real CLI tests exposed the shared-hook side effect;
  canonical MIT-licensed command sources confirmed it and the long-line rewrite
  limitation. They were used only as informational behavior references, not
  copied or adapted into this repository.

No source code, assets, wording, or visual implementation were copied.

## Partial patch application

Source:

- [Git apply documentation](https://git-scm.com/docs/git-apply)

Used for:

- Applying selected working-tree patch lines to the index.
- Reversing selected patches for unstage and discard operations.
- Recounting edited hunk line counts after line selection.
- Restoring and reapplying repository-local discard recovery patches.

No source code was copied.

## Sparse checkout

Sources:

- [Git sparse-checkout documentation](https://git-scm.com/docs/git-sparse-checkout)
- [Git 2.34 sparse-checkout documentation](https://git-scm.com/docs/git-sparse-checkout/2.34.0.html)

Used for:

- Reading repository-local sparse checkout, cone-mode, and sparse-index state.
- Setting directory selections through standard input, reapplying the current selection, and restoring the complete working tree.
- Providing repository-scoped preferences and conditional toolbar actions for an enabled sparse checkout.
- Warning that restoring a full working tree can require substantial time and disk space.
- Disclosing modified or unmerged paths that Git leaves outside a new selection.

No source code, assets, wording, or visual implementation were copied.

## Repository favorites

Source:

- Project-defined repository navigation requirements.

Used for:

- Defining the functional expectation that repository management can pin frequently used repositories.
- Providing platform-specific shortcuts for the first nine favorites.

No source code, assets, wording, or visual implementation were copied.

## Repository maintenance

Sources:

- [Git maintenance documentation](https://git-scm.com/docs/git-maintenance)
- [Git fsck documentation](https://git-scm.com/docs/git-fsck)

Used for:

- Defining a keyboard-accessible repository-maintenance capability.
- Defining keyboard-accessible repository creation, tab, staging, and stash workflows.
- Running only explicit commit-graph and pack-refs tasks after a complete passing
  integrity check, rather than the configured repository-maintenance strategy.
- Confirming that explicit `--task` options exclude tasks enabled by configuration.
- Keeping maintenance serialized with other repository operations while the UI remains responsive.

No source code, assets, wording collections, or visual implementation were copied.

## Commit bisection

Source:

- [Git bisect documentation](https://git-scm.com/docs/git-bisect)

Used for:

- Starting a binary search from explicit known-bad and known-good revisions.
- Classifying candidates with Git's documented good, bad, and skip terms.
- Restoring the original branch and commit with Git's reset operation.

No source code was copied.

## Protected force push

Source:

- [Git push documentation](https://git-scm.com/docs/git-push)

Used for:

- Publishing rewritten branch history with `--force-with-lease`.
- Preserving remote work by rejecting a push when the upstream reference differs from the locally observed remote-tracking reference.

No source code was copied.

## Merge continuation and recovery

Source:

- [Git merge documentation](https://git-scm.com/docs/git-merge)

Used for:

- Detecting an active merge through Git repository metadata.
- Continuing a resolved merge and aborting a conflicted merge through documented commands.
- Restoring the pre-merge state when the user aborts.

No source code was copied.

## Cherry-pick and revert recovery

Sources:

- [Git cherry-pick documentation](https://git-scm.com/docs/git-cherry-pick)
- [Git revert documentation](https://git-scm.com/docs/git-revert)

Used for:

- Detecting interrupted cherry-pick and revert operations.
- Continuing, skipping, or aborting the active operation through documented commands.
- Restoring the original repository state when an operation is aborted.
- Selecting a 1-based mainline parent to apply or reverse a single merge's
  difference relative to that parent, without copying implementation code.
- Explaining how reverting a merge retains ancestry and affects later merges.
- Applying selected changes with documented `--no-commit` and later explicit
  commits using the current identity.
- Reverting an explicit list with `--no-walk=unsorted` and native sequencer
  Continue/Skip/Abort, preserving documented inverse-commit semantics.
- Owned first/later hook-refusal fixtures identify retained sequencer state
  without REVERT_HEAD and qualify explicit staged commit before Continue;
  no Git implementation code was inspected or copied.
- Owned black-box fixtures of single/multiple no-commit conflicts, Continue and
  `git reset --merge` informed an independent restart-safe application journal;
  no proprietary implementation was inspected or copied.

No source code was copied.

## Reflog recovery

Source:

- [Git reflog documentation](https://git-scm.com/docs/git-reflog)

Used for:

- Reading local reference movement history through Git's documented reflog interface.
- Identifying prior commit positions with reflog selectors.
- Preserving a selected commit by creating a normal branch without moving the current branch.

No source code was copied.

## Commit signing

Source:

- [Git commit documentation](https://git-scm.com/docs/git-commit)
- [Git config documentation](https://git-scm.com/docs/git-config)
- [Git pretty formats documentation](https://git-scm.com/docs/pretty-formats)
- [Git signature object format](https://git-scm.com/docs/gitformat-signature)
- [Git 2.34 SSH trust configuration](https://git-scm.com/docs/git-config/2.34.0)
- [Git hooks manual](https://git-scm.com/docs/githooks)
- [Git 2.34 signing configuration documentation](https://raw.githubusercontent.com/git/git/v2.34.0/Documentation/config/gpg.txt)
- [GnuPG configuration options](https://www.gnupg.org/documentation/manuals/gnupg/GPG-Configuration-Options.html)
- [GnuPG agent trust configuration](https://www.gnupg.org/documentation/manuals/gnupg/Agent-Configuration.html)
- [GPGSM certificate-checking options](https://www.gnupg.org/documentation/manuals/gnupg/Certificate-Options.html)
- [GPGSM configuration options](https://www.gnupg.org/documentation/manuals/gnupg/Configuration-Options.html)
- [OpenSSL certificate request command](https://docs.openssl.org/3.5/man1/openssl-req/)
- [OpenSSL PKCS#12 command](https://docs.openssl.org/3.5/man1/openssl-pkcs12/)

Used for:

- Requesting a cryptographic commit signature through Git's documented `--gpg-sign` option.
- Delegating key selection, signing format, signer invocation, and credentials to the user's existing Git configuration.
- Reading effective repository identity, automatic-signing, signing-format, and signing-key configuration.
- Updating repository-local `user.name` and `user.email` values through Git's documented configuration interface.
- Reading Git's documented signature status, signer, key, fingerprint, and trust placeholders for one inspected commit.
- Resolving the effective OpenPGP, SSH, or X.509 signer program without invoking it.
- Distinguishing stored commit-signature headers from absent signatures when
  verification lacks configuration, using bounded independent header parsing.
- Qualifying SSH allowed-signers/revocation behavior through ephemeral local
  test keys without touching user keys or trust stores.
- Explaining the exact verification-hook opt-out and always-run prepare hook.
- Resolving legacy and format-specific OpenPGP program aliases in effective
  configuration order with bounded, literal settings and explicit failures.
- Qualifying OpenPGP signing/verification using generated disposable keys,
  isolated signing/public-verification homes and home-scoped agent cleanup.
- Qualifying offline X.509 signing/tamper rejection and explicit distrust through
  generated disposable certificate/key/trust fixtures. Offline checking options
  are fixture-only; production trust and revocation configuration are untouched.

No source code was copied.

## Keyboard-accessible tag creation

Sources:

- [Git tag documentation](https://git-scm.com/docs/git-tag)
- Project-defined command-palette requirements.

Used for:

- Creating either a lightweight tag or an annotated tag with a message at an explicitly selected commit or the current HEAD.
- Making tag creation available through the application command palette.

No source code, assets, wording collections, or visual implementation were copied.

## Reference visibility controls

Source:

- Project-defined graph visibility requirements.

Used for:

- Defining the product-neutral behavior of hiding references from the commit graph without changing Git data.
- Applying or removing Solo Mode for individual branches and complete remote locations.

No source code, assets, wording collections, or visual implementation were copied.

## Hosted review-request navigation

Sources:

- [GitHub documentation about remote repositories](https://docs.github.com/en/get-started/git-basics/about-remote-repositories)
- [GitHub pull-request documentation](https://docs.github.com/en/pull-requests/reference/pull-requests)
- [GitLab merge-request documentation](https://docs.gitlab.com/user/project/merge_requests/)
- [GitLab Projects API fields](https://docs.gitlab.com/api/projects/)
- [Bitbucket Cloud remote URL documentation](https://support.atlassian.com/bitbucket-cloud/docs/change-the-remote-url-to-your-repository/)
- [Bitbucket Cloud pull-request URL example](https://support.atlassian.com/bitbucket-cloud/kb/how-to-locally-fetch-and-checkout-a-pull-request/)

Used for:

- Recognizing documented GitHub, GitLab, and Bitbucket Cloud HTTPS and SSH repository remote forms.
- Providing an explicit link from a repository remote to its pull-request or merge-request page.
- Treating hosted review requests as a hosting workflow without inspecting or copying any hosting-client implementation.

No source code, assets, wording collections, or visual implementation were copied.

## Isolated worktree sessions

Source:

- [Git worktree documentation](https://git-scm.com/docs/git-worktree)

Used for:

- Creating a linked working tree for a new branch or an existing branch.
- Opening the linked worktree as a repository workspace with an optional repository terminal.
- Keeping terminal handoff tool-neutral so users can run any locally available command.

No source code, assets, wording collections, or visual implementation were copied.

## Configured commit-template preparation

Sources:

- https://git-scm.com/docs/git-commit
- https://git-scm.com/docs/git-config
- https://git-scm.com/docs/git-stripspace

Used for effective template path configuration and Git-owned comment/whitespace
preparation. Independently implemented bounded UTF-8 loading, visible failures,
non-mutating retry and confirmation before draft replacement. Original disposable
fixtures compare behavior with Git, including literal paths, custom comment
characters, exact limits and preserved repository state. No code copied.

## Explicit repository integrity inspection

Source: [Git fsck manual](https://git-scm.com/docs/git-fsck).

Used for object/connectivity inspection scope and the distinction between
diagnostic findings, normal dangling objects and repair. Git owns verification;
bounded streaming, cancellation, conservative promisor refusal and the interface
are original implementations. No external code or documentation prose copied.

## Minimum Git version qualification

Sources: [Git source releases](https://github.com/git/git/tags),
[Git 2.36 worktree manual](https://git-scm.com/docs/git-worktree/2.36.0) and
[Git 2.35 am manual](https://git-scm.com/docs/git-am/2.35.0).

Used for building disposable Git 2.34, 2.39 and 2.43 binaries and running the
native fixture suite against each. Version-specific findings and the 2.39
baseline are recorded in compatibility notes. No code copied.

## Linux system packaging

Sources:

- [Tauri 2 bundle configuration reference](https://v2.tauri.app/reference/config/#bundleconfig)
- [Debian package archives policy](https://www.debian.org/doc/debian-policy/ch-archive.html)
- [Debian copyright format 1.0](https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/)
- [Desktop Entry Specification](https://specifications.freedesktop.org/desktop-entry-spec/latest/)

Used for:

- Building a Debian package with explicit runtime dependencies and standard
  installation paths.
- Installing the executable, desktop launcher, icons, manual, changelog,
  copyright statement and third-party notices system-wide.
- Validating package metadata and desktop-menu registration independently of
  any other Git client.

No source code, assets, or product wording were copied.

## Native window title updates

Source:

- [Tauri 2 window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)

Used for:

- Updating the native desktop window title through the documented `setTitle`
  capability when the active repository, branch, or working state changes.
- Keeping browser-preview document titles useful without invoking native APIs.

No source code, assets, wording collections, or visual implementation were copied.
