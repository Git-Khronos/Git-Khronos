# Git Chronos

Git Chronos is a free and open-source, local-first Git desktop client built with
Angular, Nx, Rust, and Tauri.

> [!NOTE]
> The project is under active development. The current vertical slice supports
> repository tabs, a visual commit graph and focused panels, file, hunk, and
> line staging operations with recoverable discards, commit comparison, history
> and blame, silently prefetched commit history, common history and remote
> operations, configurable background fetching, conditional Git LFS pull and
> prune actions, repository-scoped sparse checkout, interactive rebase,
> conflict resolution, searchable reflog recovery with safe branch creation,
> explicitly signed commits with effective repository-signing diagnostics,
> worktree-backed Agent
> Sessions, native submodule management, and a repository-scoped terminal with
> multiple independent tabs.

## Prerequisites

- Node.js 24.15+ LTS or Node.js 26
- pnpm 10 or newer
- Rust 1.99.0 (pinned by `rust-toolchain.toml`)
- Git 2.34 or newer
- The [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for
  your platform

## Development

```bash
nvm install
nvm use
pnpm install
task dev
```

If you do not use `nvm`, install a supported Node.js release through your usual
version manager or package source. Run `task doctor` to verify all required
toolchains before building.

Build and run the optimized native application:

```bash
task build
task run
```

Other useful shortcuts:

```bash
task --list
task frontend
task preview
task test
task test:e2e:install
task test:e2e
task check
task ci
task bundle
```

`task frontend` creates an optimized frontend build. Use `task preview` when
you need a browser-accessible, sample-data development server at
`http://127.0.0.1:4200`. Add `?welcome-preview` to inspect the welcome screen.
System Git operations are available only in the native Tauri application.

Resize graph columns from the right edge of each heading, or focus its separator
and use Left/Right (Shift for larger steps), Home, or End. Drag a heading onto
another to reorder the columns; it lands on the side you dragged towards. The last
column (Date / Time by default) resizes from its left edge instead: its right edge
stays fixed while the preceding column gives or takes the width (Left widens it,
Right narrows it). By default, resizing preserves the
other columns' widths and wide layouts scroll horizontally. Turn off **Configure graph
columns → Horizontal Scrolling** (saved for the whole app) to keep the columns inside the
panel instead: widening a column first narrows Commit Message, then the other columns
(nearest first), down to their minimum widths. Dragging back within the same drag restores
them, and narrowing the window narrows the columns. Columns never overlap: none is pinned, so every heading and
cell keeps its own track and scrolls with the history, and a resized edge is
scrolled into view. The last column reaches the panel edge with the settings button
inside its right end; while more columns lie to the right, the settings button stays
at the edge on its own strip, which headings end at. Date / Time shows the
full date with its year and a 24-hour time, and never narrows below the width those
need. Widths are saved per repository. Double-click a separator
to reset it (the Graph separator fits branch paths), or use **Configure graph
columns → Restore graph defaults** to restore the automatic layout. A heading too
narrow for its title shows an icon instead (hover it for the full title). The settings
button is not a commit column.

Remote-tracking references are refreshed automatically every five minutes while
the desktop app is open. The active repository is also checked when the window
regains focus or the machine comes back online. Change the interval—or turn the
feature off—in **Preferences → Remote updates**. This background operation first
uses a per-remote dry run and runs a resource-bounded `git fetch --all --prune`
only when advertised references changed. It never pulls, moves the current
branch, or changes working files.

Local repository state also refreshes automatically. Git metadata notifications
update the graph after commits, branch changes, rebases, and terminal-driven Git
operations, while a coalesced status check updates working-tree changes. The app
watches only small mutable metadata trees such as `refs` and `worktrees`—never
the Git object database or the source tree. Repository reads run away from the
window event loop, saved tabs restore progressively, and working-tree status
retains only the requested page of paths in memory. The first-frame snapshot
also avoids calculating ahead/behind divergence for every inactive branch;
current-branch divergence still comes from the status query. The history list
renders only the rows in view (plus one viewport above and below) and rebinds
those row elements while scrolling instead of rebuilding them. Each row keeps a
fixed position in the document and is painted on its own layer, so scrolling
repaints only the rows that changed. Each loaded history page only lays out, dates,
and indexes its own commits. These safeguards keep very large repositories responsive.

`task test:e2e` runs fast, deterministic renderer journeys against the sample
repository. These tests cover interface behavior but do not replace native
Tauri integration tests for Git, filesystem, terminal, or operating-system
dialogs.

## Architecture

- `apps/desktop` contains the Angular UI and Tauri application adapter.
- `apps/desktop/src-tauri` contains the narrow native command surface.
- `crates/git-core` owns Git process execution, parsing, and domain types.
- `libs/contracts` contains the frontend TypeScript IPC contracts.

Git itself remains the source of truth. The Rust backend invokes Git directly
with argument arrays—never through a shell—and returns typed, redacted results
to the UI.

## Privacy

Git Chronos has no telemetry, accounts, advertisements, or hosted backend.
Repository information and diagnostics remain on the local machine.

## License

GPL-3.0-only. See [LICENSE](LICENSE).

Third-party component notices are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
