# Branch integration review — 2026-10-30

Baseline: `dev` at `101a4c335521a30ff311c46c745d27c35d2837ef`.
Reviewed branches: `mauriziocasciano-performance-fixes` at `8f2e12af` and
`mauriziocasciano-production-readiness-audit` at `7bf5be01`.

Both branches diverged before the Khronos rename and typed IPC migration.
Trial merges found 21 and 6 conflicting files respectively. Changes are ported
onto current dev behavior rather than replacing files with the older versions.
Existing uncommitted packaging, provenance, ignore-rule and acceptance work is
preserved. The initial tracked diff is backed up at
`/tmp/git-khronos-pre-integration.patch` for this session.

## Disposition

| Source commits | Disposition |
| --- | --- |
| `7bf5be01` | Port startup failure reporting, preserve saved paths on restore failure, and error-toast Escape/decorative-icon/target-size fixes. Native background commands and terminal rejection handling already have newer implementations in dev. |
| `8bff428c` | Adapt snapshot parallelism to three read-only lanes with at most two extra workers and serial fallback on thread-creation failure. Retain bare-repository handling and nonfatal commit-template errors. Current native command threading is retained. |
| `8d34264c` | Port the actionable disabled commit label; retain allow-empty commits and rebase-split behavior. |
| `5c05a058` | Keep dev's existing recovery captures, recovery commands, and typed dialogs. Do not add a second recovery system. |
| `15437d7a` | Extract the current worktree graph row into an OnPush component; retain dev's button semantics, labels, graph resizing and nested-control handling. |
| `ac673550`, `f52ae230` | Keep dev's existing feature-specific deferred components and loader/error handling rather than introducing the branch's alternate monolithic overlay component. |
| `3354a296` | Keep current budgets until the production build is measured; older branch budget values are not evidence for the current bundle. |
| `fd18d830` | Port memoized branch visibility, remote membership, diff-selection and untracked-path lookups. |
| `2ad77241` | Port contrast declarations whose source declarations still match current components. Preserve changed dev declarations and both existing themes. |
| `ef1dca7a` | Port a dedicated polite operation-status region with explicit Git status context, replacing the changing live attribute on the activity button. |
| `21872d6e`, `c48790c0`, `8f2e12af` | Keep dev's existing authentication transport, askpass and LFS-lock implementation. The final Windows conversion fix concerns the older branch's separate credential helper, which is not used by dev. |
| `89e49b81`, `5729ca52` | Keep dev's more comprehensive CI workflow and current crate/module structure. Avoid wholesale formatting churn. |
| `b2948897` | Port LFS pointer counts through Rust and regenerated typed IPC to the toolbar/menu, with parser regression coverage. Describe the checked-out pointer state without assuming the object is absent from the local cache. |
| `5aaac35c`, `7c051af4`, `d8775c95` | Keep current renderer harness/identity isolation and dev graph interactions. Run current renderer acceptance plus ported focused regressions. |
| `a58b6ae7`, `98a4e567` | Keep dev's newer responsive graph layout and semantic theme tokens rather than reapplying older panel proportions and negative letter spacing. |
| `82172193` | Port the IME-aware text directive and native checkbox/radio/select bindings after the first production build exceeded the initial bundle limit by 8.10 KB. Keep deferred dialogs, numeric zoom conversion and form novalidate behavior; include form interaction regressions. |
| `428ccae9`, `bf2f2ec6` | Port bounded syntax scanning/token emission for diff and blame, preserving text and word-change indicators; include unit and browser regressions. |
| `cd467492` | Port staged/unstaged path/tree virtualization and Home/End navigation, retaining bulk discard selection and current actions. |
| `dc94051f` | Port local/remote/tag/stash virtualization, Tab traversal and applicable deferred-menu focus handling; add ResizeObserver updates so panel growth cannot expose an unrendered gap, and keep group separators within fixed virtual row heights; retain current branch creator and action buttons. |

`main` and `mauriziocasciano-incremental-debian-packaging` have no commits
outside dev. The recovery branch's `11443176` is an older variant of work
represented by `62067fa1`; it is not merged wholesale.

## Validation

- Source checks, Angular compilation, Rust Clippy, generated IPC verification,
  and renderer-test type checking pass on the final source state. Evidence:
  `target/validation-runs/branch-integration-final-source/`.
- Frontend unit tests (164), Rust tests (568), real-LFS tests (41),
  packaging/provenance tests (55), and native-harness tests (28) pass.
- The first complete renderer run passed 1,189 cases and exposed 15 failures.
  Review corrected badge contrast, virtual-row geometry, initial native-select
  values, preview-fixture initialization ordering, and status announcement context.
  One case encountered an environment `ERR_NETWORK_CHANGED` error.
  All 15 exact cases pass after correction:
  `target/validation-runs/branch-integration-corrected-cases/`.
- The focused final regression suite passes, including the additional remote
  group-boundary row-height regression:
  `target/validation-runs/branch-integration-final-features/`.

- The complete renderer suite passes on the final source: **1,205 passed**,
  no retries or failures, in 29.8 minutes. The CLI test budget was 60 seconds
  with four workers; assertion and performance limits were unchanged. Evidence:
  `target/validation-runs/branch-integration-final-renderer/`.
- The final Debian build passes unchanged hard bundle/style budgets; existing
  soft size warnings remain. Package:
  `target/verified-packages/branch-integration-final-efa425efbc83/Git-Khronos_0.1.0_amd64.deb`.
  SHA-256: `efa425efbc83c2da9fdf5fe520c544845f37d6606f557e675a5c223cef00d14d`.
- That exact package passes all 10 Linux native smoke scenarios. Evidence:
  `test-results/native/smoke-1793401324161634759/report.json`.

Windows acceptance has not been run. No dependency or external asset is
introduced by these ports. The reviewed distribution-notice and streaming-ignore
hardening is committed separately from the branch integration. Local IDE notes
and the pre-existing temporary test repository are excluded.
