# Linux package build cache

A cached package may be reused only after a completed build receipt matches the
Task source checksum, selected Cargo output directory and exact required output
hashes. Debian payload verification also compares the packaged executable with
the current release executable. A valid package header or an existing `.deb` is
not evidence that current application source was built.

## Interrupted and redirected builds

Task's checksum checks declared source files and existence of generated outputs;
it does not hash those outputs. Its source fingerprint belongs to the task label,
so changing Cargo output directories requires a target-specific completion check.
A hard process kill can also leave the new checksum alongside older outputs.
Both conditions were reproduced with owned fake build fixtures before this fix.

The build recipe now runs these steps:

1. Write a pending marker containing the declared source checksum and owning Task
   process identity. Refuse another live owner of that Cargo output directory.
2. Run the normal Tauri build and normalize the Debian filename.
3. Validate the package payload and its equality with the release executable;
   hash the package, executable, notices and declared renderer/package outputs.
4. Atomically write the completed receipt, then remove the pending marker.

The receipt is stored under the selected Cargo release directory. Cache checks
reject unfinished markers, missing/invalid receipts, a different workspace or
source checksum, missing outputs and changed output bytes. PID identity includes
process start time, so a reused PID does not keep an interrupted marker active.
Old outputs remain available as evidence; they are not silently promoted to a new
source identity. Unknown marker ownership fails closed rather than overwriting it.

The source set remains declared in `Taskfile.yml`; generated Tauri schemas remain
excluded while actual capability configuration is included. Build inputs must stay
stable during compilation. This is an incremental-build check, not an artifact
signature, hermetic-build attestation or behavioral acceptance. Explicit build
environment/toolchain overrides may require `task --force package:deb`.

## Evidence

The original implementation failed both new stale-cache reproductions: hard-kill
recovery and a return to a Cargo target containing an older source build. The
corrected implementation passes all **64** packaging tests, including five new
cases for those conditions, changed outputs/deleted receipts, live owner refusal
and mismatched release/package executables. Tests use temporary owned artifacts
and private package databases. No host package installation is performed.

A fresh real package and complete renderer/native acceptance are still required
before a source candidate is qualified. The old `24b73deaf96a` incoming-link-only
artifact was explicitly rejected as evidence for the later combined editor,
configured-program and window-close candidate.

Reference: [Task up-to-date checks](https://taskfile.dev/docs/guide/up-to-date),
inspected 2026-11-01. The receipt implementation and regressions are original;
no upstream implementation was copied.
