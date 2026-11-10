# Informational sources

## Reviewed original-reference deletion

- [Git reference update semantics](https://git-scm.com/docs/git-update-ref)
- [Git reference enumeration and format atoms](https://git-scm.com/docs/git-for-each-ref)
- Existing gitoxide direct-reference read API documentation (the workspace's
  already licensed dependency).

Used for independently implemented canonical-name framing and a hook-aware,
non-dereferencing Git transaction with a locked direct-object lease. Display decorations are not used to
reconstruct reference authority. No external implementation code was copied.

## Linux worktree path resolution

- [Linux `openat2(2)` manual](https://man7.org/linux/man-pages/man2/openat2.2.html)
- [Linux kernel pathname lookup](https://docs.kernel.org/filesystems/path-lookup.html)

These sources informed an earlier independent Linux file-creation approach.
That implementation was removed after testing showed the selected worktree
root could still be replaced concurrently. Empty-file creation is now refused
outside Windows and in Windows subdirectories; no Linux `openat2` create path
is active. No external source code was copied.

## Windows repository-file boundaries

- [Windows file naming rules and short names](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
- [Rust filesystem canonicalization](https://doc.rust-lang.org/std/fs/fn.canonicalize.html)
- [Windows final path names](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew)

Used to independently define validation for Windows file names and resolved
paths, including possible short-name aliases for Git metadata. No external
source code or assets were copied. Focused native Windows CI tests cover these
boundaries; broader Windows application qualification remains open.

## Private discard-recovery snapshots

- [Linux renameat2 and no-replace publication](https://man7.org/linux/man-pages/man2/renameat2.2.html)
- [Windows CreateFileW flags and sharing](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- [Rust Windows OpenOptions extensions](https://doc.rust-lang.org/std/os/windows/fs/trait.OpenOptionsExt.html)

Used to independently select no-overwrite publication on Linux and exclusive,
delete-on-close temporary-file behavior for the Windows recovery snapshot.
Unix unlinks its private temporary file before writing. No external code was
copied; Windows runtime qualification remains open.

## Reviewed GitLab cloning

- [GitLab Projects API](https://docs.gitlab.com/api/projects/)
- [Git clone manual](https://git-scm.com/docs/git-clone)
- [Git HTTP backend](https://git-scm.com/docs/git-http-backend)
- [Git credential helpers](https://git-scm.com/docs/gitcredentials)
- [Git TLS configuration](https://git-scm.com/docs/git-config)
- [OpenSSH server configuration](https://man.openbsd.org/sshd_config)
- [OpenSSH client configuration](https://man.openbsd.org/ssh_config)

Used for stable-ID project inspection, documented clone URL fields and literal
branch/depth/submodule options, and an owned verified-HTTPS Git fixture using
public CGI/credential-helper contracts. The normalization, preview ownership and fixtures
are independently written. No proprietary code or assets, external implementation
source or documentation passages were copied. The private loopback SSH fixture uses documented forced commands, explicit
identity files and pinned known hosts without changing host configuration.
Local desktop and exact-package evidence is recorded in the
[reviewed clone specification](../specifications/gitlab-reviewed-clone.md).

## GitLab account and project discovery

- [GitLab REST API](https://docs.gitlab.com/api/rest/)
- [REST API token authentication](https://docs.gitlab.com/api/rest/authentication/)
- [Projects API](https://docs.gitlab.com/api/projects/)
- [GitLab CLI API interface](https://docs.gitlab.com/cli/api/)
- [CLI configuration and environment precedence](https://docs.gitlab.com/cli/configuration/)
- [CLI account status](https://docs.gitlab.com/cli/auth/status/)
- [Canonical CLI MIT license](https://gitlab.com/gitlab-org/cli/-/raw/main/LICENSE)

Used for public response fields, account/instance requirements, bounded discovery
and review of a possible optional transport. The core model and JSON behavioral
fixtures are original project code. No external source code or assets were copied.
No CLI dependency has been adopted or bundled. The concrete HTTPS transport and
owned packaged fixture passed local qualification; live-service acceptance remains
open. See the [catalogue specification](../specifications/gitlab-projects.md).

The owned CLI 1.126.0 HTTPS fixtures also inform the redirect refusal requirement;
they contain no real account credentials or third-party implementation material.

## GitLab HTTPS transport

- [reqwest 0.13.5 client configuration](https://docs.rs/reqwest/0.13.5/reqwest/struct.ClientBuilder.html)
- [Response streaming](https://docs.rs/reqwest/0.13.5/reqwest/struct.Response.html)
- [Disabling automatic retries](https://docs.rs/reqwest/0.13.5/reqwest/retry/fn.never.html)
- [reqwest canonical repository](https://github.com/seanmonstar/reqwest)
- [Tokio canonical repository](https://github.com/tokio-rs/tokio)
- [Tokio 1.53.3 runtime shutdown](https://docs.rs/tokio/1.53.3/tokio/runtime/struct.Runtime.html#method.shutdown_background)

Used for public client APIs, verified TLS, redirect refusal, response bounds and
cooperative request cancellation. Transport and fixture implementations are
original. No external example or implementation code copied. Published local
manifests identify reqwest 0.13.5 as MIT OR Apache-2.0 and Tokio 1.53.3 as MIT.
The lockfile adds fifteen packages with known MIT/Apache terms; locked offline
Linux notice collection, behavioral tests and exact-package gates pass as recorded
in the catalogue specification. This does not establish live-service acceptance.

## GitLab catalogue interface candidate

- [Angular deferred loading](https://angular.dev/guide/templates/defer)

Used for public standalone-component deferral and loading/error lifecycle rules.
The catalogue, token-input lifecycle, cancellation guards and original behavioral
fixtures use Khronos's own design tokens and repository dialog. No external source,
assets, screenshots or distinctive vendor wording were copied. Syntax checks alone
do not prove chunk separation, rendering, interaction or native behavior.

## Reviewed local fork remote configuration

- [Git remote manual](https://git-scm.com/docs/git-remote)
- [Git configuration manual](https://git-scm.com/docs/git-config)

Used for remote URL/fetch-refspec behavior, configuration scopes and includes.
The locking/comparison/publication implementation and behavioral fixtures are
original project code. No external source or vendor implementation was copied.

## Generated frontend notices and dialog-plugin terms

Sources: the actual production `dist/apps/desktop/3rdpartylicenses.txt`, installed
package metadata, `pnpm-lock.yaml`, the official
[plugin-dialog 2.8.1 registry metadata](https://registry.npmjs.org/@tauri-apps/plugin-dialog/2.8.1),
and the exact plugins-workspace revision
`d4835d0e947179bac24a383212792d74be3ebe4f`.

Used to identify the omitted generated notice payload and the dialog package's
SPDX-only published notice. The pinned upstream manifest and MIT/Apache license
blobs were verified by SHA-256 and Git-blob identity before retaining the terms.
No upstream implementation was copied. Policy identities and license-file
provenance are in `packaging/licenses/reviewed-frontend-notices.json`.

## Native Tauri acceptance and typed IPC

Sources:

- https://v2.tauri.app/develop/tests/webdriver/manual-setup/
- https://github.com/specta-rs/tauri-specta/tree/v2.0.0-rc.21
- https://github.com/specta-rs/specta

Used for the public WebDriver setup and the supported Tauri command/event type
generation model. The harness, fixtures, safe-integer validation, generated
adapter, and acceptance scenarios are independently written for Git Khronos.
No external source code, assets, or documentation prose copied.

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
- [libcurl error categories](https://curl.se/libcurl/c/libcurl-errors.html)

The server manual informed only the disposable loopback `sshd` test fixture.

Used for Git askpass/helper ownership, SSH askpass behavior and strict host-key
verification. The operation bridge, protocol and interface are independent
implementations; no upstream source code or assets were copied.

The libcurl reference distinguishes connection, TLS and certificate failures;
it does not define a stable Git stderr protocol. Transport classification is an
independent best-effort implementation, tested against owned Git/HTTPS fixtures.
Repository names and quoted URLs alone are not evidence of a TLS failure.

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
- Existing-repository endpoint credential review uses the Git LFS configuration
  manual's documented endpoint keys, working/index/HEAD `.lfsconfig` selection,
  bare-repository behavior, and ordinary Git configuration overrides. Git itself
  parses configuration; the preflight, bounds, and cancellation lifecycle are
  independently implemented. Owned loopback fixtures verify refusal before any
  connection and preserve safe overrides. No upstream implementation was copied.
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
- Retaining CRLF pointer references during cleanup. An original fixture asks
  `git lfs pointer --check --no-strict` to validate its noncanonical pointer,
  stores it as an unreachable Git blob, and checks that a previously reviewed
  removal is refused without deleting cache data or changing HEAD/index bytes.
  This behavior was independently verified with Git LFS 3.7.1; no upstream code
  was copied or adapted.
- Retaining original pointer content hidden by Git replacement refs. An original
  local Git 2.53 fixture writes both blobs and a replacement ref, verifies the
  changed ordinary `cat-file` output, and checks cleanup against raw stored
  objects with replacement presentation disabled. No external implementation
  was copied or adapted.
- Clone-configuration safety checks were independently exercised with local Git
  2.53, using NUL-framed `config --get-regexp` output and `config --type=bool`
  as a separate oracle for disabled promisor values. Original fixtures distinguish
  the partial-clone extension's remote name from booleans and require failed
  configuration queries to refuse cleanup. No external source code was reused.
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

## Responsive terminal input

Sources:

- [Tauri asynchronous commands](https://v2.tauri.app/develop/calling-rust/)
- [Tokio asynchronous mutex behavior](https://docs.rs/tokio/latest/tokio/sync/struct.Mutex.html)
- [Linux readiness polling](https://man7.org/linux/man-pages/man2/poll.2.html)
- [Linux file status flags](https://man7.org/linux/man-pages/man2/F_GETFL.2const.html)

Used for keeping blocking PTY writes off the UI thread and awaiting a per-terminal
writer without holding the shared session registry or occupying a blocking worker
while queued. Frontend input is sequenced per tab and queued suffixes are cancelled
after a failed write or close request. The IPC contract is unchanged. Tests use a
controlled blocked writer and an owned stopped shell with a full PTY input buffer.
Explicit close also runs on the blocking pool. Per-child ownership is retained
through status, signal, or wait failures, so an explicit retry can still reap the
same child. EOF and explicit close serialize process cleanup without holding the
shared registry; a separate lifecycle guard announces exit only once, after both
output handling and reaping complete. Independent fault-injection and native
event fixtures verify these boundaries.
Unix PTY streams use owned duplicate descriptors with nonblocking I/O and bounded
readiness polling. Closing a session sets a shared cancellation flag, allowing
pending writes to settle even if reaping the shell does not release the PTY's
blocked system call. Buffered output is drained before treating a hangup as EOF.
The non-Unix stream implementation retains the portable-pty backend; the new
cancellation regression and native acceptance evidence are Linux-specific.
No upstream code was copied or adapted.

## Renderer terminal startup ownership

Sources:

- [Angular render callbacks](https://angular.dev/api/core/afterNextRender)
- [xterm.js terminal lifecycle API](https://xtermjs.org/docs/api/terminal/classes/terminal/)
- [Tauri content security policy](https://v2.tauri.app/security/csp/)
- [CSP style-src-attr directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr)

Used for independently ordering screen creation after the Angular host render
and disposing acquired terminal resources when setup or mounting fails. Native
session cleanup remains part of the startup transaction. A failed native close
retains its session ID for an explicit cleanup retry before another startup is
allowed. Renderer disposal failures do not skip native cleanup or other resource
disposals. In packaged builds, terminal-generated style elements receive the
Tauri style nonce before attachment. The policy permits inline style attributes
throughout the app for terminal true-color rendering while still requiring
nonces for inline style elements; it does not relax the script policy. No
upstream implementation code was copied or adapted.

## Authentication interface delivery

Source: [Angular deferred loading](https://angular.dev/guide/templates/defer).

Used for independently deferring the authentication component immediately after
the first view render, with explicit load-failure feedback and pending-request
reconciliation. This keeps the existing initial-bundle hard limit while preserving
credential masking, per-request submission ownership, and cancellation feedback.
No framework implementation code was copied or adapted.

## Browser drag-and-drop verification

Source:

- [Playwright pointer and drag actions](https://playwright.dev/docs/input#dragging-manually)

Used for:

- Driving branch-drop menu tests with hit-tested pointer actions and repeated
  target movement so browsers deliver the required `dragover` event.
- Retaining menu placement, keyboard navigation, and focus-return assertions.

The tests use standard documented APIs. No third-party implementation was copied.

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
- [Git branch documentation](https://git-scm.com/docs/git-branch)

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

## Untracked diff statistics

Sources:

- [Git attributes documentation](https://git-scm.com/docs/gitattributes)
- [Git configuration documentation](https://git-scm.com/docs/git-config)
- [Git diff driver behavior](https://github.com/git/git/blob/master/userdiff.c)
- [Git diff size classification](https://github.com/git/git/blob/master/diff.c)

Used for:

- Resolving typed effective diff attributes with gitoxide, including inherited
  rules and index fallbacks, verified against the Git CLI.
- Using read-only Git index metadata for attribute paths so sparse trees and
  executable attribute files retain their effective rules without checkout.
- Respecting explicit text/binary settings, automatic driver settings, and the
  configured size threshold while computing untracked additions.
- Deriving behavioral tests against local Git without executing diff converters
  or changing the application user's index.

The implementation is independently written. No upstream source code was copied
or adapted.

## Selected-file stash boundaries

Sources:

- [Git stash documentation](https://git-scm.com/docs/git-stash)
- [Git 2.53 stash command behavior](https://github.com/git/git/blob/v2.53.0/builtin/stash.c)

Used for independently implementing complete rename selection, literal NUL-framed
path scopes, and explicit index-restoration options. Disposable CLI fixtures
verify staged deletion validation and Git's keep-index capture/reapply behavior.
Git's staged-only reverse patch does not honor the selected path scope; an
isolated index containing only selected staged changes avoids changing other
staged files. The real index remains locked until its selected entries are
published. Ordinary and keep-index selected stashes retain Git's full staged-tree
parent; restoring that index can conflict with staged changes that were left in
place. Tests distinguish this existing Git behavior from rollback or
data-preservation failures.

No upstream implementation was copied or adapted.

## Inherited Git environment boundaries

Source: [Git command and environment documentation](https://git-scm.com/docs/git).

Used for interpreting repository-routing and pathspec environment variables.
Internal Git commands clear inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`,
and `GIT_INDEX_FILE`, plus the four `GIT_*_PATHSPECS` flags, before applying their
explicit repository and path selections. Scoped internal alternate indexes and
explicit bare-repository access are applied afterward. Normal Git configuration
and authentication environment are retained. Independently written isolated
process tests verify these boundaries. The in-process attribute engine explicitly
sets its selected working directory after opening, so inherited `GIT_WORK_TREE`
cannot substitute another repository's attribute files. No source code was
copied or adapted.

## Commit-history record framing

Sources: [Git pretty-format documentation](https://git-scm.com/docs/pretty-formats)
and [Git log options](https://git-scm.com/docs/git-log).

Used for the documented literal-byte placeholders and `tformat` terminator
semantics. History transport uses eight NUL-terminated fields followed by Git's
record newline, instead of field/record separators that valid commit text can
contain. The decoder rejects incomplete records, invalid object IDs, and duplicate
commit records rather than silently dropping them. Ordinary control-character
messages are compared with independent per-field Git queries. Malformed raw NUL
commit fixtures separately check that message data cannot forge records or
metadata. Output is explicitly UTF-8 even when `i18n.logOutputEncoding` requests
UTF-16; configured output encoding cannot introduce NULs into the field stream.
Signature, notes, and color presentation are disabled for this transport.
No upstream source code was copied or adapted.

## Stash-list record framing and recovery labels

Source: [Git stash documentation](https://git-scm.com/docs/git-stash), including
its documented Git log options and newest-first reflog selectors.

Stash transport independently uses three NUL-terminated fields and validates
the complete ordinal selector sequence and full object IDs. Repeated object IDs
remain valid when their stash selectors differ. Unicode/control-character
labels, configured output encoding, exact-target stash actions, and restoration
after deletion are checked with owned Git repositories. Deletion recovery uses
an explicitly UTF-8, bounded display-label preview; the full stash object remains
protected by its unchanged object ID. No upstream implementation was copied and
no new dependencies were introduced.

## Selected stash application and partial pop outcomes

Source: [Git stash documentation](https://git-scm.com/docs/git-stash), specifically
immutable stash-like commit arguments for apply, pop retaining a stash on
conflict, and the `stash.index` configuration behavior.

Selected apply/pop commands independently validate the captured selector/object
pair, then apply the immutable object ID. Pop revalidates before removal and
reports an explicit applied-but-not-removed outcome when removal fails. Owned
merge-driver fixtures renumber the stash stack during application to check that
the applied contents remain those selected and neither entry is removed on the
changed-stack path. No upstream source code was copied.

## Immutable stash preview transport

Sources: [Git show documentation](https://git-scm.com/docs/git-show) for explicit
UTF-8 output, notes suppression, and signature presentation; and
[Git stash documentation](https://git-scm.com/docs/git-stash) for stash object
structure and including saved untracked files.

Preview messages, file lists, statistics, and patches independently use one
selected immutable object ID, not a later interpretation of a stash ordinal.
Optional notes, colour, external diff/text conversion, and signature-verifier
presentation are suppressed. Existing bounded complete-header inspection detects
signature presence without invoking a verifier, so a signed object is not
misrepresented as unsigned. Owned Git fixtures cover Unicode, stack renumbering,
signature-helper suppression, message limits, and incomplete headers. No external
implementation was copied or new dependency added.

## Commit preview and file-history metadata

Sources: [Git show documentation](https://git-scm.com/docs/git-show) and
[Git pretty formats](https://git-scm.com/docs/pretty-formats).

Ordinary commit previews explicitly request UTF-8 and suppress notes, colour,
and additional signature presentation while retaining verification through the
documented signature placeholders. Incomplete or unknown verification metadata
is rejected rather than treated as unsigned. Legacy file history independently
uses five NUL-terminated fields and a record newline, rejecting incomplete,
duplicate, or invalid object-ID records. Search and paginated file history also
explicitly request UTF-8. Owned fixtures exercise control characters, Unicode,
configured UTF-16 output, and real SSH signature verification. No external code
was copied and no dependency was added.

Legacy file-history reads additionally use the project's bounded, deadline-aware
history process runner with a 2 MiB per-pipe cap. The native command runs outside
the UI thread. Owned fixtures verify an oversized subject is refused without a
partial list and that unrelated controls respond while Git is deliberately held
open. Exact-boundary and stderr-overflow checks exercise the shared collector;
an owned shell-alias fixture checks cancellation remains active after Git exits
while a descendant still holds a pipe. No external process-runner implementation
was used.

## Bounded blame investigation

Source: [Git blame documentation](https://git-scm.com/docs/git-blame), including
line ranges, line-porcelain metadata, encoding, and boundary configuration; and
[Git pathname quoting](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corequotePath).

Blame pages independently request 100 lines plus one lookahead line from a pinned
commit, with explicit UTF-8 metadata and no text conversion. Both the legacy and
paged commands run outside the UI thread with bounded pipes and a deadline.
The decoder requires complete source/attribution records and consecutive final
line numbers instead of inventing missing text or epoch timestamps. Empty-file
range failures are checked against the actual empty blob, not stderr wording.
Owned fixtures cover Unicode, renamed paths, CRLF data, malformed output, text
converter suppression, large files, and pending-read responsiveness. The original
UI provides bounded pages, line jumps, explicit local errors/retry, preserved
loaded pages, and horizontal source scrolling. No upstream code or assets were
copied; no new dependency was introduced.
The independent path decoder removes exactly one enclosing quote pair, supports
Git's C control escapes and octal bytes, and rejects malformed/NUL paths. Literal
argv validation preserves valid spaces and control characters without weakening
the separate validators used by mutation workflows.

## Native WebDriver session transport

Sources: [Tauri manual WebDriver setup](https://tauri.app/develop/tests/webdriver/manual-setup/)
and [Tauri driver request routing](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-driver/src/server.rs).

The Linux harness independently routes session creation through Tauri and
subsequent commands directly to the native WebKit driver owning that session.
This removes an intermediary HTTP hop after repeated lost replies at unrelated
operations; it does not establish the underlying cause of those lost replies.
The packaged application and native bridge remain unchanged. Mutation replies
are never recovered by replay or fallback; owned unit tests assert endpoint
selection and exactly one attempted mutation on connection loss. No upstream
source code was copied or adapted, and no dependency was introduced.

## Directory-relative LFS removal

Sources:

- rustix filesystem API: <https://docs.rs/rustix/1.1.5/rustix/fs/index.html>
- openat: <https://docs.rs/rustix/1.1.5/rustix/fs/fn.openat.html>
- unlinkat: <https://docs.rs/rustix/1.1.5/rustix/fs/fn.unlinkat.html>

Used for directory-handle-relative filesystem operations and no-follow flags.
The requirement was independently derived from a disposable native regression
that swaps an LFS cache directory after inventory and requires an outside
sentinel to survive. No implementation source code copied.

## Namespace-relative reference names

Source: [Git for-each-ref documentation](https://git-scm.com/docs/git-for-each-ref).

Used for distinguishing ambiguity-dependent `refname:short` display values from
namespace-relative branch, remote-tracking, tag, and upstream names. Original
fixtures create branches and tags with the same names under both ambiguity
settings and verify exact action scope. No source code was copied.

## Build-output isolation

Source: [Nx output configuration](https://nx.dev/docs/guides/tasks--caching/configure-outputs).

Used for binding cached build artifacts to the selected output directory instead
of a shared release path. Original tests separately qualify development checks,
fresh development builds, cache restoration, and the production asset guard.
No external implementation code was copied.

## Menu keyboard exit

Source: [WAI menu and menubar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/).

Used for the requirement that Tab and Shift+Tab leave transient menus rather
than cycling through their items. Original browser regressions compare normal
focus order against menu dismissal, including the document boundary. A native
WebKit fixture uses real keyboard input against the packaged application.
No implementation code was copied.

## Clone URL review

Sources:

- [Git ls-remote documentation](https://git-scm.com/docs/git-ls-remote/2.28.0)
- [Git configuration conditional includes](https://git-scm.com/docs/git-config/2.39.0#_conditional_includes)

Used for delegating URL expansion to Git without contacting the remote and for
scoping conditional includes to the clone destination. Disposable local-only
probes distinguish launching-repository settings from destination and remote-URL
conditions. Original integration tests isolate global and system configuration
in subprocesses; native acceptance exercises the existing packaged clone command.
No implementation source code was copied or adapted.

## Transport-time credential URL refusal

Source: [Git 2.39 configuration documentation](https://git-scm.com/docs/git-config/2.39.0#Documentation/git-config.txt-transfercredentialsInUrl).

Used for enforcing Git's password-in-URL refusal during the actual transport,
including rewrites copied from clone templates after preflight. Original local-only
regressions require HTTP and SSH password refusal despite configured `allow`,
preserve a safe template's rewrite and files, and classify the diagnostic without
returning its URL. This safeguard supplements existing validation; it does not
claim to cover HTTP username-only template URLs or replace push-URL preflight.
No implementation code was copied or adapted.

## Debian package-name transition

Sources:

- [Debian package relationships policy](https://www.debian.org/doc/debian-policy/ch-relationships.html)
- [APT transaction hook protocol](https://manpages.debian.org/bookworm/apt/apt.conf.5.en.html)
- [APT removal refusal](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html)
- [APT's official hook configuration implementation](https://github.com/Debian/apt/blob/main/apt-pkg/deb/dpkgpm.cc)

Used for exact legacy-package replacement fields, the documented version-2
action stream, and per-command protocol selection. The guard is independently
implemented, never parses translated simulation output, and does not execute
configuration values. No upstream implementation code was copied or adapted.
Private fakeroot/dpkg regressions, protocol/mocked-installer checks, and real
isolated APT transactions passed. These cover user decline, legacy-only
replacement, refusal of an unrelated transitive removal before dpkg mutation,
and preservation of existing hooks' protocols. They use private configuration,
databases, roots, logs, and fixture packages; no host packages are installed or
removed. Rebuilt-artifact acceptance remains a separate gate.

## Interruptible Unix child-output reads

Sources: existing Rustix 1.1.5 API declarations and
[fcntl_getfl](https://docs.rs/rustix/1.1.5/rustix/fs/fn.fcntl_getfl.html) /
[fcntl_setfl](https://docs.rs/rustix/1.1.5/rustix/fs/fn.fcntl_setfl.html)
documentation.

Used for preserving the owned read descriptor's flags while enabling
nonblocking reads. The independently written stop-aware adapter lets the
capture, history, and LFS-scan workers join on requested termination even when an original
fixture helper retains inherited writers outside Git's process group. Normal
EOF remains distinct from requested termination. No upstream implementation
was copied, and no dependency was added. Linux regression proof does not
qualify Windows or other reader implementations.

## Distribution notice coverage audit

Sources: locked offline `cargo metadata --filter-platform x86_64-unknown-linux-gnu`
from this checkout, the actual preserved Debian payload, and Mozilla's
[MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) (particularly Q8).

Used to distinguish declared dependency-license metadata, source-availability
notices, and actual release-payload coverage. Workspace normal-dependency
closures, even with proc-macro subtrees excluded, are not represented as exact
linked-artifact SBOMs or a legal compliance approval. The current package
verifier's notice-presence checks do not prove complete upstream attribution.
No third-party implementation or additional asset was copied by this audit.

The project-authored selectors source-availability notice also uses Mozilla's
[MPL 2.0 terms](https://www.mozilla.org/en-US/MPL/2.0/) (sections 3.1–3.4),
the published crate's recorded VCS metadata and MPL headers, and the exact
[upstream source revision](https://github.com/servo/stylo/tree/572ecba2d1600e7c3d490586692a209faf703baa/selectors).
These define the source retrieval information, not an overall legal opinion.
No implementation was copied into the notice or collector output.

Linux notice generation uses the target triple exposed by Tauri's
[beforeBundleCommand hook](https://v2.tauri.app/reference/config/#beforebundlecommand),
also confirmed in the installed CLI schema. No host-architecture inference or
third-party implementation was used for the packaging hook.

The packaged-versus-build-directory executable comparison also consulted the
locked `tauri-utils 2.10.1` crate's `src/platform.rs` in the local Cargo registry.
It defines Tauri's patchable bundle-type marker. Independent byte comparison
found only the expected `UNK` to `DEB` marker substitution in this candidate;
packaged and unbundled executable hashes are therefore recorded separately.
No upstream implementation was copied or modified for that inspection.

## Isolated committed merge preview

Source: [Git merge-tree manual](https://git-scm.com/docs/git-merge-tree), consulted
2026-10-31. Used for default merge behavior, NUL-delimited conflict paths,
exit-status interpretation, rename handling, unrelated-history refusal, and the
fact that merge-tree writes merge objects while leaving index/working files alone.
The implementation uses an isolated bare object database and reads the selected
repository through Git alternates. No upstream implementation was copied.

The preceding feature comparison consulted public GitKraken documentation for
[conflict prevention](https://help.gitkraken.com/gitkraken-desktop/conflict-prevention/).
It supplied only the abstract capability of detecting conflicts before a merge.
No proprietary package contents, code, assets, wording, layout or internal
implementation details were used.

Committed attribute lookup uses Git's documented
[`--attr-source`](https://git-scm.com/docs/git/2.43.0)
option. This feature requires Git 2.43+ explicitly rather than allowing an older
Git to silently ignore attributes through an unrecognized environment variable.

## Workspace, identity, hosted collaboration and agent capabilities

Public workflow references (capability discovery only):

- https://help.gitkraken.com/gitkraken-desktop/gitkraken-launchpad/
- https://help.gitkraken.com/gitkraken-desktop/profiles/
- https://help.gitkraken.com/gitkraken-desktop/pull-requests/

Implementation behavior references:

- https://git-scm.com/docs/git-status (local status and tracking state)
- https://git-scm.com/docs/git-config (repository commit identity)
- https://cli.github.com/manual/gh_api (authenticated explicit GET requests)
- https://docs.github.com/en/rest/pulls/pulls (pull metadata and changed files)
- https://docs.github.com/en/rest/pulls/reviews (review decisions)
- https://docs.github.com/en/rest/checks/runs (commit-scoped check runs)
- https://docs.github.com/en/rest/issues/issues (issues include pull requests;
  the adapter filters those records from its issue list)
- https://docs.github.com/en/rest/actions/workflow-runs (workflow state)
- https://learn.chatgpt.com/docs/codex/cli (interactive `codex` launch)
- https://code.claude.com/docs/en/cli-reference (interactive `claude` launch)
- https://geminicli.com/docs/ (interactive Gemini CLI)
- https://opencode.ai/docs/cli/ (interactive `opencode` launch)

Used for neutral requirements, request/response field semantics and documented
program invocation. No external source code, screenshots, UI strings or assets
were copied. No proprietary package contents were inspected. No new dependency
was added; optional external CLIs are installed and authenticated separately by
the user, and are not redistributed with Khronos.

## Hosted pagination, decisions and status contexts

- https://docs.github.com/en/rest/pulls/reviews (chronological paginated review
  events and their state/commit fields)
- https://docs.github.com/en/rest/commits/statuses (combined provider state and
  latest commit-status contexts)
- https://docs.github.com/en/rest/checks/runs (latest check runs and pagination)
- https://docs.github.com/en/rest/pulls/pulls (PR state filters and file pages)
- https://docs.github.com/en/rest/issues/issues (state filters; PR records remain
  distinct from issues when paging)

Requirements and original behavioral fixtures derive from public response
semantics. No provider source code or proprietary implementation was used.

## Additional public capability discovery

- https://help.gitkraken.com/gitkraken-desktop/linking/
- https://help.gitkraken.com/gitkraken-desktop/pull-requests-filter-syntax/
- https://help.gitkraken.com/gitkraken-desktop/gkd-gitkraken-ai/

Used only to expand neutral, currently unfinished requirements: Git object links
with local-copy selection and clone fallback; provider-specific review search;
configurable assistance for messages, explanations, conflicts and commit grouping.
No implementation, visual design, assets, examples or documentation prose copied.

The former coding-agent launcher and the assisted requirements discovered from
these sources have since been removed from the active product scope. These
references remain here to record historical provenance.

Further public guides used for the unfinished inventory:

- https://help.gitkraken.com/gitkraken-desktop/profiles/ (separate identities,
  integrations, preferences and tabs; optional explicit Git identity sync)
- https://help.gitkraken.com/gitkraken-desktop/fork/ (existing/new forks and
  reviewed remote attachment)
- https://help.gitkraken.com/gitkraken-desktop/workspaces/ (local/shared groups,
  conversion and multi-repository actions)

These are capability references only, not implementation or visual references.

- https://help.gitkraken.com/gitkraken-desktop/diff/ (comparison modes, change
  navigation, combined selections, history/blame and external tools)
- https://help.gitkraken.com/gitkraken-desktop/editing-files/ (working-file edits,
  distinct save/stage choices, Markdown preview and encoding behavior)
- https://help.gitkraken.com/gitkraken-desktop/tags/ (tag movement, commit
  navigation, branch creation and local/remote transfer)
- https://help.gitkraken.com/gitkraken-desktop/adding-and-removing/ (local file
  creation, deletion and filtering)
- https://help.gitkraken.com/gitkraken-desktop/stashing/ (partial stash and
  individual-file restoration)
- https://help.gitkraken.com/gitkraken-desktop/submodules/ (explicit and optional
  automatic submodule workflows)

Used to refine remaining behavioral acceptance cases. Public Git manuals remain
the implementation authority for Git effects. No example code was copied.

## Reviewed hosted submissions

Primary behavior and invocation references:

- https://docs.github.com/en/rest/pulls/pulls (creation fields, fork head
  coordinates, merge methods and expected-head SHA)
- https://docs.github.com/en/rest/pulls/reviews (explicit submitted review events
  and reviewed commit ID)
- https://docs.github.com/en/rest/branches/branches (published branch commit IDs)
- https://docs.github.com/en/rest/users/users (authenticated account identity)
- https://cli.github.com/manual/gh_api (explicit methods and JSON stdin)
- https://cli.github.com/manual/gh_auth_token (selected CLI account token)
- https://cli.github.com/manual/gh_help_environment (per-process authentication
  precedence and diagnostic controls)

Used for original request/response handling and owned offline acceptance fixtures.
No external implementation, example code, documentation prose or assets copied.
No new dependency was added. The optional CLI is not redistributed.

## Feature, release and hotfix workflow specification

Capability reference:
https://help.gitkraken.com/gitkraken-desktop/git-flow/

Git behavior references:

- https://git-scm.com/docs/git-merge
- https://git-scm.com/docs/git-update-ref
- https://git-scm.com/docs/git-check-ref-format
- https://git-scm.com/docs/git-worktree
- https://git-scm.com/docs/git-tag

Used to define neutral branch transitions and independently designed previews,
partial-result reporting and recovery acceptance cases in
`docs/specifications/branch-workflows.md`. This is a specification, not
implementation or qualification evidence. No proprietary internals, source,
assets or documentation prose were copied; no dependency was added.


## Configurable branch workflows

Sources:

- [Public feature/release/hotfix capability guide](https://help.gitkraken.com/gitkraken-desktop/git-flow/)
- [Git configuration](https://git-scm.com/docs/git-config)
- [Git checkout](https://git-scm.com/docs/git-checkout)
- [Git ref validation](https://git-scm.com/docs/git-check-ref-format)
- [Git conditional ref transactions](https://git-scm.com/docs/git-update-ref)
- [Git reference-transaction hooks](https://git-scm.com/docs/githooks#_reference_transaction)
- [Git merge](https://git-scm.com/docs/git-merge)
- [Git annotated and signed tags](https://git-scm.com/docs/git-tag)
- [Git worktree occupancy](https://git-scm.com/docs/git-worktree)
- [Rust standard file locking](https://doc.rust-lang.org/std/fs/struct.File.html#method.try_lock)

Used for a neutral capability specification and an original Rust workflow engine.
Owned Git repositories verify configuration scope, literal names, conditional
refs, integration ancestry, partial completion, cancellation before/after a transaction
commits, and durable recovery. Standard
library file locks serialize linked-worktree actions. No vendor implementation,
package contents, assets, interface composition or external source code was used.
Desktop/native acceptance remains a separate open requirement in the specification.


## Hosted repository discovery and fork requirements

Primary informational sources:

- [GitHub authenticated repository listing and metadata](https://docs.github.com/en/rest/repos/repos)
- [GitHub fork operations](https://docs.github.com/en/rest/repos/forks)
- [Git clone](https://git-scm.com/docs/git-clone)
- [Git remote configuration](https://git-scm.com/docs/git-remote)

The [public fork capability guide](https://help.gitkraken.com/gitkraken-desktop/fork/)
is a capability reference only. These sources inform neutral requirements in
`docs/specifications/hosted-repositories.md`. The initial discovery adapter uses
public REST fields and independently written owned fixtures. No example code,
proprietary package contents, assets or documentation prose were copied. No
third-party dependency was introduced.

### Reviewed fork requests and readiness

Additional public authorities:

- [GitHub user/owner metadata](https://docs.github.com/en/rest/users/users)
- [GitHub Git reference reads](https://docs.github.com/en/rest/git/refs)
- [GitHub Git commit-object reads](https://docs.github.com/en/rest/git/commits)

The official fork API defines destination organization, requested name, branch
scope and asynchronous creation. Owner identity, a branch reference and its
commit object inform the independent reconciliation checks. Durable private
records, non-replay behavior, local serialization and archive recovery are
project designs. All response fixtures and code are original. No vendor package
internals, copied examples, external code, assets or dependencies were introduced.

### Reviewed desktop catalogue and clone

The same official repository API and Git clone manual define the independent
desktop handoff: bounded account-visible pages, fresh repository metadata, a
selected SSH/HTTPS URL, explicit local destination and branch/history/submodule
options. Native review tokens, cancellation handling and the original interface
are project designs. No external implementation or assets were reused, and no
dependency was added. Behavioral evidence uses owned API responses and local
Git repositories; live provider writes are outside this checkpoint.


## Non-text comparison requirements

Sources:

- https://help.gitkraken.com/gitkraken-desktop/current/ (public 12.1.2 extensionless-image correction)
- https://help.gitkraken.com/gitkraken-desktop/diff/

Used for: identifying content-based image detection and existing comparison
contexts as independently implementable requirements. The neutral specification
is in `docs/specifications/non-text-diffs.md`. No product implementation, assets,
screenshots, distinctive interface composition or substantial text was reused.
Implementation will use public Git plumbing and file-format specifications.


## Read-only selected file content

Sources:

- https://git-scm.com/docs/git (literal pathspecs, optional locks and no-lazy-fetch)
- https://git-scm.com/docs/git-ls-tree
- https://git-scm.com/docs/git-ls-files
- https://git-scm.com/docs/git-cat-file

Used for: an independent selected-file reader that distinguishes Git tree/index
identities from working bytes and performs no implicit object fetch. Existing
project process cancellation and Unix file-descriptor conventions are reused.
The new fixture bytes, local upload-helper control and reader are project-created;
no third-party source code, asset or new dependency was added.


## Exact comparison sides

Sources:

- https://git-scm.com/docs/git-cat-file
- https://git-scm.com/docs/git-stash (saved working tree and parent relationships)

Used for: independently selecting commit parents, HEAD/index/working-copy and
stash layers without treating shallow boundaries or missing objects as absent
files. Owned repositories cover SHA-1/SHA-256, literal rename paths, root and
merge commits, stash layers, missing objects, cancellation and unchanged Git
state. No external implementation, assets or new dependency were introduced.


## Selected raster metadata and Git LFS pointer identification

- https://docs.rs/imagesize/0.15.0/imagesize/ (public licensed library API)
- https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md (public pointer format)

Used for independent content-based presentation and canonical pointer recognition.
The original pointer parser never invokes an LFS filter, fetches an object or
materializes a working file. SVG remains text. Dependency review and fixture
provenance are recorded in third-party-code.md and assets.md.


## Independent repository links specification

- https://help.gitkraken.com/gitkraken-desktop/linking/ (public capability scope only; inspected 2026-11-01)
- https://www.rfc-editor.org/rfc/rfc3986 (URI components and percent encoding)
- https://git-scm.com/docs/git-check-ref-format (public ref-name validation)
- https://v2.tauri.app/plugin/deep-linking/ (platform delivery and lifecycle constraints)

Used for the unfinished G28 specification in `docs/specifications/repository-links.md`.
The proposed scheme and interaction design are independent. No vendor URL format,
source, assets or documentation prose was copied. No plugin has been added.


## Read-only repository-link verification

- https://git-scm.com/docs/git-remote (effective first fetch URL and insteadOf expansion)
- https://git-scm.com/docs/git-rev-parse (full-ref commit resolution)
- https://git-scm.com/docs/git-cat-file (local object type verification)

Used for independently implemented known-path matching and local target checks.
No vendor implementation, proprietary URL grammar or third-party source was copied.


## Composed fetch-free Git reads

- https://git-scm.com/docs/git (`--no-lazy-fetch` behavior)

Used for a project-created, thread-scoped inspection policy and its independently
written local-promisor tests. Explicit fetch remains a separate user operation.
No external implementation was copied.


## Git SSH repository address semantics

- https://git-scm.com/docs/git-clone (Git URL syntax and SCP path semantics)

Used for independent explicit-user SCP address validation, preserving relative,
absolute, home-relative and literal-percent paths without converting them into
absolute SSH URLs. No parser implementation or vendor source was copied.

## Independent working-file editor core

- [Public file-editing capability guide](https://help.gitkraken.com/gitkraken-desktop/editing-files/)
- [Rust string UTF-16 APIs](https://doc.rust-lang.org/std/string/struct.String.html#method.from_utf16)
- [encoding_rs public codec API](https://docs.rs/crate/encoding_rs/0.8.42)
- [rustix filesystem API](https://docs.rs/rustix/1.1.5/rustix/fs/)
- [Atomic rename behavior](https://man7.org/linux/man-pages/man2/rename.2.html)
- [Filesystem synchronization](https://man7.org/linux/man-pages/man2/fsync.2.html)

Used for neutral capability requirements, public APIs, byte interpretation and
filesystem commit/durability semantics. Private edit state, bounded preconditions,
metadata handling and behavioral fixtures are original. No proprietary code,
assets, text collection, visual layout or implementation material was inspected.

### Editor repository context and native identifiers

Sources inspected 2026-11-01:

- https://git-scm.com/docs/git-rev-parse
- https://git-scm.com/docs/git-symbolic-ref
- https://docs.rs/getrandom/0.3.4/getrandom/fn.fill.html

Used for Git-directory/common-directory, object-format, symbolic/detached HEAD
behavior and the existing dependency's public random-byte API. The private
context/session design is original; no external implementation was copied.

### Inert Markdown draft preview

Sources inspected 2026-11-01:

- https://marked.js.org/using_pro#lexer
- https://marked.js.org/license
- https://github.com/markedjs/marked/security/advisories/GHSA-6v9c-7cg6-27q7
- https://angular.dev/ecosystem/web-workers

Used for the licensed public token API, notice obligations, known affected
versions and worker integration. The bounded tree, inactive HTML/links/images,
draft lifecycle and presentation are independent designs. No external code or
visual assets were transcribed.


## Original incoming-link queue and platform transport

- [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)
- [Tauri single instance](https://v2.tauri.app/plugin/single-instance/)
- [Canonical plugin workspace](https://github.com/tauri-apps/plugins-workspace)
- [Tauri driver release history](https://v3.tauri.app/release/tauri-driver/)
  (`tauri:options.args` supplies separate application arguments)
- [D-Bus daemon configuration](https://dbus.freedesktop.org/doc/dbus-daemon.1.html)

Used for public SDK configuration/lifecycle and an isolated native acceptance bus.
The bounded FIFO, redaction, explicit acknowledgement, review UI and read policies
are original designs. No proprietary implementation or assets were inspected.


Linux scheme association uses the public
[Desktop Entry specification](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)
for `%U` argument expansion and MIME declarations. The project-owned desktop entry
advertises only `x-scheme-handler/git-khronos`; no proprietary scheme is registered.
The acceptance harness rebases this entry solely inside owned XDG fixtures and
uses GIO to test association routing without replacing host defaults.

## Independently configured tools: initial requirements

Sources inspected 2026-11-01:

- https://help.gitkraken.com/gitkraken-desktop/preferences/
- https://git-scm.com/docs/git-difftool
- https://git-scm.com/docs/git-mergetool

Used for neutral editor/terminal/agent/diff/merge capabilities, documented file
roles and process-result interpretation. The versioned profile, closed argument
placeholders and execution design are original. Only the profile/argument model
is introduced at this stage; no execution or complete integration is claimed.
No external implementation or assets were copied and no dependency was added.

## Working-file window-close review

- Tauri public window API: https://v2.tauri.app/reference/javascript/api/namespacewindow/
- Inspected 2026-11-01 for close-request prevention, listener ownership and the
  documented destruction permission. Used to design original draft review and
  asynchronous listener cleanup. No third-party implementation or assets copied.

## Owned X11 window-close acceptance

- ICCCM: https://xorg.freedesktop.org/releases/current/doc/xorg-docs/icccm/icccm.html
- Xlib API: https://xorg.freedesktop.org/archive/current/doc/libX11/libX11/libX11.html
- EWMH application properties: https://specifications.freedesktop.org/wm/latest/ar01s05.html

Inspected 2026-11-01 for standard WM_PROTOCOLS/WM_DELETE_WINDOW delivery, the Xlib
ABI and PID window binding. The original ctypes helper verifies the exact extracted
fixture executable and exactly one visible, regular PID-bound close-capable
window before sending a normal close request. XGetWindowAttributes and its public
ABI define visibility, InputOutput class and override-redirect handling; the target
is revalidated immediately before delivery. It does not destroy windows or terminate processes. No third-party
implementation, comments or assets were copied. libX11 is a host acceptance-tool
requirement, not a new bundled application dependency. Protocol constants and API
field names are used for the required standard interoperability.

## Owned X11 pointer acceptance

- X.Org libXtst releases: https://xorg.freedesktop.org/releases/individual/lib/
- The installed XTest public ABI header and Debian `libxtst6` copyright metadata.

The public XTEST calls were inspected locally for the original ctypes acceptance
helper. `libXtst` is a host test requirement, not a bundled application
dependency; its installed package identifies permissive X.Org licenses. The
helper limits injection to the harness-owned Xvfb display and checks the
extracted application's PID and visible X window before a right press. No
third-party implementation or assets were copied.

## Linux package cache completion

- Task up-to-date checks: https://taskfile.dev/docs/guide/up-to-date
- Inspected 2026-11-01 for declared source/output checks, per-task checksum scope
  and programmatic status checks. Used to design original target-specific build
  completion receipts after reproducing hard-kill and cross-target stale reuse.
  No upstream implementation copied; no new dependency introduced.

## Complete renderer acceptance partitions

- [Playwright sharding](https://playwright.dev/docs/test-sharding)

Used for the standard shard argument and complete-suite partition semantics.
CI runs four partitions serially with one worker and zero retries, retaining
separate artifacts and restarting the browser/server for each invocation.
Collection identities are checked locally for disjoint full coverage.
Partitioning does not alter assertions, individual test timeouts or application behavior; no
external code copied.

The aggregate checks-job budget is 120 minutes: the earlier unpartitioned CI
checks job took 87 minutes 27 seconds, leaving insufficient margin under its
90-minute budget for four fresh server startups and expanded acceptance.

## Deferred provider panel failure

- Angular deferred views: https://angular.dev/guide/templates/defer
- Angular deferred-load error: https://angular.dev/errors/NG0750
- Upstream retry discussion: https://github.com/angular/angular/issues/52800

Inspected 2026-11-01 after an owned failed-download browser regression showed
that recreating the deferred view cannot retry its failed dependency. The
GitLab panel reports the failure, preserves drafts, offers the existing manual
URL form and explains saving work before restarting. It does not reload the
application or promise an unsupported in-place retry. No source code copied.

## Linux native HTTPS runtime dependency

- Tauri Debian bundle dependencies: https://v2.tauri.app/reference/config/#debconfig
- Debian OpenSSL 3 package: https://packages.debian.org/en/bookworm/libs/libssl3
- Debian time64 package files: https://packages.debian.org/trixie/amd64/libssl3t64/filelist

Inspected 2026-11-01 for explicit runtime dependency declaration. The native HTTPS
transport links libssl.so.3 and libcrypto.so.3. Debian's libssl3 supplies both; the
local libssl3t64 package also declares a versioned libssl3 provision. The Deb
configuration now declares libssl3, and the GitLab packaged acceptance checks the
actual control dependency and ELF libraries before launching. No code copied or
system package modified. Other Linux distributions and platforms require their
own package qualification.

## Public provider workflow scope

- Public GitLab integration capabilities: https://help.gitkraken.com/gitkraken-desktop/gitlab-gitkraken-desktop/
- Public self-managed integration capabilities: https://help.gitkraken.com/gitkraken-desktop/gitlab-self-hosted/
- GitLab project API: https://docs.gitlab.com/api/projects/

Refreshed 2026-11-01 to keep the neutral parity scope broader than project
discovery: clone/remote, review-request and issue workflows remain requirements.
The documented project lookup and transport URL fields inform future independent
clone inspection. No competitor code, UI composition, assets or wording copied.

## GitLab fork workflow (in progress)

Sources inspected 2026-11-02:

- https://docs.gitlab.com/api/project_forks/
- https://docs.gitlab.com/api/namespaces/
- https://docs.gitlab.com/api/projects/
- https://docs.gitlab.com/api/project_import_export/

Used for public fork/namespace endpoints, stable identity and asynchronous import-state
requirements. Original projection, authority, recovery and fixture design is recorded
in [the candidate specification](../specifications/gitlab-fork-workflow.md). No proprietary
implementation, assets, UI composition or substantial documentation was copied. The
read/native/browser and namespace-preflight slices have local evidence. The closed
POST port and data-only record model also have local qualification. The Linux journal
is original project code using existing descriptor-relative storage techniques and
the existing rustix dependency. Its ten filesystem cases and expanded 27-case HTTPS
suite, including journal/transport composition, pass with strict workspace Clippy and
contract checks.
The complete creation/reconciliation/remote workflow is not implemented. The public create request fields and asynchronous outcome behavior
were refreshed on the same date for the original
[dispatch and recovery specification](../specifications/gitlab-fork-dispatch.md); that
specification now records both the implemented submission/recovery slice and the
remaining ancestry, branch-scope and remote-attachment requirements. Its current
qualification does not complete the broader workflow.

The projects API was refreshed on 2026-11-02 for its boolean `empty_repo` field.
The registered fork plan retains that explicit fact separately from the default
branch; absent/null metadata remains unknown. Its six cases are included in the
completed source gates. No external implementation or example code was copied.

## Saved GitLab fork reconciliation (2026-11-02)

Sources:

- https://docs.gitlab.com/api/projects/
- https://docs.gitlab.com/api/project_forks/
- https://docs.gitlab.com/user/reserved_names/

Used for the public single-project lookup by ID or encoded namespace/project path,
upstream/import metadata, and the distinction between display names and URL slugs.
The new read route encodes namespace separators once and admits documented slug
characters, with explicit rejection of traversal, nested percent encoding, query
and resource-route aliases. Known IDs retain priority over destination paths.
These protocol facts informed original requirements and fixtures. No vendor source,
assets, example implementation or substantial documentation was copied.

## Fork branch-scope requirements refresh (2026-11-02)

Sources:

- [GitLab project forks API](https://docs.gitlab.com/api/project_forks/)
- [GitLab fork workflow](https://docs.gitlab.com/user/project/repository/forking_workflow/)

The public API describes an optional string field `branches`, with an empty value
meaning all branches. The workflow documents both the complete repository branch
set and a default-branch-only option; the latter omits tags. These are requirements
for a future scope selector, with a fresh native review of the resolved default
branch. The pages reviewed do not establish a multi-branch expression grammar.
No comma, wildcard, pattern or regular-expression semantics have been assumed.
The present implementation still requests all branches; scope selection is not
claimed complete. Only functional documentation was consulted, without vendor
implementation, assets or copied interface wording.
