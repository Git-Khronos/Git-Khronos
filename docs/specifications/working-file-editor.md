# Independent working-file editing

Status: core/native candidate with an original desktop editor under validation.
A bounded inert Markdown preview is implemented as a candidate. Packaged editor
acceptance remains pending.
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

Complete the combined renderer regression, full renderer gate and exact-package
real UI/disk/index assertions, including truthful save/stage partial success.
Six native editor scenarios have been added but not yet executed. Broader codec,
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
source is frozen for those gates. Merged-source all-target Clippy also passes. Complete renderer outcome and
exact-package native editor acceptance remain pending at this checkpoint.
