# Linux packaged acceptance

## Renderer recovery evidence

The installed X11 recovery probe requires the replacement renderer to
respond to Ctrl+P and Escape on a private Xvfb display before inducing
another crash. A nonblank frame alone is insufficient: X11 can still show
the previous renderer's frame while WebKit starts its replacement. The
probe exercises only the read-only command palette, never a Git action.

## Reproduce the reviewed stash workflow

Use the exact fixture-key build or production candidate selected for review.
Run this focused suite in a prepared Linux acceptance environment:

```sh
python3 tools/native_acceptance.py --suite stash-review --headless --package "$PACKAGE"
```

This reuses the toolbar, staged/working/untracked content, and keyboard
checks from the larger publisher-environment suite; it does not replace
that required release check. Without `--installed` the harness extracts
the provided package into its isolated fixtures.

## Latest 0.1.6 local qualification

The newest worktree-focus test-key archive has SHA-256
`46247c359ff192d6e2e04183e583f671d5232b968ae42092e5013d03e815765f`.
It passed all 52 installed reports in one clean run across Ubuntu 22.04,
24.04, and 26.04 and Debian 12 and 13. The Ubuntu 22.04 publisher
environment passed all 331 scenarios, and the strict test-publisher
verifier accepted reports for this exact archive. The offline test-key
updater rehearsal also accepted the verified bytes and rejected a modified
body.

The same exact archive was then installed as an APT upgrade from public
0.1.5 on all five baselines. Each upgrade preserved a dirty checkout's
branch, index, staged and unstaged changes, and untracked file; both X11
launch paths and repeated renderer recovery passed, followed by a fresh
interactive launch. Logs are under
`target/local-review/current-exact-upgrade-launch-20261126T133118Z/`.
The clean acceptance matrix and verifier are under
`target/local-review/jammy-worktree-qualification-low-load.RIvp3O/`.
The test-key artifact is not production-signed or published; these checks
do not qualify the actual Windows-pinned WSLg shortcut or a hosted release.

The preceding test-key archive includes the changed-files focus fix, the
toolbar keyboard recovery fix, and the earlier discard, recap, workspace,
and GitLab changes. Its SHA-256 is
`1415e37857fea3f57a2dd5f58f87f6fab05e5404c91f5a383a05a5d741e6a5b7`.
It passed all 52 installed reports in one run across Ubuntu 22.04, 24.04,
and 26.04 and Debian 12 and 13. The Jammy publisher-environment report
passed all 330 scenarios, and the test-key trust verifier matched the
exact archive. The focused installed recap suite also passed all 28
scenarios, including final-page focus with animation frames suppressed.

See `target/local-review/jammy-pagination-focus.Mw4Urs/HANDOFF.md` for
the preview command, the build receipt, inventories, and exact-artifact
reports. This archive is not production-signed. Upgrade, launch, or
signing reports for the older digests below do not qualify its bytes.

### Earlier per-file discard qualification

The earlier test-key archive includes the per-file discard button's busy
state. Its SHA-256 is
`2fc9a868cfbb1390e37f9728d498631d5e6400f093635795d1a6b63a4550b9d9`.
It passed all 52 required installed reports in one local run across five
Linux baselines, including all 329 scenarios in the Ubuntu 22.04 publisher
lane. The strict package and test-publisher verifiers passed. The focused
busy-discard test failed on the prior archive on WSLg and passed on the
new archive on both WSLg and Ubuntu 22.04. The new archive also passed the
no-install preview check, and a manual APT upgrade from public v0.1.5 on all
five baselines preserved the dirty checkout and index. Both X11 launch paths
and repeated renderer recovery passed after these upgrades.
See `target/local-review/jammy-row-discard-preview.s2HjIw/`
for receipts and the package and source SBOMs. This archive has not been
signed for release or published; the offline updater rehearsal below
applies to the previous archive.

### Previous 0.1.6 local qualification

The test-key archive including the working-tree keyboard and scroll fixes
and the stash-review refresh fix has SHA-256
`8ca22c68d893436cb25631d9d94c2ace07b02b1a7aff1f5acbe5b9ef5f55a926`. All 52 installed release checks passed in one local matrix
across the five Linux baselines, with no report substitutions. The
required Ubuntu 22.04 environment suite passed all 329 scenarios. The
package also passed the focused stash review, three live WSLg XWayland
launch probes, and APT upgrade from public 0.1.5 on all five baselines
without changing the dirty Git fixture. Both X11 launch paths and three
responsive renderer recoveries followed by a fresh launch passed on
each baseline.

Evidence is under `target/local-review/jammy-stash-refresh.tR8W4jlN/`.
The initial qualification and WSLg and upgrade checks are there. A later
rerun with the catalogue and editor harness fixes passed all 52 reports
again, with 329 scenarios in the publisher lane and no report substitutions.
See the directory named by `repaired-harness-matrix.path` for the exact-package
and publisher verifier results and `updater-rehearsal-final.log` for the
offline update check. The interim `latest-harness-matrix.path` run that
passed 48 of 52 reports remains separate. No production signing, hosted
qualification, or publication was performed.

## Earlier 0.1.6 keyboard navigation qualification

The Jammy-built test-key archive containing the WSLg fix and the
expanded file-list Home/End fix has SHA-256
`312a7de8c679928cf03754a7c9ce57f2154032da1997444da3485294874a4976`. All 52 installed release checks passed across five Linux
baselines in the selected evidence set; this was **not** one clean matrix
attempt. The failed Debian 12 incoming-link, Ubuntu 26.04 GitLab and Jammy
publisher reports are retained alongside their passing isolated reruns.
The Jammy rerun exercised 328 scenarios, including the stricter reviewed
prune check. Ubuntu 24.04's 35 review suites passed in three parallel
groups. Each required suite is backed by one complete passing report;
none combines scenarios from separate attempts.

Evidence is under `target/local-review/jammy-working-tree-nav.espDUuED/`:
`current-verified-release-matrix.json` and `selected-report-paths.txt`
record the selection, and `signed-rehearsal/` records offline signature
and updater verification with a fixture key. End reproduced the last-row
failure on the earlier archive; both Home and End passed without writes
on this archive on Ubuntu 22.04 and 24.04. Three WSLg XWayland launches
painted with the automatically routed accessibility address. The public
0.1.5 upgrade preserved a dirty fixture on all five baselines. Both
launch paths and forced renderer recovery also passed on each baseline,
with Debian 12's initial parallel recovery failure retained and a
passing isolated run. This is not production signing or publication.

## Earlier 0.1.6 WSLg release-notes qualification

The archive with the WSLg fix documented in its packaged changelog has
SHA-256 `2dae2bcb1632957cb6fed701a2717c3f8fa2deabe3f90ecf7034d142c2facd95`.
All 52 installed reports passed in the same local matrix run across the
five Linux baselines, with no substituted reports; Ubuntu 22.04 passed
all 327 environment scenarios. The strict verification, the three
WSLg XWayland launches, and the fixture-key offline update rehearsal
are in `target/local-review/jammy-wsl-release-notes.8EXlzRZm/`.
The executable hash matches the prior WSLg-fixed archive; only the
changelog and its packaging checksum entry differ in the extracted data
and control files. With these exact updated bytes, the APT upgrade
from public 0.1.5 preserved a dirty checkout on all five baselines;
both X11 launch paths and renderer recovery passed
(`upgrade-launch-baselines/`). The publication workflow's local
notes extraction includes the WSLg mitigation
(`signed-rehearsal/release-notes.md`). No production signing or
publication was performed.

## Earlier 0.1.6 WSLg mitigation qualification

The Jammy-built test-key archive with the WSLg startup mitigation has
SHA-256 `9dfa58867a77315399a2531adcc2ee0e371f8865b98e59e2c6f276ee07dc2293`.
Its passing 52-report matrix is in
`target/local-review/jammy-wsl-accessibility.teiVXWF6/verified-release-matrix-with-reruns.json`.
The uninterrupted matrix had two early, unclassified GitLab connection
failures; both passed when rerun in fresh containers against the identical
archive. The verifier rejects the original failing set. Both attempts
and the replacement rule are retained. The Ubuntu 22.04 environment
suite passed on the first attempt with this archive.

The same bytes passed WSLg XWayland launch with the automatic accessibility
address, native Wayland and explicit-address controls, fresh install and
launch on five Linux baselines, the Ubuntu 24.04 manual upgrade and
renderer recovery, and the offline signed-update rehearsal with a test key.
The existing Windows pin, production key, and hosted release are not
qualified by these local tests.

## Earlier 0.1.6 keyboard-focus qualification

The Jammy-built package
`e62c2674d6be4ada7f957326cc012ea9a48c464251b6db9e7ff8ae2c7058ea61`
passed the Ubuntu 24.04 installed clipboard checks, including opening a
branch menu with Shift+F10, navigating with the arrow keys, and pressing
Enter to copy. Focus returns to the branch. The previous archive failed
that focus assertion. Both clipboard checks also passed on Ubuntu
22.04 and 26.04 and Debian 12 and 13 (`reference-copy-baselines/`).
Evidence is in
`target/local-review/jammy-ref-copy-focus.duLp0tGX/`.
The exact archive passed all 52 installed release checks across Ubuntu
22.04, 24.04, and 26.04 and Debian 12 and 13
(`verified-release-matrix.json`). The initial Ubuntu 22.04 environment
run failed while waiting for a configured-tool control; the same archive
passed all 327 scenarios after the harness waited for that control to
be ready. Both attempts are retained. Replaying the original report set
without the replacement fails the strict verifier
(`original-matrix-rejection.log`); the passing set substitutes only the
Ubuntu 22.04 environment report. The exact archive also passed the
APT upgrade from public 0.1.5, both X11 launch paths, and renderer
recovery on all five baselines (`upgrade-launch/` for Ubuntu 24.04;
`upgrade-launch-baselines/` for the other four). The upgrade preserved
the owned dirty checkout, including its branch, index and working files.
The offline signed-update rehearsal with the fixture key also passed.
The three installed update-consent scenarios passed per baseline
(`matrix-noble/reports/application-update-consent-*/` and
`update-consent-baselines/`). Manual checks worked without automatic
consent, and opt-in and opt-out persisted after restart. Those isolated
checks did not contact the production updater endpoint.
The exact archive passed all 22 installed file-history checks on each
baseline (`current-file-history/` for Ubuntu 24.04 and
`file-history-baselines/` elsewhere). The suite covers deleted paths, full
commit ID copying, starting revision changes, and keyboard navigation.
All 26 installed working-tree recap checks passed on each baseline
(`current-working-tree-recaps/` for Ubuntu 24.04 and
`working-tree-recap-baselines/` elsewhere). They cover index-relative line
counts, compact bulk actions, and the collapsed Staged header docking at
the bottom. The four installed large-discard checks passed on each
baseline, including recovery of CTI-shaped paths and sizes after
restart and preservation of the staged-only sibling
(`matrix-noble/reports/discard-large-*/` and `discard-large-baselines/`).
All seven installed selective-discard checks also passed on each
baseline, including the tracked nested lockfile, unchanged index and
sibling edit, and restored working bytes after Undo
(`matrix-noble/reports/discard-subset-*/` and `discard-subset-baselines/`).
The nested-deletion, stale-review and size-limit suites passed on all
five baselines (Ubuntu 24.04 release reports and `discard-safety-baselines/`).
These checks cover Undo/Redo for a nested deletion, refusing changed
review scope without discarding, and an actionable size limit without writes.
The fixtures use synthetic data; the real CTI checkout was not modified.
All 25 installed worktree checks also passed on each baseline
(`matrix-resolute/reports/worktrees-*/` and `occupied-worktree-baselines/`).
They verify that double-clicking an occupied `dev` branch opens its
registered primary checkout from a linked checkout without detaching HEAD
or altering dirty work, and that a stale owner is not used as a fallback.
The same archive also passed fresh APT install, both X11 launch paths,
and APT removal on all five baselines (`x11-launch-baselines/`). Both
launches rendered a nonblank window, and removal preserved the test
user’s file. The initial probe runs lacking Node are retained separately;
Xvfb does not qualify a Windows-pinned WSLg shortcut.
A separate local WSLg XWayland command launch of the exact extracted
executable, with a private profile, rendered a nonblank window
(`wslg-xwayland-exact/`). The probe matched the window to the owned process
and counted 544 sampled colors. Launching the unmodified desktop entry
with a private PATH wrapper pointing to the exact extracted executable
also rendered a nonblank XWayland window (`wslg-desktop-entry-exact/`). A private-profile native Wayland launch also committed a non-null buffer
for the app's toplevel and received a compositor frame callback
(`wslg-native-wayland/`). This is protocol evidence, not a pixel or
Windows-pinned shortcut check. The user's existing profile was not used.
A read-only check of the workstation's Start menu and taskbar links
found identical `wslg.exe` targets and Git Khronos launch arguments
(`wslg-desktop-entry-exact/windows-shortcut-metadata.json`). Neither
Windows link was started or modified. A separate launch through the same
Windows `wslg.exe` target and distribution rendered nonblank XWayland
pixels from the exact extracted app (`wslg-windows-launch-bridge/`).
It passed a private test command in place of the original shortcut
arguments, not a click on the existing pin with the user's profile.
A follow-up found a visible, nonminimized 1011 × 665 Windows window
during that launch (`wslg-windows-visible-window/`). An in-memory
Windows capture of only the owned window found 377 distinct sampled
colors; no image or full-desktop capture was saved
(`wslg-windows-window-only-paint/windows-paint.json`).
The same Windows capture API returned a uniform image for a visible
native Wayland launch (`wslg-windows-native-wayland-paint/`). A separate
screen probe checked window ownership at each sampled point and found
153 colors across 920 visible points of the app window
(`wslg-native-wayland-screen-sample/`). Only aggregate counts were
retained. The uniform off-screen capture did not mean the native
Wayland window was blank on the Windows desktop.
The two successful XWayland pixel checks emitted the reported DRI3
warnings. The native Wayland trace emitted the reported Mesa/Zink and
DRI2 warnings before successful buffer commits and a frame callback.
These observations show that the warnings alone do not indicate a
failed launch; they do not prove GPU acceleration or explain a blank
Windows window.
Two additional private XWayland launches exited with SIGSEGV before
window interaction, both after reporting a missing accessibility-bus
socket (`wslg-owned-window-lifecycle*/`). The matching kernel messages
placed both faults at the same offset in the workstation's ATK
accessibility bridge (`libatk-bridge-2.0.so.0`, local symbol
`spi_register_object_to_path`); this locates the fault, not its cause.
Supplying the address from the
test's own D-Bus session preserved accessibility and produced a rendered
window that Windows resized, minimized, and restored
(`wslg-owned-window-private-accessibility/windows-lifecycle.json`).
This isolates a potential test-environment factor; it does not establish
an application fix or explain the original taskbar-pin incident.
An isolated Ubuntu 26.04 Xvfb launch with a deliberately missing
test-owned accessibility socket emitted the same warning but still
rendered (`owned-x11-accessibility-container/stale.log`). So the warning
alone is insufficient to reproduce the WSLg crash. The control lane
lacked an accessibility service in that container and did not qualify
private-bus routing there.
A paired WSLg launch check used the live session bus and fresh private
profiles. The exact app crashed in all three XWayland launches with
automatic accessibility-bus selection. Passing the accessibility address
queried from that same session made all three render
(`wslg-default-session-sample/` and
`wslg-default-session-explicit-accessibility/`). No accessibility service
was disabled and no system setting changed.
The GNOME bridge's published [ATK registration source](https://gnome.pages.gitlab.gnome.org/at-spi2-core/coverage/atk-adaptor/accessible-register.c.html)
and [bus initialization source](https://gnome.pages.gitlab.gnome.org/at-spi2-core/coverage/atk-adaptor/bridge.c.html)
are consistent with a failed initialization leaving no bridge state for
later registration. They are not a backtrace of this particular build.
For an app-side mitigation, preserve explicit accessibility settings and
query the live session's accessibility service before GTK on the affected
WSLg X11 launch path. Bound that query, pass the address only to the app
process, preserve launch arguments, and do not disable the bridge or write
the global X11 property. Keep the original launcher and the signed-package
identity checks intact. Qualification needs a fresh package and controls
for native Wayland, non-WSL Linux, and an unavailable service.
The startup mitigation now queries the existing local session over GIO
with a 600 ms deadline, then re-executes the same app image with the
resolved address if needed. The WSL X11 debug build rendered in all
three fresh-profile attempts; the probe verified that the app received
the live address without a caller override (`wslg-debug-routing-validation/`).
The follow-up Jammy archive (SHA-256
`9dfa58867a77315399a2531adcc2ee0e371f8865b98e59e2c6f276ee07dc2293`)
passed three real WSLg XWayland launches with the live address and original
argument vector confirmed. On the same archive, native Wayland committed
its window buffer without the X11 routing, and an explicit caller-supplied
address was preserved.
Launching the same archive via the Windows WSLg bridge with its default
environment selected native Wayland and produced 143 distinct colors
across 920 sampled Windows points (`wslg-windows-default-backend/`).
That test used a temporary profile and did not click the existing pin.
It does not connect the X11 accessibility crash to the original pin issue.
A Windows bridge launch forced through XWayland also passed with the new
archive: it obtained the live address without a caller override and drew
159 colors across 976 owned Windows points
(`wslg-windows-x11-repaired/`).
The repaired executable also appeared in the live AT-SPI registry with
its accessible window under the owned process ID
(`wslg-accessibility-tree/`). This verifies that accessibility was not
merely left configured; it does not substitute for screen-reader review. Its evidence is in
`target/local-review/jammy-wsl-accessibility.teiVXWF6/`. The prior 52-check
matrix does not qualify these new archive bytes; use the new 52-report matrix above.
An isolated Ubuntu 26.04 X11 control with the WSL marker and no
accessibility service still drew a window and did not set an address
(`wslg-no-accessibility-service-control/`). The new archive, build
receipt, software inventories and checksums are staged locally for
verification after the exact-artifact matrix; nothing is signed for
production or published.
Fresh install, desktop-entry launch, terminal launch, and removal of the
new archive passed on all five Linux baselines (`x11-launch-baselines/`).
Removal preserved the owned user's file. Ubuntu 24.04 also preserved
a dirty checkout while upgrading from public 0.1.5 and relaunched after
induced renderer crashes (`upgrade-launch/`).
No public release or production-key qualification was performed.

## Manual Windows taskbar pin check

Use the installed build and profile you intend to qualify. First compare
the installed files with the reviewed archive using
`task install:linux:status -- "$archive"`. Save work, quit Git Khronos,
then open it from the existing Windows taskbar pin. Verify that the
window opens, redraws after a resize, and can minimize, restore, and close.
Repeat from the Windows Start menu and the Linux terminal only if the pin
fails, closing the app between attempts so an already running process
does not satisfy a launch check. Record the failing path and whether
the window was missing, blank, or unresponsive. Collect WSLg transport
diagnostics before changing the shortcut or restarting WSL.

## GitLab catalogue stale-element regression

The exact archive passed 48 installed GitLab scenarios on each of the
five baselines. Each report includes three real WebDriver checks: recover
from an explicit stale-element refusal, ignore a disabled duplicate, and
wait for delayed navigation before clicking exactly once. The recovery
is limited to local navigation; it does not replay a provider operation
or a click whose outcome is unknown. The latest fork catalogue test
captures ready controls before clicking instead of doing a second lookup.
All five installed suites passed again after that change
(`gitlab-single-capture-baselines/`). The strict checker accepted the
52-check matrix with these five same-archive replacements
(`verified-release-matrix-latest-gitlab.json`); the original reports
remain under `matrix-*/reports/gitlab-*/`.

The navigation harness also verifies that a live WebKit page without
animation frames still completes the scroll and hit-target check. The
normal paint wait remains in use when frames arrive; a timer only bounds
that wait. The test suppresses frames in the owned page and counts actual
clicks on the intended control and its disabled duplicate. The installed
release verifier requires this evidence on each GitLab baseline. A lost
WebDriver reply is still reported as uncertain, not retried.

To run the entire suite against an extracted archive in a prepared
test environment, use `pnpm nx run desktop:native-gitlab -- --package
"$archive"`. This includes the loopback SSH clone fixture and requires
a working OpenSSH server executable and helpers. An extracted server also
needs the helpers' runtime libraries; an executable `sshd` alone does
not prove its session helper can start. For the original fork catalogue regression, use
`pnpm nx run desktop:native-gitlab-fork-ui -- --package "$archive"`.
It exercises the actual catalogue transition and the WebDriver readiness
and refusal regressions without SSH. The focused target opens a small
owned repository directly rather than running the general smoke suite first.
It passed the same ten fork and WebDriver assertions on the workstation
(`direct-nx-gitlab-fork-ui-focused/`). The full installed release check
is unchanged.

## Trying the exact local candidate

`task install:linux` builds from the checkout. To try the exact archive
from the acceptance run without changing your installed app, set `archive`
to its absolute path and `reviewed_sha256` to the qualified digest above:

```sh
bash tools/preview-linux-package.sh "$archive" "$reviewed_sha256"
```

The preview needs the runtime libraries already on your system. It opens a
temporary app profile, but it does not isolate Git repositories; use a
disposable checkout. To test the actual system installation instead:

```sh
sha256sum "$archive"
task install:linux:dry-run -- "$archive"
# Only install if this is the archive you intend to test.
sudo apt-get install --reinstall --no-remove "$archive"
# Quit all running Git Khronos windows and relaunch before testing.
task install:linux:status -- "$archive"
```

Two local builds may both report `0.1.6`. The status task checks the
installed files against the selected archive rather than relying on the
version string. The candidate trusts a test publisher, not the
production update service.

## Rerun the working-tree and reference regressions

On a disposable Linux test system with the reviewed archive already
installed, run the affected suites as one batch:

```sh
GIT_KHRONOS_NATIVE_OUTPUT=/absolute/path/to/new-results \
  bash tools/run-native-suites.sh "$archive" \
  working-tree-recaps discard-subset discard-large worktrees reference-copy
```

The Ubuntu 24.04 batch passed all five suites against the exact archive
(`user-regressions-batch-with-subset/`). Each suite also passed separately
on all five baselines. The harness uses owned temporary
repositories, not the open app or the user's CTI checkout.
For extracted-package checks from the checkout, the matching Nx targets
are `desktop:native-working-tree-recaps`, `desktop:native-discard-subset`,
`desktop:native-discard-busy`,
`desktop:native-discard-large`, `desktop:native-worktrees`, and
`desktop:native-reference-copy`.

## Focused configured-tool acceptance

To exercise configured program profiles and custom actions without
rerunning the full toolkit:

```sh
pnpm nx run desktop:native-configured-tools
```

To test an extracted archive, use `python3 tools/native_acceptance.py
--suite configured-tools --headless --package PATH`. The focused run passed the same
three configured-tool scenarios on each of the five baselines without
first running the generic smoke suite (`configured-tools-focused-trimmed/`
for Ubuntu 22.04 and `configured-tools-baselines/` elsewhere). It covers profile deletion after
its control becomes ready; it does not replace the full environment suite.

## Earlier 0.1.6 full-ref qualification

The Jammy-built 0.1.6 package with **Copy full ref** has SHA-256
`731adcc947de13f7caeb56be7b9ee8678b5b420a2def5a4a77809adbbc67744c`.
The installed `reference-copy` suite opens the real local
branch, remote-tracking branch, and tag menus with overlapping names,
pastes each clipboard value into an owned X11 field, and checks that
HEAD, refs, index, and working state are unchanged. It passed on all
five Linux baselines. The 78 focused Chromium reference-action tests
also passed. Evidence is in `target/local-review/jammy-copy-full-ref.z9TkUS7v/`.
The same archive passed all 22 installed file-history checks on Ubuntu
24.04, including a real root-commit blame action: **Parent** explains
that no parent exists and leaves the displayed file, HEAD, and index
unchanged (`history-root-parent/`).
Ubuntu 24.04 also upgraded from public 0.1.5, preserved a dirty checkout,
and passed both X11 launch paths and renderer recovery. The first run
passed the application checks but reported a cleanup error when a Mesa
shader-cache write overlapped removal of the private test profile. A
bounded cleanup retry fixed the harness failure; both logs are retained
under `upgrade-launch/`.
The current archive also passed fresh install, desktop-entry and command
launch, and APT removal on all five baselines. The executable and launcher
matched the archive before launch; removal left the owned test-user file
untouched (`x11-launch-baselines/`).
The same archive passed all 51 checks in the first matrix run. The
Ubuntu 24.04 clipboard test is now a release requirement; the strict
verifier accepts all 52 checks with that same-package report
(`verified-release-matrix-with-ref-copy.json`). To run the focused check:

```sh
pnpm nx run desktop:native-reference-copy -- --installed --package /path/to/package.deb
```

The fixture-key rehearsal verified all
five staged files and the real updater library accepted the signed offer
in a mock runtime set to 0.1.5. These are local checks, not production
publication or a live in-app upgrade.

## Earlier Blame input candidate

The local Ubuntu 22.04 package with the Blame line-input fix and updated
release notes has SHA-256
`d7aeb70d5809e98be3332d26ddc4114d8a044a6fc9855ac84f0abdeebe65ec13`.
On Ubuntu 24.04, all 21 installed file-history scenarios passed. The new
empty-input check keeps focus and the current page, shows an input error
without offering a retry, and then accepts a valid jump. The previous
package failed that check. The embedded changelog matches the source and
the host APT dry run would replace only Git Khronos. In a disposable
Ubuntu 24.04 install, the upgrade from public 0.1.5 preserved a dirty
checkout. Both X11 launch paths and bounded renderer recovery passed.
Fresh installation, both X11 launch paths, and APT removal passed on
all five Linux baselines without changing an owned file in the test
user's home (`x11-launch-baselines/`).
The Ubuntu 24.04 same-version reinstall also proved that the status tool
identifies the exact still-running old executable by PID; the warning
clears after exit and both fresh launch paths render the new package
(`running-same-version-reinstall/`). The command launch still emitted
DRI3 warnings in this Xvfb setup while rendering a nonblank window. This
does not qualify WSLg or a Windows taskbar pin.
All 51 installed release checks passed on the first matrix run across
Ubuntu 22.04, 24.04, and 26.04 and Debian 12 and 13. The strict verifier
bound all reports, including the 326 Jammy environment scenarios, to the
same archive. The fixture-key rehearsal staged and verified all five
release files; the actual updater library accepted the signed offer in a
mock runtime set to 0.1.5. A fresh Ubuntu 26.04 worktree run on these bytes
also proved that double-clicking `dev` from a linked worktree returns to
the registered primary checkout without detaching or modifying either
checkout. A focused Ubuntu 24.04 run also confirmed that bulk discard,
Undo, Redo, and post-restart recovery of the four CTI-sized paths leave a
staged-only file and the index entries unchanged. The Ubuntu 26.04
GitLab rerun passed 48 scenarios, including a real WebDriver probe
that waits for a delayed control and clicks it exactly once. The stricter
matrix recheck requires these scenarios and incorporates the fresh reports
(`verified-release-matrix-delayed-navigation.json`).
These local results are under
`target/local-review/jammy-blame-input.9c2x7bYY/`. They do not replace a
hosted production-key candidate or a live update check.

## Earlier minimap candidate

The Ubuntu 22.04 build with the dense-diff minimap cap has SHA-256
`c9d1a799e54b360164d6086ababb2c300e96d83d397327c3b15afb83a5a71955`.
The focused native history suite passed 21 checks on Ubuntu 24.04, including
clicking **Parent** on a line introduced by a rename and verifying that the
pre-rename path opens at the parent commit without touching the checkout or
index. The same
large-diff fixture rendered 512 decorative marks, down from 8,567 on the
previous package; hunk buttons still navigate to exact changes. The host's
APT dry run would change only Git Khronos. A separate Ubuntu 24.04
container upgraded from public 0.1.5 without changing a dirty checkout,
rendered both X11 launch paths and passed the renderer-recovery check.
These records are under `target/local-review/jammy-diff-minimap.HX1pBqJW/`.
The first Ubuntu 26.04 GitLab lane stopped before dispatching the Browse
GitLab projects click: the Clone tab was visible before its Browse control
was eligible. The harness now waits for the eligible control and captures
it in the same read. A fresh smoke and GitLab run using the unchanged
archive passed after the harness fix; the failing run is retained in
`matrix-resolute/` and the passing run in `resolute-catalogue-readiness/`.
This was distinct from the earlier pre-TCP connection failure.
The strict verifier rejected the original set containing the failure. With
only that lane replaced by the documented rerun, it verified all 51
installed checks, including 326 environment scenarios on Ubuntu 22.04.
`verified-release-matrix.json` binds those reports to the archive. The
fixture-key rehearsal then staged five verified files, and an offline
mock 0.1.5 runtime accepted the signed offer using the real updater
library. No production key, production release, or live updater install
was used.

## Earlier theme-token candidate

The later theme-token cleanup package, SHA-256
`96d88cc6ceea47a1292a32c9b0849a5d9e2bfa571bc0ef12dd84abfa4bfe1c94`,
passed strict verification for all 51 installed lanes. The first run passed
50 lanes; Ubuntu 26.04 GitLab reported an unclassified connection failure
before the fixture accepted TCP. A fresh installed run with the same bytes
and socket-only tracing passed all 47 GitLab scenarios. The failure was not
a WebDriver stale-click refusal, and its cause is not established.
`target/local-review/jammy-theme-tokens.uhYhdqAC/test-publisher-verified.json`
binds the 50 original successful reports and the new GitLab report. The
initial failure is retained in `matrix-resolute/`; the rerun is in
`gitlab-connect-diagnostics/`. The exact archive also passed the
Ubuntu 24.04 APT upgrade and renderer recovery probes in `upgrade-and-render/`.
Four further Ubuntu 26.04 samples in `gitlab-connect-samples/` exercised
the first owned connection after smoke under a two-CPU quota. All negotiated
TLS and recorded exactly one fixture TCP accept and one API request. The
traces cover only `connect` and `getsockopt` in loopback-only containers;
the failed connection was not reproduced with tracing enabled.
Four otherwise comparable runs without tracing also passed
(`gitlab-connect-untraced/`), with one TCP accept and one API request each.
This does not isolate tracing or CPU load as the cause of the first failure.
The fixture-signed assets in `signed-rehearsal/` passed offline updater
consumption from a mock 0.1.5 runtime and rejected changed package bytes.
No production signature or hosted update was used.
Fresh installation, both X11 launch paths and APT removal passed on all
five baselines for this archive (`exact-launch/`). The workstation dry run
(`host-apt-dry-run.log`) would replace only `git-khronos`; it neither
installed the package nor tested the Windows pin.
In a disposable Ubuntu 24.04 system, `same-version-reinstall/run.log`
also proves that reinstalling this archive over a different 0.1.6 build
replaced the executable. The installed-byte checker detected the older
build beforehand, and both launch paths rendered afterward with the dirty
fixture checkout unchanged.
`running-reinstall/run.log` covers a different case: the old app was still
running during same-version replacement. Its executable was unlinked on
disk and the status command identified the old process by PID. After
quitting that owned process, both launch paths rendered the new build.
`final-release-matrix-replay.json` records a fresh strict verification.
Separate negative replays refused both a passing report from the previous
0.1.6 archive and the original failed GitLab report supplied alongside its
passing rerun. A previous version string or a passing replacement does not
make the supplied report qualify.

### Previous theme-recap candidate

The portable package with theme-aware recap labels has SHA-256
`4e84847806319c7c920a66166c797b1319fa40ff3e17b610bdb9bd177dd0fdd8`.
All 51 installed checks passed on Ubuntu 22.04, 24.04 and 26.04 and Debian
12 and 13 in the original matrix run. Ubuntu 22.04 passed 325 environment
scenarios; Ubuntu 24.04 passed 26 recap scenarios including both themes.
The GitLab catalogue, occupied branch, updater consent and discard checks
used these same bytes.

In `target/local-review/jammy-theme-recap.MCkDSylQ/`,
`test-publisher-verified.json` binds the exact package, build receipt and
fixture key to all reports. `upgrade-and-render/run.log` records the Ubuntu
24.04 APT replacement of public 0.1.5, both launch paths, renderer recovery
and unchanged dirty-checkout files. `signed-rehearsal/` contains the locally
verified release assets. The offline updater library accepted the offer and
original package, refused corrupted bytes and offered nothing at the
current version. No production signing, GitHub publication or live
in-app installation was performed.

`exact-launch/` has fresh-install evidence for the same bytes on all five
baselines. The desktop entry and terminal command both drew a nonblank
window. Removal took out the executable and desktop entry and preserved
the test user's file. This does not verify a Windows taskbar pin.

## Earlier 0.1.6 local qualification

The Ubuntu 22.04 baseline test-publisher package with SHA-256
`12d5d9a02e7c8f12b8ac3d4d1a2a0bfaa459ffeb48f2489861554969686eba64`
passed all 49 installed matrix checks on Ubuntu 22.04, 24.04 and 26.04
and Debian 12 and 13, with no retries. The Ubuntu 22.04 environment lane
ran 321 scenarios, including the automatic-update consent description
in the packaged WebKitGTK app. GitLab catalogue and CTI-style discard
checks used the current harness. The production renderer was 292,329 bytes
with no budget warning.

Local evidence: `target/local-review/jammy-current-consent.KebefH/`.
Its `test-publisher-gitlink-gate-verified.json` binds the reports to this
archive, its build receipt and the fixture public key. The release verifier
requires explicit evidence of the packaged consent check and of staging and
unstaging exact binary bytes, executable-bit changes, and a parent gitlink
without touching a dirty submodule. This is not evidence
of production publisher signing, public release, or a signed in-app upgrade.

The `apt-upgrade.QVDULY/run.log` in the same evidence directory records an
offline Ubuntu 24.04 APT upgrade from the checksum-verified public 0.1.5
asset to that exact candidate. Both launch paths rendered after replacement,
and the fixture's HEAD, index, unstaged contents and untracked file retained
their original bytes. This exercised the system package upgrade, not the
in-app installer.

The later host-local build containing the file-history clipboard fix is a
different package (`35deb3edd672f094fac7f5c2ad98e30219f4a6377949f632e086169a754b1481`).
It passed file history (18 scenarios), application updates (23) and discard
subset (7) when installed on Ubuntu 26.04. The package without the fix fails
the new clipboard assertion after switching history revisions. Local evidence
is in `target/local-review/history-feedback-fixed.3ISRj5/`; these focused
results do not transfer the earlier portable package's matrix qualification.

The subsequent Ubuntu 22.04 baseline package containing that fix
(`74b42079472fd17ed21e1b8c2d20ced1b72d52a774de134f41fc68b03ade2929`)
covered all 49 release checks with the receipt selection in
`target/local-review/jammy-history-feedback.mRldMk/test-publisher-clipboard-gate-verified.json`.
The standalone signing preflight and the matrix verifier both require the
installed updater consent scenario. The matrix also requires evidence that
creating a branch from a stash refuses to overwrite ignored local contents
and retains the source stash when restoration succeeds.
The initial reports are retained: Debian 12 incoming-link activation and
Ubuntu 22.04 GitLab passed on rerun without a verified root cause; the
Ubuntu 24.04 working-tree and Ubuntu 22.04 environment lanes passed after
the harness was changed to await Git's authoritative index rather than
only optimistic UI rows. The focused Ubuntu 24.04 file-history suite also
passed all 18 scenarios against this same archive.
Its `apt-upgrade-smoke/run.log` records a fresh check from the public
0.1.5 package to this exact candidate on Ubuntu 24.04: both launch paths
rendered and the dirty fixture's HEAD, index and files kept their bytes.

The host-local 0.1.6 build with the expanded Debian changelog is
`cf5be1c8bc51fef6b4f875ca50aede7ce3f465c5c05746103e7e5b8f230450d4`.
Compared with the preceding host-local build, the extracted changelog is
the only changed payload file and `Installed-Size` is the only changed
control field. The new archive passed 23 installed updater and seven
discard checks on Ubuntu 26.04. Evidence is under
`target/local-review/release-notes-local.SfcHzS/`.

The newer host-local build that adds File History's full commit ID action
(`e7a9132c3729b9bb073078da40afc88c548e4342c263fe07ffa9998cc251c149`)
passed 56 installed checks across tracked-file search, file history, updater
and discard on Ubuntu 26.04. Evidence is in
`target/local-review/history-id-local.Ks9HSq/`.

The matching portable test-publisher build
(`05bd4248033360044b40631c2bd2945bd574fe85e3cf2bcac82e9c409b061c0b`)
passed all 49 checks under the gate that now requires the full commit ID
action. The Ubuntu 22.04 environment lane covered 323 scenarios. Two initial
failures are retained: Debian 12 GitLab passed after the fixture waited for
native capture removal; Ubuntu 26.04's TCP refusal check passed on rerun with
no verified cause for the earlier generic error. See
`target/local-review/jammy-history-id.oq7Ww4/test-publisher-with-rechecks-verified.json`.
The same archive passed an Ubuntu 24.04 APT upgrade from the checksum-verified
public 0.1.5 package, including exact installed executable/launcher matching,
rendering from both launch paths, and unchanged dirty fixture files and index.
See `public-apt-upgrade/run.log` in the same evidence directory.

The host-local 0.1.6 package with the clearer **Excluded** line-recap label
(`516e662e6e366b6ea1735c246b7b51d301df6cd0436ec889ab6478cfc619e557`)
passed 38 installed checks on Ubuntu 26.04, including visible totals,
comparison-base tooltips, tracked-file search and discard recovery.
Evidence is in `target/local-review/recap-label-local.vv7tZ2/`.

The corresponding portable **Excluded** build
(`0636923d0414c31fd6707304bab671e25a8f239a30555b39cf0e4051796789d1`)
passed all 49 installed checks on the first attempt. That includes
323 Ubuntu 22.04 environment scenarios and all 24 Ubuntu 24.04 working-tree
recap scenarios using the updated label and tooltip checks. Its build
receipt, test publisher key, and exact reports are bound by
`target/local-review/jammy-recap-label.WgWuwd/test-publisher-verified.json`.
The same archive passed an upgrade from the public 0.1.5 package on Ubuntu
24.04; see `public-apt-upgrade/run.log` in that evidence directory.
Its `offline-update-consent/` run separately passed a manual check without
opt-in and verified that both opting in and opting out survive restart.
It did not exercise signed download or installation.
On Ubuntu 26.04 the same archive passed 24 focused worktree checks and
20 performance checks. On the 100,000-commit fixture with 64 branches
and 36 linked worktrees, the graph opened in 1.75 s and the working-tree
totals appeared in 2.23 s while renderer tests also ran. At most 57 graph
rows were rendered. See `focused-worktrees/` and `focused-performance/`.
After extending stale-element handling to the local Clone and Browse
GitLab projects controls, the same archive passed all 46 GitLab scenarios
on each of the five baselines. The harness still sends provider connections,
reviews and writes only once. The strict
`test-publisher-catalogue-navigation-verified.json` binds those five fresh
reports and the 44 unchanged lanes to the same archive.
The refreshed Ubuntu 24.04 recap lane passed all 25 scenarios, including
an installed WebKitGTK check at 820 px that keeps the totals, Stage all and
Discard all visible without overlap or checkout changes.
`test-publisher-compact-recap-verified.json` binds that updated report,
the five refreshed GitLab reports and the other 43 lanes to the same archive.

A newer host-local package
(`f83d331b3e9800b6ecffca6adfee8486a4ffa5d7225c50c8f10e3417b78b2191`)
adds ellipsis for long File History subjects. All 20 extracted-package
File History scenarios passed on Ubuntu 26.04 under WSL2, including a real
commit with a long unbroken subject at 820 px and both copy actions.
See `test-results/native/file-history-1795558474486384040/report.json`.
This focused result does not transfer the portable archive's matrix to the
newer package or verify the pinned shortcut.

The corresponding new portable Ubuntu 22.04 archive
(`f484d494084faeee98d6bb72b6cb9206f38e4d53d030df809b434a7e0219da2b`)
requires at most GLIBC_2.34. In an offline Ubuntu 24.04 container, APT
upgraded the public 0.1.5 package to these exact 0.1.6 bytes. Both installed
launch paths drew a nonblank X11 window, and the fixture HEAD, index,
modified file and untracked file still matched their pre-upgrade hashes.
See `target/local-review/jammy-compact-history.rhdw0RLS/public-apt-upgrade/run.log`.
Fresh installations of the same archive also rendered from both launch
paths on all five baselines. APT removal took out the executable and desktop
entry without removing the test user's marker file. See `exact-x11/`;
use `jammy-with-harness-path.log` for the Jammy result, since the first
probe lacked the harness Python path.
An additional Ubuntu 24.04 experiment used private Xvfb and D-Bus to
terminate only the freshly launched app's verified WebKit child. After each
of three crashes the same app process started a replacement renderer and
drew nonblank content. A fourth crash closed the app, and a new launch drew
normally. See `native-renderer-recovery/run.log` in the same evidence
directory. This is not a WSLg compositor or pinned-shortcut test.
Repeat the experiment with
`bash tools/check-installed-x11-launch.sh --renderer-recovery PACKAGE.deb`
as an unprivileged user after installing the exact archive in a disposable
Linux environment. The probe uses its own profile, display and session bus,
and signals only a verified WebKit child of the app it starts.
The Ubuntu 24.04 installed-acceptance job now also runs this probe and
retains `renderer-recovery.log` with the archive digest.
This uses a test publisher key and verifies manual APT replacement, not a
signed in-app update.

The same archive passed all 49 installed matrix checks on the first run,
including 324 environment scenarios on Ubuntu 22.04 and the compact
File History check on Ubuntu 24.04. The exact package, build receipt,
fixture public key and installed results are bound by
`target/local-review/jammy-compact-history.rhdw0RLS/test-publisher-verified.json`.
An offline signing rehearsal then staged and reverified the unchanged
package, canonical manifest, two CycloneDX inventories and checksums.
Negative checks on those bytes refused a different public key, a
valid fixture signature for the wrong version, and a changed manifest
download URL even after updating its checksum. The original set still verified.
It did not publish assets or test an in-app install.
The same installed bytes passed all three checks in
`offline-update-consent/` on Ubuntu 24.04. A manual check ran with
automatic updates off; an opt-in survived restart and triggered an automatic
check; and a subsequent opt-out survived restart and kept the manual check
available. The disposable container had no external network, so it could not
receive an offer or install an update.
All 24 focused installed worktree scenarios also passed on Ubuntu 26.04
(`focused-worktrees/`). Opening an occupied branch went to its registered
worktree without detaching or modifying either checkout. Cancel and a changed
owner both left the dirty checkouts intact.
The Ubuntu 26.04 worktree suite is now a required release lane.
`test-publisher-worktrees-gate-verified.json` binds all 50 required lanes
to the same archive and fixture publisher key.
The Ubuntu 24.04 offline consent suite is also now required for
publisher-enabled candidates. The hosted lane isolates networking before
running the app as the unprivileged runner.
`test-publisher-consent-gates-verified.json` binds all 51 current lanes.
The hardened initial navigation check also passed in all 47 fresh GitLab
scenarios on each baseline. `test-publisher-initial-navigation-verified.json`
binds those five refreshed reports and the 46 unchanged lanes.
The separate Ubuntu 26.04 installed performance run (`focused-performance/`)
passed 20 scenarios with a two-CPU container quota. On the fixture with
100,000 commits, 64 branches and 36 linked worktrees, the graph opened in
0.99 s, working-tree totals appeared in 1.70 s and at most 57 graph rows
were rendered. These are local measurements, not hosted-CI timings.

By default, the native acceptance harness tests the production WebKitGTK
application extracted from the Debian package. It does not install the package, alter a
personal Git configuration, reuse personal repositories, or expose a
development-only application endpoint.

The harness inspects, hashes, and extracts one private copy of the selected
archive. A concurrent rebuild at the original path cannot change the package
bytes midway through those checks.
Run the harness with Python assertions enabled. It refuses `-O` or
`PYTHONOPTIMIZE` rather than treating skipped assertions as passing checks.

The optional `--installed` mode checks both the installed executable and the
`git-khronos.desktop` launcher against the reviewed package before starting
WebDriver. It records the installed launcher's SHA-256. This catches a missing
or stale launcher (including altered link arguments or window identity);
it does not test host-specific pinned shortcuts.

To verify that both normal launch paths actually draw a window, install the
reviewed Debian package in a disposable Linux environment and run
`bash tools/check-installed-x11-launch.sh` as an unprivileged user. It uses
separate Xvfb displays, D-Bus sessions and temporary homes for the desktop
entry and direct executable. It samples a rendered window rather than
relying on a successful launch command, and needs no WebDriver or xauth.
Pass the reviewed `.deb` as its only argument to first verify that the
installed executable and desktop entry match that archive (requires Node).
This is an X11 smoke check, not a WSLg or pinned-shortcut test.

The main-menu smoke journey waits for the actual deferred menu content and its
focused Manage Repositories action before Tab dismissal. A loading/error escape
does not qualify the finished menu. The report records header/scroll-area layout
and checks that the menu remains inside the native viewport. Renderer checks
separately hold/fail its module request and exercise compact-height scrolling.

The full and inherited-environment suites check the fixture Git and Git LFS
toolchains before launching WebDriver; the LFS-only counts/timeout suites also
require Git LFS. A missing executable is reported during preflight rather than
surfacing later as a misleading transport failure. The report records the executable, Git's helper
directory and the outcome of `git fsck` on a fresh fixture. If using a custom
Git in `PATH`, provision its matching helpers where that executable looks for
them; the fixture intentionally discards inherited `GIT_*` overrides. This
preflight does not replace the application's initial and final integrity checks.

Headless right clicks use the application owner on that test's private D-Bus
session, verified against the packaged executable and the target Xvfb window.
A second process using the same installed executable does not become a click
target. The owner is checked again before dispatch, and input is never replayed
after an uncertain reply.
The packaged restart checks use the same owner instead of counting processes
with matching executable paths. They wait for the old process and bus owner to
exit, launch once, and verify that the new bus owner is the reviewed executable.

The `editor-close` suite exercises the real X11 window-close request in
isolation. It binds the visible, close-capable window to the application PID
on the fixture's private bus and checks that owner again before sending one
`WM_DELETE_WINDOW`. A process briefly sharing the executable does not become
the target. The suite checks keeping, saving and discarding editor drafts
without staging changes.

For watcher diagnosis, run `watcher-checkout` for just the external-checkout
and untracked-file case shared by smoke and GitLab acceptance. Set
`GIT_KHRONOS_NATIVE_TRACE_WATCHER=1` to record native events, Git status read
modes and checkout milestones. `watcher-refresh` also records untracked-file
disappearance. If the rendered branch or status fails to converge, the
report captures Git, rendered and native read-only status after the timeout;
the check still fails. The success path never forces a refresh and the
timeout is unchanged.

On a Git version with reftable support, use `watcher-reftable` to create and
delete a branch externally without changing the checkout's HEAD or index.
The renderer must update the branch list in response to real watcher
notifications. Run this focused suite on Git versions that can initialize
a reftable repository; it is not part of the Git 2.39 compatibility gate.

Use `--suite watcher-shallow-history` to open a detached linked checkout and
deepen its shared history from the primary checkout using an owned file
remote. HEAD, refs, index, config and working files must stay identical.
The rendered boundary moves as history arrives and disappears after
unshallowing. A legacy graft on the root keeps its ordinary Git decoration
unchanged, so the final check distinguishes shallow metadata from commit
identity. The harness observes the actual watcher; it does not refresh
the renderer itself.

Use `--suite conflict-navigation` to start a real conflicting merge and
move from the commit inspector to the focused **Conflicted Files** section
with **Show conflicted files**. Independent Git reads verify that
`MERGE_HEAD`, refs, index, config and working files do not change. The packaged
Merge Tool is then opened for seven conflicted paths: **Take Incoming**,
**Take Current**, edited output, a binary conflict, modify/delete and
rename/modify conflicts, and a submodule gitlink conflict. Independent Git
reads verify exact staged blobs and removal; the submodule choice changes only
the parent gitlink, not the checked-out submodule's HEAD or status. The merge
remains active until all unmerged index entries are cleared, with `MERGE_HEAD`
preserved for the user's next merge action.

The focused `desktop:native-file-tools` target also exercises an external
merge profile in the installed package: the tool receives exact base/current/
incoming bytes in private copies, its binary output is explicitly reviewed,
the saved worktree result is separately reviewed before staging, and cleanup
retires the private tool session without modifying repository configuration.

Read-only readiness checks tolerate WebKit's exact transient result-parsing
error within the original deadline. Direct scripts, clicks and Git
operations are not retried after an uncertain reply.
The private headless display stays initialized between app processes so a
WebView restart doesn't also race an X server reset. If a restart fails,
inbox cleanup must not replace the original error with an invalid session ID.

For a long run, read the evidence directory's `progress.json`. It identifies
the acceptance worker PID in its process namespace, current phase, phase start (seconds into the
run), and last completed scenario. The full toolkit identifies the active
group, such as file tools, hosted reviews, Git transport, history, or
working-tree recovery. `completedPhases` records elapsed wall time and
scenario counts for phases that have ended, including a phase that failed.
Phase transitions are not completed tests. A failure retains its first failing phase through cleanup, also
recorded as `failurePhase` in `report.json`. Only the final report qualifies
the package; a stale progress file alone is not proof the worker is alive.
When the run finishes, the console shows elapsed time, scenario count, and
the three slowest phases. This is diagnostic output, not release evidence.
Hosted and workspace steps now report fork discovery, branch workflows,
hosted decisions, and workspace/reference work separately. History pagination,
stash-stack operations, commit previews, blame, and stash dialogs likewise
have separate timings. Both the full toolkit and the focused file-history
suite report responsiveness, output-limit enforcement, and the intentional
deadline separately. A slow intentional-deadline phase is expected: that
test holds Git until the application times out and reaps the child.
Splitting phases does not skip or reorder scenarios.
To retest branch/tag column hover and focus without running the full toolkit:
`python3 tools/native_acceptance.py --suite reference-hover --headless --package /path/to/package.deb`.
It runs the same real-pointer and keyboard-focus checks at all three widths.

Use `--suite checkout-snapshot` to reproduce a same-tip branch switch
while the application opens a repository. The fixture pauses only the
app's Git reference read. Independent Git switches branches at the same
commit, then the native command must retry and agree on the branch in
porcelain status, the branch list, and the active worktree. The retry must
not change Git state. A passing smoke run alone cannot satisfy this check.

Use `--suite worktree-reservation` to exercise branch checkout while a
linked checkout has a real stopped rebase. The linked checkout is detached,
but Git still reserves its original branch. The test selects Checkout
branch in the packaged UI, checks that the error names the owning path
and explains what to do, then verifies that both checkouts and the pending
conflict are unchanged.

Use `--suite comparison-line-budget` to open a real working-directory
comparison containing tracked edits, a small untracked text file and a
large untracked text file. The installed UI must show partial line totals,
keep the uncounted file selectable, and still open the small file's diff
without modifying Git state or any fixture file.

Use `--suite comparison-responsiveness` to hold Git during the packaged
commit and working-directory comparisons, at both list and file level,
and during the commit-count phase of a local branch comparison.
An unrelated native status query must finish before the held comparison
is released, and the finished comparison must still return the correct
file, patch, or branch tips and counts without changing the repository.
The Ubuntu 24.04 installed-package release check requires both results.
The optimized branch counter and unknown LFS toolbar badge passed the
comparison and LFS-timeout suites against extracted local package
`660ea2422d781e56f8e690d0b201955540287b8cec71a8eddf640e118ec27dca`
(`test-results/native/comparison-responsiveness-1795517672155477041/report.json`
and `test-results/native/lfs-snapshot-timeout-1795517677073296969/report.json`).
Both comparisons passed in an offline Ubuntu 24.04 installation of
`827a2780486716684474c8f01d8edcf733990ff5176191f7d8419891d5db3f88`,
alongside the four merge-preserving rebase checks. See
`target/local-review/noble-branch-comparison.s0OW6arn/reports/`.

`--suite stash-responsiveness` uses the same check for stash details and
an individual saved file. It verifies the exact saved patch while both
the stash ref and the different live working changes remain untouched.

`--suite checkout-responsiveness` holds Git separately during local branch
switching, explicit remote-tracking branch creation, and reviewed detached
checkout. Native status must respond while each switch is paused. The suite
also verifies the resulting HEAD and tree, upstream, and unrelated local
file against Git.
The Ubuntu 24.04 release check requires this result separately from
detached-checkout safety and snapshot coherence. All three passed after
offline APT installation of
`7f27ceb3685085535da9222066409815226353198ace26ba5f5afb5bf757a9f6`;
see `target/local-review/noble-checkout-responsiveness.lkrnflb1/verified.json`.

`--suite history-control-responsiveness` uses the same held-Git check for
interactive rebase preparation and replay, as well as Continue and Abort
for both rebase and merge. It checks branch, commit parents and working
tree after Git settles. The detached-checkout safety suite separately
exercises ignored-file obstructions during rebase Skip and Abort.

`--suite local-mutation-responsiveness` holds stash save, apply and pop,
then cherry-pick and revert, while an unrelated native status request runs.
It checks the exact restored file bytes, stash retention versus removal,
and the resulting Git history and trees.

`--suite commit-responsiveness` also holds message-only amendment and
ancestor editing at their real Git commands. Native status must respond
before the hold is released. Both operations preserve staged and
unstaged contents, the existing commit trees, and the sibling branch.
The Ubuntu 24.04 installed gate requires commit responsiveness separately
from the commit editor's stale-review and rewrite correctness checks.
The old local package needed the watchdog to release the held Git command
before native status could respond. Package
`fca18fa7966c7cda2e0088c0abd78311e6392a18fa5ec78594abe94b41a86fd7`
passed both commit suites, all five scenarios, after offline installation
on Ubuntu 26.04. Each held mutation left native status responsive without
the watchdog. Evidence is in
`target/local-review/commit-rewrite-responsive.ZsCTuj/`.
The Ubuntu 22.04-built test-key archive
`9f41ae58b44d48ec6280735e59a4ca1b90fa3f75c86343d0d5335b7740e4da63`
also passed both focused installed gates on Ubuntu 24.04. Its receipt
is under `target/local-review/jammy-direct-commit.yyAzpE/noble-focused-commit/owned/run/`.
The same archive satisfied all 48 installed matrix checks after an Ubuntu
26.04 GitLab rerun with socket tracing. Both earlier failures are retained
in `release-progress-all-attempts.json`; the strict
`test-publisher-verified.json` selects the passing evidence and verifies
the exact archive, build receipt, and test public key.

For GitLab connection triage, use `--suite gitlab-connect` for only the
private TLS Connect flow, or `--suite gitlab-connect-after-smoke` to run it
after the smoke and SSH setup that precede it in full GitLab acceptance.
`--suite gitlab-connect-refused` instead reserves a loopback port without
listening. It checks for the specific TCP-refused diagnostic, a cleared
token, no HTTP requests, and unchanged Git state. A passing refusal test
does not establish the cause of a prior intermittent failure. Ubuntu 26.04
release qualification now requires this refusal test separately from the
full GitLab suite.
The local package
`d39cdc90e190c274590c8b03e4f49193845306265df8477bcec130a0c681319c`
passed both the refusal test and all 19 Connect-after-smoke scenarios
after installation in offline Ubuntu 26.04 with a 1.5 CPU limit.
See `target/local-review/gitlab-connect-diagnostics.MlQQRK/offline-installed.OzaxM5/`.
This is focused evidence, not a new portable release-matrix result.

On the subsequent portable candidate
`43b2fb1fe32567c156963224e1bf931d5e465b4a1de99105633c4f96ced5f59a`,
Debian 13 reported `connect-unclassified` with zero fixture TCP accepts
and zero HTTP requests; an independent TLS handshake immediately afterward
succeeded. A socket-traced rerun of the same package passed all 45 GitLab
scenarios, including one accepted TCP connection and one authenticated
request on its initial Connect. The tracing covered only `connect` and
`getsockopt`; it did not reproduce the failure or identify its cause.
Both attempts are retained under
`target/local-review/jammy-connection-stage.xwCMYI/`.
The same archive satisfied all 49 installed checks across five Linux
distributions. In that directory, `expanded-release-progress.json`
retains the failed attempt, and `expanded-test-publisher-verified.json`
binds the selected passing reports and build receipt to the exact archive
and disposable publisher key. This verifies the test-key candidate only;
it does not qualify an actual production-signed upgrade.
The same package passed 20 performance and three update-consent scenarios
after offline installation on Ubuntu 24.04. With 100,000 commits, 64
branches and 36 linked worktrees, the graph opened in 797 ms and working-tree
recaps were ready in 1.67 seconds; at most 57 rows were rendered. The consent
tests verified manual checks and durable opt-in and opt-out across restart
without any installable offer. See `installed-extra.Y53kmb/verified.json`
under the same evidence directory.

The Ubuntu 22.04-built test-key package
`09ac6dce1a155300340b899ccb8b500f1ba30060621c981fa92856d0016852e9`
passed the installed performance suite with 20,000 and 100,000 commits,
64 branches and 36 linked worktrees per fixture. With other acceptance
containers running, both graphs opened within 1.74 seconds, working-tree
recaps within 2.26 seconds, and no more than 57 rows were rendered.
See `target/local-review/jammy-local-mutations.GZVhMo0V/installed-performance/`.
The same archive passed the full 47-check installed matrix on its first run,
including 316 Jammy environment scenarios. The strict
`target/local-review/jammy-local-mutations.GZVhMo0V/test-publisher-verified.json`
binds the matrix, archive and build receipt to the fixture public key.
The separate offline consent suite passed all three checks; it did not
offer or install an update. These are not production-signing or publication
results.

The next portable test-key package,
`49318f97a076904bc3bd419b427a76fad5879cb11727676480995725b857e3e4`,
was built offline on Ubuntu 22.04 with the selected-file discard fixes.
The ELF requires glibc symbols through 2.34, below the declared 2.35
baseline. The installed offline consent suite passed all three checks
against these exact bytes again. The build, checksum, snapshot, ABI check,
and consent run are under `target/local-review/jammy-discard-scope.skNzLH/`.
The same archive passed all 47 installed matrix checks after the successful
Ubuntu 24.04 GitLab rerun. The strict `test-publisher-verified.json` binds
the passing reports to the exact archive, build receipt, and test public
key. `release-progress-all-attempts.json` retains both initial GitLab
failures; they were not treated as passing reports. This package predates
the renderer's rejected-status retry backoff and the per-path oversized
discard labels.

Its successor `fe1936f835d964d0b536c2635f1e8199e2369ff0b2443712007042d4bd6d6aad`
passed all 20 installed performance scenarios on Ubuntu 22.04. In the
20,000- and 100,000-commit fixtures (64 branches and 36 linked worktrees
each), history opened in 1.37 s and 1.01 s, and working-tree recaps became
ready in 2.14 s and 1.79 s. No more than 57 graph rows were rendered.
These are observations from this exact run, not timing guarantees.
See `target/local-review/jammy-oversized-discard.A9HBeW/installed-performance/`.
The same portable archive passed all 47 installed matrix checks on the
first attempt. The strict `test-publisher-verified.json` binds those
reports to this archive, the build receipt, and the test public key.
The newer commit-rewrite worker change was verified only on the separate
local package above.

## Experimental AppImage launch

The already-built Ubuntu 22.04 candidate executable was bundled separately
through Tauri after provisioning the builder's `file` package. The resulting
86 MiB amd64 Type 2 AppImage
`34f4a96655bf27cfbf408d600a95f78b1c92ffe49866ffce339b85586228900a`
mapped a 1440 × 900 Git Khronos window in offline Ubuntu 22.04 using
extract-and-run and a disposable unprivileged profile. Evidence is under
`target/local-review/jammy-appimage.Eor485hB/`. This was a window startup
check only, not full runtime qualification. The bundler warned about missing
copyright files for some bundled libraries; review redistribution and
notices before distribution.

A read-only audit of the extracted archive matched all 174 ELF files under
`usr/lib` to the Jammy build packages by ELF build ID. There were 161 files
with the owning package's copyright notice present and 13 from 10 packages
whose notices were present on the builder but missing from the archive.
`payload-notice-audit.tsv` in the evidence directory records the file paths,
build IDs, package versions, and notice results. This is scoped to that
payload directory; it neither covers every non-ELF asset nor clears the
AppImage for distribution.

The rebuilt AppImage
`77ece1e770e9ad910ad5868c629fd6b323fb3a7da2d47284bef17fdc9945689b`
includes the ten missing Ubuntu notices and all four project notice files
through `packaging/linux/appimage-notices.conf.json`. It mapped a
1440 × 900 Git Khronos window in the same offline Ubuntu 22.04 environment.
The extracted archive had 176 regular ELF files: all 174 library and
helper files from the original audit retained their build IDs and now had
byte-matched Ubuntu copyright notices. The other two, `AppRun.wrapped`
and `usr/bin/git-khronos`, are listed separately in
`notices-elf-inventory.tsv`; the AppImage runtime itself is outside the
embedded filesystem. See `notices-verified.tsv` and
`notices-appimage-window.log` in the evidence directory. This closes the
known library notice gaps, not the review of redistribution obligations
for the runtime, launcher, and non-ELF assets.

The packaged `AppRun.wrapped` is byte-identical to the cached Tauri
`AppRun-x86_64` downloaded from the `apprun-old` release, as recorded in
`retry-build.log`. The outer runtime came from the AppImage Type 2
`continuous` download, as recorded in `notices-build.log`, and its ELF
contains a reference to upstream revision `fedfad5`. The file hashes and
ELF build IDs are in `launcher-provenance.txt`. These observations identify
the bytes in this build, but they do not verify upstream signatures or pin
either download. Keep AppImage distribution experimental until the launcher
and runtime sources, redistribution requirements, and pinned build inputs
are verified.

A later read-only audit matched the embedded runtime to the
[upstream continuous asset](https://github.com/AppImage/type2-runtime/releases/tag/continuous)
for commit `fedfad51acc2860b2916a1eef32ba4a500ff31ef`. The downloaded
asset matched GitHub's reported SHA-256; all 16 bytes that differed from
the embedded runtime were inside the ELF `.digest_md5` section.
The [Tauri mirror](https://github.com/tauri-apps/binary-releases/releases/tag/apprun-old)
also reports the exact SHA-256 of the embedded `AppRun.wrapped`. Both
release records are mutable. The Tauri release names the upstream
project but does not identify the launcher's source revision.
These comparisons establish byte provenance for this test artifact, not
pinned downloads, upstream signature verification, or redistribution clearance.

The detached signature of the downloaded Type 2 runtime was subsequently
verified against the [public key committed at that same upstream revision](https://github.com/AppImage/type2-runtime/blob/fedfad51acc2860b2916a1eef32ba4a500ff31ef/signing-pubkey.asc),
using a fresh local GPG keyring. The signer fingerprint was
`570C77ACEA40C0F1B758902CBF96CCA56490F695`. This proves the original
runtime asset verifies against the project's published key, not an
independently certified identity or a signature on our AppImage. The
[upstream license file](https://github.com/AppImage/type2-runtime/blob/fedfad51acc2860b2916a1eef32ba4a500ff31ef/LICENSE)
lists the MIT-licensed runtime and its statically linked dependencies
separately, including libfuse under LGPL terms. Review those components'
distribution requirements separately from the runtime's MIT notice.
The Tauri launcher mirror and a pinned build remain open.
Evidence: `target/local-review/appimage-runtime-audit.PEdvsX6b/`.

Use `--suite commit-coauthors` to add a suggested and a manual co-author
through the installed composer. The scenario verifies that editing the
draft makes no Git changes, then reads both exact trailers from the single
new commit and verifies that the separate unstaged edit was not committed.

Use `--suite working-tree-recaps` to check staged and unstaged line totals
without running all setup workflows. It checks the displayed counts and
their accessible labels together, including singular counts and exclusions.
It covers staging, rename previews, and updates after an external edit with
unchanged porcelain status.
The suite also checks discard selection guidance when Unstaged Files is
collapsed or a filter hides all loaded unstaged files, without changing Git
state. The previous portable package timed out at the missing guidance;
the rebuilt local Debian package passed all 22 recap scenarios and five
discard-subset scenarios after offline installation on Ubuntu 26.04. See
`target/local-review/discard-selection-guidance.lQp8xh/` for the exact
package checksum and both runs.

The portable test-key package
`eb958f51abb7aa5f7c64f8f0e9f56b71b0c151fd9a44b7d15b05aced82325037`
also passed the discard guidance check on Ubuntu 24.04 and satisfied all
49 installed matrix checks across five distributions. A Debian 12 GitLab
rerun passed all 45 scenarios. The original unclassified connection
failure had no accepted TCP connection or HTTP request, and an independent
TLS probe succeeded immediately afterward. Three socket-traced follow-up
trials passed and did not reproduce it. See the all-attempts and strict
publisher reports under `target/local-review/jammy-discard-guidance.4t239p/`.
This package predates the Updates dialog keyboard fix.

## Focused offline update consent check

The separate `application-updates` suite checks keyboard recovery in the
Updates dialog without contacting an update feed. The rebuilt local package
`9ec4da38b0c1103ce691e9da7c0abe8f45f51a81a3a4fd19a0149ccac9733aee`
passed all 22 installed scenarios in offline Ubuntu 26.04. WebKitGTK reported
Shift+Tab with `key: Unidentified` and `code: Tab`; focus reached the last
enabled action without changing Git state. The preceding local build let
focus leave the dialog on that same input. See
`target/local-review/updater-webkit-tab.U6Z3WN/` for the passing report.

The portable candidate
`162c7a8ff663788c91ff0c14816768fc0558aedfcfd967eb8a71e4a208ca6768`
passed all 49 installed release checks on the first attempt, with no
rejected reports. The 318 Ubuntu 22.04 environment scenarios include the
keyboard fix and discard guidance. The same candidate passed 24 focused
Updates and offline consent scenarios on Ubuntu 22.04. See
`target/local-review/jammy-updater-webkit.3dqDw0/test-publisher-verified.json`
and `jammy-focused-updates.1JLhSe/verified.json` under that directory.
This qualifies the exact disposable test-key build, not a production-signed
upgrade.

A follow-up local package
`4d89383816ffa2acbd523cd3b9477270f7a4ad51993bce55817b7e2e8a31f1ce`
extended the WebKitGTK Shift+Tab fix to the shortcut reference and shared
confirmations. Offline Ubuntu 26.04 passed 76 setup-keyboard and six
discard-subset scenarios. The tests preserved the repository and commit
draft, and moving focus to a discard action did not apply it or create a
capture. See `target/local-review/shared-webkit-tab.FUQlW5/verified.json`.
This follow-up is not part of the portable candidate above.

The subsequent portable package
`ef5a72e1db985a29edd22a3d2dcd450676ae75ffaabd6aa6921d08908054c026`
passed all 49 installed release checks on the first attempt across five
distributions, including 320 Ubuntu 22.04 environment scenarios. The
occupied-branch review, discard confirmation, and shortcut reference each
verified the Shift+Tab behavior. The same archive passed the focused
installed worktrees and 20-scenario performance suites on Ubuntu 26.04.
With 100,000 commits, 64 branches and 36 linked worktrees, the graph
opened in 1.96 seconds and working-tree totals in 2.33 seconds while
other qualification lanes were running. See
`target/local-review/jammy-shared-webkit.A2fc6Y/` for the strict test-key
publisher report and focused evidence. There were no GitLab retries or
rejected reports.

For the same portable archive, independent X11 window checks in disposable
Ubuntu 24.04 and 26.04 containers rendered the installed desktop entry
via `gio launch` and the installed executable directly. APT removal
removed both the launcher and executable in each container. See
`desktop-entry-launch.UrGSOC/` in the same evidence directory. These checks
do not exercise WSLg or Windows pinned shortcuts.
The equivalent launch and removal checks also passed on Ubuntu 22.04 and
Debian 12 and 13; see `desktop-launch-baselines.GSNT7B/`. Those containers
needed an explicitly managed Xvfb rather than assuming `xauth` was installed.

A separate offline Ubuntu 24.04 run replaced the preceding portable
0.1.6 package with this build using APT. Both archives have the same
version but different executable bytes. The installed executable and
desktop entry matched the replacement, its launcher rendered a window,
and an owned repository kept its staged index, HEAD and working file
byte-for-byte. See `apt-replacement.DDtSzY/run.log`. This is a same-version
APT replacement, not a cross-version or signed in-app upgrade.

After adding the real stale-element probe to the release gate, all five
installed GitLab lanes passed 46 scenarios each against the same archive.
The strict verifier combined those new reports with the retained passing
reports for the other 44 checks. All 49 checks passed with no failures or
rejections. See `stale-gate-requalification.HR5ut1/verified.json` inside
the same evidence directory.

In a disposable Linux container with only the loopback interface (for
example Docker `--network none`), run a test-publisher installer with
`--suite application-update-consent --installed --headless`. This is separate
from the release publisher-trust preflight. The actual Updates dialog must
attempt a manual check while automatic updates are off, restore opt-in
across a real application restart and then schedule an offline check, and
restore opt-out across a second restart, leaving the scheduler idle past
its first startup tick without removing manual checks.
There is no installable offer, no installer is invoked, and the owned
Git checkout is unchanged.

The local Jammy build with a disposable test publisher key (SHA-256
`b0d13fa9b646ed445fb688a8b79c349e92f66b41ede4ea10f73a4490b7f97a5f`)
passed the ABI gate and this three-scenario installed consent suite
(`target/local-review/jammy-test-publisher.7UueOv/evidence/application-update-consent-1795478483451823651/`).
The temporary private key was removed before the build; only its public
key was embedded. This package is not intended for distribution or
production updater qualification.
The later fixture-public-key Jammy archive
(`5c978e6f5014e9512d98456e9a3308dad2c6bbb4c1c3c48f9095d9781b336c2d`)
also passed all three installed offline consent checks. See
`target/local-review/jammy-fixture-trust-current.avXgjjEA/offline-consent/run.log`.
No production key or installable offer was used.
The same archive satisfied every installed release-matrix lane (42 of 42).
The installed Jammy inherited-environment run passed 316 scenarios, and
the strict verifier matched its raw report, the exact archive, and the
fixture public key to the build receipt. See
`target/local-review/jammy-fixture-trust-current.avXgjjEA/test-publisher-verified.json`.
This qualifies the fixture build only, not a production publisher,
production release manifest, or installer download.
The installed Jammy performance suite also passed on those exact bytes:
the dirty 20,000- and 100,000-commit fixtures opened in 463 ms and 443 ms,
with working-tree recaps ready in 1.31 s and 1.29 s respectively. In each
fixture the graph rendered at most 57 rows. These are local fixture
measurements, not a performance promise. See
`target/local-review/jammy-fixture-trust-current.avXgjjEA/installed-performance/run.log`.
The same installed package also passed all 304 inherited-Git environment
scenarios (`environment-1795478498532508715`), including the default-off
publisher-trust check. The strict evidence preflight matched the package,
its build receipt, the installed report, and the disposable public key.
These receipts cannot be combined with the unsigned package's matrix
because the packages have different checksums.

## Focused wrapped diff rendering check

Run `--suite diff-rendering` with a reviewed installer to check a real Git
working-tree diff in the installed WebView. The fixture keeps a long
unchanged context line between edits. Split, hunk and inline views must
preserve its exact text, number syntax and changed-word highlights while
using only three spans per copy of the context line. The scenario checks
that opening and switching the views leaves HEAD, refs, index, config and
working bytes unchanged.

## Focused setup keyboard check

Use the existing runner with a reviewed package to check that setup inputs do
not dispatch ambient commit/stage or palette shortcuts:

```sh
pnpm nx exec -p desktop --excludeTaskDependencies -- python3 "$PWD/tools/native_acceptance.py" \
  --suite setup-keyboard --headless --package "$PWD/target/release/bundle/deb/Git-Khronos_0.1.6_amd64.deb"
```

This includes the ordinary smoke journeys plus worktree, submodule and remote
setup checks and a branch-deletion confirmation. A disposable repository has both staged and untracked contents
and a background commit draft. A local refusing hook records any attempted
commit; no personal repository or hook is used. Each keyboard chord is sent
once through WebDriver actions. Read-only rendering/readiness observations
precede independent disk/index/config/ref comparisons; shortcuts are never
replayed after an uncertain reply. The full/environment suites include these
checks too. Renderer coverage separately exercises editing, Tab, Escape,
replacement DOM and the pre-render focus gap.

The worktree check also narrows the actual window while the Branch name field
has focus. Escape must return focus to the visible references launcher, not
the now-hidden opener. The window returns to its usual size for the remaining
checks. The resize and dismissal must not change the checkout or commit draft.

The same suite opens the workspace editor on demand, checks input and Cancel
focus, creates and renames an empty workspace, and cancels then confirms
deleting that layout. The original checkout's staged and untracked data,
refs, index and config remain unchanged. Renderer tests separately hold or
fail the lazy module to prove an unrendered editor cannot modify a layout.

Use `--suite workspace-restore` to run the saved-path regression independently
of smoke and the rest of setup. The fixture parks two owned checkouts outside their
saved paths, waits for restoration to fail, and switches away and back using
the workspace menu. It removes one membership and returns the other folder
before explicitly retrying. A fresh WebView load must restore only the
remaining checkout paths; independent Git reads check that each checkout's
refs, index, config, and working files remain unchanged. Setup, full and
environment suites also run this scenario.

The suite then explicitly confirms deletion of the owned test branch. It checks
the remaining branch refs, HEAD, staged/untracked contents, index/config bytes,
commit draft and native recovery receipt. This proves valid reviewed commands
still work; keyboard isolation must not be implemented by refusing all commands.

The branch menu's off-screen Delete action and Recovery History's discarded
changes opener use the existing single-delivery scrolling helper. It waits for
ordinary rendering turns, scrolls normally and verifies the enabled painted hit
target before one native click; it never injects activation or replays a mutation.

The discarded-changes opener opts into a read-only readiness poll that captures
the exact enabled, laid-out, visible, non-inert text match in that same poll.
It replaces a separate DOM-presence wait and second lookup, without extending
the default deadline. Ambiguous matches still fail before clicking; a lost
scroll or click response is not replayed. Runner unit tests cover readiness,
ambiguity, permanent absence and single delivery after an uncertain reply.

## Focused workspace batch stop and Pull checkout

Use `--suite workspace-batch` to exercise **Stop after current repository**
in the installed UI with two owned checkouts and a local Git remote. The
fixture pauses only the first app fetch. Stopping must leave that fetch
running and prevent the second fetch from starting. The first then settles
normally, and a new explicit action proves the skipped checkout can still
fetch. The app-only Git wrapper records dispatch order; independent Git
reads check remote-tracking refs and preservation of HEAD, local refs,
index, config and working files. A second journey holds the first Pull,
switches the queued checkout to another branch at the same commit, and
checks that Pull refuses it before fetching. An explicit retry then
advances only the newly selected local branch. The suite also sets
**Fast-forward only** in the UI, then checks that a batch updates the linear
checkout without merging a divergent checkout. No external transport is used.
The exact-artifact Ubuntu 24.04 CI job runs this suite on the installed package.

## Focused removal of unopened saved paths

Use `--suite workspace-saved-removal` to verify that Repository overview
can remove only the reviewed paths. The test opens one owned checkout and
parks three unavailable ones, then cancels and repeats a review for two of
them. After a fresh WebView load the third path and the open tab must still
belong to the current workspace, and the removed paths must still belong
to a separate layout. Independent Git reads fingerprint HEAD, refs, index,
config and working files before and after.
The exact-artifact Ubuntu 24.04 CI job also runs this suite.

## Focused relocation of unavailable saved paths

Use `--suite workspace-locate --headless` to select a moved checkout through
the app's native GTK folder picker. Use `--suite workspace-bulk-locate --headless`
to select the first folder, cancel the second picker, and check that the third
path is reported as skipped without showing its picker. After a fresh WebView
load, only the successful relocation
must replace its original saved slot; a separate layout and all checkout
footprints must be unchanged.

The test selects the sole visible folder in the fixture's private home.
Keyboard input is restricted to the exact titled window of the owned app on
the runner's private Xvfb display, using the English GTK3 shortcuts. A key sent
is not proof of a successful selection: the test waits for the exact moved path
to become active and verifies saved membership and Git data independently.
The exact-artifact Ubuntu 24.04 CI job runs both suites on the installed package.

Use `--suite workspace-locate-nearby --headless` to check the starting folder
when a checkout was renamed in its original parent. The keyboard selects the
sole row in the chooser's starting folder without navigating; only the exact
renamed checkout in the original saved slot is accepted as success.

Use `--suite workspace-reopen --headless` to exercise session-local tab
history in two saved layouts with a shared checkout. The other workspace
must not inherit the close action. Reopening in the original workspace
restores the exact former saved position, preserves an unavailable slot,
and does not touch Git data. The exact-artifact Ubuntu 24.04 CI job runs it.

## Focused selection from a blocked discard review

Use `--suite discard-subset --headless` to exercise the native preview and
recovery path with staged and unstaged content, a blocked nested symbolic
link, and unselected root and nested tracked files. Returning to the blocked review must clear the selection
and restore keyboard focus. The selected preview must name only the chosen
root file; confirming restores its staged contents and leaves the other paths
unchanged. Undo must restore the files and effective Git state, including staged
entries, flags, refs, and config. Discard and undo must both preserve staging.
The report retains raw index hashes and diagnostics when they differ; Git can
refresh cache metadata without changing staged entries or flags.

The same suite tests the direct **Select files for discard** entry point
against a real nested tracked edit. Cancel returns focus to **Discard
selected…** and keeps the selection. Confirm discards only the reviewed
path, leaves the adjacent symbolic link and unrelated root files intact,
and saves an exact recovery capture. Undo restores the original state.
The Ubuntu 26.04 local package
`c9ba02638822af2ed4fa8ad88651e53a2dfde519aeb14579ace6aed9b38d119b`
passed all five scenarios both from extracted package bytes and after
installation in an offline, disposable Ubuntu 26.04 container. Evidence is
under `target/local-review/discard-scope-local.Ef5Do5/`; the previous
package reproduced the focus failure in the same test. The release evidence
checker now requires the direct-selection scenario on Ubuntu 24.04 as part
of the portable installed matrix. The Ubuntu 26.04 run is not a substitute
for that matrix check.

The suite also checks both bulk and single-file discard and Undo on a tracked
path with spaces and non-ASCII text. Use `--suite discard-deletion --headless`
to exercise the single-file action on a deleted nested lockfile with an intact
parent directory. Confirm must restore the index version, Undo must reinstate
the deletion, and Redo must restore the file again, without changing staging
or HEAD.
After bulk discard leaves only staged changes, the trash control is disabled
and keyboard focus returns to **Unstaged Files**. The renderer also checks
that completion does not take focus back after the user moves elsewhere.

Use `--suite discard-stale-review --headless` to check the single-file
confirmation against an external edit made after preview. The newer edit
must survive, staging and HEAD must remain unchanged, and the stale
attempt must not save a recovery capture. The installed Ubuntu 24.04 release gate also
requires a subsequent fresh review to succeed and Undo to restore the newer
edit. The suite also opens an unsupported nested symbolic link's discard
action by keyboard. The app must return focus to the file, keep the
refusal visible, and not change the checkout or save a capture.

The extracted package with prepared single-file reviews passed both
stale-review scenarios (`discard-stale-review-1795447846986203281`), all four
subset scenarios (`discard-subset-1795447328250276073`), deletion and Redo
(`discard-deletion-1795447342773632872`), and all 18 smoke scenarios
(`smoke-1795447349865517618`). All four reports use package SHA-256
`29ced81f11cc9fd7dbc12b5f59da684019e0fa68d99eaa7100ed786723e26a9c`.
The same extracted artifact also passed all 25 GitLab fork UI scenarios
(`gitlab-fork-ui-1795447413820771654`).
The two `file-review-scope` scenarios also passed: an external checkout to
the same commit blocked the old review, and a fresh review affected only
the newly selected edit (`file-review-scope-1795447543758088136`).
The artifact passed all 303 scenarios in the full extracted-package suite
(`full-1795447384269485830`). This is not evidence for a system installation
or the hosted release matrix.

The later CTI discard candidate (SHA-256
`0c4ce6e54f1f466e2cedb1179cee22f1c48e2d7d96ef7a70451a427c51e59de0`)
passed the native trash-button check: a nested untracked file was discarded
and restored through Undo without changing the index or HEAD
(`discard-deletion-1795463977822584808`). The same artifact passed
`discard-subset`, `discard-stale-review`, and `smoke` for 27 scenarios
across the four suites, and all 303 scenarios in the full extracted-package
suite (`full-1795464015281898663`). `task install:linux:dry-run` offered to reinstall
only Git Khronos. The separate core test
`discard_large_nested_untracked_batch_and_recover_exact_bytes` verified
discard and byte-for-byte recovery on the four CTI file sizes using
disposable files, not the user's checkout. The Linux source-check workflow
runs that test separately with one test thread because of its larger
memory and disk footprint.
After the package was installed locally, the harness verified the installed
executable and desktop entry against the same installer, then passed both
`discard-deletion` scenarios and all three `discard-stale-review` scenarios
using a private profile and disposable repositories
(`discard-deletion-1795464285217644911` and
`discard-stale-review-1795464292344902396`). This did not test a pinned
shortcut or touch the CTI checkout.
The same installed executable passed all 25 GitLab fork UI scenarios against
the local HTTPS fixture (`gitlab-fork-ui-1795464328757616970`); no hosted
workflow was rerun.
An installed rerun also verified that, after discarding the untracked file,
the trash button was disabled and the staged lockfile still appeared in
**Staged Files** (`discard-deletion-1795464906964818050`).

The later memory-bounded serializer build (SHA-256
`aab390222d460db2e8ad0bd8b12b97475d6e55bd0504495ca85b46b50a8a668c`)
passed 27 extracted-package scenarios across
`discard-deletion-1795465178696734516`, `discard-subset-1795465188698207340`,
`discard-stale-review-1795465201163717588`, and `smoke-1795465209497683565`.
The renderer accessibility and confirmation-keyboard suites also passed
all 85 cases locally. None of these checks installed this package.
The same optimized artifact passed all 303 scenarios in the full extracted
suite (`full-1795465253058034448`, 379.1 seconds locally). Phase timing
identified hosted/workspace reviews, file tools, and history/stashes as the
three longest groups in that run.
For a larger scenario, run `--suite discard-large --headless`. It creates
68,584,155 bytes at the four CTI file sizes in a disposable checkout, uses
the trash button, and verifies every SHA-256 after Undo plus unchanged
staging and HEAD. The same extracted artifact passed
(`discard-large-1795465284799313567`); the scenario phase took 17.3 seconds
on this host, including fixture setup and verification. The installed Ubuntu
24.04 lane requires this scenario from the exact release package.
It also requires the same capture to remain discoverable and recoverable
after a real application restart. That round trip passed on the optimized
package (`discard-large-1795465505997031168`).
The installed CTI fix without the serializer optimization also passed
the scenario on this host (`discard-large-1795465345238569898`, package
`0c4ce6e54f1f466e2cedb1179cee22f1c48e2d7d96ef7a70451a427c51e59de0`).

Use `--suite discard-limit --headless` to verify that both a single nested
untracked file just above 64 MiB and a bulk selection containing only
oversized files report the per-file limit. Neither opens a confirmation
or changes the repository or capture store. The installed Ubuntu 24.04
lane requires both scenarios from the release package. The test uses
sparse disposable files and a separately staged edit.

For a mixed request containing otherwise eligible changes, the review
labels each known oversized path and leaves confirmation disabled. The
previous local package did not show those labels. Its replacement,
`8ac462f068de8c18caf78a9b82e7622840fdcb6d080bcd96ab1f71ffda68cbab`,
passed the extracted-package test and all four `discard-limit` scenarios
after installation in a disposable Ubuntu 26.04 container. It also passed
the 21 working-tree recap and 21 unconfigured updater scenarios there.
See `target/local-review/oversized-discard-local.ZD83AT/`. This local
package is not publisher-configured or qualified across the portable
release matrix. The Ubuntu 24.04 installed release gate now requires the
mixed-request scenario in addition to the size-specific refusals.
The portable Ubuntu 22.04-built test-key package
`fe1936f835d964d0b536c2635f1e8199e2369ff0b2443712007042d4bd6d6aad`
passed that exact four-scenario requirement after offline installation on
Ubuntu 24.04; see the focused installed receipt in
`target/local-review/jammy-oversized-discard.A9HBeW/noble-focused-discard/owned/run/`.
The same archive also passed all three installed offline consent checks on
Ubuntu 22.04. The build includes the renderer's rejected-status retry
backoff, but the offline scenario tests manual dispatch and persisted
consent, not transport rejection of status reads. The frozen source and
`snapshot-delta.tsv` show that the newer native commit-rewrite changes
were not part of this archive.

The local package with SHA-256
`f3b3e64986719905e0a426a5be7ee6767cc8dba7e07739e151066c3c9e561ce9`
passed 25 extracted-package scenarios before the bulk limit check was added, across
`discard-limit-1795468324506668628`, `discard-large-1795468333599054722`,
`discard-deletion-1795468366319035074`, `file-menu-copy-1795468377025272393`,
and `smoke-1795468386105488791`. The installation dry run planned to
upgrade only `git-khronos`; it did not install the package.
The same extracted package also passed the 25-scenario GitLab fork UI
suite (`gitlab-fork-ui-1795468517175157824`) and the 45-scenario GitLab
suite with loopback SSH (`gitlab-1795468539013648712`). The latter used a
privately extracted OpenSSH server and its required libraries.
Two later regression checks intentionally failed against that older
artifact: bulk oversized discard returned the generic nested-path
refusal (`discard-limit-1795469566014293064`), and Ctrl+Z in the file
filter triggered repository Undo (`discard-deletion-1795469510502202395`).
The newer source fixes both; qualification requires passing results
against a rebuilt package.

The rebuilt local Debian package (SHA-256
`ebc8d411c0c47fbbba2e4b376ad70184f367f3363b4402ffe53f81e3267369d6`)
passed both size-limit checks (`discard-limit-1795471667565125435`),
both CTI-sized recovery checks (`discard-large-1795471678184736059`),
all three deletion and keyboard checks
(`discard-deletion-1795471801212335714`), and 18 smoke cases
(`smoke-1795471814268437036`). The keyboard check uses a real
Ctrl+Z event and confirms the app does not consume it or mutate Git; the
Chromium test separately verifies the actual text Undo and Redo behavior.
This is extracted-package evidence on Ubuntu 26.04/WSL2, not the
system-installed Ubuntu 24.04 release lane. The install dry run planned
to update only `git-khronos`.
The same rebuilt package also passed 25 GitLab fork UI cases
(`gitlab-fork-ui-1795471870447396710`) and 45 GitLab cases
with loopback SSH (`gitlab-1795471935569381305`).
All 303 scenarios in the full extracted-package suite also passed
(`full-1795472032151361835`).
The same exact local package was installed in a disposable, network-isolated
Ubuntu 24.04 container and passed seven installed checks across
`discard-limit`, `discard-deletion`, and `discard-large`
(`test-results/native-noble-local.N21Mlk/`). APT's dependency check passed,
and the harness verified the installed executable and desktop entry against
the package before launch. This qualifies those local compatibility
scenarios only: this package declares glibc 2.39, so it is not the Jammy
release artifact required for the GitHub Actions matrix.

A separate unsigned local candidate built in Ubuntu 22.04
(`target/local-review/jammy-discard-candidate.fP5Brj/`) passed the glibc
2.35 ABI gate. The unchanged package SHA-256
`f7bf6a773f4901f9ae01818a94cbf037e86eebf0b7b3a5a5232b795d71b580bb`
passed 70 installed checks each in disposable Ubuntu 22.04 and 24.04
containers. The `installed-jammy/` and `installed-noble/` directories
retain the exact-package receipts for `smoke`, `discard-limit`,
`discard-deletion`, `discard-large`, and `gitlab`. This is partial
local release evidence, not a signed updater build or a completed
GitHub Actions release matrix.
On Ubuntu 24.04, another 89 scenarios passed across 24 review suites.
The original tracked-file-search suite failed at a WebDriver click on an
unscrolled File History action; after changing the harness to scroll and
wait for the real hit target, all five cases passed on the same installed
package. The original and focused rerun reports remain in
`installed-noble-reviews/` and `installed-noble-tracked-retest/`.
The unchanged Jammy-built package also passed 63 installed cases on
Ubuntu 26.04, 69 on Debian 12, and 63 on Debian 13. Each platform ran
GitLab with loopback SSH; Ubuntu 26.04 and Debian 13 also ran smoke,
while Debian 12 ran the incoming-link suite. See `installed-ubuntu26/`,
`installed-debian12/`, and `installed-debian13/`.
Debian 12 also passed the required incoming-link variant with deliberately
inherited Git context (`installed-debian12-inherited/`); an ordinary
incoming-link run does not satisfy that requirement. Jammy passed 58
additional watcher and Git LFS tests with the pinned Git LFS 3.7.1 binary
(`installed-jammy-extended/`).
The first full Jammy environment run stopped after 274 cases at a worktree
repair dialog. The focused setup suite passed all 63 cases, and a separate
full rerun of the same installed package passed all 305 cases with
inherited Git context (`installed-jammy-environment-retest/`). The captured
`local-release-progress.json` still accepts only 41 of 42 release checks:
the successful unsigned run lacks the required publisher-trusted startup
scenario. No signing or release publication was performed.

## Copying a path from a file menu

Use `--suite file-menu-copy --headless` to exercise the actual clipboard
write from working-tree and commit menus. The fixture uses spaces, brackets,
and accented characters and checks that copying leaves HEAD, the index,
and the working files unchanged. Renderer tests check the exact clipboard
argument, keyboard focus, clipboard refusal, and out-of-order feedback.
The extracted Debian build at SHA-256
`5e2e65a808668dd9ed4e4b7c7f75463d742a7d00cc49770f603adf170c90530d`
passed both file-menu clipboard scenarios
(`file-menu-copy-1795466241819729205`), both large-discard scenarios
(`discard-large-1795466248211180086`), and all 18 smoke scenarios
(`smoke-1795466269745656101`). Ubuntu 24.04 installed acceptance requires
both clipboard scenarios for the exact release package.

The broad run on this artifact exposed a timing failure: it queried
**Branch workflows** before the deferred workspace menu made that control
visible (`full-1795466327922033574`). The harness now waits for a visible,
enabled hit target and sends one click. The focused suites passed on the
same package (`branch-workflow-ui-1795466565210836978` and
`branch-workflow-recovery-1795466585928724293`); these do not replace the
original failed broad result. A new full run on the unchanged artifact
passed all 303 scenarios (`full-1795466627874107572`).

The subsequent discard completion-focus build, SHA-256
`a4ed4091c042debe5abcb0a05229fca981bfe53bec464802a388a1a060426233`,
passed 25 focused scenarios in `discard-deletion-1795467030431781591`,
`discard-stale-review-1795467041141688375`, `file-menu-copy-1795467050868963175`,
and `smoke-1795467061919563665`. The deletion suite checks that focus returns
to the Unstaged Files heading when the trash button becomes disabled.
The same package passed all 303 scenarios in the full extracted run
(`full-1795467124615800292`, 349.3 seconds). The harness also uses the
readiness-aware single click for **Repository overview** and **Reviews and
checks**, which are deferred in the same workspace menu.

## Focused initialization of one submodule

Use `--suite submodule-initialize --headless` with an owned local Git fixture.
Opening an uninitialized checkout must focus Cancel in the selected path's
review without initializing anything. Dismissing the review preserves the
parent and returns focus to the row. Confirming explicitly must initialize
only the selected path and its nested checkout, leaving a second top-level
submodule uninitialized. Git independently checks the recorded commits,
parent staging and refs, and the expected scope of local config changes.
The exact-artifact Ubuntu 24.04 CI job runs this suite.

Use `--suite submodule-update --headless` to exercise the separate remote
update review with two local checkouts and an owned upstream. Opening or
cancelling must not fetch. The test introduces a tracked edit after review
and checks the remote-tracking ref is still unchanged after the native
refusal. Confirming a clean selected checkout must move only that checkout,
even when its sibling is dirty, without staging the parent gitlink.
The exact-artifact Ubuntu 24.04 CI job also runs this suite.

## Focused stash selection scope

Use `--suite stash-selection --headless` to check a selected staged-only stash
with three owned files. A mixed-eligibility native request must fail before
creating a stash or changing staged entries or files. The UI then selects all
eligible files, switches to staged-only, and confirms. Independent Git reads
check that only the staged file was saved and that the unstaged and untracked
neighbours stayed unchanged.
The exact-artifact Ubuntu 24.04 CI job also runs this suite.

## Focused patch export

Use `--suite patch-export --headless` to check the reviewed export paths
against two owned tracked files. The empty scope must not offer a save.
Restoring one selected file outside the app must leave that path visible
as unavailable and block export until it is explicitly removed. The
native command must also refuse the mixed selection without creating a
file. Once the selection is repaired, the test opens and cancels the real
GTK save picker, then verifies the native export independently with
`git apply --numstat`.
The exact-artifact Ubuntu 24.04 CI job also runs this suite.

## Focused tracked-file search

Use `--suite tracked-file-search --headless` to inspect an owned repository
in a real merge conflict. The index has three stages for one path and an
ordinary tracked neighbour. A two-path search must return both exactly
once without reporting truncation. The installed palette must show one
history and one blame action for each tracked path, exclude the untracked
file, and leave the merge, index entries, references and files unchanged.
The exact-artifact Ubuntu 24.04 CI job and local release checklist require
both scenarios.

## Focused diff line selection

Use `--suite diff-line-selection --headless --installed --package "$PACKAGE"`
in a disposable environment with the exact package already installed.
The packaged viewer must stage the intended later replacement without
staging text that resembles a patch header. It must also keep both sides
of a replacement selected when neither line has a trailing newline.
The suite checks exact index blob IDs and working bytes through native
unstage, discard, recovery, and refusal of a selection that would join
final lines. It also checks discard and recovery when Git omits the space
prefix on blank context lines. Full and inherited-environment acceptance
run the same checks.
The focused reproduction does not replace the release matrix.

## Focused commit rewrite review

Use `--suite commit-rewrite --headless --installed --package "$PACKAGE"`
in a disposable environment with the exact package already installed.
Both native edit commands must reject a review for another branch at the
same HEAD. A subsequent edit through the installed commit inspector must
rewrite only the checked-out branch, select the replacement commit, and
preserve the other branch, commit trees, index, config and working bytes.
Both scenarios are required by the Ubuntu 24.04 workflow and exact-package
release checklist.

## Focused file review scope

Use `--suite file-review-scope --headless --installed --package "$PACKAGE"`
with the exact package installed in a disposable environment. An external
switch to another branch at the same commit must disable an open discard
confirmation without touching files, the index or recovery captures. A new
review must still discard the intended edit and create one recovery capture.
Both scenarios are required by the Ubuntu 24.04 workflow and exact-package
release checklist.

## Focused hosted fork attachment

To isolate the hosted fork attachment journey from the long environment run,
use `--suite hosted-fork-remote`. It uses a local provider fixture, verifies
the separate review and confirmation, and checks that attachment did not
create a remote fork or alter the checkout.

## Focused feature rebase review

Use `--suite merge-rebase-review` to exercise the separate **Rebase
preserving merges** workflow from a local branch menu. The owned fixture
checks the native review against Git's exact source, destination, common
base, and both merge parents. Cancel must leave the checkout and all refs
unchanged. The suite also advances the destination externally to verify that
stale execution is refused before writing, then executes a fresh review and
checks both rebased parents, the untouched side refs, and the recovery tip.
The suite holds the real Git replay while checking that an unrelated native
status request still completes. The Ubuntu 24.04 installed-package release
check requires all five results, including dismissing a held preview.
The first three passed in an offline Ubuntu 24.04 container after APT installed
the existing portable test-key package
`5c978e6f5014e9512d98456e9a3308dad2c6bbb4c1c3c48f9095d9781b336c2d`;
`target/local-review/noble-merge-rebase.92oRAt3V/verified.json` binds the
focused result to those exact package bytes. This does not qualify a
production signing key or a newer package.
All four passed against the newer local Debian package
`ba4fd6793348f8b0a07eb07db406934a5927965ed1527dcd76b0fabcaca04bb1`
in extracted-package mode
(`test-results/native/merge-rebase-review-1795515659672489098/report.json`).
The held Git replay blocked the status request on the older package,
confirming that the new runtime check detects the freeze.
The same newer archive also passed the four rebase checks, 21 working-tree
recap checks, and three stale-discard checks after APT installed it in an
offline Ubuntu 24.04 container. Exact-archive focused verification:
`target/local-review/noble-background-rebase.6yopYQng/verified.json`.
The newer archive
`0a368f487e52ad89da22c4ed0cd5a30deb073cdff2dae7fbe13574f218d91462`
also passed all five extracted-package scenarios, including Escape during a
held native preview and the absence of any late review dialog or Git writes
(`test-results/native/merge-rebase-review-1795517018086063786/report.json`).
The exact same archive passed both installed comparison scenarios and all
five installed rebase scenarios in offline Ubuntu 24.04. See
`target/local-review/noble-rebase-dismissal.QLkEeyIC/verified.json`.

The later Ubuntu 22.04-built test-key candidate
`dafbf25852bc115d449ccadaf5d8b84df8e660d2810a6ada24cb742271988b5f`
passed all 44 required installed checks across the five Linux userspaces.
The Jammy environment retry passed 316 scenarios with the guarded fork
navigation; the Noble GitLab retry passed 45. Both original failed reports
remain in `target/local-review/jammy-current-reviews.JzKGNW9M/`.
Its `test-publisher-verified.json` binds the passing matrix to this package,
build receipt, and fixture key. The separate `offline-consent/` report
records three passing manual and automatic update consent scenarios, not
an actual signed upgrade.

Use `--suite feature-rebase` to verify that Branch workflows opens a
separate rebase review against the configured development branch. The
fixture uses a non-default development branch and enables Git's
`rebase.updateRefs` in the owned checkout. The review and Cancel must
leave Git state unchanged. Confirming must replay the checked-out feature
onto the expected commit without moving production, development or an
unrelated local branch pointing into the old replay range. A fresh Finish
review must refer to the rebased tip.
The exact-artifact Ubuntu 24.04 CI job also runs this suite.

## Renderer acceptance in GitHub Actions

The renderer suite uses Chromium with an isolated development server and mocked
IPC where applicable. It tests UI behavior, focus, and lifecycle decisions. It
does not replace the separate packaged WebKitGTK or installed Linux checks.
For a quick local check, pass a spec or Playwright filter through Task:

```sh
task test:e2e -- e2e/renderer/keyboard-shortcuts.spec.ts --workers=1
```

For a focused cross-browser check, install Playwright WebKit with
`pnpm exec playwright install webkit` if needed. Use a test environment
with the browser's required system libraries, then opt in explicitly:

```sh
GIT_KHRONOS_RENDERER_WEBKIT=1 pnpm nx run desktop:e2e -- \
  --project=webkit e2e/renderer/history-search.spec.ts -g 'blame jump'
```

This adds a local browser project; it does not change the default Chromium
shards or test the packaged app's system WebKitGTK and native bridge.

Desktop CI runs four Playwright shards on independent Ubuntu 24.04 runners.
Each uses one browser worker and no retries. Failure in one shard does not
cancel the other shards; each failed shard uploads any available report, traces,
and screenshots under `renderer-failure-<run>-attempt-<attempt>-shard-<shard>`.
The existing **Checks and renderer acceptance** status passes only after the
Linux production renderer build, TypeScript/Rust/harness checks, and all
renderer shards succeed. The production build runs before the Rust tests
and retains its initial-asset report when available, including a recorded
budget failure. Packaged
native and exact-installer acceptance continue in their separate jobs.

Reproduce one shard on a machine with the lockfile dependencies and Chromium
installed:

```sh
CI=true NX_DAEMON=false NX_ISOLATE_PLUGINS=false NODE_OPTIONS=--max-old-space-size=2048 \
  GIT_KHRONOS_RENDERER_OUTPUT_DIR=test-results/renderer/shard-2 \
  GIT_KHRONOS_RENDERER_REPORT_DIR=test-results/renderer-report/shard-2 \
  pnpm nx run desktop:e2e --output-style=static --skipNxCache -- \
    --shard=2/4 --workers=1 --retries=0
```

Use a different `PLAYWRIGHT_PORT` and output/report directory for each
simultaneous local run. The Playwright-managed server builds once without
file watching. By default, local runs also require a fresh server rather than
silently testing anything already listening on the selected port. Set
`PLAYWRIGHT_REUSE_SERVER=1` only when you intentionally want to reuse the
known application server at the selected port; `CI=true` always requires a
fresh server.
Use the Node version pinned in `.nvmrc` (`nvm use`) when reproducing CI.
One local run on Node 26.13.1 hit a V8 abort in the Angular server
(`Lazy deopt after a fast API call with return value is unsupported`).
If the server exits mid-run and subsequent tests report connection refused,
preserve the log and rerun with the pinned version in a separate results
directory. Those connection errors do not establish renderer regressions.

Local renderer checkpoint on Node 24.21.0: the full run in
`test-results/renderer-current.5cLzs7/` finished with 2,771 passes and one
failure. The failure expected regular nested files to be blocked by the
browser discard preview. The corrected test now distinguishes eligible
regular nested files from blocked type changes; the entire file-operation
spec passed (22 tests, `test-results/renderer-file-lifecycle.TZLlAH/`).
The 10 keyboard tests, including changes made after the full run started,
passed separately (`test-results/renderer-recovery-shortcuts.AxpOA4/`).
These runs do not convert the original full result into a pass.

The next full run (`target/validation-runs/renderer-final-1795472569259974852/`)
reported 2,768 passes, five failures and one timeout. It included the
corrected discard preview and keyboard cases. The deferred-menu harness
now drains outstanding routes before teardown; all 28 focused cases passed.
The graph resize fixture now tests flexible and narrow messages separately.
Both variants and the three other affected workspace tests passed three
focused repetitions; the hover case then passed five repetitions with a
controlled clock. The full run overlapped packaged WebKit and Rust work
and the host exhausted swap; prefer running broad suites separately on
this host. No clean full run of these later test changes is claimed.

Local Ubuntu 26.04/WSL2 checkpoint: Debian 0.1.6 amd64, SHA-256
`781eb9bd918dfbf04d5bcb63a1d14de9e5d3a4213675c4a97787917db443c9a2`,
passed package verification and these extracted-package suites:
`smoke` (18 scenarios), `file-history` (16), `gitlab-fork-ui` (25), and
`full` (303).
Their reports are under `test-results/native/` in
`smoke-1795430092845542225`, `file-history-1795430228515747593`, and
`gitlab-fork-ui-1795430417354700883`, and `full-1795430521066694405`,
respectively. The scenario totals overlap. On the same host, the installed
`/usr/bin/git-khronos` also passed all 18 smoke scenarios after the harness
verified the executable and desktop entry against the package
(`test-results/native/smoke-1795438509183321885/report.json`). The same
installed artifact passed all 10 working-tree recap scenarios
(`test-results/native/working-tree-recaps-1795438578236021055/report.json`).
Installed File History also passed all 17 scenarios, including WebKit's
successful clipboard write for a deleted path without a HEAD, index, or
working-file change
(`test-results/native/file-history-1795439218694712576/report.json`).
These focused runs do not qualify the full suite against the system installation, host-specific
pinned shortcuts, or a hosted CI run.

The subsequent extracted Debian build with nested-file discard and the
eligible-file chooser (SHA-256
`5c94ff3df500bc568be59cefaffc3d0876fb01f54e28510c8969a12b458870d2`)
passed all 25 GitLab fork UI scenarios again
(`test-results/native/gitlab-fork-ui-1795445561478311434/report.json`).
The harness reacquires catalogue navigation controls after a confirmed
WebDriver stale-element refusal; it does not replay fork submissions or
clicks with uncertain outcomes.
The same extracted artifact passed `detached-checkout` (28 scenarios) and
`worktree-reservation` (1 scenario), including guidance for a reserved
branch without changes to either checkout
(`detached-checkout-1795445652343155082` and
`worktree-reservation-1795445702084541374` under `test-results/native/`).

The extracted Debian build that adds discard of deleted nested files
(SHA-256
`4e447edcacd8bc254349fa98b78c8d9b2d80556b6436579e89b333674f3b9b3f`)
passed `discard-deletion` (1), `discard-subset` (4), `smoke` (18),
`application-updates` (20), `working-tree-recaps` (10), `file-history`
(17), and `full` (303). See `discard-deletion-1795445796825116566`,
`discard-subset-1795445805185205289`, `smoke-1795445821629681682`, and
`application-updates-1795445917332431919`,
`working-tree-recaps-1795445991232896285`, and
`file-history-1795446011624829028`, and `full-1795445878903713900` under
`test-results/native/`. Counts overlap across suites.
The updater check used the unconfigured-trust mode, not a publisher-signed
release. `task install:linux:dry-run` reused the verified build and offered
to upgrade only `git-khronos`; no installation was performed.

The newer extracted Debian build (SHA-256
`352cc46e302ecc9e59e047250a5ae34b990315ba56e57de9e08888673452356e`)
passed `full` (305), `working-tree-recaps` (11), `application-updates` (21),
and `discard-limit` (2). This covers collapsing Staged Files without changing
the checkout, opening Updates from the command palette without changing
consent, and the large-file discard limit. See
`working-tree-recaps-1795482771581334695`,
`application-updates-1795482782978589331`, and
`discard-limit-1795482804235290981`, plus `full-1795482839887114658` under
`test-results/native/`. The same archive passed the three focused suites
(34 scenarios per distribution) after APT installation in disposable,
network-isolated Ubuntu 24.04 and 26.04 containers. These reports verify
`/usr/bin/git-khronos` against the exact archive; see
`test-results/staged-layout-installed.0MnADn53/`. Both distributions also
passed all 45 installed GitLab scenarios, including the catalogue and
loopback SSH, against the same package
(`test-results/staged-layout-installed-gitlab.XqYe9ptg/`). This is not a
publisher-signed release, and it does not qualify a host's pinned shortcut.

A separate offline Ubuntu 22.04 build from the updated source passed the
glibc 2.35 ABI gate (archive SHA-256
`af6e014906d9bf0cac14ea589fc0a7082791485a9aa2a65cb1fc3062ae28663c`).
The exact unsigned archive passed the same four installed suites (79
scenarios per distribution) in isolated Ubuntu 22.04, 24.04, and 26.04,
and Debian 12 and 13 containers. See `target/local-review/jammy-current.JDhP32pK/`,
including the ABI result in `build.log` and installed reports for `jammy-retest`,
`noble`, `resolute`, `bookworm`, and `trixie`. These results do not qualify the different
glibc 2.39 archive or a future publisher-signed artifact.
The release evidence verifier accepted 41 of its then-required 42 checks for this archive
with no failed or rejected reports. The remaining Ubuntu 22.04 environment
check requires the native updater to recognize an embedded publisher key;
the passing unsigned environment report cannot establish that scenario.
The inherited-environment run completed all 307 scenarios applicable to the
unsigned build. The local verifier output is in `current-release-progress.json`
beside the build log; `--release-matrix` returned exit 1 because the required
publisher-trust scenario is absent.
In a separate isolated Ubuntu 24.04 check, `gio launch` opened the
APT-installed desktop entry from that same archive. X11 pixel sampling
confirmed that the window rendered despite a DRI3 warning, without any
WebKit compositing override. See `launcher-noble/default.log` alongside
the portable build. This does not reproduce WSLg or validate Windows pinning.

The later local Debian build with the bulk-discard palette entry (SHA-256
`dc2c5ca52d5bf759185754a54b5a2366d2403ad6b0185e18250a4aad4bfac798`)
passed all four extracted `discard-deletion` scenarios. This includes opening
the bulk review by keyboard while a filter hides an untracked file, then
cancelling and restoring focus without changing the checkout. See
`test-results/native/discard-deletion-1795485790604513728/`.
The same package passed 12 installed discard scenarios across
`discard-deletion`, `discard-subset`, `discard-limit`, and `discard-large` on
isolated Ubuntu 24.04 (`target/local-review/palette-discard-dc2c5ca5/noble-installed/`).
The complete renderer discard-recovery spec passed all 50 cases.
The subsequent keyboard-focus build (`56c16c8bbff1b98a3ee81063e374c7b0a6b3ce45b5219b192b80c896eacb6a8d`)
passed seven installed checks on isolated Ubuntu 24.04, including both the
successful palette preview/cancel and the oversized-file refusal paths. The
release gate now requires both palette scenarios. This local package has
a glibc 2.39 floor and does not qualify the portable release matrix.

The newer Ubuntu 22.04 portable archive
(`a9ee8e8be03eccb4bb9cedd8becd2dad34d5b7817bb823682fe115ce12b4927a`)
passed the glibc 2.35 gate and 41 of 42 exact-package installed checks across
the five-distribution matrix, including both new keyboard scenarios. Its
Ubuntu 22.04 environment run passed all 307 scenarios applicable to the
unsigned build. The verifier recorded no failed or rejected reports and
identified only the absent publisher-trust scenario. See
`target/local-review/jammy-palette.otam6d9M/current-release-progress.json`
and the raw reports in its `installed/` directory.

The later local archive with the bulk-index pagination fix
(`b014a2b29c4e96aa7e06015a87a1b53d6e77e29d9a2e3027cd8bf804275a64cd`)
passed all 13 extracted `working-tree-recaps` scenarios. The new checks
verify both bulk actions against real changes beyond the initial 1,000
status rows while preserving working files, HEAD, and refs. See
`test-results/native/working-tree-recaps-1795488757138501575/`.
The same archive passed 20 installed working-tree and discard scenarios on
isolated Ubuntu 24.04 (`target/local-review/paged-index-b014a2b2/noble-installed/`).
Its full extracted-package run also passed all 307 scenarios
(`test-results/native/full-1795488998318369806/report.json`).
The combined renderer run for discard recovery, conflict safety, and
application updates passed all 83 cases.

The subsequent full renderer run for the checkout-bound palette actions
passed all 2,783 cases (Node 24.21.0, two workers;
`target/validation-runs/renderer-whole-tree-1795489775417433376/result.json`).
This is renderer evidence, not an installed-package result. It used the
original graph test setup; the optimized setup has a separate run.
The Debian archive with the checkout guard
(`22087b40843289e768c2091eb370682d7f7144859ac96146e1ea9ecbc8defc73`)
passed the extracted `working-tree-recaps` (13), `discard-deletion` (4),
and `discard-limit` (3) runs. See
`working-tree-recaps-1795493036887238169`,
`discard-deletion-1795493049173102525`, and
`discard-limit-1795493058461436040` under `test-results/native/`.

The portable build of the same application changes with the **test publisher
public key** embedded
(`ef1f8d525c0e68fd80571f5d923e8b4a5c4bd7376408bbc5a03eebaa001067ff`)
passed all 42 installed matrix checks. The full Ubuntu 22.04 environment
run passed all 308 scenarios, including configured trust with automatic
updates off and no installable offer. The strict verifier matched the ABI,
exact archive, build receipt, installed reports, and test key. See
`target/local-review/jammy-guard-trust.FA0UrGiW/test-publisher-verified.json`.
This qualifies the test-key artifact only; it was not signed or published.
The same installed archive passed three separate offline consent scenarios:
manual checking without automatic consent, opt-in surviving a process
restart and scheduling a check, and opt-out surviving a restart while
manual checks remain available. See `consent-installed/` beside that report.

The later local pagination-focus package
(`3c01952966652fb1254de6f7f4946ba6c8217c358e08440613efb81edfc41eec`)
passed all 14 extracted working-tree scenarios, including keyboard focus
return after loading the final page and no change to the fixture checkout.
See `test-results/native/working-tree-recaps-1795495972172898851/report.json`.
It predates the separate guard for a late pagination result after switching tabs.
The later archive with that guard
(`41d840918358c29dfe39ed1ee9cfafaa158b8504b21f4d7998b5936054da5579`)
passed 43 installed checks in isolated Ubuntu 24.04: 28 detached-checkout,
one worktree-reservation, and 14 working-tree pagination and recap checks.
See `target/local-review/pagination-checkout-41d84091/noble-installed/`.

The later build with one status-page request per checkout
(`8cc4ff5bf359d216e7555c6fe56e3e111ad8c49e07cf7fcf1ec9aff3cb74f398`)
passed 35 installed checks on isolated Ubuntu 24.04, covering working-tree
recaps and keyboard paging, coherent checkout snapshots, and LFS count
and lock workflows. See
`target/local-review/independent-pagination-8cc4ff5b/noble-installed/`.
The 22-case renderer status-pagination and working-tree lifecycle run
separately exercised overlapping requests in distinct tabs.

The first-status diagnostics regression reproduced a stall with
`8cc4ff5b…`: the fixture began writing 2 MiB to Git's diagnostic pipe but
did not reach the status gate
(`test-results/native/first-status-1795497967766862376/report.json`).
The fixed archive
(`e0e5def4496cb35e07071cee991258ddb8a9878caf2bf2011071afa0357af092`)
passed 18 extracted checks across first status, working-tree recaps, and
checkout snapshots. The exact-packaged first-status report is
`test-results/native/first-status-1795498374880559597/report.json`.
It also passed those 18 checks after APT installation in isolated
Ubuntu 24.04 (`target/local-review/bounded-status-e0e5def4/noble-installed/`).
In a separate network-isolated Ubuntu 24.04 container, the installed-status
checker ran as an ordinary user against that same APT-installed archive.
It produced no advisory for the normal command path, warned about both a
shadowing executable and an older per-user desktop entry, and did not
execute the shadowing file. A symlink to the packaged executable cleared
only the command-path warning. This does not qualify Windows shortcut
resolution or a separate desktop session's environment.
The subsequent local package (SHA-256
`54d55c986e06ef3a578e349cd59e3d2a042ea4d114f3555f1445e303fb090a8c`)
passed all 14 working-tree recap checks both extracted and APT-installed
in isolated Ubuntu 24.04. The staged disclosure test now checks Enter and
Space, retained focus, valid control targets when expanded, and an unchanged
checkout. See `working-tree-recaps-1795501141919357805` under
`test-results/native/` and
`target/local-review/disclosure-54d55c98/noble-installed/run-with-driver.log`.
That package also passed all 308 full extracted scenarios
(`test-results/native/full-1795501167529451434/report.json`). The release
matrix now requires the whole-checkout stash untracked-inclusion scenario
in the focused installed `stash-selection` report.
The next local package (SHA-256
`c420a5ee268e8ed2333cdb680fab53b2ce981bb5957de3f5cec9ef392a25225a`)
contains the count-only preflight for whole-checkout stash. It passed
`stash-selection` (5 scenarios) and `working-tree-recaps` (14 scenarios) after
APT installation in isolated Ubuntu 24.04. See
`target/local-review/stash-c420a5ee/noble-installed/run.log`.
The subsequent stash pagination package (`dc5a8838…`) passed all six
`stash-selection` scenarios both extracted and APT-installed in isolated
Ubuntu 24.04. The release gate now also requires the pagination scenario:
the test selects across two real status pages, verifies loading changes
nothing, and reads the stash tree to confirm it contains only the two
selected paths. See `test-results/native/stash-selection-1795502391636243986/`
and `target/local-review/stash-pagination/noble-installed/run.log`.
The same package passed the full extracted run (308 scenarios, 336.6 s).
The slowest phases were integrity and file tools (64.6 s), history previews
and blame (52.1 s), and workspace and references (44.9 s). These are
local wall times, not CI targets. See
`test-results/native/full-1795502510960089525/`.
With the faster initial WebDriver read-only polling, the same archive
passed extracted `gitlab-fork-ui` (25 scenarios) and APT-installed `gitlab`
(45 scenarios) in network-isolated Ubuntu 24.04. The full GitLab suite
used OpenSSH inside the container, not a host SSH server. See
`test-results/native/gitlab-fork-ui-1795503124108100598/` and
`target/local-review/stash-pagination/noble-gitlab-fast-poll/run.log`.
The next local archive (`d89a8fb794d010b35b07b78364d0f12deb86ff2b7e3df0d8e26ba7317e26f3c8`)
contains the stash dialog's single error announcement. It passed all six
extracted stash checks and 22 installed stash and discard checks, including
the large nested files, stale review, and recovery limits, in isolated
Ubuntu 24.04. See `test-results/native/stash-selection-1795503435989198065/`
and `target/local-review/stash-alert-d89a8fb7/noble-installed/run.log`.
The next archive (`eaf26033036cec579927df9e01a53ba7a337004f85cd4d71c1d4a28f33ca185e`)
passed all 15 working-tree recap checks both extracted and APT-installed in
isolated Ubuntu 24.04. Installed release evidence now requires the added
check that the staged disclosure and extra unstaged space survive a reload
without changing the checkout. See
`test-results/native/working-tree-recaps-1795503959741841312/` and
`target/local-review/disclosure-persistence-eaf26033/noble-installed/run.log`.
The subsequent archive (`3491f3b5264229095c96c4e58786c33dc01ebde652989c55e9caef7e94293f39`)
passed all 16 working-tree checks extracted and APT-installed in isolated
Ubuntu 24.04. The release gate additionally checks that collapsing Unstaged
Files expands the staged viewport and reopening it restores the previous
height without writing to the checkout. See
`test-results/native/working-tree-recaps-1795504668646887892/` and
`target/local-review/symmetric-file-sections-3491f3b5/noble-installed/run.log`.
The stash-filter archive (`8be74c45091fd9038a5e282e3afdce700421741d7f6de1e4d873ba1343f37c4e`)
passed all seven installed stash checks in isolated Ubuntu 24.04.
Release qualification now distinguishes pagination from filter safety:
the latter must show that a hidden selection stays in the exact stash while
an unselected path is left alone. See
`target/local-review/stash-path-filter/noble-installed/run.log`.
The same exact archive passed all 310 full extracted scenarios in 325.6 s.
See `test-results/native/full-1795505327519880371/report.json`. The two
additional full-run scenarios cover retained staged disclosure and the
staged viewport expanding when unstaged files are collapsed. The focused
installed stash suite remains the evidence for filtering hidden selections.
The next local archive (`8f9d36cee5333df172ecf3c1dcb5961e200100835b0984701157124dc72ddff9`)
passed eight stash and 16 working-tree checks after APT installation in
isolated Ubuntu 24.04. The stash gate now explicitly requires that selecting
matching paths adds only loaded matches and retains earlier selections.
See `target/local-review/stash-matching-8f9d36ce/noble-installed.log`.
The next archive (`56cb5421fc052c4234d7c07ccfba5b7ac2233ba83ad289da1a93ee6afd09e0be`)
passed 17 working-tree checks and eight stash checks after APT installation
in isolated Ubuntu 24.04. The release gate now checks that **Filter Changed
Files** opens the inspector, focuses the filter and leaves the draft and
checkout intact. See
`target/local-review/palette-file-filter-56cb5421/noble-installed.log`.
The next archive (`c4eaf04fcda1f2ec81504d5fc2fdda9857a71b7722804be385af57baf9d4bf1b`)
passed 18 working-tree, eight stash, 45 GitLab, and 21 application-update
checks after APT installation in isolated Ubuntu 24.04. The working-tree
gate now requires the palette's two section-specific focus commands.
The update run uses unconfigured publisher trust; it does not verify a
live signed release. See
`target/local-review/palette-file-sections-c4eaf04f/noble-installed.log`.
The next archive (`2567b42419dd099f0a2d1ba4ded0873bd4f9198d6b33867215483dbdac3f7824`)
passed 19 working-tree and 16 discard checks after APT installation in
isolated Ubuntu 24.04. The working-tree gate now also checks that opening
and cancelling the discard picker works with a collapsed unstaged list
and leaves the checkout untouched. See
`target/local-review/discard-picker-2567b424/noble-installed.log`.
The next archive (`7fd07578c7692c037ee5280a1efba47cc1cb589f8b180491d948dd9b29aaf20c`)
passed 20 working-tree and nine discard checks after APT installation in
isolated Ubuntu 24.04. The release gate also checks disclosure of selections
hidden by the filter and keyboard focus after cancelling. See
`target/local-review/discard-count-7fd07578/noble-installed.log`.
The next archive (`ea9017ef83000f723c1b7cc19ce4a5f1be416e299ccf8bd28c02f2be4fb56143`)
passed 21 working-tree and eight stash checks after APT installation in
isolated Ubuntu 24.04. The gate now covers the loaded match counts on
collapsed working-tree sections. See
`target/local-review/section-matches-ea9017ef/noble-installed.log`.
The portable archive built from the retained current development snapshot
(`3ae112598478d4384aa172216a7890d68cbc5278fab4e3cfe21999f4b5c1c6e6`)
declares the Jammy glibc 2.35 floor and passed smoke (18), working-tree
recaps (21), and stash selection (8) after APT installation on each of
Ubuntu 22.04, 24.04, 26.04, Debian 12, and Debian 13. The images were
network-isolated; Jammy used the separately supplied Git in the test image.
The initial Jammy attempt did not dispatch tests because its versioned
Python was not on PATH. See `target/local-review/jammy-current.2EG27MFM/`
for the ABI result, source snapshot digest, and successful installed logs
(`installed-jammy-retry` for Jammy). This unsigned archive has focused
cross-distribution evidence, not complete release or publisher qualification.
The expanded run against those same bytes satisfies 41 of 42 installed
release-matrix checks (`latest-release-progress.json` in the same directory).
Debian 12 incoming links needed the inherited Git environment; Jammy LFS
counts needed the separately supplied JSON-capable Git LFS. Passing retries
are retained alongside the original diagnostics. The missing Jammy
environment lane requires configured publisher trust. The unsigned variant
of that installed suite passed 317 scenarios with inherited Git context,
but the verifier identifies the configured-publisher scenario as the sole
missing case. The unsigned archive is not eligible for publisher
qualification. See `unsigned-environment/run.log`.
The subsequent local LFS-preferences build
(`87e406e6bec05d2000d2ebfe3599308c36f457a4d093ed0be11f1aa5d24b1404`)
passed the installed count/preferences suite (20 scenarios) and the
snapshot-timeout suite (19 scenarios) in isolated Ubuntu 24.04.
The count fixture verifies both displayed totals without a checkout write;
renderer tests separately cover the unavailable-count display.
See `target/local-review/lfs-preferences-87e406e6/noble-installed.log`.
The next local build (`da42a5e9ff5629f402a7f0db97beabc133b6ff8788933e6eb19a635478472866`)
extends the optional LFS deadline to attribute discovery. The owned stalled
scan delayed the earlier build by 12.05 s; the fixed extracted build opened
in 2.03 s, stopped the owned process, and did not report invented counts or
change the checkout. The same archive passed 20 timeout-suite checks
APT-installed on isolated Ubuntu 24.04. This new scenario is required for
the next Jammy release gate; the earlier 41-of-42 result predates it. See
`test-results/native/lfs-snapshot-timeout-1795510993871387946/`,
`test-results/native/lfs-snapshot-timeout-1795511311159713705/`, and
`target/local-review/lfs-attributes-da42a5e9/noble-installed.log`.
The same archive passed all 315 scenarios in the full extracted run
(`test-results/native/full-1795511417947923212/report.json`, 323.5 s).
The next local build (`ca65b85dc8514d5b76b1747f70260fbd94b46d6afea622f051a49e9e7beb6d5d`)
also bounds the version probe before LFS actions. The extracted object-review
test returned the inspection timeout in 2.01 s, stopped its owned helper
and preserved the checkout. The same archive passed 20 count and 21
timeout checks APT-installed on isolated Ubuntu 24.04. The next Jammy
timeout lane requires the new probe check as well. See
`test-results/native/lfs-snapshot-timeout-1795512132370261354/` and
`target/local-review/lfs-version-ca65b85d/noble-installed.log`.
The next local build (`776ecd27c98ae325ce74341638058839bff7e09fdaf32b7223a7cad10ffdda8b`)
bounds LFS Pull's eligibility check, too. The extracted fixture timed out
in 2.02 s before any transfer and retained the exact checkout. All 22
timeout-suite checks passed after APT installation in isolated Ubuntu
24.04. The next Jammy timeout lane includes this scenario. See
`test-results/native/lfs-snapshot-timeout-1795512583130251458/` and
`target/local-review/lfs-pull-preflight-776ecd27/noble-installed.log`.
On the same bytes, explicitly cancelling a running LFS Pull eligibility
check returned `operationCancelled`, stopped the owned scanner before
transfer, and preserved the checkout. All 23 checks passed extracted and
APT-installed on isolated Ubuntu 24.04. The release gate requires this
separately from the timeout. See
`target/local-review/lfs-pull-preflight-776ecd27/noble-cancel.log`.
The earlier `e0e5def4…` archive passed all 308 scenarios in the full extracted run
(`test-results/native/full-1795498473848245981/report.json`).
It also passed the large-history suite
(`test-results/native/performance-1795500149041061614/report.json`).
In this local headless run, the 20,000- and 100,000-commit fixtures opened
in 499 ms and 491 ms, with at most 57 rendered rows and a 96 ms maximum
renderer heartbeat gap in both. These are fixture measurements, not a
startup time guarantee for other repositories or systems.
The richer benchmark records history opening and working-tree readiness
separately. With both a staged and an unstaged edit, the same two fixtures
opened in 511 ms and 497 ms; their exact staged/unstaged totals were visible
in 1.37 s and 1.34 s respectively, with no checkout changes. See
`test-results/native/performance-1795500216294688249/report.json`.
The release gate now requires this diagnostics check and the staged-collapse,
bulk-action pagination, and final-page keyboard checks. Earlier artifacts
do not qualify the expanded gate.
The portable test-key archive with the fix
(`cf641d6777d8438e2aab9879e28240f33c1b3dddd34bd1cdb3b53740cf98c3b2`)
passed all 42 installed checks under the expanded gate. The Ubuntu 22.04
environment run passed all 309 scenarios. The strict verifier matched the
fixture publisher key to the build receipt and exact installed reports:
`target/local-review/jammy-bounded-status.CXoAE62V/test-publisher-verified.json`.
This is an unsigned test-key build, not a production update.
The same archive passed the dirty large-history benchmark after APT
installation on isolated Ubuntu 22.04. Its two fixtures opened in 461 ms
and 447 ms, with exact working-tree totals visible in 1.30 s and 1.40 s.
The run rendered at most 57 rows and did not modify either checkout. See
`performance-installed/` beside the test-key verification report.

Local renderer checkpoint on Node 24.21.0: the full run reported
2,752 passes and nine non-passing cases. The log is
`test-results/renderer-ci-node.J33uDX/run.log`. The two File History
status assertions and six workspace readiness cases passed focused reruns
after test-only fixes. The graph-column resize timeout did not reproduce
in three focused repetitions without a test change. These reruns do not
constitute a clean full run of the updated tests.

The next full run (`test-results/renderer-final.7xYSQt/run.log`) reported
2,751 passes, one failure and nine timeouts. A serial rerun of the rebase
split, reference action and remote cleanup review specs passed all 58
cases without changes to those specs. The Windows launcher and inspector
tests passed three repetitions each after adding explicit mount checks.
The full-run result remains non-green; the focused logs are
`test-results/renderer-timeout-triage.jK9lcr/run.log` and
`test-results/renderer-late-fixes.ttegXX/run.log`.

In renderer tests, navigation completing does not mean the lazy workspace
is mounted. Before sending a page-level shortcut, wait for a control from
the relevant workspace region. Before collecting layout geometry, use a
locator that waits for the measured element to attach. Scope loading and
clipboard assertions to their own status messages rather than assuming
the panel has only one live region.

The subsequent single-worker run on Node 24.21.0 passed all 2,761
renderer tests in 87 minutes, with no retries, failures, or timeouts.
The run log, final progress record, starting HEAD and tracked-worktree
diff are in `test-results/renderer-serial.XkoRze/`. This validates the
renderer and tests loaded at launch; it does not qualify nested discard
or attest to a hosted release run.

For a cold build on a busy machine, set `PLAYWRIGHT_SERVER_TIMEOUT_MS=300000`
to allow up to five minutes for the server to start. This does not change
browser test timeouts or retry counts; the default startup limit is two minutes.
Add `--list` to enumerate a shard without launching a
browser. The first hosted run of this layout is needed to measure elapsed time
and runner-minute costs; no test cases were dropped to reduce wall time.


## Focused remote and LFS review check

```sh
pnpm nx exec -p desktop --excludeTaskDependencies -- python3 "$PWD/tools/native_acceptance.py" \
  --suite remote-reviews --headless --package "$PWD/target/release/bundle/deb/Git-Khronos_0.1.6_amd64.deb"
```

This includes smoke plus real publish, force-with-lease refusal, fresh reviewed
force-push and exact LFS cleanup journeys. All push destinations are owned local
bare fixtures, checked before use; no hosted remote is written. A concurrent
fixture commit advances the bare remote after review, and the original pinned
lease must refuse it. A new review after fetching must succeed, so blanket
refusal cannot pass. The suite also changes an owned push URL after confirmation
opens: both local bare destinations must remain unchanged, even when they share
the reviewed base commit. A fresh review must then write only the explicitly
reviewed replacement destination. The UI shows a redacted label for every
Git-expanded push URL and explains multi-destination partial failure;
native confirmation requires its configuration fingerprint as well as the
commit-ID lease. This is launch preflight, not an endpoint lock.

Git LFS must be available; the LFS fixture is initialized
locally before creating an aged unreferenced cache object. Cleanup must remove
that object without altering unrelated refs, staged/untracked contents, index
or configuration. A refusing commit hook detects accidental background commits.
The full/environment suites include these checks too.

Cold application restarts discard the main menu's loaded module. Editor draft
recovery and the committed-merge palette journey therefore use the existing
visible-target polling helper for their actual menu item, followed by one native
click. Merely opening the menu can expose its loading escape before these items
exist. Missing/ambiguous controls and uncertain click replies remain failures;
there is no injected activation, longer configured deadline or action replay.

## Linux release qualification

The current release qualification target is Ubuntu 22.04 (Jammy), 24.04 (Noble)
and 26.04 (Resolute), amd64, using one unchanged Debian artifact built on
Jammy. Debian 12 (Bookworm) and 13 (Trixie) are additional exact-artifact
qualification targets in the reusable workflow. This change does not itself
establish Debian support: claim it only after both Debian jobs pass on the same
artifact and their reports are retained. GitHub does not provide Debian-hosted
runners, so those jobs run in official Debian container images on an Ubuntu
hosted runner. Retained [local candidate results](production-readiness.md#full-late-clone-package-matrix--2026-11-21)
include passing exact-artifact checks on both Debian releases. These checks
do not establish that a different or publicly released build passed.

Debian's release package data shows Bookworm's glibc 2.36 and Git 1:2.39.5,
and Trixie's glibc 2.41 and Git 1:2.47.3; both meet the package's glibc 2.35
floor and Git >=2.39 dependency. Both releases provide `libwebkit2gtk-4.1-0`.
Bookworm provides `libssl3`; Trixie uses `libssl3t64`. The actual Debian
package installation must confirm Trixie's package satisfies the `.deb`'s
`libssl3` dependency. The WebDriver package name is
`webkit2gtk-driver` on Bookworm and `webkitgtk-webdriver` on Trixie; each
provides `WebKitWebDriver` and depends on the matching-version WebKitGTK runtime.
Debian splits the D-Bus commands between `dbus-daemon` (`dbus-daemon`,
`dbus-run-session`) and its `dbus-bin` dependency (`dbus-send`).

Jammy support is conditional on **separately supplied, maintained Git >=2.39**.
Its official Git 2.34 cannot satisfy the package or the app's safety requirements.
Neither the installer nor the Debian package configures external repositories;
on Ubuntu 22.04, `install.sh` requires a sufficient Git already registered with
dpkg. A newer PATH-only Git binary does not satisfy APT. On other Debian/Ubuntu
releases, APT retains responsibility for installing or updating dependencies,
including Git. Selecting and maintaining an external Git distribution on a
Jammy user's system remains their responsibility.

The explicitly labeled `jammy-git` CI action uses the Git project's documented
`git-core/ppa` only on disposable GitHub-hosted Ubuntu 22.04 runners, with normal
APT signature verification. This is an external maintenance/trust boundary, not
Ubuntu's stock/security archive and not a recommendation to silently configure
user systems. No Git implementation is bundled into Git Khronos.

Before starting a local or release package build, the builder briefly opens
and closes a watcher on the desktop Cargo manifest. If that fails, it stops
before Tauri runs or a pending build receipt is written. Tauri initializes
this watcher even when not running in development-watch mode. Linux reports
both descriptor exhaustion and its per-user inotify instance limit as
`EMFILE`; raising the descriptor limit alone may not help. Close unnecessary
watchers or review resource limits in the disposable build runner. The
preflight does not change user or system resource limits.

### Jammy runner retirement

The Jammy userspace is the Debian package's build baseline; the hosted
runner label is not part of the package ABI. GitHub
[plans to retire `ubuntu-22.04` on April 17, 2027](https://github.com/actions/runner-images/issues/14254),
with brownouts starting March 23. At present, **Desktop CI**, **Qualify
Debian release candidate**, and the Jammy runtime/publisher lanes in the
shared acceptance workflow still use that label. Migrate all three
before the first brownout, rather than replacing only the build job.

Use a supported hosted runner to run an Ubuntu 22.04 build environment,
then preserve the existing checks for the exact archive: actual Jammy
userspace, amd64, declared libc at most 2.35, imported GLIBC symbols at
most 2.35, and the same installed package hash in every lane. The local
candidate already built and passed the installed suite under Docker
with Jammy userspace, including the publisher qualification. That is
not proof of hosted orchestration. Rehearse the pinned build image,
unprivileged Xvfb/DBus execution, Git and LFS tool versions, artifact
transfer, and publisher checks on GitHub before removing the old jobs.
Do not silently build on a newer userspace and lower its package
dependency metadata in place of the ABI check.

CI and release builds use Ubuntu 22.04 with official updates/Universe enabled
for WebKitGTK 4.1. `desktop:package-ubuntu` first requires an Ubuntu 22.04 amd64
build host, then merges `packaging/linux/ubuntu-jammy.conf.json` over the normal
Tauri configuration. Only this release flavor declares glibc 2.35; ordinary
local builds retain the existing 2.39 floor. Tauri's generated runtime
dependencies are not removed or rewritten. A local newer-system executable
was observed to import GLIBC_2.39, so changing only its metadata would be false
compatibility. The separate release gate refuses any higher declared libc
floor, numeric GLIBC requirement above 2.35, unknown/non-numeric GLIBC ABI
requirements, or non-amd64 ELF:

```sh
node tools/check-linux-abi.mjs /path/to/Git-Khronos_VERSION_amd64.deb
```

The check's JSON records the package SHA-256, full Depends, required GLIBC versions
and DT_NEEDED libraries without executing the payload. This static check alone is
not runtime qualification. The shared `linux-package-acceptance.yml` downloads
the build job's artifact for every Ubuntu and Debian release, verifies its
original SHA256SUMS, checks the ABI again, and lets APT install that exact file
without removals.
APT must resolve the actual runtime dependencies successfully. No rebuild or
per-release repackaging is permitted.

Build the release flavor on its required baseline with:

```sh
pnpm nx run desktop:package-ubuntu
```

Each runner then runs native smoke and GitLab HTTPS/SSH catalogue acceptance
using `--installed`. Before launching `/usr/bin/git-khronos`, the harness
requires its SHA-256 to equal the package's extracted executable. Repositories,
profile, Xvfb display and session bus remain private fixtures. Reports retain
the package/executable hashes, actual executable path, runtime platform and
Linux userspace distribution separately (a container may share the host kernel).
The GitLab release check requires both catalogue read-only preservation and
fork recovery after a real app restart without replaying credentials or the
provider request. The installed fork scenario waits for the restored workspace
toolbar before clicking, rather than using the transient startup launcher.
On Debian 12, the incoming-link suite includes smoke and also verifies cold
saved-tab restoration with the distribution's Git 2.39 and an inherited Git
context. Acceptance is not limited to the newer Git used by the Jammy builder.
The ordinary harness default still extracts the package without installing it.
Python 3.11+ is required by the harness. Ubuntu jobs select Python 3.12 instead
of assuming Jammy's system Python has `hashlib.file_digest`; Debian jobs install
their distribution Python and assert the minimum version.
The Ubuntu runtime runners install `webkit2gtk-driver` on Jammy/Noble and
`webkitgtk-webdriver` on Resolute. Debian runtime runners install
`webkit2gtk-driver` on Bookworm and `webkitgtk-webdriver` on Trixie. All provide
`WebKitWebDriver` on PATH and depend on the matching WebKitGTK 4.1 runtime.
Provisioning checks binary discovery and equal installed package versions
before attempting native acceptance. Debian installs `dbus-daemon` and
`dbus-bin`, then checks `dbus-daemon`, `dbus-send` and `dbus-run-session`.
Ubuntu continues to request the release-available `dbus` package and check the
same commands.
Installed runners provision the standard sticky `/tmp/.X11-unix` directory
before starting Xvfb as an unprivileged fixture user. Minimal containers may
not have it even after installing Xvfb.
On WSLg with a read-only `/tmp/.X11-unix` mount, the headless native
harness uses `xauth` and a separate high-numbered Linux abstract display without enabling
TCP or touching the workstation's display socket. The headless run still
uses a private app profile and owned repository fixtures.

Jammy's standard smoke and GitLab checks keep the distro's Git LFS. The full
signed-release qualification uses a checksum-pinned upstream Git LFS fixture
on PATH because Jammy's stock 3.0.2 doesn't support `ls-files --json`.
The full, environment, and LFS-count suites probe this capability in a
disposable Git repository before launching the app. The probe records the
resolved tool version and an actionable failure without counting it as a
scenario.
The same installed candidate must also pass the focused LFS count and
timeout regressions. The fixture is not bundled in the package and does not
change the app's behavior on installations where counts are unavailable.

The release publish job depends on the reusable workflow completing every
Ubuntu and Debian runtime matrix entry successfully. A failed or unavailable
runner, unsatisfied dependency, absent WebDriver, loader failure or scenario
failure blocks publication; it is not skipped support.
The build-job checksums cover the same package and inventories later published.

To summarize retained installed reports against one Jammy-built package:

```sh
node tools/report-installed-acceptance.mjs "$PACKAGE" \
  "$RESULTS"/setup-keyboard/*/report.json "$RESULTS"/worktrees/*/report.json
```

The command checks the package ABI, installer hash, and installed executable
and launcher hashes before reporting each suite and Git version. It exits
nonzero if a supplied suite failed or any report mismatches the package.
Use repeatable `--reports-dir DIRECTORY` arguments instead of shell globs
to discover final `report.json` files under selected results roots. Select
directories for one candidate attempt; empty directories or links are
rejected, and an older or failed report is not skipped. Discovery is bounded
and does not treat `progress.json` or screenshots as release evidence.
Scenario counts are per report and are not added across potentially overlapping
suites. Older reports may not identify the userspace distribution. This
summary is not signing approval; it does not replace the release preflight or
the required runtime matrix.

For a focused installer check, record the expected scope before running the
suites. For example, write the following to `focused-plan.json`:

```json
{
  "version": 1,
  "checks": [
    {
      "distribution": { "id": "ubuntu", "versionId": "24.04" },
      "suite": "setup-keyboard",
      "inheritedGitEnvironment": true,
      "requiredScenarios": [
        "native-stash-branch-refuses-ignored-obstruction-before-creating-branch",
        "native-reviewed-stash-branch-retains-exact-saved-state-and-source"
      ]
    }
  ]
}
```

```sh
node tools/report-installed-acceptance.mjs --verify-focused focused-plan.json \
  "$PACKAGE" --reports-dir "$RESULTS" > focused-result.json
```

The command exits nonzero if any requested lane is missing, split across
reports, incomplete or mismatched, or if any supplied report failed. Both
`true` and `false` require an explicit match for the inherited Git setup.
With no completed reports the result shows the requested lanes as missing.
The output is labeled `focused-installed-acceptance`, includes the exact
package digest and the matched report for each check, and is not a release
qualification or publisher receipt.
Focused checks can also use a local Debian build on a compatible system.
They still verify the exact archive, executable and desktop-entry hashes.
Release matrix and publisher verification continue to require the Jammy ABI.

Inside a disposable, already provisioned Linux runner with the reviewed
package installed, the same plan can drive both dispatch and verification:

```sh
python3 tools/native_acceptance.py --describe-runner
node tools/run-focused-installed-acceptance.mjs focused-plan.json "$PACKAGE" "$NEW_RESULTS"
```

If the prepared image provides a versioned Python executable but no
`python3` on PATH, set `GIT_KHRONOS_ACCEPTANCE_PYTHON` to its absolute path
(for example, `/usr/bin/python3.11`). Both installed test runners accept
this override. The focused runner uses it for capability discovery as well
as every suite.
In a shell batch, add `:inherited` to any lane that needs the inherited Git
fixture, for example `bash tools/run-native-suites.sh "$PACKAGE" smoke
incoming-links:inherited`. The other suites retain their normal context
unless they explicitly require inherited Git settings.
After an ordinary failure, the batch keeps testing the other lanes and
prints a command for rerunning just the failed lanes in the same shell
environment. A rerun helps diagnose a failure; it does not replace the
original batch's result.

To check Git transport error wording without running the full toolkit, use
`bash tools/run-native-suites.sh "$PACKAGE" transport-error-guidance`.
This runs the standard smoke checks, then uses disposable local repositories
and a fixture askpass prompt. It does not authenticate to a hosted provider.

To rerun the full working-file editor scenario, including the Markdown
preview-to-edit transition and unsaved draft, use
`bash tools/run-native-suites.sh "$PACKAGE" working-file-editor`. This is a
focused check, not a substitute for the publisher lane.

For portable Git artifacts, run these suites against an already installed
archive in a disposable test system:

```sh
bash tools/run-native-suites.sh "$PACKAGE" \
  patch-export bundle-incremental-export commit-source-zip comparison-patch
```

The v0.1.6 test-key archive passed all 11 checks on Debian 12 with Git
2.39.5. A comparison patch reconstructed the target tree, an incremental
bundle required its advertised base and imported only the new recovery tip,
and the ZIP contained committed files only. Cancelling the save dialogs did
not create files. This tests local artifact exchange, not remote publication.

Use one distribution per plan. Before starting any suite, the runner refuses
an unknown suite, a different distribution, an impossible Git environment,
or an archive whose resolved filename does not match the workspace version.
Keep the original installer filename when copying it to a test runner.
The runner also refuses a missing installation or mismatched system files
before dispatch, even if the installed version number matches.
It never installs or publishes a package. It requires a new output directory,
retains the validated plan and each lane's evidence, and writes `run.json`
with the package digest, process results, wall-clock durations and scenario
verification. During execution, `progress.json` identifies the active lane,
its evidence directory, and completed lane count. It is diagnostic only
and does not prove the runner is still alive. A green
process exit alone does not satisfy a requested scenario. For example,
`branch-workflow-ui` checks setup/start/finish, whereas
`branch-workflow-recovery` checks a paused merge, conflicts, restart and stop.
The `bisect-voting` suite runs the same custom-term, unique-result, and
inconclusive-result scenarios as the detached-checkout gate, without
running unrelated checkout and recovery scenarios. Use the complete Git
runtime for the target distribution, including the scripted helper on Git
2.39; a copied executable alone is not equivalent.
The `merge-preview` suite checks a conflict that depends on nested
committed attributes, not the dirty checkout's rules; it also verifies
direction, conflict paths, and unchanged working files and index. Clean
fast-forward and disjoint non-fast-forward fixtures prove previews do not
write source-only files or move refs, then compare actual integration parents,
tree contents and checkout bytes to each reviewed outcome. Run it with
`pnpm nx run desktop:native-merge-preview`.

To check whether the retained reports cover every required Linux runtime
suite for one release candidate, add `--release-matrix` before the package
path. The JSON lists the matching report or `null` for each required
distribution and suite; any missing or failed check causes a nonzero exit.
An isolated lane needs a report that explicitly used isolated Git
configuration. A run with inherited configuration, or one that does not
say which mode it used, cannot qualify that lane.
In `--release-progress` output, an unsatisfied check can include
`closestPassingReport`. It identifies one validated receipt and lists
its missing scenario names and whether its inherited Git context matches.
This is a diagnostic only; separate passing reports still cannot be
combined to satisfy a required suite.
To see the current checklist without building an installer or collecting
reports, run `node tools/report-installed-acceptance.mjs --list-release-matrix`.
The JSON lists each distribution, suite and required scenario. It includes
the focused Ubuntu 24.04 workspace and Git workflow reviews as well as
package startup and GitLab catalogue checks. CI runs the Ubuntu 24.04
workspace, file, and history review groups on separate runners, alongside
the main runtime lane. Each group installs the same checksummed archive
and uploads its own reports under the same workflow attempt. The release
verifier still requires every suite; sharding does not add retries or
allow a partial matrix. This reduces serial wait at the cost of three
additional runner setups. The listing is not acceptance
evidence.
Use the original `report.json` from each passing job. The command does not
check the publisher key or authorize publication.

For a running qualification, use `--release-progress` with the built package
and the same `--reports-dir` arguments. This read-only view accepts empty result
directories and reports how many checks are satisfied, failed, missing
required evidence, or awaiting a final report. It checks the same package and
installed-file hashes, and never treats `progress.json` as evidence. Rejected
reports (for example malformed JSON or a different package digest) are listed
by path and reason under `rejectedReports` without hiding verified results from
other lanes. They do not contribute to any check. Missing reports alone do
not make the progress command fail; a verified failure or a rejected report
causes a nonzero exit even though the JSON snapshot is still available. Use
`--verify-release`, not the progress command, for handoff.

To start or resume one distribution's qualification, generate a plan from
the release checklist instead of retyping its suites:

```bash
node tools/report-installed-acceptance.mjs --plan-release-lane ubuntu 24.04 > noble-all.json
node tools/report-installed-acceptance.mjs --plan-release-lane ubuntu 24.04 \
  "$PACKAGE" --reports-dir "$OLD_RESULTS" > noble-retry.json
```

Without an installer or a suite filter, the plan contains every check
for that distribution. Repeat `--suite NAME` before the optional package
path to request only selected release suites; names not required on that
distribution are refused instead of yielding an empty plan. For a
focused working-tree check on Ubuntu 24.04:

```sh
node tools/report-installed-acceptance.mjs --plan-release-lane ubuntu 24.04 \
  --suite working-tree-recaps --suite discard-large > noble-working-tree.json
```

With an installer and retained reports, it skips only checks satisfied by a
passing installed report for those exact package bytes. Failed, incomplete,
and missing checks remain in the plan. Malformed or mismatched reports stop
planning; keep reports for different installers in separate directories.

If `checks` is empty, there is nothing to rerun in the requested selection. Otherwise,
in a disposable runner for that distribution with the same package installed,
run `node tools/run-focused-installed-acceptance.mjs noble-retry.json "$PACKAGE" "$NEW_RESULTS"`.
Keep the original passing reports and the passing retry reports for the final
handoff; don't submit superseded failures. An empty plan does not qualify any
other distribution or replace `--verify-release`.

If an all-attempts progress file contains superseded failures, keep it for
diagnosis and use its exact matched report paths for handoff. In Bash, with
the progress JSON saved from the same archive:

```bash
jq -e '
  (.rejectedReports | length) == 0
  and (.releaseProgress.totalChecks > 0)
  and all(.releaseProgress.checks[]; .state == "satisfied" and (.report | type) == "string")
' "$PROGRESS_JSON" >/dev/null
mapfile -d '' -t passing_reports < <(jq -j '.releaseProgress.checks[].report + "\u0000"' "$PROGRESS_JSON")
node tools/report-installed-acceptance.mjs --verify-release \
  "$BUILD_RECEIPT" "$PUBLISHER_PUBLIC_KEY_FILE" "$PACKAGE" "${passing_reports[@]}"
```

Run this in a shell that stops on errors (or stop if the first command
fails). The strict verifier reopens the reports and validates the package
and publisher evidence; the progress file itself is not proof.

For a strict offline handoff, check the full matrix and publisher preflight
in one command. Supply the original installed reports, not a prior summary:

```bash
node tools/report-installed-acceptance.mjs --verify-release \
  "$BUILD_RECEIPT" "$PUBLISHER_PUBLIC_KEY_FILE" "$PACKAGE" \
  --reports-dir "$UBUNTU_RESULTS" --reports-dir "$DEBIAN_RESULTS"
```

This emits a JSON summary only after both checks pass. The publisher preflight
uses the exact raw Ubuntu 22.04 environment report selected by the matrix
and checks the same package hash. It neither signs nor publishes files.

During longer runs, inspect the adjacent `progress.json` for the last
completed scenario and elapsed time. The harness replaces it atomically
and logs progress periodically when scenarios finish. It is a progress
snapshot, not release evidence; an interrupted run may leave it marked
`running`. Only a completed `report.json` represents the suite outcome.

For incoming repository links, `incomingDirectActivation` retains the
owned secondary PID, its exit status or terminating signal, and the
primary's private-bus ownership before and after launch when observable.
A nonzero exit or timeout still fails the scenario even if the original
primary survives. This diagnostic does not retry delivery or retain argv.

For the bounded Git LFS counts regression, run
`python3 tools/native_acceptance.py --suite lfs-counts --headless --package "$PACKAGE"`.
Use a disposable runner with a Git LFS that supports `ls-files --json` on PATH,
and add `--installed` when
the exact package is installed there. The owned checkout uses a literal
newline in one LFS path, keeps another file as a pointer, and sets a
nonmatching LFS transfer filter. All counts must still match the checkout
and the read must leave its index and working files unchanged.
For the time-budget regression, use `--suite lfs-snapshot-timeout` instead.
An app-only helper stalls the listing for one owned checkout. The real
Git oracle keeps its original PATH; opening the repository must complete
without waiting for that helper, leave the counts unknown, and preserve the
checkout.

For watcher contention, run
`python3 tools/native_acceptance.py --suite watcher-refresh --headless --installed --package "$PACKAGE"`
with the exact package on a disposable runner. Jammy signed-release
qualification runs this check with the stock runtime prerequisites. The app-only Git wrapper
holds one read while real Git deletes a packed checkpoint in the owned
checkout. Git verifies the deletion first; the graph must then remove the
row without a manual refresh. A separate loose-checkpoint deletion must
converge while the native watcher is still delivering a continuous event
stream. The fixture arms deletion only after the WebView observes at least
700 ms of continuous notifications; the report still rejects any gap of
450 ms or more from that window through graph convergence. The
local release matrix requires both checks in one passing Jammy watcher
report. The fixture does not modify Git on the host.

The GitLab suite's initial Connect action is clicked once. A refusal records
the rendered error category, the number of TCP sockets the fixture accepted,
owned HTTPS request counters, and whether the fixture saw a TLS handshake.
Evidence includes only aggregate TCP counts and a bounded
handshake outcome and SSL reason identifier, never credentials or raw
request data. A refusal also triggers one credential-free TLS handshake
against the owned loopback listener to distinguish a fixture outage from
an app-side failure. The app's connection and HTTP request are not retried.
The application distinguishes initialization failure, selected OS
connection failures, and otherwise unclassified connection or response
errors using fixed messages. The report records only the corresponding
allowlisted stage label, not the transport error chain.
Use `--suite gitlab-connect --headless` for that exact UI connection
without the preceding toolkit work or SSH fixture. It checks private TLS,
account identity, token clearing and unchanged Git data. It is a diagnostic
shortcut, not release evidence for the full `gitlab` suite.
Use `--suite gitlab-connect-after-smoke` to preserve the full GitLab
suite's smoke and SSH setup but stop after the first Connect result.
Use `--suite gitlab-connect-refused` to exercise the real native refusal
path against a reserved loopback port with no listener. It requires the
specific TCP message, a cleared token, no HTTP request, and unchanged Git
data. Unlike the intermittent symptom, this test's refusal is intentional.
On Ubuntu 26.04 the installed `9f41ae58` archive passed three fresh
Connect-only runs in 5.3–5.9 seconds each. It also passed both
Connect-after-smoke runs (one socket-traced), so these faster probes did
not reproduce the previous refusal. Their reports are under
`target/local-review/jammy-direct-commit.yyAzpE/`.
An additional traced Connect-after-smoke run with the Ubuntu 26.04
container limited to 1.5 CPUs also passed all 19 scenarios. CPU
contention alone did not reproduce the refusal in this run.
The fixture negotiates TLS in a bounded per-connection worker. A TCP
connection that never starts TLS can no longer stall accepts for other
clients. A local harness regression reproduced the stall with the previous
fixture and verifies that a second, credential-free handshake now succeeds.
This does not establish the cause of the separate Ubuntu 24.04 app refusal.
Against portable build `49318f97a076904bc3bd419b427a76fad5879cb11727676480995725b857e3e4`,
the previous fixture's Ubuntu 24.04 runs failed at initial Connect twice.
A clean run of the same installed package with per-connection TLS passed
all 45 GitLab scenarios. Both failures and the successful run are retained
under `target/local-review/jammy-discard-scope.skNzLH/`.
The next frozen package,
`fe1936f835d964d0b536c2635f1e8199e2369ff0b2443712007042d4bd6d6aad`,
passed all 45 installed GitLab scenarios on the first attempt on every
matrix distribution (Ubuntu 22.04, 24.04 and 26.04; Debian 12 and 13).
See the five matrix logs in `target/local-review/jammy-oversized-discard.A9HBeW/`.
On the subsequent `9f41ae58` build, the two Ubuntu 26.04 refusals had
zero TCP accepts and zero API requests; a later credential-free handshake
still succeeded. The traced rerun passed all 45 scenarios and therefore
did not establish why the earlier attempts failed. These logs are under
`target/local-review/jammy-direct-commit.yyAzpE/`. This archive predates
the application-side error-stage descriptions.

Splitting the inherited Ubuntu 22.04 environment suite into its own
container reduced the measured initial-attempt matrix wall time from
820.2 to 685.4 seconds across these two local runs. No required scenarios
were removed, although the isolated environment suite itself took longer
under contention. `matrix-wall-timing.json` excludes build and retry time;
this comparison is neither a controlled benchmark nor a release ETA.

For Pull scope, Ubuntu 24.04 qualification runs two independent suites
against the installed package:

```sh
python3 tools/native_acceptance.py --suite workspace-pull-upstreams --headless --installed --package "$PACKAGE"
python3 tools/native_acceptance.py --suite pull-submodule-scope --headless --installed --package "$PACKAGE"
```

The workspace suite verifies that a multi-upstream repository is skipped
before fetch, a second repository still advances, and an explicit toolbar
Pull integrates only the displayed branch. The submodule suite enables
Git recursion in a fixture and verifies that Pull records the new gitlink
without fetching or checking out the nested revision. Both use independent
Git reads in disposable repositories.

Use `--suite branch-workflow-ui` to isolate packaged workflow setup,
feature, release, and hotfix operations. The same scenarios run in
`environment`. The harness gives each reviewed Apply a bounded 60-second
window, records its elapsed time, and requires the real Git refs, parents,
tags, and recovery artifacts before declaring success.

Use `--suite hosted-fork-ui` to isolate the real hosted fork UI, restart
recovery, and reviewed clone handoff on an installed package. It uses the
owned CLI provider and local Git only. Controls in the scrolling catalogue
must be painted and hit-testable before the harness clicks them once.

The `file-media` suite runs the same native image and file-content checks
as the full toolkit, including actual WebKit decoding. It centers each row
before its click so a partially clipped row under a sticky heading is not
treated as an available hit target.

Native editor, file-tool, and media scenarios wait for the deferred file
action menu to paint before selecting Preview file content. The harness
captures the enabled control in that wait, verifies its hit target, and
clicks it once; menu loading is not mistaken for a missing action.

## Focused linked-worktree navigation acceptance

From the repository root, the `worktrees` suite runs the normal packaged smoke
checks plus three real-UI cases for an occupied local branch:

```sh
package=$(task --silent package:deb:path)
pnpm nx exec -p desktop --excludeTaskDependencies -- \
  python3 "$PWD/tools/native_acceptance.py" --suite worktrees --headless --package "$package"
```

The same cases are included in `full` and `environment`. They create only owned
temporary linked checkouts and dirty tracked/untracked files. Cancel must leave
both checkouts unchanged. A real double-click in the graph's branch column must
offer explicit navigation. Accepting it must open the registered owner on its
branch, without detaching HEAD or changing Git data, using its exact path with
Unicode, a tab, an embedded newline and a trailing space. A real Git ownership change
after review must be refused, without a fallback checkout. Retained evidence
includes both checkouts' HEAD/ref/config/index/file hashes and before/after Git
status, resolving each linked checkout's actual index rather than treating its
`.git` pointer file as a directory. No personal repository is used, and the
driver uses a private Xvfb display and session bus. The installed Jammy
`environment` release gate now requires all four branch-navigation
receipts, including the graph double-click assertion, from the exact
candidate package.

Local package `8ac462f068de8c18caf78a9b82e7622840fdcb6d080bcd96ab1f71ffda68cbab`
passed all 23 extracted-package `worktrees` scenarios, including
opening the registered owner by double-click without detaching either HEAD.
The run is under `target/local-review/commit-rewrite-responsive.ZsCTuj/baseline-worktree-results/`.

The separate `first-status` suite holds Git's first complete file scan in an
owned checkout. It checks that history is usable while file counts remain
unknown, then releases the read and verifies the exact staged and unstaged
line recaps without changing either the index or the files. To run it, use
the command above with `--suite first-status`.

Read-only completion observations are not mutation retries. In particular,
partial-discard refusal acceptance waits for the confirmation to close and the
exact native refusal to render before checking file/index/recovery invariants;
diff disappearance alone cannot complete that gate. Regression tests evaluate
that predicate against pending, unrelated and hidden feedback using the already
required Node runtime. No native write is replayed and no timeout is increased.

## Focused incoming-link restart acceptance

Use `--suite incoming-links --inherited-git-environment --headless --package "$package"`
with `tools/native_acceptance.py` to isolate existing-process delivery and a cold
start from a saved workspace. The restart must render the expected repository
and commit, not merely any graph rows. An owned missing-object control proves
that ordinary Git would call its configured helper; guarded restoration and
patch inspection must not call it. A timeout retains the failing view before
fixture cleanup reopens the original repository. On a disposable installed
runner, add `--installed` to check the same package bytes used by the full suite.

Direct and desktop-scheme delivery must leave the original PID owning the
fixture's private session bus. If a candidate PID disappears or changes
executable between procfs reads, the report keeps that observation separate
from live application processes. A short read-only settling window can
recheck a non-owning direct child on the same bus. The original and settled
observations are both kept. A persistent second process, unrelated process,
unreadable candidate, or changed bus owner still fails. This never resends
a desktop activation.

## Focused publisher trust acceptance

For an offline updater UI and native-policy check, use
`--suite application-updates --headless --package "$package"`. Set
`GIT_KHRONOS_NATIVE_EXPECT_UPDATE_TRUST=1` when the package was built with the
publisher public key; without it, the suite expects the unconfigured-trust
refusal. This checks the running version, default-off preference, and absence
of an installable offer, not a live download or an update installation. The
broad signed-release evidence gate still requires its complete environment suite.

## Prerequisites

- the pinned Node, pnpm, and Rust toolchains;
- `task`, `dpkg-deb`, Python 3.11+, Git, Git LFS, and OpenSSH;
- `readelf` (binutils) and a C compiler for release ABI/package regressions;
- `openssl` for the owned GitLab HTTPS test fixture;
- `fakeroot` for the package regression suite's private dpkg ownership checks
  (not required for normal application use or installation);
- `tauri-driver 2.0.6`, `WebKitWebDriver`, and Xvfb plus `libXtst` for headless
  right-click scenarios;
- `dbus-daemon` and `dbus-send` for the owned private session bus and restart checks;
- `desktop-file-utils` (`desktop-file-validate`, `update-desktop-database`) and
  `libglib2.0-bin` (`gio`) for full/inherited-environment incoming-link checks;
- the Linux libraries required by Tauri and WebKitGTK.

Missing prerequisites are failures. The harness never reports a skipped native
suite as a pass.

For headless context-menu scenarios, WebKitWebDriver's right-button release can
produce a spurious primary click. The harness therefore sends one XTEST right
press and release only to its own live Xvfb display, after checking the exact
extracted application PID and the visible window under the pointer. It verifies
both trusted events and never injects into an inherited desktop display. Visible
runs continue to use WebDriver input and fail if it does not deliver a proper
right-button release. These checks do not modify application menu behavior.

Application restart checks verify that the private single-instance bus name belongs
to the owned executable's PID before closing it. They wait for both process exit and
bus-name release before launching one new WebDriver session. A timeout or different
bus owner fails the check without retrying a session creation whose outcome is unknown.

Read-only WebDriver readiness polls cap each HTTP request by the time
remaining and reject a late positive reply. Opening repository management
from the restored toolbar uses the same deadline for readiness and click.
Only a structured stale-element refusal permits a fresh lookup and click;
a timed-out or lost click reply is never replayed.
For explicit catalogue navigation, the harness waits for one visible,
enabled replacement within the remaining deadline after that refusal.
It does not dispatch another click if multiple controls match. Provider
connections, reconciliation, and fork submissions do not use this recovery.
Both the release `gitlab` suite and the focused `gitlab-fork-ui` suite
detach a harness-owned inert button and check that the real WebDriver stale
response leads to exactly one click on its replacement. This probe never
calls GitLab.

Linux bundling also prepares `rust-dependency-notices.json.gz` from locked,
offline Cargo metadata for Tauri's explicit target triple. It includes the
conservative normal/build dependency closure, upstream notice text/hashes and
versioned source locations, with separately marked project-authored source
availability where explicitly reviewed. It is not an exact linked-artifact
SBOM or a legal approval. Missing or changed license provenance fails bundling.
The Debian verifier rejects a missing, corrupt or mismatched catalog; rebuild
with `task package:deb` if the generated copy is absent or differs. Existing
curated notices remain alongside it. `desktop:package-test` covers collection,
generation and private Debian payload/cache regressions without installing.

The package also carries `frontend-dependency-notices.txt.gz`: Angular's
production-generated notice bytes, followed by the explicitly reviewed full
dialog-plugin terms omitted from that package's SPDX-only published notice.
The generator verifies the package/lock/source identities and retained hashes;
the Debian verifier rejects missing, corrupt or mismatched frontend notices.
The generated file alone is not an exact frontend SBOM or legal approval.

The separate `desktop:test-ssh` target requires `/usr/sbin/sshd`, or an absolute
`GIT_KHRONOS_SSHD` path to an already available OpenSSH server. A private extracted
package prefix is supported: keep `usr/lib/openssh/sshd-session` and `sshd-auth`
beside `usr/sbin/sshd` in that prefix. The test selects those helpers explicitly,
uses an ephemeral loopback listener and private keys/trust files, and does not
require installing or reconfiguring the host's SSH service. A missing prerequisite
is not an application transport regression or a successful qualification.

## CI Rust build footprint

The checks job builds serially with line-table debug information for Cargo's
`dev` and `test` profiles. This retains source-line backtraces without full type
and variable debug information. It does not disable debug assertions, overflow
checks or tests. Local developer defaults and the packaged release profile are
unchanged. See the [Cargo profile reference](https://doc.rust-lang.org/cargo/reference/profiles.html).

The checks cache uses the `checks-line-tables-v1` prefix, preventing restoration
of the previous full-debug target cache when establishing the smaller profile.
The [Rust cache action](https://github.com/Swatinem/rust-cache) includes Cargo
environment values in its cache identity. Disk availability is recorded before
verification and after releasing checked desktop artifacts. A CI disk-exhaustion
failure is retained as a failed build; it is never reported as passing tests.

## Durable local validation

For a long-running Linux validation command, run the existing Nx targets through
the owned-process wrapper from the repository root:

```sh
mkdir -p target/validation-runs
node tools/run-validation.mjs start target/validation-runs/my-source-check run-many --targets=test,check --projects=desktop --parallel=1 --skipNxCache --output-style=static
```

Use a new run directory every time. The launcher prints a runner PID only
after the worker exclusively creates the directory and writes
`preparing.json`. An existing directory or a missing parent makes
`start` fail immediately, without changing any existing evidence. The
worker goes on to record `started.json`, `output.log`, and a terminal
`result.json`. Use `node tools/run-validation.mjs status <run-directory>`
to distinguish preparation, a running command, and a finished run.
See `node tools/run-validation.mjs --help` for examples. A leading
`desktop:e2e` is shorthand for `run desktop:e2e`; the receipt records the
expanded command.
Use `node tools/run-validation.mjs wait <run-directory>` to wait for an
existing run and return its exit code. Interrupting this observer does not
cancel the detached run. A missing or unverifiable run is not a pass. A stopped
run without a result reports whether the boot differs, the process is no
longer live, or its PID has been reused. It does not infer why it stopped.

For uncommitted changes, opt in to an end-to-end checkout comparison:

```sh
node tools/run-validation.mjs start target/validation-runs/guarded-renderer \
  --guard-source desktop:e2e -- --workers=3
```

Use a run directory outside the checkout or ignored by Git. The guard
compares Git-visible file paths and bytes, executable bits, symlink text,
HEAD, and branch at the start and end. A different or unreadable final
fingerprint prevents an otherwise passing command from being reported as
a pass. Ignored files and edits reverted before the final check are not
covered; use `--snapshot REF` for a run isolated from live checkout edits.

A named validation that includes `desktop:e2e` (directly or via an explicit
`run-many --targets` list) also writes optional
`renderer-progress.json` once Playwright knows the test plan. The status
command reports how many distinct tests have returned a result, total
attempts including retries, and the latest outcome for each counted test.
Use `testsRemainingToReport` and `reportedPercent` for case-count
progress; a reported test can have failed or be awaiting a retry.
`reportedPercent` is null when no tests were planned. This is not an
ETA or a pass result.
The wrapper chooses an available loopback port for these renderer runs
unless `PLAYWRIGHT_PORT` is set, and records the chosen port in the receipt.
Named validation never reuses an already running server, even if the parent
shell has `PLAYWRIGHT_REUSE_SERVER=1` set for interactive testing.
Parallel runs therefore need not share the default Playwright port.
Port isolation does not isolate CPU or memory. On a busy WSL2 host,
complete the optimized Rust package build before running a broad renderer
suite. If the development server misses its startup deadline or tests time
out during setup, retain that failed run and rerun in a separate evidence
directory with `--workers=1` after the build ends. Increasing
`PLAYWRIGHT_SERVER_TIMEOUT_MS` only changes the server startup deadline,
not individual test timeouts.
Use `activeAttempts` and `oldestActiveAttempts` to tell what is still running
before the next test result arrives. The latter lists up to five spec
basenames with attempt start times; it does not include test titles or
absolute paths.
These are observations, not a percentage of release readiness or a
prediction of the end time. If the runner stops without a result, status
keeps its last valid snapshot for diagnosis; any active attempts shown
there were active at the snapshot time, not necessarily still running.
`result.json` and the retained test report remain the authority. A custom
`--reporter` override can omit this file.

To investigate slow runs, inspect `slowestSpecsByAttemptTime` in
`renderer-progress.json`. It lists up to five spec files ranked by the
sum of their completed test-attempt durations, including retries. These
times can overlap across workers and exclude server startup, so they are
useful for profiling, not as elapsed time or a release ETA.
Each listed spec also reports its number of timed attempts, longest
attempt, and that attempt's source line when available. This distinguishes
a large group of ordinary tests from one slow case. To rerun a case by
that location, use:

```sh
pnpm nx run desktop:e2e -- e2e/renderer/branch-panel-interactions.spec.ts:381 --workers=1
```

The source line belongs to the tested checkout and may move after edits.
The latest full three-worker run passed 2,816 cases in 40 minutes 37 seconds;
the top two specs by summed attempt time were `graph-columns.spec.ts` and
`workspace.spec.ts`. The four CI lists resolve to 704 cases each and cover
the same suite without overlap (`renderer-shard-resolution/` in the local
qualification evidence). That shows balanced case counts, not equal shard
runtimes or a hosted CI speedup.

The graph-column suite now seeds the initial layout before the first app
navigation, without reseeding on a persistence reload. All 270 cases
still ran and passed. Its summed attempt time dropped from 1,091 seconds
in the two-worker full renderer run to 910 seconds in the two-worker
isolated rerun. Those are different run scopes, so the observed reduction
is not a guaranteed speedup for the entire renderer suite.
The layout probe also measures each heading and row cell once per check,
then reuses the rectangle for visibility and alignment. All 270 column
cases and four layout-readiness cases passed a guarded three-worker run
(`graph-layout-single-snapshot/`), including the negative geometry checks.
The graph-column cases used 1,052 seconds in aggregate across the workers;
this focused run was not a controlled speed comparison with the full suite.

A subsequent isolated run identified the partial-column assertion as its
longest test attempt (31.4 seconds). The eight independent column orders
now run separately while each still changes between both scroll modes and
checks every separator. All eight passed in 14.1 seconds of test time with
three workers. The updated CI lists cover 2,823 cases without overlap; each
shard gets two of the partial-column cases and 705 or 706 total cases
(`renderer-partial-columns-split/`, `renderer-shard-resolution-after-column-split/`).
The four window-resize orders in both scroll modes were also split into
eight independent cases. The combined graph-column suite passed all 284
cases in a guarded three-worker run (`renderer-graph-column-split-full/`).
The longest attempt was 16.7 seconds, down from 31.4 in the earlier
isolated run. These observations show smaller individual cases, not a
reduction in total graph-suite or hosted CI runtime.
The final CI test lists resolve all 2,830 cases exactly once, with
707–708 tests per shard. Each shard receives two partial-column cases
and two window-resize cases (`renderer-shard-resolution-after-resize-split/`).



SIGINT or SIGTERM to that verified runner interrupts its owned command group,
waits for cleanup, and records the interruption instead of abandoning children.
Commands get a separate process group; unrelated groups are outside cleanup
scope. Descendants that deliberately leave that group are not chased. This is
validation tooling, not a way to manage personal applications or arbitrary PIDs.
For Playwright, also select a fresh, run-specific `--output` directory to avoid
two runs deleting one another's traces. Do not overlap timing-sensitive suites
with a compiler or a second browser suite.

For a renderer release check, pin the app and test files to the same commit:

```sh
PLAYWRIGHT_PORT=4284 node tools/run-validation.mjs start \
  target/validation-runs/renderer-candidate --snapshot HEAD \
  run desktop:e2e --skipNxCache --output-style=static -- --workers=2 --retries=0
```

Choose an unused port and a new run directory. Snapshot mode resolves the
ref before detaching and exports that commit under the run directory without
registering a worktree. It includes neither uncommitted tests nor untracked
files. The runner installs the snapshot's locked dependencies from the local
pnpm store and makes Playwright start its own server. If dependencies are
missing from the store, setup fails rather than using the live checkout.
`preparing.json` records the pinned commit during setup; `started.json`
means Nx actually started, and both receipts identify the isolated directory.
Use normal mode for Git-history-dependent targets such as `nx affected`.

The lightweight lifecycle tests include the actual CLI with a private fake
package-manager executable; they never change the user's PATH or launch a build:

```sh
pnpm nx exec --projects=desktop --excludeTaskDependencies -- node --test "$PWD/tools/owned-command.test.mjs"
```

`desktop:owned-process-test` runs the same lifecycle regressions, and
`desktop:graph-test-typecheck` strictly checks all `graph*.ts` renderer test
files without emitting output. Both are dependencies of `desktop:test` so they
also run through the ordinary test gate. The graph check does not claim to type
check unrelated renderer journeys.

### Optional native TypeScript check

For local graph-test type checking only, run:

```sh
pnpm --package=typescript@7.0.2 dlx tsc --project tsconfig.graph-tests.json
```

This downloads the pinned CLI into pnpm's external cache without changing the
workspace dependencies or lockfile. In three runs per compiler on the same
checkout (excluding installation), the median was 0.97 s on 7.0.2 and 4.29 s on
6.0.3; both passed. That is not an Angular build or browser-test benchmark.
Keep the normal Nx gate on the workspace compiler: Angular 22
[requires TypeScript 6.0.x](https://angular.dev/reference/versions).

## Nx targets

```text
pnpm nx run desktop:package-deb
pnpm nx run desktop:native-smoke
pnpm nx run desktop:native-full
pnpm nx run desktop:native-performance
pnpm nx run desktop:test-lfs
TMPDIR=/tmp pnpm nx run desktop:test-signing
```

For local renderer changes, start with just the affected spec:
`pnpm nx run desktop:e2e -- e2e/renderer/worktree-move.spec.ts`.
For a feature that spans multiple specs, use
`pnpm nx run desktop:e2e:<profile>`:

| Profile | Renderer coverage |
| --- | --- |
| `worktrees` | Linked worktrees, occupied-branch checkout, submodule review |
| `working-files` | File editing, working-tree actions, discard and recovery |
| `branches` | Branch navigation, scoped reference actions, branch workflows |
| `stash` | Stash creation, review, restoration and deletion |
| `transport` | Fetch, pull, push, remote cleanup and authentication UI |
| `gitlab` | Catalogue, clone, fork browsing and creation |
| `graph` | Representative graph layout, connectivity, scrolling and virtualization |
| `history` | History search, paging, blame, comparison and replay |
| `workspace` | Repository workspace, tab and sidebar interactions |
| `keyboard` | Command palette, shortcut reference and review-dialog keyboard handling |
| `updates` | Application updater UI |

Pass Playwright options after `--`; otherwise Nx can consume options such as
`--project`. For example, list the working-files cases or run only that profile
in WebKit:

```sh
pnpm nx run desktop:e2e:working-files -- --list
GIT_KHRONOS_RENDERER_WEBKIT=1 pnpm nx run desktop:e2e:working-files -- --project=webkit --workers=4
```

Use `-- --grep='test title'` to narrow further. Profiles group renderer specs,
not all dependencies of a code change.
For shared UI or IPC changes, include adjacent specs or use the full suite.

To plan or run checks based on changed files:

```sh
pnpm test:changed                           # Preview staged, unstaged and untracked changes vs HEAD
pnpm test:changed --base origin/dev         # Compare with the local tracking ref; does not fetch
pnpm test:changed --staged                  # Select from the index; execution still uses working files
pnpm test:changed --run                     # Run the selected local checks
pnpm test:changed --run --webkit --workers=4 # Opt into WebKit and override browser workers
```

Recognized renderer components select their profile. Changed browser and
renderer unit specs run directly unless already covered, while native harness
and registered package test edits use their own test targets. Packaged native
scenarios still need a separate run against a selected Debian archive.
Shared or unmapped files fall back to broader validation; use
`--run --allow-full` after reviewing that plan. This is a local aid, not a
release gate or a complete dependency analysis.

For a broader local pass, run `pnpm nx run desktop:e2e-quick`. This skips
the exhaustive five-column order permutations except for the default order
in both scroll modes. The remaining browser cases still exercise SHA placement,
window resizing, and drag-and-drop. Use `--list` to inspect the selection.
The full `desktop:e2e` target is unchanged and remains the release check.

The native targets do not build the application. Without `--package`, they
use the Debian archive in the local build output, which may predate the checkout.
For a source regression, run `desktop:package-deb` first; for a release candidate,
pass its archive explicitly and match the report's `packageSha256` against the
candidate digest. A failing or passing run against an older archive does not
establish the behavior of the current source.

The packaged GitLab discovery/clone suite uses the same verified package and
ordinary native IPC with owned HTTPS and loopback SSH services and synthetic
credentials. It requires `sshd` (`openssh-server`) in addition to the client;
set `GIT_KHRONOS_SSHD` to an absolute private server path when it is not installed
at `/usr/sbin/sshd`. For OpenSSH builds with separate `sshd-session` and
`sshd-auth` executables, keep both under the same extracted prefix's
`usr/lib/openssh`; the fixture selects them automatically. The server
and both helpers must be able to load their distribution libraries (check
each with `ldd` when extracting without installing). To reproduce only the
fork catalogue UI and its HTTPS fixture without SSH, use `--suite gitlab-fork-ui`.

```sh
package=$(task --silent package:deb:path)
pnpm nx exec -p desktop --excludeTaskDependencies -- \
  python3 "$PWD/tools/native_acceptance.py" --suite gitlab --headless --package "$package"
```

Its private CA and SSH identity/known-hosts configuration apply only to the owned
application process. The SSH server accepts one read-only test repository command.
It changes no host trust, keys, agent, accounts or system service and contacts no
real GitLab account. Missing prerequisites fail the suite rather than skipping
SSH coverage. Run an unavailable private SSH login in a disposable container
instead of changing host account authentication. The SSH clone acceptance
surfaces visible terminal feedback immediately without issuing another click. See the [GitLab discovery](specifications/gitlab-projects.md) and
[reviewed clone](specifications/gitlab-reviewed-clone.md) specifications.

`test-lfs` runs the normally ignored Rust LFS integration checks serially with
real Git LFS, using disposable repositories and local transfer/locking fixtures.
It covers checkout, selective fetch, object inspection, tracking-rule removal,
and conservative cleanup. It is non-cached and fails if Git LFS is missing. The
CI checks job installs Git LFS and runs this target separately from ordinary unit
tests, so ignored coverage is not mistaken for an exercised integration gate.

The target also runs the desktop `authentication_transport` LFS regressions,
which require real Git LFS and the shipped askpass helper.
`lfs_lock_listing_uses_authenticated_json` uses a private Basic-auth locking endpoint that returns a known held
lock; the scoped core API must return that lock, report quiet authentication
failure instead of an empty list, honor prompt cancellation, and allow an explicit
retry. This is separate from native lock-dialog acceptance. Core bounded-reader
tests also retain complete bytes and exit status below the limit, stop inherited
pipe holders on overflow, and remain cancellable after parent exit.
Endpoint-policy regressions refuse embedded credentials from ordinary endpoint
keys and working/index/HEAD/bare `.lfsconfig` sources before any connection to the
owned server. Safe file-source and ordinary-config overrides still authenticate
and return the held lock without rewriting the configuration or index. Unix path
fixtures include whitespace, newlines, Unicode, and non-UTF-8 bytes. Invalid and
oversized file configuration must fail closed. A separate regression first
authenticates against the held-lock fixture, then repeats safe ordinary endpoint
values beyond the capture limit and requires refusal without another connection
or a change to Git configuration or index state. A Linux core fixture holds a
configuration FIFO open and requires cancellation to finish before the writer
closes, rather than relying on EOF to release the query.

Native full/environment acceptance also calls the packaged lock-list IPC against
a private Basic-auth locking server. Its fixture-only credential helper releases
saved credentials only when noninteractive retrieval is configured. The JSON
listing must retain the known held lock, an unauthenticated read must fail rather
than return an empty list without opening a prompt, and a configured retry must
recover the same lock. HEAD, index, and working contents must stay unchanged.
The packaged endpoint-policy checks refuse credential-bearing ordinary endpoint
keys and a working `.lfsconfig` without another TCP connection or HTTP request.
A safe ordinary-config override must still return the held lock without changing
the selected file or Git configuration. The core parser regression also keeps
distinct non-UTF-8 endpoint names separate when applying configuration overrides.
The native fixture also exceeds the ordinary endpoint-query capture limit with
repeated safe values and requires refusal before another connection or request.
This exercises the shipped command boundary, not a lock-dialog interaction.

Native full/environment acceptance also builds real local branches, remote refs,
and tags with short, medium, and overflowing names on separate commits. It uses the column separator's keyboard controls
at three increasing widths and real WebDriver pointer movement, sampling 30
animation frames on hover and focus. Labels must remain readable without moving
their resting position or the adjacent graph. The application-generated reference
markup is not replaced, and Git refs, index, and working contents must remain
unchanged. This complements the renderer-only reference-hover matrix.

The avatar-side fixture creates a real merge graph, an intervening branch, and a
branch that can be pinned to the left. In expanded/compact and pinned/unpinned
modes, it measures the packaged SVG endpoints in screen coordinates against the
actual avatar bounds. Left/right departures, converging arrivals, and straight
reference connectors must meet the circle's side center within 0.1 px. The
pinned case must exercise an incoming lane relocated to the avatar's right side;
the unpinned case must exercise departures on both sides. These checks use the
release DOM and persisted user preferences, not Angular debug APIs or replacement
markup. Git refs, index bytes, and working-file contents must stay unchanged.

A second fixture reproduces the nine-commit shared-parent/checkpoint topology
reported in Git-Khronos itself, using original fixture commits with deterministic
dates and verifying their actual loaded row order. In both graph densities, the
real parent link must leave the shared commit's right-side center, while
unrelated compacting lanes must remain at least 0.5 px outside the avatar circle.
Every rendered commit edge in this fixture must use only horizontal/vertical
SVG segments and circular quarter-turn arcs, with rounded joins in both modes.
At least one rounded turn must actually be exercised. Avatar lane spacing is
40 px expanded and 32 px compact, leaving room for the rounded side ports.

The renderer merge-direction regression checks adjacent and distant secondary
parents in both densities. Merge links turn beside the upper merge commit,
then follow the branch lane downward; a lane-colored arrow points back into
the merge commit and stops 2 px outside its avatar. Ordinary first-parent
links and unrelated continuing lanes retain their existing routing. Collapsed
same-column links omit the arrow rather than placing it over the avatar.

The report records the checked path count per mode as
`roundedOrthogonalGraphPathCount`; earlier reports without this field do not
qualify the rounded orthogonal routing requirement.
The report records the minimum measured bypass clearance. Parent links must not
be confused with continuing lanes, and this test also preserves refs, index, and
working contents.

On Linux hosts with changing bridge/veth interfaces, Chromium can abort even
loopback development-module requests with `net::ERR_NETWORK_CHANGED`, before
the application shell starts. Renderer-only checks can use a temporary private
network namespace when unprivileged user namespaces and `ip` are available:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false \
  unshare --user --map-root-user --net -- sh -c \
  'ip link set lo up && exec pnpm nx run desktop:e2e -- --workers=1'
```

This enables only the private namespace's loopback; the host user's privileges,
host interfaces, services, browser flags, assertions, and timeouts are unchanged.
Do not disable host security settings to make this command work. These renderer
checks do not qualify real Git transport: run the separate native, HTTP, SSH,
LFS, and signing gates as described above. Keep heavy concurrent builds out of a
renderer timing requalification, and retain any preceding failure artifacts.

`desktop:check` compiles its development renderer into `dist/checks/desktop`,
separate from `dist/apps/desktop` used for production packaging. A check run
must not delete or replace release assets. It is not a production renderer build;
packaging still runs the production build and its preview-initializer guard.
Ordinary development builds (`desktop:build:development`, or Angular's
development configuration) write to `dist/development/desktop`. Nx's build
output declaration follows the selected `output-path` option, so restoring a
development build from cache must not restore or overwrite release assets.
The production guard reads that same selected output directory.

`test-signing` separately runs the three normally ignored real SSH, OpenPGP,
and X.509 signing tests, serially and without caching. It requires `ssh-keygen`,
`gpg`, `gpgconf`, `gpgsm`, and OpenSSL. Use a short temporary-directory path on
Unix because GnuPG's agent sockets have a platform pathname-length limit.
The CI checks job installs these tools and runs this target explicitly. Keys
and trust stores are fixture-local; personal signing material is not used.
`desktop:native-signed-tag` separately exercises packaged annotated-tag
creation for lightweight and OpenPGP-signed annotated tags through the UI,
plus SSH- and X.509-signed annotated tags through native IPC. It verifies all
three signatures and checks tag objects, peeled targets, and unchanged
worktree/index state. A signing-tool preflight reports missing `gpg`,
`ssh-keygen`, `gpgsm`, or `openssl` before launching the application.
`desktop:native-signed-commit` exercises the explicit Sign commit control in
the commit form, confirms the new commit's parent, tree content, signature, and
signature display, and checks that Git configuration is unchanged. It needs
`gpg` and fails before launch with a missing-tool diagnostic.
`desktop:native-empty-commit` verifies that an unchanged-tree commit stays
disabled until the user enables the explicit commit policy, then records an
empty commit without staging pre-existing unstaged edits. It checks the original
index bytes, unchanged commit tree, successful pre-commit hook execution, and
the resulting working-tree status.
`desktop:native-tag-preview` verifies that selecting a tag navigates to its
peeled commit and that branch creation from the tag opens the exact tagged
commit and switches to the new branch without disturbing other refs or leaving
worktree changes.
`desktop:native-file-history` qualifies rename-following file history, bounded
history and blame pages, exact literal paths, timeout/cancellation handling,
and large-file blame navigation against the packaged application.
The CRLF-pointer regression first asks Git LFS to accept the pointer, writes it
as an unreachable Git blob, and verifies that cleanup retains the referenced
object and rejects a stale pre-pointer removal preview without changing HEAD or
index bytes.

LFS reference scanning spools small-blob requests to a private temporary file
instead of retaining every Git object ID in memory. Each Git inventory/content
phase has a 120-second deadline; cancellation and parser failures terminate and
reap its process group before returning. Core tests reject malformed, truncated,
out-of-order, oversized, and extra batch responses, and check inherited-pipe
timeouts and owned temporary-file cleanup. Packaged acceptance separately blocks
each phase in an owned Git wrapper and requires cancellation to finish within
two seconds while the gate remains closed, with the child reaped and cached
object bytes unchanged.
The five preliminary Git/LFS metadata checks use the same monitored process
lifecycle, with a 15-second deadline and a 256 KiB output limit. Native acceptance
blocks each preliminary check separately and requires the same cancellation and
reaping guarantees. Clone settings use complete NUL-framed records: a partial
clone whose remote is named `false` is still refused, valid disabled promisor
booleans remain supported, and a failed configuration query is never interpreted
as proof of complete history. Both preview and reviewed removal must refuse an
owned injected configuration-query failure without changing cached bytes,
HEAD, or the index.
A failed metadata parent must also release any descendant holding stdout open
without waiting for the deadline. Core tests require buffered bytes and the
original nonzero status to survive cleanup, including Git config's exit 1 for no
matches. Packaged acceptance injects an exit-2 parent with an inherited writer;
both preview and reviewed removal must refuse within two seconds, with the
parent reaped, the descendant stopped, and all cached bytes unchanged.
Directory-swap acceptance separately holds Git's object inventory after local
cache discovery, replaces an owned cache directory with a link to an owned
outside sentinel, then resumes removal. The sentinel and the parked reviewed
object must both survive, and the operation must report an explicit refusal.
The outside sentinel has the same size as the reviewed object, so metadata
length checks alone cannot make this test pass.
Unix removal retains a handle to the common Git directory and walks each cache
parent relative to that handle without following links. Leaf metadata must
still describe an ordinary file of the reviewed size. Core regressions exercise
swaps at every cache directory level, replacement of the common-directory path,
leaf links, changed sizes, and directory traversal attempts. Linux regressions
also preserve support for execute-only ancestors and unreadable object bytes.
An additional real-Git regression replaces a stored pointer with an ordinary
blob, proves that normal Git reads hide the pointer, and requires cleanup to
retain its cached content anyway. The packaged scenario also verifies that the
replacement ref, HEAD, index, and all cached bytes remain unchanged.

`native-smoke` checks the production CSP, terminal font and ANSI/true-color
rendering, graph layout, selection, lazy dialog styles, saved-tab restoration,
native snapshot transport, workspace-menu outside
dismissal before mouse-up (without consuming the toolbar action), and asynchronous
untracked-file discovery and removal in the working-tree UI, including changes
made alongside an external branch checkout. It opens an owned repository with
live and already-deleted loose and packed checkpoint refs, shows checkpoint
history, and checks that deleted refs and their otherwise-unreachable commits
are absent. External loose and packed ref deletions must refresh the graph.
Deleting a reviewed live checkpoint through the UI must preserve a sibling
ref, HEAD, the index, working-tree contents and all checkpoint commit objects;
moving a ref after review must refuse the stale deletion. The native harness
waits for the uniquely matching delete control to be visible, enabled and
hit-testable after menu positioning, then sends one click without replay.
`native-full`
adds disposable Git repositories and verifies the implemented staging,
history, recovery, reference, worktree, submodule, patch, bundle, mail,
remote, signing, and LFS workflows, plus retained history pages across metadata
refreshes with an exact Git history comparison. Shallow-history checks retain
older parent objects locally and compare commit IDs and parent edges against
Git across pagination, deepening, and unshallowing, in both the main checkout
and a linked worktree. Missing objects, invalid compressed objects, and malformed
decoded commit objects must produce explicit history
errors, not successful shortened pages. The error persists on retry; restoring
the owned object and explicitly refreshing must recover all commits without
advancing the retained page count on failure. A native UI commit refused by a
hook is explicitly retried without dismissing its error. Commit Undo/Redo is
also exercised through the real toolbar, with Git HEAD, index, and working-file
assertions. `native-performance` uses 20,000- and
100,000-commit histories with 64 branches and 36 linked worktrees.

Shared-reference fixtures create local branches, remote-tracking branches, and
tags with matching names. Under both `core.warnAmbiguousRefs` settings, native
snapshots must retain namespace-relative names and the correct upstream. Tag
inspection and deletion use the returned name, while the local branch, remote
reference, HEAD, index, and working contents must remain unchanged.

The Linux transport-cancellation fixture exits an owned Git wrapper while a
same-process-group child keeps its output pipes open. Cancellation must still
finish in under one second, stop that child, and leave HEAD, index, and working
contents unchanged. Core Unix tests separately retain delayed stdout/stderr and
the original successful or failed parent status when no cancellation is requested.
These checks do not qualify Windows descendant termination after parent exit.

Remote-URL configuration validation is also part of the cancellable operation,
before Git starts a transport. A Linux core fixture blocks an owned configuration
FIFO; native acceptance separately holds the URL-validation query in the owned
Git wrapper. Cancellation must finish while that hold remains active, reap the
query, and leave HEAD, index, and working contents unchanged. No network fetch
or implicit retry is needed to release either fixture.

Clone-policy integration fixtures use private global/system configuration in
isolated subprocesses and allow only file transport. The native fixture blocks
HTTPS before presenting a synthetic credential-bearing rewrite, then requires
`credentialsInUrl` for global, destination, and remote-conditional settings,
without a leftover destination. A safe rewrite must still clone the owned source.
An owned wrapper separately holds clone's `--get-url` review: cancellation must
finish within one second while the hold remains active, reap the process, remove
only the reserved empty destination, and preserve source HEAD, index, and bytes.
Template fixtures separately require HTTP and SSH password rewrites to be
refused despite a configured `transfer.credentialsInUrl=allow`, while a safe
template's rewrite and marker file remain usable. HTTP username-only template
URLs remain outside this qualification; see the explicit boundary in
[authentication.md](authentication.md).

The Linux harness starts its driver and headless display in private process
groups. Teardown stops and waits for surviving group members even after the
leader exits, before deleting owned fixtures. Deterministic tests retain a
SIGTERM-resistant writer and require it to stop; another test refuses to signal
the test runner's group. If shutdown cannot be verified, the harness fails and
retains the fixture instead of racing its deletion. Cleanup errors are not
converted into passing acceptance results.

Native keyboard smoke checks compare ordinary Tab navigation from the main and
workspace menu buttons with Tab dismissal from an open menu. Focus must reach
the same outside control, not a removed menu item. Renderer checks additionally
cover Shift+Tab, the welcome screen's document boundary, reopening menus,
Escape restoration, and pointer-down dismissal without waiting for a click.
Busy-menu regressions additionally disable every workspace action both before
opening and after focus enters the menu, then compare Tab/Shift+Tab with normal
closed-menu focus order. A packaged native fixture starts a real renderer fetch,
holds only its owned Git process, and checks menu dismissal and focus while that
operation is still pending, without patching Angular state or the native bridge.

Core cursor regressions separately verify that failed metadata initialization or
refresh remains an error on subsequent page requests, even after metadata is
repaired, until an explicit refresh successfully initializes the cursor again.
They cover both the in-process and Git CLI initialization paths; these exact
failure points are not injected into the packaged IPC scenarios.

Control-character fixtures create ordinary commits containing field/record
separator bytes in author names, subjects, and bodies, including message text
shaped like a forged history record. Packaged checks compare commit IDs against
independent Git traversal and each affected field against a separate Git query
across initial loading, pagination, and refresh, with non-ASCII author text and
configured UTF-16 log output overridden by the UTF-8 transport. Core tests also
reject truncated,
duplicate, invalid-OID, and unframed records and check that malformed raw NUL
messages cannot inject history. An owned signature helper proves that configured
signature presentation is not executed by history loading or tip discovery.

Stash-label fixtures likewise preserve control characters and Unicode under
configured UTF-16 log output. They compare stack selectors, IDs, and labels with
independent Git queries, retain duplicate stash objects, and exercise rename,
apply, drop, and pop against exact owned contents. Deleting an externally created
long-label stash retains its complete object behind operation recovery; only the
display preview is bounded. Restoring its recovery branch must restore the full
saved file contents. Core checks separately reject malformed stash frames and
verify that stash listing does not execute configured signature presentation.

Stash deletion requires the selected object ID as well as its mutable stack
selector. Core and packaged IPC checks reject a shifted selector before recovery
capture or deletion. The packaged UI scenario uses an owned Git reference lock
to refuse deletion, checks that the confirmation and focused inline error remain,
then removes only that lock and explicitly retries. Renderer checks additionally
cover pending-action dismissal and duplicate-submit guards, repository navigation
before a reply, keyboard focus trapping/restoration, and long labels in a narrow
reduced-motion viewport.

Plain apply/pop and latest-pop IPC also require the displayed object ID. Owned
fixtures reject shifted selectors without changing files or index bytes, apply
an older selected entry without removing it, preserve conflict stages and the
stash on failure, and distinguish successful application from refused removal.
A configured owned merge driver adds a different stash during application; the
selected contents must still be applied and the changed stack must remain intact.
The native Pop button is separately exercised with an owned stash-reference lock:
the persistent warning must explain that changes were applied and must not be
applied again. Only explicit deletion completes removal after repairing the lock.
Renderer checks cover captured menu/palette repository ownership and later
inspection/navigation while an action's reply is pending.

Immutable stash-preview checks read an older selected object after another stash
has moved its ordinal. Message text, tracked/untracked file lists, and patches
must all describe that same object under UTF-16 log output, notes, and forced
colour configuration. A signed-looking owned stash first exercises a configured
verifier to establish the fixture, then proves preview does not run it and does
not label the object unsigned. SHA-256 fixtures separately inspect tracked and
saved untracked files. Core checks also bound large messages and refuse to infer
signature absence from incomplete headers; renderer checks ensure later file
inspection retains the selected object ID after metadata refresh.
The packaged UI separately displays the Unicode stash body, then opens a saved
file after an external stash store has renumbered the stack; the diff must still
show the selected stash's contents without component-state injection.
Older listed stashes absent from the loaded history open directly through the
external-summary path, which also uses explicit UTF-8 and suppresses presentation
output. Renderer coverage checks that this selection does not fetch unrelated
commit pages.

The full suite also exercises bulk-discard confirmation and capture creation,
refusal of partial discard after an external edit followed by reload and explicit
retry, restoring and staging a file
from an earlier commit, and saving edited conflict
output through the production UI. Independent Git/file assertions verify those
results; renderer-only tests separately cover delayed-reply races.
Packaged IPC checks also verify raw untracked-binary discard/recovery without
executing a configured text converter.

The earlier Debian candidate
`1b3c8b5274a25c56e5b52c6ff02bcc7780c209e8875b4be0beb705ef7eb4b180`
passed package verification and the complete headless native suite: 228
scenarios passed, including checkpoint deletion, stale-review refusal, editor
and file-tool workflows, and eight right clicks delivered only to the owned
Xvfb/application window. The candidate built from the source at `10c2866`
`1ce7f469980c33600572f8fec7e628a180e8184cfc750d5f59e28f6847befa46`
passes package verification and the complete headless native suite: 229
scenarios passed, including eight right clicks delivered only to the owned
Xvfb/application window. The report records the same package SHA-256. A later
test-only Clippy correction changes a package receipt input without changing
production code.

The later local Debian candidate associated with commit
`4438e93d15c18a18f6f6b5a7a6b3dd4df0857f96` has SHA-256
`a43736a8008bb57ddee6351361009e4e9a83797c2cf3309172341592337a516a`.
Its full headless report records `passed: true`, 229 distinct scenario names and
eight owned-window XTEST pointer deliveries on
`Linux-7.0.0-42-generic-x86_64-with-glibc2.43`, using Git 2.53.0. The report
sets `inheritedGitEnvironment: false`. Its retained location is
`files/native-4438e93d/full-1794158458131433925/report.json` in the session
artifacts, not a repository or CI artifact. At this review the retained `.deb`
was independently hashed and matches the report and completed Task receipt.
The packaged `usr/bin/git-khronos` bytes also match the report's executable SHA-256
`3f4d5a293f4ea7f117c9a992a6bb37aa0d76043ca9e1c1ecb08ab6ad9191f1a9`.
The session build checkpoint associates the package with the commit; the report
and receipt themselves contain no Git commit ID. The receipt records an input
checksum, not a source-revision attestation. This evidence does not qualify
later source changes or substitute for the separate inherited-environment,
GitLab catalogue and performance suites. It does not qualify the later
descriptor-guarded discard implementation described below.

The later completed
[GitHub run 42504326903](https://github.com/Git-Khronos/Git-Khronos/actions/runs/42504326903)
for that commit passed the focused Windows source-test job, Linux checks and
renderer acceptance, and packaged-native acceptance. At this commit the
Windows ignore selectors shared one PowerShell step, so the step's success
alone does not establish that each selector succeeded.
At this review `nx.json` had neither `nxCloudId` nor `nxCloudAccessToken`;
Nx Cloud monitoring was unavailable.
Because the workflow cancels an earlier run on the same ref, wait for that run
to finish before dispatching another. A new run for a later final commit must
retain its own package, report and source identity.

The subsequent
[run 42520781486](https://github.com/Git-Khronos/Git-Khronos/actions/runs/42520781486)
failed its Windows ignore-publication test and Linux recovery-permission test.
[Run 42521640442](https://github.com/Git-Khronos/Git-Khronos/actions/runs/42521640442)
passed the Windows source job and the Linux recovery-permission test, but its
Linux suite failed an ignore-publication outcome regression; packaged acceptance
was skipped. The follow-up restores the early unsupported-platform refusal and
the uncertain outcome for a destination linked to the staging file. A later
full CI and packaged run must qualify the exact source being released; the
earlier results do not qualify later commits.

A disposable Linux real-Git probe confirmed that replacing a parent directory
can redirect tracked deletion outside the worktree. Tracked deletion is now
refused on non-Windows platforms. Focused native Windows CI tests cover
ancestor-handle rename protection, tracked deletion and working-file previews;
the complete Windows application remains unqualified. An earlier real-Git
regression swaps an untracked file's reviewed parent for a symlink before Git
starts reverse-apply and confirms refusal with the outside file and index
preserved. That timing is not sufficient to qualify discard safety. In a
separate disposable Linux/Git 2.53.0 probe, `strace` delayed Git after reading
the file and immediately before the reverse-apply unlink; the reviewed parent
was then replaced by a symlink to an outside directory. The untracked-discard
case deleted an outside sentinel and Git exited 0; the tracked-discard case
also deleted the outside sentinel and Git exited 128. This is a confirmed race
in the then-current Git `apply` implementation, not a safe outcome. The current
Linux source replaces that mutation path for root-level entries with held
worktree/recovery descriptors and descriptor-relative renames, refuses nested
paths and refuses discard on other platforms. Source regression tests
substitute links at the mutation boundary and check the outside file and index.
The new source is not qualified until final CI and packaged acceptance; the
probe above remains historical evidence for the superseded implementation.
See the capability audit.

Tracked and untracked working-directory comparisons likewise preserve raw text
and binary previews without executing converters. Large comparison previews are
explicitly truncated; the backend bounds collected diff stdout during the read,
rather than buffering the entire diff before trimming the response.
Untracked summary statistics use symlink target-path bytes without opening the
target. Native checks cover external, binary, directory, dangling, and newline
targets, plus non-UTF-8 text, empty/CRLF/binary files, and large streamed counts.
Binary-prefix checks cover NUL bytes immediately before and after Git's 8000-byte
probe boundary and beyond a streamed-read boundary, preserving later text counts.
Attribute scenarios cover forced text/binary, custom diff drivers without running
their text converters, inherited/info rules across a wide path set, and
files immediately below, at, and above a configured large-file threshold.
SHA-256 repositories have a separate native statistics fixture.
Index-only executable attribute files and attributes inside sparse-index trees
are checked without rewriting the original index or hydrating excluded files.
They also refuse linked recovery directories, patches, and existing or dangling
marker links, verify that external bytes and permissions remain unchanged, and
exercise recovery, redo, and deletion after the invalid entries are repaired.
Ignore-file scenarios preserve existing non-UTF-8 rules, refuse linked rules or
another writer's lock, retry after lock removal, untrack only the selected literal
filename, and leave rules unchanged when Git refuses to untrack staged contents.
Operation-storage scenarios retain external data when rebase support is linked,
refuse starting rebase or controlling a split through redirected support, and
keep native Abort available. Linked or dangling no-commit journals refuse before
replay/control; repairing the owned journal permits a normal explicit Abort.
Literal-file scenarios use wildcard-, bracket-, and Git-magic-looking filenames.
They restore only the selected path while preserving dirty neighbours and their
index entries, and isolate commit/stash previews, comparisons, and file history.
Selected-stash scenarios roll back both names of a rename in ordinary and
staged-only modes, including literal pattern and newline filenames. They preserve
unselected staged/working contents, refuse visible or ignored data occupying the
old name, verify keep-index capture and restoration from the original base, and
check that the explicit restore-index option overrides repository configuration.
An unselected non-UTF-8 untracked filename remains in place when selected stashing
includes untracked files; scope exclusions use raw Git filenames, not display text.

The packaged smoke suite also deletes an owned untracked binary file from
Repository files, locates its filename in Recovery History, restores its exact
bytes, and removes the capture through the UI. It checks dialog focus, the
unchanged index and HEAD, and refuses applying or removing a capture changed
after review, without injecting component state. It also checks that a replaced
recovered capture is marked for review and cannot be discarded again.

Each run writes a JSON report, screenshots, and driver output below
`test-results/native/`. Reports include the package and executable SHA-256
digests, platform, Git version, scenario list, and performance timings where
applicable. Repositories, application data, global Git configuration, and
signing material live in a disposable directory.

Native terminal fixtures also use a disposable home and `/bin/sh`, without
inherited `ENV` or `BASH_ENV` startup scripts. Read-only requests and element
lookups have a two-second transport retry window; the initial request retains
its normal timeout. Clicks, navigation, and action scripts are never automatically
repeated after an ambiguous transport failure. Session creation retries only a
refused connection, never a lost response that may already have launched the app.
Read-only wait predicates tolerate
document replacement, and reload waits for a new document identity before
checking restored UI state.
Visible-control actions additionally require a nonzero viewport intersection,
an enabled non-inert control, and a center-point hit test before issuing one
native click. A failed or ambiguous click is retained as a failure, not replayed.

Terminal acceptance executes Git in the actual PTY, checks its selected working
tree and staged bytes, and verifies owned shell PIDs disappear after natural
exit and after explicitly closing a shell that ignores HUP. New shells clear
the shared Git-context overrides while retaining PATH, user Git configuration,
and SSH-agent settings. Shell startup files remain under the user's control.
Backpressure acceptance fills an owned stopped shell's raw PTY input buffer,
then opens, resizes, and writes to another terminal while the first write is
pending. Closing the blocked terminal must finish promptly, reap its shell, and
settle the pending write. Renderer tests separately verify per-tab input order,
close/write races, and cancellation of queued suffixes after a write failure.
Renderer close-failure fixtures reject the close reply and verify the screen and
tab remain available, the error is announced, retry targets the failed tab even
if another tab is active, and pre-close queued input is not sent afterward.
These deterministic reply failures are renderer coverage, not a claim that a
native process-termination failure was induced.
Native Rust fault-injection tests separately retain real, test-owned child
handles across status, kill, and wait failures, then explicitly retry cleanup.
A controlled per-child lock verifies concurrent cleanup does not hold the shared
registry. Exit notification is gated on both completed output handling and a
reaped child, with one notification claim across competing cleanup paths. The
packaged-app fixture captures actual terminal events, requires complete final
output before a single exit event, and checks that the owned PID is gone.
Renderer startup fixtures fail add-on initialization and partially completed
mounting, then verify disposal, native close requests, preservation of other tabs,
and explicit retry. Cleanup-refusal fixtures retain the failed startup ID and
block another startup until cleanup succeeds; repository teardown also retries
that outstanding session. A packaged-app fixture injects a one-shot DOM append
failure without production test hooks, captures the real owned shell PID before
the test-owned launcher execs `/bin/sh`, and verifies that error handling reaps it
before offering a successful fresh startup. The native bridge is not replaced;
the launcher's PID record and the native registry are checked independently.

Authentication renderer tests cover interrupted listener registration, rejected
teardown, pending-request recovery, initial snapshot failure, cross-prompt reply
races, cleared credential inputs, and failed cancellation. The native fixture
uses the normal event API with fixture-only unavailable request IDs and dummy
input: it checks that the real broker's refusal does not trap the modal, lose the
next prompt, or falsely report confirmed cancellation. It asserts that the native
pending list is empty before and after; no real authentication request is consumed
and this fixture is not live remote-account authentication proof.

A separate packaged-UI scenario clicks Push in an owned repository whose real
Git pre-push hook calls the shipped askpass helper, accepts a dummy passphrase,
and refuses the push. The native dialog must close and show push-rejection
guidance rather than an authentication failure, without exposing the dummy
value. Local HEAD, the index, working-file bytes and the remote tip must remain
unchanged. This qualifies the packaged prompt/error path; actual server
authentication and divergent-history rejection are covered separately by the
loopback SSH integration test.

Another packaged Fetch scenario uses missing local remotes whose names contain
`certificate`, `ssl`, or a certificate-error phrase. It must show general
transport guidance, never a false HTTPS certificate warning, and preserve local
HEAD, index and working-file bytes. Real HTTPS certificate refusal remains a
separate transport integration check.

A separate Fetch scenario covers missing local target names containing
authentication, SSH host-trust and push-rejection phrases, including an embedded
quote. It requires general transport guidance with no pending credential request
and the same independent local-state preservation checks. Unit controls also
verify that quoted targets cannot override a genuine security or Push failure.

Renderer tests write to `test-results/renderer/`; native evidence stays in
`test-results/native/`. Playwright clears its output directory before a run,
so keep independently retained audits in sibling directories, not inside the
renderer output directory.

Pull requests run the smoke suite against a newly built package. Pushes to
`dev` run the full suite. Manual workflow dispatch can run full or performance
acceptance. CI artifacts retain both the tested package and its evidence.

## Local discard-selection qualification (2026-11-14)

The source at base commit `71997b497a896751853e1328e563788878b40075` passed
`pnpm exec nx run desktop:e2e --args=e2e/renderer/discard-recovery.spec.ts`
(42 tests) and `pnpm nx run desktop:check`. `pnpm nx run
desktop:package-deb` built and verified
`Git-Khronos_0.1.2_amd64.deb` with Task source checksum
`59cf5977acd0b2f257b6f3fb0c6be21c`. The package SHA-256 is
`5984b473872aacca34f11c2112da619e4904b3bb0684a3f6875316f97ed76228`;
the extracted packaged executable SHA-256 is
`0401326a116fd53c260aefb81be3efa155b81c9d36a09665d32bab308ec96cdf`.
The package was extracted, not installed.

The extracted application was exercised through its actual UI with XTEST input
on a private Xvfb display, private D-Bus session, isolated HOME/XDG directories,
and a disposable repository. Mixed root/nested discard was refused without
changing the worktree or index. Pointer and keyboard selection left only the
chosen root file selected; a fresh native preview listed exactly that file and
made no changes until its separate confirmation. The confirmed discard created
a recovery capture, and the UI recovery restored the file. The nested-only
request also surfaced a refusal. Across these operations, staged content and
index, HEAD, unrelated files, and blocked nested contents were preserved.
Sanitized screenshots are retained under the session files as
`discard-sprint-*.png`.

The repository's WebDriver-based native suite was not run: `tauri-driver` and
`WebKitWebDriver` are unavailable, and Python AT-SPI bindings are also absent.
The isolated XTEST run verifies the requested discard UI workflow, but does not
replace full native-suite or accessibility-tree coverage. The production build
also emitted size-budget warnings for the initial bundle and
`app.component.scss`; packaging and verification succeeded.

## Evidence boundary

Production renderer builds must exclude development URL scenario initializers
without increasing the initial-bundle budget. The asset check refuses missing
output and scans every emitted JavaScript chunk for development-only query keys;
ordinary browser sample data remains supported. Native acceptance additionally
reloads an owned three-commit repository with comparison, diff, co-author, and
conflict preview parameters. Those parameters must not create inspections, edit
the commit draft, or change HEAD, index bytes, or working-file contents.

Diff-layout acceptance uses real before/after Git revisions and checks the same
visible new-source line across Hunk, Inline, and Split views, both wrapped and
unwrapped. Toolbar focus, HEAD, index bytes, and working-file contents must stay
unchanged. Reports retain per-layout pixel offsets and screenshots. Renderer
regressions separately cover keyboard layout navigation, manual reading positions,
large fonts, stacked panes, reduced/normal motion, newer navigation overriding
queued restoration, and closing/reopening before rendering. Wrapped-row anchoring
must release on real wheel input and stop scheduling corrections at a clamped
scroll boundary or after closing the viewer.

Blame acceptance separately holds both the legacy and paged Git reads open while
unrelated native controls and renderer probes must remain responsive. A real
100,000-line Unicode fixture checks exact first/middle/final ranges, immutable
attribution, and 100 rendered rows after navigating with the visible Next control.
HEAD, index, and working-file bytes must not change. Renderer coverage additionally
checks initial failures versus empty results, retrying a failed page without
losing the current page, stale-request ownership, large line-number visibility,
compact layout, and keyboard horizontal access to long source lines. New blame
pages cap each pipe at 2 MiB; the compatibility full-file reader caps each pipe
at 16 MiB. Both use the existing 15-second history deadline and refuse incomplete
data rather than claiming complete attribution.

On Linux, Tauri's driver creates the WebDriver session and owns the native driver
process. Before creating the session, the harness checks that the proxy accepts
a connection and waits for a positive status directly from WebKit. The proxy
and native driver are assigned distinct ports. Session creation still goes
through Tauri for capability translation; subsequent commands go directly
to the same native WebKit session. Reports
record this route as `webdriverTransport`. Lost mutation replies still fail the
run: no session creation, click, script, or navigation is replayed after an
ambiguous disconnect.

Commit-preview acceptance configures UTF-16 log output, notes, signature display,
and colour in an owned repository. The native UI must display the selected
Unicode message and unsigned status correctly. Legacy and paginated file-history
IDs are compared with an independent Git query; control characters in the author
and subject must remain text, not become extra records. Repository search must
retain Unicode subjects under the same settings. A separate real SSH-signed
commit must retain both its Unicode body and a valid verification status.
These read-only checks also verify that the preview fixture's HEAD, index bytes,
and working-file contents remain unchanged.

Legacy file-history acceptance uses an app-only Git wrapper to hold one owned
repository's `--follow` read open. Before releasing it, an unrelated native
command and a renderer-state read must complete in under two seconds. An
independent release thread prevents a regressed UI-thread reader from hanging
the test indefinitely. The wrapper does not affect the independent Git oracle,
other repositories, or commands without `--follow`. A changed-tree, unreferenced
commit with an oversized subject separately checks the real IPC output-limit
error, with no large subject inserted into the visible graph. HEAD, index bytes,
and working-file bytes must remain unchanged. The legacy preview retains its
existing 200-commit cap, adds a 2 MiB cap per output pipe and a 15-second read
deadline, and rejects overflow rather than returning a partial list.
A separate held read must return the native timeout before a 20-second fixture
fallback releases the gate, with the recorded owned Git PID already reaped.

The setup-keyboard suite also exercises local branch renaming through the real
command palette and context menu. Modifier shortcuts must not submit a pending
rename or commit the staged draft. Explicit palette rename and context-menu
rename-back must change only the reviewed branch reference, preserve the index,
config and dirty files, and leave the commit-attempt hook marker absent. The
palette dialog must display its checkout and initially focus the name field.

Palette-rename shortcut acceptance additionally checks actual Enter-key default
cancellation. The report retains each chord's delivered modifier flags, target,
final default-prevented state, focus/submit events and independent checkout
footprint before proceeding to the next chord. A failed chord is never replayed.
This distinguishes a browser-default submission from a lost modifier or focus
change without treating an absent final dialog as the complete diagnosis.

The inline WIP stash-message editor has a separate owned-fixture gate. Ctrl+Enter
and Ctrl+Shift+Enter must preserve dirty/index/reference bytes and the commit
draft; ordinary Enter must create one stash containing the exact staged tree,
working blob and untracked blob, without moving HEAD or running the normal
commit hook. This native gate does not emulate a physical IME; composition and
repeat-event flags have separate renderer coverage.

The setup-keyboard suite also runs the five advanced stash review entry points
in an owned repository. Saving must retain distinct staged, unstaged and
untracked contents in the actual stash parents while leaving HEAD unchanged.
Index-restoring apply must reproduce the original index tree and working bytes;
selected-file apply must leave index bytes and the stash unchanged and exclude
the other saved file. Branch-from-stash must preserve the original stash while
restoring its state, and stash-before-switch must retain both old and newly
saved work. The oracle also checks configuration, HEAD and a refusing commit-hook
marker. Test-only owned-file resets separate cases; no app action is replayed.

The setup-keyboard suite additionally exercises explicit fetch and linked-worktree
reviews. With only owned local remotes, ordinary fetch must update the branch
without importing tags or pruning an obsolete tracking ref; explicit prune must
remove that ref without changing local heads/tags or dirty/index/config bytes.
A file-transport depth-one clone must deepen by exactly one commit, then complete
its history to match the owned remote, preserving its checkout data throughout.
Actual move and external-move repair must preserve both dirty checkouts, linked
index bytes, untracked and ignored files, and source configuration. The repair
oracle checks the final registration path separately from working bytes. This
does not qualify a physical directory chooser; picker races have renderer tests.

The setup-keyboard suite also verifies the Unstaged Files line recap through the
packaged UI. An independently constructed fixture contains different staged and
unstaged replacements, a deleted tracked file, untracked text without a final
newline, and binary data. The initial recap must be +4/−3 with one uncounted
binary file and no checkout/index/config changes from reading it. Explicitly
staging the mixed tracked file must change the recap to +2/−2 without moving
HEAD or other references or changing working bytes. This checks index-relative
counts rather than reusing HEAD/commit totals. A separate intent-to-add rename
with one edited line must show +1/−1 unstaged and +0/−0 staged, without
changing the index. Core tests also check a pure rename and deliberately
different repository rename preferences. The installed check then adds one
line externally without changing the porcelain record and expects +2/−1
without any click or index write. Renderer tests separately isolate the
periodic/focus-refresh fallback from live watcher notifications.
`desktop:native-working-tree-recaps` runs this UI workflow as focused packaged
CI coverage and also checks independent staged/unstaged budgets and oversized
status output without counting unresolved conflicts.
The rename fixture also reviews the staged and unstaged diffs and stages and
unstages the pair through the file row. Both previews must show the original
name and +2/−1, with no hunk or line mutation controls. Git must show one staged
rename and, after unstage, both unstaged path changes; checkout bytes, HEAD,
unrelated refs and configuration remain unchanged.

The remote-review suite additionally exercises all six tag/remote-reference
review actions through their actual UI. An owned annotated tag is pushed,
renamed locally and remotely after a fresh exact-object check, deleted remotely,
then deleted locally with recovery retained. An owned remote branch is renamed
and deleted without moving local heads. The independent oracle checks original
tag-object identity and unchanged dirty files, index/config and staged draft;
a refusing commit hook records any accidental commit attempt. Modifier shortcuts
in the rename field must not submit or open background commands. Every remote
is an owned local bare repository; no hosted reference is written.

`pnpm nx run desktop:native-environment` runs the full native suite with inherited
repository-routing, legacy `GIT_CONFIG`, and pathspec overrides pointing at
another owned fixture.
The independent Git oracle keeps its clean environment; only the application
process and driver inherit the overrides. A distinct outside identity must not
shadow the selected repository's native identity. The outside fixture's HEAD,
index, config bytes, and working contents must remain unchanged. Conflicting
outside attributes expose cross-worktree attribute lookup even if an index fallback would otherwise hide
it. This is separate from ordinary full and performance acceptance.

Passing headless acceptance proves behavior of the extracted production
package in WebKitGTK. It does not prove system installation, desktop-entry
integration, distribution-specific packaging beyond the runner, hardware-key
interaction, or a real hosted Git service. Those remain separate manual or
environment-specific acceptance steps.
