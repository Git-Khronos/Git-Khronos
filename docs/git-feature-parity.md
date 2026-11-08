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
   Feature rebase is available as a separate branch action before a fresh
   finish review; it is not an implicit finishing step. Setup retains existing
   branch tips, and successful feature cleanup permits reusing the topic name.
   Integrated rebase convenience and remaining failure/platform cases still
   need qualification. See the
   [Gitflow guide](https://help.gitkraken.com/gitkraken-desktop/git-flow/).
2. **Optional submodule automation:** clone can include submodules and explicit
   management exists, but automatic update preferences are intentionally not
   exposed: pull-triggered nested checkouts could surprise users or interact
   with local submodule state. See the
   [submodule guide](https://help.gitkraken.com/gitkraken-desktop/submodules/).
3. **Remaining workspace actions:** bulk clone, locate and remove, conversion
   of local groups to shared groups, and unopened-repository aggregation remain
   unimplemented. Bulk fetch, pull and open report per-repository outcomes.

Repository files now has a flat, native-filtered view of tracked, untracked and
ignored files with bounded pages. It can create empty files in existing
directories and open supported files. Tracked-file deletion is disabled on
non-Windows platforms: a confirmed Linux race lets Git's pathname-based `git
rm` remove a file outside the worktree after concurrent parent replacement.
Windows still stages deletion only for clean committed files without index
flags that hide changes; it uses held parent handles, whose rename protection
is covered by native Windows tests. Untracked files use the existing recoverable
discard flow. A Linux real-Git regression now swaps the reviewed parent for a
symlink immediately before reverse-apply and confirms Git refuses without
removing the outside file; other platforms remain unqualified. Git
metadata and nested repositories are excluded; ignored files have read-only
previews and symbolic links cannot be opened. If Git fails after tracked
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
the completed operation rather than implying it was not applied. Paths that
cannot be inspected safely are reported instead of being presented as a complete
listing. Linux file creation resolves the full
path beneath the worktree in one no-symlink `openat2` operation; a regression
test moves the checked parent outside the worktree during the operation and
verifies that no file is created there. Other Unix creation paths have not been
qualified against the same parent-move race. Native Windows tests cover
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
| G06 | Stage/unstage whole files, hunks and lines; represent renames, modes, binaries, new/deleted files and submodules | Audit index/worktree bytes against independent Git CLI fixtures |
| G07 | Browse, create, delete and ignore files/patterns, edit tracked files, invoke configured editors and diff/merge tools | Partial: Repository files filters the full Git-visible path set in bounded pages; creates empty files in existing directories; opens supported files; disables tracked deletion on non-Windows platforms after a confirmed Linux parent-replacement race; and deletes untracked files through recoverable discard. A Linux real-Git regression confirms reverse-apply refuses a symlink-swapped parent after review; other platforms remain unqualified. Focused native Windows tests cover tracked deletion, held ancestor handles and working-file previews. Ignored previews are read-only; symbolic links and Windows reparse points cannot be opened; nested repositories/Git metadata are excluded. Windows in-app editing is unsupported. Ignore-rule extension/directory coverage and Windows packaged UI qualification remain open. Debian package `1ce7f469980c33600572f8fec7e628a180e8184cfc750d5f59e28f6847befa46`, built from the `10c2866` source, passed package verification and all 229 headless native scenarios, including eight owned-window XTEST clicks. See the [recovery specification](specifications/editor-draft-recovery.md) and [external tool specification](specifications/external-file-tools.md) |
| G08 | Compare revisions, contiguous commit selections and working trees; offer hunk/inline/split views, word changes, syntax colors, overview navigation, wrapping, whitespace and image/binary handling | Linux checkpoint: independent bounded byte/image previews and direct content entry pass all 1362 renderer cases and 377 native executions on corrected package `47e83c15899a`. SVG/local LFS previews, broader G08 behavior and other platforms remain open; see the [specification](specifications/non-text-diffs.md) |
| G09 | Navigate file history/blame through renames and parent revisions; copy/reveal/open paths | Audit historical navigation, limits and deleted paths |
| G10 | Create/amend commits, templates, coauthors, sign-off, empty commits and identity/author options | Audit exact commit metadata, hooks, templates and failure paths |
| G11 | Sign commits/tags and diagnose effective signing configuration | Audit supported formats and real signed artifacts; verify tag-signing scope |
| G12 | Create, rename, delete, checkout and publish branches, remote branches and detached commits | Audit exact refs, occupancy, tracking and destructive preconditions |
| G13 | Fetch/pull/push scoped or all refs; configure remotes/upstreams, publish branches, force with lease, auto-fetch and cancel operations | Partial: force push now pins the reviewed remote-tracking and local commit object IDs. Audit normal/auth/error/conflict/partial-success cases and inherited environment isolation |
| G14 | Merge, fast-forward, rebase and preview conflicts; continue/abort/skip where applicable | Audit topology, dirty-state handling, strategy options and preview/actual outcome equivalence |
| G15 | Interactive rebase: reorder, squash/fixup, edit/split, drop and preserve merges/root/selected ranges | Audit every edit instruction and recovery state against Git behavior |
| G16 | Cherry-pick/revert individual or selected commits, including merge-parent selection and conflicts | Audit sequencing, ranges, no-commit options and abort/recovery |
| G17 | Reset/reflog/undo/redo/discard recovery with clear destructive scope | Audit each supported action, retained recovery bytes and restart behavior |
| G18 | Stash full/selected work, stage/index options, names, apply/pop/drop and branch from stash | Partial: selecting files to save and applying an individual reviewed stashed file while retaining the stash and index are implemented. Audit remaining index/worktree/untracked combinations and stale stash preconditions |
| G19 | Create, inspect, delete, rename, move and transfer lightweight/annotated/signed tags; navigate to their commits or branch from them | Audit tag types, peeled targets and remote lease behavior |
| G20 | Detect/resolve text, binary, rename/delete and submodule conflicts; configure external merge resolution | Audit all conflict types; identify missing resolution modes |
| G21 | Add/init/update/sync/remove nested submodules and inspect their changes/history | Partial: explicit management and optional recursive clone exist. Automatic updates remain opt-in functionality deferred to avoid background nested-checkout mutations. Audit nested, dirty, missing, detached and conflicted submodules |
| G22 | Initialize/use Git LFS, track/untrack, transfer/prune objects, and manage locks | Audit provider availability, actual object integrity and lock ownership |
| G23 | Create/open/lock/move/repair/remove worktrees and branches safely | Audit occupancy, shared configuration, ignored/untracked collisions and recovery |
| G24 | Configure and run feature/release/hotfix workflows, including finishing into the appropriate branches and tagging releases | Partial desktop: reviewed setup/start/finish and saved conflict recovery have source, renderer and Linux-package evidence; the specification records full-run failures and successful serial rechecks. Existing branch tips are retained during setup, and a successfully finished feature topic can be recreated with the same name. Feature rebase remains a separate reviewed branch action before a fresh finish plan; integrated rebase convenience and further signing/platform/failure cases remain open. The [independent specification](specifications/branch-workflows.md) records transitions, recovery and remaining gates |
| G25 | Respect Git hooks, expose hook errors/output and explicit hook-control options | Audit actual hook processes and refusal/recovery behavior |
| G26 | Import/export patches, mail series and bundles; inspect and recover failed imports | Audit existing exchange implementations and format compatibility |
| G27 | Maintain repository integrity and offer actionable diagnostics without silently losing data | Audit fsck/maintenance, cancellation and missing/corrupt repositories |
| G28 | Open and generate repository/branch/commit/tag links; select among local copies and offer a prefilled clone when none exists | Candidate: original URI, local-copy review, fetch-free opening, sharing and clone review pass 391 packaged native executions. The original OS inbox also passes 403 exact-package Linux executions for cold process argv and warm GIO routing. The complete 1394-case renderer gate passes. Cold launcher association and other platforms remain open; see the [independent specification](specifications/repository-links.md) |
| G29 | Edit current working files with visible unsaved state, explicit save/discard and save-and-stage versus stage-saved choices; preview Markdown and handle declared encodings accurately | Linux checkpoint: bounded lossless editing, separate save/stage choices, inert Markdown and normal window-close review pass all 1424 renderer cases and 213 normal / 214 inherited-environment native scenarios on exact combined package `ecbdad48a0f7`. Persistent draft recovery and broader codec/platform support remain open. See the [independent editor specification](specifications/working-file-editor.md) |

### Current source-tree audit

This checkpoint concerns the source tree committed as `10c2866`. Earlier Debian
candidate
`1b3c8b5274a25c56e5b52c6ff02bcc7780c209e8875b4be0beb705ef7eb4b180`
passed package verification and the complete headless native suite: 228
scenarios passed, including real checkpoint deletion, stale-review refusal,
editor/file-tool workflows, and eight owned-window XTEST right clicks. A new
package built from that source
`1ce7f469980c33600572f8fec7e628a180e8184cfc750d5f59e28f6847befa46`
passes Debian package verification and the complete headless native suite:
229 scenarios passed, including eight owned-window XTEST right clicks. The
report confirms the same package SHA-256. A later test-only Clippy correction
changes a package receipt input without changing production code. Chromium passed
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
confirms reverse-apply refuses a symlink-swapped parent for untracked deletion.
The same Actions run failed its Linux strict Clippy step on that regression's
assertion; the subsequent test-only correction is verified locally.

| ID | Exercised cases | Remaining qualification or known gap |
| --- | --- | --- |
| G01 | Initialization, clone options, empty and detached HEADs, bare repositories and shallow boundaries | Network failures and the complete large/nested repository matrix |
| G02 | Workspace selection, canonical bulk open, failures and stale workspace replies | Full persisted tab-set, alias and keyboard lifecycle across platforms |
| G03 | Incremental history, shallow boundaries and exact checkpoint references | Every graph/ref topology and large-history navigation on a new package |
| G04 | Full-history search filters, pagination, literal paths and renamed history | Every UI filter combination and large-repository performance |
| G05 | Reference-type filtering, remote hide/solo and checkpoint visibility with a similarly named hidden branch | Other hidden/solo combinations and persisted worktree preferences |
| G06 | File, hunk and line staging/unstaging, new files, sparse paths and literal names | The complete rename, binary, mode and submodule matrix in the UI |
| G07 | Paged file search, safe creation, tracked-deletion refusal on Linux, recoverable untracked deletion and ignored read-only previews; native Windows tests for tracked deletion, parent handles and bounded previews | Tracked deletion is disabled on non-Windows platforms after the confirmed Linux parent-replacement hazard. Linux creation refuses the tested parent-move race; other Unix creation paths are not similarly qualified. Linux reverse-apply refuses the tested symlink-swapped untracked parent; other-platform runtime qualification remains open. The Debian package passed all 229 native scenarios; the full Windows UI remains unqualified and editing is unsupported |
| G08 | Revision/index/worktree byte comparisons, absent content, links, binary previews and external-tool snapshots | All visual diff modes, SVG/LFS preview cases and other platforms |
| G09 | File history, bounded blame, Unicode/literal paths and rename-aware search | Deleted-path navigation and the complete renderer workflow |
| G10 | Commit identity, amend, sign-off, empty-commit policy, templates and hook refusals | Complete metadata and hook combinations through the packaged UI |
| G11 | Real OpenPGP, SSH and X.509 signing round trips and diagnostic failures | Tag-signing coverage and platform-specific signer configurations |
| G12 | Branch creation, rename, delete, tracking and occupied-worktree refusals | All detached/remote publishing and destructive precondition combinations |
| G13 | Scoped fetch, pull strategies, cancellation and pinned force-push leases | Live authentication, every remote topology and partial network outcomes |
| G14 | Read-only merge previews, fast-forward, conflicts and pull merge/rebase strategies | Complete preview-versus-actual outcome and recovery matrix |
| G15 | Rebase edit, fixup, split, merge-preserving review and stale-state refusals | Every instruction, root/merge topology and recovery combination |
| G16 | Ordered revert, cherry-pick/revert mainline selection, no-commit replay and conflict recovery | Full renderer and platform coverage for multi-step failures |
| G17 | Reset/recovery preconditions, retained discard bytes, restart recovery, recovery-record failures, missing-versus-inaccessible captures and stale-toolbar ownership | Every filesystem failure/restart combination and other platforms |
| G18 | Selected stash creation, individual-file restoration, stale-state refusals and index/worktree preservation | All untracked, staged, rename and pop/branch combinations |
| G19 | Lightweight/annotated tag creation, exact names and selected remote transfer/deletion leases | Signed tags and all remote/peeled-target combinations |
| G20 | Text/binary/rename previews, gitlink selection and reviewed external merge output | Complete conflict-resolution modes and platform-specific tools |
| G21 | Recursive clone, explicit submodule inspection, sync, removal and dirty/conflicted refusals | Automatic updates are deliberately deferred; nested edge cases remain |
| G22 | Real LFS tracking, selective fetch/checkout, prune and lock scenarios | Additional providers, installed-client versions and other platforms |
| G23 | Worktree move, repair, registration, locks and occupied/dirty refusals | Complete shared-configuration, collision and platform matrix |
| G24 | Feature/release/hotfix setup and finish, conflicts, recovery and stale reviews | Integrated feature rebase remains separate; more signing and platform cases |
| G25 | Commit and replay hook execution, refusal, cancellation and explicit hook policy | All supported hook types and packaged output presentation |
| G26 | Patch, mail-series and bundle round trips, limits, conflicts and recovery | Broader external format interoperability and other platforms |
| G27 | Integrity checks, corruption reporting, cancellation and non-pruning maintenance | Complete filesystem/error and packaged diagnostic cases |
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
| H02 | Discover/list/clone repositories; detect or create a fork and attach its reviewed SSH/HTTPS remote using the selected provider/account | Partial: GitHub discovery, reviewed HTTPS/SSH cloning, fork creation/reconciliation and reviewed remote attachment have controlled-provider and real-Git Linux package evidence. GitLab account-bound discovery and reviewed cloning now have complete renderer/native Linux qualification, including actual HTTPS Git transfer with separate credentials and a pinned-host SSH clone. GitLab reviewed fork submission, private saved outcomes and read-only reconciliation have focused source/renderer and 37-scenario Linux package evidence; its full 220 and inherited-environment 221 native scenarios also pass, and the complete 1,519-case renderer qualification passes without retries or skips. GitLab fork ancestry, branch scopes, reviewed remote attachment and other providers remain open. The qualified renderer set preserves all earlier 1,484 case identities and adds 35 GitLab cases; the isolated date-test clock correction is recorded in the fork specification. Scenario counts measure test coverage, not capabilities. Catalogue identity does not replace Git transport credentials. See the [hosted repository](specifications/hosted-repositories.md), [GitLab discovery](specifications/gitlab-projects.md), [GitLab clone](specifications/gitlab-reviewed-clone.md) and [GitLab fork](specifications/gitlab-fork-dispatch.md) specifications |
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
| W02 | Show multi-repository changes, divergence, active operations, review/CI/issue context and actionable overview filters | Partial: open-local-repository overview; unopened repositories and hosted aggregation missing |
| W03 | Save/switch identities, accounts, preferences and tab sets; explicitly choose local/global identity sync without silent Git or credential changes | Partial: named commit identity templates only |
| W04 | Provide local and shared team/repository collaboration views and discovery | Discovery and implementation required |
| W05 | Configure terminal/editor/diff/merge programs, repository setup commands and defaults | Partial: terminal profiles retain explicit launch and defaults; the former dedicated agent launcher was removed. The [external file-tool candidate](specifications/external-file-tools.md) supports reviewed editor/comparison/merge launches and separate merge save/stage/cleanup. Earlier Linux package evidence predates this removal; restart storage management and reviewed setup workflows remain open. See the [independent tool specification](specifications/configured-tools.md) |
| W11 | Select workspace repositories for bulk clone/fetch/pull/open/locate/remove, with individual outcomes; convert local groups to shared groups explicitly | Partial: selected-repository fetch, pull and open are available with per-item outcomes; bulk clone/locate/remove and group conversion remain missing. Local overview still covers open repositories only |

## UX, platform and delivery requirements

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| U01 | Provide keyboard-driven command discovery, configurable shortcuts and equivalent Git actions from appropriate contexts | Audit current palette/context menus; shortcut configurability needs discovery |
| U02 | Support documented drag/drop Git workflows with equivalent explicit previews and keyboard alternatives | Audit graph drag operations; enumerate any missing actions |
| U03 | Preserve original identity while supporting themes, scaling, compact layouts, accessibility and large data | Audit all layouts and platforms; fallback-font layout and rapid rebase input fixes passed 1251 local renderer cases and 306 native scenario executions on package `05c1a4c1cd85`; remote verification remains pending |
| U04 | Persist preferences/drafts/view state and restore context across restarts without replaying mutations | Partial: Linux editor draft recovery survives owned crash/relaunch, with inert review and explicit load/save/discard on the final package. Preferences, multiple workspaces and broader session restoration still require audit |
| U05 | Provide native Linux, Windows and macOS behavior plus documented Windows/WSL interoperability | Linux is qualified for prior exact artifacts; focused Windows file tests pass, but complete Windows/macOS/WSL application qualification remains open |
| U06 | Package/install/update/uninstall with accurate licenses, notices and dependency provenance | Audit current package bytes, supported formats and platforms |
| U07 | Verify local Git outputs, native IPC/PTY behavior, full renderer suite and exact distributable artifacts | Latest local Linux checkpoint: all 1,473 renderer cases passed in complete, disjoint partitions with no retries. Exact corrected package `38f876a06ff6` passed 216 normal and 217 inherited-environment native scenarios plus 30 GitLab scenarios (463 total executions, 237 distinct) and viewport checks. The recovery click harness correction also passes against the original failed CI package and fresh full/environment runs. The [GitLab clone specification](specifications/gitlab-reviewed-clone.md) records source/artifact association and retained failed attempts. New-head remote CI and other platforms remain unverified |
| U08 | Handle cancellation, stale state, partial results and uncertain remote writes without reporting false success | Audit every new operation; extend failure fixtures with each implementation |

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
