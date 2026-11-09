# Production-readiness review

Snapshot: 2026-10-31. This is an evidence-bounded work-in-progress
review, not a release approval or an overall completion percentage. Refresh the
snapshot after the active gates finish; run directories below are local retained
artifacts, not checked-in or published reports.

## Current qualification boundary

The current source includes the streaming ignore-rule fix, reviewed Rust and
frontend notices, and the selective performance/readiness branch integration.
Source checks and the complete renderer suite pass (1,205 cases, zero failures
or retries), alongside unit, LFS, packaging and native-harness tests.
The final Debian artifact has SHA-256
`efa425efbc83c2da9fdf5fe520c544845f37d6606f557e675a5c223cef00d14d`
and passes verification and all 10 native smoke scenarios. Full/environment/
performance acceptance of older artifacts below does not qualify this new
artifact. Windows acceptance has not been run. No system package was changed.

See [the branch integration audit](branch-integration-2026-10-30.md) for exact
current artifact paths and validation evidence. The dated records below retain
the earlier qualification history and its limits.

## Latest packaged executable and frontend-notice qualification

The `73475a44` candidate's exact packaged executable `6d597fd6` passed full
acceptance (134 scenarios, 2026-10-24 22:43:29 UTC), environment acceptance
(135, 22:47:06 UTC) and performance acceptance (11, 22:48:32 UTC). Reports are
under `target/validation-runs/streaming-ignore-native-evidence/`, respectively
`full-1792881620818385192/report.json`,
`environment-1792881839632027383/report.json`, and
`performance-1792882091599943012/report.json`. Each report confirms the preserved
package and executable hashes. Rounded graph paths and avatar bypass clearances
remain 23 per density and approximately 2.54/2.68 px. The 20,000/100,000-commit
fixtures opened in about 897/1,196 ms, with maximum heartbeat gaps 192/160 ms
and at most 57 rendered rows; both have 64 branches and 36 linked worktrees.
These are headless fixture measurements, not universal hardware guarantees.

The frontend audit found that Angular emits `3rdpartylicenses.txt` beside the
embedded `browser` directory, so that generated file was absent from the actual
Debian payload. The packaging hook and both Linux format mappings now include
`frontend-dependency-notices.txt.gz`; the verifier rejects missing/corrupt/stale
payloads and the Task cache tracks its producers and generated outputs.
The original 30,907 bytes cover ten emitted package records. The dialog plugin's
SPDX-only notice does not contain the full declared MIT/Apache terms; its exact
reviewed upstream files are now appended with pinned manifest, registry/lock,
published-SPDX and license-file identity checks, without inventing a template.
The generated prefix remains byte-identical. The complete 42,882-byte payload
has gzip SHA-256 `660567cf9b4427b5dfeb555aea0bb6d22e0de37e5b3f4b6b56fa7c26672c84e9`.
All 55 package/generator/retained-policy tests passed on 2026-10-26 at 11:03:20
UTC under `target/validation-runs/frontend-reviewed-license-package-gate/`.
Real asset preparation passed at 11:03:17 UTC under
`target/validation-runs/frontend-reviewed-license-real-assets/`. A new bundled
artifact and actual payload verification remain required; the existing
`73475a44` candidate is not represented as containing this newer frontend file.

## Latest rounded graph revision passed extracted-package native suites

The user subsequently requested rounded right-angle corners and more avatar
spacing. Current source uses circular quarter turns, 40 px expanded / 32 px
compact lanes, and a 92 px compact default width. The dense adjacent-avatar
route can now use one shared vertical stem instead of backtracking at the row
boundary. All 157 frontend unit tests passed under
`target/validation-runs/rounded-spaced-graph-unit/`. All 21 focused browser,
virtualization, and scrollbar checks passed at 19:37:55 UTC under
`target/validation-runs/rounded-spaced-graph-browser/`. Expanded and compact
screenshots were inspected, and strict graph test type-checking passed under
`target/validation-runs/rounded-spaced-graph-final-types/`.
A fresh complete renderer run was attempted under
`target/validation-runs/rounded-renderer-full/`, with 205-file input snapshot
`target/validation-runs/rounded-renderer-qualification/before.json`, SHA-256
`b468392e90de2d8fed9a169777d2f03aba9957c1415bca01c8e7fb372bcc9734`.
It recorded two 30-second total-deadline failures in the word-wrapped manual
diff-position journeys and was deliberately interrupted at 20:27:23 UTC to
investigate them without competing browser load. Its terminal result is 130,
not a pass. Recorded intermediate position checks were within one pixel, but
that does not prove the remaining layout transitions. The focused reproduction
under `target/validation-runs/wrapped-diff-scroll-existing-server/` also exhausted
the deadline. A separate fresh-server attempt timed out before running tests.
A complete passing renderer report and matching after-input snapshot remain
required; the commit was deferred while these failures are unresolved.
At 20:29:49 UTC, both previously failing cases passed with the original
30-second deadlines and unchanged source/assertions, using one worker and a
ready dedicated server without a competing repository compiler/browser job.
Evidence: `target/validation-runs/wrapped-diff-scroll-serial-original-deadline/`
(2 passed, 38.4 seconds total). This supports contention as the deadline cause;
it is not a replacement for a complete renderer pass. A longer-deadline
diagnostic is not counted: its second case lost its shared server when the
failed broad run was stopped. The complete diff-navigation file passed all
16 cases at 20:32:51 UTC under
`target/validation-runs/diff-scroll-serial-file/`: zero unexpected, skipped, or
flaky cases, original deadlines, one worker, no retries. The frontend/core
fingerprints still matched their successful source-gate snapshots immediately
before completion. A clean full-renderer run remains a release qualification
requirement; these results resolve the observed focused deadline failures,
not the broader unfinished qualification.
The square-corner full renderer run below was deliberately interrupted at
19:32:37 UTC because the requested design changed. It is not a complete pass.
The preserved packages and their 280 native scenarios below do not qualify
this newer rounded/expanded layout or the follow-up Unix pipe fix.

The new rounded/history/LFS Debian build and payload verification passed at
20:24:46 UTC under `target/validation-runs/rounded-history-lfs-package/`.
An exclusive preserved copy is at
`target/verified-packages/rounded-history-lfs-candidate-6d6a56f5/Git-Khronos_0.1.0_amd64.deb`,
SHA-256 `6d6a56f59da9c5b5b8a9cad3aefb3f0c6b8c03b1fb73fe57de2d85e84ca6ad7b`.
The copied hash matches the build output, whose modification time is later
than the build start. This is build/payload proof, not native acceptance.
The initial native-full attempt under
`target/validation-runs/rounded-history-lfs-native-full/` failed its prerequisite
check because the private WebKitWebDriver/Xvfb prefix was absent from PATH;
it ran no scenarios. Retry with the existing extracted driver prefix, without
installing packages or modifying host services.
The driver-prefix retry under
`target/validation-runs/rounded-history-lfs-native-full-driver-retry/` did launch
the exact preserved package, executable SHA-256
`2ed19c54e57160914a0ebcd5f7c822599138275dcd3f34ec213ebcec8fc22dd6`.
It completed ten preliminary scenarios, then failed the shared-parent graph
check because no bypass-clearance samples were collected. This is not a native
pass. The unchanged assertion was reproduced with endpoint diagnostics under
`target/validation-runs/rounded-native-bypass-endpoint-diagnostic/`: WebKit
reported rounded-path endpoint y=40.000003814697266, so exact y=40 comparisons
excluded both real bypass paths. The harness now classifies row boundaries
within 0.001 px and retains the same 0.5 px clearance requirement. It records
the measured endpoints alongside clearance values. Native full acceptance is
passed all 134 scenarios at 20:41:45 UTC against the same preserved artifact
under `target/validation-runs/rounded-native-bypass-tolerance-green/`; no
application code or package bytes were changed to resolve the measurement defect.
Its report is
`target/validation-runs/rounded-history-lfs-native-evidence/full-1792874123019785156/report.json`.
It records 23 rounded orthogonal paths per density and minimum unrelated-avatar
clearances of about 2.54 px expanded / 2.68 px compact. The 28 harness unit tests
also passed at 20:42:23 UTC under
`target/validation-runs/native-svg-precision-harness-test/`. A clean complete
renderer run remains a release qualification;
this is not an overall production-readiness approval.

Post-commit inherited-environment acceptance passed all 135 scenarios at
20:50:17 UTC under
`target/validation-runs/committed-rounded-native-environment/`. Its report,
`target/validation-runs/committed-rounded-native-evidence/environment-1792874783103231830/report.json`,
records the same package and executable hashes, 23 rounded orthogonal paths
per density, and the same approximately 2.54/2.68 px avatar-bypass clearances.
This is extracted-package fixture evidence, not host desktop or real hosted
service acceptance.

Performance acceptance passed all 11 scenarios at 20:51:03 UTC under
`target/validation-runs/committed-rounded-native-performance/`, with no competing
repository compiler/browser suite. Its report,
`target/validation-runs/committed-rounded-native-evidence/performance-1792875034476547351/report.json`,
records the same package and executable hashes. The 20,000/100,000-commit
fixtures opened in about 1,159/1,360 ms, with maximum heartbeat gaps of
318/334 ms and at most 57 rendered rows. Both fixtures contain 64 branches
and 36 linked worktrees. These headless measurements are not universal
hardware guarantees. All 280 native scenarios now pass for the preserved
`6d6a56f5` candidate.

A new complete renderer run is active under
`target/validation-runs/committed-rounded-renderer-full/`, using one worker,
original deadlines, zero retries, a fresh server, and no competing repository
compiler/native suite. Its 205-file before snapshot is
`target/validation-runs/committed-rounded-renderer-qualification/before.json`,
SHA-256 `1cddf8e60a11a35e5c10b74e1b40712cecd0e95f6ed8241593a4323fe4b5c7ab`.
A successful terminal result, complete JSON case accounting and matching
after-input snapshot are still required; starting this run is not a pass.
The run has recorded a failure in SHA-column case 503. Its screenshot is blank;
the retained trace reports `net::ERR_NETWORK_CHANGED` for both `main.js` and an
Angular chunk after reload, before application startup. The missing-row check
therefore did not measure a geometry violation. Keep this failed case in the
report; the remaining run is still being observed, not relabeled successful.
Evidence is under
`renderer/graph-columns-keeps-SHA-al-cb9fa-ph-branch-with-scroll-false-chromium/`
inside that run. A private user/network namespace probe succeeded, including
private loopback setup and pnpm 12.14.0 readiness, with no host interface changes.
It does not itself prove that isolation prevents this browser interruption;
a controlled check and subsequent complete qualification remain necessary.

Terminal follow-up: the run exited 1 at 22:09:17 UTC on 2026-10-24. JSON
accounting contains all 1,185 cases: 1,182 expected, three unexpected, zero
skipped/flaky and no top-level errors. The after snapshot at
`target/validation-runs/committed-rounded-renderer-qualification/after.json`
matches the original 205-file fingerprint. In addition to the bootstrap
interruption, two workspace assertions still expected pre-rounded-layout
dimensions: 44 px instead of the explicit second-lane offset 16 + 40 = 56 px,
and compact width 70 px instead of the independently unit-tested 92 px layout
specification. Those assertions were corrected after the run, without changing
production geometry, deadlines or retries. Targeted revalidation and a new full
qualification remain required; the failed complete run is retained unchanged.
The separate three-case recheck passed at 22:13:48 UTC under
`target/validation-runs/rounded-renderer-three-case-recheck/`, using a fresh
server, one worker, original deadlines and zero retries. JSON accounting
confirms exactly three expected, zero unexpected/skipped/flaky and no top-level
errors. It includes the previously interrupted bootstrap case. This targeted
success does not replace a new successful complete renderer qualification.

The final staged whitespace check found trailing spaces in generated IPC type
declarations. The adapter now normalizes exporter line endings, with a
literal-space-preservation regression, and the bindings were regenerated through
`contracts:generate`. `contracts:check` passed freshness, strict TypeScript and
all three generator tests at 20:44:46 UTC under
`target/validation-runs/ipc-whitespace-contract-check/`. The generated binding
change contains only trailing-space removal; TypeScript transpilation before
and after produced identical runtime JavaScript. The resulting 205-file input
fingerprint is `1cddf8e60a11a35e5c10b74e1b40712cecd0e95f6ed8241593a4323fe4b5c7ab`,
not the earlier byte-for-byte `b468392e` snapshot. No rebuilt-package/runtime
claim is inferred merely from this new fingerprint.

Post-commit installed-launcher inspection confirmed that `/usr/bin/git-khronos`
and `/usr/share/applications/Git Khronos.desktop` belong to the installed
`git-khronos` 0.1.0 package; no legacy `git-khronos-desktop` package was found.
`desktop-file-validate` accepted the entry, whose Exec, Icon and StartupWMClass
are all `git-khronos`. This is metadata proof, not a desktop launch test.
The installed executable SHA-256 is
`def842d8a1563bfff77539f7ded37950a85d58c370dcf46231660d14de7caa6a`,
different from the candidate's `2ed19c54` executable. The shared version number
does not make them equivalent, and current graph/workflow fixes must not be
reported as installed. No system package or personal application was changed.

## Previous square-corner revision and packaging checks

The orthogonal graph update passed all 157 frontend unit tests, strict graph
test type-checking, and 19 focused Chromium attachment/virtualization checks.
Expanded and compact screenshots were inspected. Evidence:
`target/validation-runs/orthogonal-graph-frontend-unit/`,
`target/validation-runs/orthogonal-graph-final-types/`, and
`target/validation-runs/orthogonal-graph-routing-browser/`.
The earlier 1,185-test renderer run and preserved native packages below do not
qualify this newer routing. The broader graph browser run was deliberately
interrupted to run these focused checks; its interrupted result is not a pass.

All 18 package regressions passed at 19:13:16 UTC under
`target/validation-runs/package-uninstall-partial-state-green/`.
These include real isolated APT replacement and unrelated-removal refusal,
plus a newly reproduced verifier cleanup defect: extraction failure unwound
the local temporary-directory variable before the EXIT handler used it.
The handler now captures the owned path safely. Its regression preserves the
extractor's exit code, handles spaces and quotes in TMPDIR, leaves unrelated
files untouched, and requires no extracted files to remain. Pre-fix evidence:
`target/validation-runs/package-verifier-extraction-cleanup-red/`.

The uninstaller also incorrectly reported unpacked/half-configured packages as
not installed because it required the full `ii` abbreviation. It now checks
dpkg's actual package status and offers ordinary APT removal for active and
partial states, including pending triggers. Configuration-only and absent
packages are not removed. No force, purge, or automatic confirmation was added.
The regression covers all six active states, removal-selected installed state,
and inactive states using mocked tools only. Pre-fix evidence:
`target/validation-runs/package-uninstall-partial-state-red/`.
Installer/uninstaller scripts are repository tools, not payload files inside
the preserved Debian artifact; their tests are separate from native app tests.

The fresh Debian build and package verification passed at 19:08:56 UTC under
`target/validation-runs/orthogonal-migration-package/`. A separately preserved
copy is at
`target/verified-packages/orthogonal-migration-candidate-31c600c0/Git-Khronos_0.1.0_amd64.deb`,
SHA-256 `31c600c0a039ee65e2478a50c1bf1a2ac733d1df6b92af263d410437a4581399`.
The actual package declares exactly the legacy `Conflicts` and `Replaces` fields.
Its source payload is newer than the build start, and the copied hash agrees.
The native full suite passed all 134 scenarios at 19:12:56 UTC under
`target/validation-runs/orthogonal-migration-native-full/`. Its report
`target/validation-runs/orthogonal-migration-native-evidence/full-1792868975006512604/report.json`
records the same package hash and extracted executable SHA-256
`b6327b2bf4376b2f8f439178889a5091b26e99212b9b5ff8f73b2313b3fb9091`.
It verifies 23 orthogonal paths per density and bypass clearance of about
1.65 px expanded / 1.71 px compact. The packaged notices match workspace
SHA-256 `bdad01bb06ab4ed711a9d1c887018abb5537bc96781973216e5ceaa8a044023b`.
The inherited-environment suite passed all 135 scenarios at 19:16:27 UTC under
`target/validation-runs/orthogonal-migration-native-environment/`. Its report
`target/validation-runs/orthogonal-migration-native-evidence/environment-1792869206310997929/report.json`
records the same package/executable hashes and graph-path/clearance checks.
Performance acceptance passed all 11 scenarios at 19:17:28 UTC under
`target/validation-runs/orthogonal-migration-native-performance/`. Its report
`target/validation-runs/orthogonal-migration-native-evidence/performance-1792869429730536733/report.json`
records the same package/executable hashes. The 20,000/100,000-commit fixtures
opened in about 797/788 ms, with maximum heartbeat gaps of 198/237 ms and at
most 57 rendered rows. Both fixtures have 64 branches and 36 linked worktrees.
These are headless fixture results, not universal hardware guarantees.
Thus all 280 native scenarios passed for this exact artifact. The 28
native-harness tests passed separately under
`target/validation-runs/orthogonal-native-harness-tests/`.
No system installation is authorized or performed as part of these checks.

The now-interrupted complete renderer attempt is retained under
`target/validation-runs/orthogonal-renderer-full/`. It used a fresh server without
retries. Its before-input snapshot is retained at
`target/validation-runs/orthogonal-renderer-qualification/before.json`:
205 files, SHA-256
`df1aab1cd8956034e5895938dfea916cea49afab717ad3c98d543b546357f178`.
A new complete run with matching before/after inputs is required for the
subsequently requested rounded routing; this interrupted result cannot qualify it.

## Follow-up Unix pipe cancellation fix passed source and native-full gates

A bounded detached-helper regression reproduced a separate cancellation hang:
the capture loop killed Git's process group, then blocked joining readers whose
pipe writers had moved into another session. The fixture validates the helper's
own session/group and private command marker before cleanup. Valid pre-fix
evidence is under `target/validation-runs/escaped-pipe-cancel-valid-red/`;
the earlier `escaped-pipe-cancel-red` compilation failure was a test-only API
typo, not a reproduction of the defect.

The working tree now uses nonblocking, stop-aware Unix output readers and
signals them before joining on cancellation, output-limit termination, or wait
failure. Normal EOF still drains complete output. The first focused regression
passed under `target/validation-runs/escaped-pipe-cancel-green/`; the extended
cancel/limit cases and complete ordinary core suite passed at 19:29:04 UTC under
`target/validation-runs/escaped-pipe-core-suite/`: 527 passed and 37 specialized
cases deferred to their dedicated gates. The earlier broad source run under
`target/validation-runs/escaped-pipe-source-gates/` finished with a missing-sshd
prerequisite failure in its SSH gate; its other nine targets passed. The actual
loopback SSH test then passed at 19:40:48 UTC using the existing private
OpenSSH extraction under `target/validation-runs/escaped-pipe-ssh-prerequisite-retry/`.
The original failed report is retained, not relabeled successful.
This follow-up production-code change is **not** in the preserved `31c600c0`
package; its separate source and rebuilt-package evidence is recorded below
and in the latest-candidate section above.
Windows retains its existing pipe implementation and is not qualified by the
Linux reproduction.

The separate history reader also reproduced this hang in both cancellation
and output-limit cases. Valid pre-fix evidence:
`target/validation-runs/escaped-history-pipe-valid-red/`. Both focused cases
passed after adding the same stop-aware reads under
`target/validation-runs/escaped-history-pipe-green/`.

LFS reference scans independently reproduced cancellation and deadline hangs
under `target/validation-runs/escaped-lfs-pipe-valid-red/`; its parser-refusal
control already passed. The fix interrupts the scan reader only on failed
outcomes, preserving the rule that partial/failed scans never authorize pruning.
All three focused cases passed under
`target/validation-runs/escaped-lfs-pipe-green/` at 19:54:43 UTC. The shared test
fixture's extra detached session is identity-checked and reclaimed separately;
the production code does not chase or signal arbitrary detached processes.

The fresh combined source/transport gate passed all ten targets at 20:08:27 UTC
under `target/validation-runs/rounded-history-lfs-source-gates/`, with the
verified private SSH prerequisite explicitly configured. Coverage includes
157 frontend tests, strict graph type-checking, 8 owned-process checks, 532 core
tests, 11 desktop tests, 8 ordinary transport cases, 12 clone-policy cases,
the gix trust regression, 34 core/7 desktop LFS cases, real SSH, 3 signing cases,
18 package tests, 28 native-harness checks, Angular development compilation,
Rust all-target checks, strict Clippy, and no known pnpm audit findings. The
37 specialized core cases omitted from the ordinary suite were run by their
dedicated LFS/signing gates.

The qualified input fingerprints remained unchanged. The 55-file core scope
(core sources/tests plus Rust workspace/toolchain manifests) is
`0ff10e5b7a07f26e5a4ca4d04886b6aad677720c4540d72664b762838c209b9e`;
the 205-file frontend scope remains `b468392e90de2d8fed9a169777d2f03aba9957c1415bca01c8e7fb372bcc9734`.
Evidence: `target/validation-runs/rounded-history-lfs-qualification/after-source-gates.json`.
These scopes do not purport to fingerprint every desktop or packaging input.

The Debian build under `target/validation-runs/rounded-history-lfs-package/`
passed with two Cargo build jobs and workspace temporary storage. The preserved
`6d6a56f5` candidate and its 134 native-full scenarios qualify the rebuilt
history/LFS/rounded-UI artifact at that scope; the earlier `31c600c0` artifact
contains none of those follow-up changes. The ordinary native scenarios do not
replace the dedicated core detached-pipe reproductions. No installed package
has been changed.

## Previous candidate passed extracted-package native acceptance

The fresh Debian build and package verification passed at 17:54:05 UTC. An
exclusive preserved copy is at
`target/verified-packages/transport-stderr-candidate-97952c36/Git-Khronos_0.1.0_amd64.deb`,
SHA-256 `97952c3641bd6152eb61933982e464b666947550d8827c736fe852365327cb57`.
Its modification time follows the build start, and its hash differs from the
earlier candidate below. At qualification, the core and frontend source
fingerprints matched their qualified runs; the subsequent orthogonal routing
and package-transition changes are not covered by this candidate.
The package contains `/usr/bin/git-khronos`; its packaged
`THIRD_PARTY_NOTICES.md` has the same SHA-256 as the workspace file:
`bdad01bb06ab4ed711a9d1c887018abb5537bc96781973216e5ceaa8a044023b`.

Full native acceptance of that exact copy passed at 17:58:39 UTC: all 134
scenarios, including both shared-parent avatar modes, with no shutdown failure.
The report records the same package SHA-256. Evidence:
`target/validation-runs/transport-stderr-native-evidence/full-1792864548790253110/report.json`.
The inherited-environment suite then passed all 135 scenarios at 18:02:25 UTC,
and performance acceptance passed all 11 scenarios at 18:10:52 UTC. Reports:

- `target/validation-runs/transport-stderr-native-evidence/environment-1792864774776965571/report.json`
- `target/validation-runs/transport-stderr-native-evidence/performance-1792865430338800985/report.json`

All 280 scenarios passed against the same package and extracted executable
SHA-256 `3514eb5687a65bbd088655416fba5e442bd3b0e05725e85be6f54e9ed6469ed9`.
No report records a failure, failed process shutdown, or failed fixture cleanup;
all three wrapper jobs exited successfully and their runners are gone. The
performance fixture recorded approximately 928 ms to open 20,000 commits and
826 ms for 100,000 commits, each with 64 branches and 36 linked worktrees.
Maximum heartbeat gaps were 140 and 192 ms respectively, with no more than 57
rendered commit rows. These are headless fixture measurements, not universal
hardware performance guarantees. No system installation has been performed.

The legacy package-name upgrade path exposed another confirmed defect after
this candidate was qualified. An independently constructed legacy package
owns the same desktop-file path; the original metadata fails with an explicit
dpkg overwrite refusal in a private database. Valid pre-fix evidence:
`target/validation-runs/legacy-package-migration-red-isolated-log/`.

The working tree now declares `Conflicts` and `Replaces` scoped exactly to
`git-khronos-desktop` and verifies those fields. A version-2 APT transaction
guard permits only that legacy removal before dpkg runs. Fresh installations
retain `--no-remove`, and the legacy branch still requires APT confirmation.
Eighteen package tests now pass under the current package gate above, covering
private dpkg replacement, missing/broader metadata refusal, action framing,
unrelated-removal refusal, installer command construction, and temporary-hook
cleanup on success and failure. Real isolated APT checks also pass: the user
can decline without any package changes; confirming replaces the legacy
package; a transitive conflict requiring an unrelated removal is rejected
before any mutating dpkg invocation. Existing APT hooks retain their original
protocol. The initial negative-fixture formatting error and hook-cleanup
defect were corrected without weakening assertions. The real APT CLI hook gate
also passed independently under
`target/validation-runs/legacy-package-migration-real-apt-cli/`.

These use an isolated configuration and package database, not host-package
installation. The new metadata is **not** present in the preserved
`97952c36` candidate. Rebuild and qualify a new artifact before recommending
legacy upgrades; do not apply force-overwrite or remove host packages to make
the tests pass. No installed packages have been changed.

## Earlier candidate and source are different validation scopes

The extracted Linux package at
`target/verified-packages/shared-parent-avatar-candidate-f9122055/Git-Khronos_0.1.0_amd64.deb`
has SHA-256
`f912205531d9332062c7233ea176c1f7185fbddff1a4159eb9223d9d475e1c11`.
Its current reports agree on that exact hash:

| Gate | Recorded result | Local report |
| --- | --- | --- |
| Native full | Passed, 134 scenarios | `test-results/native/full-1792851382480987930/report.json` |
| Native inherited environment | Passed, 135 scenarios | `test-results/native/environment-1792851736700472023/report.json` |
| Native performance | Passed, 11 scenarios | `test-results/native/performance-1792852066937010777/report.json` |
| Earlier full renderer | Finished: 1,181 passed, one timeout, no skips/flaky tests | `target/validation-runs/shared-parent-avatar-renderer-full/` |
| Last complete renderer before orthogonal routing | Passed: 1,185 tests, no skips/flaky tests/errors; unchanged 205-file frontend fingerprint | `target/validation-runs/graph-readiness-renderer-full/` |

The package includes the shared-parent avatar routing correction. The later
source changes selecting Tokio 1.53.3 and gix 0.90.0 are **not** included in that
package. Dependency resolution, license checks, and formatting do not substitute
for compilation, behavioral tests, or packaged acceptance of those changes.
The source test/build-check/strict-Clippy gates subsequently passed at 15:57:50
UTC, including the new trust-policy regression. Those dependency changes are
now covered by the new candidate's separate native reports above, not by this
earlier artifact's reports.

## Next local correctness and reliability work

1. The renderer readiness defect is now qualified without hiding the earlier
   failure. The earlier run finished at 15:53:32 UTC with all 1,182 cases accounted for and
   unchanged renderer inputs. All six avatar-attachment cases passed.
   In the recorded column-order timeout, browser
   call `call@42043` returned `problems: []` in about 25 ms, while the corresponding
   test-worker call `pw:api@138` settled after about 7.9 seconds, beyond the
   3-second client polling deadline. This establishes a delivery/timing gap, not
   a measured geometry violation or the exclusive cause of the delay.
   Preserve the trace under
   `renderer/graph-columns-keeps-column-3496e-raph-aligned-while-resizing-chromium/`.
   The browser-side readiness wait preserves those predicates and deadline,
   including a negative control that still rejects invalid geometry. No timeout
   increase, retries, or reduced layout coverage were used to obtain a pass.
   The subsequent complete 1,185-case renderer run passed at 17:36:46 UTC;
   before/after frontend SHA-256 was unchanged:
   `314ba14cd399f8f009460ac6df181e409f4c8f49e12c73ea8b9e3342430dbda0`.
2. Rust dependency qualification passed for the preserved `97952c36` artifact.
   Source gates passed at
   15:57:50 UTC, including the new independent
   `crates/git-core/tests/gix_trust_policy.rs` regression and strict Clippy.
   The same regression fails at its intended trust-protection assertion against
   0.88.0 in a scratch project, without rolling back application dependencies.
   The separately gated transport suites and all 280 native scenarios then
   passed for that artifact. The deferred source-gate controller records UI evidence separately;
   source-gate success cannot turn a failed UI qualification green.
3. Bounded transport stderr qualification also passed for that artifact.
   The previous reader drained stderr into an unbounded vector and the
   classifier created a lossy, lowercased copy. A verbose helper could therefore
   cause excessive memory use. The working-tree implementation now retains a
   64-KiB excerpt while collecting diagnostic facts from the complete stream;
   generic local-command stderr remains complete. The current core regression
   run passed at 17:40:12 UTC (526 passed, 37 specialized tests deferred to their
   dedicated gates). The complete source/transport gate subsequently passed at
   17:46:29 UTC. The new candidate subsequently passed all 280 extracted-package
   native scenarios; installed-package migration remains a separate check.
   A correct fix must drain continuously and classify the complete stream with
   bounded state, including markers outside the retained excerpt. Preserve
   credential redaction, quoted-target exclusions, UTF-8/chunk boundaries,
   CR/LF semantics, cancellation, and complete generic local-command output.

The superseded avatar candidate's orphaned renderer child was found and
interrupted after process identity and report-path verification. Its reports and
the correction to the earlier controller-stop assumption are retained in
`target/validation-runs/avatar-side-attachment-renderer-full/`.
Its incomplete results do not qualify either candidate. Concurrent execution
may have added load, but does not prove the cause of the current timing failure.

Lifecycle follow-up, 2026-10-24 15:40 UTC: the maintained Linux runner
`tools/run-validation.mjs` now uses private command groups, propagates
interruption, waits for cleanup, and records interrupted results. Eight
lightweight process/CLI regressions passed, including parent-first exit,
resistant descendants, unrelated-group isolation, nested signal propagation,
and report-write failure. Evidence is retained under
`target/validation-runs/owned-process-lifecycle-reporting-qualification/`.
This fixes the validation lifecycle defect for future launches; it does not
retroactively qualify the incomplete old run or excuse the current UI failure.

Readiness-wait follow-up, 2026-10-24: a controlled four-second browser-reply
delivery delay reproduces the old client-polling timeout on valid geometry.
The corrected browser-side wait keeps the same three-second readiness deadline
and every original geometry predicate/tolerance; it captures title and geometry
assertions from one report. Transient-invalid and persistent-invalid controls
pass, with the latter still rejecting at three seconds. Thirty focused browser
checks (three repetitions of those controls, the original failing ordering, and
all six avatar cases) passed with no skipped, unexpected, or flaky tests and
unchanged inputs. Evidence: `target/validation-runs/graph-layout-readiness-focused/`.
Strict checking of all graph test files and eight process tests are now
dependencies of `desktop:test`; their individual gates and the dependency audit
passed. The complete ten-target source/transport gate passed at 16:30:28 UTC,
before the new stderr changes. The subsequent 1,185-case UI run finished at
17:36:46 UTC with every case passed, zero skipped/unexpected/flaky tests, and
an empty errors list. Its frontend fingerprint matched before and after the
run. This qualifies the renderer changes, but not the new Rust stderr code or
a newly built native package.

Transport-stderr follow-up, 2026-10-24: validation began after that UI job
terminated, keeping heavy validation serialized.
The pre-fix core source and two real-Git regression tests were preserved under
`target/validation-runs/transport-stderr-baseline/`; its original and copied
48-file snapshots had identical SHA-256
`cc7d869b97a2720f7655f747d2c3a15c0b572a77391800ba9850f128e5d87466`.
The baseline run finished at 17:37:09 UTC with the intended retention failure:
the old reader retained 1,048,686 bytes despite the 65,536-byte test bound. The
late-marker classification control passed. That is a valid pre-fix regression,
not a failure of the new implementation. The first current-core attempt then
caught an incorrect matcher API method name at compilation. That failed report
is preserved under `target/validation-runs/transport-stderr-green/`. After
correcting the call to the published `Automaton::is_match` API, the narrow retry
passed at 17:40:12 UTC: 526 tests passed, zero failed, and 37 specialized tests
remained explicitly ignored for their dedicated gates. Evidence:
`target/validation-runs/transport-stderr-green-api-retry/`.
All nine new stderr tests passed, including streaming/full-output classification
equivalence, 2,048 deterministic fragment combinations, long lines and late
delimiters, chunk and UTF-8 boundaries, interrupted/erroring reads, complete
generic output, real successful fetches, and late failure markers. A diagnostic
debug-profile sample scanned a 4-MiB unterminated stream in about 557 ms; this is
not a release performance threshold or native-package qualification.
The complete ten-target source and specialized transport gate then passed at
17:46:29 UTC, with cache use disabled. It includes development compilation,
workspace checking, strict Clippy, 157 frontend tests, strict graph-test checking,
eight process-lifecycle tests, the workspace tests, 34 core plus seven desktop
LFS cases, one SSH acceptance case, three signing cases, ten package-script
tests, 28 native-harness tests, and a clean JavaScript dependency audit. This
evidence is retained under `target/validation-runs/transport-stderr-source-gates/`.
The 53-file core SHA-256 remained
`9f8f831b50c651215b7a801466cf93b0b5c846e3d2e80296537e060f5d3e662d`,
and the frontend fingerprint remained unchanged. A fresh Debian build started
under `target/validation-runs/transport-stderr-package/` at 17:47 UTC; it is not
a passed package gate yet. Package/native
qualification must use a subsequently rebuilt artifact's own hash.

The deferred controller at
`target/validation-runs/transport-stderr-qualification/state.json` was started
at 17:10:34 UTC and confirmed waiting for the exact existing UI runner and
controller. It will not terminate that UI job. It requires successful full UI
qualification before running the baseline, current core tests, and complete
source/transport gates, in that order. Its 53-file core-input fingerprint is
`3d7bde421a8e5a3804177b708aff4bdd53ab63ce147780ef20c452157db1ea36`;
input drift or any unexpected test result stops the chain for investigation.
That controller correctly stopped at the compilation failure. The narrow retry
and subsequent full source gate use separate retained run directories; the old
controller's `needs-investigation` state remains historical evidence and is not
rewritten to green. Source success, if reached, still leaves new-package/native
acceptance pending.

## Acceptance limits that remain explicit

Post-commit notice-coverage audit: locked, offline Linux Cargo metadata exposes
376 packages in the desktop normal-dependency closure, with no missing license
declarations. Excluding proc-macro subtrees leaves 314 candidate packages and
29 proc-macro boundaries. These are metadata inventories, not exact linked
artifact SBOMs; default/workspace feature unification and linker elimination
must not be confused with release payload proof. The latter inventory still
includes MPL-declared `option-ext`, `selectors`, `cssparser`, `dtoa-short`, and
`uluru`. The curated Rust notice names only `uluru`; the preserved Debian
payload contains the curated notice and copyright file, not a resolved license
inventory or source-availability catalog. Packaging verification currently
checks notice presence/content equality, not completeness for linked dependencies.
Before publication, qualify release dependency selection and generate/verify
the required upstream notices and source-availability information. Do not infer
redistribution compliance from declared identifiers, existing file presence,
or the 280 successful native scenarios. Mozilla's primary MPL FAQ describes
source-availability notice requirements for compiled third-party MPL code:
<https://www.mozilla.org/en-US/MPL/2.0/FAQ/> (Q8).
This audit does not establish that every metadata package is linked, that the
current local build has been externally distributed, or an overall legal opinion.

The standalone `tools/collect-rust-notices.mjs` collector now traverses a
conservative normal/build closure, preserves upstream notice bytes and hashes,
and records versioned crates.io source-archive locations. It rejects missing
terms, unreviewed declarations/sources, escaping or linked files, invalid text
and oversized inputs. Nine synthetic-fixture tests passed under
`target/validation-runs/rust-notice-collector-unit/`. This is not yet connected to
package preparation or its verifier. The first real-metadata attempt correctly
stopped at `tauri-specta 2.0.0-rc.21`, whose published crate omits a notice file.
Its canonical upstream license was then verified at the package's recorded VCS
revision and preserved verbatim in
`packaging/licenses/tauri-specta-2.0.0-rc.21-LICENSE`; its Git blob exactly
matches `6d135f35f014e78278507b868d6617018e16b488`, SHA-256
`79b0c7d284efc4c2dc8da73c01a6d10c19caf61e70fca813e642dc010049eee7`.
An exact-version exception is now recorded in
`packaging/licenses/reviewed-rust-notices.json` and enforced against registry,
declared license/repository, published VCS revision/path, pinned upstream URL,
SHA-256 and Git-blob identity. All 15 fixture tests passed under
`target/validation-runs/rust-notice-reviewed-final-unit/`, including stale
provenance, edited bytes and malformed-VCS error redaction. The real collector
gets past that exception and next refuses `tauri-specta-macros`.

The separate per-package diagnostic inventory at
`target/validation-runs/rust-notice-gap-inventory.json` inspected 394 selected
third-party packages across the conservative normal/build closure and records
14 remaining missing-notice cases. It is explicitly not a generated successful
catalog. Upstream exact-revision tree inspection located workspace notice files
for several of them. A non-truncated recursive tree for `selectors`' recorded
Stylo revision contains no MPL license document; the Apache/MIT files belonging
to sibling crates must not be substituted for this MPL-declared package.
Complete real-catalog qualification and packaging integration remain required.
Follow-up: fourteen exact package exceptions now preserve the verified upstream
workspace notices, including both files for dual-license workspaces. All 19
fixture/policy tests passed at 21:43:50 UTC under
`target/validation-runs/rust-notice-retained-policy-unit/`. The new diagnostic
`target/validation-runs/rust-notice-gap-reviewed-inventory.json` checks the same
394 selected packages and leaves only the selectors case unresolved. Its
`passed` field remains false; neither that diagnostic nor the current collector
is represented as a successful complete release catalog. The 14-issue original
inventory and earlier failed attempts remain retained separately.
No generic license-template fallback was added, and the preserved
`6d6a56f5` package has not been replaced or relabeled notice-complete.

The selectors case now uses a separately classified, project-authored MPL
source-availability notice, not a fabricated upstream license file. Its policy
binds the declared MPL-2.0 license, published VCS revision/path, exact `lib.rs`
SHA-256/Git-blob identity and MPL header, versioned crate source archive and
Mozilla license URL. Implementation text is inspected only as provenance
evidence and is not copied into catalog output. The fixture suite now passes
23 tests, including false upstream identity, edited source/header, missing
retrieval information and changed hashes. The full locked offline Linux
normal/build closure collected successfully at 22:00:07 UTC on 2026-10-24:
394 third-party packages and 702 notice entries, with exactly one
project-authored source-availability notice. The retained result is
`target/validation-runs/rust-notice-complete-catalog-file-check/`.
An earlier inline-command attempt failed because Nx shell forwarding removed
JavaScript string quotes; that failed result is retained separately, and the
successful check uses a file-based script. This collector check is not package
integration, an exact binary SBOM or overall redistribution approval. The
preserved Debian payload has not changed.

Package integration now runs this collector from `beforeBundleCommand` using
Tauri's explicit target triple and locked offline Cargo metadata. Debian/RPM
file mappings include `rust-dependency-notices.json.gz`. The Debian verifier
requires a valid gzip payload that matches the generated catalog byte-for-byte;
Task inputs and generated outputs now cover the collector, generator, reviewed
policy/notices and resulting catalog. The real preparation hook passed at
22:03:05 UTC under `target/validation-runs/rust-notice-real-package-assets/`.
The 46 collector/generator/private-package regression tests passed at 22:03:17
UTC under `target/validation-runs/rust-notice-packaging-unit/`, including
missing/corrupt/stale notice rejection and cache invalidation. A fresh bundled
Debian artifact has not yet been built or accepted against these changes;
earlier candidate acceptance remains tied to its original, unchanged payload.
Neither the catalog nor fixture verification establishes JavaScript/native-OS
dependency coverage, application-source distribution obligations or legal
approval for publication.
The normal `desktop:package-test` target now includes collector and generator
tests as well as package fixtures. All 47 tests passed at 22:12:28 UTC under
`target/validation-runs/rust-notice-standard-package-gate/`, including a check
of both Linux format mappings and the preparation hook. The generated gzip
catalog SHA-256 is
`5fac5c2819ede1e738567139346fc6d7fb870b7841dc85af316bcf29fa3cf5a4`;
the preserved candidate's SHA-256 remains `6d6a56f59da9c5b5b8a9cad3aefb3f0c6b8c03b1fb73fe57de2d85e84ca6ad7b`.

The notice-enabled Debian build passed at 22:19:06 UTC on 2026-10-24 under
`target/validation-runs/rust-notice-integrated-debian-build/`. Its separately
preserved artifact is
`target/verified-packages/rust-notices-candidate-370a012e/Git-Khronos_0.1.0_amd64.deb`,
SHA-256 `370a012e6a2c5654e39bde16bc78a7998b6135117d409494f3c48f4a897721d2`.
The real package verifier accepted it; independent extraction confirmed the
catalog matches generated bytes, SHA-256 `5fac5c2819ede1e738567139346fc6d7fb870b7841dc85af316bcf29fa3cf5a4`.
Its executable SHA-256 remains
`2ed19c54e57160914a0ebcd5f7c822599138275dcd3f34ec213ebcec8fc22dd6`,
the exact executable previously exercised by the 280 native scenarios. No
system installation or publication occurred. The later streaming ignore-rule
change described below is not included in this preserved package.

Post-commit read-only review: `validate_worktree_path` rejects NUL, LF and CR
before ignore-rule construction, so the suspected multi-line-filename rule
injection is not reachable through `ignore_path`. Existing tests also cover
literal wildcard names, foreign locks, byte/CRLF preservation, symlink refusal
and preservation of staged content. No fix was made for that ruled-out concern.
One resource-boundary candidate remains for a focused follow-up after the
frozen renderer run: `ignore_rules::update` still reads the complete existing
`.gitignore` with `fs::read`. Investigate large-rule-file memory behavior and
streaming alternatives without weakening byte preservation, duplicate-rule
detection, permissions, lock ownership or stop-tracking failure protections.
This is an audit lead, not a measured allocation failure or a claimed fix.

Follow-up resource probe confirmed one precise failure in the current helper:
after reading a 64 MiB ordinary sparse `.gitignore`, growing its vector to
append a rule requests 128 MiB. A child capped at 96 MiB address space aborted
with `SIGABRT` and left its lock. Core dumps were disabled and no host memory
limit was changed. This exercises the helper with fixture error/Git adapters,
not the whole IPC/desktop path. The earlier 512 MiB/128 MiB experiment failed
its initial read gracefully; its first adapter incorrectly used `unwrap()`.
That fixture panic is not evidence of a product crash.

The helper now scans with a 64 KiB buffer and constant-size line-match state,
then streams a second pass only when an update is needed. Duplicate rules stay
no-ops; existing bytes, CRLF/non-UTF8 content, permissions, hard-link isolation,
foreign locks and stop-tracking staging protections remain covered. The same
64 MiB/96 MiB probe passes at 22:25:30 UTC under
`target/validation-runs/ignore-memory-growth-green/`, checking the original
prefix SHA-256, exact appended bytes, successful exit and lock removal.
The red result remains at `target/validation-runs/ignore-memory-growth-red/`.
All 20 ignore-filtered core unit cases and three clone-policy cases passed at
22:25:08 UTC under `target/validation-runs/ignore-streaming-core-regressions/`.
Three new scanner tests cover bounded long lines, CRLF across chunk boundaries,
interrupted reads, non-UTF8 matching and read-error propagation. Broader gates
and a rebuilt application package remain required for this newer core change.
A workspace-wide formatting check also found existing differences in unchanged
files; only the edited ignore module was formatted, without rewriting unrelated
sources or representing the overall formatting check as green.

The broader `desktop:test`/`desktop:check` run passed at 22:28:43 UTC on
2026-10-24 under `target/validation-runs/ignore-streaming-workspace-gates/`:
157 frontend tests, 535 core tests, 11 desktop unit tests, eight ordinary
authentication/transport tests, 12 clone-policy tests and one gix trust-policy
test, plus strict graph-test types and eight owned-process tests. The development
renderer build, workspace/all-target Cargo check and Clippy with warnings denied
also passed. Explicitly ignored SSH/LFS/signing tests are not counted as covered
by that ordinary gate; a separate dedicated run is required. The 55-file core
source/test/manifest fingerprint is
`867fcc08adaf408edf37a30682b1888499aeb67ad619e39010ae93af631a16b9`,
captured at 22:31:06 UTC. That fingerprint does not cover all desktop or
packaging inputs and is not interchangeable with an executable/package hash.
The dedicated SSH/LFS/signing run passed at 22:31:37 UTC under
`target/validation-runs/ignore-streaming-dedicated-transports/`, using the
existing private SSH fixture server and local transport/signing fixtures,
without changing a host SSH service or publishing remote changes.

The subsequent Debian build passed at 22:39:05 UTC on 2026-10-24 under
`target/validation-runs/ignore-streaming-notice-debian-build/`. The preserved
artifact is
`target/verified-packages/streaming-ignore-candidate-73475a44/Git-Khronos_0.1.0_amd64.deb`,
SHA-256 `73475a44ad22d32aa2f15ed4e2c958ecc281f9a1f90f40ebac51bbf2c5f2a445`.
The package verifier accepted it; independent extraction verified that the gzip
notice catalog still matches the generated `5fac5c28` bytes. The packaged
executable SHA-256 is
`6d597fd605b9a281fcd07a2097a5dd7a0e41e43e6a5334a854409e74c658d9b9`.
Do not substitute the build-directory executable's different `acc73d4e` hash.
An independent full-byte comparison establishes that the only difference is
the three-byte Tauri bundle marker `UNK` becoming `DEB` at the marker beginning
at offset 1,653,967. The locked `tauri-utils 2.10.1` source explicitly defines
that patchable marker. Both files are already stripped; stripping is not the
explanation for this difference. All other executable bytes match.
The `streaming-ignore-native-full` run is testing the preserved package, not
the build-directory binary. Its terminal result and exact report hashes remain
required; previous native acceptance of `2ed19c54` is not acceptance of this
changed executable. No system installation or publication occurred.

As documented in [Linux acceptance](linux-acceptance.md), headless tests of an
extracted package do not establish system-installed desktop-entry integration,
hardware-key behavior, distribution-wide compatibility, or real hosted-service
acceptance. [Authentication support](authentication.md) also distinguishes the
loopback HTTPS/OpenSSH fixtures from production services, agents, MFA, and proxies.
Windows and macOS acceptance remain separate from Linux evidence.

The [roadmap](../ROADMAP.md) additionally identifies remaining accessibility and
assistive-technology review, string externalization, AppImage, published
checksums, SBOM, and signed-update work. Existing source features and local
package builds do not establish completion of those deliverables.

No system installation, service/network changes, publication, or Git commit is
implied by this review. Any such operation needs the applicable user authority.
