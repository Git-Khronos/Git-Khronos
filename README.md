# Git Khronos

Git Khronos is a free and open-source, local-first Git desktop client built with
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
> linked-worktree and native submodule management, and a repository-scoped terminal with
> multiple independent tabs.

## Prerequisites

- Node.js 24.15+ LTS or Node.js 26
- pnpm 10 or newer
- Rust 1.99.0 (pinned by `rust-toolchain.toml`)
- Git 2.39 or newer (the native suite is qualified against Git 2.39, 2.43 and
  current releases; older Git lacks options such as NUL-separated worktree lists)
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

### Install system-wide on Debian or Ubuntu

#### Using the install script

[`install.sh`](install.sh) installs Git Khronos from a published GitHub Release.
It downloads the release's `SHA256SUMS`, verifies the `.deb` for your CPU
architecture against it, confirms the package is Git Khronos, and installs it
with APT (which resolves dependencies and asks for `sudo`). Download and read
the script before running it:

The Debian package requires glibc 2.39 or newer (the Ubuntu 24.04 baseline).
APT refuses installation on systems with an older glibc.

```bash
curl -fsSLO https://raw.githubusercontent.com/Git-Khronos/Git-Khronos/main/install.sh
less install.sh
bash install.sh --dry-run   # verify and show APT's plan only
bash install.sh             # install the latest release
```

Other options:

```bash
bash install.sh --version 0.1.0          # a specific release
bash install.sh --deb ./Git-Khronos.deb  # a package you already have
bash install.sh --from-source            # build from source, then install
bash install.sh --uninstall              # remove; repositories and preferences are kept
```

Downloading requires a published release that provides
`Git-Khronos_<version>_<arch>.deb` and `SHA256SUMS`. Until one exists, use
`--from-source` or `--deb`, or the `task` commands below. Run
`bash install.sh --help` for every option.

#### From a source checkout

Build a native Debian package and install it for every user on the machine:

```bash
task install:system
```

The command builds the optimized application, verifies that the generated
package belongs to Git Khronos, and then asks for administrator access through
`sudo`. The package installs `git-khronos` in `/usr/bin`, registers Git
Khronos in the desktop application menu, and installs its icons and license
notices in the standard system locations. Git 2.39 or newer is a required
package dependency; OpenSSH client and Git LFS are recommended dependencies.
The Debian package requires glibc 2.39 or newer, matching the Ubuntu 24.04
build baseline.

To build and verify the `.deb` without installing it, print the generated
package path, or remove the system package while leaving repositories and
per-user preferences untouched:

```bash
task package:deb
task package:deb:path
task uninstall:system
```

The generated package is written to `target/release/bundle/deb/`. Unchanged
builds reuse it only after validating its metadata and required payload; a
missing or invalid package triggers a rebuild. The generic
`task bundle` command continues to build every installer format supported by the
current platform, while `task install` remains the development-dependency setup
command. After installation, launch **Git Khronos** from the desktop application
menu or run `git-khronos` from any terminal. A locally built package
targets the current CPU architecture and native-library baseline; build public
release packages on the oldest Debian/Ubuntu baseline the release supports.

`task package:deb` (and `task install:system`) reuses the last successful build
when its source/configuration checksums are unchanged and required build outputs
are still present. Package verification still runs every time. The first
invocation after enabling these checks builds once to establish a baseline in
`.task/`; existing Cargo and Nx caches are retained. Source additions, edits,
deletions, or missing required outputs trigger another build. Use
`task --force package:deb` to rebuild explicitly, for example after changing the
installed toolchain or system libraries.

`task frontend` creates an optimized frontend build. Use `task preview` when
you need a browser-accessible, sample-data development server at
`http://127.0.0.1:4200`. Add `?welcome-preview` to inspect the welcome screen.
System Git operations are available only in the native Tauri application.

`task test` includes an IPC contract check
(`apps/desktop/src/app/ipc-contract.spec.ts`). It reads the native command
registrations and signatures, plus renderer calls, from source. It fails when a
command is unregistered or unused, when argument names differ, or when a
cancelable command cannot receive its operation identifier.
`e2e/renderer/accessibility-audit.spec.ts` runs a dependency-free structural
accessibility audit across sample-data preview states and open overlays. It
does not replace review with real assistive technology.

Run `pnpm nx run desktop:audit` to check runtime and development dependencies
against the registry's current vulnerability advisories. This target is never
cached and fails on any reported severity. A clean audit is not a substitute
for build, behavioral, native-package, or accessibility validation.

**Preferences → Git Features → Git command reference…** opens a searchable
learning reference for implemented workflows. Each topic explains the underlying
commands, important precautions and the application's narrower scope. Contextual
**Learn about…** buttons open the relevant topic without submitting the parent
dialog. Official Git and Git LFS manuals open in your browser only on request;
their full option sets do not imply that Git Khronos implements every option.
The explanations are original, not copied documentation.

The commit form's **Commit policy** options are opt-in per repository draft.
**Add Signed-off-by trailer** delegates to `git commit --signoff`, using Git's
committer identity; this is a contributor statement governed by your project's
policy, not a cryptographic signature. **Allow commit without staged changes**
delegates to `--allow-empty`: it permits an unchanged tree but still includes
staged contents when present and never stages unstaged edits automatically.
Both options reset after a successful commit. Hook/signing failures preserve
the draft and opt-ins for retry; hooks are not bypassed by either option.
A nonempty message is still required. If you switch repositories before a
commit finishes, its completion does not clear the new draft or push the new
repository's branch.

In the same disclosure, **Override commit author** and **Override commit
committer** accept complete name/email pairs for this commit only. An author
override uses explicit `--author`; a committer override uses command-local
`GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`, also visible to Git's hooks.
No repository/global configuration or application-process environment is changed.
Amend retains its existing author unless overridden; Signed-off-by uses the
effective committer. Signing continues to follow Git policy, so changing the
committer may affect default key selection. Invalid identities are refused
without starting the commit. Enabled overrides follow their repository draft,
survive failures for correction and reset after success.

**Skip checks** is an explicit `--no-verify` opt-out for pre-commit and commit-msg
verification hooks, not a way to disable every hook. Prepare-commit-msg and other
applicable hooks still run, including hooks selected by `core.hooksPath`.
Hooks may modify messages, staged contents or working files; a failed commit does
not roll back their effects. Inspect staged changes before retrying.
Signing failures retain the draft and never silently turn signing off.
Signer availability checks establish only that the program can be found, not
that its key is accessible or signing will succeed. OpenPGP diagnostics respect
both `gpg.openpgp.program` and its legacy `gpg.program` alias in effective
configuration order, without trimming literal executable paths.
Empty, valueless, malformed, non-UTF-8 or oversized diagnostic configuration
produces explicit feedback instead of substituting a default signer.
Rechecking clears the previous availability result, including when the new
check fails.

The commit inspector distinguishes stored signatures that cannot be verified
from genuinely unsigned commits. SSH verification follows the user's allowed
signers and revocation configuration; the application does not create trust
entries. If Git cannot verify a signature, check the configured tools, keys and
trust policy. Real disposable SSH signing/trust/revocation qualification is
available with `cargo test -p git-khronos-git-core signing_ -- --include-ignored`
when `ssh-keygen` supports SSH signing. It generates and removes test-only keys;
no existing keys or user trust stores are modified.
On Unix, the same selector also qualifies real OpenPGP signing when `gpg` and
`gpgconf` are available. Its private signing home and separate public-only
verification home are disposable and isolated from user keyrings. It checks
trusted and unknown-trust signatures, missing public keys, tampered signatures,
missing signing-key failure, explicit correction/retry and unsigned amend.
Cleanup stops only the agent associated with each owned home and removes the
fixture data.
With `gpgsm`, `gpgconf` and `openssl`, the selector also qualifies an isolated
X.509 round trip using a generated self-signed certificate. It checks signed and
tampered commits, explicit certificate distrust, unavailable private-key refusal,
corrected-signer retry and unsigned amend while preserving repository policy,
staged contents, working files and fixture trust lists.
The X.509 fixture is strictly offline: its wrappers disable Dirmngr/CRL checks
only for disposable certificate testing. Production adds none of those options.
This does not qualify online CRL/OCSP, external CA chains or every certificate
trust case. Interactive passphrase/hardware-key and native packaged signing
acceptance remain unfinished.
Signature presentation loads only when commit details need it. Pending loading
does not claim verification, and a failed display import is explicit without
changing the selected commit or draft. Closing details during loading does not
reopen them or move focus when the chunk arrives.

Configured commit templates are read as bounded UTF-8 files (up to 1 MiB).
Git's `stripspace --strip-comments` prepares the form using the effective
comment prefix instead of unconditionally removing `#` headings.
Unreadable, oversized, invalid or non-file templates have visible feedback
without preventing the repository from opening. Empty/guidance-only templates
are disclosed separately from an unconfigured template.
**Refresh template status** retries after repairing the configured file;
for an available template, refresh the repository to pick up file changes.
**Reload template** requires confirmation before replacing the summary,
description and co-authors. It preserves other commit options, cannot run while
Git is busy, and a pending confirmation does not transfer to another repository.
Template guidance is normalized before entering the form; Git still applies
its configured commit cleanup and hooks to the submitted message.

Git failures retain their original credential-redacted diagnostics and now
include focused recovery guidance for recognized lock collisions, full disks/
quotas, filesystem permissions, index/object corruption and storage I/O failures.
These hints are advisory, not a diagnosis or repair guarantee. Unrecognized
errors retain the generic refresh/recovery guidance.
No hint deletes a lock, resets the index, runs maintenance or retries a write.
Wait for an owning Git operation before retrying lock failures; investigate a
possibly stale lock only after confirming its owner is no longer running.
Preserve staged/index and working-file data before investigating corruption.
**Preferences → Git Features → Inspect integrity** explicitly runs a cancellable
`git fsck --full --no-progress` check. It is inspection, not repair:
maintenance/pruning cannot restore missing objects.
After disk or permission failures, inspect possible partial effects before retry.

The integrity panel preserves stdout and stderr separately, retaining up to
1 MiB per stream. Excess output is drained but clearly marked incomplete,
never a passed check. Nonzero exits show findings/failure instead of a clean
result. Dangling objects can be normal; read the report.
No lost-found writes, automatic repair or downloads are requested, commit-graph
use is disabled for the check, and promisor/partial-clone configuration is refused
conservatively. The result does not verify LFS contents, signatures, device health
or every aspect of the repository and is not a backup. Global Git busy/cancel
controls remain available if preferences are closed. Reports do not transfer
to another active repository. Native packaged acceptance remains unfinished.
Git's configured bare-repository safety policy is respected, not overridden.

**Preferences → Git Features → Non-pruning maintenance** provides an explicit
review/run flow. The command-palette maintenance action uses the same native
scope: a complete passing integrity preflight, followed only by
`git maintenance run --task=commit-graph --task=pack-refs`.
Configured enabled tasks cannot add garbage collection, pruning, reflog expiry,
missing-worktree cleanup or prefetch to this invocation. No scheduling is changed.
This operation writes metadata, uses disk space and is not cancellable. It cannot
repair damage, replace a backup or exclude concurrent changes by other clients.
A failed or incomplete preflight prevents maintenance from starting; failures
during metadata updates can have partial effects, which should be inspected
before an explicit retry. Local feedback and review do not transfer across
repository switches.
Create a branch from the toolbar or the Local section's add button. Both entry
points reveal and focus the same form; a blank name keeps the form open, failed
creation retains the draft for retry, and Escape cancels it. Creation switches
to the new branch from the current HEAD. The branch picker preserves search-field
editing keys. The picker, branch options, and context-menu checkout return focus
unless it has moved elsewhere; branch mutations are disabled while another
repository operation is running. Creating a branch at a selected commit or
reference from its context menu also retains a failed draft for retry.
Recovery history creates a branch at the chosen commit without switching the
current branch or changing working files, and keeps failed names available to
correct and retry.

Resize the sidebar and inspector with their full-height separators, or focus a
separator and use Left/Right (Shift for larger steps), Home, or End. Panel widths
leave room for history and adapt to the window; double-click restores automatic
sizing. Reference sections, working-file lists, and the terminal also have
resizable separators. Cancelling a drag or leaving the window releases resizing
and restores normal text selection.

Right-click repository tabs, references, commits, worktrees, submodules, or files
for their available actions. Menus stay inside the viewport, replace any previous
action menu, and support keyboard navigation. Escape dismisses a menu and returns
focus to its target; pressing outside dismisses it, including on disabled controls.
Editing keys remain available in menu text fields.

Resize graph columns from the right edge of each heading, or focus its separator
and use Left/Right (Shift for larger steps), Home, or End. Drag a heading onto
another to reorder the columns; it lands on the side you dragged towards. Every
column, including Date / Time and the last visible column, keeps its left edge
fixed while its right edge moves (Left narrows it, Right widens it).
By default, resizing preserves the
other columns' widths and wide layouts scroll horizontally. Turn off **Configure graph
columns → Horizontal Scrolling** (saved for the whole app) to keep the columns inside the
panel instead: widening a column uses free space, then narrows only columns to its
right (nearest first), down to their minimum widths. Once that space is exhausted,
the right edge stops; columns to its left never give up width. This also applies
to keyboard resizing and fitting branch paths. Dragging back within the same drag restores
them, and narrowing the window narrows the columns. Columns never overlap: none is pinned, so every heading and
cell keeps its own track and scrolls with the history, and a resized edge is
scrolled into view. Narrowing a manually sized last column can leave free space
after it instead of moving its left edge. The settings button stays at the
panel edge independently of column widths. Date / Time shows the
full date with its year and a 24-hour time, and never narrows below the width those
need. Widths are saved per repository. Double-click a separator
to reset it (the Graph separator fits branch paths), or use **Configure graph
columns → Restore graph defaults** to restore the automatic layout. A heading too
narrow for its title shows an icon instead (hover it for the full title). The settings
button is not a commit column.

Continuing graph lanes stay vertical when neighboring lanes end. New branches
reuse vacant lanes rather than shifting existing paths left and right.
Adjacent cross-lane parent links leave the avatar's bottom center before
turning into the parent avatar's side.

Copilot checkpoint references are hidden from the graph by default, without
deleting them. To include their history for the current open repository, turn
on **Configure graph columns → Show Copilot checkpoints**. Click or right-click
a checkpoint to delete its individual reference after reviewing the warning.
Deleting a checkpoint can affect Copilot's ability to recover a session.

Remote-tracking references are refreshed automatically every five minutes while
the desktop app is open. The active repository is also checked when the window
regains focus or the machine comes back online. Change the interval—or turn the
feature off—in **Preferences → Remote updates**. This background operation first
uses a per-remote dry run and runs a resource-bounded `git fetch --all --prune`
only when advertised references changed. It never pulls, moves the current
branch, or changes working files.

For explicit scope, use **Pull options → Fetch branches with options…** (also in
the command palette). Choose one remote or all configured remotes; pruning is
off by default. This separate branch-only action uses the remote's fetch URL
and standard `refs/heads/*` → `refs/remotes/<remote>/*` mapping, ignores custom
fetch/mirror refspecs, and neither downloads nor prunes local tags. Pruning
removes cached branch references absent on the selected server(s), not branches
on the server. Local branches, index, working files and other remote namespaces
are untouched. Overlapping remote names and another remote's potentially shared
custom tracking destinations are refused before updates. Symbolic tracking
destinations are checked to protect local branch references.
Scoped fetching currently requires Git's file-based reference storage; other
storage formats are refused with local-Git guidance.
In a shallow repository the same dialog shows **History depth**: keep the
current depth, deepen by a number of commits, or download complete history from
one selected remote. Branches first fetched while deepening may themselves be
shallow. A cancelled clone can leave a partial destination folder; the error
names it, and Git Khronos never deletes it automatically.
Submodules are cloned only when **Include submodules** is checked: Git then
clones every submodule, including nested ones, and marks all submodules active
(`submodule.active=.`) so ones added later are also initialized. A shallow
clone does not shorten submodule history. If only a submodule fails, the error
says the repository itself was cloned and names its folder; open it and retry
from the **Submodules** menu. Without the option, initialize each submodule you
need from that menu (**Initialize**).

Opening a bare repository's own folder browses it read-only: history, commit
details, branches, tags and remotes are shown, while the working directory,
staging, commits, stashes, pull and checkout are unavailable (a **Bare
repository** note replaces the working directory entry). Git commands for that
repository receive an explicit `GIT_DIR`, so a configured
`safe.bareRepository=explicit` policy keeps working without being changed.
A folder inside bare repository data, Git's internal `.git` folder, a repository
whose format the installed Git does not support, or a folder owned by another
user is refused with an explanation and next steps; nothing is changed. Empty
repositories (unborn branch) and detached HEAD open normally.

**Worktrees → Worktree actions → Review registrations and prune report…**
reads the complete NUL-delimited registration list and Git's verbose prune
dry-run, with `--expire=now`. It displays locked/prunable reasons and preserves
literal paths. This more aggressive expiry policy can identify entries that
normal age-based pruning would retain. The observations are sequential, not an
atomic snapshot or deletion lease. Reviewing removes or repairs nothing. An empty dry-run report does not prove every link is
healthy; repair externally moved directories and reconnect or lock offline
storage instead of deleting their metadata. Unsupported output and review
limits produce explicit errors.

A missing, unlocked linked registration offers **Remove with recovery…**. After
explicit confirmation, Git Khronos rechecks the reviewed HEAD/branch, that the
directory is still absent and that the exact administrative directory is
identified by an absolute link. It protects HEAD and any worktree-specific
references under `refs/git-khronos/recovery/`, then copies the administrative
index, reflog and per-worktree files to `git-khronos-worktree-registrations/`
in the common Git directory. After a final recheck of every registration and the
metadata, it runs `git worktree remove` without force for that path only, never
the global prune. It then verifies that other registrations and
branch/tag/remote references are unchanged. Main, bare, locked, existing,
stale, relative-link and reftable registrations are refused. Branches are never
deleted; uncommitted files in a disconnected directory cannot be recovered, and
reflog entries beyond HEAD are copied but not protected from garbage collection.
All-remotes fetching is sequential: failure or cancellation can leave earlier
remotes updated, and the graph refreshes to show actual state.
Ordinary **Fetch All**, keyboard/background fetch and pull retain Git's configured
refspec semantics; configured tag refspecs or tag-pruning settings may affect tags
there. The scoped options do not change those settings.

**Worktrees → Worktree actions → Move linked worktree…** reviews the source,
branch/HEAD and destination before moving a linked directory through Git.
Staged, unstaged, untracked and ignored files move with it; no branch is deleted.
The action refuses current, locked, missing or open worktrees, changed branch/HEAD,
existing destinations and moves inside the source. Close its repository tab
first. Git also refuses worktrees containing submodules and unsupported
filesystem moves. No forced move or automatic rollback is attempted; failures
retain the dialog's destination and refresh actual repository state.
External Git/filesystem processes are not locked out.

If a linked directory was moved outside Git, use **Repair after external move…**
on its registered entry and select its actual directory. The old path must be
missing; bounded ordinary `.git`/registration links must prove it is the selected
worktree in this repository. HEAD/branch must still match. The workflow changes
Git links, not working files or branches, and verifies the resulting registration.
It refuses open old/actual tabs, locked entries, copies with an existing source,
symlink directories, submodule index entries, relative registration backlinks,
and other registrations whose links need repair. These cases require local Git.
This prevents Git's repair command from silently repairing other broken links
alongside the selected worktree. No registration is pruned and no rollback is
promised. Broader lifecycle workflows remain unfinished.

The **Submodules** pane is visible by default. Use **Manage submodules** there,
or search for **Manage Submodules** / **Add Submodule** in the command palette,
to reach the complete workflow without opening an individual row menu. The
management review lists every gitlink and `.gitmodules` declaration; inspecting
it does not change the repository. It explains
unrecorded or undeclared paths, initialization and checkout state, a checked-out
commit that differs from the recorded one, staged gitlink changes (HEAD versus
index), uncommitted or untracked files inside, conflicting commit sides, and a
local URL that differs from an absolute declared URL. A configured
`submodule.<name>.ignore` setting does not hide changes in this review. Relative
declared URLs are reported without resolution. Reviews are bounded to 500 paths;
bare repositories are refused.

The manager keeps bulk initialization and remote updating separate. **Initialize
missing** checks out every missing submodule at the commits recorded by the
parent repository, including nested submodules. **Update all from remotes** is
available only when every reviewed submodule is initialized and has no conflict
or local file changes; it follows each configured remote-tracking branch
recursively and can leave parent-repository gitlinks modified for explicit
review and commit. Both network-capable operations require confirmation.

Each declared submodule also shows the branch followed by remote updates.
**Change tracking branch…** can use the remote's default branch, mirror the
parent repository's current branch name, or store a specific branch name.
The change is written to `.gitmodules` for review and an explicit commit; it
does not fetch or move the submodule checkout. Stale reviews and invalid branch
names are refused, and Git Khronos verifies that no other declaration changed.

When an initialized submodule's local URL differs from `.gitmodules` (or the
declaration is relative), **Sync local URL from .gitmodules…** confirms the
declared and current values, then runs `git submodule sync` for that path only
(not recursively). The repository and its review must still match. Afterwards
Git Khronos verifies that only `submodule.<name>.url` and, inside a checked-out
submodule, one default-remote URL changed, and reports both previous values so
they can be restored with `git config`. Committed files and the index are not
changed.

When a clean, checked-out submodule sits on a different commit than the one
recorded in the parent index, **Check out recorded commit…** detaches it at the
recorded commit with `git submodule update --no-fetch --checkout` for that path
only. It never fetches, overrides a configured merge/rebase/none update mode,
and refuses tracked changes, conflicts, stale reviews and unavailable commits.
The previous submodule commit is kept under `refs/git-khronos/recovery/` inside
the submodule; branches, untracked files and the parent index are unchanged.
The optional nested mode then applies the same protected checkout to every
initialized nested submodule (up to 8 levels), reporting each moved commit,
recovery reference and skipped entry (for example, not initialized). Edits at
any depth are refused before anything changes; drift that is only nested
recorded commits is allowed. It never initializes or fetches and promises no
rollback.

**Deinitialize…** is offered only for a declared submodule that is checked out
at its recorded commit with no edits or untracked files at any depth. It runs
`git submodule deinit` without `--force`, so Git refuses anything that would be
lost. The checked-out files and the whole local `submodule.<name>` section are
removed; the submodule's repository data under `.git/modules`, its branches,
the gitlink and `.gitmodules` stay, and an embedded `.git` directory is first
moved there by Git. The removed settings are reported for manual restoration.

**Remove from project…** stages, but does not commit, the deletion of a declared
submodule's gitlink and its `.gitmodules` declaration with `git rm` (no force).
It requires no staged gitlink change, no unstaged `.gitmodules` edits, and a
checked-out submodule that is clean at its recorded commit; uninitialized ones
qualify. Other staged changes, other declarations, the submodule repository data
and its local settings are kept and verified.

**Preferences → Git Features → Manage tracking patterns…** lists Git LFS rules
with their source, tracking/exclusion and lockable status. This requires Git LFS
with `track --json` support. Nested, external and exclusion rules are read-only
here; the list is not an effective-attribute report for individual files.
**Review removal…** shows root `.gitattributes` before removing a root tracking
rule. HEAD, branch, staged attributes and working attributes must still match
the review. Conflicted, symlink, non-text, oversized or excessively long-line
attributes are refused, as are macro definitions, expanded/quoted rules that
cannot be matched directly, and ambiguous attribute substrings. Git LFS may normalize root line endings and removes
other attributes on the matching LFS rule lines, so inspect the resulting diff
and commit `.gitattributes` separately. Other rule sources, the staged index,
tracked file contents and history are unchanged; existing pointers and LFS
objects are not converted or deleted, nor are lockable file permissions restored.
Configured hooks are protected by a command-local private hook directory, rather
than letting pattern commands install hooks in a shared user hook directory.
Git LFS may initialize its repository-local format metadata. External processes
are not excluded and no rollback is promised.

Real Git LFS fixtures are opt-in because LFS is an optional system tool. With a
JSON-capable `git-lfs` on `PATH`, run
`cargo test -p git-khronos-git-core lfs_tracking -- --include-ignored`.
The regular native suite explicitly reports these fixtures as ignored when
they are not selected; renderer journeys use mocked IPC, not packaged Tauri.

Expand **File locks on the LFS server** in the same dialog to coordinate edits
to files that cannot be merged. **Load locks** contacts the configured LFS
endpoint only when chosen and lists each lock's path, owner and time, marking
your own. Lock a tracked file by its repository-relative path; untracked or
missing paths, existing locks and unconfirmed server replies are refused.
**Unlock** is offered for your own locks and keeps the lock while the file has
uncommitted changes. Collaborators' locks need **Force unlock…**, which warns
that breaking their lock can lead to conflicting binary edits. Unlock and force
unlock recheck the server list first and refuse if the lock changed. Servers
without locking support, unreachable endpoints and refusals are reported with
their reason; files, the index and references are not changed. Real lock
fixtures use a local test server:
`cargo test -p git-khronos-git-core lfs_locks -- --include-ignored`.

The same dialog's **Inspect effective file attributes** accepts one literal
repository-relative path and works even without Git LFS. It compares `filter`,
`diff`, `merge`, `text` and `lockable` in Git's working and `--cached` index views.
Git resolves macro, nested, `.git/info/attributes`, global and system precedence.
Working view can fall back to staged attributes when a working attribute file
is missing; index view ignores working attribute files but still includes
external attribute sources. Missing, untracked and sparse-excluded paths can be
queried without hydration or staging. The query does not assert that a file
exists, that LFS is installed, or that its contents are pointers/hydrated objects.
Views are sequential observations, not a transactional snapshot; inspect again
after edits. Values are Git's raw `set`, `unset`, `unspecified` or custom strings
(literal attribute values can use those same words). Invalid/traversing/metadata
paths, unsupported encoding, truncated or malformed output produce explicit
errors. Changing the path clears old results; reopening resets the path.
The on-demand panel is lazy-loaded; loading can be cancelled and failed loads
offer an explicit close/restart route. Renderer tests disable Angular HMR so
deferred chunk loading and failures are actually exercised, rather than using
HMR's eagerly imported component definitions.

Expand **Local LFS object diagnostics → Inspect local objects** in the same
dialog to scan Git LFS's current index/HEAD pointer scope. Index paths take
precedence, but deleted index paths can still appear from HEAD. Untracked files,
all-history objects and zero-size objects are not covered. The bounded complete
list (up to 2000 paths / 2 MiB JSON) shows object IDs, byte sizes, Git LFS's cache
and working-size flags, and a bounded working-file inspection. Canonical pointers
are distinguished from missing paths, symlinks, pointer-like content and matching/
differing content sizes. Matching size is **not** hash verification or proof of
hydration: modified/corrupt same-sized contents can match. Configured LFS storage
is respected through Git LFS, not guessed by the app.
The diagnostic does not download, hydrate, prune or repair anything; it retains
sparse exclusion and the index. Missing-cache feedback explains remote/credential/
object-availability checks and retry without promising recovery. Filesystem/Git
state can change externally during the sequential scan. Unsupported JSON/version/
hash/path values and filesystem read failures are explicit errors, not empty
successes. Real object fixtures require `git-lfs` on `PATH`; run
`cargo test -p git-khronos-git-core lfs_objects -- --include-ignored`.

After scanning, choose a **Remote for selective fetch** and **Review fetch…**
on one file. Review its path, committed HEAD, SHA-256 object ID and size, then
**Fetch reviewed object**. Only the object matching that path in committed HEAD
is eligible; staged-only or different staged objects are refused.
The selected remote's effective LFS endpoint and configured storage are used.
HEAD and a fingerprint of effective Git/LFS settings are rechecked before transfer.
Command-local overrides disable remote autodetection/fallback, prevent
recent/history fetching and isolate the root-anchored single-file include filter
from configured includes/excludes.
Names containing commas, wildcard syntax, backslashes or exclamation marks are
refused rather than widening scope; use local Git LFS for those names.
This downloads into the local cache without hydrating files, modifying the index,
pruning objects or updating Git references. **Cancel transfer** uses the existing
Git operation cancellation and authentication bridge. Failures/cancellation can
retain downloaded or partial cache data; inspect and review again before retrying.
Successful fetch checks local availability by size, not hash integrity, and
refreshes diagnostics. External edits remain possible; review is not a filesystem
transaction. Real fixtures with local bare remotes require Git LFS:
`cargo test -p git-khronos-git-core lfs_fetch -- --include-ignored`.
Live HTTPS/SSH LFS endpoints and packaged-native acceptance remain unqualified.

For an existing canonical pointer with an available local object, choose
**Review hydration… → Hydrate reviewed file**. Hydration is separate from fetch:
it copies the selected cached object to an exclusively created temporary file,
checks its SHA-256 and size through Git LFS, then replaces the unchanged pointer.
The pointer must exactly match one ordinary, unconflicted, included stage-zero
index entry, with `filter=lfs` in both working and index attribute views.
Unlike fetch filtering, hydration uses literal paths, including wildcard-looking
names. Modified, missing, already hydrated, symlink, sparse-excluded and
assume-unchanged entries are refused; extended/noncanonical pointers are not
supported here.
HEAD, branch, complete index checksum, pointer permissions, attributes and
effective LFS settings are leased and rechecked before replacement.
Configured storage comes from the supported `LocalMediaDir` reported by
`git lfs env`; unsupported output and symlink cache paths fail explicitly.
No LFS download, staging, pruning, lock/unlock or reference update runs.
Permissions are preserved, including existing lockable read-only state.
The complete object needs additional temporary disk space. **Cancel hydration**
cleans the owned temporary copy before replacement; a late cancellation or final
check failure may occur after replacement, so refresh and inspect the file.
External filesystem edits can still race checks; no transactional guarantee or
automatic rollback is claimed. The ordinary diagnostic scan remains size-only,
even after a particular hydration verified its copied contents.
Actual hydration fixtures are opt-in:
`cargo test -p git-khronos-git-core lfs_checkout -- --include-ignored`.
Packaged and cross-platform native acceptance remain unqualified.

**Clean LFS storage** reviews an exact list of local LFS objects that no Git
object references, with their sizes, before anything is removed. Git Khronos
reads every Git object in the object database, including unreachable objects and
alternates, so branches, tags, stashes, reflogs, every worktree index and dangling
blobs all protect their LFS content. Objects written in the last hour are kept so
an in-progress `git add` cannot lose its content. Storage outside the repository's
Git directory (possibly shared), shallow history and partial clones are refused
because unreferenced objects cannot be proven there. Removal re-scans and requires
every reviewed object to still be an unreferenced candidate with the same size;
otherwise nothing is removed. At most 5,000 objects are reviewed per batch.
Removed local copies have no offline undo. Fixtures are opt-in:
`cargo test -p git-khronos-git-core lfs_prune -- --include-ignored`.

The older `git lfs prune` delegation remains as an advanced action inside the same
dialog. It follows retention and fetch-exclude settings, removes historical objects
without an exact preview or remote verification, and reflogs do not protect them.
Local Git LFS 3.7.1 qualification exposed incomplete verbose candidate output and a
local-file remote verification result that did not prove the remote copy existed,
so those reports are not used as a deletion lease.

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
repaints only the rows that changed. Each recycled row also has isolated change
detection, so scrolling checks only the newly rebound rows rather than reevaluating
every visible row's SVG paths, references, and metadata. Mouse-wheel input is
accumulated per frame, and destination rows are rendered before the scroll offset
moves, preventing asynchronous scrolling from exposing an empty virtual window.
That synchronous render is confined to the history viewport, not the sidebar or
working-tree panels. Mouse-driven ancestry and ghost-branch previews stay stable
while scrolling and resume on the row under the pointer after 120 ms of quiet;
reference-stack hover expansion is deferred too, without delaying keyboard focus
or explicit clicks.
Wheel distance is preserved, including line/page deltas; zoom and Shift-wheel
gestures retain their native handling. Each loaded history page only lays out, dates,
and indexes its own commits. Older history pages are read in-process with
gitoxide (`gix`) instead of starting a Git process per page; repositories gitoxide
cannot open fall back to the Git CLI. Staging, unstaging, and discarding update
the change lists immediately, run Git away from the window event loop, and then
reconcile with a status-only refresh instead of reloading history and
references. These safeguards keep very large repositories responsive.
Closing a repository invalidates pending history pages and their errors; reopening
the same path cannot receive results from the closed session. Switching tabs
keeps an open repository's pending page valid.
New text files support selected-line staging without staging their remaining
contents or changing the working file, including before the first commit.
Selected index edits use the displayed diff as a native expected-state check;
changed previews fail visibly and **Reload diff** clears the selection for review.
Truncated or non-UTF-8 text previews cannot be partially staged. Binary files and
symbolic-link targets use whole-file actions; Git attributes and executable-mode
policy remain effective. Unstaging a partially staged new file also works in an
unborn repository without removing its working copy.
Push completion applies refreshed branch tips, divergence counts, and commit
decorations together. Unchanged commit SHAs do not suppress reference updates,
and pre-push background snapshots cannot overwrite the completed push state.
Graph lane geometry is reused when only decorations move; no follow-up fetch or
status poll is required to place the remote reference at the pushed commit.

**Working directory options** offers **Discard all unstaged** and an opt-in
**Select files for discard** mode. A native preview includes files beyond the loaded
status page and expands untracked folders. Conflicts, submodule working trees,
and nested repositories are excluded; staged contents and ignored files are
preserved. Changed files or index contents invalidate the preview.
File, hunk, selected-line and bulk discards save binary-capable recovery patches in the worktree's Git
directory before changing files. **Recover discarded** discovers these captures
after restart and offers checked recovery, repeat discard, and explicit capture
removal. Captures are retained until explicitly removed; they can contain
sensitive working-file contents and consume disk space. Recovery refuses
conflicting edits rather than overwriting them. Filesystem failures can leave
partial effects, so failed discards retain their captures for inspection.

**Reset to this commit** previews the complete native index/worktree scope before
moving history. Soft, mixed and hard resets first protect the original HEAD and,
when needed, save a non-destructive snapshot of tracked staged/unstaged contents.
Assume-unchanged index flags and unresolved index conflicts must be cleared
before a complete capture can be made.
Changed HEAD, branch, index or working state invalidates the preview. Hard reset
refuses untracked/ignored obstructions and initialized submodule removal; it does
not recurse into submodule working trees.
**Delete branch**, **Remove worktree and delete branch** and **Delete stash**
also create a capture before Git removes the reference: the branch tip, or the
stash commit with its base, index, working and untracked parts. When Git refuses
the deletion and the reference is unchanged, the unused capture is removed.
**Recovery History → Saved operation captures** discovers these per-worktree records
after restart. Restore creates and switches to an explicitly named new branch at
the original HEAD and restores the saved index and tracked working contents.
The current repository must be clean, and ignored-file collisions are refused.
Captures remain protected until explicit removal, even after restoration; they
can contain sensitive file contents and consume disk space. Untracked, ignored
and submodule working contents are not captured. Internal snapshot commits and
reference decorations are excluded from ordinary history and default search.
Git/filesystem operations are not atomic against external Git processes or
filesystem failures: an error can leave partial effects, and retained captures
are recovery data rather than a promise of automatic rollback. These checkpoints
currently cover reset; broader destructive-operation capture is still in progress.

**Preview merge conflicts** is available from a local branch's context menu and
from the Command Palette. Choose the source branch and the target it would merge
into, then request the preview explicitly. The branch context menu defaults to
merging the selected branch into the current checkout, matching the merge action.
The command palette defaults to the current branch as source. The result lists the exact commit IDs
and conflicted paths; Git can also report conflicts without individual path
records. Changed or deleted references invalidate the visible result.
HEAD, index, references, working files and the repository's object database stay
unchanged: merge objects are generated in a private temporary bare repository
and removed afterward. Cancellation or closing the dialog discards pending
results. Switching repositories closes and cancels the preview.

This feature requires Git 2.43 or newer for explicit committed-attribute lookup.
It compares committed local or remote-tracking tips, without fetching. It
excludes uncommitted edits and uses default Git merge settings with committed
attributes, without copying repository-specific merge options or external
attributes. Shallow/partial clones, configured custom merge drivers and
replacement references are refused. A clean preview is an observation for the
displayed commits, not a promise that a later merge or custom strategy succeeds.

The conflict editor identifies Current/Incoming index stages and explains their
rebase meanings. Accepting a deleted side is distinct from saving an empty file.
Resolution checks the reviewed branch, index-stage objects and working contents;
stale failures retain unsaved editor output and offer **Reload conflict**.
Reload replaces editor output with the latest working contents.
Text saves refuse binary/non-UTF-8, truncated, symlink and gitlink conflicts.
Edited output is written to a synced temporary file before replacing the working
file; a staging failure explicitly reports that the file was saved but remains
unresolved. Complete-side actions preserve binary bytes and symlink types.
Submodule gitlink conflicts can be resolved by selecting the reviewed Current or
Incoming commit. Only the parent repository's gitlink is staged; the submodule
checkout and local changes inside it are left untouched. Configured external-tool
handoff remains unfinished.
These checks do not lock out external Git processes or promise transactional
resolution against filesystem failures.

**Working directory options → Stash with options** saves selected files,
optionally includes untracked files, keeps staged contents in place, or saves
only staged changes (Git 2.35+). Ignored files are never included. The standard
Stash shortcut still saves all changes, including untracked files. Stash actions
can restore the original staged state or create a clean recovery branch at the
stash's original base; these new restore workflows keep the stash even after
success. **Stash changes and checkout** is an explicit local-branch action:
changes stay saved in the stash and are not silently applied to the destination.
Conflicts or overlapping staged-only edits are reported rather than dropped.

Tag menus distinguish local deletion, signature verification, selected-tag
push, and remote deletion. A local deletion first preserves the tag object in
`refs/git-khronos/recovery`; selected transport never automatically includes
other tags. Remote deletion uses an exact expected-object lease and refuses a
reference that moved. The selected remote's **push URL**, not its fetch URL,
defines the destination; multiple push URLs are refused for these actions.
**Edit Remote → Advanced** edits a separate push URL or clears it to follow the
fetch URL. These actions do not change another remote or the working files.
Signed annotated tags use Git's configured signer; signing and verification
failures remain visible. A failed signed-tag creation retains the entered
annotation and signing selection for explicit retry; it never falls back to
an unsigned tag. Verification follows Git's configured policy and does not
install trust entries or certify a signer's identity.
Native fixtures qualify real SSH tag signing, trust/revocation and tamper
refusal, existing-tag protection and recovery of the complete signed object.
The optional isolated OpenPGP/X.509 signing selector above also qualifies tag
creation, verification, unavailable-key refusal and corrected-signer retry.
X.509 tag qualification has the same strictly offline certificate limits.

**Pull options** applies the chosen integration mode explicitly for that
operation, even when Git's configured rebase/fast-forward defaults disagree.
**Fast-forward if possible** fast-forwards or merges without replaying local
commits; **Fast-forward only** stops on divergence; **Rebase** replays local
commits. One-off choices do not change the saved app default or Git settings.
Other configured Git policies, including hooks, signing and autostash, still
apply.

A failed pull may already have fetched new remote-tracking tips. The workspace
refreshes actual state and exposes the active merge/rebase with Continue and
Abort; conflicting files must be resolved before continuing. Recognized
divergence, missing-upstream and local-change refusals provide relevant guidance
without automatically retrying, discarding edits or choosing another branch.
Review and explicitly commit/stash local work before retrying an obstructed
pull. A gone upstream stays configured until you intentionally change it.
Native fixtures qualify opposing configuration, divergent/fast-forward histories,
conflict aborts, staged/unstaged preservation, deleted upstreams, removed remotes
and occupied worktree branch protections. Renderer acceptance uses mocked IPC;
live transport and packaged-platform acceptance remain.

The interactive rebase editor supports **Fixup** (or `F` for the selected row)
alongside Pick, Reword, Edit, Squash and Drop. Fixup combines the changes into the
preceding retained commit and keeps that commit's message; Squash combines
messages too. Dropped rows cannot receive combined changes. Removing or moving
the recipient disables Start until you explicitly correct the plan; reordering
never silently changes a combination into Pick.
Reordering does not require dragging: use each row's Move up/down buttons, or
focus the row and press **Alt+Up/Down**. Focus follows the moved commit and the
new position is announced without changing actions or reword drafts.
Normal text-editing arrow keys remain available in the message field.
Plans are repository-bound: switching repositories closes the editor, stale
execution is refused, and a late preparation cannot reopen it after switching
away and back.
Preparation refuses active merge/cherry-pick/revert/bisect operations and source
branches occupied by another worktree, including locked or missing registrations.
Only complete plans of at most 500 commits and 2 MiB of serialized metadata are
offered; each message is limited to 256,000 bytes. Unsupported text encoding or
incomplete metadata is refused rather than replaced or silently omitted.
Commit-message whitespace and embedded record/field control characters are
preserved. These checks run again before execution, before recovery or support
files are written.
Preparation reads explicit local-branch references, and replay uses an explicit
local-branch target, so tags sharing those names cannot redirect the plan.
For a commit on the current local branch, choose **Edit history from this
commit…**. A consecutive multi-selection offers **Edit selected range…**.
The review includes the selected starting commit **and every later descendant
through HEAD**, even when the selection ends earlier. It retains the original
parent as the base and labels selected versus later rows before Start.
Nonconsecutive selections, commits outside the current branch, root/shallow
boundaries and merge-containing suffixes refuse without rewriting a prefix.
Recorded remote-reachable rows are identified from local remote-tracking
references only; **Publication unknown** is not proof that a commit is unpublished.
The review does not fetch or query remote servers. Coordinate before rewriting
shared history. Selected-range editing does not move unrelated branches, tags
or remote-tracking refs, even with automatic ref updates configured.
In selected-history review, **Replay destination** defaults to keeping that
original parent base. Explicitly choose an available branch-tip commit to replay
the same complete suffix elsewhere using `--onto`. The review captures and shows
the full destination ID; later movement of its branch does not replace it.
The original boundary still determines the replayed changes, while the chosen
commit becomes their new parent. The destination reference remains untouched.
Destinations inside the reviewed suffix or missing/non-commit objects refuse
before recovery/setup writes. Different destination contents can cause conflicts
or newly empty steps: resolve/Continue, explicitly Skip, or Abort. This option
does not combine with root mode; merge-preserving replay remains separate.
Originally empty commits remain in the reviewed history, including explicit
Reword. Assume-unchanged index entries are refused rather than hiding local edits.
On the current local branch's actions menu, **Edit entire history, including
root…** reviews all reachable commits from the actual root through HEAD.
There is **no unchanged parent base**: the root itself is editable, and all
reviewed commits may be rewritten. Retain at least one commit; dropping every
row is refused before recovery/setup writes. Only complete linear history is
accepted; shallow and merge-containing histories require another workflow.
The same 500-commit/2 MiB limits and fresh execution preflight apply.
Other branches, tags and remote-tracking refs remain unchanged even with
automatic ref updates configured. Hooks and signing remain enabled.
Root Edit supports explicit amendment/Continue/Abort, but guided splitting
requires a stopped commit with a parent and is unavailable for roots.
For a local destination branch, **Rebase preserving merges…** opens a separate
complete topology review of the current branch. It supports ordinary commits
and two-parent merges, using Git's generated `label`/`reset`/`merge` instructions
with `--rebase-merges=no-rebase-cousins`. Side histories outside the common-base
ancestry retain their original branch points. Source/destination tips and every
original parent are shown; either tip changing requires a new review.
The original tip is protected, unrelated refs stay unchanged, and hooks/signing
remain enabled. **Previous manual merge resolutions are not automatically
preserved**: resolve recreated conflicts again, then Continue, Skip or Abort.
Final merge contents and signatures may differ. Shallow, octopus, root,
ambiguous-base and oversized histories refuse before execution. This distinct
workflow does not offer row editing, guided splitting or autosquash.
The rebase editor is loaded only when requested. Loading and failed imports have
focused Cancel/Close controls and keyboard escape; cancelling prevents a late
import from reopening the editor. The loaded editor contains keyboard focus,
preserves the prepared message drafts and uses the same explicit action handlers.
**Edit** (or `E` for the selected row) pauses after replaying that commit.
The status distinguishes this intentional stop from a conflict. Edit and stage
the changes, enable **Amend previous**, review the message, and submit the
amendment before **Continue**. Continue unchanged is also available on a clean
tracked working tree. Continue refuses uncommitted tracked changes at an Edit
stop instead of letting Git automatically create an extra commit. Hooks and
configured signing still apply; failures retain the staged changes for explicit
retry. Later Edit/Reword steps retain their support files across pauses.
**Abort** restores the original source branch; its recovery reference remains.
At a clean **Edit** stop, **Split this commit…** opens a separate confirmation.
It saves the original history and stopped commit, moves detached HEAD to that
commit's parent, and keeps its changes unstaged. Added files become untracked.
Stage selected files, hunks or lines, then create at least two separate ordinary
commits with reviewed messages. Amend is unavailable because it would rewrite
the parent; unchanged-tree permission must be disabled. Each new part uses the
current commit identity and signing policy, with existing explicit author
overrides available; original authors and signatures are not automatically copied.
**Continue** requires a clean complete working tree and the exact combined tree
of the original stopped commit. **Skip** cannot bypass an active split.
The worktree-local bounded split journal survives restart; uncertain interrupted
resets require Abort rather than automatically repeating reset or committing.
If Abort refuses a split-created untracked-file obstruction, review and stage
only those files, or move them safely outside the repository, then retry.
Unrelated untracked files are not deleted and no force-reset is attempted.
Empty commits have no changes to split; use Reword or Continue unchanged.
This guided split intentionally preserves the original combined contents.
Amend instead when the desired workflow changes the stopped commit's final tree.
**Preview autosquash** explicitly matches `fixup!`/`squash!` subjects to an earlier
unique exact subject, full commit ID or unique ID prefix (at least four hex
characters). It moves matching rows after their recipient in stable order and
sets Fixup/Squash; you must review the result and press Start Rebase separately.
Reset restores the original order/actions. Nested marker targets resolve to the
same retained recipient. Ambiguous/unmatched targets refuse the entire preview
without changing rows, and existing manual actions are never overwritten.
Partial subject matching and `amend!` message replacement are not supported;
use explicit row actions for those cases.
Before any interactive rebase checkout, the complete action/message plan is
validated and the original source tip is preserved under
`refs/git-khronos/recovery`. If preserving that tip fails, execution stops.
The reference protects committed history, not arbitrary filesystem/hook effects
or remote updates. Existing Continue/Skip/Abort handle interrupted execution.
The row editor remains a linear local-branch workflow; merge preservation uses
the separate topology review described above. Whole-history editing can also
choose a Replay destination (`git rebase -i --root --onto`): the first replayed
commit gains that captured commit as its parent, destinations inside the
reviewed history are refused and the destination reference never moves. Broader
autosquash variants and packaged/platform acceptance remain unfinished.

Cherry-pick and revert confirmations for a **single merge commit** require an
explicit 1-based mainline parent. Cherry-pick applies the merge difference
relative to that parent as a new single-parent commit; revert reverses that
difference while retaining the original merge in history. Parent 1 is never
selected automatically. Reverting a merge can also affect what later merges
bring in, since the original ancestry remains.
Merge replay requires a clean working tree and no active operation, and saves
the original destination tip under `refs/git-khronos/recovery` before execution.
Invalid/missing parents and mixed selections containing merges are refused
before any replay. Hook failures preserve the reviewed choice, but may leave
applied changes staged. Close the confirmation to review them: Continue/Abort
an active operation, or explicitly commit/restore the original tip when Git
has ended the operation. Retry replay only after recovery. Conflicts use the
existing Continue/Skip/Abort controls after closing the confirmation.
Context-menu, inspector and branch-drop actions share this review.
The shared cherry-pick, revert and reset review loads on demand. Its loading and
failure views keep a keyboard-accessible escape; closing or switching repositories
cannot reopen a delayed review or execute its captured action. Reset previews
remain read-only until the explicit confirmation.
**Apply changes without creating commits** is an explicit cherry-pick option for
1-500 selected commits. It combines changes in the selected order in the index
and working tree without moving HEAD. A single merge still requires its reviewed
mainline parent. Clean complete status and no active Git operation are required;
assume-unchanged entries are refused rather than hiding local edits.
The original destination tip is saved before any application.

No-commit conflicts use a bounded, worktree-local application journal, not a
fabricated Git marker. Resolve and stage, then **Continue** applies the remaining
rows without creating a commit, even after restarting. Commit is unavailable
while the sequence is active. **Abort** uses Git's merge reset to the original
tip; overlapping later unstaged edits can refuse the reset and remain intact.
**Finish manually** ends only the application sequence, leaving files, staged
changes and unresolved conflicts untouched. Skip is intentionally unavailable.
An uncertain interrupted step is not silently repeated or treated as complete.
After successful application, explicitly commit the staged result with your own
message and current identity; original author metadata is not retained
automatically. Normal hooks and configured signing run at that later commit,
not while applying. Empty effects create no commit and are reported as such.
Recovery protects committed history, not arbitrary hook, untracked, ignored or
submodule working contents.

Select multiple ordinary graph commits and choose **Revert N commits** to review
their newest-to-oldest inverse order. Git receives exactly the reviewed list,
without revision traversal or date reordering, and creates one inverse commit
per successful step while retaining original history. The selection is bounded
to 500 distinct full commit IDs; all objects and parents, clean complete status,
visible index entries and original-tip recovery are checked before any prefix.
Merge commits must be reverted individually with an explicit mainline parent.

Conflicts pause Git's native sequence. Resolve and stage, then **Continue**;
**Skip** omits the current step, including an empty inverse, and **Abort**
restores the original sequence tip, including earlier successful inverse commits.
The saved sequence is detected after restarting even when a failed hook leaves
staged inverse changes without `REVERT_HEAD`. In that state, review and explicitly
commit the completed inverse step, then Continue, or Abort; do not replay the
entire list again. Hooks and configured signing remain Git's responsibility.
No-commit revert is not supported.

### Diff patch exchange

Open **Preferences → Git Features → Patch exchange** to save tracked staged
or unstaged diffs, including binary changes. Choose all tracked changes or
individual files. New untracked files are excluded; stage them first.
Staged export reads the index, not later working-file edits. Paths are literal;
every selected file must have a complete diff in the chosen scope. Renames
export as deletion/addition; choose all tracked changes for staged renames.
Exports use a new filename outside the repository and its Git directory.
Existing destination files are never overwritten. LFS patches contain pointers,
not cached LFS objects.

For import, choose **Working files only**, **Index only**, or **Index and working
files**, then **Choose and check patch…**. Git checks the entire patch before a
separate review of all paths, binary changes, additions/deletions and modes.
Press **Apply reviewed patch** explicitly. Exact source bytes, HEAD, branch and
index are checked again; changing the target invalidates the review.
The repository must be completely clean, including untracked files, with a
committed HEAD, no active operation and no assume-unchanged/skip-worktree entries.
Index-only import leaves working files unchanged, so their difference can appear
to reverse the new staged patch: inspect both views before staging again.
No commit, author, signature, branch, tag or remote reference is imported.

Complete patches and index reviews are bounded to 4 MiB and 2000 distinct patch
paths. Oversized, incomplete, unsafe-path, symlink, submodule, extended rename/
copy and non-UTF-8 path patches refuse rather than applying a prefix.
Executable-mode changes and ordinary file additions/deletions are supported.
Context matching is not relaxed by configured whitespace-ignore settings;
whitespace bytes are retained rather than fixed. No partial-hunk, three-way or
unsafe-path fallback is used. Keep the original patch for recovery and inspect
any failure before retrying: Git's usual all-hunk checks are not a filesystem
transaction against disk failures or external concurrent writes.

### Mail patches (format-patch / am)

Open **Preferences → Git Features → Patch exchange → Mail patches**. Choose how
many consecutive ordinary commits ending at HEAD to export (oldest first; a merge
stops the range), review the exact series, then **Save series…** to a new file.
Configured format-patch settings (signatures, notes, threading, numbering,
headers, mbox quoting, external diff) cannot change the output. Patches carry
author, date, message and binary changes, but not merge commits, signatures,
notes or committer identity; committed secrets travel in plain text.

**Choose series to apply…** reviews every patch's author and subject without
changing anything. **Apply patches** rechecks the exact file, HEAD and branch,
requires a clean tracked state on a local branch and saves the original tip under
`refs/git-khronos/recovery/` before `git am` creates one new commit per patch with
you as committer. Hooks run; no three-way fallback, scissors or rerere update is
used. Conflicts, empty patches or hook refusals pause the series: resolve and
stage, then **Continue**, **Skip this patch** or **Abort** (restores the original
tip). The paused state survives reloads; ordinary commits are refused until
the series is continued, skipped or aborted.
Series are limited to 16 MiB and 500 patches; larger or cover-letter-based series
require local Git.

### Offline Git bundles

Open **Preferences → Git Features → Offline Git bundles**. Export one explicitly
selected local branch with all its reachable committed history. The captured
tip must still match. Save a new file outside the repository and Git metadata;
existing destinations are never overwritten. Committed secrets remain part of
history, so inspect what you share.

**Choose and verify bundle…** checks format and available prerequisite commits,
then shows the complete advertised references and Git's report without importing
objects. Verification is not an authenticity or signature check; only open
trusted files. Git validates the actual object payload during import, not review.
Incremental bundles need their prerequisite commits in the receiving repository.
Choose an advertised branch explicitly, then **Import into new recovery reference**.
Objects are imported and the exact branch commit is protected under
`refs/git-khronos/recovery/`. Use reflog/recovery tools to create a local branch
from that commit afterwards. No checkout or existing branch/tag/tracking-ref,
HEAD, FETCH_HEAD, index or working-file update is requested. Dirty files can stay
in place; active Git operations must finish or abort first. Configured reference
mapping, tag fetching, pruning, submodule recursion and automatic maintenance
cannot expand this command's scope; Git configuration itself remains unchanged.

Complete files are bounded to 16 MiB and 500 distinct advertised references.
Non-UTF-8 references, symlink/special sources, tag-only input and missing
prerequisites refuse. Offline exchange refuses partial/promisor repositories to
prevent implicit network downloads; full-history export also refuses shallow
repositories. Only direct branch commits can be preserved, not annotated
tag objects advertised as branches. Larger bundles, custom revision cutoffs,
bare repositories and tag imports require local Git. Bundles do not carry
uncommitted files, settings, hooks, credentials or LFS cached objects. Original
commit signatures remain object data, but are not automatically verified.
Failures require inspection and a fresh review: downloaded objects can remain
even when recovery-ref creation fails, and a failed export can leave a partial
new destination. Temporary captures are cleaned up; cleanup failures are explicit.
Configured hook effects, outside processes and disk failures are not covered by
a filesystem transaction.

`task test:e2e` runs fast, deterministic renderer journeys against the sample
repository. These tests cover interface behavior but do not replace native
Tauri integration tests for Git, filesystem, terminal, or operating-system
dialogs.

### Workspace overview, identity profiles and hosted reviews

Open the workspace menu (or command palette) and choose **Repository overview**,
**Identity profiles**, or **Reviews and checks**.

- The overview summarizes open repositories in the current workspace. **Refresh
  local state** reads Git status and metadata without fetching. Ahead/behind
  counts use existing tracking refs. Failed reads retain visibly cached state.
- Identity profiles save reusable commit names/emails on this device. **Use…**
  displays the repository path and requires **Apply to this repository** before
  updating local Git settings, which are shared by linked worktrees. Selecting
  a workspace never changes Git identity.
- Reviews and checks loads GitHub data through an independently installed,
  authenticated `gh` CLI using its current account. Choose a fetch remote and
  load explicitly. Pull request inspection shows descriptions, provider patches,
  review events, latest submitted decisions, check runs and legacy commit-status
  contexts for the captured head commit. Lists and detail sections have explicit
  page controls (50 records per page), with open/closed/all list filters. Missing
  permissions are reported independently for each inspection section.
- Hosted submissions can create a pull request (including forks and drafts),
  submit a review comment, approval or change request, and merge with merge,
  squash or rebase. Prepare a preview first and review its account, repositories,
  branches and commit IDs before submitting. The local source branch must already
  match its published remote commit. Editing requires a new preview.
  The provider enforces its permissions and branch rules. A lost reply remains
  unconfirmed; inspect the result and reload current records before preparing
  another request. Stopping the wait does not undo a remote write.

In Preferences, configure terminal profiles using an executable and separate
arguments. New terminal tabs use the chosen default or the system shell. When
profiles exist, **Profiles** in the terminal selects another saved profile for
an explicit launch. Profiles from the former agent launcher remain available as
terminal profiles; migration does not start them or set them as defaults.

See [the capability inventory](docs/clean-room-capabilities.md) for remaining
Git, provider, account-context and collaboration workflow scope.

## Architecture

- `apps/desktop` contains the Angular UI and Tauri application adapter.
- `apps/desktop/src-tauri` contains the narrow native command surface.
- `crates/git-core` owns Git process execution, parsing, and domain types.
- `libs/contracts` contains the frontend TypeScript IPC contracts.

Git itself remains the source of truth. The Rust backend invokes Git directly
with argument arrays—never through a shell—and returns typed, redacted results
to the UI.

## Privacy

Git Khronos has no telemetry, accounts, advertisements, or hosted backend.
Repository information and diagnostics remain on the local machine.

## License

GPL-3.0-only. See [LICENSE](LICENSE).

Third-party component notices are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
