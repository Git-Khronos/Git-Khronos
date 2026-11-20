use super::{
    AppError, ensure_success, file_statistics, parse_numstat, read_status_with_limit,
    run_git_with_stdout_limit,
};
use serde::Serialize;
use std::{cell::RefCell, fs, path::Path, process::Command};

thread_local! {
    static READ_PROTOCOLS: RefCell<Option<Vec<String>>> = const { RefCell::new(None) };
}

/// Apply only within this optional local inspection. Modern Git understands the
/// environment guard; command-level transport refusal also protects Git 2.39.
/// User/system/global configuration is never rewritten.
pub(super) fn configure_read_command(command: &mut Command) {
    READ_PROTOCOLS.with(|slot| {
        if let Some(keys) = slot.borrow().as_ref() {
            command.env("GIT_NO_LAZY_FETCH", "1");
            command.args(["-c", "protocol.allow=never"]);
            for key in keys {
                command.arg("-c").arg(format!("{key}=never"));
            }
        }
    });
}

pub(super) fn with_local_reads<T>(
    path: &Path,
    action: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "config",
            "--null",
            "--name-only",
            "--get-regexp",
            r"^protocol\..*\.allow$",
        ],
        64 * 1024,
    )?;
    if output.status.code() != Some(1) {
        ensure_success("inspect local line-count transport policy", &output)?;
    }
    if truncated {
        return Err(AppError::new(
            "lineSummaryUnavailable",
            "Transport settings exceed the safe line-count inspection limit.",
            None,
        ));
    }
    let mut keys: Vec<String> = [
        "file", "http", "https", "git", "ssh", "ext", "ftp", "ftps", "rsync",
    ]
    .into_iter()
    .map(|protocol| format!("protocol.{protocol}.allow"))
    .collect();
    for key in output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|key| !key.is_empty())
    {
        let key = std::str::from_utf8(key).map_err(|_| {
            AppError::new(
                "lineSummaryUnavailable",
                "Transport settings cannot be safely inspected for line counts.",
                None,
            )
        })?;
        keys.push(key.to_owned());
    }
    keys.sort();
    keys.dedup();
    struct Restore(Option<Vec<String>>);
    impl Drop for Restore {
        fn drop(&mut self) {
            READ_PROTOCOLS.with(|slot| *slot.borrow_mut() = self.0.take());
        }
    }
    let _restore = Restore(READ_PROTOCOLS.with(|slot| slot.replace(Some(keys))));
    action()
}

const MAX_FILES: usize = 2_000;
const MAX_STATS_BYTES: usize = 4 * 1024 * 1024;
const MAX_UNTRACKED_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeChangeSummary {
    pub additions: usize,
    pub deletions: usize,
    pub uncounted_files: usize,
    pub partial: bool,
}

/// Unstaged changes are relative to the index, not HEAD. Never run external diff
/// drivers or read through untracked symlinks while calculating this recap.
pub fn working_tree_change_summary(path: &Path) -> Result<WorkingTreeChangeSummary, AppError> {
    with_local_reads(path, || read_summary(path))
}

fn read_summary(path: &Path) -> Result<WorkingTreeChangeSummary, AppError> {
    let status = read_status_with_limit(path, MAX_FILES)?;
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
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "diff",
            "--numstat",
            "-z",
            "--no-renames",
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
    summary.partial |= truncated;
    let complete = output
        .stdout
        .iter()
        .rposition(|byte| *byte == 0)
        .map_or(&[][..], |end| &output.stdout[..=end]);
    let stats = parse_numstat(complete);
    let mut untracked = Vec::new();
    let mut remaining = MAX_UNTRACKED_BYTES;
    for entry in entries {
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
