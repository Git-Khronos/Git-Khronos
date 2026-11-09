# Compatibility notes

## GitLab account and project discovery

Public GitLab REST v4 documentation defines the authenticated user and project
list endpoints, API token header, response fields, literal search parameters and
pagination. The project independently projects those responses into bounded
account/project metadata with string IDs, nested namespace paths and explicit
account/instance checks. These public protocol names are used for interoperability;
no proprietary schema, SDK implementation or client internals were copied.

The HTTPS client, native in-memory account sessions and original fixtures are
project designs. Redirect refusal, byte limits, cancellation, native lifetime and
window boundaries are independent requirements. Normal use of official glab
1.126.0 against owned HTTPS fixtures identified cross-origin credential-forwarding
behavior; that raw CLI transport is not adopted. No real account credential was
read and no access control was bypassed.

The catalogue passed local source, behavioral, notice, renderer and exact Linux
package/IPC checks recorded in its [specification](../specifications/gitlab-projects.md).
This does not establish live GitLab, cloning, provider-write or cross-platform
acceptance. The independent [reviewed cloning workflow](../specifications/gitlab-reviewed-clone.md)
extends the public API read boundary to stable-ID single-project inspection and
uses the existing Git execution/authentication boundary. Its corrected Linux
package passes fresh renderer/native acceptance, including real verified HTTPS
Git transfer with a separate credential and cancellation after a real PACK prefix,
and a desktop SSH clone against a private pinned-host OpenSSH server.
No proprietary package internals, source, assets, wording or visual composition
were used. Live-service and other-platform acceptance remain open.

## Reviewed fork remote attachment

The public Git configuration and remote manuals define URL/refspec entries and
configuration scopes. Fork identity comes from the existing independently
implemented public GitHub reads. The configuration comparison, original-byte
preservation, lock ownership checks and publication logic are project designs.
Owned temporary repositories and Git CLI output supply behavioral oracles.
No external source, proprietary internals or assets were used. Desktop/native,
redirected transport and cross-platform acceptance remain open.

## Mail-patch series exchange

Export accepts 1-500 consecutive ordinary first-parent commits ending at HEAD,
refusing merges, shallow boundaries and partial/promisor repositories. Public
format-patch runs with replacement objects disabled and explicit command options
overriding signature, notes, threading, numbering, headers, mboxrd, rename,
external diff and textconv configuration; exports never overwrite files.
Import reviews a complete regular file up to 16 MiB/500 patches, then rechecks
file identity, HEAD and branch, requires clean tracked state and saves the
original tip in a protected recovery reference before git am -k --keep-cr
--no-3way. Committer is local; signatures and notes are not carried. Empty
patches, conflicts and hook refusals stop for explicit Continue/Skip/Abort;
Abort restores the original tip; ordinary commits refuse while paused.
Eight owned real-Git fixtures qualify exact
round trips under hostile configuration, partial series, refusal boundaries,
500-commit/oversize limits, conflicts, stale/dirty/detached inputs and hook
refusal. Seven renderer journeys qualify review/save/apply/pause controls, focus
and repository-scoped refresh. Not a transaction against outside writes or disk
failures. No external implementation, assets or documentation prose copied.

## Offline bundle branch exchange

Public Git bundle create exports one local branch with its full reachable history
and an expected-tip guard. Verify/list-heads inspect the complete immutable
captured file and available prerequisites; actual object payload validation
happens at fetch. Source fingerprints detect ordinary stale contents, not
authenticity. Complete regular files are limited to 16 MiB and 500 distinct
UTF-8 advertised references. Symlink/special/tag-only/over-limit inputs refuse.
Partial/promisor repositories refuse before status inspection to avoid implicit
network downloads; self-contained export also requires non-shallow history.
New exclusive output files are synchronized outside working-tree/Git metadata
boundaries; existing files are never replaced.

Separate explicit branch-only import rechecks contents, exact advertised tips
and active operations, fetches from a local capture without destination mapping,
and atomically creates one protected recovery reference to the direct commit.
No existing branch, tag, remote-tracking ref, HEAD, FETCH_HEAD, index or working
file update is requested. Dirty files stay in place; configured ref mapping,
pruning/tags, submodule recursion and automatic maintenance are disabled for
this command without editing settings. Missing prerequisites refuse before
fetch. Annotated tag and blob objects advertised as branches cannot become recovery refs.
Failed fetch/ref preservation may leave objects and returns explicit guidance;
temporary capture cleanup errors also disclose completed/failed action state.
Configured hooks and external filesystem effects are not transactional.

Original real-Git fixtures cover binary full-history round trips, dirty index/
worktree/untracked/ref/FETCH_HEAD isolation, stale source/export tips, changed
advertisements, active metadata, no overwrite/outside-output boundaries,
incremental prerequisites in unborn and existing repositories, shallow/partial
source scope without implicit network fetch, exact byte and
500/501 reference limits, corrupt headers/payloads, annotated-tag advertisements,
hook-refusal after object import, literal newline source paths and linked
worktree scope. Deferred renderer journeys cover exact expected-tip/import IPC,
explicit branch-only choice, complete tip disclosure, cancellations, compact
help/focus, stale export/refusal/no-repeat recovery, post-import refresh failure,
loaded/review-generation repository invalidation, and shared lazy-loading shell.
No external implementation, assets or documentation prose copied.

## Complete tracked diff patch exchange

Public Git diff with binary/full-index output exports all or literal selected
tracked staged/unstaged changes. New files require staging; renames export as
deletion/addition. Every selected path must produce its complete chosen-scope
diff. No external diff or text conversion is requested. New exclusive output
files outside the worktree/common metadata directory are synchronized; existing
files are not replaced. Export does not move refs or mutate the index/worktree.
Filesystem write failures disclose a possible partial output file.

Import reads one bounded regular file, inspects Git's NUL-delimited path/count
report and creation/deletion/mode summary, and runs public git apply --check
against the explicitly chosen working files, cached index, or both. A separate
Apply repeats the complete clean-state/path/object review and compares exact
input bytes, HEAD, full branch identity and the complete index entries.
No commit/ref changes, partial-hunk application, three-way fallback, whitespace
fixing or unsafe-path override. Configured whitespace-ignore behavior is
overridden for this command only; repository/user configuration is not edited.
Index-only effects are explained separately from working-file contents.

Review requires a committed HEAD and no dirty/untracked/active-operation or
assume-unchanged/skip-worktree state. Complete patch/index reports are bounded
to 4 MiB and 2000 distinct patch paths. Invalid/outside/metadata paths, symlink
ancestors/leaves, nested repositories, special input files, unsupported
non-UTF-8 paths, symlink/gitlink modes and extended rename/copy records refuse.
Ordinary additions/deletions, executable modes and binary data are supported.
LFS diffs carry Git pointer data, not cached LFS objects.

Original native fixtures verify all three target effects, exact text/binary/
index bytes and unchanged refs, staged literal tab/newline paths, mode/rename
deletion-addition round trips, source/base/branch/dirty/hidden-state refusal,
all-hunk base mismatch, preserved operation metadata, exact byte/path limits,
symlink/nested/metadata safety, no overwrite, whitespace/external-diff config
isolation and linked worktrees with a literal newline root path.
Renderer journeys qualify exact optional selection and captured import IPC,
explicit review/cancel/target invalidation, native dialog cancellation, focused
refusal/fresh review, compact/help and repository/deferred-load invalidation.
These checks do not promise a transaction against outside filesystem writes or
disk failures. Mail patches have their own commit-series workflow above.
No external implementation, assets or documentation prose copied.

## Separately reviewed merge-preserving replay

Current-local-branch replay onto a different local branch can use a distinct
complete topology review. Public `git rebase -i --rebase-merges=no-rebase-cousins
--onto <captured-target> <common-base>` leaves Git's generated structural
instructions intact. Ordinary commits and two-parent merges are supported;
shallow, root, octopus, ambiguous common bases and over-limit reviews refuse.
No flattening fallback, instruction reconstruction, autosquash or row editing
is offered. Side ancestry outside the common base keeps original branch points.

Source/destination tips, original parents and recorded remote reachability are
reviewed, then checked again on execution. The original tip is preserved;
unrelated refs remain unchanged despite configured automatic updates.
Hooks/signing remain enabled. Native conflicts and Continue/Skip/Abort survive
reload. Original manual merge resolutions are not automatically copied;
owned conflicting-merge fixtures prove a new resolution is required and Abort
restores the original resolved tree.

Original real-Git fixtures qualify resulting two-parent trees/messages/ancestry,
cousin branch points, unrelated-ref isolation, conflict Continue/Abort,
500/501 topology bounds, shallow/linear/octopus/ambiguous/stale/dirty/hidden/
recovery refusal and actual hook failure. Deferred renderer fixtures exercise
explicit scope, exact IPC, keyboard/compact help/cancel, failed replay no-repeat,
preparation refusal/retry and repository/lazy import invalidation.
No external source code or manual prose copied.

## Explicit selected-history replay destination

Selected-history review defaults to its unchanged parent base. An explicit
destination choice captures an available branch-tip commit independently of the
original boundary. Public `git rebase -i --onto <captured-commit> <boundary>`
replays the complete reviewed suffix on the current local branch. The destination
reference remains untouched; later branch movement cannot silently change the
captured parent. Exact commit existence/type is checked before native recovery
or setup; a destination inside the reviewed suffix refuses.

Existing optional selection/root requests remain compatible when no destination
is supplied. Complete source preflight, protected original tip and scoped
unrelated-ref/autostash/autosquash/merge preservation guards are retained.
Hooks/signing remain enabled. Different destination files can cause conflicts
or newly empty effects; native Continue/Skip/Abort remains explicit. Destination
choices retain reviewed actions/messages; restoring original-base choice runs
no command. Whole-history editing supports the same captured destination
(see below); merge preservation uses the separate topology review described above.

Owned real-Git fixtures qualify exact resulting parents/trees/messages/authors,
captured destination despite branch movement, no unrelated-ref updates across
Edit/Continue, conflict Continue/Abort, newly empty Skip, invalid destination/
mode/dirty/hidden/recovery refusal and actual hook failure. Renderer journeys
qualify exact optional destination IPC, full suffix/disclosure, retained drafts,
compact help/cancel/restored base and repository-switch invalidation.
No external implementation material or documentation prose copied.

## Explicit whole-history editing including the root

Current-local-branch actions offer a distinct complete-history review from the
actual root through HEAD. Public `git rebase -i --root` executes only after
complete bounded review and repeated execution preflight. There is no unchanged
base; at least one commit must remain. Shallow, non-linear, competing-operation,
dirty/hidden-index and stale/incomplete plans refuse instead of replaying a
prefix or treating a shallow boundary as the actual root.

Existing branch and selected-range APIs remain compatible; an optional root
IPC flag is absent in legacy requests. Scoped configuration prevents implicit
unrelated-ref updates, autosquash, autostash and merge preservation. Hooks and
configured signing remain enabled. The original tip is protected before setup.
An originally empty root can be reworded with conditional unchanged-tree
permission; newly empty steps retain Git's native interruption. Root Edit
supports amendment/Continue/Abort but not parent-based guided splitting.

Independent owned fixtures exercise root messages/parents/trees/authors,
empty-root Reword, root dropping versus all-drop refusal, root Edit/reload/
amend/Continue/Abort, conflict Abort, exact500/501 review boundaries and
stale/shallow/merge/detached/ref refusals. Renderer journeys exercise explicit
scope, exact optional IPC, all-drop disabling, compact help/draft/keyboard
escape, refusal/retry and repository-switch invalidation.
An optional captured Replay destination runs public `git rebase -i --root
--onto <commit>`: the first replayed commit gains that destination as parent,
destinations inside the reviewed history refuse before side effects, ordinary
non-selected/non-root modes still refuse a destination, and the destination
reference never moves. Owned fixtures verify resulting parent/trees/messages,
unchanged destination/unrelated branches, recovery protection and conflict stop
plus Abort restoring the original tip; a renderer journey verifies exact
`root`+`ontoOid` IPC and that clearing the choice restores independent history.
Merge preservation uses its own
separately reviewed workflow, not the linear root editor.
No external implementation material or documentation prose copied.

## Guided commit splitting at Edit stops

A separately reviewed action at a clean intentional rebase Edit stop protects
the original branch tip and replayed commit, then performs a documented mixed
reset to its sole parent. Index changes are unstaged, working contents retained
and added files become untracked. Existing application rebase reviews/recovery
remain authoritative; original native rebase metadata is inspected, never
fabricated or edited by this feature.

A strict 4 KiB worktree-local split journal is synchronized before reset, then
marked active after the expected parent is verified. Exclusive metadata locks
are not stolen. Interrupted/uncertain reset state refuses repeat, commit,
Skip and Continue, while direct Abort remains available. Malformed/oversized/
unreadable metadata reports errors instead of looking idle.

Active split parts must form a bounded linear chain (up to 500 commits) rooted
at the saved parent. Explicit ordinary commits use the current identity and
signing policy; author overrides remain available. Parent amendment and
unchanged-tree permission are refused. Continue requires at least two parts,
the exact saved combined tree and no remaining staged/unstaged/untracked changes.
No implicit commit or Skip can bypass this check. Empty stopped commits refuse
without reset. This intentionally supports partitioning contents, not changing
their net tree; ordinary Edit/amend remains available for the latter workflow.

Native Abort may refuse split-created untracked files overlapping the restored
original tree. Files remain intact; explicit review/stage-only-those-files or
safe external movement precedes retry. No force reset or silent deletion runs.
Owned actual-Git fixtures cover repeat/reset/lock/stale/dirty/hidden-state refusal,
partial/full parts, exact suffix trees/messages/parents, hook failures, uncertain
storage, worktree isolation, empty input, consecutive Edit splits and Abort
obstructions with unrelated-file preservation. Renderer fixtures verify
confirmation/identity guidance, focused help/cancel, staged parts/commit/Continue,
restart-like status-only changes and repository-switch safety.

## Reviewed selected-range history editing

Commit actions prepare an inclusive starting commit or consecutive
oldest-to-newest selection on the current local branch. The complete review
also contains every later descendant through HEAD, bounded at 500 rows and
2 MiB. The original first-parent base remains unchanged. Merge-containing,
unrelated/nonconsecutive, root and shallow-boundary ranges refuse rather than
flattening or replaying a partial selection.

Existing local-branch-to-local-branch preparation remains available. Both modes
inspect recorded remote reachability via local remote-tracking ancestry;
unknown means unverified publication, never proof of private/unpublished work.
No network operation runs during this inspection. Captured immutable source
objects and final branch-tip checks prevent source changes from silently
altering the review, and execution validates the complete supplied set again.

Selected-range execution preserves the original tip before support writes,
refuses hidden index entries and competing operations, and suppresses configured
automatic unrelated-ref updates, implicit autosquash/autostash and merge
preservation. Hooks and configured signing remain effective. Reword adds
unchanged-tree permission only for commits verified as originally empty;
nonempty commits becoming empty still use Git's interactive stop behavior.
Recovery references, native rebase stops and Continue/Skip/Abort survive reload.

Original actual-Git fixtures cover exact trees, messages and parent base,
protected original history, configured automatic ref updates, tags sharing
branch names, remote reachability/unknown, 500/501-row thresholds, invalid and
stale selections, hidden edits, actual hooks, empty Reword and repeated conflicts.
Renderer journeys qualify full-suffix disclosure, exact optional selection IPC,
compact keyboard/help/cancel, refusal/retry and repository-switch invalidation.
Merge-preserving mode remains unfinished; explicit destination replay,
whole-history root editing and guided splitting have separate workflows above.
Official Git manuals inform behavior; no external implementation material copied.

## Explicit sign-off and unchanged-tree commits

Per-draft opt-ins delegate to Git's `--signoff` and `--allow-empty`. Existing
callers keep both disabled; the IPC policy is optional for older clients and
unknown policy fields are refused. Sign-off uses the actual Git committer and
is distinct from cryptographic signing. Unchanged-tree permission does not
exclude staged files or automatically stage working edits.
Real-Git fixtures cover default empty refusal, nonempty messages, exact tree
and parent behavior, committer trailer deduplication, co-author preservation,
amend, unstaged/untracked preservation and configuration preservation.
Unix fixtures qualify failing pre-commit, prepare-commit-msg and commit-msg
hooks plus an unavailable signer, without recording a commit or losing staged
contents. Renderer fixtures mock IPC, including per-repository drafts, pending
controls and late-completion safety; they do not establish packaged acceptance.

Source: official Git commit and hook manuals. Independently implemented.

## Per-commit author and committer overrides

Strict optional identity objects extend the commit policy without changing old
caller defaults. Explicit full author identity is passed through `--author`;
committer name/email are added only to that Git command's environment.
Both require bounded nonempty names and explicit emails without control or
delimiter injection. Invalid overrides fail before executing Git.
Repository configuration and the parent application's environment are not
modified. Git owns amend-author retention, trailer identity and signing policy.
A changed committer may affect default key selection.

Original real-Git fixtures qualify independent author-only/committer-only/both
overrides, restoration of configured defaults on the next commit, unchanged
configuration, Unicode names, explicit amend-author replacement, exact tree/
parent preservation, malformed/overlong identities and strict unknown-field
refusal. Unix hooks observe the scoped committer, can refuse the operation and
do not persist the override into a later command.
The combined deferred policy editor retains per-repository drafts, pending
editing guards, native-refusal retry and explicit chunk-load errors.
Renderer IPC is mocked; packaged acceptance remains unfinished.

Source: official Git commit/hook documentation. No third-party code copied.

## Configured templates without silent loss

The repository snapshot reads the effective `commit.template` path using Git's
NUL-delimited path output. Whitespace/newline paths remain literal. Only regular
UTF-8 files up to 1 MiB, without NUL text, are accepted; reading is bounded even
if the file grows. Empty/guidance-only templates are distinct from no template.
Git `stripspace --strip-comments` prepares guidance with effective comment
configuration instead of the renderer deleting every hash-prefixed line.
This is form preparation, not an override of commit cleanup policy.

Failures are structured snapshot feedback, not silently empty templates or
repository-opening failures. Repair is retried with repository refresh; refresh
does not replace an entered message. Reload of the current snapshot requires
confirmation before replacing summary, description and co-authors. Commit
policy is preserved, pending commits disable reload/help, and confirmations
are invalidated on repository/template/error changes.

Original real-Git fixtures qualify configured comments, whitespace/newline
paths, missing/invalid/directory/oversized inputs, exact accepted byte limit,
repair, unchanged configuration/HEAD/index and staged/unstaged contents.
Renderer qualification covers explicit replacement/cancel/focus, literal
headings, empty templates, visible failures, retry, repository switches,
pending controls, compact layout and deferred import refusal.
IPC is mocked; packaged-native acceptance remains unfinished.

Source: official commit/config/stripspace manuals. No external code copied.

## Advisory Git failure recovery

Existing `gitFailure` kind and credential-redacted Git diagnostics remain
unchanged. An original classifier adds non-destructive hints for selected
English C-locale diagnostic phrases: lock collisions, full volumes/quotas,
permissions/read-only filesystems, damaged indexes/objects and storage I/O.
Unknown messages keep generic guidance; revisions merely named by invalid
user input are not classified as repository corruption.
An active rebase does not replace recognized operational-failure guidance with
conflict instructions; ordinary rebase conflict handling remains unchanged.
Hints do not inspect ownership, assert complete diagnosis, delete locks,
reset indexes, fetch objects, prune, run maintenance or retry mutations.
Object guidance suggests a separate manual `git fsck --full` check and recovery
from known-good sources. The separately implemented explicit inspector below
also exposes this check, never automatically from an error.

Original disposable actual-Git fixtures qualify a foreign index lock retained
byte-for-byte after stage refusal, an empty loose object and damaged index
preserved after inspection refusal, and explicit fixture-only repair for retry.
Synthetic diagnostics qualify disk/quota/permissions/I/O phrases, conservative
fallbacks, contract stability, active-rebase distinction and existing credential
redaction.
Renderer mocked IPC qualifies original messages plus hints, retained drafts and
only user-initiated commit attempts. Packaged acceptance remains unfinished.

## Explicit object/connectivity inspection

The independently implemented inspector runs `git -c core.commitGraph=false
fsck --full --no-progress` with optional locks disabled, C-locale diagnostics,
terminal prompts disabled and lazy fetch disabled. Any partial-clone/promisor
configuration is conservatively refused without changing it. No lost-found,
repair, garbage collection or maintenance command is issued.
Both output streams drain concurrently with 1 MiB retained per stream; complete
output versus truncated reporting is explicit. A check passes only with exit zero
and complete output. Nonzero exits are inspection findings/failure, not transport
success or clean-state claims. Signals/startup/read/wait failures and cancellation
remain explicit errors without a success report.

Tauri registers a cancellable operation and serializes inspection with local
mutations. The deferred preferences panel reuses global operation busy/cancel
lifecycle; closing preferences does not hide the global cancellation affordance.
Reports/errors are repository-scoped and delayed results are discarded after a
switch. Nested official help remains focus-restoring and disabled while pending.
Results are sequential observations, not an ownership lease, backup, signature/
LFS/device-health verification or permission for repair.

Original real-Git fixtures preserve HEAD/index/config and staged/unstaged data,
inspect clean/dangling and damaged loose-object repositories, qualify linked/
unborn layouts and respect configured bare-repository policy, refuse promisor settings,
retain cancelled large-object inspection data and never create lost-found.
Bounded-reader units qualify exact/excess stream limits. Renderer mocked IPC
qualifies explicit invocation, findings/empty/truncated output, error/retry,
cancellation, global busy, switching, nested help and lazy import refusal.
Packaged-native/platform acceptance remains unfinished.

## Read-only worktree registration review

The independently implemented review reads a complete bounded
`git worktree list --porcelain -z --expire=now`, then a bounded
`git worktree prune --dry-run --verbose --expire=now`. NUL boundaries preserve
literal newline/tab paths. Incomplete, malformed, duplicate and unknown records
are refused instead of presenting a partial successful review.
Locked and prunable reasons are shown explicitly; the human prune report is
displayed, not parsed into an executable deletion scope.
Sequential observations are not a lease or transaction. Immediate expiry is
disclosed as more aggressive than Git's normal age-based policy.
No registration, directory, index, branch or reflog is changed by this review.
Real-Git fixtures preserve existing state, including dirty and detached
worktrees; renderer journeys mock IPC and do not establish packaged acceptance.

## Recoverable single worktree registration removal

The Git manual's global `worktree prune` has no per-entry selection, so this
independent workflow uses documented `git worktree remove <path>` without
`--force`. A local Git 2.53 observation confirmed that it removes only the
named registration when its directory is gone. Preconditions: Git reports the
entry prunable and unlocked, it is not the main/bare entry, its directory is
absent, and exactly one administrative directory has an absolute `gitdir`
link to it. Reftable storage, relative links, symbolic or malformed
worktree-specific refs, and special files refuse. HEAD and per-worktree refs
are protected with the existing recovery-reference mechanism. A bounded,
byte-verified, synced copy of the administrative directory and a JSON
description are kept in the common Git directory. Every registration, the link
and a metadata manifest are rechecked before removal. Afterwards the admin
directory's absence, other registrations, refs and recovery refs are verified.
No rollback is promised. Missing working files and other reflog objects are not
recoverable.

Source: official Git worktree manual. No third-party implementation copied.

## Read-only submodule state review

Independently combines documented outputs: `git ls-files --stage` for gitlink
mode 160000 entries and conflict stages, `git status --porcelain=v2
--ignore-submodules=none` submodule flags (`S<c><m><u>`), `.gitmodules` and
local `submodule.*` configuration, and the submodule's checked-out commit.
Local Git 2.53 observations: a deleted gitlink reports `1 D. S...` with zero
modes; untracked submodule content is still flagged with `-uno`; relative
declared URLs remain relative in `.gitmodules` while local config holds the
resolved URL. URL comparison is therefore limited to absolute declarations.
Optional locks are disabled; real-Git fixtures verify index, config,
`.gitmodules` and HEAD stay byte-identical. No mutation is performed.

## Submodule remote-update branch

Uses documented `git submodule set-branch --branch <branch> -- <path>` and
`--default`. An absent `submodule.<name>.branch` follows the remote HEAD; the
special value `.` follows the branch with the same name as the parent
repository's current branch. The reviewed branch value is rechecked before the
command. Ordinary names are validated with `git check-ref-format --branch`.
Afterwards the complete `.gitmodules` submodule configuration is compared so
only the selected declaration's `branch` value may differ. The command does not
fetch or move a submodule checkout. `.gitmodules` remains for explicit review,
staging and commit. No third-party implementation was used.

## Single submodule URL sync

Uses documented `git submodule sync -- <path>` without `--recursive`. Local Git
2.53 observations: only `submodule.<name>.url` in the superproject and the
submodule's default remote URL change (a renamed sole remote is updated, not
`origin`); push URLs are untouched; relative declarations are resolved by Git
against the superproject. Uninitialized entries are left alone by Git, so they
are refused. Expected declared and local URLs are rechecked; afterwards the
complete `submodule.*` and submodule `remote.*` configuration is compared so any
additional change is reported as unverified. No rollback is promised; previous
values are returned for manual restoration.

## Recorded submodule commit checkout

Uses documented `git submodule update --no-fetch --checkout -- <path>` without
`--recursive`. `--checkout` overrides a configured update mode and `--no-fetch`
prevents network access, so a missing recorded commit is refused beforehand via
`git cat-file -e`. Local Git 2.53 observations: the submodule HEAD is detached
at the recorded commit, branches and untracked files stay, and the parent index
and HEAD are unchanged. Expected index and checkout commits are rechecked;
tracked changes and conflicts are refused. The previous commit is protected by
a recovery reference inside the submodule, and afterwards HEAD, submodule
references and parent index entries are verified.

Nested mode does not use `--recursive`; it walks initialized nested
submodules itself and repeats the same single-level step with its own
protection and verification. Before any change, `git status --porcelain=v2`
at every level must report only submodule entries without staged changes, so
nested recorded-commit drift is allowed but file edits are refused.
Uninitialized, conflicted and refused nested entries are reported as skipped.

## Safe submodule deinit

Uses documented `git submodule deinit -- <path>` without `--force`. Local Git
2.53 observations: Git refuses when the submodule or a nested submodule has
edits, untracked files or a commit other than the recorded one; on success it
empties the directory, removes the entire local `submodule.<name>` section
(including update, branch and ignore), keeps `.git/modules/<name>` with its
references, and leaves the gitlink, `.gitmodules` and status unchanged. An
embedded `.git` directory is absorbed first. Git Khronos rechecks the reviewed
commit, then verifies the empty directory, the remaining configuration, the
kept repository data and references, and the parent HEAD, index and
`.gitmodules`.

## Staged submodule removal

Uses documented `git rm -q -- <path>` without `--force` or `--cached`. Local Git
2.53 observations: Git refuses edits, untracked files or another checked-out
commit and refuses unstaged `.gitmodules` changes; on success it removes the
directory and stages both the gitlink deletion and the declaration edit, while
local `submodule.<name>` configuration and `.git/modules/<name>` remain.
Uninitialized entries are removed the same way. Afterwards Git Khronos verifies
that only the path and `.gitmodules` changed in the index, other declarations,
local configuration, references in the kept repository data and the parent
HEAD are unchanged. Reading references from that data passes an explicit work
tree because its recorded one no longer exists.

## Clone history limits and interrupted clones

Uses documented `git clone [--branch <name> --single-branch] [--depth <n>] --
<source> <destination>`. Local Git 2.53 observations: `--depth` is ignored for
plain local paths but honored for `file://` sources, producing a shallow
repository; `--branch` with `--single-branch` fetches only that branch. Git
removes its destination after an ordinary failure, but cancellation stops the
whole process group, so Git cannot clean up and a partial destination with
`.git` can remain. Git Khronos never deletes it automatically; the error names
the folder to remove before retrying, and a retry into it is refused because the
destination exists.

Optional `--recurse-submodules` (no pathspec) clones nested submodules and,
as documented, records `submodule.active=.`. Observed on Git 2.39 and 2.53:
`--depth` does not shorten submodule history (`--shallow-submodules` is not
passed); when a submodule's server repository is missing, clone exits with an
error but keeps the checked-out superproject, so Git Khronos reports
`submoduleCloneIncomplete`, naming the folder instead of claiming a partial
clone. Default protocol policy refuses `file` transport for submodules, so the
fixture serves repositories through a local `git daemon`.

## Shallow-history deepening

The explicit branch-only fetch can add documented `--deepen=<n>` or
`--unshallow` when `git rev-parse --is-shallow-repository` reports a shallow
repository. Local Git 2.53 observations: deepening extends the existing
boundary while branches first fetched in the same operation arrive with limited
history; `--deepen` on a complete repository is a no-op and `--unshallow` there
fails. Because the boundary is repository-wide, Git Khronos requires one
selected remote, refuses complete repositories and depths outside 1-1,000,000,
leaves HEAD, local branches and files unchanged, and reports when the
repository is still shallow after requesting complete history.

## Detached, unborn and bare repository states

Opening resolves the working tree with documented `git rev-parse
--show-toplevel`. Local Git 2.53 observations: an unborn branch has no
references yet, `git switch -c` renames it, and the first commit creates it;
on a detached HEAD, commits do not move any branch and `git switch -c` attaches
the current commit to a new branch. A bare repository or a `.git` folder fails
with "must be run in a work tree", or "cannot use bare repository" when
`safe.bareRepository=explicit`; unknown `extensions.*` with format version 1
fails with "unknown repository extension"; foreign ownership fails with
"dubious ownership". Git Khronos keeps Git's detail but classifies these as
bare, repository-data, unsupported-format or untrusted-owner refusals with
original guidance, and never fabricates a working tree or changes the
repository.

Read-only bare browsing: when Git reports a bare repository, Git Khronos accepts
the path only if `git --git-dir=<path> rev-parse --is-bare-repository
--absolute-git-dir` reports `true` and the same canonical directory. Folders
inside bare repository data remain refused. Every later command for that
repository sets `GIT_DIR` explicitly, which Git's `safe.bareRepository=explicit`
policy permits; the policy is not changed. Status is the current branch only
(no working tree), stashes and submodules are empty because `git stash` needs a
work tree, and Git itself refuses working-tree commands (observed "must be run
in a work tree"). Original fixtures qualify this under the default policy,
`safe.bareRepository=explicit` and Git 2.39.

## Original educational hints

The searchable reference uses original explanations of implemented feature
families, with explicit risks and narrower application support. Static official
HTTPS Git/Git LFS manual links are opened on demand through the existing validated
browser-opening service. Contextual help does not execute the explained Git
command. The catalog and dialogs load separately from the startup bundle.

Sources: official Git/Git LFS command manuals; no external prose or assets copied.

## Reviewed unreferenced LFS object removal

Requirement: remove only local LFS cache objects that cannot be needed by any
local Git state, with an exact reviewed list and no retention-policy guesswork.

Candidates are regular files in the documented `LocalMediaDir` layout
(`aa/bb/<sha256>`) that no SHA-256 pointer in any Git object names. Pointers are
read from every blob under the specification's 1024-byte pointer limit enumerated
by `git cat-file --batch-all-objects`, which includes unreachable objects and
alternates, so references, reflogs, stashes, every worktree index and dangling
blobs protect content. Objects modified within an hour are kept. Storage outside
the common Git directory, shallow repositories and promisor/partial-clone
configuration are refused. Removal repeats the whole scan and requires each
reviewed object to remain a candidate with the same size; otherwise nothing is
removed. Symlinks and unexpected names are never candidates. Cancellation between
removals reports how many were removed. Fixtures qualify Git 2.39 and current Git
with Git LFS 3.7.1. Remote copies are not checked: removed objects may be
unavailable anywhere.

## Advanced Git LFS retention prune limitations

The advanced action delegates to Git LFS after confirmation. It does not provide
an exact candidate preview, require remote verification or refuse shared storage.
Retention and fetch-exclude settings remain effective; reflog-only objects are
not protected by Git LFS's documented policy. UI and documentation disclose these
limits rather than describing all candidates as unreferenced.

A proposed stricter workflow was rejected during local Git LFS 3.7.1 black-box
qualification: the verbose dry-run reported two removable objects but listed only
one, and a local-file remote check reported verification after the selected
remote cache copy had been removed. No candidate parser or new deletion executor
from that experiment remains. Complete enumeration and meaningful remote backup
evidence require further work. These local observations do not qualify HTTP/SSH
server verification or imply the same behavior in other tool versions.

Source: official Git LFS prune manual and original, disposable local fixtures.
No external implementation copied.

## Reviewed local single-pointer hydration

Independent hydration is deliberately narrower than `git lfs checkout`: only an
existing canonical working pointer identical to one ordinary unmerged-free
stage-zero index entry is eligible. Both attribute views must assign the LFS
filter. Missing/modified/already hydrated files, symlink parents/entries, gitlinks,
unmerged entries, noncanonical pointers, skip-worktree and assume-unchanged flags
are refused. Literal index pathspecs support wildcard-looking names without scope
expansion. This does not vivify absent sparse paths.

The review leases HEAD/branch, a complete index-file checksum, selected index
entry/flags, pointer permissions, effective attributes, cache path and an opaque
fingerprint of effective Git/LFS settings. Initial identity and working-pointer
reads are rechecked before returning a review and again before replacement.
Git hashes the literal unfiltered working pointer and compares the index blob
ID; no missing Git pointer blob needs to be fetched.

The supported `LocalMediaDir` line from documented `git lfs env` locates configured
storage; missing/duplicate/nonabsolute/unsupported output or symlink object paths
fail explicitly. No hardcoded default `.git/lfs` location is assumed. An exclusive
randomly named temporary file in the existing working parent uses owner-only
permissions on Unix. Copy is streaming and cancellable. The documented `git lfs
pointer --file` computes SHA-256/size of that copy; it must match the exact
reviewed canonical pointer before original permissions are applied and rename
replaces the working pointer. No network transfer, staging, Git reference update,
prune or LFS lock/unlock is requested.

Same-size corrupt cache contents fail before replacement. Errors/cancellation
clean only the owned temporary file; cleanup failure identifies its exact path.
Successful rename is followed by directory synchronization on Unix and identity
verification. Post-replacement failures explicitly disclose the replacement and
lack of rollback. External filesystem races and unsupported platform-specific
replace/permission semantics are not hidden as transactional guarantees.

Original actual-LFS fixtures cover custom cache, exact one-file replacement,
unchanged index/ref/config/other working files, permission preservation, modified/
missing/different-index/cache-corrupt/unmerged/symlink/sparse/assume-unchanged
refusals, full-index/HEAD/attributes/settings leases, literal special names and
active-copy cancellation cleanup. Renderer journeys exercise review, exact IPC,
error/retry, cancellation focus, compact layout and repository guards with mocked
IPC. Packaged/cross-platform native acceptance remains unqualified.

Sources: official LFS checkout behavior, environment/pointer manuals and public
pointer specification. No upstream implementation copied; safe temporary-copy
hydration and tests were written independently.

## Reviewed single-file LFS cache fetch

An inspected pointer must match exactly one selected literal path at committed
HEAD. The preview records that commit, path, object ID, size and chosen configured
remote. An opaque fingerprint of bounded effective Git configuration and `git
lfs env` output detects configuration/endpoint/storage changes without returning
raw settings to the renderer. Execution rechecks HEAD, the committed object and
settings before starting. External changes are still possible after these reads;
no transactional guarantee or server identity certificate is claimed.

The documented CLI fetch uses the explicit pinned commit and a root-anchored
include filter, clears exclusions, and disables recent/history expansion through
command-local configuration. Remote autodetection and search-all fallback are
disabled so a missing object on the selected remote is not obtained silently
from another remote. Commas, wildcard syntax, backslashes and exclamation
marks in names are refused rather than reinterpreted as wider selection.
No checkout, prune, staging or Git ref update is requested. Custom local storage
and configured LFS endpoint resolution remain Git LFS's responsibility.
Completion requires the selected cache object's size-based availability; it is
not hash-integrity verification. The existing operation authentication bridge and
process-group cancellation are reused; transfer errors and cancellation explicitly
disclose possible retained cache data and require a new review for retry.

Original local bare-remote fixtures qualify single-object selection despite broad
recent/history policy and conflicting include/exclude configuration, no download
of unrelated or historical objects, preservation of dirty/index/pointer/ref/config
state, sparse-index exclusion without hydration, stale review and staged-object
refusal, missing-server-object failure/retry, disabled cross-remote fallback and
pre-cancelled transfer. Renderer
journeys qualify explicit review, exact IPC, refusal/retry, cancellation focus,
compact layout and repository guards; they mock IPC. Live HTTPS/SSH LFS-specific
authentication and packaged-native acceptance remain unqualified.

Source: official Git LFS fetch manual. Implementation, interface and tests were
written independently; no external implementation copied.

## Bounded local LFS object diagnostics

Uses Git LFS's documented `ls-files --json` output with no include/exclude
filter, bounded complete output and strict path/hash/version/size validation.
Null and empty file arrays are valid empty scopes; missing/malformed records
and output limits are explicit errors. Index/HEAD scope, index-first duplicate
selection, fallback HEAD paths deleted from the index, and zero-size omission
are explained rather than presented as all repository objects.

OID and cache location interpretation are delegated to LFS. Its checkout and
downloaded booleans are size evidence, not checksums. An independent bounded
ordinary working-file read recognizes the canonical public-spec pointer to the
listed OID/size, labels other pointer-like content conservatively, and refuses
following static symlink paths. Missing paths (including sparse exclusion),
non-files and size-matching/differing content remain distinct. No hash integrity
or transactional filesystem guarantee is claimed; external edits are possible.

Real LFS fixtures cover custom storage, pointer-only checkout with available and
missing cache, same-size modified contents, size mismatch, other pointer-like
contents, missing paths, symlink parents/entries and unchanged configured hooks.
Diagnostics do not stage, hydrate, transfer, prune or rewrite files/index/HEAD.
UI reports scan failures separately from empty results, focuses status/errors,
guards repository switches and pending dismissal, and provides non-mutating
missing-object/transfer retry guidance. Packaged-native qualification, actual
live HTTPS/SSH transfer acceptance, safe prune and locking remain.

Sources: official Git LFS ls-files documentation and pointer specification;
MIT-licensed canonical command sources were behavior references only.

## Effective file attributes without hydration

The LFS tracking dialog accepts a literal repository-relative path and compares
five relevant attributes in `git check-attr -z` and its `--cached` view. It does
not implement an attribute parser or flatten pattern precedence: Git resolves
macros, nested/root rules and info/global/system sources. Complete records must
match the requested path and attribute order; oversized/truncated, non-UTF-8,
missing or malformed responses are errors. Traversing/absolute/metadata paths
are refused. Paths need not exist or be tracked.

Real Git fixtures verify nested working/index differences, macro/global/info
precedence, staged fallback when working attribute files are missing, literal
wildcard/space/option-looking names and sparse-excluded directories. Sparse-index
bytes, HEAD and excluded-file absence stay unchanged. This is a read operation,
not hydration, staging or an LFS installation check; it runs without `git-lfs`.
Views are sequential observations and can diverge under external edits.
Raw values are displayed, not inferred from the pattern listing; Git's reserved
status words can also be literal custom values.

UI retains invalid input, focuses errors/results, clears old output on edits,
blocks dismissal during a read, guards repository switching and resets path on
reopening. Browser journeys use mocked IPC; packaged Tauri acceptance remains.

Sources: official Git check-attr and gitattributes manuals. No code was copied.

## Reviewed Git LFS file locking

Observed behavior with Git LFS 3.7.1 against a local test lock server:

- `git lfs locks --verify --json` returns `{ours, theirs}` but reports an empty
  list with a successful exit when the server is unreachable or lacks locking,
  so a plain-text `locks --verify` probe confirms the server answered;
- `git lfs lock` accepts paths that are not tracked, so tracked status is
  checked first; a refused lock exits with a reason and an empty JSON list;
- `git lfs unlock --id` refuses files with uncommitted changes unless forced,
  and makes lockable files read-only again.

Git Khronos lists locks only on request, refuses existing locks and untracked
paths before locking, confirms the new lock in Git LFS's JSON reply, rechecks
the server list (id, path, owner and ownership) before unlocking, refuses dirty
files before an unforced unlock, and requires a separate warning review before
forcing a collaborator's lock. Files, index and references are not changed.

Implementation source: Git LFS manuals and locking API documentation, plus
black-box observation of the CLI. No Git LFS implementation code was used.

## Reviewed root Git LFS tracking-rule removal

Git LFS's documented `track --json` list is presented with original pattern,
source, lockable and tracking/exclusion fields. Root tracked rules can be
reviewed; nested, external and exclusion rules remain read-only in this scope.
Removal leases HEAD/branch, root working text/type/mode and root index entries,
rejects unmerged or unsafe attributes, then delegates to Git LFS and verifies
the selected root tracking rule disappeared, other lines match the reviewed
result, and index/HEAD/branch/permissions stayed unchanged. Macro definitions,
indirect/quoted rules without a direct match and misleading `filter=lfs`
substrings are refused before editing. It does not convert pointers,
rewrite history, remove objects, restore lockable permissions or stage changes.
Git LFS may normalize line endings and remove additional attributes on matching
LFS lines. Overlong lines are refused to prevent silent CLI rewrite truncation.

Pattern commands are given a private command-local hook directory; their
implicit hook installation never targets configured repository/shared hooks.
Only that owned directory's known hook files are cleaned up, and cleanup failures
are explicit. Repository-local LFS format metadata can be initialized by the
CLI. External processes are not locked out; no transaction or rollback is
claimed. The dialog retains failed review, offers explicit reload, guards
repository switching, blocks dismissal during mutations and manages keyboard
focus. Global duplicate error toasts are suppressed while this dialog displays
the error, so they cannot obscure its retry controls.

Behavior was qualified with original actual Git/LFS 3.7.1 fixtures and mocked
renderer journeys. Older JSON-capable LFS versions and packaged Tauri still need
qualification. Object/transfer diagnostics, selective
hydration, safe prune and locking remain unfinished.

Sources: official Git LFS track/untrack manuals, Git's hooks-path documentation
and MIT-licensed canonical command sources (behavior reference only).

## Reviewed linked-worktree move

The action checks the selected registration's HEAD/branch, current/locked/missing
state, linked `.git` marker, unused destination and outside-source parent before
delegating to `git worktree move` without force. The desktop additionally refuses
an open source repository tab, comparing canonical paths. Main worktrees,
unsupported submodule-containing moves and filesystem failures are explicit.
Working/index files and branch occupancy survive successful moves.

The dialog retains failed destination choices, blocks submission after repository
switch, disables edits/dismissal while moving, traps focus, and restores focus to
the moved row or compact-window panel control. External filesystem/Git processes
are not excluded: this is not a transactional filesystem move or rollback
guarantee. Prune and packaged acceptance remain unfinished.

Source: [Git worktree manual](https://git-scm.com/docs/git-worktree).
Implementation and actual-Git fixtures are original.

## Verified repair after an external worktree move

The original registered path must be missing. The actual linked directory's
bounded ordinary `.git` file must resolve to a direct registration in this
repository's common `worktrees` directory, and its absolute backlink must match
the selected old path. HEAD/branch and links are rechecked before Git repair.
The resulting path, backlink and HEAD/branch are verified before success.
Files, index and branch refs are not modified by this workflow.

Git's repair command can rewrite other broken worktree links even when passed
one path; local fixtures exposed that behavior. Other existing registrations
must therefore have consistent reciprocal links and common-directory pointers
before running this focused action. Other missing entries remain registered.
Locked/current/open worktrees, existing-source copies, symlink/malformed links,
relative backlinks and submodule index entries have explicit refusal and local
Git guidance. Nested submodule repair and main-repository relocation are not
claimed. External filesystem/Git races remain possible; there is no rollback or
pruning guarantee. The dialog retains refused paths and restores keyboard focus.

Source: [Git worktree manual](https://git-scm.com/docs/git-worktree) and original
black-box local Git fixtures. No third-party implementation used.

## Explicit branch fetch and prune scope

The separate options workflow fetches one remote or every configured remote into
its standard tracking-branch namespace. Explicit refspecs, empty `--refmap`,
`--no-all`, `--no-tags` and `--no-prune-tags` isolate the action from configured
mirror/custom/tag mappings. Pruning is an explicit opt-in and overrides ordinary
configured pruning defaults. It uses fetch URLs, not separate push destinations.
Nested/overlapping remote names, potentially shared custom tracking mappings
from other remotes, and resolved symbolic aliases pointing outside the chosen
namespace are rejected before any update. Loose references are inspected because
Git enumeration omits dangling symbolic aliases; unresolved aliases also block
fetching instead of reporting an apparently successful fetch that silently
skipped the broken tracking branch. This scoped action requires file-based
reference storage; other storage formats are explicitly refused.

Each remote uses Git's `--atomic` reference update option. All-remotes execution
is sequential, not a cross-remote transaction; failures/cancellation report the
affected remote and previously completed count. External processes remain able
to modify repository state. The renderer retains options on error, exposes
cancellation and refreshes actual state. Local branches, tags, index and working
files are not destinations of this action.
Ordinary configured-refspec fetch/pull and automatic fetch are unchanged.

Source: [Git fetch manual](https://git-scm.com/docs/git-fetch).
Implementation and real-Git behavioral fixtures were written independently.

## Checked conflict resolution

Conflict previews lease HEAD, symbolic branch, exact selected unmerged stages,
working-file type/mode and unfiltered object hash (or symlink target).
State is checked across preview reads and before text replacement. Missing blobs
are read errors, never interpreted as deleted sides. Content previews are bounded
at 256 KB; binary, invalid UTF-8, oversized, symlink and gitlink conflicts cannot
be saved through the text editor.

Text output is synced to an exclusively created temporary file and renamed before
literal-path staging. Failed staging reports saved but unresolved output.
Complete-side actions use Git index stages, including actual deletion rather than
empty-file substitution. The UI explains rebase meanings, retains failed editor
output, provides explicit reload, guards repository identity and traps keyboard
focus. Gitlinks are explicitly unsupported by these side/text actions.
External Git/filesystem races are not transactional; broader complex conflict
resolution and configured local tools remain unfinished.

Sources: Git's `git-checkout`, `git-ls-files`, `git-cat-file` and `git-hash-object`
manuals. Implementation and behavioral fixtures are original.

## Partial staging of new files

New-file patches apply directly to the index with `git apply --cached`; no
full-file or intent-to-add staging is performed first. Native selections compare
the current complete UTF-8 diff with the displayed preview. Truncated previews,
invalid selections and non-text diffs are refused before index mutation.
Partial unstage retains unselected new-file contents by expressing an ordinary
content edit, and removing all selected contents removes the new index entry.
Working bytes stay unchanged. Unborn whole-file unstage force-removes only the
index entry, including when its staged contents differ from the working copy.

Paths are literal, diff prefixes are fixed, and external diff/text conversion
is disabled. Git attributes still apply; executable new-file metadata follows
effective `core.filemode` rather than no-index filesystem mode alone.
Behavioral fixtures cover unborn and committed repositories, unusual paths,
other staged entries, missing final newlines, CRLF, executable bits, stale
working/index state and failure without unintended index entries.
As with other local workflows, external Git processes are not locked out.

Sources: Git's `git-apply`, `git-diff`, `git-config`, `git` and `gitattributes`
manuals. The selection implementation and tests are independently written.

## Durable reset checkpoints

Native reset previews lease HEAD, symbolic branch identity, exact index entries,
tracked worktree diffs and ordinary status. Captured index trees and worktree
diffs are checked against that state, then state and obstructions are rechecked
immediately before mutation. Recovery uses non-destructive `git stash create`,
owned protected references and a synced bounded JSON journal in the individual
worktree's Git directory. Soft/mixed/hard behavior remains Git-owned.

Reset does not recurse into submodules. Hard resets refuse untracked/ignored
destination collisions, nested repositories and initialized gitlink removal.
Recovery creates a new branch at the original HEAD and uses `stash apply --index`
without dropping the protected capture. It requires a clean repository and checks
ignored destination collisions before branch creation. Removal leases only the
record's owned direct references and never dereferences symbolic aliases.

Native behavioral fixtures cover staged/unstaged separation, binary/empty/deleted
files and symlinks, stale state, obstructions, capture failures, linked worktrees,
GC retention, journal tampering, direct-ref ownership and ordinary graph isolation.
Internal refs are excluded from default graph/search tips and decorations, not
explicit immutable-OID inspection. External Git processes are not locked out,
and filesystem failures are not transactional; failures retain captures and
report partial effects rather than promising rollback.

Sources: Git's `git-reset`, `git-stash`, `git-update-ref` and `git-log` manuals.
No external implementation or proprietary assets were used.

## Branch and stash deletion checkpoints

Before Git deletes a local branch, including a branch deleted with its
worktree, Git Khronos protects the branch tip in the same owned recovery
namespace and journal. Git removes a deleted branch's reflog, so the reflog
alone cannot recover it. Before a stash entry is dropped, the reviewed stash
commit and its first parent are protected. The entry is re-resolved just before
the drop, so a shifted `stash@{n}` index cannot drop a different entry. When
Git refuses (for example an unmerged branch without force) and the original
reference is verifiably unchanged, the unused capture is removed. Otherwise it
is retained because effects may be partial. Restoration reuses the reset
capture path: a new named branch at the saved commit, plus `stash apply --index`
for stash captures, which also restores the stash's untracked part.

Native fixtures cover unmerged refusal without leftovers, a missing branch,
forced deletion, restoration after reflog expiry and `gc --prune=now`, stale
stash indexes, and dropping a middle stash entry.

Sources: Git's `git-branch`, `git-stash`, `git-update-ref` manuals.
No external implementation or proprietary assets were used.

## Selective stash and explicit checkout handoff

Stash options delegate literal selected paths, untracked inclusion, keep-index
and staged-only semantics to Git. Staged-only is guarded at Git 2.35.
Index-restoring apply validates the selected immutable stash object and keeps
the stash. Recovery branches start from the stash's original parent, preserve
staged/unstaged separation and intentionally do not drop the source stash.
Stash-and-checkout checks both selected branch tips before saving changes and
never silently applies them on the destination.

Behavioral source: https://git-scm.com/docs/git-stash.
Implementation and fixtures were written independently; no external code or
proprietary interface identity was copied.

## Selected reference lifecycle

Local tag deletion preserves the raw tag object before an expected-object
delete. Signed tags use the configured Git signer. Selected tag pushes pin the
local object and explicitly disable follow-tags, mirroring and recursive
submodule pushes. Remote tag/branch deletion uses an exact-object lease.
Tag deletion previews resolve the selected remote's single push destination,
including separate push URLs. Remote configuration validates both URL inputs
before writing and reports partial configuration failures explicitly.

Real SSH fixtures qualify annotated target/message, refusal to overwrite an
existing tag, unknown/revoked signer and tampered-object failures, missing-key
creation without a partial reference, and deletion/recovery of the exact signed
object with successful verification after restoration. HEAD, staged/unstaged
contents and configuration remain unchanged. Optional isolated OpenPGP and
offline-X.509 fixtures also qualify annotated targets, verification, missing-key
refusal without a partial tag and explicit corrected-signer retry. OpenPGP
unknown trust may still pass Git's cryptographic verification; the app neither
changes that policy nor creates trust entries. X.509 checks retain the existing
test-only offline CRL/Dirmngr scope, not production revocation-policy changes.
Renderer journeys retain annotation/signing after refusal, verify the exact
selected tag, expose explicit refusal versus success and never transport a tag
as a side effect of signature verification. They use mocked IPC.
Reference-menu placement acceptance checks exact pointer anchoring when the
menu fits, height-aware clamping when it does not, and the existing eight-pixel
viewport gutter; a stale fixed-position expectation no longer confuses correct
clamping for a positioning regression.

Behavioral sources: Git's `git-tag`, `git-push`, `git-update-ref` and
`git-remote` manuals. No upstream code, assets or proprietary wording was copied.

## Explicit pull choices and local integration refusals

The three app pull modes now explicitly select both rebase and fast-forward
behavior: merge uses `--no-rebase --ff`, fast-forward-only uses
`--no-rebase --ff-only`, and rebase uses `--rebase --ff`. This prevents
configured `pull.rebase`, `branch.<name>.rebase`, `pull.ff` or `merge.ff` from
contradicting the chosen menu mode. No persistent Git configuration changes.
Other Git policies, including hooks/signing and configured autostash, remain.

Original real-Git fixtures use owned local bare remotes and publishers.
They check exact divergent merge parents without local replay, fast-forward-only
refusal with refreshed tracking tip and preserved local contents, rebase with
the remote as its sole parent and retained changes, exact-tip fast-forward
under every mode, conflict state and explicit abort back to the local tip,
overlapping staged/unstaged preservation with fixture autostash disabled,
missing/deleted upstream and removed-remote refusal. Pruning a deleted upstream
retains its configured name with gone tracking state, not an invented replacement.
Ordinary checkout and both safe/force branch deletion respect occupied linked
worktrees and retain both trees' staged/unstaged data.

Only recognized local pull diagnostics select project-written divergence,
integration, upstream or local-change guidance. Raw transport output is never
propagated; auth/host-key diagnostics retain priority. Known local failures
after an authentication prompt are not mistaken for rejected credentials.
Synthetic fixtures include carriage-return rebase progress, redaction and
non-pull command isolation. Unrecognized failures retain explicit transport
failure, without asserting unobserved local success.
Renderer fixtures qualify per-command selection independently of the saved
default, truthful error refresh, conflict continuation/abort, draft preservation
and explicit retry. Rebase progress is not falsely described as always
interactive. These mock IPC, not packaged native transport.

Sources: public Git pull/branch documentation and independent observations.
No upstream implementation or proprietary identity copied.

## Interactive fixup and recovery preflight

The existing linear local-branch interactive plan accepts an explicit `fixup`
action and emits Git's documented todo command. It combines changes into the
preceding retained commit without appending the fixup message. `squash` keeps
its existing message-combination behavior. The full plan is validated before
writing support files: dropped rows cannot receive either combination, and
reword messages require bounded, nonempty, NUL-free content. Membership and
unique-commit checks remain.

Before execution, Git's update-ref creates a protected recovery reference
for the original source tip. Failure prevents checkout or support modification.
Successful or interrupted rebase retains the reference; no remote rollback,
filesystem transaction or arbitrary hook-effect backup is promised.
Native fixtures qualify retained message/combined tree and later independent
commit, fixup after dropped rows/reword, original-history recovery on a new
branch, invalid combination/reword refusal without ref/index/support changes,
recovery namespace obstruction before checkout and conflict/abort with the
protected source and target intact.
Renderer fixtures qualify explicit IPC actions, keyboard `F`, Reset,
recipient drop/reorder without silent action conversion and compact control
bounds. Plans include the repository identity, switch invalidation and a request
generation for late preparation. Renderer fixtures qualify switch dismissal,
explicit stale-execution refusal and no late opening after switching away/back.
The native selector also retains existing squash/reword/conflict tests.
Selected ranges, guided splitting, explicit autosquash preview, root/onto and
merge-preserving replay are qualified separately in their sections.

Sources: official Git rebase and update-ref documentation; independent
implementation and fixtures, no copied upstream source or interface identity.

## Complete, bounded interactive rebase plans

Preparation and execution refuse active merge/cherry-pick/revert/bisect state
and source branches checked out in another worktree, including missing or
locked registrations. Exact canonical worktree identity distinguishes nested
linked worktrees from their containing main worktree. No recovery reference,
support file, checkout or replay is created on these refusals.

The planner bounds topology to 500 commits and complete serialized commit
metadata to 2 MiB, with individual messages limited to 256,000 bytes.
Limit crossings refuse the whole plan instead of offering a truncated replay.
NUL-delimited fields replace ambiguous control-character separators; UTF-8,
record completeness, unique full OIDs and exact topology/log sequence are
validated. Message whitespace and embedded record/field control characters
are preserved, and notes/signature-display configuration does not alter the
metadata. Unsupported text is refused rather than decoded lossily.
Source and target history reads use explicit `refs/heads/` references, as does
the replay target. A real-Git fixture first reproduced colliding tags selecting
the wrong source history, then qualified the intended source sequence, target
ancestry, final tree and unchanged tags with explicit local-branch references.

Original real-Git fixtures exercise exact commit-count acceptance/refusal,
oversized total and individual messages, malformed text, control characters,
active-operation markers and nested/locked/missing worktrees. Parser fixtures
exercise missing terminators/fields, duplicate OIDs, invalid OIDs and NUL
ambiguity. Renderer journeys qualify visible refusal guidance and explicit
retry without opening or executing a partial plan.

Sources: public Git log/pretty-format/worktree documentation and independent
fixtures. No external implementation, assets or documentation prose copied.
These safety limits are shared infrastructure; selected-range, guided split,
autosquash, root/onto and merge-preserving behavior have separate qualification.

## Intentional interactive rebase Edit stops

The independently implemented editor emits Git's documented `edit` todo action
and exposes `E` as a row shortcut. Git replays that commit and pauses successfully.
Native status separately reports the Git rebase backend's amendment
marker; conflict counts take precedence in the displayed workflow. Success with
an active rebase preserves support files for later reword steps rather than
cleaning them prematurely. Completion or abort clears support as before.

The application deliberately requires an explicit amendment/commit before
Continue at a dirty Edit stop. An original real-Git fixture observed that plain
`git rebase --continue` can automatically commit staged changes; native and UI
guards prevent that unreviewed action here. Clean Continue leaves the replayed
commit unchanged. Multiple Edit stops, Edit followed by Reword/Fixup, amend
success, hook refusal/retry, conflict-before-stop and abort-after-amend are
qualified with disposable repositories and exact trees/messages/ancestry and
retained original-tip recovery. No hook/signing policy is bypassed.

Renderer fixtures qualify the exact Edit IPC action, shortcut, truthful pause
activity (never premature completion), dirty Continue disabling, staged Amend
with retained draft on refusal, explicit retry, unchanged Continue and Abort.
The status equality guard includes the Edit marker so same-count refreshes can
change the reported stop. Guided split/root/onto/ranges/autosquash and
merge-preserving workflows have separate reviews and qualification.

Source: official Git rebase documentation and original black-box fixtures.
No upstream source or distinctive product interface copied.

## Reviewed autosquash grouping

The editor explicitly previews fixup!/squash! grouping on an all-Pick plan.
It matches earlier unique exact subjects or full/unique abbreviated IDs (at
least four hex characters), resolves nested marker targets to their retained
root and moves matching rows after that root in stable source order. Message
drafts, unique membership and independent-row ordering remain intact.
Existing manual actions, duplicate IDs, unsupported amend! markers and any
ambiguous/unmatched target refuse the entire preview without partial changes.
This deliberately does not implement Git's partial-subject matching or
amend! message-replacement variants. Reset restores the original plan; Start
Rebase remains a separate explicit action using existing native validation,
recovery and plain fixup/squash todo commands, not a second native matcher.

Original unit fixtures qualify exact/hash/nested matching, stable grouping,
atomic refusal and input immutability. Renderer fixtures qualify visible
preview/refusal, retained manual reword draft, Reset and exact final IPC order.
A real-Git fixture replays the reviewed reordered plan and verifies exact final
tree, retained target/squash messages, discarded fixup message, independent
commit order and original-tip recovery.

Source: public Git rebase documentation. Independent matcher, UI and fixtures;
no external implementation copied. Broader matching variants remain unsupported.

## Rebase reorder interaction alternatives

The independently designed editor supplies Move up/down controls and focused
row Alt+Up/Down as alternatives to drag ordering. Moves preserve exact row
objects/actions/message drafts and root-owned plan state. Boundary controls
are disabled. Moved rows regain focus after Angular's keyed DOM move and
scroll into view; a polite atomic announcement provides commit and position
context without replacing focus. Text fields keep normal cursor navigation.
Invalid Fixup/Squash recipient placement stays visible and disables Start;
neither moving nor resetting implicitly runs Git.

Renderer fixtures qualify compact target bounds of at least 24 CSS pixels,
focus restoration, selected-row action shortcuts, preserved reword drafts,
boundary no-op, Reset, no IPC before Start and exact final native order.
The native rebase validation/recovery contract is unchanged.

## Recoverable bulk discard

Git Khronos independently derives unstaged changes from complete porcelain
status and binary, full-index Git diffs. A server-held preview captures the
affected paths and index state; execution rejects changed previews and applies
the checked reverse patch without modifying the index.
Conflicts, gitlinks, nested repositories, ignored paths and unselected files
are not recursively removed. Recovery patches remain in the worktree Git
directory and are reapplied only after Git validates the current files.

Behavioral sources: Git's `git-status`, `git-diff`, and `git-apply` manuals.
No third-party implementation code or proprietary assets were copied.

## Private checkpoint references in commit history

Independent implementation:

- By default, initial snapshots, offset-based pages, and incremental history
  walks exclude `refs/copilot/checkpoints/*` as traversal roots and as commit
  decorations. A per-open-repository setting can include them instead.
- Hiding checkpoints never deletes references. Commits reachable through normal
  branches, tags, remote references, or HEAD remain visible even when a
  checkpoint also points to them.
- A user may explicitly delete one loose or packed checkpoint reference after
  reviewing a warning. Deletion is restricted to that namespace and guarded
  by the reviewed object ID; a moved or missing reference is rejected.
- If a branch's short name resembles a checkpoint reference, history uses
  unambiguous full reference names so their actions cannot be confused.
- Other custom references and stash history retain their existing behavior.
- Refreshing history resets the incremental cursor from live references, so
  deleted references cannot retain unreachable commits in later pages.

The implementation uses Git's public `--exclude`, `--decorate-refs-exclude`,
and `update-ref` options. No proprietary implementation or assets used.

## Repository tab utilities

Documented behavior:

- A repository tab menu keeps common repository and tab-management actions close to the selected tab.
- Batch closing clearly identifies whether it affects tabs to the right or every other open repository.
- Focused tabs expose the same menu through standard context-menu keys.

Independent implementation:

- Git Khronos presents repository identity, terminal and folder access, favorite state, display-name editing, and close actions in a project-designed menu.
- Closing multiple repositories uses the same draft, terminal, recently-closed, and persistence paths as closing one tab.
- Counts beside batch actions make their scope visible before activation, and unavailable actions remain disabled.
- Directional keys traverse enabled actions, while Escape restores focus to the originating tab.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Repository-local author identity

Documented behavior:

- Git resolves `user.name` and `user.email` from its layered configuration when creating commits.
- Repository-local values override broader configuration only for the current repository.

Independent implementation:

- Git Khronos displays the effective author identity and offers an explicit editor for repository-local values.
- The native layer validates single-line, non-empty values and delegates persistence to `git config --local --replace-all` using argument arrays.
- The application does not create an account or store identity data outside Git configuration.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Repository terminal tab navigation

Documented behavior:

- A repository may keep multiple independent terminal sessions open in a tab strip.
- Left and Right Arrow move between terminal tabs, Home and End select the boundaries, and focus follows selection.
- Ctrl+PageUp and Ctrl+PageDown cycle sessions, while Ctrl+Shift+T and Ctrl+Shift+W open and close sessions.

Independent implementation:

- Git Khronos uses project-owned session state and native pseudo-terminal commands behind a WAI-ARIA tab interface.
- Each terminal tab and content panel has a unique repository-scoped relationship, and inactive tabs leave the keyboard sequence.
- The shortcut routing is limited to the visible terminal panel and does not change repository-tab behavior.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Focused diff file identity

Documented behavior:

- The central diff keeps the active file name readable while retaining its repository-relative directory and revision context.
- The complete path remains available as a tooltip and through an explicit copy action.

Independent implementation:

- Git Khronos derives the name and directory from its existing repository-relative path and adapts the header with project-owned responsive styling.
- No additional file reads or Git commands are required when switching files.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Changed-file navigation in the central diff

Documented behavior:

- A focused diff keeps the repository context panels visible while presenting one changed file in the center workspace.
- Previous and next controls move through the currently displayed file ordering without closing the diff.
- Alt+Up and Alt+Down provide the same navigation from the keyboard.

Independent implementation:

- Git Khronos derives navigation targets from its own filtered path/tree lists for working changes, commits, and comparisons.
- Navigation reuses the existing asynchronous inspection APIs and request guards, so stale file loads cannot replace a newer selection.
- The toolbar controls, counter, shortcuts, and visual treatment are project-created.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Keyboard-accessible workspace splitters

Documented behavior:

- The left reference panel and right commit panel can be resized with either a pointer or a keyboard.
- Every visible commit-graph column exposes the same keyboard-resizing model from its header boundary.
- Stacked reference sections expose horizontal splitters and retain automatic sizing until the user adjusts them.
- The repository terminal exposes the same bounded horizontal splitter model and restores its saved height across application sessions.
- A focused vertical splitter reports the controlled panel, its current width, and its permitted width range.
- Directional arrows move the physical divider, Shift selects a larger step, and Home or End select the bounded extremes.

Independent implementation:

- Git Khronos applies project-owned width bounds and persists the resulting pixel width in local application storage.
- Double-click restores project defaults or automatic section sizing, while the graph column fits the currently required branch-lane width.
- The implementation follows the public WAI-ARIA window splitter semantics and does not depend on another application's code or assets.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Keyboard-accessible graph and reference actions

Documented behavior:

- Focused graph rows expose their action menus through the standard Menu key or Shift+F10.
- Local branches, remote branches, and tags expose the same actions from every interactive reference surface.
- Directional keys move through enabled actions, while Escape closes the menu and restores graph focus.

Independent implementation:

- Git Khronos positions the existing project-designed commit or stash menu beside the focused row.
- Reference menus reuse the same focus, directional-navigation, and return-to-origin behavior in the Left Panel, graph, and commit inspector.
- Focus moves only after the conditional menu view has rendered and returns without scrolling the graph.
- Disabled actions are excluded from keyboard traversal.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Lazy annotated-tag previews

Documented behavior:

- Hovering or focusing a tag can reveal its annotation and tagger context without navigating away from the graph.

Independent implementation:

- Git Khronos waits for a deliberate hover before requesting one exact tag through Git's public `for-each-ref` interface.
- Preview output is bounded, stale requests are ignored, and successful results are cached by repository, tag name, and target object.
- Initial repository snapshots remain unchanged, so repositories with thousands of tags do not pay annotation costs before the workspace is interactive.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Large-repository first-frame snapshot

Documented behavior:

- Repository tabs should become interactive without waiting for optional metadata on every inactive branch.
- The current branch still needs immediate upstream and ahead/behind information.

Independent implementation:

- Git Khronos's latency-sensitive snapshot reads every local and remote branch name, object ID, and upstream name without asking Git to traverse each branch history.
- Current-branch divergence is retained from the bounded status query.
- Annotated tags and the broader working-tree snapshot hydrate after the first usable frame, avoiding an eager object walk in tag-heavy repositories.
- Full git-core snapshots preserve complete per-branch tracking metadata for callers that explicitly request it.
- Inactive saved tabs restore after the active workspace is interactive instead of competing with its first render.

## Bounded commit graph lanes

Documented behavior:

- History scrolling should remain responsive as older pages are appended.
- The graph should preserve useful nearby parent and merge relationships inside its visible column.

Independent implementation:

- Git Khronos extends an append-only graph-layout cache when another history page arrives instead of rebuilding every earlier row.
- Active lanes are bounded by the number that can fit in the configured graph column, with a hard safety ceiling.
- DOM virtualization and bounded per-row SVG edges keep rendering cost proportional to the visible graph instead of the repository's total ref fan-out.

No proprietary implementation details were used.

## Readable default interface scale

Documented behavior:

- Repository navigation, graph metadata, file lists, forms, and status text should be readable at the default 100% interface zoom.
- Zoom remains an optional workspace preference rather than a prerequisite for ordinary use.

Independent implementation:

- Git Khronos uses a 12 px floor for primary application text at 100% zoom while retaining larger heading and editor-specific type scales.
- Tiny non-textual initials and corner annotations retain compact dimensions where enlarging them would obscure their container.
- Renderer coverage checks the graph, sidebar, toolbar, file list, commit form, and status bar as distinct interface regions.

No proprietary source code, fonts, assets, or visual measurements were copied.

## Platform-aware keyboard shortcut labels

Documented behavior:

- Desktop shortcuts use Command and Option terminology on macOS.
- Windows and Linux use Ctrl, Alt, and F11 terminology.

Independent implementation:

- Git Khronos derives display labels from the browser platform exposed by the native WebView.
- Command handling continues to accept the platform's native modifier keys; only the teaching labels vary.
- A pure platform mapping and renderer journey cover both the mapping and the Linux presentation.

No proprietary source code, assets, wording, or implementation details were used.

## Branch checkout undo and redo

Documented behavior:

- A successful branch checkout is available as the most recent undoable action.
- Undo returns to the previously checked-out branch; redo reapplies the checkout.

Independent implementation:

- Git Khronos records only the before/after local branch names returned by its own repository snapshot.
- Undo and redo reuse the validated public `git switch` command path and refresh the repository afterward.
- Failed, detached, or no-op checkouts are not recorded as reversible actions.

No proprietary source code, assets, wording, or implementation details were used.

## Branch rename undo and redo

Documented behavior:

- The toolbar Undo and Redo controls expose the most recent supported repository action.

Independent implementation:

- Git Khronos records the validated old and new local branch names only after a successful rename.
- Undo and redo call the same validated branch-rename command with reversed arguments.
- If either expected branch name no longer exists, Git rejects the operation instead of overwriting unrelated state.

No proprietary source code, assets, wording, or implementation details were used.

## Commit-producing action undo and redo

Documented behavior:

- Successful commit-producing actions can become the most recent undoable action.
- Multi-commit cherry-pick participates in the same one-step Undo/Redo workflow.

Independent implementation:

- Git Khronos records the repository's before/after HEAD identifiers after successful commits, message edits, cherry-picks, and revert commits.
- Undo and redo use a guarded soft HEAD move and fail if repository history changed after the recorded action.
- The guard preserves unrelated external Git activity instead of guessing how history should be rewritten.

No proprietary source code, assets, wording, or implementation details were used.

## Commit graph date formatting

Documented behavior:

- Date and time presentation is an app-wide UI preference.
- The selected presentation applies consistently to commit graph rows.

Independent implementation:

- Git Khronos provides compact locale-aware, relative, and ISO 8601 modes using browser internationalization APIs.
- The preference is stored locally and never changes commit metadata.
- Formatting controls and visuals are original to Git Khronos.

No proprietary source code, assets, or implementation details were used.

## Repository-wide file history search

Documented behavior:

- A keyboard shortcut opens a focused tracked-file search.
- Matching files expose direct history and blame actions.

Independent implementation:

- Git Khronos queries the public `git ls-files` interface with a validated literal search and NUL-delimited output.
- Native output, result count, and input length are bounded; searches are debounced and stale responses are ignored.
- Results open Git Khronos's independently designed centered history or blame workspace.

No proprietary source code, assets, wording, or implementation details were used.

## Interface zoom presets

Documented behavior:

- The status bar offers 100%, 110%, 125%, 140%, 150%, 175%, and 200% zoom presets.
- Zoom-in and zoom-out stop at the first and last presets.
- Reset returns the interface to 100%.

Independent implementation:

- Git Khronos implements these presets using its own Angular state and Tauri window integration.
- Previously stored values outside the supported range are normalized to the nearest preset.
- No proprietary source code, assets, or implementation details were used.

## Sparse checkout

Documented behavior:

- A repository can limit its working tree to selected directories in cone mode.
- The current selection can be reapplied after other Git operations materialize additional paths.
- Disabling sparse checkout restores the complete tracked working tree.
- A sparse index can reduce index work for large repositories.
- Git keeps modified or unmerged files and populated submodules outside a new selection and reports them only as a warning; set/reapply still succeed.
- `git add --all` succeeds while silently leaving changed tracked files outside the selection unstaged; `git add <path>` for such a file is refused with sparse advice. Commits keep excluded files unchanged in the tree.

Independent implementation:

- Git Khronos invokes the public `git sparse-checkout` interface with validated argument arrays and newline-delimited standard input.
- Repository state comes from documented Git configuration and `git sparse-checkout list` output.
- After set/reapply, paths Git reported as left outside the selection (read under `LC_ALL=C`) become an explicit `sparsePathsLeft` result naming up to five paths; nothing is deleted, the selection stays applied and the repository is refreshed. Owned real-Git fixtures cover a modified file (set and reapply, then clean reapply) and an unmerged merge conflict; a renderer journey covers the disclosed message, hint and refresh.
- In sparse checkouts, Stage all checks porcelain-v2 status afterwards and reports skipped paths as `sparsePathsNotStaged` (in-selection changes stay staged); single-file staging outside the selection becomes `sparsePathOutsideSelection`. A real-Git fixture verifies the populated submodule disclosure, unchanged excluded tree after a sparse commit, and both staging outcomes; a renderer journey verifies the alert and refreshed Git status.
- The UI and confirmation flows are original to Git Khronos; no proprietary code, assets, or visual implementation were used.

## Compact commit graph column

Documented behavior:

- Commit graph settings provide an alternate compact column layout.
- The compact layout reduces the horizontal space needed for branch relationships.

Independent implementation:

- Git Khronos uses its own lane geometry with a smaller lane gap and preferred column width.
- Expanded and compact widths are stored separately per repository, so switching layouts preserves user resizing.
- The resize ceiling is calculated from the peak active-lane count in the loaded topology, allowing every visible branch path to fit without a fixed-width cutoff.
- The graph settings menu and a resizer double-click provide a project-designed fit-to-paths action.
- Twelve project-defined lane colors reduce path repetition in wide histories while keeping reference labels, connectors, nodes, and edges visually associated.
- Commit ordering, topology, row height, and navigation remain unchanged.
- Narrowing the Author column replaces clipped names with project-created initial avatars and an icon header while retaining full identity tooltips.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Guided commit bisection

Documented behavior:

- A binary search starts from one known-bad commit and one older known-good commit.
- Each checked-out candidate can be classified as good, bad, or untestable.
- Resetting the search restores the branch and commit that were active before the search.

Independent implementation:

- Git Khronos invokes the public `git bisect start`, `good`, `bad`, `skip`, and `reset` commands through its validated native command boundary.
- The selected historical commit is presented as the known-good endpoint; the current HEAD remains the explicit known-bad endpoint.
- A project-designed progress bar keeps classification controls visible without reproducing another application's layout or assets.
- Starting is disabled for dirty worktrees, identical endpoints, rebases, or an already-active bisection.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Protected history rewriting

Documented behavior:

- A rewritten local branch may need to replace its upstream history.
- A force-with-lease push refuses to overwrite a remote branch that no longer matches the locally known remote-tracking state.

Independent implementation:

- Git Khronos exposes the public `git push --force-with-lease` behavior only for a local branch with a configured upstream.
- The action is separated from ordinary Push and requires an explicit confirmation that names the branch and upstream.
- An unconditional `--force` path is not exposed.
- Native coverage advances a bare remote behind the client's back and verifies that the stale lease rejects the rewrite without changing the remote reference.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Conflicted merge lifecycle

Documented behavior:

- A merge that cannot resolve automatically remains active while conflicted files are reviewed and staged.
- The merge can be completed after every conflict is resolved or aborted to restore the pre-merge state.

Independent implementation:

- Git Khronos detects the documented `MERGE_HEAD` repository state through Git's resolved metadata path.
- A project-designed status bar exposes Continue and Abort throughout the merge instead of relying on a transient error message.
- Continue uses `git merge --continue` with a non-interactive editor configuration; Abort uses `git merge --abort`.
- Native tests cover both a completed three-way resolution and restoration after aborting a conflicted merge.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Interrupted cherry-pick and revert recovery

Documented behavior:

- Conflicted cherry-pick and revert operations remain active until continued, skipped, or aborted.
- Continue applies the staged resolution, Skip omits the current commit, and Abort restores the state from before the operation.

Independent implementation:

- Git Khronos detects Git's documented `CHERRY_PICK_HEAD` and `REVERT_HEAD` metadata in the same bounded operation-state query used for merge, rebase, and bisect.
- A project-designed history-operation bar stays visible while the sequencer operation is active.
- Every control invokes the corresponding public Git command through validated fixed choices; arbitrary command or option input is not accepted.
- Native fixtures verify both cherry-pick completion and abort, plus revert detection and restoration.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Reviewed merge mainline replay

Public `git cherry-pick --mainline` and `git revert --mainline` define a
1-based parent baseline for applying or reversing a merge difference.
Cherry-pick produces a single-parent commit; revert retains the original merge
ancestry, so later merges do not automatically restore its ancestor changes.

Git Khronos independently adds an explicit parent selector with no default for
single merges. Context-menu, inspector and branch-drop confirmations share the
review and retain choices on hook failure. A real hook fixture observed Git
leaving staged inverse changes without `REVERT_HEAD` after revert commit refusal:
the UI explains explicit staged commit or original-tip restoration rather than
fabricating an active operation or promising replay retry over a dirty index.
Cherry-pick hook refusal retains its active marker and uses explicit Continue.
Repository changes dismiss stale
confirmations and cannot redirect replay after a delayed target checkout.
Mixed selections containing a merge require individual review; all selected
commits are validated before any prefix is replayed. Native execution rechecks
parent validity, requires a clean complete status and no active operation, and
preserves the destination tip under `refs/git-khronos/recovery` before merge
replay. Recovery-reference failure stops execution. Existing Continue/Skip/Abort
handle conflicts. Recovery protects committed history, not arbitrary hook
effects or remote updates.

Real-Git fixtures cover both parent choices, exact trees/ancestry/messages,
missing/out-of-range/nonmerge choices, mixed selections, dirty/active-operation
refusal, recovery failure, hook refusal/staged-state recovery and conflicts/abort for both commands. Renderer
fixtures cover explicit IPC, failure retry, cancellation, compact keyboard
controls and repository switches. Ordinary nonmerge commands retain their
existing default options. Ordered ordinary-commit reverts have a separate
reviewed-list path. No proprietary code, assets or distinctive wording were copied.

## Staged no-commit cherry-pick

Documented `git cherry-pick --no-commit` applies differences to the index and
working tree without creating commits. Git Khronos independently runs reviewed
rows one at a time under a bounded worktree-local JSON journal (1-500 full OIDs,
128 KiB metadata cap). This journal is application metadata, not a public Git
operation marker. Complete clean status/no active operation and visible index
entries are required; the original destination tip is protected first.
Single-merge plans use the same explicitly validated mainline choice.

Authorized tests of owned repositories found that direct single no-commit
conflicts do not leave CHERRY_PICK_HEAD and multi-pick `--continue` can refuse a
staged resolution. The independent application sequence therefore marks known
conflicts for explicit stage/Continue without an implicit commit. Before each
step, an atomic journal update records an uncertain applying phase; a crash or
nonconflict Git failure cannot cause a hidden repeat or skipped row. On Unix the
journal file and its containing directory are synchronized before application.
Journal removal also synchronizes the containing directory on Unix.
All status/control calls reload the journal, including after restart. Operation
paths are derived from the absolute worktree-local Git directory without
splitting literal whitespace or newlines in filesystem paths.

Abort invokes public `git reset --merge` only while the original HEAD and branch
still match; Git refusal leaves later conflicting unstaged edits intact.
Finish manually deletes only the application journal and preserves index,
working files and conflicts. Skip is intentionally unsupported. A competing
native Git sequence, moved HEAD, malformed metadata or journal write failure
fails visibly rather than guessing. Committing while the sequence is active is
refused natively; after completion the user explicitly supplies a message and
current identity. Empty effects do not create a commit. Hooks/signing are not
disabled and apply when the user later commits.

Native fixtures verify exact combined trees, both merge parents, independent
manual author/message/ancestry, restart-style reload, staged resolution plus
remaining order, abort/untracked retention, quit/index equality, dirty/hidden/
active/missing-object/size/recovery failures, stale/uncertain state, empty effects
and malformed metadata, linked-worktree isolation, literal newline paths,
single/repeated conflict stops and actual later commit-hook refusal. Renderer
fixtures exercise exact opt-in IPC, truthful staged feedback, retained
drafts/refusal and conflict controls without hidden commits. Marker-only status
refreshes change the recovery controls even when file counts stay unchanged;
preview manual finish retains staged contents and unresolved conflicts.
No third-party implementation code or assets were used.

## Ordered inverse commit sequences

The official Git revert manual defines a list of commits without traversal,
inverse commits, native sequencer controls and explicit merge mainlines.
Git Khronos independently validates 1-500 distinct full commit IDs and every
selected parent before mutation, refuses merges in a shared ordinary selection,
requires complete clean status and visible index entries, and protects the
original tip before invoking `git revert --no-edit --no-walk=unsorted`.
The graph review defaults to newest-to-oldest selection order and shows each
full-ID-backed inverse row before explicit confirmation.

Owned repository fixtures verify supplied argument order rather than date
sorting or implicit traversal, exact dependent-change inverses, retained
unselected files, new-message order and original ancestry. Native conflict
Continue/Skip/Abort resumes from Git's saved sequence; Abort restores its original
tip including successful earlier inverse commits. An empty inverse requires an
explicit Skip instead of a fabricated successful commit.

Actual first/later commit-hook refusal leaves staged inverse changes and a
native sequencer, sometimes without REVERT_HEAD. Status classifies the saved
operation from only the bounded leading command prefix of worktree-local
sequencer/todo; it never edits Git's sequencer metadata. Unknown or unreadable
sequence state fails explicitly. When a staged inverse lacks a pending commit
marker, Continue requires the user to review and explicitly commit that step
before continuing, or Abort. No automatic author, message or hook bypass is used.
This differs from a single revert whose hook refusal may leave no saved sequence.
No-commit revert is intentionally unsupported.
An active application no-commit journal retains priority: Finish manually can
remove that journal even alongside unknown native sequence metadata, preserving
the conflicted index and all native metadata. Its next native-state inspection
then reports the unsupported sequence explicitly instead of discarding it.

Renderer journeys qualify graph multi-selection, the exact reviewed list/IPC,
retained drafts and refusal, individual-merge refusal, compact keyboard
cancellation, official Git help and existing-sequence Continue/Skip/Abort.
Repository switches during mutation cannot redirect its captured completion or
record another repository's HEAD in the source operation's Undo history.
No proprietary implementation material or third-party code was used.

## Commit signer diagnostics

Documented behavior:

- Git selects a signing backend and optional program from repository, global, and system configuration.
- OpenPGP, SSH, and X.509 signing use different default programs.

Independent implementation:

- Git Khronos reads the effective Git signing format and relevant program setting only when the user requests a diagnostic.
- The diagnostic resolves the configured program or documented default through the repository path and system `PATH` without invoking the signer or requesting credentials.
- The result distinguishes explicit key selection from Git's default-key selection and remains scoped to the active repository.
- Signer checks are deliberately excluded from repository snapshot loading to preserve startup performance.
- Program availability does not establish access to a key, trust or successful
  signing. Diagnostics do not install keys or modify trust configuration.
- One bounded NUL-delimited effective-configuration query selects the format's
  program. OpenPGP legacy and format-specific aliases are resolved in Git's
  configuration iteration order. Missing values alone select documented defaults;
  explicitly empty/valueless, malformed, invalid UTF-8 and excessive output fail
  visibly. Literal whitespace/newline executable paths are retained.
- Rechecking clears cached availability for that repository, so an unsuccessful
  check cannot leave an earlier available-program result displayed.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Reflog recovery history

Documented behavior:

- Git records updates to local reference tips in reflogs and exposes them through `git reflog`.
- A recorded commit can be kept reachable by creating a branch at its object ID.

Independent implementation:

- Git Khronos reads a bounded set of reflog records through the system Git executable with a byte-limited output buffer.
- A project-designed searchable recovery view shows selectors, actions, authors, and abbreviated commit IDs.
- Recovery creates a validated branch reference without checking it out, so the current branch and working files are unchanged.
- Destructive reset is deliberately excluded from the recovery shortcut.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Explicit commit signing

Documented behavior:

- Git can sign a commit with the signing key and format selected by the user's configuration.
- Signing failures abort commit creation instead of silently producing an unsigned commit.

Independent implementation:

- Git Khronos exposes an explicit commit-form option and forwards only a boolean signing request across IPC.
- The native layer asks the system Git executable to sign; private keys and passphrases never enter renderer state.
- Existing `commit.gpgSign` configuration initializes the explicit commit-form option.
- Git Khronos reads identity and signing preferences together in one bounded config query, avoiding additional startup subprocesses.
- The commit checkbox starts from the effective repository default; changing it sends an explicit per-commit sign or no-sign override.
- Preferences display the effective format and key without reading or storing private-key material.
- The inspector verifies only the selected commit, avoiding an expensive signature check across the complete graph.
- Git's status is mapped to original verified, unknown-trust, invalid, expired, revoked, unverifiable, and unsigned presentation states.
- When Git reports no signature, a bounded raw-commit read checks only complete
  object headers for `gpgsig` or `gpgsig-sha256`. A stored signature with no
  verification result is labelled unverifiable, not unsigned. Incomplete headers
  fail explicitly; message text and nested mergetag content cannot establish
  signature presence. Unknown status codes are unverifiable, not unsigned.
- An optional real-SSH fixture generates its own disposable key, verifies scoped
  author/committer/sign-off, configured automatic signing, trusted/unknown/
  unconfigured/revoked verification, explicit unsigned amend and missing-key
  failure. Configuration, dirty files and staged contents remain intact.
  Git may refresh cache-tree metadata in an index during a failed commit; the
  preservation assertion checks actual staged entries, not incidental bytes.
- Unix fixtures verify custom hooks paths and the exact `--no-verify` boundary:
  pre-commit/commit-msg can be explicitly bypassed, but prepare-commit-msg still
  edits messages and can refuse a commit. The interface calls this "Skip checks"
  and discloses that hook side effects are not rolled back.
- Renderer signing/hook refusals retain message and selected policy for explicit
  retry. Online certificate revocation/CA chains, interactive/hardware-key and
  native packaged signing remain unqualified.
- An optional Unix real-OpenPGP fixture uses separate generated-private-key and
  public-only verification homes, no user keyrings or process-global environment
  changes, batch mode and a generated test-only key without a passphrase.
  It qualifies trusted and unknown-trust verification, missing public keys,
  tampered signed content without updating HEAD, failed signing with staged
  contents retained, explicit corrected-signer retry and unsigned amend.
  Format-specific program selection works despite an unavailable legacy alias.
  Cleanup addresses only each owned home's agent and removes its fixture data,
  including during assertion failures.
- An optional Unix X.509 fixture generates an ephemeral RSA certificate using
  the installed OpenSSL CLI, imports its private key only into its own GnuPG home,
  and uses a separate certificate-only home for explicit distrust and missing-key
  signing refusal. Native code preserves configured format/program/key, staged
  contents, dirty files and both fixture trust lists. Signature tampering is an
  owned unreachable commit object; HEAD is never moved to it.
- X.509 wrappers disable Dirmngr and CRL checks only within the isolated fixture.
  No production arguments or trust settings are relaxed. Qualification establishes
  offline signing, cryptographic tamper rejection, explicit distrust failure and
  retry, not online revocation or every trust/CA-chain case. An absent verifier
  trustlist was not treated as guaranteed distrust: explicit certificate distrust
  is used for the actual refusal assertion.
- Selected-commit signature presentation and its existing scoped styling are
  deferred rather than loaded at startup. A reserved neutral loading state never
  implies verification, import failure is explicit and leaves drafts intact, and
  loading completion cannot reopen a dismissed inspector or steal focus.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Application themes

Documented behavior:

- The desktop appearance can be selected globally and persists between sessions.
- Theme switching is discoverable from both preferences and keyboard-oriented commands.

Independent implementation:

- Git Khronos provides project-owned Chronos Dark and Midnight Contrast palettes through CSS custom properties.
- The selected theme is stored locally and applied at the document root so welcome, repository, overlay, and terminal-adjacent surfaces share the same state.
- Palette names, color values, controls, and styling are original to Git Khronos.

No proprietary assets, palettes, source code, or visual implementation details were copied.

## Diff viewer presentation

Documented behavior:

- Diff and editor text size, tab spacing, and long-line wrapping are application preferences.
- The selected presentation is shared across diff layouts and blame views.

Independent implementation:

- Git Khronos stores three bounded local presentation values and applies them through project-owned CSS custom properties.
- Inline, hunk, split, and blame content share the same monospace geometry without modifying repository files or patch data.
- The in-view wrap control updates the same persisted preference as the Preferences dialog.

No proprietary source code, assets, palettes, or visual implementation details were used.

## Default commit graph columns

Documented behavior:

- Branch/Tag, Graph, and Commit Message form the initial graph table.
- Author, Date/Time, and SHA remain available as optional, reorderable columns.
- Column choices are stored per repository.

Independent implementation:

- Git Khronos centralizes its initial visibility policy in a pure project-owned helper.
- Existing per-repository visibility settings continue to take precedence, so upgrades do not overwrite user choices.
- All six columns retain the existing resize, reorder, and settings-menu controls.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Commit graph scroll markers

Documented behavior:

- A narrow rail beside the commit graph identifies important locations such as HEAD, selected rows, and search results.
- Marker visibility can be changed from graph settings.

Independent implementation:

- Git Khronos derives marker positions from its virtual row geometry without adding off-screen commit rows to the DOM.
- Project-defined colors distinguish working changes, HEAD, selections, and search results.
- Large selection and search sets are evenly sampled to keep marker rendering bounded.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Favorite repositories

Documented behavior:

- Frequently used repositories can be pinned in repository management.
- The first nine favorites can be opened with a platform-specific numeric shortcut.

Independent implementation:

- Git Khronos stores an ordered list of repository paths in local application storage.
- Favorites can be added or removed from recent-repository rows and remain available across restarts.
- Existing tabs are activated directly; closed favorites use the normal repository-opening path.
- The star icon and repository-management layout are project-created.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Pull strategy defaults

Documented behavior:

- The pull dropdown exposes fetch, fast-forward/merge, fast-forward-only, and rebase workflows.
- A pull strategy can be selected as the toolbar default independently of running it.

Independent implementation:

- Git Khronos executes each strategy through its existing validated Git command path.
- A project-created star control persists the default locally without starting a network operation.
- Choosing the strategy label runs that mode once without changing the saved default.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Repository tab reordering

Documented behavior:

- Open repository tabs can be rearranged with drag-and-drop.
- The tab order persists with the open repository set.

Independent implementation:

- Git Khronos reorders its own repository-session array and persists only canonical repository paths.
- A project-defined insertion marker indicates whether the dragged tab will land before or after the target.
- Grouped worktree tabs reuse the same deterministic ordering model.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Repository maintenance command

Documented behavior:

- Non-pruning metadata maintenance is available from the command palette and a
  reviewed preferences action. It can take time and use disk space.

Independent implementation:

- Git Khronos requires a complete passing integrity inspection, then invokes
  `git maintenance run --task=commit-graph --task=pack-refs` through its existing
  argument-array execution boundary. Explicit tasks ignore configured enabled
  maintenance tasks. No GC, object pruning, reflog expiry, missing-worktree cleanup,
  prefetch or scheduling is requested.
- The native command runs away from the renderer thread and is serialized with other operations for the same repository.
- Progress and completion are reported through Git Khronos's project-defined activity system.
- The preferences action requires review before running, disables pending actions,
  retains refusal feedback and requires an explicit retry. Reviews and delayed
  local feedback do not transfer to another repository.
- This operation is not cancellable and makes no repair, backup, rollback or
  concurrent-client transaction guarantee. Inspect partial metadata effects after
  failure before retrying.
- Disposable real-Git fixtures preserve dangling objects, reflogs, offline worktree
  registrations, refs, HEAD, index, configuration and working files despite
  aggressive enabled GC/prefetch/expiry settings. A corrupt-object preflight
  refuses maintenance before generating metadata or modifying damaged objects.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Keyboard-first repository and working-tree actions

Documented behavior:

- The command palette can directly open clone and initialization workflows, close the current tab, and run staging or stash actions.
- Individual stashes can be viewed, applied while retained, or popped.
- Local branches can be located and routed into rename or guarded deletion workflows.

Independent implementation:

- Git Khronos exposes its existing repository forms and validated service operations as searchable command descriptors.
- Dynamic stash commands are derived from the current repository snapshot and use encoded stash references at the UI boundary.
- Dynamic branch commands are derived from local references; rename uses an editable dialog and deletion retains the existing confirmation and force-delete guard.
- Destructive actions are not inferred from search text, and commands disable themselves when repository state makes them unavailable.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Hosted review-request navigation

Documented behavior:

- A supported repository remote identifies the hosted repository associated with the local checkout.
- Pull requests or merge requests are reviewed on the repository's hosting page.

Independent implementation:

- Git Khronos parses supported GitHub, GitLab, and Bitbucket Cloud HTTPS and SSH clone URL forms locally.
- Provider-specific terminology and nested GitLab namespaces are retained in the generated destination.
- Only validated HTTPS destinations are passed to the operating system's default browser.
- Unsupported hosting providers retain a neutral empty state; no host API is queried and no credentials are collected.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Isolated worktree terminal handoff

Documented behavior:

- Parallel tasks can use separate Git worktrees so each task has an independent working directory and branch.
- A repository terminal should start in the active worktree and remain available through repository tab changes.

Independent implementation:

- Git Khronos creates the worktree through its existing native Git command boundary and opens it as a normal repository tab.
- Users can choose to reveal the existing multi-tab repository terminal immediately after creation.
- The workflow is tool-neutral and does not assume, install, or invoke a particular coding agent.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Minimum Git version qualification

Observed behavior (real Git builds 2.34, 2.39, 2.43 and 2.53 from the official source):

- `git worktree list --porcelain -z` requires Git 2.36; `git am --empty` requires Git 2.35.
- Before Git 2.40, the `%GT` trust placeholder can abort on signatures that cannot be verified.
- Git 2.39 `tag -s` can report success while writing an unsigned tag when the SSH signing key is unavailable.
- Git 2.39 `format-patch` omits empty commits; Git 2.43 includes them.
- Git 2.39 ignores a `.gitattributes` file excluded by sparse checkout; Git 2.43 reads it.
- Older Git prints `%aI` UTC offsets as `+00:00` instead of `Z`, and submodule URL sync without an upstream uses `origin`.

Independent implementation:

- The supported baseline is Git 2.39; detection reports older versions as unsupported.
- Commit details retry without the trust placeholder when Git reports an invalid trust level.
- Signed tags are verified after creation; an unsigned result is removed and reported as a signing failure.
- Mail-patch export refuses selections whose empty commits Git omitted instead of producing a partial series.
- Attribute inspection refuses sparse-excluded ancestor attribute files on Git older than 2.43.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Committed merge-conflict preview

Requirement: explicitly compare two reviewed branch tips, report Git's conflict
verdict and path list, and preserve the selected repository's HEAD, references,
index, objects and working files. Direction is source into target; results carry
both full reference names and exact commit IDs. Changed or deleted tips invalidate
the result; late replies after cancellation or repository switching are discarded.

Implementation specification: Git's public merge-tree manual, not proprietary
implementation material. The native command runs default merge semantics in a
private bare repository with read-only object alternates. It uses NUL-delimited
path output and exit status, including status 1 with no individual path records.
Temporary merge objects are removed on success, failure and cancellation.
No merge or automatic follow-up mutation is offered by the preview dialog.

Scope: Git 2.43+ with explicit target-commit attribute lookup; committed tips only,
no fetch, no custom merge drivers, partial/shallow
history or replacement refs. Repository-specific merge options and external
attributes are not copied. A clean preview does not guarantee a subsequent merge
with other settings or dirty working contents. Behavioral fixtures cover text,
binary, rename and modify/delete conflicts, SHA-256, stale references,
cancellation, and byte-preserving operation on a dirty repository.

## Independent workspace and collaboration workflows

- Workspace center derives a local overview from Khronos repository snapshots;
  explicit refresh preserves selected repository and commit drafts and reports
  unavailable repositories independently.
- Saved identities are bounded local label/name/email templates, with explicit
  application to local repository Git configuration. They are not accounts.
- The GitHub adapter uses documented REST endpoints through `gh api`, fixes the
  hostname and GET method, validates repository coordinates, builds safe links,
  binds PR checks to a captured head and refuses changed-head review results.
  It does not expose credentials to the renderer or copy provider implementation.
- Earlier builds exposed explicit installed coding-agent CLI launch through the
  terminal PTY. That dedicated launcher was removed; legacy saved profiles remain
  available as terminal profiles without automatic launch or a new default.

UI composition, storage design and code are original Khronos implementations.
See `docs/clean-room-capabilities.md` for precise limits and unfinished scope.

## Hosted read pagination and decision snapshots

Public GitHub REST documentation defines page/state selection, chronological
review events, check-run selection and combined commit-status semantics.
Khronos independently exposes explicit list and detail paging. Issue pages use
the original response count to detect a possible following page before filtering
out pull-request records. A page filter applies only to the loaded records.

Review inspection reads every review-event page to derive the latest submitted
approval, change request or dismissal for each reviewer. Comments and pending
reviews do not replace those decisions. Each decision retains its commit ID;
a decision on another commit is disclosed. This is a decision history snapshot,
not an independent determination of whether provider branch rules permit merge.
Checks and legacy status contexts are requested for the captured head commit.
The pull-request head and selected repository remote are checked again before
returning a result.

Files, review history, checks and legacy statuses have independent availability
flags. A failed section retains a warning while accessible sections remain
readable; absent or unavailable CI data is never presented as passing. Cancelled
requests propagate cancellation and their late renderer results are discarded.

Original owned CLI response fixtures exercise the native command boundary
without forwarding requests to a provider. They do not establish live account,
enterprise-provider or network acceptance. No provider implementation or
proprietary package contents were used.

## Reviewed hosted submissions

An independent GitHub write adapter prepares explicit pull-request creation,
submitted review and merge requests from documented REST fields. The preview
records the selected fetch remote's repository, authenticated account, source and
destination commits and original user text. Creation verifies that the chosen
local branch matches its published source branch, including a selected fork.
A native registry retains the immutable plan; submission consumes its token once,
and context changes or expiry require a new preview.

Authentication is snapshotted separately for each preparation or execution and
pinned for that operation's CLI requests. Preview identity checks use the durable
provider account ID as well as its login name. Tokens remain in the backend and are
never returned to the renderer or placed in command arguments. JSON request text
uses private temporary storage as stdin, without shell interpolation. Provider
writes leave local Git refs, index and working files unchanged.

Execution repeats the account, remote and commit checks. Reviews specify their
commit ID; merges send the expected head SHA. These do not create an atomic lock
on remote branches: creation can race with source or destination movement, which
is disclosed from the creation response. Provider permissions and branch rules
remain authoritative. A failed, cancelled or unreadable dispatched write is
unconfirmed and is never automatically replayed. Definite late confirmation is
retained in activity history even if the submission panel closed.

Original source and renderer fixtures cover these behaviors. Owned packaged
fixtures additionally model account switches, one-use tokens and writes applied
before a lost reply; their current artifact results are recorded separately.
No live provider write, proprietary package inspection or copied implementation
is part of this qualification.


## Reviewed branch workflow desktop controls

Original desktop controls expose the independent branch workflow engine through
repository-bound, one-use native previews. The review shows source/target object
IDs, merge policy, messages, tag signing and conditional topic deletion before
execution. Saved stages support inspected continuation, explicit retry, reviewed
stop and acknowledgement while retaining recovery captures.

The layout uses existing project components, palettes and icons. Renderer
fixtures model cancellation, stale references, repository switches, recovery and
keyboard access. Owned native fixtures check actual Git refs, parent lists,
annotated tags, cleanup and second-target conflict recovery. Current package
qualification is recorded separately; these fixtures do not establish every
workflow case, real signing or all-platform acceptance. No proprietary code,
assets, wording collections or distinctive visual composition were used.


## Account-bound hosted repository discovery core

The original discovery adapter consumes GitHub's documented authenticated
repository list and selected-repository endpoints. Each operation snapshots its
CLI account token, reads the acting account and preserves its decimal identity.
Subsequent pages require the original account identity. Repository selection
checks the returned repository ID again before supplying metadata.

Only bounded, allowlisted metadata leaves this core API. Canonical owner/name,
web and clone URLs must agree; credentials and mismatched destinations are
refused. Missing optional metadata remains unknown. Raw provider responses and
temporary clone tokens are not serialized. Pure owned response fixtures cover
pagination, account and repository replacement, large numeric IDs, malformed
responses and clone destination validation without provider writes.

This source checkpoint does not expose discovery through native IPC or a desktop
screen. Clone handoff, fork creation/readiness reconciliation, local attachment,
enterprise and other-provider behavior remain separate requirements. No vendor
implementation, interface composition or proprietary package contents were used.

## Read-only fork candidates and fresh inspection

An original adapter consumes the documented GitHub fork-list and repository
metadata endpoints. A candidate page is bounded and account/source bound. A
separate inspection checks the owner and repository IDs and confirms ancestry
through the reported fork-network root. Repository names alone never establish
a fork relationship; missing ancestry and failed reads remain explicit errors.

Owned fixtures cover direct forks, forks sharing a network root, ownership and
account replacement, precision-safe IDs, malformed pages, continuation and
cancellation. They submit no provider writes. This source implementation does
not establish native, renderer, creation/readiness, local attachment or
other-provider acceptance. No vendor implementation, package internals, assets,
external source code or copied documentation prose was used.

## Durable fork requests and read-only outcome reconciliation

The new core independently uses documented GitHub owner metadata and fork
creation fields. It persists nonsensitive intent before dispatch and separates
an accepted response from verified fork metadata and readable Git objects.
Repeated execution and another matching active preview do not dispatch again.
Read-only reconciliation validates owner/network identities, pins the first
verified fork ID and checks the exact default-branch reference and commit object.

Owned fixtures inspect the durable record at the provider boundary and model a
lost caller/reply, delayed readiness, replacement, inaccessible or malformed
metadata, cancellation and archive interruption. These fixtures never contact a
live provider. Explicit local acknowledgement of an unresolved outcome compares
the reviewed snapshot and retains the original record; it never cancels a
provider request, proves absence or submits a replacement write. Full source
tests and compile/Clippy checks pass; native and renderer controls, server-held
acknowledgement tokens and local remote attachment remain open. No proprietary implementation, package internals, assets, external
code or copied documentation prose was used.

## Native-owned fork execution and acknowledgement reviews

Original native commands retain fork plans and acknowledgement snapshots in a
bounded context/purpose/lifetime cache. Execution receives a single-use token,
not a client-authored plan or status. Storage is chosen from the application's
private data directory. Reads, dispatch and reconciliation reuse the existing
operation cancellation mechanism; confirmed outcomes remain distinguishable from
cancellation or unconfirmed writes.

Owned source cases cover context/purpose binding, expiry, capacity, replacement,
single use and strict nested control decoding. Generated contracts reject forged
execution plans, replacement acknowledgement snapshots, arbitrary storage paths
and numeric repository IDs at the TypeScript boundary. Source qualification does
not establish the new API's packaged/native runtime behavior or a desktop fork
workflow. No proprietary implementation or assets were used.

## Reviewed hosted repository clone handoff

The desktop catalogue independently exposes the documented GitHub repository
reads and existing Git clone capability. Selection is freshly inspected. A
native-owned plan binds account/repository identities, canonical URL, local
destination, transport and options; execution accepts a context and single-use
token, then revalidates these bindings. Provider tokens are excluded from the
preview and clone URL. Existing Git credential helpers and the SSH agent supply
transport authentication independently of the catalogue account.

Behavioral fixtures cover account changes, paging, canceled reads, immutable
reviews, altered destinations, manual-draft retention, keyboard focus and compact
layouts. Five new packaged cases exercise the real native commands and normal
desktop controls, including real HTTPS/SSH clones redirected to an owned local
source with external Git protocols blocked. Git independently verifies clone
history, branch, shallow state and file contents. No provider write is dispatched.

The exact package passes 166 normal and 167 inherited-environment scenarios; the
full renderer suite passes all 1279 cases. This qualifies the recorded Linux
discovery/clone checkpoint. Full H02 acceptance still requires fork creation,
readiness/uncertain-outcome reconciliation, reviewed remote attachment and further
provider/account coverage remain required. No proprietary code, package contents,
assets or visual composition were used.


## Independent desktop fork controls and clone handoff

An original panel separates bounded fork candidates, fresh owner/network
inspection, provider creation review and saved-outcome reconciliation. Choosing
a verified fork only fills the existing clone review; no clone, fetch, push or
remote configuration change is implicit. Personal/organization scope and branch
scope remain explicit, and unresolved outcome retirement uses a distinct server
review and acknowledgement.

Owned renderer fixtures verify token-only execution, delayed readiness, retained
uncertainty, canceled/late replies, stale acknowledgement refusal, preserved clone
behavior and keyboard/compact layouts. Keyed component instances prevent retired
contexts from surviving coalesced close/reopen or tab transitions. Thirty-two
focused cases pass; the new packaged/native workflow and local remote attachment
remain under development. No proprietary code, screenshots as implementation
specifications, assets, distinctive wording or interface composition were used.


## Project-owned repository links

Capability sources: public product documentation for sharing context and choosing
local copies, RFC 3986 for URI handling, and Git documentation for references,
remote identity and SSH address semantics. See `sources.md` for canonical links.

The version-one Khronos URI grammar, validation, local-copy lookup, fetch-free
session policy and original review dialog were designed independently. Owned
fixtures test observable behavior; no proprietary URL grammar, source, assets,
wording or visual composition was reused. The exact manual-link package passes
391 native executions across normal and inherited-environment suites. A separate
original bounded incoming queue uses the public Tauri transport APIs; 32 focused
renderer cases and five inbox unit cases pass. The Linux OS-transport package now
passes 403 native executions across normal/inherited-environment suites; complete
renderer qualification, cold launcher routing and other platforms remain open. See the repository-link
specification for exact scope, artifact hashes and retained unsuccessful attempts.

### Linux incoming-link renderer qualification

The independently implemented incoming-link candidate passes a fresh complete
1394-case renderer run and 403 actual native scenario executions (201 normal,
202 environment) against the same retained Linux package. Package SHA-256:
`24b73deaf96a89e54e9daf855bf546efb661f94d5496868ecec1b96fa73160fa`.
Executable SHA-256:
`45bd67cb28215d49b9bacb479ad8308eb9805216e09289d2e5947eb4e92bfe96`.
Source, failed attempts and test-only corrections are recorded in the repository-link
specification. Cold desktop-launcher association and other platforms remain unqualified.
No proprietary implementation material or assets were used.

## Reviewed external file programs

The [file-tool candidate](../specifications/external-file-tools.md) extends the public
Git comparison/merge role semantics recorded in the configured-program specification.
Native file snapshots, one-use reviews, direct Child ownership, raw-byte publication,
separate staging and cleanup are independently designed. Owned Git/filesystem/process
fixtures define expected behavior; renderer protocol fixtures exercise the UI without
claiming real execution. No proprietary implementation or assets were inspected or
incorporated. The current package identified in the specification passes 14 normal
and 15 inherited-environment native executions, with 12 capture images actually viewed.
The original loading-state visual rejection remains recorded. The current package
also passes 471 broad native executions over 241 distinct scenarios; all 45 optional
LFS/signing/SSH source cases pass. All 1,484 current renderer cases pass exactly once,
with no retries or skips and all earlier 1,473 cases preserved. Restart storage
management, absent-target save and other-platform support remain open. These local
results do not establish remote CI success.

## GitLab fork workflow foundation (in progress)

Public namespace and project-fork API documentation defines the read endpoints and
reported identity/import fields. The bounded projections, account rechecks, candidate
versus inspected relationship distinction, original fixtures and native lease design
are independent project work. Initial nine core cases, 14 HTTPS regressions and strict
core Clippy pass locally. The initial two native adapter cases, strict workspace Clippy
and generated contracts also passed. The original fork browser passes an AOT build and
50 renderer cases (15 new fork cases plus 35 existing clone/catalogue cases), with inspected
320px/780px views. These renderer fixtures do not make real provider requests or Git clones.
Namespace identity preflight and three real-HTTPS additions passed a fresh gate covering
12 core, 17 HTTPS and three native cases plus contracts/Clippy. A distinct fork-only HTTPS
port and exact request serializer pass four serializer and 25 HTTPS cases, including
eight new POST cases against owned verified-TLS services. A data-only record model
passes six further state/validation cases. Strict workspace Clippy and generated
contract checks pass. This proves the local protocol/model slices; it does not prove a
complete provider creation workflow or live-service use. Linux disk-journal source now
passes ten filesystem cases and the expanded 27-case HTTPS suite, including
two real journal/transport composition cases; strict workspace Clippy and generated
contract checks also pass. The registered core fork plan passes six further read-only
preparation/revalidation cases, including changed identities, cancellation, unknown or
empty repositories and retained scope. In-app fork creation/recovery and durable read-only reconciliation now have
qualified source and focused packaged evidence described below. Remote attachment
and broader workflow qualification remain open.
No proprietary implementation or assets were used. See
[the workflow](../specifications/gitlab-fork-workflow.md) and the incomplete
[dispatch design](../specifications/gitlab-fork-dispatch.md).

The original native fork-review cache candidate passed ten standalone behavioral
cases, compiled with warnings denied. It is now registered with a new native
connection/review/submission adapter. The completed scoped gate passes 50 native,
38 core fork and 27 HTTPS cases, strict workspace Clippy, generated contracts, AOT
and 50 existing renderer cases without retries or skips. The adapter uses
project-owned retained plans, a shared native session lease and the private journal
callback. Native submission tests use actual owned filesystem journals and simulated
ports; the HTTPS suite remains a separate proof. No proprietary source, assets or
new dependencies were used. At that earlier checkpoint, the subsequent read-only
reconciliation adapter and original creation/recovery UI were unqualified source
candidates; their later results follow.
The recovery backend passes its scoped 142-case gate and strict source checks.
The corrected original UI passed a 68-case renderer checkpoint; eight later paired
320px/780px views were inspected for readable content/actions. Two additional
disconnect cases exposed a cancellation race, now corrected in source. The current
combined dev source passes its full source checks (1,072 Rust, 182 frontend unit
cases and strict Clippy), 60 harness cases, production AOT and all 81 focused
renderer cases once without retries or skips. Eight current renderer captures
were actually viewed for original content/action layout and horizontal fit.
The subsequent native private-parent correction passes 1,077 full Rust cases
(including 63 scoped native cases), strict Clippy and unchanged contracts. The
immutable Linux package with DEB SHA-256
`ff61643e85a9767a9550dfb44d5c05fff0771dacb47824dbe4c96d46b32f6d34`
and packaged executable SHA-256
`d0948757be7db28d0dfa908fc45290b4d41a4daa31daadb5ea99c93af755ad3d`
passes all 37 focused native scenarios. The owned TLS server observes the actual
private journal before each of two fork POSTs; restarting after a lost reply sends
no replacement POST. Fresh read-only reconciliation and exact-ID 404 handling pass.
Twelve normal/compact native captures were actually viewed and accepted. These
results cover synthetic owned services, not live GitLab. The same package passes 220 full and 221 inherited-environment scenarios: 478
native executions over 248 distinct scenarios including the focused 37. All 45
optional LFS/signing/SSH source cases pass. The qualified renderer set passes all 1,519 cases, preserving all earlier 1,484
identities with no retries or skips. An existing wall-clock-dependent date
assertion failed after its sample crossed 30 days; the isolated test now pins the
clock and asserts exact ISO/time/relative output. The first three unchanged
shards were retained, the corrected fourth shard passed in full, and detailed
reports confirm exact collection matching. Runtime and package inputs did not
change for that test correction.
Fork-network ancestry, branch-scope selection and reviewed remote attachment remain
open; further packaged error/cancellation composition coverage is also required.
