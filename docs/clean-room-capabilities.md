# Independently implemented desktop Git capabilities

This is a capability inventory and acceptance plan, not a claim of complete
parity with any product. Requirements come from public Git/provider manuals and
high-level published workflows. Proprietary packages, executable internals,
source maps, UI assets and internal identifiers are excluded.

The active full-parity requirements and completion audit are tracked in
[git-feature-parity.md](git-feature-parity.md). The rows below are implementation
pointers and must not be interpreted as a reduced definition of the objective.
Basic local Git and file workflows take priority over hosted collaboration; AI
and coding-agent functionality is outside the product scope.

## Main capability map

| Capability | Khronos implementation | Acceptance / remaining scope |
| --- | --- | --- |
| Repository lifecycle | Open, initialize, clone; recent/favorite paths; tabs and named local workspaces | Existing renderer and packaged native suites |
| Visual history | Commit graph, branches/tags/HEAD, search, comparisons, file history and blame | Existing graph, history-search and inspection suites |
| Commit preparation | File/hunk/line stage and unstage; ignore rules; commit templates, signing and policy | Existing staging, commit, signing and recovery suites |
| Branch and remote operations | Create, rename, delete, checkout, tracking, fetch, pull, push, publish and lease-protected forced push | Existing reference and transport suites |
| History editing | Merge, rebase, interactive rebase including merges and commit splitting, cherry-pick, revert, resets | Existing history suites; recovery previews for destructive actions |
| Conflict handling | Three-way resolution and submodule conflict workflows; committed merge preview without modifying the checkout | Merge-preview tests cover stale refs, attributes, binary/rename conflicts, cancellation and dirty-state preservation |
| Recovery | Reflog, branch recovery, saved discards, reset recovery, undo/redo where supported | Existing recovery suites |
| Large/nested repositories | LFS, sparse checkout, submodules and worktree lifecycle/move/repair | Existing LFS, submodule and worktree suites |
| Offline exchange | Binary/text patches, mail patch series and Git bundles | Existing exchange suites |
| Repository overview | Workspace center summarizes open repositories, dirty/conflicted state, active operations and tracking divergence; explicit local refresh with per-repository failures | New workspace-center renderer coverage; no implicit network fetch; closed/unopened workspace repositories excluded |
| Saved commit identities | Named local identity templates; create/edit/delete; explicit per-repository application preview | New profile parser and renderer tests; authentication accounts, signing keys and global Git config are separate |
| Hosted collaboration | GitHub PR/issue/workflow lists, PR descriptions, file patches, review decisions and head-commit checks through documented REST APIs and installed `gh` | New offline API fixture and renderer tests; explicit loads, paging/state filters, current review decisions, legacy statuses, cancellation and stale head checks; no live account qualification yet |
| Hosted write operations | Reviewed GitHub PR creation, fork/draft support, review-level comments/approvals/change requests, merge/squash/rebase; account/commit-bound one-use previews and uncertain outcomes | Source checks, all 1247 renderer cases and 305 owned Linux native scenarios pass for package `9a5a8c0badec`; live-provider and other-platform qualification remain outstanding. Inline threads/suggestions, templates/reviewer metadata, issue writes, close/reopen and branch cleanup remain unfinished |
| Terminal and external tools | System shell and configured terminal profiles; reviewed editor, comparison and merge programs | Saved legacy agent profiles are available as terminal profiles without automatically starting them |
| Original UX | Khronos components, theme tokens, original wording, keyboard controls and existing icon system | Focus/compact-window regression coverage; no proprietary assets introduced |

## Remaining capability work

1. Pin force-push leases to the reviewed remote object rather than a tracking ref
   that background fetch can advance.
2. Fill local file management, selective stash restoration, multi-repository
   actions and the remaining Gitflow workflow gaps identified in the parity
   inventory.
3. Extend workspace overview to unopened repositories with bounded background
   scans and clear freshness/error reporting; add hosted data aggregation.
4. Extend identity templates to isolated account contexts and preference sets
   without silently changing credentials or global Git configuration.
5. After core workflows, finish qualifying hosted pagination, state filters,
   per-reviewer decisions, commit statuses and real-account behavior.
6. Extend hosted review actions, issue-tracker integrations and provider
   coverage; complete deep-link qualification.
7. Qualify final packaged artifacts and each supported operating system after
   source and renderer gates. Previous package qualification does not transfer
   to a package containing these additions.

## Behavioral rules

- A view never treats unavailable data as a clean repository or passing CI.
- Remote data loads only after an explicit action and is tied to repository,
  remote fetch destination, section and (for PR inspection) expected head SHA.
- Provider text and patches are plain text, never executable HTML. Provider URLs
  used by the new adapter are constructed from validated repository coordinates
  and numeric identifiers.
- Profiles store only label/name/email, have bounded validated storage, and do
  not apply when selected, edited, deleted or when a workspace changes.
- Configured terminal programs start only after an explicit terminal action.
  Migration of legacy profiles does not start them or change the default.

Public references and implementation provenance are recorded in
[provenance/sources.md](provenance/sources.md) and
[provenance/compatibility.md](provenance/compatibility.md).
