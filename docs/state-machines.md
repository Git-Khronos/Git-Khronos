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

## Implemented transition ownership

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
| D05 CI/release | `.github/workflows/ci.yml`, `release.yml` | Select checks -> build/test artifacts; release validates tag/version/ancestry -> package -> checksum/SBOM -> upload/publish. | Workflow definitions and package tests; no live CI audit implied |
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
