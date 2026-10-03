# Git Chronos roadmap

Git Chronos is built in vertical slices. A milestone is complete only when its
workflows run in the packaged desktop application—not merely in a browser mock.

## Foundation and repository vertical slice — in progress

- [x] Nx, Angular, Tauri, and Rust workspace
- [x] Original design system and application icon
- [x] System Git detection and minimum-version guidance
- [x] Open and refresh local repositories
- [x] Recent repositories, working-tree summary, branches, and recent commits
- [x] Stage all, unstage all, commit, branch creation/switching
- [x] Fetch, pull, and push through configured Git credentials
- [x] Configurable background fetch and remote-reference refresh
- [x] Per-repository operation serialization and redacted errors
- [x] Real-repository parser and mutation tests
- [x] File and commit diffs
- [x] Filesystem-driven automatic refresh
- [x] Non-blocking, bounded large-repository loading and progressive tab restore
- [x] Clone and initialize workflows
- [x] Repository-scoped sparse checkout with preferences and toolbar actions
- [ ] Generated Rust-to-TypeScript IPC bindings

## Linux daily-driver beta — in progress

- [x] File, hunk, and line staging with safe discard recovery
- [x] Commit amendment, tags, remotes, and stash workflows
- [x] Visible operation progress and durable activity logs
- [x] Safe cancellation for long-running Git operations
- [ ] In-app askpass bridge that delegates persistence to Git credential helpers
- [x] Searchable, virtualized commit graph with real topology
- [ ] AppImage and Debian packages with checksums, SBOM, and signed updates
- [ ] English accessibility review and externalized UI strings

## Full power suite

- [x] Merge lifecycle with three-way conflict resolution, continue, and abort
- [x] Interactive rebase, cherry-pick, revert, and reset
- [x] Bounded reflog recovery with safe branch preservation
- [x] Guided bisect with good, bad, skip, and reset controls
- [x] Worktrees, submodules, and explicit commit signing through configured Git keys
- [x] Commit signature verification in the inspector
- [x] Effective repository signing configuration diagnostics
- [x] Confirmed force push with remote-update lease protection
- [x] On-demand signer executable and key-selection diagnostics
- [ ] Expanded Git LFS diagnostics
- [x] Persistent continue/skip/abort flows for rebase, merge, cherry-pick, and revert
- [ ] Operation previews and temporary recovery references

## Stable multiplatform release

- Signed Windows installers
- Notarized Intel and Apple Silicon macOS packages
- Linux AppImage, Debian, and RPM packages
- Community translations, security review, performance qualification, and
  packaged acceptance on every supported operating system

Provider-specific GitHub, GitLab, and Forgejo review interfaces are post-v1.
Standard local, HTTPS, and SSH remotes remain part of the core product.
