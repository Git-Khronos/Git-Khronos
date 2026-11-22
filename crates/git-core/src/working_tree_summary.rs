use super::{
    AppError, ensure_success, file_statistics, git_cancellation, is_explicit_bare_repository,
    numstat_entries, porcelain_status_conflicted, porcelain_status_records, run_git_with_stdout_limit,
    without_lazy_fetch,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::Duration,
};

const MAX_FILES: usize = 2_000;
const MAX_STATUS_BYTES: usize = 4 * 1024 * 1024;
const MAX_STATS_BYTES: usize = 4 * 1024 * 1024;
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
        let Some(status) = status else {
            // A full status stream isn't necessary for either line count.
            // Use independent bounded sources under the same deadline.
            let unstaged = read_unstaged_without_status(path).ok();
            let staged = read_staged_summary(path, true).ok();
            return Ok(WorkingTreeSummaries { staged, unstaged });
        };
        Ok(WorkingTreeSummaries {
            staged: read_staged_summary(path, status.has_staged).ok(),
            unstaged: read_unstaged_summary(path, &status).ok(),
        })
    })
}

struct UnstagedPath {
    name: Vec<u8>,
    untracked: bool,
}

#[derive(Default)]
struct RecapStatus {
    has_staged: bool,
    unstaged_paths: Vec<UnstagedPath>,
    unstaged_partial: bool,
}

fn read_summary_status(path: &Path) -> Result<Option<RecapStatus>, AppError> {
    if is_explicit_bare_repository(path) {
        return Ok(Some(RecapStatus::default()));
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
        return Ok(None);
    }
    ensure_success("read working-tree summary status", &output)?;
    let mut status = RecapStatus::default();
    // A staged-only path must not consume the unstaged budget. Keep bytes,
    // not a display string: unrelated non-UTF-8 names can look identical.
    for (record, _) in porcelain_status_records(&output.stdout) {
        if record.len() < 4 || record.starts_with(b"## ") || porcelain_status_conflicted(&record[..2]) {
            continue;
        }
        let untracked = record.starts_with(b"??");
        status.has_staged |= !untracked && !matches!(record[0], b' ' | b'!');
        if untracked || !matches!(record[1], b' ' | b'!') {
            if status.unstaged_paths.len() == MAX_FILES {
                status.unstaged_partial = true;
            } else {
                status.unstaged_paths.push(UnstagedPath {
                    name: record[3..].to_vec(),
                    untracked,
                });
            }
        }
    }
    Ok(Some(status))
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

fn read_staged_summary(path: &Path, has_staged: bool) -> Result<WorkingTreeChangeSummary, AppError> {
    let mut summary = WorkingTreeChangeSummary::default();
    if !has_staged {
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
    inspect_recap(|| match read_summary_status(path)? {
        Some(status) => read_unstaged_summary(path, &status),
        None => read_unstaged_without_status(path),
    })
}

fn unstaged_numstat(path: &Path) -> Result<(Vec<u8>, bool), AppError> {
    let rename_limit = format!("-l{MAX_FILES}");
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "diff", "--numstat", "-z", "--find-renames", &rename_limit,
            "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "--",
        ],
        MAX_STATS_BYTES,
    )?;
    if !truncated {
        ensure_success("count unstaged lines", &output)?;
    }
    Ok((output.stdout, truncated || skipped_renames(&output.stderr)))
}

fn read_unstaged_summary(path: &Path, status: &RecapStatus) -> Result<WorkingTreeChangeSummary, AppError> {
    let entries = &status.unstaged_paths;
    let mut summary = WorkingTreeChangeSummary {
        partial: status.unstaged_partial,
        ..Default::default()
    };
    if entries.is_empty() {
        return Ok(summary);
    }
    // Git diff has no rows for ordinary untracked names. Do not scan the
    // tracked index again unless this recap can use at least one such row.
    let stats_output = if entries.iter().any(|entry| !entry.untracked) {
        let (output, partial) = unstaged_numstat(path)?;
        summary.partial |= partial;
        output
    } else {
        Vec::new()
    };
    let stats: HashMap<_, _> = numstat_entries(complete_records(&stats_output))
        .map(|(path, additions, deletions)| (path, (additions, deletions)))
        .collect();
    for entry in entries.iter().filter(|entry| !entry.untracked) {
        git_cancellation::inspection_checkpoint()?;
        match stats.get(entry.name.as_slice()) {
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
    count_untracked(
        path,
        entries.iter().filter(|entry| entry.untracked).map(|entry| entry.name.as_slice()),
        &mut summary,
    )?;
    Ok(summary)
}

fn read_unstaged_without_status(path: &Path) -> Result<WorkingTreeChangeSummary, AppError> {
    // A conflicted path can have both an unmerged and a modified numstat
    // record. Filtering the diff by change type alone leaves the latter.
    let (conflict, truncated) =
        run_git_with_stdout_limit(path, &["ls-files", "--unmerged", "-z"], MAX_STATUS_BYTES)?;
    let incomplete_conflicts = || {
        AppError::new(
            "workingTreeSummaryConflictPaths",
            "Could not verify all unmerged paths for the unstaged line count.",
            None,
        )
    };
    if truncated || (!conflict.stdout.is_empty() && !conflict.stdout.ends_with(&[0])) {
        return Err(incomplete_conflicts());
    }
    ensure_success("read unmerged paths for the unstaged line count", &conflict)?;
    let mut blocked = HashSet::new();
    for row in conflict.stdout.split(|byte| *byte == 0).filter(|row| !row.is_empty()) {
        let separator = row.iter().position(|byte| *byte == b'\t').ok_or_else(incomplete_conflicts)?;
        blocked.insert(&row[separator + 1..]);
    }
    let (tracked, partial) = unstaged_numstat(path)?;
    let mut summary = WorkingTreeChangeSummary { partial, ..Default::default() };
    let mut remaining = MAX_FILES;
    for (name, additions, deletions) in numstat_entries(complete_records(&tracked)) {
        if blocked.contains(name) {
            continue;
        }
        if remaining == 0 {
            summary.partial = true;
            return Ok(summary);
        }
        remaining -= 1;
        match (additions, deletions) {
            (Some(additions), Some(deletions)) => {
                summary.additions += additions;
                summary.deletions += deletions;
            }
            _ => summary.uncounted_files += 1,
        }
    }
    let (output, truncated) = run_git_with_stdout_limit(
        path, &["ls-files", "--others", "--exclude-standard", "-z"], MAX_STATUS_BYTES,
    )?;
    if !truncated {
        ensure_success("read untracked paths for the unstaged line count", &output)?;
    }
    let mut rows = complete_records(&output.stdout).split(|byte| *byte == 0).filter(|row| !row.is_empty());
    count_untracked(path, rows.by_ref().take(remaining), &mut summary)?;
    summary.partial |= truncated || rows.next().is_some();
    Ok(summary)
}

fn count_untracked<'a>(
    path: &Path,
    names: impl Iterator<Item = &'a [u8]>,
    summary: &mut WorkingTreeChangeSummary,
) -> Result<(), AppError> {
    let mut paths = Vec::new();
    for name in names {
        git_cancellation::inspection_checkpoint()?;
        // The file/attribute reader accepts UTF-8 paths. Never open a
        // different, valid filename obtained by substituting bytes.
        if let Ok(name) = std::str::from_utf8(name) {
            paths.push(name);
        } else {
            summary.uncounted_files += 1;
            summary.partial = true;
        }
    }
    let counts = file_statistics::untracked_additions(path, &paths)?;
    summary.partial |= counts.partial;
    for additions in counts.counts {
        if let Some(additions) = additions {
            summary.additions += additions;
        } else {
            summary.uncounted_files += 1;
        }
    }
    Ok(())
}
