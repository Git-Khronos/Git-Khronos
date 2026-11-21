use super::{
    AppError, RepositoryStatus, StatusOverflow, ensure_success, file_statistics, git_cancellation,
    is_explicit_bare_repository, numstat_entries, parse_numstat, parse_porcelain_status,
    run_git_with_stdout_limit, without_lazy_fetch,
};
use serde::Serialize;
use std::{fs, path::Path, time::Duration};

const MAX_FILES: usize = 2_000;
const MAX_STATUS_BYTES: usize = 4 * 1024 * 1024;
const MAX_STATS_BYTES: usize = 4 * 1024 * 1024;
const MAX_UNTRACKED_BYTES: u64 = 16 * 1024 * 1024;
const RECAP_GIT_BUDGET: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeChangeSummary {
    pub additions: usize,
    pub deletions: usize,
    pub uncounted_files: usize,
    pub partial: bool,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct WorkingTreeSummaries {
    pub staged: Option<WorkingTreeChangeSummary>,
    pub unstaged: Option<WorkingTreeChangeSummary>,
}

/// Both recaps share one bounded status scan, and one side may still be
/// available if the other requires unreadable or missing local objects.
pub fn working_tree_summaries(path: &Path) -> Result<WorkingTreeSummaries, AppError> {
    inspect_recap(|| {
        let status = read_summary_status(path)?;
        Ok(WorkingTreeSummaries {
            staged: read_staged_summary(path, &status).ok(),
            unstaged: read_unstaged_summary(path, &status).ok(),
        })
    })
}

fn read_summary_status(path: &Path) -> Result<RepositoryStatus, AppError> {
    if is_explicit_bare_repository(path) {
        return Ok(RepositoryStatus::default());
    }
    // An unstaged rename can be one porcelain record, but two diff records
    // if rename detection is disabled there. Use matching policy on both reads.
    let rename_limit = format!("status.renameLimit={MAX_FILES}");
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "-c",
            &rename_limit,
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--find-renames",
        ],
        MAX_STATUS_BYTES,
    )?;
    if truncated {
        return Err(AppError::new(
            "workingTreeSummaryStatusLimit",
            "Git status exceeded the working-tree line count limit.",
            None,
        ));
    }
    ensure_success("read working-tree summary status", &output)?;
    Ok(parse_porcelain_status(
        &output.stdout,
        RepositoryStatus::default(),
        MAX_FILES,
        false,
        StatusOverflow::default(),
    ))
}

fn inspect_recap<T>(action: impl FnOnce() -> Result<T, AppError>) -> Result<T, AppError> {
    without_lazy_fetch(|| git_cancellation::inspect_within(RECAP_GIT_BUDGET, action)).map_err(|error| {
        if error.kind == "gitInspectionTimeout" {
            AppError::new(
                "workingTreeSummaryTimedOut",
                "Git took too long to count working-tree lines.",
                Some("Refresh the repository to retry."),
            )
        } else {
            error
        }
    })
}

fn skipped_renames(stderr: &[u8]) -> bool {
    let message = b"rename detection was skipped";
    stderr.windows(message.len()).any(|text| text == message)
}

fn complete_records(output: &[u8]) -> &[u8] {
    output.iter().rposition(|byte| *byte == 0).map_or(&[], |end| &output[..=end])
}

fn read_staged_summary(path: &Path, status: &RepositoryStatus) -> Result<WorkingTreeChangeSummary, AppError> {
    let mut summary = WorkingTreeChangeSummary::default();
    if status.staged == 0 {
        return Ok(summary);
    }
    // No explicit HEAD: an unborn branch compares the index to an empty tree.
    // Conflicts stay in their own section; only resolved index changes count.
    let rename_limit = format!("-l{MAX_FILES}");
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "diff", "--cached", "--numstat", "-z", "--find-renames", &rename_limit,
            "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "--diff-filter=ACDMRT", "--",
        ],
        MAX_STATS_BYTES,
    )?;
    if !truncated {
        ensure_success("count staged lines", &output)?;
    }
    // If Git falls back after hitting its rename limit, disclose that the
    // resulting add/delete totals do not account for all rename relationships.
    summary.partial = truncated || skipped_renames(&output.stderr);
    let mut entries = numstat_entries(complete_records(&output.stdout));
    for (_, additions, deletions) in entries.by_ref().take(MAX_FILES) {
        match (additions, deletions) {
            (Some(additions), Some(deletions)) => {
                summary.additions += additions;
                summary.deletions += deletions;
            }
            _ => summary.uncounted_files += 1,
        }
    }
    summary.partial |= entries.next().is_some();
    Ok(summary)
}

/// Unstaged changes are relative to the index, not HEAD. Never run external diff
/// drivers or read through untracked symlinks while calculating this recap.
pub fn working_tree_change_summary(path: &Path) -> Result<WorkingTreeChangeSummary, AppError> {
    inspect_recap(|| read_unstaged_summary(path, &read_summary_status(path)?))
}

fn read_unstaged_summary(path: &Path, status: &RepositoryStatus) -> Result<WorkingTreeChangeSummary, AppError> {
    if status.unstaged == 0 && status.untracked == 0 {
        return Ok(WorkingTreeChangeSummary::default());
    }
    let entries: Vec<_> = status
        .entries
        .iter()
        .filter(|entry| {
            !entry.conflicted && (entry.worktree_status != " " || entry.index_status == "?")
        })
        .collect();
    let mut summary = WorkingTreeChangeSummary {
        partial: status.entries_truncated,
        ..Default::default()
    };
    if entries.is_empty() {
        return Ok(summary);
    }
    let rename_limit = format!("-l{MAX_FILES}");
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "diff",
            "--numstat",
            "-z",
            "--find-renames",
            &rename_limit,
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=none",
            "--",
        ],
        MAX_STATS_BYTES,
    )?;
    if !truncated {
        ensure_success("count unstaged lines", &output)?;
    }
    summary.partial |= truncated || skipped_renames(&output.stderr);
    let stats = parse_numstat(complete_records(&output.stdout));
    let mut untracked = Vec::new();
    let mut remaining = MAX_UNTRACKED_BYTES;
    for entry in entries {
        git_cancellation::inspection_checkpoint()?;
        if entry.index_status == "?" {
            // The existing attribute-aware counter handles symlink blobs without
            // opening their targets. Bound aggregate regular-file reads as well.
            match fs::symlink_metadata(path.join(&entry.path)) {
                Ok(metadata) if metadata.is_symlink() => untracked.push(entry.path.as_str()),
                Ok(metadata) if metadata.is_file() && metadata.len() <= remaining => {
                    remaining -= metadata.len();
                    untracked.push(entry.path.as_str());
                }
                _ => {
                    summary.uncounted_files += 1;
                    summary.partial = true;
                }
            }
        } else {
            match stats.get(&entry.path) {
                Some((Some(additions), Some(deletions))) => {
                    summary.additions += additions;
                    summary.deletions += deletions;
                }
                Some(_) => summary.uncounted_files += 1,
                None => {
                    summary.uncounted_files += 1;
                    summary.partial = true;
                }
            }
        }
    }
    for additions in file_statistics::untracked_additions(path, &untracked)? {
        if let Some(additions) = additions {
            summary.additions += additions;
        } else {
            summary.uncounted_files += 1;
        }
    }
    Ok(summary)
}
