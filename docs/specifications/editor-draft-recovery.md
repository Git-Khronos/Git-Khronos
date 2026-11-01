# Local editor draft recovery

## Capability

Retain unsaved editor text across an unexpected application exit. After restart,
the user can inspect a retained draft, compare it with the current working file,
then explicitly restore it into an editor or discard the recovery copy.
Recovering a draft must not itself modify a working file, index, reference or
repository configuration. Restoring text does not replay a prior save or stage
request.

This is an original requirement and design. No proprietary implementation,
assets, private formats or extracted application code informed it.

## Candidate record model

The initial model is versioned and rejects unknown fields. Each record binds an
opaque draft identifier to a repository location, literal repository-relative
file path, declared text encoding, baseline text SHA-256, editor revision and
positive sequence number. Timestamps and byte counts cross JSON as decimal
strings. Full-record debug output omits repository paths and draft text.

Bounds are three MiB of UTF-8 text per draft, eight MiB per encoded record,
eight drafts and thirty-two MiB total storage. Record identifiers and editor
revisions contain thirty-two lowercase hexadecimal characters. Baseline hashes
contain sixty-four. Repository locations must be bounded absolute paths; file
paths cannot escape their repository or target Git metadata.

A sequence may be retried only with identical content and binding. A timestamp
change alone does not alter a record's content identity. These constraints are
input validation, not permission to open or overwrite any path in a record.

## Required storage and session behavior

- Use a private application-data directory and bounded regular files. Refuse
  symlinks, shared writable storage, unsupported record formats and ambiguous
  ownership. Do not silently remove unreadable recovery material.
- Serialize writers and retain an already committed record if a replacement is
  interrupted. Report storage and durability failures visibly.
- Derive metadata from the native editor session. Do not accept an arbitrary
  repository/file binding supplied by the renderer as write authority.
- Bind asynchronous snapshots to an editor revision and sequence. A late reply
  or pending snapshot must not recreate a recovery copy after an approved save
  or discard.
- Require explicit review after restart. Reopen the current repository and file
  using the normal editor checks. Missing files, changed baselines and changed
  repository state must remain reviewable without overwriting current data.
- Clear recovery material only after confirmed file save or an explicit discard.
  If cleanup fails, retain the draft and explain the remaining recovery copy.
- Continue protecting ordinary window-close requests while recovery work is
  pending. Crash recovery does not replace save/discard confirmation.

## Acceptance still required

The initial record model and Linux storage baseline compile and pass all twelve
focused behavioral tests (`parity-draft-recovery-model-store`). That source was
preserved before the later per-entry inspection changes. The current extended
prototype compiles and passes all nineteen focused cases
(`parity-draft-recovery-inspection-focused`), including seven per-entry review and
cleanup cases. The complete default workspace Rust gate also passes **827 tests**
with **45 optional tests ignored** (`parity-draft-recovery-full-rust`); workspace
all-target Clippy passes with warnings denied (`parity-draft-recovery-workspace-clippy`).
Nx dependency expansion is explicitly excluded, so these are single executions.
These gates establish the core library candidate, not native/UI or actual packaged
crash/relaunch acceptance. Native session integration, restart review UI and actual
packaged crash/relaunch tests are not implemented. The prototype uses only
already declared dependencies; no third-party implementation was copied.

Native and packaged acceptance must extend the core cases to interrupted
replacement, competing application instances, quotas, invalid/unknown records, symlink and hardlink refusal,
out-of-order snapshots, save/discard races, externally changed files and explicit
restore without an automatic Git or file mutation.

## Session integration design, not yet implemented

The native session must serialize snapshot/save/discard against the same editor
value lock, then access the recovery store in a consistent order. Snapshot
metadata comes from the owned native editor, including its current baseline and
revision. A queued snapshot must recheck revision and closed state after obtaining
the lock. Removing the renderer component is not sufficient cancellation.

An explicit discard must confirm recovery cleanup before discarding the editable
text or closing its session. A successful working-file save followed by recovery
cleanup failure must still report the successful file write, with a distinct
retained-copy warning; it must not invite replay of the save. A retained old copy
can subsequently be reviewed against a fresh editor context and current disk.

The strict storage API refuses malformed or conflicting pending entries and
preserves both files. The per-entry inspection and reviewed cleanup APIs below
make those copies individually reviewable. The native UI must expose their issues;
a store-level error must not be presented as proof that no recoverable drafts exist. Storage limits
include the pending replacement, so a near-full store can refuse a replacement
without automatically evicting another draft.


## Per-entry inspection candidate

A read-only inventory presents committed and pending copies independently. A
valid older copy remains reviewable when a pending replacement is truncated,
invalid or conflicting. Known file identifiers are validated before opening;
unrecognized names are preserved without being opened. The scan is bounded to
sixty-four names and eight draft identifiers, with at most two bounded entries
per identifier. Missing, unreadable, over-limit and unrecognized data produces an
incomplete report with explicit issues; it is never substituted with an empty
successful result.

Each safe regular entry receives an opaque review token binding its identifier,
copy kind, device/inode, metadata and exact bytes. Reading or explicitly deleting
a reviewed copy requires the same token and fresh ownership/identity checks. A
changed or replaced entry requires reloading the review. Deletion targets only
that copy; the other copy and unrelated data remain. Unsafe links, FIFOs, wrong
ownership/permissions and oversized entries receive no deletion token.

The inventory and reviewed-copy APIs still do not open a recorded working path
or run Git. Native restoration must bind an independently opened current editor
context and explicit user review before any file save. Native commands, pending
snapshot cancellation, the restart review UI and packaged crash/relaunch behavior
remain unimplemented.

Native integration must retain a recovery binding separately from the current
file-write authority. Staging or a partially successful save may invalidate that
authority while the user still has unsaved text. Snapshotting those bytes must
not manufacture a new write context or silently replace the captured baseline.
The native binding must use exact UTF-8 paths, current revision and sequence;
lossy path conversion must fail visibly. Restore always obtains a fresh editor
context and compares its current baseline before offering an explicit save.

A late cleanup or snapshot reply must not retarget a newly opened file or erase
its copy. Explicit discard must serialize with pending snapshots. Cache cleanup
failure after an actual file save must remain a separate warning, with the file
save reported truthfully and no replay of that save.


The focused filesystem tests use owned Linux directories and deliberately
constructed interrupted, corrupt and conflicting entries. They preserve exact
bytes and exercise stale/foreign inode refusal, FIFOs, quotas and bounded scans.
These controlled fixtures do not constitute an actual process-kill/relaunch test.
