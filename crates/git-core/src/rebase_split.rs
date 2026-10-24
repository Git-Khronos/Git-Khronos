use super::*;

const LIMIT: u64 = 4096;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Split {
    stopped_oid: String,
    head_oid: String,
    parent_oid: String,
    tree_oid: String,
    phase: Phase,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Preparing,
    Active,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RebaseSplitStatus {
    pub preparing: bool,
    pub part_count: usize,
    pub tree_matches: bool,
}

fn failure(message: impl Into<String>) -> AppError {
    AppError::new(
        "rebaseSplitState",
        message,
        Some(
            "Preserve current changes and Abort the rebase to restore the original branch. Saved split state is never silently ignored.",
        ),
    )
}

fn oid(path: &Path, revision: &str) -> Result<String, AppError> {
    let output = run_git(path, &["rev-parse", "--verify", revision])?;
    ensure_success("inspect the stopped commit for splitting", &output)?;
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| failure("Git returned an unsupported split object."))?;
    let value = text.strip_suffix('\n').unwrap_or(text);
    validate_commit_oid(value)?;
    Ok(value.to_owned())
}

fn load(file: &Path) -> Result<Option<Split>, AppError> {
    let metadata = match fs::symlink_metadata(file) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(failure(format!(
                "Could not inspect split metadata: {error}"
            )));
        }
    };
    if !metadata.file_type().is_file() || metadata.len() > LIMIT {
        return Err(failure(
            "Saved split metadata is not a bounded regular file.",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(file)
        .and_then(|file| file.take(LIMIT + 1).read_to_end(&mut bytes))
        .map_err(|error| failure(format!("Could not read split metadata: {error}")))?;
    if bytes.len() as u64 > LIMIT {
        return Err(failure("Saved split metadata exceeds its size limit."));
    }
    let split: Split = serde_json::from_slice(&bytes)
        .map_err(|error| failure(format!("Saved split metadata is invalid: {error}")))?;
    for value in [
        &split.stopped_oid,
        &split.head_oid,
        &split.parent_oid,
        &split.tree_oid,
    ] {
        validate_commit_oid(value)
            .map_err(|_| failure("Saved split metadata contains an invalid object ID."))?;
    }
    Ok(Some(split))
}

fn save(file: &Path, split: &Split) -> Result<(), AppError> {
    operation_storage::directory(
        file.parent()
            .ok_or_else(|| failure("Split metadata has no parent directory."))?,
    )?;
    operation_storage::file(file)?;
    let bytes = serde_json::to_vec(split)
        .map_err(|error| failure(format!("Could not encode split metadata: {error}")))?;
    let lock = file.with_extension("json.lock");
    let mut stream = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|error| failure(format!("Could not lock split metadata: {error}")))?;
    let mut lock_owned = true;
    let result = (|| {
        stream
            .write_all(&bytes)
            .and_then(|()| stream.sync_all())
            .map_err(|error| failure(format!("Could not persist split metadata: {error}")))?;
        drop(stream);
        fs::rename(&lock, file)
            .map_err(|error| failure(format!("Could not install split metadata: {error}")))?;
        lock_owned = false;
        #[cfg(unix)]
        fs::File::open(
            file.parent()
                .ok_or_else(|| failure("Split metadata has no parent directory."))?,
        )
        .and_then(|directory| directory.sync_all())
        .map_err(|error| failure(format!("Could not synchronize split metadata: {error}")))?;
        Ok(())
    })();
    if result.is_err() && lock_owned {
        fs::remove_file(&lock).map_err(|error| {
            failure(format!(
                "Could not remove this operation's failed split metadata lock: {error}"
            ))
        })?;
    }
    result
}

pub(super) fn inspect(
    path: &Path,
    directory: &Path,
    rebase: bool,
    edit: bool,
) -> Result<Option<RebaseSplitStatus>, AppError> {
    if !rebase {
        return Ok(None);
    }
    let support = directory.join("git-khronos-rebase");
    operation_storage::directory(&support)?;
    let Some(split) = load(&support.join("split.json"))? else {
        return Ok(None);
    };
    if oid(path, "REBASE_HEAD")? != split.stopped_oid {
        return Ok(None);
    }
    if !edit {
        return Err(failure(
            "The saved split no longer matches an intentional Edit stop.",
        ));
    }
    if split.phase == Phase::Preparing {
        return Ok(Some(RebaseSplitStatus {
            preparing: true,
            part_count: 0,
            tree_matches: false,
        }));
    }
    let symbolic = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    if symbolic.status.code() != Some(1) {
        return Err(failure(
            "The active split no longer has a detached rebase HEAD.",
        ));
    }
    let head = oid(path, "HEAD")?;
    let count = if head == split.parent_oid {
        0
    } else {
        let (output, truncated) = run_git_with_stdout_limit(
            path,
            &[
                "rev-list",
                "--parents",
                "--max-count=501",
                &format!("{}..{head}", split.parent_oid),
            ],
            128 * 1024,
        )?;
        ensure_success("inspect the split commit chain", &output)?;
        if truncated {
            return Err(failure("The split commit chain exceeds its review limit."));
        }
        let text = std::str::from_utf8(&output.stdout)
            .map_err(|_| failure("The split commit chain has unsupported metadata."))?;
        let mut expected = head.as_str();
        let mut count = 0;
        for line in text.lines() {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() != 2 || fields[0] != expected || count >= 500 {
                return Err(failure(
                    "The split is not a bounded linear chain on its original parent.",
                ));
            }
            validate_commit_oid(fields[1])?;
            expected = fields[1];
            count += 1;
        }
        if expected != split.parent_oid {
            return Err(failure(
                "The split commit chain does not reach its original parent.",
            ));
        }
        count
    };
    Ok(Some(RebaseSplitStatus {
        preparing: false,
        part_count: count,
        tree_matches: oid(path, "HEAD^{tree}")? == split.tree_oid,
    }))
}

pub fn begin_rebase_split(path: &Path, expected_head: &str) -> Result<(), AppError> {
    validate_commit_oid(expected_head)?;
    let status = read_status(path)?;
    if !status.rebase_edit_stopped || status.conflicted > 0 {
        return Err(AppError::new(
            "rebaseSplitUnavailable",
            "Splitting requires a clean intentional Edit stop.",
            None,
        ));
    }
    if status.entry_count != 0 || status.entries_truncated {
        return Err(AppError::new(
            "dirtyWorkingTree",
            "Commit or preserve all current changes before splitting the stopped commit.",
            Some(
                "Splitting starts only from the clean replayed commit. No existing changes are unstaged or overwritten.",
            ),
        ));
    }
    require_visible_replay_index(path)?;
    if status.rebase_split.is_some() {
        return Err(failure(
            "A split is already saved at this stop. Complete its parts or Abort; do not reset it again.",
        ));
    }
    let head = oid(path, "HEAD")?;
    if head != expected_head {
        return Err(AppError::new(
            "staleRebaseSplit",
            "The stopped commit changed after split confirmation was opened.",
            Some("Review the current Edit stop and open a new confirmation."),
        ));
    }
    let symbolic = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    if symbolic.status.code() != Some(1) {
        return Err(failure(
            "Splitting requires the detached HEAD of an active rebase.",
        ));
    }
    let output = run_git(path, &["rev-list", "--parents", "--no-walk", &head, "--"])?;
    ensure_success("inspect the split parent", &output)?;
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| failure("Git returned unsupported split parent metadata."))?;
    let fields: Vec<_> = text.split_whitespace().collect();
    if fields.len() != 2 || fields[0] != head {
        return Err(AppError::new(
            "rebaseSplitUnavailable",
            "Root and merge commits require a different splitting workflow.",
            None,
        ));
    }
    validate_commit_oid(fields[1])?;
    let stopped_oid = oid(path, "REBASE_HEAD")?;
    let mut split = Split {
        stopped_oid,
        head_oid: head.clone(),
        parent_oid: fields[1].to_owned(),
        tree_oid: oid(path, "HEAD^{tree}")?,
        phase: Phase::Preparing,
    };
    if split.tree_oid == oid(path, &format!("{}^{{tree}}", split.parent_oid))? {
        return Err(AppError::new(
            "rebaseSplitUnavailable",
            "An unchanged-tree commit has no changes to split.",
            Some("Use Reword or Continue unchanged instead. No reset has run."),
        ));
    }
    let directory = rebase_support_dir(path)?;
    let original_file = directory
        .parent()
        .ok_or_else(|| failure("Rebase storage has no metadata directory."))?
        .join("rebase-merge/orig-head");
    let mut original_bytes = Vec::new();
    fs::File::open(original_file)
        .and_then(|file| file.take(66).read_to_end(&mut original_bytes))
        .map_err(|error| {
            failure(format!(
                "Could not inspect the original rebase tip: {error}"
            ))
        })?;
    let original = std::str::from_utf8(&original_bytes)
        .map_err(|_| failure("Git returned an unsupported original rebase tip."))?;
    let original = original.strip_suffix('\n').unwrap_or(original);
    validate_commit_oid(original)?;
    preserve_reference(path, original, "Original history before guided split")?;
    preserve_reference(path, &head, "Commit before guided split")?;
    fs::create_dir_all(&directory)
        .map_err(|error| failure(format!("Could not prepare split storage: {error}")))?;
    operation_storage::directory(&directory)?;
    let file = directory.join("split.json");
    save(&file, &split)?;
    if oid(path, "HEAD")? != head || oid(path, "REBASE_HEAD")? != split.stopped_oid {
        return Err(failure(
            "The Edit stop changed while split recovery was saved. The reset has not run.",
        ));
    }
    let current = read_status(path)?;
    if current.entry_count != 0 || current.entries_truncated || !current.rebase_edit_stopped {
        return Err(failure(
            "Index or working files changed after split review. The reset has not run; preserve changes before Abort.",
        ));
    }
    require_visible_replay_index(path)?;
    run_mutation(
        path,
        &["reset", "--mixed", &split.parent_oid],
        "uncommit the stopped commit for guided splitting",
    )?;
    if oid(path, "HEAD")? != split.parent_oid {
        return Err(failure(
            "The split reset did not retain the expected parent.",
        ));
    }
    split.phase = Phase::Active;
    save(&file, &split)
}

pub(super) fn require_continue(status: &RepositoryStatus) -> Result<(), AppError> {
    let Some(split) = &status.rebase_split else {
        return Ok(());
    };
    if split.preparing
        || split.part_count < 2
        || !split.tree_matches
        || status.entry_count != 0
        || status.entries_truncated
    {
        return Err(AppError::new(
            "rebaseSplitIncomplete",
            "The guided split is not complete.",
            Some(
                "Create at least two explicit commits, finish all remaining changes and preserve the original stopped tree before Continue; or Abort the rebase. Nothing is committed automatically.",
            ),
        ));
    }
    Ok(())
}
