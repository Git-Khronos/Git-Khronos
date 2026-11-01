# Non-text and image comparison

## Requirement and provenance

Repository file inspection must show useful before/after content for images and
truthful metadata for other binary files. Detection follows file bytes, not only
the filename. GitKraken Desktop's public release notes describe a correction for
extensionless image detection; the public diff guide establishes commit, index,
working-directory and selected-revision comparison contexts. Those public facts
inform this requirement. No proprietary executable, implementation, screenshot,
asset, distinctive wording or layout is an implementation source.

Sources:

- https://help.gitkraken.com/gitkraken-desktop/current/ (12.1.2 image-detection entry)
- https://help.gitkraken.com/gitkraken-desktop/diff/
- https://git-scm.com/docs/git-cat-file
- https://git-scm.com/docs/git-ls-tree
- https://git-scm.com/docs/git-ls-files
- https://git-scm.com/docs/git-stash

## Observable behavior

1. Selecting a file can inspect the exact sides represented by its comparison:
   a commit and its first parent (or an absent side for a root commit), two
   selected revisions, a revision and working copy, HEAD and index, or index and
   working copy. Stash inspection must select the relevant stash parent and
   untracked tree rather than accidentally inspect the current worktree.
2. Renames retain the original source path on the before side. Additions and
   deletions show an absent side. A changed extension does not change detection
   of the same bytes. Literal path characters, spaces and non-ASCII names work.
3. Regular raster images expose before/after previews, byte lengths, detected
   type and dimensions. Begin with PNG, JPEG, GIF, WebP, BMP and ICO; verify each
   against actual Chromium and packaged WebKitGTK. A recognized but invalid
   image reports a decoding failure. It never becomes an empty successful view.
4. SVG retains its text diff and can offer a separate image preview only after
   its inert rendering and external-resource restrictions are proven. Unsupported
   formats remain explicitly identified as unsupported rather than misrendered.
5. An original Khronos comparison panel provides readable side labels, a fit
   view, zoom and keyboard-operable comparison controls. Side-by-side and
   single-side views accommodate different dimensions and compact windows.
   Existing text diff, history, blame and applicable file actions remain reachable.
6. Other binary files show changed/added/deleted state, exact known byte sizes
   and available content identities. Partial reads are labeled incomplete. No
   binary content is presented as an editable UTF-8 document or a text hunk.
7. Git LFS pointer content is distinguished from an image. A preview performs
   no implicit fetch or materialization. Any use of an existing local LFS object
   validates its declared identity and length before displaying it; unavailable
   objects receive an explicit explanation and the existing explicit LFS action.
8. Inspection never writes the index, refs, worktree, Git configuration or LFS
   cache, and never starts configured filters, external diff tools or textconv.
   A symlink's stored link content is inspected without following it. Submodule
   gitlinks remain in their existing submodule workflow.
9. Native requests bind a registered repository session and validated comparison
   identity. Untracked filesystem reads remain under the repository root, refuse
   non-regular files and changed path identities, and stay bounded. Blob reads
   verify object type and length. Arbitrary paths or executable Git expressions
   cannot enter through a file selector.
10. Byte and decoded-pixel budgets are explicit. Oversized content and excessive
    dimensions produce a visible refusal with actual metadata, never a truncated
    image passed off as complete. Cancellation reaps owned processes, stale
    replies cannot replace a different file/repository, and load errors retain
    enough selection context for an explicit retry.

## Independent implementation and acceptance

Use Git plumbing for immutable tree/index blob identity and bounded local reads
for regular working files. Keep binary payloads out of general repository
snapshots; load them only for the selected comparison. Native type contracts
carry explicit side state, identities, size/type/dimension metadata and bounded
image content. Choose project-native components and existing design tokens.
No new dependency or graphical asset is approved by this specification alone.

Create owned fixture bytes from public format specifications, including images
with misleading names and no extension. Compare selected blob bytes and object
identities against independent Git output. Cover root/merge commits, stashes,
renames, deletions, staged-versus-unstaged differences, empty and malformed files,
truncation, symlinks, LFS pointers, repository switches and cancellation. Assert
unchanged Git state and dirty bytes. Renderer fixtures must exercise decoding,
keyboard navigation, scaling, compact layouts and failure recovery; packaged
acceptance must use real native commands and actual image decoding.

## Current state

The existing diff DTOs still carry patch text and truncation only. The original
`file_content` core now reads a selected immutable revision/tree, index entry or
Unix working file without modifying repository data. It distinguishes absent,
regular, symbolic-link, submodule and unmerged sides. Blob identity/type/size and
the selected index entry are checked; oversized payloads expose their exact known
length without returning partial bytes. Working reads use directory-relative
handles, refuse symlink ancestors and special files, and check the selected path
again after reading. Link content is read without opening its target. Literal
UTF-8 names include wildcard characters, spaces, tabs and newlines.
Payloads are bounded to 8 MiB per side, Git entry metadata to 64 KiB, and input
paths to 16 KiB. File bytes are excluded from the type's debug output and are not
added to the general repository snapshot or serialized automatically.

Every Git inspection uses `--no-lazy-fetch`. Unsupported Git versions fail closed
rather than fall back to fetching; compatibility with older Git remains open.
The partial-clone fixture proves that an ordinary Git read would call its owned
local upload helper, while this reader leaves both the missing object and index
unchanged. No provider or external network is involved. No new dependency or
asset is introduced.

All eleven focused cases and the complete core suite pass: 684 tests, with 37
intentionally ignored. All-target core Clippy passes with warnings denied. The
first Clippy attempt found one needless borrow in a test; after correction the
focused cases and Clippy pass again. The production reader did not change after
the complete core suite passed. A follow-up root guard refuses Git metadata
directories as working-file roots while preserving historical blob reads from a
bare repository; its focused cases, full core suite and Clippy pass.

The independent comparison resolver now selects commit/first-parent, explicit
revision pairs, revision/working-copy, HEAD/index and index/working-copy sides.
It reads commit header parents rather than inferring a root from a shallow walk.
Stash comparisons distinguish the saved base, index, working tree and optional
untracked tree. Renames retain their selected original path. Missing objects are
explicitly unavailable on the affected side while a readable counterpart remains
available; they are never represented as an absent file or substituted with
current working bytes. Mutable selections are checked again after bounded reads.
Cancellation ends the whole request. Comparison metadata and file reads share
the fetch-free Git runner and working-root guards.

The comparison checkpoint passes 25 focused file-content/comparison cases and
all 695 core tests (37 intentionally ignored). All-target core Clippy passes with
warnings denied. Earlier Clippy failures were a collapsible conditional and were
corrected before this final run; failed attempts remain in validation artifacts.

### Media source implementation (qualification in progress)

The next independent slice adds `inspect_file_media`, bound to a registered
repository session, a typed comparison request and a cancellable operation ID.
It reads on the native background executor and returns explicit side states.
Staged rename sources are discovered from Git's bounded rename output, including
when the desktop row has no original-path field; stale original-path hints are
refused. File and LFS byte lengths use decimal strings in media responses so the
JavaScript boundary cannot round large values.

The reviewed MIT `imagesize` 0.15.0 dependency probes dimensions for PNG, JPEG,
GIF, WebP, BMP and ICO, with only those features enabled. The already locked
MIT/Apache-2.0 `base64` 0.22.1 dependency encodes original selected raster bytes.
No image is transcoded, and EXIF metadata is retained. The Rust notice collector
successfully includes their complete published license notices. The fixture
images and their reproducible pixel-generation script are project-created.

A raster response requires complete bounded bytes and valid, nonzero header
dimensions. The current preview limits are 8 MiB per side, 16,384 pixels per edge
and 40 million header pixels. Header inspection does not establish complete
image validity or a hard allocator limit inside an operating-system decoder.
The renderer reports actual decoding errors and also checks natural decoded
dimensions before accepting the display. Missing, absent, binary, text, over-limit,
symlink, gitlink, unmerged, unavailable and LFS pointer sides remain distinct.
SVG remains text. The preview neither fetches nor materializes LFS objects;
validated previews from existing local LFS objects remain open work.

The original Content view sits alongside Diff, History and Blame. It provides
before/after metadata, both-side and single-side views, fit/actual size, bounded
zoom, scrolling, keyboard-operable controls, cancellation and retry. Changing or
closing the selection cancels the owned request and rejects late replies. Only
bounded raster data URIs from a closed MIME allowlist reach image elements;
external URLs, HTML and SVG preview URIs are refused without requesting them.

The initial 14 Chromium cases pass, covering all six actual decoders, EXIF
orientation, zoom/side controls, malformed bodies, missing sides, cancellation,
late replies and compact layouts. Visual review found clipped file-view controls
at 360px; their sizing and stronger viewport-bound assertions are being qualified
in the expanded 18-case run, which also covers 320px layouts and disallowed URI schemes/formats. The compact toolbar now uses three rows to keep both file views and diff layouts reachable.
An initial generator mismatch exposed missing explicit camelCase field renames;
it was corrected in Rust and bindings regenerated. A separate initial fixture
loader failed under the CommonJS test configuration before running any cases;
the project-relative loader replaces it. Those failed attempts are retained.

The full workspace source gate passes 746 Rust tests and 166 frontend cases,
including exact decimal LFS lengths and stale staged-rename refusal, with 45 Rust
cases intentionally ignored. Generated contracts and all-target Clippy pass.
A separate overlapping core run failed because its owned blocking-hook fixture
was never reached; the same case passes in the full workspace gate and a later
isolated run without a production change. That failed attempt is retained and
is not counted as passing evidence; its cause is not established.

The final expanded Chromium run passes all 18 cases, including every visible
toolbar button's bounds and non-overlap at 320, 360, 700 and 1440px. Its compact
screenshots were inspected. The complete source gate preceded the final compact
stylesheet corrections; the final focused run compiles and exercises those
corrections without a subsequent Rust/TypeScript runtime change. Exact-package
native acceptance and the complete renderer suite remain pending. The native harness includes original scenarios for six real
WebKit decoders, byte oracles and malformed-body failure, but no packaged result
is claimed until they execute successfully. The working-file reader currently
requires Unix directory handles; containment and runtime acceptance on other
platforms, older Git compatibility, SVG previews and local LFS object previews
remain open. The Content view currently follows selected patch retrieval; a
standalone content entry and recovery when the preceding patch cannot load
(including missing/promised objects) remain open. Fetch-free guarantees here
cover the new Content reader, not all existing text-patch retrieval paths. This slice does not complete the broader parity inventory.


### Direct content entry candidate

File context menus now offer an independent content dialog for commit, revision
comparison, revision-to-working-copy, saved-work, staged, unstaged and conflicted
selections. Opening a working-file context menu no longer starts patch retrieval;
View changes remains an explicit action. The content action freezes the selected
repository, paths and revision pair at menu opening, refuses a stale repository
session, and closes on repository switching. The dialog traps keyboard focus,
restores its opener when appropriate, and cancels its reader on destruction.
Both content entry points load lazily within the existing production size budget.

The candidate passes 166 unique frontend unit cases and six focused lifecycle,
keyboard and deferred-loading renderer cases. A broader 87-case run and new
packaged direct-entry acceptance are pending. Native cases use owned fixtures
and ordinary menu actions; a missing promised base object is paired with a
readable working image and a local fetch sentinel, whose effectiveness is checked
separately with ordinary Git. No native result is claimed before execution.

The preceding media-only package, SHA-256
`5bea9f4f60d4fb82e59052cd458dfffaed7e9669f87b920a4f64adc51ee0c1f5`,
passes 185 normal and 186 inherited-environment native scenarios (371 executions),
including six actual WebKit decoders and malformed-body feedback. Its full
1,327-case renderer run finished with 1,326 passes and one real narrowed-pane
toolbar overlap; integration is held pending correction. These results belong to that artifact;
they do not qualify the new direct-entry candidate or establish full parity.


### Narrowed-pane correction and retained attempts

The full media-only renderer run caught a real layout failure at a 780px window:
the inspector reduced the center pane enough for the Diff control to cover Split.
It passed 1,326 cases and failed that workflow. Its 371 passing native executions
remain artifact-specific evidence, not a successful full UI qualification.

The direct-entry package, SHA-256
`f36908fe4b2a576b80b80ee65d62b56c9e427f71c309e532f2d639c56ec0849e`,
passes 188 normal and 189 inherited-environment native scenarios (377 executions),
including direct staged/unstaged entry and an unavailable promised base with a
readable working image. A separate ordinary Git control activates the owned
local fetch sentinel; direct preview does not. The same toolbar defect applies
to this package. Its in-progress full renderer run was intentionally stopped
with terminal status 143 after that shared defect was established. Neither old
package qualifies the corrected final UI. Failed/interrupted results are retained.

The correction selects three toolbar rows using the actual center-pane container
width rather than the window width, lets the header determine its height, and
reserves enough space for the Graph label beside the filename. Seven focused
cases pass, including the originally failing workflow and strengthened control
bounds, non-overlap and filename separation at 320, 360, 700, 780, 1051 and 1440px.
A widened 22-case sweep now passes, including the original failing workflow,
normal text-diff navigation and selected-line actions, actual button hit testing,
pane bounds, non-overlap and filename spacing from 320px through 1920px. It also
found and corrected two wider-pane overlaps at 1550px and 1600px: the two-row
breakpoint now allows the full action group, action groups wrap, and selected-line
controls receive enough header space. A new integrated artifact, its full renderer
suite and both native environment runs remain required before push.


### Corrected artifact and current renderer qualification

The corrected Debian package has SHA-256
`47e83c15899ac70a24e266bdd471db294589c87d866758d269b23e7264c1e5a5`,
with executable SHA-256
`767d39aee07e4fa06b32bd7f9ad51b12a458fc032dc1d86e4eeea066007d6607`.
Its runtime source is `aff66edccc1ba80701ccf24ed6ce858228e47ddd`; all 671 recorded
inputs matched at preservation. It passes 188 normal and 189 inherited-environment
native scenarios (377 actual executions), including six real image decoders and
three direct content-entry cases. These results belong to this corrected artifact,
separately from the preceding artifacts. The 159 native/core inputs remain identical
to the 746-case Rust source gate. The focused 22-case renderer sweep and final
typecheck pass; the existing production size budget was preserved.

The first corrected full renderer attempt passes 1361 cases and fails one outdated
keyboard expectation: the newly available Preview content action receives the first
ArrowDown, ahead of Stage. The test now verifies that focus explicitly and advances
to Stage with a second ArrowDown; five isolated repetitions pass without a runtime
change. The next full attempt passes 1360 cases but fails two trace-cleanup operations
with ENOENT. An assistant-launched recheck mistakenly used the same checkout/output
directory and cleared active Playwright traces. This was a validation infrastructure
mistake, not a successful full gate. The failed and interrupted attempts remain
retained; no assertion failure was observed in those two cleanup failures.

Named validation runs now receive distinct Playwright artifact/report directories,
and record actual checkout/branch/commit/status provenance. Eleven process-runner
regressions pass, including destructive-output isolation and refusal to overwrite
existing evidence. The fresh full renderer run from qualification source
`fcb5fb7f4de970788cc8c98a96651a772ac7b4a2` passes all 1362 cases with no retries,
finishing 2026-11-01 at 04:13:18 UTC. Its changes after the artifact are test
infrastructure and expectations only; app runtime stays frozen. This locally
qualifies the corrected Linux content checkpoint together with its 377 exact-package
native executions. The qualification documentation adds no runtime change.
Exact-commit remote CI remains separate and pending after integration. This
checkpoint does not accept the complete G08 inventory, other platforms, SVG or
local LFS previews.
