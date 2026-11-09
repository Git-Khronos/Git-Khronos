pub(super) const GENERIC_HINT: &str = "Resolve the Git error and refresh the repository.";

pub(super) fn recovery_hint(detail: &str) -> &'static str {
    let detail = detail.to_ascii_lowercase();
    if detail.contains("no space left on device") || detail.contains("disk quota exceeded") {
        return "Free space or resolve the quota on the repository and temporary-file volumes. Writes may have partially completed; preserve the current files, inspect repository status and refresh before retrying. Do not remove Git objects or recovery data to make space.";
    }
    if detail.contains("read-only file system") || detail.contains("permission denied") {
        return "Check filesystem permissions, read-only mounts and access to the repository and temporary-file directories. Preserve the current files and inspect status before retrying; do not run Git as another user or recursively change permissions as a shortcut.";
    }
    if detail.contains("file exists")
        && (detail.contains("unable to create") && detail.contains(".lock")
            || detail.contains("cannot lock ref") && detail.contains(".lock"))
    {
        return "Another Git operation may own this lock. Wait for it to finish, then refresh and retry. Never delete a lock while its owner may still be running. If an operation was interrupted, close other Git clients and confirm no Git process owns the lock before manually investigating it; preserve the index and working files.";
    }
    if detail.contains("index file smaller than expected")
        || detail.contains("index file corrupt")
        || detail.contains("bad signature") && detail.contains("index")
        || detail.contains("unknown index entry format")
    {
        return "Preserve a copy of the index and working files before investigating index damage. Do not delete or rebuild the index automatically: it can contain staged changes absent from HEAD and the working tree. Stop writing to this repository and obtain a verified recovery plan before retrying.";
    }
    if detail.contains("object file")
        && (detail.contains("is empty") || detail.contains("is corrupt"))
        || detail.contains("missing blob")
        || detail.contains("missing tree")
        || detail.contains("missing commit")
        || detail.contains("unable to read tree")
        || detail.contains("unable to read sha1 file")
        || detail.contains("loose object") && detail.contains("corrupt")
        || detail.contains("packfile") && detail.contains("does not match")
    {
        return "Stop write operations and preserve a copy of this repository, including working files and recovery data. Run a read-only integrity check with git fsck --full and identify the missing or corrupt objects. Recover from a verified backup or known-good object source; maintenance and pruning cannot restore missing data and must not be used as a repair shortcut.";
    }
    if detail.contains("input/output error") {
        return "Stop writes and check the storage device and filesystem for I/O failures. Preserve recoverable repository and working-file data before further Git operations. Inspect any partial changes and use a verified backup; do not assume retrying or maintenance will repair storage damage.";
    }
    GENERIC_HINT
}

#[cfg(test)]
mod tests {
    use super::recovery_hint;

    #[test]
    fn operational_failures_get_specific_non_destructive_recovery_guidance() {
        for (message, expected) in [
            (
                "fatal: Unable to create '/repo/.git/index.lock': File exists.",
                "Never delete a lock",
            ),
            (
                "error: cannot lock ref 'refs/heads/main': Unable to create '/repo/.git/refs/heads/main.lock': File exists",
                "Never delete a lock",
            ),
            (
                "fatal: unable to write new index file: No space left on device",
                "Free space",
            ),
            ("error: Disk quota exceeded", "resolve the quota"),
            (
                "fatal: unable to create index.lock: Permission denied",
                "Check filesystem permissions",
            ),
            ("error: Read-only file system", "read-only mounts"),
            (
                "fatal: index file smaller than expected",
                "Do not delete or rebuild the index",
            ),
            (
                "error: bad signature 0x00000000 in index",
                "Do not delete or rebuild the index",
            ),
            (
                "error: object file .git/objects/aa/bb is empty",
                "git fsck --full",
            ),
            ("fatal: loose object aabb is corrupt", "git fsck --full"),
            ("missing blob aabb", "git fsck --full"),
            ("fatal: unable to read tree aabb", "git fsck --full"),
            (
                "fatal: packfile .git/objects/pack/foo does not match index",
                "git fsck --full",
            ),
            ("error: Input/output error", "check the storage device"),
        ] {
            assert!(recovery_hint(message).contains(expected), "{message}");
        }
    }

    #[test]
    fn unrelated_errors_keep_generic_guidance_without_suggesting_repair() {
        for message in [
            "",
            "fatal: bad object not-a-revision",
            "fatal: destination path already exists",
            "error: gpg failed to sign the data: bad signature",
            "fatal: reference is not a tree: unknown-branch",
            "fatal: cannot lock ref: is at abc but expected def",
        ] {
            assert_eq!(
                recovery_hint(message),
                "Resolve the Git error and refresh the repository."
            );
        }
    }
}
