# Compatibility notes

## Repository tab utilities

Documented behavior:

- A repository tab menu keeps common repository and tab-management actions close to the selected tab.
- Batch closing clearly identifies whether it affects tabs to the right or every other open repository.
- Focused tabs expose the same menu through standard context-menu keys.

Independent implementation:

- Git Chronos presents repository identity, terminal and folder access, favorite state, display-name editing, and close actions in a project-designed menu.
- Closing multiple repositories uses the same draft, terminal, recently-closed, and persistence paths as closing one tab.
- Counts beside batch actions make their scope visible before activation, and unavailable actions remain disabled.
- Directional keys traverse enabled actions, while Escape restores focus to the originating tab.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Repository-local author identity

Documented behavior:

- Git resolves `user.name` and `user.email` from its layered configuration when creating commits.
- Repository-local values override broader configuration only for the current repository.

Independent implementation:

- Git Chronos displays the effective author identity and offers an explicit editor for repository-local values.
- The native layer validates single-line, non-empty values and delegates persistence to `git config --local --replace-all` using argument arrays.
- The application does not create an account or store identity data outside Git configuration.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Repository terminal tab navigation

Documented behavior:

- A repository may keep multiple independent terminal sessions open in a tab strip.
- Left and Right Arrow move between terminal tabs, Home and End select the boundaries, and focus follows selection.
- Ctrl+PageUp and Ctrl+PageDown cycle sessions, while Ctrl+Shift+T and Ctrl+Shift+W open and close sessions.

Independent implementation:

- Git Chronos uses project-owned session state and native pseudo-terminal commands behind a WAI-ARIA tab interface.
- Each terminal tab and content panel has a unique repository-scoped relationship, and inactive tabs leave the keyboard sequence.
- The shortcut routing is limited to the visible terminal panel and does not change repository-tab behavior.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Focused diff file identity

Documented behavior:

- The central diff keeps the active file name readable while retaining its repository-relative directory and revision context.
- The complete path remains available as a tooltip and through an explicit copy action.

Independent implementation:

- Git Chronos derives the name and directory from its existing repository-relative path and adapts the header with project-owned responsive styling.
- No additional file reads or Git commands are required when switching files.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Changed-file navigation in the central diff

Documented behavior:

- A focused diff keeps the repository context panels visible while presenting one changed file in the center workspace.
- Previous and next controls move through the currently displayed file ordering without closing the diff.
- Alt+Up and Alt+Down provide the same navigation from the keyboard.

Independent implementation:

- Git Chronos derives navigation targets from its own filtered path/tree lists for working changes, commits, and comparisons.
- Navigation reuses the existing asynchronous inspection APIs and request guards, so stale file loads cannot replace a newer selection.
- The toolbar controls, counter, shortcuts, and visual treatment are project-created.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Keyboard-accessible workspace splitters

Documented behavior:

- The left reference panel and right commit panel can be resized with either a pointer or a keyboard.
- Every visible commit-graph column exposes the same keyboard-resizing model from its header boundary.
- Stacked reference sections expose horizontal splitters and retain automatic sizing until the user adjusts them.
- The repository terminal exposes the same bounded horizontal splitter model and restores its saved height across application sessions.
- A focused vertical splitter reports the controlled panel, its current width, and its permitted width range.
- Directional arrows move the physical divider, Shift selects a larger step, and Home or End select the bounded extremes.

Independent implementation:

- Git Chronos applies project-owned width bounds and persists the resulting pixel width in local application storage.
- Double-click restores project defaults or automatic section sizing, while the graph column fits the currently required branch-lane width.
- The implementation follows the public WAI-ARIA window splitter semantics and does not depend on another application's code or assets.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Keyboard-accessible graph and reference actions

Documented behavior:

- Focused graph rows expose their action menus through the standard Menu key or Shift+F10.
- Local branches, remote branches, and tags expose the same actions from every interactive reference surface.
- Directional keys move through enabled actions, while Escape closes the menu and restores graph focus.

Independent implementation:

- Git Chronos positions the existing project-designed commit or stash menu beside the focused row.
- Reference menus reuse the same focus, directional-navigation, and return-to-origin behavior in the Left Panel, graph, and commit inspector.
- Focus moves only after the conditional menu view has rendered and returns without scrolling the graph.
- Disabled actions are excluded from keyboard traversal.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Lazy annotated-tag previews

Documented behavior:

- Hovering or focusing a tag can reveal its annotation and tagger context without navigating away from the graph.

Independent implementation:

- Git Chronos waits for a deliberate hover before requesting one exact tag through Git's public `for-each-ref` interface.
- Preview output is bounded, stale requests are ignored, and successful results are cached by repository, tag name, and target object.
- Initial repository snapshots remain unchanged, so repositories with thousands of tags do not pay annotation costs before the workspace is interactive.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Large-repository first-frame snapshot

Documented behavior:

- Repository tabs should become interactive without waiting for optional metadata on every inactive branch.
- The current branch still needs immediate upstream and ahead/behind information.

Independent implementation:

- Git Chronos's latency-sensitive snapshot reads every local and remote branch name, object ID, and upstream name without asking Git to traverse each branch history.
- Current-branch divergence is retained from the bounded status query.
- Annotated tags and the broader working-tree snapshot hydrate after the first usable frame, avoiding an eager object walk in tag-heavy repositories.
- Full git-core snapshots preserve complete per-branch tracking metadata for callers that explicitly request it.
- Inactive saved tabs restore after the active workspace is interactive instead of competing with its first render.

## Bounded commit graph lanes

Documented behavior:

- History scrolling should remain responsive as older pages are appended.
- The graph should preserve useful nearby parent and merge relationships inside its visible column.

Independent implementation:

- Git Chronos extends an append-only graph-layout cache when another history page arrives instead of rebuilding every earlier row.
- Active lanes are bounded by the number that can fit in the configured graph column, with a hard safety ceiling.
- DOM virtualization and bounded per-row SVG edges keep rendering cost proportional to the visible graph instead of the repository's total ref fan-out.

No proprietary implementation details were used.

## Readable default interface scale

Documented behavior:

- Repository navigation, graph metadata, file lists, forms, and status text should be readable at the default 100% interface zoom.
- Zoom remains an optional workspace preference rather than a prerequisite for ordinary use.

Independent implementation:

- Git Chronos uses a 12 px floor for primary application text at 100% zoom while retaining larger heading and editor-specific type scales.
- Tiny non-textual initials and corner annotations retain compact dimensions where enlarging them would obscure their container.
- Renderer coverage checks the graph, sidebar, toolbar, file list, commit form, and status bar as distinct interface regions.

No proprietary source code, fonts, assets, or visual measurements were copied.

## Platform-aware keyboard shortcut labels

Documented behavior:

- Desktop shortcuts use Command and Option terminology on macOS.
- Windows and Linux use Ctrl, Alt, and F11 terminology.

Independent implementation:

- Git Chronos derives display labels from the browser platform exposed by the native WebView.
- Command handling continues to accept the platform's native modifier keys; only the teaching labels vary.
- A pure platform mapping and renderer journey cover both the mapping and the Linux presentation.

No proprietary source code, assets, wording, or implementation details were used.

## Branch checkout undo and redo

Documented behavior:

- A successful branch checkout is available as the most recent undoable action.
- Undo returns to the previously checked-out branch; redo reapplies the checkout.

Independent implementation:

- Git Chronos records only the before/after local branch names returned by its own repository snapshot.
- Undo and redo reuse the validated public `git switch` command path and refresh the repository afterward.
- Failed, detached, or no-op checkouts are not recorded as reversible actions.

No proprietary source code, assets, wording, or implementation details were used.

## Branch rename undo and redo

Documented behavior:

- The toolbar Undo and Redo controls expose the most recent supported repository action.

Independent implementation:

- Git Chronos records the validated old and new local branch names only after a successful rename.
- Undo and redo call the same validated branch-rename command with reversed arguments.
- If either expected branch name no longer exists, Git rejects the operation instead of overwriting unrelated state.

No proprietary source code, assets, wording, or implementation details were used.

## Commit-producing action undo and redo

Documented behavior:

- Successful commit-producing actions can become the most recent undoable action.
- Multi-commit cherry-pick participates in the same one-step Undo/Redo workflow.

Independent implementation:

- Git Chronos records the repository's before/after HEAD identifiers after successful commits, message edits, cherry-picks, and revert commits.
- Undo and redo use a guarded soft HEAD move and fail if repository history changed after the recorded action.
- The guard preserves unrelated external Git activity instead of guessing how history should be rewritten.

No proprietary source code, assets, wording, or implementation details were used.

## Commit graph date formatting

Documented behavior:

- Date and time presentation is an app-wide UI preference.
- The selected presentation applies consistently to commit graph rows.

Independent implementation:

- Git Chronos provides compact locale-aware, relative, and ISO 8601 modes using browser internationalization APIs.
- The preference is stored locally and never changes commit metadata.
- Formatting controls and visuals are original to Git Chronos.

No proprietary source code, assets, or implementation details were used.

## Repository-wide file history search

Documented behavior:

- A keyboard shortcut opens a focused tracked-file search.
- Matching files expose direct history and blame actions.

Independent implementation:

- Git Chronos queries the public `git ls-files` interface with a validated literal search and NUL-delimited output.
- Native output, result count, and input length are bounded; searches are debounced and stale responses are ignored.
- Results open Git Chronos's independently designed centered history or blame workspace.

No proprietary source code, assets, wording, or implementation details were used.

## Interface zoom presets

Documented behavior:

- The status bar offers 100%, 110%, 125%, 140%, 150%, 175%, and 200% zoom presets.
- Zoom-in and zoom-out stop at the first and last presets.
- Reset returns the interface to 100%.

Independent implementation:

- Git Chronos implements these presets using its own Angular state and Tauri window integration.
- Previously stored values outside the supported range are normalized to the nearest preset.
- No proprietary source code, assets, or implementation details were used.

## Sparse checkout

Documented behavior:

- A repository can limit its working tree to selected directories in cone mode.
- The current selection can be reapplied after other Git operations materialize additional paths.
- Disabling sparse checkout restores the complete tracked working tree.
- A sparse index can reduce index work for large repositories.

Independent implementation:

- Git Chronos invokes the public `git sparse-checkout` interface with validated argument arrays and newline-delimited standard input.
- Repository state comes from documented Git configuration and `git sparse-checkout list` output.
- The UI and confirmation flows are original to Git Chronos; no proprietary code, assets, or visual implementation were used.

## Compact commit graph column

Documented behavior:

- Commit graph settings provide an alternate compact column layout.
- The compact layout reduces the horizontal space needed for branch relationships.

Independent implementation:

- Git Chronos uses its own lane geometry with a smaller lane gap and preferred column width.
- Expanded and compact widths are stored separately per repository, so switching layouts preserves user resizing.
- The resize ceiling is calculated from the peak active-lane count in the loaded topology, allowing every visible branch path to fit without a fixed-width cutoff.
- The graph settings menu and a resizer double-click provide a project-designed fit-to-paths action.
- Twelve project-defined lane colors reduce path repetition in wide histories while keeping reference labels, connectors, nodes, and edges visually associated.
- Commit ordering, topology, row height, and navigation remain unchanged.
- Narrowing the Author column replaces clipped names with project-created initial avatars and an icon header while retaining full identity tooltips.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Guided commit bisection

Documented behavior:

- A binary search starts from one known-bad commit and one older known-good commit.
- Each checked-out candidate can be classified as good, bad, or untestable.
- Resetting the search restores the branch and commit that were active before the search.

Independent implementation:

- Git Chronos invokes the public `git bisect start`, `good`, `bad`, `skip`, and `reset` commands through its validated native command boundary.
- The selected historical commit is presented as the known-good endpoint; the current HEAD remains the explicit known-bad endpoint.
- A project-designed progress bar keeps classification controls visible without reproducing another application's layout or assets.
- Starting is disabled for dirty worktrees, identical endpoints, rebases, or an already-active bisection.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Protected history rewriting

Documented behavior:

- A rewritten local branch may need to replace its upstream history.
- A force-with-lease push refuses to overwrite a remote branch that no longer matches the locally known remote-tracking state.

Independent implementation:

- Git Chronos exposes the public `git push --force-with-lease` behavior only for a local branch with a configured upstream.
- The action is separated from ordinary Push and requires an explicit confirmation that names the branch and upstream.
- An unconditional `--force` path is not exposed.
- Native coverage advances a bare remote behind the client's back and verifies that the stale lease rejects the rewrite without changing the remote reference.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Conflicted merge lifecycle

Documented behavior:

- A merge that cannot resolve automatically remains active while conflicted files are reviewed and staged.
- The merge can be completed after every conflict is resolved or aborted to restore the pre-merge state.

Independent implementation:

- Git Chronos detects the documented `MERGE_HEAD` repository state through Git's resolved metadata path.
- A project-designed status bar exposes Continue and Abort throughout the merge instead of relying on a transient error message.
- Continue uses `git merge --continue` with a non-interactive editor configuration; Abort uses `git merge --abort`.
- Native tests cover both a completed three-way resolution and restoration after aborting a conflicted merge.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Interrupted cherry-pick and revert recovery

Documented behavior:

- Conflicted cherry-pick and revert operations remain active until continued, skipped, or aborted.
- Continue applies the staged resolution, Skip omits the current commit, and Abort restores the state from before the operation.

Independent implementation:

- Git Chronos detects Git's documented `CHERRY_PICK_HEAD` and `REVERT_HEAD` metadata in the same bounded operation-state query used for merge, rebase, and bisect.
- A project-designed history-operation bar stays visible while the sequencer operation is active.
- Every control invokes the corresponding public Git command through validated fixed choices; arbitrary command or option input is not accepted.
- Native fixtures verify both cherry-pick completion and abort, plus revert detection and restoration.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Commit signer diagnostics

Documented behavior:

- Git selects a signing backend and optional program from repository, global, and system configuration.
- OpenPGP, SSH, and X.509 signing use different default programs.

Independent implementation:

- Git Chronos reads the effective Git signing format and relevant program setting only when the user requests a diagnostic.
- The diagnostic resolves the configured program or documented default through the repository path and system `PATH` without invoking the signer or requesting credentials.
- The result distinguishes explicit key selection from Git's default-key selection and remains scoped to the active repository.
- Signer checks are deliberately excluded from repository snapshot loading to preserve startup performance.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Reflog recovery history

Documented behavior:

- Git records updates to local reference tips in reflogs and exposes them through `git reflog`.
- A recorded commit can be kept reachable by creating a branch at its object ID.

Independent implementation:

- Git Chronos reads a bounded set of reflog records through the system Git executable with a byte-limited output buffer.
- A project-designed searchable recovery view shows selectors, actions, authors, and abbreviated commit IDs.
- Recovery creates a branch through the existing validated branch command and never moves the current branch implicitly.
- Destructive reset is deliberately excluded from the recovery shortcut.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Explicit commit signing

Documented behavior:

- Git can sign a commit with the signing key and format selected by the user's configuration.
- Signing failures abort commit creation instead of silently producing an unsigned commit.

Independent implementation:

- Git Chronos exposes an explicit commit-form option and forwards only a boolean signing request across IPC.
- The native layer asks the system Git executable to sign; private keys and passphrases never enter renderer state.
- Existing `commit.gpgSign` configuration initializes the explicit commit-form option.
- Git Chronos reads identity and signing preferences together in one bounded config query, avoiding additional startup subprocesses.
- The commit checkbox starts from the effective repository default; changing it sends an explicit per-commit sign or no-sign override.
- Preferences display the effective format and key without reading or storing private-key material.
- The inspector verifies only the selected commit, avoiding an expensive signature check across the complete graph.
- Git's status is mapped to original verified, unknown-trust, invalid, expired, revoked, unverifiable, and unsigned presentation states.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Application themes

Documented behavior:

- The desktop appearance can be selected globally and persists between sessions.
- Theme switching is discoverable from both preferences and keyboard-oriented commands.

Independent implementation:

- Git Chronos provides project-owned Chronos Dark and Midnight Contrast palettes through CSS custom properties.
- The selected theme is stored locally and applied at the document root so welcome, repository, overlay, and terminal-adjacent surfaces share the same state.
- Palette names, color values, controls, and styling are original to Git Chronos.

No proprietary assets, palettes, source code, or visual implementation details were copied.

## Diff viewer presentation

Documented behavior:

- Diff and editor text size, tab spacing, and long-line wrapping are application preferences.
- The selected presentation is shared across diff layouts and blame views.

Independent implementation:

- Git Chronos stores three bounded local presentation values and applies them through project-owned CSS custom properties.
- Inline, hunk, split, and blame content share the same monospace geometry without modifying repository files or patch data.
- The in-view wrap control updates the same persisted preference as the Preferences dialog.

No proprietary source code, assets, palettes, or visual implementation details were used.

## Default commit graph columns

Documented behavior:

- Branch/Tag, Graph, and Commit Message form the initial graph table.
- Author, Date/Time, and SHA remain available as optional, reorderable columns.
- Column choices are stored per repository.

Independent implementation:

- Git Chronos centralizes its initial visibility policy in a pure project-owned helper.
- Existing per-repository visibility settings continue to take precedence, so upgrades do not overwrite user choices.
- All six columns retain the existing resize, reorder, and settings-menu controls.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Commit graph scroll markers

Documented behavior:

- A narrow rail beside the commit graph identifies important locations such as HEAD, selected rows, and search results.
- Marker visibility can be changed from graph settings.

Independent implementation:

- Git Chronos derives marker positions from its virtual row geometry without adding off-screen commit rows to the DOM.
- Project-defined colors distinguish working changes, HEAD, selections, and search results.
- Large selection and search sets are evenly sampled to keep marker rendering bounded.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Favorite repositories

Documented behavior:

- Frequently used repositories can be pinned in repository management.
- The first nine favorites can be opened with a platform-specific numeric shortcut.

Independent implementation:

- Git Chronos stores an ordered list of repository paths in local application storage.
- Favorites can be added or removed from recent-repository rows and remain available across restarts.
- Existing tabs are activated directly; closed favorites use the normal repository-opening path.
- The star icon and repository-management layout are project-created.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Pull strategy defaults

Documented behavior:

- The pull dropdown exposes fetch, fast-forward/merge, fast-forward-only, and rebase workflows.
- A pull strategy can be selected as the toolbar default independently of running it.

Independent implementation:

- Git Chronos executes each strategy through its existing validated Git command path.
- A project-created star control persists the default locally without starting a network operation.
- Choosing the strategy label runs that mode once without changing the saved default.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Repository tab reordering

Documented behavior:

- Open repository tabs can be rearranged with drag-and-drop.
- The tab order persists with the open repository set.

Independent implementation:

- Git Chronos reorders its own repository-session array and persists only canonical repository paths.
- A project-defined insertion marker indicates whether the dragged tab will land before or after the target.
- Grouped worktree tabs reuse the same deterministic ordering model.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Repository maintenance command

Documented behavior:

- Repository optimization is available from the keyboard-oriented command palette.
- The operation improves Git's on-disk repository data and can take time on large repositories.

Independent implementation:

- Git Chronos invokes the public `git maintenance run` command through its existing argument-array execution boundary.
- The native command runs away from the renderer thread and is serialized with other operations for the same repository.
- Progress and completion are reported through Git Chronos's project-defined activity system.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Keyboard-first repository and working-tree actions

Documented behavior:

- The command palette can directly open clone and initialization workflows, close the current tab, and run staging or stash actions.
- Individual stashes can be viewed, applied while retained, or popped.
- Local branches can be located and routed into rename or guarded deletion workflows.

Independent implementation:

- Git Chronos exposes its existing repository forms and validated service operations as searchable command descriptors.
- Dynamic stash commands are derived from the current repository snapshot and use encoded stash references at the UI boundary.
- Dynamic branch commands are derived from local references; rename uses an editable dialog and deletion retains the existing confirmation and force-delete guard.
- Destructive actions are not inferred from search text, and commands disable themselves when repository state makes them unavailable.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Hosted review-request navigation

Documented behavior:

- A supported repository remote identifies the hosted repository associated with the local checkout.
- Pull requests or merge requests are reviewed on the repository's hosting page.

Independent implementation:

- Git Chronos parses supported GitHub, GitLab, and Bitbucket Cloud HTTPS and SSH clone URL forms locally.
- Provider-specific terminology and nested GitLab namespaces are retained in the generated destination.
- Only validated HTTPS destinations are passed to the operating system's default browser.
- Unsupported hosting providers retain a neutral empty state; no host API is queried and no credentials are collected.

No proprietary source code, assets, wording collections, or visual implementation details were used.

## Isolated worktree terminal handoff

Documented behavior:

- Parallel tasks can use separate Git worktrees so each task has an independent working directory and branch.
- A repository terminal should start in the active worktree and remain available through repository tab changes.

Independent implementation:

- Git Chronos creates the worktree through its existing native Git command boundary and opens it as a normal repository tab.
- Users can choose to reveal the existing multi-tab repository terminal immediately after creation.
- The workflow is tool-neutral and does not assume, install, or invoke a particular coding agent.

No proprietary source code, assets, wording collections, or visual implementation details were used.
