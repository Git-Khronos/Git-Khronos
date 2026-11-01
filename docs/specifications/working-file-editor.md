# Independent working-file editing

Status: core/native candidate with an original desktop editor under validation.
A bounded inert Markdown preview passes the Linux normal package suite. Full
renderer and environment qualification remain pending.
Inventory requirement: G29. No full feature-parity claim is made.

## Capability and provenance

The public [file editing guide](https://help.gitkraken.com/gitkraken-desktop/editing-files/)
was inspected 2026-11-01. Its functional scope motivates editing the current
working copy, visible unsaved drafts, explicit saving/staging, encoding controls
and Markdown rendering. Product controls, visuals, wording and implementation
were not used. The following design is original.

## Bounded text interpretation

A private decoded value binds replacement text to its original encoding and BOM.
UTF-8 is the default; a UTF-8/UTF-16 BOM determines its encoding. BOM-less UTF-16
and Windows-1252 require an explicit selection. Invalid Unicode, NUL-containing
content, mismatched BOMs, non-round-tripping input and unrepresentable edits are
refused. No replacement characters, encoding conversion or newline normalization
are silently introduced. A newly ambiguous leading byte signature is refused
before writing. Encoded files, including a BOM, are limited to one MiB.

The already-locked `encoding_rs` 0.8.42 public API provides Windows-1252 handling;
Rust standard APIs handle UTF-8/UTF-16. Its MIT/Apache option and additional WHATWG
BSD attribution are documented in provenance, with four complete notice files
verified against the existing Linux catalog. No codec implementation or table
was copied.

## Original contained save design

On Linux, opening validates a literal repository-relative path outside Git
metadata and reads an existing regular file through non-following directory/file
handles. The edit binds original bytes, file identity/timestamps, root/parent
identities, permissions, ownership and bounded extended attributes. It also binds
HEAD, symbolic reference, object format and canonical Git/common-directory
identities, including linked worktrees. Changed files
and paths must be reloaded before retrying; an unsaved client draft remains the
client's responsibility until the desktop layer is implemented.

Saving rechecks those preconditions, prepares a private adjacent temporary file,
preserves supported metadata, synchronizes the bytes, rewalks the current paths
and rechecks original bytes/identity immediately before atomic replacement.
The prepared temporary path is also re-read and checked against its open file,
expected bytes and metadata. Observed modification or substitution refuses the
save; cleanup checks the owned inode and preserves an observed foreign replacement.
Identical saves avoid replacing the inode. Owner-read-only files, special
permission bits, unsupported protected metadata, unpreservable ownership and
metadata-copy failures refuse rather than silently altering those properties.
Cancellation is checked before replacement. A failure to confirm the path or
synchronize its directory after replacement returns an actual write plus a
warning, not an unsaved-error result. An owned temporary-cleanup failure is
reported with its temporary name.

This final precondition check is not transaction isolation against unrelated
programs writing after it. Other platforms return an explicit unsupported result
for contained filesystem editing; the pure codecs are portable. A successful
save consumes the original core context, including clones. An ambiguous rename
error returns an unconfirmed outcome, invalidates the context and retains any
owned recovery file; it never blindly rolls back or automatically stages.

Save-and-stage and staging the saved disk version are separate native commands.
The latter accepts no unsaved draft. A staging failure after a completed save
returns the actual disk status and a separate unconfirmed staging outcome.

## Evidence and remaining work

Twenty-one focused core tests pass, including 20 new tests and one existing
regression. Owned Git fixtures cover exact bytes/metadata, unchanged index/config/refs,
stale bytes/modes, path and symlink refusal, cancellation/no-op identity, encoding
limits, successful writes with lost rename responses, replay refusal, branch/HEAD
changes, unborn/detached/SHA-256 repositories and replaced Git/common directories.
The core all-target Clippy gate passes. The workspace regression before the final temporary-path refinement passed
793 Rust tests with 45 ignored,
including 735 core unit, 13 core integration, 37 native unit and eight native
integration tests. After the refinement, the focused 21-test group and workspace
all-target Clippy pass; a fresh full workspace run remains required. These
checks do not establish a packaged editor workflow.

The native-session candidate uses a separate bounded, ephemeral registry, opaque
random identifiers, single-use revisions, a 15-minute context lifetime, per-repository
operation serialization and cancellation on close. It separates disk-save status
from staging outcome and keeps stage-saved free of an unsaved-text argument.
Uniform LF/CRLF/CR line endings are restored after browser text-area normalization;
mixed line endings are initially read-only. Seven native operation/lifecycle
tests pass, including real owned disk/index checks, successful save with refused
staging, stale-revision refusal and UTF-16/BOM/newline preservation. Workspace
all-target Clippy and generated contract checks pass. Packaged UI acceptance
remains open.

The candidate desktop entry opens the current working file explicitly from the
existing file-content dialog. Drafts, save-only, save-and-stage and stage-saved
are distinct. Dirty close/reload requires a choice. Repository switching retains
the original draft and disables writes; late read contexts are closed after
teardown. A lost write reply preserves the draft and requires a fresh disk
review. Fourteen focused renderer scenarios pass before the dialog-state refactor;
the combined state integration passed 51 of 52 preview/media/editor cases,
finding a real 320px overflow. The grid/header correction passes four compact
checks at 320px/700px, with visual review; a new combined/full run remains
required. These are not packaged proof. The production build passes the same
1.40 MB initial-bundle hard limit after state was kept in the dialog request.
An earlier candidate exceeded that cap by 280 bytes; no budget was raised.

## Bounded Markdown draft preview

The public `marked` 18.1.2 lexer runs in a separate terminable worker. Input is
limited to 128 KiB of UTF-8 text, the resulting tree to 6,000 nodes and 24 levels,
and worker execution to two seconds. Teardown or newer input terminates the old
worker; no synchronous main-thread parser fallback is used.

An original Angular tree renders headings, paragraphs, emphasis, lists/tasks,
quotes, code and tables through text interpolation. Raw HTML stays literal;
links and images show inactive labels/destinations, without clickable URLs or
automatic resource loading. There is no HTML insertion or trust-bypass API.
Only common named and numeric entities are decoded in ordinary text; other
named entities remain literal. Full CommonMark/GFM conformance, active links,
local images and syntax highlighting are not claimed.

Six pure tests and the focused browser cases cover hostile HTML/destinations,
real worker rendering, bounds, termination on timeout and draft preservation.
All 172 frontend unit tests pass. The production notice catalog contains the
complete installed Marked license, including its Markdown BSD-style notice,
with SHA-256 `8e3a3f82f59a60958f56ca08f445647c32a4733dc7ca6c2c46f6eb898471ab9c`.
Packaged worker/CSP and attribution checks remain separate gates.

## Remaining acceptance

Complete the full renderer gate and remaining environment acceptance. Normal
exact-package UI/disk/index assertions now pass, including truthful partial success.
All six native editor scenarios pass in the 207-case normal package suite below. Broader codec,
mixed-newline editing and other-platform support remain explicit gaps.

The current dirty-draft review covers leaving the editor and reloading disk.
Whole-window/process closure and crash recovery of unsaved drafts are not yet
qualified; persistent draft recovery is not claimed. Track those separately
before marking the complete editing capability accepted.

## Integrated source candidate (2026-11-01)

The editor candidate was combined with the original incoming-link transport in
its own checkout. Full Rust regression passes 799 tests with 45 ignored: 42
native unit, eight native integration, 736 core unit and 13 core integration.
All 172 frontend unit tests, generated IPC checks and package/harness targets
pass. The combined focused renderer group passes 85 cases; four zoom/title
regressions pass after native platform APIs were deferred. That production build
passes at approximately 1.383 MB under the unchanged 1.40 MB hard limit, with
50 JavaScript assets verified free of development-preview initialization.

The first combined production attempt exceeded the cap by 6.10 kB. Native title
and zoom APIs now load on asynchronous use; stale requests do not override newer
selections. No bundle limit was increased. A 698-file source snapshot was captured
before the full 1,409-case renderer and Linux-package gates started. The application
source is frozen for those gates. Merged-source all-target Clippy also passes.
The later section records normal package acceptance; complete renderer and
environment outcomes remain pending.


## Preserved Linux package: normal acceptance

The combined package was built successfully and retained before acceptance:

- Package SHA-256: `0362430100cc5bed92c3bf73fb380160a6d3c05d9b1e7dacbb8d099dacd5bea7`.
- Executable SHA-256: `d92fb7c2a2eadba58f1de566ea511d7970cd5907f9670665ca3cfa70d5f55327`.
- `parity-editor-incoming-native-reviewed-harness`: **207/207** actual normal
  native scenarios pass, including all six new editor scenarios.

The build started during the reviewed merge at `38b50eb8` with captured dirty
inputs. Application inputs match committed candidate `795f4d07`; it is not
represented as a clean-commit build. Qualification documents and native helpers
changed afterward; no application input changed. The environment suite and full
1409-case renderer gate are still running.

Real packaged checks cover UTF-8 BOM, both BOM-marked UTF-16 byte orders and
explicit Windows-1252, CRLF/mode preservation, actual index contents, single-use
revisions, stale/mixed/readonly/binary refusals and owned index-lock failures.
Normal WebDriver menu/text controls save a UTF-16 file and stage saved bytes while
retaining an unsaved draft. The production worker renders inert Markdown under
WebKit/CSP; disk and index remain unchanged by preview. Actual screenshots were
reviewed for the editor and preview.

Initial acceptance attempts exposed test expectations needing correction: a
staging failure can invalidate the context while reporting disk success, and a
successful stage can likewise require reload while retaining the draft. Tests now
check refusal of the invalid context and explicit reload/recovery. The preview
assertion trims ordinary rendered whitespace; the same emphasis requirement is
retained. All prior failures remain recorded; only the complete later 207-case
run is counted as passing. A duplicate invocation from the wrong checkout was
stopped and is not editor acceptance evidence.

The native media helper also waits for an enabled visible Content control after
a file-row click. This addresses the asynchronous lookup failure seen in the
older `44ec1a23` remote workflow; remote acceptance is tracked separately.

## Window-close review candidate

A separate candidate addresses ordinary window-close requests while editing. It
installs the public Tauri close listener before opening a writable editor; failed
or late registration leaves the preview available and editing unopened. A dirty
window close offers save, explicit discard or keeping the draft. A running save
settles before a close can proceed, without replaying the save. Failed save
transport or failed window destruction retains the draft and requires an explicit
next action. Cancelling the close intent does not turn a later ordinary save into
an application-close action. Browser preview uses the browser's ordinary unload
confirmation for dirty text or an in-flight write.

The SDK's documented close listener completes an approved close through window
destruction. This candidate grants `core:window:allow-destroy` only to the existing
`main` window capability; other windows receive no additional permissions and process APIs are unchanged.
The behavior comes from the public [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/),
inspected 2026-11-01. No SDK implementation was copied. Focused renderer checks,
production compilation and actual packaged window-close acceptance remain pending.
This does not provide crash recovery or protection against forced process termination.

The close-review source candidate passes all 24 focused editor renderer cases,
including nine new window-close/listener journeys. Production compilation passes
under the unchanged 1.40 MB hard cap. All 59 package-policy and 37 native-harness
unit tests pass; four new harness safety tests refuse missing/ambiguous owned
process bindings before any X request and check missing-library/process-state
handling. The application Rust/core sources and generated contracts are unchanged
from the configured-tools candidate's 808-test Rust gate; the main-window capability
and two original renderer components differ. A fresh packaged build is required
to verify the permission and real platform event route.

Three new actual acceptance scenarios use standard ICCCM WM_DELETE_WINDOW
requests bound to the owned extracted process and X window, then normal UI
Save/Discard/Keep choices with independent disk/index/ref checks and process
relaunch. These scenarios have not yet executed against a close-guard package.
The helper's first positive-control attempt failed during initial WebDriver session
creation before any scenario or X request; this is retained as a failed startup,
not evidence of window-close behavior. Complete renderer and actual packaged
qualification remain pending. Crash recovery remains unimplemented.
