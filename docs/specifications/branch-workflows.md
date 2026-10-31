# Feature, release and hotfix workflows

Status: independent functional specification for G24, with a tested core-engine
checkpoint described below. The dedicated desktop workflow is not yet available.
Ordinary branch commands do not satisfy this capability.

## Public capability reference

The [public workflow guide](https://help.gitkraken.com/gitkraken-desktop/git-flow/)
documents configurable production/development branches and topic prefixes,
creation of missing long-lived branches during setup, prefix-based topic lists,
features finishing into development with local topic deletion, releases finishing
into both long-lived branches with a version tag, and hotfixes finishing into
both long-lived branches. It also describes optional feature rebasing, tag
prefix/message configuration, and publishing through ordinary push.

Only these capabilities are the reference. No vendor source, package contents,
assets, private data formats or interface composition were inspected or reused.
The choices below are Khronos design decisions, not assertions about that
product's implementation or undocumented behavior.

## Configuration and setup

A repository has one optional workflow configuration containing production and
development branch names, three topic prefixes, and a tag prefix. Defaults may be
suggested, but setup displays every resulting ref before application. Settings
are repository-local and shared with its linked worktrees. Do not alter a global
Git configuration or require an additional workflow executable.

Both long-lived branches must have distinct valid names. Topic prefixes must be
nonempty, distinct and nonoverlapping, and must produce valid branch refs when a
suffix is appended. A production or development branch may not also be a topic.
Tag names and branch names are validated by Git; entered names are literal data,
never a revision expression or a shell fragment.

Setup on an existing history shows an explicit base commit for each missing
long-lived branch. Existing branches are retained at their current commits.
Create missing refs only if they are still absent and the reviewed base commits
still match. Reject a stale setup instead of overwriting an existing ref.
An unborn repository requires the user to create its initial commit first; do
not invent a hidden initialization commit. This explicit initial restriction is
a qualification gap until the empty-repository workflow is specified and tested.

Configuration changes need their own preview and cannot rename or delete refs
implicitly. Unrecognized or malformed stored settings are reported and cannot
silently activate defaults. Pending workflow execution prevents reconfiguration.

## Starting and publishing work

Show local topics grouped by configured prefix. Include manually created topics;
exclude remote refs and ordinary local branches. Display suffix, complete ref,
commit, tracking state and linked-worktree occupancy.

Start features and releases from development; start hotfixes from production.
A preview captures the configuration, chosen base ref/commit, full new branch
name and checkout behavior. Refuse an existing name, dirty checkout, active Git
operation, stale base, occupied checkout target or untracked/ignored collision.
A failed checkout must not be reported as a successful start. If branch creation
succeeds but checkout fails, report that partial outcome and retain the branch.

Publishing uses the existing explicit push preview, account/remote selection,
upstream choice and cancellation behavior. Starting and finishing do not push,
fetch, delete a remote branch, bypass hooks or change signing settings.

## Finishing work

The user reviews a single plan containing topic type, source commit, all target
refs/commits, merge policy, messages, optional tag and local cleanup scope.
Preparation is read-only. Execution revalidates every captured local binding.

| Topic | Integration targets | Tag | Local topic cleanup |
| --- | --- | --- | --- |
| Feature | Development | None | Delete only after successful integration |
| Release | Production, then development | Required version name with configured prefix and reviewed message | Explicit choice, deferred until all stages succeed |
| Hotfix | Production, then development | Optional explicit tag | Explicit choice, deferred until all stages succeed |

Each target must contain the reviewed topic commit when its integration stage
succeeds. The plan states whether a stage permits fast-forward or requires a
merge commit. Never silently substitute squash, rebase or unrelated-history
integration. An optional feature rebase is a separate history-rewrite preview
with existing backup/recovery behavior, followed by a fresh finish preview.

Tags identify the resulting production commit. Existing tags are never moved or
replaced by finish. Annotation and signing choices must be visible, honor the
repository's effective configuration and expose signing or hook failures.
Tagging cannot be reported as complete merely because branch integration passed.

Refuse finishing a long-lived branch, a non-topic ref or an occupied target in a
different worktree. Require a clean index/worktree, no active Git operation,
valid complete configuration and no overlapping workflow execution. Source and
target refs must resolve directly to the reviewed commits. Do not resolve an
arbitrary user-supplied revision in place of a configured branch.

## Partial completion and recovery

A multi-target finish is not an atomic Git operation. Preserve named recovery
refs for the topic and all target tips before the first mutation, and retain a
durable per-worktree execution record. Show each stage independently: pending,
in progress, conflicted, completed, refused or unconfirmed after interruption.

A conflict pauses at that target without deleting the topic or running later
stages. Existing conflict tools resolve files; continue verifies the expected
checkout, merge parents and captured stage before advancing. Abort affects the
currently active merge only. Previously completed merges are retained and clearly
reported. A separate reviewed recovery action can restore saved commits through
new branches; do not automatically reset branches after partial completion.

After process failure or application restart, inspect actual refs, Git operation
state and saved stage expectations. If a stage's effect is not established, show
that uncertainty and require reconciliation before continuing. Do not repeat a
merge, hook or tag operation solely because its reply was lost. Concurrent
external ref changes refuse continuation without overwriting new work.

Delete the local topic only after all required integrations and tag creation are
verified, its tip still equals the reviewed source, and no worktree occupies it.
Cleanup refusal leaves a successful integration visible with cleanup pending.
Cancellation stops future stages and reports already applied effects; it is not
a promise to undo a completed merge or external hook side effect.

## Behavioral acceptance cases

Use owned repositories and ordinary Git output as the independent oracle. Every
case checks exact refs and peeled tag targets, parent relationships, file/index
bytes, checkout state, recovery records and per-stage outcomes as applicable.

- Setup retains existing refs, atomically refuses creation races, handles custom
  names/prefixes, rejects ambiguous settings and clearly handles unborn history.
- Feature/release/hotfix starts choose their specified bases, discover manually
  named topics, reject duplicate names and preserve unrelated files on refusal.
- Feature finish covers fast-forward, true merge, already integrated topics and
  local cleanup; optional rebase preserves recoverable original commits.
- Release and hotfix finish integrate the source into both targets, including
  targets with independent commits. Release tags peel to production, not to the
  unmerged topic or development tip.
- Conflicts in the first and second target expose the correct stage; continue,
  abort, cancellation and restart never replay completed stages.
- Hook refusal, signing failure, existing tag, checkout failure, disk/write
  failure and cleanup refusal report accurate partial results and retain backups.
- Stale configuration, source/target movement, linked-worktree occupancy,
  symbolic ref substitution and operation overlap refuse without losing work.
- Spaces, Unicode, slashes, option-like input and revision-expression text are
  validated as literal ref/message data without executing commands.
- Native commands, renderer previews, keyboard/compact-window controls and the
  exact packaged executable demonstrate equivalent outcomes. Source-only tests
  do not qualify packaged or cross-platform behavior.

## Implementation authorities

- [Git merge](https://git-scm.com/docs/git-merge): merge outcomes, conflict state,
  continue and abort.
- [Git ref transactions](https://git-scm.com/docs/git-update-ref): conditional
  ref creation/update/deletion and transactions.
- [Git ref validation](https://git-scm.com/docs/git-check-ref-format): legal ref
  names and branch-name interpretation.
- [Git worktrees](https://git-scm.com/docs/git-worktree): checkout occupancy.
- [Git tags](https://git-scm.com/docs/git-tag): tag types, annotation and signing.

No external source code or dependency is introduced by this specification.


## Core-engine checkpoint (2026-10-31)

Original Rust code in `crates/git-core/src/branch_workflow.rs` and
`branch_workflow_finish.rs` implements local configuration and conditional setup,
prefix discovery, reviewed starts, and journaled feature/release/hotfix finish.
Finish preserves recovery refs, integrates the original topic into the reviewed
targets in order, annotates the production result when requested, and conditionally
deletes the reviewed topic ref. Shared repository locking serializes actions
across linked worktrees; execution records remain bound to their owning checkout.

Owned Git fixtures cover conflict continuation, abort after an earlier integration,
restart reconciliation, explicit retry, stale bindings, checkout-hook failure,
signing failure, cancellation during a running post-merge hook, malformed records,
completed-ancestry validation and changed release tags. Initial records are
published from a complete synced temporary file without replacing another record.
A saved completed stage is rechecked before applying later stages. If an
interrupted hook leaves merge metadata after the expected commit is created,
explicit continue clears that metadata with Git’s quit action, without replaying
the merge or its hooks. Abort in this state retains the completed commit; changed
working files prevent automatic metadata cleanup. Signature
presence is checked when reconciling a requested signed tag; this is not a claim
of cryptographic trust or signer identity.

Remaining requirements before desktop acceptance:

- Renderer controls, keyboard behavior and packaged acceptance remain open;
  the native command and cancellation checkpoint below does not complete them.
- Topic discovery does not yet expose tracking state. Conditional local ref
  deletion retains branch-specific configuration; safely handling later topic
  name reuse and concurrent external worktree registration needs qualification.
- Optional feature rebase needs an explicit connection to the existing reviewed
  rebase workflow. Unborn setup and moved owning worktrees remain unsupported.
- Successful real signing, further storage failures, all supported platforms and
  native IPC rejection cases still require their own acceptance evidence.

This checkpoint introduces no dependency, proprietary code, asset or copied UI.
It does not qualify the current packaged executable or complete G24.


## Native command and cancellation checkpoint (2026-10-31)

The native registry exposes `load_branch_workflow`, `prepare_branch_workflow`,
`execute_branch_workflow`, `discard_branch_workflow_plan` and
`control_branch_workflow_finish`. Setup/start/finish previews are stored in the
native process, bound to a repository session, and expire after fifteen minutes.
Execution consumes a preview once before dispatch and accepts only its token.
The cache is bounded; a busy checkout is refused without an uninterruptible
mutex wait. Continue/abort/acknowledge identify the durable workflow and its
current action revision. Rust-derived TypeScript contracts preserve these types.

Owned source tests exercise repository binding, expiry, reuse refusal, strict
nested request decoding and TypeScript rejection of forged execution plans or
missing revisions. This is source-level command evidence, not native WebDriver
or packaged acceptance.

Workflow preview reads and setup use synchronous thread-bound cancellation
scopes. Scoped Git stdin is a private file, so a command that does not consume
input cannot block a pipe writer ahead of the cancellable runner. Scopes restore
the previous context when nested or unwound and do not propagate to another
thread or across asynchronous suspension.

Owned hooks verify cancellation on both sides of reference-transaction commit.
Before commit, setup and backup cancellation preserve original refs. After
commit, setup retains initialized refs and reports a partial outcome; a verified
backup ref receives a discoverable recovery record even if its Git process was
canceled. Neither outcome silently starts later stages. A configuration lock
failure retains initialized refs and preserves the existing lock file.

Post-command merge inspection uses a separate eight-second deadline, so an
already-canceled action can still establish applied effects. If inspection cannot
finish, the durable stage remains unconfirmed and requires another explicit
inspection or continuation. This limit never causes a merge replay or a reset.
Successful continuation checks use the new action's cancellation token.

Before further finish stages, the engine verifies each saved recovery record and
its direct protected ref against the reviewed original commit. Missing or moved
refs, symbolic substitutions and removed records refuse continuation while
retaining the existing workflow journal, refs and index. The source test covers
all four cases independently.
