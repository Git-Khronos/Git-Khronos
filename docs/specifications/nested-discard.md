# Nested whole-file discard

A user must be able to discard unstaged changes to an ordinary tracked file
inside a repository subdirectory. The operation restores the reviewed index
version, not HEAD. It does not unstage anything, and the discarded working
content must be recoverable through Discard Recovery.

The Linux x86-64 Git core now permits whole-file discard and recovery for
tracked nested files when the index contains a regular file and the working
copy is either regular or deleted with all parent directories intact.
On WSL2, the extracted Debian package passed UI checks for single-file and
bulk discard and Undo with the updated chooser
(`discard-subset-1795445805185205289`). It also passed deletion, Undo and Redo
(`discard-deletion-1795445796825116566`). Both reports use package SHA-256
`4e447edcacd8bc254349fa98b78c8d9b2d80556b6436579e89b333674f3b9b3f`.
The later portable package
`ef5a72e1db985a29edd22a3d2dcd450676ae75ffaabd6aa6921d08908054c026`
passed additional offline Ubuntu 26.04 checks using synthetic contents
at the CTI-reported paths. The four nested data paths totaled 68,584,155
bytes and recovered byte-for-byte after restart. Both bulk and single-file
discard restored the index version of
`API/clients/ng-cti-client/package-lock.json`; single-file discard left
the other nested working edit alone, and Undo restored the lockfile's
exact unstaged bytes. These tests did not modify or copy content from CTI.
The release gate now requires both of these path-specific regressions. The
same archive passed them on Ubuntu 24.04; combining those two reruns with
the unchanged evidence passed all 49 checks again. See
`target/local-review/jammy-shared-webkit.A2fc6Y/cti-path-release-gate.XFaUGl/verified.json`.
Regular nested untracked files use the same confined rename and recovery
checks. Raw files remain capped at 64 MiB each; the larger bounded capture
budgets account for encoded snapshots and the Git patch. Nested symlinks
and partial (hunk or line) discard remain unsupported. If a bulk request
is blocked, the chooser lists eligible paths returned by native preview,
including eligible nested tracked files. It requires a fresh preview of
the user's selection before any changes are made.
The path filter only changes which eligible files are shown. The chooser
reports any selected files outside the filter; those selections remain
included in the fresh preview unless explicitly cleared.
If every path in a whole-worktree request is blocked, the review lists the
blockers and offers a fresh eligibility check. It cannot be confirmed and
does not generate a recovery capture. A direct single-file refusal remains
an error, including its specific size limit when applicable.
Capture serialization streams JSON into the existing base64 header and
enforces the header and total capture budgets while writing. It does not
allocate a separate full JSON document or a second full encoded header.
Preview also stops collecting snapshots once their data alone would
exceed the header budget, and tells the user to review a smaller selection.
The nested eligibility pass inspects opened-file metadata without reading
or encoding the contents. The guarded snapshot still captures and checks the
actual bytes separately before the review can be confirmed.
The on-disk format and Undo compatibility are unchanged.
Native code remains responsible for the reviewed target and the mutation;
the renderer must not infer that a path is writable from its spelling.

## Native implementation boundary

The `DiscardBoundary` holds the worktree root and Git metadata descriptors.
Nested paths must qualify in both directions before a capture is issued.
Keep existing root captures readable and apply the same native ownership model
in preview, confirmation, and recovery. Do not fall back to an unguarded pathname-based
Git invocation if that model cannot establish write authority.

The implementation must also distinguish a pre-write refusal from an
uncertain result after an attempted write. In the latter case keep the
capture, refresh status, and require a new user decision instead of
automatically retrying.

On Linux the mutation helper uses
[Landlock](https://docs.kernel.org/userspace-api/landlock.html) write authority
granted to the worktree root, not independently to the selected parent. The
helper operates on directory descriptors and installs its restrictions
before attempting the rename. If the required policy cannot be installed,
it does not attempt the rename. Recovery capture preparation is separate.
An opt-in Linux test exercises the actual rename helper with a parent moved
outside the root, testing both move directions. Landlock alone does not verify
the destination identity, stage, or capture; those checks still belong to
the operation.

## Acceptance cases

- Given a tracked nested file with different HEAD, index, and working bytes,
  review and confirm discard. Only the working bytes become the reviewed
  index bytes; the index, HEAD, and unrelated files remain unchanged.
- Recover the discarded working bytes from the capture without changing the
  index. Cover literal names with spaces and non-ASCII characters.
- Restore a deleted nested file from the index when its parent still exists;
  Undo should remove it again, and Redo should restore it again. The core
  regression and the packaged deletion scenario cover this case.
- If the checkout, index, or reviewed file changes before confirmation,
  refuse the old review. Preserve external changes and any existing captures.
- A missing or substituted ancestor, symbolic link, or nested repository
  must not redirect a write. Validate containment at the mutation boundary,
  not only during preview: a retained parent directory descriptor alone
  does not prove that the parent is still under the selected worktree.
- Keep bulk review explicit about which paths are included. No partial
  mutation on a rejected preview, and no automatic retry of an uncertain
  mutation.

Verify on disposable real Git repositories, then through the packaged desktop
UI. Do not broaden eligibility beyond the tested file types and platforms.
