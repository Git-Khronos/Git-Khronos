# Independently implemented desktop Git capabilities

This is a capability inventory and acceptance plan, not a claim of complete
parity with any product. Requirements come from public Git/provider manuals and
high-level published workflows. Proprietary packages, executable internals,
source maps, UI assets and internal identifiers are excluded.

The active full-parity requirements and completion audit are tracked in
[git-feature-parity.md](git-feature-parity.md). The rows below are implementation
pointers and must not be interpreted as a reduced definition of the objective.

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
| Hosted write operations | Existing browser links to provider workflows | In-app PR creation, review submission, issue editing and merge decisions remain future work |
| Agent tools | Explicit installed Codex/Claude/Gemini/OpenCode CLI launch in the selected checkout, independent PTY tabs and process lifecycle | Fixed program enum, no shell command interpolation or permission bypass flags; existing worktrees provide isolation; no AI task-state inference |
| Original UX | Khronos components, theme tokens, original wording, keyboard controls and existing icon system | Focus/compact-window regression coverage; no proprietary assets introduced |

## Remaining capability work

1. Finish qualifying hosted pagination, state filters, per-reviewer decisions and
   legacy commit statuses. Add provider search and richer filters; qualify real
   account/rate-limit behavior.
2. Add explicit, reviewable provider writes (PR creation, review submission and
   merge), with head-commit preconditions and permissions errors.
3. Add equivalent hosted adapters for GitLab, Bitbucket, Azure DevOps and
   enterprise installations. Browser links currently cover common public hosts.
4. Extend workspace overview to unopened repositories with bounded background
   scans and clear freshness/error reporting; add hosted data aggregation.
5. Extend identity templates to isolated account contexts and preference sets
   without silently changing credentials or global Git configuration.
6. Add optional documented agent status integration, session restoration and
   prompt/task management. Running/exited describes a process, not whether an
   agent needs approval or has completed a task.
7. Implement issue-tracker integrations, Gitflow workflows and independent deep
   links from neutral specifications. Existing underlying Git operations do not
   establish parity for these dedicated workflows.
8. Qualify final packaged artifacts and each supported operating system after
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
- Agent processes start only after choosing a program and pressing Start.
  Installation, login and tool permissions belong to that CLI. No model or
  provider access is bundled or implied.

Public references and implementation provenance are recorded in
[provenance/sources.md](provenance/sources.md) and
[provenance/compatibility.md](provenance/compatibility.md).
