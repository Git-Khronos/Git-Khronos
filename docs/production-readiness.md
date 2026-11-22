# Production-readiness review

Snapshot: 2026-11-20. This is an evidence-bounded work-in-progress
review, not a release approval or an overall completion percentage. Refresh the
snapshot after the active gates finish; run directories below are local retained
artifacts, not checked-in or published reports.

## Installed workspace editing and live recaps — 2026-11-21

The Jammy-built candidate at `c6a1edf` completed **189 installed checks** on
Ubuntu 24.04 with stock Git 2.43: setup and keyboard (49), worktrees (23),
application updates (21), GitLab (47), recovery (23), and incoming links (26).
The setup suite exercised the installed workspace create/rename/cancel flow and
verified that an external edit updates the line recap even when Git's status
record is unchanged. All six reports matched the package, installed executable,
and desktop-entry hashes. The exact package also passed an APT dry run.

Package SHA-256:
`4b9ab546d9f6d0b8c64109191766bb502f31ed3b28558e51c0e2ea99d5800a25`.
The installer, receipt, and reports are retained under
`target/local-review/updater/jammy-builder/workspace-editing.s9lPFhe9/`.
Only the acceptance driver used the follow-up menu-readiness change at
`980e5b9`; the installer bytes did not change. This checkpoint does not qualify
paired rename staging, which was added after this installer was built.

The preceding live-recap candidate at `a6838ee` has now completed the full
**274-scenario installed environment suite** on Ubuntu 24.04 with Git 2.53.
It reproduced the +2/−1 recap after an external edit without a status change.
Only the harness changed for the passing run: `980e5b9` captured the native
root-history menu action when it was ready, before sending one click. The
strict installed release preflight accepted package SHA-256
`a8c829fd648e6dcc4a7d8bfa989fb564a2ed1764030c9140afc5a8b538655fa4`;
the report, receipt, and installer are retained under
`target/local-review/updater/jammy-builder/live-recap.oD1hX1mY/`.

The next Jammy candidate, `52b6dcb`, passed **190 installed checks** across the
same six Ubuntu 24.04 suites with stock Git 2.43. Its staged rename reported
`R  before.txt -> after.txt` and +2/−1; unstaging returned the original
deletion and an untracked destination without changing the working file.
All six reports matched the installed executable, desktop entry and package
hashes. Package SHA-256:
`d72c3bdbcfda9c563d05b50d257af2e19780f3a1c2f49fa12fe3833716c77c11`.
The unchanged artifacts and reports are under
`target/local-review/updater/jammy-builder/paired-index-rename.inkJbl3s/`.
The same bytes passed all **276 installed environment scenarios** with Git
2.53 on Ubuntu 24.04, the strict release evidence preflight, and an APT dry
run. The package-matching suite summary, receipt and checked digest are
retained in that directory.
This does not qualify the subsequent rename diff or Tags restoration changes.

The rename-diff candidate at `1db7a28` passed **51 installed setup and keyboard
checks** on Ubuntu 24.04 with Git 2.43. The exact artifact showed the original
path and +2/−1 in both staged and unstaged previews, with zero partial action
controls and unchanged checkout contents. The package SHA-256 is
`04740fa2b99b4958ca87a21a0f0eb62b7945cc830383190a3cf42a3aad3c4a91`;
the receipt, independently checked package and report are under
`target/local-review/updater/jammy-builder/rename-diff.4TrqrXpZ/`. The other
stock-Git suites also passed on those bytes: worktrees, GitLab, updates,
recovery, and incoming links. All six reports were matched to the installed
executable and launcher. This checkpoint does not qualify the later Tags
changes or replace the full matrix.

The same rename-diff package subsequently passed all **277 installed
environment scenarios** on Ubuntu 24.04 with Git 2.53. The strict release
evidence preflight accepted its exact digest and the APT dry run passed.
The final report, verified digest, and dry-run transcript are retained with
that same artifact.

The Tags restoration candidate at `b80a99e` passed all **32 installed
remote-review checks** on Ubuntu 24.04 with Git 2.43. These include pushing,
renaming and deleting a tag through the actual sidebar after opening the
fixture, while preserving the dirty checkout and using only owned local refs.
The report and package hashes match the installer
`4150bffd1d7a4c479ef773eaae29b54e420b95f13c172e57688a0ce22baa386f` in
`target/local-review/updater/jammy-builder/tags-restore.W7HdWROR/`.
The same candidate passed all **277 installed environment scenarios** with
Git 2.53, including the real tag workflows, and passed the exact-package
release preflight.
This package predates the Tags loading/retry presentation and per-workspace
metadata isolation.

The subsequent workspace-Tags package at `431b6ce` passed the 32 installed
remote-review and 51 setup/keyboard checks on Ubuntu 24.04 with stock Git
2.43. The retained reports explicitly identify Linux userspace and match
installer SHA-256
`b1254e19477dfb11425b2701f9da0d99b2cdbc3dd207c8d97d2d31ef70176991`
under `target/local-review/updater/jammy-builder/workspace-tags.JSKN2MQa/`.
The isolated late-reply cases are renderer regressions; these installed
suites confirm the neighboring real Git and package workflows.
The same bytes passed all **277 installed environment scenarios** on Ubuntu
24.04 with Git 2.53 and passed the strict release-evidence preflight. The
candidate directory contains the exact-package digest and a summary of the
matched reports.

The same workspace-Tags bytes also passed Ubuntu 26.04 smoke (20), GitLab
(47), and application update (21) checks; Debian 12 incoming links (26)
with Git 2.39.5; and Debian 13 smoke (20), GitLab (47), and application
updates (21) with Git 2.47.3. Ubuntu 26.04 used Git 2.53. The Debian 12
incoming-links run used the harness-only dismissal/order
fix and confirmed the same single private-bus process before and after
desktop link delivery. Debian 12 also passed setup/keyboard (51), GitLab
(47), and application updates (21). The fresh Debian 13 image's first WebDriver
session disconnected; a new run with the standard X11 socket directory
provisioned passed. Exact-package reports are under
`target/local-review/runtime-matrix-workspace-tags.qDy7Af33/` and the
candidate directory above. These are disposable local runtime checks, not
the hosted release matrix or publication approval.

The LFS count candidate at `0d84104` passed the 21 installed LFS/smoke
scenarios on Ubuntu 24.04 with stock Git 2.43. The literal-newline fixture
reported two tracked files and one unmaterialized file without changing the
checkout. The older installer reported three and two on the same fixture.
The passing installer SHA-256 is
`e6baff195cbda587a83516b5be900e8f6b2bf28cfcbf30990a8ef20371d00824`
in `target/local-review/updater/jammy-builder/lfs-counts.huiFc5to/`.
It does not include the subsequent LFS inspection timeout.
The same exact package later completed all **278 installed environment
scenarios** on Ubuntu 24.04 with Git 2.53 and passed the strict
release-evidence preflight. The eight stock-Git scenario reports and the
full report were independently matched against the same installer.

That same installer also passed the focused counts suite on Ubuntu 22.04
with Git 2.56.1 and the checksum-verified Git LFS 3.7.1 release archive.
With that fixture, the **278-scenario installed environment run** and strict
release-evidence preflight also passed on Jammy.
The same suite with stock Jammy Git LFS 3.0.2 demonstrated the compatibility
boundary: the helper is available, but the counts are unknown because
`git lfs ls-files --json` is unsupported. The pinned binary is only a
release-qualification fixture, not an install requirement. The timeout
suite's negative control against these pre-timeout bytes reproduced a
20.12-second repository opening; that is baseline evidence, not a pass for
the new timeout.

The timeout candidate at `e3713ee` passed all 21 installed timeout/smoke
scenarios on Ubuntu 24.04 with stock Git 2.43. The same stalled helper no
longer blocked repository opening: it returned in **2.135 seconds**, kept
the counts unknown, verified the helper had exited, and left the checkout
unchanged. The report matches package SHA-256
`348ed4a403e57fcee2ecd1adad6f2ba0b108aaf24c74ce1522d2ee12e5be49ad`
under `target/local-review/updater/jammy-builder/lfs-time-budget.zDVt6ssI/`.
The same package subsequently completed all 278 installed environment
scenarios on Ubuntu 24.04 with Git 2.53 and passed the strict
release-evidence preflight. It does not include the later watcher fix.

On Ubuntu 22.04 the same package passed the installed timeout probe in
2.046 seconds. One ordinary run left the packed checkpoint row stale before
starting GitLab; a same-package retry completed all 45 GitLab/smoke checks.
A controlled negative run on the same bytes then held an actual status read
for 1.5 seconds after Git deleted the packed ref. The independent Git oracle
confirmed the deletion, but the graph kept the row. The report is under
`jammy-held-status-negative.eK0yjWU5/` in the candidate directory. This
separates the watcher race from GitLab and from the LFS timeout change;
the replacement app was built and checked separately.

The replacement at `892519a` passed the controlled installed watcher suite on
Ubuntu 22.04 and 24.04. In both runs the Git oracle confirmed packed-ref
deletion while the wrapper held status; the graph removed the row after
status settled. The same package passed Jammy smoke, GitLab and both LFS
suites, plus smoke, GitLab and application updates on Ubuntu 26.04 and
Debian 13. Its SHA-256 is
`9359c11ddea63ca90aab6a4917ac3b8e74bfc1e6f206d7fb40a7c9cd16cf8406`.
Package-matched reports are retained in
`target/local-review/updater/jammy-builder/watcher-refresh.1o25EHZw/`.
Debian 12's first run failed a direct singleton delivery process check. A
same-package rerun with additional process diagnostics passed incoming links
(26), GitLab (47), and application updates (21). The rerun observed the same
private-bus owner before and after each direct launch and did not reproduce
the original failure; this does not establish a root cause for it.
These local checks are not hosted approval.
The same installer then completed all 278 Jammy environment scenarios.
The exact-package matrix matched all 14 required suite reports across the
five distributions, and the separate publisher-key evidence check accepted
the same digest. The matched matrix and strict-preflight digest are retained
as `installed-release-matrix.json` and `jammy-installed-preflight.sha256`
in the candidate directory. No release signature or publication was created.

The subsequent writer-lock build at `83e2a14` passed all 278 installed
environment scenarios on Ubuntu 24.04 and the optional strict preflight
against that report. Its package SHA-256 is
`afee62f618bc7da092d8f5a87db0ca7d839f6eb9e818b8ed2bc50a09e778e3ca`,
under `target/local-review/updater/jammy-builder/writer-lock.IhuAdfLz/`.
The Jammy full run initially stopped on a partially obscured image row;
the focused media suite then passed all 30 checks with the corrected
harness. A fresh Jammy full-suite run on the same package passed all 278
scenarios in 605 seconds. All 14 required release-matrix checks now match
these exact bytes, and the Jammy strict preflight accepted the same digest.
See `installed-release-matrix.json` and `jammy-installed-preflight.sha256`
in the candidate directory. This does not qualify subsequent renderer
changes or replace hosted qualification and publisher signing.

The checkout-visit candidate at `ed9b22c` also passed all 14 exact-package
matrix checks, including all 278 installed Jammy environment scenarios, and
passed the strict publisher-key evidence preflight. The package SHA-256 is
`ceaca378b84f1a726aff2913ffadb194d428592bdce9a7467cac8ceb0d5e398a`. The
installer, matrix, checked digest, and APT simulation are retained in
`target/local-review/updater/jammy-builder/checkout-visit.i7iBachS/`.
An initial Debian 12 incoming-link report failed before dispatch because a
second observed PID disappeared during inspection. It is retained alongside
the matrix. A same-bytes rerun using the corrected process observation passed
incoming links (26), GitLab (47), and updates (21). The verification still
requires the same live private-bus owner before and after delivery. This
candidate does not include durable unavailable workspace paths.

The saved-workspace build at `7efad11` has package SHA-256
`4c33a3eb93f1b90f475219dd024e5d5b45bda1a6c74e27ef16760ed2b8e6201b`.
On disposable Ubuntu 24.04, the installed app retained both unavailable
paths across a workspace switch, reopened one after its folder returned,
and kept the explicitly removed path out after reloading. All three owned
checkouts retained their refs, index, config and working-file bytes. The
older `ed9b22c` package failed at the switch with both paths dropped.
The reports and successful APT simulation are retained in
`target/local-review/updater/jammy-builder/saved-workspace.1h4ZT3fI/`.
Two initial attempts on these bytes failed an earlier smoke check because
the deleted untracked file did not disappear before the deadline. The
focused test did not bypass that gate in the release suite. A fresh Jammy
run passed all 279 installed environment scenarios, including saved paths.
Ubuntu 26.04's first GitLab attempt failed a process scan during restart;
a separate same-bytes run verified the original and replacement using the
private session bus and passed GitLab (45) and updates (19). The
original failures remain retained. The exact package passed all 14
checks in the matrix used for that candidate and strict updater preflight.
See `installed-release-matrix.json` and `jammy-installed-preflight.sha256`.
It predates bounded watcher debounce and its new installed burst gate.

The watcher-burst build at `fc44942` has SHA-256
`af5f72acb7922cb4356835c2b06f3ff93ac7406887761738a17609017a1da40c`.
Its installed Ubuntu 24.04 watcher suite passed all 22 scenarios. In the
same repository-scoped test, the previous package kept the externally
deleted checkpoint visible for the full four-second observation and
removed it only after the event burst stopped. The replacement removed it
after 990 ms while notifications were still arriving (maximum gap 159 ms,
below the 450 ms quiet debounce). Git independently confirmed the deletion
in both runs. These reports are retained in
`target/local-review/updater/jammy-builder/watcher-burst.UjxQi7BT/burst-proof/`.
Jammy's watcher suite also passed all 20 checks: the graph converged in
1,013 ms with a maximum event gap of 280 ms. The first full Jammy attempt
stopped before a link activation because process inspection found a second
non-owning child of the verified application. A bounded read-only recheck
now verifies that such a child disappears or changes executable before
accepting a singleton. The focused same-package Jammy incoming-link run
passed 26 checks; it did not reproduce the extra child. The original
failure and separate focused report are retained. A fresh Jammy full
run passed all 279 installed environment scenarios. The stronger
14-check exact-package matrix and publisher-key preflight both passed
on the same bytes. See `installed-release-matrix.json` and
`jammy-installed-preflight.sha256` in the candidate directory. These
results predate the later commit-draft and bulk-open fixes.

The bulk-open build at `5893e70` has SHA-256
`89abe87c72c22902fe315df705ece11ac8f63247b41eff9af678736ba309d8b8`
and passed an APT simulation without changing the host package database.
Multiple initial native runs timed out waiting for the toolbar to reflect an
external checkout; a failure screenshot captured the new branch after the
deadline. Exact-package traced watcher runs on Ubuntu 22.04 and 24.04 passed
and observed actual watcher notifications and Git status reads. Those passes
did not reproduce the original delay or establish its cause. The initial
reports and the traced reports are retained under
`target/local-review/updater/jammy-builder/bulk-open.BPaQhVGy/`.
The next full Jammy attempt passed external checkout but stopped while
checking the image viewing mode. Its failure screenshot already showed the
correct single “After” image; the test had read the DOM immediately after
the click. The updated check waits for the pressed control and the
expected single image without replaying input. The same installed package
passed all 30 focused media checks. A fresh full Jammy run then passed
all 279 installed environment scenarios. The exact package passed all
14 required release-matrix checks and strict installed updater preflight
with the fixture publisher key. See `installed-release-matrix.json` and
`jammy-installed-preflight.sha256` in the candidate directory. These
results do not qualify the later draft handoff, bulk close, or batch-stop
changes.

The batch-stop build at `2f260db` has SHA-256
`1b31c5633f09f16f176df4cd1a94b1aba06652ca5c72d4cfc14f1d31aebb15ef`.
The same offline Ubuntu 24.04 test first reached a held Git fetch on the
previous package but found no stop control. On the new package, stopping
left the active fetch running and prevented the queued checkout's Git
command from dispatching. An explicit follow-up successfully fetched the
previously skipped checkout. Independent Git reads found only the expected
remote-tracking ref changes, with HEAD, local refs, index, config and
working files preserved. The new package also passed an APT simulation
without changing the host package database. The new package passed the
focused suite both with the normal CI invocation and with inherited Git
environment checks enabled. Those exact-artifact summaries and the
baseline failure report are retained under
`target/local-review/updater/jammy-builder/workspace-batch-stop.QCqMqMMd/`.
The same package subsequently completed all 279 Ubuntu 22.04 environment
scenarios and all 14 required release-matrix checks. The strict updater
preflight accepted these exact installed bytes with the fixture publisher
key. See `installed-release-matrix.json` and `jammy-installed-preflight.sha256`
in that directory. This local evidence does not qualify the later workspace
locate or saved-path bulk removal changes or imply production signing.

The saved-path removal candidate at `a1b9263` has SHA-256
`1698ddc4575bbf01de3a66d88f77eda7bdf2caf5139f1d79d0bf78d12cf109c6`.
The exact package passed the focused offline Ubuntu 24.04 test. Cancelling
left both layouts unchanged. After confirmation and WebView reload, only
the two reviewed memberships were gone; the same paths still belonged to
another workspace. Git verified that HEAD, refs, index, configuration and
working files were unchanged across all four owned checkouts. The first
attempt failed the runner's checkbox input hit test; a fresh attempt on
the same bytes used its associated visible HTML label. Both attempts and
the older package's baseline failure are retained with the verified
summary and APT simulation under
`target/local-review/updater/jammy-builder/workspace-saved-removal.BWbwdDc3/`.
The host package database was unchanged. This focused check does not
replace a full release matrix or qualify feature rebase.

The feature-rebase candidate at `9d49a65` has SHA-256
`7f986d4c94de892cafaa6ac38e54c97768d57b07bd17a5a55d67451d309ab44b`.
The exact package passed the focused offline Ubuntu 24.04 regressions for
feature rebase, batch stop, and removal of unopened saved paths. The feature
rebased onto the non-default configured development branch without moving
development, production, or a sibling branch pointing into the old history,
even with `rebase.updateRefs` enabled. Cancel left Git state unchanged, and
the fresh Finish review contained the rebased tip. The predecessor reached
Finish but did not offer rebase. Reports and checksum-matched summaries
are under `target/local-review/updater/jammy-builder/feature-rebase-palette.oAT3XeQs/`.
The same package passed 279 installed Ubuntu 22.04 environment scenarios
and all 14 required release-matrix checks. Strict installed-updater preflight
accepted that exact SHA-256 with the fixture publisher key; see
`installed-release-matrix.json` and `jammy-installed-preflight.sha256`.
This does not qualify the later lazy diff and bulk relocation changes, or
imply production signing or publication.

The lazy-diff candidate at `b621971` has SHA-256
`e64cbdd4bf985638142d3c7e1d87b4511afbd84125b7464e5a9ecb3892a1bda3`.
On disposable Ubuntu 24.04 the exact installed package passed 30 file/media
scenarios, 50 keyboard/setup scenarios (with fixture publisher trust), and
the saved-workspace restore scenario. The first setup invocation selected
the missing-key expectation despite building with fixture trust. The fresh
setup and restore run explicitly expected the embedded fixture key. See
`installed-focused.json` in
`target/local-review/updater/jammy-builder/lazy-diff-workspace.wLdk9Bsw/`.
This focused result does not qualify bulk relocation or substitute for
the full release matrix.

The bulk-relocation package at `257c2f3`, SHA-256
`dae6240e0196ef30a4d88b304e389f1c0d92fe132223c0afa4c5009ec43b6f46`,
passed the individual and batch relocation suites in disposable Ubuntu 24.04
using its actual GTK folder picker. The batch selected one replacement,
cancelled the next chooser, and did not request a third. After a WebView reload
only the chosen saved slot changed; all four checkouts kept their Git
footprints and the other layout kept its original paths. The older candidate
did not offer the bulk action. See `installed-locate.json` under
`target/local-review/updater/jammy-builder/workspace-locate-latest.ROf8O4Ys/`.
The same bytes passed all 14 release-matrix checks, including 279 installed
Ubuntu 22.04 environment scenarios. The strict updater preflight accepted
the raw installed Jammy report, its launcher and executable, and the local
fixture key for this SHA-256. See `installed-release-matrix.json` and
`jammy-installed-preflight.sha256` in the same directory. APT simulation
left the host package database unchanged. This does not qualify later
changes or imply production signing or publication.

The picker-hint package at `a927872`, SHA-256
`46ed2e5768ea1ca65f63e96675c88c87e0fb9c61b922ea39e9cf636dc7c4f9da`,
passed all three installed relocation suites on Ubuntu 24.04. The new test
selects the renamed checkout directly from the chooser's starting directory.
The previous package could open the chooser but did not activate that checkout
with the same input. All 57 workspace renderer tests passed against settled
development assets. The exact-package comparison is retained under
`target/local-review/updater/jammy-builder/workspace-picker-hint.0MBhT5FI/`.

Deferring the blocked-discard file chooser and its styles moved them out of the
initial renderer. An independent walk of emitted static imports measured
1,361,018 → 1,357,578 initial bytes against the preceding picker-hint build
(`a927872`), a 3,440-byte reduction without changing either budget. The
900 kB initial warning remains. The production content audit and 127 renderer
scenarios covering discard, recovery, and file-action lifecycles passed.
The chunk hold confirms the subset chooser cannot request a second preview
until the blocked review has rendered. Evidence is under
`target/local-review/lazy-discard-choice.YB9vDTk6/`.
The installed build at `65b0d19`, SHA-256
`05c798c99eaa70e3a582ffb8e0a286c852af699397099e74cd640fded7a45680`,
passed both real discard-subset scenarios. Neither reviewing nor going back
changed files. Confirmation restored only the selected file to the staged
contents and undo restored its original working edit. Other files, staged
entries and their flags, refs, and config were unchanged. See
`installed-discard.json` under
`target/local-review/updater/jammy-builder/blocked-discard-subset.cfQLbcP6/`.

The submodule-initialization build at `5157559`, SHA-256
`6f64c6b922452d62485d199f9bf1e4d9948cbba68a6b822d75d743853d7f7b79`,
passed both installed single-path initialization scenarios. The predecessor
initialized immediately on the row click. This build kept the selected path
uninitialized during review and after Cancel; explicit confirmation then
initialized only that path and its nested checkout. The second top-level
checkout, parent index, refs and declaration were unchanged. See
`installed-submodule.json` under
`target/local-review/updater/jammy-builder/submodule-init-review.Vvp7sZoU/`.
The same package subsequently passed all 14 release-matrix checks, including
279 installed Ubuntu 22.04 environment scenarios. The strict updater preflight
accepted its raw installed report with the fixture publisher key. The directory
contains `installed-release-matrix.json` and `jammy-installed-preflight.sha256`.
This focused report does not qualify the later per-submodule remote update.

The remote-update build at `1c31484`, SHA-256
`43788713b5ed1d48b4188288662b23fd89864b1708679a4d1e5e2353bdba38db`,
passed all five installed submodule scenarios. Opening and cancelling did
not fetch. An edit made after opening the review caused a native refusal
without changing the remote-tracking ref. With the selected checkout clean,
only that checkout advanced; the dirty sibling and the parent index and
refs were unchanged. See `installed-submodule.json` under
`target/local-review/updater/jammy-builder/submodule-update-review.YCHlzHDO/`.

The workspace reopen package at `c278b21`, SHA-256
`2ce82787c71655f4fbf92c98ca1bbd8d048ba9490ac30e05b86f378c6359847d`,
passed four installed workspace scenarios. The predecessor exposed the
reopen action in the wrong workspace. This package kept the action in the
original layout and restored the middle tab to its former saved slot without
losing the unavailable path or changing Git data. Both nearby and bulk
relocation also passed. See `installed-workspace-tabs.json` under
`target/local-review/updater/jammy-builder/workspace-tab-reopen.mO7cGsux/`.

The stash-selection package at `eb8a4c8`, SHA-256
`46c0e45fb0484ec3e3bd4268e91d853a978e7d040c78ba768102d0a18340c747`,
passed two installed stash-scope cases. The predecessor partially applied a
mixed staged-only request and created a stash. This package refused it
without changing files, staged entries or stash history. In the UI, switching
to staged-only left one eligible checked file. Git verified that only that
file entered the stash and both neighbours were unchanged. See
`installed-stash-selection.json` under
`target/local-review/updater/jammy-builder/stash-selection-scope.RzMp7V7N/`.
The same installer passed all 14 required release-matrix checks across
Ubuntu 22.04, 24.04 and 26.04 and Debian 12 and 13. The full installed
Ubuntu 22.04 environment run passed 279 scenarios. The combined matrix
and publisher preflight matched the package SHA-256 and the fixture
publisher key; see `verified-release.manual.json` in that directory.
This evidence does not qualify the later patch-export fix or production
publisher signing.

The patch-export build at `4456b6e`, SHA-256
`5e9a172b5d8ad5c1030c23b6d0e13d31f6b993154e2d0f2bfa5d5259ff9ef5e9`,
passed three installed Ubuntu 24.04 scenarios. An empty tracked diff
disabled the save picker. An external restore left one selected path
visibly unavailable, and both the renderer and native command refused a
partial export. Removing the stale path reopened the real GTK picker.
Escape completed as cancellation without a Git error, unlike the
previous packaged build. An independent native export produced the exact
remaining one-file diff according to `git apply --numstat`. See
`installed-patch-export.json` under
`target/local-review/updater/jammy-builder/patch-picker-cancel.v8mHsyRm/`.
The same three cases also passed on installed Ubuntu 22.04 (Git 2.56.1)
and Debian 12 (Git 2.39.5), with the same artifact hash; see
`patch-export-compat/installed-patch-export-compat.json` there.
All 12 hosted Ubuntu 24.04 workspace and Git review suites also passed on
that exact installer; `installed-noble-workflow-reviews.json` records each
suite separately. The local release checklist now requires those focused
reviews alongside the original 14 distribution and suite checks.
The separate installed worktree suite passed 21 scenarios, including
the three occupied-branch checks (Cancel, explicit owner navigation, and
refusal after a changed owner). See
`workflow-reviews/installed-workflow-reviews.json` in the same directory.

The same installer passed the expanded **26-check local release matrix**,
including 279 installed Ubuntu 22.04 environment scenarios. The combined
preflight bound the installed reports and build receipt to that installer
and the fixture publisher public key. See `verified-release-expanded.json`
in the same directory. Removing the Noble patch report (while retaining
the separate Ubuntu 22.04 and Debian 12 patch reports) or supplying a
different public key produced no verification receipt. This is exact
local fixture qualification, not production signing or publication; the
later repository form stylesheet change is not in this installer.

## Updater downgrade guard and tracked-file release evidence — 2026-11-21

The Jammy-built downgrade-guard candidate at `913a05d`, SHA-256
`d63aa1f4af6b1c2c39ff554b1ee71a53d64091f68b9032d528e1be635945aec6`,
passed the then-required 26 installed checks across five distributions.
The strict offline verifier selected passing exact-package evidence from 30
reports and matched the build receipt to the fixture publisher key. See
`verified-release-directories.json` under
`target/local-review/updater/jammy-builder/updater-downgrade-guard.m9V06cJZ/`.
This did not authorize production signing or publication.

The focused tracked-file suite deliberately failed on those older installed
bytes: three unmerged index stages appeared as duplicate paths and displaced
another matching file. The Jammy-built candidate at `86d106d`, SHA-256
`620196803944957eb2e3861ed111ea165215ce44427e844b754f46e5375cb9bd`,
passed both the native result-limit check and the installed Ubuntu 24.04
palette check, preserving merge state. See the separate `baseline/results`
and `focused/results` under
`target/local-review/updater/jammy-builder/tracked-file-search.7Ct4GAYe/`.
The new requirement brings the installed matrix to 27 checks; neither
receipt alone qualifies that expanded matrix.

The tracked-file timeout candidate at `52032be`, SHA-256
`16b6a9af21ade8f9e7da702305f941a70e636300f50435aba06a6b08e0653863`,
passed all 27 required installed checks. The fixture-key verifier checked
31 exact-artifact reports, including the 279-scenario Jammy environment run
and both installed Noble tracked-file checks. See `verified-release.json`
under `target/local-review/updater/jammy-builder/tracked-search-release.Sg6pQpfS/`.
This does not qualify subsequent rebase or diff changes or production signing.

An isolated installed run against the rebase-tips candidate at `7a45f63`,
SHA-256 `b725747fe4d60c2ed93136b609e73604f519b8dfc99d7fd6f0b07c7415101f90`,
confirmed both later diff regressions before their fixes. The diff footer
showed +1/−1 while the working-tree recap correctly showed +2/−2, and the
visible tail appeared on line 3 instead of line 4. Separately, staging only
the added side of an unterminated replacement produced the concatenated
old and new bytes in the index, while leaving HEAD and the worktree
untouched. See the deliberately failing UI report and screenshot under
`target/local-review/native-diff-line-selection.wjaLP22d/old/results/`
and the independent baseline-only reproduction under
`target/local-review/native-eof-baseline.GNXWZYM9/old/results/`.
Neither run is passing release evidence.

The fixed Jammy-built candidate at `ff23e25`, SHA-256
`6862bf470908fda4d02d8c869f6835378a7ab7dc3b2d76b5abf38c75e3e99f16`,
passed all five focused cases after installation on Ubuntu 24.04
(Git 2.43.0). The suite verified the selected tail, split-view alignment,
native unstage, discard and recovery, and refusal without index or
working-file changes when a selection would concatenate final lines.
See `target/local-review/native-diff-line-selection.wjaLP22d/new/summary.json`.
The focused result does not replace the full release matrix.

An additional case on those same installed bytes reproduced refusal when
`diff.suppressBlankEmpty=true`: the preview contained an exact blank context
row without a space prefix, which guarded discard rejected before changing
files. See the deliberate baseline under
`target/local-review/native-blank-context-baseline.l20eVlR1/old/results/`.
The subsequent fix preserves the configuration and the exact preview check;
this baseline does not qualify the new behavior.

The rebase-tips candidate's original Ubuntu 26.04 GitLab attempt timed out
after an external checkout. The failure screenshot showed the previous
branch and no newly created untracked row. A separate traced GitLab run
on the same installer passed 45 cases; the standalone `watcher-checkout`
suite also passed and recorded watcher events and native status reads.
The original timeout remains evidence of a failure, not a proven cause.
See `target/local-review/resolute-watcher-probe.NQEYNfC8/` and
`target/local-review/native-watcher-and-poll.mHQRT8hw/resolute/`.

The fixed diff candidate's initial Debian 12 GitLab run separately failed
when WebKit could not parse the result of the read-only Clone-tab readiness
predicate. A fresh Debian 12 run of the same installer with bounded
readiness polling passed all 47 cases. Clicks and mutation scripts remain
one-shot. The original report is retained separately from
`target/local-review/native-watcher-and-poll.mHQRT8hw/bookworm/`.

With that successful Bookworm GitLab rerun and the remaining exact-package
reports, the strict verifier accepted all 27 checks for the `ff23e25`
artifact and its fixture publisher key. See
`verified-release-reviewed-bookworm-rerun.json` in the same parent directory.
The first attempt still exited nonzero; its failed report was not used as
release evidence.

The blank-context candidate at `62be3a4`, SHA-256
`542d65029a86d93bf7c94d9eff4735cffeef123fc08f9e987188a82bb1aa04ab`,
passed all six installed Ubuntu 24.04 diff cases, including compact
blank-context discard and recovery. The same bytes then passed all **27**
strict release checks across the five Linux distributions, using the fixture
publisher key. The successful controller exit and exact-package verifier
report are retained in
`target/local-review/updater/jammy-builder/blank-context-release.VhWpfmCA/`
as `qualification.exit` and `verified-release.json`. This does not qualify
the later watcher or recap commits, and it is not a production signing or
publication receipt.

An additional reftable-only fixture with Git 2.53.0 removed a branch
externally on the same installed diff candidate. Git no longer listed the
branch, but the Ubuntu 26.04 renderer still showed it. See
`target/local-review/native-reftable-watch.gxkK0eEn/resolute/results/`.
A local native test separately confirmed that a ref-only transaction
replaced `reftable/tables.list` without modifying HEAD and that the old
watch list missed that notification. This is distinct from the earlier
file-backed checkout timeout.

The first reftable candidate build stopped at the new watcher preflight
with `EMFILE`, before Tauri or a new build receipt. The container had
a 65,536-descriptor limit; the exact source of the transient exhaustion
was not measured. Its log is under
`target/local-review/updater/jammy-builder/reftable-watch-release.AZP8RIjR/`.

The later watcher candidate at `1984996` built successfully. Its installed
Ubuntu 26.04 replay, using Git 2.53.0, now updates the visible branch list
after external ref-only creation and deletion in a reftable repository.
Package SHA-256:
`d72be40e3fb2ffd726a001b8859599346560d8d8711050eddd78d0ff3861dc5e`.
The installed report is under
`target/local-review/updater/jammy-builder/partial-watcher-release.LuJrILXb/compatibility/resolute/results/watcher-reftable/`.
The same exact bytes passed all **27** strict Linux release checks; see
`verified-release.json` at the root of that run. The matrix used a fixture
publisher key and does not qualify later commits or production publication.

The commit-edit candidate at `48239ab` passed both installed rewrite
scenarios on Ubuntu 24.04 with Git 2.43.0. Both native edit commands refused
a stale branch at the same tip, and the inspector edited only the reviewed
branch while preserving the other ref, trees, index, config and working
bytes. Package SHA-256:
`5aa6569c64e694a3209e3cba68383ca7480daad8b97009d097f43e46c4369275`.
The package and harness source IDs are recorded under
`target/local-review/updater/jammy-builder/reviewed-commit-edit-release.J9co8Ig3/focused/`;
the runtime report is in its `results/commit-rewrite/` directory.
This check is now required by the local and CI release matrix. The same
installer passed all **28** checks under the expanded local verifier
(`verified-release-expanded.json` at the root of that run); the original
27-check receipt is retained separately. Both verified the fixture publisher
key, not a production signing or publication.

## Installed worktree-path and release-evidence checkpoint — 2026-11-21

The rename-counting candidate, `1a8c1e7`, built on Jammy and passed all 47
installed keyboard/setup checks on both Ubuntu 24.04 (Git 2.43) and Debian 12
(Git 2.39.5). The renamed-file fixture now reports +1/−1 instead of the
previous package's +4/−0. Debian 12 also passed the worktree (23) and updater
(21) checks on the same bytes. Package SHA-256:
`8bbab05106e6195e2ec43e4ff9d0062d5bfe64ab5752a3747690d322947248aa`.
The same package passed all 273 installed inherited-environment checks with
Git 2.53 on Ubuntu 24.04 and the strict release preflight. The report, checksum
and installer are retained under
`target/local-review/updater/jammy-builder/rename-recap.Eqmxn2eV/`.
To inspect installation without changing the host, pass the exact retained
`.deb` to `bash install.sh --deb "$PACKAGE" --dry-run`; `task install:linux`
instead builds and installs the current checkout.
The next candidate includes the same-status refresh fix and an installed
external-edit test; these earlier package results do not qualify that fix.

The next candidate, `d2b57e7`, includes the saved-tab restoration fix.
Its Jammy-built package SHA-256 is
`13611be47d0e628ea24b3d83b5de144c669a80bbac549adc821ef8e42a6f3bcc`.
The exact bytes passed 272 installed environment scenarios on Ubuntu 24.04
with coherent Git 2.53 helpers. This followed a harness-only correction that
binds right clicks to the private session's app instead of globally matching
its executable path. The final report and strict release preflight are under
`target/local-review/updater/jammy-builder/workspace-tabs.IDQ2jPmP/`.
With stock Git 2.43, the same bytes passed incoming links (26), worktrees (23),
setup/recaps (46), application updates (21), GitLab (47), and recovery (23).
This is local evidence; the exact package does not yet include the subsequent
rename-counting or same-status refresh refinements.

The Jammy-built candidate at `6278cbf` passed all 272 installed
inherited-environment checks on disposable Ubuntu 24.04 after provisioning a
matching Git 2.53 executable and helper directory. The same package passed the
23 worktree, 47 GitLab, 46 setup/line-recap, 23 crash-recovery and 21 updater
checks with Ubuntu 24.04's Git 2.43. The worktree test opened the exact owner
path with an embedded line break and trailing space, without changing checkout
data. The prior package failed at that navigation step. Test-only readiness
fixes were used where needed; the candidate bytes did not change.

Package SHA-256:
`e852217d6311e76ad21f16f37361346870b655eb21da7e99a11a58f8c2f2faa5`.
The installed full report is retained under
`target/local-review/updater/jammy-builder/literal-path.yPwIKvTq/noble-coherent/`.
The stricter release preflight accepted the report, matching the installed
executable and desktop entry hashes and running version to the ABI-checked
package. That check is not an asset signature, a live updater installation, or
hosted CI approval. This candidate predates the saved-tab restoration fix.

### Production bundle checkpoint

At `a6838ee`, the production renderer build and the production-content check
passed. Initial assets total **1,393,278 bytes**: 56,722 bytes below the error
limit, but 493,278 above the 900 kB warning limit. This build did not emit a
component stylesheet budget warning. No limits were raised. The build's
input-attribution metadata ranks the root application component highest,
but the attributed input counts can exceed the actual emitted chunk size.
Use them to choose what to investigate, not to estimate savings without a
new build. The sizing evidence is local at
`target/local-review/live-recap-bundle/`.

To reproduce a before/after report without touching the package build output:

```sh
pnpm nx run desktop:build --output-path=target/local-review/bundle-size
cat target/local-review/bundle-size/initial-renderer.json
```

The report follows the generated index and its static imports, cross-checks
the emitted file sizes and prints the configured budget headroom. It reports
the bundler's unverified input ranking separately and identifies chunks whose
input attribution exceeds their emitted size. Lazy-only chunks are excluded,
and the report doesn't change the Angular build gate.
Production builds record the report beside `browser/`, so it does not get
embedded in the desktop app. The release candidate workflow retains it with
the build ABI report as a diagnostic artifact, not a downloadable installer
asset or a signing receipt.

The file-action menu extraction moved the working-tree and historical menu
contents behind the first context-menu request. A before/after production
build measured **1,399,397 → 1,395,619 initial bytes**, a reduction of 3,778
bytes. The warning limit is still exceeded by 495,619 bytes; the error limit
has 54,381 bytes of headroom. No budget changed. The measured difference is
in emitted assets, not a startup latency measurement.

Deferring the focused diff viewer and its dedicated styles reduced the
initial renderer from **1,401,626 to 1,361,018 bytes** (40,608 bytes less).
Initial CSS fell from 150,101 to 130,452 bytes; the diff component loads
when a file diff is opened. The initial warning still exceeds the
900 kB budget by 461,018 bytes, with 88,982 bytes of error-limit headroom.
Budgets were unchanged. The verified before/after reports are retained
locally under `target/local-review/lazy-diff-workspace/`. Chromium against
the final production output requested no diff module before opening a file
and one copy on opening it. These are asset measurements, not boot time.

Moving patch-row projection, split alignment and syntax tokenization into
the deferred viewer reduced the initial renderer from **1,339,564 to
1,333,972 bytes** (5,592 fewer). The same production bundle requested the
parser chunk zero times before opening a file and once on first open.
The unchanged 900 kB warning remains. See
`target/local-review/lazy-diff-projection.*` for the production build
reports and Chromium request probe. Startup latency was not measured.

Moving the welcome launcher and remaining file-insight rules to their
existing lazy components cut initial CSS by 14,276 bytes
(124,233 → 109,957); initial JavaScript was unchanged. The initial total is
1,296,447 bytes, still 396,447 bytes over the unchanged 900 kB warning.
Independently compressing the initial files saved 2,673 gzip and 2,315
Brotli bytes. On the production Chromium preview, the diff styles were
requested only on first opening the diff. The welcome chunk was still
requested during repository startup in that preview, so counting that
chunk with the initial files yields only 1,116 fewer raw bytes. The
compact workspace menu and sampled diff layout and hunk controls kept
their computed styles. The build comparison and browser request probe are
in `target/local-review/lazy-feature-styles.dQF1Tebn/`. This is not a
startup-latency measurement.

Native startup with saved tabs now keeps a small progress view until the
first checkout is ready. It does not request Welcome unless restoration
fails or the user chooses to show the launcher. In a production Chromium
probe with held native-bridge responses, the old app requested the
26,367-byte Welcome chunk before Git answered; the new app made no
request for it and opened the same saved path exactly once. The progress
and fallback views add 2,808 raw initial bytes, for a net reduction of
23,559 bytes on that saved-startup path. The initial total is 1,299,255
bytes. These are asset measurements using a simulated native bridge,
not installed WebKit timings. Receipts are in
`target/local-review/saved-startup-launcher.G8ICdgQs/`.

Deferring the commit editor and its private styles reduced the initial
renderer from **1,333,972 to 1,331,513 bytes**. A production Chromium probe
requested the form chunk only when the editor opened and confirmed focus
on the summary field, then back on the edit control after cancellation.
The unchanged initial warning remains; these are asset and behavior
measurements, not a startup timing benchmark. Evidence is under
`target/local-review/deferred-commit-editor.*`.

The shared repository-form styles now load with whichever of the repository
manager, repository setup or workspace editor opens first. Common form
primitives used elsewhere remain in the startup stylesheet. Comparing
emitted static assets against `4456b6e` measured
**1,359,203 → 1,355,213 initial bytes**; CSS fell by 3,990 bytes.
The moved rules appear in one lazy chunk and no initial asset. Budgets did
not change; the initial warning remains 455,213 bytes above its 900 kB
limit. Chromium against the built assets requested that chunk only on
the first open and applied the compact layout on all three entry paths.
Measurements are under
`target/local-review/repository-form-styles.7lafCH55/`.

The Jammy package for `0cdc504` (`ec6dda3f3b4db99ee5804bf86a55aef7b9c03250e055013d62bf4a5e4f958074`)
passed 99 installed Ubuntu 24.04 scenarios: 50 setup/keyboard and updater
checks, 45 GitLab checks, three patch-export checks, and one workspace-batch
check. The staged work directory reused warmed Rust outputs after verifying
all 1,021 archived files against the source snapshot. That local build took
5m 19s versus 9m 7s for the preceding archive build; this is an observed
warm-build result, not a clean-run or CI timing guarantee. See
`target/local-review/updater/jammy-builder/repository-form-styles.RoJCxyCn/`
for the hash, build log, and `focused-publisher-trust/installed-focused.json`.
This is not a full release-matrix or live self-update test.

The deferred command palette now loads its command catalogue and search
ranking, not just its layout, on first use. The initial renderer fell from
**1,355,213 to 1,337,102 bytes** without changing either budget. The
warning remains 437,102 bytes over 900 kB. Chromium against the emitted
production files observed no catalogue request at startup and exactly
one after opening; loading retained keyboard focus and the fetch result
was searchable after release. Measurements are under
`target/local-review/lazy-command-catalogue.cWluk5ZZ/`.

## Hosted form-binding mock contract correction — 2026-11-20

Hosted run `44687310298` at `a1c9aac` completed with two failures: the same native
palette-rename shortcut assertion targeted by `76cf51b`, and one renderer stash
form-binding case. Its mock still returned `void` after `stash` acquired an
actual boolean mutation outcome. Locally the exact old test reproduced the
failure under `target/local-review/stash-form-contract/renderer-red/`.
The mock now returns a typed boolean and exercises both successful draft
consumption and refused-draft retention. Product behavior was not weakened to
accept undefined success. All 39 owning form/inline-stash/rename renderer cases
and strict graph-test types passed. This follow-up changes no packaged runtime
input, timeout or retry. Hosted verification of the queued fixes remains pending.

## Unstaged Files line recap — full local package gate passed

The Unstaged Files header now has an additions/deletions recap matching the
commit recap's notation. Its separate native read compares tracked files against
the index and includes untracked text without loading every patch. Binary or
uncounted files and partial results are explicitly disclosed. Staged-only edits
do not inflate the unstaged totals. Read failures are unavailable, not zero;
one in-flight read coalesces newer status snapshots and rejects retired-source
results. No dependency, external tool or writable Git command was added.

Seven targeted renderer cases cover totals/disclosure, collapse, read coalescing,
source/path retirement, retry, clean reset and a narrow header. The final 70-case
renderer run additionally covers working-tree lifecycle/virtualization, new-file
staging and the two current branch-scope families. A 250-pixel header screenshot
was inspected at `target/local-review/unstaged-summary/narrow-header.png`.
`desktop:test` passed 265 TypeScript tests, 201 desktop native unit tests,
1,051 core unit tests and ordinary integration tests, with their existing ignores
retained. Four new real-Git `unstaged_summary` core tests cover mixed index/
worktree changes, deletion, untracked text/binary, unborn/staged-only state,
bounded untracked input and a symlink blob without opening its target.
`desktop:check` passed the development build, workspace/all-target Cargo check
and Clippy; generated IPC freshness/types and 107 Python harness tests passed.
The production Debian build passed. The preserved package is
`target/local-review/unstaged-summary/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `7bcc24401ee2f18f4c67925858f0d026d84f12481137ccd6cb8a619f7f60deb1`;
extracted executable SHA-256
`44377dae6067b324c077650b6db198e4a8b9baeaaf4d5e9de3ba021c278ff946`.
Focused native acceptance passed all 42 scenarios at
`target/local-review/unstaged-summary/native/setup-keyboard-1795158440410887690/report.json`.
The actual recap was +4/−3 before staging and +2/−2 afterwards, with the binary
exclusion disclosed and independent data-preservation checks passing. The new
context-branch creation gate below also passed on this package. Captured inputs
matched `target/local-review/unstaged-summary/inputs.sha256` for that candidate.
Its full inherited-environment run then failed after 62 scenarios at
`target/local-review/unstaged-summary/native/environment-1795158503457282646/report.json`:
the optional new diff read attempted a promised missing-object fetch during the
existing direct-content preview sentinel. The focused pass is not full
qualification. A new real-Git regression reproduced the fetch, then passed after
a thread-scoped local-only read policy was added. It sets Git's no-lazy-fetch
environment guard and command-level transport refusal, including configured
protocol policies, without changing repository configuration. An explicit
fallback test removes the environment guard and still blocks the owned helper;
after scope exit the ordinary Git control invokes it, proving both the sentinel
and policy retirement. All six `unstaged_summary` core cases now pass, including
custom protocol override and unwind restoration. The workspace test rerun passed
1,052 core cases plus its existing desktop/TypeScript/integration gates; the sixth
focused policy test was then added and passed separately. Final workspace/all-
target check and Clippy passed with that test present. No runtime/UI/e2e input
was changed during the replacement package qualification.

The replacement package is
`target/local-review/unstaged-summary/artifacts/local-only/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `37682d2bea13893245010053e50ea5cfefb10fd4e8ddc965cf0522cdf2b6fdf8`;
extracted executable SHA-256
`91896551cbcfcb01b728c7f7865225d330939c6b3b66ed2a1975b4b6dfa6e4fd`.
All 42 focused native scenarios passed at
`target/local-review/unstaged-summary/native-local-only/setup-keyboard-1795159527469188616/report.json`.
The new fingerprint `target/local-review/unstaged-summary/inputs-local-only.sha256`
still matches. Full inherited-environment acceptance passed all 270 scenarios at
`target/local-review/unstaged-summary/native-local-only/environment-1795159611051553182/report.json`
against this exact replacement, including the direct-content missing-object
sentinel that exposed the first candidate's regression. The full suite includes
the 42 focused scenarios, not 312 unique cases. The failed first candidate
remains preserved separately. No install or release occurred.

## Context branch-creation request scope — focused native gate passed

The original nine-case renderer probe reproduced eight failures: two source
changes still dispatched, outgoing confirm/cancel/field events consumed newer
creators, and modified/repeated/composing Enter left default submission enabled.
The valid selected-tip control passed. Evidence is retained under
`target/local-review/context-branch/renderer-red/`.

The creator now has one typed source/tip/menu-generation request instead of an
independent open flag. Keyed form instances and rendered request arguments scope
confirm/cancel/field/keyboard events, and source changes retire the menu. Late
results and focus callbacks cannot consume a reopened creator, including a
same-menu close/reopen cycle. Submitted fields freeze during native work, while
plain Enter and explicit retry remain supported. Source checkout is disclosed.
The final 102 renderer cases, 265 TypeScript tests, strict graph types and 107
Python harness tests passed. The new owned native context-creation helper
subsequently passed in the 42-case focused packaged run above. It isolated real
modifier chords and created/switched to the exact reviewed tip, preserving dirty
index/config/working data and a commit draft without invoking a commit hook.
The first full candidate failed in the direct-content no-fetch sentinel as
described above; the rebuilt local-only package then passed the full 270-case
gate, including both context-creation scenarios. This is not installed or released
software.

## Palette-rename Enter defaults and native shortcut diagnostics — 2026-11-20

Hosted run `44676314454` lost the palette-rename review after its modifier-key
sequence. Local native runs had kept the dialog open, so that exact hosted
submission is not a locally reproduced result. Investigation did establish an
independent missing guard: the form stopped propagation but left implicit Enter
submission enabled. Six new renderer cancellation probes failed while the 12
existing cases and new plain-Enter control passed (13 controls). Evidence:
`target/local-review/rename-enter/renderer-red/`.

The strengthened native probe against the unchanged prior package
`9f35d41d4d73cf761beadf01789701527ebd3e074da8ad7cacd24af3cd70047d`
then failed on actual Control+Enter default cancellation at
`target/local-review/rename-enter/native-red-final/setup-keyboard-1795155962494259502/report.json`.
It observed the correct Control flag and focused input, unchanged Git data and
an open dialog, but `defaultPrevented: false`. This proves the cancellation gap,
not that the local engine actually submitted or that every hosted failure has
that cause. An initial diagnostic pass retained capture-phase microtask state;
the final probe instead reads the original Event after dispatch, avoiding
microtask checkpoints before bubbling handlers.

The palette form now cancels modified, repeated and composing Enter while
preserving ordinary Enter and explicit submit. The native runner retains bounded
per-chord key/focus/submit evidence and independent Git footprints, stops on the
first failed chord and never replays it. No timeout, retry, dependency, native
Git semantics or workflow changed. The final renderer run passed all 58
rename/inline-stash/deferred-scope cases, plus 265 TypeScript tests, strict graph
types and 107 Python runner tests; the edited helper compiled. The production
Debian build passed and is preserved under
`target/local-review/rename-enter/artifacts/Git-Khronos_0.1.6_amd64.deb`, SHA-256
`4d800a650bc8de427a761c5649249bc59be4fa078280defb5fc1f50bc36d6083`.
Extracted executable SHA-256 is
`b951a657469cba6ae55f94b60b93d6ee805bc3978fe088d68fd30a19049d6ab1`.
Focused acceptance passed all 38 scenarios at
`target/local-review/rename-enter/native/setup-keyboard-1795156220159009704/report.json`.
Actual Control+Enter and Control+Shift+Enter now report default cancellation;
all three chords preserve the dialog and exact checkout footprint, followed by
successful explicit palette/context rename. Full inherited-environment acceptance
then passed all 266 scenarios against the same package/executable at
`target/local-review/rename-enter/native/environment-1795156265724091110/report.json`.
The full suite includes the 38 focused cases. All captured source, helper and
renderer inputs still match `target/local-review/rename-enter/inputs.sha256`
after qualification. Synthetic composition flags do not qualify a physical IME,
and local passing tests do not replace hosted Jammy verification. No installation
or release was performed.

## Deferred fetch/worktree scope and shared focus leases — 2026-11-20

The original 17-case renderer probe reproduced 14 failures. Three same-ID/path
changes dispatched against the replacement checkout; three ID-switch cases
already refused mutation but left retired reviews visible. Outgoing controls
consumed replacements, and stale picker completion/error/finally affected newer
presentation state. Red evidence is retained at
`target/local-review/deferred-scope/renderer-red/`. A separate two-case probe
also reproduced an old reference/stash focus callback briefly focusing its
opener after a new fetch review opened (`focus-red/`). Final focus alone hid
that transient focus theft; the tests count actual focus events.

Fetch and worktree reviews now capture ID/path and request identity, check root
ownership synchronously, key their form instances and freeze submitted controls.
Directory selection checks its request and generation for result, error and
cleanup. Shared deferred loading/error handlers retain the whole four-review
lease. Post-close focus restoration requires the captured empty lease and source,
so a newer review retires that earlier focus intent. Native Git receipt ownership,
IPC contracts and command semantics are unchanged.

The final 99 renderer cases passed at
`target/local-review/deferred-scope/renderer-final-focus/`, along with 265
TypeScript tests, strict graph types and 107 Python harness tests. The changed
native helper also compiled. The production Debian build passed; its preserved
package is
`target/local-review/deferred-scope/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `9f35d41d4d73cf761beadf01789701527ebd3e074da8ad7cacd24af3cd70047d`;
extracted executable SHA-256
`0464a818062624b83f10529d888a8f679e9bf1ce355988f9aceb26cf20e22807`.
Focused setup-keyboard acceptance passed all 38 scenarios at
`target/local-review/deferred-scope/native/setup-keyboard-1795155121885684121/report.json`.
Its six new native cases verify fetch/prune/deepen/complete and linked-worktree
move/repair with independent Git/data oracles. Full inherited-environment
qualification then passed all 266 scenarios at
`target/local-review/deferred-scope/native/environment-1795155178918772053/report.json`
against the same package and executable hashes. The full suite includes the
focused cases, not 304 unique scenarios. All captured runtime, helper and e2e
inputs still match `target/local-review/deferred-scope/inputs.sha256` after both
runs. No Python correction or application action replay was needed for these
native runs. No system install, version change or release is implied.

Hosted run `44676314454` at `70a809d` finished with renderer and Windows checks
passing, but packaged native acceptance failed in the palette-rename shortcut
probe (`native_setup_keyboard_scenarios.py:134`, dialog unexpectedly absent).
Catalogue and downstream installed-distribution jobs did not run. That older
hosted failure is not repaired merely by the current local focused pass; it
requires separate diagnosis and hosted verification.

## Inline stash keyboard and draft-consumption guards — 2026-11-20

The original 15-case renderer probe reproduced nine failures: repeat/composing
Enter dispatched a stash, outgoing editor events targeted a replacement source,
and late success or a cleared global failure erased a newer draft. The five
modifier-key controls and valid plain Enter already passed; the initial suspicion
about modifier shortcuts was not confirmed. Red evidence is retained at
`target/local-review/inline-stash/renderer-red/`.

The editor now supplies rendered source ID/path and rejects repeat/composing
Enter while preserving its explicit plain-Enter action. Immediate stash
completion consumes only its actual successful source and captured message
revision. New edits, including same-text ABA edits, survive late completion;
refused/cancelled operations do not clear the draft from a global error signal.
No persistent draft system, native command semantics or IPC contract changed.

All 44 focused inline-stash/advanced-review/keyboard renderer cases and the
owning workspace journey passed (45 executions), along with 265 TypeScript
tests, graph typechecking, production build/preview guard and 107 runner tests.
The preserved package is
`target/local-review/inline-stash/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `a76786cafe636e32e963791685c73a3f11decb427a3a8c8aaf5d10fdeef7b41a`;
executable SHA-256
`1d20f76910b35671c0ae27ae6635a0b1817c47db1ee9885eb1b6eccdd90b043e`.
It passed all 32 focused setup-keyboard scenarios at
`target/local-review/inline-stash/native/setup-keyboard-1795152375404980083/report.json`,
including actual modifier Enter preservation and plain Enter capture of distinct
staged/working/untracked objects without changing HEAD/config or committing the
draft. Full inherited-environment qualification passed all 260 scenarios at
`target/local-review/inline-stash/native/environment-1795152406979334713/report.json`
with the same package/executable hashes. These include the 32 focused cases;
they are not 292 unique scenarios. Runtime/runner inputs still match
`target/local-review/inline-stash/inputs.sha256`. This is local Ubuntu 26.04
extracted-package proof, not installed or cross-platform qualification.
No version, dependencies, workflow or budgets changed. No installation or
release was performed.

## Advanced stash scope and keyed review forms — 2026-11-20

The new stash renderer probe reproduced seven failures against the previous
source: five same-ID/path replacements dispatched a stale stash action, and
outgoing confirm/cancel consumed a replacement review. Ten controls passed in
that same run, including all five valid actions; evidence is retained at
`target/local-review/stash-scope/renderer-red/`.

Advanced save, apply-with-index, selected-file apply, branch-from-stash and
stash-before-switch now retain source ID/path and root-owned request identity.
Loaded and loading/error controls share that lease. Draft controls/payloads stay
frozen during native work, modifier shortcuts cannot escape into the commit
draft, and actual mutation outcomes govern dismissal even if another action
clears the global error during recovery inspection. Native stash/head/target
leases and Git semantics are unchanged.

A later 71-case probe passed 70 cases but exposed another real UI-state defect:
ignoring an obsolete `ngModelChange` protects signals but can leave its internal
control text visible when the new model's reset value is unchanged. A separate
reference-name probe reproduced the same problem. Both components now key their
form view by request identity. Evidence is retained in `renderer-final/` and
`reference-field-red/`; neither failed attempt is labeled qualified.
Final source passed all 72 selected renderer cases at
`target/local-review/stash-scope/renderer-final-keyed/`, all 265 TypeScript tests,
graph typechecking, production build/preview guard and 107 runner tests.
No contracts, dependencies, workflow, version or budgets changed; the initial
size warning remains.

Preserved package:
`target/local-review/stash-scope/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `ddbc37c18739efd154f95cf49fb62fdbafa52ccc60bf9d25bbded5b1ea821409`;
executable SHA-256
`67e98f4678ab830096fd94c208fbb214c04d9b875b0cc70dfc1e144579a898f2`.
It passed all 30 focused setup-keyboard scenarios at
`target/local-review/stash-scope/native/setup-keyboard-1795150993917232269/report.json`,
including real UI save/index restore/file apply/branch/switch and independent
checks of exact stash parents, index trees, working bytes, retained stash,
unchanged HEAD/config and absent commit-attempt marker.
Full inherited-environment qualification passed all 258 scenarios at
`target/local-review/stash-scope/native/environment-1795151056653895494/report.json`,
identifying the same package/executable hashes. The full suite contains the 30
focused cases; these are not 288 unique scenarios. Runtime/runner inputs still
match `target/local-review/stash-scope/inputs.sha256`. This is local Ubuntu
26.04 extracted-package evidence, not installed or cross-platform proof.

Two earlier native helpers stopped after 25 and 26 scenarios, before completing
these new UI gates (`setup-keyboard-1795150767818213115` and
`setup-keyboard-1795150896209625098`). The first did not open the review after a
descendant label click; the final helper activates its parent menu button and
records a trusted click. The next generic WIP-row center landed on its nested
stash-message input, and an ambiguous Commit summary label also matched the
non-input inspector section. The final helper uses the actual Working Directory
button and unique `#commit-summary` input with read-only readiness. Compiled
inputs did not change during these Python-only corrections. No click replay,
application repair, timeout increase, system installation or release occurred.

## Deferred-menu branding selector and CI checkpoint — 2026-11-20

CI run [44667069442](https://github.com/Git-Khronos/Git-Khronos/actions/runs/44667069442)
at `70aafcb` completed with one renderer failure in the final shard: the chrome
identity test looked for `.app-menu-popover > header img.brand-mark`, but the
header now belongs inside `gc-main-menu-content`. Windows boundaries, source
checks, Jammy package/native/catalogue and all five installed Ubuntu/Debian jobs
passed for that earlier commit/artifact; the overall run is not green.

The same failed selector was reproduced locally at
`target/local-review/main-menu/identity-red/`; a decoded CI failure excerpt is
retained in `target/local-review/main-menu/ci-44667069442/`.
Only the direct-child assumption was removed. The original menu-header logo,
exact asset URL, empty decorative alt and completed nonzero image assertions
remain, with no retry or timeout increase. The corrected identity journey and
all seven deferred-menu journeys passed together (eight cases) at
`target/local-review/main-menu/identity-final/`.
This is test-only; it does not change the previously qualified compiled package.
The newer three local correctness commits have their own evidence below and
still require current CI qualification after their normal `dev` push. No system
installation or release was performed.

## Source-bound tag and remote-reference reviews — 2026-11-20

The new renderer regression reproduced ten failures against the previous source:
all six tag/remote-reference actions dispatched after a same-ID checkout-path
replacement, outgoing confirm/cancel consumed a replacement review, and held
remote rename success changed the replacement source's hidden/solo filters.
Six valid-action controls passed in the same red run, retained at
`target/local-review/reference-scope/renderer-red/`.

The request now retains source ID/path and root-owned identity. Deferred child
handlers consult that root ownership synchronously, not only the child's input,
which may still hold the previous request before the next render. Menu handoff,
loaded/failed/loading escapes, name/remote changes, read results and operation
cancellation share the reference lease. Remote-rename UI events retain their
source and cannot update another checkout's preferences. Explicit service
mutation outcomes determine dismissal; global errors cannot turn a refused
mutation into apparent success. Native Git authority, leases and receipts remain
unchanged. Ordinary Enter works; modifier Enter and background commands cannot
escape the review into the staged draft.

Final source passed 65 focused renderer cases (reference scopes/actions, local
rename and deferred graph/background UI), all 265 TypeScript tests, graph
typechecking and 107 runner tests. The first attempted build exposed Angular's
modifier-key binding `$event` type as `Event`, not `KeyboardEvent`; an explicit
runtime keyboard-event check corrected this, and the final production build
passed. The earlier compile failure is not presented as a product regression.
The size warning remains under unchanged budgets. No dependencies, contracts,
workflow or version changed.

The preserved candidate package is
`target/local-review/reference-scope/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `3f45f2f05e8e7f62b39df38d77ed3754a6393a0fcc793195fe4743f2dda5ae98`;
executable SHA-256
`f868488b64b6a7d35b90b20617f434f3b0abed0da6771a31077472093552e032`.
It passed all 30 focused remote-review scenarios at
`target/local-review/reference-scope/native/remote-reviews-1795149009944758364/report.json`.
Full inherited-environment qualification passed all 253 scenarios at
`target/local-review/reference-scope/native/environment-1795149050993079403/report.json`,
identifying the same package/executable hashes. The full suite contains the 30
focused cases; these are not 283 unique scenarios. Runtime/runner inputs still
match `target/local-review/reference-scope/inputs.sha256`. This is local Ubuntu
26.04 extracted-package qualification, not installed or cross-platform proof. After build
start, only the Python recovery oracle was corrected to inspect the actual native
recovery refs, not the separate operation-recovery journal; compiled inputs did
not change. New native UI scenarios cover
all six actual actions using an owned annotated tag and local bare remote,
including fresh remote-tag checks, recovery and unchanged dirty checkout data.
No installation or release was performed.

## Source-bound local branch rename — 2026-11-20

A renderer regression sent `rename_branch` to repository B when an old palette
rename form was confirmed in the interval before the repository-change effect.
The same-ID/path-replacement variant also dispatched incorrectly. Separate held
success cases changed the new source's pinned/hidden/solo preferences, and
outgoing confirm/cancel controls consumed a replacement request. The corrected
red run records six failing cases and one valid-action pass at
`target/local-review/branch-rename/renderer-red-corrected/`; an earlier probe
also contained an incorrect expected undo-kind spelling, corrected separately.

Palette rename now owns branch, source ID/path, request identity and return
focus. Confirmation checks these synchronously and refuses busy submission;
scope changes retire the review without focusing the wrong checkout. The form
shows its source and isolates keyboard navigation/shortcuts. Context-menu local
rename checks its rendered menu/source too. Both entry points consume the
actual service mutation outcome and update preferences only for the matching
active source. Source-owned undo receipts remain recorded after tab switches.
No native Git semantics, contracts, dependencies, workflow or version changed.

Final source passed 101 affected rename/reference/branch-panel renderer cases,
23 operation-history cases and the owning command-palette journey (125 total,
not a whole-renderer run), all 265 TypeScript tests, graph typechecking and 107
runner tests. The production build and preview guard passed under unchanged
budgets; the initial-size warning remains. A glob-quoting attempt selected no
unit tests, and an Nx comma-argument issue selected no palette test; both were
corrected and the actual passing counts above are from the subsequent runs.

Candidate package:
`target/local-review/branch-rename/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `8a89b23661b0ba9830658473929192e7fdec62fa2f76d7bfb6339aeade188283`.
The candidate passed all 25 focused setup-keyboard scenarios at
`target/local-review/branch-rename/native/setup-keyboard-1795147536000806453/report.json`,
including actual palette/context rename round trips and shortcut isolation.
Executable SHA-256 is
`0db209aedcb2ec4c3a8c3e53d7e2e47980e0220678d7932a0725c81e45a6f258`.
Full inherited-environment qualification passed all 247 scenarios at
`target/local-review/branch-rename/native/environment-1795147569822088839/report.json`,
with the same package/executable hashes. This includes the focused 25 scenarios;
it is not 272 unique cases. Both actual rename entry points preserve staged and
untracked contents, index/config bytes and the commit draft. Final inputs still
match `target/local-review/branch-rename/inputs.sha256`. This is local Ubuntu
26.04 extracted-package proof, not system-installed or cross-platform proof. Only Python native selector/
scroll readiness changed after build start, not compiled code. The first native
attempt stopped after 24 scenarios before clicking the below-fold context Rename
button; its screenshot/report remain at `setup-keyboard-1795147461901684309`.
The final helper uses the existing normal-scroll/hit-target check and one click,
not action replay or a larger timeout.
No system installation or release was performed.

## Inherited Git config-file selector isolation — 2026-11-20

A real packaged regression on the previous `deb037a3` package completed all 18
smoke scenarios, then failed the independent selected-identity check: the native
snapshot returned `Unselected outside identity` from the unrelated owned
repository instead of `Native Fixture`. Evidence is retained at
`target/local-review/git-config-context/old-package-native/smoke-1795145506751745427/report.json`.
No hosted service, personal repository or configuration was modified.

The shared process boundary now removes legacy `GIT_CONFIG` as well as existing
repository/index/pathspec selectors. It preserves system/global/count policy,
credentials and explicit internal alternate-index overrides. Two real
child-process regressions failed against the old core at the changed review
fingerprint assertion and pass with the fix; they additionally exercise actual
selected-author commits and local identity writes, retaining outside/system/
global config bytes. The full core library passed 1,047 tests (37 existing
ignored), terminal-context and eight external-terminal tests passed, all-target
workspace Clippy passed, and all 107 Python runner tests passed.

The newly built package is retained at
`target/local-review/git-config-context/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `220e3aa9b531b0c4810d144a1f694485d57bb43455fa37a7799dbb7b5fb5d518`.
Packaged inherited-environment qualification passed all 245 scenarios:
`target/local-review/git-config-context/native/environment-1795145962977416503/report.json`.
The same artifact passed all 26 focused inherited remote-review scenarios:
`target/local-review/git-config-context/native/remote-reviews-1795145929132925820/report.json`.
These overlap; they are not 271 unique scenarios. Both reports identify executable
SHA-256 `312d97743440476336d0cd3b0411885ccd6212983356d372246c231d11bf2c04`.
The independent oracle confirms the selected identity and unchanged outside
config/index/HEAD/working bytes. Runtime and runner inputs still match
`target/local-review/git-config-context/inputs.sha256`. This is local Ubuntu
26.04 extracted-package evidence, not installed or cross-distribution proof.
No frontend behavior, generated contracts, dependencies, workflow, version or
budgets changed. No system installation or release was performed.

## Native force-push configuration preflight — 2026-11-20

A red core regression demonstrated that changing an owned remote's push URL
after review wrote a second bare repository with the same base commit: a pinned
commit lease alone does not bind the destination configuration. Force review
now captures native configuration evidence and every Git-expanded push URL.
Confirmation rechecks that evidence before launching Git. The UI retains source
and request identity through the async inspection, disables confirmation until
ready, presents redacted destination labels and warns about multi-destination
partial failure. The existing pinned local/remote OIDs, named-remote transport,
hooks and credential policy are unchanged. This is optimistic launch preflight,
not an immutable endpoint capability, DNS/configuration lock or atomic push
across multiple servers. Any enumerated Git configuration change conservatively
requires a fresh review.

Final validation passed 301 selected renderer cases, nine affected workspace
journeys and two minimum/compact-window layout cases (312 executions, not a
whole renderer run). The layout probes retain all 128 long destination labels
and a usable keyboard cycle at the native 780x560 minimum. All 265 TypeScript
tests, graph typechecking, generated-contract checks, workspace/all-target
Clippy, production build/preview guard and 107 runner tests passed. The complete
core library run passed 1,047 tests; 37 existing tests remain ignored for their
separate gates. Core regressions cover push-URL and URL-rewrite rebinding,
multiple push URLs and multi-URL fallback, valid fresh pushes, bounded metadata
refusal and privacy-preserving labels. SCP/IPv6/local addresses and literal URI
case/path segments are preserved rather than URI-normalized.

Final preserved package:
`target/local-review/force-destination/label-fix/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `deb037a3054e3f59c251575e126f4a94f43a4c6c2fc3c5761acdd430dc0d04bd`;
packaged executable SHA-256
`6aca138de8d7153a4af22fa7fcaee9f925766b5ae951f2f1eb3cbac73db39cb4`.
It passed 24 focused remote-review scenarios and all 243 full native scenarios:
`target/local-review/force-destination/label-fix/native/remote-reviews-1795144023707511760/report.json`
and
`target/local-review/force-destination/label-fix/native/full-1795144049224119584/report.json`.
The full run includes the focused scenarios; they are not 267 unique cases.
Actual UI/native checks reject an owned URL rebind without writing either bare
remote, then accept a fresh explicit review of the replacement while preserving
staged/untracked data and index/config bytes. Runtime/core/renderer fingerprints
match `label-inputs.sha256`. Initial production assets are 1,431,729 bytes,
leaving 18,271 under the unchanged hard limit; the warning remains. Root
component CSS, dependencies, version and workflow configuration did not change.

An earlier full attempt stopped after 40 scenarios because the editor recovery
helper immediately looked up a menu item during a cold restart's loading state;
no item click had been attempted. Editor recovery and the merge-palette journey
now wait for their actual visible item before one native click, without action
replay or longer configured deadlines. The workspace force test also includes
the newly keyboard-reachable destination list instead of assuming only two
controls. The final full run above passed after these adjustments. The earlier
package and failed evidence remain retained separately, not substituted for the
final artifact.

Previous source checkpoint `7bdf185` CI run
[44656039197](https://github.com/Git-Khronos/Git-Khronos/actions/runs/44656039197)
completed successfully: checks/full renderer, Windows boundaries, Jammy
package/native/catalogue, and installed Ubuntu 22.04/24.04/26.04 and Debian
12/13. That qualifies its own commit/artifact, not this newer local package.
This batch is local Ubuntu 26.04 extracted-package acceptance; no system
installation or release was performed. The separately tracked legacy `GIT_CONFIG` environment-context follow-up is
recorded above; the force-push package is not relabeled as containing that fix.

## Deferred main-menu presentation — 2026-11-20

Optional main-menu markup and exclusive styles now load on demand. The root
retains its actions, open state, outside dismissal, keyboard navigation and
focus ownership. Real Cancel/Close controls remain available while code loads
or fails. Late content cannot reopen a retired menu or take outside focus;
normal Tab/Shift+Tab and compact-height scrolling remain covered.

The frozen-input gate passed 142 selected renderer cases, plus four affected
workspace/menu journeys (146 executions, not a full renderer run). All 265
TypeScript tests, graph typechecking, production build/preview guard and 107
native-runner tests passed. New fixture probes were corrected for browser-chrome
Shift+Tab, ambient document versus retired-menu event handling and an outside
pointer target covered by the menu; those were not product regressions.

Initial production assets decreased from 1,436,774 to 1,430,842 bytes: 5,932
bytes saved, with 19,158 headroom under the unchanged hard limit. The 10,690-byte
main-menu chunk is outside the initial static import closure. This measures
initial assets, not total download size or a benchmarked startup-time gain.
The warning remains. Root component CSS, dependencies and Rust source did not
change; only the menu's exclusive global styles moved to its optional component.

Preserved package:
`target/local-review/main-menu/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `5e7894e90be9d14c5220448d774f478418780ea464d5824300c541907e8ea4a7`;
packaged executable SHA-256
`49e33388e764ef921343e7783b77d77c3960d1d3a4e2bd4d8ae06e109200b6f4`.
All 18 packaged smoke scenarios passed:
`target/local-review/main-menu/native/smoke-1795140062762921601/report.json`.
The native menu check requires focused real content, not the loading escape,
before measuring its header/scroll area and testing Tab. Its recorded bounds
are top 36, bottom 826 within a 900-pixel viewport. UI and runner fingerprints
matched after qualification. This is local extracted-package acceptance, not
a new full native run, installed desktop qualification or release approval.
No system installation or release was performed.

## Source-bound publish, force-push and LFS reviews — 2026-11-20

Publish, force-push and exact/retention LFS cleanup reviews now capture their
source checkout and per-opening identity. Dispatch, outgoing selectors and
remote-editor handoff refuse retired/replaced or mismatched ID/path requests.
Old preview success/failure/loading completion cannot replace a newer LFS
review; preview arrival preserves focus already inside the dialog. Shared
confirmation loading/error controls carry their rendered request leases.
Native pinned force-with-lease object IDs and mutation receipts remain intact.

The frozen-input renderer gate passed 289 selected cases; seven additional
affected workspace journeys passed separately (296 executions, not an entire
renderer run). All 265 TypeScript unit tests, graph typechecking, production
build/preview guard and 106 native-runner unit tests passed. The initial red
probe included a force-positive fixture mistake: browser-preview mode bypassed
IPC. Corrected positive cases exercise intercepted native IPC, rather than
treating that fixture failure as a product regression.

Preserved package:
`target/local-review/remote-review-scope/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `cb7b217ff76bc686b0e7a7ada7962e74714c32bdc115320f0e3e6096dc9fa30b`;
packaged executable SHA-256
`edf0fba58dc5bf35c84188bc9d424687c86c90930cb2c4df2bade9326f602347`.
The focused remote-review suite passed 22 scenarios:
`target/local-review/remote-review-scope/native/remote-reviews-1795138539441345512/report.json`.
It proves actual publishing, stale pinned-lease refusal after a concurrent
local-bare remote update, a successful fresh force review, and exact removal of
a real unreferenced LFS cache object. Staged/untracked data and index remain
unchanged. Its first attempt stopped because the fixture had not initialized
LFS; only the fixture was corrected before rerunning the same package.
The setup/keyboard suite passed 23 scenarios:
`target/local-review/remote-review-scope/native/setup-keyboard-1795138564641706944/report.json`.
These focused suites share the ordinary 18 smoke scenarios, not 45 unique
scenarios. The same unchanged package then passed all 241 full native scenarios
in 9m 16s:
`target/local-review/remote-review-scope/native/full-1795138602497703360/report.json`.
This full run includes the new remote/LFS journeys and existing branch,
worktree, history, recovery, file-tool, hosting-fixture and transport checks;
it does not turn local fixtures into live hosted-service qualification.
UI and runner input manifests matched after the full run. Initial production size is
1,436,774 bytes, leaving 13,226 before the unchanged hard limit; the warning
remains. Root component CSS is unchanged. No dependency, budget or Rust source
changed, and no system installation or release was performed.

Separately, previous checkpoint `9c2eaaa` CI run
[44648780920](https://github.com/Git-Khronos/Git-Khronos/actions/runs/44648780920)
passed Jammy build/native/catalogue, Windows boundaries and installed Ubuntu
24.04/26.04 and Debian 12/13 checks. Installed Ubuntu 22.04 failed before the
discarded-recovery opener click: the presence/enable wait was followed by a
separate lookup that found no laid-out match. Its screenshot alone does not
establish the exact transient cause. The opener now uses one exact read-only
readiness lookup, with the same default deadline and single native delivery;
missing/ambiguous controls and uncertain replies remain failures, not retries.
The unchanged CI artifact (package SHA-256
`7b58ee626c6795fde933d28457ccf8862b3891e4155e415fbbff81bfa71b4dc1`)
passed 18 local extracted-package smoke scenarios with that runner:
`target/local-review/remote-review-scope/ci-artifact-recheck/smoke-1795138073607001524/report.json`.
This local Ubuntu 26.04 recheck does not prove the installed Jammy job passes.
The previous checkpoint's full renderer CI was still running when checked;
neither that run nor this local batch is release approval.

## Source-bound destructive reviews — 2026-11-20

Branch deletion/rebase, sparse checkout and worktree-removal requests now retain
their original repository ID/path and independent return-focus ownership.
Sparse action, paths and sparse-index choice form one captured request rather
than reading a mutable preferences draft at confirmation time. Source effects
retire mismatches, while synchronous dispatch checks and rendered object leases
also protect pre-effect repository/path changes, outgoing confirm/cancel/force
controls and replacement requests. Busy branch/sparse reviews retain identity
until completion; cancellation retires presentation without canceling native
work or replaying it. Late results cannot replace a newer review or its draft.
Checkout captions identify the captured source. The underlying service captures
its repository snapshot synchronously before awaiting native work; native Git
and operation receipts remain authoritative.

The new regression suite passed all 27 cases. The final frozen-input renderer
gate passed 207 selected cases, with another 11 affected workspace journeys
passing separately (218 executions total). All 265 TypeScript unit tests,
graph typechecking, production build/preview guard and 103 runner unit tests
passed. The first red gate also exposed an incorrect fixture field name for
the sparse-index argument; final expectations use the actual `sparseIndex`
contract. The wrong-destination failures described in the earlier diagnostic
below are addressed by these source-bound request checks, not by skipping
valid native dispatch.

Preserved package:
`target/local-review/confirmation-scope/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `7cf287db2fe224c2b0b0831f2b78a763c50ef89c062a318f9f08ea79d9de55f3`;
packaged executable SHA-256
`084e434d3cd27de03057338968dec77d10ac77f93834d56f6991c6787bd1e0fb`.
The focused setup/review suite passed 23 scenarios, including explicit native
branch deletion with preserved dirty/staged data and one recovery receipt:
`target/local-review/confirmation-scope/native/setup-keyboard-1795135512580665523/report.json`.
The same package passed 21 linked-worktree scenarios:
`target/local-review/confirmation-scope/native/worktrees-1795135533368406171/report.json`.
The ordinary smoke scenarios overlap between those two reports; they are not
44 unique scenarios. UI and runner fingerprints matched their retained input
manifests. Build size is 1,431,679 initial bytes, leaving 18,321 before the
unchanged hard limit. No budget, dependency or Rust source was changed.

These are local Ubuntu 26.04 extracted-package checks, not a fresh entire
renderer/native suite, installed desktop acceptance, remote Linux matrix or
release approval. No installation or release was performed for this batch.

## Local confirmation keyboard isolation — 2026-11-20

The next bounded batch extends the keyboard guard to eleven confirmation
families, repairs retired history-dialog event handling, and traps Tab inside
bisect startup. Its renderer probe found 22 failures before the guard changes;
a separate bisect probe confirmed focus escaping. The final frozen-input gate
passed 144 selected renderer cases, including explicit Enter, Tab/Escape,
focus gaps, retired controls and adjacent shortcut/reference/state-machine
journeys. All 265 TypeScript unit tests, graph typechecking, production build
and preview guard, and 103 native runner unit tests passed. Initial production
size is 1,428,658 bytes, leaving 21,342 below the unchanged hard limit; the
initial-bundle warning remains. No dependency, budget or Rust source changed.

Preserved package:
`target/local-review/confirmation-keyboard/artifacts/Git-Khronos_0.1.6_amd64.deb`,
SHA-256 `190e3ba96183916200122ebad406c262fa49b06e8f4e6ddaea5de08b81327646`;
packaged executable SHA-256
`2689b676a6ab0b11c7cf158aa9c5c69ce7298dbdc8ad0a211b1d2462a75b130f`.
All 22 focused native scenarios passed in
`target/local-review/confirmation-keyboard/native-green/setup-keyboard-1795133948805242058/report.json`.
The same final checks on the preceding immutable package recorded a real
commit attempt, refused by the owned hook, and background palette activation
from a branch-deletion review:
`target/local-review/confirmation-keyboard/native-red-qualified/setup-keyboard-1795133928337458748/report.json`.
The existing setup-form protections passed in both packages. This is not a
fresh entire renderer/native-suite result or a release approval.

Earlier fixture runs stopped at an incomplete menu label, an off-screen Delete
control, or an unobserved discarded-recovery navigation. They do not establish
the new confirmation bug. Both navigation controls now use the already tested
single-delivery scrolling/hit-target helper, with no timeout increase or
mutation retry. The final red/green comparisons use identical runner inputs;
UI and runner input manifests are retained alongside the reports.

A separate renderer diagnostic refused every native request but recorded wrong
destination `repoId` payloads after an active-repository switch for branch
deletion, sparse-checkout disable and worktree removal. Its three failures are
under `target/local-review/confirmation-keyboard/scope-probe-output/`. This is
an unfixed follow-up at this checkpoint, not acceptance of cross-repository
confirmation safety; native commands were not executed by that diagnostic.

## Local setup keyboard isolation — 2026-11-20

The root now blocks ambient shortcuts while worktree, submodule, remote editing
or remote-removal reviews own keyboard intent. Modified Enter cannot implicitly
submit or activate a focused button; plain Enter, native text editing, local Tab
cycling and Escape remain available. Retired DOM cannot retain the guard after
dismissal. This is a seven-line root routing change, not a global shortcut rewrite.

The initial renderer probe found ten failing focused-control cases. A stronger
pre-render probe using an HTMLElement event target found five additional
failures; the earlier document-target probe was insufficient because downstream
target handling expects an element. The final gate passed all 126 selected
renderer cases, including adjacent reference, worktree and setup ownership
coverage, with zero retries. All 265 TypeScript unit tests, graph typechecking,
the production build/preview guard and 103 runner unit tests passed. Source
fingerprints and renderer evidence are under `target/local-review/setup-keyboard/`.
Initial production bytes are 1,428,199 (21,801 below the unchanged hard limit).
The initial-bundle warning remains; no budget, dependency or Rust source changed.

The preserved package is
`target/local-review/setup-keyboard/artifacts/Git-Khronos_0.1.6_amd64.deb`, SHA-256
`47948584cfe3c150efcea4e1cdb87b46960d2150cbfaeab286139bcdb878b5e2`;
packaged executable SHA-256
`c022687252c4b3c126693ccc7d229a09d7f2946d7901d35d99ebb5a7e2c92a65`.
The new focused `setup-keyboard` suite passed all 21 scenarios in
`target/local-review/setup-keyboard/native-green/setup-keyboard-1795131695351675889/report.json`.
The same final checks on the previous immutable package recorded a real commit
attempt (refused by the owned fixture hook) and a background command palette:
`target/local-review/setup-keyboard/native-red-evidence/setup-keyboard-1795131674804864416/report.json`.
An earlier fixture run stopped at an ambiguous input selector before sending
shortcuts; it is not evidence of a product failure. Neither renderer mocks nor
the hook marker alone establish data preservation: the green native run also
compares HEAD, refs, index/config bytes and staged/untracked file contents.

This bounded follow-up has not rerun the entire renderer or full native suite;
the preceding 232-scenario full-package result below belongs to its older
artifact. No release or system installation was performed for this follow-up.
Separately, the user confirmed that restarting WSL restored both CLI and pinned
launches. The new WSLg log reports `use_gfxredir = 1`; later Mesa/EGL warnings do
not by themselves identify the selected renderer or prove an application failure.

## Source review update — 2026-11-19

### Repository setup scope and packaged worktree navigation

The next local batch binds worktree, submodule and remote setup reviews to the
repository ID, checkout path and individual opening. Retired rendered controls
cannot submit a replacement request or overwrite its draft; asynchronous picker
and operation replies cannot close or navigate a newer review. Captions identify
the captured checkout, and busy forms retain an enabled dismissal/focus target.
Native Git and operation receipts remain authoritative; these transient UI
owners are not native mutation capabilities.

Frozen application inputs passed 139 focused renderer cases plus 33 workspace
journeys, 265 TypeScript unit tests, graph typechecking, the production build and
preview guard. This is 172 targeted renderer cases, not a fresh full renderer
suite. Evidence is under `target/local-review/setup-scope/lease-final`,
`lease-final-report`, `workspace` and `workspace-report`; the UI input manifest is
`target/local-review/setup-scope/ui-before.sha256`. Initial size is 1,428,024
bytes (21,976 below the unchanged hard limit); root styles remain 74,680 bytes.
The 900 kB initial-bundle warning remains. No budget or dependency was changed.

The native runner adds three actual linked-worktree journeys: canceling an
occupied-branch review, explicitly opening its owning checkout, and refusing
navigation after that ownership changes. Both dirty checkouts' files, refs,
configuration and per-worktree indices are compared, not merely toast text.
The focused worktree suite passed 21 scenarios and the GitLab suite passed 45
against the preserved new package under
`target/local-review/setup-scope/artifacts/Git-Khronos_0.1.6_amd64.deb`, SHA-256
`dab37ee0c9307dccae7b6596223c35bb9f814af72d6e807192e059bc90fd4467`.
Reports are under `target/local-review/setup-scope/native/`.

CI run `44614222982` for the preceding `88b5f58` checkpoint failed in the
partial-discard acceptance observation: diff disappearance could satisfy its
wait before command feedback arrived. The runner now clicks the visible enabled
confirmation once and requires the closed confirmation plus the rendered exact
native refusal before inspecting unchanged disk/index/recovery state. A second
undo observation likewise no longer accepts an unrelated stage control. No
mutation retry, timeout extension or native implementation change was added.
All 101 runner unit tests passed, including independent evaluation of the actual
read-only observation predicate against pending, unrelated and hidden feedback.

The exact failed CI package, SHA-256
`8a540f297664949359f52c73a62bc62759d7690760d8cbf99a599c06523bbe21`, passed
232 native scenarios locally with those stricter observations. Its report is
`target/local-review/setup-scope/strict-validation/ci-artifact/full-1795127584580992079/report.json`.
This unchanged-artifact result is local Ubuntu 26.04 evidence, not a passing
remote Jammy run or distribution matrix. Strict full acceptance of the new
package also passed all 232 scenarios, with unchanged UI and runner input
fingerprints. Its report is
`target/local-review/setup-scope/strict-validation/new-package/full-1795128083121918554/report.json`;
the packaged executable SHA-256 is
`48f6cf5e252ede3baf9b9db14017f86c7290113042adf0da28bedcb4dcfa35f7`.
Neither a release nor system-installed desktop integration is established by
these extracted-package checks. A separate read-only/no-op renderer diagnostic
then confirmed that setup dialogs leak ambient commit and palette shortcuts;
that follow-up is not fixed or qualified by this batch.

The release workflow now generates package and source CycloneDX inventories
and `SHA256SUMS`, verifies those checksums, and gates publication on the
reusable exact-package Linux runtime acceptance workflow. The roadmap's older
statement that SBOM and checksum generation are entirely pending is superseded
by that source evidence. AppImage and signed-update delivery remain separate.

This is a static workflow review, not a new release approval: no current remote
run, published asset, installed desktop journey, or platform acceptance result
was verified during this update. The historical artifact hashes and test
results below retain their original dates and scopes.

## Earlier local branch-navigation and startup checks — 2026-11-19

The working tree on `dev` now offers explicit navigation for occupied local
branches, with fresh ownership inspection, retained source drafts and keyboard
loading/failure escapes. Local validation passed 262 TypeScript unit tests,
the graph TypeScript check, and 100 renderer cases across branch navigation,
branch-panel interactions, deferred background UI and terminal lifecycle. These
are source/Chromium checks, not acceptance of a newly packaged native app.

Production build statistics measured 1,448,541 initial bytes before this work
and 1,448,465 afterward, including the new UI. Browser sample/detail/diff
builders are now in an 8,899-byte non-initial chunk; existing xterm base CSS
loads with the terminal, reducing initial CSS from 192,888 to 189,268 bytes.
This offsets the new UI's startup cost; it is not a substantial reduction in
the whole initial bundle or a measured startup-latency improvement.

The normal `desktop:build` gate and its production-preview guard passed (67
JavaScript assets). No budget was raised: initial warning/error thresholds
remain 900 kB/1.45 MB and component styles remain 76 kB/80 kB. Both warnings
remain: initial size is about 1.448 MB and root component styles about 77.97 kB.
Only 1,535 bytes remain below the initial hard limit, so further shell/template
decomposition is still needed before substantial new eager UI is added. The
baseline statistics came from a successful Angular compile whose enclosing Nx
command rejected caching an output outside the workspace; it is not recorded
as a successful baseline Nx gate. The final gate used a workspace-local output.

## Follow-up reference-editor and harness checks — 2026-11-19

Tag and upstream reviews now capture their source repository ID and path,
retire stale scopes and check ownership again before dispatch. Tag completion
cannot clear a replacement review's draft. The forms and their exclusive styles
are deferred presentation components; root-owned requests and native Git remain
authoritative. The icon renderer binds three primitive types to the original
53 geometries, with independent geometry hashes and rendered-SVG parity checks.

The stable final local gate passed 265 TypeScript unit tests, 95 native-harness
tests, the graph TypeScript check, and 142 renderer cases with zero retries.
The renderer gate used a fresh server on an isolated port and serial CI settings.
Input fingerprints matched before and after validation. An earlier intervening
run had one graph-loading failure while inputs changed; it was not accepted as
final evidence, and the failure is not attributed exclusively to those edits.
Final evidence is under `target/local-review/stable-renderer` and
`target/local-review/stable-renderer-report`; source fingerprints are alongside
them. These are local source/Chromium checks, not packaged native acceptance.

The normal production build and preview guard passed for 68 JavaScript assets.
Initial size is now 1,443,922 bytes, down 4,543 bytes from the preceding local
batch, leaving 6,078 bytes before the unchanged 1.45 MB hard limit. Root component
styles are 75,990 bytes: the component-style warning is cleared, but only by
10 bytes at its unchanged 76 kB warning threshold. Deferred form styling,
consolidated adjacent equivalent CSS rules and the smaller icon renderer improve
headroom without a budget increase. The overall 900 kB initial-bundle warning
remains; this is not completion of the larger shell-decomposition work or a
measured startup-latency improvement. These measurements supersede the earlier
local size/headroom figures above, not any artifact qualification below.

The native harness adds opt-in navigation-only stale-refusal reacquisition and
shares its structured error parser with the GitLab catalogue opener. Generic
write/submit clicks, ambiguous/obscured controls, lost replies and other failures
are not globally retried. Packaged native acceptance still needs to qualify
these helper changes; no system installation or remote CI run occurred.

## Deferred graph action menu checks — 2026-11-19

The graph action menu is now an on-demand presentation component. The root still
owns requests, Git callbacks, menu positioning, keyboard handling and focus
restoration. Loading/failure escapes cannot dispatch commands. Renderer coverage
includes late and failed imports, loaded-content refitting and scoped styling,
keyboard focus transfer, replacement targets and retired repository requests.

A fresh isolated server with serial CI settings and zero retries passed all
87 selected renderer cases. The 265 TypeScript unit tests, graph TypeScript
check, normal production build and preview guard (69 JavaScript assets) passed.
Application/test input fingerprints matched across the final renderer run.
Evidence is under `target/local-review/graph-menu-final-renderer` and
`target/local-review/graph-menu-final-report`, with validation fingerprints under
`target/local-review`. An earlier 84-pass/2-fail renderer run exposed two new
fixture mistakes (expecting a browser-preview-disabled action to receive focus,
and clicking a hover-hidden overflow control); those fixtures were corrected,
without retries or application changes, before the passing frozen-input run.

`dist/graph-menu-review/browser-stats.json` measures 1,422,880 initial bytes,
down 21,042 bytes from the preceding local batch. The 23,120-byte graph action
JavaScript chunk is non-initial. Root component CSS is 74,680 bytes, leaving
1,320 bytes below the unchanged 76 kB warning. Initial hard-limit headroom is
27,120 bytes at the unchanged 1.45 MB limit. These figures supersede the local
size figures above; the overall 900 kB warning still remains. No startup-latency
benchmark, packaged native qualification, commit, push, release or installation
is implied by these source/Chromium checks.

## Final local maintenance qualification — 2026-11-19

The frozen final source passed **2,029 renderer cases** on a fresh isolated
server with two workers and zero retries. All application/test fingerprints
matched before and after the full run. The preceding serial run passed 2,023
cases and failed four: three fixtures assumed the old immediate DOM parent,
repository-name-only status text, or synchronous sample diffs; one exposed a
real editor-close keyboard race. Tests now measure the visible menu, assert
both repository name and path, and wait for enabled navigation controls without
changing the existing busy guard. Two deterministic regressions failed before
the keyboard fix and passed afterwards. Retired tag/upstream forms no longer
swallow a global shortcut before Angular removes their DOM.

The final production build, preview guard (69 JavaScript assets), 265 TypeScript
unit tests and graph typecheck passed again after that fix. Unchanged Rust
sources passed 1,268 tests with 50 existing ignored tests; packaging regressions
passed 84 tests and the native harness passed 95. No budget or dependency was
changed. Final initial assets total **1,422,950 bytes**, leaving 27,050 bytes
under the 1.45 MB hard limit; root CSS remains 74,680 bytes. The 900 kB initial
warning remains. These figures supersede earlier local measurements above.

The rebuilt and verified local Debian package is preserved at
`target/local-review/qualification/artifacts/final/Git-Khronos_0.1.6_amd64.deb`:

- Package SHA-256: `598c623a07dca2fc1c5af25ee9a6ffb84e625aad4c70a4c5a06bfcc2d1feaa72`.
- Extracted executable SHA-256: `8821a5b3c33c78b2a65961a3bc19df12efe8f0d09d9e4483c40786b824ca5daa`.
- GitLab catalogue/fork/HTTPS/SSH acceptance: **45 scenarios passed**,
  `final-native/gitlab-1795113050566603551/report.json`.
- Full native acceptance: **229 scenarios passed**,
  `final-native/full-1795113142929576340/report.json`.

Both native reports record identical package and executable hashes. Paths above
are relative to `target/local-review/qualification` unless written in full.
Renderer evidence is in `final-full-renderer` and `final-full-renderer-report`;
input fingerprints and `final-native-qualification.json` bind the local evidence.
The first package and all failed attempts remain preserved separately. Native
provisioning initially failed on WSLg's read-only filesystem socket mount, then
on a locally extracted OpenSSH helper's missing `libwrap.so.0`. A verified,
high-numbered abstract-socket Xvfb launcher and locally extracted matching tools
resolved those environment failures; no app/harness workaround or system
package installation was used. `tools-manifest.json` records the local tools.

This is extracted-package qualification on the local Ubuntu 26.04 host, not
Jammy ABI, system-installed, Windows, multi-distribution release or remote CI
qualification. No release tag, release publication or app installation was
performed. Subsequent source changes require their own qualification.

## Historical qualification boundary — 2026-10-30

The source reviewed in the 2026-10-30 audit included the streaming ignore-rule
fix, reviewed Rust and frontend notices, and the selective performance/readiness
branch integration. At that checkpoint, source checks and the complete renderer
suite passed (1,205 cases, zero failures or retries), alongside unit, LFS,
packaging and native-harness tests.
The final Debian artifact has SHA-256
`efa425efbc83c2da9fdf5fe520c544845f37d6606f557e675a5c223cef00d14d`
and passes verification and all 10 native smoke scenarios. Full/environment/
performance acceptance of older artifacts below does not qualify this new
artifact. Windows acceptance has not been run. No system package was changed.

See [the branch integration audit](branch-integration-2026-10-30.md) for that
checkpoint's artifact paths and validation evidence. The dated records below retain
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

Named `desktop:e2e` snapshot runs select a loopback port immediately before
starting Playwright and record it in their receipts. Previously, overlapping
snapshot runs could use the same default port and one run lost its HTTP
server during startup of the other. Set `PLAYWRIGHT_PORT` explicitly only
when the port is deliberately owned by that run. Port selection samples an
available port; it does not reserve it against unrelated processes.

Inspect a long-running named validation with
`node tools/run-validation.mjs status <run-directory>`. The JSON receipt
distinguishes source preparation, a verified live runner, and a final
result. A retired process with no result is not a pass, and an older live
receipt without process-start identity is reported as unverified. Reading
status never starts, restarts, or interrupts a validation. Receipts are
written atomically so a poll does not read a partial result.

Installed acceptance also publishes its final `report.json` atomically,
after cleanup is complete. A live `--release-progress` query therefore
sees either a complete result or an awaiting gate, not a half-written
report. `progress.json` remains a separate running status, not evidence
that a release gate passed.

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

## Deferred Windows shortcut inspection — 2026-11-21

The startup root no longer instantiates the Windows shortcut inspection service.
The deferred main menu refreshes it once per eligible opening; its dialog still
shares the same inspection and in-flight request. A matched production build
with statistics reports 1,447,724 initial bytes versus 1,449,856: 2,132 bytes
moved off startup, giving 2,276 bytes of headroom under the unchanged 1.45 MB
limit. The 900 kB warning remains, and startup latency was not benchmarked.
The shortcut, deferred main menu, and updater renderer suites passed 42 cases.

## Deferred merge conflict editor — 2026-11-21

The conflict editor and its scoped styles now load when the editor opens. The
root still owns drafts, operation scope, and Native Git actions. Loading and
failed-import fallbacks trap keyboard focus, can be dismissed, and never
dispatch a resolution. Tests assert that scoped styles preserve the compact
layout. Initial bytes dropped from 1,447,724 to 1,434,707, leaving 15,293 bytes
under the unchanged error limit; the 900 kB warning remains. The 40 owning
renderer tests and 86 neighboring cases passed. A publisher-key-enabled Debian
package also passed 271 native cases. That local package is not the Jammy
release artifact and was not published or installed.

## Jammy candidate with staged and unstaged recaps — 2026-11-21

A network-disabled Ubuntu 22.04 build of source
`fbd0db399ffcb92dc837e6955a6745a2f8d71ba2` produced
`Git-Khronos_0.1.6_amd64.deb` with the publisher public key compiled in.
Installer SHA-256:
`8db18dfc761ad4a2d305da69ca86457fc07af74ac75a2623ec74a05c58d90c97`.
It declared the glibc 2.35 baseline, required symbols through GLIBC_2.34,
and passed the release ABI and strict receipt/evidence checks.

The extracted package passed all **272 native environment scenarios** on
WSL2, including the configured publisher key and automatic updates off by
default. Before staging a partially staged file, its two section totals were
staged +1/−1 and unstaged +4/−3. After staging it, they were +2/−1 and +2/−2.
The binary exclusion remained visible, and the pre-staging read preserved the
owned Git index, references, configuration, and working files.

The identical installer passed APT dependency and package checks in a disposable
Ubuntu 24.04 container, then **45 installed GitLab catalogue scenarios**,
including real fixture HTTPS and loopback SSH. The harness checked the installed
binary and desktop entry against the archive before launching WebKitGTK.
The WSL host's extracted SSH fixture refused the reviewed clone; the same
bytes succeeded with a disposable login in Ubuntu. This does not establish a
host-specific pinned launcher, a live self-update, or installed coverage on the
other supported distributions for this exact build.

Local evidence is under
`target/local-review/updater/jammy-builder/qualification.d77zWOu2/`:
`work/artifacts/` has the unchanged installer, build receipt and ABI record;
`work/native-environment/` and `work/noble-native/` have the reports.
All 92 package regressions also passed. Nothing was installed on the host, signed,
tagged, or published as part of this qualification.

## Installed worktree navigation with literal Linux paths — 2026-11-21

An offline Jammy build of `6be75d18266a56e82d51b04ba937446a9173fb6b`
produced `Git-Khronos_0.1.6_amd64.deb`, SHA-256
`080167d2c64cf5dab179cf125bb13c106846241c5af51283726170f4bb2c0202`.
The release ABI check accepted the declared glibc 2.35 baseline; the highest
required version was GLIBC_2.34. This build includes the literal-path fix and
the stale branch-switch refusal flow. The follow-up commit `61237ff` changes
only test setup for symlinked temporary directories.

The same installer passed APT checks in an offline Ubuntu 24.04 container and
passed the installed **worktrees (21)** and **GitLab (45)** scenarios. Both
reports matched the installed executable and desktop entry to the archive.
The occupied branch case opened an existing dirty checkout whose directory
name contains Unicode, a tab and a newline; cancelling or navigating changed
neither checkout's HEAD, references, index, config nor working files. A change
of owner after review was refused without attempting a fallback switch.

Reports and the package are under
`target/local-review/updater/jammy-builder/qualification.YKPSJUk/`, in
`installed-noble/` and `work/artifacts/` respectively. This is not a signed
or published release and does not substitute for the hosted runtime matrix.

The broad installed environment run of that package stopped at cold
incoming-link startup before reaching the updater check. On Ubuntu 24.04,
Git 2.43 rejected the newer `--no-lazy-fetch` switch during saved repository
reads. Commit `4cb30fb` replaces that switch with the shared fetch-free scope;
real Git 2.39.5, 2.43.0 and 2.53.0 passed the repository-link and file-content
regressions. Explicit fetch still reached the independent owned control.
The SHA-256 stash test on Noble failed during fixture creation; the same
`git stash push --include-untracked` failed outside the app on that Git
version. It is not counted as a passing stash test.

The same unchanged `080167d2` package separately passed all 19 installed
`application-updates` scenarios, including the pinned public key, automatic
updates off, and no installable offer while offline. The focused report is
under `installed-noble-updates/` in the qualification directory above.
This is not full environment acceptance or a live signed update installation.

## Installed saved-tab and editor recovery follow-up — 2026-11-21

The next Jammy package was built from `4cb30fb`, SHA-256
`e7c06759239f6580eed680dc3e433d7ad92504ca44f5a372d65746e056f30f61`.
The exact installer passed all 26 focused incoming-link cases in an Ubuntu
24.04 container with both its stock Git 2.43.0 and a separately supplied
Git 2.39.5 binary. Both runs restored the expected saved repository on a
fresh application process and left the missing promised object unfetched.

The broad installed runs reached editor recovery, where the old harness
refused the installed path because it only recognized extracted executables.
The corrected harness uses the verified binary, private D-Bus owner and
private profile to bind the interruption to its own process. All 23 installed
recovery scenarios passed on the same artifact, including a different
replacement PID and explicit recovery/save. Evidence is under
`target/local-review/updater/jammy-builder/guarded-reads.e2R48c1/`.
These focused reports do not establish the full hosted release gate.

The same SHA-256 also passed the installed incoming-link (26) and GitLab
catalogue (45) suites in an offline Debian 12 container using its stock
Git 2.39.5 and glibc 2.36. The installed launcher and executable matched
the package. This is separate from running the Git 2.39 binary on Ubuntu.
Reports are in `bookworm-native/` under the same qualification directory.
The installed crash/relaunch suite also passed all 21 scenarios there,
including the private-bus process binding and explicit save.
The installed publisher-trust suite separately passed all 19 scenarios:
the public key was configured, automatic updates remained off and no offline
offer could be installed. That report is in `bookworm-updates/`.
The Debian 12 workflow now runs the incoming-link suite in place of plain
smoke (which it includes), so the cold-start regression is covered at the
supported Git floor. Hosted execution of that workflow is still pending.

The first Ubuntu 24.04 installed environment run after the recovery fix
recorded 164 successes before failing Git integrity inspection. A retained
initial integrity report identified the qualification setup problem: the
manually supplied Git 2.53 binary invoked the system Git 2.43 for its nested
`git refs verify`. The private fixture intentionally strips inherited
`GIT_EXEC_PATH`, so that override could not supply the matching helpers.
An independent local repository passed `fsck` with the modern binary and
helpers mounted at their normal paths in the container. On the subsequent
recheck, that exact installed candidate passed **272 environment scenarios**
with both Git integrity checks clean. The updater recognized the publisher
key, kept automatic updates off and offered no offline installation. Strict
local preflight accepted the Jammy receipt, Debian ABI, exact package digest
and environment evidence for `e7c06759`. The report is under
`noble-coherent-git/`; `noble-coherent-preflight.sha256` records the accepted
digest. This does not qualify the later setup-dialog or workflow-lock changes
and does not establish hosted publication or a live update installation.

## Deferred repository setup dialogs — 2026-11-21

Worktree, submodule and remote setup now load a shared presentation only
when opened. The root still owns draft and native operation scope. Closing
while loading releases focus; a failed load keeps a keyboard-accessible
Close action and does not submit a Git command.

Matched production builds measured **1,405,123 → 1,391,825 initial bytes**
(13,298 fewer). The 16,794-byte JavaScript module and 1,514-byte stylesheet
are outside startup. The 1.45 MB hard limit and 900 kB warning were not
changed; the warning remains. This is a byte measurement, not a startup
latency benchmark.

All 93 selected renderer cases passed, including held/failed/retired imports,
compact layout, keyboard routing, stale control refusal and valid setup writes.
The build and renderer evidence is under `target/local-review/setup-deferral/`.

## GitLab catalogue restart and exact-package recheck — 2026-11-21

The original Ubuntu 24.04 run of the `e3ccb77` installer did not open the
Clone tab after WebDriver acknowledged the entry click. Separate observations
showed the old harness choosing the transient welcome action while the saved
workspace was still restoring. They did not reproduce the original failed
delivery. The harness now waits for the painted workspace toolbar button and
only reacquires it after an explicit stale-element refusal. A click without
the resulting dialog remains a failure, not a reason to click again.

Two independent Ubuntu 24.04 installs of the same `Git-Khronos_0.1.6_amd64.deb`
passed all 47 GitLab scenarios each with the revised harness. The exact
installer SHA-256 is
`b50ec3a33ab34c8927e53bfb38ea6c32ac5bf2876c0f1af1606e628a2e9faa9e`.
The strict local release verifier passed all 28 checks, including the new
explicit fork restart recovery requirement on all five userspaces. The
original failure remains in `deferred-editor-release.5F54Lmes/noble-smoke/`
under `target/local-review/updater/jammy-builder/`; the separate passing
reports and `verified-release-fork-restart.json` are under
`target/local-review/gitlab-restored-entry.4SdfGShs/`.
This qualifies those package bytes with a fixture public key only. It does
not qualify later app changes, sign an update or publish a release.

## Installed file-discard scope and release checklist — 2026-11-21

The Jammy build from `da25ca1` passed its full matrix. In its installed
Ubuntu 24.04 discard review, an external checkout at the same commit disabled
the original review without touching the working tree, index or recovery
records. A fresh review then discarded only the newly reviewed edit and
created one recovery capture. The release checklist now requires both
outcomes; strict verification of the same bytes passed all 29 checks
(`verified-release-file-review.json`).

The installer, receipt and all reports are retained at
`target/local-review/updater/jammy-builder/file-review-release.YNdT8tef/`.
Its SHA-256 is
`b79721d9c7f87437479f92be6cd35d80f6f1c7b866058e98cddd113abc4bea51`.
This uses a fixture publisher key and does not qualify subsequent app
changes or publish anything.

## Installed first file scan — 2026-11-21

The exact Jammy installer from `4a8645c`, SHA-256
`12c7949ccd4da6b1deaee9e7b6dfc1405147ac805cb240ec03942f134c97e63b`, passed
both Ubuntu 24.04 `first-status` scenarios. History remained usable while
the full Git scan was held. The sidebar and inspector showed loading without
claiming a file count. After releasing the scan, the unstaged recap was
**+3/−1**, the staged recap **+1/−0**, and the Git footprint was unchanged.

The original installed worktree run timed out after double-clicking the
graph before the dirty working-tree row was known to be painted. The separate
rerun on the same installer waited for that row before locating the pointer
target; all 22 worktree scenarios passed. Original and rerun reports are
retained under `target/local-review/updater/jammy-builder/first-status-release.p3vVbWOx/`.
These are focused results, not complete release qualification.

## Deferred repository tab actions — 2026-11-21

The repository tab context menu now loads its actions and styles on first
use. The shell still owns position, focus and the target repository. Tests
hold or fail the chunk load, verify Escape restores the tab's focus, and
exercise alias editing, reorder and batch-close after loading.

Matched production builds reduced initial assets from **1,336,204** to
**1,332,226** bytes (3,978 bytes). The 900 kB warning and 1.45 MB hard limit
are unchanged. The tab menu styles and action markup are absent from the
initial asset list; this measures bytes, not startup latency.

## Installed late clone recovery — 2026-11-21

On Ubuntu 24.04, a real folder chooser and an owned HTTPS Git server held the
manual clone mid-transfer while Repository Management closed and reopened.
The earlier package from `474c97d` completed the clone but incorrectly made
it active. The package from `6c52d4e` kept the original checkout active, saved
the clone once, and let the user open it from Recents without another Git
request. Independent Git checks confirmed the fetched commit and unchanged
original checkout and remote source. The fixed installer SHA-256 is
`66ea004a676f14b3bb5bea8edcadfc7ff0b12a905ec3ff7fc3a0d3adcf3a72d1`.
The paired reports are in `target/local-review/repository-creation-installed.*`.
These are focused installed checks with fixture trust, not full qualification.

The earlier package's broad Jammy run reached 242 scenarios before the
setup keyboard harness tried to seed a commit draft before the first file scan
had mounted the form. Setup, context branch creation, and reference review
now wait for the requested checkout's visible, editable commit form before
seeding a draft. Waiting only for graph history is not sufficient.
The focused Jammy rerun on the same package passed 52 scenarios with the
private inherited Git context and expected fixture publisher trust.

## Full late-clone package matrix — 2026-11-21

The exact `6c52d4e` Debian package also passed all 30 installed release
checks on the then-current checklist, covering Ubuntu 22.04, 24.04 and
26.04 and Debian 12 and 13. The corrected Ubuntu 22.04 run passed 287
environment scenarios, including the setup keyboard checks that had
previously failed before reaching the real controls. The original matrix
launcher failure and the separate, successful Jammy results are retained
alongside `installed-matrix.MPFGjPYC/verified-release-combined.json` under
`target/local-review/updater/jammy-builder/repository-creation-release.DLDHfn0G/`.
The package SHA-256 is
`66ea004a676f14b3bb5bea8edcadfc7ff0b12a905ec3ff7fc3a0d3adcf3a72d1`.
Qualification used the fixture publisher key, not production signing.

## Installed accessible line recap — 2026-11-21

The `4861704` package passed `first-status` and
`repository-creation-scope` in an Ubuntu 24.04 installation with an isolated
Git environment. Holding the initial Git scan left history usable and
showed loading rather than a clean tree. After the scan, the staged recap
was **+1/−0** and the unstaged recap **+3/−1**, each with a single accessible
label. The exact package SHA-256 is
`74d879362ec2369b54982bb7d2bd4a32d850900f0f423df30381ed8a4f51ac04`.
Evidence is under
`target/local-review/updater/jammy-builder/accessible-recap-release.vLwHp41d/focused-installed/`.
This is focused evidence; it does not qualify those bytes across the matrix
or verify later Browse ownership changes.

## Installed detached checkout review — 2026-11-21

The `97dcd21` package reproduced an immediate detached checkout from
**Checkout this commit**, without a review. The `419939d` package passed
all three detached-checkout scenarios installed on Ubuntu 24.04: Cancel
preserved branch, index and working files; native Git refused a stale
review after switching branches at the same commit; and explicit checkout
preserved branch and tag refs, staged contents, disjoint working edits and
untracked files. This includes branch/tag name collisions. The isolated
inherited-Git environment checks also passed on the exact package.

SHA-256:
`0bc1be6e1a8521bd1d0e5e04ed89b95c156b366bc656336167312a6f86179a57`.
The paired reports are under `target/local-review/detached-checkout-installed.*`.
The 33-check release matrix now requires all three results. This is focused
evidence with fixture trust, not production signing or complete qualification.

The same exact `419939d` package subsequently passed all 33 checks in
that checklist on Ubuntu 22.04, 24.04 and 26.04 and Debian 12 and 13.
The original Jammy runner completed and recorded its five prerequisite
suites before its environment run was stopped: its immutable harness
contained the known stale singular line-recap assertions. The corrected
Jammy environment run passed 287 scenarios with the inherited Git fixture.
The strict combined verifier matched every required report to the same
package and passed fixture-publisher preflight. The final receipt is under
`target/local-review/updater/jammy-builder/reviewed-detach-release.PUqBYx0k/jammy-recap-recheck.bTyafwSj/verified-release.json`.
This qualifies the earlier bytes against that checklist, not the later
checkout-snapshot race fix or production signing.

## Installed same-tip checkout race — 2026-11-21

On Ubuntu 24.04, the `419939d` installer returned status for `main`
and a worktree and current reference for `parallel` after an external
switch at the same commit. The `bc1a577` installer retried the native
read and returned `parallel` consistently without mutating the repository.
It also passed the two inherited-Git checks. The updated fixture verified
the same package again using atomic readiness markers.

The positive installer SHA-256 is
`4bded47504c280c1e9525cf0b7851eb6626b441de5e73da90e2d4a85f3dd5d76`.
The paired and atomic-marker reports are in
`target/local-review/coherent-checkout-snapshot.pg2K80sh/` and
`target/local-review/updater/jammy-builder/coherent-snapshot-release.tCQLzY8Z/focused/`.
These are focused installed results, not the full 34-check matrix or
production signing.

## Installed guidance for a branch reserved by a rebase — 2026-11-21

The same `worktree-reservation` scenario ran on both Ubuntu 24.04
installers. With a real conflicted rebase in a linked checkout, the
`bc1a577` build showed only Git's refusal and generic advice. The
`bc80488` package told the user to open the named checkout in Worktrees
and finish or stop the operation there before trying to switch elsewhere.
Independent Git and filesystem checks confirmed that each checkout's
HEAD, shared refs, index, config and working file, plus the pending rebase
and its conflicts, were unchanged. Both inherited-Git checks passed on
the fixed installer.

The positive installer SHA-256 is
`3dabd0cdb758e75951d4455451ce9d86ae872db691ed433003f0ef7a792ccac0`.
Reports are under
`target/local-review/coherent-checkout-snapshot.pg2K80sh/reserved-branch.X1POuJUw/red/`
and
`target/local-review/updater/jammy-builder/worktree-reservation-release.35QMYopM/focused/`.
This is focused evidence for a different candidate, not the full release matrix.

## Frozen 0.1.6 installer: full 34-check Linux matrix — 2026-11-21

The `f9e3f2f` package passed all 34 required installed checks on
Ubuntu 22.04, 24.04 and 26.04 and Debian 12 and 13. The exact-artifact
verifier accepted 42 original reports, including 287 scenarios from the
Ubuntu 22.04 environment suite. That lane's original Docker launch failed
before any tests because of an invalid container name; only the affected
lane was rerun against the same installer and harness.

Installer SHA-256:
`9700ad49d54d8c919624377e2ca11aea2702399c75ed94fc9868dfac13790573`.
The combined receipt is
`target/local-review/updater/jammy-builder/linux-next.cgHmcnFR/jammy-recovered.tit2e5vZ/verified-release.json`.
Publisher preflight passed with the fixture trust key. This is local
qualification of those bytes, not production signing, publication,
or qualification of changes committed after the candidate was frozen.

## Installed partial working-directory comparison — 2026-11-21

On Ubuntu 24.04, the `f9e3f2f` installer counted a 17 MiB untracked
text fixture with the other edits and displayed +4/−0 as a complete
total. The `8578d57` installer displayed +3/−0 as partial, kept the
uncounted file selectable, opened the smaller file's diff, and kept
the repository and all fixture files unchanged. Both inherited-Git
checks also passed. The positive package SHA-256 is
`ee3ba64124dd2b9e936c3abf2b3a94bc3e8253dd6f2439c728211084b52801b6`.
The negative report is under
`target/local-review/comparison-line-budget.YXATMbjf/red/` and the positive
report under
`target/local-review/updater/jammy-builder/comparison-budget-release.ztzmLeOP/focused/`.

## Deferred co-author picker — 2026-11-21

The commit co-author picker now loads its fields and styles only when
opened, while the composer retains draft state. Seven Chromium tests
covered the real composer, including blocked and failed chunk loads.
Matched production builds lowered initial renderer assets from
1,334,924 to 1,331,923 bytes. The picker markup moved out of the initial
asset set. The 900 kB warning remains; this comparison measures bytes,
not startup time.

The installed `998c238` build also added one suggested and one manual
co-author through the deferred picker. Editing the draft was read-only;
the resulting Git commit had both exact trailers and did not include
the unrelated unstaged edit. SHA-256:
`6032a4fd06201b494b255baed956dc34b006a877c1316827bd7414f46ae2953f`.
The report is under
`target/local-review/installed-coauthors.5q9iKMnN/combined/`.

## Installed comparison responsiveness — 2026-11-21

The Ubuntu 24.04 installed fixture held the comparison Git process
open and requested updater status through the native command bridge.
In the `8578d57` package the status call did not finish until the
watchdog released Git. In the `ac8ac69` package it finished while
each of the four commit and working-directory comparison commands was
still pending, without invoking the watchdog. Each comparison then
completed normally after Git was released.

Positive installer SHA-256:
`73a0690e0c472a8a58e05016af6120aaf9a43cd7f16c44c4099383c4599e1622`.
Reports: `target/local-review/comparison-native-background.BhTpmW3O/red/`
and `target/local-review/updater/jammy-builder/comparison-responsive-release.kS7kw8aR/focused/`.
This is focused evidence for that installer, not a full release matrix.

## Combined 0.1.6 candidate: full Linux matrix — 2026-11-21

The frozen `998c238` installer passed all 34 required installed checks
across Ubuntu 22.04, 24.04 and 26.04 and Debian 12 and 13. The verifier
accepted 44 original reports, including all 287 Jammy environment
scenarios. The packaged GitLab catalogue scenario passed on each of
the five distributions. The publisher preflight used the fixture key.

Installer SHA-256:
`6032a4fd06201b494b255baed956dc34b006a877c1316827bd7414f46ae2953f`.
The verification receipt is under
`target/local-review/updater/jammy-builder/combined-linux.MnaEIB1s/verified-release.json`.
The digest-checked handoff and no-install APT preview are under
`target/local-review/qualified-0.1.6-998c238/`. Neither this matrix nor
the preview qualifies a production-signed build or later source changes.

## Installed stash preview responsiveness — 2026-11-21

The old installed package could not answer updater status while Git
held a stash read. The `5205efb` package answered updater status while
both stash detail and per-file preview were still held. After release,
both returned the saved text without restoring files or changing the
checkout. The same package repeated all four comparison responsiveness
checks successfully.

Positive installer SHA-256:
`0b111eb890b2ed57470ad9a24b357788f957640ec9261a1cd67ebe933c88e376`.
Reports: `target/local-review/stash-native-background.ZBmUqIg7/red/`
and `target/local-review/updater/jammy-builder/stash-responsive-release.GyP3TSHc/focused/`.
These are focused installed checks, not a release matrix.

### Updates status retry

The deferred Updates dialog now gives an unanswered native status read
six seconds, retires its late reply, and pauses repeated polling. An explicit
refresh or accepted native status resumes polling; installer and preference
actions are never replayed. Reopening can retry failed event registration.
The held-status and subscription regressions failed before the change.
All 285 renderer unit tests, 19 updater browser checks and the AOT build
passed. Initial raw bundle size stayed at 1,307,639 bytes. These source
receipts are under `target/local-review/updater-read-timeout.SXr4VcWE/`;
they do not qualify a newly built installer or production update feed.

## Installed commit and amend responsiveness — 2026-11-21

With Git held in `commit_changes`, the `998c238` installer answered
the unrelated updater status request only after the test watchdog released
Git. On the `3746422` installer, the updater answered with both the ordinary
commit and amend still pending. After release, the returned snapshot matched
Git's HEAD, the parent and committed content were correct, and the unrelated
unstaged and untracked files remained unchanged. Comparison and stash
responsiveness also passed on that exact installed package.

Positive installer SHA-256:
`34e3e6938e3952433b36237d1c6927d63ff288298fd077e22bb9df1b33a59de2`.
Reports: `target/local-review/commit-native-background.J5fzAc5z/red/`
and `target/local-review/updater/jammy-builder/composer-responsive-release.3EACgEaV/focused/positive/`.

## Installed ignore rule responsiveness — 2026-11-21

The older installed build blocked updater status while Git validated a new
ignore rule. On the `f1fdf10` installer, the status call settled with Git
still held both when adding an extension rule and when adding a rule and
untracking a selected file. Independent Git and file checks confirmed the
extension rule preserved the index, only the selected file was later staged
for removal, and all working files, refs and configuration stayed unchanged.

The first positive run assumed the fast snapshot included a newly untracked
.gitignore. The corrected fixture checks complete untracked status through
independent Git instead. The rerun used the exact same installer and passed
ignore, commit, stash, and comparison responsiveness.

Installer SHA-256:
`8f3f66df77f58620a563f5ccec94d280a41a133a94503f04d7ec60f066beb6fc`.
Reports: `target/local-review/ignore-native-background.OVR8hj36/red/`
and `target/local-review/updater/jammy-builder/ignore-responsive-release.6LNEj7Br/harness-recheck.ssXwPF6Q/`.

## Defer selected commit references — 2026-11-21

Production Nx builds of `5b3856a` and `a87b747` used the same compiler
settings and independent archived sources. Raw initial renderer size fell
from 1,340,309 to 1,326,106 bytes (14,203 bytes saved). The selected commit
reference strip appears only in an 18,032-byte deferred chunk, not in the
initial asset list. The warning threshold stays 900,000 bytes and is still
exceeded by 426,106 bytes. The hard budget, dependencies and native binary
were not changed by this UI refactor.

Build receipts, `initial-renderer.json` and emitted asset attribution are
under `target/local-review/startup-profile.jfFlmEyE/`.

The graph settings experiment (`e0bc902`) passed 14 targeted Chromium tests
but removed only 133 initial bytes and added an 8.3 kB first-open JS/CSS
load, so it was reverted. The bigger reference-strip saving is retained.
To compare two build directories using the same production settings:

```sh
node tools/report-initial-renderer.mjs --compare "$BASELINE_DIST" "$CANDIDATE_DIST"
```

This measures the actual initial files in both builds and prints candidate
minus baseline for raw, JavaScript, stylesheet, gzip and Brotli bytes. The
compressed sizes describe encoding the emitted assets independently, not
network transfer timing. It does not change budgets or write receipts.

The shared revision file list (`e59f88f`) then removed another 5,543 raw
initial bytes without adding a deferred chunk: 1,326,106 → 1,320,563.
Gzip and Brotli encodings increased by 563 and 156 bytes respectively, so
this is a raw-size and template-deduplication improvement, not a network
transfer saving. The 900 kB warning remains. The exact build and comparison
receipts are in the same directory under `revision-files-*`.

The Staged Files and Unstaged Files viewports now share one row template
(`34bc9c3`), with independent scroll state, line-count recaps, and stage or
unstage actions. The production build fell from 1,320,563 to 1,310,835 raw
initial bytes (−9,728 JS bytes; CSS unchanged), with 361 fewer gzip bytes
and 382 fewer Brotli bytes. No extra chunk is needed to display the lists.
The initial renderer is still 410,835 bytes above the 900 kB warning.
The exact commit passed 122 focused Chromium tests (111 file and diff
lifecycle, rename, recap and virtualization cases; 11 workspace cases).
See `working-tree-rows-*` in the same receipts directory.

## Batch Pull candidate: full Linux matrix — 2026-11-21

The exact local 0.1.6 installer from `a953fe3` satisfied all 34 required
checks with 49 passing installed-app reports across Ubuntu 22.04, 24.04,
and 26.04 and Debian 12 and 13. The tested package SHA-256 is
`b5a16da00356e9d2eae40645886b6a7f3ad19e8a547750dea4d8f69a8c1b4eb4`.
The final verifier used each lane's report directory directly: the first
aggregation stopped at a source symlink outside the reports, not a failed
runtime suite. The verifier's symlink refusal was not relaxed.

The checked package, verification JSON, and a successful APT dry run are in
`target/local-review/qualified-0.1.6-a953fe3/`. It uses a fixture update key
and has not been published. These receipts do not qualify newer changes on
`dev` or a package built with the production publisher key.

The release workflow and local verifier now also require the installed
working-tree recap suite on Ubuntu 24.04 (`9f8bd0c`). The new check opens
both Tree rows for the same partially staged file: the staged diff shows
`+1 −1`, the unstaged diff shows `+2 −1`, and the checkout and index stay
unchanged while inspecting. It passed on the same `a953fe3` installer in
`target/local-review/native-tree-sides.y0BzNo9l/`, where the updated verifier
reports 35/35 checks from 50 passing reports (`verified-release-35.json`).
The newer renderer was built and qualified separately.

The newer renderer's 0.1.6 Linux package was built from `df1edc7`, SHA-256
`57277c06c396636c5e9ca737d4ab000eb0e30a818e22257cc56120ad01705542`.
Its original Jammy watcher run removed the expected graph row but did not
prove continuous notifications: there was a quiet gap before deletion. With
the measured-burst harness (`11c46f0`), the same package passed the watcher
suite with 734 ms of continuous notification warm-up and a 101 ms maximum gap.
The same package's Debian 12 GitLab suite passed all 47 scenarios on rerun
with unchanged TLS verification. The original initial connection refusal
was not reproduced; `8a8d8d6` now records its UI outcome and safe request
counters rather than waiting for a connection after the UI has refused it.
These two focused reruns did not on their own qualify the package.
Raw reports, including failed attempts, are under
`target/local-review/updater/jammy-builder/working-tree-release.4wNlfYM8/`.

## Installed Pull scope proof — 2026-11-21

On the older `a953fe3` installer the workspace batch integrated two
configured upstreams, and the parent Pull fetched the new child commit.
On the 0.1.6 installer from `b966672` the same two Ubuntu 24.04 suites
passed. The batch refused the ambiguous repository before fetch, advanced
the other repository, and preserved the original Git configuration. A
separate toolbar Pull integrated only the displayed branch. The nested
checkout tests show that the parent advanced to its new gitlink without
fetching the child object or changing the nested checkout.

Installer SHA-256:
`f8244573c029f3d3c1ef54f30c57f576cd82a30d4f1c95d3d5143f8158e073a7`.
Failing and passing reports are in
`target/local-review/native-pull-scope.Oh9N6pIp/` and
`target/local-review/updater/jammy-builder/pull-scope-release.Lb6rguwE/focused/results/`,
respectively. These are focused passes, not complete release qualification.

On that same `b966672` package the first Jammy environment run stopped
before the hosted fork form opened in the scrolling catalogue. With the
ready-control click helper (`30bb7b4`), the isolated hosted-fork suite
passed all six cases, including restart recovery and the separately
reviewed Git clone. The Debian 12 GitLab recheck likewise passed its
47 scenarios and recorded one negotiated TLS handshake and one expected
API request at Connect. See `jammy-hosted-fork.IOr6od5N/` and
`bookworm-gitlab-tls.OUEpWJgd/` in the same package run. The initial
failures remain in the original lane reports.

The full Jammy environment recheck subsequently passed all 288 cases under
that same package SHA-256. The strict verifier accepted 52 passing reports
and all 37 Linux release checks. The installer, verification JSON, checksum
and successful APT dry run are in
`target/local-review/qualified-0.1.6-b966672/`. This supersedes the
`df1edc7` local handoff; it uses a fixture publisher key and qualifies
neither subsequent `dev` changes nor a production-signed installer.

### Selected branch Push scope

Source tests against owned bare repositories reproduced unselected
annotated tags appearing on the receiver, a successful-looking Push that
skipped the parent ref, and Publish refusing a branch with a same-named
tag. The explicit native branch commands now keep tag and nested-checkout
pushes out of scope, without altering the corresponding Git config.
The pinned force-push lease still updates the selected branch only, and
configured mirror mode still refuses instead of widening the refspec.
Git 2.39.5 also accepted the scoped publish refspec, set the upstream, and
left Git configuration for tags and submodules unchanged.

The new assertions are in the native `remote-reviews` suite; source
Push/Publish/reference tests, strict Clippy, and 64 harness unit tests
passed. With the same corrected harness, the `b966672` installer refused
Publish in the same-name-tag fixture and the `b105e5a` package passed the
whole isolated suite. Only `refs/heads/main` existed at the receiver after
both Publish and Force Push. The successful package SHA-256 is
`78ef9ccd89f3162fa35530230875c0dd0ffcfdad703db78e66ccc2aa5bf84500`.
These are focused installed checks, not qualification of that package.
Both reports are under `scoped-branch-release.8b86T8u7/`.

### Ordinary and background Fetch

Against owned local bare repositories the previous default Fetch pruned
local-only tags and stale remote-tracking branches. Ordinary and background
Fetch now leave those refs for explicit pruning through Fetch options.
Foreground Fetch still writes `FETCH_HEAD`; background sync preserves
it and respects per-remote opt-outs. A Git 2.39.5 probe showed that
`--all --no-write-fetch-head` could still change the file. Fetching the
changed remotes by name fixed that case on the same Git version.

The two regression tests passed on Git 2.39.5 and 2.53.0. The broader
32-test source filter, strict Clippy, the AOT build and 20 focused renderer
checks passed. Packaged UI and background IPC coverage is in the
`setup-keyboard` suite; new installer evidence remains separate.
Source receipts are under `target/local-review/non-pruning-fetch.Cp9KGYCx/`.

The installed `ef28d9d` Ubuntu 22.04 `setup-keyboard` run passed all
53 cases. Ordinary Fetch retained the local tag and stale tracking branch;
background Fetch advanced tracking while keeping the manual `FETCH_HEAD`
byte-for-byte. An initial run passed those cases but failed later because
the isolated runner expected no publisher key for a fixture-key package.
The corrected run used the same SHA-256
`a5084158b475bbafc9fc73664c191ec75a8bd143c77afeaf333ff1c0d966b4f9`
and verified automatic updates were off with publisher trust configured.
Both reports remain under `non-pruning-fetch-release.V8T90CRs/`; this
focused run does not substitute for the full Linux matrix.

The unchanged `ef28d9d` installer subsequently passed the full Linux
verification for that source: 37/37 gates and 52 passing reports across
five Ubuntu and Debian versions. The initial Ubuntu 24.04 GitLab run
refused Connect before an API request or a fixture TLS negotiation was
recorded. Its isolated recheck passed 47 scenarios, including one
negotiated TLS connection and one expected API request at Connect.
The fixture-key installer, checksum, verification JSON and successful
APT preview are in `target/local-review/qualified-0.1.6-ef28d9d/`. This
does not qualify the later checkout change or the production publisher.

### Local checkout, Pull, and merge safety

The unchanged Linux installer from `65d9e7d` passed 37/37 required
gates and 52 reports across five Ubuntu/Debian versions. Installed
checkout acceptance rejected a stale local branch without creating it
from the same-named remote and preserved an ignored local file when a
branch would have replaced it. The checksum-verified APT preview and
the exact fixture-key installer are in
`target/local-review/qualified-0.1.6-65d9e7d/` (SHA-256
`c18fff1e5a36ed2dd9eb00fb7ae5d1d5930215b037d82427f7e95f5eabebdff4`).

The matching installed Pull regression is red on the earlier `ef28d9d`
package: configured-upstream Pull pruned refs. In source tests, the
per-command override preserves both the local-only tag and stale tracking
branch while explicit and configured Pull still advance the checkout.
Direct merge and squash also refused to overwrite ignored settings in
the divergent fixture, including a directory-rename destination. Once
the obstruction was moved, the integration succeeded and preserved an
unrelated ignored file. The fast-forward fixture exercises Git's own
overwrite guard. The retests ran on Git 2.39.5 and 2.53.0; no protection
against concurrent external file edits, nor ignored-path protection for
Pull or rebase, is claimed. The two new scenarios are required by the
existing installed Pull and checkout suites for future candidates.

Both focused Ubuntu 24.04 installed suites passed on `ca3a347`:
six checkout cases and three Pull cases, including the new ignored-file
merge refusal and pruning-config Pull. They used the same package
SHA-256 `9d22a1fb6e3f207463ff1e67f27e432d1c32a60006c6f0decf48ac4ff573646a`.
Evidence is under `target/local-review/updater/jammy-builder/safe-integration-release.7M68nsCX/`.
This is focused evidence, not full qualification of that or later packages.

An installed replay on that same `ca3a347` package reproduced a separate
context-menu rebase bug: with Git's `rebase.updateRefs` enabled, confirming a
rebase also moved an unreviewed sibling branch. The renderer now sends the
frozen branch pair through the existing reviewed native command, which
leaves the sibling unchanged and retains the user's Git setting. Three
browser regressions failed on the old renderer, then all 69 focused
browser checks and the production build passed on the fix. The installed
sibling-preservation check is required for future release candidates and
passed in the `d52b711` focused checkout suite described below.

The same installed baseline also moved an unreviewed branch when Pull
used the Rebase strategy. Pull now overrides `rebase.updateRefs` for its
own invocation. The override leaves the configured setting intact, and
the regular transport classifier still identifies conflicts and dirty
checkout errors when Git receives the option before the subcommand.
The installed regression is required by the Pull scope gate for future
candidates.

The installed branch-delete baseline accepted a stale tip even for a safe
delete after the selected branch advanced to a merged commit. Local delete
reviews now display the selected tip, pass it through the native contract,
and refuse either safe or forced deletion if the ref no longer matches.
Git retains its existing merged-branch and linked-worktree safeguards.
The new installed check is required by the checkout scope gate for future
candidates; this is a preflight, not a lock against independent Git clients.

A linked-worktree removal that also deletes its branch now saves the branch
commit before removing the directory. An owned fixture that blocked the
recovery ref namespace reproduced loss of the checkout on the older
`ca3a347` installer as well as in the source regression.
The corrected operation leaves the directory and registration intact. A
separate fixture refuses branch deletion after checkout removal and verifies
that the partial outcome is reported and the recovery commit survives.

The previous `4b10b95` package finished its pinned Linux matrix with
37 required gates and 52 passing reports (SHA-256
`e24c5391779586eb3b3eceb1dcbf8f464200cbdf97f86567a7e3085126f8ecdb`).
It predates the later rebase, branch deletion, and worktree recovery fixes.
The `d52b711` package then passed all seven focused checkout cases,
including the installed sibling-branch rebase regression. Its SHA-256
is `c4b2dba8066150b9353c4eb04a98939d64d8506bf472e012068bcc81a82c5124`.
The combined `02ff4a7` package subsequently passed its own strict installed
matrix: 37 required gates and 52 passing reports across Ubuntu 22.04,
24.04, and 26.04 and Debian 12 and 13. The Ubuntu 22.04 environment suite
passed all 292 scenarios. The digest-matched installer, ABI and build
receipts, matrix result, and successful APT simulation are in
`target/local-review/qualified-0.1.6-02ff4a7/` (SHA-256
`0fd729dfc405990077e8ec3a495d08c277843eaeee4e3e8f16355e78736bb7a9`).
This qualifies those exact fixture-key package bytes, not later `dev`,
the full Chromium suite, or a public signed release.

The frozen browser run recorded a context-rebase test failure. An
isolated replay on the same renderer forced a status read and reproduced
the extra mock dispatch: the test changed the renderer to another branch,
but its mock native status still returned the original branch. The fixed
test changes both to the same branch and explicitly checks a status read
before confirming. This is a fixture fix, not a retroactive pass for the
archived full run. The exact `02ff4a7` installer separately passed all
four Ubuntu 24.04 Pull scope scenarios, including sibling preservation.

The `62ac826` candidate adds checkout-scoped stored-reference deletion and
keeps safe branch deletion results independent of other UI errors. Its
pinned renderer regression run passed all 134 cases. The exact installer
then passed all 37 Linux runtime gates with 52 passing reports; the Ubuntu
22.04 environment suite passed 292 scenarios. The checksum-verified
fixture-key package and successful APT simulation are in
`target/local-review/qualified-0.1.6-62ac826/` (SHA-256
`2098043f28c3b9a066adaf846e48d060c44922a079c70fd3ac28dbc6264d1745`).
This handoff supersedes the earlier local package, not the public release.

The subsequent `c4f6610` package passed the 20-case installed smoke suite
on Ubuntu 24.04. Its Repository Files scenario verified that Linux keeps
the nested entry browsable without a Delete action and that an eligible
top-level file can still be deleted and recovered byte-for-byte. The
package digest is
`96b334cebbae9e58f6288487ff38a4a7298a83e43b0cbc226306f08d7946e28e`;
package and reports are under
`target/local-review/updater/jammy-builder/repository-files-smoke.zJYTbGpB/`.
This is focused smoke evidence, not a complete Linux matrix for that build.

Git's receiving-branch `--squash` default could also make the old
installer report Pull success without moving HEAD. The new
workspace-Pull check reproduced it on that same `62ac826` package, even
though its earlier matrix passed without this case. Pull and direct
Merge/Fast-forward now select no-squash explicitly; reviewed Squash
remains available. Native source tests check exact tips, parents, working
files, clean stage state, and unchanged config. The command behavior was
reproduced and then corrected on Git 2.39.5 and 2.53.0 using only owned
local repositories. Future package qualification requires the new
workspace-Pull scenario. The installed baseline failure is retained
under `target/local-review/pull-squash-safety.y3cPYiIi/installed-red/`.

### Packaged GitLab TLS fixture readiness

The packaged harness now uses the IPv4 address its fixture actually binds
and verifies that listener with one credential-free TLS handshake before
launching the app. It checks the IP identity using the fixture's private
certificate as its trust anchor; host trust is unchanged. The harness excludes that
handshake from app traffic counts. Source transport tests still use the
`localhost` origin by default, and a redirect to the second port is still
a different origin.

On the unchanged `ef28d9d` installer, the updated harness passed all 47
GitLab cases on Ubuntu 24.04 and Debian 12. Each Connect recorded exactly
one new TLS negotiation and one expected API request. The earlier zero-
traffic refusal remains in its original report; removing the resolver
from this local fixture does not prove it caused that refusal. Python
harness tests (150) and native GitLab source tests (103) also passed.
See `target/local-review/gitlab-loopback-readiness.pEfBzgsX/`.

### Manual and automatic Fetch recovery

Successful manual Fetch options now re-enable an automatic Fetch paused
by an earlier failure only when the manual scope covers the repository.
One of multiple remotes is not enough. A background reply from a closed
checkout cannot pause its reopened tab. The three regression assertions
failed on the old renderer, then passed with 44 related cases. AOT build
passed with 311 more raw initial JavaScript bytes and unchanged CSS.
Renderer receipts are under `target/local-review/fetch-retry-scope.O2fbig8N/`.
This renderer change is newer than the installed `ef28d9d` proof above.
The later `4b6d990` installer independently passed the focused native
Updates (19 cases) and working-tree recaps (8 cases) suites. This is not
a full matrix for that package.

### Detached-checkout native hit target

The first Ubuntu 24.04 run of the fast-Git package opened the context
menu for the row above the requested commit. The screenshot showed the
dirty-working-copy row, consistent with it appearing after target geometry
was measured. The scenario now waits for that row and the exact current
branch before one trusted right-click. On the unchanged `30bb7b4` package,
all three detached-checkout cases and the remaining focused suites passed.
The original report and the successful `focused-after-wip.09k5Vvz9/`
recheck remain in the same package receipt directory. This did not change
the actual checkout operation or retry a click.

The unchanged fast-Git package then passed strict qualification: all 37
Linux release checks, 52 accepted reports, and 288 cases in the full Jammy
environment scope. The fixture-key installer, exact verification and APT
preview are in `target/local-review/qualified-0.1.6-30bb7b4/`.
Its SHA-256 is
`f8354635356384c986a64602a52854e7a47f55c2affcf29e0919d4638b43a1d1`.
Release and hotfix Finish took 15.8 and 7.4 seconds in the isolated
installed branch-workflow check. These are measured on this package and
host, not a controlled comparison with the older installer.

### Scoped checkout and ignored-file preservation

The ordinary local-branch and detached checkout paths now refuse
collisions with ignored local files, leave nested checkouts alone, and
do not guess a remote-tracking branch when a selected local branch is
gone. Reviewed remote checkout uses the same switch policy and guards
its subsequent fast-forward. Its earlier fetch and local branch switch
remain reportable partial results if that fast-forward is refused.

Four real-Git regressions reproduced before the fix and passed on Git
2.39.5 and 2.53.0. Checkout, operation recovery, and stash source filters
passed, together with strict Clippy. The installed `ef28d9d` baseline
recreated the deleted branch under the new scope scenario. That is a red
check on the old package, not a failing gate in its original matrix.
Exact source and installed baseline receipts are in
`target/local-review/safe-checkout.BIlSZSgx/`.
New release qualification requires both the stale-target and ignored-file
scenarios in its existing Ubuntu 24.04 detached-checkout gate.

### Working-tree recap during refresh

An unchanged-status recount now keeps previously measured totals
visible, explicitly marked as updating. It clears them on receipt
failure or a different checkout/status. The new held-read regression
failed on the old renderer and passed on the candidate. All 82 focused
Chromium cases passed, including the revised lifecycle fixtures and the
two Windows launcher cases that timed out in the earlier full run.
This did not rerun the full 2,574-test matrix or the native Windows app.
The AOT build adds 1,796 raw initial JS bytes, 222 gzip bytes and 159
Brotli bytes; initial CSS is unchanged. Receipts are in
`target/local-review/recap-refresh.vjxXDg5B/`.

### Branch workflow qualification timing

The isolated Ubuntu 22.04 branch-workflow suite passed all four cases with
the same `df1edc7` installer after giving reviewed operations their own
60-second test window. The release and hotfix finishes took 44.3 and
47.7 seconds respectively in that run, beyond the old general 30-second
wait. The scenario continues to check Git parentage, tags, cleanup, and
recovery state; it does not replay the Apply click. See the report under
`target/local-review/updater/jammy-builder/working-tree-release.4wNlfYM8/jammy-workflow.RkKTxmy0/`
for those timings. The full environment suite was restarted separately.

That full retry then stopped because the editor-close scenario queried
`Preview file content` before its deferred menu was painted after app
restart. At the same package SHA-256, all three isolated editor-close
scenarios passed with the ready-control click helper (`bc7bf1f`).
See `jammy-editor.tySJcZnF/results/editor-close/` in the package run above.

That same Ubuntu 22.04 recheck also passed all 288 cases in the full
environment suite. The strict verifier then accepted 51 passing reports
for the unchanged `df1edc7` package, covering all 35 required gates across
Ubuntu 22.04, 24.04, and 26.04, and Debian 12 and 13. The qualified installer,
checksum, source/build receipt, and successful APT dry run are in
`target/local-review/qualified-0.1.6-df1edc7/`. This supersedes the older local
handoff but does not qualify subsequent `dev` commits. The installer embeds a
test publisher key; no production package was signed or published.

### Shared Pull strategy menu rows

One tracked template now renders the three strategy rows and uses the
same labels as the toolbar and workspace overview. Changing the default
retains focus without issuing Pull; selecting a one-off strategy still
dispatches only that action. No deferred chunk or extra first-open load was
introduced. Same-settings production builds measured 1,311,523 → 1,309,852
raw initial bytes (−1,671 JavaScript bytes; CSS unchanged), with 244 fewer
gzip bytes and 102 fewer Brotli bytes. The 900 kB initial warning remains.
All 21 focused browser cases passed. See `pull-menu-*` under the startup
profile receipts directory.

### Deferred compact repository actions

Moving the compact More menu's presentation and responsive item styles
out of the initial renderer reduced raw startup bytes from 1,309,852 to
1,303,726 (−6,126 JavaScript bytes, initial CSS unchanged). Initial gzip
and Brotli encodings fell by 701 and 418 bytes. The first use loads an
optional 9,481-byte JS chunk and 633-byte stylesheet. Five alternating
fresh Chromium pages at 780 px against local production builds measured
a median of 19 ms → 48 ms from the click to the first ready action; the
slowest candidate sample was 105 ms. These local samples describe the
first-open trade-off, not installed WebKit or machine-wide latency.
The overlay remains dismissible if the chunk is delayed or fails.

All 29 focused Chromium cases passed, including held and failed chunk
delivery and narrow toolbar actions. Exact build, timing samples, and
browser receipts are under `compact-toolbar-*` in the startup profile.
The 900 kB bundle warning remains.

The compact menu now [prefetches on hover or keyboard focus](https://angular.dev/guide/templates/defer#prefetching-data-with-prefetch).
It still renders only when explicitly opened and does not fetch its chunk
on startup. With 180 ms of hover before clicking, seven alternating pairs
of fresh Chromium pages each measured 62 → 73 ms medians with no added
delay (no local speedup demonstrated), and 203 → 36 ms when only the menu
chunk had a simulated 100 ms delay. Each prefetch response finished
before the click in those samples. This demonstrates hiding a slow load
when there is advance intent, not a native WebKit latency result.

The trigger adds 2,146 raw initial JS bytes, 558 gzip bytes and 610 Brotli
bytes over click-only deferral. Compared with the earlier eager menu,
initial output is still 3,980 raw bytes and 143 gzip bytes smaller, but
192 Brotli bytes larger. CSS and bundle budgets are unchanged. All 32
focused browser checks passed; the three new intent checks failed on the
click-only baseline because it made no request before activation. Exact
receipts are under `compact-intent-*` in the startup profile directory.

### Cancellable Git process latency

The process coordinator now wakes when both output readers finish instead
of always waiting for its next 30 ms poll. It still keeps the normal
cancellation polling bound and the real child exit status. Three alternating
local runs of 60 short Git processes measured a median of 1,979 ms before
and 707 ms after the change. The existing real-Git release-finish test ran
in about 23 seconds before and 9 seconds after on the same host. These are
debug-test timings, not installed-app latency estimates.

Logs and the opt-in timing probe are in
`target/local-review/short-git-capture.Tlyy8Yfi/`.

The Unix pipe-readiness follow-up removed the sampling sleep from the
readers without changing their 10 ms cancellation check. In a second
three-pair comparison, the median of 60 short Git processes fell from
733 ms to 235 ms. The real-Git release-finish test fell from a median of
9.53 s to 4.76 s. These timings are local debug runs; logs are under
`target/local-review/ready-git-pipes.nUy31LmV/`.
