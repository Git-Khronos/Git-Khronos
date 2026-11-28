# Full Git feature parity: requirements and evidence

Objective: independently reach full non-AI Git feature parity with GitKraken
Desktop, prioritizing basic local Git and file workflows. A green subset of
tests, a capability name, or a browser handoff does not establish full parity.

The inventory below preserves the whole objective. It includes local Git,
hosted collaboration, workspace/account workflows, platform support, and
usability. Existing hosted collaboration is retained for reference but is
outside the current work; hosted file management is lower priority than local
basics. AI and coding-agent workflows are excluded. Product identity, protected
assets and private vendor implementation/protocols are not implementation
references. Equivalent capabilities must use public specifications and an
original Khronos design.

## Acceptance method

For each requirement, collect the public behavior reference, a neutral
input/action/outcome specification, implementation entry points, behavioral tests,
and current runtime evidence. Record commit, operating system and exact artifact
hash where applicable. Inspect actual coverage before accepting a passing test.

Status vocabulary:

- **Audit**: an implementation exists, but complete behavioral equivalence and
  current qualification have not been proven.
- **Partial**: a known capability gap remains.
- **Missing**: no dedicated implementation has been established.
- **Discovery**: public feature details still need inspection before specifying
  the complete acceptance cases.

No row is currently accepted as fully verified. Broad descriptions in the older
[capability overview](clean-room-capabilities.md) are implementation pointers,
not completion evidence. Each grouped row must be expanded into its constituent
behavioral cases during the audit; grouping does not remove any listed action.

## Current priorities

1. **Gitflow finishing:** feature, release and hotfix setup/start/finish exist.
   Branch workflows offers a separate rebase review for the checked-out
   feature before a fresh finish review; it is not an implicit finishing step.
   Setup retains existing branch tips, and successful feature cleanup permits
   reusing the topic name. Remaining failure/platform cases still need
   qualification. See the
   [Gitflow guide](https://help.gitkraken.com/gitkraken-desktop/git-flow/).
2. **Optional submodule automation:** clone can include submodules and explicit
   management exists. Opening a missing submodule now opens a scoped review;
   it does not initialize or contact its remote without confirmation.
   A single remote update is also reviewed, and the native command checks
   that the selected checkout is clean and conflict-free before fetching.
   The review can filter by path or name and show only entries that need
   attention, including checkouts with only untracked files.
   Automatic update preferences are intentionally not
   exposed: pull-triggered nested checkouts could surprise users or interact
   with local submodule state. See the
   [submodule guide](https://help.gitkraken.com/gitkraken-desktop/submodules/).
3. **Remaining workspace actions:** conversion of local groups to shared groups
   remains unimplemented. Bulk clone, fetch, pull and open report
   per-repository outcomes. Bulk close removes reviewed open tabs from this
   workspace without touching Git data or files. Saved but unopened paths
   remain in Repository overview with individual retry, locate and remove
   actions plus reviewed bulk removal. Locate replaces paths in place;
   selecting several prompts for one explicit replacement per path.
   **Check saved status** reads selected or all unopened saved paths, up to
   32 at a time, without opening a tab or fetching. Results are timestamped
   local observations; an unavailable path does not hide the other results.
   **Clone multiple repositories** reviews pasted Git sources and destination
   names before cloning them one at a time. Stopping does not undo completed
   checkouts. Provider-catalogue selection is still single-repository.
   **Share clone recipe** copies selected fetch URLs and suggested folder
   names for reuse in another workspace. It does not create an online group
   or synchronize workspace membership.

Repository files now has a flat, native-filtered view of tracked, untracked and
ignored files with bounded pages. Empty-file creation is currently limited to
root-level paths on Windows; it is refused on other platforms and in
subdirectories because the selected worktree and nested-repository boundaries
cannot be protected against concurrent replacement. Repository Files uses the
desktop's reported creation capability; unsupported builds keep browsing and
refresh available and direct users to their editor or file manager. On Windows
the form accepts a root filename, not a folder path. Supported files can be
opened. The file list reports whether untracked deletion with recovery is
available for each row. Linux top-level regular files can be reviewed; nested
and ignored files and symbolic links are not offered that action. A deletion
confirmation is valid only in the repository visit that opened it. Native
still checks the current file and requires a successful recovery capture.
Tracked-file deletion is disabled on
non-Windows platforms: a confirmed Linux race lets Git's pathname-based `git
rm` remove a file outside the worktree after concurrent parent replacement.
Windows still stages deletion only for clean committed files without index
flags that hide changes; it uses held parent handles, whose rename protection
is covered by native Windows tests. Linux discard uses held
worktree and recovery-directory descriptors and descriptor-relative renames.
The superseded Git `apply` implementation did not safely contain mutations
after parent replacement; it is not the fallback.

Git metadata and nested repositories are excluded; ignored files have read-only
previews and symbolic links cannot be opened. On Linux x86-64, guarded
whole-file discard and recovery cover nested regular untracked files and
regular index entries whose working file is regular or was deleted with its
parent still present. A bulk request with an unsupported nested path remains
blocked as a whole, with an eligible-file chooser for a fresh native preview.
Conflicts, gitlinks, and nested repositories remain non-blocking exclusions.
Nested partial discard, linked worktrees, and discard on other operating
systems remain unsupported. See the
[nested discard specification](specifications/nested-discard.md). If Git fails after tracked
deletion starts, the application reports that the file or index may already
have changed and refreshes the repository and file list rather than offering an
immediate retry. Similarly, a lost or unexpected discard response is treated as an uncertain
outcome: stale matching undo and diff state are cleared, the working tree is
refreshed, and the user is directed to review Recovery History before retrying.
Lost recovery or capture-removal responses also invalidate only undo entries
that might refer to the affected capture and warn that recovery state may have
changed. Definite pre-mutation refusals keep the existing undo entry. If an
ignore result is lost or unexpected, the original diff is invalidated and the
user is asked to refresh and inspect `.gitignore` and the index before retrying.
When the operation completes but snapshot refresh fails, the application reports
the completed operation rather than implying it was not applied. Extension and
directory rules may also ignore other matching untracked paths, but only the
selected tracked file is removed from the index. The confirmation explains that
scope; Unix filename backslashes are treated literally rather than as path
separators. Existing root ignore rules are opened without following a final
symbolic link or Windows reparse point, and Unix opens are nonblocking, so a
swap to a link or FIFO after the initial check is refused before untracking.
This does not qualify concurrent replacement of the worktree root or an
uncooperative writer replacing an existing ignore file during publication.
Creating a new root `.gitignore` is currently supported only on Linux, where
publication links the held staging file; other platforms refuse rather than
linking a mutable lock pathname. Paths that
cannot be inspected safely are reported instead of being
presented as a complete listing. Native Windows tests cover
guarded working-file previews, link and junction refusal, and concurrent writer
and rename protection; reparse-point files are refused. Windows in-app
working-file editing is still unsupported. The Linux tracked-deletion hazard
is contained by disabling tracked deletion on non-Windows platforms. A
disposable real-Git probe confirmed that a checked parent moved outside the
worktree and replaced by a symbolic link lets `git rm` remove an outside file.
A synchronized probe showed that a worktree-root Landlock rule does not stop
`unlinkat` through a pinned parent handle after that parent moves outside the
root. A worktree-only Landlock wrapper around `git rm` is also unsafe for linked worktrees:
Git removed the file before failing to publish its index in the external Git
directory. Another confined-rename probe moved a checked parent into `.git`
and successfully moved its file. The Windows ancestor-handle tests are focused
source-level checks, not qualification of the complete Windows application.

Discarded-change captures can be opened from Recovery History, including captures
created by untracked-file deletion. Their affected paths are read from the saved
patch so older captures remain identifiable. Path reports are bounded; the UI
warns when details are truncated or unavailable, and recovery still applies the
complete capture. For inspectable captures, apply and removal refuse a content
fingerprint that differs from the review, and toolbar undo/redo also retains
the original capture fingerprint. Git checks and applies the same private
snapshot. During discard and recovery, a second independently saved copy is kept
through the mutation; an interrupted or failed action can leave both copies in
Recovery History. Review the working tree before restoring either copy. This
requires temporary snapshot space and another full capture's worth of Git-directory
space; failure to create those copies stops the action before it changes files.
Later storage failures can occur after mutation and are reported accordingly. Linux
publication requires filesystem support for no-replace renames; other platforms
use hard links and remain runtime-unqualified.

Recovered-state markers are bound to their capture's fingerprint. Recovery
History warns and blocks replay when a marker and capture disagree or state
publication was interrupted. Older empty markers are explicitly identified as
unverified; after review, their capture is bound before it can be discarded
again. Binding cannot establish whether a legacy capture changed before that
review, and an interrupted mutation can leave state markers behind the working
tree. Inspect the files and retained captures before retrying.

A capture too large or otherwise unavailable for inspection has no review
fingerprint; the UI warns that later changes cannot be detected. Fingerprint
verification before capture removal, including cleanup of the extra copy, is not
atomic with pathname unlink. Concurrent replacements during that cleanup, or
simultaneous replacement of both copies, remain unqualified.

Selective stash restoration is also implemented: a reviewed individual file
can be applied while retaining the stash and index. Conflict, stale-state and
path-boundary refusals are covered by native and renderer tests.

Force-push leases now pin both the reviewed remote-tracking object ID and local
commit ID; a later background fetch cannot silently change the expected lease.
This closes a safety defect, not a GitKraken parity gap. The
[Git push documentation](https://git-scm.com/docs/git-push) describes why
implicit leases are unsafe with background fetches. Core staging, commits,
branches, history, merge/rebase, worktrees, submodules, LFS, diff and recovery
already have implementations; each **Audit** row below still requires
case-by-case verification. Existing hosted collaboration remains available but
is outside the current work.

## Local Git and repository interaction

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| G01 | Open, initialize and clone repositories; handle empty, bare, detached, shallow, large and nested repositories | Audit repository lifecycle and packaged fixtures across each state |
| G02 | Manage recent/favorite repositories, aliases, tab sets, reopen/close/reorder tabs | Audit persistence, keyboard navigation and stale-session handling |
| G03 | Display commits, parents, merges, refs, tags, authors, dates, HEAD and worktree state in history | Audit graph topology, every reference type, paging and large-history navigation |
| G04 | Filter/search loaded and full history by message, author, SHA, date, path and branch/ref scope | Audit full-history search, pagination and zero/many matches; discover remaining documented filters |
| G05 | Hide/solo/filter refs and remotes; collapse reference groups and preserve these view choices | Audit combinations and inheritance into new worktrees |
| G06 | Stage/unstage whole files, hunks and lines; represent renames, modes, binaries, new/deleted files and submodules | Installed working-tree acceptance compares whole-file rename, executable mode, binary blob and submodule gitlink stage/unstage operations against Git index entries and checks that the working contents stay intact. Additional partial-stage combinations and other platforms remain |
| G07 | Browse, create, delete and ignore files/patterns, edit tracked files, invoke configured editors and diff/merge tools | Partial: Repository files filters the full Git-visible path set in bounded pages; creates empty files only at the worktree root on Windows; opens supported files; disables tracked deletion on non-Windows platforms after a confirmed Linux parent-replacement race; and uses capture-backed, descriptor-relative discard on Linux. Whole-file discard and recovery now cover ordinary nested tracked files on Linux x86-64 when the index contains a regular file and the working file is regular or was deleted with its parent still present. A bulk review remains blocked if it includes unsupported nested paths, but eligible files can be selected for a fresh native preview. Conflicts, gitlinks, and nested repositories remain non-blocking exclusions. Regular nested untracked files are eligible for capture-backed whole-file discard. Nested symlinks, nested hunk or line discard, other operating systems, and linked worktrees are not supported. Core tests verify index preservation, recovery, and confinement when an opened parent moves outside the worktree. Extracted Debian acceptance on WSL2 passed single-file and bulk nested discard and Undo with the updated chooser, and passed discard, Undo and Redo for a nested deletion. See the [nested discard specification](specifications/nested-discard.md). Ignored previews are read-only; symbolic links and Windows reparse points cannot be opened; nested repositories/Git metadata are excluded. Windows in-app editing is unsupported. Extension and directory ignore scope has focused real-Git coverage; new root `.gitignore` creation is refused outside Linux; broader ignore-rule and Windows packaged UI qualification remain open. The Debian candidate associated with `4438e93d` predates these changes and does not qualify them. See the [recovery specification](specifications/editor-draft-recovery.md) and [external tool specification](specifications/external-file-tools.md) |
| G08 | Compare revisions, contiguous commit selections and working trees; offer hunk/inline/split views, word changes, syntax colors, overview navigation, wrapping, whitespace and image/binary handling | Named revision comparison is available directly from the command palette or with the selected commit prefilled. The picker accepts local branches, remote-tracking refs, tags, and typed commit expressions without checkout. Earlier Linux checkpoint: bounded byte/image previews and direct content entry passed 1362 renderer cases and 377 native executions on `47e83c15899a`. SVG/local LFS previews, broader behavior and other platforms remain open; see the [specification](specifications/non-text-diffs.md) |
| G09 | Navigate file history/blame through renames and parent revisions; copy/reveal/open paths | Partial: the packaged `native-file-history` target proves history follows a file rename without including a neighboring-only commit; covers bounded/history-page reads, control-character and UTF-16 metadata, exact literal paths, cancellation/timeout behavior, and blame navigation through a 100,000-line file while controls stay responsive; safely opens the removal diff for an exact deleted path; and tests tracked-file palette search during a real merge conflict without changing its index or files. Per-entry Copy path preserves the exact UTF-8 path, and rename rows expose a separate copy action for the previous path. Renderer coverage exercises spaces, non-ASCII text, success/failure announcements and unchanged Git state. The short hash in File History copies the full commit ID; targeted renderer and installed Linux tests confirm the copy action does not mutate Git. Reveal/open and additional parent/revision navigation cases remain |
| G10 | Create/amend commits, fixup commits, templates, coauthors, sign-off, empty commits and identity/author options | Audit exact commit metadata, hooks, templates and failure paths; fixup creation now uses staged changes and a captured target/HEAD review |
| G11 | Sign commits/tags and diagnose effective signing configuration | Partial: packaged Linux UI acceptance explicitly signs commits with OpenPGP, SSH, and X.509, and annotated tags with each format through the tag form. Git verifies each artifact, and the tag suite confirms signing does not change HEAD, index, or worktree (`desktop:native-signed-commit`, `desktop:native-signed-tag`). Packaged Preferences verifies the advisory SSH signer diagnostic, and an unavailable SSH key leaves the commit draft, refs, config and staged files intact. Other diagnostics and failure paths remain to audit |
| G12 | Create, rename, delete, checkout and publish branches, remote branches and detached commits | Partial: the published Linux 0.1.7 archive (source `53f39a6`, SHA-256 `6331e0e4dbd33a6f145f31b97a6ae5ac037ae872535e078c94427020c03215b4`) passed the extracted `worktrees` and `worktree-reservation` suites on WSL2 (33 + 1 scenarios). A real graph double-click on occupied `dev` navigated from the linked checkout to the primary checkout. The suites also verify unchanged dirty files, index and refs in both checkouts, refusal when ownership changes during review, and separate guidance for a branch reserved by a detached rebase. Other branch actions, platform cases and destructive preconditions remain to audit |
| G13 | Fetch/pull/push scoped or all refs; configure remotes/upstreams, publish branches, force with lease, auto-fetch and cancel operations | Partial: force push pins the reviewed remote-tracking and local commit object IDs. Packaged Fetch All updated two owned remotes without pruning or touching the checkout. A real-Git partial failure verifies that one remote can advance while the other fails; the Chromium and WebKit tests verify that the error remains visible after refreshing the remote refs. Broader authentication, conflict, remote topology, and environment isolation cases remain |
| G14 | Merge, fast-forward, rebase and preview conflicts; continue/abort/skip where applicable | Audit topology, dirty-state handling, strategy options and preview/actual outcome equivalence |
| G15 | Interactive rebase: reorder, squash/fixup, edit/split, drop and preserve merges/root/selected ranges | Audit every edit instruction and recovery state against Git behavior |
| G16 | Cherry-pick/revert individual or selected commits, including merge-parent selection and conflicts | Audit sequencing, ranges, no-commit options and abort/recovery |
| G17 | Reset/reflog/undo/redo/discard recovery with clear destructive scope | Partial: Linux uses descriptor-relative discard; guarded whole-file operations on Linux x86-64 also cover ordinary nested tracked and untracked files. Packaged checks cover stale refusal, a nested deletion with Undo/Redo, and CTI-sized nested untracked recovery after restart without changing the index or HEAD. Unsupported nested paths block bulk preview; conflicts, gitlinks, and nested repositories are non-blocking exclusions. Nested partial discard, linked worktrees and other platforms remain unsupported. See [nested discard](specifications/nested-discard.md) and [package evidence](linux-acceptance.md) |
| G18 | Stash full/selected work, stage/index options, names, apply/pop/drop/clear and branch from stash | Partial: selected saves keep their file list aligned with the current stash mode; ineligible explicit paths are refused before mutation. Whole-checkout saves use complete status counts without retaining path records, and skip untracked discovery unless requested. Applying one reviewed stashed file preserves the stash and index. Clear-all now reviews the exact complete stash stack, saves every stash object in Recovery History before removal, rejects stale reviews, and is covered by the packaged full-native suite. Audit remaining index/worktree/untracked combinations and stale stash preconditions |
| G19 | Create, inspect, delete, rename, move and transfer lightweight/annotated/signed tags; navigate to their commits or branch from them | Partial: packaged UI coverage creates lightweight tags and annotated tags signed with OpenPGP, SSH, and X.509. Tests verify the signatures and exact targets, including missing-key refusal and explicit retry without losing the reviewed tag or dirty checkout. The focused `native-tag-preview` suite verifies tag-click navigation to the peeled commit and branch creation/switch at that exact tag target. The `remote-reviews` packaged suite checks tag push, checked remote-object rename, remote deletion, local recovery on tag deletion, and unchanged dirty checkout. Broader platform, failure, and remote-ref race cases remain to audit |
| G20 | Detect/resolve text, binary, rename/delete and submodule conflicts; configure external merge resolution | Partial: core coverage includes text output, side selection, missing-side deletion, binary refusal and gitlink handling. The installed packaged `native-conflict-navigation` scenario opens the real Merge Tool for seven simultaneous conflicts and verifies Incoming/Current sides, edited text, binary, modify/delete, rename/modify destination handling and submodule gitlink resolution without changing the nested checkout. `native-file-tools` additionally verifies the configured external merge program receives exact base/current/incoming private copies, binary output is reviewed before saving, staging remains a separate reviewed action, and private files are cleaned up. Other platform/tool combinations remain |
| G21 | Add/init/update/sync/remove nested submodules and inspect their changes/history | Partial: explicit management and optional recursive clone exist. Automatic updates remain opt-in functionality deferred to avoid background nested-checkout mutations. Audit nested, dirty, missing, detached and conflicted submodules |
| G22 | Initialize/use Git LFS, track/untrack, transfer/prune objects, and manage locks | Partial: focused package acceptance now exercises create/unlock, dirty-file refusal, canceling a collaborator force-unlock review and explicit force-unlock against a local locking-protocol fixture. Source tests validate 34 LFS core cases and seven authenticated transport cases. Real hosted HTTPS/SSH LFS object transfer, hosted lock-provider behavior, additional providers and other platforms remain |
| G23 | Create/open/lock/move/repair/remove worktrees and branches safely | Partial: linked-worktree snapshots expose Git's lock reason, and the lock review accepts an optional reason. Focused Chromium and WebKit renderer checks cover locking, reason display, unlock, cancel and Escape without mutation. Packaged occupancy, shared-configuration, ignored/untracked collision and recovery cases remain to audit |
| G24 | Configure and run feature/release/hotfix workflows, including finishing into the appropriate branches and tagging releases | Partial desktop: reviewed setup/start/finish and saved conflict recovery have source, renderer and Linux-package evidence. Existing branch tips are retained during setup, and a successfully finished feature topic can be recreated with the same name. Branch workflows offers a fixed-pair rebase review for the checked-out feature before a fresh Finish plan; the focused installed Ubuntu 24.04 check passed on the package built at `9d49a65`. More signing/platform/failure cases remain open. The [independent specification](specifications/branch-workflows.md) records transitions, recovery and remaining gates |
| G25 | Respect Git hooks, expose hook errors/output and explicit hook-control options | Audit actual hook processes and refusal/recovery behavior |
| G26 | Import/export patches, mail series and bundles; inspect and recover failed imports | A committed comparison can be saved as a Git patch using its resolved endpoints, including binary changes. Full and incremental one-branch bundle export; the incremental range requires a reviewed ancestor OID already available to the recipient. Import preserves the chosen tip under a new recovery ref. One selected commit can also be exported as a source ZIP without history. Audit format interoperability, additional export scopes and platforms |
| G27 | Maintain repository integrity and offer actionable diagnostics without silently losing data | The exact Debian package's focused UI suite reports a damaged loose object, verifies HEAD/index/config/worktree preservation, and proves reviewed maintenance refuses to run without creating metadata or repairing the corruption. It also runs reviewed maintenance on a healthy repository, then verifies the checkout, refs, index, config and an unreachable object are preserved while commit-graph and packed-ref metadata are created. A held real-Git fsck process can be cancelled from the UI without presenting a partial result or mutating repository state. Broader filesystem failures and platform coverage remain |
| G28 | Open and generate repository/branch/commit/tag links; select among local copies and offer a prefilled clone when none exists | Candidate: original URI, local-copy review, fetch-free opening, sharing and clone review pass 391 packaged native executions. The original OS inbox also passes 403 exact-package Linux executions for cold process argv and warm GIO routing. The complete 1394-case renderer gate passes. Cold launcher association and other platforms remain open; see the [independent specification](specifications/repository-links.md) |
| G29 | Edit current working files with visible unsaved state, explicit save/discard and save-and-stage versus stage-saved choices; preview Markdown and handle declared encodings accurately | Linux checkpoint: bounded lossless editing, separate save/stage choices, inert Markdown and normal window-close review pass all 1424 renderer cases and 213 normal / 214 inherited-environment native scenarios on exact combined package `ecbdad48a0f7`. Persistent draft recovery and broader codec/platform support remain open. See the [independent editor specification](specifications/working-file-editor.md) |

### Current source-tree audit

On 2026-11-22, the current local source tree built and package verification
passed for Debian artifact SHA-256
`4782ab3ce8358067102e931757c960a276022b66daa6d75141336604218ed21e`
(embedded executable `8ad82434297dbe4c29b8753c178c076cb47dfc1db6876a891fc6e0ca81db07d5`).
That exact package passed all 301 full native scenarios and the focused
three-scenario autosquash/amend UI suite on Ubuntu 26.04/WSL2 with Git 2.53.0,
plus the one-scenario explicit empty-commit UI acceptance, including the hook
execution and unstaged-work preservation checks.
including occupied-branch graph navigation, setup keyboard flows,
full-toolkit and Linux desktop-protocol scenarios. The package build verifier
and APT installation dry-run also pass; dry-run resolves as an upgrade of the
locally installed 0.1.6 package, but no system installation was performed.
The source `desktop:test` and `desktop:check` targets also pass. Earlier package
`e112a8834314ffb4e0d5403a257db07a2446c8478751ca5bf2e5836240f6e4de` separately
passed inherited-Git-environment and large-history performance acceptance (20k
and 100k commits, 64 branches, 36 linked worktrees); those results do not qualify
the current artifact. These are local extracted-package results, not
system-installed, remote-CI, Windows or macOS qualification. This does not
replace the remaining platform and release gates below. Current package reports:
`test-results/native/full-1795384518876469961/report.json` and
`test-results/native/autosquash-amend-1795385216367890792/report.json`, and
`test-results/native/empty-commit-1795385442709888426/report.json` and
`test-results/native/merge-preview-1795385939648620351/report.json`. Earlier
package `e112a8834314ffb4e0d5403a257db07a2446c8478751ca5bf2e5836240f6e4de`
reports are `test-results/native/full-1795374655432009623/report.json` and
`test-results/native/environment-1795375005031103816/report.json`.

An earlier source-tree checkpoint concerned commit `10c2866`. Debian candidate
`1b3c8b5274a25c56e5b52c6ff02bcc7780c209e8875b4be0beb705ef7eb4b180`
passed package verification and the complete headless native suite: 228
scenarios passed, including real checkpoint deletion, stale-review refusal,
editor/file-tool workflows, and eight owned-window XTEST right clicks. A new
package built from that source
`1ce7f469980c33600572f8fec7e628a180e8184cfc750d5f59e28f6847befa46`
passes Debian package verification and the complete headless native suite:
229 scenarios passed, including eight owned-window XTEST right clicks. The
report confirms the same package SHA-256. A later test-only Clippy correction
changes a package receipt input without changing production code. The later
package built from `c3b245da`, SHA-256
`93ccae5de955fe83f9d343923951fcc5275a93a16801b31f4259d50faf052819`,
also passed package verification and all 229 headless native scenarios,
including eight owned-window XTEST clicks; it predates the subsequent
ignore-file open hardening. The later
[GitHub run](https://github.com/Git-Khronos/Git-Khronos/actions/runs/42495995748)
at `f7bf456` passed Windows and renderer checks but failed packaged acceptance
when the checkpoint action was not yet visible to the test. The harness now
waits for that positioned control before clicking; the corrected run still
requires remote qualification. Chromium passed
1,830 cases across two shards without retries. The first shard preceded the final patch-review
invalidation change; its complete owning spec passed afterward, so these
shards are not a single exact-final-source full run. The latest whole Git-core
run passed 979 normally enabled tests and all 37 ignored tests. The 41-case
workspace-center renderer suite passed, as did the reported 345-case renderer
regression run. Earlier file-content, repository-file and WebKit
file/editor/workspace suites remain representative rather than complete
acceptance. The table records exercised cases, not complete feature
acceptance. On 2026-11-08, the [Windows Actions job](https://github.com/Git-Khronos/Git-Khronos/actions/runs/42483208903/job/128739419954)
at commit `10c2866` passed 13 repository-file tests and seven file-content
tests on `windows-latest`. These include held-parent rename refusal, tracked
deletion preconditions, links and junctions, bounded previews and live-writer
refusal; they do not qualify the complete Windows application. A Linux probe
confirmed outside-worktree tracked deletion through parent replacement;
tracked deletion is now disabled outside Windows. A new Linux regression
confirms reverse-apply refuses an untracked parent swapped before Git starts,
but the later in-Git unlink probe described above confirms a remaining race.
The same Actions run failed its Linux strict Clippy step on that regression's
assertion; the subsequent test-only correction is verified locally.

The later Debian candidate associated with commit
`4438e93d15c18a18f6f6b5a7a6b3dd4df0857f96` has SHA-256
`a43736a8008bb57ddee6351361009e4e9a83797c2cf3309172341592337a516a`.
Its retained full native report records `passed: true`, 229 distinct scenario
names and eight owned-window XTEST pointer deliveries on
`Linux-7.0.0-42-generic-x86_64-with-glibc2.43` with Git 2.53.0; it did not
use the inherited-Git-environment suite. The retained report is
`files/native-4438e93d/full-1794158458131433925/report.json` in the session
artifacts. Independent hashes of the `.deb` and its embedded executable
`3f4d5a293f4ea7f117c9a992a6bb37aa0d76043ca9e1c1ecb08ab6ad9191f1a9`
match the report. The completed build receipt also matches the package digest
and records a source-input checksum, but neither it nor the report embeds the
Git commit ID; commit attribution comes from the session build checkpoint.
These results do not qualify later source changes, installation, other platforms,
or the later Linux descriptor-guarded discard implementation.

A read-only snapshot at approximately 17:54 UTC on 2026-11-08 of
[GitHub run 42504326903](https://github.com/Git-Khronos/Git-Khronos/actions/runs/42504326903)
showed that it targeted `4438e93d`: its focused Windows source-test job and
Linux source-verification step had passed, renderer acceptance was running, and
the dependent packaged-native job had not yet appeared. The overall run had
no conclusion at that snapshot. At that commit the Windows ignore selectors
shared one PowerShell step, whose success alone does not prove each selector
passed. The workflow cancels an earlier run on the same ref, so a subsequent
run must wait until this one finishes.

| ID | Exercised cases | Remaining qualification or known gap |
| --- | --- | --- |
| G01 | Initialization, clone options, empty and detached HEADs, bare repositories and shallow boundaries | Network failures and the complete large/nested repository matrix |
| G02 | Workspace selection, canonical bulk open, failures and stale workspace replies | Full persisted tab-set, alias and keyboard lifecycle across platforms |
| G03 | Incremental history, shallow boundaries and exact checkpoint references | The current exact package passes repository-open responsiveness with 20k and 100k commits, 64 branches and 36 linked worktrees (under 0.5 s open, under 140 ms maximum heartbeat gap, 57 max rendered rows). Every graph/ref topology, detailed large-history navigation and other platforms remain |
| G04 | Full-history search filters, pagination, literal paths and renamed history | Every UI filter combination and large-repository performance |
| G05 | Reference-type filtering, remote hide/solo and checkpoint visibility with a similarly named hidden branch | Other hidden/solo combinations and persisted worktree preferences |
| G06 | File, hunk and line staging/unstaging, new files, sparse paths and literal names; packaged whole-file UI coverage for renames, binary files, executable-bit changes and gitlinks | Partial-stage edge cases and the corresponding behavior on non-Linux platforms |
| G07 | Paged file search, platform-limited creation, tracked-deletion refusal on Linux, capture-backed untracked deletion and ignored read-only previews; native Windows tests for tracked deletion, parent handles and bounded previews | The current local Debian package passes the full extracted-package suite; source tests include root-entry replacement at the Linux descriptor-relative discard mutation boundary. Tracked deletion remains disabled on non-Windows platforms after the confirmed Linux parent-replacement hazard. Creation is limited to Windows root-level files, and new `.gitignore` creation to Linux. The earlier in-Git unlink probe confirmed outside-file deletion in the superseded Git-based discard path. Core and extracted-package coverage prove whole-file nested modification discard and Undo while preserving staging. Core and extracted-package coverage also prove discard, Undo and Redo for a nested deletion with an intact parent. Nested partial discard and other operating systems remain unsupported. System-installed and full Windows UI qualification remain open; Windows editing is unsupported |
| G08 | Revision/index/worktree byte comparisons, absent content, links, binary previews and external-tool snapshots | All visual diff modes, SVG/LFS preview cases and other platforms |
| G09 | File history, bounded blame, literal paths, rename-aware paging, exact deleted-path lookup and an explicit local branch/tag/commit starting point | Packaged UI proves exact deleted-path discovery and removal diff, plus history start/reset using a local tag, slash-containing local branch, and full commit ID; parent/revision combinations and other platforms remain |
| G10 | Commit identity, amend, sign-off, empty-commit policy, templates and hook refusals | Packaged UI verifies that an intentional empty commit requires the explicit policy, preserves the unchanged tree and unstaged work, and still runs pre-commit hooks. A separate UI journey verifies an amended commit's prior HEAD and staged tree appear in Recovery History and can be restored on a new branch. Core tests cover message-only amend recovery and retire the temporary capture after a hook refusal that leaves repository state unchanged. Complete metadata and hook combinations remain |
| G11 | Real OpenPGP commit/tag, SSH-tag and X.509-tag signing round trips | The current exact package passes OpenPGP signed-commit and signed-tag UI acceptance; SSH and X.509 signed tags pass packaged native IPC acceptance. Other commit-signing formats and platform-specific signer configurations remain |
| G12 | Branch creation, rename, delete, tracking and occupied-worktree refusals | All detached/remote publishing and destructive precondition combinations |
| G13 | Exact one-branch or all-branch fetch, pull strategies, cancellation and pinned force-push leases | Installed single-branch fetch, live authentication, every remote topology and partial network outcomes |
| G14 | Read-only merge previews, fast-forward, conflicts and pull merge/rebase strategies | Packaged merge-preview acceptance covers clean fast-forward and clean disjoint merge-commit previews, matching both actual Git outcomes; the conflict case depends on nested committed attributes and preserves dirty files, the index, and refs. Pull merge/rebase strategy combinations and the full preview-versus-outcome/recovery matrix remain |
| G15 | Rebase edit, fixup, fixup-with-message autosquash, split, merge-preserving review and stale-state refusals | The current package passes the autosquash-amend UI journey including replacement message/tree verification. Every instruction, root/merge topology and recovery combination remains |
| G16 | Ordered revert, cherry-pick/revert mainline selection, no-commit replay and conflict recovery | Full renderer and platform coverage for multi-step failures |
| G17 | Reset/reflog/undo/redo/discard recovery with clear destructive scope | Partial: Linux uses descriptor-relative discard; guarded whole-file operations on Linux x86-64 also cover ordinary nested tracked and untracked files. Packaged checks cover stale refusal, a nested deletion with Undo/Redo, and CTI-sized nested untracked recovery after restart without changing the index or HEAD. Unsupported nested paths block bulk preview; conflicts, gitlinks, and nested repositories are non-blocking exclusions. Nested partial discard, linked worktrees and other platforms remain unsupported. See [nested discard](specifications/nested-discard.md) and [package evidence](linux-acceptance.md) |
| G18 | Selected stash creation, individual-file restoration, stale-state refusals, clear-all review and recovery preservation | Exact stash-stack review, cancel/stale-review refusals and full-stack recovery preservation pass the current packaged `native-stash-clear` target. All untracked, staged, rename and pop/branch combinations remain |
| G19 | Lightweight/annotated tag creation, exact names and selected remote transfer/deletion leases | Signed-tag creation and peeled-target navigation pass on the current package; all remote/peeled-target combinations remain |
| G20 | Text/binary/rename previews, gitlink selection, reviewed external merge output and packaged Merge Tool Incoming/Current/edited-output, binary, modify/delete, rename/modify and submodule resolution | Other platform/tool combinations |
| G21 | Recursive clone, explicit submodule inspection, sync, removal and dirty/conflicted refusals | Automatic updates are deliberately deferred; nested edge cases remain |
| G22 | Real LFS tracking, selective fetch/checkout, prune and lock scenarios | The current package passes a real-dialog lock/create/unlock/force-unlock journey against a local protocol fixture; source tests pass 34 core and seven transport LFS cases, and the full package covers tracking, selective fetch/checkout, prune and lock listing. Hosted transfer/lock services, installed-client diversity and other platforms remain |
| G23 | Worktree move, repair, registration, locks and occupied/dirty refusals | Complete shared-configuration, collision and platform matrix |
| G24 | Feature/release/hotfix setup and finish, conflicts, recovery and stale reviews | Focused installed Ubuntu 24.04 feature rebase passed; more signing and platform cases |
| G25 | Commit and replay hook execution, refusal, cancellation and explicit hook policy | Unix real-Git tests verify refusal preserves staged work and HEAD until explicit bypass. The packaged UI names the exact hooks, announces a conditional warning that other hooks still run and side effects are not rolled back, and retains refusal/retry state. Existing fixtures cover prepare-commit-msg and commit-msg behavior; broader hook types and replay-output presentation remain |
| G26 | Patch, mail-series and bundle round trips, limits, conflicts and recovery | Broader external format interoperability and other platforms |
| G27 | Integrity checks, corruption reporting, cancellation and non-pruning maintenance | Exact-package UI acceptance covers a real corrupt loose object, retained Git diagnostics, unchanged HEAD/index/config/worktree and safe refusal of reviewed maintenance with no repair or metadata writes; healthy maintenance creates commit-graph/packed-ref metadata while preserving checkout, refs, index, config and unreachable objects; a held fsck is cancellable without partial-result claims or repository mutations. Broader filesystem/error edge cases and platforms remain |
| G28 | Bare/linked root inspection, original links and fetch-free reference inspection | New package qualification, cold launcher association and other platforms |
| G29 | Bounded working-file reads/writes, encodings, save/stage separation and draft recovery store; focused Windows preview tests | Windows working-file editing is unsupported; broader encodings and full restart/platform qualification remain open |

## Hosted Git collaboration

Each applicable behavior must be audited for GitHub, GitLab, Bitbucket and Azure
DevOps, including their supported enterprise/self-hosted variants. Provider
capability differences must come from public documentation rather than guessed
API equivalence. A browser fallback remains a useful option, not evidence of an
implemented in-app capability.

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| H01 | Authenticate/select provider accounts and enterprise endpoints without leaking credentials across contexts | Partial: GitHub uses the selected `gh` account; GitLab has explicit HTTPS-instance-bound, in-memory account sessions with verified reads and separate Git credentials. OAuth/persistent login, subfolder instances and complete provider coverage remain open. See the [GitLab specification](specifications/gitlab-projects.md) |
| H02 | Discover/list/clone repositories; detect or create a fork and attach its reviewed SSH/HTTPS remote using the selected provider/account | Partial: GitHub discovery, reviewed HTTPS/SSH cloning, fork creation/reconciliation and reviewed remote attachment have controlled-provider and real-Git Linux package evidence. GitLab account-bound discovery and reviewed cloning now have complete renderer/native Linux qualification, including actual HTTPS Git transfer with separate credentials and a pinned-host SSH clone. GitLab reviewed fork submission, private saved outcomes and read-only reconciliation have focused source/renderer and 37-scenario Linux package evidence; the new `native-gitlab-fork-ui` target passes 25 extracted-package scenarios, including repeated catalogue entry after process restart, without requiring local `sshd`; its integrated HTTPS/SSH suite still requires separate qualification. Its full 220 and inherited-environment 221 native scenarios also pass, and the complete 1,519-case renderer qualification passes without retries or skips. GitLab fork ancestry, branch scopes, reviewed remote attachment and other providers remain open. The qualified renderer set preserves all earlier 1,484 case identities and adds 35 GitLab cases; the isolated date-test clock correction is recorded in the fork specification. Scenario counts measure test coverage, not capabilities. Catalogue identity does not replace Git transport credentials. See the [hosted repository](specifications/hosted-repositories.md), [GitLab discovery](specifications/gitlab-projects.md), [GitLab clone](specifications/gitlab-reviewed-clone.md) and [GitLab fork](specifications/gitlab-fork-dispatch.md) specifications |
| H03 | List/filter/search/sort/page open, closed, merged and draft review requests; support applicable text, people, branch, review, CI, metadata and date filters with combination/exclusion semantics | Partial: GitHub page/state controls implemented; full provider/search coverage remains |
| H04 | Create PRs/MRs with pushed source/base refs, forks, descriptions/templates, draft state and reviewer metadata | Partial: reviewed GitHub creation/forks/drafts implemented; templates, reviewer metadata and other providers remain |
| H05 | Inspect descriptions, revisions, changed files/patches, binary limits and commits | Partial: GitHub paged text inspection exists; complete metadata/binary/commit and provider coverage remains |
| H06 | Display current review decisions, review history, check runs and legacy commit statuses, tied to exact commits | Partial: GitHub decision/status coverage implemented; live account and other-provider qualification remain |
| H07 | Add comments, inline review threads, approvals/change requests, resolve threads and apply/post code suggestions | Partial: GitHub review-level comments/approvals/change requests implemented; inline threads, suggestions and other providers remain |
| H08 | Merge/squash/rebase a PR/MR, respect branch protections and expected head; close/reopen/delete source branches explicitly | Partial: reviewed GitHub merge/squash/rebase and uncertain-outcome protection implemented; close/reopen, branch cleanup and other providers remain |
| H09 | Work with stacked review requests and their branch/dependency relationships where supported | Discovery and implementation required; generic branch graphs are not proof |
| H10 | Filter/list/inspect/create/edit/link provider issues, create branches from issues and preserve issue context | Partial: GitHub issue listing only; writes and branch linkage missing |
| H11 | Integrate the documented Jira/Trello and provider issue-tracker workflows | Missing dedicated tracker adapters and account configuration |
| H12 | Inspect CI/workflow status and actionable logs/artifacts for current review/repository context | Partial: GitHub run list and browser links exist; details/log/artifact workflow requires implementation |
| H13 | Diagnose access, SSO, certificate, authentication, rate-limit and transient network failures | Partial: generic diagnostics and uncertain-write protection exist; provider-specific recovery and live qualification remain |

## Workspaces, identities and external tools

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| W01 | Persist and switch workspace repository sets, including shared/remote workspace capabilities documented by the reference product | Partial: local sets only; shared workspace equivalent needs specification and implementation |
| W02 | Show multi-repository changes, divergence, active operations, review/CI/issue context and actionable overview filters | Partial: open-local-repository overview and on-demand unopened local status; hosted aggregation missing |
| W03 | Save/switch identities, accounts, preferences and tab sets; explicitly choose local/global identity sync without silent Git or credential changes | Partial: named commit identity templates only |
| W04 | Provide local and shared team/repository collaboration views and discovery | Discovery and implementation required |
| W05 | Configure terminal/editor/diff/merge programs, repository setup commands and defaults | Partial: terminal profiles retain explicit launch and defaults; the former dedicated agent launcher was removed. The [external file-tool candidate](specifications/external-file-tools.md) supports reviewed editor/comparison/merge launches and separate merge save/stage/cleanup. Earlier Linux package evidence predates this removal; restart storage management and reviewed setup workflows remain open. See the [independent tool specification](specifications/configured-tools.md) |
| W11 | Select workspace repositories for bulk clone/fetch/pull/open/locate/remove, with individual outcomes; convert local groups to shared groups explicitly | Partial: clone from pasted Git sources or a portable clone recipe, fetch, pull, open, locate, reviewed close of open tabs and reviewed removal of unopened saved paths have per-item outcomes. Bulk locate opens one folder chooser per path; it does not guess mappings. Catalogue bulk selection and hosted shared-group conversion remain missing |

## UX, platform and delivery requirements

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| U01 | Provide keyboard-driven command discovery, configurable shortcuts and equivalent Git actions from appropriate contexts | Audit current palette/context menus; shortcut configurability needs discovery |
| U02 | Support documented drag/drop Git workflows with equivalent explicit previews and keyboard alternatives | Audit graph drag operations; enumerate any missing actions |
| U03 | Preserve original identity while supporting themes, scaling, compact layouts, accessibility and large data | Audit all layouts and platforms; fallback-font layout and rapid rebase input fixes passed 1251 local renderer cases and 306 native scenario executions on package `05c1a4c1cd85`; remote verification remains pending |
| U04 | Persist preferences/drafts/view state and restore context across restarts without replaying mutations | Partial: Linux editor draft recovery survives owned crash/relaunch, with inert review and explicit load/save/discard on the final package. Preferences, multiple workspaces and broader session restoration still require audit |
| U05 | Provide native Linux, Windows and macOS behavior plus documented Windows/WSL interoperability | The locally rebuilt Debian candidate passed both full extracted-package and system-installed headless native acceptance on Ubuntu 26.04, including the installed executable and desktop entry. Pinned-shortcut/hardware-key host checks and complete Windows/macOS/WSL application qualification remain open; Windows in-app working-file editing is unsupported |
| U06 | Package/install/update/uninstall with accurate licenses, notices and dependency provenance | Audit current package bytes, supported formats and platforms |
| U07 | Verify local Git outputs, native IPC/PTY behavior, full renderer suite and exact distributable artifacts | Current local Debian artifact `4782ab3ce8358067102e931757c960a276022b66daa6d75141336604218ed21e` passes all 301 full extracted-package native scenarios (`test-results/native/full-1795384518876469961/report.json`), the 3-scenario autosquash/amend UI suite (`test-results/native/autosquash-amend-1795385216367890792/report.json`), the focused empty-commit UI suite (`test-results/native/empty-commit-1795385442709888426/report.json`) and focused merge-preview suite (`test-results/native/merge-preview-1795385939648620351/report.json`) on Ubuntu 26.04. Local `desktop:test`, `desktop:check`, `git diff --check` and `cargo fmt --check` pass. Earlier candidate reports remain tied to their respective package hashes. The Debian package verifier passed; the package has not been system-installed. System-installed performance, focused GitLab fork/integrity qualification on this exact package, integrated HTTPS/SSH GitLab clone/catalogue qualification, remote CI, final integrated source and other platforms remain unverified |
| U08 | Handle cancellation, stale state, partial results and uncertain remote writes without reporting false success | Audit every new operation; extend failure fixtures with each implementation |

### Remaining platform and release gates

- **Linux:** The portable test-key package
  `8ca22c68d893436cb25631d9d94c2ace07b02b1a7aff1f5acbe5b9ef5f55a926`
  passed all 52 installed release checks across Ubuntu 22.04, 24.04,
  26.04 and Debian 12 and 13 without isolated reruns.
  The matrix includes the GitLab
  delayed-button check, navigation back to the primary `dev` checkout,
  and CTI-sized bulk discard preserving staged work. On Ubuntu 24.04 the same archive passed
  full-ref clipboard, keyboard focus, and Home/End navigation checks. Both X11 launch paths and
  upgrade from public 0.1.5 passed on all five baselines.
  This is evidence for those exact bytes,
  not a production build or WSLg taskbar-pin qualification. The tagged
  production-key candidate still needs hosted exact-artifact
  qualification. The live signed upgrade also needs a supported older
  installation with the same pinned key.
  See [Linux packaged acceptance](linux-acceptance.md#latest-016-local-qualification).
- **Windows:** The existing `windows-latest` job exercises selected Git-core
  tests, not the desktop application or an installer. A feasible first gate is
  the repository's whole desktop build on that runner:
  `pnpm exec tauri build --no-bundle --config apps/desktop/src-tauri/tauri.conf.json`.
  Follow it with packaged-app and installer qualification using an actual
  Windows desktop and native UI/IPC, terminal, file/recovery, cancellation and
  restart journeys. The Linux Debian/WebKitGTK harness cannot run unchanged
  there. Implement and qualify working-file editing and test WSL
  interoperability separately before claiming those capabilities.
- **macOS:** The current workflow has no macOS job. Provision a macOS runner,
  run platform-specific source tests and a whole desktop build, then qualify
  a packaged application and its native UI/IPC, terminal, file safety,
  recovery, installation and restart behavior on supported macOS versions and
  architectures. Other Unix file creation is not qualified against Linux's
  tested parent-move race; file creation is currently refused on non-Windows
  platforms. The current Tauri pre-bundle command prepares
  Linux-oriented assets unconditionally, so its suitability for a macOS bundle
  must be established rather than assumed. Signing and notarization need their
  own evidence when required by the chosen distribution policy.

Record the final source revision, clean-source state, platform and exact
artifact hashes alongside each report. Focused source tests, cross-compilation
or a Linux extracted-package run are not substitutes for installed native
application qualification.

## Public discovery references

- [Desktop interface and feature index](https://help.gitkraken.com/gitkraken-desktop/interface/)
- [Hosted review workflows](https://help.gitkraken.com/gitkraken-desktop/pull-requests/)
- [Feature/release/hotfix workflows](https://help.gitkraken.com/gitkraken-desktop/git-flow/)
- [Profiles](https://help.gitkraken.com/gitkraken-desktop/profiles/)
- [Fork workflows](https://help.gitkraken.com/gitkraken-desktop/fork/)
- [Workspace workflows](https://help.gitkraken.com/gitkraken-desktop/workspaces/)
- [Application link behavior](https://help.gitkraken.com/gitkraken-desktop/linking/)
- [Review-request filter capabilities](https://help.gitkraken.com/gitkraken-desktop/pull-requests-filter-syntax/)
- [Diff, history and blame workflows](https://help.gitkraken.com/gitkraken-desktop/diff/)
- [File editing workflows](https://help.gitkraken.com/gitkraken-desktop/editing-files/)
- [Local file management](https://help.gitkraken.com/gitkraken-desktop/adding-and-removing/)
- [Stash workflows](https://help.gitkraken.com/gitkraken-desktop/stashing/)
- [Submodule workflows](https://help.gitkraken.com/gitkraken-desktop/submodules/)
- [Tag workflows](https://help.gitkraken.com/gitkraken-desktop/tags/)
- [Git manuals](https://git-scm.com/docs)
- [GitHub REST API](https://docs.github.com/en/rest)

The public feature index is the discovery starting point, not an exhaustive
specification. Follow each linked feature guide, expand this inventory when new
requirements are observed, and retain missing/unverified requirements until their
own behavior and runtime evidence are established. Do not close the objective
from this document's existence or from passing counts alone.
