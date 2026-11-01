# Full Git feature parity: requirements and evidence

Objective: reach full Git feature parity with GitKraken Desktop through an
independent implementation. This objective is active. A green subset of tests,
a capability name, or a browser handoff does not establish full parity.

The inventory below preserves the whole objective. It includes local Git,
hosted collaboration, workspace/account workflows, agent-assisted Git work,
platform support, and usability. Product identity, protected assets and private
vendor implementation/protocols are not implementation references. Equivalent
capabilities must use public specifications and an original Khronos design.

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

## Local Git and repository interaction

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| G01 | Open, initialize and clone repositories; handle empty, bare, detached, shallow, large and nested repositories | Audit repository lifecycle and packaged fixtures across each state |
| G02 | Manage recent/favorite repositories, aliases, tab sets, reopen/close/reorder tabs | Audit persistence, keyboard navigation and stale-session handling |
| G03 | Display commits, parents, merges, refs, tags, authors, dates, HEAD and worktree state in history | Audit graph topology, every reference type, paging and large-history navigation |
| G04 | Filter/search loaded and full history by message, author, SHA, date, path and branch/ref scope | Audit full-history search, pagination and zero/many matches; discover remaining documented filters |
| G05 | Hide/solo/filter refs and remotes; collapse reference groups and preserve these view choices | Audit combinations and inheritance into new worktrees |
| G06 | Stage/unstage whole files, hunks and lines; represent renames, modes, binaries, new/deleted files and submodules | Audit index/worktree bytes against independent Git CLI fixtures |
| G07 | Ignore files/patterns, edit tracked files, invoke configured editors and diff/merge tools | Partial: audit file editing and external-tool configuration beyond terminal handoff |
| G08 | Compare revisions, contiguous commit selections and working trees; offer hunk/inline/split views, word changes, syntax colors, overview navigation, wrapping, whitespace and image/binary handling | Audit existing text views; discover and implement missing non-text previews |
| G09 | Navigate file history/blame through renames and parent revisions; copy/reveal/open paths | Audit historical navigation, limits and deleted paths |
| G10 | Create/amend commits, templates, coauthors, sign-off, empty commits and identity/author options | Audit exact commit metadata, hooks, templates and failure paths |
| G11 | Sign commits/tags and diagnose effective signing configuration | Audit supported formats and real signed artifacts; verify tag-signing scope |
| G12 | Create, rename, delete, checkout and publish branches, remote branches and detached commits | Audit exact refs, occupancy, tracking and destructive preconditions |
| G13 | Fetch/pull/push scoped or all refs; configure remotes/upstreams, publish branches, force with lease, auto-fetch and cancel operations | Audit normal/auth/error/conflict/partial-success cases and inherited environment isolation |
| G14 | Merge, fast-forward, rebase and preview conflicts; continue/abort/skip where applicable | Audit topology, dirty-state handling, strategy options and preview/actual outcome equivalence |
| G15 | Interactive rebase: reorder, squash/fixup, edit/split, drop and preserve merges/root/selected ranges | Audit every edit instruction and recovery state against Git behavior |
| G16 | Cherry-pick/revert individual or selected commits, including merge-parent selection and conflicts | Audit sequencing, ranges, no-commit options and abort/recovery |
| G17 | Reset/reflog/undo/redo/discard recovery with clear destructive scope | Audit each supported action, retained recovery bytes and restart behavior |
| G18 | Stash full/selected work, stage/index options, names, apply/pop/drop and branch from stash | Audit index/worktree/untracked combinations and stale stash preconditions |
| G19 | Create, inspect, delete, rename, move and transfer lightweight/annotated/signed tags; navigate to their commits or branch from them | Audit tag types, peeled targets and remote lease behavior |
| G20 | Detect/resolve text, binary, rename/delete and submodule conflicts; configure external merge resolution | Audit all conflict types; identify missing resolution modes |
| G21 | Add/init/update/sync/remove nested submodules and inspect their changes/history | Audit nested, dirty, missing, detached and conflicted submodules |
| G22 | Initialize/use Git LFS, track/untrack, transfer/prune objects, and manage locks | Audit provider availability, actual object integrity and lock ownership |
| G23 | Create/open/lock/move/repair/remove worktrees and branches safely | Audit occupancy, shared configuration, ignored/untracked collisions and recovery |
| G24 | Configure and run feature/release/hotfix workflows, including finishing into the appropriate branches and tagging releases | Partial desktop: reviewed setup/start/finish and saved conflict recovery have source, renderer and Linux-package evidence; the specification records full-run failures and successful serial rechecks. Branch-configuration cleanup/name reuse, optional feature rebase and further signing/platform/failure cases remain open. The [independent specification](specifications/branch-workflows.md) records transitions, recovery and remaining gates |
| G25 | Respect Git hooks, expose hook errors/output and explicit hook-control options | Audit actual hook processes and refusal/recovery behavior |
| G26 | Import/export patches, mail series and bundles; inspect and recover failed imports | Audit existing exchange implementations and format compatibility |
| G27 | Maintain repository integrity and offer actionable diagnostics without silently losing data | Audit fsck/maintenance, cancellation and missing/corrupt repositories |
| G28 | Open and generate repository/branch/commit/tag links; select among local copies and offer a prefilled clone when none exists | Candidate: original URI, local-copy review, fetch-free opening, sharing and clone review pass 391 packaged native executions. The original OS inbox also passes 403 exact-package Linux executions for cold process argv and warm GIO routing. Full renderer qualification, cold launcher association and other platforms remain open; see the [independent specification](specifications/repository-links.md) |
| G29 | Edit current working files with visible unsaved state, explicit save/discard and save-and-stage versus stage-saved choices; preview Markdown and handle declared encodings accurately | Candidate: bounded lossless core editing and versioned native sessions have focused source tests; original draft/save/stage UI and bounded inert Markdown have focused renderer evidence. Final integration, packaged editor acceptance and broader codec/platform support remain open; see the [independent editor specification](specifications/working-file-editor.md) |

## Hosted Git collaboration

Each applicable behavior must be audited for GitHub, GitLab, Bitbucket and Azure
DevOps, including their supported enterprise/self-hosted variants. Provider
capability differences must come from public documentation rather than guessed
API equivalence. A browser fallback remains a useful option, not evidence of an
implemented in-app capability.

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| H01 | Authenticate/select provider accounts and enterprise endpoints without leaking credentials across contexts | Partial: Git transport helpers exist; hosted reads currently use the selected `gh` account |
| H02 | Discover/list/clone repositories; detect or create a fork and attach its reviewed SSH/HTTPS remote using the selected provider/account | Partial desktop: GitHub account-bound paged discovery, fresh selection and reviewed HTTPS/SSH cloning have source, 1279-case renderer and exact Linux-package evidence (166 normal plus 167 inherited-environment scenarios). Catalogue identity does not replace Git transport credentials. Fork/reconciliation, remote attachment and other providers remain open. See the [independent specification](specifications/hosted-repositories.md) |
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

## Workspaces, identities and assisted workflows

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| W01 | Persist and switch workspace repository sets, including shared/remote workspace capabilities documented by the reference product | Partial: local sets only; shared workspace equivalent needs specification and implementation |
| W02 | Show multi-repository changes, divergence, active operations, review/CI/issue context and actionable overview filters | Partial: open-local-repository overview; unopened repositories and hosted aggregation missing |
| W03 | Save/switch identities, accounts, preferences and tab sets; explicitly choose local/global identity sync without silent Git or credential changes | Partial: named commit identity templates only |
| W04 | Provide local and shared team/repository collaboration views and discovery | Discovery and implementation required |
| W05 | Configure terminal/editor/diff/merge/agent programs, repository setup commands and defaults | Partial: terminal appearance and fixed agent launchers exist. Original configured terminal/agent profiles and PTY launch candidate have focused native/store tests; desktop/package qualification, external file-tool execution and reviewed setup workflows remain open |
| W06 | Launch supported agents in isolated worktrees from a chosen base and inherit repository view preferences | Partial: manual worktree creation and agent terminal launch are separate |
| W07 | Monitor/sort/filter agent sessions, show repository WIP/divergence and documented live task/permission states | Partial: process running/exited only; public CLI status integrations need independent implementation |
| W08 | Resume/restore agent sessions and respond to supported approval requests through documented integrations | Discovery and implementation required; never infer approval from process activity |
| W09 | Draft commit messages and review-request descriptions; explain commits/branches and assist conflict resolution using configurable models, providers/endpoints and prompts | Discovery and implementation required; no account, model or provider access is implied |
| W10 | Propose/review/edit commit groups from staged changes or a contiguous existing range, preserving authorship and adding coauthors where required | Missing assisted composition/recomposition; independent hunk completeness and recovery checks required before application |
| W11 | Select workspace repositories for bulk clone/fetch/pull/open/locate/remove, with individual outcomes; convert local groups to shared groups explicitly | Audit every selected-repository action; grouping conversion and independent failure outcomes need implementation evidence |

## UX, platform and delivery requirements

| ID | Required behavior | Current assessment / evidence needed |
| --- | --- | --- |
| U01 | Provide keyboard-driven command discovery, configurable shortcuts and equivalent Git actions from appropriate contexts | Audit current palette/context menus; shortcut configurability needs discovery |
| U02 | Support documented drag/drop Git workflows with equivalent explicit previews and keyboard alternatives | Audit graph drag operations; enumerate any missing actions |
| U03 | Preserve original identity while supporting themes, scaling, compact layouts, accessibility and large data | Audit all layouts and platforms; fallback-font layout and rapid rebase input fixes passed 1251 local renderer cases and 306 native scenario executions on package `05c1a4c1cd85`; remote verification remains pending |
| U04 | Persist preferences/drafts/view state and restore context across restarts without replaying mutations | Audit local state and multiple sessions/workspaces |
| U05 | Provide native Linux, Windows and macOS behavior plus documented Windows/WSL interoperability | Linux is qualified for prior exact artifacts; Windows/macOS/WSL remain unqualified |
| U06 | Package/install/update/uninstall with accurate licenses, notices and dependency provenance | Audit current package bytes, supported formats and platforms |
| U07 | Verify local Git outputs, native IPC/PTY behavior, full renderer suite and exact distributable artifacts | Partial: the Linux fork/remote attachment checkpoint passed all 1309 renderer cases; package `15d19f2c7068` passed 176 normal and 177 inherited-environment native scenarios, including saved fork recovery across an application-process restart. Earlier interrupted/failing attempts are retained separately in its specification. Exact-commit remote CI and other platforms remain unverified |
| U08 | Handle cancellation, stale state, partial results and uncertain remote writes without reporting false success | Audit every new operation; extend failure fixtures with each implementation |

## Public discovery references

- [Desktop interface and feature index](https://help.gitkraken.com/gitkraken-desktop/interface/)
- [Hosted review workflows](https://help.gitkraken.com/gitkraken-desktop/pull-requests/)
- [Feature/release/hotfix workflows](https://help.gitkraken.com/gitkraken-desktop/git-flow/)
- [Agent workflows](https://help.gitkraken.com/gitkraken-desktop/agents/)
- [Profiles](https://help.gitkraken.com/gitkraken-desktop/profiles/)
- [Fork workflows](https://help.gitkraken.com/gitkraken-desktop/fork/)
- [Workspace workflows](https://help.gitkraken.com/gitkraken-desktop/workspaces/)
- [Application link behavior](https://help.gitkraken.com/gitkraken-desktop/linking/)
- [Review-request filter capabilities](https://help.gitkraken.com/gitkraken-desktop/pull-requests-filter-syntax/)
- [Assisted Git workflow capabilities](https://help.gitkraken.com/gitkraken-desktop/gkd-gitkraken-ai/)
- [Diff, history and blame workflows](https://help.gitkraken.com/gitkraken-desktop/diff/)
- [File editing workflows](https://help.gitkraken.com/gitkraken-desktop/editing-files/)
- [Tag workflows](https://help.gitkraken.com/gitkraken-desktop/tags/)
- [Git manuals](https://git-scm.com/docs)
- [GitHub REST API](https://docs.github.com/en/rest)

The public feature index is the discovery starting point, not an exhaustive
specification. Follow each linked feature guide, expand this inventory when new
requirements are observed, and retain missing/unverified requirements until their
own behavior and runtime evidence are established. Do not close the objective
from this document's existence or from passing counts alone.
