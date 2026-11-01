# Local editor draft recovery

## Capability and provenance

Retain unsaved editor text across an unexpected application exit. After restart,
the user can inspect retained text, compare it with an independently opened
working file, explicitly load it into the editor, then save or discard it.
Inspection and loading do not write working files, index, references or repository
configuration, and never replay an earlier save or stage request.

This is an original requirement and implementation. No proprietary source,
assets, extracted formats or implementation details informed it. Normal Git and
filesystem behavior define the independent verification oracles.

## Record and storage

Version-one records reject unknown fields and bind native-generated identifiers
to an absolute repository location, literal relative file path, selected encoding,
normalized baseline SHA-256, editor revision, positive sequence and native clock.
Timestamps cross JSON as decimal strings. Debug output omits paths and draft text.
The optional original full reference and HEAD support unborn branches, detached
HEAD and SHA-1/SHA-256 repositories. Missing legacy context remains unknown.

Limits are three MiB of UTF-8 text per draft, eight MiB per encoded record, eight
drafts and thirty-two MiB total storage. Identifiers and revisions are thirty-two
lowercase hexadecimal characters. Relative paths cannot escape a repository or
target Git metadata. Validation of a record never grants permission to open or
write its recorded path.

Linux storage uses the native-selected application-data `editor-drafts-v1`
directory, mode 0700, with effective-user ownership and mode-0600 regular entries.
A retained directory descriptor, no-follow opens, file locks and fresh inode,
permissions and byte checks reject ambiguous ownership, links and replacements.
Other platforms return an explicit unsupported result.
Ordinary editor discard on those platforms still retires the in-memory revision;
it does not depend on an unavailable persistence capability.

Replacement writes a bounded pending record, syncs it, verifies its identity and
contents, renames it to the committed slot and syncs the directory. Failures
preserve existing material. Quotas include pending data; storage never evicts an
unrelated draft automatically. Retries accept only absent data or a known,
complete attempted/committed record with the captured binding. Corrupt, pending
or foreign data requires explicit review rather than blind replacement.

A read-only inventory scans at most sixty-four names and eight draft identifiers,
with separate pending and committed entries. Unknown names are preserved. Scan,
format and permission failures produce explicit issues and an incomplete result,
never an empty successful substitute. A damaged pending copy does not hide a
valid committed copy.

An opaque review token binds each safely readable entry to its exact bytes and
filesystem identity. Loading or deleting a reviewed copy repeats those checks.
A changed entry requires a fresh review. Per-copy deletion preserves its sibling
and unrelated data. Unsafe entries have no deletion token.

## Native editor binding and concurrency

The recovery binding is captured from the independently opened native editor,
not deserialized from renderer-supplied repository metadata. It has no file-save
method and survives consumption of the original editor's write authority.
Review checks a fresh editor's current bytes and Git context before comparing
location, path, encoding, normalized baseline and original reference/HEAD.

Matching paths are not proof of filesystem identity. Matching normalized text
is not proof of identical raw bytes, BOM, endings or inode. Review results do not
grant save permission: ordinary editor freshness and repository checks still
apply to every explicit save. The current editor determines encoding and endings.

Six main-window-only commands snapshot an owned editor, inspect copies, load an
exact reviewed copy, compare it with a fresh editor, discard the editor's recovery
epoch, and discard an inactive reviewed entry. Generated contracts come from
the Rust command registry. Snapshot inputs contain only editor ID, current
revision, sequence and text; identifiers, clock and storage location are native.

Snapshot, save and editor-discard take the editor value lock before the store
lock. Repository-aware review/save take the repository operation lock first.
Queued work rechecks revision and closed state under lock. Closing a context
remains nonblocking. Snapshot activity may retain a data-only context after the
fifteen-minute save lifetime; it never extends permission to save or stage.
A refused expired save keeps its known binding available through a separate
cleanup lookup. Explicit discard can clean that owned copy without renewing the
save lease. Closed contexts remain unavailable, and insertion still prunes
abandoned contexts within the existing capacity bound.

Explicit discard retires the old epoch before store acquisition or cleanup.
Failure preserves editable text and refuses queued old snapshots; a cleanup
retry remains possible. Success rotates native identifiers/revision. Live,
non-retired editor copies cannot be deleted through the separate review panel.
Cleanup verifies every owned copy before deleting any and refuses foreign text.

Confirmed saves rotate the epoch to the freshly verified file. Unconfirmed saves
never clear recovery. A cache containing text different from the confirmed save
is retained with a warning. Cleanup failure reports file-save success separately
from the retained-copy warning and never replays the save. If file-write authority
is unavailable, original recovery metadata remains available for later review.

## Snapshot controller and interaction

The controller coalesces input for 350 ms, serializes requests, bounds UTF-8 text
and binds asynchronous replies to editor revision and local generation. A saved
acknowledgement must match identifier, sequence and byte count. Late replies do
not retarget another editor. Stage-only revision changes preserve sequence;
confirmed saves start a new epoch. Disposing drops unsent work.

Storage refusal pauses background retries and keeps the latest desired text.
The editor exposes pending, confirmed and failed status with explicit retry.
Before ordinary save it flushes the buffer and rechecks that the editor is still
current and mounted. Cache failure does not block an explicit file save. Discard
waits for an in-flight snapshot and keeps editable text until native cleanup is
confirmed. A failed window close keeps the buffer and schedules a new snapshot.

Recovery review is available through the main menu, command palette and welcome
screen, including without an open repository. It previews literal text in a
readonly textarea, with no HTML execution or resource loading. Copies can be
copied or individually discarded after an explicit confirmation. Errors and
partial inspection remain visible. The dialog traps keyboard focus, supports
Escape and keeps a usable list and scrolling detail at compact widths.

The panel does not automatically open a recorded repository. The user first
selects the original repository through normal controls, then chooses Review
working file. Normal close protection is installed before opening a writable
editor. Changed or unknown original file/Git context requires acknowledgement.
Mismatched location/path/encoding, readonly files, dirty buffers and busy or
closing contexts cannot accept recovered text. Missing originals remain readable
and copyable in the panel.

Load recovered text changes only the editor buffer and schedules a new recovery
snapshot. Only an explicit Save file writes it; staging remains separate. After
confirmed save or explicit discard, cleanup targets the loaded source's exact
review token. A lost cleanup reply is resolved only by a complete read-only
inventory proving that exact copy absent. It never replays deletion. Failure
retains the reference and reports a separate warning. Successfully consumed
references do not trigger another review when the editor is reopened.

## Qualification and remaining gates

The current candidate passes the default full Rust workspace regression:
**853 passed, zero failed, 45 optional tests ignored** in
`parity-draft-recovery-expiry-full-rust`. Its Rust/build inputs stayed unchanged;
only the separately executed Python package-acceptance scenario changed after
the source snapshot. This run includes unsupported-storage ordinary discard and
expired-save/explicit-cleanup regressions. The earlier thirty-case core and
fourteen-case native filters also passed; their counts are not additive to the
full run, and the native filter includes an existing reset-preview test.
All-target workspace Clippy with warnings denied passes in
`parity-draft-recovery-expiry-clippy`.

Generated-contract freshness/type checks pass in
`parity-draft-recovery-contract-check`. All eighteen pure controller/cleanup tests
pass in `parity-recovery-controller-acknowledgement-unit`. They exercise the actual
TypeScript controller with injected transport and do not establish native IPC or
filesystem behavior. Five owned-process crash-helper tests also pass, including
hash/profile/ambiguity refusals and preservation of another process.
The final complete Python native-harness regression passes all 46 tests in
`parity-draft-recovery-final-native-harness-fixtures`. The two failure-cleanup
fixtures supply the new optional flag's default value; their shutdown/preservation
assertions remain unchanged. All 178 desktop frontend unit tests pass
in `parity-draft-recovery-frontend-unit`, with one worker.

All **38 focused renderer journeys pass**, one worker and zero retries, in
`parity-draft-recovery-renderer-expanded`: fourteen recovery journeys and twenty-four
existing editor regressions. Runtime inputs stayed unchanged; only this
specification's Clippy result changed during the run. The earlier compact
screenshot was visually reviewed. Cases include a missing original and refused
source cleanup after a confirmed save. These are browser interaction/protocol
tests; their stateful fake transport is not native storage evidence.

The intermediate production renderer passed at approximately 1.39 MB under the
unchanged 1.40 MB error budget; 53 production JavaScript assets pass the preview
isolation check. Its binary build was deliberately cancelled when review found
the unsupported-platform discard regression. It does not qualify a package.

The corrected Debian package builds and verifies in
`parity-draft-recovery-corrected-package`; all 726 captured inputs stayed unchanged.
Its SHA-256 is
`4275592aacabd5ced30a563b244810d6048a7b1f4e8d76a0f7a3024a8267bf0f`.
The extracted packaged executable has SHA-256
`288794ebd65023f4110defead7192dffd659a5147fe316f868bfd0741ab86f1b`;
this is the identity used for acceptance, distinct from the release-directory
executable recorded separately in the build receipt.

Actual process-kill/relaunch acceptance passes all 13 scenarios (ten smoke and
three recovery) in `parity-draft-recovery-native-crash-private-drivers`.
The private cache is acknowledged and its exact bytes, owner and 0700/0600
directory/file permissions verified before SIGKILL. A pidfd, executable hash,
private profile and process start time bind the crash to the owned fixture app.
Relaunch creates a different process with the same cache bytes. Explicit inert
review/load preserves working-file, index, refs and config; only an explicit save
writes the recovered text, preserving BOM/CRLF and cleaning the reviewed source.
The native screenshot was visually reviewed. The initial attempt failed before
launch because WebKitWebDriver was absent from PATH; the successful run uses the
existing private driver directory and does not install host packages.

The full normal native suite also passes **216 distinct scenarios** on that same
package and packaged-executable hash in `parity-draft-recovery-native-full`.
The inherited-environment suite passes **217 distinct scenarios** in
`parity-draft-recovery-native-environment`, preserving the outside repository
whose Git context variables were inherited by the app. The two full suites total
433 executions covering 217 distinct scenarios. The dedicated thirteen-scenario
run is a subset, not thirteen additional capabilities.

An additional focused run passes all **14 scenarios** with
`--suite recovery --inherited-git-environment` in
`parity-draft-recovery-native-context-oracles`. It independently checks the cached
original branch/HEAD against Git CLI output and encoding/normalized baseline
hash against known bytes. It uses the same packaged executable and adds stronger
metadata oracles to the crash/relaunch workflow. These counts are not additive
capabilities beyond the full suites.

The monolithic full renderer attempt, `parity-draft-recovery-renderer-full`,
was deliberately stopped with exit 143 after two failures. One browser bootstrap
failed before interaction when `main.js` and six chunks reported
`ERR_NETWORK_CHANGED`; the underlying network cause is unproven. Another case
still expected three welcome actions. It now requires four and explicitly checks
the new recovery action, retaining the existing shortcut and layout assertions.
Both failures and their diagnostics are retained.

Replacement full acceptance uses four serial Playwright shards, fresh
browser/server processes, one worker and zero retries. Collection proves all
1,438 cases occur exactly once (360, 360, 359 and 359), with no static skips.
Partitioning does not establish that the earlier network failure is fixed.
Partition one passes all 360 cases with zero retries in
`parity-draft-recovery-renderer-shard-1`. Application and test inputs remain
unchanged; only this specification's evidence text changed during the run.
Partition two also passes all 360 cases with zero retries in
`parity-draft-recovery-renderer-shard-2`, including the earlier history-replay
bootstrap failure case. This is local acceptance evidence; the earlier network
cause remains unproven and the failed CI attempts remain retained.
Partition three passes all 359 cases with zero retries in
`parity-draft-recovery-renderer-shard-3`, including the LFS case that crashed in
the earlier dev CI rerun. The final partition finishes with 356 passed and three menu failures in
`parity-draft-recovery-renderer-shard-4`. One selector matched both the Edit
section heading and the new Editor draft recovery label. Two layout assertions
found actual overflow at the native minimum and roomy desktop heights. These
failures are retained. The menu correction passes all four focused cases with
one worker and zero retries in `parity-draft-recovery-menu-layout-fix`. The selector
now matches the exact section heading; menu-scoped padding gives the added
command room without hiding descriptions except at the existing compact-height
breakpoint. Tests explicitly require the recovery command in both compact and
roomy layouts. The corrected final partition passes all 359 cases, with no
retries, skips, flaky cases or interruptions, in
`parity-draft-recovery-final-scope-renderer-shard-4`. Its source inputs stay frozen
except documentation updates. Together the passing partitions cover the complete
1,438-case collection. Partitions one through three preceded the menu-scoped CSS
correction and minimal Rust formatting cleanup; the final partition and four
focused menu cases qualify those corrections. This composite local evidence
does not replace exact-head CI qualification after integration.
Final self-review is recorded. Exact-package acceptance passes on the final artifact. Selective integration
and exact-head remote CI remain required.
Controlled filesystem interruption/corruption/quotas/link tests are valuable
separate evidence; they do not establish an actual process crash. The older
editor/tools package already on dev does not qualify this new recovery runtime.
Final exact-package acceptance passes; selective integration and exact-head
remote CI remain outstanding.

Final scoped qualification starts from the two minimal Rust registration diffs,
the menu correction and the 120-minute aggregate CI checks budget. Generated
contract freshness, Angular development build, all-target Rust checking and
Clippy with warnings denied pass in `parity-draft-recovery-final-scope-check`.
Rust formatting cleanup was separately proved equivalent under rustfmt to the
previously qualified source. The final scoped full Rust regression also passes
853 tests with zero failures and 45 optional tests ignored in
`parity-draft-recovery-final-scope-rust`. Dedicated LFS qualification passes all
34 core and seven native transport cases in `parity-draft-recovery-final-scope-lfs`.
All three optional signing cases pass in `parity-draft-recovery-final-scope-signing`,
and all 46 harness cases pass in `parity-draft-recovery-final-scope-harness`.
The corrected final renderer partition passes all 359 cases in
`parity-draft-recovery-final-scope-renderer-shard-4`, with no failures, retries or
skips. The final package build passes in `parity-draft-recovery-final-scope-package`.
Its Debian archive SHA-256 is
`56a24a5fe8a0fb826f0281e7f07859a68cfcb6aff7bdf8d925e36d817b41b7cc`;
the packaged executable is
`be374752bec578330e8ce22bfb3da886590054c19ce0a92e7d35badeb0a7efde`.
The release-directory executable has the separately recorded SHA-256
`f93b12f8ae130a335dd914056b469bb28746ec3971ec5127252f02e6d74504bf`.
The archive, completed build receipt and source snapshot are preserved under
`target/verified-packages/editor-recovery-final-56a24a5fe8a0`. Production rendering
remains approximately 1.39 MB under the unchanged 1.40 MB error budget, with all
53 JavaScript assets passing preview isolation. Exact-package native acceptance
passes all 216 distinct full-suite scenarios in
`parity-draft-recovery-final-scope-native-full`, including owned crash/relaunch
and the stronger metadata oracles. The inherited-environment suite passes all
217 distinct scenarios in `parity-draft-recovery-final-scope-native-environment`,
including preservation of the outside repository. These full suites total 433
executions covering 217 distinct scenarios on the same final artifact.

The focused actual WebKit menu probe also passes in
`parity-draft-recovery-final-native-menu`: ten smoke scenarios plus three new
layout/keyboard checks at 780×560, 1000×640 and 1440×900. It uses standard
WebDriver window resizing, checks all fourteen commands, complete command bounds
at minimum/roomy heights and expected body scrolling at 640 pixels. Recovery
visibility at minimum/roomy sizes, visible Application controls, Home/End focus
and preserved Git index/refs/config are covered. All three screenshots were visually reviewed. Its thirteen
executions are not thirteen additional capabilities beyond the full suites.
The probe source and qualification receipt are preserved beside the final
archive. Earlier package evidence remains retained without substituting for
these final artifact results. Final scoped local qualification is complete;
selective commits, dev integration and exact-head remote CI remain required.
