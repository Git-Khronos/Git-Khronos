# Feature, release and hotfix workflows

Status: independent functional specification for G24. This document does not
claim an implementation or acceptance result. Ordinary branch commands already
available in Khronos do not satisfy this dedicated workflow.

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
