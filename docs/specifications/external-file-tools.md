# Reviewed external editor, comparison and merge programs

Status: implementation candidate. The Rust workspace, focused renderer, frontend unit,
strict Clippy, generated IPC and production-build gates have local evidence. The current
immutable Linux package passes focused native workflows and reviewed normal/compact
screens. The complete current-source renderer suite, broad native and optional-tool
regressions now pass at the scoped checkpoints below.
This document does not claim complete tool or product parity.

## Independent capability

A user can configure a local editor, comparison or merge program; inspect its exact
executable, argument boundaries, repository directory and file roles; and explicitly
launch that reviewed command. Requirements extend the public command semantics and
sources already recorded in [configured tools](configured-tools.md). The implementation,
UI, review authority, private-file format and tests are original project work. No
proprietary binaries, source, assets or interface composition supplied implementation
material. There are no new third-party dependencies or assets.

## Configuration and preparation

Profiles retain payload version 1. Application preference storage moves to version 2
with independent optional defaults for terminal, editor, comparison and merge roles.
Existing valid version-1 terminal/agent data is read without writing or launching;
legacy agent profiles are converted in memory to terminal profiles without
changing the default. Only a subsequent explicit preference change writes the
new envelope. Invalid or unknown data remains preserved until explicit clearing.
Storage commits before live state. The total profile limit remains 16.

Native preparation resolves repository and executable identity. File selection,
repository metadata, exact revisions/index stages and private copy paths are derived
natively. The renderer cannot supply a ready executable plan or file-write authority.
Editor launches open a contained existing regular working file at a one-based line.
Comparison launches use exact fetch-free snapshots. Existing comparison requests retain
their native context, including root commits, staged renames, unborn branches and
untracked stash content; the renderer does not infer missing sides or ancestry.
Missing content remains distinct from an empty file. Symlink comparison content is
link text; symlink working targets are not followed for writes.

The complete literal argument vector is shown before execution, including empty
arguments and shell punctuation. No shell, command-string splitting or implicit
executable search is introduced. An executable explicitly configured as a shell is
still the user's chosen program. Preparation never executes it.

## Draft handoff and command lifetime

An unsaved internal editor offers Save and review, Review saved file while retaining
draft, and Keep editing. Saving must confirm the working copy before handoff. Keeping
a dirty draft requires a confirmed recovery snapshot; failure keeps the editor and
its text visible. The editor remains mounted while the external review is open.
Window-close protection closes the nested panel and exposes the existing draft
review. Historical content stays read-only.

A launch token is context-bound, short-lived and single-use. Native session ownership
is recorded before spawning, so a failed or lost response can be inspected without
replaying the command. Sessions retain the exact reviewed command and request time.
A read-only status refresh can observe progress; it never retries a launch or write.
Closing a panel retires unused reviews and retains launched sessions and their files.

The native owner retains its direct Child handle. Stopping targets only that owned,
unreaped root command. No program-name search, descendant sweep or process-group kill
is used after a GUI handoff. A zero launcher exit proves neither GUI completion nor a
saved result. A separate IDE may continue running. Inherited Git repository selectors,
application askpass bridges and Git/SSH askpass variables are cleared; ordinary user
Git configuration and SSH agent context remain available.

## Private files, save, stage and cleanup

Linux private sessions are created beneath native application data, with random
identifiers, owner-only directories and directory-relative no-follow access. Inputs
are read-only copies; merge output is writable. Each role is limited to 8 MiB.
The store and native session registry each have a 16-session bound. Input identity and
bytes are checked before reuse. Atomic replacement by an external editor is supported
for the output, which is pinned afresh for result review.

A merge result review displays byte count, SHA-256 and an inert bounded text preview,
or identifies binary data. Saving requires explicit finished-editing acknowledgement
and rechecks the pinned output, repository identity, branch/HEAD, unmerged index stages
and working baseline. It writes raw bytes with no assumed encoding and preserves
existing file permissions and extended attributes. It does not stage. A separate
fresh review checks the saved working bytes and original conflict entries before one
Git add. Write/stage failures or uncertain outcomes remain recorded and are not replayed.
These checks observe outside changes; they do not lock out concurrent filesystem writes
or promise a transaction across Git and the filesystem.

Cleanup requires a fresh private-file review, an exited owned command and explicit
acknowledgement that any GUI handoff has finished using the files. Changed, foreign,
linked or unexpected material is retained. Cleanup can operate after the original
Git context changes because its authority concerns only the reviewed private copies.
It never edits working files or the index.

## Current limits and acceptance boundaries

Execution is Linux-only. Other platforms return an unavailable result. Existing regular
working merge targets are supported; creating a missing working target requires a
separate no-replace publication design and is not implemented. Submodule and symlink
merge targets refuse. Launch identity checks are preconditions rather than an atomic
kernel executable-identity guarantee.

Live session ownership lasts for the application process. Private files survive a
restart and are not automatically deleted or re-executed. Process ownership must never
be reconstructed from a saved PID. A retained-file recovery and storage-management
workflow remains open; old files may occupy the bounded store. No full restart-recovery,
Windows/macOS, live external IDE, or complete broad packaged acceptance claim is made here.

## Current candidate evidence

On 2026-11-02 the frozen application candidate has 966 passing Rust test executions across the complete
workspace invocation (45 optional tests excluded), all 182 frontend unit tests in 27
files, and an earlier 59-case focused renderer group with zero retries. The current
restart-aware harness passes 60 cases. That earlier renderer group includes 11 new file-tool journeys and existing editor, direct-content
and configured-program regressions. Compact 320px and 780px review screenshots were
visually inspected. Workspace all-target Clippy uses unchanged `-D warnings`; generated
bindings and negative authority assertions pass. The production AOT build passes the
existing 1,400,000-byte initial hard cap and development-code exclusion check. Existing
soft initial/CSS size warnings remain visible. These source/renderer gates do not establish full product parity.

## Latest qualified exact-package checkpoint

The current DEB SHA-256 is
`568e5d4aec974f3b689c68294bf541fdd916acca827749b77cd2ff4b0e396a6a`;
its independently extracted executable SHA-256 is
`9d20970554c92db03f145ac9924442f1a7189c89e1d5c63ce1ff7704fa2c4985`.
This package includes the menu correction described below. The preceding pre-menu
package `b6ff51effc969a1a2556021772adefef21e4edd6529dae780fa67323bb8e4c7b`
retains its own focused reports and inspected views as historical evidence.
The production build retains the original 1,400,000-byte initial and 80,000-byte
component-style hard limits. Soft warnings remain visible.

This exact package passes 14 normal and 15 inherited-environment native executions,
including the four real file-tool journeys described below. These are 29 executions,
not 29 distinct scenarios. All ten normal-run capture images and two inherited-run
completed-staging images were actually viewed: literal launch reviews for three roles,
binary result review and completed staging review, at normal and compact viewports.
Compact captures establish readability and bounds; execution occurs after restoring
the normal viewport. The earlier loading-state staging screenshot below is not used
as completed-review evidence.

The current renderer candidate passed the 19-case focused correction group (11 new
file-tool cases and eight existing conflict cases) after restoring the conflict header's
Close position and omitting the unsupported submodule action. The earlier complete-run
attempt failed two conflict-layout cases and is retained. A fresh complete 1,484-case
run now passes, as recorded below. The exact menu-corrected package also passes
220 full, 221 inherited-environment and 30 GitLab native executions: 471 executions
covering 241 distinct scenario names. Optional LFS (41), signing (3) and SSH (1)
source gates also pass. These completed local reports do not establish remote CI
success or qualification of the incomplete capabilities below.

## First exact-package native checkpoint

Package `0aa658726809e268126ee77cd4424a2161a72415edf3dacb427f37b0958dcb0e`
(ELF `2533100540345f9fa24eb3ed2faa276596d6d6e09dcf0fe30f57d6337e8bab59`)
passes 14 normal Linux native scenarios: ten smoke cases and four file-tool journeys.
Ordinary packaged controls configure profiles and review literal arguments before real
owned programs read exact comparison copies, edit a working file, write binary merge
output, save without staging, then separately stage and clean up. Actual working/index
bytes and unchanged refs/configuration are asserted. No program runs while preferences
are saved, and shell punctuation remains literal.

Three normal launch-review screens were visually accepted. The staging screenshot
captured loading, so it is retained as functional evidence and does not qualify the
completed review visually. The heading wording is corrected in source; a new artifact
and harness captures must qualify completed staging/output reviews at normal and compact
sizes, including inherited Git context. The first artifact and its build/source/report
receipts remain preserved. Its 468-package Rust notice closure is conservative normal/build
dependency coverage, not an exact linked-artifact SBOM. Broad normal/environment native
and complete renderer qualification still remain open.

## Menu correction after complete renderer attempt

The complete 1,484-case run for the b6 source finished with 1,482 passed and two
main-menu layout failures, without retries. The added file-tools command caused
unnecessary menu scrolling at 780×560 and 1440×900. All three earlier shards passed;
the failed complete attempt remains retained and is not a passing checkpoint.

The scoped correction reduces menu gaps and padding while retaining every command,
font size and the compact 24px control minimum. The first focused correction passed
the normal menu but still failed compact height; that failed receipt is retained.
The second correction passes all three existing main-menu cases and the 19-case
file-tool/conflict group, with one attempt per case, plus the unchanged production
hard budgets. Both corrected menu screenshots were actually viewed and accepted.
The fresh menu-corrected package above passes the 29 focused native executions and
12 inspected views. The pre-menu b6 package remains evidence for its own bytes.
Broad native and optional transport gates now pass as recorded above. The fresh
current-source renderer qualification below also passes.

## Exact-package native menu acceptance

The menu-corrected package above also passes the unchanged ten-case smoke suite plus
two added native menu cases at 1440×900 and 780×560. Both actual WebKit captures were
viewed and accepted for menu fit and readability: all 15 commands remain visible,
normal scroll/client height is 650/650 and compact height is 365/365. Native End/Home
focus navigation passes. This is not full accessibility or platform qualification.
The complete 1,484-case current-source renderer run below also passes.

## Complete current-source renderer checkpoint

The final menu-corrected source passes all 1,484 distinct renderer cases in four
serial shards of 371 cases. Detailed reports were checked against the complete
collection and each shard: every case ran exactly once, with zero retries, failures
or skips. All 1,473 earlier cases are preserved and all 11 new file-tool cases pass.
This is renderer protocol and UI evidence; real execution is established separately
by the exact-package native and optional source gates above.

The feature remains partial: creating an absent working merge target, restart
snapshot inventory/recovery management and non-Linux support remain open. The prior
remote dev CI failure is retained as a separate unresolved result; these local passes
do not relabel that remote run.
