# State machines

## Decision and boundaries

Use local discriminated unions, Angular signals, and Rust enums at native
ownership boundaries. Keep the existing Specta IPC generator as the schema
source. Do not introduce a global store, statechart dependency, shadow Git
sequencer, or another durable journal merely to standardize presentation.

The inventory below identifies 71 lifecycle families from the source audit at
`dce1c58`, including already-explicit machines. It is a static inventory, not a
claim that every possible interleaving has been exercised or every family has
been migrated. Large families contain several orthogonal machines. Source
symbols and test filenames are preferred to line numbers, which move during
refactoring. Frontend owners below are in `apps/desktop/src/app`, native owners
in `apps/desktop/src-tauri/src`, and core owners in `crates/git-core/src`.
Renderer coverage names are relative to `e2e/renderer` unless stated otherwise.

Separate these facts rather than compressing them into one phase:

- Cancellation requested, cancellation accepted, and actual operation completion.
- A confirmed mutation, a failed post-write inspection, and an unknown outcome.
- A retired read context and a confirmed write receipt that still must be kept.
- User intent, externally observed Git state, and native one-use authority.
- Request lifecycle, content classification, dirty drafts, and process lifetime.

Keep repository IDs, expected object/revision identities and request generations
with their existing owners. Ignore stale reads, but never discard confirmed
write receipts just because their panel closed. Unknown outcomes require
inspection and fresh review, not automatic replay. Never record credential
values, native capability tokens, or user draft contents in transition logs.

## Selected Git process context

The UI-selected checkout remains authoritative when spawning Git or its owned
terminal/file-tool/hosting children. The shared native environment boundary
removes inherited repository/index selectors, pathspec reinterpretation flags,
and legacy `GIT_CONFIG`, which can redirect config queries without redirecting
ordinary Git commands. Explicit internal alternate indexes are applied after
sanitization. System/global configuration and command-count policy remain user
authority, not application-owned defaults. This is process-context isolation,
not a lock against concurrent external configuration edits.

Coverage: `git_environment_context.rs` uses isolated child processes to verify
selected identity reads, actual commit author, local identity writes and native
push-review evidence while preserving unrelated config bytes and valid policy.
Packaged inherited-environment acceptance independently checks the selected
identity and the outside fixture's config, index, HEAD and working bytes.

Cancellable Git capture waits for both the owned process exit and the two
output readers. Those readers wake the coordinator on completion; the
bounded poll still checks cancellation when Git has closed its output but
is running, or a descendant keeps a pipe open after Git exits. EOF alone
never completes the operation or substitutes for Git's exit code.
Unix output readers use [bounded pipe readiness](https://man7.org/linux/man-pages/man2/poll.2.html)
instead of sleeping before every nonblocking read. The stop check still
runs when a writer is silent, and the reader drains bytes before returning
EOF on normal completion.

Repository watchers observe Git's metadata directories, not its object
database. In a reftable repository this includes the shared stack and any
private stack of the selected linked checkout. Watch the directories rather
than individual files so Git's atomic stack replacement is visible.
If attaching one path fails, keep the successful paths and try the remaining
paths. The next native repository open retries only missing registrations.
The existing status refresh remains the fallback where events are unavailable.

## Implemented transition ownership

### Command palette

The deferred palette builds and ranks command options from live root state.
The palette owns cursor and combobox focus; a new open visit resets both.
The root still owns the tracked-file search lease, command dispatch, and
repository-specific review authorities. A captured action must pass the same
dispatch guards after the palette closes or the repository changes. While the
chunk loads, Cancel and Escape can close its view without running any Git
command. A failed chunk remains dismissible and a late load cannot reopen it.
The tracked-file debounce belongs to the open palette visit, query and
checkout visit. Both dispatch and receipt recheck the visit, including a
switch away and back to the same repository ID. Git emits distinct paths
for tracked-file search; multiple unmerged index stages do not reserve
multiple results or change the existing bounded search limit.
The native listing has a five-second ceiling and respects any earlier
deadline. On timeout Git is stopped without publishing partial results,
and the palette distinguishes a failed file search from no matches.

### Rebase review

Both the interactive editor and the merge-preserving review belong to one
active checkout visit. Accepting a prepared plan, starting Git, and
applying navigation or focus changes cannot cross visits. An
away-and-back tab change retires the earlier review even when the renderer
never drew the intervening checkout. The original native mutation receipt
still belongs to the command; retiring the review does not cancel or replay it.
The native interactive plan records both local branch tips. Start must
submit those tips even when the common base and replay commits are unchanged.
Git receives the reviewed destination commit ID, not a moving branch name;
a changed tip before execution requires a fresh plan instead of a new replay.

### Diff patch export

The patch panel owns the reviewed diff scope and explicit path selection.
Do not open the destination picker for an empty, conflicted or incomplete
scope. An empty chooser result is cancellation even if Escape closed the
owning Preferences panel. Keep its activity receipt, not an error or a
write request. For a nonempty destination, recheck the originating
checkout visit and reviewed selection. A stale path blocks the whole
selected export until the user explicitly removes it or changes the
selection. A valid selection expresses intent about paths, not a frozen
copy of their bytes.
Native Git reads the current diff and refuses partial selected exports; the
destination must be a new file outside the repository and its metadata.
`patch-exchange.spec.ts` covers the renderer gate before and after the picker.

Diff line actions submit hunk-relative indices against the exact displayed
native patch. Within a hunk, only the first prefix character determines an
addition or deletion: file content that begins with `++` or `--` is still
selectable. End-of-file notices are shown without consuming a source line or
a change index, and do not separate the removed and added sides of a
replacement. Native selection retains the notice on the appropriate patch
side and refuses a partial change that would concatenate final lines.
Git can omit the prefix on blank context rows. Safe discard interprets an
exact bare newline as unchanged context but still matches the complete
displayed patch and the working-file bytes before writing.

### Deferred saved-tab restoration

Saved workspace tab paths are the intent; loaded repository snapshots and the
cache are observations. Opening, closing, and reordering visible tabs must not
erase the still-pending paths or change their relative slots. Returning to a
partially cached workspace resumes its missing tabs, without changing a visible
selection. An unreadable saved path remains saved during restoration and is
reported rather than treated as an explicit close.

Repository overview can locate an unopened saved checkout at its new path.
It passes the original saved path as a starting-location hint to the native
picker. The hint does not open a checkout or change its saved membership.
The folder picker and native open reply belong to the originating overview
and workspace visit. Only a successful current reply can replace the old
membership in its original slot, using the canonical path returned by Git
and revoking any pending restore of the old path. An invalid folder or a
canonical path already in the same workspace leaves membership alone.
Other layouts are unchanged. `workspace-center.spec.ts` covers these replies,
late picker cancellation and draft handoff.

Bulk locate freezes the selected paths in layout order and prompts for
each replacement separately. Folder-picker cancellation stops all remaining
prompts without undoing confirmed replacements. Invalid choices leave
their old path saved and report an individual error. Closing the overview
retires the current assignment as well as undispatched prompts.

Selection for removing unopened entries is independent of the open-tab
selection. Confirmation revalidates the entire reviewed set against the
owning workspace and the currently open tabs before changing any
membership. One stale or reopened path refuses the whole removal.
Successful removal revokes every matching pending restore before updating
the saved layout. This does not close tabs or invoke Git.

Close history is session-local and scoped to the workspace that closed the
tab. Reopen uses its former saved position without dropping inaccessible
paths. A failed open retains the history for retry, and a native reply from
a retired workspace visit cannot restore the tab into another layout.
Ordinary opens consume only matching entries in the current workspace.

One restore instance owns an active workspace visit. Both its timer and replies
check instance identity, including when the user leaves and returns to the same
workspace. Closing a tab revokes that pending path so an earlier read cannot
reopen it. Renderer incoming-link tests cover saved-path restoration before
review, and the packaged workspace scenario checks returning to cached tabs.

The first usable snapshot may omit tags. Its full metadata read stays pending
while a status read or foreground action is active, with at most one deferred
timer per repository in each workspace. Two cached views of the same checkout
can have different metadata readiness. A superseded refresh cannot settle the
pending read, including after leaving and returning to the same workspace.
Only a current snapshot from the owning visit and checkout clears it.
`background-status.spec.ts` holds a status reply across the first timer and
verifies that the restored tag then appears without a manual refresh.
A failed full read is distinct from ready metadata with zero tags. The Tags
pane discloses loading, failure with an explicit read-only retry, confirmed
empty, or no filter matches. Retry returns focus to the Tags heading without
clearing the filter or closing the pane.

### Submodule review filters

Path and attention filters only change visible entries, not the inspected
state or bulk-operation scope. A new request starts with empty filters.
An open confirmation disables filtering so the reviewed entry cannot
disappear before confirmation or cancellation.

### Prepared single-file discard

Single-file discard from the row or context menu prepares a native token for
the exact selected path before opening the confirmation. A token that names
a different path, has exclusions or has a changed tracked/untracked status
does not open a confirmable review. Confirmation sends the token, not a path
to rediscover on disk. If working bytes or the index changed, native code
refuses the stale review instead of capturing and discarding the new edit.
The renderer keeps the checkout-visit and review-generation checks.

### Blocked discard subset review

The root owns file-action identity, preview requests and confirmation; the
deferred review body owns rendering. The root binds the confirmation to the
active checkout visit, branch and HEAD. A stale review explains why it cannot
be confirmed, even when a revisit still has the same repo ID and patch.
Rendered controls identify the review they belong to; a retired control
cannot submit, dismiss or change a replacement. A delayed bulk preview is
discarded if another review opened in the meantime. The eligible-file subset
chooser cannot start until the matching first review has rendered. Returning
from the chooser
discards the selection and restores focus only after that review is rendered
again. Choosing a subset still requires a fresh native preview before any
destructive confirmation. The Select all eligible and Clear selection controls
only update the current candidate list; neither starts a preview or touches
excluded paths. Eligibility comes from native preview, not from the presence
of a slash in a path. `discard-recovery.spec.ts` holds the review chunk,
asserts that no second preview starts during loading, and checks focus and
the exact subset sent after the chunk is released.
`diff-action-lifecycle.spec.ts` checks same-tip branch changes, return visits
and retired submit controls. Native exact-patch and recovery checks remain
authoritative when working bytes change independently.

Bulk discard carries a stable focus target through preview and review.
Closing the working-directory menu uses its toggle as the return target;
selected-file review uses the Discard selected button. A refused preview
only returns focus when it would otherwise be lost, and never takes focus
from another control or a different checkout.
If the user cancels selection while a preview is running, the late result
cannot open a review. For an active selection, every returned path must be
in scope and every selected row must be accounted for (including blocked
or skipped results). A selected untracked directory summary may expand to
its descendants, but never to a sibling directory.
When native metadata identifies an oversized file in a mixed blocked
review, that path is labeled as too large to save for recovery. Other
blocked paths keep the general explanation; the label never makes a path
eligible or changes what gets captured.

### Ignore rule review

Ignoring one untracked path applies directly. Directory and extension rules
can hide other untracked paths, so they use the checkout-bound file review
even for an untracked selection. Cancel makes no Git request. Confirming an
untracked selection adds the rule without requesting an index change;
confirming a tracked selection can untrack only the selected file.
Both paths keep the native mutation and snapshot refresh under the same
repository lock on a worker. If the write succeeds but refresh fails,
the outcome remains distinct from a refusal or an unknown write.
`diff-action-lifecycle.spec.ts` covers both scopes and dispatch arguments;
native `ignore-responsiveness` checks both writes with Git held.

### Commit followed by push

The composer previews the same route the toolbar uses: push to the selected
remote and target branch, open a publish review for a branch without an
upstream, or commit locally when there is no usable route. A publish review
is not itself a network write.
The composer retains the selected remote, its displayed push URL, and
the target branch when it starts a commit (or stage-and-commit).
After staging, a mismatch leaves the staged changes for explicit review.
After committing, a mismatch keeps the local commit but skips the push.
The user can review the new destination and push explicitly. This check
covers the renderer's selected destination and latest accepted repository
snapshot; it is not a lock against external Git configuration changes.
The commit response retains its own reported HEAD separately from any
reconciliation refresh. If the view later shows a different HEAD, it cannot
be adopted for the follow-up push or recorded as the commit's Undo target.
`Push` also sends the selected local commit ID to native. A different HEAD
before launch is a refusal, and the push refspec uses the requested object
ID rather than a symbolic HEAD so a later move cannot change the commits
the transport sends. This is a regular, non-force push.
`commit-policy.spec.ts` covers both phases and the unchanged destination.

### Toolbar split menus

The active toolbar overlay owns the opening button. Escape closes the menu
and returns focus to it. Tab or Shift+Tab makes the closing menu inert and
anchors focus on the opener before the browser performs native sequential
navigation. Closing a menu must not send keyboard focus to the page start
or through detached menu items.

The compact More menu defers its presentation and responsive item styles.
The root retains the opener, loading and failure dismissal, and dispatch.
The deferred presenter receives a read-only view and emits an action; the
root checks the current repository scope before executing it. A late chunk
does not reopen the menu or take focus away from another control.

### Upstream status actions versus toolbar sync

The ahead/behind status badges compare the checkout with its configured
upstream. Their actions target that same remote branch, independently of
the toolbar's selected remote. The toolbar and the composer still use the
selected remote, showing upstream counts only when the toolbar targets it.
Git reports the upstream's remote name, source branch, and local tracking
ref separately; a tracking ref may use a different namespace or name.
Local-only upstreams retain their counts without remote action buttons.
An explicit pull fetches the full branch ref, not a same-named remote tag.
`pull-strategies.spec.ts` covers both destinations and local-only tracking;
Git core tests cover custom fetch mappings and the remote tag collision.

All app Pull routes pass the original checkout's branch and commit to
native. A workspace batch captures each checkout when the batch is started,
not when it reaches the front of the queue. It also captures the saved Pull
strategy once for the batch; each checkout still uses its own Git upstream,
not the active tab's toolbar remote. The native command requires an explicit
strategy; it does not silently choose merge when omitted. Under the app's
repository mutation lock, native refuses a changed checkout before starting
Git, even when the new branch shares its old commit. This preflight isn't a lock against Git
clients outside the app after the check.
Before an implicit batch Pull, native also reads the checkout's configured
merge sources. More than one distinct source is a per-repository error
before fetching; the batch does not perform an undisclosed octopus merge.
Explicit toolbar Pull still uses the single branch shown in its menu.

Pull integrates the parent commit and its recorded submodule revisions.
It does not fetch into or check out nested repositories, even when Git's
recursion settings are enabled. Users can review and update the submodule
separately after Pull.
Both configured and explicit Pull disable pruning for that invocation.
Integration does not delete local tags or stale tracking refs as a side
effect, even when pruning is configured. This does not disable normal tag
following or change the configured fetch mappings.
Pull also disables all-remote fetching. Before transport, native rejects
configured fetch destinations that can write directly to a local branch
(`refs/heads/`, wildcard parents, or ambiguous short names). Explicit
toolbar Pull can still select a branch outside the source of a dangerous
mapping. Normal remote-tracking, fully qualified custom tracking refs,
and a configured local branch upstream remain supported. Legacy remote
files are refused because normal config queries do not describe their
mappings. A checked-out branch and commit are rechecked after this
preflight. It is not a lock against other Git clients.
For a named receiving branch, all three modes protect ignored files when
Git takes its fast-forward path, including the fast path of Pull with Rebase.
Pull passes Git's no-overwrite option using the receiving branch's
invocation-scoped merge options; it does not save settings. If a detached
checkout or complex merge defaults prevent safely enabling the guard, Pull
refuses before transport when ignored paths are present. On an actual
checkout collision, transport may already have refreshed tracking refs,
but the current branch, index and file are preserved. This is not
ignored-file protection during a divergent Pull merge or rebase.
None of the three Pull strategies stages a squash. The app overrides
`--squash` in receiving-branch merge options for those invocations,
including the fast-forward path of Pull with Rebase.
A clean divergent merge may still stop before committing when the receiving
branch has `--no-commit` configured. The app preserves that review boundary:
Pull and local Merge call it a prepared, uncommitted merge when their own
matching native result introduces an active merge. Workspace Pull marks
that repository as needing review and continues processing the batch.
Pull with Rebase replays only the selected receiving branch. It suppresses
`rebase.updateRefs` for the operation without changing repository settings.
A conflict and later Continue Rebase do not add sibling branches to the replay.

### Local branch deletion

The context menu and palette confirm one local branch tip, displayed in the
dialog. Safe delete and its optional force follow-up send the same tip.
The renderer rejects a moved or now-current branch, and native verifies
the named ref before and after capturing the reviewed commit for recovery.
Git still checks branch merge status and linked worktree occupancy. The
preflight does not lock out independent Git writers before Git starts.
The force follow-up uses the safe deletion's own native refusal. A
background refresh or another action clearing or replacing the global
error cannot turn that refusal into success or erase an unrelated error.
Leaving the checkout also retires branch deletion and rebase confirmations;
a late refusal cannot open a force-delete follow-up in a new visit.
Local branch rename likewise requires the current checkout visit in both
the context menu and command palette. A retired field cannot change a
replacement draft, and late success cannot rewrite the new visit's pinned
or filtered branch preferences.

### Worktree removal and sparse checkout

These confirmations belong to the checkout visit in which they opened. A
switch away and back invalidates the previous review even if the repository
ID and path are unchanged. An old confirmation control cannot dispatch
removal or change sparse checkout; force removal and returning to the sparse
editor also require the active review to belong to the current visit.

Force-push review uses the same visit boundary. A destination lookup from a
retired visit cannot enable confirmation, and a previously enabled button
cannot initiate a push after leaving and returning. Native ref and destination
leases still authorize the actual Git operation.

LFS cleanup uses the same visit boundary for both the reviewed object list
and retention-based prune. A retired preview cannot update a new visit.
Branch publishing and remote removal also require the original checkout
visit. The remote removal review owns its target and focus opener together,
so replacing the review cannot leave either value from the old one.

Commit history confirmations carry both checkout-visit and rendered-review
identity. An obsolete control cannot execute, change the options of, or
dismiss a replacement review. Reset previews and mutation completions can
update only the review that started them.
Graph menus captured in a previous visit retire without returning focus to
that checkout. History actions also require the menu that rendered the
control, so a stale click cannot open a review for a replacement selection.

Stash options also belong to one checkout visit. Leaving the checkout retires
the form, including its draft and focus intent, whether saving, applying a
stash or one file, branching from it, or stashing before switching branches.
The stash menu uses the same boundary for immediate Apply and Pop. A late
result must not replace the inspected commit after switching away and back.

### Remote branch rename and deletion

Tag and remote-branch actions require a menu and rendered review from the
current checkout visit. An old action cannot dispatch or update branch
filters after leaving and returning.

Before sending a rename or deletion, native checks that Git's configured
fetch mappings uniquely resolve the selected tracking ref to the same
remote branch name. A displayed alias can share its commit with another
branch; the commit lease alone does not prove the destination. Symbolic
aliases, conflicting mappings, and mappings to a differently named branch
are refused without a push. A rename also checks that the new name will be
tracked before changing either the remote branch or local upstreams.
After the remote rename succeeds, Git verifies the new tracking tip and
removes the old one only at the reviewed object ID, in one local reference
transaction. If the refs no longer match when Git acquires their locks,
native reports the remote rename as partially applied without changing
local upstreams. The remote rename is not replayed or rolled back automatically.

### Manual co-author entry

Text typed in the co-author picker belongs to the checkout's in-memory
editor, not to the submitted commit message. It survives switching tabs
without opening the picker in the destination tab. A successful commit
can consume the matching message and added trailers without consuming
the unsubmitted text. Closing the checkout abandons both drafts.
`commit-policy.spec.ts` covers delayed commit completion, tab switches,
and reuse of a closed tab's repository ID.

### Selected commit references

The selected commit's reference strip is loaded on demand. The inspector
keeps rendering commit text and files while that module is pending or
unavailable. The parent retains ownership of actions, selection, and the
hover/keyboard stack; dismissing the inspector or selecting Working
Directory does not mount a late reference strip. The loader and menu
behavior are covered by `commit-reference-loading.spec.ts` and the
reference-stack interaction tests.

### Changed files for a revision or comparison

The commit/stash and comparison inspectors share one changed-file list
and one virtualized row renderer. The row's source and target revision
still belong to the active inspector. Path mode adapts only the visible
rows, while tree mode keeps its directory and collapse state. A capped
commit file list and a comparison with partial line counts retain distinct
notices; the shared renderer does not treat uncounted comparison files as
binary or hide their diff actions.

### Repository change notifications

Filesystem notifications and explicit file-tool change notices request a
debounced metadata read for an open repository. At most one queued request
per repository owns the timer. Quiet bursts debounce for 450 ms, but continuous
notifications cannot schedule the first attempt more than 1.5 seconds out. A
status read, foreground Git action, or background fetch may still defer the
read without consuming the notification. Closing the tab or switching
workspace retires queued work for that visit. A native read error is not
automatically replayed. Both the filesystem event and periodic status remain
read-only; status alone does not invalidate a same-branch ref change.

In `background-status.spec.ts`, a held status reply crosses the first
metadata deadline. After the reply settles, the delayed refresh reads and
applies the changed ref metadata without requiring another notification.
Another case keeps producing events and observes a refresh before the burst ends.

### Deferred workspace editing

Workspace create, rename and delete forms share a deferred view without
moving mutation authority out of the renderer shell. Cancel and Escape work
while its module is pending, returning focus to the opener. A completed
load cannot reopen a cancelled request. The loaded view focuses the name
field or deletion's Cancel button after render; the loader exposes only a
non-mutating close action. `workspace-edit-dialogs.spec.ts` covers cancellation
and load failure with saved state unchanged.

Repository management likewise owns keyboard shortcuts while its shell
request is live, not while the deferred dialog happens to remain mounted.
Closing retires that ownership immediately: a key reaching the old
focused button can reopen the command palette without another keystroke.
Timers for dialog-mode focus retain the originating focus request and
cannot focus a retired dialog. `workspace.spec.ts` exercises the closing
gap as well as the ordinary keyboard path from Clone and Initialize.
The native destination picker belongs to the same dialog request, its current
mode, and its own invocation. Closing, switching modes, or starting another
picker retires the old reply; neither a path nor an error from it may replace
the shared form draft. A path confirmed while its form is still current
remains a draft across ordinary closes and reopens.

An ordinary Browse, Recent, or Favorite open is a read, not a filesystem
creation. Its picker and native reply belong to the active checkout visit
and the current Browse request. A closed, replaced, or superseded request
does not activate a tab, change saved membership, or announce a late
failure in the replacement dialog. A live request can still open the
selected repository normally.
Installed `repository-open-scope` holds Git's path resolution for a real
Recent entry while the manager is closed and reopened. It verifies unchanged
tab, draft, saved membership, and Git data before allowing the replacement
manager to open a fresh selection.
Clone (URL or provider review) and Initialize separate navigation ownership
from the native result. Only the originating form and repository visit may
activate the new checkout. If that visit retires after dispatch, a confirmed
creation is saved unopened to the original workspace and recorded in Recent
repositories (Recent only if the workspace no longer exists). An old result
cannot close a replacement dialog or replay the native command.
Installed `repository-creation-scope` exercises the manual Clone form with a
real folder chooser and an owned Git HTTPS transfer held mid-pack. It verifies
the saved result stays unopened after retirement, then opens it from Recents
without a second transfer.

The repository tab menu keeps positioning and keyboard ownership in the
shell, but loads action content and styles on demand. Escape closes a
pending or failed load without running an action. Once the content is
painted, only the current menu request can fit the menu, take focus, or
dispatch a tab action. A newly opened menu for the same repository is a
different request.

### Deferred diff workspace

The diff viewer's on-demand component turns the shell's current patch into
rows, syntax tokens, line totals and navigation markers. The shell still
owns file selection, viewport restoration, navigation and Git operations;
keyboard hunk navigation reads the loaded viewer's hunk list. Before the
viewer loads, the fallback can
return to the graph and the diff shortcuts cannot move an invisible file
or hunk. Closing unmounts the request; a late chunk cannot reopen it.
When the loading fallback held focus, a rendered viewer takes it only
if no other control took focus. Loading, closing and failed import
are covered by `diff-workspace-loading.spec.ts`.

The syntax scanner counts source fragments before combining adjacent
unhighlighted plain text. Combining runs reduces the number of DOM spans in
wrapped rows without merging across syntax or changed-word highlights,
altering source coordinates, or raising the scanner budget.
`diff-performance.spec.ts` checks the span count and exact source text on
both sides of a wrapped split diff.

### Working-tree line recap freshness

Porcelain status describes file states, not file contents. A successful
standalone status refresh of the active dirty checkout advances a separate
content revision even when the renderer can retain its existing status object.
The recap binds that revision, repository ID, path, status and the active
checkout visit to its one in-flight native read. An away-and-back tab switch
invalidates results even if it reuses the same repository snapshot. The recap
discards outdated results and coalesces new requests.
Full snapshots already provide a fresh status input. Clean or hidden recaps
do not start reads just because a refresh ran. `unstaged-summary.spec.ts`
exercises unchanged-status updates, superseded counts and return visits.

### History search read ownership

The paged history engine is not part of startup. The search dialog and file
history share one lazy service instance. A file-history request retains the
checkout visit, diff viewer, revision and path while the engine loads;
closing the viewer or starting a new request before that load completes
does not submit a native page. First use does not reset a newly started
read. Single-commit lookup and blame navigation use their own native reads.

Repository search and paged file history belong to the active workspace visit
and checkout, not just the reusable repository ID. Results and paging
continuations from a retired read cannot update the new view, even if the new
workspace opens the same checkout. Retirement cancels outstanding reads on a
best-effort basis; their replies remain invalid if cancellation fails.
Ordinary snapshot updates within the same view do not reset pinned results.
The scope is checked after cancellation and native replies, not only when the
renderer next runs its reset effect. `history-search-lifecycle.spec.ts`
exercises same-checkout workspace switches and in-place snapshot refreshes.
Repository history search keeps focus on its Search or Continue/Retry action
while a page is pending. The actions ignore activation while unavailable.
Closing the search dialog or its deferred loader restores focus only for the
current checkout and only if another control has not taken it. If compact
layout hides the advanced-search button, focus returns to the visible compact
search toggle instead of the hidden button.
After a cancelled continuation settles, focus returns to Retry only if it
would otherwise be lost with the Cancel button and the original search view
still owns it. The same paging control reports when all matches are loaded.
A file history starting point can differ from its owning diff revision. The
owning revision and exact path determine whether the pane can resume existing
results or a replacement pending cancellation. A replacement uses a fresh
cursor; continuation resolves no alias again. Another file or checkout cannot
reuse the alternate starting point.
File History keeps keyboard focus on Reload and Load older while a native
read makes those actions unavailable. Their activation checks the current
file target and read state; Enter or Space during a pending page does not
start another read. After the last page, the focused pagination control
reports that all available history is loaded.
Historical file and blame navigation also retain the originating viewer and
read scope. A closed or replaced viewer or a newer navigation retires the
older request before it can select a commit, open a different file, or surface
its error in the current view. Tests hold the native blame lookup across these
transitions without weakening ordinary Parent navigation.

### Reviewed shallow-history fetch

The native depth mutation compares the original shared Git shallow
boundaries with the result. If Git reports success but leaves the
boundary set identical, a single follow-up with the same reviewed scope
can obtain missing parents that were skipped while fetching new tips.
It rechecks tracking destinations and the boundary before dispatch and
shares the original cancellation token.
Changes to the boundary set, including partial progress, never trigger
a second depth change. An unchanged or partially extended result
cannot be reported as full success; the existing fetch failure flow
refreshes the graph and retains the user's options. This is not a lock
against independent Git processes.

After a failed or cancelled depth fetch, the open dialog also obtains a
new native depth observation for the same checkout visit. It retains the
selected mode and count while checking, and labels the old count as
historical. If the read fails, retrying the read does not fetch; a depth
mutation remains unavailable until a new observation arrives. If the
checkout is already complete, the dialog requires an explicit selection
before the action can become a fetch without a depth change.

### Tag preview read ownership

Pointer and keyboard tag previews belong to the active checkout visit. A
delayed pointer request cannot start in a different checkout; replies must
still match the originating visit and the displayed tag name and target.
The Git reader verifies the exact tag ref, not a descendant with the same
prefix. A new preview reads the annotation again: the tag object may have
changed even when its target commit has not. Missing or moved tags and failed
reads report unavailable details rather than assuming a lightweight tag.

### Working-tree rename index actions

An unambiguous Git rename row retains both literal paths. Stage and Unstage
submit those paths together with their checkout context; native Git status
must still confirm the same pair on the requested side of the index before
the single index operation runs. A reviewed rename that now matches a copy,
an ambiguous pair or the wrong side is refused, not silently reduced to a
one-file operation. A missing exact source is likewise refused. Grouped
actions refuse sparse checkouts or a directory replacement that would expand
the index change beyond the two reviewed file paths.
The renderer waits for the returned status instead of predicting a half
rename. The operation does not move working files, and the review is not a
lock against independent Git processes.

The rename diff also binds the exact source and destination to the selected
staged or unstaged side. Git compares the two paths in one bounded read; the
destination is not presented as an entirely new file. The diff is read-only:
the renderer sends the user to whole-rename indexing instead of offering hunk
or line actions that could split its two entries. Normal edits to the
destination on the other side of the index still use the ordinary file diff.

### Source-bound branch, sparse-checkout and worktree-removal reviews

Branch deletion/rebase and worktree removal requests capture the repository ID,
checkout path and return-focus target with their review data. Sparse checkout
uses one scoped request containing its action, selected paths and sparse-index
choice; the older scalar action view is derived from that request. Later edits
to a preferences draft cannot change the reviewed sparse payload or count.
These UI records are transient intent, not native mutation capabilities.

Removing a linked checkout **and its branch** first saves its branch commit
in Recovery History. If that save fails, neither is removed. Native then
rechecks the linked branch, commit, and observed change count before Git
removes the checkout. Git retains its own dirty-checkout guard unless the
user explicitly forces removal. If the checkout was removed but the branch
could not be removed, the result identifies the partial operation and
keeps the saved commit. Recovery here protects committed history, not
uncommitted files in a worktree that the user chose to force-remove.

A scope effect retires mismatched requests without restoring focus into another
checkout. Confirmation independently checks ID/path and request identity before
calling the service, including the pre-effect interval. Rendered request aliases
are passed to confirm/cancel and force-choice handlers, so an outgoing control
cannot consume or alter a replacement review. Loading/error dismissals preserve
those sparse/worktree leases too. Each review displays its captured checkout.

Branch and sparse reviews keep their identity while a native operation is in
flight. Native work disables confirmation and force inputs; closing a review
retires UI intent, not the operation. Late branch refusals cannot reopen a
canceled review or replace a newer one, and late sparse completion cannot reload
another checkout's draft or close its review. Worktree force choice is captured
before dismissal resets the control. Focus restoration is source-checked again
when its microtask runs and yields to a newer scoped review. Native service
operation receipts remain authoritative even after UI retirement.

Coverage: `repository-confirmation-scope.spec.ts` exercises repository switches,
same-ID path changes, valid native payloads, outgoing confirm/cancel/force
controls, captured sparse settings, busy cancellation and late completions.
The packaged keyboard suite additionally performs a real explicit deletion of
an owned branch, checks unrelated staged/untracked contents and index/config
bytes, and requires the native recovery receipt. Refusing every valid command
would therefore not satisfy the acceptance gate.

### Source-bound local branch renaming

The palette rename request captures its branch, repository ID/path and opener.
Repository/path changes retire it; confirmation independently checks scope and
rendered request identity before dispatch, including the pre-effect interval.
Outgoing confirm/cancel controls cannot consume a replacement request. Busy
confirmation cannot close the request or start another mutation. The dialog
shows the selected checkout, contains keyboard focus/shortcuts and restores its
opener only while that source still owns the UI.

Context-menu local rename also checks the rendered menu identity and captured
repository ID/path. Both entry points consume the service's actual mutation
outcome rather than a later global error signal. Successful operations retain
source-owned undo history even after a tab switch; only matching active-source
completion may update pinned/hidden/solo preferences. A changed pin is not
silently restored while the rename is in flight. These UI guards do not lock
Git against external reference edits or replace native branch semantics.

The palette rename form explicitly cancels browser-default Enter submission for
modifier chords, repeated keys and composition. Stopping propagation alone
isolates background shortcuts but does not cancel a browser's implicit form
submission. Plain Enter and explicit confirmation remain supported. Renderer
coverage checks both default cancellation and the valid submission path; native
acceptance records the delivered key flags, final default-prevented state,
focus/submit events and checkout footprint after each single chord. Event state
is read after dispatch completes, not from a capture-phase microtask that could
run before the form's bubbling listener.

Coverage: `branch-rename-scope.spec.ts`, `operation-history-lifecycle.spec.ts`,
reference and branch-panel journeys. Packaged setup-keyboard acceptance adds
explicit palette/context rename round trips with independent ref/index/config/
working-byte checks and a commit-attempt marker.

### Staged and unstaged line recaps

`WorkingTreeSummariesDirective` owns one optional native read for the visible
working-directory inspector. The two section components only render its
results. The staged recap compares the index with HEAD (or the empty tree
before the first commit); a pure rename contributes no changed lines. The
unstaged recap compares tracked working files with the index and counts
untracked text with the attribute-aware counter. Conflicted entries stay
in their separate section. Binary or uncounted files are disclosed, not
silently interpreted as no changes. The compact counters in each header have
one accessible name that identifies the stage, counts, and any exclusions
or partial result.

An unchanged-status recount keeps the last measured counts visible and
marked as updating. It does not borrow counts across visits, checkout
paths, or changed status snapshots. A failed recount reports missing
counts, and both sections still share one in-flight read.
An unavailable section can request a read-only Retry using its painted
state and checkout scope. It keeps the other section's measured totals for
the same snapshot if the retry cannot measure them again. The initiating
section's heading takes keyboard focus when its Retry control is removed;
an obsolete painted control cannot start a new count or move focus.

The installed `first-status` release check holds the initial complete
file scan while history is usable. It requires a loading state instead of
false zeroes, then checks both real recaps and an unchanged Git footprint.

Both sides share a status scan capped at 4 MiB of stdout. If that scan is incomplete,
neither side reports a total. Each summary counts at most 2,000 entries
with 4 MiB of numstat output per side. The 16 MiB direct-read budget is
charged against the opened untracked files, not their earlier status snapshot;
files too large to count are disclosed as partial. Direct readers refuse
symlink substitutions rather than opening their targets. The recap gives
its Git subprocesses a shared three-second deadline and checks it between
local file probes. A timed-out
side is unavailable without discarding a count that already finished;
size-limited numstat totals are labeled partial.
When the unstaged recap contains only untracked entries, it skips the
tracked-file diff and counts those paths under the same attribute policy.
External diff and text conversion are disabled and untracked symlink targets
are not opened. The same thread-scoped fetch-free policy used for file
preview and incoming-link reads covers the status and both diffs. It
overrides inherited transport permissions for these reads without a
configuration preflight or any persistent Git change. If local blobs are
unavailable for one diff, that side is unavailable without hiding a valid
count from the other.

Status bursts coalesce to one in-flight read and one latest desired checkout.
Only the same checkout visit, repository ID/path and status object may accept a response,
and the inspector must still be visible and Git idle. A clean section shows
zero; two clean sections or a hidden inspector skip the native read.
Filtering, collapse, and list/tree presentation do not redefine the totals.

A comparison against the working directory uses the same 16 MiB untracked
line-count budget. Exceeding that budget does not remove paths from the
comparison or disable their individual diffs. The native result marks the
aggregate line counts partial, and a file without a count is not labeled
binary solely because its numbers are unavailable.

The commit and working-directory comparison commands, including
individual file diffs, run on the native blocking worker pool. They
retain the repository's existing operation lock and read policy.
Moving them off the UI lane does not change which checkout or inputs a
request owns, or authorize a write while the comparison completes.
Stash details and stash file previews use the same worker and operation
lock; previewing saved changes does not apply them or replace the
current worktree's contents.
In the renderer, once a comparison opens a file, that file request owns
the loading indicator. A completed or failed auto-opened file cannot
clear the indicator for a later selection.

Coverage: `unstaged-summary.spec.ts`, real Git tests for both summaries,
and the packaged `native_unstaged_summary_scenarios.py` fixture. Packaged
qualification is a separate gate; source coverage is not evidence that
the fixture ran.

### Stage All and Commit

The shortcut treats staging and committing as separate steps. A failed or
uncertain staging response must not commit changes that were already staged.
The commit step requires the successful staging status to be applied to the
same checkout, with the same workspace, HEAD, draft, and commit options still
current. A changed context keeps the draft and requires a fresh explicit
commit. These checks do not lock out an independent Git process.

Bulk Stage All and Unstage All are unavailable while the index has unresolved
entries. Native code checks the current index before either write so a stale
renderer status cannot silently turn conflicted files into ordinary staged
files or erase their conflict stages. Individual file actions and the reviewed
merge editor remain separate. The native check is a preflight, not an index
transaction across independent Git processes.

### Commit draft ownership

Commit completion consumes only the submitted draft. Both the live form and
saved per-tab drafts retain edits made after submission, even when the user
types the same text again. A tab switch can save a new draft for the original
checkout without letting the old completion erase it. Repository navigation
saves the visible draft again at handoff, so edits made during a pending
native open stay with their original checkout. A same-checkout transition
keeps the live form, and explicit tab closure does not re-save the closed
tab's draft. An optional push uses
the original consent only while the same tab, checkout, and branch remain
active; otherwise the user must review and push explicitly.

### Detached checkout review

Current checkout labels use the native status branch and HEAD OID, not the
presence or current marker of a branch-list row. A missing or older metadata
row may withhold tracking details but cannot display a false detached HEAD,
attach a real detached HEAD to the old branch, or navigate to an old tip.

Status and worktree registration are sampled separately. If the collected
branch or HEAD samples disagree, native code rereads the snapshot once. If
they still disagree, it asks the user to refresh instead of publishing mixed
checkout state. This check does not lock the repository or replay writes.
The installed `checkout-snapshot` scenario switches branches at the same
commit during a native read to exercise the retry.

**Checkout this commit** reviews the destination commit, repository path,
and current checkout before dispatch. The user must explicitly choose
**Check out detached HEAD**; Cancel is the initial focus. A changed checkout
visit, branch, or HEAD invalidates the review, including a move to a different
branch at the same commit. Native code rechecks the reviewed HEAD and
symbolic branch before asking Git to switch without force. This preflight
does not lock out independent Git processes. Git retains responsibility for
refusing conflicting index or working-tree changes. Tags still navigate to
their commit without checking it out.
Installed `detached-checkout` covers cancellation, a stale branch at the
same commit, and an explicit checkout with non-overlapping staged and
working changes. Branch and tag refs must remain unchanged, including
when they share a name.

### Local branch merge and ignored files

Local merge, squash and fast-forward request that Git preserve ignored files,
and do not recurse into submodule working trees. Ordinary merge and squash
also compare Git's prospective tree with the ignored checkout paths before
starting: on some Git versions a divergent merge can overwrite ignored files
despite the merge flag. The check includes rename destinations and paths that
would replace a file with a directory or the reverse. It never updates the
index or worktree but may write immutable objects to the local object store.
If the detailed ignored-file list exceeds its limit, summarized directories
can establish that an incoming change is outside the ignored paths. A
possible overlap in a summarized checkout is still refused.
If custom merge behavior, a promisor remote, or incomplete output prevents
verification, the app refuses the operation when ignored files are present.
Only the receiving branch's default merge flags apply. Standard fast-forward,
commit, and statistics toggles remain usable because they do not widen the
paths the merge may write; unknown options on the receiver are still refused.
Merge and Fast-forward explicitly disable squash, and Squash explicitly
enables it. A saved branch option cannot substitute one mode for another.

The native command runs on a background worker using the existing repository
mutation lock. It rechecks the reviewed receiver after the preflight and still
integrates the exact reviewed source commit. These checks do not lock external
Git clients or file edits between the preflight and Git startup. Local
Rebase and interactive Rebase with an explicit or known base separately
check the initial checkout against ignored paths, including a source-branch
checkout if needed. This check does not predict paths created during replay,
or cover whole-history replay without a destination. Pull's separate guard
applies only to the fast-forward path.
Abort Rebase inspects the original tree recorded by the active rebase, not
the mutable `ORIG_HEAD`, and checks the native autostash against that tree.
If either restore could replace an ignored local file,
the app leaves both the checkout and operation in progress. Move the
obstructing file and retry Abort. Native status recognizes the apply backend's
rebase marker separately from `git am`; apply-based rebases get the normal
Continue, Skip, and Abort controls without interactive Edit or Split controls.
Skip checks its initial reset to the current commit against the current index,
including paths that became ignored and untracked during conflict resolution.
Merge Abort, including the branch workflow's Abort, checks the receiving
tree and additions from a native autostash before resetting. A refusal
keeps the native operation active; a branch workflow still consumes its
command revision as before. These checks do not predict subsequent rebase
replay or where Git could apply a rebase autostash on a different base
after Continue or Skip.
Standalone mail-patch Skip and Abort also check the reset against the
current index. Skip checks HEAD; Abort checks Git's effective `ORIG_HEAD`,
not the separate metadata used by Rebase Abort. Refusals keep the series
paused. The check does not predict subsequent patches after Skip.
Bisect Reset checks the recorded start against the live local branch or
detached commit and leaves the session active on an ignored-file collision.
A Git-managed `--no-checkout` session requires no restore and keeps its
native reset behavior. Starting or advancing a bisect is separate.
Starting a bisect binds both displayed commit IDs and the original checkout
visit, path and branch to the confirmation. A stale review cannot substitute
the latest HEAD for the displayed bad commit. Native start validates the
actual branch and HEAD again before Git can record its initial state.
Switching to candidates requires a clean working tree. An explicit
**Keep current checkout** choice passes Git's no-checkout option instead;
staged, unstaged and untracked work can stay in place. The banner names
the candidate independently of HEAD and can open its commit details.
An independent first-parent choice passes Git's own first-parent option:
merges are tested on the primary line, not as individual commits on
the merged branch.
Good, Bad, and Skip capture the displayed candidate and checkout visit,
whether invoked from the banner or palette. For Git's no-checkout mode,
the candidate is the exact `BISECT_HEAD` ref and is independent of HEAD.
The banner and palette use the native session's terms, including old/new
or custom terms from a session started outside the application.
Native validation compares the current candidate, checkout mode,
first-parent setting and terms before voting for an explicit OID. Invalid or ambiguous terms do not
authorize a native vote. A term cannot be a built-in bisect operation.
Ordinary terms work in both scripted Git 2.39 and later implementations.
An option-shaped custom term is only sent with the explicit separator
supported by newer Git, never where it could be interpreted as an option.
The scripted version refuses that special term without recording a vote.
An unavailable candidate disables votes but does not disable Reset.
When Git records a unique result, the banner shows that exact commit
instead of presenting another test candidate. Only View result and Reset
remain. If skipped revisions leave more than one possible first bad/new
commit, the banner offers those exact commits for inspection without
offering another vote. A bounded terminal log must match the current
bad/new or skipped references and the session's configured new term.
The reader accepts both older bare terms and the single-quoted terms
observed in Git 2.56; apostrophes that are part of a custom term remain
literal. Git's exit code 2 counts as a recorded
vote only when both the inconclusive result and the reviewed vote's ref
are verified. An unreadable or inconsistent result does not authorize
a new vote.
In switching mode, starting or voting checks ignored paths against a
bounded superset of the candidate trees before Git moves or records a
vote. The check includes possible merge bases and, when voting, the
original checkout that Git can restore. First-parent searches can use
a smaller candidate set when the known-good revisions are ancestors;
possible merge bases still need the conservative check. The app does
not replicate Git's candidate selection. Beyond the per-tree limit, Git can still prove
that none of the ignored top-level names ever appeared in the candidate
ancestry. This proof follows the eligible merge parents and includes Git links;
the original checkout is verified separately. A collision or exhausted
verification deadline or data bound leaves the current checkout and
bisect state unchanged. No-checkout mode does not need this tree scan.
Cherry-pick and Revert Skip check the current HEAD reset, while Abort
checks the native sequencer's original commit for a multi-commit replay.
Single-step and app-owned no-commit Abort check the current, original HEAD.
A refusal preserves the replay and staged state. This does not predict
later commits in the sequence after Skip.
Merge, squash, fast-forward, and rebase from the branch context menu carry a
separate review tied to that menu opening, the repository visit, and both
branch tips. Their labels retain the selected receiver instead of mutating
with a refresh. The renderer refuses a changed checkout or tip before
dispatch; native checks the same identities against Git. A detached or
unborn checkout does not offer these direct integrations. The rebase
confirmation retains the same review rather than resampling the current
checkout, and native replay does not update sibling branch refs even if
Git's `rebase.updateRefs` is enabled.

### Commit rewrite review ownership

The inline author/message editor reviews a target OID against the active
checkout visit, branch and HEAD. Before dispatch, a changed checkout or tip
invalidates the draft rather than authorizing a rewrite against the newer
history. Native rewrite commands check both the reviewed branch (or detached
HEAD) and its expected tip. Ancestor edits recheck after building replacement
objects and only then ask Git to compare-and-swap the original ref. The
checkout recheck occurs before Git's ref transaction; it is not an atomic
lock on HEAD across independent Git processes. The native rewrite and
its snapshot refresh hold the repository operation lock on a worker.
That keeps independent native commands responsive without admitting
competing mutations of the same checkout. A successful rewrite
reconciles the repository through the service, but only the same active
editor may navigate to the replacement commit. Leaving the editor does not
undo or discard an already-dispatched mutation.

Renderer coverage: `commit-edit.spec.ts` exercises stale tips, same-tip
branch changes, away-and-back visits, and selection during an in-flight save.
The installed `commit-rewrite` suite verifies both native stale-branch
refusals and an editor rewrite against independent ref, tree, index and
worktree checks.

Only the editor's presentation loads on demand. The shell still owns the
draft and the native rewrite review. Each form is keyed to that review so
outputs from a retired form cannot target its replacement. A cancel control
remains available during loading or on error; a late form only takes focus
if the user has not moved it elsewhere.

### Saved checkout status

Workspace overview can inspect saved checkout roots without registering a
native repository session, opening a tab, or starting a watcher. It checks
one path at a time and records failures separately. Read-only checks cannot
follow a saved path into a different canonical root; locate reviews are
separate and explicit. Native reads disable optional index writes, implicit
promisor downloads and configured fsmonitor hooks. Untracked directories
may count as one porcelain entry. Tracking counts refer only to local refs.

The scan belongs to the workspace dialog instance. Stop retires the current
result and prevents new reads; closing or changing workspace requests
cancellation and cannot publish a late result in the next workspace.

### Revision comparison entry

History search and the dedicated comparison command share a comparison form.
The opening request belongs to one checkout visit, even while its renderer
code is loading. Closing the dialog or changing the visit retires pending
comparison results. Starting from a commit supplies its exact object ID;
typed refs and the branch/tag lists are resolved by native Git at submission.
Native comparison uses one frozen pair for both merge-base selection and the
resulting file diff. The inspector shows the requested revisions and the
object IDs actually compared. Neither entry point checks out a revision.

Saving a comparison patch belongs to the displayed committed comparison and
its checkout visit. If either changes while the destination chooser is open,
that chooser cannot authorize a write. After dispatch, the native operation
uses only the resolved IDs, not the names, file filter or selected diff.
It verifies the full patch by applying it to a private index seeded with the
base tree and checking the resulting target tree ID. Only then may it create
a new destination file outside the checkout and Git metadata. WIP is not an
eligible comparison export; it has its own tracked-patch workflow.

Commit, stash and comparison bodies share an on-demand revision inspector.
The shell still owns the sticky title and close action, selection, file
viewport, checkout scope and pending Git reviews. A slow renderer load
displays the latest selection rather than restoring an old one, and
returning to the working directory leaves the draft and focus with its
owner. A failed inspector can be closed or left for the working directory.
The reference strip and commit editor retain their own loading lifecycles.

Reference navigation uses the graph and scrolls to the commit when its row
is loaded. Otherwise it reads the exact local object and opens its inspector
without paging the graph or clearing filters. A late read cannot replace a
newer selection or a different checkout visit. Palette tags are distinguished
by full reference name, including aliases that share a target; activation
checks that the named tag still points to the captured object.

### Toolbar split menus

The primary toolbar buttons and their split toggles are always available.
All seven split menus share one deferred presentation component; it cannot
run Git directly. The active overlay owns the menu, opener and checkout visit.
Changing the visit retires the overlay, and action dispatch rechecks the
current menu view before using its data. The loading and error states can
be dismissed using the same keyboard path as the loaded menu. When content
arrives, it can focus the first enabled action only if focus still belongs
to that menu or its opener. If no action is enabled, focus stays on the
opener. Native review and confirmation ownership do not move into the menu.

### Toolbar and compact branch search

Both branch pickers search the same catalog of local branches and grouped
remote-tracking branches. Exact names and qualified refs are resolved before
the display cap is applied. For a specific remote-only peer, the row and its
action identify the same remote. A short remote name with an existing local
counterpart keeps the local checkout action; a qualified remote ref explicitly
selects the fetch-and-checkout action. A missing qualified ref cannot become
a new branch draft. In the toolbar search field, Enter can use a single
match, but does not guess between multiple choices. A checkout visit owns
the toolbar picker: results and focus from a retired visit cannot act on the
next repository. The existing native checkout and occupied-worktree reviews
remain authoritative.

**Find previous local branch…** opens a scoped palette visit and reads Git's
previous-checkout entry for the selected worktree. The lookup presents only
an existing local heads ref; detached checkout IDs, missing heads and
tag-only matches are not substitutes. There is no checkout while the
lookup is pending or lacks a result. Selecting the displayed branch uses
ordinary checkout or the existing occupied-worktree review. Editing the
search retires the lookup; leaving the palette or changing its checkout
cannot reuse a late result or dispatch an outdated choice.

### Workspace clone queue

Bulk clone takes up to 20 sources and one chosen parent folder. Reviewing the
source-to-folder mapping does not start Git. A confirmed plan snapshots the
sources and names and dispatches them serially through the standard native
clone and authentication path. Git's default branch is used without recursive
submodule initialization. Native clone enforces destination vacancy; an
ordinary failure belongs to its own row and does not abandon later rows.

Successful clones are added without switching an existing active tab. Stop
leaves the current clone running and prevents dispatch of further rows.
Cancelling the current native operation ends the queue too. Leaving the
overview retires the plan; if a committed clone returns after retirement, the
existing repository-creation recovery saves its location in the originating
workspace rather than opening a tab in the unowned view. No queue or retry
intent survives restart.

**Share clone recipe** snapshots the open workspace rows and offers only
shareable fetch URLs. Copy rechecks the selected repository and URL against
the latest visible state before writing the clipboard. The version 1 JSON
recipe carries only a format marker, version, and source/folder pairs. It
does not carry local checkout paths, push destinations, workspace names,
or authentication state. The import rejects unsupported fields, nonportable
URLs, and invalid or colliding folder names as a whole. Pasting or reviewing
a recipe never starts Git; the recipient chooses a parent and explicitly
confirms using the same clone queue as a plain list.

### Deferred task-dialog shell

Nine on-demand task dialogs share an eager loading/error shell. It offers
only dismissal: Tab stays on that control, Escape dismisses the owning
request, and keyboard chords cannot reach the application's Git shortcuts.
The shell preserves each dialog's layer, status/alert announcement, and
opener. Request-backed shells cannot dismiss a replacement request, and
completed module loading cannot reopen an already closed request. The actual
task and its Git authority stay in the deferred component. Reopening after a
chunk error does not reload it in the
same renderer; the fallback tells the user to restart.

### Shared deferred fetch and worktree review ownership

Fetch options and linked-worktree move/repair capture the checkout ID/path and
request identity. Their deferred children consult synchronous root ownership,
not only possibly stale child inputs. Scope changes retire the review; outgoing
confirm/cancel/field events cannot act on its replacement. Keyed form views
prevent obsolete ngModel state from surviving a request reset. Busy native work
freezes the submitted payload; successful native outcomes govern dismissal.
Fetch also belongs to the originating workspace visit, so showing the same
checkout in a new workspace does not inherit its review. A selected remote
branch opens a fixed fetch-only review. A changed fetch URL in the current
snapshot disables confirmation rather than retargeting the action.

Directory selection has a separate generation and source predicate. Replacing a
request releases its presentation-level choosing state, without letting an old
picker result, error or finally block affect a newer picker. Suppressing retired
picker feedback does not discard any native Git mutation receipt.

The shared deferred loader captures all four request pointers (reference, fetch,
worktree and stash). Its escape/keyboard handlers require that exact lease and
source. Closing a loaded review captures the post-close lease for focus return:
any newer review, including an open/close ABA cycle, retires the old focus intent.
Native operations remain independent of these transient presentation leases.

Coverage: `deferred-action-scope.spec.ts`, fetch options/result lifecycle,
worktree move/repair, reference/stash scope and deferred-background journeys.
Packaged `native_deferred_review_scenarios.py` checks actual fetch/prune/deepen/
complete and dirty linked-worktree move/repair against independent Git oracles.
Picker interleavings are renderer coverage, not physical directory-picker or
cross-platform acceptance.

### Inline stash keyboard intent and draft consumption

The WIP stash-message editor passes its rendered checkout ID/path with Enter.
Only a non-repeated, non-composing, unmodified Enter may start a stash; other
keys remain editing input rather than background application shortcuts. A stale
rendered editor cannot dispatch against a newly selected checkout. Modifier-key
controls were already safe under the previous filtered Enter binding and remain
negative controls, not evidence of a newly fixed modifier-key regression.

Immediate stash completion consumes only the captured source and draft revision,
using its actual mutation outcome. Typing a new message, including editing away
and back to identical text, retires the earlier consumption intent. A newer draft
or a refused/cancelled operation cannot be erased merely because the global
error was cleared. This does not add persistent per-repository stash drafts or a
new native lifecycle; Git and the existing operation receipts remain authoritative.

Coverage: `inline-stash-keyboard.spec.ts` checks composition/repeat flags, source
changes, newer/same-text drafts, refusal inspection and a valid plain Enter.
Packaged acceptance separately checks real modifier-key isolation and a single
plain-Enter stash with exact index/worktree/untracked objects and unchanged HEAD.
Synthetic composing-event tests do not qualify a physical IME on every platform.

### Source-bound advanced stash reviews and form lifetimes

Advanced stash save, index-restoring apply, selected-file apply, branch-from-stash
and stash-before-switch requests retain checkout ID/path and their original
immutable stash/head/target metadata. Root ownership is consulted synchronously
by the deferred child, including the interval before Angular updates its inputs.
Scope changes retire the review without focusing another checkout. Captured
confirm/cancel, draft-change and shared loading/error escapes cannot consume a
replacement stash review. Native work freezes its option controls and payload;
its actual mutation result, not a subsequently cleared global error, determines
successful dismissal. Retiring UI intent does not cancel or lose native receipts.

The command palette opens the same reviews for saving with options, applying
a selected stash with optional staged-state restoration, and creating a branch
from a selected stash. Palette results carry the checkout visit and, when
applicable, the stash reference and object ID. If that visit or reference
changes before activation, the result cannot open a review for the new target.
Opening a review does not mutate Git; confirmation remains separate.

Selected stash paths are limited to entries eligible for the current mode.
Changing mode or untracked-file preference drops paths that no longer match;
dispatch also intersects with the latest visible status. The native command
rechecks every explicit path before stashing, rather than saving only the
eligible subset of an outdated selection.

Selected Apply, Pop and staged-state Apply check the immutable stash's saved
untracked tree against the current untracked paths, including ignored files.
An obstruction refuses before Git applies tracked changes or changes the
index. The stash remains selected and the user can move the local file
and retry. Ignored files at the literal destinations of the tracked stash
deltas are also guarded, including changes in the saved index. This does
not predict relocated paths on arbitrary divergent merges or turn later
native conflicts and external worktree changes into a rollback guarantee.

Each stash and tag/reference request also owns its form-control instances. Their
loaded components key the rendered view by request identity. Ignoring an obsolete
`ngModelChange` event protects signal state but is not sufficient to reset the
DOM: an unchanged model reset value can leave the old control's internal value
visible. Replacing the keyed view prevents that stale text from carrying into a
new review while preserving normal edits throughout one request's lifetime.

Coverage: `stash-review-scope.spec.ts`, stash option/file/action/delete/preview
journeys, and the outgoing-field regression in `reference-action-scope.spec.ts`.
Packaged stash review acceptance verifies real save/index restore/file apply/
branch/switch through their UI against independent index trees, exact saved Git
objects and working bytes. Fixture-only resets separate restoration cases; they
are not automatic application repair or write retries.

### Source-bound tag and remote-reference actions

Tag push/deletion/rename and remote-branch deletion/rename capture the original
checkout ID/path, exact reference and return-focus target. The root retires
mismatched reviews and independently owns their identity. The deferred child
checks a synchronous root ownership predicate as well as its input: parent
request replacement can precede Angular's input update. Rendered action, close,
field-change, preview and cancel-operation handlers cannot consume a replacement
review during that interval. Deferred loading/failure escapes retain the same
reference request identity.

Remote-tag read results require the same request, source, destination and read
generation. Successful mutation outcomes, not the later global error signal,
control dismissal. Remote-rename presentation events retain their request and
are emitted/applied only while it still owns that source; native mutation and
activity receipts are not discarded by retiring a dialog. Focus restoration is
source-checked and cannot steal focus from a replacement reference review.
Ordinary Enter may confirm a valid rename; modifier Enter and background palette
shortcuts do not silently submit it or reach the staged commit draft.

Coverage: `reference-action-scope.spec.ts` exercises all six actions, same-ID path
replacement, outgoing controls, held completion/read results and shortcut
isolation. `native_reference_review_scenarios.py` exercises actual annotated-tag
push/rename/delete and remote-branch rename/delete through the packaged UI using
only an owned local bare remote. Independent Git checks preserve the annotated
object, unrelated local heads, dirty files/index/config and the staged draft.

### Optional Git LFS checkout diagnostics

An automatic snapshot first detects local LFS configuration, then gives the
external executable check and structured checkout count one shared two-second
budget. If the version check completes but listing does not, LFS actions stay
available and the counts stay unknown. An unresponsive executable is not reported as
available. These checks do not fetch; explicit LFS transfers have their own
operation lifecycle and do not inherit the snapshot deadline.

### Source-bound publish, force-push and LFS cleanup reviews

Publishing, force-push and LFS cleanup capture repository ID/path and their own
return-focus target. Confirmation checks source scope, rendered request identity
and busy state before dispatch. Publish remote selection and the handoff to the
remote editor use the same guard. Force-push keeps the existing pinned local
and remote object IDs and native force-with-lease authority unchanged.

Push to a selected branch, Publish Branch and Force Push with Lease send only
the requested branch ref. They do not inherit automatic annotated-tag push or
recursive submodule push configuration. Publish uses the full local and remote
branch names, even when a tag has the same name, and Git sets the upstream only
as part of its successful push. Configured mirror mode still refuses an explicit
branch refspec; the operation never falls back to a mirror push. These overrides
apply per invocation; unscoped native Push and stored Git configuration are
unchanged, apart from Publish's explicit upstream update.

Each LFS preview belongs to one review instance: an older success, failure or
loading completion cannot overwrite or close a replacement. Preview arrival
does not steal focus from a control already inside the dialog. Exact cleanup
uses the captured repository and reviewed preview; native receipts survive UI
retirement. Shared confirmation loading/error controls capture all their request
leases, and a retired loader stops intercepting ambient keyboard events.

Coverage: `remote-cleanup-review-scope.spec.ts` checks source/path changes,
outgoing controls, positive IPC payloads, remote-editor handoff and overlapping
preview completion. The packaged `remote-reviews` suite publishes to an owned
local bare repository, proves a stale lease refuses a concurrent remote update,
then proves a fresh review succeeds. It also removes a real aged unreferenced
LFS cache object while checking unrelated refs, staged/untracked data and index.
These UI scopes are not remote endpoint capabilities or a new native journal.

Force-push additionally obtains a native `PushDestinationReview` before enabling
confirmation. The native owner fingerprints complete effective Git configuration
and Git-expanded push URLs, bound to source path and remote name; it returns
only an opaque digest and credential/query-redacted destination labels. It reads
all push URLs, including the multiple fetch-URL fallback, not merely the first
URL shown in the ordinary repository summary. Incomplete, control-containing or
oversized metadata is refused rather than silently truncated (256 KiB per read,
128 destinations). The request identity/path guard also owns this async preview:
retired results cannot reopen a review or populate another source's destination.

Labels preserve Git's SCP/IPv6 address syntax, literal local paths and URI case,
escapes and path segments instead of normalizing them through a general URI
serializer. URI userinfo, query and fragment details are omitted for privacy;
custom helper addresses use a generic label. These labels are presentation,
never replacement transport URLs.

Native confirmation rechecks that configuration evidence before starting the
push, alongside the existing local/remote commit leases. Normal Git transport,
hooks and credential policy remain in charge; no endpoint is substituted and no
configuration is rewritten to force a match. This is optimistic launch preflight,
not an immutable endpoint capability or a lock against a concurrent external
configuration/DNS change after validation. Any effective Git configuration
change conservatively requires a new review, even if unrelated to the remote.
Multiple destinations remain supported; Git can update earlier destinations
before a later failure, so the review warns to inspect results before retrying.
The destination list participates in the modal keyboard cycle.

Core regressions prove stale explicit push URLs, `insteadOf`/`pushInsteadOf`
rewrites and added destinations refuse without writing either owned bare remote;
fresh single/multiple-destination reviews still push. A red regression against
the old implementation wrote the rebound bare remote despite the pinned commit
lease. Renderer coverage exercises native review payloads, pending/refused
inspection, retired previews and keyboard access. Packaged qualification must
also exercise refusal after an actual local URL rebind and a fresh successful
review; renderer IPC interception alone is not proof of native refusal.

### Confirmation keyboard ownership

Force-push, worktree removal, sparse checkout, branch publishing, workspace
deletion, LFS pruning, file actions, branch actions, stored-reference deletion,
bisect startup and history reviews suppress ambient document shortcuts while
their own independent request is present, including the pre-render focus gap.
This is a derived keyboard guard, not a shared review state, native authority or
new lifecycle store. Plain Enter can activate a focused explicit confirmation;
modified Enter cannot submit or activate it implicitly. Existing text editing,
Tab and Escape handling remain local. Bisect startup uses the common modal Tab
trap. A retired history review stops intercepting keys before its DOM disappears.

Checkpoint and original-reference deletion also bind the selected ref and
commit to the repository path and active visit. Both the menu and the
confirmation check ownership before dispatch. Confirm and Cancel retain the
rendered request: an outgoing button cannot delete or dismiss a replacement
review. Late completion restores focus or clears selection only while the
original repository visit still owns the response. Native continues to
compare the expected ref tip against Git when actually deleting it.

Coverage: `confirmation-keyboard.spec.ts` checks all eleven request families,
focus gaps, retired DOM, Tab/Escape and explicit Enter. The packaged
`setup-keyboard` suite additionally opens a real branch-deletion review and
checks that background commit/staging/palette shortcuts preserve the owned
checkout and commit draft, without reaching the local commit-hook marker.

### Deferred main-menu presentation

`MainMenuContentComponent` owns optional menu markup and its exclusive styles;
the root retains the open flag, service/action callbacks, outside dismissal,
keyboard navigation, opener and return focus. The root menu container remains
available while its content loads or fails, with a real keyboard-reachable
Cancel/Close action. No Git command is dispatched by loading menu code.

Content readiness transfers focus from the opener or retired loading control,
but not from a control outside the menu. Closing the menu removes the deferred
view, so late imports cannot resurrect it. Tab excludes outgoing controls before
resuming normal focus order; retired DOM stops intercepting menu navigation.
The content styles preserve the existing scroll area and compact-height rules.

Coverage: `deferred-main-menu.spec.ts` holds/fails the actual module request and
checks escapes, late content, outside focus, Tab/Shift+Tab and retired DOM.
Workspace menu journeys exercise existing actions and compact/full-height
layout. Packaged smoke waits for the focused real Manage Repositories action,
not the loading escape, before measuring menu layout and testing Tab dismissal.

### Fetch toolbar review

The open toolbar menu and checkout visit own the review opener. A refreshed
remote status line can replace the presentation model without retiring that
visit. Opening Fetch Options in that interval does not fetch: it opens a
review for the live checkout, with a separate submit action. An old menu
visit or an active foreground Git operation still blocks the opener. Direct
menu actions that can run Git retain the stricter rendered-model guard.

Coverage: `fetch-options.spec.ts` delivers a click between a remote status
update and the next render and checks review focus, no fetch and focus return.
It also exercises a retired menu callback after reopening the same menu.

### Deferred graph action presentation

The graph action menu's optional template and exclusive form styles live in
`GraphActionMenuComponent`. The root retains the overlay request, source scope,
Git callbacks, menu DOM handle, keyboard navigation, outside-click dismissal and
return-focus target. The child receives a typed presentation view; it does not
own operations or replay commands.

Loading and failed imports expose a root-owned cancel/close action. Once actual
content renders, the root refits it against the viewport and statusbar rather
than retaining the smaller loading placeholder's dimensions. Keyboard focus
transfers from a removed loading action to an enabled action, without forcing
focus into pointer-opened menus. A replaced or retired request remains governed
by the root; resolving an old code import does not recreate the old request.

Coverage: renderer `deferred-graph-actions.spec.ts`, existing
`context-menu-interactions.spec.ts` and `reference-actions.spec.ts`.

### Deferred graph settings

The root retains the popover shell, its close action, contextual anchor, focus
return and preference callbacks. The controls and their styles load only when
opened. Loading or a failed chunk leaves the same keyboard-accessible Close
and Escape behavior. A late load cannot reopen a dismissed popover or change
focus. When a live contextual popover grows after loading, the root refits it
against its original anchor rather than leaving the new controls off-screen.

Coverage: `deferred-graph-settings.spec.ts` holds or fails the settings
chunk and checks focus and context fitting; `graph-columns.spec.ts` checks
compact layout and visible controls under normal loading.

### Source-bound repository setup reviews

Worktree creation (new or existing branch), submodule addition, remote editing
and remote removal retain independent root-owned repository ID/path and request
object identities. Submission checks that owner synchronously before dispatch;
a scope effect alone cannot protect the interval before Angular runs it.
Changing the repository or changing its path retires only the mismatched review.

The worktree, submodule and remote editors share an on-demand presentation
component. The root retains the drafts, operations and return focus. Each view is
keyed by its rendered request and passes it to submit, browse, edit and dismissal
handlers. Replacing a request before Angular renders cannot let an old control
act on the new review. Loading and import failure keep a focused Cancel/Close
control without submitting or modifying Git state. The request is transient UI
intent, not a native capability or journal.

Creation completion checks the original request and source before opening a
worktree, and terminal handoff additionally requires the destination path to be
active. Late directory choices cannot overwrite a replacement review. Remote
rename preferences can follow a confirmed rename in the still-active source
without rewriting replacement editor fields. Native operation/activity ownership
and confirmed write receipts remain with the service; closing a review does not
cancel or replay its operation.

Editors and remote-removal confirmation display the captured checkout path.
Editable and destructive setup controls are disabled during native work, while
Cancel/Close remain available. Delayed initial focus checks the owning request
and offers a safe cancel target when inputs are disabled. Remote editing and
remote-removal confirmation have separate return-focus owners.

These setup review signals also own keyboard routing before their first render
or initial focus. Ambient commit, stage/unstage, undo/redo, fetch, navigation,
terminal and palette shortcuts cannot run behind the review. Modified Enter is
consumed so it cannot implicitly activate a focused button or submit the form;
plain Enter, native text editing, the local Tab cycle and Escape remain usable.
After dismissal the retired DOM does not retain this keyboard ownership.
Responsive inspector focus cannot supersede an active modal, even if the
viewport becomes narrow while that modal is open. Dismissing Create Worktree
restores its opener after layout renders. When a narrower layout hides the
references sidebar, its launcher receives focus instead.

Coverage: `repository-setup-scope.spec.ts` exercises pre-effect repository/path
changes, outgoing rendered controls, valid native payloads, closed reviews,
replacement drafts, late write receipts, independent focus, and directory
choices. Existing reference, worktree, workspace and accessibility journeys
remain part of the local targeted gate.
`setup-dialog-keyboard.spec.ts` additionally covers real control key presses,
pre-render focus gaps and events from outgoing controls after dismissal.
`deferred-overlay-styles.spec.ts` holds, fails and cancels the setup import,
and checks narrow layout and focus after the deferred CSS loads.
`working-directory-navigation.spec.ts` checks the normal inspector focus
handoff when the window narrows without an open modal. The
packaged `setup-keyboard` suite checks actual staged/untracked fixture data,
HEAD, refs, per-worktree index/config bytes and a commit-hook attempt marker;
it does not replace Git operations with renderer mocks.

### Source-bound tag and upstream editors

`pendingTagTarget` and `pendingBranchUpstream` remain independent root-owned
requests with captured repository ID and path. Deferred presentation components
read narrow views; they do not own Git writes or introduce a durable journal.
A scope effect retires mismatched requests, but submission independently checks
the owner before dispatch, including the interval before that effect runs.

Tag completion checks both request identity and source ownership before clearing
its fields, so a completed old write cannot dismiss a replacement draft.
Editable controls are disabled during a native operation. Cancel can retire the
review without replaying its command; the service still owns the original write
receipt. Once a request is retired, its still-mounted form ignores local
keyboard handling until Angular removes it, allowing the next global shortcut
to reach its owner instead of being swallowed by a closing editor. Missing editor chunks expose keyboard-contained loading/failure escapes
and never submit a command. Native signing failures retain the original draft
and require an explicit retry.

Coverage: renderer `reference-actions.spec.ts` includes cross-repository and
same-ID/path-change refusals, replacement drafts, normal payloads, signing
failure and late/failed editor imports.

### Occupied local-branch navigation

`AppComponent.checkoutWorktreeRequest` owns the transient source repository ID,
source path, requested branch, registered owner path and return-focus target.
Sidebar, graph, picker, palette and local-branch context actions share this
review. Current branches are no-ops; available branches still use native Git.
Shift+Enter on a local branch in the sidebar, graph, or inspector uses the
same review. It does not fire for repeating keys or rendered branch entries
that no longer belong to the live checkout; plain Enter remains a read-only
branch-tip jump.
Compound checkout-then-integrate and reviewed history mutations retain their
original checkout semantics; navigation must not silently continue those writes
in another repository.

The deferred review permits explicit navigation only after refreshing the
source and rechecking the exact owner path, branch and non-prunable status.
Changed ownership or failed inspection stays in review with an error; there is
no fallback checkout, force option, repair or automatic replay. The review and
its refresh belong to one visit to a checkout. Closing the review, changing
repositories or switching workspaces (even when both show the same checkout)
retires the request. A late read cannot navigate or reopen the old review.
Opening the owner saves the source commit draft. Before activating a tab,
the returned native snapshot must still show the reviewed path, branch
and shared worktree registration, and the source checkout visit must still
be active. Cancel retires the review during either the ownership refresh or
the open. An in-flight read may finish, but cannot publish its late metadata
or file counts, or activate a tab. The dialog does not claim to interrupt Git.
A late open can neither redirect to a different branch nor
navigate after an away-and-back tab switch. A mismatched destination leaves
the source tab active and shows the failure inside the review. Success reveals
the destination tab and gives it focus if the dialog still owned focus. Git's
registration paths are compared separately from the platform's canonical
path spelling. If occupancy changes before an ordinary native checkout, Git still decides
whether the switch is allowed. After a refusal, native code
classifies a fresh, bounded registration read without parsing Git's error text.
The same source checkout may then offer navigation if refresh confirms an owner;
it never retries the switch or opens the owner without confirmation. Unrelated
errors or failed ownership reads retain the ordinary Git error.
If the selected local branch disappears, native reports that fact rather than
creating a local branch from a same-named remote. Checkout uses Git's
no-overwrite guard for ignored files and leaves initialized nested checkouts
alone. The fast-forward in reviewed remote checkout also refuses an ignored
file collision; a completed fetch and local switch can precede that refusal.
Ordinary worktree snapshots use Git's NUL-delimited porcelain format so
embedded newlines and tabs in registered paths survive navigation unchanged.

Coverage: `repository-location.spec.ts`, renderer
`branch-checkout-worktree.spec.ts` (including a stale graph double-click,
late native reply, mismatched destination, and canonical alias), branch-panel
interaction tests, and the real-Git occupied-branch test preserving both
worktrees.

### Saved workspace repositories

Saved workspace paths are membership, not a mirror of the open tabs.
Restoration can be deferred, or fail when a folder is unavailable. Tab
activation, workspace switches and tab reorder keep unopened paths. An open
can replace a saved alias with the canonical checkout path; closing a tab
removes that checkout from the active workspace. Repository overview offers an
explicit retry and a workspace-only removal for each unopened path. Removal
revokes pending restoration for that exact path. A late native result cannot
add it back, and the same path saved in another workspace is unaffected.
After an explicit open, the shell restores the new checkout's draft and
view only when the successful reply still identifies the active checkout.
Unrelated background errors do not decide whether to switch the draft.
The native first-frame snapshot deliberately reads HEAD without scanning files.
The working-directory inspector reports its status as unknown until the first
working-tree scan succeeds, and offers retry on failure. A tracked-only
metadata read cannot settle that first scan, nor replace an already known
working directory with a loading screen.
Bulk open uses the same shell action for each new checkout, in selection
order, keeping individual outcomes in the overview. Closing the overview
stops undispatched paths without undoing a native open already in flight.
Bulk close reviews the exact tabs, including selections hidden by a filter.
It refuses the complete request if any identity or path changes before
confirmation. The shell closes any selected active tab last, using the
existing close-and-discard-draft behavior without deleting repository files
or changing another workspace's saved paths. Closing all tabs keeps the
workspace available; dismissing the overview focuses the replacement workspace
switcher on the welcome screen.
Bulk fetch and pull advance one repository at a time. Stopping the queue
marks only undispatched repositories as not started and leaves the current
native operation to report its actual outcome. If the native operation itself
is cancelled, the batch also retires all remaining work. Ordinary Git
errors still leave other repositories eligible for their own attempt.

Coverage: `startup-failures.spec.ts`, `workspace-center.spec.ts`, and the
packaged `workspace-restore` suite.

### Transient overlays (F46)

`OverlayController<T>` owns a read-only `activeOverlay` signal, a discriminated
union with its payload and return-focus target. Its transitions are:

| Event | Before | After / effect |
|---|---|---|
| `open(overlay, returnFocus)` | Any | Replace the previous member of this scope atomically. |
| `toggle(overlay, returnFocus)` | Same kind | Closed, without focus restoration. |
| `toggle(overlay, returnFocus)` | Closed or different kind | Open the requested member. |
| `close(kind, restoreFocus)` | Different kind or closed | No change; an obsolete sibling close cannot dismiss the active member. |
| `close(kind, restoreFocus)` | Matching kind | Closed; optionally queue focus restoration. |
| `closeAll(restoreFocus)` | Any | Closed; optionally queue focus restoration. |
| Focus microtask | A newer transition happened, or opener disconnected/inert | Ignore; do not steal focus from a new owner. |

`AppComponent.toolbarOverlays` replaces the eight fetch/pull/push/branch/stash/
LFS/sparse-checkout/more-actions flags and the separate toolbar focus field.
Existing `*MenuOpen` names are read-only computed projections. The menu-render
callback checks its captured owner before focusing.

`AppComponent.actionOverlays` owns the nine graph/file/commit-file/stash/
repository-tab/remote-group/worktree/submodule/reference-pane payload variants.
Existing payload names are read-only computed projections. Context-specific
fitting, selection, dialog handoff and fallback-focus logic stay in the
component; those are not interchangeable with toolbar focus restoration.

These are **scoped**, not global, owners. Preferences, editor/file-tool dialogs,
confirmation/help nesting, palette, inspector, reference stacks, and persisted
disclosures remain independent. Existing nested merge-review/help behavior is
covered by `merge-rebase.spec.ts`; collapsing it into one global overlay would
destroy the underlying review. Not every remaining overlay has been converted.

Coverage: `overlay-controller.spec.ts` (unit), `state-machine-characterization.spec.ts`,
`context-menu-interactions.spec.ts`, `workspace-menu.spec.ts`, `merge-rebase.spec.ts`.

### Repository operation observations (N04)

Rust `RepositoryOperation` is an internally tagged enum: `merge`,
`rebase { editStopped, split }`, `cherryPick { noCommit }`,
`revert { noCommit }`, or `mailPatch`. `RepositoryStatus.operations` contains
normalized observations across independent operation families, not a single
global winner; the empty collection means idle.
`bisectInProgress` remains orthogonal. Native status construction derives the
deprecated legacy fields from this collection through one exhaustive match.

The field is nullable for older/preview snapshot producers. The frontend's
`repositoryOperationState` is the only compatibility adapter: it uses the
legacy fields only when the collection is absent. Otherwise an exhaustive
switch projects these observations for banner, palette, commit/rebase guards,
service commands and mail-patch tools. There is no independently mutable
frontend operation engine and no assumption that closing UI aborts Git.
Status reconciliation compares this projection, including marker-only updates.

Coverage: core `repository_operation_*` tests exercise filesystem markers,
legacy projection, concurrent observations and serialized camelCase fields;
`repository-operation.spec.ts` exercises every enum variant and compatibility;
renderer characterization exercises both typed and legacy producers.

The replay detector gives the application-owned no-commit journal precedence;
its persisted kind determines whether the typed operation is `cherryPick` or
`revert`. Older journals without a kind default to cherry-pick. The active
no-commit step's matching `CHERRY_PICK_HEAD` or `REVERT_HEAD` is owned by that
journal and is removed only after the corresponding step is resolved; an
unexpected marker is preserved and reported as stale state. Without an owned
journal, native marker precedence remains `CHERRY_PICK_HEAD`, then
`REVERT_HEAD`, then the sequencer. If both head markers exist, the typed
collection contains the detected cherry-pick, not both raw marker files. This
is **not lossless raw-marker forensics**, nor evidence that two marker files
are two valid Git operations. The focused
`repository_operation_replay_markers_keep_legacy_precedence` fixture pins this
compatibility limitation. Expanding forensic observations or adding controls
for ambiguous replay markers requires separate native semantics/review.

### Inbox async reads (F45)

`AsyncStateController<T>` owns `idle | loading(previous, error) | ready(value) |
error(previous, message)`, a retained value, and monotonic request tokens.
`begin` starts a request; `publish` accepts content without ending dependent
hydration; `resolve`/`fail` settle only the current token. `finish` cannot clear
a newer request or an error. `invalidate` retires outstanding work while
retaining accepted contents and errors; `reset` explicitly returns to idle.
Quiet requests retain the existing presentation until they settle.

`IncomingLinksController` uses this owner for inbox reads, acknowledgement and
overflow dismissal. Accepted inbox contents become visible before read-policy
hydration finishes. Acknowledgements remain quiet unless superseding an
already-visible loading state. Listener registration has its own generation;
initialization readiness, conservative pending protection, listener errors and
repository policy generations remain orthogonal. Late subscriptions are still
released, stale snapshots ignored, and failed/retired reads never empty the inbox.
Native acknowledgement/overflow commands emit an inbox event before returning.
Their confirmed outcome is independent of the refresh generation started by
that event. An acknowledgement removes only its exact ID from retained contents;
it cannot overwrite newer requests or clear a newer read error. A temporary
confirmed-ID receipt filters already-started snapshots until an accepted native
snapshot observes its absence. Stopping the controller suppresses UI publication,
not the confirmed acknowledgement result.

Overflow has no item/revision identity. A late overflow receipt updates only the
overflow field, and only if no newer snapshot has been accepted since dispatch.
Otherwise the newer observation wins. Pending protection stays conservative
while the newer refresh is pending/failed; a read retry is still required.
`AsyncStateController.updateValue` retains confirmed changes without completing
the current read, clearing its error, or advancing its request generation.
Rejection or a malformed command response is **unconfirmed**, not proof of no
mutation: native commands mutate before returning a fresh snapshot. The error
asks for a read refresh before deciding whether to retry; no dismissal is replayed
automatically. `acknowledge` returning false includes this unknown outcome.
Uncertainty has an orthogonal error/admission owner and mutation epoch, not the
read request token. Dismissal controls and controller entry points remain blocked
until an accepted read **started after the unknown outcome** reconciles the
inbox. A read already in flight cannot release the guard: it may have captured
pre-mutation contents even if its response arrives later. Such reads may still
publish newer contents without erasing uncertainty or releasing pending
protection. A later event can start the required read; otherwise the explicit
read retry does so. Deferred-read fixtures cover delayed/failed native events.
Closing and reopening the dialog does not remove this protection.
Injected post-mutation rejection/malformed-response tests verify retained
contents, conservative protection, and read-only reconciliation. They do not
claim that the underlying native post-mutation failure has been reproduced.
This helper is not a replacement for confirmed mutation receipts or native
capabilities. Other loader families remain candidates, not completed migrations.

Coverage: `async-state.spec.ts`, `incoming-links-controller.spec.ts` and
`incoming-repository-links.spec.ts` (renderer).

### Live operations and background fetch (F01, F10, F11)

`OperationTracker` owns a collection of live foreground operation identities,
not a mutable count or the activity-log length. Each identity carries its
repository and native operation ID, plus an orthogonal cancellation state:
`idle | requested(request) | accepted(request)`. A refused/failed cancellation
returns to idle for retry; acceptance does not complete work. Only the original
operation's `finally` removes that identity. Startup restoration also owns an
identity without adding a presentation-log entry. Late cancellation replies cannot
attach to a replacement. The existing per-call `success | error | cancelled`
result and activity-log outcome remain authoritative for completion.

The background region is independent: `idle -> waitingForHistory(repository,
request) -> fetching -> reconciling -> idle`, with early exit/error allowed from
any active phase. Busy and repository identity are atomic read-only projections;
obsolete cleanup cannot release a newer owner. Repository-keyed failure/timestamp
history, automatic authentication-retry suppression, history barriers, inbox
pausing, and closed-repository reconciliation retain their existing owners.
An older background result cannot set a timestamp or pause a reopened tab.
A confirmed manual Fetch clears only the failure record it began with, for
the checkout that it actually fetched. This applies to Workspace Fetch as
well as the toolbar. Auth and transport failures can be retried by covering
all remotes or the checkout's one configured remote. A configured-scope
refusal requires successful ordinary Fetch All; branch-only or named Fetch
may succeed without checking the scope used by automatic Fetch.
Foreground branch-mutation admission remains a separate lock. Recovery,
post-write inspection, receipts, and warning delivery are not collapsed into
the tracker.

Ordinary foreground Fetch and background sync do not prune refs, even when
Git config enables pruning. Use the explicit branch-only Fetch options to
prune stale remote-tracking branches. A background fetch also leaves
`FETCH_HEAD` alone; foreground Fetch still records its result there. Both
paths preflight configured destinations before starting transport. Named
Fetch, Fetch All and background sync refuse a mapping that may write
directly to a local branch. They don't change the remote config. Other
configured tracking mappings remain available, and explicit branch-only
Fetch options already isolate the configured mapping. Fetch All and the
background path honor remote opt-outs; the background path fetches each
changed remote by name:
Git 2.39 does not carry the no-write flag into multi-remote fetch children.

Coverage: `operation-tracker.spec.ts`, `operation-tracker-characterization.spec.ts`,
`activity-log-concurrency.spec.ts`, `fetch-result-lifecycle.spec.ts`,
`background-status.spec.ts`, `snapshot-mutation-lifecycle.spec.ts` and
`workspace-menu-busy.spec.ts`.

### Observed facts and hypotheses

- **Observed:** context menus replace different context-menu kinds; toolbar
  siblings replace each other. Escape returns focus; outside presses and blur
  dismiss transient menus. Existing capture-phase dismissal is significant.
- **Observed:** merge plus bisect, rebase plus bisect, replay plus bisect, and
  multiple externally supplied operation markers remain separately visible.
  Any operation representation must preserve these combinations.
- **Observed:** no-commit cherry-pick and revert share the durable review
  journal, but Continue/Skip/Finish-manually guards remain distinct in the
  banner and command palette; no-commit sequences deliberately have no Skip.
- **Observed and corrected:** acknowledgement superseding an in-flight inbox
  read invalidated its cleanup without clearing `loading`, leaving the spinner
  stuck. A deferred-response unit test failed before migration and now requires
  the newest request to settle loading. Ordinary acknowledgement remains quiet.
- **Observed and corrected:** a malformed inbox reply silently retained old
  contents without reporting the read failure. A characterization test failed
  before migration; invalid replies now use the existing retryable read-error
  presentation and retain the accepted inbox.
- **Observed and corrected:** the native event delivered before a dismissal
  reply advanced the shared generation, so a confirmed acknowledgement returned
  false and a failing event refresh left the dismissed inbox entry/overflow
  visible. Deferred event/reply tests reproduce this ordering. The pilot now
  preserves confirmed exact-ID receipts separately from read freshness; tests
  cover failed reads before/after the reply, newer accepted snapshots, late
  pre-confirmation snapshots, and teardown. Unversioned overflow is deliberately
  conservative rather than allowed to erase a newer observed overflow.
- **Hypothesis, not a reproduced bug:** asymmetric app/workspace toggle reset
  lists could leave two menus open. Pointer capture already dismisses outside
  dropdowns; differing reset lists alone do not prove a visible inconsistency.

No intentional UX change follows from a static risk alone. The goal is less
distributed state without changing the domain's safety or observable behavior.

## Frontend and cross-layer inventory

The transition sketches are descriptive, not instructions to merge their
owners. Unless explicitly listed above as implemented, entries are existing
protocols or future migration candidates; the listed tests are relevant
coverage, not proof of all transitions.

| ID / family | Owner | States and transitions | Relevant coverage |
|---|---|---|---|
| F01 Initialization | `git-khronos.service.ts`, `app.component.ts` | Uninitialized -> system-info pending -> native ready / native failed / browser preview -> restoration. | `startup-failures.spec.ts`, `repository-open-failures.spec.ts` |
| F02 Workspace/tab selection | `GitKhronosService`, `AppComponent` | Saved -> switching -> cached/restored/unavailable tabs -> selected; closed -> recently closed -> reopened. | `workspace.spec.ts`, `workspace-menu-busy.spec.ts` |
| F03 Open/init/clone | `repository-dialog.component.ts` | Closed -> local/init/provider selection -> destination -> submitting -> opened/error/cancelled; keep drafts independent. | `clone-options.spec.ts`, `welcome-launcher.spec.ts` |
| F04 Snapshot reconciliation | `GitKhronosService`, `scheduleRepositoryRefresh` | Scheduled -> reading -> accepted/stale/failed/deferred; per-repository mutation/status/history generations. | `background-status.spec.ts`, `snapshot-concurrency.spec.ts`, `snapshot-mutation-lifecycle.spec.ts` |
| F05 History pagination | `GitKhronosService`, native cursor registry | Idle -> barrier -> page pending -> appended/exhausted/stale/error; close invalidates session cursor. | `history-pagination.spec.ts`, `history-review-loading.spec.ts` |
| F06 Status paging/file search | `GitKhronosService`, native repository reads | Debounced query/page -> reading -> accepted/complete/stale/error; search and authoritative status differ. One page read at a time per repository; a late error does not follow the user into another checkout. Native status retains a page of rows, counts overflow, and concurrently drains bounded diagnostics. | `status-pagination.spec.ts`, `working-tree-lifecycle.spec.ts`, `bounded_status_drains_diagnostics_before_parsing_records` |
| F07 Details/diff/comparison | `GitKhronosService` | Unselected -> details pending -> selected details -> file diff pending -> loaded/error; new identity invalidates old request. | `history-comparison-lifecycle.spec.ts`, `stash-preview-lifecycle.spec.ts`, `diff-action-lifecycle.spec.ts` |
| F08 Whole-history search | `history-search.service.ts` | Prompt -> searching -> partial/complete/error; stopping -> acknowledgement -> incomplete; preserve prior results. | `history-search-lifecycle.spec.ts`, `history-search.spec.ts` |
| F09 File history/blame | `GitKhronosService`, `file-blame.component.ts` | Unbound -> captured target read -> page/more/error -> source navigation; target includes revision/path/line. | `blame-pages.spec.ts`, `file-content-entry.spec.ts` |
| F10 Auto-fetch/live status | `AppComponent`, `GitKhronosService` | Disabled/paused/hidden -> scheduled -> due/waiting-for-busy -> fetching -> timestamp/error -> scheduled. | `deferred-background-ui.spec.ts`, `fetch-result-lifecycle.spec.ts`, `background-status.spec.ts` |
| F11 Foreground activity/cancellation | `GitKhronosService.run`, `cancellable-operation.ts` | Registered/running -> cancel requested -> accepted/unacknowledged/finished -> success/error/cancelled; operations may overlap. | `activity-log-concurrency.spec.ts`, `mutation-concurrency.spec.ts` |
| F12 Working-tree mutation | `repository-file-actions.ts`, `GitKhronosService` | Dispatch -> applied/refused/unknown -> inspection -> confirmed/inspection failed; defer competing reads. | `file-operation-lifecycle.spec.ts`, `snapshot-mutation-lifecycle.spec.ts`, native `ignore_outcome_tests.rs` |
| F13 Commit composer | `AppComponent`, `GitKhronosService`, `commit-template-banner.component.ts` | Edit/restore/template -> validation -> committing -> committed -> optional push -> pushed/push failed. Native commit/amend and snapshot refresh share the repository operation lock on a worker, without blocking other native UI commands. | `commit-template.spec.ts`, `commit-policy.spec.ts`, `push-sync.spec.ts`, native `commit-responsiveness` |
| F14 Undo/redo | `operation-history.ts`, `GitKhronosService` | No entry -> reversible -> undo pending -> undone -> redo pending -> restored; expected-ref guards remain authoritative. | Unit `operation-history.spec.ts`, `operation-history-lifecycle.spec.ts` |
| F15 Rebase planning | `AppComponent`, rebase editor and merge-rebase dialog | Closed -> prepare -> reviewed/editing -> applying -> native running/conflicted/edit-stopped/completed; stale plan retired. | `rebase-loading.spec.ts`, `selected-rebase.spec.ts`, `merge-rebase.spec.ts` |
| F16 Conflicts | `GitKhronosService`, `AppComponent` | Checkout-owned Show conflicted files -> focused file list (or paging when truncated); navigation issues no Git mutation. Inspect -> editable/read-only content -> resolution review -> writing/staging -> resolved/refused/reinspect. | `conflict-lifecycle.spec.ts`, `conflict-safety.spec.ts`, installed `conflict-navigation` suite |
| F17 Stash actions | `GitKhronosService`, `stash-delete-dialog.component.ts` | Select exact ref/OID -> review -> apply/delete -> success/conflict/refusal/error; retain identity across reordering. | `stash-action-lifecycle.spec.ts`, `stash-delete-lifecycle.spec.ts`, `stash-file-restore.spec.ts` |
| F18 Discard/reset/recovery | `AppComponent`, core `operation_recovery.rs` | Prepare -> review -> preserve -> apply -> refreshed/failed/unknown; saved capture -> restore/reverse/forget. | `discard-recovery.spec.ts`, `operation-recovery.spec.ts` |
| F19 Reference/remote confirmations | `AppComponent`, `reference-action-dialog.component.ts` | Select -> inspect expected refs -> review -> applied/stale/error; dismiss retires review. Single `refs/original/*` deletion captures repository ID, full name and direct commit OID; an atomic non-dereferencing lease rejects changed or symbolic refs. | `reference-actions.spec.ts`, `push-sync.spec.ts`, `original-references.spec.ts`, native `original_reference_*` tests |
| F20 Branch workflows | `branch-workflow-dialog.component.ts`, core finish journal | Settings -> prepare -> review -> apply -> durable ready/conflicted/complete/aborted; explicit retry/acknowledge. | `branch-workflows.spec.ts`, core `branch_workflow_finish.rs` tests |
| F21 Mail patch | `mail-patch-panel.component.ts`, core `mail_patch.rs` | Choose -> import/export review -> execute -> stopped/conflict/completed; continue/skip/abort rediscovered from Git. | `mail-patch.spec.ts` |
| F22 Patch/bundle exchange | `patch-exchange-panel.component.ts`, `bundle-exchange-panel.component.ts` | Select -> verify/review -> ready -> import/export -> success/error. Imports bind a fingerprint; incremental export binds the repository visit, branch tip and prerequisite commit. Input or context changes invalidate the review. | `patch-exchange.spec.ts`, `bundle-exchange.spec.ts` |
| F22a Committed source ZIP | `graph-action-menu.component.html`, `source_zip.rs` | Single commit -> save picker -> bounded, cancellable generation -> exclusive file write. The picker belongs to a checkout visit; it cannot dispatch after that visit ends. A cancellation during the final exclusive write does not erase the result. | `source-zip.spec.ts` and real-Git archive tests |
| F23 Worktrees | Worktree move/registration dialogs, `AppComponent` | Inspect location/registration -> review -> create/move/repair/prune -> actual result/error. | `worktree-move.spec.ts`, `worktree-registration.spec.ts`, `worktree-repair.spec.ts` |
| F24 Submodules | `submodule-state-review.component.ts`, core `submodule_review.rs` | Inspect independent worktree/config facts -> confirm per-item/bulk action -> execute -> reload/partial/error. Opening a missing checkout is review-only. Single remote update also requires explicit review and rechecks the selected checkout for local changes natively before transport. | `submodule-review.spec.ts`, `--suite submodule-initialize`, core `adds_initializes_and_updates_submodules` |
| F25 LFS | `lfs-tracking-dialog.component.ts`, `AppComponent`, native commands | Inspect -> fetch/hydrate/lock/prune review -> execute -> result; distinct target and auth scopes. | `lfs-tracking.spec.ts`, `lfs-locks.spec.ts`, `lfs-prune.spec.ts`, `desktop:test-lfs` |
| F26 Integrity/maintenance | `integrity-panel.component.ts` | Scan -> result/error/cancelling; separate maintenance confirmation -> pending -> complete/error. | `integrity.spec.ts` |
| F27 Workspace center | `workspace-center.component.ts`, `workspace-actions.ts` | Parallel overview refresh, sequential batch/per-item outcomes, identity validation/persist/apply, file search/review/mutate. | `workspace-center.spec.ts`, `file-operation-lifecycle.spec.ts`, unit `identity-profiles.spec.ts` |
| F28 Hosted reads | `hosting-panel.component.ts`, core `hosting.rs` | Keyed page/review pending -> loaded/error/cancelling; context change invalidates read. | `hosting-center.spec.ts`, `hosted-writes.spec.ts` |
| F29 Hosted writes | `hosted-write-panel.component.ts`, core `hosting_writes.rs` | Edit -> prepare -> immutable reviewed plan -> submit -> confirmed/refused/uncertain; unknown blocks replay. | `hosted-writes.spec.ts`, core hosting-write tests |
| F30 Hosted browsing/clone | `hosted-repository-browser.component.ts` | Filter/page -> select -> inspect -> options -> prepare -> review -> clone -> opened/failure/cancel. | `hosted-repositories.spec.ts`, `clone-options.spec.ts` |
| F31 Hosted forks | `hosted-forks.component.ts`, core `hosted_fork_request.rs` | Discover -> preview -> dispatch -> awaiting/accepted/metadata/ready/conflict -> reconcile/archive; retain confirmed receipt after view retirement. | `hosted-forks.spec.ts`, core `hosted_fork_request_tests.rs` |
| F32 Fork remote | `hosted-fork-remote.component.ts`, core remote implementation | Configure -> inspect -> preview -> apply -> confirmed/stale/error; local mutation identity differs from remote-read identity. | `hosted-forks.spec.ts`, core `hosted_fork_remote_tests.rs` |
| F33 GitLab account/projects | `gitlab-projects.component.ts`, native `gitlab_commands.rs` | Disconnected -> connecting -> verified session -> listing/selected -> expired/stale/disconnecting. | `gitlab-projects.spec.ts`, native `gitlab_commands_tests.rs` |
| F34 GitLab clone | `gitlab-clone.component.ts`, native clone commands | Inspect -> options -> prepare -> review -> clone -> actual result; close/cancel retires view, not confirmed receipt. | `gitlab-clone.spec.ts`, native clone tests |
| F35 GitLab forks | GitLab fork/create/records components and native submission | Discover/search -> draft -> reviewed -> submit -> awaiting/accepted/rejected/storage-unconfirmed; saved record inspection/archive never restores authority. | `gitlab-forks.spec.ts`, `gitlab-fork-creation.spec.ts`, native fork tests |
| F36 Authentication | `authentication.component.ts`, native/core `authentication.rs` | Module load; listener setup/snapshot/listening; queued prompt -> active -> sending -> dismissed/expired/error; operation cancellation is separate. | `authentication-lifecycle.spec.ts`, `authentication.spec.ts`, native transport suites |
| F37 Terminal | Root terminal intent, `terminal-panel.component.ts`, native terminal registry/I/O | A loading or failed renderer chunk can be dismissed before a PTY exists. Once mounted: opening -> registered -> running -> exited -> closing -> closed/close failed; early output/exits buffered; input serialized. | `terminal-loading.spec.ts`, `terminal-lifecycle.spec.ts`, native `terminal_lifecycle_tests.rs` |
| F38 In-app editing | `working-file-editor.component.ts`, native working-file commands | Loading -> clean/dirty/read-only/needs-reload -> save -> confirmed/uncertain write plus independent staging outcome; close protection. | `working-file-editor.spec.ts`, `editor-draft-recovery.spec.ts`, native editor tests |
| F39 Draft snapshots | `editor-draft-snapshots.ts` | Explicit idle -> pending -> saving -> saved/failed; debounce/coalesce, failure pauses retry, flush/discard/dispose preserve queue ownership. | `tools/editor-draft-snapshots.test.mjs` |
| F40 Recovery inventory | `editor-draft-recovery.component.ts`, native/core recovery stores | Inspect partial/complete inventory -> exact-copy review -> read/load/discard -> removed/unknown -> reconcile; preserve corrupt/pending evidence. | `editor-draft-recovery.spec.ts`, native recovery suites |
| F41 File/media loading | `file-content-dialog.component.ts`, `file-media.component.ts` | Target read -> content classification -> decode/display/error; close/context invalidates late reads/decodes. | `file-media.spec.ts`, `file-content-entry.spec.ts` |
| F42 External tools | `file-tools-dialog.component.ts`, `file-tool-actions.service.ts`, native runtime | Launch review -> launch -> running/exited/failed -> result/save/stage/cleanup reviews -> closed/cleanupFailed; pending and uncertainty can coexist. | `file-tools.spec.ts`, native/core file-tool tests |
| F43 Configured programs | `configured-tools.service.ts`, panel | Absent/default or valid version -> decoded configuration; unreadable -> preserved/blocked; async validate -> persist -> activate. | Unit `configured-tools.spec.ts`, configured-tool renderer cases |
| F44 Appearance | `AppComponent`, `ui-zoom.ts`, native `display_environment.rs` | Read/normalize -> DOM/webview apply -> native projection -> persist; reset selected preferences; requested/applied/persisted differ. | Unit `app-theme.spec.ts`, `ui-zoom.spec.ts`, `font-layout.spec.ts`, native display tests |
| F45 Incoming links | `incoming-links-controller.ts`, link dialog, native inbox | Listener and inbox read independent; pending/overflow -> discover -> review/open/clone -> acknowledge; failures retain guard and pause fetch. | `incoming-repository-links.spec.ts`, `repository-links.spec.ts` |
| F46 Overlays/focus | `AppComponent`, dialogs, `OverlayController` | Closed -> open -> rendered/focused -> action/nested review -> dismiss -> opener/fallback; local scopes, not one global phase. | Controller unit tests, characterization and context-menu/workspace/nested-review specs |
| F47 Pointer/resize/hover | `resize-pointer.ts`, `AppComponent`, viewport components | Idle -> captured gesture -> move -> finish/cancel -> restore; hover pause/timer and measured viewport remain separate. | `graph-layout-readiness.spec.ts`, `graph-scrollbar.spec.ts`, `diff-keyboard-scroll.spec.ts` |
| F48 Markdown worker | `markdown-preview.component.ts` | Input -> debounce -> worker -> result/error/timeout; replacement/dispose closes request and terminates owned worker. | Unit `markdown-preview.spec.ts`, `working-file-editor.spec.ts` |
| F49 Documentation/feedback | Documentation service/dialog, template banner | Topic selection -> manual opening -> success/error; copied/failed -> cleared; retry review -> restore focus. | `git-documentation.spec.ts`, unit topic tests, `commit-template.spec.ts` |
| F50 Signing diagnosis | `GitKhronosService`, native signing inspection | No result -> captured-repository diagnosis -> available/attention/failed; cache is repository-bound, not signing authority. | `desktop:test-signing`; cross-context renderer characterization remains a candidate |
| F51 Sparse checkout | `AppComponent`, core sparse commands | Edit -> set/disable confirmation -> apply -> refreshed/left-out-path warning/error; reapply is explicit and separate. | `sparse-left-paths.spec.ts`, core sparse tests |
| F52 Bisect | `AppComponent`, `GitKhronosService`, core marker inspection | Inactive -> known-good/current-bad review -> active -> verdict -> next/found -> reset original context; externally mutable. | Characterization spec, core bisect tests; all verdict interleavings not established |
| F53 Graph-local navigation | `AppComponent`, pure graph helpers | Search expand/filter -> derived matches -> next/previous/select; reference pin/solo/hover and viewport navigation are independent. | `history-search.spec.ts`, unit graph-scroll tests, `graph-virtualization.spec.ts` |

## Native authority and durable protocols

| ID / family | Owner | States and transitions | Relevant coverage |
|---|---|---|---|
| N01 Repository/operation registries | Native `lib.rs` | Absent -> registered session/watcher -> locked read/mutate -> closed; operation registered -> cancellation signalled -> RAII unregister. | Native checkpoint tests; renderer concurrency suites |
| N02 Git child/askpass/deadlines | Core `git_cancellation.rs`, `authentication.rs`, native authentication | Scoped -> child running/readers -> complete/cancelled/timeout/output-limited -> terminate/reap; prompt response/refusal/timeout -> cleanup. | Core cancellation/transport tests, native HTTPS/SSH scenarios |
| N03 Terminal exit join | Native `terminal_io.rs`, registry | Reader done and child reaped can arrive in either order; announce exit once only after both. | Native `terminal_lifecycle_tests.rs`, renderer terminal lifecycle |
| N04 Git operation observations | Core `lib.rs`, `no_commit_replay.rs`, `rebase_split.rs` | Git markers -> independent observed operations; replay applying/conflicted/index and split preparing/active require exact OID/tree journals. | Core replay/split/revert/rebase tests; renderer characterization |
| N05 Branch finish journal | Core `branch_workflow_finish.rs` | ready -> checkingOut -> merging -> conflicted/next target -> tagging -> cleaning -> complete; abort/reconcile/retry. | Inline journal tests, `branch-workflows.spec.ts` |
| N06 Review capabilities | Native review stores and command modules | Absent -> reserved/preparing -> published -> consumed/discarded/expired; reservation drop retires failed preparation. | Native file-tool/GitLab review tests; renderer stale-token tests |
| N07 Hosted fork journal | Core `hosted_fork_request.rs` | awaitingConfirmation -> acceptedPending -> metadataAvailable -> ready/conflict; unknown remains inspectable; acknowledge/archive exact record. | `hosted_fork_request_tests.rs` |
| N08 GitLab submission/journal | Native submission/session; core fork record/journal | Independent account lifetime, response, durable-storage confirmation, provider import and immutable successor revisions -> inspection/archive. | Native fork submission/recovery; core journal/reconcile tests |
| N09 Editor revision/recovery | Native working-file/recovery; core recovery/write modules | Current revision -> active write -> confirmed/uncertain -> new revision; committed/pending/corrupt recovery evidence -> reconcile/retire. | Native editor/recovery tests, core recovery tests |
| N10 External tool resources | Native file-tool runtime/reviews; core process model | Session launching/launched/failed/cleanupFailed; independent child running/exited/cancellation; reviewed result -> save/stage/cleanup. | Native/core file-tool suites |
| N11 Native startup/chrome | Native `lib.rs`, `display_environment.rs` | Capture args -> window/chrome -> listeners; second instance forwards URI; coalesced refresh; persisted chrome is a projection. | Native incoming-link/display tests |
| N12 GitLab HTTPS | Core `gitlab_https.rs` | Validate origin -> connect -> response/refusal/timeout/cancelled; redirect refused; no automatic write replay. | `gitlab_https_tests.rs`, native GitLab fixtures |

## Delivery and tooling protocols

These are inventoried, not migration targets in the renderer refactor. The
installer/package-transition files must not be modified by this task.

| ID / family | Owner | States and transitions | Relevant coverage |
|---|---|---|---|
| D01 Build receipts/cache | `tools/build-linux-package.sh`, `tools/package-build-receipt.mjs` | Acquire workspace writer lock -> owned pending attempt -> verified outputs -> atomic completed receipt -> reusable only with matching digests. The writer lock spans shared renderer and notice writes even across separate Cargo outputs. | `tools/package-deb.test.mjs` |
| D02 Installer/package manager | `install.sh`, `tools/manage-linux-package.sh` | Validate -> select source/download/local -> verify -> fresh/legacy/already-present transaction -> install/uninstall -> inspect/cleanup. | Installer/package tests |
| D03 APT guard parser | `tools/guard-linux-package-transition.sh` | Version header -> config frame -> terminator -> allowed action records -> required app action -> accept, otherwise refuse. | Package-transition tests |
| D04 Validation resource ownership | `tools/run-validation.mjs`, `owned-command.mjs`, native harness | Started evidence -> owned child -> exit/abort -> graceful/forced cleanup -> reaped/pipes closed -> one report. | Owned-command/validation/native harness tests |
| D05 CI/release | `.github/workflows/ci.yml`, `release.yml`, `publish-signed-debian.yml` | Validate tag/version/ancestry -> build once with pinned trust -> qualify unchanged package -> sign offline -> verify exact assets read-only -> protected publication. Ordinary CI does not publish. | Workflow definitions and package tests; no live CI audit implied |
| D06 IPC generation | `tools/generate-ipc.mjs`, Rust exporter, contracts | Rust schema -> Specta -> AST adapter -> generated bindings -> freshness/type checks; request/event lifetime remains caller-owned. | `contracts:check`, generator tests, unit `ipc-contract.spec.ts` |

## Already-explicit state: preserve, do not rewrite

| Type | Owner | Existing states/role |
|---|---|---|
| `FileToolSessionPhase` | Native `file_tool_commands.rs` | Tool session launch/failure/cleanup phase; separate from child process. |
| `SubmissionPhase` | Native `gitlab_fork_submission.rs` | Submission acknowledgement, rejection and storage uncertainty. |
| `BranchWorkflowFinishPhase` | Core `branch_workflow_finish.rs` | Durable multi-target workflow phases and recovery. |
| `GitLabForkPhase` | Core `gitlab_fork_record.rs` | Durable provider observations, not permission to replay. |
| `HostedForkPhase` | Core `hosted_fork_request.rs` | Awaiting/accepted/metadata/ready/conflict observations. |
| `FileToolProcessState` | Core `file_tool_model.rs` | Running/exited process evidence independent of session phase. |
| `EditorStage` | Native `working_file_commands.rs` | Staging acknowledgement independent of disk-write outcome. |
| `WorkingFileWriteStatus` | Core `working_file_edit.rs` | Confirmed versus uncertain working-file write. |
| `HostingState` | Core `hosting.rs` | Hosting classifications; an enum need not be a temporal machine. |
| `DraftSnapshotState` | Frontend `editor-draft-snapshots.ts` | idle/pending/saving/saved/failed, with serialized generation-bound effects. |
| Dialog/view/action unions | Local frontend owners | Keep existing domain-specific modes and reviewed action identities. |

Independent persisted disclosure preferences (`changesOpen`, section visibility,
branch/tag/stash groups), form fields, pure derived geometry, content kinds and
ordinary user options do not need lifecycle controllers.

## Validation and safe continuation

Before each subsequent migration: characterize its acceptance and teardown
predicate, keep old UI accessors as read-only projections, then run the
repository's Nx targets (`desktop:test`, `desktop:check`, `desktop:build`,
`contracts:check`) and the affected renderer specs. There is no configured
standalone lint target; Rust Clippy is part of `desktop:check`.

The implemented Git operation model retains independent operation families in a
collection, with deprecated legacy fields derived from the new representation.
It preserves the replay detector's existing precedence, not every raw marker.
Preserve this compatibility boundary when extending it.
Regenerate, never hand-edit, `libs/contracts/src/native.ts`.

For asynchronous reads, preserve prior payload/guard behavior on failure and
context retirement. Listener connectivity, initialization readiness, pending
inbox guard, and loading phase are separate dimensions. Do not apply a generic
idle/loading/ready/error type to uncertain writes or cancellable searches
without retaining their domain-specific outcomes.

The inventory is comprehensive at the lifecycle-family level of the static
audit, not a proof over all interleavings. Only the ownership migrations above
are implemented. Other overlays and async loaders (including tracked-file search,
history, details, recovery reads and diagnostics) remain with their current
generation/context guards. Their inventory entries identify existing tests and
risks, not a completed migration or new exhaustive characterization. These
domain-specific migrations require separate behavioral coverage; no generic
state wrapper should erase error distinctions, accepted writes, or capabilities.

### Deferred overlay styles

Preferences, Repository Management, and Activity Logs load their content
styles with their deferred components. Selectors are scoped to the component
host, including embedded panels. Shared modal form and shell rules and
launcher/status controls remain in the startup stylesheet. The Preferences
shell still styles loading and failure states when its feature chunk never
arrives. Activity Logs has a non-modal loading/error panel. Closing it while
loading retires the open request without discarding log entries; a late chunk
cannot reopen it or take focus from a different control. Repository Management
also keeps an eager loading/error shell. While
the request owns the modal, Tab stays in the dialog and background Git
shortcuts are ignored, including in the gap before the module renders. Escape
retains drafts and returns focus only to the current request's opener.
The stash action menu also loads on demand. Its root shell owns anchor,
keyboard dismissal and repository/request identity before the chunk loads.
Positioning refits the rendered actions against the original anchor, and a
retired menu or failed chunk cannot submit a stash action.
The branch-drop menu also loads on demand, with a root-styled failure notice.
The drop owns the repository path and ID and the source and target branch
tips. A changed snapshot retires it, and comparison results must match both the
active drop request and its tips; a native comparison detecting newer tips
retires the review even before the snapshot changes. The rendered menu refits
after late comparison text without retaking focus.

Both a direct drop and the merge/rebase chooser send the receiving and source
branch names and tips to native before switching or integrating. The native
repository operation lock serializes app mutations; Git resolves only exact
local refs, checks both tips and the receiving HEAD just before integration,
and integrates the verified source commit rather than a moving source name.
An ordinary checkout does not require this review. If checkout succeeds but a
tip then changes, the app can remain on the new branch without integrating.
This is not a transaction with external Git processes: another process can
still change the receiving HEAD or ref between validation and Git acquiring
its own locks. The integration command continues to rely on Git's checks for
worktrees, local changes, conflicts, and history ancestry.

`deferred-overlay-styles.spec.ts` covers the deferred layout, and
`integration-dialog.spec.ts` covers ownership and the checkout handoff.
`branch_comparison_tests.rs` uses real Git repositories to verify unchanged-tip
integration and refusal of moved tips, detached or different HEAD, and nonlocal
refs with colliding names.

Recovery History owns its deferred layout and retains an eager, dismissible
loading/error shell. Both phases consume workspace keyboard shortcuts and
restore focus only if no newer surface took it. A distinct open request owns
the repository path and ID, capture/ref query state and focus callbacks.
Closing invalidates pending reflog and saved-operation capture reads; a stale
success or failure cannot populate or announce errors in a reopened history. A still-open
review from another repository reports the mismatch and refuses mutations.
The nested discarded-change history remains an independent dialog.
`operation-recovery.spec.ts`, `discard-recovery.spec.ts`, and
`deferred-overlay-styles.spec.ts` cover these boundaries.

### Application update intent, consent and installation receipts

Application updates are application-global, not a repository mutation lifecycle.
`application_update_model.rs` separates offered/verified package state, automatic
consent epochs and accepted installation receipts. Manual actions do not require
automatic consent. Opt-out retires future automatic intent but cannot discard an
already admitted install's actual outcome. A durable prepared receipt precedes
OS invocation; uncertain persistence or installer outcome blocks automatic replay
across restart. If a final native-activity check finds new work before any OS
invocation, the same worker may durably retire its own still-matching prepared
receipt. That leaves the verified package available for a fresh attempt when
idle. If the stored proposal changed or durable retirement cannot be confirmed,
the in-memory updater remains uncertain and blocks replay. A process that
crashes before retirement still leaves a receipt for recovery.
Native installer outcomes and package/version observations, not a download or
renderer acknowledgment, govern installation confirmation. Worker failure after admission becomes
inspectable uncertainty rather than an indefinitely busy UI; late worker failure
cannot overwrite an already confirmed native outcome.

The native controller owns HTTPS sources, pinned publisher trust, opaque offer
IDs, bounded downloaded bytes, signed-version verification and installer paths.
Read-only package inspection has output/time limits and owns its decompressor
process group. Linux authorization uses fixed OS programs and the registered
system authentication agent, without a textual-password fallback. Debian auth
refusal is distinct from potentially partial installer failure; ambiguous
outcomes remain uncertain. The installed version is rechecked before launch;
the Debian transaction itself refuses a downgrade even if another installer
has since updated the application. Windows self-installation is still disabled
pending a safe restart boundary. Missing publisher trust is fail-closed, not permission
to trust a key supplied in a manifest.

The deferred Updates review captures a request identity and restores only its
own opener. Native state survives presentation closure. Pending install IPC is
one-shot before a status event arrives; out-of-order native responses cannot
replace newer revisions. Preference widgets reflect confirmed native state even
when a write is refused or its response is lost. Browser preview never initiates
an updater request. The manual browser fallback opens only the fixed official
releases page on an explicit action and never converts a missing manifest into
an up-to-date result, requests installation, or changes consent. Browser-open
errors belong to the owning dialog. The native scheduler, not renderer timers
or local storage, owns opt-in automatic checks and safe installation admission.
An unanswered renderer status read is retired after six seconds. It pauses
polling only if no newer native state was accepted while it was pending.
An explicit refresh or accepted native status can resume a paused poller,
and the retired reply can no longer change the view. In particular, an
obsolete deadline cannot freeze a live install blocker when Git finishes
without changing the updater revision. A read timeout never retries an
update operation or changes consent. Rejected status reads use a separate
automatic retry backoff from three to thirty seconds; an explicit refresh
bypasses the delay, and any accepted native status resets it. Reopening the
dialog can retry a failed event subscription.

Coverage: native `application_update` policy, signature/version binding, bounded
transport, real signed inert package metadata and receipt/worker fault tests;
`application-updates.service.spec.ts`; renderer `application-updates.spec.ts`;
and packaged `native_application_updates_scenarios.py`. Production signing-key
provisioning and release publication are separate operations. Platform and exact
artifact acceptance are not implied by fixture-only test results.
