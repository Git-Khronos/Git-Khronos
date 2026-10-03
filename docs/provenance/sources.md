# Informational sources

## Desktop interface behavior

Sources:

- [Git log documentation](https://git-scm.com/docs/git-log)
- [Git status documentation](https://git-scm.com/docs/git-status)
- [Git branch documentation](https://git-scm.com/docs/git-branch)
- [Git tag documentation](https://git-scm.com/docs/git-tag)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WAI-ARIA Authoring Practices window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
- [WAI-ARIA Authoring Practices tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)

Used for:

- High-level toolbar, panel, graph, and status-bar behavior.
- The default Branch/Tag, Graph, and Commit Message column set plus optional metadata columns.
- App-wide UI customization for commit-graph date and time presentation.
- Visible remote-fetch recency in the repository chrome.
- Command-palette discovery for repositories, branches, tags, stashes, working-directory state, changed-file diffs, history, and blame.
- Keyboard access to commit, stash, reference, and repository-tab action menus through standard context-menu keys and directional navigation.
- Focusable repository-panel, stacked reference-section, terminal-panel, and commit-graph column splitters with exposed bounds, current values, and directional keyboard resizing.
- Roving focus, wrapped directional navigation, and explicit tab-to-panel relationships for repository terminals.
- Project-defined interface zoom presets: 100%, 110%, 125%, 140%, 150%, 175%, and 200%.
- Project-defined shortcut behavior for fullscreen mode, opening the current repository folder, and opening repositories.
- Platform-specific Command/Option and Ctrl/Alt shortcut terminology.
- The product-neutral workflow for comparing a selected commit with current working-directory changes.
- The project-defined branch-menu workflow for assigning an upstream remote branch.
- Revealing the nearest containing branch when inspecting an otherwise unlabeled commit.
- One-step undo and redo for successful local and remote-tracking branch checkouts.
- The project-defined option to reduce the commit graph column's horizontal footprint.
- Local initials or stable per-author color markers, plus icon headers for narrow graph columns.
- Scroll markers for checked-out tips, selections, working changes, and search results.
- Separate execution and default-selection controls for Git pull strategies.
- Persistent repository-tab reordering through drag-and-drop.
- Repository-tab utilities for terminal and folder access, favorites, display names, and scoped batch closing.
- Hover previews for annotated tags without eagerly loading annotation content.
- Global appearance selection that persists independently of repository state.
- Project-defined diff/editor preferences for text size, tab width, and long-line wrapping.

No source code, assets, or product-specific visual implementation were copied.

## Tracked-file discovery

Source:

- [Git `ls-files` documentation](https://git-scm.com/docs/git-ls-files)

Used for:

- Repository-wide tracked-file search with NUL-delimited path handling.
- Capped, case-insensitive pathspec queries that feed file-history and blame actions.

No source code was copied.

## Git remote management

Source:

- [Git remote documentation](https://git-scm.com/docs/git-remote)

Used for:

- Adding named remotes with fetch URLs.
- Reading effective fetch and push URLs.
- Updating a remote URL and removing a remote configuration.
- Warning that removing a remote also removes its remote-tracking branches.

No source code was copied.

## Git LFS repository actions

Sources:

- [Git LFS command documentation](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs.adoc)
- [Git LFS install documentation](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-install.adoc)
- [Git LFS track documentation](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-track.adoc)
- [Git LFS prune documentation](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-prune.adoc)

Used for:

- Showing repository-scoped LFS actions only when LFS tracking is configured.
- Initializing repository-local Git LFS filters and hooks.
- Adding ordinary or lockable tracking patterns through `.gitattributes`.
- Pulling objects required by the current checkout through the documented Git LFS CLI.
- Requiring explicit confirmation before pruning old local LFS objects.

No source code, assets, wording, or visual implementation were copied.

## Partial patch application

Source:

- [Git apply documentation](https://git-scm.com/docs/git-apply)

Used for:

- Applying selected working-tree patch lines to the index.
- Reversing selected patches for unstage and discard operations.
- Recounting edited hunk line counts after line selection.
- Restoring and reapplying repository-local discard recovery patches.

No source code was copied.

## Sparse checkout

Sources:

- [Git sparse-checkout documentation](https://git-scm.com/docs/git-sparse-checkout)
- [Git 2.34 sparse-checkout documentation](https://git-scm.com/docs/git-sparse-checkout/2.34.0.html)

Used for:

- Reading repository-local sparse checkout, cone-mode, and sparse-index state.
- Setting directory selections through standard input, reapplying the current selection, and restoring the complete working tree.
- Providing repository-scoped preferences and conditional toolbar actions for an enabled sparse checkout.
- Warning that restoring a full working tree can require substantial time and disk space.

No source code, assets, wording, or visual implementation were copied.

## Repository favorites

Source:

- Project-defined repository navigation requirements.

Used for:

- Defining the functional expectation that repository management can pin frequently used repositories.
- Providing platform-specific shortcuts for the first nine favorites.

No source code, assets, wording, or visual implementation were copied.

## Repository maintenance

Sources:

- [Git maintenance documentation](https://git-scm.com/docs/git-maintenance)

Used for:

- Defining a keyboard-accessible repository-maintenance capability.
- Defining keyboard-accessible repository creation, tab, staging, and stash workflows.
- Running Git's documented repository-local maintenance strategy on demand.
- Keeping maintenance serialized with other repository operations while the UI remains responsive.

No source code, assets, wording collections, or visual implementation were copied.

## Commit bisection

Source:

- [Git bisect documentation](https://git-scm.com/docs/git-bisect)

Used for:

- Starting a binary search from explicit known-bad and known-good revisions.
- Classifying candidates with Git's documented good, bad, and skip terms.
- Restoring the original branch and commit with Git's reset operation.

No source code was copied.

## Protected force push

Source:

- [Git push documentation](https://git-scm.com/docs/git-push)

Used for:

- Publishing rewritten branch history with `--force-with-lease`.
- Preserving remote work by rejecting a push when the upstream reference differs from the locally observed remote-tracking reference.

No source code was copied.

## Merge continuation and recovery

Source:

- [Git merge documentation](https://git-scm.com/docs/git-merge)

Used for:

- Detecting an active merge through Git repository metadata.
- Continuing a resolved merge and aborting a conflicted merge through documented commands.
- Restoring the pre-merge state when the user aborts.

No source code was copied.

## Cherry-pick and revert recovery

Sources:

- [Git cherry-pick documentation](https://git-scm.com/docs/git-cherry-pick)
- [Git revert documentation](https://git-scm.com/docs/git-revert)

Used for:

- Detecting interrupted cherry-pick and revert operations.
- Continuing, skipping, or aborting the active operation through documented commands.
- Restoring the original repository state when an operation is aborted.

No source code was copied.

## Reflog recovery

Source:

- [Git reflog documentation](https://git-scm.com/docs/git-reflog)

Used for:

- Reading local reference movement history through Git's documented reflog interface.
- Identifying prior commit positions with reflog selectors.
- Preserving a selected commit by creating a normal branch without moving the current branch.

No source code was copied.

## Commit signing

Source:

- [Git commit documentation](https://git-scm.com/docs/git-commit)
- [Git config documentation](https://git-scm.com/docs/git-config)
- [Git pretty formats documentation](https://git-scm.com/docs/pretty-formats)

Used for:

- Requesting a cryptographic commit signature through Git's documented `--gpg-sign` option.
- Delegating key selection, signing format, signer invocation, and credentials to the user's existing Git configuration.
- Reading effective repository identity, automatic-signing, signing-format, and signing-key configuration.
- Updating repository-local `user.name` and `user.email` values through Git's documented configuration interface.
- Reading Git's documented signature status, signer, key, fingerprint, and trust placeholders for one inspected commit.
- Resolving the effective OpenPGP, SSH, or X.509 signer program without invoking it.

No source code was copied.

## Keyboard-accessible tag creation

Sources:

- [Git tag documentation](https://git-scm.com/docs/git-tag)
- Project-defined command-palette requirements.

Used for:

- Creating either a lightweight tag or an annotated tag with a message at an explicitly selected commit or the current HEAD.
- Making tag creation available through the application command palette.

No source code, assets, wording collections, or visual implementation were copied.

## Reference visibility controls

Source:

- Project-defined graph visibility requirements.

Used for:

- Defining the product-neutral behavior of hiding references from the commit graph without changing Git data.
- Applying or removing Solo Mode for individual branches and complete remote locations.

No source code, assets, wording collections, or visual implementation were copied.

## Hosted review-request navigation

Sources:

- [GitHub documentation about remote repositories](https://docs.github.com/en/get-started/git-basics/about-remote-repositories)
- [GitHub pull-request documentation](https://docs.github.com/en/pull-requests/reference/pull-requests)
- [GitLab merge-request documentation](https://docs.gitlab.com/user/project/merge_requests/)
- [GitLab Projects API fields](https://docs.gitlab.com/api/projects/)
- [Bitbucket Cloud remote URL documentation](https://support.atlassian.com/bitbucket-cloud/docs/change-the-remote-url-to-your-repository/)
- [Bitbucket Cloud pull-request URL example](https://support.atlassian.com/bitbucket-cloud/kb/how-to-locally-fetch-and-checkout-a-pull-request/)

Used for:

- Recognizing documented GitHub, GitLab, and Bitbucket Cloud HTTPS and SSH repository remote forms.
- Providing an explicit link from a repository remote to its pull-request or merge-request page.
- Treating hosted review requests as a hosting workflow without inspecting or copying any hosting-client implementation.

No source code, assets, wording collections, or visual implementation were copied.

## Isolated worktree sessions

Source:

- [Git worktree documentation](https://git-scm.com/docs/git-worktree)

Used for:

- Creating a linked working tree for a new branch or an existing branch.
- Opening the linked worktree as a repository workspace with an optional repository terminal.
- Keeping terminal handoff tool-neutral so users can run any locally available command.

No source code, assets, wording collections, or visual implementation were copied.
