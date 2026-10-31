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

This is a core source checkpoint. Native commands, comparison-side selection,
image type/dimension detection and decoding, LFS/SVG handling, original desktop
controls and packaged acceptance remain open. The working-file reader currently
requires Unix directory handles; a contained reader and runtime acceptance for
other platforms remain required. This code does not establish an image preview
or completion of any non-text parity requirement by itself.
