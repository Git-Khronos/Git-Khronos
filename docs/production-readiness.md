# Production-readiness review

Snapshot: 2026-10-24. This is an evidence-bounded work-in-progress
review, not a release approval or an overall completion percentage. Refresh the
snapshot after the active gates finish; run directories below are local retained
artifacts, not checked-in or published reports.

## Latest rounded graph revision passed native full acceptance

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
`target/validation-runs/native-svg-precision-harness-test/`. The new candidate's
inherited-environment/performance runs and clean complete renderer run remain
release qualifications; this is not an overall production-readiness approval.

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
