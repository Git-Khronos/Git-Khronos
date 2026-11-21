//! Index actions for a rename whose two literal paths have been reviewed.
//! Keep ordinary single-path staging unchanged; a rename is a separate intent.
use std::{io::ErrorKind, path::Path};

use super::{
    AppError, ensure_success, run_git, run_git_with_stdout_limit, run_mutation, without_lazy_fetch,
};

const MAX_REVIEW_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy)]
enum RenameSide {
    Index,
    Worktree,
}

fn stale_rename() -> AppError {
    AppError::new(
        "staleWorkingTreeRename",
        "The reviewed rename no longer matches Git's status. Neither path was changed.",
        Some("Refresh and review both paths before trying again."),
    )
}

fn matches_review(stdout: &[u8], source: &str, destination: &str, side: RenameSide) -> bool {
    let mut records = stdout.split(|byte| *byte == 0);
    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            continue;
        }
        let is_rename_or_copy = |code| matches!(code, b'R' | b'C');
        let index_grouped = is_rename_or_copy(record[0]);
        let worktree_grouped = is_rename_or_copy(record[1]);
        if !index_grouped && !worktree_grouped {
            continue;
        }
        // Porcelain v1 -z puts the destination first, then the source. If
        // both sides are grouped, it does not provide two independent pairs.
        let Some(previous) = records.next() else {
            return false;
        };
        if &record[3..] == destination.as_bytes() {
            let correct_side = match side {
                RenameSide::Index => record[0] == b'R' && !worktree_grouped,
                RenameSide::Worktree => record[1] == b'R' && !index_grouped,
            };
            return correct_side && previous == source.as_bytes();
        }
    }
    false
}

fn require_review(
    path: &Path,
    source: &str,
    destination: &str,
    side: RenameSide,
) -> Result<(), AppError> {
    if source.is_empty() || destination.is_empty() || source == destination {
        return Err(stale_rename());
    }
    let sparse = run_git(path, &["config", "--bool", "--get", "core.sparseCheckout"])?;
    if sparse.status.code() != Some(1) {
        ensure_success("check sparse checkout before changing the rename", &sparse)?;
        if sparse.stdout == b"true\n" || sparse.stdout == b"true\r\n" {
            return Err(AppError::new(
                "sparseRenameIndexUnsupported",
                "A grouped rename cannot be changed in a sparse checkout. Neither path was changed.",
                Some("Review and stage or unstage each path separately using Git."),
            ));
        }
    }
    let (output, truncated) = without_lazy_fetch(|| {
        run_git_with_stdout_limit(
            path,
            &[
                "--no-optional-locks",
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=no",
            ],
            MAX_REVIEW_BYTES,
        )
    })?;
    if truncated {
        return Err(stale_rename());
    }
    ensure_success("recheck the reviewed rename", &output)?;
    if !output.stdout.ends_with(b"\0") || !matches_review(&output.stdout, source, destination, side)
    {
        return Err(stale_rename());
    }
    Ok(())
}

fn require_literal_file_scope(
    path: &Path,
    source: &str,
    destination: &str,
    tree: Option<&str>,
) -> Result<(), AppError> {
    let mut args = vec!["--literal-pathspecs"];
    match tree {
        Some(tree) => args.extend(["ls-tree", "-rz", "--name-only", tree]),
        None => args.extend(["ls-files", "-z", "--cached"]),
    }
    args.extend(["--", source, destination]);
    let (output, truncated) =
        without_lazy_fetch(|| run_git_with_stdout_limit(path, &args, MAX_REVIEW_BYTES))?;
    ensure_success("verify the two literal paths of the rename", &output)?;
    // Even literal Git pathspecs also select descendants of a directory.
    // Refuse if either would change an unreviewed index entry.
    if truncated
        || (!output.stdout.is_empty() && !output.stdout.ends_with(b"\0"))
        || output.stdout.split(|byte| *byte == 0).any(|entry| {
            !entry.is_empty() && entry != source.as_bytes() && entry != destination.as_bytes()
        })
    {
        return Err(stale_rename());
    }
    Ok(())
}

/// Stages the deletion and destination of the explicitly reviewed worktree rename.
pub fn stage_worktree_rename(path: &Path, source: &str, destination: &str) -> Result<(), AppError> {
    require_review(path, source, destination, RenameSide::Worktree)?;
    require_literal_file_scope(path, source, destination, None)?;
    if !std::fs::symlink_metadata(path.join(source))
        .is_err_and(|error| error.kind() == ErrorKind::NotFound)
        || !std::fs::symlink_metadata(path.join(destination))
            .is_ok_and(|metadata| metadata.is_file() || metadata.is_symlink())
    {
        return Err(stale_rename());
    }
    run_mutation(
        path,
        &["--literal-pathspecs", "add", "--", source, destination],
        "stage both paths of the reviewed rename",
    )
}

/// Restores the HEAD index entries for both paths without altering working files.
pub fn unstage_index_rename(path: &Path, source: &str, destination: &str) -> Result<(), AppError> {
    require_review(path, source, destination, RenameSide::Index)?;
    require_literal_file_scope(path, source, destination, None)?;
    require_literal_file_scope(path, source, destination, Some("HEAD"))?;
    run_mutation(
        path,
        &[
            "--literal-pathspecs",
            "reset",
            "--mixed",
            "HEAD",
            "--",
            source,
            destination,
        ],
        "unstage both paths of the reviewed rename",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_the_raw_pair_and_refuses_copy_ambiguous_and_wrong_side_records() {
        let source = "before\t\n [*]";
        let destination = "after\n [*]";
        let status = |prefix| format!("{prefix} {destination}\0{source}\0");
        assert!(matches_review(
            status(" R").as_bytes(),
            source,
            destination,
            RenameSide::Worktree
        ));
        assert!(matches_review(
            status("R ").as_bytes(),
            source,
            destination,
            RenameSide::Index
        ));
        for prefix in ["RM", " C", "RR", "CR"] {
            assert!(!matches_review(
                status(prefix).as_bytes(),
                source,
                destination,
                RenameSide::Worktree
            ));
        }
        assert!(!matches_review(
            status(" R").as_bytes(),
            destination,
            source,
            RenameSide::Worktree
        ));
    }
}
