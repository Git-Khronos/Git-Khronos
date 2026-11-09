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

The latest combined Linux renderer and exact-package qualification is recorded
at the end of this document. Broader codec, mixed-newline editing and other-platform
support remain open. Ordinary Linux window-close review is qualified for the
retained combined package. Persistent draft recovery and forced process termination
are outside that package's implemented/qualified scope.

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
1409-case renderer attempts were later interrupted by the verified systemd-oomd
scope kill. Neither interrupted run is counted as a pass; the newer combined
candidate requires fresh complete acceptance.

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
inspected 2026-11-01. No SDK implementation was copied. Focused renderer checks and production
compilation pass as recorded below; complete packaged acceptance remains pending.
This does not provide crash recovery or protection against forced process termination.

The close-review source candidate passes all 24 focused editor renderer cases,
including nine new window-close/listener journeys. Production compilation passes
under the unchanged 1.40 MB hard cap. All 59 package-policy and 37 native-harness
unit tests pass; four new harness safety tests refuse missing/ambiguous owned
process bindings before any X request and check missing-library/process-state
handling. The application Rust/core sources and generated contracts are unchanged
from the configured-tools candidate's 808-test Rust gate; the main-window capability
and two original renderer components differ. The fresh package build and actual
permission/platform-event evidence are recorded below.

Three new actual acceptance scenarios use standard ICCCM WM_DELETE_WINDOW
requests bound to the owned extracted process and X window, then normal UI
Save/Discard/Keep choices with independent disk/index/ref checks and process
relaunch. The initial combined-package attempt reached this helper but refused its
ambiguous window binding before sending any request. The later complete normal-mode run below supplies passing actual close-guard
package evidence; the earlier refusal remains a recorded failure.
The helper's first positive-control attempt failed during initial WebDriver session
creation before any scenario or X request; this is retained as a failed startup,
not evidence of window-close behavior. Full renderer and inherited-environment
qualification remain pending; the passing normal packaged run is recorded below.
Crash recovery remains unimplemented.


## Combined package and acceptance recovery

Candidate `8a6682fcd12bed20ec1cfea30fd2f8813a590c0c` has a clean captured
711-file source manifest and a completed target-specific build receipt. The fresh
Debian package passes payload verification, production compilation and the
unchanged renderer hard cap. Retained artifact:

- Package SHA-256: `ecbdad48a0f774851ea6e47e77859b0cbbd89decbd67695f2a1a60ef5c0910ca`.
- Executable SHA-256: `8951c88b83df289ce475836088c5b96e89d75021f7e5fc532c6653ed58c5f9c4`.
- `parity-combined-marker-package`: complete fresh build, exit zero.
- `parity-package-cache-marker-complete`: all 65 packaging tests pass.

The stale incoming-link-only artifact previously returned by the interrupted
Task cache was rejected. It is not evidence for this editor/program/close-guard
candidate. The source checksum plus completed receipt and exact output hashes
replace mere artifact existence as the incremental build reuse check.

The first two actual native attempts stopped in a new configured-program test
helper: it selected a dynamic Angular form name that is not a DOM name attribute.
A readiness wait alone did not resolve that mismatch. The corrected helper waits
for the input's existing accessible label, then performs one input action. The
next retained run passes all six editor scenarios and all three configured-program
scenarios, including real PTY arguments and normal desktop persistence, launch,
close and deletion. It stops before a window request because three windows share
the owned PID and close protocol; this is not a passing full native run.

The Xlib helper now requires exactly one visible InputOutput window that does not
bypass the window manager, in addition to the exact executable, PID and close
protocol binding. It rechecks the target immediately before delivery. All five
helper safety unit tests pass. `parity-owned-visible-window-diagnostic` passes an
actual clean-window close and new-process relaunch on the retained package; its
scope is that positive control, not the complete native suite. These helper
changes do not alter the packaged application.

`parity-combined-native-approved-close` subsequently passes all **213/213** unique
normal-mode native scenarios on this exact artifact. All three dirty-window
scenarios pass, with two confirmed application process exits and new-process
relaunches. The Discard click produces the observed WebDriver response
“Session terminated without a reply”; the helper accepts that specific response
only after its single dispatched click and confirmation that the owned process
exited. It never replays the click. Independent post-relaunch disk/index/ref/config
checks still run and pass. Unrelated errors and a still-running process fail the
helper. All **41** native-harness unit tests pass. Actual editor, configured-program
and kept-draft screenshots were reviewed.

The retained report is `full-1793526371650989681/report.json` under the combined
checkout's native artifacts. The application inputs match the preserved 711-file
package source snapshot; only reviewed helper/test files and evidence documents
changed afterward. Prior failed full attempts are not added to the passing count.

`parity-combined-native-inherited-environment` also passes all **214/214** unique
scenarios on the identical package and executable hashes. Its scenario set covers
the same 213 normal cases plus the outside-repository/index preservation check
under deliberately conflicting inherited Git environment variables. The report
is `environment-1793527172548274173/report.json`. Together these are 427 scenario
executions across two modes, not 427 distinct scenarios.

The complete combined renderer suite remains required before integration into
`dev`. Crash recovery remains unimplemented in this packaged candidate.


The earlier `154c16d1` remote renderer workflow failed one case with Chromium
“Target crashed” while updating a fetch destination; it did not report a failed
behavioral assertion. `parity-hosted-fetch-destination-repeat` passes that exact
case ten times on the combined candidate, one worker and zero retries. Repetition
is isolated by Playwright and is not proof of a long-lived-worker memory cause
or that the remote failure is fixed. No application change or retry was introduced
to obtain these passes. A fresh complete combined renderer gate remains required.


The first fresh combined renderer attempt, `parity-combined-complete-renderer`,
encountered a failed bootstrap in `diff-performance.spec.ts:3`. Its trace records
Chromium `net::ERR_NETWORK_CHANGED` for `main.js` and six local JavaScript chunks;
the screenshot shows an unmounted blank application. The initial blame-readiness
assertion failed, before dense/long-line injection and syntax/text-preservation
assertions ran. This is observed browser asset failure, not proof of a product
logic defect or of the underlying network-change cause.

That failed run was deliberately stopped with SIGINT (runner exit 130), retaining
its trace, screenshot, error context, source manifest and read-only memory samples.
It is not a complete passing renderer run. The same exact case subsequently passes
three full executions on unchanged candidate source, with one worker, zero retries
and unchanged assertion/performance limits:
`parity-diff-performance-bootstrap-reviewed`. A fresh complete 1424-case gate is
still required; passing these three cases does not replace it.

## Complete combined Linux qualification (2026-11-01)

`parity-combined-renderer-network-recheck` passes **all 1,424 renderer tests**,
with one worker, zero retries, zero skips and exit zero. It ran from 10:54:07 to
11:56:59 UTC on clean candidate
`0696f9a64b2d368205767127b7b1a63df1ed3ce3`. All 712 captured source inputs,
file kinds and executable bits were verified unchanged after completion; the
input digest is `3893eb3d5b1727cf2bcd2df152d96932d56ac14335eecdc9bc98a3ab266c5dfc`.
This complete run supersedes the earlier pending combined-renderer gates, while
the failed/interrupted attempts above remain part of the evidence.

The retained package remains `ecbdad48a0f7` with the full hashes recorded above.
Its source is clean `8a6682fcd12bed20ec1cfea30fd2f8813a590c0c`; exactly nine
reviewed harness/test/documentation paths differ between that source and the
renderer candidate, with no application-runtime differences. The full package
hash and all **213 normal / 214 inherited-environment** native scenario results
were reverified. These are **214 distinct native cases and 427 executions**.
The production hard cap, 65 packaging tests and 41 native-harness tests retain
their earlier passing results; no app change was introduced for the final run.

The runner, its child and bounded read-only observer exited, and the owned server
port was released before another heavy gate started. This is a local Linux
checkpoint, not completed remote CI or qualification of Windows/macOS. The old
remote Chromium crash's underlying cause remains unproven. New persistent draft
recovery work is on a separate branch and is absent from this artifact.
