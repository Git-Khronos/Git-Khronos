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

The current diff DTOs carry patch text and truncation only. A code audit found no
dedicated image preview or binary metadata path. This document is a functional
specification; implementation, format coverage and runtime acceptance remain open.
