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

## Implemented transition ownership

### Source-bound branch, sparse-checkout and worktree-removal reviews

Branch deletion/rebase and worktree removal requests capture the repository ID,
checkout path and return-focus target with their review data. Sparse checkout
uses one scoped request containing its action, selected paths and sparse-index
choice; the older scalar action view is derived from that request. Later edits
to a preferences draft cannot change the reviewed sparse payload or count.
These UI records are transient intent, not native mutation capabilities.

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

### Unstaged line recap reads

`WorkingTreeSummaryComponent` owns a separate optional read lifecycle rather than
making repository status or file-list loading wait for line statistics. Totals
compare tracked working files to the index, not HEAD, and include untracked text
using the existing attribute-aware counter. Conflicted entries belong to their
separate section. Binary or uncounted files are disclosed, not treated as text
with zero changes. Truncated status/stat output and budget-skipped untracked
files explicitly mark partial totals. The native read is bounded to 2,000 status
entries, 4 MiB numstat output and 16 MiB aggregate regular untracked-file input;
external diff/textconv are disabled and symlink targets are not opened.
A thread-scoped policy also prevents implicit network access: the no-lazy-fetch
environment guard is backed by command-level protocol refusal for older Git,
including explicit configured allow policies. It retires on return/unwind and
does not alter normal user-requested fetches or persistent Git configuration.
Missing local objects make this optional recap unavailable, never a hidden fetch.

Status bursts coalesce to one in-flight read and the latest desired snapshot.
Only the same checkout ID/path, status object, active request and idle source can
accept a result or error. Mutation/busy transitions invalidate old presentation;
a clean unstaged section becomes zero without a new read. Failure is shown as
unavailable rather than a fabricated zero, and the next status refresh retries.
Filtering, collapse and list/tree presentation do not redefine the section total.

Coverage: `unstaged-summary.spec.ts`, six native core `unstaged_summary` cases,
and the packaged `native_unstaged_summary_scenarios.py` fixture. Native fixture
execution remains a separate package gate, not implied by source test presence.

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
checkout without letting the old completion erase it. An optional push uses
the original consent only while the same tab, checkout, and branch remain
active; otherwise the user must review and push explicitly.

### Shared deferred fetch and worktree review ownership

Fetch options and linked-worktree move/repair capture the checkout ID/path and
request identity. Their deferred children consult synchronous root ownership,
not only possibly stale child inputs. Scope changes retire the review; outgoing
confirm/cancel/field events cannot act on its replacement. Keyed form views
prevent obsolete ngModel state from surviving a request reset. Busy native work
freezes the submitted payload; successful native outcomes govern dismissal.

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

### Source-bound publish, force-push and LFS cleanup reviews

Publishing, force-push and LFS cleanup capture repository ID/path and their own
return-focus target. Confirmation checks source scope, rendered request identity
and busy state before dispatch. Publish remote selection and the handoff to the
remote editor use the same guard. Force-push keeps the existing pinned local
and remote object IDs and native force-with-lease authority unchanged.

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

### Source-bound repository setup reviews

Worktree creation (new or existing branch), submodule addition, remote editing
and remote removal retain independent root-owned repository ID/path and request
object identities. Submission checks that owner synchronously before dispatch;
a scope effect alone cannot protect the interval before Angular runs it.
Changing the repository or changing its path retires only the mismatched review.

Each form captures its rendered owner with `@let` and passes that lease to
submission, browse and dismissal handlers. Input/change callbacks also compare
the rendered lease with the current request. Replacing a request before a render
therefore cannot let an old control submit into, overwrite or dismiss the new
review. The lease is transient UI intent, not a native Git capability or journal.

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

Coverage: `repository-setup-scope.spec.ts` exercises pre-effect repository/path
changes, outgoing rendered controls, valid native payloads, closed reviews,
replacement drafts, late write receipts, independent focus, and directory
choices. Existing reference, worktree, workspace and accessibility journeys
remain part of the local targeted gate.
`setup-dialog-keyboard.spec.ts` additionally covers real control key presses,
pre-render focus gaps and events from outgoing controls after dismissal. The
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
Compound checkout-then-integrate and reviewed history mutations retain their
original checkout semantics; navigation must not silently continue those writes
in another repository.

The deferred review permits explicit navigation only after refreshing the
source and rechecking the exact owner path, branch and non-prunable status.
Changed ownership or failed inspection stays in review with an error; there is
no fallback checkout, force option, repair or automatic replay. Closing or
changing the active repository retires the request; a late read cannot navigate.
Opening the owner uses the existing repository navigation path so source commit
drafts are saved. Git remains authoritative if occupancy changes before an
ordinary native checkout.

Coverage: `repository-location.spec.ts`, renderer
`branch-checkout-worktree.spec.ts` and existing branch-panel interaction tests.

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

The existing replay detector's precedence is deliberately unchanged:
no-commit replay / `CHERRY_PICK_HEAD`, then `REVERT_HEAD`, then the sequencer.
If both head markers exist, the typed collection contains the detected
cherry-pick, not both raw marker files. This is **not lossless raw-marker
forensics**, nor evidence that two marker files are two valid Git operations.
The focused `repository_operation_replay_markers_keep_legacy_precedence` fixture
pins this compatibility limitation. Expanding forensic observations or adding
controls for ambiguous replay markers requires separate native semantics/review.

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
Foreground branch-mutation admission remains a separate lock. Recovery,
post-write inspection, receipts, and warning delivery are not collapsed into
the tracker.

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
- **Observed:** no-commit replay has different Continue/Skip/Finish-manually
  guards in the banner and command palette.
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
| F06 Status paging/file search | `GitKhronosService`, native repository reads | Debounced query/page -> reading -> accepted/complete/stale/error; search and authoritative status differ. | `status-pagination.spec.ts`, `working-tree-lifecycle.spec.ts` |
| F07 Details/diff/comparison | `GitKhronosService` | Unselected -> details pending -> selected details -> file diff pending -> loaded/error; new identity invalidates old request. | `history-comparison-lifecycle.spec.ts`, `stash-preview-lifecycle.spec.ts`, `diff-action-lifecycle.spec.ts` |
| F08 Whole-history search | `history-search.service.ts` | Prompt -> searching -> partial/complete/error; stopping -> acknowledgement -> incomplete; preserve prior results. | `history-search-lifecycle.spec.ts`, `history-search.spec.ts` |
| F09 File history/blame | `GitKhronosService`, `file-blame.component.ts` | Unbound -> captured target read -> page/more/error -> source navigation; target includes revision/path/line. | `blame-pages.spec.ts`, `file-content-entry.spec.ts` |
| F10 Auto-fetch/live status | `AppComponent`, `GitKhronosService` | Disabled/paused/hidden -> scheduled -> due/waiting-for-busy -> fetching -> timestamp/error -> scheduled. | `deferred-background-ui.spec.ts`, `fetch-result-lifecycle.spec.ts`, `background-status.spec.ts` |
| F11 Foreground activity/cancellation | `GitKhronosService.run`, `cancellable-operation.ts` | Registered/running -> cancel requested -> accepted/unacknowledged/finished -> success/error/cancelled; operations may overlap. | `activity-log-concurrency.spec.ts`, `mutation-concurrency.spec.ts` |
| F12 Working-tree mutation | `repository-file-actions.ts`, `GitKhronosService` | Dispatch -> applied/refused/unknown -> inspection -> confirmed/inspection failed; defer competing reads. | `file-operation-lifecycle.spec.ts`, `snapshot-mutation-lifecycle.spec.ts`, native `ignore_outcome_tests.rs` |
| F13 Commit composer | `AppComponent`, `GitKhronosService`, `commit-template-banner.component.ts` | Edit/restore/template -> validation -> committing -> committed -> optional push -> pushed/push failed. | `commit-template.spec.ts`, `commit-policy.spec.ts`, `push-sync.spec.ts` |
| F14 Undo/redo | `operation-history.ts`, `GitKhronosService` | No entry -> reversible -> undo pending -> undone -> redo pending -> restored; expected-ref guards remain authoritative. | Unit `operation-history.spec.ts`, `operation-history-lifecycle.spec.ts` |
| F15 Rebase planning | `AppComponent`, rebase editor and merge-rebase dialog | Closed -> prepare -> reviewed/editing -> applying -> native running/conflicted/edit-stopped/completed; stale plan retired. | `rebase-loading.spec.ts`, `selected-rebase.spec.ts`, `merge-rebase.spec.ts` |
| F16 Conflicts | `GitKhronosService`, `AppComponent` | Inspect -> editable/read-only content -> resolution review -> writing/staging -> resolved/refused/reinspect. | `conflict-lifecycle.spec.ts`, `conflict-safety.spec.ts` |
| F17 Stash actions | `GitKhronosService`, `stash-delete-dialog.component.ts` | Select exact ref/OID -> review -> apply/delete -> success/conflict/refusal/error; retain identity across reordering. | `stash-action-lifecycle.spec.ts`, `stash-delete-lifecycle.spec.ts`, `stash-file-restore.spec.ts` |
| F18 Discard/reset/recovery | `AppComponent`, core `operation_recovery.rs` | Prepare -> review -> preserve -> apply -> refreshed/failed/unknown; saved capture -> restore/reverse/forget. | `discard-recovery.spec.ts`, `operation-recovery.spec.ts` |
| F19 Reference/remote confirmations | `AppComponent`, `reference-action-dialog.component.ts` | Select -> inspect expected refs -> review -> applied/stale/error; dismiss retires review. Single `refs/original/*` deletion captures repository ID, full name and direct commit OID; an atomic non-dereferencing lease rejects changed or symbolic refs. | `reference-actions.spec.ts`, `push-sync.spec.ts`, `original-references.spec.ts`, native `original_reference_*` tests |
| F20 Branch workflows | `branch-workflow-dialog.component.ts`, core finish journal | Settings -> prepare -> review -> apply -> durable ready/conflicted/complete/aborted; explicit retry/acknowledge. | `branch-workflows.spec.ts`, core `branch_workflow_finish.rs` tests |
| F21 Mail patch | `mail-patch-panel.component.ts`, core `mail_patch.rs` | Choose -> import/export review -> execute -> stopped/conflict/completed; continue/skip/abort rediscovered from Git. | `mail-patch.spec.ts` |
| F22 Patch/bundle exchange | `patch-exchange-panel.component.ts`, `bundle-exchange-panel.component.ts` | Select -> verify/review -> ready -> import/export -> success/error; input/context invalidates fingerprint-bound review. | `patch-exchange.spec.ts`, `bundle-exchange.spec.ts` |
| F23 Worktrees | Worktree move/registration dialogs, `AppComponent` | Inspect location/registration -> review -> create/move/repair/prune -> actual result/error. | `worktree-move.spec.ts`, `worktree-registration.spec.ts`, `worktree-repair.spec.ts` |
| F24 Submodules | `submodule-state-review.component.ts`, core `submodule_review.rs` | Inspect independent worktree/config facts -> confirm per-item/bulk action -> execute -> reload/partial/error. | `submodule-review.spec.ts` |
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
| F37 Terminal | `terminal-panel.component.ts`, native terminal registry/I/O | Opening -> registered -> running -> exited -> closing -> closed/close failed; early output/exits buffered; input serialized. | `terminal-lifecycle.spec.ts`, native `terminal_lifecycle_tests.rs` |
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
| D01 Build receipts/cache | `tools/package-build-receipt.mjs` | Missing -> owned pending attempt -> verified outputs -> atomic completed receipt -> reusable only with matching digests. | `tools/package-deb.test.mjs` |
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
arrives. Repository Management also keeps an eager loading/error shell. While
the request owns the modal, Tab stays in the dialog and background Git
shortcuts are ignored, including in the gap before the module renders. Escape
retains drafts and returns focus only to the current request's opener.
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
across restart. Native installer outcomes and package/version observations, not a download or
renderer acknowledgment, govern installation confirmation. Worker failure after admission becomes
inspectable uncertainty rather than an indefinitely busy UI; late worker failure
cannot overwrite an already confirmed native outcome.

The native controller owns HTTPS sources, pinned publisher trust, opaque offer
IDs, bounded downloaded bytes, signed-version verification and installer paths.
Read-only package inspection has output/time limits and owns its decompressor
process group. Linux authorization uses fixed OS programs and the registered
system authentication agent, without a textual-password fallback. Debian auth
refusal is distinct from potentially partial installer failure; ambiguous
outcomes remain uncertain. Windows self-installation is still disabled pending
a safe restart boundary. Missing publisher trust is fail-closed, not permission
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

Coverage: native `application_update` policy, signature/version binding, bounded
transport, real signed inert package metadata and receipt/worker fault tests;
`application-updates.service.spec.ts`; renderer `application-updates.spec.ts`;
and packaged `native_application_updates_scenarios.py`. Production signing-key
provisioning and release publication are separate operations. Platform and exact
artifact acceptance are not implied by fixture-only test results.
